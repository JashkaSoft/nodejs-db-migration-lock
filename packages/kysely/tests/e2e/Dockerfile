FROM docker.io/library/node:26-alpine

ARG E2E_SUITE=postgres

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/kysely/package.json packages/kysely/tsconfig.json ./packages/kysely/
COPY packages/${E2E_SUITE}/package.json packages/${E2E_SUITE}/tsconfig.json ./packages/${E2E_SUITE}/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/kysely/src ./packages/kysely/src
COPY packages/${E2E_SUITE}/src ./packages/${E2E_SUITE}/src

RUN npm run build

COPY packages/kysely/tests/e2e/${E2E_SUITE} ./packages/kysely/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/kysely/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
