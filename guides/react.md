# React without a data library

For most apps, pair endpoint-kit with [TanStack Query](./tanstack-query.md). When you want zero
dependencies, a 30-line hook covers loading, error and abort-on-unmount. Full, type-checked source:
[`examples/react-plain.tsx`](../examples/react-plain.tsx).

## `useRoute`

```tsx
import { useEffect, useState } from 'react';
import type {
  AnyRoute,
  RouteArgs,
  RouteCaller,
  RouteFailure,
  RouteInput,
  RouteOutput,
} from 'endpoint-kit';

export type RouteState<TData, TError> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'success'; data: TData; error?: undefined }
  | { status: 'error'; data?: undefined; error: TError };

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
      if (controller.signal.aborted) return; // stale response, ignore
      setState(
        result.ok
          ? { status: 'success', data: result.data }
          : { status: 'error', error: result.error },
      );
    });

    return () => controller.abort();
  }, [caller, inputKey]);

  return state;
}
```

Because callers never reject, there is no `try/catch` and no unhandled-rejection risk. An
aborted request resolves with an `AbortError`, which the `aborted` check drops before it reaches
state.

## Rendering the three states

```tsx
export function UserCard({ username }: { username: string }) {
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
```

`matchError` with a `_` fallback keeps the switch short; drop the fallback when you want the
compiler to force a handler for every tag.

## Mutations

Call the route directly in the handler and branch on the result:

```tsx
export function NewIssueForm({ owner, repo }: { owner: string; repo: string }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    const { data, error } = await github.createIssue({ params: { owner, repo }, body: { title } });
    setMessage(error ? error.message : `Created #${String(data.number)}`);
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} />
      <button disabled={title.length === 0}>Create issue</button>
      {message && <p>{message}</p>}
    </form>
  );
}
```

## Server components and loaders

Outside the browser render loop (Next.js server components, Remix/React Router loaders,
`getServerSideProps`) there is no hook: await the caller and decide what to render.

```tsx
export default async function Page({ params }: { params: { username: string } }) {
  const { data, error } = await github.getUser({ params });
  if (error?._tag === 'NotFoundError') notFound();
  if (error) throw error; // let the error boundary handle the rest
  return <h1>{data.login}</h1>;
}
```

## Session state

Token changes should re-render the parts of the UI that care. Read the store through
`useSyncExternalStore`; see the [auth guide](./auth-refresh-token.md#react-reacting-to-sign-out).
