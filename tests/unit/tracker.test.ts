import { describe, it, expect } from 'vitest';
import { ClusterTracker } from '../../src/life/tracker';
import { LifeEngine } from '../../src/life/engine';
import { mulberry32 } from '../../src/rng';

const cells = (list: [number, number][]) => list.map(([x, y]) => ({ x, y }));

const BLINKER_H: [number, number][] = [[10, 10], [11, 10], [12, 10]];
const BLINKER_V: [number, number][] = [[11, 9], [11, 10], [11, 11]];

describe('ClusterTracker', () => {
  it('reports a new cluster as born with metrics', () => {
    const t = new ClusterTracker(96, 96);
    const ev = t.update(cells(BLINKER_H));
    expect(ev.born).toHaveLength(1);
    expect(ev.updated).toHaveLength(0);
    expect(ev.died).toHaveLength(0);
    const m = ev.born[0];
    expect(m.cellCount).toBe(3);
    expect(m.centroid).toEqual({ x: 11, y: 10 });
    expect(m.aspect).toBe(3);
    expect(m.delta).toBe(0);
    expect(m.velocity).toBe(0);
  });

  it('keeps a blinker as the same cluster across phases', () => {
    const t = new ClusterTracker(96, 96);
    const id = t.update(cells(BLINKER_H)).born[0].id;
    const ev = t.update(cells(BLINKER_V));
    expect(ev.born).toHaveLength(0);
    expect(ev.died).toHaveLength(0);
    expect(ev.updated).toHaveLength(1);
    const m = ev.updated[0];
    expect(m.id).toBe(id);
    expect(m.delta).toBe(0);          // 3 cells in both phases
    expect(m.velocity).toBe(0);       // centroid unchanged
    expect(m.aspect).toBeCloseTo(1 / 3); // vertical now
  });

  it('tracks two separate clusters independently', () => {
    const t = new ClusterTracker(96, 96);
    const ev = t.update(cells([[2, 2], [3, 2], [2, 3], [3, 3], [40, 40], [41, 40], [40, 41], [41, 41]]));
    expect(ev.born).toHaveLength(2);
    const ids = ev.born.map(m => m.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('reports death when a cluster disappears', () => {
    const t = new ClusterTracker(96, 96);
    const id = t.update(cells(BLINKER_H)).born[0].id;
    const ev = t.update([]);
    expect(ev.died).toEqual([id]);
    expect(ev.born).toHaveLength(0);
    expect(ev.updated).toHaveLength(0);
  });

  it('merge: the cluster with larger overlap keeps its id, the other dies', () => {
    const t = new ClusterTracker(96, 96);
    const small: [number, number][] = [[10, 10], [11, 10], [10, 11], [11, 11]]; // 4 cells
    const big: [number, number][] = [[20, 10], [21, 10], [22, 10], [20, 11], [21, 11], [22, 11]]; // 6 cells
    const ev1 = t.update(cells([...small, ...big]));
    expect(ev1.born).toHaveLength(2);
    const bigId = ev1.born.find(m => m.cellCount === 6)!.id;
    const smallId = ev1.born.find(m => m.cellCount === 4)!.id;
    // bridge them into one group (all previous cells still present)
    const bridged: [number, number][] = [...small, ...big, [13, 10], [15, 10], [17, 10], [18, 10]];
    const ev2 = t.update(cells(bridged));
    expect(ev2.updated).toHaveLength(1);
    expect(ev2.updated[0].id).toBe(bigId);
    expect(ev2.died).toEqual([smallId]);
  });

  it('split: the largest fragment keeps the id, others are born', () => {
    const t = new ClusterTracker(96, 96);
    const frag4: [number, number][] = [[10, 10], [11, 10], [10, 11], [11, 11]];
    const frag6: [number, number][] = [[16, 10], [17, 10], [18, 10], [16, 11], [17, 11], [18, 11]];
    const bridge: [number, number][] = [[13, 10], [14, 10]];
    const ev1 = t.update(cells([...frag4, ...bridge, ...frag6]));
    expect(ev1.born).toHaveLength(1);
    const id = ev1.born[0].id;
    const ev2 = t.update(cells([...frag4, ...frag6])); // bridge gone -> two clusters
    expect(ev2.updated).toHaveLength(1);
    expect(ev2.updated[0].id).toBe(id);
    expect(ev2.updated[0].cellCount).toBe(6);
    expect(ev2.born).toHaveLength(1);
    expect(ev2.born[0].cellCount).toBe(4);
    expect(ev2.died).toHaveLength(0);
  });

  it('equal-overlap merge takes the lower prev id even when prev order is reversed', () => {
    const t = new ClusterTracker(96, 96);
    const a: [number, number][] = [[10, 10], [11, 10]];
    const b: [number, number][] = [[20, 10], [21, 10]];
    const ev1 = t.update(cells([...a, ...b]));
    expect(ev1.born).toHaveLength(2);
    const idA = ev1.born.find(m => m.centroid.x === 10.5)!.id;
    const idB = ev1.born.find(m => m.centroid.x === 20.5)!.id;
    // Tick 2: same clusters, but b's cells listed first so the tracker's
    // internal prev map is rebuilt with the higher id inserted first.
    const ev2 = t.update(cells([...b, ...a]));
    expect(ev2.updated).toHaveLength(2);
    // Tick 3: one bridged group overlapping both prevs equally (2 cells each).
    const bridged: [number, number][] = [
      [10, 10], [11, 10], [13, 10], [15, 10], [17, 10], [19, 10], [20, 10], [21, 10],
    ];
    const ev3 = t.update(cells(bridged));
    expect(ev3.updated).toHaveLength(1);
    expect(ev3.updated[0].id).toBe(Math.min(idA, idB));
    expect(ev3.died).toEqual([Math.max(idA, idB)]);
  });

  it('tracks a mover via velocity', () => {
    const t = new ClusterTracker(96, 96);
    const id = t.update(cells([[10, 10], [11, 10], [12, 10]])).born[0].id;
    const ev = t.update(cells([[11, 10], [12, 10], [13, 10]])); // shifted right by 1
    expect(ev.updated[0].id).toBe(id);
    expect(ev.updated[0].velocity).toBeCloseTo(1);
  });
});

describe('ClusterTracker at large board sizes', () => {
  it('tracks a busy 512x512 board in well under a Life tick', () => {
    const engine = new LifeEngine(512, 512);
    const rng = mulberry32(1);
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) if (rng() < 0.2) engine.set(x, y, true);
    }
    const t = new ClusterTracker(512, 512);
    t.update(engine.liveCells());
    engine.tick();
    const start = performance.now();
    t.update(engine.liveCells());
    expect(performance.now() - start).toBeLessThan(250);
  });
});
