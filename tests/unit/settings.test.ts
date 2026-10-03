import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, FIELD_SIZE, LIFE_SIZES, cellSizeFor, seedFromUrl, sizeFromUrl } from '../../src/app/settings';

describe('settings', () => {
  it('has the spec sizes and defaults', () => {
    expect(FIELD_SIZE).toBe(2048);
    expect(DEFAULT_SETTINGS).toEqual({
      playing: true, lifeHz: 1, randomDensity: 0.2, actorsPerBirth: 16, spawnMode: 'burst',
      lifeOpacity: 0.6, physarumOpacity: 1, foodView: false, poolSize: 131072, lifeSize: 512,
    });
  });

  it('offers Life board sizes that divide the field into whole pixel blocks', () => {
    expect(LIFE_SIZES).toEqual([64, 128, 256, 512, 1024]);
    expect(LIFE_SIZES.map(cellSizeFor)).toEqual([32, 16, 8, 4, 2]);
  });

  it('reads an integer ?seed= from the URL, else falls back', () => {
    expect(seedFromUrl('?seed=42', 1)).toBe(42);
    expect(seedFromUrl('?seed=abc', 1)).toBe(1);
    expect(seedFromUrl('', 7)).toBe(7);
  });

  it('reads a supported ?size= from the URL, else falls back', () => {
    expect(sizeFromUrl('?size=128', 512)).toBe(128);
    expect(sizeFromUrl('?seed=7&size=1024', 512)).toBe(1024);
    expect(sizeFromUrl('?size=300', 512)).toBe(512);
    expect(sizeFromUrl('?size=abc', 512)).toBe(512);
    expect(sizeFromUrl('', 256)).toBe(256);
  });
});
