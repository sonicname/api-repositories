/**
 * React without a data-fetching library: a small `useRoute` hook, abort on unmount,
 * and session state via `useSyncExternalStore`.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';

import { matchError } from '../src/index.js';
import type {
  AnyRoute,
  RouteArgs,
  RouteCaller,
  RouteFailure,
  RouteInput,
  RouteOutput,
} from '../src/index.js';

import { github } from './api.js';
import { auth } from './auth-store.js';

// --- useRoute --------------------------------------------------------------

export type RouteState<TData, TError> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: TData; error?: undefined }
  | { status: 'error'; data?: undefined; error: TError };

/**
 * Call a route whenever its input changes. The request is aborted when the component
 * unmounts or the input changes, and the resulting AbortError is ignored.
 */
export function useRoute<R extends AnyRoute, E>(
  caller: RouteCaller<R, E>,
  ...args: RouteArgs<R>
): RouteState<RouteOutput<R>, RouteFailure<R, E>> {
  const [state, setState] = useState<RouteState<RouteOutput<R>, RouteFailure<R, E>>>({
    status: 'loading',
  });
  const input = args[0];
  // Compare inputs by value so a new object literal on every render does not refetch.
  const inputKey = JSON.stringify(input ?? null);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    const withSignal = { ...(input ?? {}), signal: controller.signal } as RouteInput<R>;
    void caller(...([withSignal] as RouteArgs<R>)).then((result) => {
      if (controller.signal.aborted) return;
      setState(
        result.ok
          ? { status: 'success', data: result.data }
          : { status: 'error', error: result.error },
      );
    });

    return () => {
      controller.abort();
    };
    // `inputKey` stands in for `input` so a fresh object literal per render does not refetch.
  }, [caller, inputKey]);

  return state;
}

// --- Components ------------------------------------------------------------

export function UserCard({ username }: { username: string }): ReactElement {
  const user = useRoute(github.getUser, { params: { username } });

  switch (user.status) {
    case 'loading':
      return <p>Loading…</p>;
    case 'error':
      return (
        <p role="alert">
          {matchError(user.error, {
            NotFoundError: () => `No user named ${username}`,
            UnauthorizedError: () => 'Please sign in',
            _: (e) => e.message,
          })}
        </p>
      );
    case 'success':
      return <h2>{user.data.name ?? user.data.login}</h2>;
  }
}

export function NewIssueForm({ owner, repo }: { owner: string; repo: string }): ReactElement {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    setBusy(true);
    const { data, error } = await github.createIssue({
      params: { owner, repo },
      body: { title },
    });
    setBusy(false);
    setMessage(error ? error.message : `Created #${String(data.number)}`);
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <input
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      <button disabled={busy || title.length === 0}>Create issue</button>
      {message && <p>{message}</p>}
    </form>
  );
}

// --- Session ---------------------------------------------------------------

/** Re-renders when the token changes (sign in, refresh, sign out). */
export function useSession(): { signedIn: boolean } {
  const token = useSyncExternalStore(
    (listener) => auth.subscribe(listener),
    () => auth.getAccessToken(),
    () => null,
  );
  return { signedIn: token !== null };
}

export function Header(): ReactElement {
  const { signedIn } = useSession();
  return signedIn ? (
    <button onClick={() => void auth.signOut()}>Sign out</button>
  ) : (
    <a href="/sign-in">Sign in</a>
  );
}
