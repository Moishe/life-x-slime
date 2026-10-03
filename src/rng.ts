export type Rng = () => number;

// mulberry32: a small seedable PRNG returning floats in [0, 1).
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random u32 that is never 0, for seeding the GPU's per-actor xorshift32.
export function randomNonZeroU32(rng: Rng): number {
  return (Math.floor(rng() * 4294967296) | 1) >>> 0;
}
