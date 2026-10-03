import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PARAMS, DEFAULT_POOL_SIZE, SIM_PARAMS_BYTES, packFadeParams, packFoodParams, packSimParams, supportedPoolSizes,
} from '../../src/physarum/params';

describe('DEFAULT_PARAMS', () => {
  it('matches the spec defaults', () => {
    expect(DEFAULT_POOL_SIZE).toBe(131072);
    expect(DEFAULT_PARAMS).toEqual({
      lookSlices: 3, lookRadians: 1, lookDistance: 10,
      directionRandomization: 0.1, directionMomentum: 0.1, minSpeed: 0.3, maxSpeed: 2,
      intensity: 1, foodPerDeath: 0.5, foodExhaustion: 1, foodSensitivity: 0.1,
      life: 20000, alwaysSpawnFromParent: 1, spawnRandomOffset: 1, spawnProbability: 0.0001,
      directionVariance: Math.PI / 4, speedVariance: 0.1,
      lockToHsvAngles: 0, hsvAngleOffset: 1, hsvSaturationMultiplier: 1, hsvValueMultiplier: 1,
      fadeDecrement: 0.01, blurMultiplier: 0, blurInterval: 1, foodFadeDecrement: 0.002, foodFadeInterval: 1,
      wrapBounds: true, rngSeed: 1,
    });
  });
});

describe('packSimParams', () => {
  it('writes every field at its WGSL offset', () => {
    const buf = packSimParams(
      { ...DEFAULT_PARAMS, alwaysSpawnFromParent: -1, wrapBounds: false, lockToHsvAngles: 6 },
      { width: 2048, height: 1024, step: 77, poolSize: 256, maxChildren: 32, spawnCount: 5 },
    );
    expect(buf.byteLength).toBe(SIM_PARAMS_BYTES);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const i = new Int32Array(buf);
    expect([f[0], f[1]]).toEqual([2048, 1024]);
    expect(u[2]).toBe(3);
    expect(f[3]).toBeCloseTo(1);
    expect(f[4]).toBeCloseTo(10);
    expect(f[7]).toBeCloseTo(0.3);
    expect(f[8]).toBeCloseTo(2);
    expect(f[10]).toBeCloseTo(0.1);
    expect(f[11]).toBeCloseTo(1);
    expect(u[12]).toBe(20000);
    expect(i[13]).toBe(-1);
    expect(f[15]).toBeCloseTo(0.0001);
    expect(f[16]).toBeCloseTo(Math.PI / 4);
    expect(u[18]).toBe(6);
    expect(u[22]).toBe(0);
    expect([u[23], u[24], u[25], u[26], u[27]]).toEqual([77, 256, 32, 5, 0]);
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
