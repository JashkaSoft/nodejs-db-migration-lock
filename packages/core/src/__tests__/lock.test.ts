import { normalizeAcquireOptions } from '../lock/acquire-options';
import { lockHolder, quoteIdent } from '../lock/holder';
import { crc32, postgresAdvisoryKey, scopedLockName } from '../lock/lock-key';
import { withProcessLock } from '../lock/process-mutex';

describe('lock keys', () => {
  it('matches the CRC-32 of 123456789', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
  });

  it('builds a stable postgres advisory key', () => {
    expect(postgresAdvisoryKey('appdb')).toBe(postgresAdvisoryKey('appdb'));
    expect(postgresAdvisoryKey('appdb')).not.toBe(postgresAdvisoryKey('other'));
  });

  it('keeps a short scoped name and hashes a long one', () => {
    expect(scopedLockName('app', 'migration', 64)).toBe('migration:app');
    const longName = scopedLockName('x'.repeat(80), 'migration', 64);
    expect(Buffer.byteLength(longName)).toBeLessThanOrEqual(64);
    expect(longName.startsWith('migration:')).toBe(true);
    expect(scopedLockName('appdb', 'migration', 8).length).toBeLessThanOrEqual(8);
  });
});

describe('lock holder', () => {
  it('includes the pid and a unique suffix', () => {
    const first = lockHolder();
    const second = lockHolder();
    expect(first).toContain(String(process.pid));
    expect(first).not.toBe(second);
  });

  it('quotes safe identifiers and rejects the rest', () => {
    expect(quoteIdent('migration_lock', '"')).toBe('"migration_lock"');
    expect(quoteIdent('migration_lock', '`')).toBe('`migration_lock`');
    expect(quoteIdent('migration_lock', '[')).toBe('[migration_lock]');
    expect(() => quoteIdent('lock;drop', '"')).toThrow('Invalid SQL identifier');
  });
});

describe('acquire options', () => {
  it('accepts an AbortSignal or an options object', () => {
    const controller = new AbortController();
    expect(normalizeAcquireOptions(controller.signal).signal).toBe(controller.signal);
    expect(normalizeAcquireOptions({ timeoutMs: 5 })).toEqual({ timeoutMs: 5 });
    expect(normalizeAcquireOptions()).toEqual({});
  });
});

describe('process mutex', () => {
  it('does not let a rejection block the next caller', async () => {
    const key = `mutex-${Date.now()}`;
    await expect(withProcessLock(key, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    await expect(withProcessLock(key, async () => 'ok')).resolves.toBe('ok');
  });
});
