import { OracleDriver } from '../../src/driver';

describe('OracleDriver', () => {
  it('sends an OUT bind and reads it back as acquired', async () => {
    const connection = {
      closed: false,
      async execute(sql: string, binds: Record<string, unknown>) {
        expect(sql).toContain(':p3');
        expect(binds.p3).toMatchObject({ dir: 3003 });
        expect((binds.p3 as { type: { name: string } }).type.name).toBe('DB_TYPE_NUMBER');
        return { outBinds: { p3: 0 } };
      },
      async commit() { return undefined; },
      async rollback() { return undefined; },
      async close() { this.closed = true; },
    };
    const driver = new OracleDriver(connection);
    await expect(driver.query('BEGIN :p3 := 0; END;', [1, 0, { out: true }])).resolves.toEqual([{ acquired: 0 }]);
    await driver.close();
    expect(connection.closed).toBe(true);
  });
});
