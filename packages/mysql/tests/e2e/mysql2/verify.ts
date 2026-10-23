import mysql from 'mysql2/promise';

const results: Array<{ test: string; passed: boolean; message: string }> = [];

function add(test: string, passed: boolean, message: string): void {
  results.push({ test, passed, message });
  console.log(`${passed ? 'OK' : 'FAIL'} ${test}: ${message}`);
}

function asRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Array<Record<string, unknown>>;
  }
  return [];
}

async function main(): Promise<void> {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'testuser',
    password: process.env.MYSQL_PASSWORD || 'testpass',
    database: process.env.MYSQL_DB || 'migration_test',
  });

  const expected = parseInt(process.env.EXPECTED_PROCESSES || '3', 10);
  const started = Date.now();
  while (Date.now() - started < 120000) {
    try {
      const rows = asRows(await pool.query('SELECT COUNT(*) AS n FROM migration_logs'));
      const count = Number(rows[0]?.n ?? 0);
      console.log(`Waiting for logs ${count}/${expected}`);
      if (count >= expected) {
        break;
      }
    } catch {
      console.log('Waiting for migration_logs...');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const logs = asRows(await pool.query('SELECT * FROM migration_logs ORDER BY started_at'));
  const completed = logs.filter((l) => l.status === 'completed');
  add('logs', logs.length >= expected, `found ${logs.length}`);
  add('success', completed.length === expected, `${completed.length} completed`);

  const tables = asRows(
    await pool.query(`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_name IN ('users', 'posts')
  `),
  );
  const names = tables.map((t) => String(t.name || t.TABLE_NAME || '').toLowerCase());
  add('tables', names.includes('users') && names.includes('posts'), names.join(','));

  const users = asRows(await pool.query('SELECT * FROM users ORDER BY created_at'));
  add('users', users.length === expected, `${users.length} users`);

  const locks = asRows(await pool.query('SELECT * FROM migration_lock WHERE id = 1'));
  add('lock released', locks.length === 0, `${locks.length} lock rows`);

  await pool.end();
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    console.log('Some MySQL e2e checks failed');
    process.exit(1);
  }
  console.log('All MySQL e2e tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
