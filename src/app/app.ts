import { FixedStepClock } from './clock';
import { RateMeter } from './rates';
import { DEFAULT_SETTINGS, FIELD_SIZE, PHYSARUM_HZ, cellSizeFor, type AppSettings } from './settings';
import { SpawnScheduler, birthsToActors, deathsToFoodSeeds } from '../bridge/spawner';
import type { Cell } from '../life/engine';
import { LifeWorld } from '../life/world';
import type { FoodSeed } from '../physarum/layout';
import { PhysarumSim } from '../physarum/simulation';
import { Compositor } from '../render/compositor';
import { ghostTexels, lifeTexels } from '../render/texels';
import { mulberry32, type Rng } from '../rng';
import type { LoadedSettings } from './settings-file';

// Owns the simulations and clocks, and draws each frame.
export class App {
  readonly settings: AppSettings = { ...DEFAULT_SETTINGS };
  world: LifeWorld;
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
    lifeSize: number,
  ) {
    this.seededRng = mulberry32(seed);
    this.settings.lifeSize = lifeSize;
    this.world = new LifeWorld(lifeSize, lifeSize, this.rng);
    this.sim = new PhysarumSim(device, {
      width: FIELD_SIZE, height: FIELD_SIZE, poolSize: this.settings.poolSize, cellSize: cellSizeFor(lifeSize),
    });
    this.sim.params.rngSeed = seed;
    this.scheduler = new SpawnScheduler(this.settings.poolSize);
    this.compositor = new Compositor(device, format, lifeSize);
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
      { actorsPerBirth: this.settings.actorsPerBirth, cellSize: cellSizeFor(this.settings.lifeSize), minSpeed: this.sim.params.minSpeed, life: this.sim.params.life },
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

  // Starts an empty board at the new size. The food map and pending food are
  // cleared because they are laid out in the old cell blocks; actors and trail stay.
  setLifeSize(lifeSize: number): void {
    this.settings.lifeSize = lifeSize;
    this.world = new LifeWorld(lifeSize, lifeSize, this.rng);
    this.sim.setCellSize(cellSizeFor(lifeSize));
    this.pendingSeeds = [];
    this.compositor.setGridSize(lifeSize);
    this.ghost = [];
    this.lifeDirty = true;
    this.ghostDirty = true;
  }

  // Applies values read from a settings file. Board and pool size go through
  // setLifeSize/setPoolSize, so they clear the board or actors as the panel does.
  applySettings(loaded: LoadedSettings): void {
    const { lifeSize, poolSize, ...plain } = loaded.settings;
    Object.assign(this.settings, plain);
    if (lifeSize !== undefined && lifeSize !== this.settings.lifeSize) this.setLifeSize(lifeSize);
    if (poolSize !== undefined && poolSize !== this.settings.poolSize) this.setPoolSize(poolSize);
    const seedChanged = loaded.physarum.rngSeed !== undefined && loaded.physarum.rngSeed !== this.sim.params.rngSeed;
    Object.assign(this.sim.params, loaded.physarum);
    if (seedChanged) this.reseed(this.sim.params.rngSeed);
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
      this.compositor.setLife(lifeTexels(this.world.liveCells(), this.settings.lifeSize));
      this.lifeDirty = false;
    }
    if (this.ghostDirty) {
      this.compositor.setGhost(ghostTexels(this.ghost, this.settings.lifeSize));
      this.ghostDirty = false;
    }
    const field = this.settings.foodView ? this.sim.foodTexture : this.sim.trail;
    this.compositor.render(this.context.getCurrentTexture().createView(), field, this.settings.physarumOpacity, this.settings.lifeOpacity);
  }
}
