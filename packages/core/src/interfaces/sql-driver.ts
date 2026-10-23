export interface SqlDriver {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
