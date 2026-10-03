import { hsv2rgb, type Vec3 } from '../color';
import type { Rng } from '../rng';
import type { ClusterEvents } from './tracker';

export const PALETTE_HUES_DEGREES: readonly number[] = [0, 45, 90, 135, 180, 225, 270, 315];

// Fully saturated, full-value colors spaced evenly around the hue circle.
export const PALETTE: readonly Vec3[] = PALETTE_HUES_DEGREES.map(deg => hsv2rgb([deg / 360, 1, 1]));

// Remembers which palette color each tracked organism wears. A color lasts as
// long as the organism's id: splits give new ids (new colors), merges keep one.
export class OrganismPalette {
  private colors = new Map<number, number>();

  constructor(private rng: Rng) {}

  apply(events: ClusterEvents): void {
    for (const id of events.died) this.colors.delete(id);
    for (const m of events.born) this.colors.set(m.id, Math.floor(this.rng() * PALETTE.length));
  }

  indexOf(organismId: number): number | undefined {
    return this.colors.get(organismId);
  }
}
