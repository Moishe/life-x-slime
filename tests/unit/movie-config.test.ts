import { describe, it, expect } from 'vitest';
import { MOVIE_FPS, chooseMovieConfig, movieFilename, movieNotice, recordingStatus, type CanEncode } from '../../src/record/movie-config';

// Test encoder probes: report support only for the listed codec/size pairs.
const supports = (...pairs: string[]): CanEncode => async (codec, size) => pairs.includes(`${codec}@${size}`);

describe('chooseMovieConfig', () => {
  it('records 30 fps', () => {
    expect(MOVIE_FPS).toBe(30);
  });

  it('prefers H.264 at 2048', async () => {
    expect(await chooseMovieConfig(supports('avc@2048', 'avc@1024', 'vp9@2048'))).toEqual({ codec: 'avc', size: 2048, bitrate: 20_000_000 });
  });

  it('falls back to H.264 at 1024', async () => {
    expect(await chooseMovieConfig(supports('avc@1024', 'vp9@2048'))).toEqual({ codec: 'avc', size: 1024, bitrate: 8_000_000 });
  });

  it('uses VP9 only when there is no H.264 encoder at all', async () => {
    expect(await chooseMovieConfig(supports('vp9@2048'))).toEqual({ codec: 'vp9', size: 2048, bitrate: 20_000_000 });
    expect(await chooseMovieConfig(supports('vp9@1024'))).toEqual({ codec: 'vp9', size: 1024, bitrate: 8_000_000 });
  });

  it('returns null when nothing can be encoded', async () => {
    expect(await chooseMovieConfig(supports())).toBeNull();
  });
});

describe('movieNotice', () => {
  it('says nothing for full-size H.264', () => {
    expect(movieNotice({ codec: 'avc', size: 2048, bitrate: 20_000_000 })).toBeNull();
  });

  it('explains a smaller size or a different codec', () => {
    expect(movieNotice({ codec: 'avc', size: 1024, bitrate: 8_000_000 })).toBe(
      'Recording at 1024×1024: this browser cannot encode 2048×2048 video.',
    );
    expect(movieNotice({ codec: 'vp9', size: 2048, bitrate: 20_000_000 })).toBe(
      'Recording as VP9: this browser has no H.264 encoder, so some players (such as QuickTime) may not play the movie.',
    );
  });

  it('reports both fallbacks for VP9 at 1024', () => {
    expect(movieNotice({ codec: 'vp9', size: 1024, bitrate: 8_000_000 })).toBe(
      'Recording as VP9: this browser has no H.264 encoder, so some players (such as QuickTime) may not play the movie.\n'
      + 'Recording at 1024×1024: this browser cannot encode 2048×2048 video.',
    );
  });
});

describe('movieFilename', () => {
  it('uses the shared local timestamp format', () => {
    expect(movieFilename(new Date(2026, 9, 4, 7, 5, 9))).toBe('life-x-physarum-2026-10-04-07-05-09.mp4');
  });
});

describe('recordingStatus', () => {
  it('reads "off" when not recording', () => {
    expect(recordingStatus(null)).toBe('off');
  });

  it('shows movie time and frame count while recording', () => {
    expect(recordingStatus(0)).toBe('0.0 s (0 frames)');
    expect(recordingStatus(45)).toBe('1.5 s (45 frames)');
  });
});
