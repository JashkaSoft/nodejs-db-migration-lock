import { Pool } from 'pg';

const dbConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'testuser',
  password: process.env.POSTGRES_PASSWORD || 'testpass',
  database: process.env.POSTGRES_DB || 'migration_test',
};

interface VerificationResult {
  test: string;
  passed: boolean;
  message: string;
  details?: any;
}

const results: VerificationResult[] = [];

function addResult(test: string, passed: boolean, message: string, details?: any) {
  results.push({ test, passed, message, details });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${test}: ${message}`);
  if (details) {
    console.log('   Details:', JSON.stringify(details, null, 2));
  }
}

async function verify(): Promise<void> {
  console.log('🔍 Starting E2E test verification...\n');

  const pool = new Pool(dbConfig);

  try {

    // Test 1: Check migration logs exist
    console.log('Test 1: Checking migration logs...');
    const logsResult = await pool.query(
      'SELECT * FROM migration_logs ORDER BY started_at',
    );
    const logs = logsResult.rows;

    addResult(
      'Migration Logs Created',
      logs.length > 0,
      `Found ${logs.length} migration log(s)`,
      logs,
    );

    // Test 2: Check that all processes completed successfully (sequentially)
    console.log('\nTest 2: Checking successful migrations...');
    const completedLogs = logs.filter((log) => log.status === 'completed');
    const failedLogs = logs.filter((log) => log.status === 'failed');

    addResult(
      'All Migrations Succeeded',
      completedLogs.length === 3 && failedLogs.length === 0,
      `Expected 3 successful migrations (sequential), got ${completedLogs.length} completed and ${failedLogs.length} failed`,
      { completed: completedLogs.length, failed: failedLogs.length },
    );

    // Test 3: Check that tables were created
    console.log('\nTest 3: Checking tables were created...');
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'posts')
      ORDER BY table_name
    `);
    const tables = tablesResult.rows.map((r) => r.table_name);

    addResult(
      'Tables Created',
      tables.includes('users') && tables.includes('posts'),
      `Tables: ${tables.join(', ')}`,
      tables,
    );

    // Test 4: Check that indexes were created
    console.log('\nTest 4: Checking indexes were created...');
    const indexesResult = await pool.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename IN ('users', 'posts')
      ORDER BY indexname
    `);
    const indexes = indexesResult.rows.map((r) => r.indexname);

    addResult(
      'Indexes Created',
      indexes.includes('idx_posts_user_id') && indexes.includes('idx_users_email'),
      `Indexes: ${indexes.join(', ')}`,
      indexes,
    );

    // Test 5: Check that tracking record was inserted
    console.log('\nTest 5: Checking tracking records...');
    const usersResult = await pool.query(
      'SELECT * FROM users ORDER BY created_at',
    );
    const users = usersResult.rows;

    addResult(
      'Tracking Records Inserted',
      users.length > 0,
      `Found ${users.length} user record(s)`,
      users.map((u) => ({ email: u.email, created_by: u.created_by })),
    );

    // Test 6: Verify all processes ran migrations sequentially (each inserted its own record)
    console.log('\nTest 6: Checking sequential execution...');
    const uniqueCreators = new Set(users.map((u) => u.created_by));

    addResult(
      'All Processes Executed Sequentially',
      uniqueCreators.size === 3 && users.length === 3,
      `Expected 3 processes to each create 1 record sequentially, got ${uniqueCreators.size} processes creating ${users.length} records`,
      Array.from(uniqueCreators),
    );

    // Test 7: Check that lock table was cleaned up (table lock strategy)
    console.log('\nTest 7: Checking lock cleanup...');
    try {
      const lockResult = await pool.query(
        'SELECT * FROM migration_lock WHERE id = 1',
      );
      const lockRows = lockResult.rows;

      addResult(
        'Lock Released',
        lockRows.length === 0,
        lockRows.length === 0
          ? 'Lock table is empty (lock released)'
          : `Lock table has ${lockRows.length} row(s)`,
        lockRows,
      );
    } catch (error) {
      // Table might not exist if advisory lock was used
      if ((error as any).code === '42P01') {
        addResult(
          'Lock Released',
          true,
          'Lock table does not exist (advisory lock used)',
        );
      } else {
        throw error;
      }
    }

    // Test 8: Check that failed processes got lock timeout errors
    console.log('\nTest 8: Checking failed process error messages...');
    const timeoutErrors = failedLogs.filter(
      (log) =>
        log.error_message &&
        (log.error_message.includes('timeout') ||
          log.error_message.includes('Failed to acquire lock')),
    );

    addResult(
      'Failed Processes Got Lock Errors',
      failedLogs.length === 0 || timeoutErrors.length === failedLogs.length,
      `${timeoutErrors.length} of ${failedLogs.length} failed process(es) got lock errors`,
      failedLogs.map((l) => ({
        process_id: l.process_id,
        error: l.error_message,
      })),
    );

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Verification Summary');
    console.log('='.repeat(60));

    const passed = results.filter((r) => r.passed).length;
    const total = results.length;

    console.log(`\nTests Passed: ${passed}/${total}`);

    results.forEach((result) => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.test}`);
    });

    const exitCode = passed === total ? 0 : 1;
    
    if (passed === total) {
      console.log('\n🎉 All E2E tests passed!\n');
    } else {
      console.log('\n❌ Some E2E tests failed!\n');
    }

    // Attempt to close pool but don't wait - just exit
    pool.end().catch(err => {
      console.error('Error closing pool:', err);
    });

    // Give pool a moment to close, then force exit
    setTimeout(() => {
      console.log('👋 Exiting...');
      process.exit(exitCode);
    }, 500);
  } catch (error) {
    console.error('\n❌ Verification failed with error:', error);
    
    // Attempt to close pool but don't wait
    pool.end().catch(err => {
      console.error('Error closing pool on error:', err);
    });
    
    // Give pool a moment to close, then force exit
    setTimeout(() => {
      console.log('👋 Exiting with error...');
      process.exit(1);
    }, 500);
  }
}

// Run verification
verify().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

