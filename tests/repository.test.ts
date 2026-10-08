import { describe, expect, it } from 'vitest';

import { Repository } from '../src/index.js';

interface User {
  id: string;
  name: string;
}

describe('Repository', () => {
  it('starts empty', () => {
    const repo = new Repository<User>();
    expect(repo.size).toBe(0);
    expect(repo.all()).toEqual([]);
  });

  it('seeds initial entities', () => {
    const repo = new Repository<User>({ initial: [{ id: '1', name: 'Ann' }] });
    expect(repo.size).toBe(1);
    expect(repo.find('1')).toEqual({ id: '1', name: 'Ann' });
  });

  it('saves, finds and removes', () => {
    const repo = new Repository<User>();
    repo.save({ id: '1', name: 'Ann' }).save({ id: '1', name: 'Anna' });
    expect(repo.find('1')?.name).toBe('Anna');
    expect(repo.remove('1')).toBe(true);
    expect(repo.remove('1')).toBe(false);
    expect(repo.find('1')).toBeUndefined();
  });
});
