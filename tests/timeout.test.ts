import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRepository, createRoute, TimeoutError, timeoutMiddleware } from '../src/index.js';
import type { Adapter, AdapterRequest, AdapterResponse } from '../src/index.js';

const ok: AdapterResponse = { status: 200, statusText: '', headers: {}, data: 'ok' };

/** Adapter that resolves after `delay` ms unless its signal aborts first. */
function slowAdapter(delay: number): Adapter {
  return {
    request: (request: AdapterRequest) =>
      new Promise<AdapterResponse>((resolve, reject) => {
        if (request.signal?.aborted) {
          reject(request.signal.reason as Error);
          return;
        }
        const timer = setTimeout(() => {
          resolve(ok);
        }, delay);
        request.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(request.signal?.reason as Error);
        });
      }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('timeoutMiddleware', () => {
  it('throws TimeoutError when the request takes too long', async () => {
    const run = timeoutMiddleware(100);
    const promise = run(
      { url: 'u', method: 'GET', headers: {}, responseType: 'json' },
      (request) => slowAdapter(1000).request(request),
      { route: 'slow', attempt: 1 },
    );
    const assertion = expect(promise).rejects.toMatchObject({
      name: 'TimeoutError',
      route: 'slow',
      timeout: 100,
    });

    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('resolves normally when the request is fast enough', async () => {
    const run = timeoutMiddleware(100);
    const promise = run(
      { url: 'u', method: 'GET', headers: {}, responseType: 'json' },
      (request) => slowAdapter(10).request(request),
      { route: 'fast', attempt: 1 },
    );

    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toBe(ok);
  });

  it('forwards a caller abort and keeps its reason', async () => {
    const controller = new AbortController();
    const run = timeoutMiddleware(1000);
    const promise = run(
      { url: 'u', method: 'GET', headers: {}, responseType: 'json', signal: controller.signal },
      (request) => slowAdapter(500).request(request),
      { route: 'r', attempt: 1 },
    );
    const assertion = expect(promise).rejects.toThrow('user cancelled');

    controller.abort(new Error('user cancelled'));
    await assertion;
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already'));
    const run = timeoutMiddleware(1000);

    await expect(
      run(
        { url: 'u', method: 'GET', headers: {}, responseType: 'json', signal: controller.signal },
        (request) => slowAdapter(500).request(request),
        { route: 'r', attempt: 1 },
      ),
    ).rejects.toThrow('already');
  });
});

describe('timeout policy resolution', () => {
  const route = createRoute({ method: 'GET', path: '/x' });

  it('applies the repository timeout and reports it through onError', async () => {
    const errors: unknown[] = [];
    const api = createRepository({
      baseUrl: 'https://a.com',
      adapter: slowAdapter(1000),
      timeout: 50,
      hooks: {
        onError: ({ error }) => {
          errors.push(error);
        },
      },
    })
      .mergeAll({ route })
      .build();

    const assertion = expect(api.route()).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(errors[0]).toBeInstanceOf(TimeoutError);
  });

  it('lets a route disable it and a call override it', async () => {
    const api = createRepository({
      baseUrl: 'https://a.com',
      adapter: slowAdapter(200),
      timeout: 50,
    })
      .mergeAll({ route: createRoute({ method: 'GET', path: '/x', timeout: false }) })
      .build();

    const untouched = api.route();
    await vi.advanceTimersByTimeAsync(200);
    await expect(untouched).resolves.toBe('ok');

    const overridden = expect(api.route({ timeout: 20 })).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(20);
    await overridden;
  });
});
