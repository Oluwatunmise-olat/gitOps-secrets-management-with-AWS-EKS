FROM node:18-alpine as base

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

CMD ["node", "index.js"]