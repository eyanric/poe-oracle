/**
 * services — passive-tree analysis (Phase 2).
 *
 * Normalizes GGG's tree export into a graph and answers: node lookup (by id/name),
 * shortest path + distance between nodes, "allocate these nodes → combined stat
 * delta", and classification of an allocated id set into keystones/notables/masteries
 * (used to put names on a parsed PoB's allocated nodes).
 *
 * Pure functions take a normalized `PassiveTree`; the live wrappers load + cache it.
 * Clean-room over GGG's data export.
 */
import { getPassiveTreeData, type RawPassiveTree, type RawTreeNode } from '../data/passiveTreeData'

export type NodeType = 'keystone' | 'notable' | 'mastery' | 'jewel' | 'ascendancy' | 'class' | 'normal'

export interface TreeNode {
  id: number
  name: string
  stats: string[]
  type: NodeType
  /** Undirected neighbour ids. */
  adj: number[]
}

export interface PassiveTree {
  version?: string
  nodes: Map<number, TreeNode>
  /** Lowercased name → id (first wins) for name lookup. */
  byName: Map<string, number>
}

function nodeType(n: RawTreeNode): NodeType {
  if (n.isKeystone) return 'keystone'
  if (n.isMastery) return 'mastery'
  if (n.isNotable) return 'notable'
  if (n.isJewelSocket) return 'jewel'
  if (n.ascendancyName) return 'ascendancy'
  if (n.classStartIndex != null) return 'class'
  return 'normal'
}

/** Normalize the raw GGG export into the analysis graph (undirected adjacency). */
export function normalizeTree(raw: RawPassiveTree): PassiveTree {
  const nodes = new Map<number, TreeNode>()
  const byName = new Map<string, number>()
  for (const [key, n] of Object.entries(raw.nodes ?? {})) {
    const id = n.skill ?? Number(key)
    if (!Number.isFinite(id)) continue
    const adj = [...new Set([...(n.in ?? []), ...(n.out ?? [])].map(Number).filter(Number.isFinite))]
    const name = n.name ?? ''
    nodes.set(id, { id, name, stats: n.stats ?? [], type: nodeType(n), adj })
    if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), id)
  }
  return { version: raw.tree, nodes, byName }
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function lookupNode(tree: PassiveTree, idOrName: number | string): TreeNode | null {
  if (typeof idOrName === 'number') return tree.nodes.get(idOrName) ?? null
  const asNum = Number(idOrName)
  if (Number.isFinite(asNum) && tree.nodes.has(asNum)) return tree.nodes.get(asNum)!
  const id = tree.byName.get(idOrName.toLowerCase())
  return id != null ? tree.nodes.get(id) ?? null : null
}

/** Shortest path (node ids incl. endpoints) via BFS, or null if unreachable. */
export function pathBetween(tree: PassiveTree, from: number, to: number): number[] | null {
  if (!tree.nodes.has(from) || !tree.nodes.has(to)) return null
  if (from === to) return [from]
  const prev = new Map<number, number>()
  const seen = new Set<number>([from])
  const queue: number[] = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of tree.nodes.get(cur)!.adj) {
      if (seen.has(nb) || !tree.nodes.has(nb)) continue
      seen.add(nb)
      prev.set(nb, cur)
      if (nb === to) {
        const path = [to]
        let p = cur
        while (p !== from) { path.push(p); p = prev.get(p)! }
        path.push(from)
        return path.reverse()
      }
      queue.push(nb)
    }
  }
  return null
}

/** Edge distance between two nodes (number of points to travel), or -1 if unreachable. */
export function distance(tree: PassiveTree, from: number, to: number): number {
  const path = pathBetween(tree, from, to)
  return path ? path.length - 1 : -1
}

export interface AllocationStats {
  nodes: Array<{ id: number; name: string; type: NodeType; stats: string[] }>
  /** Flattened stat lines across the allocated nodes. */
  stats: string[]
  unresolved: number
}

/** "Allocate these nodes → combined stat delta": the stats the given ids grant. */
export function statsForNodes(tree: PassiveTree, ids: number[]): AllocationStats {
  const out: AllocationStats = { nodes: [], stats: [], unresolved: 0 }
  for (const id of ids) {
    const n = tree.nodes.get(id)
    if (!n) { out.unresolved++; continue }
    out.nodes.push({ id: n.id, name: n.name, type: n.type, stats: n.stats })
    for (const s of n.stats) out.stats.push(...s.split('\n'))
  }
  return out
}

export interface AllocatedNodes {
  keystones: string[]
  notables: string[]
  masteries: string[]
  unresolved: number
}

/** Classify an allocated id set into keystone/notable/mastery names (pure). */
export function classifyAllocated(tree: PassiveTree, ids: number[]): AllocatedNodes {
  const out: AllocatedNodes = { keystones: [], notables: [], masteries: [], unresolved: 0 }
  for (const id of ids) {
    const n = tree.nodes.get(id)
    if (!n) { out.unresolved++; continue }
    if (n.type === 'keystone') out.keystones.push(n.name)
    else if (n.type === 'notable') out.notables.push(n.name)
    else if (n.type === 'mastery') out.masteries.push(n.name)
  }
  return out
}

// ── Live wrappers (load + cache the normalized tree) ──────────────────────────

let cached: PassiveTree | null = null

/** Load + normalize the GGG tree (cached for the process). */
export async function loadPassiveTree(): Promise<PassiveTree> {
  if (cached) return cached
  cached = normalizeTree(await getPassiveTreeData())
  return cached
}

/** Test/maintenance helper. */
export function clearPassiveTreeCache(): void {
  cached = null
}

/** Classify allocated ids, loading the tree live unless one is supplied. */
export async function resolveAllocatedNodes(ids: number[], tree?: PassiveTree): Promise<AllocatedNodes> {
  return classifyAllocated(tree ?? (await loadPassiveTree()), ids)
}
