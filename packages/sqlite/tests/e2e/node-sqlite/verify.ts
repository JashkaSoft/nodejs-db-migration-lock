import { DatabaseSync } from 'node:sqlite';

const SQLITE_PATH = process.env.SQLITE_PATH || '/data/migration_test.db';
const results: Array<{ test: string; passed: boolean; message: string }> = [];

function add(test: string, passed: boolean, message: string): void {
  results.push({ test, passed, message });
  console.log(`${passed ? 'OK' : 'FAIL'} ${test}: ${message}`);
}

async function main(): Promise<void> {
  const expected = parseInt(process.env.EXPECTED_PROCESSES || '3', 10);
  const started = Date.now();
  let db: DatabaseSync | undefined;

  while (Date.now() - started < 120000) {
    try {
      db = new DatabaseSync(SQLITE_PATH, { timeout: 5000, readOnly: true });
      const row = db.prepare('SELECT COUNT(*) AS n FROM migration_logs').get() as
        | { n?: number }
        | undefined;
      const count = Number(row?.n ?? 0);
      console.log(`Waiting for logs ${count}/${expected}`);
      if (count >= expected) {
        break;
      }
      db.close();
      db = undefined;
    } catch {
      console.log('Waiting for migration_logs...');
      try {
        db?.close();
      } catch {}
      db = undefined;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!db) {
    db = new DatabaseSync(SQLITE_PATH, { timeout: 5000, readOnly: true });
  }

  const logs = db.prepare('SELECT * FROM migration_logs ORDER BY started_at').all() as Array<{
    status: string;
  }>;
  const completed = logs.filter((l) => l.status === 'completed');
  add('logs', logs.length >= expected, `found ${logs.length}`);
  add('success', completed.length === expected, `${completed.length} completed`);

  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'posts')`,
    )
    .all() as Array<{ name: string }>;
  const names = tables.map((t) => t.name);
  add('tables', names.includes('users') && names.includes('posts'), names.join(','));

  const users = db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown[];
  add('users', users.length === expected, `${users.length} users`);

  const steps = db
    .prepare('SELECT process_id, step FROM migration_steps ORDER BY id')
    .all() as Array<{ process_id: string; step: number }>;
  const stepCount = expected * 25;
  add('steps', steps.length === stepCount, `${steps.length} of ${stepCount}`);
  let runs = steps.length === 0 ? 0 : 1;
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index].process_id !== steps[index - 1].process_id) {
      runs += 1;
    }
  }
  add('no interleave', runs === expected, `${runs} contiguous runs`);

  const locks = db.prepare('SELECT * FROM migration_lock WHERE id = 1').all() as unknown[];
  add('lock released', locks.length === 0, `${locks.length} lock rows`);

  db.close();
  const failed = results.filter((r) => !r.passed);
  if (failed.length) {
    console.log('Some SQLite e2e checks failed');
    process.exit(1);
  }
  console.log('All SQLite e2e tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
