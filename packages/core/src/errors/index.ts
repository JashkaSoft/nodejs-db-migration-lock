/**
 * Custom error types for migration lock operations
 */

export class MigrationLockError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'MigrationLockError';
    Object.setPrototypeOf(this, MigrationLockError.prototype);
  }
}

export class LockAcquisitionError extends MigrationLockError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'LockAcquisitionError';
    Object.setPrototypeOf(this, LockAcquisitionError.prototype);
  }
}

export class LockTimeoutError extends MigrationLockError {
  constructor(
    public readonly timeoutMs: number,
    public readonly retries: number,
  ) {
    super(
      `Failed to acquire lock after ${retries} retries (${timeoutMs}ms timeout)`,
    );
    this.name = 'LockTimeoutError';
    Object.setPrototypeOf(this, LockTimeoutError.prototype);
  }
}

export class MigrationExecutionError extends MigrationLockError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'MigrationExecutionError';
    Object.setPrototypeOf(this, MigrationExecutionError.prototype);
  }
}

