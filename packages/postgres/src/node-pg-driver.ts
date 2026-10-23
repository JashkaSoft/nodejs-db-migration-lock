import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { Pool, PoolClient, Client } from 'pg';

type PgConnection = Pool | PoolClient | Client;

function isPgPool(client: PgConnection): client is Pool {
  return (
    typeof (client as Pool).connect === 'function' &&
    'totalCount' in client
  );
}

/**
 * Adapter to use node-postgres (pg) Pool or Client as a SqlDriver.
 *
 * When given a Pool, the driver checks out a dedicated client for the
 * driver's lifetime so session-level features (advisory locks) stay on
 * one PostgreSQL backend.
 */
export class NodePgDriver implements SqlDriver {
  private sessionClient: PoolClient | null = null;

  constructor(private client: PgConnection) {}

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const connection = await this.getConnection();
    const result = await connection.query(sql, params);
    return result.rows as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const connection = await this.getConnection();
    await connection.query('BEGIN');
    try {
      const result = await fn();
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.sessionClient) {
      this.sessionClient.release();
      this.sessionClient = null;
    }

    if ('end' in this.client && typeof this.client.end === 'function') {
      await this.client.end();
    }
  }

  private async getConnection(): Promise<PgConnection> {
    if (this.sessionClient) {
      return this.sessionClient;
    }

    if (isPgPool(this.client)) {
      this.sessionClient = await this.client.connect();
      return this.sessionClient;
    }

    return this.client;
  }
}
