import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import {
  createRepository,
  createRoute,
  errorFromSchema,
  TaggedError,
  ValidationError,
} from '../src/index.js';
import type { Adapter, RouteError } from '../src/index.js';

const BASE = 'https://a.com';
const respond = (status: number, data: unknown): Adapter => ({
  request: () => Promise.resolve({ status, statusText: '', headers: {}, data }),
});

class NotFoundError extends TaggedError<'NotFoundError'> {
  readonly _tag = 'NotFoundError';
  constructor(
    readonly resource: string,
    readonly id: number,
  ) {
    super(`${resource} ${String(id)} not found`);
  }
}

class RateLimited extends TaggedError<'RateLimited'> {
  readonly _tag = 'RateLimited';
  constructor(readonly retryAfter: number) {
    super('Slow down');
  }
}

const notFoundBody = z.object({ resource: z.string(), id: z.coerce.number() });

const getRepo = createRoute.get('/repos/:id', {
  errors: {
    404: errorFromSchema(notFoundBody, (data, ctx) => {
      expectTypeOf(data).toEqualTypeOf<{ resource: string; id: number }>();
      expectTypeOf(ctx.data).toBeUnknown();
      return new NotFoundError(data.resource, data.id);
    }),
    429: async (ctx) => {
      await Promise.resolve();
      return new RateLimited(Number(ctx.headers['retry-after'] ?? 0));
    },
  },
});

describe('errorFromSchema', () => {
  const build = (adapter: Adapter) =>
    createRepository({ baseUrl: BASE, adapter }).mergeAll({ getRepo }).build();

  it('types the error union from the mapped error, including async factories', () => {
    expectTypeOf(build(respond(200, null)).getRepo)
      .returns.resolves.toHaveProperty('error')
      .toEqualTypeOf<RouteError | NotFoundError | RateLimited | null>();
  });

  it('validates and transforms the body before mapping', async () => {
    const { error } = await build(respond(404, { resource: 'repo', id: '42' })).getRepo({
      params: { id: 42 },
    });

    expect(error).toBeInstanceOf(NotFoundError);
    if (error?._tag === 'NotFoundError') {
      expect(error.id).toBe(42);
      expect(error.message).toBe('repo 42 not found');
    }
  });

  it('yields a ValidationError with target "error" when the body does not match', async () => {
    const { error } = await build(respond(404, { message: 'nope' })).getRepo({
      params: { id: 1 },
    });

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ target: 'error', route: 'getRepo' });
  });

  it('awaits async factories', async () => {
    const adapter: Adapter = {
      request: () =>
        Promise.resolve({
          status: 429,
          statusText: '',
          headers: { 'retry-after': '7' },
          data: null,
        }),
    };
    const { error } = await build(adapter).getRepo({ params: { id: 1 } });

    expect(error).toBeInstanceOf(RateLimited);
    if (error?._tag === 'RateLimited') expect(error.retryAfter).toBe(7);
  });

  it('works at repository level too', async () => {
    const api = createRepository({
      baseUrl: BASE,
      adapter: respond(404, { resource: 'thing', id: 3 }),
      errors: { 404: errorFromSchema(notFoundBody, (d) => new NotFoundError(d.resource, d.id)) },
    })
      .mergeAll({ ping: createRoute.get('/ping') })
      .build();

    const { error } = await api.ping();

    expect(error).toBeInstanceOf(NotFoundError);
    expectTypeOf(api.ping)
      .returns.resolves.toHaveProperty('error')
      .toEqualTypeOf<RouteError | NotFoundError | null>();
  });
});
