import { describe, it, expect } from 'vitest';
import { CELL_SIZE, DEFAULT_SETTINGS, FIELD_SIZE, LIFE_SIZE, seedFromUrl } from '../../src/app/settings';

describe('settings', () => {
  it('has the spec sizes and defaults', () => {
    expect([LIFE_SIZE, FIELD_SIZE, CELL_SIZE]).toEqual([128, 2048, 16]);
    expect(DEFAULT_SETTINGS).toEqual({
      playing: true, lifeHz: 1, randomDensity: 0.2, actorsPerBirth: 16, spawnMode: 'burst',
      lifeOpacity: 0.6, physarumOpacity: 1, foodView: false, poolSize: 131072,
    });
  });

  it('reads an integer ?seed= from the URL, else falls back', () => {
    expect(seedFromUrl('?seed=42', 1)).toBe(42);
    expect(seedFromUrl('?seed=abc', 1)).toBe(1);
    expect(seedFromUrl('', 7)).toBe(7);
  });
});
