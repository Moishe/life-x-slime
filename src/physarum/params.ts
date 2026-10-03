// Live-editable Physarum parameters. Names are camelCase versions of the
// spec's (and Particles') parameter names.
export interface PhysarumParams {
  lookSlices: number;
  lookRadians: number;
  lookDistance: number;
  directionRandomization: number;
  directionMomentum: number;
  minSpeed: number;
  maxSpeed: number;
  intensity: number;
  foodPerDeath: number;
  foodExhaustion: number;
  foodSensitivity: number;
  life: number;
  alwaysSpawnFromParent: number;
  spawnRandomOffset: number;
  spawnProbability: number;
  directionVariance: number;
  speedVariance: number;
  lockToHsvAngles: number;
  hsvAngleOffset: number;
  hsvSaturationMultiplier: number;
  hsvValueMultiplier: number;
  fadeDecrement: number;
  blurMultiplier: number;
  blurInterval: number;
  foodFadeDecrement: number;
  foodFadeInterval: number;
  wrapBounds: boolean;
  rngSeed: number;
}

export const DEFAULT_POOL_SIZE = 2 ** 17;

export const DEFAULT_PARAMS: PhysarumParams = {
  lookSlices: 3,
  lookRadians: 1,
  lookDistance: 10,
  directionRandomization: 0.1,
  directionMomentum: 0.1,
  minSpeed: 0.3,
  maxSpeed: 2,
  intensity: 1,
  foodPerDeath: 0.5,
  foodExhaustion: 1,
  foodSensitivity: 0.1,
  life: 20000,
  alwaysSpawnFromParent: 1,
  spawnRandomOffset: 1,
  spawnProbability: 0.0001,
  directionVariance: Math.PI / 4,
  speedVariance: 0.1,
  lockToHsvAngles: 0,
  hsvAngleOffset: 1,
  hsvSaturationMultiplier: 1,
  hsvValueMultiplier: 1,
  fadeDecrement: 0.01,
  blurMultiplier: 0,
  blurInterval: 1,
  foodFadeDecrement: 0.002,
  foodFadeInterval: 1,
  wrapBounds: true,
  rngSeed: 1,
};

// Per-step values that live in the SimParams uniform alongside the parameters.
export interface SimFrame {
  width: number;
  height: number;
  step: number;
  poolSize: number;
  maxChildren: number;
  spawnCount: number;
}

export const SIM_PARAMS_BYTES = 112;

// Must match `struct SimParams` in shaders/common.wgsl.
export function packSimParams(p: PhysarumParams, frame: SimFrame): ArrayBuffer {
  const buf = new ArrayBuffer(SIM_PARAMS_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const i = new Int32Array(buf);
  f[0] = frame.width;
  f[1] = frame.height;
  u[2] = p.lookSlices;
  f[3] = p.lookRadians;
  f[4] = p.lookDistance;
  f[5] = p.directionRandomization;
  f[6] = p.directionMomentum;
  f[7] = p.minSpeed;
  f[8] = p.maxSpeed;
  f[9] = p.intensity;
  f[10] = p.foodSensitivity;
  f[11] = p.foodExhaustion;
  u[12] = p.life;
  i[13] = p.alwaysSpawnFromParent;
  f[14] = p.spawnRandomOffset;
  f[15] = p.spawnProbability;
  f[16] = p.directionVariance;
  f[17] = p.speedVariance;
  u[18] = p.lockToHsvAngles;
  f[19] = p.hsvAngleOffset;
  f[20] = p.hsvSaturationMultiplier;
  f[21] = p.hsvValueMultiplier;
  u[22] = p.wrapBounds ? 1 : 0;
  u[23] = frame.step;
  u[24] = frame.poolSize;
  u[25] = frame.maxChildren;
  u[26] = frame.spawnCount;
  u[27] = 0;
  return buf;
}

export const FADE_PARAMS_BYTES = 16;

// Must match `struct FadeParams` in shaders/common.wgsl.
export function packFadeParams(decrement: number, blurMultiplier: number): ArrayBuffer {
  return new Float32Array([decrement, blurMultiplier, 0, 0]).buffer;
}

export const FOOD_PARAMS_BYTES = 16;

// Must match `struct FoodParams` in shaders/food-seed.wgsl.
export function packFoodParams(cellSize: number, foodPerDeath: number, width: number, height: number): ArrayBuffer {
  return new Float32Array([cellSize, foodPerDeath, width, height]).buffer;
}

const ACTOR_BYTES_FOR_LIMITS = 64;

// Pool sizes (powers of two from 2^14 to 2^22) whose actor buffer fits the device limits.
export function supportedPoolSizes(limits: { maxStorageBufferBindingSize: number; maxBufferSize: number }): number[] {
  const maxActors = Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) / ACTOR_BYTES_FOR_LIMITS;
  const sizes: number[] = [];
  for (let e = 14; e <= 22; e++) if (2 ** e <= maxActors) sizes.push(2 ** e);
  return sizes;
}
