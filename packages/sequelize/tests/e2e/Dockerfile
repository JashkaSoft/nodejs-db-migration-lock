FROM docker.io/library/node:26-alpine

ARG E2E_SUITE=postgres

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/postgres/package.json packages/postgres/tsconfig.json ./packages/postgres/
COPY packages/mysql/package.json packages/mysql/tsconfig.json ./packages/mysql/
COPY packages/typeorm/package.json packages/typeorm/tsconfig.json ./packages/typeorm/
COPY packages/sequelize/package.json packages/sequelize/tsconfig.json ./packages/sequelize/

RUN npm install

COPY packages/core/src ./packages/core/src
COPY packages/postgres/src ./packages/postgres/src
COPY packages/mysql/src ./packages/mysql/src
COPY packages/typeorm/src ./packages/typeorm/src
COPY packages/sequelize/src ./packages/sequelize/src

RUN npm run build

COPY packages/sequelize/tests/e2e/${E2E_SUITE} ./packages/sequelize/tests/e2e/${E2E_SUITE}

WORKDIR /app/packages/sequelize/tests/e2e/${E2E_SUITE}
RUN npm install
RUN npx tsc

CMD ["node", "dist/migrate.js"]
