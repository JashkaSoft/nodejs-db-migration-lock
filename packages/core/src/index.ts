/**
 * Core functionality for database migration locking
 */

// Export interfaces
export { LockProvider, LockStatus, MigrationRunner, SqlDriver } from './interfaces';

export { AcquireOptions, normalizeAcquireOptions } from './lock/acquire-options';
export { lockHolder, quoteIdent } from './lock/holder';
export {
  MIGRATION_LOCK_SALT,
  crc32,
  postgresAdvisoryKey,
  scopedLockName,
} from './lock/lock-key';
export { withProcessLock } from './lock/process-mutex';

// Export coordinator
export {
  MigrationCoordinator,
  CoordinatorOptions,
} from './coordinator/migration-coordinator';

// Export errors
export {
  MigrationLockError,
  LockAcquisitionError,
  LockTimeoutError,
  MigrationExecutionError,
  LockLeaseLostError,
} from './errors';

// Export retry utilities
export { RetryConfig, RetryOptions, withRetry, sleep } from './retry';
