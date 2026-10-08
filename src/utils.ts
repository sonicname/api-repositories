/** Options accepted by {@link greet}. */
export interface GreetOptions {
  /** Greeting word, defaults to `"Hello"`. */
  greeting?: string;
  /** Append an exclamation mark, defaults to `true`. */
  excited?: boolean;
}

/**
 * Build a greeting message.
 *
 * @example
 * ```ts
 * greet('World'); // "Hello, World!"
 * greet('World', { greeting: 'Hi', excited: false }); // "Hi, World"
 * ```
 */
export function greet(name: string, options: GreetOptions = {}): string {
  const { greeting = 'Hello', excited = true } = options;
  return `${greeting}, ${name}${excited ? '!' : ''}`;
}

/** Sum a list of numbers. Returns `0` for an empty list. */
export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Clamp `value` into the inclusive range `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new RangeError(`min (${String(min)}) must be <= max (${String(max)})`);
  }
  return Math.min(Math.max(value, min), max);
}
