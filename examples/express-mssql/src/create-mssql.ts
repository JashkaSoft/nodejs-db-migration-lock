import { TediousDriver } from '@nodejs-db-migration-lock/mssql';

function config(database: string) {
  return {
    server: process.env.MSSQL_HOST || 'localhost',
    authentication: {
      type: 'default' as const,
      options: {
        userName: process.env.MSSQL_USER || 'sa',
        password: process.env.MSSQL_PASSWORD || 'Migration_Lock_1',
      },
    },
    options: {
      database,
      port: parseInt(process.env.MSSQL_PORT || '1433', 10),
      encrypt: true,
      trustServerCertificate: true,
      connectTimeout: 30000,
    },
  };
}

/** Connect to master, create the app database, then return a driver on that database. */
export async function createMssql(): Promise<TediousDriver> {
  const database = process.env.MSSQL_DB || 'app';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(database)) {
    throw new Error(`Invalid database name: ${database}`);
  }
  const master = new TediousDriver(config('master'));
  try {
    await master.query(`IF DB_ID(N'${database}') IS NULL CREATE DATABASE ${database}`);
  } finally {
    await master.close();
  }
  return new TediousDriver(config(database));
}
