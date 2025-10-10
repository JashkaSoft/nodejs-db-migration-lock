export interface MigrationRunner {
  run(): Promise<void>;
}
