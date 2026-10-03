import type { Vec3 } from '../color';

export type Vec4 = [number, number, number, number];

// CPU view of one actor. Must match `struct Actor` in shaders/common.wgsl.
export interface ActorRecord {
  x: number;
  y: number;
  dir: number;
  speed: number;
  seed: Vec4;
  color: Vec4;
  age: number;
  life: number;
  alive: boolean;
  rng: number;
}

export const ACTOR_BYTES = 64;
const ACTOR_WORDS = ACTOR_BYTES / 4;

export function packActors(actors: ActorRecord[]): ArrayBuffer {
  const buf = new ArrayBuffer(actors.length * ACTOR_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  actors.forEach((a, i) => {
    const o = i * ACTOR_WORDS;
    f[o] = a.x;
    f[o + 1] = a.y;
    f[o + 2] = a.dir;
    f[o + 3] = a.speed;
    f.set(a.seed, o + 4);
    f.set(a.color, o + 8);
    u[o + 12] = a.age;
    u[o + 13] = a.life;
    u[o + 14] = a.alive ? 1 : 0;
    u[o + 15] = a.rng;
  });
  return buf;
}

export function unpackActors(buf: ArrayBuffer): ActorRecord[] {
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const out: ActorRecord[] = [];
  for (let o = 0; o + ACTOR_WORDS <= f.length; o += ACTOR_WORDS) {
    out.push({
      x: f[o],
      y: f[o + 1],
      dir: f[o + 2],
      speed: f[o + 3],
      seed: [f[o + 4], f[o + 5], f[o + 6], f[o + 7]],
      color: [f[o + 8], f[o + 9], f[o + 10], f[o + 11]],
      age: u[o + 12],
      life: u[o + 13],
      alive: u[o + 14] !== 0,
      rng: u[o + 15],
    });
  }
  return out;
}

// One dead Life cell's food deposit. Must match `struct FoodSeed` in shaders/food-seed.wgsl.
export interface FoodSeed {
  cellX: number;
  cellY: number;
  rgb: Vec3;
}

export const FOOD_SEED_BYTES = 32;

export function packFoodSeeds(seeds: FoodSeed[]): ArrayBuffer {
  const buf = new ArrayBuffer(seeds.length * FOOD_SEED_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  seeds.forEach((s, i) => {
    const o = i * 8;
    f.set([s.rgb[0], s.rgb[1], s.rgb[2], 1], o);
    u[o + 4] = s.cellX;
    u[o + 5] = s.cellY;
  });
  return buf;
}

// Must match `struct Counters` in shaders/common.wgsl.
export const COUNTERS_BYTES = 16;

export interface CounterValues {
  head: number;
  childCount: number;
  aliveCount: number;
  childrenInserted: number;
}

export function unpackCounters(buf: ArrayBuffer): CounterValues {
  const u = new Uint32Array(buf);
  return { head: u[0], childCount: u[1], aliveCount: u[2], childrenInserted: u[3] };
}

// The pool slot the ring head points at. Mirrors the inject shader.
export function ringSlot(head: number, poolSize: number): number {
  if (!Number.isInteger(Math.log2(poolSize))) throw new Error(`poolSize must be a power of two, got ${poolSize}`);
  return (head & (poolSize - 1)) >>> 0;
}
