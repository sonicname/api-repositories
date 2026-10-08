/**
 * Refresh-on-401 middleware.
 *
 * - Retries the request once with the new token when the server answers 401.
 * - Deduplicates refreshes: concurrent 401s share a single refresh call.
 * - Skips requests that already used the fresh token (a 401 with the new token means the
 *   session is really gone), so there is no refresh loop.
 */
import type { Middleware } from '../src/index.js';

export interface RefreshOn401Options {
  /** Current access token, or `null` when signed out. */
  getToken: () => string | null;
  /** Obtain a new access token. Resolve `null` when refreshing is impossible. */
  refresh: () => Promise<string | null>;
  /** Called once when refreshing fails (typically: sign the user out). */
  onRefreshFailed?: () => void | Promise<void>;
  /** Header carrying the token. Defaults to `authorization`. */
  header?: string;
  /** Build the header value from the token. Defaults to `Bearer <token>`. */
  format?: (token: string) => string;
}

export function refreshOn401(options: RefreshOn401Options): Middleware {
  const header = options.header ?? 'authorization';
  const format = options.format ?? ((token: string) => `Bearer ${token}`);
  let inflight: Promise<string | null> | null = null;

  const refreshOnce = (): Promise<string | null> => {
    inflight ??= options
      .refresh()
      .catch(() => null)
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return async (request, next) => {
    const tokenUsed = options.getToken();
    const response = await next(request);
    if (response.status !== 401) return response;

    // Another request already refreshed while this one was in flight: just replay.
    const current = options.getToken();
    const token = current !== null && current !== tokenUsed ? current : await refreshOnce();

    if (token === null) {
      await options.onRefreshFailed?.();
      return response; // the repository turns this 401 into UnauthorizedError / ApiError
    }

    return next({ ...request, headers: { ...request.headers, [header]: format(token) } });
  };
}
