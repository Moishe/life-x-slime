import { describe, it, expect } from 'vitest';
import { groupCells } from '../../src/life/tracker';

const c = (x: number, y: number) => ({ x, y });

describe('groupCells', () => {
  it('returns no groups for an empty board', () => {
    expect(groupCells([])).toEqual([]);
  });

  it('groups adjacent cells together', () => {
    const groups = groupCells([c(5, 5), c(6, 5), c(5, 6), c(6, 6)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
  });

  it('allows a one-cell gap (Chebyshev distance 2)', () => {
    expect(groupCells([c(0, 0), c(2, 2)])).toHaveLength(1);
  });

  it('separates cells at Chebyshev distance 3', () => {
    expect(groupCells([c(0, 0), c(3, 3)])).toHaveLength(2);
  });

  it('separates two distant blocks', () => {
    const groups = groupCells([
      c(2, 2), c(3, 2), c(2, 3), c(3, 3),
      c(20, 20), c(21, 20), c(20, 21), c(21, 21),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.length)).toEqual([4, 4]);
  });

  it('chains gaps: A-2-B-2-C is one cluster', () => {
    expect(groupCells([c(0, 0), c(2, 0), c(4, 0)])).toHaveLength(1);
  });
});
