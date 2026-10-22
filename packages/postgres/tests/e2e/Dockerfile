FROM node:26-alpine

WORKDIR /app

COPY package.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/postgres/package.json packages/postgres/tsconfig.json ./packages/postgres/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/postgres/src ./packages/postgres/src

RUN npm run build

COPY packages/postgres/tests/e2e ./packages/postgres/tests/e2e

WORKDIR /app/packages/postgres/tests/e2e
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
