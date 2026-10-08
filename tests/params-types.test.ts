import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { createRoute } from '../src/index.js';
import type { RouteInput, ValidateParams } from '../src/index.js';

describe('params typing: per-key map', () => {
  it('uses schema input for mapped keys and string | number for the rest', () => {
    const route = createRoute({
      method: 'GET',
      path: '/repos/:owner/:repo/issues/:number',
      params: { number: z.coerce.number(), repo: z.enum(['a', 'b']) },
    });
    type Params = RouteInput<typeof route>['params'];

    expectTypeOf<Params>().toEqualTypeOf<{
      owner: string | number;
      repo: 'a' | 'b';
      number: unknown;
    }>();
  });

  it('rejects keys that are not in the path', () => {
    const typeOnly = () => {
      createRoute({
        method: 'GET',
        path: '/users/:username',
        // @ts-expect-error "usernam" is not a path param
        params: { usernam: z.string() },
      });
      createRoute({
        method: 'GET',
        path: '/users/:username',
        // @ts-expect-error extra key next to a valid one
        params: { username: z.string(), extra: z.string() },
      });
      createRoute({
        method: 'GET',
        path: '/ping',
        // @ts-expect-error path has no params at all
        params: { id: z.string() },
      });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});

describe('params typing: whole-object schema', () => {
  it('accepts a schema that requires exactly the path params', () => {
    const route = createRoute({
      method: 'GET',
      path: '/repos/:owner/:repo',
      params: z.object({ owner: z.string(), repo: z.string().min(1) }),
    });

    expectTypeOf<RouteInput<typeof route>['params']>().toEqualTypeOf<{
      owner: string;
      repo: string;
    }>();
  });

  it('rejects missing, optional and extra keys', () => {
    const typeOnly = () => {
      createRoute({
        method: 'GET',
        path: '/repos/:owner/:repo',
        // @ts-expect-error repo is missing
        params: z.object({ owner: z.string() }),
      });
      createRoute({
        method: 'GET',
        path: '/repos/:owner/:repo',
        // @ts-expect-error repo is optional but the path always needs it
        params: z.object({ owner: z.string(), repo: z.string().optional() }),
      });
      createRoute({
        method: 'GET',
        path: '/repos/:owner/:repo',
        // @ts-expect-error extra is not a path param
        params: z.object({ owner: z.string(), repo: z.string(), extra: z.string() }),
      });
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  it('spells out the problem in the error type', () => {
    type Missing = ValidateParams<'/repos/:owner/:repo', z.ZodObject<{ owner: z.ZodString }>>;
    expectTypeOf<
      keyof Missing
    >().toEqualTypeOf<'params: path "/repos/:owner/:repo" has param ":repo" but the schema does not require it'>();

    type Extra = ValidateParams<'/u/:id', { id: z.ZodString; nope: z.ZodString }>;
    expectTypeOf<keyof Extra>().toEqualTypeOf<'params: "nope" is not a param of path "/u/:id"'>();

    type Ok = ValidateParams<'/u/:id', { id: z.ZodString }>;
    expectTypeOf<Ok>().toEqualTypeOf<{ id: z.ZodString }>();
  });
});
