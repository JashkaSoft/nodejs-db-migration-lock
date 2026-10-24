FROM docker.io/library/node:26-alpine

ARG E2E_SUITE=pg

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/yugabyte/package.json packages/yugabyte/tsconfig.json ./packages/yugabyte/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/yugabyte/src ./packages/yugabyte/src

RUN npm run build

COPY packages/yugabyte/tests/e2e/${E2E_SUITE} ./packages/yugabyte/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/yugabyte/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
