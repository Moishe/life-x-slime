import { DEFAULT_SETTINGS, LIFE_SIZES, type AppSettings } from './settings';
import { DEFAULT_PARAMS, type PhysarumParams } from '../physarum/params';

export const SETTINGS_FILE_VERSION = 1;

// Settings worth saving: everything in the panel except moment-to-moment state.
export type SavedSettings = Omit<AppSettings, 'playing' | 'foodView'>;

export interface LoadedSettings {
  settings: Partial<SavedSettings>;
  physarum: Partial<PhysarumParams>;
  warnings: string[];
}

const NOT_A_SETTINGS_FILE = 'This file is not a Life x Physarum settings file.';

export function serializeSettings(settings: AppSettings, params: PhysarumParams): string {
  const { playing, foodView, ...saved } = settings;
  void playing;
  void foodView;
  return JSON.stringify({ version: SETTINGS_FILE_VERSION, settings: saved, physarum: params }, null, 2);
}

// Reads a settings file. Fields that are unknown or invalid are skipped with a
// warning so one bad value doesn't spoil the rest; only an unreadable file or a
// different version is an error.
export function parseSettings(text: string, poolSizes: number[]): LoadedSettings {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_SETTINGS_FILE);
  }
  if (!isRecord(data) || !isRecord(data.settings) || !isRecord(data.physarum)) throw new Error(NOT_A_SETTINGS_FILE);
  if (data.version !== SETTINGS_FILE_VERSION) {
    throw new Error(`This settings file is version ${String(data.version)}; this app reads version ${SETTINGS_FILE_VERSION}.`);
  }

  const warnings: string[] = [];
  const { playing, foodView, ...savedDefaults } = DEFAULT_SETTINGS;
  void playing;
  void foodView;
  const settings = readSection(data.settings, savedDefaults, warnings) as Partial<SavedSettings>;
  const physarum = readSection(data.physarum, DEFAULT_PARAMS, warnings) as Partial<PhysarumParams>;

  if (settings.lifeSize !== undefined && !LIFE_SIZES.includes(settings.lifeSize)) {
    warnings.push(`Skipped "lifeSize": ${settings.lifeSize} is not one of ${LIFE_SIZES.join(', ')}.`);
    delete settings.lifeSize;
  }
  if (settings.poolSize !== undefined && !poolSizes.includes(settings.poolSize)) {
    const fallback = Math.max(...poolSizes);
    warnings.push(`Pool size ${settings.poolSize} is not supported on this GPU; using ${fallback}.`);
    settings.poolSize = fallback;
  }
  return { settings, physarum, warnings };
}

// Copies the fields of `section` whose type matches the same field in `defaults`.
function readSection(section: Record<string, unknown>, defaults: object, warnings: string[]): Record<string, unknown> {
  const known = defaults as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(section)) {
    if (!(key in known)) {
      warnings.push(`Ignored unknown setting "${key}".`);
      continue;
    }
    const problem = typeProblem(key, value, known[key]);
    if (problem) warnings.push(`Skipped "${key}": ${problem}.`);
    else out[key] = value;
  }
  return out;
}

function typeProblem(key: string, value: unknown, example: unknown): string | null {
  if (key === 'spawnMode') return value === 'burst' || value === 'trickle' ? null : 'expected "burst" or "trickle"';
  if (typeof example === 'boolean') return typeof value === 'boolean' ? null : 'expected true or false';
  return typeof value === 'number' && Number.isFinite(value) ? null : 'expected a number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
