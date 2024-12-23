# Getting AWS Secrets Manager Working with EKS

This guide shows how to get your AWS Secrets Manager secrets into Kubernetes using External Secrets Operator (ESO).

## Before You Start

Make sure you have:
- AWS CLI set up
- Access to your EKS cluster with `kubectl`
- `helm` (v3+)

## Setting Things Up

### 1. Get ESO Running

First, install ESO using Helm:

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm install external-secrets \
    external-secrets/external-secrets \
    --namespace external-secrets \
    --create-namespace \
    --set installCRDs=true
```

### 2. OIDC Setup

You need this for AWS IAM authentication. The easy way:

```bash
eksctl utils associate-iam-oidc-provider \
    --region your-region \
    --cluster your-cluster-name \
    --approve
```

If you prefer clicking around in AWS Console:
1. Head to IAM → Identity Providers → Add Provider
2. Pick OpenID Connect
3. Grab your cluster's OIDC URL (you can find this in EKS cluster details)
4. Put `sts.amazonaws.com` as the audience
5. Add it

### 3. IAM Setup

#### Policy First
Create a policy that lets you read secrets. Something like:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": [
                "arn:aws:secretsmanager:region:account-id:secret:GitOpsApp*"
            ]
        }
    ]
}
```

#### Then the Role

Create a role with this trust relationship (replace the obvious placeholder bits):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/oidc.eks.REGION.amazonaws.com/id/OIDC_ID"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringEquals": {
                    "oidc.eks.REGION.amazonaws.com/id/OIDC_ID:sub": "system:serviceaccount:default:gitops-app-sa",
                    "oidc.eks.REGION.amazonaws.com/id/OIDC_ID:aud": "sts.amazonaws.com"
                }
            }
        }
    ]
}
```

### 4. Kubernetes Bits

A service account to use the IAM role:
```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gitops-app-sa
  namespace: default
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT_ID:role/eks-gitops-app-role
```

Tell ESO how to talk to AWS:
```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: gitops-app-secrets-store
spec:
  provider:
    aws:
      service: SecretsManager
      region: eu-central-1
      auth:
        jwt:
          serviceAccountRef:
            name: gitops-app-sa
```

Define which secrets you want to pull:
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: gitops-app-eso
spec:
  refreshInterval: 2m  # Update this based on how often you want secrets synced
  secretStoreRef:
    name: gitops-app-secrets-store
    kind: SecretStore
  target:
    name: gitops-app-eso-secret
    creationPolicy: Owner
  data:
    - secretKey: APP_NAME
      remoteRef:
        key: GitOpsApp
        property: APP_NAME
    - secretKey: NODE_ENV
      remoteRef:
        key: GitOpsApp
        property: NODE_ENV
```

Finally, use it in your deployment:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitops-app-deployment
spec:
  template:
    spec:
      serviceAccountName: gitops-app-sa
      containers:
      - name: app
        envFrom:
        - secretRef:
            name: gitops-app-eso-secret
```

## Why This Is Cool

ESO (EKS-Optimized Storage) automatically syncs your AWS secrets (or any other secrets store, such as HashiCorp Vault) into Kubernetes secrets. Once it's set up, it's largely hands-off: simply update your secret in AWS Secrets Manager (or your chosen secrets store), and ESO will fetch the new version within the configured refresh interval.

Since ESO creates regular Kubernetes secrets, you don't need to change how your applications interact with them. They will continue to read secrets as they always have.

---

## Important Note About Secret Updates ⚠️

❗️ **When ESO syncs new secret values, existing pods will not automatically pick up the changes.** To apply the updated secrets, you'll need to trigger a deployment rollout.

You can do this by running the following command:

```bash
kubectl rollout restart deployment <DEPLOYMENT_NAME>
```

Alternatively, if you're using Lens or another Kubernetes dashboard, you can trigger the rollout directly from the UI by clicking the "Restart" button on your deployment.

---

### Why This Happens

Kubernetes only reads secret values when mounting them during pod creation. To apply new secret values, the affected pods must be recreated, hence the need to trigger a deployment rollout.

