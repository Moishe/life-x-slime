import type { Cell } from './engine';
import { cellRadial, panFromX } from './geometry';

// Unique per cell for grids narrower than 4090 columns.
export const cellKey = (x: number, y: number): number => y * 4096 + x;

class UnionFind {
  private parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

// Forward half of the 5x5 Chebyshev-distance-2 neighborhood.
const OFFSETS: [number, number][] = [];
for (let dy = 0; dy <= 2; dy++) {
  for (let dx = -2; dx <= 2; dx++) {
    if (dy > 0 || dx > 0) OFFSETS.push([dx, dy]);
  }
}

export function groupCells(cells: Cell[]): Cell[][] {
  const index = new Map<number, number>();
  cells.forEach((c, i) => index.set(cellKey(c.x, c.y), i));
  const uf = new UnionFind(cells.length);
  for (let i = 0; i < cells.length; i++) {
    for (const [dx, dy] of OFFSETS) {
      const j = index.get(cellKey(cells[i].x + dx, cells[i].y + dy));
      if (j !== undefined) uf.union(i, j);
    }
  }
  const groups = new Map<number, Cell[]>();
  for (let i = 0; i < cells.length; i++) {
    const root = uf.find(i);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(cells[i]);
  }
  return [...groups.values()];
}

export interface ClusterMetrics {
  id: number;
  cells: Cell[];
  cellCount: number;
  centroid: { x: number; y: number };
  radial: number;
  pan: number;
  aspect: number;
  delta: number;
  velocity: number;
}

export interface ClusterEvents {
  born: ClusterMetrics[];
  updated: ClusterMetrics[];
  died: number[];
}

interface PrevCluster {
  keys: Set<number>;
  cellCount: number;
  centroid: { x: number; y: number };
}

function centroidOf(cells: Cell[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const c of cells) {
    sx += c.x;
    sy += c.y;
  }
  return { x: sx / cells.length, y: sy / cells.length };
}

export class ClusterTracker {
  private nextId = 1;
  private prev = new Map<number, PrevCluster>();

  constructor(
    private width: number,
    private height: number,
  ) {}

  update(liveCells: Cell[]): ClusterEvents {
    const groups = groupCells(liveCells).map(cells => ({
      cells,
      keys: new Set(cells.map(c => cellKey(c.x, c.y))),
      centroid: centroidOf(cells),
      claim: null as number | null,
    }));

    // Which previous cluster owned each cell, so overlaps cost one lookup per cell.
    const prevOwner = new Map<number, number>();
    for (const [id, p] of this.prev) for (const k of p.keys) prevOwner.set(k, id);

    // 1. Claim by largest cell overlap (ties toward lower prev id).
    for (const g of groups) {
      const overlaps = new Map<number, number>();
      for (const k of g.keys) {
        const id = prevOwner.get(k);
        if (id !== undefined) overlaps.set(id, (overlaps.get(id) ?? 0) + 1);
      }
      let best: { id: number; overlap: number } | null = null;
      for (const [id, overlap] of overlaps) {
        if (!best || overlap > best.overlap || (overlap === best.overlap && id < best.id)) {
          best = { id, overlap };
        }
      }
      g.claim = best?.id ?? null;
    }

    // 2. Fallback: unclaimed group adopts nearest unclaimed prev centroid within 3.
    const claimed = new Set<number>();
    for (const g of groups) if (g.claim !== null) claimed.add(g.claim);
    for (const g of groups) {
      if (g.claim !== null) continue;
      let best: { id: number; d: number } | null = null;
      for (const [id, p] of this.prev) {
        if (claimed.has(id)) continue;
        const d = Math.hypot(g.centroid.x - p.centroid.x, g.centroid.y - p.centroid.y);
        if (d <= 3 && (!best || d < best.d || (d === best.d && id < best.id))) best = { id, d };
      }
      if (best) {
        g.claim = best.id;
        claimed.add(best.id);
      }
    }

    // 3. Splits: several groups claiming one prev id -> largest keeps it.
    const byClaim = new Map<number, typeof groups>();
    for (const g of groups) {
      if (g.claim === null) continue;
      let list = byClaim.get(g.claim);
      if (!list) {
        list = [];
        byClaim.set(g.claim, list);
      }
      list.push(g);
    }
    for (const [, claimants] of byClaim) {
      if (claimants.length < 2) continue;
      claimants.sort((a, b) => b.cells.length - a.cells.length);
      for (const loser of claimants.slice(1)) loser.claim = null;
    }

    // 4. Build events.
    const born: ClusterMetrics[] = [];
    const updated: ClusterMetrics[] = [];
    const claimedIds = new Set<number>();
    const nextPrev = new Map<number, PrevCluster>();

    for (const g of groups) {
      const isNew = g.claim === null;
      const id = isNew ? this.nextId++ : g.claim!;
      if (!isNew) claimedIds.add(id);
      const prev = isNew ? undefined : this.prev.get(id);
      const m = this.metricsFor(id, g.cells, g.centroid, prev);
      (isNew ? born : updated).push(m);
      nextPrev.set(id, { keys: g.keys, cellCount: g.cells.length, centroid: g.centroid });
    }

    const died = [...this.prev.keys()].filter(id => !claimedIds.has(id));
    this.prev = nextPrev;
    return { born, updated, died };
  }

  private metricsFor(
    id: number,
    cells: Cell[],
    centroid: { x: number; y: number },
    prev: PrevCluster | undefined,
  ): ClusterMetrics {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of cells) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    return {
      id,
      cells,
      cellCount: cells.length,
      centroid,
      radial: cellRadial(centroid.x, centroid.y, this.width, this.height),
      pan: panFromX(centroid.x, this.width),
      aspect: (maxX - minX + 1) / (maxY - minY + 1),
      delta: prev ? cells.length - prev.cellCount : 0,
      velocity: prev
        ? Math.hypot(centroid.x - prev.centroid.x, centroid.y - prev.centroid.y)
        : 0,
    };
  }
}
