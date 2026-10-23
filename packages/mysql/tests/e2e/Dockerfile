FROM docker.io/library/node:26-alpine

ARG E2E_SUITE=typeorm

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/mysql/package.json packages/mysql/tsconfig.json ./packages/mysql/
COPY packages/typeorm/package.json packages/typeorm/tsconfig.json ./packages/typeorm/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/mysql/src ./packages/mysql/src
COPY packages/typeorm/src ./packages/typeorm/src

RUN npm run build

COPY packages/mysql/tests/e2e/${E2E_SUITE} ./packages/mysql/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/mysql/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
