import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiError, createRepository, createRoute, ValidationError } from '../src/index.js';
import type { Adapter, AdapterRequest } from '../src/index.js';

const BASE = 'https://api.example.com';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function mockFetch(response: Response | ((input: string, init: RequestInit) => Response)) {
  const fetchMock = vi.fn((input: string, init: RequestInit) =>
    Promise.resolve(typeof response === 'function' ? response(input, init) : response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const userSchema = z.object({ id: z.number(), login: z.string() });

const getUser = createRoute({
  method: 'GET',
  path: '/users/:username',
  response: userSchema,
});

const listRepos = createRoute({
  method: 'GET',
  path: '/users/:username/repos',
  query: z.object({
    page: z.number().int().positive().optional(),
    sort: z.enum(['created', 'updated']).optional(),
  }),
  response: z.array(z.object({ name: z.string() })),
});

const createIssue = createRoute({
  method: 'POST',
  path: '/repos/:owner/:repo/issues',
  params: z.object({ owner: z.string().min(1), repo: z.string().min(1) }),
  body: z.object({ title: z.string().min(1), labels: z.array(z.string()).default([]) }),
  response: z.object({ number: z.number() }),
});

const ping = createRoute({ method: 'GET', path: '/ping', responseType: 'text' });

describe('createRepository', () => {
  it('builds a client with one caller per route and $-extras', () => {
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getUser, listRepos }).build();

    expect(typeof api.getUser).toBe('function');
    expect(typeof api.getUser.orThrow).toBe('function');
    expect(api.getUser.definition).toBe(getUser);
    expect(api.$routes).toEqual({ getUser, listRepos });
    expect(api.$config.baseUrl).toBe(BASE);
  });

  it('supports addRoute chaining', () => {
    const api = createRepository({ baseUrl: BASE })
      .addRoute('getUser', getUser)
      .addRoute('ping', ping)
      .build();

    expect(Object.keys(api.$routes)).toEqual(['getUser', 'ping']);
  });

  it('interpolates path params and parses the JSON response', async () => {
    const fetchMock = mockFetch(jsonResponse({ id: 1, login: 'octocat', extra: true }));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getUser }).build();

    const user = await api.getUser.orThrow({ params: { username: 'octo cat' } });

    expect(user).toEqual({ id: 1, login: 'octocat' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/users/octo%20cat`);
    expect(init.method).toBe('GET');
  });

  it('serialises query params and skips undefined values', async () => {
    const fetchMock = mockFetch(jsonResponse([{ name: 'repo' }]));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ listRepos }).build();

    await api.listRepos.orThrow({
      params: { username: 'octocat' },
      query: { page: 2, sort: undefined },
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/users/octocat/repos?page=2`);
  });

  it('validates and transforms the body before sending it as JSON', async () => {
    const fetchMock = mockFetch(jsonResponse({ number: 7 }));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ createIssue }).build();

    const issue = await api.createIssue.orThrow({
      params: { owner: 'me', repo: 'proj' },
      body: { title: 'Bug' },
    });

    expect(issue).toEqual({ number: 7 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/repos/me/proj/issues`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ title: 'Bug', labels: [] }));
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('merges repository, route and call headers in that order', async () => {
    const fetchMock = mockFetch(jsonResponse({ id: 1, login: 'x' }));
    const route = createRoute({
      method: 'GET',
      path: '/users/:username',
      headers: { 'x-route': 'route', 'x-shared': 'route' },
    });
    const api = createRepository({
      baseUrl: BASE,
      headers: () => Promise.resolve({ authorization: 'Bearer token', 'x-shared': 'repo' }),
    })
      .mergeAll({ route })
      .build();

    await api.route.orThrow({ params: { username: 'a' }, headers: { 'x-call': 'call' } });

    expect(fetchMock.mock.calls[0]![1].headers).toEqual({
      authorization: 'Bearer token',
      'x-route': 'route',
      'x-shared': 'route',
      'x-call': 'call',
    });
  });

  it('makes the input optional when the route needs nothing', async () => {
    mockFetch(new Response('pong', { status: 200 }));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ ping }).build();

    await expect(api.ping.orThrow()).resolves.toBe('pong');
  });

  it('exposes status and headers through raw()', async () => {
    mockFetch(jsonResponse({ id: 1, login: 'x' }, { status: 201, headers: { 'x-id': '42' } }));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getUser }).build();

    const response = await api.getUser({ params: { username: 'x' } });
    if (!response.ok) throw response.error;

    expect(response.status).toBe(201);
    expect(response.headers['x-id']).toBe('42');
    expect(response.data).toEqual({ id: 1, login: 'x' });
  });

  it('throws ValidationError for invalid params before sending', async () => {
    const fetchMock = mockFetch(jsonResponse({}));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ createIssue }).build();

    const promise = api.createIssue.orThrow({
      params: { owner: '', repo: 'x' },
      body: { title: 't' },
    });

    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ target: 'params', route: 'createIssue' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws ValidationError when the response does not match its schema', async () => {
    mockFetch(jsonResponse({ id: 'not-a-number', login: 'x' }));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getUser }).build();

    const promise = api.getUser.orThrow({ params: { username: 'x' } });

    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({ target: 'response' });
  });

  it('can skip response validation', async () => {
    mockFetch(jsonResponse({ id: 'oops' }));
    const api = createRepository({ baseUrl: BASE, validateResponse: false })
      .mergeAll({ getUser })
      .build();

    await expect(api.getUser.orThrow({ params: { username: 'x' } })).resolves.toEqual({
      id: 'oops',
    });
  });

  it('throws ApiError on non-2xx status with the parsed body', async () => {
    mockFetch(jsonResponse({ message: 'Not Found' }, { status: 404, statusText: 'Not Found' }));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getUser }).build();

    const promise = api.getUser.orThrow({ params: { username: 'nobody' } });

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 404,
      data: { message: 'Not Found' },
      route: 'getUser',
    });
  });

  it('respects a custom isSuccess', async () => {
    mockFetch(jsonResponse({ id: 1, login: 'x' }, { status: 404 }));
    const api = createRepository({ baseUrl: BASE, isSuccess: (status) => status < 500 })
      .mergeAll({ getUser })
      .build();

    await expect(api.getUser.orThrow({ params: { username: 'x' } })).resolves.toEqual({
      id: 1,
      login: 'x',
    });
  });

  it('invokes hooks in order and reports errors', async () => {
    mockFetch(jsonResponse({ message: 'boom' }, { status: 500 }));
    const calls: string[] = [];
    const api = createRepository({
      baseUrl: BASE,
      hooks: {
        onRequest: ({ route, request }) => {
          calls.push(`request:${route}`);
          request.headers['x-hooked'] = '1';
        },
        onResponse: ({ response }) => {
          calls.push(`response:${String(response.status)}`);
        },
        onError: ({ error }) => {
          calls.push(`error:${(error as Error).name}`);
        },
      },
    })
      .mergeAll({ getUser })
      .build();

    await expect(api.getUser.orThrow({ params: { username: 'x' } })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(calls).toEqual(['request:getUser', 'response:500', 'error:ApiError']);
  });

  it('uses a custom adapter and merges options from every level', async () => {
    const seen: AdapterRequest[] = [];
    const adapter: Adapter = {
      request: (request) => {
        seen.push(request);
        return Promise.resolve({
          status: 200,
          statusText: 'OK',
          headers: {},
          data: { id: 1, login: 'x' },
        });
      },
    };
    const route = createRoute({
      method: 'GET',
      path: '/users/:username',
      response: userSchema,
      options: { route: true, shared: 'route' },
    });
    const api = createRepository({ baseUrl: BASE, adapter, options: { repo: true } })
      .mergeAll({ route })
      .build();

    await api.route.orThrow({ params: { username: 'x' }, options: { call: true, shared: 'call' } });

    expect(seen[0]!.options).toEqual({ repo: true, route: true, call: true, shared: 'call' });
    expect(seen[0]!.url).toBe(`${BASE}/users/x`);
  });

  it('forwards an AbortSignal', async () => {
    const fetchMock = mockFetch(new Response('pong'));
    const api = createRepository({ baseUrl: BASE }).mergeAll({ ping }).build();
    const controller = new AbortController();

    await api.ping.orThrow({ signal: controller.signal });

    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
  });
});
