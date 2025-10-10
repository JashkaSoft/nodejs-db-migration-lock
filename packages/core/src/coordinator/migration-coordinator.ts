import { LockProvider } from '../interfaces/lock-provider';
import { MigrationRunner } from '../interfaces/migration-runner';
import { SqlDriver } from '../interfaces/sql-driver';
import { withRetry, RetryConfig } from '../retry';
import {
  LockAcquisitionError,
  LockTimeoutError,
  MigrationExecutionError,
} from '../errors';

export interface CoordinatorOptions {
  driver: SqlDriver;
  lockProvider: LockProvider;
  migrationRunner: MigrationRunner;
  retryConfig?: Partial<RetryConfig>;
  onLockWaiting?: (attempt: number, maxRetries: number) => void;
  onLockAcquired?: () => void;
  onLockReleased?: () => void;
  onMigrationStart?: () => void;
  onMigrationComplete?: () => void;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 60,
  retryIntervalMs: 2000,
  timeoutMs: 120000,
};

export class MigrationCoordinator {
  private readonly driver: SqlDriver;
  private readonly lockProvider: LockProvider;
  private readonly migrationRunner: MigrationRunner;
  private readonly retryConfig: RetryConfig;
  private readonly onLockWaiting?: (attempt: number, maxRetries: number) => void;
  private readonly onLockAcquired?: () => void;
  private readonly onLockReleased?: () => void;
  private readonly onMigrationStart?: () => void;
  private readonly onMigrationComplete?: () => void;

  constructor(options: CoordinatorOptions) {
    this.driver = options.driver;
    this.lockProvider = options.lockProvider;
    this.migrationRunner = options.migrationRunner;
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...options.retryConfig,
    };
    this.onLockWaiting = options.onLockWaiting;
    this.onLockAcquired = options.onLockAcquired;
    this.onLockReleased = options.onLockReleased;
    this.onMigrationStart = options.onMigrationStart;
    this.onMigrationComplete = options.onMigrationComplete;
  }

  async migrate(signal?: AbortSignal): Promise<void> {
    try {
      // Ensure infrastructure (tables, etc.) exists
      if (this.lockProvider.ensureInfrastructure) {
        await this.lockProvider.ensureInfrastructure(this.driver);
      }

      // Acquire lock with retry
      const lockAcquired = await this.acquireLockWithRetry(signal);

      if (!lockAcquired) {
        throw new LockTimeoutError(
          this.retryConfig.timeoutMs || 0,
          this.retryConfig.maxRetries,
        );
      }

      this.onLockAcquired?.();

      try {
        // Run migrations
        this.onMigrationStart?.();
        await this.migrationRunner.run();
        this.onMigrationComplete?.();
      } catch (error) {
        throw new MigrationExecutionError(
          'Failed to execute migrations',
          error,
        );
      } finally {
        // Always release the lock
        await this.releaseLock();
      }
    } catch (error) {
      if (error instanceof LockTimeoutError || error instanceof MigrationExecutionError) {
        throw error;
      }
      throw new LockAcquisitionError(
        'Failed to coordinate migration',
        error,
      );
    }
  }

  private async acquireLockWithRetry(signal?: AbortSignal): Promise<boolean> {
    return withRetry(
      () => this.lockProvider.acquire(this.driver, signal),
      (acquired) => !acquired, // Retry if lock was not acquired
      {
        ...this.retryConfig,
        signal,
        onRetry: this.onLockWaiting,
      },
    );
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.lockProvider.release(this.driver);
      this.onLockReleased?.();
    } catch (error) {
      // Log but don't throw - we don't want to hide migration errors
      console.error('Failed to release lock:', error);
    }
  }

  /**
   * Check if the lock provider and driver are healthy
   */
  async healthcheck(): Promise<boolean> {
    try {
      if (this.lockProvider.healthcheck) {
        return await this.lockProvider.healthcheck(this.driver);
      }
      // Default healthcheck: try a simple query
      await this.driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
