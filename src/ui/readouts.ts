export interface ReadoutValues {
  fps: number;
  physStepsPerSec: number;
  alive: number;
  organisms: number;
  lifeInsertsPerSec: number;
  childInsertsPerSec: number;
}

const ROWS: [keyof ReadoutValues, string, string][] = [
  ['fps', 'fps', 'readout-fps'],
  ['physStepsPerSec', 'physarum steps/s', 'readout-steps'],
  ['alive', 'alive actors', 'readout-alive'],
  ['organisms', 'organisms', 'readout-organisms'],
  ['lifeInsertsPerSec', 'inserts/s from Life', 'readout-life-inserts'],
  ['childInsertsPerSec', 'inserts/s from children', 'readout-child-inserts'],
];

// Builds the readout rows; returns a function that updates them.
export function createReadouts(root: HTMLElement): (values: ReadoutValues) => void {
  const cells = new Map<keyof ReadoutValues, HTMLSpanElement>();
  for (const [key, label, testId] of ROWS) {
    const row = document.createElement('div');
    const name = document.createElement('span');
    name.textContent = label;
    const value = document.createElement('span');
    value.dataset.testid = testId;
    value.textContent = '0';
    row.append(name, value);
    root.append(row);
    cells.set(key, value);
  }
  return values => {
    for (const [key] of ROWS) cells.get(key)!.textContent = String(Math.round(values[key]));
  };
}
