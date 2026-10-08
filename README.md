# api-repositories

[![CI](https://github.com/egohub/api-repositories/actions/workflows/ci.yml/badge.svg)](https://github.com/egohub/api-repositories/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/api-repositories.svg)](https://www.npmjs.com/package/api-repositories)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Declare your backend endpoints once, get a fully typed API client.

- **Schema driven**: `params`, `query`, `body` and `response` are described with Zod v4 (or any
  [Standard Schema](https://standardschema.dev) library such as Valibot or ArkType).
- **Full IDE inference**: path params are inferred from `"/users/:username"`, inputs come from the
  schema input types, the result is the response schema output type.
- **Transport agnostic**: ships with adapters for `fetch` (default), axios and ofetch. Write your
  own in a few lines.
- **Validated at runtime**: bad inputs are rejected before the request is sent, unexpected
  responses throw a `ValidationError`, non-2xx statuses throw an `ApiError`.
- **Resilient**: per-attempt timeout, retry with exponential backoff and `Retry-After`, and an
  opt-in cache with TTL, request deduplication and tag invalidation. All configurable per
  repository, per route and per call.
- **Extensible**: a middleware pipeline around the transport for logging, auth refresh, mocking...
- **Tiny**: no runtime dependencies, under 8 kB minified.

## Install

```bash
pnpm add api-repositories zod
```

Zod is optional. Any schema library implementing Standard Schema works.

## Quick start

```ts
import { createRepository, createRoute } from 'api-repositories';
import { z } from 'zod';

const getUser = createRoute({
  method: 'GET',
  path: '/users/:username',
  response: z.object({ id: z.number(), login: z.string() }),
});

const listRepos = createRoute({
  method: 'GET',
  path: '/users/:username/repos',
  query: z.object({
    page: z.number().int().positive().optional(),
    sort: z.enum(['created', 'updated']).optional(),
  }),
  response: z.array(z.object({ name: z.string(), stargazers_count: z.number() })),
});

const createIssue = createRoute({
  method: 'POST',
  path: '/repos/:owner/:repo/issues',
  params: { owner: z.string().min(1) }, // repo stays string | number
  body: z.object({ title: z.string().min(1), labels: z.array(z.string()).default([]) }),
  response: z.object({ number: z.number(), html_url: z.string() }),
});

const github = createRepository({
  baseUrl: 'https://api.github.com',
  headers: () => ({ authorization: `Bearer ${getToken()}` }),
})
  .mergeAll({ getUser, listRepos, createIssue })
  .build();

// Everything below is fully typed and autocompleted.
const user = await github.getUser({ params: { username: 'octocat' } });
//    ^? { id: number; login: string }

const repos = await github.listRepos({
  params: { username: 'octocat' },
  query: { sort: 'updated' },
});

const issue = await github.createIssue({
  params: { owner: 'octocat', repo: 'hello-world' },
  body: { title: 'Bug report' }, // labels is optional thanks to .default([])
});
```

## Routes

`createRoute` accepts:

| Field          | Description                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `method`       | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` or `OPTIONS`.                                                                                                                                                             |
| `path`         | Path relative to `baseUrl`. `:name` segments become path params.                                                                                                                                                          |
| `params`       | Path param validation: a per-key map `{ id: z.coerce.number() }` (keys are autocompleted from `path`) or a whole-object schema. Both are checked against the path at compile time. Params without a schema accept `string | number`. |
| `query`        | Schema for the query string. Arrays become repeated keys, `undefined` values are skipped.                                                                                                                                 |
| `body`         | Schema for the request body. Plain objects are JSON encoded, `FormData`/`Blob` pass through.                                                                                                                              |
| `response`     | Schema for the response body. Its output type is what the caller resolves with.                                                                                                                                           |
| `responseType` | `json` (default), `text`, `blob`, `arrayBuffer` or `none`.                                                                                                                                                                |
| `headers`      | Static headers for this route.                                                                                                                                                                                            |
| `options`      | Adapter specific options (axios config, ofetch options, `RequestInit`).                                                                                                                                                   |

A route can be reused across several repositories.

### Path params

Params are inferred from the `:name` segments of `path`. Add schemas only where you need them:

```ts
const getIssue = createRoute({
  method: 'GET',
  path: '/repos/:owner/:repo/issues/:number',
  params: {
    number: z.coerce.number().int().positive(), // keys are suggested by the IDE
  },
});

await api.getIssue({ params: { owner: 'octocat', repo: 'hello-world', number: '42' } });
```

A whole-object schema works too and must require exactly the path params:

```ts
params: z.object({ owner: z.string(), repo: z.string() });
```

Mismatches are compile errors with a readable message, for example
`params: "repo" is not a param of path "/users/:username"` or
`params: path "/repos/:owner/:repo" has param ":repo" but the schema does not require it`.

## Calling a route

Each route becomes a function on the built client. It takes a single object with `params`,
`query` and `body` (only the ones the route declares, required only when the schema has required
keys) plus:

```ts
await github.getUser({
  params: { username: 'octocat' },
  headers: { 'x-request-id': '123' }, // merged over repository and route headers
  signal: controller.signal,
  options: { cache: 'no-store' }, // merged over repository and route options
});
```

When nothing is required, the argument can be omitted entirely: `await api.ping()`.

Use `.raw()` to also get status and headers:

```ts
const { data, status, headers } = await github.getUser.raw({ params: { username: 'octocat' } });
```

`client.$routes` holds the definitions and `client.$config` the resolved configuration.

## Repository options

```ts
createRepository({
  baseUrl: 'https://api.example.com',
  adapter: fetchAdapter({ init: { credentials: 'include' } }), // default: fetchAdapter()
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  options: {}, // adapter specific, merged into every request
  validateResponse: true, // set false to skip response schema validation
  isSuccess: (status) => status < 400, // default: 200 <= status < 300
  hooks: {
    onRequest: ({ route, request, attempt }) => {},
    onResponse: ({ route, request, response, attempt }) => {},
    onError: ({ route, request, error }) => {},
  },
  middlewares: [], // see below
  timeout: 10_000, // per attempt, in ms
  retry: { attempts: 3 }, // or just a number
  cache: { ttl: 30_000 }, // or just a number; GET/HEAD only
});
```

Routes can be registered with `.mergeAll({ ... })` or one at a time with `.addRoute('name', route)`.

## Timeout, retry and cache

The three policies follow the same layering: repository defaults, overridden by the route,
overridden by the call. A number is a shorthand (`timeout` ms, retry `attempts`, cache `ttl`),
an object is shallow-merged over the level below, and `false` disables the policy.

```ts
const listRepos = createRoute({
  method: 'GET',
  path: '/users/:username/repos',
  retry: { attempts: 5 }, // merged over the repository retry options
  cache: { ttl: 60_000, tags: ['repos'] },
});

const createRepo = createRoute({
  method: 'POST',
  path: '/user/repos',
  retry: false, // never retry this one
  invalidates: ['repos'], // drop cached entries tagged "repos" after success
});

await github.listRepos({ params: { username: 'octocat' }, timeout: 2_000, cache: false });
```

### Timeout

Applies to each attempt. When it fires the call rejects with a `TimeoutError`. A caller
`signal` still works: whichever aborts first wins.

### Retry

Defaults: 3 attempts, idempotent methods only (`GET, HEAD, PUT, DELETE, OPTIONS`), on statuses
`408, 425, 429, 500, 502, 503, 504` or on thrown errors (network, timeout), exponential backoff
with jitter starting at 300 ms, and `Retry-After` honoured when present. Requests whose body is a
stream are never retried, and a caller abort stops everything.

```ts
retry: {
  attempts: 4,
  delay: ({ attempt }) => attempt * 500, // or a fixed number of ms
  methods: ['GET', 'POST'],
  statuses: [500, 503],
  respectRetryAfter: true,
  // Replace the decision entirely; call defaultShouldRetry to extend it instead.
  shouldRetry: (ctx) => defaultShouldRetry(ctx) || ctx.response?.status === 418,
}
```

### Cache

Opt-in through `ttl`. Only successful `GET`/`HEAD` responses are stored (override with
`methods`). Concurrent identical requests share one in-flight request. The default key is
`method + url`; add header names with `vary` or supply your own `key` function. The store is an
in-memory `Map` unless you pass `storage` (any object implementing `CacheStorage`, sync or async).

```ts
cache: { ttl: 30_000, vary: ['Authorization'], tags: ['user'] }

await github.$cache.invalidate('user', 'repos');
await github.$cache.delete('GET https://api.github.com/users/octocat');
await github.$cache.clear();
```

This is deliberately small. For stale-while-revalidate, background refetching or optimistic
updates, pair the client with TanStack Query or SWR and leave `cache` off.

## Middlewares

A middleware wraps the transport: `(request, next, context) => Promise<AdapterResponse>`. Call
`next` to continue, return a response to short-circuit, throw to fail. Repository middlewares run
outermost, then route middlewares, then the built-in cache, retry, timeout and hooks, then the
adapter.

```ts
import type { Middleware } from 'api-repositories';

const logging: Middleware = async (request, next, { route, attempt }) => {
  const started = Date.now();
  const response = await next(request);
  console.log(route, attempt, response.status, `${Date.now() - started}ms`);
  return response;
};

const refreshOn401: Middleware = async (request, next) => {
  const response = await next(request);
  if (response.status !== 401) return response;
  const token = await refreshToken();
  return next({ ...request, headers: { ...request.headers, authorization: `Bearer ${token}` } });
};

createRepository({ baseUrl, middlewares: [logging, refreshOn401] });
createRoute({ method: 'GET', path: '/x', middlewares: [mockInDev] });
```

## Adapters

```ts
import axios from 'axios';
import { ofetch } from 'ofetch';
import { axiosAdapter, fetchAdapter, ofetchAdapter } from 'api-repositories';

createRepository({ baseUrl, adapter: fetchAdapter() });
createRepository({ baseUrl, adapter: axiosAdapter(axios.create({ timeout: 5000 })) });
createRepository({ baseUrl, adapter: ofetchAdapter(ofetch.create({ retry: 2 })) });
```

Neither axios nor ofetch is a dependency of this package. A custom adapter only needs a
`request(request: AdapterRequest): Promise<AdapterResponse>` method and must not throw on
non-2xx statuses; the repository decides what counts as a failure.

## Errors

```ts
import { ApiError, TimeoutError, ValidationError } from 'api-repositories';

try {
  await github.getUser({ params: { username: 'nobody' } });
} catch (error) {
  if (error instanceof ApiError) {
    error.status; // 404
    error.data; // parsed body
    error.route; // 'getUser'
  }
  if (error instanceof ValidationError) {
    error.target; // 'params' | 'query' | 'body' | 'response'
    error.issues; // Standard Schema issues
  }
  if (error instanceof TimeoutError) {
    error.timeout; // ms
  }
}
```

## Type helpers

```ts
import type { RouteInput, RouteOutput } from 'api-repositories';

type GetUserInput = RouteInput<typeof getUser>;
type GetUserOutput = RouteOutput<typeof getUser>;
```

## Development

| Script               | Description                                                |
| -------------------- | ---------------------------------------------------------- |
| `pnpm build`         | Build ESM, CJS and `.d.ts` into `dist/`                    |
| `pnpm dev`           | Build in watch mode                                        |
| `pnpm test`          | Run tests once                                             |
| `pnpm test:watch`    | Run tests in watch mode                                    |
| `pnpm test:coverage` | Run tests with coverage                                    |
| `pnpm typecheck`     | Type-check without emitting                                |
| `pnpm lint`          | Lint with ESLint                                           |
| `pnpm format`        | Format with Prettier                                       |
| `pnpm check:exports` | Validate `package.json` exports and types (attw + publint) |
| `pnpm size`          | Check bundle size against `.size-limit.json`               |
| `pnpm docs:api`      | Generate API docs into `docs/`                             |
| `pnpm check`         | Run everything CI runs                                     |
| `pnpm changeset`     | Add a changeset describing your change                     |

Releases are driven by [Changesets](https://github.com/changesets/changesets): run
`pnpm changeset`, merge to `main`, merge the generated "Version Packages" PR.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full workflow.

## License

[MIT](./LICENSE) © Phạm Anh Đức
