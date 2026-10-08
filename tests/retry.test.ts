import { describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  createRepository,
  createRoute,
  defaultShouldRetry,
  parseRetryAfter,
  retryMiddleware,
} from '../src/index.js';
import type { Adapter, AdapterRequest, AdapterResponse, RetryContext } from '../src/index.js';

const res = (status: number, headers: Record<string, string> = {}): AdapterResponse => ({
  status,
  statusText: '',
  headers,
  data: { status },
});

const req = (overrides: Partial<AdapterRequest> = {}): AdapterRequest => ({
  url: 'https://a.com/x',
  method: 'GET',
  headers: {},
  responseType: 'json',
  ...overrides,
});

/** Adapter answering with a scripted sequence of responses or errors. */
function scripted(steps: (AdapterResponse | Error)[]): Adapter & { calls: number } {
  const adapter = {
    calls: 0,
    request: () => {
      const step = steps[adapter.calls++];
      if (!step) throw new Error('script exhausted');
      return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
    },
  };
  return adapter;
}

describe('retryMiddleware', () => {
  it('retries retryable statuses up to attempts and returns the last response', async () => {
    const adapter = scripted([res(503), res(502), res(500)]);
    const run = retryMiddleware({ attempts: 3, delay: 0 });

    const response = await run(req(), adapter.request, { route: 'r', attempt: 1 });

    expect(response.status).toBe(500);
    expect(adapter.calls).toBe(3);
  });

  it('stops as soon as an attempt succeeds and updates context.attempt', async () => {
    const adapter = scripted([new Error('network'), res(503), res(200)]);
    const context = { route: 'r', attempt: 1 };
    const run = retryMiddleware({ attempts: 5, delay: 0 });

    const response = await run(req(), adapter.request, context);

    expect(response.status).toBe(200);
    expect(adapter.calls).toBe(3);
    expect(context.attempt).toBe(3);
  });

  it('rethrows the last error when attempts are exhausted', async () => {
    const adapter = scripted([new Error('one'), new Error('two')]);
    const run = retryMiddleware({ attempts: 2, delay: 0 });

    await expect(run(req(), adapter.request, { route: 'r', attempt: 1 })).rejects.toThrow('two');
  });

  it('does not retry non-idempotent methods by default, but can be told to', async () => {
    const post = scripted([res(503), res(200)]);
    await retryMiddleware({ delay: 0 })(req({ method: 'POST' }), post.request, {
      route: 'r',
      attempt: 1,
    });
    expect(post.calls).toBe(1);

    const forced = scripted([res(503), res(200)]);
    await retryMiddleware({ delay: 0, methods: ['POST'] })(
      req({ method: 'POST' }),
      forced.request,
      {
        route: 'r',
        attempt: 1,
      },
    );
    expect(forced.calls).toBe(2);
  });

  it('does not retry non-retryable statuses', async () => {
    const adapter = scripted([res(404), res(200)]);
    await retryMiddleware({ delay: 0 })(req(), adapter.request, { route: 'r', attempt: 1 });
    expect(adapter.calls).toBe(1);
  });

  it('honours Retry-After and a delay function', async () => {
    vi.useFakeTimers();
    try {
      const delay = vi.fn((_context: RetryContext) => 500);
      const adapter = scripted([res(429, { 'retry-after': '1' }), res(503), res(200)]);
      const promise = retryMiddleware({ delay })(req(), adapter.request, {
        route: 'r',
        attempt: 1,
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(adapter.calls).toBe(1); // still waiting on Retry-After (1s)
      await vi.advanceTimersByTimeAsync(1);
      expect(adapter.calls).toBe(2);
      await vi.advanceTimersByTimeAsync(500); // delay() for the second retry
      expect(adapter.calls).toBe(3);
      await expect(promise).resolves.toMatchObject({ status: 200 });
      expect(delay).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses exponential backoff by default', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const adapter = scripted([res(503), res(503), res(200)]);
      const promise = retryMiddleware()(req(), adapter.request, { route: 'r', attempt: 1 });

      await vi.advanceTimersByTimeAsync(299);
      expect(adapter.calls).toBe(1);
      await vi.advanceTimersByTimeAsync(1); // 300ms * (0.5 + 0.5)
      expect(adapter.calls).toBe(2);
      await vi.advanceTimersByTimeAsync(600);
      expect(adapter.calls).toBe(3);
      await expect(promise).resolves.toMatchObject({ status: 200 });
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('stops waiting when the caller aborts during the delay', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const adapter = scripted([res(503), res(200)]);
      const promise = retryMiddleware({ delay: 1000 })(
        req({ signal: controller.signal }),
        adapter.request,
        { route: 'r', attempt: 1 },
      );
      const assertion = expect(promise).rejects.toThrow('stop');

      await vi.advanceTimersByTimeAsync(10);
      controller.abort(new Error('stop'));
      await assertion;
      expect(adapter.calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets shouldRetry replace the decision and extend the default', async () => {
    const onlyTeapot = scripted([res(418), res(200)]);
    await retryMiddleware({
      delay: 0,
      shouldRetry: (context) => context.response?.status === 418,
    })(req(), onlyTeapot.request, { route: 'r', attempt: 1 });
    expect(onlyTeapot.calls).toBe(2);

    const extended = scripted([res(503), res(418), res(200)]);
    await retryMiddleware({
      delay: 0,
      attempts: 5,
      shouldRetry: (context) => defaultShouldRetry(context) || context.response?.status === 418,
    })(req(), extended.request, { route: 'r', attempt: 1 });
    expect(extended.calls).toBe(3);
  });

  it('never retries a request whose body is a stream', () => {
    const body = new ReadableStream();
    expect(defaultShouldRetry({ request: req({ body }), attempt: 1, response: res(503) })).toBe(
      false,
    );
  });

  it('never retries once the caller aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      defaultShouldRetry({
        request: req({ signal: controller.signal }),
        attempt: 1,
        error: new Error('x'),
      }),
    ).toBe(false);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds, HTTP dates and rejects garbage', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      expect(parseRetryAfter('2')).toBe(2000);
      expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:05 GMT')).toBe(5000);
      expect(parseRetryAfter('Wed, 31 Dec 2025 00:00:00 GMT')).toBe(0);
      expect(parseRetryAfter('soon')).toBeUndefined();
      expect(parseRetryAfter(undefined)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retry policy on a repository', () => {
  it('merges repository, route and call levels', async () => {
    const adapter = scripted([res(503), res(503), res(503), res(200)]);
    const route = createRoute({ method: 'GET', path: '/x', retry: { attempts: 2 } });
    const api = createRepository({ baseUrl: 'https://a.com', adapter, retry: { delay: 0 } })
      .mergeAll({ route })
      .build();

    // route says 2 attempts, repo says delay 0 → 2 calls, then ApiError 503
    await expect(api.route()).rejects.toBeInstanceOf(ApiError);
    expect(adapter.calls).toBe(2);

    // call level bumps attempts to 5 → succeeds on the 4th response overall
    await expect(api.route({ retry: 5 })).resolves.toEqual({ status: 200 });
    expect(adapter.calls).toBe(4);
  });

  it('can be disabled per call', async () => {
    const adapter = scripted([res(503), res(200)]);
    const api = createRepository({ baseUrl: 'https://a.com', adapter, retry: { delay: 0 } })
      .mergeAll({ route: createRoute({ method: 'GET', path: '/x' }) })
      .build();

    await expect(api.route({ retry: false })).rejects.toBeInstanceOf(ApiError);
    expect(adapter.calls).toBe(1);
  });
});
