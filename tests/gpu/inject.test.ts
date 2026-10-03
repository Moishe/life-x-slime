import { describe, it, expect } from 'vitest';
import { InjectPass } from '../../src/physarum/inject-pass';
import { createCountersBuffer, createStorageBuffer, createUniformBuffer } from '../../src/physarum/buffers';
import { ACTOR_BYTES, COUNTERS_BYTES, packActors, unpackActors, unpackCounters } from '../../src/physarum/layout';
import { DEFAULT_PARAMS, SIM_PARAMS_BYTES, packSimParams } from '../../src/physarum/params';
import { actor, getDevice, readBuffer } from './helpers';

async function inject(opts: { poolSize: number; head: number; spawnXs: number[]; childXs: number[]; childCount: number; maxChildren: number }) {
  const device = await getDevice();
  const params = createUniformBuffer(device, SIM_PARAMS_BYTES, 'params');
  device.queue.writeBuffer(params, 0, packSimParams(DEFAULT_PARAMS, {
    width: 64, height: 64, step: 0, poolSize: opts.poolSize, maxChildren: opts.maxChildren, spawnCount: opts.spawnXs.length,
  }));
  const actors = createStorageBuffer(device, opts.poolSize * ACTOR_BYTES, 'actors');
  const spawns = createStorageBuffer(device, opts.spawnXs.length * ACTOR_BYTES, 'spawns');
  if (opts.spawnXs.length) device.queue.writeBuffer(spawns, 0, packActors(opts.spawnXs.map(x => actor({ x }))));
  const children = createStorageBuffer(device, opts.maxChildren * ACTOR_BYTES, 'children');
  if (opts.childXs.length) device.queue.writeBuffer(children, 0, packActors(opts.childXs.map(x => actor({ x }))));
  const counters = createCountersBuffer(device);
  device.queue.writeBuffer(counters, 0, new Uint32Array([opts.head, opts.childCount, 0, 0]));

  const encoder = device.createCommandEncoder();
  new InjectPass(device).encode(encoder, { params, actors, spawns, children, counters }, opts.spawnXs.length + opts.maxChildren);
  device.queue.submit([encoder.finish()]);

  return {
    actors: unpackActors(await readBuffer(device, actors, opts.poolSize * ACTOR_BYTES)),
    counters: unpackCounters(await readBuffer(device, counters, COUNTERS_BYTES)),
  };
}

describe('InjectPass', () => {
  it('writes spawns and children at the ring head, wrapping around', async () => {
    const { actors, counters } = await inject({
      poolSize: 8, head: 6, spawnXs: [100, 101, 102, 103], childXs: [200, 201], childCount: 2, maxChildren: 2,
    });
    // Intra-step order is not deterministic: check which slots changed, not their order.
    const written = [6, 7, 0, 1, 2, 3];
    expect(new Set(written.map(i => actors[i].x))).toEqual(new Set([100, 101, 102, 103, 200, 201]));
    for (const i of written) expect(actors[i].alive).toBe(true);
    for (const i of [4, 5]) expect(actors[i].alive).toBe(false);
    expect(counters.head).toBe(12);
    expect(counters.childrenInserted).toBe(2);
  });

  it('ignores children beyond maxChildren', async () => {
    const { actors, counters } = await inject({
      poolSize: 8, head: 0, spawnXs: [], childXs: [200, 201], childCount: 5, maxChildren: 2,
    });
    expect(actors.filter(a => a.alive)).toHaveLength(2);
    expect(counters.head).toBe(2);
    expect(counters.childrenInserted).toBe(2);
  });

  it('inserts nothing when there is nothing queued', async () => {
    const { actors, counters } = await inject({ poolSize: 8, head: 3, spawnXs: [], childXs: [], childCount: 0, maxChildren: 2 });
    expect(actors.filter(a => a.alive)).toHaveLength(0);
    expect(counters.head).toBe(3);
  });
});
