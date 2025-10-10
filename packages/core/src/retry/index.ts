/**
 * Retry utilities for lock acquisition
 */

export interface RetryConfig {
  maxRetries: number;
  retryIntervalMs: number;
  timeoutMs?: number;
}

export interface RetryOptions extends RetryConfig {
  signal?: AbortSignal;
  onRetry?: (attempt: number, maxRetries: number) => void;
}

/**
 * Execute an async function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  shouldRetry: (result: T) => boolean,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, retryIntervalMs, signal, onRetry } = options;
  
  let attempt = 0;
  
  while (attempt < maxRetries) {
    // Check if operation was aborted
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }
    
    const result = await fn();
    
    if (!shouldRetry(result)) {
      return result;
    }
    
    attempt++;
    
    if (attempt < maxRetries) {
      onRetry?.(attempt, maxRetries);
      await sleep(retryIntervalMs, signal);
    }
  }
  
  // Return last attempt result even if it didn't succeed
  return await fn();
}

/**
 * Sleep for specified milliseconds, can be interrupted by AbortSignal
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Sleep aborted'));
      return;
    }
    
    const timeout = setTimeout(resolve, ms);
    
    const abortHandler = () => {
      clearTimeout(timeout);
      reject(new Error('Sleep aborted'));
    };
    
    signal?.addEventListener('abort', abortHandler, { once: true });
  });
}

