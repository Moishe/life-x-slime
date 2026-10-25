import { FixedStepClock, StepTicker } from './clock';
import { RateMeter } from './rates';
import { DEFAULT_SETTINGS, FIELD_SIZE, PHYSARUM_HZ, cellSizeFor, type AppSettings } from './settings';
import { cellColors, imageToActors, nearestColor, type SeedImage } from '../bridge/image-seed';
import { SpawnScheduler, birthsToActors, deathsToFoodSeeds } from '../bridge/spawner';
import type { Vec3 } from '../color';
import type { Cell } from '../life/engine';
import type { ColoredCell } from '../life/world';
import { colorFor, paletteColors } from '../life/palette';
import { LifeWorld } from '../life/world';
import type { FoodSeed } from '../physarum/layout';
import { PhysarumSim } from '../physarum/simulation';
import { Compositor } from '../render/compositor';
import { captureImage } from '../render/snapshot';
import { ghostTexels, lifeTexels } from '../render/texels';
import { mulberry32, type Rng } from '../rng';
import type { LoadedSettings } from './settings-file';
import type { MovieConfig } from '../record/movie-config';
import { MovieRecorder } from '../record/recorder';

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
  // Called if the movie encoder fails mid-recording; the recording is abandoned.
  onRecordingError: (error: unknown) => void = () => {};

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
  private lifePaletteKey = '';
  private ghost: Cell[] = [];
  private ghostDirty = true;
  private recorder: MovieRecorder | null = null;
  // The uploaded seed image, and the average image color under each Life cell.
  private image: SeedImage | null = null;
  private imageCells: Vec3[] = [];
  private readonly recordingLifeTicker = new StepTicker();

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
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
    this.compositor = new Compositor(device, lifeSize);
    this.compositor.setHeight(this.sim.height, FIELD_SIZE, FIELD_SIZE);
  }

  frame(dtMs: number): void {
    if (this.recorder) this.recordingFrame(dtMs);
    else this.liveFrame(dtMs);
    this.render();
    this.stats.frames.add();
  }

  get recordedFrames(): number | null {
    return this.recorder?.frameCount ?? null;
  }

  async startRecording(config: MovieConfig): Promise<void> {
    this.recorder = await MovieRecorder.start(this.device, this.compositor, config);
    this.recordingLifeTicker.reset();
  }

  async finishRecording(): Promise<Blob> {
    const recorder = this.recorder!;
    this.recorder = null;
    this.lifeClock.reset();
    this.physClock.reset();
    return recorder.finish();
  }

  // Wall-clock pacing: Life and Physarum each follow their own clock.
  private liveFrame(dtMs: number): void {
    this.lifeClock.hz = this.settings.lifeHz;
    if (this.settings.playing && this.lifeRuns()) {
      for (let n = this.lifeClock.advance(dtMs); n > 0; n--) this.lifeTick();
    } else {
      this.lifeClock.reset();
    }
    for (let n = this.physClock.advance(dtMs); n > 0; n--) this.physStep();
  }

  // Movie pacing: every Physarum step becomes one frame, and Life ticks every
  // stepsPerLifeTick() steps, so the movie runs at the simulation's own speed.
  // While the encoder is behind, steps are skipped rather than frames dropped.
  private recordingFrame(dtMs: number): void {
    const recorder = this.recorder!;
    let steps = this.physClock.advance(dtMs);
    for (; steps > 0 && !recorder.busy; steps--) {
      if (this.settings.playing && this.lifeRuns() && this.recordingLifeTicker.step(this.stepsPerLifeTick())) this.lifeTick();
      this.physStep();
      this.refreshCellTextures();
      try {
        recorder.addFrame(this.sim.trail, this.settings.physarumOpacity, this.settings.lifeOpacity);
      } catch (error) {
        this.recorder = null;
        void recorder.cancel();
        this.onRecordingError(error);
        return;
      }
    }
    if (steps > 0) this.physClock.reset();
  }

  private colors(): Vec3[] {
    return paletteColors(this.settings.palette, this.settings.colorCount);
  }

  private stepsPerLifeTick(): number {
    return Math.max(1, Math.round(PHYSARUM_HZ / this.settings.lifeHz));
  }

  // Life stands still in image mode, where the field is populated once from
  // the image; in life and hybrid modes it feeds the field.
  private lifeRuns(): boolean {
    return this.settings.seedSource !== 'image';
  }

  // One Life generation; queues its spawns and food for the next Physarum steps.
  lifeTick(): void {
    if (!this.lifeRuns()) return;
    const result = this.world.tick();
    const colorOf = (cell: ColoredCell) => this.cellColor(cell);
    const actors = birthsToActors(
      result.births,
      { actorsPerBirth: this.settings.actorsPerBirth, cellSize: cellSizeFor(this.settings.lifeSize), minSpeed: this.sim.params.minSpeed, life: this.sim.params.life, colorOf },
      this.rng,
      this.settings.poolSize,
    );
    this.scheduler.enqueue(actors, this.stepsPerLifeTick());
    this.pendingSeeds = this.pendingSeeds.concat(deathsToFoodSeeds(result.deaths, colorOf));
    this.lifeDirty = true;
  }

  // The seed color for actors and food from a Life cell: in hybrid mode the
  // image color under the cell (snapped to the palette if asked), otherwise
  // its organism's color.
  private cellColor(cell: ColoredCell): Vec3 {
    if (this.settings.seedSource === 'hybrid' && this.image) {
      const rgb = this.imageCells[cell.y * this.settings.lifeSize + cell.x];
      return this.settings.imageColorMode === 'palette' ? nearestColor(rgb, this.colors()) : rgb;
    }
    return colorFor(this.colors(), cell.paletteIndex);
  }

  // Keeps the image for seeding and for coloring Life cells in hybrid mode.
  loadImage(image: SeedImage): void {
    this.image = image;
    this.imageCells = cellColors(image, this.settings.lifeSize, FIELD_SIZE);
  }

  // Queues actors spawned from the loaded image's pixels, placed where the image sits on the field.
  seedFromImage(): void {
    if (!this.image) return;
    const actors = imageToActors(
      this.image,
      {
        density: this.settings.imageDensityPercent / 100, colorMode: this.settings.imageColorMode, colors: this.colors(),
        minSpeed: this.sim.params.minSpeed, life: this.sim.params.life,
        intensitySteepness: this.settings.imageIntensitySteepness, intensityMidpoint: this.settings.imageIntensityMidpoint,
      },
      this.rng,
      this.settings.poolSize,
    );
    this.scheduler.enqueue(actors, this.stepsPerLifeTick());
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
    if (this.image) this.imageCells = cellColors(this.image, lifeSize, FIELD_SIZE);
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
    this.sim.heightGain = this.settings.heightGain;
    this.sim.heightDecay = this.settings.heightDecay;
    this.scheduler.mode = this.settings.spawnMode;
    const spawns = this.scheduler.takeForStep(this.sim.maxSpawnsPerStep);
    const seeds = this.pendingSeeds.splice(0, this.sim.maxFoodSeedsPerStep);
    this.sim.step(spawns, seeds);
    this.stats.physSteps.add();
    this.stats.lifeInserts.add(spawns.length);
  }

  // RGBA pixels of the Life layer alone, the trail alone, and the two mixed at
  // the panel's opacities, all at the field's full size and without the ghost.
  // All three renders are submitted before any is awaited, so they show the same moment.
  async snapshot(): Promise<{ life: Uint8Array; physarum: Uint8Array; mix: Uint8Array }> {
    this.refreshCellTextures();
    const trail = this.sim.trail;
    const [life, physarum, mix] = await Promise.all([
      captureImage(this.device, this.compositor, trail, 0, 1, FIELD_SIZE),
      captureImage(this.device, this.compositor, trail, 1, 0, FIELD_SIZE),
      captureImage(this.device, this.compositor, trail, this.settings.physarumOpacity, this.settings.lifeOpacity, FIELD_SIZE),
    ]);
    return { life, physarum, mix };
  }

  private render(): void {
    this.refreshCellTextures();
    const { relief, reliefHeight, lightAngle, lightElevation } = this.settings;
    this.compositor.relief = { relief, reliefHeight, lightAngle, lightElevation };
    const field = this.settings.foodView ? this.sim.foodTexture : this.sim.trail;
    this.compositor.render(this.context.getCurrentTexture(), field, this.settings.physarumOpacity, this.settings.lifeOpacity, 1);
  }

  private refreshCellTextures(): void {
    // Also redraw when the panel's palette changes, even if Life is paused.
    const paletteKey = `${this.settings.palette}/${this.settings.colorCount}`;
    if (this.lifeDirty || paletteKey !== this.lifePaletteKey) {
      this.compositor.setLife(lifeTexels(this.world.liveCells(), this.settings.lifeSize, this.colors()));
      this.lifeDirty = false;
      this.lifePaletteKey = paletteKey;
    }
    if (this.ghostDirty) {
      this.compositor.setGhost(ghostTexels(this.ghost, this.settings.lifeSize));
      this.ghostDirty = false;
    }
  }
}
