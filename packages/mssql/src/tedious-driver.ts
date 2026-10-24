import { SqlDriver } from '@nodejs-db-migration-lock/core';
import { Connection, Request, TYPES, type ConnectionConfiguration } from 'tedious';

type QueryConnection = {
  execSql(request: Request): void;
  on(event: 'connect' | 'end', listener: (error?: Error) => void): void;
  connect(): void;
  close(): void;
};

function isConfiguration(value: ConnectionConfiguration | QueryConnection): value is ConnectionConfiguration {
  return 'server' in value && !('execSql' in value);
}

function bindParameter(request: Request, index: number, value: unknown): void {
  const name = `p${index + 1}`;
  if (typeof value === 'number' && Number.isInteger(value)) {
    request.addParameter(name, TYPES.Int, value);
    return;
  }
  if (typeof value === 'bigint') {
    request.addParameter(name, TYPES.VarChar, value.toString());
    return;
  }
  if (typeof value === 'boolean') {
    request.addParameter(name, TYPES.Bit, value);
    return;
  }
  if (value instanceof Date) {
    request.addParameter(name, TYPES.DateTime, value);
    return;
  }
  if (value === null || value === undefined) {
    request.addParameter(name, TYPES.NVarChar, null);
    return;
  }
  if (typeof value === 'string') {
    request.addParameter(name, TYPES.NVarChar, value);
    return;
  }
  request.addParameter(name, TYPES.NVarChar, JSON.stringify(value));
}

export function executeRequest(
  connection: QueryConnection,
  sql: string,
  params: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const rows: Array<Record<string, unknown>> = [];
    const request = new Request(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
    params.forEach((value, index) => bindParameter(request, index, value));
    request.on('row', (columns: Array<{ metadata: { colName: string }; value: unknown }>) => {
      const row: Record<string, unknown> = {};
      for (const column of columns) {
        row[column.metadata.colName] = column.value;
      }
      rows.push(row);
    });
    connection.execSql(request);
  });
}

/**
 * One tedious connection for the driver lifetime.
 * Session application locks are released when this connection closes.
 */
export class TediousDriver implements SqlDriver {
  private readonly connection: QueryConnection;
  private readonly ready: Promise<void>;

  constructor(target: ConnectionConfiguration | QueryConnection) {
    if (isConfiguration(target)) {
      const connection = new Connection(target);
      this.connection = connection;
      this.ready = new Promise((resolve, reject) => {
        connection.on('connect', (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      connection.connect();
      return;
    }

    this.connection = target;
    this.ready = Promise.resolve();
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    await this.ready;
    const rows = await executeRequest(this.connection, sql, params);
    return rows as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.query('BEGIN TRANSACTION');
    try {
      const result = await fn();
      await this.query('COMMIT TRANSACTION');
      return result;
    } catch (error) {
      try {
        await this.query('ROLLBACK TRANSACTION');
      } catch {
        // The original error is the one the caller needs.
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.ready.catch(() => undefined);
    await new Promise<void>((resolve) => {
      this.connection.on('end', () => resolve());
      this.connection.close();
    });
  }
}
