import { SqlDriver } from '@nodejs-db-migration-lock/core';
import type { Knex } from 'knex';

type KnexClient = {
  acquireConnection(): Promise<unknown>;
  releaseConnection(connection: unknown): Promise<void>;
};

type RawBuilder = Promise<unknown> & {
  connection?: (connection: unknown) => Promise<unknown>;
};

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
 * When the client can check out a connection, lock queries stay on that
 * connection for the driver lifetime.
 */
export class KnexDriver implements SqlDriver {
  private session: unknown | undefined;

  constructor(private knex: Knex) {
    if (!knex || typeof knex.raw !== 'function') {
      throw new Error('KnexDriver requires a Knex instance');
    }
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const knexSql = toKnexSql(sql);
    const session = await this.getSession();
    const builder = (
      params === undefined ? this.knex.raw(knexSql) : this.knex.raw(knexSql, params as Knex.RawBinding[])
    ) as RawBuilder;
    const executed =
      session && typeof builder.connection === 'function'
        ? builder.connection(session)
        : builder;
    return unwrapKnexResult<T>(await executed);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const session = await this.getSession();
    if (!session) {
      return this.knex.transaction(async (trx) => {
        const previous = this.knex;
        this.knex = trx;
        try {
          return await fn();
        } finally {
          this.knex = previous;
        }
      });
    }

    await this.exec('BEGIN');
    try {
      const result = await fn();
      await this.exec('COMMIT');
      return result;
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.client();
    if (this.session && client) {
      await client.releaseConnection(this.session);
      this.session = undefined;
    }
    await this.knex.destroy();
  }

  private client(): KnexClient | undefined {
    const client = (this.knex as Knex & { client?: KnexClient }).client;
    if (!client || typeof client.acquireConnection !== 'function') {
      return undefined;
    }
    return client;
  }

  private async getSession(): Promise<unknown | undefined> {
    if (this.session) {
      return this.session;
    }
    const client = this.client();
    if (!client) {
      return undefined;
    }
    this.session = await client.acquireConnection();
    return this.session;
  }

  private async exec(sql: string): Promise<void> {
    await this.query(sql);
  }
}
