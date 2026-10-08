import type { StandardSchemaV1 } from './standard-schema.js';

/**
 * Base class of every error this library produces. The `_tag` discriminant makes
 * narrowing trivial: `if (error._tag === 'ApiError')`, `hasTag(error, 'ApiError')`,
 * `matchError(error, { ApiError: ..., _: ... })`.
 *
 * Extend it in your own middlewares to add tags of your own; they pass through
 * untouched and reach `matchError`'s `_` fallback.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- Tag is the discriminant subclasses pin down
export abstract class TaggedError<Tag extends string = string> extends Error {
  abstract readonly _tag: Tag;
}

/** Where a validation failure happened. */
export type ValidationTarget = 'params' | 'query' | 'body' | 'response';

/** Thrown when request input or the response body does not match its schema. */
export class ValidationError extends TaggedError<'ValidationError'> {
  readonly _tag = 'ValidationError';
  override readonly name = 'ValidationError';

  constructor(
    /** Which part of the request/response failed validation. */
    readonly target: ValidationTarget,
    /** Issues reported by the schema library. */
    readonly issues: readonly StandardSchemaV1.Issue[],
    /** Name of the route that was being called. */
    readonly route: string,
  ) {
    super(`Validation failed for ${target} of route "${route}": ${formatIssues(issues)}`);
  }
}

/** Thrown when the server answers with a non-successful status code. */
export class ApiError<TData = unknown> extends TaggedError<'ApiError'> {
  readonly _tag = 'ApiError';
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    /** Parsed response body, if any. */
    readonly data: TData,
    /** Name of the route that was being called. */
    readonly route: string,
    readonly headers: Record<string, string> = {},
    readonly statusText = '',
  ) {
    super(
      `Request to route "${route}" failed with status ${String(status)}${statusText ? ` ${statusText}` : ''}`,
    );
  }
}

/** Thrown when an attempt exceeds the configured timeout. */
export class TimeoutError extends TaggedError<'TimeoutError'> {
  readonly _tag = 'TimeoutError';
  override readonly name = 'TimeoutError';

  constructor(
    /** Name of the route that was being called. */
    readonly route: string,
    /** The timeout that was exceeded, in ms. */
    readonly timeout: number,
  ) {
    super(`Request to route "${route}" timed out after ${String(timeout)}ms`);
  }
}

/** Thrown when the caller aborted the request through its `signal`. */
export class AbortError extends TaggedError<'AbortError'> {
  readonly _tag = 'AbortError';
  override readonly name = 'AbortError';

  constructor(
    /** Name of the route that was being called. */
    readonly route: string,
    /** The original abort reason. */
    override readonly cause?: unknown,
  ) {
    super(`Request to route "${route}" was aborted`, { cause });
  }
}

/** Thrown when the transport could not reach the server (DNS, connection, CORS...). */
export class NetworkError extends TaggedError<'NetworkError'> {
  readonly _tag = 'NetworkError';
  override readonly name = 'NetworkError';

  constructor(
    /** Name of the route that was being called. */
    readonly route: string,
    /** The error thrown by the adapter. */
    override readonly cause: unknown,
  ) {
    super(`Request to route "${route}" failed: ${messageOf(cause)}`, { cause });
  }
}

/** Wraps anything else thrown during a call (a middleware bug, a URL building error...). */
export class UnknownError extends TaggedError<'UnknownError'> {
  readonly _tag = 'UnknownError';
  override readonly name = 'UnknownError';

  constructor(
    /** Name of the route that was being called. */
    readonly route: string,
    /** The original value that was thrown. */
    override readonly cause: unknown,
  ) {
    super(messageOf(cause), { cause });
  }
}

/** Every error a route call can reject with. */
export type RouteError =
  ApiError | ValidationError | TimeoutError | AbortError | NetworkError | UnknownError;

/** The `_tag` values of {@link RouteError}. */
export type RouteErrorTag = RouteError['_tag'];

/** The {@link RouteError} member carrying `Tag`. */
export type ErrorByTag<Tag extends RouteErrorTag> = Extract<RouteError, { _tag: Tag }>;

/** `true` for any {@link TaggedError}, including user-defined ones. */
export function isTaggedError(value: unknown): value is TaggedError {
  return value instanceof TaggedError;
}

/** Type guard on the `_tag` of a {@link RouteError}. */
export function hasTag<Tag extends RouteErrorTag>(
  error: unknown,
  tag: Tag,
): error is ErrorByTag<Tag> {
  return isTaggedError(error) && error._tag === tag;
}

/**
 * Normalise anything thrown during a route call into a {@link RouteError}.
 * Tagged errors pass through, aborts become {@link AbortError}, transport failures
 * become {@link NetworkError}, everything else {@link UnknownError}.
 */
export function toRouteError(error: unknown, route: string): RouteError {
  if (isTaggedError(error)) return error as RouteError;
  if (isAbort(error)) return new AbortError(route, error);
  if (isNetworkFailure(error)) return new NetworkError(route, error);
  return new UnknownError(route, error);
}

function isAbort(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return name === 'AbortError' || name === 'CanceledError' || code === 'ERR_CANCELED';
}

const NETWORK_CODES = new Set([
  'ERR_NETWORK',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const NETWORK_MESSAGES =
  /fetch failed|failed to fetch|networkerror|network request failed|load failed/i;

function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code, message, cause } = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (typeof code === 'string' && NETWORK_CODES.has(code)) return true;
  if (name === 'TypeError' && typeof message === 'string' && NETWORK_MESSAGES.test(message)) {
    return true;
  }
  // undici wraps the socket error in `cause`
  return cause !== undefined && cause !== error && isNetworkFailure(cause);
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value) as string | undefined;
    return json ?? 'undefined';
  } catch {
    return 'Unknown error';
  }
}

function formatIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) => (typeof segment === 'object' ? String(segment.key) : String(segment)))
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
