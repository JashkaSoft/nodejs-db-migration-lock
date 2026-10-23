export interface SqlDriver {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
  close?(): Promise<void>;
  /**
   * Open a second session for the table-lock heartbeat.
   * The caller closes it. The original session stays pinned for the lock.
   */
  fork?(): Promise<SqlDriver>;
}
