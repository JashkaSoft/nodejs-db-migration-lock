import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { Pool, PoolClient, Client } from 'pg';

/**
 * Adapter to use node-postgres (pg) Pool or Client as a SqlDriver
 * 
 * Usage with Pool:
 * ```typescript
 * import { Pool } from 'pg';
 * import { NodePgDriver } from '@nodejs-db-migration-lock/postgres';
 * 
 * const pool = new Pool({...});
 * const driver = new NodePgDriver(pool);
 * ```
 * 
 * Usage with Client:
 * ```typescript
 * import { Client } from 'pg';
 * import { NodePgDriver } from '@nodejs-db-migration-lock/postgres';
 * 
 * const client = new Client({...});
 * await client.connect();
 * const driver = new NodePgDriver(client);
 * ```
 */
export class NodePgDriver implements SqlDriver {
  constructor(private client: Pool | PoolClient | Client) {}

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.client.query(sql, params);
    return result.rows as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // If it's a pool, get a client
    if ('connect' in this.client && typeof this.client.connect === 'function') {
      const client = await (this.client as Pool).connect();
      try {
        await client.query('BEGIN');
        const driver = new NodePgDriver(client);
        // Temporarily swap the client
        const originalClient = this.client;
        this.client = client;
        try {
          const result = await fn();
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          this.client = originalClient;
        }
      } finally {
        client.release();
      }
    }

    // If it's already a client, use it directly
    await this.client.query('BEGIN');
    try {
      const result = await fn();
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    if ('end' in this.client && typeof this.client.end === 'function') {
      await this.client.end();
    }
  }
}

