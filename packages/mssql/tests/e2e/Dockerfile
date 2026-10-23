FROM docker.io/library/node:26-alpine

ARG E2E_SUITE=tedious

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/mssql/package.json packages/mssql/tsconfig.json ./packages/mssql/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/mssql/src ./packages/mssql/src

RUN npm run build

COPY packages/mssql/tests/e2e/${E2E_SUITE} ./packages/mssql/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/mssql/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
