import { SqlDriver } from '@nodejs-db-migration-lock/core';

type SequelizeInstance = any;

/**
 * Adapter for a Sequelize instance.
 * Database-agnostic: pair with a lock provider from postgres, mysql, or another dialect package.
 */
export class SequelizeDriver implements SqlDriver {
  private activeTransaction: unknown = null;

  constructor(private sequelize: SequelizeInstance) {
    if (!sequelize || typeof sequelize.query !== 'function') {
      throw new Error('SequelizeDriver requires a Sequelize instance');
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const dialect = this.sequelize.getDialect?.() ?? '';
    const options: Record<string, unknown> = { raw: true };
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
    return this.sequelize.transaction(async (t: unknown) => {
      this.activeTransaction = t;
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
