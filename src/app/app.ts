import { FixedStepClock } from './clock';
import { RateMeter } from './rates';
import { CELL_SIZE, DEFAULT_SETTINGS, FIELD_SIZE, LIFE_SIZE, PHYSARUM_HZ, type AppSettings } from './settings';
import { SpawnScheduler, birthsToActors, deathsToFoodSeeds } from '../bridge/spawner';
import type { Cell } from '../life/engine';
import { LifeWorld } from '../life/world';
import type { FoodSeed } from '../physarum/layout';
import { PhysarumSim } from '../physarum/simulation';
import { Compositor } from '../render/compositor';
import { ghostTexels, lifeTexels } from '../render/texels';
import { mulberry32, type Rng } from '../rng';

// Owns the simulations and clocks, and draws each frame.
export class App {
  readonly settings: AppSettings = { ...DEFAULT_SETTINGS };
  readonly world: LifeWorld;
  readonly sim: PhysarumSim;
  readonly stats = {
    frames: new RateMeter(),
    physSteps: new RateMeter(),
    lifeInserts: new RateMeter(),
    childInserts: new RateMeter(),
  };
  alive = 0;

  private readonly scheduler: SpawnScheduler;
  private readonly compositor: Compositor;
  private seededRng: Rng;
  // A stable function the world can hold on to, even after reseeding.
  private readonly rng: Rng = () => this.seededRng();
  private readonly lifeClock = new FixedStepClock(1, 1);
  private readonly physClock = new FixedStepClock(PHYSARUM_HZ, 4);
  private pendingSeeds: FoodSeed[] = [];
  private lastChildrenInserted = 0;
  private lifeDirty = true;
  private ghost: Cell[] = [];
  private ghostDirty = true;

  constructor(
    device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
    seed: number,
  ) {
    this.seededRng = mulberry32(seed);
    this.world = new LifeWorld(LIFE_SIZE, LIFE_SIZE, this.rng);
    this.sim = new PhysarumSim(device, { width: FIELD_SIZE, height: FIELD_SIZE, poolSize: this.settings.poolSize, cellSize: CELL_SIZE });
    this.sim.params.rngSeed = seed;
    this.scheduler = new SpawnScheduler(this.settings.poolSize);
    this.compositor = new Compositor(device, format, LIFE_SIZE);
  }

  frame(dtMs: number): void {
    this.lifeClock.hz = this.settings.lifeHz;
    if (this.settings.playing) {
      for (let n = this.lifeClock.advance(dtMs); n > 0; n--) this.lifeTick();
    } else {
      this.lifeClock.reset();
    }
    for (let n = this.physClock.advance(dtMs); n > 0; n--) this.physStep();
    this.render();
    this.stats.frames.add();
  }

  // One Life generation; queues its spawns and food for the next Physarum steps.
  lifeTick(): void {
    const result = this.world.tick();
    const actors = birthsToActors(
      result.births,
      { actorsPerBirth: this.settings.actorsPerBirth, cellSize: CELL_SIZE, minSpeed: this.sim.params.minSpeed, life: this.sim.params.life },
      this.rng,
      this.settings.poolSize,
    );
    this.scheduler.enqueue(actors, Math.max(1, Math.round(PHYSARUM_HZ / this.settings.lifeHz)));
    this.pendingSeeds = this.pendingSeeds.concat(deathsToFoodSeeds(result.deaths));
    this.lifeDirty = true;
  }

  editWorld(edit: (world: LifeWorld) => void): void {
    edit(this.world);
    this.lifeDirty = true;
  }

  setGhost(cells: Cell[]): void {
    this.ghost = cells;
    this.ghostDirty = true;
  }

  setPoolSize(poolSize: number): void {
    this.settings.poolSize = poolSize;
    this.sim.setPoolSize(poolSize);
    this.scheduler.maxQueued = poolSize;
    this.scheduler.clear();
    this.lastChildrenInserted = 0;
  }

  clearActors(): void {
    this.sim.clearActors();
    this.scheduler.clear();
    this.lastChildrenInserted = 0;
  }

  reseed(seed: number): void {
    this.seededRng = mulberry32(seed);
  }

  // Refreshes alive/children readouts from the GPU; skipped if a read is in flight.
  async pollCounters(): Promise<void> {
    const counters = await this.sim.readCounters();
    if (!counters) return;
    this.alive = counters.aliveCount;
    this.stats.childInserts.add(counters.childrenInserted - this.lastChildrenInserted);
    this.lastChildrenInserted = counters.childrenInserted;
  }

  private physStep(): void {
    this.scheduler.mode = this.settings.spawnMode;
    const spawns = this.scheduler.takeForStep(this.sim.maxSpawnsPerStep);
    const seeds = this.pendingSeeds.splice(0, this.sim.maxFoodSeedsPerStep);
    this.sim.step(spawns, seeds);
    this.stats.physSteps.add();
    this.stats.lifeInserts.add(spawns.length);
  }

  private render(): void {
    if (this.lifeDirty) {
      this.compositor.setLife(lifeTexels(this.world.liveCells(), LIFE_SIZE));
      this.lifeDirty = false;
    }
    if (this.ghostDirty) {
      this.compositor.setGhost(ghostTexels(this.ghost, LIFE_SIZE));
      this.ghostDirty = false;
    }
    const field = this.settings.foodView ? this.sim.foodTexture : this.sim.trail;
    this.compositor.render(this.context.getCurrentTexture().createView(), field, this.settings.physarumOpacity, this.settings.lifeOpacity);
  }
}
