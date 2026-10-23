/**
 * Stable salt for migration lock keys. Do not change it: a new salt would
 * hide locks taken by an older version of this library.
 * 31-bit so salt × CRC32 still fits in a signed 64-bit integer.
 */
export const MIGRATION_LOCK_SALT = 1_234_567_890;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC_TABLE[index] = crc >>> 0;
}

/** IEEE CRC-32. Exported so lock keys stay identical across dialects. */
export function crc32(value: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(value)) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Postgres advisory-lock key for one database.
 * Returned as a decimal string so it can exceed Number.MAX_SAFE_INTEGER.
 */
export function postgresAdvisoryKey(databaseName: string): string {
  const key = BigInt(MIGRATION_LOCK_SALT) * BigInt(crc32(databaseName));
  return key.toString();
}

/**
 * Named lock string scoped by database name.
 * MySQL GET_LOCK names are server-wide and limited to 64 bytes.
 * SQL Server application lock resources allow 255 characters.
 */
export function scopedLockName(
  databaseName: string,
  prefix = 'nodejs_db_migration_lock',
  maxBytes = 64,
): string {
  const raw = `${prefix}:${databaseName}`;
  if (Buffer.byteLength(raw) <= maxBytes) {
    return raw;
  }
  const hashed = `${prefix}:${crc32(databaseName).toString(16)}`;
  return hashed.length <= maxBytes ? hashed : hashed.slice(0, maxBytes);
}
