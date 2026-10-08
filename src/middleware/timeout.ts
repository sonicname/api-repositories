import { TimeoutError } from '../errors.js';
import type { Middleware } from './types.js';

/**
 * Abort the request after `ms` milliseconds. The timeout applies to each attempt
 * individually when combined with the retry middleware. A caller-provided `signal`
 * keeps working: whichever aborts first wins.
 */
export function timeoutMiddleware(ms: number): Middleware {
  return async (request, next, context) => {
    const controller = new AbortController();
    const outer = request.signal;
    const state = { timedOut: false };

    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort(new TimeoutError(context.route, ms));
    }, ms);

    const forwardAbort = (): void => {
      controller.abort(outer?.reason);
    };
    if (outer?.aborted) forwardAbort();
    else outer?.addEventListener('abort', forwardAbort, { once: true });

    try {
      return await next({ ...request, signal: controller.signal });
    } catch (error) {
      if (state.timedOut) throw new TimeoutError(context.route, ms);
      throw error;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', forwardAbort);
    }
  };
}
