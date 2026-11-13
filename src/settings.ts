/**
 * Persisted plugin settings.
 *
 * `loadData()` returns untrusted JSON: anything can be missing, out of range or
 * of the wrong type. `normalizeSettings` is the single place that turns that
 * into a complete, valid `GraphSettings`, so neither the settings tab nor the
 * view has to defend against bad data.
 */

export interface GraphSettings {
  /** Git executable; a bare name resolved from PATH or an absolute path. */
  gitPath: string;
  /** Commits requested per page (clamped to 10–5000). */
  pageSize: number;
  /** `local` shows local branches and tags; `all` also shows remote-tracking refs. */
  refFilter: 'local' | 'all';
  /** Date format string used by the table (no date library is bundled). */
  dateFormat: string;
}

export const DEFAULT_SETTINGS: GraphSettings = {
  gitPath: 'git',
  pageSize: 200,
  refFilter: 'local',
  dateFormat: 'DD Mon YYYY HH:mm',
};

/** Lowest accepted page size. */
const MIN_PAGE_SIZE = 10;

/** Highest accepted page size. */
const MAX_PAGE_SIZE = 5000;

function normalizePageSize(value: unknown): number {
  // Anything that is not a finite number (missing, NaN, Infinity, strings)
  // falls back to the default; numbers are truncated before clamping so the
  // persisted value is always an integer.
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.pageSize;
  }
  const integer = Math.trunc(value);
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, integer));
}

/** Return a fresh, fully valid settings object from persisted data. */
export function normalizeSettings(data: unknown): GraphSettings {
  const source: Partial<GraphSettings> =
    typeof data === 'object' && data !== null ? data : {};

  const gitPath =
    typeof source.gitPath === 'string' && source.gitPath.trim() !== ''
      ? source.gitPath.trim()
      : DEFAULT_SETTINGS.gitPath;

  // `auto` was the pre-0.1.0 spelling; migrate it so existing data keeps working.
  const refFilter =
    source.refFilter === 'all' || source.refFilter === 'local'
      ? source.refFilter
      : (source.refFilter as string | undefined) === 'auto'
        ? 'local'
        : DEFAULT_SETTINGS.refFilter;

  const dateFormat =
    typeof source.dateFormat === 'string' && source.dateFormat.trim() !== ''
      ? source.dateFormat.trim()
      : DEFAULT_SETTINGS.dateFormat;

  return {
    gitPath,
    pageSize: normalizePageSize(source.pageSize),
    refFilter,
    dateFormat,
  };
}
