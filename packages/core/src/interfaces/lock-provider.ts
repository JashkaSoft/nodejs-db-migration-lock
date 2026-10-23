import { AcquireOptions } from '../lock/acquire-options';
import { SqlDriver } from './sql-driver';

export interface LockStatus {
  lockId: string;
  holder: string | null;
  lockedAt: number | null;
  expiresAt: number | null;
}

export interface LockProvider {
  name: string;
  /**
   * In-process mutex key. Coordinators that share a key never run migrate() together.
   * Defaults to `name`.
   */
  lockKey?: string;
  /**
   * When true, `acquire` blocks inside the database for `timeoutMs` and the
   * coordinator calls it once instead of polling.
   */
  waitsInDatabase?: boolean;
  /**
   * When true, the coordinator holds `SqlDriver.transaction` across acquire and
   * the migration. The provider must take a transaction-scoped lock and must
   * not release it itself. Session locks stay the default.
   */
  transactionScoped?: boolean;
  ensureInfrastructure?(driver: SqlDriver): Promise<void>;
  acquire(driver: SqlDriver, options?: AbortSignal | AcquireOptions): Promise<boolean>;
  release(driver: SqlDriver): Promise<void>;
  /** Extend a table-lock lease. Return false when this holder no longer owns the row. */
  renew?(driver: SqlDriver): Promise<boolean>;
  status?(driver: SqlDriver): Promise<LockStatus | null>;
  /** Delete the lock row even if another holder owns it. */
  forceRelease?(driver: SqlDriver): Promise<void>;
  healthcheck?(driver: SqlDriver): Promise<boolean>;
}
