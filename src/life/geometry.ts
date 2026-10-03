export function cellRadial(x: number, y: number, width: number, height: number): number {
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxDist = Math.hypot(cx, cy);
  return Math.min(1, Math.hypot(x - cx, y - cy) / maxDist);
}

export function panFromX(x: number, width: number): number {
  return (x / (width - 1)) * 2 - 1;
}
