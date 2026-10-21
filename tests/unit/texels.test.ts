import { describe, it, expect } from 'vitest';
import { GHOST_RGBA, ghostTexels, lifeTexels } from '../../src/render/texels';
import { paletteColors } from '../../src/life/palette';

const PALETTE = paletteColors('rainbow', 8);

describe('lifeTexels', () => {
  it('writes each live cell in its palette color, opaque, and leaves the rest transparent', () => {
    const t = lifeTexels([{ x: 1, y: 2, paletteIndex: 3 }], 4, PALETTE);
    expect(t).toHaveLength(4 * 4 * 4);
    const o = (2 * 4 + 1) * 4;
    expect(Array.from(t.slice(o, o + 4))).toEqual([...PALETTE[3].map(v => Math.round(v * 255)), 255]);
    expect(Array.from(t.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});

describe('ghostTexels', () => {
  it('writes the ghost color at each cell', () => {
    const t = ghostTexels([{ x: 0, y: 1 }], 2);
    expect(Array.from(t.slice(8, 12))).toEqual([...GHOST_RGBA]);
    expect(Array.from(t.slice(0, 4))).toEqual([0, 0, 0, 0]);
  });
});
