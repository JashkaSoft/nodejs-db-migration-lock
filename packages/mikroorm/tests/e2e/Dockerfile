ARG NODE_VERSION=26
FROM docker.io/library/node:${NODE_VERSION}-alpine

ARG E2E_SUITE=postgres

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/mikroorm/package.json packages/mikroorm/tsconfig.json ./packages/mikroorm/
COPY packages/${E2E_SUITE}/package.json packages/${E2E_SUITE}/tsconfig.json ./packages/${E2E_SUITE}/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/mikroorm/src ./packages/mikroorm/src
COPY packages/${E2E_SUITE}/src ./packages/${E2E_SUITE}/src

RUN npm run build

COPY packages/mikroorm/tests/e2e/${E2E_SUITE} ./packages/mikroorm/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/mikroorm/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
