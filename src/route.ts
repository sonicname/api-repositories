import type { HttpMethod, ResponseType } from './adapters/types.js';
import type { AnySchema, StandardSchemaV1 } from './standard-schema.js';

/** A schema slot: either a Standard Schema or nothing. */
export type SchemaOrUndefined = AnySchema | undefined;

/**
 * Declaration of a single API endpoint.
 *
 * @typeParam TPath - Literal path, e.g. `"/users/:username"`. Path params are inferred from it.
 * @typeParam TParams - Schema for path params. When omitted they are inferred from `TPath`.
 * @typeParam TQuery - Schema for the query string.
 * @typeParam TBody - Schema for the request body.
 * @typeParam TResponse - Schema for the response body. Its output type is what the caller receives.
 * @typeParam TResponseType - How the adapter should parse the response body.
 */
export interface RouteDefinition<
  TPath extends string = string,
  TParams extends SchemaOrUndefined = SchemaOrUndefined,
  TQuery extends SchemaOrUndefined = SchemaOrUndefined,
  TBody extends SchemaOrUndefined = SchemaOrUndefined,
  TResponse extends SchemaOrUndefined = SchemaOrUndefined,
  TResponseType extends ResponseType = ResponseType,
> {
  method: HttpMethod;
  /** Path relative to the repository `baseUrl`. Use `:name` segments for path params. */
  path: TPath;
  /** Schema validating path params. Optional, inferred from `path` when omitted. */
  params?: TParams;
  /** Schema validating the query string. */
  query?: TQuery;
  /** Schema validating the request body. */
  body?: TBody;
  /** Schema validating (and typing) the response body. */
  response?: TResponse;
  /** Response parsing strategy, defaults to `"json"`. */
  responseType?: TResponseType;
  /** Static headers sent with every call of this route. */
  headers?: Record<string, string>;
  /** Adapter specific options (axios config, ofetch options, RequestInit...). */
  options?: Record<string, unknown>;
}

/** Any route, regardless of its generics. */
export type AnyRoute = RouteDefinition;

/** A named collection of routes. */
export type RouteMap = Record<string, AnyRoute>;

/**
 * Declare an endpoint. The returned object is the same you pass in, but with all
 * literal types preserved so the repository can infer inputs and outputs.
 *
 * @example
 * ```ts
 * const getUser = createRoute({
 *   method: 'GET',
 *   path: '/users/:username',
 *   response: z.object({ id: z.number(), login: z.string() }),
 * });
 * ```
 */
export function createRoute<
  TPath extends string,
  TParams extends SchemaOrUndefined = undefined,
  TQuery extends SchemaOrUndefined = undefined,
  TBody extends SchemaOrUndefined = undefined,
  TResponse extends SchemaOrUndefined = undefined,
  TResponseType extends ResponseType = 'json',
>(
  definition: RouteDefinition<TPath, TParams, TQuery, TBody, TResponse, TResponseType>,
): RouteDefinition<TPath, TParams, TQuery, TBody, TResponse, TResponseType> {
  return definition;
}

// ---------------------------------------------------------------------------
// Type inference helpers
// ---------------------------------------------------------------------------

/** Flattens intersections so hover tooltips are readable. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Names of `:param` segments in a path literal. */
export type PathParamNames<TPath extends string> =
  TPath extends `${string}:${infer Param}/${infer Rest}`
    ? Param | PathParamNames<`/${Rest}`>
    : TPath extends `${string}:${infer Param}`
      ? Param
      : never;

/** Object type for the `:param` segments of a path, or `never` if it has none. */
export type PathParams<TPath extends string> = [PathParamNames<TPath>] extends [never]
  ? never
  : { [K in PathParamNames<TPath>]: string | number };

type SchemaOf<S> = [NonNullable<S>] extends [never]
  ? undefined
  : NonNullable<S> extends AnySchema
    ? NonNullable<S>
    : undefined;

type InputOf<S, Fallback = never> =
  SchemaOf<S> extends AnySchema ? StandardSchemaV1.InferInput<SchemaOf<S>> : Fallback;

type OutputOf<S, Fallback = never> =
  SchemaOf<S> extends AnySchema ? StandardSchemaV1.InferOutput<SchemaOf<S>> : Fallback;

/** Keys of `T` that are not optional. */
export type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K;
}[keyof T];

/**
 * Builds `{ [K]: T }`, `{ [K]?: T }` or `{}` depending on whether `T` is `never`,
 * has required keys, or only optional keys.
 */
type Field<K extends string, T> = [T] extends [never]
  ? Record<never, never>
  : T extends object
    ? [RequiredKeys<T>] extends [never]
      ? { [P in K]?: T }
      : { [P in K]: T }
    : { [P in K]: T };

/** Path params accepted by a route: schema input, or inferred from the path. */
export type RouteParams<R extends AnyRoute> = InputOf<R['params'], PathParams<R['path']>>;

/** Query accepted by a route, or `never` when it has no query schema. */
export type RouteQuery<R extends AnyRoute> = InputOf<R['query']>;

/** Body accepted by a route, or `never` when it has no body schema. */
export type RouteBody<R extends AnyRoute> = InputOf<R['body']>;

/** Options every call accepts in addition to params/query/body. */
export interface CallOptions {
  /** Extra headers merged over repository and route headers. */
  headers?: Record<string, string>;
  /** Abort the request. */
  signal?: AbortSignal;
  /** Adapter specific options merged over repository and route options. */
  options?: Record<string, unknown>;
}

/** The single argument a route caller accepts. */
export type RouteInput<R extends AnyRoute> = Simplify<
  Field<'params', RouteParams<R>> &
    Field<'query', RouteQuery<R>> &
    Field<'body', RouteBody<R>> &
    CallOptions
>;

/** Argument tuple for a route caller: the input becomes optional when nothing in it is required. */
export type RouteArgs<R extends AnyRoute> = [RequiredKeys<RouteInput<R>>] extends [never]
  ? [input?: RouteInput<R>]
  : [input: RouteInput<R>];

type ParsedBody<R extends AnyRoute> =
  NonNullable<R['responseType']> extends 'text'
    ? string
    : NonNullable<R['responseType']> extends 'blob'
      ? Blob
      : NonNullable<R['responseType']> extends 'arrayBuffer'
        ? ArrayBuffer
        : NonNullable<R['responseType']> extends 'none'
          ? undefined
          : unknown;

/** What a route caller resolves with: the response schema output, or the raw parsed body. */
export type RouteOutput<R extends AnyRoute> = OutputOf<R['response'], ParsedBody<R>>;

/** Full response returned by `caller.raw()`. */
export interface RouteResponse<TData> {
  data: TData;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

/** Callable produced for each route of a built repository. */
export interface RouteCaller<R extends AnyRoute> {
  /** Perform the request and resolve with the (validated) response body. */
  (...args: RouteArgs<R>): Promise<RouteOutput<R>>;
  /** Perform the request and resolve with status, headers and body. */
  raw(...args: RouteArgs<R>): Promise<RouteResponse<RouteOutput<R>>>;
  /** The route definition this caller was built from. */
  readonly definition: R;
}
