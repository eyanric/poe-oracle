/**
 * data layer — GGG passive-tree data export (Phase 2).
 *
 * Consumes GGG's OFFICIAL machine-readable export (`grindinggear/skilltree-export`,
 * the same data the game/site publishes) on the shared `fetchJson` cache. Clean-room:
 * GGG's own data export, not PoB source. Override the URL with POE_TREE_URL if needed.
 */
import { fetchJson, type FetchJsonOptions } from './fetchJson'

export const PASSIVE_TREE_URL =
  process.env.POE_TREE_URL ?? 'https://raw.githubusercontent.com/grindinggear/skilltree-export/master/data.json'

export interface RawTreeNode {
  skill?: number
  name?: string
  stats?: string[]
  isKeystone?: boolean
  isNotable?: boolean
  isMastery?: boolean
  isJewelSocket?: boolean
  ascendancyName?: string
  classStartIndex?: number
  /** Neighbour node ids (strings), incoming + outgoing. */
  in?: string[]
  out?: string[]
}

export interface RawPassiveTree {
  tree?: string
  nodes: Record<string, RawTreeNode>
}

export const getPassiveTreeData = (o?: FetchJsonOptions): Promise<RawPassiveTree> =>
  fetchJson<RawPassiveTree>(PASSIVE_TREE_URL, o)
