FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY lerna.json ./
COPY tsconfig.json ./

# Copy packages
COPY packages/core ./packages/core
COPY packages/postgres ./packages/postgres

# Install root dependencies and build packages
RUN npm install
RUN npm run build

# Copy e2e tests
COPY packages/postgres/e2e ./packages/postgres/e2e

# Install e2e dependencies
WORKDIR /app/packages/postgres/e2e
RUN npm install

# Compile TypeScript files to JavaScript
RUN npx tsc

WORKDIR /app/packages/postgres/e2e

CMD ["node", "dist/migrate.js"]
