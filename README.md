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
- **Tiny**: no runtime dependencies, under 4 kB minified.

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
  params: z.object({ owner: z.string().min(1), repo: z.string().min(1) }),
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

| Field          | Description                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------- |
| `method`       | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` or `OPTIONS`.                                |
| `path`         | Path relative to `baseUrl`. `:name` segments become path params.                             |
| `params`       | Schema for path params. Optional. Without it, params are inferred from `path`.               |
| `query`        | Schema for the query string. Arrays become repeated keys, `undefined` values are skipped.    |
| `body`         | Schema for the request body. Plain objects are JSON encoded, `FormData`/`Blob` pass through. |
| `response`     | Schema for the response body. Its output type is what the caller resolves with.              |
| `responseType` | `json` (default), `text`, `blob`, `arrayBuffer` or `none`.                                   |
| `headers`      | Static headers for this route.                                                               |
| `options`      | Adapter specific options (axios config, ofetch options, `RequestInit`).                      |

A route can be reused across several repositories.

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
    onRequest: ({ route, request }) => {},
    onResponse: ({ route, request, response }) => {},
    onError: ({ route, request, error }) => {},
  },
});
```

Routes can be registered with `.mergeAll({ ... })` or one at a time with `.addRoute('name', route)`.

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
import { ApiError, ValidationError } from 'api-repositories';

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
