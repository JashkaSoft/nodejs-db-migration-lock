import { SqlDriver } from '@nodejs-db-migration-lock/core';

// Use dynamic import type to avoid requiring typeorm at compile time
type DataSource = any; // Users will import from 'typeorm' in their code

/**
 * Adapter to use TypeORM DataSource as a SqlDriver
 * 
 * Usage:
 * ```typescript
 * import { DataSource } from 'typeorm';
 * import { TypeORMDriver } from '@nodejs-db-migration-lock/postgres';
 * 
 * const dataSource = new DataSource({...});
 * await dataSource.initialize();
 * const driver = new TypeORMDriver(dataSource);
 * ```
 */
export class TypeORMDriver implements SqlDriver {
  constructor(private dataSource: DataSource) {
    if (!dataSource.isInitialized) {
      throw new Error(
        'TypeORM DataSource must be initialized before use with TypeORMDriver',
      );
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.dataSource.query(sql, params);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager: any) => {
      // Temporarily swap the query runner
      const originalQuery = this.dataSource.query;
      this.dataSource.query = manager.query.bind(manager);
      try {
        return await fn();
      } finally {
        this.dataSource.query = originalQuery;
      }
    });
  }

  async close(): Promise<void> {
    if (this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }
}

