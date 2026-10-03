import { describe, it, expect } from 'vitest';
import { cellFromPointer, ghostCells } from '../../src/ui/placement';
import { PATTERNS } from '../../src/life/patterns';

const rect = { left: 200, top: 50, width: 640, height: 640 }; // 5 CSS px per cell at 128

describe('cellFromPointer', () => {
  it('maps a point on a scaled, offset canvas to its cell', () => {
    expect(cellFromPointer(200, 50, rect, 128)).toEqual({ x: 0, y: 0 });
    expect(cellFromPointer(200 + 5 * 10 + 2, 50 + 5 * 20 + 4, rect, 128)).toEqual({ x: 10, y: 20 });
    expect(cellFromPointer(839.9, 689.9, rect, 128)).toEqual({ x: 127, y: 127 });
  });

  it('returns null outside the canvas', () => {
    expect(cellFromPointer(199, 60, rect, 128)).toBeNull();
    expect(cellFromPointer(840, 60, rect, 128)).toBeNull();
    expect(cellFromPointer(300, 690, rect, 128)).toBeNull();
  });
});

describe('ghostCells', () => {
  const glider = PATTERNS.find(p => p.id === 'glider')!;

  it('offsets the rotated pattern by the anchor', () => {
    const cells = ghostCells(glider, 0, { x: 10, y: 10 }, 128);
    expect(new Set(cells.map(c => `${c.x},${c.y}`))).toEqual(new Set(['11,10', '12,11', '10,12', '11,12', '12,12']));
  });

  it('clips cells that fall off the board', () => {
    const cells = ghostCells(glider, 0, { x: 126, y: 126 }, 128);
    expect(cells).toEqual([{ x: 127, y: 126 }]);
  });

  it('shows the single cell under the cursor in paint mode', () => {
    expect(ghostCells(null, 0, { x: 3, y: 4 }, 128)).toEqual([{ x: 3, y: 4 }]);
  });
});
