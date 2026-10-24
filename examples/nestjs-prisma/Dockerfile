FROM docker.io/library/node:26-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY lerna.json ./
COPY tsconfig.json ./
COPY packages/core ./packages/core
COPY packages/postgres ./packages/postgres

RUN npm install && npm run build

COPY examples/nestjs-prisma ./examples/nestjs-prisma
WORKDIR /app/examples/nestjs-prisma
ENV DATABASE_URL=postgresql://app:app@postgres:5432/app
RUN npm install && npx prisma generate && npx tsc

EXPOSE 3000
CMD ["node", "dist/main.js"]
