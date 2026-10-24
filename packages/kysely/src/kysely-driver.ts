import type { CompiledQuery, DatabaseConnection, Kysely } from 'kysely';
import { SqlDriver } from '@nodejs-db-migration-lock/core';

function compiled(sql: string, parameters?: readonly unknown[]): CompiledQuery {
  return {
    sql,
    parameters: parameters ?? [],
    query: { kind: 'RawNode' },
    queryId: { queryId: 'migration-lock' },
  } as CompiledQuery;
}

type Hold = {
  connection: DatabaseConnection;
  release(): void;
  released: Promise<void>;
};

/**
 * Adapter for a Kysely instance.
 * `provideConnection` keeps one session until `close()`. `fork()` holds a second
 * session for the table-lock heartbeat and does not destroy Kysely.
 */
export class KyselyDriver implements SqlDriver {
  private hold: Hold | null = null;
  private connecting: Promise<Hold> | null = null;

  constructor(
    private readonly db: Kysely<any>,
    private readonly ownsKysely = true,
    hold?: Hold,
  ) {
    if (!db || typeof db.getExecutor !== 'function') {
      throw new Error('KyselyDriver requires a Kysely instance');
    }
    if (hold) {
      this.hold = hold;
    }
  }

  async fork(): Promise<SqlDriver> {
    return new KyselyDriver(this.db, false, await this.acquire());
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const hold = await this.getHold();
    const result = await hold.connection.executeQuery(compiled(sql, params));
    return result.rows as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const hold = await this.getHold();
    await hold.connection.executeQuery(compiled('BEGIN'));
    try {
      const result = await fn();
      await hold.connection.executeQuery(compiled('COMMIT'));
      return result;
    } catch (error) {
      await hold.connection.executeQuery(compiled('ROLLBACK'));
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.hold) {
      this.hold.release();
      await this.hold.released;
      this.hold = null;
    }
    if (this.ownsKysely) {
      await this.db.destroy();
    }
  }

  private async getHold(): Promise<Hold> {
    if (this.hold) {
      return this.hold;
    }
    if (!this.connecting) {
      this.connecting = this.acquire().finally(() => {
        this.connecting = null;
      });
    }
    const hold = await this.connecting;
    this.hold = hold;
    return hold;
  }

  private acquire(): Promise<Hold> {
    let release!: () => void;
    let settled!: () => void;
    const released = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let captured!: DatabaseConnection;
    const ready = new Promise<Hold>((resolve, reject) => {
      this.db.getExecutor().provideConnection(async (connection) => {
        captured = connection;
        const hold: Hold = {
          connection,
          release: () => release(),
          released,
        };
        resolve(hold);
        try {
          await gate;
        } finally {
          settled();
        }
      }).catch((error: unknown) => {
        settled();
        reject(error);
      });
    });
    return ready.then((hold) => {
      if (!captured) {
        throw new Error('Kysely did not provide a connection');
      }
      return hold;
    });
  }
}
