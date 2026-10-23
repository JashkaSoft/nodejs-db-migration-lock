FROM docker.io/library/node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/postgres ./packages/postgres
COPY packages/mysql ./packages/mysql

RUN npm install && npm run build

COPY examples/fastify-typeorm ./examples/fastify-typeorm
WORKDIR /app/examples/fastify-typeorm
RUN npm install && npx tsc

EXPOSE 3000
CMD ["node", "dist/main.js"]
