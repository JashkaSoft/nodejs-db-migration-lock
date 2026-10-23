/**
 * E2E Integration tests for PostgreSQL package
 * Tests complete flows with realistic scenarios
 */

import {
  MigrationCoordinator,
  MigrationRunner,
  SqlDriver,
} from '@nodejs-db-migration-lock/core';
import { PostgresAdvisoryLock } from '../../src/advisory-lock';
import { PostgresTableLock } from '../../src/table-lock';

function asNumber(value: unknown): number {
  if (typeof value !== 'number') {
    throw new Error('Expected numeric SQL parameter');
  }
  return value;
}

function asString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Expected string SQL parameter');
  }
  return value;
}

/**
 * In-memory PostgreSQL simulator for E2E tests
 */
class PostgresSimulator {
  private advisoryLocks = new Set<number>();
  private tables = new Map<string, Map<number, Record<string, unknown>>>();
  private tableDefinitions = new Set<string>();

  // Advisory locks
  tryAdvisoryLock(lockId: number): boolean {
    if (this.advisoryLocks.has(lockId)) {
      return false;
    }
    this.advisoryLocks.add(lockId);
    return true;
  }

  advisoryUnlock(lockId: number): boolean {
    return this.advisoryLocks.delete(lockId);
  }

  isAdvisoryLocked(lockId: number): boolean {
    return this.advisoryLocks.has(lockId);
  }

  // Table operations
  tableExists(tableName: string): boolean {
    return this.tableDefinitions.has(tableName);
  }

  createTable(tableName: string): void {
    this.tableDefinitions.add(tableName);
    this.tables.set(tableName, new Map());
  }

  insertRow(tableName: string, id: number, data: Record<string, unknown>): boolean {
    const table = this.tables.get(tableName);
    if (!table) return false;
    
    if (table.has(id)) {
      return false; // Conflict
    }
    
    table.set(id, { id, ...data });
    return true;
  }

  deleteRow(tableName: string, id: number): boolean {
    const table = this.tables.get(tableName);
    if (!table) return false;
    return table.delete(id);
  }

  getRow(tableName: string, id: number): Record<string, unknown> | undefined {
    return this.tables.get(tableName)?.get(id);
  }

  hasRow(tableName: string, id: number): boolean {
    return this.tables.get(tableName)?.has(id) ?? false;
  }

  reset(): void {
    this.advisoryLocks.clear();
    this.tables.clear();
    this.tableDefinitions.clear();
  }
}

/**
 * Realistic PostgreSQL driver for E2E testing
 */
class TestPostgresDriver implements SqlDriver {
  constructor(private db: PostgresSimulator) {}

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const normalizedSql = sql.toLowerCase().trim();

    if (normalizedSql.includes('current_database')) {
      return [{ name: 'appdb' }] as T[];
    }

    if (normalizedSql.includes('set_config')) {
      return [] as T[];
    }

    // Advisory lock operations
    if (normalizedSql.includes('pg_try_advisory')) {
      const lockId = asNumber(params[0]);
      const success = this.db.tryAdvisoryLock(lockId);
      return [{ pg_try_advisory_lock: success, acquired: success }] as T[];
    }

    if (normalizedSql.includes('pg_advisory_unlock')) {
      const lockId = asNumber(params[0]);
      const success = this.db.advisoryUnlock(lockId);
      return [{ pg_advisory_unlock: success }] as T[];
    }

    if (normalizedSql.includes('pg_advisory_lock') || normalizedSql.includes('pg_advisory_xact_lock')) {
      const lockId = asNumber(params[0]);
      if (!this.db.tryAdvisoryLock(lockId)) {
        const error = new Error('canceling statement due to lock timeout') as Error & { code: string };
        error.code = '55P03';
        throw error;
      }
      return [] as T[];
    }

    // Table existence check
    if (normalizedSql.includes('information_schema.tables')) {
      const tableName = asString(params[0]);
      const exists = this.db.tableExists(tableName);
      return [{ exists }] as T[];
    }

    // Create table
    if (normalizedSql.includes('create table')) {
      const match = sql.match(/create table (?:if not exists )?"?([A-Za-z_][A-Za-z0-9_]*)"?/i);
      if (match) {
        this.db.createTable(match[1]);
      }
      return [] as T[];
    }

    // Create sequence (ignore for simulation)
    if (normalizedSql.includes('create sequence')) {
      return [] as T[];
    }

    // DO block (ignore for simulation)
    if (normalizedSql.includes('do $$')) {
      return [] as T[];
    }

    // Insert with conflict handling
    if (normalizedSql.includes('insert')) {
      const tableMatch = sql.match(/into\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i);
      const tableName = tableMatch?.[1] ?? 'migration_lock';
      const lockId = asNumber(params[0]);
      const now = typeof params[2] === 'number' ? params[2] : Date.now();
      const existing = this.db.getRow(tableName, lockId);
      if (existing && Number(existing.expires_at ?? Number.POSITIVE_INFINITY) >= now) {
        return [] as T[];
      }
      this.db.deleteRow(tableName, lockId);
      const holder = typeof params[1] === 'string' ? params[1] : undefined;
      const expiresAt = typeof params[3] === 'number' ? params[3] : now + 30_000;
      this.db.insertRow(tableName, lockId, { holder, expires_at: expiresAt });
      return [{ id: lockId }] as T[];
    }

    if (normalizedSql.includes('delete')) {
      const tableMatch = sql.match(/from\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i);
      const tableName = tableMatch?.[1] ?? 'migration_lock';
      const lockId = asNumber(params[0]);
      const holder = params[1];
      const row = this.db.getRow(tableName, lockId);
      if (typeof holder === 'string' && row?.holder && row.holder !== holder) {
        return [] as T[];
      }
      this.db.deleteRow(tableName, lockId);
      return [] as T[];
    }

    // Health check
    if (normalizedSql === 'select 1') {
      return [{ result: 1 }] as T[];
    }

    return [] as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

/**
 * Test migration runner
 */
class TestMigrationRunner implements MigrationRunner {
  public executed = false;
  public executionCount = 0;
  public shouldFail = false;

  async run(): Promise<void> {
    this.executionCount++;
    if (this.shouldFail) {
      throw new Error('Migration execution failed');
    }
    this.executed = true;
    // Simulate migration time
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  reset(): void {
    this.executed = false;
    this.executionCount = 0;
    this.shouldFail = false;
  }
}

describe('Integration Tests - PostgreSQL', () => {
  let db: PostgresSimulator;

  beforeEach(() => {
    db = new PostgresSimulator();
  });

  describe('PostgresAdvisoryLock', () => {
    it('should execute complete migration with advisory lock', async () => {
      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresAdvisoryLock({ lockId: 12345 });
      const migrationRunner = new TestMigrationRunner();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await coordinator.migrate();

      expect(migrationRunner.executed).toBe(true);
      expect(db.isAdvisoryLocked(12345)).toBe(false); // Released after migration
    });

    it('should prevent concurrent migrations with advisory lock', async () => {
      const driver1 = new TestPostgresDriver(db);
      const driver2 = new TestPostgresDriver(db);

      const lock1 = new PostgresAdvisoryLock({ lockId: 99999 });
      const lock2 = new PostgresAdvisoryLock({ lockId: 99999 }); // Same ID

      const runner1 = new TestMigrationRunner();
      const runner2 = new TestMigrationRunner();

      const coordinator1 = new MigrationCoordinator({
        driver: driver1,
        lockProvider: lock1,
        migrationRunner: runner1,
      });

      const coordinator2 = new MigrationCoordinator({
        driver: driver2,
        lockProvider: lock2,
        migrationRunner: runner2,
        retryConfig: {
          maxRetries: 2,
          retryIntervalMs: 10,
        },
      });

      let active = 0;
      let maxActive = 0;
      const watch = (runner: TestMigrationRunner) => {
        const run = runner.run.bind(runner);
        runner.run = async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            await run();
          } finally {
            active -= 1;
          }
        };
      };
      watch(runner1);
      watch(runner2);

      const [result1, result2] = await Promise.allSettled([
        coordinator1.migrate(),
        coordinator2.migrate(),
      ]);

      expect(result1.status).toBe('fulfilled');
      expect(result2.status).toBe('fulfilled');
      expect(maxActive).toBe(1);
      expect(runner1.executed).toBe(true);
      expect(runner2.executed).toBe(true);
      expect(db.isAdvisoryLocked(99999)).toBe(false);
    });

    it('should allow sequential execution after lock release', async () => {
      const lockProvider = new PostgresAdvisoryLock({ lockId: 55555 });

      // First migration
      const driver1 = new TestPostgresDriver(db);
      const runner1 = new TestMigrationRunner();
      const coordinator1 = new MigrationCoordinator({
        driver: driver1,
        lockProvider,
        migrationRunner: runner1,
      });

      await coordinator1.migrate();
      expect(runner1.executed).toBe(true);
      expect(db.isAdvisoryLocked(55555)).toBe(false);

      // Second migration (should succeed)
      const driver2 = new TestPostgresDriver(db);
      const runner2 = new TestMigrationRunner();
      const coordinator2 = new MigrationCoordinator({
        driver: driver2,
        lockProvider,
        migrationRunner: runner2,
      });

      await coordinator2.migrate();
      expect(runner2.executed).toBe(true);
    });
  });

  describe('PostgresTableLock', () => {
    it('should execute complete migration with table lock', async () => {
      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresTableLock({
        tableName: 'migration_lock',
        lockId: 1,
      });
      const migrationRunner = new TestMigrationRunner();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await coordinator.migrate();

      expect(migrationRunner.executed).toBe(true);
      expect(db.tableExists('migration_lock')).toBe(true);
      expect(db.hasRow('migration_lock', 1)).toBe(false); // Lock released
    });

    it('should prevent concurrent migrations with table lock', async () => {
      const lockProvider1 = new PostgresTableLock({ lockId: 1 });
      const lockProvider2 = new PostgresTableLock({ lockId: 1 }); // Same ID

      const driver1 = new TestPostgresDriver(db);
      const driver2 = new TestPostgresDriver(db);

      const runner1 = new TestMigrationRunner();
      const runner2 = new TestMigrationRunner();

      const coordinator1 = new MigrationCoordinator({
        driver: driver1,
        lockProvider: lockProvider1,
        migrationRunner: runner1,
      });

      const coordinator2 = new MigrationCoordinator({
        driver: driver2,
        lockProvider: lockProvider2,
        migrationRunner: runner2,
        retryConfig: {
          maxRetries: 2,
          retryIntervalMs: 10,
        },
      });

      let active = 0;
      let maxActive = 0;
      const watch = (runner: TestMigrationRunner) => {
        const run = runner.run.bind(runner);
        runner.run = async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          try {
            await run();
          } finally {
            active -= 1;
          }
        };
      };
      watch(runner1);
      watch(runner2);

      const [result1, result2] = await Promise.allSettled([
        coordinator1.migrate(),
        coordinator2.migrate(),
      ]);

      expect(result1.status).toBe('fulfilled');
      expect(result2.status).toBe('fulfilled');
      expect(maxActive).toBe(1);
      expect(runner1.executed).toBe(true);
      expect(runner2.executed).toBe(true);
    });

    it('should handle infrastructure setup', async () => {
      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresTableLock({
        tableName: 'custom_lock',
        lockId: 5,
      });

      expect(db.tableExists('custom_lock')).toBe(false);

      await lockProvider.ensureInfrastructure(driver);

      expect(db.tableExists('custom_lock')).toBe(true);
    });

    it('should skip table creation if already exists', async () => {
      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresTableLock();

      // Create table manually
      db.createTable('migration_lock');

      await lockProvider.ensureInfrastructure(driver);

      // Should not fail, just skip creation
      expect(db.tableExists('migration_lock')).toBe(true);
    });

    it('should cleanup lock even if migration fails', async () => {
      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresTableLock({ lockId: 1 });
      const migrationRunner = new TestMigrationRunner();
      migrationRunner.shouldFail = true;

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await expect(coordinator.migrate()).rejects.toThrow();

      // Lock should be released
      expect(db.hasRow('migration_lock', 1)).toBe(false);
    });
  });

  describe('Lifecycle hooks', () => {
    it('should call all hooks in correct order', async () => {
      const callOrder: string[] = [];

      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresAdvisoryLock({ lockId: 777 });
      const migrationRunner = new TestMigrationRunner();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        onLockAcquired: () => callOrder.push('acquired'),
        onMigrationStart: () => callOrder.push('start'),
        onMigrationComplete: () => callOrder.push('complete'),
        onLockReleased: () => callOrder.push('released'),
      });

      await coordinator.migrate();

      expect(callOrder).toEqual(['acquired', 'start', 'complete', 'released']);
    });

    it('should call onLockWaiting when retrying', async () => {
      const driver1 = new TestPostgresDriver(db);
      const driver2 = new TestPostgresDriver(db);

      const lockProvider1 = new PostgresTableLock({ lockId: 1 });
      const lockProvider2 = new PostgresTableLock({ lockId: 1 });
      const runner2 = new TestMigrationRunner();

      await lockProvider1.ensureInfrastructure(driver1);
      db.insertRow('migration_lock', 1, { holder: 'other', expires_at: Date.now() + 60_000 });

      const onLockWaiting = jest.fn();
      const coordinator2 = new MigrationCoordinator({
        driver: driver2,
        lockProvider: lockProvider2,
        migrationRunner: runner2,
        retryConfig: {
          maxRetries: 3,
          retryIntervalMs: 10,
        },
        onLockWaiting,
      });

      await expect(coordinator2.migrate()).rejects.toThrow();
      expect(onLockWaiting.mock.calls.length).toBeGreaterThan(0);
      expect(runner2.executed).toBe(false);
    });
  });

  describe('Healthcheck', () => {
    it('should perform healthcheck with advisory lock', async () => {
      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresAdvisoryLock();
      const migrationRunner = new TestMigrationRunner();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      const healthy = await coordinator.healthcheck();

      expect(healthy).toBe(true);
    });

    it('should perform healthcheck with table lock', async () => {
      const driver = new TestPostgresDriver(db);
      const lockProvider = new PostgresTableLock();
      const migrationRunner = new TestMigrationRunner();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      const healthy = await coordinator.healthcheck();

      expect(healthy).toBe(true);
    });
  });

  describe('Multiple processes simulation', () => {
    it('should handle 3 concurrent processes correctly', async () => {
      const results: string[] = [];

      // Use a shared database instance to properly simulate lock contention
      const sharedDb = new PostgresSimulator();

      const createCoordinator = (id: number) => {
        const driver = new TestPostgresDriver(sharedDb);
        const lockProvider = new PostgresTableLock({ lockId: 1 });
        const runner = new TestMigrationRunner();

        return new MigrationCoordinator({
          driver,
          lockProvider,
          migrationRunner: runner,
          retryConfig: {
            maxRetries: 2, // Short retry to fail fast
            retryIntervalMs: 5,
          },
          onLockAcquired: () => results.push(`process${id}-acquired`),
          onMigrationComplete: () => results.push(`process${id}-complete`),
        });
      };

      const coordinator1 = createCoordinator(1);
      const coordinator2 = createCoordinator(2);
      const coordinator3 = createCoordinator(3);

      // Run all concurrently
      const migrations = await Promise.allSettled([
        coordinator1.migrate(),
        coordinator2.migrate(),
        coordinator3.migrate(),
      ]);

      const succeeded = migrations.filter(r => r.status === 'fulfilled');
      expect(succeeded).toHaveLength(3);
      expect(results.filter(r => r.includes('acquired'))).toHaveLength(3);
      expect(results.filter(r => r.includes('complete'))).toHaveLength(3);
    });
  });

  describe('Retry behavior', () => {
    it('should eventually succeed with retries', async () => {
      let attemptCount = 0;

      class RetryableDriver implements SqlDriver {
        constructor(private db: PostgresSimulator) {}

        async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
          const normalizedSql = sql.toLowerCase();
          
          if (normalizedSql.includes('insert')) {
            attemptCount++;
            if (attemptCount < 3) {
              return [] as T[]; // Simulate conflict
            }
            const lockId = asNumber(params[0]);
            this.db.insertRow('migration_lock', lockId, {});
            return [{ id: lockId }] as T[];
          }

          // Delegate to normal driver
          return new TestPostgresDriver(this.db).query(sql, params);
        }
      }

      const driver = new RetryableDriver(db);
      const lockProvider = new PostgresTableLock({ lockId: 1 });
      const migrationRunner = new TestMigrationRunner();

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
      expect(migrationRunner.executed).toBe(true);
    });
  });
});

