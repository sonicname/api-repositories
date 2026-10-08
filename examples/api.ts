/**
 * Shared API definition used by the other examples.
 * In an app this would live in something like `src/api/github.ts`.
 */
import { z } from 'zod';

import {
  createRepository,
  createRoute,
  errorFromSchema,
  fetchAdapter,
  groupRoutes,
  TaggedError,
} from '../src/index.js';

import { auth } from './auth-store.js';
import { refreshOn401 } from './refresh-middleware.js';

// --- Schemas ---------------------------------------------------------------

export const userSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullable(),
});
export type User = z.infer<typeof userSchema>;

export const repoSchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  stargazers_count: z.number(),
});
export type Repo = z.infer<typeof repoSchema>;

const issueSchema = z.object({ number: z.number(), title: z.string(), html_url: z.string() });

// --- Custom errors ---------------------------------------------------------

export class NotFoundError extends TaggedError<'NotFoundError'> {
  readonly _tag = 'NotFoundError';
  constructor(readonly resource: string) {
    super(`${resource} not found`);
  }
}

export class UnauthorizedError extends TaggedError<'UnauthorizedError'> {
  readonly _tag = 'UnauthorizedError';
  constructor() {
    super('Please sign in');
  }
}

export class RateLimitedError extends TaggedError<'RateLimitedError'> {
  readonly _tag = 'RateLimitedError';
  constructor(readonly resetAt: Date) {
    super(`Rate limited until ${resetAt.toISOString()}`);
  }
}

const notFoundBody = z.object({ message: z.string(), documentation_url: z.string().optional() });

// --- Routes ----------------------------------------------------------------

export const routes = {
  getUser: createRoute.get('/users/:username', {
    response: userSchema,
    errors: { 404: errorFromSchema(notFoundBody, () => new NotFoundError('user')) },
  }),

  ...groupRoutes('/users/:username', {
    listRepos: createRoute.get('/repos', {
      query: z.object({
        sort: z.enum(['created', 'updated', 'pushed', 'full_name']).optional(),
        per_page: z.number().int().min(1).max(100).optional(),
        page: z.number().int().positive().optional(),
      }),
      response: z.array(repoSchema),
      cache: { ttl: 30_000, tags: ['repos'] },
    }),
  }),

  createIssue: createRoute.post('/repos/:owner/:repo/issues', {
    body: z.object({ title: z.string().min(1), body: z.string().optional() }),
    response: issueSchema,
    invalidates: ['repos'],
  }),
};

// --- Repository ------------------------------------------------------------

export const github = createRepository({
  baseUrl: 'https://api.github.com',
  adapter: fetchAdapter(),
  timeout: 10_000,
  retry: 2,
  // Sent with every request; read at call time so a refreshed token is picked up.
  headers: (): Record<string, string> => {
    const token = auth.getAccessToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  },
  // Repository-wide custom errors. Every caller's `error` union includes them.
  errors: {
    401: () => new UnauthorizedError(),
    403: (ctx) => {
      const reset = Number(ctx.headers['x-ratelimit-reset'] ?? 0) * 1000;
      return new RateLimitedError(new Date(reset));
    },
  },
  middlewares: [
    refreshOn401({
      getToken: () => auth.getAccessToken(),
      refresh: () => auth.refresh(),
      onRefreshFailed: () => auth.signOut(),
    }),
  ],
})
  .mergeAll(routes)
  .build();

export type GithubApi = typeof github;
