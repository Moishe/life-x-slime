import { describe, it, expect } from 'vitest';
import { SETTINGS_FILE_VERSION, parseSettings, serializeSettings } from '../../src/app/settings-file';
import { DEFAULT_SETTINGS } from '../../src/app/settings';
import { DEFAULT_PARAMS } from '../../src/physarum/params';

const POOL_SIZES = [2 ** 14, 2 ** 15, 2 ** 16, 2 ** 17, 2 ** 18, 2 ** 19, 2 ** 20];

const fileWith = (settings: object, physarum: object, version = SETTINGS_FILE_VERSION) =>
  JSON.stringify({ version, settings, physarum });

describe('serializeSettings', () => {
  it('writes versioned JSON with every panel value but no moment-to-moment state', () => {
    const data = JSON.parse(serializeSettings({ ...DEFAULT_SETTINGS, playing: false, foodView: true }, DEFAULT_PARAMS));
    expect(data.version).toBe(SETTINGS_FILE_VERSION);
    const { playing, foodView, ...persisted } = DEFAULT_SETTINGS;
    void playing;
    void foodView;
    expect(data.settings).toEqual(persisted);
    expect(data.physarum).toEqual(DEFAULT_PARAMS);
  });
});

describe('parseSettings', () => {
  it('round-trips everything that was saved', () => {
    const settings = {
      ...DEFAULT_SETTINGS, lifeOpacity: 0.3, lifeSize: 256, spawnMode: 'burst' as const, poolSize: 2 ** 16, palette: 'fairy floss', colorCount: 5,
      relief: 0.5, reliefHeight: 12, lightAngle: 1.5, lightElevation: 0.4, heightGain: 0.2, heightDecay: 0.05,
    };
    const params = { ...DEFAULT_PARAMS, lookDistance: 33, wrapBounds: false, rngSeed: 5 };
    const result = parseSettings(serializeSettings(settings, params), POOL_SIZES);
    expect(result.warnings).toEqual([]);
    expect(result.settings).toEqual({
      lifeHz: settings.lifeHz, randomDensity: settings.randomDensity, actorsPerBirth: settings.actorsPerBirth,
      spawnMode: 'burst', palette: 'fairy floss', colorCount: 5, lifeOpacity: 0.3, physarumOpacity: settings.physarumOpacity, poolSize: 2 ** 16, lifeSize: 256,
      relief: 0.5, reliefHeight: 12, lightAngle: 1.5, lightElevation: 0.4, heightGain: 0.2, heightDecay: 0.05,
    });
    expect(result.physarum).toEqual(params);
  });

  it('leaves out keys the file does not mention', () => {
    const result = parseSettings(fileWith({ lifeHz: 2 }, { lookSlices: 4 }), POOL_SIZES);
    expect(result.settings).toEqual({ lifeHz: 2 });
    expect(result.physarum).toEqual({ lookSlices: 4 });
    expect(result.warnings).toEqual([]);
  });

  it('ignores unknown keys with a warning', () => {
    const result = parseSettings(fileWith({ playing: false, colour: 'red' }, { warpFactor: 9 }), POOL_SIZES);
    expect(result.settings).toEqual({});
    expect(result.physarum).toEqual({});
    expect(result.warnings).toEqual([
      'Ignored unknown setting "playing".',
      'Ignored unknown setting "colour".',
      'Ignored unknown setting "warpFactor".',
    ]);
  });

  it('skips values of the wrong type with a warning', () => {
    const result = parseSettings(
      fileWith({ lifeOpacity: 'high', spawnMode: 'sometimes', palette: 'plaid' }, { wrapBounds: 1, lookDistance: null, minSpeed: Infinity }),
      POOL_SIZES,
    );
    expect(result.settings).toEqual({});
    expect(result.physarum).toEqual({});
    expect(result.warnings).toEqual([
      'Skipped "lifeOpacity": expected a number.',
      'Skipped "spawnMode": expected "burst" or "trickle".',
      'Skipped "palette": expected one of rainbow, fairy floss, apple 1980s, dracula, solarized, nord, synthwave, sunset, pico-8.',
      'Skipped "wrapBounds": expected true or false.',
      'Skipped "lookDistance": expected a number.',
      'Skipped "minSpeed": expected a number.',
    ]);
  });

  it('skips an unsupported board size with a warning', () => {
    const result = parseSettings(fileWith({ lifeSize: 300 }, {}), POOL_SIZES);
    expect(result.settings).toEqual({});
    expect(result.warnings).toEqual(['Skipped "lifeSize": 300 is not one of 64, 128, 256, 512, 1024.']);
  });

  it('falls back to the largest supported pool size with a warning', () => {
    const result = parseSettings(fileWith({ poolSize: 2 ** 22 }, {}), POOL_SIZES);
    expect(result.settings).toEqual({ poolSize: 2 ** 20 });
    expect(result.warnings).toEqual(['Pool size 4194304 is not supported on this GPU; using 1048576.']);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseSettings('not json {', POOL_SIZES)).toThrow('This file is not a Life x Physarum settings file.');
  });

  it('rejects a file with no settings object', () => {
    expect(() => parseSettings('[1, 2, 3]', POOL_SIZES)).toThrow('This file is not a Life x Physarum settings file.');
  });

  it('rejects a different file version', () => {
    expect(() => parseSettings(fileWith({}, {}, 99), POOL_SIZES)).toThrow(
      `This settings file is version 99; this app reads version ${SETTINGS_FILE_VERSION}.`,
    );
  });
});
