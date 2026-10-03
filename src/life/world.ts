import type { Rng } from '../rng';
import { LifeEngine, type Cell } from './engine';
import { OrganismPalette } from './palette';
import { placePattern, type Pattern } from './patterns';
import { ClusterTracker, cellKey, type ClusterEvents } from './tracker';

export interface ColoredCell {
  x: number;
  y: number;
  paletteIndex: number;
}

export interface WorldTick {
  births: ColoredCell[];
  deaths: ColoredCell[];
  events: ClusterEvents;
}

// The Life board plus organism tracking and coloring. This is the single
// place other modules (rendering, the Physarum bridge, future MIDI) read
// organism state from.
export class LifeWorld {
  readonly engine: LifeEngine;
  private tracker: ClusterTracker;
  private palette: OrganismPalette;
  private owner = new Map<number, number>();
  private events: ClusterEvents = { born: [], updated: [], died: [] };

  constructor(
    readonly width: number,
    readonly height: number,
    private rng: Rng,
  ) {
    this.engine = new LifeEngine(width, height);
    this.tracker = new ClusterTracker(width, height);
    this.palette = new OrganismPalette(rng);
  }

  tick(): WorldTick {
    const { births, deaths } = this.engine.tick();
    // Deaths take the color of the organism the cell belonged to before this tick.
    const coloredDeaths = deaths.map(c => this.colored(c));
    this.retrack();
    return { births: births.map(c => this.colored(c)), deaths: coloredDeaths, events: this.events };
  }

  toggle(x: number, y: number): void {
    this.engine.set(x, y, !this.engine.get(x, y));
    this.retrack();
  }

  place(pattern: Pattern, x: number, y: number, quarterTurns: number): void {
    placePattern(this.engine, pattern, x, y, quarterTurns);
    this.retrack();
  }

  clear(): void {
    this.engine.clear();
    this.retrack();
  }

  randomFill(density: number): void {
    this.engine.clear();
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.rng() < density) this.engine.set(x, y, true);
      }
    }
    this.retrack();
  }

  liveCells(): ColoredCell[] {
    return this.engine.liveCells().map(c => this.colored(c));
  }

  organismCount(): number {
    return this.events.born.length + this.events.updated.length;
  }

  // Organism events from the most recent tracker update (a tick or an edit).
  latestEvents(): ClusterEvents {
    return this.events;
  }

  private colored(c: Cell): ColoredCell {
    const id = this.owner.get(cellKey(c.x, c.y));
    const paletteIndex = id === undefined ? undefined : this.palette.indexOf(id);
    return { x: c.x, y: c.y, paletteIndex: paletteIndex ?? 0 };
  }

  private retrack(): void {
    this.events = this.tracker.update(this.engine.liveCells());
    this.palette.apply(this.events);
    this.owner.clear();
    for (const m of [...this.events.born, ...this.events.updated]) {
      for (const c of m.cells) this.owner.set(cellKey(c.x, c.y), m.id);
    }
  }
}
