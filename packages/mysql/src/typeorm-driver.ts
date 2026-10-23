import { SqlDriver } from '@nodejs-db-migration-lock/core';

type DataSource = any;

export class TypeORMDriver implements SqlDriver {
  constructor(private dataSource: DataSource) {
    if (!dataSource.isInitialized) {
      throw new Error(
        'TypeORM DataSource must be initialized before use with TypeORMDriver',
      );
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.dataSource.query(sql, params);
    if (Array.isArray(result)) {
      return result as T[];
    }
    if (result && typeof result === 'object') {
      return [result as T];
    }
    return [];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager: any) => {
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
