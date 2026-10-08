/**
 * A policy value as accepted at repository, route and call level:
 * a full options object, a numeric shorthand, `false` to disable, or nothing.
 */
export type PolicyInput<T extends object> = T | number | false | undefined;

/**
 * Merge policy levels left to right. Objects shallow-merge over the accumulated value,
 * a number sets `shorthandKey`, `false` resets everything, `undefined` is skipped.
 */
export function resolvePolicy<T extends object>(
  shorthandKey: keyof T,
  ...levels: readonly PolicyInput<T>[]
): T | undefined {
  let current: T | undefined;
  for (const level of levels) {
    if (level === undefined) continue;
    if (level === false) {
      current = undefined;
      continue;
    }
    const patch = typeof level === 'number' ? ({ [shorthandKey]: level } as T) : level;
    current = { ...current, ...patch };
  }
  return current;
}

/** Last defined wins, `false` disables. */
export function resolveTimeout(
  ...levels: readonly (number | false | undefined)[]
): number | undefined {
  let current: number | undefined;
  for (const level of levels) {
    if (level === undefined) continue;
    current = level === false ? undefined : level;
  }
  return current !== undefined && current > 0 ? current : undefined;
}
