/// <reference path="./oracledb.d.ts" />
import { SqlDriver } from '@nodejs-db-migration-lock/core';

export type OracleConnection = {
  execute(
    sql: string,
    binds?: Record<string, unknown>,
    options?: { outFormat?: number; autoCommit?: boolean },
  ): Promise<{ rows?: unknown[]; outBinds?: Record<string, unknown> }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
};

export type OracleConnectionConfig = {
  user: string;
  password: string;
  connectString: string;
};

function isConfig(value: OracleConnection | OracleConnectionConfig): value is OracleConnectionConfig {
  return 'connectString' in value && !('execute' in value);
}

function isOutBind(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { out?: boolean }).out === true);
}

function bindNamesInOrder(sql: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const match of sql.matchAll(/(?<!:):([A-Za-z][A-Za-z0-9_]*)/g)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * One Oracle session for the driver lifetime.
 * DBMS_LOCK is tied to that session until RELEASE or disconnect.
 */
export class OracleDriver implements SqlDriver {
  private connection: OracleConnection | null = null;
  private inTransaction = false;
  private readonly ready: Promise<void>;

  constructor(private readonly target: OracleConnection | OracleConnectionConfig) {
    if (isConfig(target)) {
      this.ready = this.connect(target);
      return;
    }
    this.connection = target;
    this.ready = Promise.resolve();
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    await this.ready;
    const connection = this.connection;
    if (!connection) {
      throw new Error('Oracle connection is closed');
    }
    const oracledb = await import('oracledb');
    const values = params ?? [];
    const names = bindNamesInOrder(sql);
    const useSqlNames = names.length === values.length && names.length > 0;
    const binds: Record<string, unknown> = {};
    let outName: string | undefined;
    values.forEach((value, index) => {
      const name = useSqlNames ? names[index] : `p${index + 1}`;
      if (isOutBind(value)) {
        binds[name] = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };
        outName = name;
        return;
      }
      binds[name] = value;
    });
    const result = await connection.execute(sql, binds, {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: !this.inTransaction,
    });
    if (outName) {
      return [{ acquired: result.outBinds?.[outName] }] as T[];
    }
    return (result.rows ?? []) as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.ready;
    this.inTransaction = true;
    try {
      const result = await fn();
      await this.connection?.commit();
      return result;
    } catch (error) {
      await this.connection?.rollback();
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    await this.connection?.close();
    this.connection = null;
  }

  private async connect(config: OracleConnectionConfig): Promise<void> {
    const oracledb = await import('oracledb');
    const connection = await oracledb.getConnection(config);
    this.connection = connection;
  }
}
