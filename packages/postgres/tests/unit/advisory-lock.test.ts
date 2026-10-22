/**
 * Unit tests for PostgresAdvisoryLock
 */

import { PostgresAdvisoryLock } from '../../src/advisory-lock';
import { MockPostgresDriver } from './mocks';

describe('PostgresAdvisoryLock', () => {
  let driver: MockPostgresDriver;

  beforeEach(() => {
    driver = new MockPostgresDriver();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const lock = new PostgresAdvisoryLock();

      expect(lock.name).toBe('postgres-advisory-lock');
    });

    it('should create with custom lock ID', () => {
      const lock = new PostgresAdvisoryLock({ lockId: 999999 });

      expect(lock.name).toBe('postgres-advisory-lock');
    });
  });

  describe('acquire', () => {
    it('should acquire lock successfully', async () => {
      driver.mockAdvisoryLock(true);
      const lock = new PostgresAdvisoryLock({ lockId: 123 });

      const acquired = await lock.acquire(driver);

      expect(acquired).toBe(true);
      expect(driver.queries).toHaveLength(1);
      expect(driver.queries[0].sql).toContain('pg_try_advisory_lock');
      expect(driver.queries[0].params).toEqual([123]);
    });

    it('should fail to acquire lock if already held', async () => {
      driver.mockAdvisoryLock(false);
      const lock = new PostgresAdvisoryLock({ lockId: 123 });

      const acquired = await lock.acquire(driver);

      expect(acquired).toBe(false);
    });

    it('should use default lock ID', async () => {
      driver.mockAdvisoryLock(true);
      const lock = new PostgresAdvisoryLock();

      await lock.acquire(driver);

      expect(driver.queries[0].params?.[0]).toBe(123456789); // Default ID
    });

    it('should return false if signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const lock = new PostgresAdvisoryLock();
      const acquired = await lock.acquire(driver, controller.signal);

      expect(acquired).toBe(false);
      expect(driver.queries).toHaveLength(0); // No query executed
    });

    it('should handle database errors', async () => {
      driver.shouldFail = true;
      driver.failureError = new Error('Connection lost');

      const lock = new PostgresAdvisoryLock();

      await expect(lock.acquire(driver)).rejects.toThrow('Connection lost');
    });

    it('should handle null/undefined result', async () => {
      driver.mockResult('advisory_lock', [{ pg_try_advisory_lock: null }]);
      const lock = new PostgresAdvisoryLock();

      const acquired = await lock.acquire(driver);

      expect(acquired).toBe(false);
    });
  });

  describe('release', () => {
    it('should release lock', async () => {
      const lock = new PostgresAdvisoryLock({ lockId: 456 });

      await lock.release(driver);

      expect(driver.queries).toHaveLength(1);
      expect(driver.queries[0].sql).toContain('pg_advisory_unlock');
      expect(driver.queries[0].params).toEqual([456]);
    });

    it('should handle release errors', async () => {
      driver.shouldFail = true;
      const lock = new PostgresAdvisoryLock();

      await expect(lock.release(driver)).rejects.toThrow('Query failed');
    });
  });

  describe('healthcheck', () => {
    it('should return true for healthy connection', async () => {
      const lock = new PostgresAdvisoryLock();

      const healthy = await lock.healthcheck(driver);

      expect(healthy).toBe(true);
      expect(driver.queries[0].sql).toContain('SELECT 1');
    });

    it('should return false for failed connection', async () => {
      driver.shouldFail = true;
      const lock = new PostgresAdvisoryLock();

      const healthy = await lock.healthcheck(driver);

      expect(healthy).toBe(false);
    });
  });

  describe('typical usage pattern', () => {
    it('should acquire, use, and release lock', async () => {
      driver.mockAdvisoryLock(true);
      const lock = new PostgresAdvisoryLock({ lockId: 789 });

      // Acquire
      const acquired = await lock.acquire(driver);
      expect(acquired).toBe(true);

      // Do work...
      
      // Release
      await lock.release(driver);

      const acquireQuery = driver.queries.find(q => 
        q.sql.includes('pg_try_advisory_lock')
      );
      const releaseQuery = driver.queries.find(q => 
        q.sql.includes('pg_advisory_unlock')
      );

      expect(acquireQuery).toBeDefined();
      expect(releaseQuery).toBeDefined();
      expect(acquireQuery?.params).toEqual([789]);
      expect(releaseQuery?.params).toEqual([789]);
    });
  });
});

