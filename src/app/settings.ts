import type { SpawnMode } from '../bridge/spawner';
import { DEFAULT_POOL_SIZE } from '../physarum/params';

export const FIELD_SIZE = 2048;
// Life board sizes; each divides the field into whole square pixel blocks.
export const LIFE_SIZES: readonly number[] = [64, 128, 256, 512, 1024];
export const PHYSARUM_HZ = 30;

export interface AppSettings {
  playing: boolean;
  lifeHz: number;
  randomDensity: number;
  actorsPerBirth: number;
  spawnMode: SpawnMode;
  palette: string;
  colorCount: number;
  lifeOpacity: number;
  physarumOpacity: number;
  foodView: boolean;
  poolSize: number;
  lifeSize: number;
  // Relief shading of the Physarum layer from the pile height field.
  relief: number;
  reliefHeight: number;
  lightAngle: number;
  lightElevation: number;
  heightGain: number;
  heightDecay: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  playing: true,
  lifeHz: 7.5,
  randomDensity: 0.2,
  actorsPerBirth: 129,
  spawnMode: 'trickle',
  palette: 'rainbow',
  colorCount: 8,
  lifeOpacity: 0.05,
  physarumOpacity: 1,
  foodView: false,
  poolSize: DEFAULT_POOL_SIZE,
  lifeSize: 64,
  relief: 0,
  reliefHeight: 8,
  lightAngle: 0.8,
  lightElevation: 0.7,
  heightGain: 0.1,
  heightDecay: 0.02,
};

// Width of one Life cell's block on the Physarum field, in field pixels.
export function cellSizeFor(lifeSize: number): number {
  return FIELD_SIZE / lifeSize;
}

// The integer ?seed=N URL parameter, if present.
export function seedFromUrl(search: string, fallback: number): number {
  const value = new URLSearchParams(search).get('seed');
  const n = value === null ? NaN : Number(value);
  return Number.isInteger(n) ? n : fallback;
}

// The ?size=N URL parameter, if it names a supported Life board size.
export function sizeFromUrl(search: string, fallback: number): number {
  const n = Number(new URLSearchParams(search).get('size'));
  return LIFE_SIZES.includes(n) ? n : fallback;
}
