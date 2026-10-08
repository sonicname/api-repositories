import { describe, expect, it } from 'vitest';

import { buildQueryString, buildUrl, interpolatePath, joinUrl } from '../src/index.js';

describe('interpolatePath', () => {
  it('replaces and encodes params', () => {
    expect(interpolatePath('/repos/:owner/:repo', { owner: 'a/b', repo: 1 })).toBe(
      '/repos/a%2Fb/1',
    );
  });

  it('leaves paths without params untouched', () => {
    expect(interpolatePath('/ping', undefined)).toBe('/ping');
  });

  it('throws on a missing param', () => {
    expect(() => interpolatePath('/users/:id', {})).toThrow(/Missing value for path param ":id"/);
  });
});

describe('buildQueryString', () => {
  it('handles primitives, arrays, dates and nested objects', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(
      buildQueryString({ a: 1, b: ['x', 'y'], c: date, d: { k: 'v' }, e: undefined, f: null }),
    ).toBe('a=1&b=x&b=y&c=2026-01-02T03%3A04%3A05.000Z&d=%7B%22k%22%3A%22v%22%7D');
  });

  it('accepts strings and URLSearchParams', () => {
    expect(buildQueryString('?q=1')).toBe('q=1');
    expect(buildQueryString(new URLSearchParams({ q: '2' }))).toBe('q=2');
  });

  it('returns an empty string for nothing', () => {
    expect(buildQueryString(undefined)).toBe('');
    expect(buildQueryString(null)).toBe('');
    expect(buildQueryString(42)).toBe('');
  });
});

describe('joinUrl', () => {
  it('normalises slashes', () => {
    expect(joinUrl('https://a.com/', '/x')).toBe('https://a.com/x');
    expect(joinUrl('https://a.com', 'x')).toBe('https://a.com/x');
    expect(joinUrl('https://a.com/v1/', '')).toBe('https://a.com/v1');
  });

  it('keeps absolute paths', () => {
    expect(joinUrl('https://a.com', 'https://b.com/x')).toBe('https://b.com/x');
  });
});

describe('buildUrl', () => {
  it('combines everything', () => {
    expect(buildUrl('https://a.com', '/u/:id', { id: 5 }, { q: 'x' })).toBe(
      'https://a.com/u/5?q=x',
    );
  });

  it('appends to an existing query string', () => {
    expect(buildUrl('https://a.com', '/u?v=1', undefined, { q: 'x' })).toBe(
      'https://a.com/u?v=1&q=x',
    );
  });
});
