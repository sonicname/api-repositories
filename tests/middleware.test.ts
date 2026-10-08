import { describe, expect, it, vi } from 'vitest';

import { composeMiddlewares, createRepository, createRoute } from '../src/index.js';
import type { Adapter, AdapterRequest, AdapterResponse, Middleware } from '../src/index.js';

const ok = (data: unknown = { ok: true }, status = 200): AdapterResponse => ({
  status,
  statusText: '',
  headers: {},
  data,
});

const baseRequest: AdapterRequest = {
  url: 'https://a.com/x',
  method: 'GET',
  headers: {},
  responseType: 'json',
};

describe('composeMiddlewares', () => {
  it('runs middlewares outermost first and lets them modify the request', async () => {
    const order: string[] = [];
    const a: Middleware = async (request, next) => {
      order.push('a:in');
      const response = await next({ ...request, headers: { ...request.headers, a: '1' } });
      order.push('a:out');
      return response;
    };
    const b: Middleware = async (request, next) => {
      order.push('b:in');
      const response = await next({ ...request, headers: { ...request.headers, b: '1' } });
      order.push('b:out');
      return response;
    };
    const terminal = vi.fn((request: AdapterRequest) => Promise.resolve(ok(request.headers)));

    const run = composeMiddlewares([a, b], terminal, { route: 'r', attempt: 1 });
    const response = await run(baseRequest);

    expect(order).toEqual(['a:in', 'b:in', 'b:out', 'a:out']);
    expect(response.data).toEqual({ a: '1', b: '1' });
  });

  it('lets a middleware short-circuit', async () => {
    const terminal = vi.fn(() => Promise.resolve(ok()));
    const mock: Middleware = () => Promise.resolve(ok('mocked'));

    const run = composeMiddlewares([mock], terminal, { route: 'r', attempt: 1 });

    expect((await run(baseRequest)).data).toBe('mocked');
    expect(terminal).not.toHaveBeenCalled();
  });
});

describe('repository middlewares', () => {
  it('runs repository middlewares outside route middlewares, hooks innermost', async () => {
    const order: string[] = [];
    const tag =
      (name: string): Middleware =>
      async (request, next) => {
        order.push(`${name}:in`);
        const response = await next(request);
        order.push(`${name}:out`);
        return response;
      };
    const adapter: Adapter = {
      request: () => {
        order.push('adapter');
        return Promise.resolve(ok());
      },
    };
    const route = createRoute({ method: 'GET', path: '/x', middlewares: [tag('route')] });
    const api = createRepository({
      baseUrl: 'https://a.com',
      adapter,
      middlewares: [tag('repo')],
      hooks: {
        onRequest: ({ attempt }) => {
          order.push(`hook:request:${String(attempt)}`);
        },
        onResponse: ({ attempt }) => {
          order.push(`hook:response:${String(attempt)}`);
        },
      },
    })
      .mergeAll({ route })
      .build();

    await api.route.orThrow();

    expect(order).toEqual([
      'repo:in',
      'route:in',
      'hook:request:1',
      'adapter',
      'hook:response:1',
      'route:out',
      'repo:out',
    ]);
  });

  it('exposes the route name in the context', async () => {
    const seen: string[] = [];
    const spy: Middleware = (request, next, context) => {
      seen.push(context.route);
      return next(request);
    };
    const adapter: Adapter = { request: () => Promise.resolve(ok()) };
    const api = createRepository({ baseUrl: 'https://a.com', adapter, middlewares: [spy] })
      .addRoute('hello', createRoute({ method: 'GET', path: '/hello' }))
      .build();

    await api.hello.orThrow();

    expect(seen).toEqual(['hello']);
  });
});
