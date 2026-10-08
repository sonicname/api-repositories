/** Replace `:name` segments in `path` with URL-encoded values from `params`. */
export function interpolatePath(path: string, params: Record<string, unknown> | undefined): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === null) {
      throw new TypeError(`Missing value for path param ":${name}" in "${path}"`);
    }
    return encodeURIComponent(toStringValue(value));
  });
}

/** Serialise a query object into a query string (without the leading `?`). */
export function buildQueryString(query: unknown): string {
  if (query === undefined || query === null) return '';
  if (typeof query === 'string') return query.replace(/^\?/, '');
  if (query instanceof URLSearchParams) return query.toString();
  if (typeof query !== 'object') return '';

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null) search.append(key, serialise(item));
      }
    } else {
      search.append(key, serialise(value));
    }
  }
  return search.toString();
}

function serialise(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return toStringValue(value);
}

/** Stringify a primitive, or JSON-encode anything else. */
export function toStringValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value);
    case 'object':
      return JSON.stringify(value);
    default:
      return '';
  }
}

/** Join `baseUrl` and `path` with exactly one slash between them. Absolute paths are kept as is. */
export function joinUrl(baseUrl: string, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, '');
  const rest = path.replace(/^\/+/, '');
  return rest ? `${base}/${rest}` : base;
}

/** Build the final request URL from base, path, path params and query. */
export function buildUrl(
  baseUrl: string,
  path: string,
  params: Record<string, unknown> | undefined,
  query: unknown,
): string {
  const url = joinUrl(baseUrl, interpolatePath(path, params));
  const search = buildQueryString(query);
  if (!search) return url;
  return url.includes('?') ? `${url}&${search}` : `${url}?${search}`;
}
