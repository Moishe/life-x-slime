import { WEBCAM_INTERVAL_MAX_SEC, WEBCAM_INTERVAL_MIN_SEC } from '../app/settings';

// The capture interval slider is logarithmic: a position in [0, 1] maps onto
// seconds so that equal slider distances are equal ratios of interval.
const RATIO = WEBCAM_INTERVAL_MAX_SEC / WEBCAM_INTERVAL_MIN_SEC;

export function intervalFromPosition(position: number): number {
  return WEBCAM_INTERVAL_MIN_SEC * RATIO ** position;
}

// The slider position for an interval, clamped to the slider's ends.
export function positionFromInterval(seconds: number): number {
  const position = Math.log(seconds / WEBCAM_INTERVAL_MIN_SEC) / Math.log(RATIO);
  return Math.max(0, Math.min(1, position));
}

// "24 fps" below a second, "2.5 s" from a second up.
export function formatInterval(seconds: number): string {
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '');
  return seconds < 1 ? `${trim(1 / seconds)} fps` : `${trim(seconds)} s`;
}
