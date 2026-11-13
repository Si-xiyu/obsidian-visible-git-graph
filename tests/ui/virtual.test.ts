import { describe, expect, it } from 'vitest';
import { rowIndexAt, rowTop } from '../../src/ui/virtual';

describe('virtual row math', () => {
  it('maps offsets to rows without an expanded block', () => {
    expect(rowIndexAt(0, 24, -1, 0, 10)).toBe(0);
    expect(rowIndexAt(23, 24, -1, 0, 10)).toBe(0);
    expect(rowIndexAt(24, 24, -1, 0, 10)).toBe(1);
    expect(rowIndexAt(10_000, 24, -1, 0, 10)).toBe(10);
  });

  it('accounts for a details block taller than the overscan', () => {
    const rowHeight = 24;
    const detailsHeight = 600;
    const expanded = 1;

    // Details occupy [48, 648); rows after it start at 648.
    expect(rowIndexAt(47, rowHeight, expanded, detailsHeight, 100)).toBe(1);
    expect(rowIndexAt(48, rowHeight, expanded, detailsHeight, 100)).toBe(2);
    expect(rowIndexAt(647, rowHeight, expanded, detailsHeight, 100)).toBe(2);
    expect(rowIndexAt(648, rowHeight, expanded, detailsHeight, 100)).toBe(2);
    expect(rowIndexAt(672, rowHeight, expanded, detailsHeight, 100)).toBe(3);
  });

  it('is the inverse of rowTop for rows after the details block', () => {
    const rowHeight = 24;
    const detailsHeight = 600;
    const expanded = 1;

    for (const index of [2, 3, 10, 99]) {
      expect(rowIndexAt(rowTop(index, rowHeight, expanded, detailsHeight), rowHeight, expanded, detailsHeight, 100)).toBe(
        index,
      );
    }
  });

  it('clamps to the row count', () => {
    expect(rowIndexAt(10_000, 24, -1, 0, 5)).toBe(5);
    expect(rowIndexAt(10_000, 24, 1, 600, 5)).toBe(5);
  });
});
