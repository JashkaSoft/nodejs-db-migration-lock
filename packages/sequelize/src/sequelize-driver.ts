import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { QueryOptions, Sequelize, Transaction } from 'sequelize';

type ConnectionManager = {
  getConnection(options: { type: string }): Promise<unknown>;
  releaseConnection(connection: unknown): Promise<void>;
};

function isOkPacket(value: unknown): value is { affectedRows?: number; insertId?: number } {
  return (
    value !== null &&
    typeof value === 'object' &&
    ('affectedRows' in value || 'insertId' in value || 'fieldCount' in value)
  );
}

function normalizeSequelizeQueryResult<T>(results: unknown, metadata: unknown): T[] {
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0];
    if (first !== undefined && first !== null && typeof first === 'object' && !isOkPacket(first)) {
      return results as T[];
    }
    if (isOkPacket(first)) {
      return [first as T];
    }
  }
  if (typeof metadata === 'number') {
    return [{ affectedRows: metadata } as T];
  }
  if (metadata && typeof metadata === 'object') {
    return [metadata as T];
  }
  if (isOkPacket(results)) {
    return [results as T];
  }
  if (Array.isArray(results)) {
    return results as T[];
  }
  if (results && typeof results === 'object') {
    return [results as T];
  }
  return [];
}

/**
 * Adapter for a Sequelize instance.
 * When connectionManager is present, one connection is checked out and every
 * lock query is sent on it via a transaction-shaped options object. Sequelize
 * only keeps a connection checked out for the whole call when a transaction
 * is set; it releases pool connections otherwise.
 */
export class SequelizeDriver implements SqlDriver {
  private activeTransaction: Transaction | null = null;
  private pinned: unknown | undefined;
  private readonly ownsSequelize: boolean;

  /**
   * A forked driver releases only its checked-out connection.
   */
  constructor(
    private sequelize: Sequelize,
    options: { ownsSequelize?: boolean; pinned?: unknown } = {},
  ) {
    if (!sequelize || typeof sequelize.query !== 'function') {
      throw new Error('SequelizeDriver requires a Sequelize instance');
    }
    this.ownsSequelize = options.ownsSequelize !== false;
    this.pinned = options.pinned;
  }

  async fork(): Promise<SqlDriver> {
    const manager = this.manager();
    if (!manager) {
      throw new Error('SequelizeDriver.fork requires connectionManager');
    }
    const pinned = await manager.getConnection({ type: 'write' });
    return new SequelizeDriver(this.sequelize, { ownsSequelize: false, pinned });
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const dialect = this.sequelize.getDialect();
    const options: QueryOptions = { raw: true };
    const pinned = await this.getPinned();
    if (pinned) {
      (options as { transaction?: { connection: unknown } }).transaction = { connection: pinned };
    } else if (this.activeTransaction) {
      options.transaction = this.activeTransaction;
    }
    if (params !== undefined) {
      if (dialect === 'mysql' || dialect === 'mariadb') {
        options.replacements = params;
      } else {
        options.bind = params;
      }
    }

    const [results, metadata] = await this.sequelize.query(sql, options);
    return normalizeSequelizeQueryResult<T>(results, metadata);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const pinned = await this.getPinned();
    if (!pinned) {
      return this.sequelize.transaction(async (transaction) => {
        this.activeTransaction = transaction;
        try {
          return await fn();
        } finally {
          this.activeTransaction = null;
        }
      });
    }

    const hold = { connection: pinned } as unknown as Transaction;
    await this.sequelize.query('BEGIN', { transaction: hold });
    try {
      const result = await fn();
      await this.sequelize.query('COMMIT', { transaction: hold });
      return result;
    } catch (error) {
      await this.sequelize.query('ROLLBACK', { transaction: hold });
      throw error;
    }
  }

  async close(): Promise<void> {
    const manager = this.manager();
    if (this.pinned && manager) {
      await manager.releaseConnection(this.pinned);
      this.pinned = undefined;
    }
    if (this.ownsSequelize) {
      await this.sequelize.close();
    }
  }

  private manager(): ConnectionManager | undefined {
    const manager = (this.sequelize as Sequelize & { connectionManager?: ConnectionManager })
      .connectionManager;
    if (!manager || typeof manager.getConnection !== 'function') {
      return undefined;
    }
    return manager;
  }

  private async getPinned(): Promise<unknown | undefined> {
    if (this.pinned) {
      return this.pinned;
    }
    const manager = this.manager();
    if (!manager) {
      return undefined;
    }
    this.pinned = await manager.getConnection({ type: 'write' });
    return this.pinned;
  }
}
