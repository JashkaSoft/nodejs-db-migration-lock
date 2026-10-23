FROM docker.io/library/node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/mssql ./packages/mssql

RUN npm install && npm run build

COPY examples/express-mssql ./examples/express-mssql
WORKDIR /app/examples/express-mssql
RUN npm install && npx tsc

EXPOSE 3000
CMD ["node", "dist/main.js"]
