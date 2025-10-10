/**
 * Unit tests for error classes
 */

import {
  MigrationLockError,
  LockAcquisitionError,
  LockTimeoutError,
  MigrationExecutionError,
} from '../errors';

describe('Error Classes', () => {
  describe('MigrationLockError', () => {
    it('should create error with message', () => {
      const error = new MigrationLockError('Test error');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(MigrationLockError);
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('MigrationLockError');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with message and cause', () => {
      const cause = new Error('Original error');
      const error = new MigrationLockError('Wrapped error', cause);
      
      expect(error.message).toBe('Wrapped error');
      expect(error.cause).toBe(cause);
    });

    it('should maintain prototype chain', () => {
      const error = new MigrationLockError('Test');
      
      expect(error instanceof MigrationLockError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe('LockAcquisitionError', () => {
    it('should create error with message', () => {
      const error = new LockAcquisitionError('Failed to acquire');
      
      expect(error).toBeInstanceOf(MigrationLockError);
      expect(error).toBeInstanceOf(LockAcquisitionError);
      expect(error.message).toBe('Failed to acquire');
      expect(error.name).toBe('LockAcquisitionError');
    });

    it('should create error with cause', () => {
      const cause = new Error('DB connection failed');
      const error = new LockAcquisitionError('Failed to acquire', cause);
      
      expect(error.cause).toBe(cause);
    });
  });

  describe('LockTimeoutError', () => {
    it('should create error with timeout details', () => {
      const error = new LockTimeoutError(60000, 30);
      
      expect(error).toBeInstanceOf(MigrationLockError);
      expect(error).toBeInstanceOf(LockTimeoutError);
      expect(error.name).toBe('LockTimeoutError');
      expect(error.timeoutMs).toBe(60000);
      expect(error.retries).toBe(30);
      expect(error.message).toContain('30 retries');
      expect(error.message).toContain('60000ms');
    });

    it('should have descriptive message', () => {
      const error = new LockTimeoutError(120000, 60);
      
      expect(error.message).toBe(
        'Failed to acquire lock after 60 retries (120000ms timeout)'
      );
    });
  });

  describe('MigrationExecutionError', () => {
    it('should create error with message', () => {
      const error = new MigrationExecutionError('Migration failed');
      
      expect(error).toBeInstanceOf(MigrationLockError);
      expect(error).toBeInstanceOf(MigrationExecutionError);
      expect(error.message).toBe('Migration failed');
      expect(error.name).toBe('MigrationExecutionError');
    });

    it('should wrap migration errors', () => {
      const migrationError = new Error('SQL syntax error');
      const error = new MigrationExecutionError(
        'Failed to execute migrations',
        migrationError
      );
      
      expect(error.message).toBe('Failed to execute migrations');
      expect(error.cause).toBe(migrationError);
    });
  });

  describe('Error serialization', () => {
    it('should be JSON serializable', () => {
      const error = new LockTimeoutError(30000, 15);
      
      // Error objects need special handling for JSON serialization
      const errorObj = {
        name: error.name,
        message: error.message,
        timeoutMs: error.timeoutMs,
        retries: error.retries,
      };
      
      const json = JSON.stringify(errorObj);
      const parsed = JSON.parse(json);
      
      expect(parsed.message).toBeDefined();
      expect(parsed.name).toBe('LockTimeoutError');
      expect(parsed.timeoutMs).toBe(30000);
      expect(parsed.retries).toBe(15);
    });

    it('should preserve stack trace', () => {
      const error = new MigrationLockError('Test error');
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('MigrationLockError');
    });
  });
});

