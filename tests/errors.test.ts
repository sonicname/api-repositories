import { describe, expect, it } from 'vitest';

import { ApiError, ValidationError } from '../src/index.js';

describe('ValidationError', () => {
  it('formats issues with nested paths', () => {
    const error = new ValidationError(
      'body',
      [{ message: 'Required', path: ['user', { key: 'name' }, 0] }, { message: 'Too short' }],
      'createUser',
    );

    expect(error.name).toBe('ValidationError');
    expect(error.target).toBe('body');
    expect(error.route).toBe('createUser');
    expect(error.message).toBe(
      'Validation failed for body of route "createUser": user.name.0: Required; Too short',
    );
  });
});

describe('ApiError', () => {
  it('includes status text when present', () => {
    const error = new ApiError(500, { message: 'x' }, 'getUser', { 'x-a': '1' }, 'Server Error');

    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('Request to route "getUser" failed with status 500 Server Error');
    expect(error.headers).toEqual({ 'x-a': '1' });
  });

  it('works with defaults', () => {
    const error = new ApiError(418, undefined, 'teapot');

    expect(error.message).toBe('Request to route "teapot" failed with status 418');
    expect(error.headers).toEqual({});
    expect(error.statusText).toBe('');
  });
});
