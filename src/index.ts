/**
 * Declare backend endpoints once, get a fully typed client.
 *
 * @packageDocumentation
 */

export { createRoute } from './route.js';
export type {
  AnyRoute,
  CallOptions,
  PathParamNames,
  PathParams,
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
  RepositoryClient,
  RepositoryConfig,
  RepositoryHooks,
} from './repository.js';

export { ApiError, ValidationError } from './errors.js';
export type { ValidationTarget } from './errors.js';

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
