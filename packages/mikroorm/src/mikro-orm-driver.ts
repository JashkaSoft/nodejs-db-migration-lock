import { SqlDriver } from '@nodejs-db-migration-lock/core';

/**
 * The slice of a connected MikroORM instance this adapter uses.
 * Lock SQL goes through one checked-out native client. The EntityManager keeps the pool.
 */
export interface MikroOrmLike {
  close(force?: boolean): Promise<void>;
  em: {
    getConnection(): {
      getNativeClient(): Promise<unknown>;
    };
  };
}

type QueryClient = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  release?: () => void | Promise<void>;
};

type PoolLike = {
  connect?: () => Promise<QueryClient>;
  getConnection?: () => Promise<QueryClient>;
};

type Pinned = {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  release(): Promise<void>;
};

function asRows<T>(result: unknown): T[] {
  if (result == null) {
    return [];
  }
  if (Array.isArray(result)) {
    const first: unknown = result[0];
    if (Array.isArray(first)) {
      return first as T[];
    }
    if (first && typeof first === 'object') {
      return result as T[];
    }
    return [];
  }
  if (typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  if (typeof result === 'object') {
    return [result as T];
  }
  return [];
}

async function pin(native: unknown): Promise<Pinned> {
  if (!native || typeof native !== 'object') {
    throw new Error('MikroORMDriver requires connection.getNativeClient()');
  }
  const pool = native as PoolLike;
  const client = typeof pool.connect === 'function'
    ? await pool.connect()
    : typeof pool.getConnection === 'function'
      ? await pool.getConnection()
      : undefined;
  if (!client || typeof client.query !== 'function') {
    throw new Error('MikroORMDriver requires a pool with connect() or getConnection()');
  }
  const onError = (client as { on?: (event: string, listener: (error: unknown) => void) => void }).on;
  if (typeof onError === 'function') {
    onError.call(client, 'error', () => undefined);
  }
  return {
    query: (sql, params) => client.query(sql, params),
    release: async () => {
      await client.release?.();
    },
  };
}

/**
 * Adapter for a MikroORM instance.
 * Checks out one native connection for lock SQL. `fork()` checks out a second
 * connection for the table-lock heartbeat and does not close the ORM.
 */
export class MikroORMDriver implements SqlDriver {
  private connecting: Promise<Pinned> | null = null;

  constructor(
    private readonly orm: MikroOrmLike,
    private readonly ownsOrm = true,
    private session: Pinned | null = null,
  ) {}

  async fork(): Promise<SqlDriver> {
    const native = await this.orm.em.getConnection().getNativeClient();
    return new MikroORMDriver(this.orm, false, await pin(native));
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const session = await this.getSession();
    return asRows<T>(await session.query(sql, params));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const session = await this.getSession();
    await session.query('BEGIN');
    try {
      const result = await fn();
      await session.query('COMMIT');
      return result;
    } catch (error) {
      await session.query('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    if (this.ownsOrm) {
      await this.orm.close(true);
    }
  }

  private async getSession(): Promise<Pinned> {
    if (this.session) {
      return this.session;
    }
    if (!this.connecting) {
      this.connecting = (async () => {
        const native = await this.orm.em.getConnection().getNativeClient();
        this.session = await pin(native);
        return this.session;
      })().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }
}
