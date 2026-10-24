const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '40001',
  '40P01',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  'PROTOCOL_CONNECTION_LOST',
]);

const TRANSIENT_ERRNO = new Set([
  1205, // MySQL lock wait timeout, SQL Server deadlock
  1213, // MySQL deadlock
  2006, // MySQL server gone
  2013, // MySQL lost connection
]);

const TRANSIENT_MESSAGE =
  /deadlock|connection terminated|connection reset|server closed the connection|broken pipe|too many connections|connection lost|socket hang up|ECONNRESET|cannot connect/i;

function readCode(error: object): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readErrno(error: object): number | undefined {
  const errno = (error as { errno?: unknown }).errno;
  if (typeof errno === 'number') {
    return errno;
  }
  const number = (error as { number?: unknown }).number;
  return typeof number === 'number' ? number : undefined;
}

/** Connection drops and deadlocks can be retried. A wrong query cannot. */
export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = readCode(error);
  if (code && TRANSIENT_CODES.has(code)) {
    return true;
  }
  const errno = readErrno(error);
  if (errno !== undefined && TRANSIENT_ERRNO.has(errno)) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return TRANSIENT_MESSAGE.test(message);
}
