import { describe, expect, it } from 'vitest';

import { resolvePolicy, resolveTimeout } from '../src/index.js';
import type { RetryOptions } from '../src/index.js';

describe('resolvePolicy', () => {
  it('merges objects left to right', () => {
    expect(
      resolvePolicy<RetryOptions>('attempts', { attempts: 3, delay: 10 }, { attempts: 5 }),
    ).toEqual({ attempts: 5, delay: 10 });
  });

  it('treats a number as the shorthand key', () => {
    expect(resolvePolicy<RetryOptions>('attempts', { delay: 1 }, 4)).toEqual({
      delay: 1,
      attempts: 4,
    });
  });

  it('resets on false and skips undefined', () => {
    expect(resolvePolicy<RetryOptions>('attempts', { attempts: 3 }, false)).toBeUndefined();
    expect(resolvePolicy<RetryOptions>('attempts', { attempts: 3 }, false, 2)).toEqual({
      attempts: 2,
    });
    expect(resolvePolicy<RetryOptions>('attempts', undefined, undefined)).toBeUndefined();
  });
});

describe('resolveTimeout', () => {
  it('takes the last defined value, false disables, non-positive disables', () => {
    expect(resolveTimeout(100, undefined, 50)).toBe(50);
    expect(resolveTimeout(100, false)).toBeUndefined();
    expect(resolveTimeout(100, false, 20)).toBe(20);
    expect(resolveTimeout(0)).toBeUndefined();
    expect(resolveTimeout()).toBeUndefined();
  });
});
