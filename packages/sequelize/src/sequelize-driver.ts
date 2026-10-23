import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { QueryOptions, Sequelize, Transaction } from 'sequelize';

/**
 * Adapter for a Sequelize instance.
 * Database-agnostic: pair with a lock provider from postgres, mysql, or another dialect package.
 */
export class SequelizeDriver implements SqlDriver {
  private activeTransaction: Transaction | null = null;

  constructor(private sequelize: Sequelize) {
    if (!sequelize || typeof sequelize.query !== 'function') {
      throw new Error('SequelizeDriver requires a Sequelize instance');
    }
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const dialect = this.sequelize.getDialect();
    const options: QueryOptions = { raw: true };
    if (this.activeTransaction) {
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
    if (Array.isArray(results) && results.length > 0) {
      return results as T[];
    }
    if (metadata && typeof metadata === 'object') {
      return [metadata as T];
    }
    if (Array.isArray(results)) {
      return results as T[];
    }
    if (results && typeof results === 'object') {
      return [results as T];
    }
    return [];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.sequelize.transaction(async (transaction) => {
      this.activeTransaction = transaction;
      try {
        return await fn();
      } finally {
        this.activeTransaction = null;
      }
    });
  }

  async close(): Promise<void> {
    await this.sequelize.close();
  }
}
