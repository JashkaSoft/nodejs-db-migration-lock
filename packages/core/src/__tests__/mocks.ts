/**
 * Mock implementations for testing
 */

import { SqlDriver, LockProvider, MigrationRunner } from '../interfaces';

/**
 * Mock SqlDriver for testing
 */
export class MockSqlDriver implements SqlDriver {
  public queries: Array<{ sql: string; params?: any[] }> = [];
  public queryResults: Map<string, any[]> = new Map();
  public shouldFail = false;
  public failureError = new Error('Query failed');

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    this.queries.push({ sql, params });
    
    if (this.shouldFail) {
      throw this.failureError;
    }
    
    const key = this.normalizeQuery(sql);
    return (this.queryResults.get(key) || []) as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async close(): Promise<void> {
    // Mock close
  }

  // Helper methods
  mockQueryResult(sql: string, result: any[]): void {
    this.queryResults.set(this.normalizeQuery(sql), result);
  }

  getLastQuery(): { sql: string; params?: any[] } | undefined {
    return this.queries[this.queries.length - 1];
  }

  getQueryCount(): number {
    return this.queries.length;
  }

  reset(): void {
    this.queries = [];
    this.queryResults.clear();
    this.shouldFail = false;
  }

  private normalizeQuery(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim();
  }
}

/**
 * Mock LockProvider for testing
 */
export class MockLockProvider implements LockProvider {
  name = 'mock-lock';
  public acquireCalls = 0;
  public releaseCalls = 0;
  public infrastructureCalls = 0;
  public healthcheckCalls = 0;
  
  public shouldAcquireSucceed = true;
  public acquireDelay = 0;
  public acquireResults: boolean[] = [];
  public shouldFailInfrastructure = false;
  public shouldFailRelease = false;

  async ensureInfrastructure(driver: SqlDriver): Promise<void> {
    this.infrastructureCalls++;
    if (this.shouldFailInfrastructure) {
      throw new Error('Infrastructure setup failed');
    }
  }

  async acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean> {
    this.acquireCalls++;
    
    if (signal?.aborted) {
      return false;
    }
    
    if (this.acquireDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.acquireDelay));
    }
    
    // Use predefined results if available
    if (this.acquireResults.length > 0) {
      return this.acquireResults.shift() || false;
    }
    
    return this.shouldAcquireSucceed;
  }

  async release(driver: SqlDriver): Promise<void> {
    this.releaseCalls++;
    if (this.shouldFailRelease) {
      throw new Error('Release failed');
    }
  }

  async healthcheck(driver: SqlDriver): Promise<boolean> {
    this.healthcheckCalls++;
    return true;
  }

  // Helper methods
  setAcquireSequence(results: boolean[]): void {
    this.acquireResults = [...results];
  }

  reset(): void {
    this.acquireCalls = 0;
    this.releaseCalls = 0;
    this.infrastructureCalls = 0;
    this.healthcheckCalls = 0;
    this.shouldAcquireSucceed = true;
    this.acquireDelay = 0;
    this.acquireResults = [];
    this.shouldFailInfrastructure = false;
    this.shouldFailRelease = false;
  }
}

/**
 * Mock MigrationRunner for testing
 */
export class MockMigrationRunner implements MigrationRunner {
  public runCalls = 0;
  public shouldFail = false;
  public failureError = new Error('Migration failed');
  public runDelay = 0;

  async run(): Promise<void> {
    this.runCalls++;
    
    if (this.runDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.runDelay));
    }
    
    if (this.shouldFail) {
      throw this.failureError;
    }
  }

  reset(): void {
    this.runCalls = 0;
    this.shouldFail = false;
    this.runDelay = 0;
  }
}

