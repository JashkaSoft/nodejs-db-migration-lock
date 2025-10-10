/**
 * Unit tests for MigrationCoordinator
 */

import { MigrationCoordinator } from '../coordinator/migration-coordinator';
import { LockProvider } from '../interfaces';
import {
  LockAcquisitionError,
  LockTimeoutError,
  MigrationExecutionError,
} from '../errors';
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

  describe('constructor', () => {
    it('should create coordinator with required options', () => {
      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      expect(coordinator).toBeInstanceOf(MigrationCoordinator);
    });

    it('should accept custom retry config', () => {
      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        retryConfig: {
          maxRetries: 10,
          retryIntervalMs: 500,
        },
      });

      expect(coordinator).toBeInstanceOf(MigrationCoordinator);
    });

    it('should accept lifecycle hooks', () => {
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

      expect(coordinator).toBeInstanceOf(MigrationCoordinator);
    });
  });

  describe('migrate - success flow', () => {
    it('should execute successful migration', async () => {
      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await coordinator.migrate();

      expect(lockProvider.infrastructureCalls).toBe(1);
      expect(lockProvider.acquireCalls).toBe(1);
      expect(migrationRunner.runCalls).toBe(1);
      expect(lockProvider.releaseCalls).toBe(1);
    });

    it('should call lifecycle hooks in correct order', async () => {
      const callOrder: string[] = [];

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

    it('should skip infrastructure if not provided', async () => {
      class SimpleLockProvider implements LockProvider {
        name = 'simple-lock';
        acquireCalls = 0;
        releaseCalls = 0;
        
        async acquire(): Promise<boolean> {
          this.acquireCalls++;
          return true;
        }
        
        async release(): Promise<void> {
          this.releaseCalls++;
        }
      }
      
      const simpleLockProvider = new SimpleLockProvider();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider: simpleLockProvider,
        migrationRunner,
      });

      await coordinator.migrate();

      expect(simpleLockProvider.acquireCalls).toBe(1);
      expect(migrationRunner.runCalls).toBe(1);
    });
  });

  describe('migrate - lock acquisition', () => {
    it('should retry lock acquisition', async () => {
      lockProvider.setAcquireSequence([false, false, true]);

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

      expect(lockProvider.acquireCalls).toBe(3);
      expect(onLockWaiting).toHaveBeenCalledTimes(2);
      expect(migrationRunner.runCalls).toBe(1);
    });

    it('should throw LockTimeoutError if lock not acquired', async () => {
      lockProvider.shouldAcquireSucceed = false;

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        retryConfig: {
          maxRetries: 3,
          retryIntervalMs: 10,
        },
      });

      await expect(coordinator.migrate()).rejects.toThrow(LockTimeoutError);
      
      expect(lockProvider.acquireCalls).toBeGreaterThan(0);
      expect(migrationRunner.runCalls).toBe(0);
    });

    it('should respect AbortSignal', async () => {
      lockProvider.shouldAcquireSucceed = false;
      const controller = new AbortController();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        retryConfig: {
          maxRetries: 100,
          retryIntervalMs: 50,
        },
      });

      setTimeout(() => controller.abort(), 100);

      await expect(coordinator.migrate(controller.signal)).rejects.toThrow();
      
      expect(lockProvider.acquireCalls).toBeLessThan(100);
    });
  });

  describe('migrate - error handling', () => {
    it('should throw MigrationExecutionError if migration fails', async () => {
      migrationRunner.shouldFail = true;
      migrationRunner.failureError = new Error('SQL error');

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await expect(coordinator.migrate()).rejects.toThrow(MigrationExecutionError);
      
      // Lock should still be released
      expect(lockProvider.releaseCalls).toBe(1);
    });

    it('should release lock even if migration fails', async () => {
      migrationRunner.shouldFail = true;

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await expect(coordinator.migrate()).rejects.toThrow();
      
      expect(lockProvider.acquireCalls).toBe(1);
      expect(migrationRunner.runCalls).toBe(1);
      expect(lockProvider.releaseCalls).toBe(1);
    });

    it('should handle infrastructure setup failure', async () => {
      lockProvider.shouldFailInfrastructure = true;

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await expect(coordinator.migrate()).rejects.toThrow(LockAcquisitionError);
      
      expect(lockProvider.infrastructureCalls).toBe(1);
      expect(lockProvider.acquireCalls).toBe(0);
      expect(migrationRunner.runCalls).toBe(0);
    });

    it('should log but not throw if lock release fails', async () => {
      lockProvider.shouldFailRelease = true;
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await coordinator.migrate();
      
      expect(migrationRunner.runCalls).toBe(1);
      expect(consoleError).toHaveBeenCalledWith(
        'Failed to release lock:',
        expect.any(Error)
      );
      
      consoleError.mockRestore();
    });

    it('should preserve migration error even if release fails', async () => {
      migrationRunner.shouldFail = true;
      migrationRunner.failureError = new Error('Migration error');
      lockProvider.shouldFailRelease = true;
      
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await expect(coordinator.migrate()).rejects.toThrow(MigrationExecutionError);
      
      expect(consoleError).toHaveBeenCalled();
      
      consoleError.mockRestore();
    });
  });

  describe('healthcheck', () => {
    it('should return true for healthy provider', async () => {
      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      const healthy = await coordinator.healthcheck();

      expect(healthy).toBe(true);
      expect(lockProvider.healthcheckCalls).toBe(1);
    });

    it('should fallback to driver query if no healthcheck method', async () => {
      class SimpleProvider implements LockProvider {
        name = 'simple';
        async acquire(): Promise<boolean> { return true; }
        async release(): Promise<void> {}
      }
      
      const simpleProvider = new SimpleProvider();

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider: simpleProvider,
        migrationRunner,
      });

      const healthy = await coordinator.healthcheck();

      expect(healthy).toBe(true);
      expect(driver.getLastQuery()?.sql).toContain('SELECT 1');
    });

    it('should return false on failure', async () => {
      const failDriver = new MockSqlDriver();
      failDriver.shouldFail = true;
      
      class SimpleProvider implements LockProvider {
        name = 'simple';
        async acquire(): Promise<boolean> { return true; }
        async release(): Promise<void> {}
      }

      const coordinator = new MigrationCoordinator({
        driver: failDriver,
        lockProvider: new SimpleProvider(),
        migrationRunner,
      });

      const healthy = await coordinator.healthcheck();

      expect(healthy).toBe(false);
    });
  });

  describe('retry configuration', () => {
    it('should use default retry config', async () => {
      lockProvider.setAcquireSequence([false, false, true]);

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
      });

      await coordinator.migrate();

      expect(lockProvider.acquireCalls).toBe(3);
    });

    it('should respect custom retry config', async () => {
      lockProvider.shouldAcquireSucceed = false;

      const coordinator = new MigrationCoordinator({
        driver,
        lockProvider,
        migrationRunner,
        retryConfig: {
          maxRetries: 2,
          retryIntervalMs: 5,
        },
      });

      await expect(coordinator.migrate()).rejects.toThrow(LockTimeoutError);
      
      expect(lockProvider.acquireCalls).toBe(3); // maxRetries + 1
    });
  });

  describe('concurrent behavior simulation', () => {
    it('should handle multiple coordinators with same lock', async () => {
      const results: string[] = [];

      // First coordinator acquires immediately
      const coordinator1 = new MigrationCoordinator({
        driver: new MockSqlDriver(),
        lockProvider: new MockLockProvider(),
        migrationRunner: new MockMigrationRunner(),
        onLockAcquired: () => results.push('c1-acquired'),
        onMigrationComplete: () => results.push('c1-complete'),
      });

      // Second coordinator fails to acquire
      const lockProvider2 = new MockLockProvider();
      lockProvider2.shouldAcquireSucceed = false;
      
      const coordinator2 = new MigrationCoordinator({
        driver: new MockSqlDriver(),
        lockProvider: lockProvider2,
        migrationRunner: new MockMigrationRunner(),
        retryConfig: {
          maxRetries: 2,
          retryIntervalMs: 10,
        },
      });

      await coordinator1.migrate();
      await expect(coordinator2.migrate()).rejects.toThrow(LockTimeoutError);

      expect(results).toEqual(['c1-acquired', 'c1-complete']);
    });
  });
});

