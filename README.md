# AWS Secrets Manager Integration with EKS

This guide explains how to set up AWS Secrets Manager integration with EKS using the Secrets Store CSI Driver.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Installation Steps](#installation-steps)
  - [1. Install Secrets Store CSI Driver](#1-install-secrets-store-csi-driver)
  - [2. Install AWS Provider](#2-install-aws-provider)
  - [3. Create OIDC Provider](#3-create-oidc-provider)
  - [4. Set up IAM Role and Policies](#4-set-up-iam-role-and-policies)
  - [5. Configure Kubernetes Resources](#5-configure-kubernetes-resources)

## Prerequisites

- AWS CLI configured with appropriate permissions
- `kubectl` configured to interact with your EKS cluster
- `helm` installed (v3.0+)
- An existing EKS cluster

## Installation Steps

### 1. Install Secrets Store CSI Driver

```bash
# Add the Secrets Store CSI driver Helm repository
helm repo add secrets-store-csi-driver https://kubernetes-sigs.github.io/secrets-store-csi-driver/charts
helm repo update

# Install the Secrets Store CSI driver
helm install csi-secrets-store secrets-store-csi-driver/secrets-store-csi-driver \
    --namespace kube-system \
    --set syncSecret.enabled=true \
    --set enableSecretRotation=true \
    --set rotationPollInterval=2m
```

### 2. Install AWS Provider

```bash
# Install the AWS provider
kubectl apply -f https://raw.githubusercontent.com/aws/secrets-store-csi-driver-provider-aws/main/deployment/aws-provider-installer.yaml
```

### 3. Create OIDC Provider

```bash
# Get your cluster's OIDC provider URL
aws eks describe-cluster --name your-cluster-name --query "cluster.identity.oidc.issuer" --output text

# Create the OIDC provider
eksctl utils associate-iam-oidc-provider \
    --region your-region \
    --cluster your-cluster-name \
    --approve
```

Alternatively, you can create it in the AWS Console:
1. Go to IAM → Identity Providers → Add Provider
2. Select OpenID Connect
3. Enter your EKS cluster's OIDC endpoint URL
4. For Audience, enter: sts.amazonaws.com
5. Click "Add provider"

### 4. Set up IAM Role and Policies

#### Create Secrets Manager Access Policy

Create a policy (e.g., `eks-secrets-manager-gitops-access`) with the following permissions:

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

#### Create IAM Role

Create a role (e.g., `eks-gitops-app-role`) with the following trust relationship:

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

Attach the Secrets Manager access policy to this role.

### 5. Configure Kubernetes Resources

#### Create Service Account

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: gitops-app-sa
  namespace: default
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::ACCOUNT_ID:role/eks-gitops-app-role
```

#### Create SecretProviderClass

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: aws-secrets-manager
  namespace: default
spec:
  provider: aws
  parameters:
    objects: |
      - objectName: "GitOpsApp"
        objectType: secretsmanager
        jmesPath:
          - path: NODE_ENV
            objectAlias: NODE_ENV
          - path: APP_NAME
            objectAlias: APP_NAME
    region: eu-central-1
  secretObjects:
  - data:
    - key: NODE_ENV
      objectName: NODE_ENV
    - key: APP_NAME
      objectName: APP_NAME
    secretName: gitops-app-secret
    type: Opaque
```

#### Update Deployment

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
        volumeMounts:
        - name: secrets-store
          mountPath: "/mnt/secrets"
          readOnly: true
        envFrom:
        - secretRef:
            name: gitops-app-secret
      volumes:
      - name: secrets-store
        csi:
          driver: secrets-store.csi.k8s.io
          readOnly: true
          volumeAttributes:
            secretProviderClass: aws-secrets-manager
```

