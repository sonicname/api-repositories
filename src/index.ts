/**
 * Declare backend endpoints once, get a fully typed client.
 *
 * @packageDocumentation
 */

export { createRoute } from './route.js';
export type {
  AnyRoute,
  CallOptions,
  MethodRouteFactory,
  RouteOptions,
  PathParamNames,
  PathParams,
  ParamsSchemaMap,
  ParamsSpec,
  ValidateParams,
  RouteArgs,
  RouteBody,
  RouteCaller,
  RouteDefinition,
  RouteInput,
  RouteMap,
  RouteOutput,
  RouteParams,
  RouteQuery,
  RouteResponse,
  SchemaOrUndefined,
} from './route.js';

export { createRepository, RepositoryBuilder } from './repository.js';
export type {
  HeadersProvider,
  RepositoryCacheOptions,
  RepositoryClient,
  RepositoryConfig,
  RepositoryHooks,
} from './repository.js';

export {
  AbortError,
  ApiError,
  NetworkError,
  TaggedError,
  TimeoutError,
  UnknownError,
  ValidationError,
  hasTag,
  isTaggedError,
  toRouteError,
} from './errors.js';
export type { ErrorByTag, RouteError, RouteErrorTag, ValidationTarget } from './errors.js';
export { catchTag, catchTags, err, matchError, ok, toResult } from './result.js';
export type { ErrorHandlers, HandlerResult, Result, RouteErrorHandlers } from './result.js';

export { fetchAdapter } from './adapters/fetch.js';
export type { FetchAdapterOptions } from './adapters/fetch.js';
export { axiosAdapter } from './adapters/axios.js';
export type { AxiosLike } from './adapters/axios.js';
export { ofetchAdapter } from './adapters/ofetch.js';
export type { OfetchLike } from './adapters/ofetch.js';
export type {
  Adapter,
  AdapterRequest,
  AdapterResponse,
  HttpMethod,
  ResponseType,
} from './adapters/types.js';

export type { AnySchema, StandardSchemaV1 } from './standard-schema.js';
export { buildQueryString, buildUrl, interpolatePath, joinUrl, toStringValue } from './url.js';

export { composeMiddlewares } from './middleware/types.js';
export type { Middleware, MiddlewareContext, NextFunction } from './middleware/types.js';
export { timeoutMiddleware } from './middleware/timeout.js';
export {
  RETRY_DEFAULTS,
  defaultShouldRetry,
  parseRetryAfter,
  retryMiddleware,
} from './middleware/retry.js';
export type { RetryContext, RetryOptions } from './middleware/retry.js';
export {
  MemoryCacheStorage,
  cacheMiddleware,
  createCacheController,
  defaultCacheKey,
} from './middleware/cache.js';
export type {
  CacheController,
  CacheEntry,
  CacheOptions,
  CacheStorage,
} from './middleware/cache.js';
export { resolvePolicy, resolveTimeout } from './policy.js';
export { groupRoutes } from './group.js';
export type { GroupOptions, GroupedRoutes, PrefixedRoute } from './group.js';
export type { PolicyInput } from './policy.js';
