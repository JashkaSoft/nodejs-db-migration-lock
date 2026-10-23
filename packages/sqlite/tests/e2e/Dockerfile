FROM docker.io/library/node:26-alpine

ARG E2E_SUITE=node-sqlite

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/sqlite/package.json packages/sqlite/tsconfig.json ./packages/sqlite/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/sqlite/src ./packages/sqlite/src

RUN npm run build

COPY packages/sqlite/tests/e2e/${E2E_SUITE} ./packages/sqlite/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/sqlite/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
