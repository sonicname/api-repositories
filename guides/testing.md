# Testing

Two strategies, both without touching the network. Full source:
[`examples/testing.ts`](../examples/testing.ts).

## 1. Swap the adapter

The adapter is the only thing that talks HTTP. A scripted one keeps every other layer
(validation, params, middlewares, custom errors) exercised exactly as in production.

```ts
import type { Adapter, AdapterRequest, AdapterResponse } from 'endpoint-kit';

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
      if (!handler)
        return Promise.resolve({ status: 404, statusText: 'Not Found', headers: {}, data: null });
      const answer = handler(request);
      const response: AdapterResponse =
        answer !== null && typeof answer === 'object' && 'status' in answer
          ? { status: 200, statusText: '', headers: {}, data: null, ...(answer as object) }
          : { status: 200, statusText: '', headers: {}, data: answer };
      return Promise.resolve(response);
    },
  };
}
```

Build the client from the same route definitions as production, only the adapter differs.
Turn retries and timeouts off so tests are deterministic:

```ts
const adapter = mockAdapter({
  'GET /users/octocat': () => ({ id: 1, login: 'octocat', name: null }),
  'GET /users/nobody': () => ({ status: 404, data: { message: 'Not Found' } }),
});

const api = createRepository({ baseUrl: 'https://api.test', adapter, retry: false, timeout: false })
  .mergeAll(routes)
  .build();

it('maps 404 to NotFoundError', async () => {
  const { error } = await api.getUser({ params: { username: 'nobody' } });
  expect(error?._tag).toBe('NotFoundError');
});

it('sends the auth header', async () => {
  await api.getUser({ params: { username: 'octocat' } });
  expect(adapter.calls[0]?.headers.authorization).toMatch(/^Bearer /);
});
```

Keep the factory in one place (`createTestClient` in the example) so tests do not repeat the
repository config.

## 2. Mock the network

If you prefer tests to go through real `fetch`, keep `fetchAdapter()` and intercept at the
network layer:

- **MSW** works unchanged, in Node and in the browser. Handlers answer with JSON; endpoint-kit
  validates and maps errors as usual.
- **`vi.stubGlobal('fetch', ...)`** for quick one-offs. endpoint-kit reads `globalThis.fetch`
  when `fetchAdapter()` is created, so stub it before building the client, or pass the stub
  explicitly: `fetchAdapter({ fetch: myStub })`.

This repository's own tests use the second approach; see [`tests/repository.test.ts`](../tests/repository.test.ts).

## Testing custom middlewares

A middleware is a function of `(request, next, context)`. Call it directly with a fake `next`:

```ts
it('refreshes once and replays', async () => {
  const next = vi
    .fn()
    .mockResolvedValueOnce({ status: 401, statusText: '', headers: {}, data: null })
    .mockResolvedValueOnce({ status: 200, statusText: '', headers: {}, data: 'ok' });
  const refresh = vi.fn().mockResolvedValue('new-token');

  const mw = refreshOn401({ getToken: () => 'old-token', refresh });
  const response = await mw(request, next, { route: 'getUser', attempt: 1 });

  expect(response.status).toBe(200);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[1]?.[0].headers.authorization).toBe('Bearer new-token');
});
```

## Timers

Timeout and retry delays use `setTimeout`. With Vitest, `vi.useFakeTimers()` plus
`await vi.advanceTimersByTimeAsync(ms)` drives them deterministically; see
[`tests/retry.test.ts`](../tests/retry.test.ts) for the pattern.
