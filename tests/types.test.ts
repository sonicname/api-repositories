import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { createRepository, createRoute } from '../src/index.js';
import type { PathParamNames, PathParams, RouteInput, RouteOutput } from '../src/index.js';

describe('type inference', () => {
  it('extracts path param names', () => {
    expectTypeOf<PathParamNames<'/users/:username'>>().toEqualTypeOf<'username'>();
    expectTypeOf<PathParamNames<'/repos/:owner/:repo/issues/:number'>>().toEqualTypeOf<
      'owner' | 'repo' | 'number'
    >();
    expectTypeOf<PathParamNames<'/ping'>>().toBeNever();
    expectTypeOf<PathParams<'/u/:id'>>().toEqualTypeOf<{ id: string | number }>();
  });

  it('infers params from the path when no schema is given', () => {
    const route = createRoute({ method: 'GET', path: '/users/:username' });
    type Input = RouteInput<typeof route>;

    expectTypeOf<Input['params']>().toEqualTypeOf<{ username: string | number }>();
    expectTypeOf<Input>().not.toHaveProperty('query');
    expectTypeOf<Input>().not.toHaveProperty('body');
    expectTypeOf<RouteOutput<typeof route>>().toBeUnknown();
  });

  it('uses schema input/output types', () => {
    const route = createRoute({
      method: 'POST',
      path: '/repos/:owner/:repo/issues',
      params: z.object({ owner: z.string(), repo: z.string() }),
      query: z.object({ dryRun: z.boolean().optional() }),
      body: z.object({ title: z.string(), labels: z.array(z.string()).default([]) }),
      response: z.object({ number: z.number(), url: z.string() }),
    });
    type Input = RouteInput<typeof route>;

    expectTypeOf<Input['params']>().toEqualTypeOf<{ owner: string; repo: string }>();
    // query has only optional keys, so the field itself is optional
    expectTypeOf<Input['query']>().toEqualTypeOf<{ dryRun?: boolean | undefined } | undefined>();
    // body uses the schema *input* type: labels is optional because of .default()
    expectTypeOf<Input['body']>().toEqualTypeOf<{ title: string; labels?: string[] | undefined }>();
    expectTypeOf<RouteOutput<typeof route>>().toEqualTypeOf<{ number: number; url: string }>();
  });

  it('derives output from responseType when there is no response schema', () => {
    const text = createRoute({ method: 'GET', path: '/t', responseType: 'text' });
    const blob = createRoute({ method: 'GET', path: '/b', responseType: 'blob' });
    const none = createRoute({ method: 'DELETE', path: '/n', responseType: 'none' });

    expectTypeOf<RouteOutput<typeof text>>().toEqualTypeOf<string>();
    expectTypeOf<RouteOutput<typeof blob>>().toEqualTypeOf<Blob>();
    expectTypeOf<RouteOutput<typeof none>>().toEqualTypeOf<undefined>();
  });

  it('types the built client', () => {
    const getUser = createRoute({
      method: 'GET',
      path: '/users/:username',
      response: z.object({ id: z.number() }),
    });
    const ping = createRoute({ method: 'GET', path: '/ping', responseType: 'text' });

    const api = createRepository({ baseUrl: 'https://x' })
      .mergeAll({ getUser })
      .addRoute('ping', ping)
      .build();

    expectTypeOf(api.getUser).parameter(0).toEqualTypeOf<RouteInput<typeof getUser>>();
    expectTypeOf(api.getUser).returns.resolves.toEqualTypeOf<{ id: number }>();
    expectTypeOf(api.getUser.raw).returns.resolves.toHaveProperty('status');
    expectTypeOf(api.ping).parameters.toEqualTypeOf<[input?: RouteInput<typeof ping>]>();
    expectTypeOf(api.ping).returns.resolves.toEqualTypeOf<string>();
    expectTypeOf(api.$routes.getUser).toEqualTypeOf<typeof getUser>();

    // Never executed, only type-checked.
    const typeOnly = () => {
      // @ts-expect-error params are required
      void api.getUser();
    };
    expectTypeOf(typeOnly).toBeFunction();
    expectTypeOf(api).not.toHaveProperty('nope');
  });
});
