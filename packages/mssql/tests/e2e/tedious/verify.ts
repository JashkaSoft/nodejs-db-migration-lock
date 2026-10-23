import { TediousDriver } from '@nodejs-db-migration-lock/mssql';

const results: Array<{ test: string; passed: boolean; message: string }> = [];

function add(test: string, passed: boolean, message: string): void {
  results.push({ test, passed, message });
  console.log(`${passed ? 'OK' : 'FAIL'} ${test}: ${message}`);
}

function driver(): TediousDriver {
  return new TediousDriver({
    server: process.env.MSSQL_HOST || 'localhost',
    authentication: {
      type: 'default',
      options: {
        userName: process.env.MSSQL_USER || 'sa',
        password: process.env.MSSQL_PASSWORD || 'Migration_Lock_1',
      },
    },
    options: {
      database: process.env.MSSQL_DB || 'master',
      port: parseInt(process.env.MSSQL_PORT || '1433', 10),
      encrypt: true,
      trustServerCertificate: true,
      connectTimeout: 30000,
    },
  });
}

async function main(): Promise<void> {
  const db = driver();
  const expected = parseInt(process.env.EXPECTED_PROCESSES || '3', 10);
  const started = Date.now();
  let logs: Array<Record<string, unknown>> = [];

  while (Date.now() - started < 180000) {
    try {
      const rows = await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM dbo.migration_logs');
      const count = Number(rows[0]?.n ?? 0);
      console.log(`Waiting for logs ${count}/${expected}`);
      if (count >= expected) {
        logs = await db.query('SELECT * FROM dbo.migration_logs ORDER BY started_at');
        break;
      }
    } catch {
      console.log('Waiting for migration_logs...');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  const completed = logs.filter((row) => row.status === 'completed');
  add('logs', logs.length >= expected, `found ${logs.length}`);
  add('success', completed.length === expected, `${completed.length} completed`);

  const tables = await db.query<{ name: string }>(`
    SELECT name FROM sys.tables WHERE name IN ('users', 'posts')
  `);
  const names = tables.map((row) => String(row.name).toLowerCase());
  add('tables', names.includes('users') && names.includes('posts'), names.join(','));

  const users = await db.query('SELECT email, created_by FROM dbo.users');
  add('users', users.length === expected, `${users.length} users`);

  await db.close();
  if (results.some((result) => !result.passed)) {
    console.log('Some SQL Server e2e checks failed');
    process.exit(1);
  }
  console.log('All SQL Server e2e tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
