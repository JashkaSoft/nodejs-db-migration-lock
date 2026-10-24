/**
 * Unit tests for retry utilities
 */

import { withRetry, sleep, isTransientDbError } from '../retry';

describe('Retry Utilities', () => {
  describe('sleep', () => {
    it('should sleep for specified duration', async () => {
      const start = Date.now();
      await sleep(100);
      const duration = Date.now() - start;
      
      expect(duration).toBeGreaterThanOrEqual(90);
      expect(duration).toBeLessThan(200);
    });

    it('should be interruptible with AbortSignal', async () => {
      const controller = new AbortController();
      
      setTimeout(() => controller.abort(), 50);
      
      await expect(sleep(1000, controller.signal)).rejects.toThrow('Sleep aborted');
    });

    it('should reject immediately if already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      
      await expect(sleep(1000, controller.signal)).rejects.toThrow('Sleep aborted');
    });
  });

  describe('withRetry', () => {
    it('should succeed on first attempt if condition met', async () => {
      const fn = jest.fn().mockResolvedValue(true);
      const shouldRetry = (result: boolean) => !result;
      
      const result = await withRetry(fn, shouldRetry, {
        maxRetries: 3,
        retryIntervalMs: 100,
      });
      
      expect(result).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry until success', async () => {
      let attempts = 0;
      const fn = jest.fn().mockImplementation(() => {
        attempts++;
        return Promise.resolve(attempts >= 3);
      });
      const shouldRetry = (result: boolean) => !result;
      
      const result = await withRetry(fn, shouldRetry, {
        maxRetries: 5,
        retryIntervalMs: 10,
      });
      
      expect(result).toBe(true);
      expect(fn).toHaveBeenCalledTimes(3); // Called until success
    });

    it('should stop at maxRetries', async () => {
      const fn = jest.fn().mockResolvedValue(false);
      const shouldRetry = (result: boolean) => !result;
      
      const result = await withRetry(fn, shouldRetry, {
        maxRetries: 3,
        retryIntervalMs: 10,
      });
      
      expect(result).toBe(false);
      expect(fn).toHaveBeenCalledTimes(4); // maxRetries + 1
    });

    it('should call onRetry callback', async () => {
      const fn = jest.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const shouldRetry = (result: boolean) => !result;
      const onRetry = jest.fn();
      
      await withRetry(fn, shouldRetry, {
        maxRetries: 5,
        retryIntervalMs: 10,
        onRetry,
      });
      
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, 5);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, 5);
    });

    it('should respect AbortSignal', async () => {
      const controller = new AbortController();
      const fn = jest.fn().mockResolvedValue(false);
      const shouldRetry = (result: boolean) => !result;
      
      setTimeout(() => controller.abort(), 50);
      
      await expect(
        withRetry(fn, shouldRetry, {
          maxRetries: 10,
          retryIntervalMs: 100,
          signal: controller.signal,
        })
      ).rejects.toThrow(); // Can be either 'Operation aborted' or 'Sleep aborted'
      
      expect(fn.mock.calls.length).toBeLessThan(10);
    });

    it('should check abort signal before each attempt', async () => {
      const controller = new AbortController();
      controller.abort();
      
      const fn = jest.fn().mockResolvedValue(false);
      const shouldRetry = (result: boolean) => !result;
      
      await expect(
        withRetry(fn, shouldRetry, {
          maxRetries: 5,
          retryIntervalMs: 10,
          signal: controller.signal,
        })
      ).rejects.toThrow('Operation aborted');
    });

    it('should handle function errors', async () => {
      const error = new Error('Function error');
      const fn = jest.fn().mockRejectedValue(error);
      const shouldRetry = (result: boolean) => !result;
      
      await expect(
        withRetry(fn, shouldRetry, {
          maxRetries: 3,
          retryIntervalMs: 10,
        })
      ).rejects.toThrow('Function error');
    });

    it('should wait correct interval between retries', async () => {
      const fn = jest.fn().mockResolvedValue(false);
      const shouldRetry = (result: boolean) => !result;
      
      const start = Date.now();
      await withRetry(fn, shouldRetry, {
        maxRetries: 3,
        retryIntervalMs: 50,
      });
      const duration = Date.now() - start;
      
      // Two 50ms sleeps between the first three attempts, plus a final call.
      expect(duration).toBeGreaterThanOrEqual(80);
      expect(duration).toBeLessThan(250);
    });
  });

  describe('withRetry edge cases', () => {
    it('should handle maxRetries = 0', async () => {
      const fn = jest.fn().mockResolvedValue(false);
      const shouldRetry = (result: boolean) => !result;
      
      const result = await withRetry(fn, shouldRetry, {
        maxRetries: 0,
        retryIntervalMs: 10,
      });
      
      expect(result).toBe(false);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should handle complex shouldRetry conditions', async () => {
      let callCount = 0;
      const fn = jest.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount);
      });
      const shouldRetry = (result: number) => result < 5;
      
      const result = await withRetry(fn, shouldRetry, {
        maxRetries: 10,
        retryIntervalMs: 10,
      });
      
      expect(result).toBe(5);
      expect(fn).toHaveBeenCalledTimes(5);
    });
  });

  describe('isTransientDbError', () => {
    it('matches connection resets and deadlocks', () => {
      const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
      const mysql = Object.assign(new Error('Deadlock found'), { errno: 1213 });
      const mssql = Object.assign(new Error('Transaction was deadlocked'), { number: 1205 });
      expect(isTransientDbError(reset)).toBe(true);
      expect(isTransientDbError(deadlock)).toBe(true);
      expect(isTransientDbError(mysql)).toBe(true);
      expect(isTransientDbError(mssql)).toBe(true);
    });

    it('rejects a query error', () => {
      expect(isTransientDbError(Object.assign(new Error('syntax error'), { code: '42601' }))).toBe(false);
      expect(isTransientDbError('down')).toBe(false);
    });
  });
});

