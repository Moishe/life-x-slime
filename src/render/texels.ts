import type { Cell } from '../life/engine';
import { PALETTE } from '../life/palette';
import type { ColoredCell } from '../life/world';

// Translucent blue, as in life-ambient's placement preview.
export const GHOST_RGBA: readonly number[] = [90, 170, 255, 120];

// One RGBA texel per Life cell: palette color where alive, transparent elsewhere.
export function lifeTexels(cells: ColoredCell[], gridSize: number): Uint8Array {
  const texels = new Uint8Array(gridSize * gridSize * 4);
  for (const c of cells) {
    const [r, g, b] = PALETTE[c.paletteIndex];
    texels.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], (c.y * gridSize + c.x) * 4);
  }
  return texels;
}

export function ghostTexels(cells: Cell[], gridSize: number): Uint8Array {
  const texels = new Uint8Array(gridSize * gridSize * 4);
  for (const c of cells) texels.set(GHOST_RGBA, (c.y * gridSize + c.x) * 4);
  return texels;
}
