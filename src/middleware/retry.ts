import type { AdapterRequest, AdapterResponse, HttpMethod } from '../adapters/types.js';
import type { Middleware } from './types.js';

/** What the retry decision and delay functions receive. */
export interface RetryContext {
  request: AdapterRequest;
  /** Attempt that just failed, starting at 1. */
  attempt: number;
  /** Present when the attempt produced a response (with a retryable status). */
  response?: AdapterResponse;
  /** Present when the attempt threw (network error, timeout...). */
  error?: unknown;
}

/** Retry configuration. Every field is optional. */
export interface RetryOptions {
  /** Total number of attempts including the first one. Defaults to `3`. */
  attempts?: number;
  /**
   * Delay before the next attempt in ms, or a function computing it.
   * Defaults to exponential backoff with jitter (300ms, 600ms, 1200ms... capped at 10s).
   */
  delay?: number | ((context: RetryContext) => number);
  /** Statuses that trigger a retry. Defaults to `408, 425, 429, 500, 502, 503, 504`. */
  statuses?: readonly number[];
  /** Methods allowed to retry. Defaults to the idempotent ones: `GET, HEAD, PUT, DELETE, OPTIONS`. */
  methods?: readonly HttpMethod[];
  /** Honour the `Retry-After` response header for the delay. Defaults to `true`. */
  respectRetryAfter?: boolean;
  /**
   * Replace the default decision entirely. Call {@link defaultShouldRetry} inside to
   * extend it rather than replace it.
   */
  shouldRetry?: (context: RetryContext) => boolean | Promise<boolean>;
}

export const RETRY_DEFAULTS = {
  attempts: 3,
  statuses: [408, 425, 429, 500, 502, 503, 504],
  methods: ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'],
  respectRetryAfter: true,
} as const satisfies RetryOptions;

/**
 * Default decision: retry idempotent methods with a replayable body when the attempt
 * threw (and the caller did not abort) or answered with a retryable status.
 */
export function defaultShouldRetry(context: RetryContext, options: RetryOptions = {}): boolean {
  const { request, response } = context;
  if (request.signal?.aborted) return false;
  if (!(options.methods ?? RETRY_DEFAULTS.methods).includes(request.method)) return false;
  if (!isReplayable(request.body)) return false;
  if (response) return (options.statuses ?? RETRY_DEFAULTS.statuses).includes(response.status);
  return true;
}

/** Retry failed attempts according to `options`. Place it outside the timeout middleware. */
export function retryMiddleware(options: RetryOptions = {}): Middleware {
  const attempts = Math.max(1, Math.floor(options.attempts ?? RETRY_DEFAULTS.attempts));
  const decide = options.shouldRetry ?? ((context) => defaultShouldRetry(context, options));

  return async (request, next, middlewareContext) => {
    for (let attempt = 1; ; attempt++) {
      middlewareContext.attempt = attempt;

      let response: AdapterResponse;
      try {
        response = await next(request);
      } catch (error) {
        const context: RetryContext = { request, attempt, error };
        if (attempt >= attempts || !(await decide(context))) throw error;
        await sleep(computeDelay(context, options), request.signal);
        continue;
      }

      const context: RetryContext = { request, attempt, response };
      if (attempt >= attempts || !(await decide(context))) return response;
      await sleep(computeDelay(context, options), request.signal);
    }
  };
}

function isReplayable(body: unknown): boolean {
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

function computeDelay(context: RetryContext, options: RetryOptions): number {
  if (options.respectRetryAfter ?? RETRY_DEFAULTS.respectRetryAfter) {
    const retryAfter = parseRetryAfter(context.response?.headers['retry-after']);
    if (retryAfter !== undefined) return retryAfter;
  }
  const { delay } = options;
  if (typeof delay === 'number') return Math.max(0, delay);
  if (typeof delay === 'function') return Math.max(0, delay(context));
  const base = Math.min(300 * 2 ** (context.attempt - 1), 10_000);
  return Math.round(base * (0.5 + Math.random()));
}

/** Parse a `Retry-After` header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortReason(signal));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError');
}
