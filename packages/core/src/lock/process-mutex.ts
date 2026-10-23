const tails = new Map<string, Promise<void>>();

/**
 * Run `fn` only after earlier callers with the same key in this process have finished.
 * Stops two startup paths from pinning two pool connections at once.
 */
export function withProcessLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => gate);
  tails.set(key, next);

  return previous.then(fn).finally(() => {
    release();
    if (tails.get(key) === next) {
      tails.delete(key);
    }
  });
}
