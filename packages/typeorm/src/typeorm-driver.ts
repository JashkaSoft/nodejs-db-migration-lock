import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { DataSource, EntityManager } from 'typeorm';

/**
 * Adapter for a TypeORM DataSource.
 * Database-agnostic: pair with a lock provider from postgres, mysql, or another dialect package.
 */
export class TypeORMDriver implements SqlDriver {
  private queryWith: (sql: string, params?: unknown[]) => Promise<unknown>;

  constructor(private dataSource: DataSource) {
    if (!dataSource.isInitialized) {
      throw new Error(
        'TypeORM DataSource must be initialized before use with TypeORMDriver',
      );
    }
    this.queryWith = (sql, params) => dataSource.query(sql, params);
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.queryWith(sql, params);
    if (Array.isArray(result)) {
      return result as T[];
    }
    if (result && typeof result === 'object') {
      return [result as T];
    }
    return [];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const previous = this.queryWith;
      this.queryWith = (sql, params) => manager.query(sql, params);
      try {
        return await fn();
      } finally {
        this.queryWith = previous;
      }
    });
  }

  async close(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}
