import type { SpawnMode } from '../bridge/spawner';
import { DEFAULT_POOL_SIZE } from '../physarum/params';

export const LIFE_SIZE = 128;
export const FIELD_SIZE = 2048;
export const CELL_SIZE = FIELD_SIZE / LIFE_SIZE;
export const PHYSARUM_HZ = 30;

export interface AppSettings {
  playing: boolean;
  lifeHz: number;
  randomDensity: number;
  actorsPerBirth: number;
  spawnMode: SpawnMode;
  lifeOpacity: number;
  physarumOpacity: number;
  foodView: boolean;
  poolSize: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  playing: true,
  lifeHz: 1,
  randomDensity: 0.2,
  actorsPerBirth: 16,
  spawnMode: 'burst',
  lifeOpacity: 0.6,
  physarumOpacity: 1,
  foodView: false,
  poolSize: DEFAULT_POOL_SIZE,
};

// The integer ?seed=N URL parameter, if present.
export function seedFromUrl(search: string, fallback: number): number {
  const value = new URLSearchParams(search).get('seed');
  const n = value === null ? NaN : Number(value);
  return Number.isInteger(n) ? n : fallback;
}
