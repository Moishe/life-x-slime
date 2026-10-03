import { PALETTE } from '../life/palette';
import type { ColoredCell } from '../life/world';
import type { ActorRecord, FoodSeed } from '../physarum/layout';
import { randomNonZeroU32, type Rng } from '../rng';

export interface SpawnSettings {
  actorsPerBirth: number;
  cellSize: number;
  minSpeed: number;
  life: number;
}

// Turns Life births into Physarum actors placed randomly inside each newborn
// cell's block. Returns at most maxActors; when there are more, the newest
// births win (older ones would be evicted from the ring anyway).
export function birthsToActors(births: ColoredCell[], settings: SpawnSettings, rng: Rng, maxActors: number): ActorRecord[] {
  if (settings.actorsPerBirth <= 0 || maxActors <= 0) return [];
  const kept = births.slice(-Math.ceil(maxActors / settings.actorsPerBirth));
  const actors: ActorRecord[] = [];
  for (const b of kept) {
    const [r, g, bl] = PALETTE[b.paletteIndex];
    for (let i = 0; i < settings.actorsPerBirth; i++) {
      actors.push({
        x: (b.x + rng()) * settings.cellSize,
        y: (b.y + rng()) * settings.cellSize,
        dir: rng() * 2 * Math.PI,
        speed: settings.minSpeed,
        seed: [r, g, bl, 1],
        color: [r, g, bl, 1],
        age: 0,
        life: settings.life,
        alive: true,
        rng: randomNonZeroU32(rng),
      });
    }
  }
  return actors.slice(-maxActors);
}

export function deathsToFoodSeeds(deaths: ColoredCell[]): FoodSeed[] {
  return deaths.map(d => {
    const [r, g, b] = PALETTE[d.paletteIndex];
    return { cellX: d.x, cellY: d.y, rgb: [r, g, b] };
  });
}

export type SpawnMode = 'burst' | 'trickle';

// Queues spawned actors between Life ticks and hands them to Physarum steps,
// either all at once (burst) or spread evenly until the next tick (trickle).
export class SpawnScheduler {
  mode: SpawnMode = 'burst';
  private queue: ActorRecord[] = [];
  private stepsLeft = 1;

  constructor(public maxQueued: number) {}

  enqueue(actors: ActorRecord[], stepsUntilNextTick: number): void {
    this.queue = this.queue.concat(actors);
    if (this.queue.length > this.maxQueued) this.queue = this.queue.slice(this.queue.length - this.maxQueued);
    this.stepsLeft = Math.max(1, stepsUntilNextTick);
  }

  takeForStep(limit: number): ActorRecord[] {
    const wanted = this.mode === 'burst' ? this.queue.length : Math.ceil(this.queue.length / this.stepsLeft);
    this.stepsLeft = Math.max(1, this.stepsLeft - 1);
    return this.queue.splice(0, Math.min(wanted, limit));
  }

  get pending(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
    this.stepsLeft = 1;
  }
}
