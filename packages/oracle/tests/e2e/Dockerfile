ARG NODE_VERSION=26
FROM docker.io/library/node:${NODE_VERSION}-alpine

ARG E2E_SUITE=oracledb

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/oracle/package.json packages/oracle/tsconfig.json ./packages/oracle/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/oracle/src ./packages/oracle/src

RUN npm run build

COPY packages/oracle/tests/e2e/${E2E_SUITE} ./packages/oracle/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/oracle/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
