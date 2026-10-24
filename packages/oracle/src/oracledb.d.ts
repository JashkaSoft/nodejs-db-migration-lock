declare module 'oracledb' {
  export const BIND_OUT: number;
  export const OUT_FORMAT_OBJECT: number;
  export const NUMBER: { name: string };
  export function getConnection(config: {
    user: string;
    password: string;
    connectString: string;
  }): Promise<{
    execute(
      sql: string,
      binds?: Record<string, unknown>,
      options?: { outFormat?: number; autoCommit?: boolean },
    ): Promise<{ rows?: unknown[]; outBinds?: Record<string, unknown> }>;
    commit(): Promise<void>;
    rollback(): Promise<void>;
    close(): Promise<void>;
  }>;
}
