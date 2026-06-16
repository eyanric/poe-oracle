import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem } from '../src/data/repoe'
import { resolveTargets } from '../src/services/modProducer'
import { resolveQueryTarget } from '../src/services/solver'
import { ANOINT_RECIPES } from '../src/data/anointRecipes'
import { SYNTHESIS_POOL } from '../src/data/synthesisImplicits'

const pre = (group: string, text: string): RepoeMod => ({
  domain: 'item', generation_type: 'prefix', name: group, type: group, is_essence_only: false, required_level: 1,
  groups: [group], spawn_weights: [{ tag: 'ring', weight: 1000 }], generation_weights: [], implicit_tags: [], adds_tags: [], text,
})
const ringSynthId = SYNTHESIS_POOL['Ring'].mods[0]
const MODS: Record<string, RepoeMod> = {
  FireDmg: pre('FireDmg', 'increased Fire Damage'),
  ColdDmg: pre('ColdDmg', 'increased Cold Damage'),
  // a real Ring synthesis-implicit id, given synthetic text so it resolves by query
  [ringSynthId]: { domain: 'item', generation_type: 'unique', name: 'syn', type: 'syn', is_essence_only: false, required_level: 1, groups: ['SynthG'], spawn_weights: [], generation_weights: [], implicit_tags: [], adds_tags: [], text: 'Zzz Synth Stat' },
}
const RING: RepoeBaseItem = { name: 'Test Ring', domain: 'item', item_class: 'Ring', tags: ['ring', 'default'], release_state: 'released' }
const AMULET: RepoeBaseItem = { name: 'Test Amulet', domain: 'item', item_class: 'Amulet', tags: ['amulet', 'default'], release_state: 'released' }
const anointable = Object.keys(ANOINT_RECIPES)[0]

describe('resolveTargets — producer domains surfaced', () => {
  it('an anointable notable on an amulet → an anoint candidate', () => {
    const c = resolveTargets(anointable.toLowerCase(), AMULET, 84, MODS).filter(x => x.domain === 'anoint')
    expect(c).toHaveLength(1)
    expect(c[0].modId).toBe(anointable)
  })
  it('a synthesis-implicit stat → a synthImplicit candidate (per item-class pool)', () => {
    const c = resolveTargets('zzz synth stat', RING, 84, MODS).filter(x => x.domain === 'synthImplicit')
    expect(c.map(x => x.modId)).toContain(ringSynthId)
  })
})

describe('resolveQueryTarget — resolve → pick decision (pure)', () => {
  it('a pinned modId (no query) passes straight through as a spec', () => {
    const r = resolveQueryTarget({ modId: 'FireDmg', group: 'FireDmg', slot: 'prefix', label: 'fire' }, RING, 84, MODS)
    expect(r.kind).toBe('spec')
    if (r.kind === 'spec') expect(r.spec.modId).toBe('FireDmg')
  })
  it('a single-identity stat → solved spec (targets the group, any tier)', () => {
    const r = resolveQueryTarget({ query: 'fire damage' }, RING, 84, MODS)
    expect(r.kind).toBe('spec')
    if (r.kind === 'spec') expect(r.spec.group).toBe('FireDmg')
  })
  it('a stat that maps to MULTIPLE affix identities → ambiguous (never picks)', () => {
    const r = resolveQueryTarget({ query: 'damage' }, RING, 84, MODS)
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(new Set(r.candidates.map(c => c.group)).size).toBeGreaterThan(1)
  })
  it('an anoint stat (no affix collision) auto-resolves to an anoint spec', () => {
    const r = resolveQueryTarget({ query: anointable.toLowerCase() }, AMULET, 84, MODS)
    expect(r.kind).toBe('spec')
    if (r.kind === 'spec') { expect(r.spec.anoint).toBe(true); expect(r.spec.modId).toBe(anointable) }
  })
  it('producer slots are opt-in: a synthImplicit identity resolves only when domain-pinned', () => {
    const r = resolveQueryTarget({ query: 'zzz synth stat', domain: 'synthImplicit' }, RING, 84, MODS)
    expect(r.kind).toBe('spec')
    if (r.kind === 'spec') { expect(r.spec.synthImplicit).toBe(true); expect(r.spec.modId).toBe(ringSynthId) }
  })
  it('an unmatched stat → unresolved (not guessed)', () => {
    expect(resolveQueryTarget({ query: 'no such stat anywhere' }, RING, 84, MODS).kind).toBe('unresolved')
  })
})
