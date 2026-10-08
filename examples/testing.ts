/**
 * Testing patterns: swap the adapter for a scripted one, or keep `fetchAdapter` and mock
 * the network with MSW / `vi.stubGlobal('fetch', ...)`.
 */
import { createRepository } from '../src/index.js';
import type { Adapter, AdapterRequest, AdapterResponse } from '../src/index.js';

import { routes } from './api.js';

/** An adapter that answers from a lookup table and records what it was asked. */
export function mockAdapter(
  handlers: Record<string, (request: AdapterRequest) => unknown>,
): Adapter & { calls: AdapterRequest[] } {
  const calls: AdapterRequest[] = [];
  return {
    calls,
    request: (request) => {
      calls.push(request);
      const url = new URL(request.url);
      const handler = handlers[`${request.method} ${url.pathname}`];
      if (!handler) {
        return Promise.resolve({ status: 404, statusText: 'Not Found', headers: {}, data: null });
      }
      const answer = handler(request);
      const response: AdapterResponse =
        answer !== null && typeof answer === 'object' && 'status' in answer
          ? { status: 200, statusText: '', headers: {}, data: null, ...(answer as object) }
          : { status: 200, statusText: '', headers: {}, data: answer };
      return Promise.resolve(response);
    },
  };
}

/** Build the same client as production, but talking to the mock. */
export function createTestClient(handlers: Parameters<typeof mockAdapter>[0]): {
  api: ReturnType<typeof build>;
  adapter: ReturnType<typeof mockAdapter>;
} {
  const adapter = mockAdapter(handlers);
  return { api: build(adapter), adapter };
}

function build(adapter: Adapter) {
  return createRepository({ baseUrl: 'https://api.test', adapter, retry: false, timeout: false })
    .mergeAll(routes)
    .build();
}

// Usage in a test:
//
// const { api, adapter } = createTestClient({
//   'GET /users/octocat': () => ({ id: 1, login: 'octocat', name: null }),
//   'GET /users/nobody': () => ({ status: 404, data: { message: 'Not Found' } }),
// });
// const { data } = await api.getUser({ params: { username: 'octocat' } });
// expect(data?.login).toBe('octocat');
// expect(adapter.calls[0]?.headers.authorization).toBeUndefined();
