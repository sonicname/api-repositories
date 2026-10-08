import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRepository,
  createRoute,
  defaultCacheKey,
  MemoryCacheStorage,
} from '../src/index.js';
import type { Adapter, AdapterRequest, AdapterResponse, CacheStorage } from '../src/index.js';

function countingAdapter(status = 200): Adapter & { calls: AdapterRequest[] } {
  const adapter = {
    calls: [] as AdapterRequest[],
    request: (request: AdapterRequest): Promise<AdapterResponse> => {
      adapter.calls.push(request);
      return Promise.resolve({
        status,
        statusText: '',
        headers: {},
        data: { n: adapter.calls.length },
      });
    },
  };
  return adapter;
}

const getUser = createRoute({ method: 'GET', path: '/users/:id', cache: { tags: ['user'] } });
const updateUser = createRoute({ method: 'PATCH', path: '/users/:id', invalidates: ['user'] });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cache middleware', () => {
  it('serves repeated GETs from cache until the TTL expires', async () => {
    const adapter = countingAdapter();
    const api = createRepository({ baseUrl: 'https://a.com', adapter, cache: { ttl: 1000 } })
      .mergeAll({ getUser })
      .build();

    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 1 });
    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 1 });
    await expect(api.getUser.orThrow({ params: { id: 2 } })).resolves.toEqual({ n: 2 });
    expect(adapter.calls).toHaveLength(2);

    vi.advanceTimersByTime(1000);
    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 3 });
  });

  it('deduplicates concurrent identical requests', async () => {
    const adapter = countingAdapter();
    const api = createRepository({ baseUrl: 'https://a.com', adapter, cache: 1000 })
      .mergeAll({ getUser })
      .build();

    const results = await Promise.all([
      api.getUser.orThrow({ params: { id: 1 } }),
      api.getUser.orThrow({ params: { id: 1 } }),
      api.getUser.orThrow({ params: { id: 1 } }),
    ]);

    expect(results).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
    expect(adapter.calls).toHaveLength(1);
    expect(api.$cache.inflight.size).toBe(0);
  });

  it('does not cache failed responses or non-GET methods', async () => {
    const failing = countingAdapter(500);
    const api = createRepository({
      baseUrl: 'https://a.com',
      adapter: failing,
      cache: 1000,
      validateResponse: false,
    })
      .mergeAll({ getUser, updateUser })
      .build();

    await expect(api.getUser.orThrow({ params: { id: 1 } })).rejects.toThrow();
    await expect(api.getUser.orThrow({ params: { id: 1 } })).rejects.toThrow();
    expect(failing.calls).toHaveLength(2);

    const ok = countingAdapter();
    const api2 = createRepository({ baseUrl: 'https://a.com', adapter: ok, cache: 1000 })
      .mergeAll({ updateUser })
      .build();
    await api2.updateUser.orThrow({ params: { id: 1 } });
    await api2.updateUser.orThrow({ params: { id: 1 } });
    expect(ok.calls).toHaveLength(2);
  });

  it('invalidates tagged entries after a mutation route succeeds', async () => {
    const adapter = countingAdapter();
    const api = createRepository({ baseUrl: 'https://a.com', adapter, cache: 60_000 })
      .mergeAll({ getUser, updateUser })
      .build();

    await api.getUser.orThrow({ params: { id: 1 } });
    await api.updateUser.orThrow({ params: { id: 1 } });
    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 3 });
  });

  it('exposes manual invalidation through $cache', async () => {
    const adapter = countingAdapter();
    const api = createRepository({ baseUrl: 'https://a.com', adapter, cache: 60_000 })
      .mergeAll({ getUser })
      .build();

    await api.getUser.orThrow({ params: { id: 1 } });
    await api.$cache.invalidate('other');
    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 1 });
    await api.$cache.invalidate('user');
    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 2 });
    await api.$cache.clear();
    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 3 });
    await api.$cache.delete('GET https://a.com/users/1');
    await expect(api.getUser.orThrow({ params: { id: 1 } })).resolves.toEqual({ n: 4 });
  });

  it('includes vary headers in the key and supports a custom key', async () => {
    const adapter = countingAdapter();
    const api = createRepository({
      baseUrl: 'https://a.com',
      adapter,
      cache: { ttl: 60_000, vary: ['Authorization'] },
    })
      .mergeAll({ getUser })
      .build();

    await api.getUser.orThrow({ params: { id: 1 }, headers: { authorization: 'a' } });
    await api.getUser.orThrow({ params: { id: 1 }, headers: { authorization: 'b' } });
    await api.getUser.orThrow({ params: { id: 1 }, headers: { authorization: 'a' } });
    expect(adapter.calls).toHaveLength(2);

    await api.getUser.orThrow({ params: { id: 1 }, cache: { key: () => 'custom' } });
    await api.getUser.orThrow({ params: { id: 2 }, cache: { key: () => 'custom' } });
    expect(adapter.calls).toHaveLength(3);
  });

  it('can be bypassed per call and per route', async () => {
    const adapter = countingAdapter();
    const api = createRepository({ baseUrl: 'https://a.com', adapter, cache: 60_000 })
      .mergeAll({ getUser, fresh: createRoute({ method: 'GET', path: '/fresh', cache: false }) })
      .build();

    await api.getUser.orThrow({ params: { id: 1 } });
    await api.getUser.orThrow({ params: { id: 1 }, cache: false });
    await api.fresh.orThrow();
    await api.fresh.orThrow();
    expect(adapter.calls).toHaveLength(4);
  });

  it('accepts a custom storage', async () => {
    const entries = new Map<string, unknown>();
    const storage: CacheStorage = {
      get: (key) => Promise.resolve(entries.get(key) as never),
      set: (key, entry) => {
        entries.set(key, entry);
      },
      delete: (key) => {
        entries.delete(key);
      },
      clear: () => {
        entries.clear();
      },
      invalidateTags: () => {
        entries.clear();
      },
    };
    const adapter = countingAdapter();
    const api = createRepository({
      baseUrl: 'https://a.com',
      adapter,
      cache: { ttl: 1000, storage },
    })
      .mergeAll({ getUser })
      .build();

    await api.getUser.orThrow({ params: { id: 1 } });
    await api.getUser.orThrow({ params: { id: 1 } });
    expect(adapter.calls).toHaveLength(1);
    expect(entries.size).toBe(1);
    expect(api.$cache.storage).toBe(storage);
  });
});

describe('MemoryCacheStorage', () => {
  it('drops expired entries lazily and invalidates by tag', () => {
    const storage = new MemoryCacheStorage();
    const response: AdapterResponse = { status: 200, statusText: '', headers: {}, data: 1 };
    storage.set('a', { response, expiresAt: Date.now() + 10, tags: ['x'] });
    storage.set('b', { response, expiresAt: Date.now() + 10, tags: ['y'] });

    expect(storage.size).toBe(2);
    storage.invalidateTags(['x']);
    expect(storage.get('a')).toBeUndefined();
    expect(storage.get('b')).toBeDefined();

    vi.advanceTimersByTime(10);
    expect(storage.get('b')).toBeUndefined();
    expect(storage.size).toBe(0);
  });
});

describe('defaultCacheKey', () => {
  it('is method + url + vary header values, case-insensitive on header names', () => {
    const request: AdapterRequest = {
      url: 'https://a.com/x',
      method: 'GET',
      headers: { Authorization: 'tok' },
      responseType: 'json',
    };
    expect(defaultCacheKey(request)).toBe('GET https://a.com/x');
    expect(defaultCacheKey(request, ['authorization', 'x-missing'])).toBe(
      'GET https://a.com/x authorization=tok x-missing=',
    );
  });
});
