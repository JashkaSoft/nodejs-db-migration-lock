import { Pool } from 'pg';

const dbConfig = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'testuser',
  password: process.env.POSTGRES_PASSWORD || 'testpass',
  database: process.env.POSTGRES_DB || 'migration_test',
};

describe('PostgreSQL Migration Lock E2E Tests', () => {
  let pool: Pool;
  let logs: any[];
  let users: any[];

  beforeAll(async () => {
    pool = new Pool(dbConfig);
    
    // Give migrations time to complete
    console.log('⏳ Waiting for migrations to complete...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Fetch data once for all tests
    const logsResult = await pool.query(
      'SELECT * FROM migration_logs ORDER BY started_at',
    );
    logs = logsResult.rows;

    const usersResult = await pool.query(
      'SELECT * FROM users ORDER BY created_at',
    );
    users = usersResult.rows;
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('Migration Logs', () => {
    test('should create migration logs', () => {
      expect(logs.length).toBeGreaterThan(0);
      console.log(`Found ${logs.length} migration log(s)`);
    });

    test('should have all migrations complete successfully', () => {
      const completedLogs = logs.filter((log) => log.status === 'completed');
      const failedLogs = logs.filter((log) => log.status === 'failed');

      expect(completedLogs).toHaveLength(3);
      expect(failedLogs).toHaveLength(0);
    });

    test('should execute migrations sequentially (no time overlap)', () => {
      // Sort logs by started_at time
      const sortedLogs = [...logs].sort((a, b) => 
        new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      );

      // Check that each migration started after the previous one completed
      let hasOverlap = false;
      for (let i = 1; i < sortedLogs.length; i++) {
        const prevCompleted = new Date(sortedLogs[i - 1].completed_at).getTime();
        const currentStarted = new Date(sortedLogs[i].started_at).getTime();
        
        if (currentStarted < prevCompleted) {
          hasOverlap = true;
          console.log(`Overlap detected between process ${sortedLogs[i-1].process_id} and ${sortedLogs[i].process_id}`);
        }
      }

      expect(hasOverlap).toBe(false);
    });
  });

  describe('Database Schema', () => {
    test('should create users table', async () => {
      const tablesResult = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      `);

      expect(tablesResult.rows).toHaveLength(1);
    });

    test('should create posts table', async () => {
      const tablesResult = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'posts'
      `);

      expect(tablesResult.rows).toHaveLength(1);
    });

    test('should create users email index', async () => {
      const indexesResult = await pool.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND indexname = 'idx_users_email'
      `);

      expect(indexesResult.rows).toHaveLength(1);
    });

    test('should create posts user_id index', async () => {
      const indexesResult = await pool.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND indexname = 'idx_posts_user_id'
      `);

      expect(indexesResult.rows).toHaveLength(1);
    });
  });

  describe('Migration Execution', () => {
    test('should insert tracking records', () => {
      expect(users.length).toBeGreaterThan(0);
      console.log(`Found ${users.length} user record(s)`);
    });

    test('should have each process insert exactly one record', () => {
      const uniqueCreators = new Set(users.map((u) => u.created_by));
      
      expect(uniqueCreators.size).toBe(3);
      expect(users).toHaveLength(3);
    });

    test('should have correct email format for each process', () => {
      users.forEach((user) => {
        expect(user.email).toMatch(/^process-[123]@test\.com$/);
        expect(user.created_by).toMatch(/^[123]$/);
      });
    });
  });

  describe('Lock Cleanup', () => {
    test('should release lock after migration completes', async () => {
      try {
        const lockResult = await pool.query(
          'SELECT * FROM migration_lock WHERE id = 1',
        );
        
        // Lock should be released (no rows)
        expect(lockResult.rows).toHaveLength(0);
      } catch (error: any) {
        // Table might not exist if advisory lock was used
        if (error.code === '42P01') {
          // This is fine - advisory lock doesn't use a table
          expect(error.code).toBe('42P01');
        } else {
          throw error;
        }
      }
    });
  });

  describe('Error Handling', () => {
    test('failed processes should log lock timeout errors', () => {
      const failedLogs = logs.filter((log) => log.status === 'failed');
      
      if (failedLogs.length > 0) {
        const timeoutErrors = failedLogs.filter(
          (log) =>
            log.error_message &&
            (log.error_message.includes('timeout') ||
              log.error_message.includes('Failed to acquire lock')),
        );

        expect(timeoutErrors.length).toBe(failedLogs.length);
      } else {
        // All migrations succeeded - this is fine
        expect(failedLogs).toHaveLength(0);
      }
    });
  });
});

