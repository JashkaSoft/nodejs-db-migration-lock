import { Pool } from 'pg';
import { YugabyteDriver } from '@nodejs-db-migration-lock/yugabyte';

const results: Array<{ test: string; passed: boolean; message: string }> = [];

function add(test: string, passed: boolean, message: string): void {
  results.push({ test, passed, message });
  console.log(`${passed ? 'OK' : 'FAIL'} ${test}: ${message}`);
}

async function main(): Promise<void> {
  const db = new YugabyteDriver(new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5433', 10),
    user: process.env.PGUSER || 'yugabyte',
    password: process.env.PGPASSWORD || 'yugabyte',
    database: process.env.PGDATABASE || 'yugabyte',
  }));
  const expected = parseInt(process.env.EXPECTED_PROCESSES || '3', 10);
  const started = Date.now();
  let logs: Array<{ status: string }> = [];

  while (Date.now() - started < 120000) {
    try {
      const rows = await db.query<{ n: string }>('SELECT COUNT(*) AS n FROM migration_logs');
      const count = Number(rows[0]?.n ?? 0);
      console.log(`Waiting for logs ${count}/${expected}`);
      if (count >= expected) {
        logs = await db.query('SELECT status FROM migration_logs');
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

  const tables = await db.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('users', 'posts')
  `);
  const names = tables.map((row) => row.table_name);
  add('tables', names.includes('users') && names.includes('posts'), names.join(','));

  const users = await db.query('SELECT email FROM users');
  add('users', users.length === expected, `${users.length} users`);

  const locks = await db.query('SELECT id FROM migration_lock WHERE id = 1');
  add('lock released', locks.length === 0, `${locks.length} lock rows`);

  await db.close();
  if (results.some((result) => !result.passed)) {
    console.log('Some YugabyteDB e2e checks failed');
    process.exit(1);
  }
  console.log('All YugabyteDB e2e tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
