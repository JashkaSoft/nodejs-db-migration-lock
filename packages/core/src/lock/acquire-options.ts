export interface AcquireOptions {
  signal?: AbortSignal;
  /** How long a database-side wait may block, in milliseconds. */
  timeoutMs?: number;
}

function isAbortSignal(value: AbortSignal | AcquireOptions): value is AbortSignal {
  return (
    typeof (value as AbortSignal).addEventListener === 'function' &&
    'aborted' in value
  );
}

export function normalizeAcquireOptions(
  options?: AbortSignal | AcquireOptions,
): AcquireOptions {
  if (!options) {
    return {};
  }

  if (isAbortSignal(options)) {
    return { signal: options };
  }

  return options;
}
