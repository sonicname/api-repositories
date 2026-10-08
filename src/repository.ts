/** Minimal shape every stored entity must satisfy. */
export interface Entity {
  id: string;
}

/** Options for {@link Repository}. */
export interface RepositoryOptions<T extends Entity> {
  /** Seed the repository with initial entities. */
  initial?: readonly T[];
}

/**
 * A tiny in-memory repository, included as an example of a class-based API.
 *
 * @typeParam T - Entity type stored in the repository.
 */
export class Repository<T extends Entity> {
  readonly #items = new Map<string, T>();

  constructor(options: RepositoryOptions<T> = {}) {
    for (const item of options.initial ?? []) {
      this.#items.set(item.id, item);
    }
  }

  /** Number of stored entities. */
  get size(): number {
    return this.#items.size;
  }

  /** Insert or replace an entity. Returns the repository for chaining. */
  save(item: T): this {
    this.#items.set(item.id, item);
    return this;
  }

  /** Find an entity by id, or `undefined` if missing. */
  find(id: string): T | undefined {
    return this.#items.get(id);
  }

  /** Remove an entity. Returns `true` if it existed. */
  remove(id: string): boolean {
    return this.#items.delete(id);
  }

  /** Snapshot of all entities in insertion order. */
  all(): T[] {
    return [...this.#items.values()];
  }
}
