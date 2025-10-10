import { SqlDriver } from "./sql-driver";

export interface LockProvider {
  name: string;
  ensureInfrastructure?(driver: SqlDriver): Promise<void>;
  acquire(driver: SqlDriver, signal?: AbortSignal): Promise<boolean>;
  release(driver: SqlDriver): Promise<void>;
  healthcheck?(driver: SqlDriver): Promise<boolean>;
}
