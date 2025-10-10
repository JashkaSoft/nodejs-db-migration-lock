/**
 * Complete example using node-postgres (pg) with advisory locks
 */

import { Pool } from 'pg';
import { 
  MigrationCoordinator, 
  MigrationRunner,
  LockTimeoutError 
} from '@nodejs-db-migration-lock/core';
import { 
  NodePgDriver, 
  PostgresAdvisoryLock 
} from '@nodejs-db-migration-lock/postgres';

// Create PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'myapp',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Custom migration runner that executes SQL files or statements
class CustomMigrationRunner implements MigrationRunner {
  constructor(private pool: Pool) {}

  async run(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      console.log('📝 Executing migration 001: Create users table');
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
      console.log('📝 Executing migration 002: Create posts table');
      await client.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          content TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);
      
      console.log('📝 Executing migration 003: Add indexes');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      `);
      
      await client.query('COMMIT');
      console.log('✅ All migrations executed successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function runMigrations() {
  console.log('🔌 Connecting to PostgreSQL...');
  
  // Test connection
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Failed to connect to database:', error);
    process.exit(1);
  }

  // Create driver adapter
  const driver = new NodePgDriver(pool);

  // Use advisory lock (fast and automatically cleaned up)
  const lockProvider = new PostgresAdvisoryLock({
    lockId: 123456789,
  });

  // Create coordinator
  const coordinator = new MigrationCoordinator({
    driver,
    lockProvider,
    migrationRunner: new CustomMigrationRunner(pool),
    retryConfig: {
      maxRetries: 30,
      retryIntervalMs: 1000,
    },
    onLockWaiting: (attempt, maxRetries) => {
      console.log(`⏳ Waiting for migration lock... (${attempt}/${maxRetries})`);
    },
    onLockAcquired: () => {
      console.log('🔒 Lock acquired');
    },
    onLockReleased: () => {
      console.log('🔓 Lock released');
    },
  });

  try {
    await coordinator.migrate();
    console.log('🎉 Migration completed successfully!');
  } catch (error) {
    if (error instanceof LockTimeoutError) {
      console.error(`❌ Could not acquire lock after ${error.retries} retries`);
      console.error('   Another migration might be running. Please try again later.');
    } else {
      console.error('❌ Migration failed:', error);
    }
    process.exit(1);
  } finally {
    await pool.end();
    console.log('👋 Connection pool closed');
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n⚠️  Shutting down...');
  await pool.end();
  process.exit(0);
});

runMigrations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

