import { describe, it, expect } from 'vitest';
import { snapshotFilenames } from '../../src/ui/export-images';

describe('snapshotFilenames', () => {
  it('names the three images with a shared local timestamp', () => {
    const when = new Date(2026, 9, 3, 7, 5, 9); // 3 Oct 2026, 07:05:09 local time
    expect(snapshotFilenames(when)).toEqual({
      life: 'life-x-physarum-2026-10-03-07-05-09-life.png',
      physarum: 'life-x-physarum-2026-10-03-07-05-09-physarum.png',
      mix: 'life-x-physarum-2026-10-03-07-05-09-mix.png',
    });
  });
});
