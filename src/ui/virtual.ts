/**
 * Pure row/offset math for the virtual commit list.
 *
 * The expanded details block sits between rows, so a row's top is not simply
 * `index * rowHeight`; the inverse used by the scroll window must account for
 * that gap or a tall details panel makes the visible rows disappear.
 */

export function rowTop(index: number, rowHeight: number, expandedIndex: number, detailsHeight: number): number {
  return index * rowHeight + (expandedIndex >= 0 && index > expandedIndex ? detailsHeight : 0);
}

/** Row index at a vertical offset (inverse of `rowTop`). */
export function rowIndexAt(
  offset: number,
  rowHeight: number,
  expandedIndex: number,
  detailsHeight: number,
  rowCount: number,
): number {
  const safeOffset = Math.max(0, offset);
  if (expandedIndex < 0) return Math.min(rowCount, Math.floor(safeOffset / rowHeight));

  const detailsTop = (expandedIndex + 1) * rowHeight;
  if (safeOffset < detailsTop) return Math.floor(safeOffset / rowHeight);
  if (safeOffset < detailsTop + detailsHeight) return Math.min(rowCount, expandedIndex + 1);

  const after = expandedIndex + 1 + Math.floor((safeOffset - detailsTop - detailsHeight) / rowHeight);
  return Math.min(rowCount, after);
}
