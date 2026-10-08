import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createRepository, createRoute, ValidationError } from '../src/index.js';

const BASE = 'https://api.example.com';

function mockFetch() {
  const fetchMock = vi.fn((_input: string, _init: RequestInit) =>
    Promise.resolve(new Response('{"ok":true}', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('params as a per-key schema map', () => {
  const getIssue = createRoute({
    method: 'GET',
    path: '/repos/:owner/:repo/issues/:number',
    params: {
      number: z.coerce.number().int().positive(),
      repo: z.string().toLowerCase(),
    },
  });

  it('validates and transforms the keys that have a schema, passes the others through', async () => {
    const fetchMock = mockFetch();
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getIssue }).build();

    await api.getIssue({ params: { owner: 'Octo', repo: 'Hello-World', number: '42' } });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/repos/Octo/hello-world/issues/42`);
  });

  it('reports issues prefixed with the param name', async () => {
    const fetchMock = mockFetch();
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getIssue }).build();

    const promise = api.getIssue({ params: { owner: 'o', repo: 'r', number: 'NaN' } });

    await expect(promise).rejects.toBeInstanceOf(ValidationError);
    await expect(promise).rejects.toMatchObject({
      target: 'params',
      issues: [expect.objectContaining({ path: ['number'] })],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still fails clearly when an unschema-ed param is missing at runtime', async () => {
    mockFetch();
    const api = createRepository({ baseUrl: BASE }).mergeAll({ getIssue }).build();

    await expect(api.getIssue({ params: { repo: 'r', number: 1 } as never })).rejects.toThrow(
      /Missing value for path param ":owner"/,
    );
  });

  it('treats an empty map like no params', async () => {
    const fetchMock = mockFetch();
    const route = createRoute({ method: 'GET', path: '/u/:id', params: {} });
    const api = createRepository({ baseUrl: BASE }).mergeAll({ route }).build();

    await api.route({ params: { id: 7 } });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/u/7`);
  });
});

describe('params as a whole-object schema', () => {
  it('validates the object and uses the transformed output in the URL', async () => {
    const fetchMock = mockFetch();
    const route = createRoute({
      method: 'GET',
      path: '/u/:id',
      params: z.object({ id: z.string().transform((v) => v.trim()) }),
    });
    const api = createRepository({ baseUrl: BASE }).mergeAll({ route }).build();

    await api.route({ params: { id: '  9 ' } });

    expect(fetchMock.mock.calls[0]![0]).toBe(`${BASE}/u/9`);
  });
});
