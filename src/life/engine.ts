export interface Cell {
  x: number;
  y: number;
}

export interface TickResult {
  births: Cell[];
  deaths: Cell[];
}

export class LifeEngine {
  readonly width: number;
  readonly height: number;
  private cells: Uint8Array;
  private next: Uint8Array;

  constructor(width = 128, height = 128) {
    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
    this.next = new Uint8Array(width * height);
  }

  get(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.cells[y * this.width + x] === 1;
  }

  set(x: number, y: number, alive: boolean): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.cells[y * this.width + x] = alive ? 1 : 0;
  }

  clear(): void {
    this.cells.fill(0);
  }

  liveCells(): Cell[] {
    const out: Cell[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y * this.width + x] === 1) out.push({ x, y });
      }
    }
    return out;
  }

  population(): number {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) n += this.cells[i];
    return n;
  }

  tick(): TickResult {
    const births: Cell[] = [];
    const deaths: Cell[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (this.get(x + dx, y + dy)) n++;
          }
        }
        const alive = this.cells[y * this.width + x] === 1;
        const lives = alive ? n === 2 || n === 3 : n === 3;
        this.next[y * this.width + x] = lives ? 1 : 0;
        if (lives && !alive) births.push({ x, y });
        if (!lives && alive) deaths.push({ x, y });
      }
    }
    [this.cells, this.next] = [this.next, this.cells];
    return { births, deaths };
  }
}
