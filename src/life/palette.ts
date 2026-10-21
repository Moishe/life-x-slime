import { hsv2rgb, type Vec3 } from '../color';
import type { Rng } from '../rng';
import type { ClusterEvents } from './tracker';

export const MAX_COLORS = 16;
// lcm(1..16): organisms draw a slot in [0, COLOR_SLOTS) and wear slot % colorCount,
// so the color count can change live and every count still picks colors uniformly.
export const COLOR_SLOTS = 720720;

// Color stops for each palette, in an order where neighbors blend well.
// Rainbow has none: it is generated as evenly spaced fully saturated hues.
export const PALETTES: Record<string, readonly string[]> = {
  rainbow: [],
  // sailorhg's fairyfloss editor theme.
  'fairy floss': ['#FFB8D1', '#FF857F', '#E6C000', '#FFF352', '#C2FFDF', '#C5A3FF', '#AE81FF'],
  // The 1977-1998 six-stripe Apple logo, top to bottom.
  'apple 1980s': ['#61BB46', '#FDB827', '#F5821F', '#E03A3E', '#963D97', '#009DDC'],
  dracula: ['#FF79C6', '#FF5555', '#FFB86C', '#F1FA8C', '#50FA7B', '#8BE9FD', '#BD93F9'],
  solarized: ['#B58900', '#CB4B16', '#DC322F', '#D33682', '#6C71C4', '#268BD2', '#2AA198', '#859900'],
  nord: ['#BF616A', '#D08770', '#EBCB8B', '#A3BE8C', '#8FBCBB', '#88C0D0', '#81A1C1', '#B48EAD'],
  synthwave: ['#FF71CE', '#B967FF', '#01CDFE', '#05FFA1', '#FFFB96'],
  sunset: ['#F8B195', '#F67280', '#C06C84', '#6C5B7B', '#355C7D'],
  // PICO-8's 16 colors minus the blacks, greys and browns that vanish on the dark field.
  'pico-8': ['#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA', '#7E2553', '#008751'],
};

export const PALETTE_NAMES: readonly string[] = Object.keys(PALETTES);

const hexToRgb = (hex: string): Vec3 => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as Vec3;

// `count` colors from the named palette: an even pick of its stops when it has
// enough, otherwise blends between neighboring stops (wrapping around).
export function paletteColors(name: string, count: number): Vec3[] {
  const n = Math.min(MAX_COLORS, Math.max(1, Math.round(count)));
  const stops = (PALETTES[name] ?? []).map(hexToRgb);
  if (stops.length === 0) return Array.from({ length: n }, (_, i) => hsv2rgb([i / n, 1, 1]));
  return Array.from({ length: n }, (_, i) => {
    const t = (i * stops.length) / n;
    if (n <= stops.length) return stops[Math.floor(t)];
    const a = stops[Math.floor(t)];
    const b = stops[(Math.floor(t) + 1) % stops.length];
    const f = t - Math.floor(t);
    return a.map((v, k) => v + (b[k] - v) * f) as Vec3;
  });
}

export function colorFor(colors: readonly Vec3[], slot: number): Vec3 {
  return colors[slot % colors.length];
}

// Remembers which color slot (see COLOR_SLOTS) each tracked organism wears.
// A color lasts as long as the organism's id: splits give new ids (new colors), merges keep one.
export class OrganismPalette {
  private colors = new Map<number, number>();

  constructor(private rng: Rng) {}

  apply(events: ClusterEvents): void {
    for (const id of events.died) this.colors.delete(id);
    for (const m of events.born) this.colors.set(m.id, Math.floor(this.rng() * COLOR_SLOTS));
  }

  indexOf(organismId: number): number | undefined {
    return this.colors.get(organismId);
  }
}
