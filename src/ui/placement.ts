import type { Cell } from '../life/engine';
import { rotateCells, type Pattern } from '../life/patterns';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The Life cell under a pointer, or null when the pointer is outside the canvas.
export function cellFromPointer(clientX: number, clientY: number, rect: Rect, gridSize: number): Cell | null {
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  return { x: Math.floor(fx * gridSize), y: Math.floor(fy * gridSize) };
}

// Cells the current tool would affect if clicked at anchor, clipped to the
// board. A null pattern means paint mode (the single cell under the cursor).
export function ghostCells(pattern: Pattern | null, quarterTurns: number, anchor: Cell, gridSize: number): Cell[] {
  const cells = pattern
    ? rotateCells(pattern.cells, quarterTurns).map(c => ({ x: anchor.x + c.x, y: anchor.y + c.y }))
    : [anchor];
  return cells.filter(c => c.x >= 0 && c.y >= 0 && c.x < gridSize && c.y < gridSize);
}
