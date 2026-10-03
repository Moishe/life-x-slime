import GUI from 'lil-gui';
import { LIFE_SIZES, type AppSettings } from '../app/settings';
import type { PhysarumParams } from '../physarum/params';

export interface PanelActions {
  playPause(): void;
  step(): void;
  clear(): void;
  randomFill(): void;
  clearTrail(): void;
  clearFood(): void;
  clearActors(): void;
  poolSizeChanged(poolSize: number): void;
  lifeSizeChanged(lifeSize: number): void;
  seedChanged(seed: number): void;
}

// The lil-gui control panel. Controls write straight into settings/params,
// which the app reads every frame/step.
export function buildPanel(settings: AppSettings, params: PhysarumParams, poolSizes: number[], actions: PanelActions): GUI {
  const gui = new GUI({ title: 'Life x Physarum' });

  const layers = gui.addFolder('Layers');
  layers.add(settings, 'lifeOpacity', 0, 1, 0.01);
  layers.add(settings, 'physarumOpacity', 0, 1, 0.01);
  layers.add(settings, 'foodView').name('food view (T)');

  const life = gui.addFolder('Life');
  life.add(actions, 'playPause').name('play / pause');
  life.add(actions, 'step');
  life.add(actions, 'clear');
  life.add(actions, 'randomFill').name('random fill');
  life.add(settings, 'randomDensity', 0, 1, 0.01).name('density');
  life.add(settings, 'lifeHz', 0.25, 8, 0.25).name('tick rate (Hz)');
  const boardSize = life.add(settings, 'lifeSize', LIFE_SIZES).name('board size').onChange(actions.lifeSizeChanged);
  boardSize.domElement.dataset.testid = 'board-size';

  const bridge = gui.addFolder('Bridge');
  bridge.add(settings, 'actorsPerBirth', 0, 256, 1);
  bridge.add(settings, 'spawnMode', ['burst', 'trickle']);

  const physarum = gui.addFolder('Physarum');
  const pool = physarum.add(settings, 'poolSize', poolSizes).onChange(actions.poolSizeChanged);
  pool.domElement.dataset.testid = 'pool-size';

  const sensing = physarum.addFolder('Sensing');
  sensing.add(params, 'lookSlices', 1, 8, 1);
  sensing.add(params, 'lookRadians', 0, Math.PI, 0.01);
  sensing.add(params, 'lookDistance', 1, 64, 1);

  const movement = physarum.addFolder('Movement');
  movement.add(params, 'directionRandomization', 0, 2, 0.01);
  movement.add(params, 'directionMomentum', 0, 1, 0.01);
  movement.add(params, 'minSpeed', 0, 5, 0.01);
  movement.add(params, 'maxSpeed', 0, 10, 0.01);

  const deposit = physarum.addFolder('Deposit & Color');
  deposit.add(params, 'intensity', 0, 2, 0.01);
  deposit.add(params, 'lockToHsvAngles', 0, 12, 1);
  deposit.add(params, 'hsvAngleOffset', 0, 1, 0.01);
  deposit.add(params, 'hsvSaturationMultiplier', 0, 2, 0.01);
  deposit.add(params, 'hsvValueMultiplier', 0, 2, 0.01);

  const food = physarum.addFolder('Food');
  food.add(params, 'foodPerDeath', 0, 1, 0.01);
  food.add(params, 'foodExhaustion', 0, 1, 0.01).name('foodExhaustion (0 = off)');
  food.add(params, 'foodSensitivity', 0, 2, 0.01);

  const fade = physarum.addFolder('Fade');
  fade.add(params, 'fadeDecrement', 0, 0.1, 0.001);
  fade.add(params, 'blurMultiplier', 0, 16, 0.1);
  fade.add(params, 'blurInterval', 1, 10, 1);
  fade.add(params, 'foodFadeDecrement', 0, 0.1, 0.0005);
  fade.add(params, 'foodFadeInterval', 1, 10, 1);

  const lifecycle = physarum.addFolder('Reproduction & Lifecycle');
  lifecycle.add(params, 'spawnProbability', 0, 0.05, 0.0001);
  lifecycle.add(params, 'directionVariance', 0, Math.PI, 0.01);
  lifecycle.add(params, 'speedVariance', 0, 1, 0.01);
  lifecycle.add(params, 'spawnRandomOffset', 0, 16, 0.1);
  lifecycle.add(params, 'alwaysSpawnFromParent', [-1, 0, 1]);
  lifecycle.add(params, 'life', 1, 100000, 1);

  const world = physarum.addFolder('World');
  world.add(params, 'wrapBounds');
  world.add(params, 'rngSeed').step(1).onFinishChange(actions.seedChanged);

  physarum.add(actions, 'clearTrail').name('clear trail');
  physarum.add(actions, 'clearFood').name('clear food');
  physarum.add(actions, 'clearActors').name('clear actors');

  return gui;
}
