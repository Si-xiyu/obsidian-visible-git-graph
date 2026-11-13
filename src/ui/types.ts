/**
 * Shared view-model types for the graph pane.
 *
 * The loader (`src/graph/load.ts`) builds a `GraphViewModel`; the Vue
 * components only consume it. Keeping this contract in one file prevents the
 * data layer and the rendering layer from drifting apart.
 */
import type { CommitFile } from '../git/detail';
import type { GitCommit } from '../git/repo';
import type { Commit, GraphLayout, RowStyle, UncommittedMark } from '../graph/types';

export interface GraphRefBadge {
  key: string;
  name: string;
  type: 'head' | 'branch' | 'remote' | 'tag';
  colour: string;
}

export interface GraphRow {
  commit: GitCommit;
  row: number;
  hash: string;
  description: string;
  author: string;
  date: number;
  colour: string;
  muted: boolean;
  current: boolean;
  refs: GraphRefBadge[];
}

export interface GraphViewModel {
  rows: GraphRow[];
  layout: GraphLayout;
  /** Width reserved for the graph column: max(layout.rowWidths). */
  graphWidth: number;
  /** Unclipped drawing width from the layout engine. */
  contentWidth: number;
  head: string | null;
  headBranch: string | null;
  /** Layout inputs (stash flags included) for re-running the engine with an expanded row. */
  layoutCommits: Commit[];
  repoRoot: string;
  dirtyCount: number;
  moreAvailable: boolean;
}

export interface GraphPreferences {
  align: boolean;
  firstParentOnly: boolean;
  muteMerges: boolean;
  muteNonAncestors: boolean;
  style: RowStyle;
  uncommittedMark: UncommittedMark;
  maxWidth: number;
}

export const DEFAULT_PREFERENCES: GraphPreferences = {
  align: false,
  firstParentOnly: false,
  muteMerges: false,
  muteNonAncestors: false,
  style: 'rounded',
  uncommittedMark: 'at-changes',
  maxWidth: -1,
};
/** Everything a diff tab needs to load one file's patch. */
export interface DiffRequest {
  repoRoot: string;
  hash: string;
  file: CommitFile;
  gitPath: string;
}