# Testing Guide

## Quick Start

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Writing Tests

### Test Structure

We use **Jest** as our testing framework. Tests are located in `src/__tests__/`.

```typescript
import { MigrationCoordinator } from '../coordinator/migration-coordinator';
import { MockSqlDriver, MockLockProvider, MockMigrationRunner } from './mocks';

describe('MigrationCoordinator', () => {
  let driver: MockSqlDriver;
  let lockProvider: MockLockProvider;
  let migrationRunner: MockMigrationRunner;

  beforeEach(() => {
    driver = new MockSqlDriver();
    lockProvider = new MockLockProvider();
    migrationRunner = new MockMigrationRunner();
  });

  it('should execute successful migration', async () => {
    const coordinator = new MigrationCoordinator({
      driver,
      lockProvider,
      migrationRunner,
    });

    await coordinator.migrate();

    expect(lockProvider.acquireCalls).toBe(1);
    expect(migrationRunner.runCalls).toBe(1);
    expect(lockProvider.releaseCalls).toBe(1);
  });
});
```

### Using Mocks

We provide mock implementations in `__tests__/mocks.ts`:

#### MockSqlDriver

```typescript
const driver = new MockSqlDriver();

// Mock query results
driver.mockQueryResult('SELECT 1', [{ result: 1 }]);

// Simulate failure
driver.shouldFail = true;

// Check queries executed
expect(driver.getQueryCount()).toBe(3);
expect(driver.getLastQuery()?.sql).toContain('SELECT');
```

#### MockLockProvider

```typescript
const lockProvider = new MockLockProvider();

// Simulate lock acquisition sequence
lockProvider.setAcquireSequence([false, false, true]); // Fail twice, then succeed

// Simulate failure
lockProvider.shouldAcquireSucceed = false;

// Check calls
expect(lockProvider.acquireCalls).toBe(3);
```

#### MockMigrationRunner

```typescript
const runner = new MockMigrationRunner();

// Simulate failure
runner.shouldFail = true;
runner.failureError = new Error('Migration failed');

// Check execution
expect(runner.runCalls).toBe(1);
```

### Testing Patterns

#### 1. Testing Success Flows

```typescript
it('should complete successfully', async () => {
  // Arrange
  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner,
  });

  // Act
  await coordinator.migrate();

  // Assert
  expect(migrationRunner.runCalls).toBe(1);
});
```

#### 2. Testing Error Scenarios

```typescript
it('should throw LockTimeoutError', async () => {
  lockProvider.shouldAcquireSucceed = false;

  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner,
    retryConfig: { maxRetries: 3, retryIntervalMs: 10 },
  });

  await expect(coordinator.migrate()).rejects.toThrow(LockTimeoutError);
});
```

#### 3. Testing Lifecycle Hooks

```typescript
it('should call hooks in order', async () => {
  const callOrder: string[] = [];

  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner,
    onLockAcquired: () => callOrder.push('acquired'),
    onMigrationComplete: () => callOrder.push('complete'),
  });

  await coordinator.migrate();

  expect(callOrder).toEqual(['acquired', 'complete']);
});
```

#### 4. Testing Retry Logic

```typescript
it('should retry until success', async () => {
  lockProvider.setAcquireSequence([false, false, true]);

  const onRetry = jest.fn();
  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner,
    onLockWaiting: onRetry,
  });

  await coordinator.migrate();

  expect(onRetry).toHaveBeenCalledTimes(2);
  expect(lockProvider.acquireCalls).toBe(3);
});
```

#### 5. Testing AbortSignal

```typescript
it('should respect abort signal', async () => {
  lockProvider.shouldAcquireSucceed = false;
  const controller = new AbortController();

  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner,
    retryConfig: { maxRetries: 100, retryIntervalMs: 50 },
  });

  setTimeout(() => controller.abort(), 100);

  await expect(coordinator.migrate(controller.signal)).rejects.toThrow();
});
```

### E2E Testing

For end-to-end tests, create realistic implementations:

```typescript
class InMemoryDatabase {
  private data = new Map<string, any>();
  // ... implementation
}

class TestSqlDriver implements SqlDriver {
  constructor(private db: InMemoryDatabase) {}
  
  async query<T>(sql: string, params?: any[]): Promise<T[]> {
    // Simulate real database behavior
  }
}

describe('E2E Tests', () => {
  it('should handle complete flow', async () => {
    const db = new InMemoryDatabase();
    const driver = new TestSqlDriver(db);
    // ... test complete flow
  });
});
```

## Test Organization

```
src/__tests__/
├── errors.test.ts           # Error class tests
├── retry.test.ts            # Retry utility tests
├── coordinator.test.ts      # MigrationCoordinator unit tests
├── integration.test.ts      # E2E integration tests
└── mocks.ts                 # Mock implementations
```

## Coverage Requirements

We maintain high code coverage:

- Statements: 85%+
- Branches: 80%+
- Lines: 85%+

Run `npm run test:coverage` to see coverage report.

## Tips

1. **Use descriptive test names**: Test names should clearly describe what's being tested
2. **One assertion concept per test**: Keep tests focused
3. **Test edge cases**: Don't just test the happy path
4. **Use mocks appropriately**: Mock external dependencies, not internal logic
5. **Test error paths**: Ensure all error scenarios are covered
6. **Verify cleanup**: Ensure locks are released, connections closed, etc.

## Debugging Tests

```bash
# Run a specific test file
npm test -- errors.test.ts

# Run tests matching a pattern
npm test -- --testNamePattern="should retry"

# Run in debug mode
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Continuous Integration

Tests run automatically on:
- Pull requests
- Commits to main branch
- Pre-publish hooks

All tests must pass before merging.

