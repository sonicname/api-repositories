import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  AbortError,
  ApiError,
  catchTag,
  catchTags,
  createRepository,
  createRoute,
  err,
  hasTag,
  isTaggedError,
  matchError,
  NetworkError,
  ok,
  TaggedError,
  TimeoutError,
  toResult,
  toRouteError,
  UnknownError,
  ValidationError,
} from '../src/index.js';
import type { Adapter, AdapterResponse, Result, RouteError } from '../src/index.js';

const BASE = 'https://a.com';

function adapterOf(handler: () => Promise<AdapterResponse>): Adapter {
  return { request: handler };
}
const respond = (status: number, data: unknown = { id: 1 }): Adapter =>
  adapterOf(() => Promise.resolve({ status, statusText: '', headers: {}, data }));
const throwing = (error: Error): Adapter => adapterOf(() => Promise.reject(error));

const getUser = createRoute.get('/users/:id', { response: z.object({ id: z.number() }) });

describe('caller.safe()', () => {
  it('returns [null, data] on success', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(200) })
      .mergeAll({ getUser })
      .build();

    const [error, user] = await api.getUser.safe({ params: { id: 1 } });

    expect(error).toBeNull();
    expect(user).toEqual({ id: 1 });
  });

  it('returns [error, null] on failure instead of rejecting', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(404, { message: 'nope' }) })
      .mergeAll({ getUser })
      .build();

    const [error, user] = await api.getUser.safe({ params: { id: 1 } });

    expect(user).toBeNull();
    expect(error).toBeInstanceOf(ApiError);
    expect(error?._tag).toBe('ApiError');
  });

  it('narrows data after checking error', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(200) })
      .mergeAll({ getUser })
      .build();

    const [error, user] = await api.getUser.safe({ params: { id: 1 } });
    if (error) {
      expectTypeOf(error).toEqualTypeOf<RouteError>();
      expectTypeOf(user).toBeNull();
      return;
    }
    expectTypeOf(user).toEqualTypeOf<{ id: number }>();
    expectTypeOf(error).toBeNull();
    expect(user.id).toBe(1);
  });

  it('is typed as a Result of the route output', () => {
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getUser }).build();
    expectTypeOf(api.getUser.safe).returns.resolves.toEqualTypeOf<Result<{ id: number }>>();
  });
});

describe('error normalisation', () => {
  const build = (adapter: Adapter) =>
    createRepository({ baseUrl: BASE, adapter }).mergeAll({ getUser }).build();

  it('keeps library errors as they are', async () => {
    await expect(build(respond(500)).getUser({ params: { id: 1 } })).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(
      build(respond(200, { id: 'x' })).getUser({ params: { id: 1 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('wraps fetch/undici failures in NetworkError', async () => {
    const cause = new TypeError('fetch failed');
    const [error] = await build(throwing(cause)).getUser.safe({ params: { id: 1 } });

    expect(error).toBeInstanceOf(NetworkError);
    expect(error?.cause).toBe(cause);
    expect(error?.message).toContain('fetch failed');
  });

  it('recognises node and axios network codes, also nested in cause', () => {
    const code = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    expect(toRouteError(code, 'r')).toBeInstanceOf(NetworkError);
    const nested = new Error('outer', { cause: code });
    expect(toRouteError(nested, 'r')).toBeInstanceOf(NetworkError);
    const axios = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    expect(toRouteError(axios, 'r')).toBeInstanceOf(NetworkError);
  });

  it('wraps aborts in AbortError', async () => {
    const dom = new DOMException('aborted', 'AbortError');
    const [error] = await build(throwing(dom)).getUser.safe({ params: { id: 1 } });
    expect(error).toBeInstanceOf(AbortError);
    expect(error?.cause).toBe(dom);

    const axiosCancel = Object.assign(new Error('canceled'), { name: 'CanceledError' });
    expect(toRouteError(axiosCancel, 'r')).toBeInstanceOf(AbortError);
  });

  it('wraps everything else in UnknownError with the original message and cause', async () => {
    const [error] = await build(throwing(new RangeError('boom'))).getUser.safe({
      params: { id: 1 },
    });
    expect(error).toBeInstanceOf(UnknownError);
    expect(error?.message).toBe('boom');
    expect(error?.cause).toBeInstanceOf(RangeError);

    expect(toRouteError('plain string', 'r').message).toBe('plain string');
    expect(toRouteError({ weird: true }, 'r').message).toBe('{"weird":true}');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(toRouteError(circular, 'r').message).toBe('Unknown error');
  });

  it('passes custom tagged errors through and hands the normalised error to onError', async () => {
    class AuthError extends TaggedError<'AuthError'> {
      readonly _tag = 'AuthError';
    }
    const seen: unknown[] = [];
    const api = createRepository({
      baseUrl: BASE,
      adapter: throwing(new AuthError('no token')),
      hooks: {
        onError: ({ error }) => {
          seen.push(error);
        },
      },
    })
      .mergeAll({ getUser })
      .build();

    await expect(api.getUser({ params: { id: 1 } })).rejects.toBeInstanceOf(AuthError);
    expect(seen[0]).toBeInstanceOf(AuthError);
    expect(isTaggedError(seen[0])).toBe(true);
  });
});

describe('hasTag / matchError', () => {
  const apiError = new ApiError(404, { message: 'x' }, 'r');
  const timeout = new TimeoutError('r', 10);

  it('hasTag narrows', () => {
    const error: RouteError = apiError;
    expect(hasTag(error, 'ApiError')).toBe(true);
    expect(hasTag(error, 'TimeoutError')).toBe(false);
    expect(hasTag('nope', 'ApiError')).toBe(false);
    if (hasTag(error, 'ApiError')) expectTypeOf(error).toEqualTypeOf<ApiError>();
  });

  it('dispatches on the tag with typed handlers and a fallback', () => {
    const describe = (error: RouteError) =>
      matchError(error, {
        ApiError: (e) => {
          expectTypeOf(e).toEqualTypeOf<ApiError>();
          return `status ${String(e.status)}`;
        },
        TimeoutError: (e) => e.timeout,
        _: (e) => e.message,
      });

    expect(describe(apiError)).toBe('status 404');
    expect(describe(timeout)).toBe(10);
    expect(describe(new UnknownError('r', 'why'))).toBe('why');
    expectTypeOf(describe).returns.toEqualTypeOf<string | number>();
  });

  it('accepts an exhaustive table without fallback and rejects an incomplete one', () => {
    const exhaustive = (error: RouteError) =>
      matchError(error, {
        ApiError: () => 1,
        ValidationError: () => 2,
        TimeoutError: () => 3,
        AbortError: () => 4,
        NetworkError: () => 5,
        UnknownError: () => 6,
      });
    expect(exhaustive(timeout)).toBe(3);

    const typeOnly = (error: RouteError) => {
      // @ts-expect-error missing handlers and no fallback
      matchError(error, { ApiError: () => 1 });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  it('rethrows when nothing matches at runtime', () => {
    const handlers = { ApiError: () => 'x' } as never;
    expect(() => matchError(timeout, handlers)).toThrow(timeout);
  });
});

describe('catchTag / catchTags', () => {
  it('recovers from the given tag only', async () => {
    const notFound = Promise.reject(new ApiError(404, null, 'r'));
    await expect(catchTag(notFound, 'ApiError', (e) => e.status)).resolves.toBe(404);

    const timeout = Promise.reject(new TimeoutError('r', 5));
    await expect(catchTag(timeout, 'ApiError', () => 'nope')).rejects.toBeInstanceOf(TimeoutError);

    await expect(catchTag(Promise.resolve('fine'), 'ApiError', () => 0)).resolves.toBe('fine');
  });

  it('normalises raw rejections before matching', async () => {
    const raw = Promise.reject(new TypeError('Failed to fetch'));
    await expect(catchTag(raw, 'NetworkError', (e) => e._tag)).resolves.toBe('NetworkError');
  });

  it('types the union of success and handler results', async () => {
    const promise = Promise.resolve({ id: 1 });
    const value = await catchTags(promise, {
      ApiError: (e) => (e.status === 404 ? null : Promise.reject(e)),
      TimeoutError: () => 'later' as const,
    });
    expectTypeOf(value).toEqualTypeOf<{ id: number } | null | 'later'>();

    const result = await catchTags(Promise.reject(new TimeoutError('r', 1)), {
      TimeoutError: () => 'later',
    });
    expect(result).toBe('later');
    await expect(
      catchTags(Promise.reject(new ApiError(500, null, 'r')), { TimeoutError: () => 1 }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('Result helpers', () => {
  it('ok/err/toResult', async () => {
    expect(ok(1)).toEqual([null, 1]);
    expect(err('e')).toEqual(['e', null]);
    expect(await toResult(Promise.resolve(2))).toEqual([null, 2]);
    const [error] = await toResult(Promise.reject(new Error('x')), 'route');
    expect(error).toBeInstanceOf(UnknownError);
    expect(error?.route).toBe('route');
  });
});
