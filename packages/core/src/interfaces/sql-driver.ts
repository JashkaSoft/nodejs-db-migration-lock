export interface SqlDriver {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  transaction?<T>(fn: () => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}
