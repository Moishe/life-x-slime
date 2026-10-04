import { exportTimestamp } from '../ui/export-images';

export const MOVIE_FPS = 30;

export type MovieCodec = 'avc' | 'vp9';

export interface MovieConfig {
  codec: MovieCodec;
  size: number;
  bitrate: number;
}

// Asks the browser whether it can encode this codec at size×size and bitrate.
export type CanEncode = (codec: MovieCodec, size: number, bitrate: number) => Promise<boolean>;

// In order of preference: H.264 plays everywhere, so any H.264 size beats VP9.
const CANDIDATES: readonly MovieConfig[] = [
  { codec: 'avc', size: 2048, bitrate: 20_000_000 },
  { codec: 'avc', size: 1024, bitrate: 8_000_000 },
  { codec: 'vp9', size: 2048, bitrate: 20_000_000 },
  { codec: 'vp9', size: 1024, bitrate: 8_000_000 },
];

// The best movie format this browser can encode, or null if it can't encode video.
export async function chooseMovieConfig(canEncode: CanEncode): Promise<MovieConfig | null> {
  for (const candidate of CANDIDATES) {
    if (await canEncode(candidate.codec, candidate.size, candidate.bitrate)) return { ...candidate };
  }
  return null;
}

// A note for the user when the movie won't be full-size H.264.
export function movieNotice(config: MovieConfig): string | null {
  if (config.codec !== 'avc') {
    return 'Recording as VP9: this browser has no H.264 encoder, so some players (such as QuickTime) may not play the movie.';
  }
  if (config.size !== 2048) return `Recording at ${config.size}×${config.size}: this browser cannot encode 2048×2048 video.`;
  return null;
}

export function movieFilename(when: Date): string {
  return `life-x-physarum-${exportTimestamp(when)}.mp4`;
}

// The recording readout: "off", or the movie's length so far.
export function recordingStatus(frames: number | null): string {
  if (frames === null) return 'off';
  return `${(frames / MOVIE_FPS).toFixed(1)} s (${frames} frames)`;
}
