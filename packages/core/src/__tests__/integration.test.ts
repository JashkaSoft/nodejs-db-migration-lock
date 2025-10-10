/**
 * E2E Integration tests for MigrationCoordinator
 * Tests the full flow with realistic scenarios
 */

import { MigrationCoordinator } from '../coordinator/migration-coordinator';
import { SqlDriver, LockProvider, MigrationRunner } from '../interfaces';
import {
  LockTimeoutError,
  MigrationExecutionError,
} from '../errors';

/**
 * In-memory database simulator for E2E tests
 */
class InMemoryDatabase {
  private data: Map<string, any> = new Map();

  set(key: string, value: any): void {
    this.data.set(key, value);
  }

  get(key: string): any {
    return this.data.get(key);
  }

  has(key: string): boolean {
    return this.data.has(key);
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }
}

/**
 * Realistic SQL driver implementation
 */
class TestSqlDriver implements SqlDriver {
  constructor(private db: InMemoryDatabase) {}

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    // Simulate table existence check
    if (sql.includes('information_schema.tables')) {
      return [{ exists: this.db.has('table:migration_lock') }] as T[];
    }

    // Simulate table creation
    if (sql.includes('CREATE TABLE')) {
      this.db.set('table:migration_lock', true);
      return [] as T[];
    }

    // Simulate lock insertion
    if (sql.includes('INSERT INTO migration_lock')) {
      if (this.db.has('lock:1')) {
        return [] as T[]; // Lock exists, conflict
      }
      this.db.set('lock:1', { id: 1, created_at: new Date() });
      return [{ id: 1 }] as T[];
    }

    // Simulate lock deletion
    if (sql.includes('DELETE FROM migration_lock')) {
      this.db.delete('lock:1');
      return [] as T[];
    }

    // Health check
    if (sql.includes('SELECT 1')) {
      return [{ result: 1 }] as T[];
    }

    return [] as T[];
  }
}

/**
 * Realistic table-based lock provider
 */
class TestTableLock implements LockProvider {
  name = 'test-table-lock';

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    const result = await driver.query<{ exists: boolean }>(
      'SELECT EXISTS FROM information_schema.tables WHERE table_name = migration_lock'
    );

    if (!result[0]?.exists) {
      await driver.query('CREATE TABLE migration_lock (id INT PRIMARY KEY)');
    }
  }

  async acquire(driver: SqlDriver): Promise<boolean> {
    const result = await driver.query<{ id: number }>(
      'INSERT INTO migration_lock (id) VALUES (1) ON CONFLICT DO NOTHING RETURNING id'
    );
    return result.length > 0;
  }

  async release(driver: SqlDriver): Promise<void> {
    await driver.query('DELETE FROM migration_lock WHERE id = 1');
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    try {
      await driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Test migration runner with state tracking
 */
class TestMigrationRunner implements MigrationRunner {
  public executed: string[] = [];

  constructor(private migrations: string[]) {}

  async run(): Promise<void> {
    for (const migration of this.migrations) {
      this.executed.push(migration);
      // Simulate migration execution time
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

describe('Integration Tests', () => {
  let db: InMemoryDatabase;

  beforeEach(() => {
    db = new InMemoryDatabase();
  });

  describe('Single process migration', () => {
    it('should execute complete migration flow', async () => {
      const driver = new TestSqlDriver(db);
      const lockProvider = new TestTableLock();
      const migrations = ['001_create_users', '002_create_posts'];
      const migrationRunner = new TestMigrationRunner(migrations);

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await coordinator.migrate();

      expect(db.has('table:migration_lock')).toBe(true);
      expect(db.has('lock:1')).toBe(false); // Lock released
      expect(migrationRunner.executed).toEqual(migrations);
    });

    it('should handle migration failure and cleanup', async () => {
      const driver = new TestSqlDriver(db);
      const lockProvider = new TestTableLock();
      
      class FailingMigrationRunner implements MigrationRunner {
        async run(): Promise<void> {
          throw new Error('Migration failed');
        }
      }

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner: new FailingMigrationRunner(),
      });

      await expect(coordinator.migrate()).rejects.toThrow(MigrationExecutionError);
      
      // Lock should be released even on failure
      expect(db.has('lock:1')).toBe(false);
    });
  });

  describe('Concurrent processes simulation', () => {
    it('should allow only one process to migrate at a time', async () => {
      const executionOrder: string[] = [];

      // First process
      const driver1 = new TestSqlDriver(db);
      const lockProvider1 = new TestTableLock();
      const migrations1 = ['001_migration'];
      const migrationRunner1 = new TestMigrationRunner(migrations1);

      const coordinator1 = new MigrationCoordinator({
        driver: driver1,
        lockProvider: lockProvider1,
        migrationRunner: migrationRunner1,
        onLockAcquired: () => executionOrder.push('process1-acquired'),
        onMigrationStart: () => executionOrder.push('process1-start'),
        onMigrationComplete: () => executionOrder.push('process1-complete'),
        onLockReleased: () => executionOrder.push('process1-released'),
      });

      // Second process (will fail to acquire lock)
      const driver2 = new TestSqlDriver(db);
      const lockProvider2 = new TestTableLock();
      const migrations2 = ['001_migration'];
      const migrationRunner2 = new TestMigrationRunner(migrations2);

      const coordinator2 = new MigrationCoordinator({
        driver: driver2,
        lockProvider: lockProvider2,
        migrationRunner: migrationRunner2,
        retryConfig: {
          maxRetries: 2,
          retryIntervalMs: 10,
        },
        onLockWaiting: () => executionOrder.push('process2-waiting'),
      });

      // Start both migrations concurrently
      const [result1, result2] = await Promise.allSettled([
        coordinator1.migrate(),
        coordinator2.migrate(),
      ]);

      expect(result1.status).toBe('fulfilled');
      expect(result2.status).toBe('rejected');
      
      // Only process 1 should have acquired and completed
      expect(executionOrder).toContain('process1-acquired');
      expect(executionOrder).toContain('process1-complete');
      expect(executionOrder).toContain('process2-waiting');
      
      // Process 1 completed, process 2 never acquired
      expect(migrationRunner1.executed).toHaveLength(1);
      expect(migrationRunner2.executed).toHaveLength(0);
    });

    it('should allow sequential execution after lock release', async () => {
      // First process
      const driver1 = new TestSqlDriver(db);
      const lockProvider1 = new TestTableLock();
      const migrationRunner1 = new TestMigrationRunner(['001_migration']);

      const coordinator1 = new MigrationCoordinator({
        driver: driver1,
        lockProvider: lockProvider1,
        migrationRunner: migrationRunner1,
      });

      // Execute first migration
      await coordinator1.migrate();
      
      expect(db.has('lock:1')).toBe(false); // Lock released

      // Second process should now succeed
      const driver2 = new TestSqlDriver(db);
      const lockProvider2 = new TestTableLock();
      const migrationRunner2 = new TestMigrationRunner(['002_migration']);

      const coordinator2 = new MigrationCoordinator({
        driver: driver2,
        lockProvider: lockProvider2,
        migrationRunner: migrationRunner2,
      });

      await coordinator2.migrate();

      expect(migrationRunner1.executed).toEqual(['001_migration']);
      expect(migrationRunner2.executed).toEqual(['002_migration']);
    });
  });

  describe('Retry behavior', () => {
    it('should eventually succeed with retry', async () => {
      let attemptCount = 0;
      
      class RetryableLockProvider implements LockProvider {
        name = 'retryable-lock';

        async acquire(driver: SqlDriver): Promise<boolean> {
          attemptCount++;
          if (attemptCount < 3) {
            return false; // Fail first 2 attempts
          }
          return true; // Succeed on 3rd attempt
        }

        async release(driver: SqlDriver): Promise<void> {}
      }

      const driver = new TestSqlDriver(db);
      const lockProvider = new RetryableLockProvider();
      const migrationRunner = new TestMigrationRunner(['001_migration']);

      const onLockWaiting = jest.fn();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        retryConfig: {
          maxRetries: 5,
          retryIntervalMs: 10,
        },
        onLockWaiting,
      });

      await coordinator.migrate();

      expect(attemptCount).toBe(3);
      expect(onLockWaiting).toHaveBeenCalledTimes(2);
      expect(migrationRunner.executed).toEqual(['001_migration']);
    });

    it('should timeout after max retries', async () => {
      class AlwaysFailLockProvider implements LockProvider {
        name = 'always-fail';
        async acquire(): Promise<boolean> {
          return false;
        }
        async release(): Promise<void> {}
      }

      const driver = new TestSqlDriver(db);
      const lockProvider = new AlwaysFailLockProvider();
      const migrationRunner = new TestMigrationRunner(['001_migration']);

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        retryConfig: {
          maxRetries: 3,
          retryIntervalMs: 10,
        },
      });

      const error = await coordinator.migrate().catch(e => e);

      expect(error).toBeInstanceOf(LockTimeoutError);
      expect(error.retries).toBe(3);
      expect(migrationRunner.executed).toHaveLength(0);
    });
  });

  describe('Lifecycle hooks', () => {
    it('should call all hooks in correct order', async () => {
      const driver = new TestSqlDriver(db);
      const lockProvider = new TestTableLock();
      const migrationRunner = new TestMigrationRunner(['001_migration']);

      const hooks = {
        onLockWaiting: jest.fn(),
        onLockAcquired: jest.fn(),
        onLockReleased: jest.fn(),
        onMigrationStart: jest.fn(),
        onMigrationComplete: jest.fn(),
      };

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        ...hooks,
      });

      await coordinator.migrate();

      expect(hooks.onLockWaiting).not.toHaveBeenCalled();
      expect(hooks.onLockAcquired).toHaveBeenCalledTimes(1);
      expect(hooks.onMigrationStart).toHaveBeenCalledTimes(1);
      expect(hooks.onMigrationComplete).toHaveBeenCalledTimes(1);
      expect(hooks.onLockReleased).toHaveBeenCalledTimes(1);

      // All hooks were called
      expect(hooks.onLockAcquired).toHaveBeenCalled();
      expect(hooks.onMigrationStart).toHaveBeenCalled();
      expect(hooks.onMigrationComplete).toHaveBeenCalled();
      expect(hooks.onLockReleased).toHaveBeenCalled();
    });
  });

  describe('Healthcheck', () => {
    it('should perform healthcheck', async () => {
      const driver = new TestSqlDriver(db);
      const lockProvider = new TestTableLock();
      const migrationRunner = new TestMigrationRunner([]);

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      const healthy = await coordinator.healthcheck();

      expect(healthy).toBe(true);
    });
  });
});

