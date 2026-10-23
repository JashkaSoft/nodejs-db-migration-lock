/**
 * Mock implementations for testing PostgreSQL adapters
 */

import { SqlDriver } from '@nodejs-db-migration-lock/core';

/**
 * Mock SQL Driver that simulates PostgreSQL behavior
 */
export class MockPostgresDriver implements SqlDriver {
  public queries: Array<{ sql: string; params?: unknown[] }> = [];
  private results: Map<string, unknown[]> = new Map();
  public shouldFail = false;
  public failureError = new Error('Query failed');

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    this.queries.push({ sql, params });

    if (this.shouldFail) {
      throw this.failureError;
    }

    // Simulate PostgreSQL responses
    const normalizedSql = this.normalizeSql(sql);

    // pg_try_advisory_lock
    if (normalizedSql.includes('pg_try_advisory_lock')) {
      return (this.results.get('advisory_lock') ?? [{ pg_try_advisory_lock: true }]) as T[];
    }

    // pg_advisory_unlock
    if (normalizedSql.includes('pg_advisory_unlock')) {
      return (this.results.get('advisory_unlock') ?? [{ pg_advisory_unlock: true }]) as T[];
    }

    // Table existence check
    if (normalizedSql.includes('information_schema.tables')) {
      return (this.results.get('table_exists') ?? [{ exists: false }]) as T[];
    }

    // Sequence check
    if (normalizedSql.includes('pg_class') && normalizedSql.includes('relname')) {
      return [] as T[];
    }

    // CREATE SEQUENCE
    if (normalizedSql.includes('create sequence')) {
      return [] as T[];
    }

    // CREATE TABLE
    if (normalizedSql.includes('create table')) {
      return [] as T[];
    }

    // INSERT with RETURNING
    if (normalizedSql.includes('insert') && normalizedSql.includes('returning')) {
      return (this.results.get('insert') ?? [{ id: 1 }]) as T[];
    }

    // DELETE
    if (normalizedSql.includes('delete')) {
      return [] as T[];
    }

    // SELECT 1 (healthcheck)
    if (normalizedSql.includes('select 1')) {
      return [{ result: 1 }] as T[];
    }

    // Default
    return (this.results.get('default') ?? []) as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async close(): Promise<void> {
    // Mock close
  }

  // Helper methods
  mockResult(key: string, result: unknown[]): void {
    this.results.set(key, result);
  }

  mockAdvisoryLock(success: boolean): void {
    this.results.set('advisory_lock', [{ pg_try_advisory_lock: success }]);
  }

  mockTableExists(exists: boolean): void {
    this.results.set('table_exists', [{ exists }]);
  }

  mockInsertSuccess(success: boolean): void {
    this.results.set('insert', success ? [{ id: 1 }] : []);
  }

  getLastQuery(): { sql: string; params?: unknown[] } | undefined {
    return this.queries[this.queries.length - 1];
  }

  getQueriesContaining(text: string): Array<{ sql: string; params?: unknown[] }> {
    return this.queries.filter(q => this.normalizeSql(q.sql).includes(text.toLowerCase()));
  }

  reset(): void {
    this.queries = [];
    this.results.clear();
    this.shouldFail = false;
  }

  private normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}

/**
 * Mock pg Pool for testing NodePgDriver
 */
export class MockPgPool {
  public queries: Array<{ sql: string; params?: unknown[] }> = [];
  public shouldFail = false;
  public failureError = new Error('Pool query failed');
  private results: Map<string, unknown[]> = new Map();

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });

    if (this.shouldFail) {
      throw this.failureError;
    }

    const key = this.normalizeSql(sql);
    const rows = this.results.get(key) || [];
    return { rows };
  }

  async connect(): Promise<MockPgClient> {
    return new MockPgClient();
  }

  async end(): Promise<void> {
    // Mock end
  }

  mockResult(sql: string, rows: unknown[]): void {
    this.results.set(this.normalizeSql(sql), rows);
  }

  private normalizeSql(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}

/**
 * Mock pg Client for testing NodePgDriver
 */
export class MockPgClient {
  public queries: Array<{ sql: string; params?: unknown[] }> = [];
  public shouldFail = false;
  public released = false;

  async query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }> {
    this.queries.push({ sql, params });

    if (this.shouldFail) {
      throw new Error('Client query failed');
    }

    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }

  async end(): Promise<void> {
    // Mock end
  }
}

