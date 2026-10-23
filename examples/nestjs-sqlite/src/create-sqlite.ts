import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function createSqlite(): DatabaseSync {
  const sqlitePath = process.env.SQLITE_PATH || './data/app.db';
  mkdirSync(dirname(sqlitePath), { recursive: true });
  return new DatabaseSync(sqlitePath, { timeout: 5000 });
}
