export interface AcquireOptions {
  signal?: AbortSignal;
  /** How long a database-side wait may block, in milliseconds. */
  timeoutMs?: number;
}

export function normalizeAcquireOptions(
  options?: AbortSignal | AcquireOptions,
): AcquireOptions {
  if (!options) {
    return {};
  }

  if (
    typeof (options as AbortSignal).addEventListener === 'function' &&
    'aborted' in options
  ) {
    return { signal: options as AbortSignal };
  }

  return options as AcquireOptions;
}
