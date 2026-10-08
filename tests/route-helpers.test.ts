import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { createRepository, createRoute } from '../src/index.js';
import type { RouteInput, RouteOutput } from '../src/index.js';

describe('createRoute.<method>', () => {
  it('builds the same definition as createRoute with method and path', () => {
    const response = z.object({ id: z.number() });
    const viaHelper = createRoute.get('/users/:id', { response, headers: { a: '1' } });
    const viaObject = createRoute({
      method: 'GET',
      path: '/users/:id',
      response,
      headers: { a: '1' },
    });

    expect(viaHelper).toEqual(viaObject);
    expectTypeOf(viaHelper).toEqualTypeOf(viaObject);
  });

  it('exposes every HTTP method', () => {
    expect(createRoute.get('/x').method).toBe('GET');
    expect(createRoute.post('/x').method).toBe('POST');
    expect(createRoute.put('/x').method).toBe('PUT');
    expect(createRoute.patch('/x').method).toBe('PATCH');
    expect(createRoute.delete('/x').method).toBe('DELETE');
    expect(createRoute.head('/x').method).toBe('HEAD');
    expect(createRoute.options('/x').method).toBe('OPTIONS');
  });

  it('keeps full inference without options', () => {
    const route = createRoute.get('/users/:id');

    expectTypeOf<RouteInput<typeof route>['params']>().toEqualTypeOf<{ id: string | number }>();
    expectTypeOf<RouteOutput<typeof route>>().toBeUnknown();
  });

  it('infers schemas and validates params against the path', () => {
    const route = createRoute.post('/repos/:owner/:repo/issues', {
      params: { repo: z.string().min(1) },
      body: z.object({ title: z.string() }),
      response: z.object({ number: z.number() }),
    });
    type Input = RouteInput<typeof route>;

    expectTypeOf<Input['params']>().toEqualTypeOf<{ owner: string | number; repo: string }>();
    expectTypeOf<Input['body']>().toEqualTypeOf<{ title: string }>();
    expectTypeOf<RouteOutput<typeof route>>().toEqualTypeOf<{ number: number }>();

    const typeOnly = () => {
      // @ts-expect-error "nope" is not a path param
      createRoute.get('/users/:id', { params: { nope: z.string() } });
      // @ts-expect-error schema must require "id"
      createRoute.get('/users/:id', { params: z.object({}) });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  it('works inline inside mergeAll', () => {
    const api = createRepository({ baseUrl: 'https://x' })
      .mergeAll({ ping: createRoute.get('/ping', { responseType: 'text' }) })
      .build();

    expectTypeOf(api.ping).parameters.toExtend<[input?: unknown]>();
    expectTypeOf(api.ping.orThrow).returns.resolves.toEqualTypeOf<string>();
  });
});
