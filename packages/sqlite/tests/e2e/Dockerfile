FROM docker.io/library/node:26-alpine

ARG E2E_SUITE=node-sqlite

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/postgres/package.json packages/postgres/tsconfig.json ./packages/postgres/
COPY packages/mysql/package.json packages/mysql/tsconfig.json ./packages/mysql/
COPY packages/typeorm/package.json packages/typeorm/tsconfig.json ./packages/typeorm/
COPY packages/sequelize/package.json packages/sequelize/tsconfig.json ./packages/sequelize/
COPY packages/knex/package.json packages/knex/tsconfig.json ./packages/knex/
COPY packages/sqlite/package.json packages/sqlite/tsconfig.json ./packages/sqlite/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/postgres/src ./packages/postgres/src
COPY packages/mysql/src ./packages/mysql/src
COPY packages/typeorm/src ./packages/typeorm/src
COPY packages/sequelize/src ./packages/sequelize/src
COPY packages/knex/src ./packages/knex/src
COPY packages/sqlite/src ./packages/sqlite/src

RUN npm run build

COPY packages/sqlite/tests/e2e/${E2E_SUITE} ./packages/sqlite/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/sqlite/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
