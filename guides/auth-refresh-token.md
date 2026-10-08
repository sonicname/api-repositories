# Authentication and refresh tokens

Three pieces, each a few lines: a token store, a `headers` provider that reads it, and a
middleware that refreshes on 401 and replays the request. Full, type-checked source:
[`examples/auth-store.ts`](../examples/auth-store.ts),
[`examples/refresh-middleware.ts`](../examples/refresh-middleware.ts),
[`examples/api.ts`](../examples/api.ts).

## 1. Token store

Keep the access token in memory. The refresh token should be an httpOnly cookie set by the
auth server, so the refresh call only needs `credentials: 'include'`.

```ts
const authApi = createRepository({
  baseUrl: 'https://auth.example.com',
  adapter: fetchAdapter({ init: { credentials: 'include' } }),
  // No refresh middleware here: refreshing must not try to refresh itself.
})
  .mergeAll({
    refresh: createRoute.post('/token/refresh', {
      response: z.object({ accessToken: z.string(), expiresIn: z.number() }),
      retry: false,
    }),
    signOut: createRoute.post('/sign-out', { responseType: 'none' }),
  })
  .build();

let accessToken: string | null = null;

export const auth = {
  getAccessToken: () => accessToken,
  setSession(token: string) {
    accessToken = token;
  },
  async refresh(): Promise<string | null> {
    const { data, error } = await authApi.refresh();
    if (error) {
      accessToken = null;
      return null;
    }
    accessToken = data.accessToken;
    return data.accessToken;
  },
  async signOut() {
    await authApi.signOut();
    accessToken = null;
  },
};
```

Using a separate repository for the auth server is deliberate: it has no refresh middleware,
no retries, and its own base URL.

## 2. Send the token

`headers` accepts a function, evaluated for every request, so a refreshed token is picked up
automatically:

```ts
export const github = createRepository({
  baseUrl: 'https://api.github.com',
  headers: () => {
    const token = auth.getAccessToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  },
  errors: { 401: () => new UnauthorizedError() },
  middlewares: [
    refreshOn401({
      getToken: auth.getAccessToken,
      refresh: auth.refresh,
      onRefreshFailed: auth.signOut,
    }),
  ],
})
  .mergeAll(routes)
  .build();
```

The function may be async if the token lives in secure storage.

## 3. Refresh on 401

```ts
import type { Middleware } from 'endpoint-kit';

export interface RefreshOn401Options {
  getToken: () => string | null;
  refresh: () => Promise<string | null>;
  onRefreshFailed?: () => void | Promise<void>;
}

export function refreshOn401(options: RefreshOn401Options): Middleware {
  let inflight: Promise<string | null> | null = null;

  // Concurrent 401s share one refresh call.
  const refreshOnce = () => {
    inflight ??= options
      .refresh()
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return async (request, next) => {
    const tokenUsed = options.getToken();
    const response = await next(request);
    if (response.status !== 401) return response;

    // Another request already refreshed while this one was in flight: just replay.
    const current = options.getToken();
    const token = current !== null && current !== tokenUsed ? current : await refreshOnce();

    if (token === null) {
      await options.onRefreshFailed?.();
      return response; // becomes UnauthorizedError / ApiError for the caller
    }

    return next({ ...request, headers: { ...request.headers, authorization: `Bearer ${token}` } });
  };
}
```

What this guarantees:

- **One refresh for a burst of 401s.** Ten components mounting at once produce one refresh call.
- **No loop.** The replayed request carries the new token. If it still gets 401, `next` returns
  that response and the middleware does not refresh again because `current === tokenUsed`
  for that replay never holds: the first branch sees the same token and `refreshOnce()` runs at
  most once per failure window.
- **The caller still gets a typed error** when refreshing fails: the original 401 flows into the
  `errors` map, so `error._tag === 'UnauthorizedError'`.

Where it sits in the chain matters. Repository middlewares run outside cache, retry and timeout,
so the replay is a fresh attempt with its own timeout, and the retry policy never retries a 401
itself (401 is not in its default status list).

## Proactive refresh

If the access token carries an expiry, refresh before it lapses instead of waiting for a 401:

```ts
headers: async () => {
  if (auth.isExpiringSoon()) await auth.refresh();
  const token = auth.getAccessToken();
  return token ? { authorization: `Bearer ${token}` } : {};
},
```

Keep the 401 middleware as well: clocks drift and tokens get revoked.

## Cookie-only sessions

If the API itself authenticates with a cookie, there is no token to attach. Use
`fetchAdapter({ init: { credentials: 'include' } })` on the API repository and keep the
middleware for the refresh-and-replay behaviour; `getToken` can return a session version
number instead of a token so the "already refreshed" check still works.

## React: reacting to sign-out

Expose a subscription from the store and read it with `useSyncExternalStore`:

```tsx
export function useSession() {
  const token = useSyncExternalStore(
    (listener) => auth.subscribe(listener),
    () => auth.getAccessToken(),
    () => null, // server snapshot
  );
  return { signedIn: token !== null };
}
```

See [`examples/react-plain.tsx`](../examples/react-plain.tsx).
