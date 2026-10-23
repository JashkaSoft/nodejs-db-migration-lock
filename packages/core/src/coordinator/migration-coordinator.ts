import { LockProvider } from '../interfaces/lock-provider';
import { MigrationRunner } from '../interfaces/migration-runner';
import { SqlDriver } from '../interfaces/sql-driver';
import { AcquireOptions } from '../lock/acquire-options';
import { withProcessLock } from '../lock/process-mutex';
import { withRetry, RetryConfig } from '../retry';
import {
  LockAcquisitionError,
  LockLeaseLostError,
  LockTimeoutError,
  MigrationExecutionError,
} from '../errors';

export interface CoordinatorOptions {
  driver: SqlDriver;
  lockProvider: LockProvider;
  migrationRunner: MigrationRunner;
  retryConfig?: Partial<RetryConfig>;
  /** How often to extend a table-lock lease while migrations run. */
  renewIntervalMs?: number;
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

const DEFAULT_RENEW_INTERVAL_MS = 10_000;

export class MigrationCoordinator {
  private readonly driver: SqlDriver;
  private readonly lockProvider: LockProvider;
  private readonly migrationRunner: MigrationRunner;
  private readonly retryConfig: RetryConfig;
  private readonly renewIntervalMs: number;
  private readonly onLockWaiting?: (attempt: number, maxRetries: number) => void;
  private readonly onLockAcquired?: () => void;
  private readonly onLockReleased?: () => void;
  private readonly onMigrationStart?: () => void;
  private readonly onMigrationComplete?: () => void;
  private leaseLost = false;
  private lockHeld = false;

  constructor(options: CoordinatorOptions) {
    this.driver = options.driver;
    this.lockProvider = options.lockProvider;
    this.migrationRunner = options.migrationRunner;
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...options.retryConfig,
    };
    this.renewIntervalMs = options.renewIntervalMs ?? DEFAULT_RENEW_INTERVAL_MS;
    this.onLockWaiting = options.onLockWaiting;
    this.onLockAcquired = options.onLockAcquired;
    this.onLockReleased = options.onLockReleased;
    this.onMigrationStart = options.onMigrationStart;
    this.onMigrationComplete = options.onMigrationComplete;
  }

  async migrate(signal?: AbortSignal): Promise<void> {
    const key = this.lockProvider.lockKey ?? this.lockProvider.name;
    return withProcessLock(key, () => this.migrateBody(signal));
  }

  private async migrateBody(signal?: AbortSignal): Promise<void> {
    this.leaseLost = false;
    this.lockHeld = false;

    try {
      if (this.lockProvider.transactionScoped) {
        if (!this.driver.transaction) {
          throw new LockAcquisitionError(
            'Transaction-scoped locks require SqlDriver.transaction',
          );
        }
        try {
          await this.driver.transaction(() => this.executeLocked(signal));
        } finally {
          if (this.lockHeld) {
            this.onLockReleased?.();
          }
        }
        return;
      }

      await this.executeLocked(signal);
    } catch (error) {
      if (
        error instanceof LockTimeoutError ||
        error instanceof MigrationExecutionError ||
        error instanceof LockLeaseLostError
      ) {
        throw error;
      }
      throw new LockAcquisitionError(
        'Failed to coordinate migration',
        error,
      );
    }
  }

  private async executeLocked(signal?: AbortSignal): Promise<void> {
    if (this.lockProvider.ensureInfrastructure) {
      await this.lockProvider.ensureInfrastructure(this.driver);
    }

    const lockAcquired = await this.acquireLock(signal);
    if (!lockAcquired) {
      throw new LockTimeoutError(
        this.retryConfig.timeoutMs || 0,
        this.lockProvider.waitsInDatabase ? 1 : this.retryConfig.maxRetries,
      );
    }

    this.lockHeld = true;
    this.onLockAcquired?.();
    let heartbeat: SqlDriver = this.driver;
    let stopRenewal: () => Promise<void> = async () => undefined;

    try {
      heartbeat = await this.openHeartbeat();
      stopRenewal = this.startRenewal(heartbeat);
      try {
        this.onMigrationStart?.();
        await this.migrationRunner.run();
        if (this.leaseLost) {
          throw new LockLeaseLostError();
        }
        this.onMigrationComplete?.();
      } catch (error) {
        if (error instanceof LockLeaseLostError) {
          throw error;
        }
        throw new MigrationExecutionError(
          'Failed to execute migrations',
          error,
        );
      }
    } finally {
      await stopRenewal();
      if (heartbeat !== this.driver) {
        try {
          await heartbeat.close?.();
        } catch (error) {
          console.error('Failed to close lease connection:', error);
        }
      }
      if (!this.lockProvider.transactionScoped) {
        await this.releaseLock();
      }
    }
  }

  /**
   * Table-lock renewal has to use another session. The lock connection can be
   * busy with a long migration statement, and that statement would otherwise
   * block the heartbeat until the lease expires.
   * A transaction-scoped lock row is invisible to other sessions until commit.
   */
  private async openHeartbeat(): Promise<SqlDriver> {
    if (!this.lockProvider.renew || this.lockProvider.transactionScoped || !this.driver.fork) {
      return this.driver;
    }
    return this.driver.fork();
  }

  private async acquireLock(signal?: AbortSignal): Promise<boolean> {
    const options: AcquireOptions = {
      signal,
      timeoutMs: this.retryConfig.timeoutMs,
    };

    if (this.lockProvider.waitsInDatabase) {
      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }
      this.onLockWaiting?.(1, 1);
      return this.lockProvider.acquire(this.driver, options);
    }

    return withRetry(
      () => this.lockProvider.acquire(this.driver, options),
      (acquired) => !acquired,
      {
        ...this.retryConfig,
        signal,
        onRetry: this.onLockWaiting,
      },
    );
  }

  private startRenewal(driver: SqlDriver): () => Promise<void> {
    if (!this.lockProvider.renew) {
      return async () => undefined;
    }

    let tail = Promise.resolve();
    const timer = setInterval(() => {
      tail = tail.then(() => this.beat(driver));
    }, this.renewIntervalMs);
    timer.unref?.();
    return async () => {
      clearInterval(timer);
      await tail;
    };
  }

  private async beat(driver: SqlDriver): Promise<void> {
    try {
      const renewed = await this.lockProvider.renew!(driver);
      if (!renewed) {
        this.leaseLost = true;
      }
    } catch {
      this.leaseLost = true;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.lockProvider.release(this.driver);
      this.onLockReleased?.();
    } catch (error) {
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
      await this.driver.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
