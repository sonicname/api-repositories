# TanStack Query

endpoint-kit gives you typed callers; TanStack Query gives you caching, deduplication,
background refetching and Suspense. They fit together through two small helpers. The full,
type-checked source of this guide lives in [`examples/tanstack-query.ts`](../examples/tanstack-query.ts)
and [`examples/tanstack-react.tsx`](../examples/tanstack-react.tsx).

## Which side owns what

| Concern                     | Owner        | Notes                                                                |
| --------------------------- | ------------ | -------------------------------------------------------------------- |
| Validation, typing, errors  | endpoint-kit | `{ data, error }`, custom errors, `matchError`                       |
| Timeout, transport retry    | endpoint-kit | `timeout`, `retry` policies                                          |
| Caching, dedupe, refetching | TanStack     | Leave endpoint-kit `cache` off when a route is used through TanStack |
| Auth, refresh token         | endpoint-kit | Middleware, see the [auth guide](./auth-refresh-token.md)            |

TanStack expects `queryFn` to **throw** on failure, so the helpers call `caller.orThrow()`.
The thrown value is still the typed `RouteFailure`, and the generics below carry it into
`useQuery(...).error`.

## The helpers

```ts
import { queryOptions } from '@tanstack/react-query';
import type {
  AnyRoute,
  RouteArgs,
  RouteCaller,
  RouteError,
  RouteFailure,
  RouteInput,
  RouteOutput,
} from 'endpoint-kit';

/** Make every `useQuery` / `useMutation` error default to `RouteError` unless narrowed further. */
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: RouteError;
  }
}

export type RouteQueryKey = readonly [method: string, path: string, input: Record<string, unknown>];

/** `[method, path, { params, query, body }]`: transport options (headers, signal) are left out. */
export function routeKey<R extends AnyRoute>(
  caller: RouteCaller<R, unknown>,
  input?: RouteInput<R>,
): RouteQueryKey {
  const { params, query, body } = (input ?? {}) as {
    params?: unknown;
    query?: unknown;
    body?: unknown;
  };
  const identity: Record<string, unknown> = {};
  if (params !== undefined) identity['params'] = params;
  if (query !== undefined) identity['query'] = query;
  if (body !== undefined) identity['body'] = body;
  return [caller.definition.method, caller.definition.path, identity];
}

/** Key prefix matching every query of a route, for `invalidateQueries`. */
export function routeKeyPrefix<R extends AnyRoute>(caller: RouteCaller<R, unknown>) {
  return [caller.definition.method, caller.definition.path] as const;
}

export function routeQuery<R extends AnyRoute, E>(
  caller: RouteCaller<R, E>,
  ...args: RouteArgs<R>
) {
  const input = args[0];
  return queryOptions<RouteOutput<R>, RouteFailure<R, E>, RouteOutput<R>, RouteQueryKey>({
    queryKey: routeKey(caller, input),
    queryFn: ({ signal }) => {
      // The call input plus TanStack's signal, so unmounting cancels the request.
      const withSignal = { ...(input ?? {}), signal } as RouteInput<R>;
      return caller.orThrow(...([withSignal] as RouteArgs<R>));
    },
  });
}

/** `mutationFn` for a route: throws the typed error so `useMutation` sees it. */
export function routeMutation<R extends AnyRoute, E>(caller: RouteCaller<R, E>) {
  return (input: RouteInput<R>) => caller.orThrow(...([input] as RouteArgs<R>));
}
```

Why `queryOptions` and not a plain object: it tags the key with the data type, so
`queryClient.getQueryData(routeKey(...))` and `setQueryData` are typed too.

## Queries

```tsx
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { matchError } from 'endpoint-kit';

export function UserCard({ username }: { username: string }) {
  const { data, error, isPending } = useQuery(routeQuery(github.getUser, { params: { username } }));

  if (isPending) return <p>Loading…</p>;

  if (error) {
    // error: RouteError | NotFoundError | UnauthorizedError | RateLimitedError
    return (
      <p role="alert">
        {matchError(error, {
          NotFoundError: () => `No user named ${username}`,
          UnauthorizedError: () => 'Please sign in to see profiles',
          RateLimitedError: (e) => `Rate limited until ${e.resetAt.toLocaleTimeString()}`,
          ApiError: (e) => `GitHub answered ${String(e.status)}`,
          _: (e) => e.message,
        })}
      </p>
    );
  }

  return <h2>{data.name ?? data.login}</h2>;
}

export function RepoList({ username }: { username: string }) {
  // Suspense variant: `data` is never undefined, errors go to the nearest error boundary.
  const { data } = useSuspenseQuery(
    routeQuery(github.listRepos, {
      params: { username },
      query: { sort: 'updated', per_page: 10 },
    }),
  );
  return (
    <ul>
      {data.map((repo) => (
        <li key={repo.id}>{repo.name}</li>
      ))}
    </ul>
  );
}
```

## Mutations and invalidation

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function NewIssueButton({ owner, repo }: { owner: string; repo: string }) {
  const client = useQueryClient();
  const createIssue = useMutation({
    mutationFn: routeMutation(github.createIssue),
    onSuccess: () => client.invalidateQueries({ queryKey: routeKeyPrefix(github.listRepos) }),
  });

  return (
    <button
      disabled={createIssue.isPending}
      onClick={() =>
        createIssue.mutate({ params: { owner, repo }, body: { title: 'Found a bug' } })
      }
    >
      New issue
    </button>
  );
}
```

`routeKeyPrefix` invalidates every `listRepos` query regardless of its input. For one specific
input use `routeKey(github.listRepos, { params: { username } })`.

If some routes also use endpoint-kit's own `cache`, invalidate both sides: `invalidates: ['repos']`
on the route handles endpoint-kit, `invalidateQueries` handles TanStack.

## Retry: avoid doing it twice

endpoint-kit's `retry` policy already retries transport errors and 5xx with backoff. Either turn
off TanStack's retry or make it narrow:

```ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => count < 2 && error._tag === 'ApiError' && error.status >= 500,
    },
  },
});
```

`error` is typed as `RouteError` here thanks to the `Register` augmentation.

## Prefetching and SSR

Everything is plain `queryOptions`, so the usual TanStack APIs apply:

```ts
await queryClient.prefetchQuery(routeQuery(github.getUser, { params: { username: 'octocat' } }));
const cached = queryClient.getQueryData(
  routeKey(github.getUser, { params: { username: 'octocat' } }),
);
//    ^? User | undefined
```

In Next.js server components you can skip TanStack entirely and await the caller:

```tsx
export default async function Page({ params }: { params: { username: string } }) {
  const { data, error } = await github.getUser({ params });
  if (error) notFound();
  return <h1>{data.login}</h1>;
}
```

## `exactOptionalPropertyTypes`

TanStack Query's option types do not compile cleanly under `exactOptionalPropertyTypes`. The
examples in this repository are type-checked with that flag off (see
[`examples/tsconfig.json`](../examples/tsconfig.json)); endpoint-kit itself works either way.
