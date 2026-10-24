ARG NODE_VERSION=26
FROM docker.io/library/node:${NODE_VERSION}-alpine

ARG E2E_SUITE=pg

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/cockroach/package.json packages/cockroach/tsconfig.json ./packages/cockroach/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/cockroach/src ./packages/cockroach/src

RUN npm run build

COPY packages/cockroach/tests/e2e/${E2E_SUITE} ./packages/cockroach/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/cockroach/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
