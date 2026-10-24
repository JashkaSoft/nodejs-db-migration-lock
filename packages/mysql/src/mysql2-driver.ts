import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { Pool, PoolConnection, Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

type MysqlConnection = Pool | PoolConnection | Connection;

function isMysqlPool(client: MysqlConnection): client is Pool {
  return (
    typeof (client as Pool).getConnection === 'function' &&
    !('threadId' in client)
  );
}

function toRows<T>(result: unknown): T[] {
  const payload: unknown = Array.isArray(result) ? result[0] : result;

  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload && typeof payload === 'object') {
    return [payload as T];
  }

  return [];
}

/**
 * Adapter for mysql2 Pool or Connection.
 * A Pool checks out one connection for the driver's lifetime so GET_LOCK
 * stays on a single session.
 */
export class Mysql2Driver implements SqlDriver {
  private sessionClient: PoolConnection | null = null;

  /**
   * `end` closes a Pool or a standalone Connection.
   * `release` returns a forked pool connection without closing the pool.
   */
  constructor(
    private client: MysqlConnection,
    private readonly closeMode: 'end' | 'release' = 'end',
  ) {}

  async fork(): Promise<SqlDriver> {
    if (!isMysqlPool(this.client)) {
      throw new Error('Mysql2Driver.fork requires a mysql2 Pool');
    }
    const connection = await this.client.getConnection();
    return new Mysql2Driver(connection, 'release');
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const connection = await this.getConnection();
    const result = await connection.query(sql, params);
    return toRows<T>(result);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const connection = await this.getConnection();
    await connection.query('START TRANSACTION');
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

    if (this.closeMode === 'release') {
      (this.client as PoolConnection).release();
      return;
    }

    if ('end' in this.client && typeof this.client.end === 'function') {
      await this.client.end();
    }
  }

  private async getConnection(): Promise<MysqlConnection> {
    if (this.sessionClient) {
      return this.sessionClient;
    }

    if (isMysqlPool(this.client)) {
      this.sessionClient = await this.client.getConnection();
      return this.sessionClient;
    }

    return this.client;
  }
}

export type { ResultSetHeader, RowDataPacket };
