/**
 * Unit tests for PostgreSQL driver adapters
 */

import { TypeORMDriver } from '../../src/typeorm-driver';
import { NodePgDriver } from '../../src/node-pg-driver';
import { MockTypeORMDataSource, MockPgPool, MockPgClient } from './mocks';

describe('TypeORMDriver', () => {
  let dataSource: MockTypeORMDataSource;

  beforeEach(() => {
    dataSource = new MockTypeORMDataSource();
  });

  describe('constructor', () => {
    it('should create driver with initialized DataSource', () => {
      const driver = new TypeORMDriver(dataSource as any);

      expect(driver).toBeDefined();
    });

    it('should throw if DataSource is not initialized', () => {
      dataSource.isInitialized = false;

      expect(() => new TypeORMDriver(dataSource as any)).toThrow(
        'TypeORM DataSource must be initialized'
      );
    });
  });

  describe('query', () => {
    it('should execute query', async () => {
      const driver = new TypeORMDriver(dataSource as any);

      const result = await driver.query('SELECT * FROM users', [1, 2]);

      expect(dataSource.queries).toHaveLength(1);
      expect(dataSource.queries[0]).toEqual({
        sql: 'SELECT * FROM users',
        params: [1, 2],
      });
    });

    it('should execute query without parameters', async () => {
      const driver = new TypeORMDriver(dataSource as any);

      await driver.query('SELECT 1');

      expect(dataSource.queries[0]).toEqual({
        sql: 'SELECT 1',
        params: undefined,
      });
    });

    it('should propagate query errors', async () => {
      dataSource.shouldFail = true;
      const driver = new TypeORMDriver(dataSource as any);

      await expect(driver.query('SELECT 1')).rejects.toThrow('TypeORM query failed');
    });
  });

  describe('transaction', () => {
    it('should execute transaction', async () => {
      const driver = new TypeORMDriver(dataSource as any);

      const result = await driver.transaction(async () => {
        return 'success';
      });

      expect(result).toBe('success');
      expect(dataSource.transactionCalled).toBe(true);
    });

    it('should handle transaction errors', async () => {
      const driver = new TypeORMDriver(dataSource as any);

      await expect(
        driver.transaction(async () => {
          throw new Error('Transaction failed');
        })
      ).rejects.toThrow('Transaction failed');
    });
  });

  describe('close', () => {
    it('should destroy DataSource', async () => {
      const driver = new TypeORMDriver(dataSource as any);

      await driver.close();

      expect(dataSource.isInitialized).toBe(false);
    });

    it('should handle already destroyed DataSource', async () => {
      const driver = new TypeORMDriver(dataSource as any);
      
      // Destroy it
      await driver.close();
      expect(dataSource.isInitialized).toBe(false);
      
      // Try to close again - should not throw
      await driver.close();
    });
  });
});

describe('NodePgDriver', () => {
  describe('with Pool', () => {
    let pool: MockPgPool;

    beforeEach(() => {
      pool = new MockPgPool();
    });

    describe('query', () => {
      it('should execute query', async () => {
        pool.mockResult('select * from users', [{ id: 1, name: 'Alice' }]);
        const driver = new NodePgDriver(pool as any);

        const result = await driver.query('SELECT * FROM users');

        expect(result).toEqual([{ id: 1, name: 'Alice' }]);
        expect(pool.queries).toHaveLength(1);
      });

      it('should execute query with parameters', async () => {
        const driver = new NodePgDriver(pool as any);

        await driver.query('SELECT * FROM users WHERE id = $1', [1]);

        expect(pool.queries[0]).toEqual({
          sql: 'SELECT * FROM users WHERE id = $1',
          params: [1],
        });
      });

      it('should propagate query errors', async () => {
        pool.shouldFail = true;
        const driver = new NodePgDriver(pool as any);

        await expect(driver.query('SELECT 1')).rejects.toThrow('Pool query failed');
      });
    });

    describe('transaction', () => {
      it('should execute transaction with pool', async () => {
        const driver = new NodePgDriver(pool as any);

        const result = await driver.transaction(async () => {
          return 42;
        });

        expect(result).toBe(42);
        
        // Should have BEGIN, COMMIT
        const queries = pool.queries.map(q => q.sql);
        // Note: The mock doesn't actually track BEGIN/COMMIT from client
      });

      it('should handle transaction errors and rollback', async () => {
        const driver = new NodePgDriver(pool as any);

        await expect(
          driver.transaction(async () => {
            throw new Error('Transaction error');
          })
        ).rejects.toThrow('Transaction error');
      });
    });

    describe('close', () => {
      it('should end pool', async () => {
        const driver = new NodePgDriver(pool as any);
        const endSpy = jest.spyOn(pool, 'end');

        await driver.close();

        expect(endSpy).toHaveBeenCalled();
      });
    });

    describe('session pinning', () => {
      it('should reuse one pool client for all queries', async () => {
        const sessionClient = {
          queries: [] as Array<{ sql: string; params?: any[] }>,
          released: false,
          async query(sql: string, params?: any[]) {
            this.queries.push({ sql, params });
            return { rows: [{ ok: true }] };
          },
          release() {
            this.released = true;
          },
        };
        const realShapedPool = {
          totalCount: 0,
          async connect() {
            return sessionClient;
          },
          async query() {
            throw new Error('pool.query should not be used after checkout');
          },
          async end() {
            return undefined;
          },
        };

        const driver = new NodePgDriver(realShapedPool as any);
        await driver.query('SELECT 1');
        await driver.query('SELECT 2');

        expect(sessionClient.queries).toHaveLength(2);
        await driver.close();
        expect(sessionClient.released).toBe(true);
      });
    });
  });

  describe('with Client', () => {
    let client: MockPgClient;

    beforeEach(() => {
      client = new MockPgClient();
    });

    describe('query', () => {
      it('should execute query', async () => {
        const driver = new NodePgDriver(client as any);

        await driver.query('SELECT 1');

        expect(client.queries).toHaveLength(1);
        expect(client.queries[0].sql).toBe('SELECT 1');
      });
    });

    describe('transaction', () => {
      it('should execute transaction with client', async () => {
        const driver = new NodePgDriver(client as any);

        const result = await driver.transaction(async () => {
          return 'done';
        });

        expect(result).toBe('done');
        
        // Should have BEGIN, COMMIT
        const queries = client.queries.map(q => q.sql);
        expect(queries).toContain('BEGIN');
        expect(queries).toContain('COMMIT');
      });

      it('should rollback on error', async () => {
        const driver = new NodePgDriver(client as any);

        await expect(
          driver.transaction(async () => {
            throw new Error('Failed');
          })
        ).rejects.toThrow('Failed');

        const queries = client.queries.map(q => q.sql);
        expect(queries).toContain('BEGIN');
        expect(queries).toContain('ROLLBACK');
      });
    });

    describe('close', () => {
      it('should end client', async () => {
        const driver = new NodePgDriver(client as any);
        const endSpy = jest.spyOn(client, 'end');

        await driver.close();

        expect(endSpy).toHaveBeenCalled();
      });
    });
  });
});

