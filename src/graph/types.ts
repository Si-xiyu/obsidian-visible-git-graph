/**
 * Public types of the graph layout engine.
 *
 * Ported alongside `engine.ts` from dsh-vsc-git-graph (MIT, © 2026 Si-xiyu).
 */

export interface StashRef { selector: string; baseHash: string }
export interface StashInternal { selector: string; kind: 'index' | 'untracked' }
export interface Commit {
  hash: string; parents: string[];
  message?: string; author?: string; email?: string; date?: number;
  stash?: StashRef | boolean | null;
  stashInternal?: StashInternal | boolean | null;
}
export interface GraphGrid { x?: number; y?: number; insetX?: number; insetY?: number; expand?: number }
export type RowStyle = 'rounded' | 'angular';
export type UncommittedMark = 'at-changes' | 'at-head';
export interface BuildLayoutOptions {
  head?: string | null; expandedRow?: number; firstParentOnly?: boolean;
  muteMerges?: boolean; muteNonAncestors?: boolean; style?: RowStyle;
  palette?: string[]; grid?: GraphGrid; uncommittedMark?: UncommittedMark; maxWidth?: number;
}
export interface GraphPath { d: string; colour: string; committed: boolean; dashed: boolean }
export interface GraphPoint { row: number; x: number; y: number; colour: string; current: boolean; stash: boolean; stashInternal: boolean; committed: boolean }
export interface GraphNav {
  firstParent(row: number): number; otherParent(row: number): number;
  firstChild(row: number): number; otherChild(row: number): number;
  canDrop(row: number): boolean;
}
export interface GraphLayout {
  paths: GraphPath[]; points: GraphPoint[]; rowWidths: number[]; rowSlots: number[];
  muted: boolean[]; contentWidth: number; width: number; height: number; nav: GraphNav;
}
