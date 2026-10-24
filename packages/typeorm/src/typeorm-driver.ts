import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { DataSource, QueryRunner } from 'typeorm';

/**
 * Adapter for a TypeORM DataSource.
 * Checks out one QueryRunner for the driver lifetime so session locks stay
 * on a single connection. Migration runners keep using the DataSource pool.
 */
export class TypeORMDriver implements SqlDriver {
  private runner: QueryRunner | null = null;
  private connecting: Promise<QueryRunner | null> | null = null;

  /**
   * A forked driver keeps the DataSource open and only releases its own runner.
   */
  constructor(
    private dataSource: DataSource,
    private readonly ownsDataSource = true,
    runner?: QueryRunner,
  ) {
    if (!dataSource.isInitialized) {
      throw new Error(
        'TypeORM DataSource must be initialized before use with TypeORMDriver',
      );
    }
    if (runner) {
      this.runner = runner;
    }
  }

  async fork(): Promise<SqlDriver> {
    if (typeof this.dataSource.createQueryRunner !== 'function') {
      throw new Error('TypeORMDriver.fork requires DataSource.createQueryRunner');
    }
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    return new TypeORMDriver(this.dataSource, false, runner);
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const runner = await this.getRunner();
    const result: unknown = runner
      ? await runner.query(sql, params)
      : await this.dataSource.query(sql, params);
    return asRows<T>(result);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const runner = await this.getRunner();
    if (!runner) {
      return this.dataSource.transaction(async () => fn());
    }

    await runner.startTransaction();
    try {
      const result = await fn();
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.runner && !this.runner.isReleased) {
      await this.runner.release();
      this.runner = null;
    }
    if (this.ownsDataSource && this.dataSource.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  private async getRunner(): Promise<QueryRunner | null> {
    if (typeof this.dataSource.createQueryRunner !== 'function') {
      return null;
    }
    if (this.runner && !this.runner.isReleased) {
      return this.runner;
    }
    if (!this.connecting) {
      this.connecting = (async () => {
        const runner = this.dataSource.createQueryRunner();
        await runner.connect();
        this.runner = runner;
        return runner;
      })().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }
}

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  if (result && typeof result === 'object') {
    return [result as T];
  }
  return [];
}
