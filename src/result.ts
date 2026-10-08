import { hasTag, isTaggedError, toRouteError } from './errors.js';
import type { ErrorByTag, RouteError, RouteErrorTag, TaggedError } from './errors.js';

/**
 * Go-style result: `[error, data]`. Exactly one side is `null`, so a truthiness check
 * on `error` narrows `data`.
 *
 * @example
 * ```ts
 * const [error, user] = await api.getUser.safe({ params: { id: 1 } });
 * if (error) return handle(error); // error: RouteError
 * user.login; // user: { id: number; login: string }
 * ```
 */
export type Result<T, E = RouteError> =
  readonly [error: null, data: T] | readonly [error: E, data: null];

/** Build a successful {@link Result}. */
export function ok<T>(data: T): Result<T, never> {
  return [null, data];
}

/** Build a failed {@link Result}. */
export function err<E>(error: E): Result<never, E> {
  return [error, null];
}

/**
 * Turn a promise into a {@link Result}, normalising whatever it rejects with into a
 * {@link RouteError}. Route callers expose this directly as `caller.safe(...)`.
 */
export async function toResult<T>(promise: Promise<T>, route = 'unknown'): Promise<Result<T>> {
  try {
    return ok(await promise);
  } catch (error) {
    return err(toRouteError(error, route));
  }
}

// ---------------------------------------------------------------------------
// Tag based matching
// ---------------------------------------------------------------------------

type TagOf<E> = E extends { readonly _tag: infer Tag extends string } ? Tag : never;
type ByTag<E, Tag extends string> = Extract<E, { readonly _tag: Tag }>;

/** One optional handler per tag, plus an optional `_` fallback. */
export type ErrorHandlers<E extends TaggedError> = {
  readonly [Tag in TagOf<E>]?: (error: ByTag<E, Tag>) => unknown;
} & {
  readonly _?: (error: E) => unknown;
};

/** Resolves to `unknown` when `H` is exhaustive, otherwise names the handlers that are missing. */
type MissingHandlers<E extends TaggedError, H> = '_' extends keyof H
  ? unknown
  : [Exclude<TagOf<E>, keyof H>] extends [never]
    ? unknown
    : {
        readonly [Tag in Exclude<TagOf<E>, keyof H>]: (error: ByTag<E, Tag>) => unknown;
      };

/** Union of the return types of the handlers in `H`. */
export type HandlerResult<H> = {
  [K in keyof H]: H[K] extends (...args: never[]) => infer R ? R : never;
}[keyof H];

/**
 * Dispatch on `error._tag`. Either handle every tag of `E` or provide a `_` fallback;
 * forgetting one is a compile error. Returns whatever the chosen handler returns.
 *
 * @example
 * ```ts
 * const message = matchError(error, {
 *   ApiError: (e) => (e.status === 404 ? 'Not found' : `Server said ${e.status}`),
 *   ValidationError: (e) => e.issues.map((i) => i.message).join(', '),
 *   _: (e) => e.message,
 * });
 * ```
 */
export function matchError<E extends TaggedError, const H extends ErrorHandlers<E>>(
  error: E,
  handlers: H & NoInfer<MissingHandlers<E, H>>,
): HandlerResult<H> {
  const table = handlers as Record<string, ((error: E) => unknown) | undefined>;
  const handler = table[error._tag] ?? table['_'];
  if (!handler) {
    throw error;
  }
  return handler(error) as HandlerResult<H>;
}

/**
 * Recover from one tag, rethrow everything else. Errors that are not tagged yet are
 * normalised with {@link toRouteError} first, so this also works on raw promises.
 *
 * @example
 * ```ts
 * const user = await catchTag(api.getUser({ params: { id } }), 'ApiError', (e) =>
 *   e.status === 404 ? null : Promise.reject(e),
 * );
 * ```
 */
export function catchTag<T, Tag extends RouteErrorTag, R>(
  promise: Promise<T>,
  tag: Tag,
  handler: (error: ErrorByTag<Tag>) => R | Promise<R>,
): Promise<T | R> {
  return promise.catch((raw: unknown) => {
    const error = toRouteError(raw, 'unknown');
    if (hasTag(error, tag)) return handler(error);
    throw error;
  });
}

/** Handlers for {@link catchTags}: any subset of the route error tags. */
export type RouteErrorHandlers = {
  readonly [Tag in RouteErrorTag]?: (error: ErrorByTag<Tag>) => unknown;
};

/**
 * Recover from several tags at once, rethrow the rest.
 *
 * @example
 * ```ts
 * const user = await catchTags(api.getUser({ params: { id } }), {
 *   ApiError: (e) => (e.status === 404 ? null : Promise.reject(e)),
 *   TimeoutError: () => cachedUser,
 * });
 * ```
 */
export function catchTags<T, const H extends RouteErrorHandlers>(
  promise: Promise<T>,
  handlers: H,
): Promise<T | Awaited<HandlerResult<H>>> {
  return promise.catch((raw: unknown) => {
    const error = toRouteError(raw, 'unknown');
    const table = handlers as Record<string, ((error: RouteError) => unknown) | undefined>;
    const handler = isTaggedError(error) ? table[error._tag] : undefined;
    if (handler) return handler(error) as Awaited<HandlerResult<H>>;
    throw error;
  });
}
