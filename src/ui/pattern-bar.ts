import { PATTERNS, type Pattern, type PatternCategory } from '../life/patterns';

export type Tool = { kind: 'pattern'; pattern: Pattern } | { kind: 'paint' };

const CATEGORIES: PatternCategory[] = ['drone', 'pulse', 'voyager', 'fountain', 'wildcard'];

// A "Paint cells" tool plus one button per pattern, grouped by category.
export function buildPatternBar(root: HTMLElement, onSelect: (tool: Tool) => void): void {
  const buttons: HTMLButtonElement[] = [];
  const add = (label: string, tool: Tool, parent: HTMLElement): HTMLButtonElement => {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('selected'));
      button.classList.add('selected');
      onSelect(tool);
    });
    buttons.push(button);
    parent.append(button);
    return button;
  };
  add('Paint cells', { kind: 'paint' }, root).classList.add('selected');
  for (const category of CATEGORIES) {
    const heading = document.createElement('h3');
    heading.textContent = category;
    root.append(heading);
    for (const pattern of PATTERNS.filter(p => p.category === category)) {
      add(pattern.name, { kind: 'pattern', pattern }, root);
    }
  }
}
