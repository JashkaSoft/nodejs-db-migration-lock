FROM docker.io/library/node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/postgres ./packages/postgres
COPY packages/mysql ./packages/mysql
COPY packages/typeorm ./packages/typeorm

RUN npm install && npm run build

COPY examples/express-typeorm ./examples/express-typeorm
WORKDIR /app/examples/express-typeorm
RUN npm install && npx tsc

EXPOSE 3000
CMD ["node", "dist/main.js"]
