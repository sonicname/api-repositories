import { describe, expect, it } from 'vitest';

import { clamp, greet, sum } from '../src/index.js';

describe('greet', () => {
  it('uses defaults', () => {
    expect(greet('World')).toBe('Hello, World!');
  });

  it('accepts options', () => {
    expect(greet('World', { greeting: 'Hi', excited: false })).toBe('Hi, World');
  });
});

describe('sum', () => {
  it('returns 0 for an empty list', () => {
    expect(sum([])).toBe(0);
  });

  it('adds numbers', () => {
    expect(sum([1, 2, 3.5])).toBe(6.5);
  });
});

describe('clamp', () => {
  it('clamps within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('throws when min > max', () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError);
  });
});
