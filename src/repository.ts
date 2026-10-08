import { fetchAdapter } from './adapters/fetch.js';
import type { Adapter, AdapterRequest, AdapterResponse } from './adapters/types.js';
import { ApiError, ValidationError } from './errors.js';
import type { ValidationTarget } from './errors.js';
import type {
  AnyRoute,
  RouteArgs,
  ParamsSpec,
  RouteCaller,
  RouteMap,
  RouteOutput,
  RouteResponse,
  Simplify,
} from './route.js';
import type { AnySchema, StandardSchemaV1 } from './standard-schema.js';
import { buildUrl } from './url.js';

/** Headers shared by every request: a static map or a (possibly async) factory, handy for auth tokens. */
export type HeadersProvider =
  Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

/** Lifecycle hooks invoked around every request. */
export interface RepositoryHooks {
  /** Called right before the adapter is invoked. Mutating `request` is allowed. */
  onRequest?: (context: { route: string; request: AdapterRequest }) => void | Promise<void>;
  /** Called after the adapter answers, before status and schema checks. */
  onResponse?: (context: {
    route: string;
    request: AdapterRequest;
    response: AdapterResponse;
  }) => void | Promise<void>;
  /** Called when the call fails for any reason (network, status, validation). */
  onError?: (context: {
    route: string;
    request: AdapterRequest | undefined;
    error: unknown;
  }) => void | Promise<void>;
}

/** Configuration shared by all routes of a repository. */
export interface RepositoryConfig {
  /** Base URL prepended to every route path. */
  baseUrl: string;
  /** Transport. Defaults to {@link fetchAdapter}. */
  adapter?: Adapter;
  /** Headers sent with every request. */
  headers?: HeadersProvider;
  /** Adapter specific options merged into every request. */
  options?: Record<string, unknown>;
  /** Validate response bodies against their `response` schema. Defaults to `true`. */
  validateResponse?: boolean;
  /** Decide whether a status code is a success. Defaults to `200 <= status < 300`. */
  isSuccess?: (status: number) => boolean;
  hooks?: RepositoryHooks;
}

/** The object returned by `build()`: one caller per route plus a few `$`-prefixed extras. */
export type RepositoryClient<TRoutes extends RouteMap> = {
  readonly [K in keyof TRoutes]: RouteCaller<TRoutes[K]>;
} & {
  /** Resolved configuration this client was built with. */
  readonly $config: Readonly<RepositoryConfig>;
  /** Route definitions keyed by name. */
  readonly $routes: Readonly<TRoutes>;
};

/** Fluent builder returned by {@link createRepository}. */
export class RepositoryBuilder<TRoutes extends RouteMap = Record<never, never>> {
  readonly #config: RepositoryConfig;
  readonly #routes: TRoutes;

  constructor(config: RepositoryConfig, routes: TRoutes) {
    this.#config = config;
    this.#routes = routes;
  }

  /** Register a single named route. */
  addRoute<TName extends string, TRoute extends AnyRoute>(
    name: TName,
    route: TRoute,
  ): RepositoryBuilder<Simplify<TRoutes & { [K in TName]: TRoute }>> {
    return new RepositoryBuilder(this.#config, {
      ...this.#routes,
      [name]: route,
    });
  }

  /** Register several routes at once, keyed by the object's property names. */
  mergeAll<TMore extends RouteMap>(routes: TMore): RepositoryBuilder<Simplify<TRoutes & TMore>> {
    return new RepositoryBuilder(this.#config, {
      ...this.#routes,
      ...routes,
    });
  }

  /** Produce the typed client. */
  build(): RepositoryClient<TRoutes> {
    const config: RepositoryConfig = {
      ...this.#config,
      adapter: this.#config.adapter ?? fetchAdapter(),
    };
    const routes = { ...this.#routes };

    const client: Record<string, unknown> = {
      $config: Object.freeze(config),
      $routes: Object.freeze(routes),
    };

    for (const [name, route] of Object.entries(routes)) {
      client[name] = createCaller(name, route, config);
    }

    return client as RepositoryClient<TRoutes>;
  }
}

/**
 * Start declaring a repository: a base URL, a transport and a set of routes.
 *
 * @example
 * ```ts
 * const github = createRepository({ baseUrl: 'https://api.github.com' })
 *   .mergeAll({ getUser, listRepos })
 *   .build();
 *
 * const user = await github.getUser({ params: { username: 'octocat' } });
 * ```
 */
export function createRepository(config: RepositoryConfig): RepositoryBuilder {
  return new RepositoryBuilder(config, {});
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function createCaller<R extends AnyRoute>(
  name: string,
  route: R,
  config: RepositoryConfig,
): RouteCaller<R> {
  const raw = (...args: RouteArgs<R>): Promise<RouteResponse<RouteOutput<R>>> =>
    execute(name, route, config, (args[0] ?? {}) as unknown as LooseInput) as Promise<
      RouteResponse<RouteOutput<R>>
    >;

  const caller = (...args: RouteArgs<R>): Promise<RouteOutput<R>> =>
    raw(...args).then((response) => response.data);

  return Object.assign(caller, { raw, definition: route });
}

interface LooseInput {
  params?: Record<string, unknown>;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  options?: Record<string, unknown>;
}

async function execute(
  name: string,
  route: AnyRoute,
  config: RepositoryConfig,
  input: LooseInput,
): Promise<RouteResponse<unknown>> {
  const hooks = config.hooks ?? {};
  let request: AdapterRequest | undefined;

  try {
    const params = await validateParams(name, route.params, input.params);
    const query = await validate(name, 'query', route.query, input.query);
    const body = await validate(name, 'body', route.body, input.body);

    const baseHeaders =
      typeof config.headers === 'function' ? await config.headers() : config.headers;

    request = {
      url: buildUrl(config.baseUrl, route.path, params, query),
      method: route.method,
      headers: { ...baseHeaders, ...route.headers, ...input.headers },
      responseType: route.responseType ?? 'json',
      signal: input.signal,
      options: { ...config.options, ...route.options, ...input.options },
    };
    if (body !== undefined) request.body = body;

    await hooks.onRequest?.({ route: name, request });

    const adapter = config.adapter ?? fetchAdapter();
    const response = await adapter.request(request);

    await hooks.onResponse?.({ route: name, request, response });

    const isSuccess = config.isSuccess ?? defaultIsSuccess;
    if (!isSuccess(response.status)) {
      throw new ApiError(
        response.status,
        response.data,
        name,
        response.headers,
        response.statusText,
      );
    }

    const data =
      config.validateResponse === false
        ? response.data
        : await validate(name, 'response', route.response, response.data);

    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  } catch (error) {
    await hooks.onError?.({ route: name, request, error });
    throw error;
  }
}

function defaultIsSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

async function validate(
  routeName: string,
  target: ValidationTarget,
  schema: AnySchema | undefined,
  value: unknown,
): Promise<unknown> {
  if (!schema) return value;
  const result = await schema['~standard'].validate(value);
  if (result.issues) {
    throw new ValidationError(target, result.issues, routeName);
  }
  return result.value;
}

function isSchema(value: unknown): value is AnySchema {
  return typeof value === 'object' && value !== null && '~standard' in value;
}

/**
 * Validate path params against either a whole-object schema or a per-key map.
 * Params without a schema pass through untouched.
 */
async function validateParams(
  routeName: string,
  spec: ParamsSpec<string>,
  value: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> {
  if (spec === undefined) return value;
  if (isSchema(spec)) {
    return (await validate(routeName, 'params', spec, value)) as
      Record<string, unknown> | undefined;
  }

  const result: Record<string, unknown> = { ...value };
  const map = spec as Record<string, unknown>;
  for (const key of Object.keys(map)) {
    const schema = map[key];
    if (!isSchema(schema)) continue;
    const outcome = await schema['~standard'].validate(value?.[key]);
    if (outcome.issues) {
      const issues: StandardSchemaV1.Issue[] = outcome.issues.map((issue) => ({
        message: issue.message,
        path: [key, ...(issue.path ?? [])],
      }));
      throw new ValidationError('params', issues, routeName);
    }
    result[key] = outcome.value;
  }
  return result;
}
