import { Sequelize } from 'sequelize';
import { SqlDriver } from '@nodejs-db-migration-lock/core';

/**
 * Example-only adapter. There is no published @nodejs-db-migration-lock/sequelize package.
 */
export class SequelizeDriver implements SqlDriver {
  constructor(private readonly sequelize: Sequelize) {}

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const dialect = this.sequelize.getDialect();
    const options =
      dialect === 'mysql' || dialect === 'mariadb'
        ? { replacements: params, raw: true as const }
        : { bind: params, raw: true as const };

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

  async close(): Promise<void> {
    await this.sequelize.close();
  }
}
