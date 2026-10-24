import { OracleDriver } from '@nodejs-db-migration-lock/oracle';

const results: Array<{ test: string; passed: boolean; message: string }> = [];

function add(test: string, passed: boolean, message: string): void {
  results.push({ test, passed, message });
  console.log(`${passed ? 'OK' : 'FAIL'} ${test}: ${message}`);
}

function field(row: Record<string, unknown>, name: string): unknown {
  return row[name] ?? row[name.toUpperCase()];
}

async function main(): Promise<void> {
  const host = process.env.ORACLE_HOST || 'localhost';
  const port = process.env.ORACLE_PORT || '1521';
  const service = process.env.ORACLE_SERVICE || 'FREEPDB1';
  const db = new OracleDriver({
    user: process.env.ORACLE_USER || 'system',
    password: process.env.ORACLE_PASSWORD || 'Migration_Lock_1',
    connectString: `${host}:${port}/${service}`,
  });
  const expected = parseInt(process.env.EXPECTED_PROCESSES || '3', 10);
  const started = Date.now();
  let logs: Array<Record<string, unknown>> = [];

  while (Date.now() - started < 180000) {
    try {
      const rows = await db.query<Record<string, unknown>>('SELECT COUNT(*) AS n FROM migration_logs');
      const count = Number(field(rows[0] ?? {}, 'n') ?? 0);
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

  const completed = logs.filter((row) => String(field(row, 'status')) === 'completed');
  add('logs', logs.length >= expected, `found ${logs.length}`);
  add('success', completed.length === expected, `${completed.length} completed`);

  const tables = await db.query<Record<string, unknown>>(`
    SELECT table_name FROM user_tables WHERE table_name IN ('USERS', 'POSTS')
  `);
  const names = tables.map((row) => String(field(row, 'table_name')));
  add('tables', names.includes('USERS') && names.includes('POSTS'), names.join(','));

  const users = await db.query('SELECT email FROM users');
  add('users', users.length === expected, `${users.length} users`);

  const locks = await db.query<Record<string, unknown>>(`
    SELECT COUNT(*) AS n FROM v$lock WHERE type = 'UL'
  `);
  const held = Number(field(locks[0] ?? {}, 'n') ?? 0);
  add('lock released', held === 0, `${held} DBMS_LOCK rows`);

  await db.close();
  if (results.some((result) => !result.passed)) {
    console.log('Some Oracle e2e checks failed');
    process.exit(1);
  }
  console.log('All Oracle e2e tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
