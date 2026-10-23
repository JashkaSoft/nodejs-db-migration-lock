import { SqlDriver } from '@nodejs-db-migration-lock/core';

type KnexLike = any;

/** Knex only interpolates `?`; lock SQL uses native `$1` on Postgres. */
function toKnexSql(sql: string): string {
  return sql.replace(/\$\d+/g, '?');
}

function unwrapKnexResult<T>(result: unknown): T[] {
  if (result == null) {
    return [];
  }
  if (typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first)) {
      return first as T[];
    }
    if (first && typeof first === 'object') {
      return [first as T];
    }
    return [];
  }
  if (typeof result === 'object') {
    return [result as T];
  }
  return [];
}

/**
 * Adapter for a Knex instance.
 * Database-agnostic: pair with a lock provider from postgres, mysql, or another dialect package.
 */
export class KnexDriver implements SqlDriver {
  constructor(private knex: KnexLike) {
    if (!knex || typeof knex.raw !== 'function') {
      throw new Error('KnexDriver requires a Knex instance');
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const knexSql = toKnexSql(sql);
    const result =
      params === undefined
        ? await this.knex.raw(knexSql)
        : await this.knex.raw(knexSql, params);
    return unwrapKnexResult<T>(result);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.knex.transaction(async (trx: KnexLike) => {
      const previous = this.knex;
      this.knex = trx;
      try {
        return await fn();
      } finally {
        this.knex = previous;
      }
    });
  }

  async close(): Promise<void> {
    await this.knex.destroy();
  }
}
