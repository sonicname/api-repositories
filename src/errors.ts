import type { StandardSchemaV1 } from './standard-schema.js';

/** Where a validation failure happened. */
export type ValidationTarget = 'params' | 'query' | 'body' | 'response';

/** Thrown when request input or the response body does not match its schema. */
export class ValidationError extends Error {
  override readonly name = 'ValidationError';

  constructor(
    /** Which part of the request/response failed validation. */
    readonly target: ValidationTarget,
    /** Issues reported by the schema library. */
    readonly issues: readonly StandardSchemaV1.Issue[],
    /** Name of the route that was being called. */
    readonly route: string,
  ) {
    super(`Validation failed for ${target} of route "${route}": ${formatIssues(issues)}`);
  }
}

/** Thrown when the server answers with a non-successful status code. */
export class ApiError<TData = unknown> extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    /** Parsed response body, if any. */
    readonly data: TData,
    /** Name of the route that was being called. */
    readonly route: string,
    readonly headers: Record<string, string> = {},
    readonly statusText = '',
  ) {
    super(
      `Request to route "${route}" failed with status ${String(status)}${statusText ? ` ${statusText}` : ''}`,
    );
  }
}

function formatIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? [])
        .map((segment) => (typeof segment === 'object' ? String(segment.key) : String(segment)))
        .join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}
