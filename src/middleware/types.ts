import type { AdapterRequest, AdapterResponse } from '../adapters/types.js';

/** Per-call information shared by every middleware in the chain. */
export interface MiddlewareContext {
  /** Name of the route being called. */
  readonly route: string;
  /** Current attempt, starting at 1. Updated by the retry middleware. */
  attempt: number;
}

/** Continues the chain with the (possibly modified) request. */
export type NextFunction = (request: AdapterRequest) => Promise<AdapterResponse>;

/**
 * A function wrapping the transport. Call `next` to continue, or return a response
 * yourself (cache hit, mock...). Throwing aborts the call.
 *
 * @example
 * ```ts
 * const logging: Middleware = async (request, next, context) => {
 *   const started = Date.now();
 *   const response = await next(request);
 *   console.log(context.route, response.status, Date.now() - started, 'ms');
 *   return response;
 * };
 * ```
 */
export type Middleware = (
  request: AdapterRequest,
  next: NextFunction,
  context: MiddlewareContext,
) => Promise<AdapterResponse>;

/** Compose middlewares left to right: the first one is the outermost. */
export function composeMiddlewares(
  middlewares: readonly Middleware[],
  terminal: NextFunction,
  context: MiddlewareContext,
): NextFunction {
  return middlewares.reduceRight<NextFunction>(
    (next, middleware) => (request) => middleware(request, next, context),
    terminal,
  );
}
