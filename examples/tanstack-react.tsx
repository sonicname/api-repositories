/**
 * React components built on TanStack Query + the helpers in `tanstack-query.ts`.
 */
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { Suspense } from 'react';
import type { ReactElement } from 'react';

import { matchError } from '../src/index.js';

import { github } from './api.js';
import { routeKeyPrefix, routeMutation, routeQuery } from './tanstack-query.js';

// --- Query client ----------------------------------------------------------

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // endpoint-kit already retried transport errors; let TanStack retry only 5xx.
      retry: (count, error) => count < 2 && error._tag === 'ApiError' && error.status >= 500,
    },
  },
});

// --- Queries ---------------------------------------------------------------

export function UserCard({ username }: { username: string }): ReactElement {
  const { data, error, isPending } = useQuery(routeQuery(github.getUser, { params: { username } }));

  if (isPending) return <p>Loading…</p>;

  if (error) {
    // `error` is RouteError | NotFoundError | UnauthorizedError | RateLimitedError
    return (
      <p role="alert">
        {matchError(error, {
          NotFoundError: () => `No user named ${username}`,
          UnauthorizedError: () => 'Please sign in to see profiles',
          RateLimitedError: (e) => `Rate limited until ${e.resetAt.toLocaleTimeString()}`,
          ApiError: (e) => `GitHub answered ${String(e.status)}`,
          _: (e) => e.message,
        })}
      </p>
    );
  }

  return (
    <h2>
      {data.name ?? data.login} (#{data.id})
    </h2>
  );
}

export function RepoList({ username }: { username: string }): ReactElement {
  // Suspense variant: `data` is never undefined, errors go to the nearest error boundary.
  const { data } = useSuspenseQuery(
    routeQuery(github.listRepos, {
      params: { username },
      query: { sort: 'updated', per_page: 10 },
    }),
  );

  return (
    <ul>
      {data.map((repo) => (
        <li key={repo.id}>
          {repo.name} ★ {repo.stargazers_count}
        </li>
      ))}
    </ul>
  );
}

// --- Mutations -------------------------------------------------------------

export function NewIssueButton({ owner, repo }: { owner: string; repo: string }): ReactElement {
  const client = useQueryClient();
  const createIssue = useMutation({
    mutationFn: routeMutation(github.createIssue),
    onSuccess: () => client.invalidateQueries({ queryKey: routeKeyPrefix(github.listRepos) }),
  });

  return (
    <button
      disabled={createIssue.isPending}
      onClick={() => {
        createIssue.mutate({ params: { owner, repo }, body: { title: 'Found a bug' } });
      }}
    >
      {createIssue.isPending ? 'Creating…' : 'New issue'}
      {createIssue.error && <span> ({createIssue.error.message})</span>}
    </button>
  );
}

// --- App -------------------------------------------------------------------

export function App(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <UserCard username="octocat" />
      <Suspense fallback={<p>Loading repos…</p>}>
        <RepoList username="octocat" />
      </Suspense>
      <NewIssueButton owner="octocat" repo="hello-world" />
    </QueryClientProvider>
  );
}
