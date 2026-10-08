import { describe, expect, it } from 'vitest';

import { isJsonBody } from '../src/adapters/types.js';
import { toStringValue } from '../src/index.js';

describe('isJsonBody', () => {
  it('accepts plain objects, null-prototype objects and arrays', () => {
    expect(isJsonBody({ a: 1 })).toBe(true);
    expect(isJsonBody(Object.create(null))).toBe(true);
    expect(isJsonBody([1, 2])).toBe(true);
  });

  it('rejects primitives and binary/form payloads', () => {
    expect(isJsonBody(null)).toBe(false);
    expect(isJsonBody('text')).toBe(false);
    expect(isJsonBody(42)).toBe(false);
    expect(isJsonBody(new FormData())).toBe(false);
    expect(isJsonBody(new Blob(['x']))).toBe(false);
    expect(isJsonBody(new URLSearchParams('a=1'))).toBe(false);
    expect(isJsonBody(new ArrayBuffer(4))).toBe(false);
    expect(isJsonBody(new Uint8Array(4))).toBe(false);
    expect(isJsonBody(new Date())).toBe(false);
  });
});

describe('toStringValue', () => {
  it('stringifies primitives and JSON-encodes objects', () => {
    expect(toStringValue('a')).toBe('a');
    expect(toStringValue(1)).toBe('1');
    expect(toStringValue(true)).toBe('true');
    expect(toStringValue(10n)).toBe('10');
    expect(toStringValue({ a: 1 })).toBe('{"a":1}');
    expect(toStringValue(undefined)).toBe('');
    expect(toStringValue(Symbol('s'))).toBe('');
  });
});
