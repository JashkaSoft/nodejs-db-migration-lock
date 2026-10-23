/**
 * Unit tests for PostgresTableLock
 */

import { PostgresTableLock } from '../../src/table-lock';
import { MockPostgresDriver } from './mocks';

describe('PostgresTableLock', () => {
  let driver: MockPostgresDriver;

  beforeEach(() => {
    driver = new MockPostgresDriver();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const lock = new PostgresTableLock();

      expect(lock.name).toBe('postgres-table-lock');
    });

    it('should create with custom options', () => {
      const lock = new PostgresTableLock({
        tableName: 'custom_lock',
        lockId: 999,
        advisoryLockId: 888,
      });

      expect(lock.name).toBe('postgres-table-lock');
    });
  });

  describe('ensureInfrastructure', () => {
    it('should create table if it does not exist', async () => {
      driver.mockTableExists(false);
      const lock = new PostgresTableLock();

      await lock.ensureInfrastructure(driver);

      const queries = driver.queries.map(q => q.sql.toLowerCase());
      
      // Should acquire advisory lock
      expect(queries.some(q => q.includes('pg_advisory_lock'))).toBe(true);
      
      // Should check table existence
      expect(queries.some(q => q.includes('information_schema.tables'))).toBe(true);
      
      // Should create sequence
      expect(queries.some(q => q.includes('create sequence'))).toBe(true);
      
      // Should create table
      expect(queries.some(q => q.includes('create table'))).toBe(true);
      
      // Should release advisory lock
      expect(queries.some(q => q.includes('pg_advisory_unlock'))).toBe(true);
    });

    it('should skip table creation if it already exists', async () => {
      driver.mockTableExists(true);
      const lock = new PostgresTableLock();

      await lock.ensureInfrastructure(driver);

      const createQueries = driver.queries.filter(q => 
        q.sql.toLowerCase().includes('create table')
      );
      
      expect(createQueries).toHaveLength(0);
    });

    it('should always release advisory lock', async () => {
      driver.mockTableExists(false);
      // Simulate error during table creation
      const originalQuery = driver.query.bind(driver);
      let callCount = 0;
      driver.query = async (sql: string, params?: unknown[]) => {
        callCount++;
        if (callCount === 3) { // Fail on sequence creation
          throw new Error('Simulated error');
        }
        return originalQuery(sql, params);
      };

      const lock = new PostgresTableLock();

      await expect(lock.ensureInfrastructure(driver)).rejects.toThrow();

      // Should still release advisory lock
      const unlockQuery = driver.queries.find(q => 
        q.sql.toLowerCase().includes('pg_advisory_unlock')
      );
      expect(unlockQuery).toBeDefined();
    });

    it('should use custom table name', async () => {
      driver.mockTableExists(false);
      const lock = new PostgresTableLock({ tableName: 'my_custom_lock' });

      await lock.ensureInfrastructure(driver);

      const tableCheckQuery = driver.queries.find(q => 
        q.sql.includes('information_schema.tables')
      );
      
      expect(tableCheckQuery?.params).toEqual(['my_custom_lock']);
    });

    it('should use custom advisory lock ID', async () => {
      driver.mockTableExists(false);
      const lock = new PostgresTableLock({ advisoryLockId: 555 });

      await lock.ensureInfrastructure(driver);

      const advisoryQuery = driver.queries.find(q => 
        q.sql.toLowerCase().includes('pg_advisory_lock') &&
        !q.sql.toLowerCase().includes('unlock')
      );
      
      expect(advisoryQuery?.params).toEqual([555]);
    });
  });

  describe('acquire', () => {
    it('should acquire lock successfully', async () => {
      driver.mockInsertSuccess(true);
      const lock = new PostgresTableLock({ lockId: 1 });

      const acquired = await lock.acquire(driver);

      expect(acquired).toBe(true);
      
      const insertQuery = driver.queries.find(q => 
        q.sql.toLowerCase().includes('insert')
      );
      expect(insertQuery).toBeDefined();
      expect(insertQuery?.sql).toContain('ON CONFLICT');
      expect(insertQuery?.sql).toContain('RETURNING');
    });

    it('should fail to acquire if lock already exists', async () => {
      driver.mockInsertSuccess(false); // Empty result = conflict
      const lock = new PostgresTableLock();

      const acquired = await lock.acquire(driver);

      expect(acquired).toBe(false);
    });

    it('should return false if signal is aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const lock = new PostgresTableLock();
      const acquired = await lock.acquire(driver, controller.signal);

      expect(acquired).toBe(false);
      expect(driver.queries).toHaveLength(0);
    });

    it('should use custom lock ID and table name', async () => {
      driver.mockInsertSuccess(true);
      const lock = new PostgresTableLock({
        tableName: 'custom_lock',
        lockId: 42,
      });

      await lock.acquire(driver);

      const insertQuery = driver.queries.find(q => 
        q.sql.toLowerCase().includes('insert')
      );
      
      expect(insertQuery?.sql).toContain('custom_lock');
      expect(insertQuery?.params).toEqual([42]);
    });
  });

  describe('release', () => {
    it('should release lock', async () => {
      const lock = new PostgresTableLock({ lockId: 1 });

      await lock.release(driver);

      const deleteQuery = driver.queries.find(q => 
        q.sql.toLowerCase().includes('delete')
      );
      
      expect(deleteQuery).toBeDefined();
      expect(deleteQuery?.sql).toContain('migration_lock');
      expect(deleteQuery?.params).toEqual([1]);
    });

    it('should use custom table name and lock ID', async () => {
      const lock = new PostgresTableLock({
        tableName: 'my_lock_table',
        lockId: 99,
      });

      await lock.release(driver);

      const deleteQuery = driver.queries[0];
      
      expect(deleteQuery.sql).toContain('my_lock_table');
      expect(deleteQuery.params).toEqual([99]);
    });
  });

  describe('healthcheck', () => {
    it('should return true for healthy connection', async () => {
      const lock = new PostgresTableLock();

      const healthy = await lock.healthcheck(driver);

      expect(healthy).toBe(true);
    });

    it('should return false for failed connection', async () => {
      driver.shouldFail = true;
      const lock = new PostgresTableLock();

      const healthy = await lock.healthcheck(driver);

      expect(healthy).toBe(false);
    });
  });

  describe('complete flow', () => {
    it('should setup, acquire, and release lock', async () => {
      driver.mockTableExists(false);
      driver.mockInsertSuccess(true);
      
      const lock = new PostgresTableLock({
        tableName: 'test_lock',
        lockId: 1,
        advisoryLockId: 999,
      });

      // Setup infrastructure
      await lock.ensureInfrastructure(driver);
      
      const setupQueries = driver.queries.length;
      expect(setupQueries).toBeGreaterThan(0);

      driver.reset();

      // Acquire lock
      const acquired = await lock.acquire(driver);
      expect(acquired).toBe(true);

      driver.reset();

      // Release lock
      await lock.release(driver);
      
      const deleteQuery = driver.queries[0];
      expect(deleteQuery.sql.toLowerCase()).toContain('delete');
    });
  });
});

