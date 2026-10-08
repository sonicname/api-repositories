import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  AbortError,
  ApiError,
  createRepository,
  createRoute,
  matchError,
  NetworkError,
  TaggedError,
  TimeoutError,
  toRouteError,
  UnknownError,
  ValidationError,
} from '../src/index.js';
import type { Adapter, RouteError, RouteFailure } from '../src/index.js';

const BASE = 'https://a.com';

const respond = (status: number, data: unknown = { id: 1 }): Adapter => ({
  request: () => Promise.resolve({ status, statusText: '', headers: { 'x-r': '1' }, data }),
});
const throwing = (error: Error): Adapter => ({ request: () => Promise.reject(error) });

const getUser = createRoute.get('/users/:id', { response: z.object({ id: z.number() }) });

class NotFoundError extends TaggedError<'NotFoundError'> {
  readonly _tag = 'NotFoundError';
  constructor(readonly resource: string) {
    super(`${resource} not found`);
  }
}

class UnauthorizedError extends TaggedError<'UnauthorizedError'> {
  readonly _tag = 'UnauthorizedError';
  constructor() {
    super('Sign in first');
  }
}

describe('{ data, error } results', () => {
  it('resolves with ok/data/status/headers on success', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(201) })
      .mergeAll({ getUser })
      .build();

    const result = await api.getUser({ params: { id: 1 } });

    expect(result).toEqual({
      ok: true,
      data: { id: 1 },
      error: null,
      status: 201,
      statusText: '',
      headers: { 'x-r': '1' },
    });
  });

  it('resolves with ok:false/error on failure instead of rejecting', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(404, { message: 'nope' }) })
      .mergeAll({ getUser })
      .build();

    const { ok, data, error } = await api.getUser({ params: { id: 1 } });

    expect(ok).toBe(false);
    expect(data).toBeNull();
    expect(error).toBeInstanceOf(ApiError);
    expect(error?._tag).toBe('ApiError');
  });

  it('narrows data after checking error, and vice versa', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(200) })
      .mergeAll({ getUser })
      .build();

    const { data, error } = await api.getUser({ params: { id: 1 } });
    if (error) {
      expectTypeOf(error).toEqualTypeOf<RouteError>();
      expectTypeOf(data).toBeNull();
      return;
    }
    expectTypeOf(data).toEqualTypeOf<{ id: number }>();
    expect(data.id).toBe(1);

    const result = await api.getUser({ params: { id: 1 } });
    if (result.ok) expectTypeOf(result.status).toBeNumber();
  });

  it('orThrow() rejects with the same error', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(500) })
      .mergeAll({ getUser })
      .build();

    await expect(api.getUser.orThrow({ params: { id: 1 } })).rejects.toBeInstanceOf(ApiError);
    await expect(
      createRepository({ baseUrl: BASE, adapter: respond(200) })
        .mergeAll({ getUser })
        .build()
        .getUser.orThrow({ params: { id: 1 } }),
    ).resolves.toEqual({ id: 1 });
  });
});

describe('custom errors', () => {
  const getRepo = createRoute.get('/repos/:id', {
    response: z.object({ id: z.number() }),
    errors: {
      404: (ctx) => new NotFoundError(`repo ${String((ctx.data as { id?: number }).id ?? '?')}`),
    },
  });

  it('types the error union with route and repository errors', () => {
    const api = createRepository({
      baseUrl: BASE,
      errors: { 401: () => new UnauthorizedError() },
    })
      .mergeAll({ getRepo, getUser })
      .build();

    expectTypeOf(api.getRepo)
      .returns.resolves.toHaveProperty('error')
      .toEqualTypeOf<RouteError | NotFoundError | UnauthorizedError | null>();
    expectTypeOf(api.getUser)
      .returns.resolves.toHaveProperty('error')
      .toEqualTypeOf<RouteError | UnauthorizedError | null>();
    expectTypeOf<RouteFailure<typeof getRepo>>().toEqualTypeOf<RouteError | NotFoundError>();
  });

  it('keeps the union clean for routes without custom errors, also inline', () => {
    const api = createRepository({ baseUrl: BASE })
      .mergeAll({ ping: createRoute.get('/ping') })
      .build();
    expectTypeOf(api.ping)
      .returns.resolves.toHaveProperty('error')
      .toEqualTypeOf<RouteError | null>();
  });

  it('builds the route error for a matching status', async () => {
    const api = createRepository({ baseUrl: BASE, adapter: respond(404, { id: 7 }) })
      .mergeAll({ getRepo })
      .build();

    const { error } = await api.getRepo({ params: { id: 7 } });

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error?.message).toBe('repo 7 not found');
    if (error?._tag === 'NotFoundError') expectTypeOf(error).toEqualTypeOf<NotFoundError>();
  });

  it('falls back to repository errors, then ApiError', async () => {
    const build = (status: number) =>
      createRepository({
        baseUrl: BASE,
        adapter: respond(status),
        errors: { 401: () => new UnauthorizedError(), 404: () => new NotFoundError('global') },
      })
        .mergeAll({ getRepo })
        .build();

    expect((await build(401).getRepo({ params: { id: 1 } })).error).toBeInstanceOf(
      UnauthorizedError,
    );
    // route 404 wins over repository 404
    expect((await build(404).getRepo({ params: { id: 1 } })).error?.message).toBe(
      'repo 1 not found',
    );
    expect((await build(500).getRepo({ params: { id: 1 } })).error).toBeInstanceOf(ApiError);
  });

  it('gives factories the full response context', async () => {
    let seen: unknown;
    const route = createRoute.get('/x', {
      errors: {
        418: (ctx) => {
          seen = ctx;
          return new NotFoundError('teapot');
        },
      },
    });
    const api = createRepository({ baseUrl: BASE, adapter: respond(418, 'short') })
      .mergeAll({ route })
      .build();

    await api.route();

    expect(seen).toEqual({
      status: 418,
      statusText: '',
      headers: { 'x-r': '1' },
      data: 'short',
      route: 'route',
    });
  });

  it('reaches onError and orThrow', async () => {
    const errors: unknown[] = [];
    const api = createRepository({
      baseUrl: BASE,
      adapter: respond(404),
      hooks: {
        onError: ({ error }) => {
          errors.push(error);
        },
      },
    })
      .mergeAll({ getRepo })
      .build();

    await expect(api.getRepo.orThrow({ params: { id: 1 } })).rejects.toBeInstanceOf(NotFoundError);
    expect(errors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('error normalisation', () => {
  const build = (adapter: Adapter) =>
    createRepository({ baseUrl: BASE, adapter }).mergeAll({ getUser }).build();

  it('keeps library errors as they are', async () => {
    expect((await build(respond(500)).getUser({ params: { id: 1 } })).error).toBeInstanceOf(
      ApiError,
    );
    expect(
      (await build(respond(200, { id: 'x' })).getUser({ params: { id: 1 } })).error,
    ).toBeInstanceOf(ValidationError);
  });

  it('wraps fetch/undici failures in NetworkError', async () => {
    const cause = new TypeError('fetch failed');
    const { error } = await build(throwing(cause)).getUser({ params: { id: 1 } });

    expect(error).toBeInstanceOf(NetworkError);
    expect(error?.cause).toBe(cause);
    expect(error?.message).toContain('fetch failed');
  });

  it('recognises node and axios network codes, also nested in cause', () => {
    const code = Object.assign(new Error('connect'), { code: 'ECONNREFUSED' });
    expect(toRouteError(code, 'r')).toBeInstanceOf(NetworkError);
    expect(toRouteError(new Error('outer', { cause: code }), 'r')).toBeInstanceOf(NetworkError);
    const axios = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    expect(toRouteError(axios, 'r')).toBeInstanceOf(NetworkError);
  });

  it('wraps aborts in AbortError', async () => {
    const dom = new DOMException('aborted', 'AbortError');
    const { error } = await build(throwing(dom)).getUser({ params: { id: 1 } });
    expect(error).toBeInstanceOf(AbortError);
    expect(error?.cause).toBe(dom);

    const axiosCancel = Object.assign(new Error('canceled'), { name: 'CanceledError' });
    expect(toRouteError(axiosCancel, 'r')).toBeInstanceOf(AbortError);
  });

  it('wraps everything else in UnknownError with the original message and cause', async () => {
    const { error } = await build(throwing(new RangeError('boom'))).getUser({
      params: { id: 1 },
    });
    expect(error).toBeInstanceOf(UnknownError);
    expect(error?.message).toBe('boom');
    expect(error?.cause).toBeInstanceOf(RangeError);

    expect(toRouteError('plain string', 'r').message).toBe('plain string');
    expect(toRouteError({ weird: true }, 'r').message).toBe('{"weird":true}');
    expect(toRouteError(undefined, 'r').message).toBe('undefined');
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(toRouteError(circular, 'r').message).toBe('Unknown error');
  });

  it('passes custom tagged errors thrown by middlewares through', async () => {
    const api = createRepository({
      baseUrl: BASE,
      middlewares: [() => Promise.reject(new UnauthorizedError())],
    })
      .mergeAll({ getUser })
      .build();

    const { error } = await api.getUser({ params: { id: 1 } });
    expect(error).toBeInstanceOf(UnauthorizedError);
  });
});

describe('matchError', () => {
  const apiError = new ApiError(404, { message: 'x' }, 'r');
  const timeout = new TimeoutError('r', 10);

  it('dispatches on the tag with typed handlers and a fallback', () => {
    const describeError = (error: RouteError | NotFoundError) =>
      matchError(error, {
        ApiError: (e) => {
          expectTypeOf(e).toEqualTypeOf<ApiError>();
          return `status ${String(e.status)}`;
        },
        NotFoundError: (e) => e.resource,
        TimeoutError: (e) => e.timeout,
        _: (e) => e.message,
      });

    expect(describeError(apiError)).toBe('status 404');
    expect(describeError(timeout)).toBe(10);
    expect(describeError(new NotFoundError('user'))).toBe('user');
    expect(describeError(new UnknownError('r', 'why'))).toBe('why');
    expectTypeOf(describeError).returns.toEqualTypeOf<string | number>();
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

describe('error classes', () => {
  it('ValidationError formats issues with nested paths', () => {
    const error = new ValidationError(
      'body',
      [{ message: 'Required', path: ['user', { key: 'name' }, 0] }, { message: 'Too short' }],
      'createUser',
    );
    expect(error.message).toBe(
      'Validation failed for body of route "createUser": user.name.0: Required; Too short',
    );
  });

  it('ApiError includes status text when present and has defaults', () => {
    expect(new ApiError(500, null, 'r', {}, 'Server Error').message).toBe(
      'Request to route "r" failed with status 500 Server Error',
    );
    const bare = new ApiError(418, undefined, 'teapot');
    expect(bare.message).toBe('Request to route "teapot" failed with status 418');
    expect(bare.headers).toEqual({});
  });
});
