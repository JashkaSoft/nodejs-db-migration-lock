# Contributing to nodejs-db-migration-lock

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## 🌟 Ways to Contribute

- **Add support for another database** or lock strategy
- **Implement new lock strategies** for existing databases
- **Improve documentation** and add examples
- **Report bugs** and suggest features
- **Write tests** and improve code quality
- **Review pull requests**

## 🏗️ Project Structure

```
nodejs-db-migration-lock/
├── packages/
│   ├── core/              # Core library (database-agnostic)
│   │   ├── src/
│   │   │   ├── coordinator/    # MigrationCoordinator
│   │   │   ├── errors/         # Error types
│   │   │   ├── interfaces/     # Core interfaces
│   │   │   ├── lock/           # Lock keys, holder, process mutex
│   │   │   └── retry/          # Retry logic
│   │   └── package.json
│   │
│   ├── postgres/          # PostgreSQL locks + NodePgDriver
│   ├── mysql/             # MySQL locks + Mysql2Driver
│   ├── typeorm/           # TypeORM DataSource adapter (DB-agnostic)
│   ├── sequelize/         # Sequelize adapter (DB-agnostic)
│   ├── knex/              # Knex adapter (DB-agnostic)
│   ├── sqlite/            # SQLite table lock + NodeSqliteDriver
│   ├── mssql/             # SQL Server sp_getapplock + TediousDriver
│   ├── oracle/            # Oracle DBMS_LOCK + OracleDriver
│   ├── cockroach/         # CockroachDB table lease + CockroachDriver
│   ├── yugabyte/          # YugabyteDB table lease + YugabyteDriver
│   ├── mikroorm/          # MikroORM adapter (DB-agnostic)
│   └── kysely/            # Kysely adapter (DB-agnostic)
│
├── examples/              # Usage examples
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 24.15 (CI and Docker use 26, the current Node.js release)
- npm >= 11
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/nodejs-db-migration-lock.git
cd nodejs-db-migration-lock

# Install dependencies
npm install

# Build all packages
npm run build

# Run unit tests
npm test

# Run PostgreSQL e2e tests (requires podman-compose or docker compose)
npm run test:e2e:postgres
```

CI runs unit tests and every adapter e2e suite on pull requests (MySQL 9.7 and Postgres 18). MySQL 8.4 and MariaDB 11.8 run the mysql2 suite on `main` and weekly.

## 📝 Adding Support for a New Database

Here's a step-by-step guide to add support for a new database (e.g., MySQL). Add lock providers and a native client driver only. Do not copy TypeORM, Sequelize, or Knex into the dialect package — use `@nodejs-db-migration-lock/typeorm`, `@nodejs-db-migration-lock/sequelize`, or `@nodejs-db-migration-lock/knex`.

### 1. Create Package Structure

```bash
mkdir -p packages/mysql/src
cd packages/mysql
```

### 2. Create package.json

```json
{
  "name": "@nodejs-db-migration-lock/mysql",
  "version": "0.1.0",
  "description": "MySQL adapter for database migration locking",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc --build"
  },
  "dependencies": {
    "@nodejs-db-migration-lock/core": "^0.1.0"
  },
  "peerDependencies": {
    "mysql2": "^3.0.0"
  },
  "peerDependenciesMeta": {
    "mysql2": { "optional": true }
  }
}
```

### 3. Implement SqlDriver

```typescript
// packages/mysql/src/mysql-driver.ts
import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { Pool } from 'mysql2/promise';

export class MySQLDriver implements SqlDriver {
  constructor(private pool: Pool) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params);
    return rows as T[];
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

### 4. Implement LockProvider

```typescript
// packages/mysql/src/advisory-lock.ts
import { LockProvider, SqlDriver } from '@nodejs-db-migration-lock/core';

export class MySQLAdvisoryLock implements LockProvider {
  name = 'mysql-advisory-lock';
  
  constructor(private lockName: string = 'migration_lock') {}

  async acquire(driver: SqlDriver): Promise<boolean> {
    const result = await driver.query(
      'SELECT GET_LOCK(?, 0) as lock_result',
      [this.lockName]
    );
    return result[0]?.lock_result === 1;
  }

  async release(driver: SqlDriver): Promise<void> {
    await driver.query('SELECT RELEASE_LOCK(?)', [this.lockName]);
  }
}
```

### 5. Create index.ts

```typescript
// packages/mysql/src/index.ts
export { MySQLDriver } from './mysql-driver';
export { MySQLAdvisoryLock } from './advisory-lock';
```

### 6. Add TypeScript Config

```json
// packages/mysql/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [
    { "path": "../core" }
  ]
}
```

### 7. Write Tests

```typescript
// packages/mysql/src/__tests__/advisory-lock.test.ts
import { MySQLAdvisoryLock } from '../advisory-lock';

describe('MySQLAdvisoryLock', () => {
  it('should acquire lock', async () => {
    // Your tests here
  });
});
```

### 8. Write Documentation

Create `packages/mysql/README.md` with:
- Installation instructions
- Usage examples
- API documentation
- Differences from other databases

### 9. Add Example

Create `examples/mysql-example.ts` showing real-world usage.

## 🧪 Testing

- Write unit tests for all new code
- Add integration tests where applicable
- Ensure all tests pass before submitting PR

```bash
npm run test
```

## 📖 Documentation

- Update README.md files for any changes
- Add JSDoc comments to all public APIs
- Include usage examples for new features
- Update the main README.md if adding a new package

## 🔍 Code Style

- Use TypeScript
- Follow existing code style
- Use meaningful variable names
- Add comments for complex logic
- Export interfaces and types properly

## 📋 Checklist for New Database Support

- [ ] Created package structure
- [ ] Implemented `SqlDriver` adapter
- [ ] Implemented at least one `LockProvider`
- [ ] Added TypeScript declarations
- [ ] Wrote comprehensive tests
- [ ] Created README.md with examples
- [ ] Added entry in main README.md
- [ ] Created example file in `/examples`
- [ ] Updated CHANGELOG.md
- [ ] All tests pass
- [ ] Documentation is clear and complete

## 🐛 Reporting Bugs

When reporting bugs, please include:

- Node.js version
- Database and version
- Package versions
- Minimal reproduction code
- Expected vs actual behavior
- Error messages and stack traces

## 💡 Suggesting Features

- Check if feature already exists or is planned
- Describe the use case clearly
- Provide example code of how it would work
- Explain why it would be useful

## 🔄 Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm run test`)
5. Build packages (`npm run build`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

### PR Guidelines

- Write clear commit messages
- Reference related issues
- Include tests for new features
- Update documentation
- Keep PRs focused (one feature/fix per PR)

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.

## ❓ Questions?

- Open an issue for questions
- Join our discussions
- Check existing documentation

Thank you for contributing! 🎉

