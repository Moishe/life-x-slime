import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PARAMS, DEFAULT_POOL_SIZE, SIM_PARAMS_BYTES, packFadeParams, packFoodParams, packSimParams, supportedPoolSizes, type PhysarumParams,
} from '../../src/physarum/params';

describe('DEFAULT_PARAMS', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULT_POOL_SIZE).toBe(1048576);
    expect(DEFAULT_PARAMS).toEqual({
      lookSlices: 6, lookRadians: 1.31, lookDistance: 17,
      directionRandomization: 0.35, directionMomentum: 0.25, minSpeed: 1.13, maxSpeed: 2.81,
      intensity: 0.37, minValue: 0, foodPerDeath: 0.5, foodExhaustion: 0, foodSensitivity: 0.1,
      life: 20000, alwaysSpawnFromParent: 1, spawnRandomOffset: 1, spawnProbability: 0.0134,
      directionVariance: 1.65, speedVariance: 0.1, crowdingLimit: 0,
      lockToHsvAngles: 0, hsvAngleOffset: 1, hsvSaturationMultiplier: 1, hsvValueMultiplier: 1,
      fadeDecrement: 0.001, blurMultiplier: 10.6, blurInterval: 1, foodFadeDecrement: 0.002, foodFadeInterval: 1,
      wrapBounds: true, rngSeed: 1,
    });
  });
});

describe('packSimParams', () => {
  it('writes every field at its WGSL offset', () => {
    // Distinct values per field so a swapped pair of offsets can't go unnoticed.
    const params: PhysarumParams = {
      lookSlices: 3, lookRadians: 1.5, lookDistance: 10, directionRandomization: 0.25,
      directionMomentum: 0.75, minSpeed: 0.3, maxSpeed: 2, intensity: 0.9, minValue: 0.35,
      foodPerDeath: 0.5, foodExhaustion: 0.8, foodSensitivity: 0.1, life: 20000,
      alwaysSpawnFromParent: -1, spawnRandomOffset: 1.25, spawnProbability: 0.0001, directionVariance: 0.6,
      speedVariance: 0.15, crowdingLimit: 7, lockToHsvAngles: 6, hsvAngleOffset: 0.2, hsvSaturationMultiplier: 1.1,
      hsvValueMultiplier: 1.3, fadeDecrement: 0.01, blurMultiplier: 4, blurInterval: 2,
      foodFadeDecrement: 0.002, foodFadeInterval: 3, wrapBounds: false, rngSeed: 9,
    };
    const buf = packSimParams(params, { width: 2048, height: 1024, step: 77, poolSize: 256, maxChildren: 32, spawnCount: 5 });
    expect(buf.byteLength).toBe(SIM_PARAMS_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const i = new Int32Array(buf);
    expect([f[0], f[1]]).toEqual([2048, 1024]);
    expect(u[2]).toBe(3);
    const floats: [number, number][] = [
      [3, 1.5], [4, 10], [5, 0.25], [6, 0.75], [7, 0.3], [8, 2], [9, 0.9], [10, 0.1], [11, 0.8],
      [14, 1.25], [15, 0.0001], [16, 0.6], [17, 0.15], [19, 0.2], [20, 1.1], [21, 1.3],
    ];
    for (const [index, value] of floats) expect(f[index], `word ${index}`).toBeCloseTo(value, 6);
    expect(u[12]).toBe(20000);
    expect(i[13]).toBe(-1);
    expect(u[18]).toBe(6);
    expect(u[22]).toBe(0);
    expect([u[23], u[24], u[25], u[26], u[27]]).toEqual([77, 256, 32, 5, 7]);
    expect(f[28]).toBeCloseTo(0.35, 6);
    expect([u[29], u[30], u[31]]).toEqual([0, 0, 0]);
  });
});

describe('small uniform packers', () => {
  it('packs fade params', () => {
    const f = new Float32Array(packFadeParams(0.25, 3));
    expect(Array.from(f)).toEqual([0.25, 3, 0, 0]);
  });

  it('packs food params', () => {
    const f = new Float32Array(packFoodParams(16, 0.5, 2048, 1024));
    expect(Array.from(f)).toEqual([16, 0.5, 2048, 1024]);
  });
});

describe('supportedPoolSizes', () => {
  it('offers powers of two from 2^14 up to what the limits allow', () => {
    const mib = 1024 * 1024;
    expect(supportedPoolSizes({ maxStorageBufferBindingSize: 128 * mib, maxBufferSize: 256 * mib }))
      .toEqual([2 ** 14, 2 ** 15, 2 ** 16, 2 ** 17, 2 ** 18, 2 ** 19, 2 ** 20, 2 ** 21]);
    expect(supportedPoolSizes({ maxStorageBufferBindingSize: 4096 * mib, maxBufferSize: 4096 * mib }).at(-1)).toBe(2 ** 22);
  });
});
