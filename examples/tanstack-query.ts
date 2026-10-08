/**
 * Glue between endpoint-kit callers and TanStack Query v5.
 *
 * `routeQuery(caller, input)` returns `queryOptions` with:
 * - a stable key derived from the route (method + path) and the call input,
 * - a `queryFn` that forwards TanStack's abort signal and throws the typed error,
 * - `TData` / `TError` generics filled from the route, so `useQuery(...).error` is typed.
 */
import { queryOptions } from '@tanstack/react-query';

import type {
  AnyRoute,
  RouteArgs,
  RouteCaller,
  RouteError,
  RouteFailure,
  RouteInput,
  RouteOutput,
} from '../src/index.js';

import type { NotFoundError, RateLimitedError, UnauthorizedError } from './api.js';

/** Every error the app's routes can produce: the built-ins plus the custom ones. */
export type AppError = RouteError | NotFoundError | UnauthorizedError | RateLimitedError;

/**
 * Make `useQuery(...).error` and `useMutation(...).error` default to `AppError` everywhere,
 * so `error._tag === 'NotFoundError'` narrows without any helper.
 */
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: AppError;
  }
}

/** Query key shape: `[method, path, input-without-transport-options]`. */
export type RouteQueryKey = readonly [method: string, path: string, input: Record<string, unknown>];

/** The part of the input that identifies the data (params, query, body), for the key. */
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
export function routeKeyPrefix<R extends AnyRoute>(
  caller: RouteCaller<R, unknown>,
): readonly [method: string, path: string] {
  return [caller.definition.method, caller.definition.path];
}

// Return type intentionally inferred: `queryOptions` tags the key with the data type and
// its exact shape is what `useQuery`, `useSuspenseQuery` and `prefetchQuery` all accept.

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
