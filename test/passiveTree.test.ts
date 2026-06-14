import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  normalizeTree,
  lookupNode,
  pathBetween,
  distance,
  statsForNodes,
  classifyAllocated,
} from '../src/services/passiveTree'
import type { RawPassiveTree } from '../src/data/passiveTreeData'

const raw = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/tree-fixture.json', import.meta.url)), 'utf8'),
) as RawPassiveTree
const tree = normalizeTree(raw)

describe('normalizeTree', () => {
  it('builds an undirected graph with typed nodes', () => {
    expect(tree.nodes.size).toBe(8)
    expect(tree.nodes.get(100)!.type).toBe('keystone')
    expect(tree.nodes.get(200)!.type).toBe('notable')
    expect(tree.nodes.get(300)!.type).toBe('mastery')
    // adjacency is undirected: 3 links to both 2 (in) and 4/100 (out)
    expect(tree.nodes.get(3)!.adj.sort((a, b) => a - b)).toEqual([2, 4, 100])
  })
})

describe('lookupNode', () => {
  it('finds by id and by name (case-insensitive)', () => {
    expect(lookupNode(tree, 100)!.name).toBe('Chaos Inoculation')
    expect(lookupNode(tree, 'chaos inoculation')!.id).toBe(100)
    expect(lookupNode(tree, 'Life Mastery')!.type).toBe('mastery')
    expect(lookupNode(tree, 'Nonexistent')).toBeNull()
  })
})

describe('pathBetween + distance', () => {
  it('finds the shortest path along the chain', () => {
    expect(pathBetween(tree, 2, 5)).toEqual([2, 3, 4, 5])
    expect(distance(tree, 2, 5)).toBe(3)
  })
  it('routes through the keystone branch', () => {
    expect(pathBetween(tree, 2, 300)).toEqual([2, 3, 100, 200, 300])
    expect(distance(tree, 2, 300)).toBe(4)
  })
  it('distance 0 to self, path is the single node', () => {
    expect(distance(tree, 3, 3)).toBe(0)
    expect(pathBetween(tree, 3, 3)).toEqual([3])
  })
  it('returns null/-1 for unknown nodes', () => {
    expect(pathBetween(tree, 2, 999)).toBeNull()
    expect(distance(tree, 2, 999)).toBe(-1)
  })
})

describe('statsForNodes (allocate → stat delta)', () => {
  it('aggregates stat lines for the allocated nodes and counts unresolved', () => {
    const r = statsForNodes(tree, [2, 4, 300, 999])
    expect(r.unresolved).toBe(1)
    expect(r.nodes.map(n => n.name)).toEqual(['Strong', 'Vitality', 'Life Mastery'])
    expect(r.stats).toContain('+10 to Strength')
    expect(r.stats).toContain('+50 to maximum Life')
  })
})

describe('classifyAllocated', () => {
  it('splits an allocated id set into keystones/notables/masteries', () => {
    const r = classifyAllocated(tree, [2, 3, 100, 200, 300, 777])
    expect(r.keystones).toEqual(['Chaos Inoculation'])
    expect(r.notables).toEqual(['Written in Blood'])
    expect(r.masteries).toEqual(['Life Mastery'])
    expect(r.unresolved).toBe(1) // 777 not in tree
  })
})
