import type { Cell } from './engine';
import { LifeEngine } from './engine';

export type PatternCategory = 'drone' | 'pulse' | 'voyager' | 'fountain' | 'wildcard';

export interface Pattern {
  id: string;
  name: string;
  category: PatternCategory;
  cells: Cell[];
  width: number;
  height: number;
}

export function fromRows(rows: string[]): Cell[] {
  const cells: Cell[] = [];
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') cells.push({ x, y });
    });
  });
  return cells;
}

function def(id: string, name: string, category: PatternCategory, rows: string[]): Pattern {
  return {
    id,
    name,
    category,
    cells: fromRows(rows),
    width: Math.max(...rows.map(r => r.length)),
    height: rows.length,
  };
}

export const PATTERNS: Pattern[] = [
  def('block', 'Block', 'drone', ['##', '##']),
  def('beehive', 'Beehive', 'drone', ['.##.', '#..#', '.##.']),
  def('loaf', 'Loaf', 'drone', ['.##.', '#..#', '.#.#', '..#.']),
  def('pond', 'Pond', 'drone', ['.##.', '#..#', '#..#', '.##.']),
  def('blinker', 'Blinker', 'pulse', ['###']),
  def('toad', 'Toad', 'pulse', ['.###', '###.']),
  def('beacon', 'Beacon', 'pulse', ['##..', '##..', '..##', '..##']),
  def('pulsar', 'Pulsar', 'pulse', [
    '..###...###..',
    '.............',
    '#....#.#....#',
    '#....#.#....#',
    '#....#.#....#',
    '..###...###..',
    '.............',
    '..###...###..',
    '#....#.#....#',
    '#....#.#....#',
    '#....#.#....#',
    '.............',
    '..###...###..',
  ]),
  def('pentadecathlon', 'Pentadecathlon', 'pulse', [
    '..#....#..',
    '##.####.##',
    '..#....#..',
  ]),
  def('glider', 'Glider', 'voyager', ['.#.', '..#', '###']),
  def('lwss', 'Lightweight Spaceship', 'voyager', [
    '#..#.',
    '....#',
    '#...#',
    '.####',
  ]),
  def('gosperGun', 'Gosper Glider Gun', 'fountain', [
    '........................#...........',
    '......................#.#...........',
    '............##......##............##',
    '...........#...#....##............##',
    '##........#.....#...##..............',
    '##........#...#.##....#.#...........',
    '..........#.....#.......#...........',
    '...........#...#....................',
    '............##......................',
  ]),
  def('rPentomino', 'R-Pentomino', 'wildcard', ['.##', '##.', '.#.']),
  def('acorn', 'Acorn', 'wildcard', ['.#.....', '...#...', '##..###']),
];

export function rotateCells(cells: Cell[], quarterTurns: number): Cell[] {
  let out = cells.map(c => ({ ...c }));
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (let t = 0; t < turns; t++) {
    const maxY = Math.max(...out.map(c => c.y));
    out = out.map(c => ({ x: maxY - c.y, y: c.x }));
  }
  return out;
}

export function placePattern(
  engine: LifeEngine,
  pattern: Pattern,
  ox: number,
  oy: number,
  quarterTurns = 0,
): void {
  for (const c of rotateCells(pattern.cells, quarterTurns)) {
    engine.set(ox + c.x, oy + c.y, true);
  }
}
