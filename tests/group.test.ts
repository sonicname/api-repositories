import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { createRepository, createRoute, groupRoutes } from '../src/index.js';
import type { Adapter, AdapterRequest, Middleware, RouteInput } from '../src/index.js';

function recordingAdapter(): Adapter & { calls: AdapterRequest[] } {
  const adapter = {
    calls: [] as AdapterRequest[],
    request: (request: AdapterRequest) => {
      adapter.calls.push(request);
      return Promise.resolve({ status: 200, statusText: '', headers: {}, data: null });
    },
  };
  return adapter;
}

describe('groupRoutes', () => {
  it('prefixes paths with a string shorthand and keeps everything else', () => {
    const admin = groupRoutes('/admin', {
      listUsers: createRoute.get('/users', { headers: { a: '1' } }),
      getUser: createRoute.get('/users/:id'),
    });

    expect(admin.listUsers).toEqual({ method: 'GET', path: '/admin/users', headers: { a: '1' } });
    expect(admin.getUser.path).toBe('/admin/users/:id');
    expectTypeOf(admin.getUser.path).toEqualTypeOf<'/admin/users/:id'>();
    expectTypeOf<RouteInput<typeof admin.getUser>['params']>().toEqualTypeOf<{
      id: string | number;
    }>();
  });

  it('adds prefix params to routes, including ones with a whole-object schema', () => {
    const org = groupRoutes('/orgs/:org', {
      listRepos: createRoute.get('/repos'),
      getRepo: createRoute.get('/repos/:repo', { params: z.object({ repo: z.string().min(1) }) }),
      getIssue: createRoute.get('/repos/:repo/issues/:n', { params: { n: z.coerce.number() } }),
    });

    expectTypeOf<RouteInput<typeof org.listRepos>['params']>().toEqualTypeOf<{
      org: string | number;
    }>();
    expectTypeOf<RouteInput<typeof org.getRepo>['params']>().toEqualTypeOf<{
      repo: string;
      org: string | number;
    }>();
    expectTypeOf<RouteInput<typeof org.getIssue>['params']>().toEqualTypeOf<{
      org: string | number;
      repo: string | number;
      n: unknown;
    }>();
  });

  it('sends prefix params at runtime, even when a whole-object schema strips them', async () => {
    const adapter = recordingAdapter();
    const org = groupRoutes('/orgs/:org', {
      getRepo: createRoute.get('/repos/:repo', { params: z.object({ repo: z.string() }) }),
    });
    const api = createRepository({ baseUrl: 'https://a.com', adapter }).mergeAll(org).build();

    await api.getRepo.orThrow({ params: { org: 'acme', repo: 'web' } });

    expect(adapter.calls[0]!.url).toBe('https://a.com/orgs/acme/repos/web');
  });

  it('merges shared headers, options and middlewares under the route ones', () => {
    const groupMw: Middleware = (request, next) => next(request);
    const routeMw: Middleware = (request, next) => next(request);
    const grouped = groupRoutes(
      {
        prefix: '/v1',
        headers: { 'x-shared': 'group', 'x-group': '1' },
        options: { shared: 'group', group: true },
        middlewares: [groupMw],
      },
      {
        a: createRoute.get('/a', {
          headers: { 'x-shared': 'route' },
          options: { shared: 'route' },
          middlewares: [routeMw],
        }),
        b: createRoute.get('/b'),
      },
    );

    expect(grouped.a.headers).toEqual({ 'x-shared': 'route', 'x-group': '1' });
    expect(grouped.a.options).toEqual({ shared: 'route', group: true });
    expect(grouped.a.middlewares).toEqual([groupMw, routeMw]);
    expect(grouped.b.headers).toEqual({ 'x-shared': 'group', 'x-group': '1' });
    expect(grouped.b.middlewares).toEqual([groupMw]);
    expect(grouped.b.path).toBe('/v1/b');
  });

  it('applies timeout, retry and cache only when the route has none', () => {
    const grouped = groupRoutes(
      { timeout: 100, retry: 2, cache: { ttl: 5 } },
      {
        defaults: createRoute.get('/d'),
        custom: createRoute.get('/c', { timeout: false, retry: { attempts: 9 }, cache: false }),
      },
    );

    expect(grouped.defaults).toMatchObject({ timeout: 100, retry: 2, cache: { ttl: 5 } });
    expect(grouped.custom).toMatchObject({ timeout: false, retry: { attempts: 9 }, cache: false });
    expect(grouped.defaults.path).toBe('/d');
  });

  it('nests', () => {
    const api = groupRoutes('/api', {
      ...groupRoutes('/admin', { listUsers: createRoute.get('/users') }),
      ...groupRoutes('/public', { health: createRoute.get('/health') }),
    });

    expect(api.listUsers.path).toBe('/api/admin/users');
    expect(api.health.path).toBe('/api/public/health');
    expectTypeOf(api.listUsers.path).toEqualTypeOf<'/api/admin/users'>();
  });

  it('plugs into a repository with full typing', async () => {
    const adapter = recordingAdapter();
    const api = createRepository({ baseUrl: 'https://a.com', adapter })
      .mergeAll(groupRoutes('/admin', { getUser: createRoute.get('/users/:id') }))
      .build();

    await api.getUser.orThrow({ params: { id: 7 } });

    expect(adapter.calls[0]!.url).toBe('https://a.com/admin/users/7');
    const typeOnly = () => {
      // @ts-expect-error id is required
      void api.getUser.orThrow();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});
