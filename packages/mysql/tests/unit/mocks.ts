import { SqlDriver } from '@nodejs-db-migration-lock/core';

export class MockMysqlDriver implements SqlDriver {
  public queries: Array<{ sql: string; params?: any[] }> = [];
  public shouldFail = false;
  public acquireResult: unknown = 1;
  public insertAffectedRows = 1;

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    this.queries.push({ sql, params });
    if (this.shouldFail) {
      throw new Error('Query failed');
    }

    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('get_lock')) {
      return [{ acquired: this.acquireResult }] as T[];
    }
    if (normalized.includes('release_lock')) {
      return [{ released: 1 }] as T[];
    }
    if (normalized.includes('insert ignore')) {
      return [{ affectedRows: this.insertAffectedRows }] as T[];
    }
    if (normalized.includes('select 1')) {
      return [{ '1': 1 }] as T[];
    }
    return [] as T[];
  }
}

export class MockMysqlPool {
  public queries: Array<{ sql: string; params?: any[] }> = [];
  public ended = false;

  async query(sql: string, params?: any[]) {
    this.queries.push({ sql, params });
    return [[{ ok: true }], []];
  }

  async getConnection() {
    return {
      query: async (sql: string, params?: any[]) => {
        this.queries.push({ sql, params });
        return [[{ ok: true }], []];
      },
      release: () => {
        this.released = true;
      },
      released: false,
    };
  }

  released = false;

  async end() {
    this.ended = true;
  }
}
