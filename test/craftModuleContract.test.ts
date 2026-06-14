/**
 * Contract-conformance: confirms the CraftModule interface cleanly EXPRESSES all three
 * method shapes — single-item (registry), two-item combine (recombinator), and
 * resource-conditioned (memory strands). The arity-2 + resource modules here are
 * illustrative stubs (NOT registered methods — none ship this track); they exist to
 * prove the contract the solver depends on can carry them.
 */
import { describe, it, expect } from 'vitest'
import { CRAFT_MODULES } from '../src/services/craftMethods'
import type { CraftModule, InputSet, ResourceConditioning, OutcomeDistribution } from '../src/services/craftModule'
import { newItemState, withAffix, consumeResource, type ItemState } from '../src/services/itemState'

describe('registered modules expose the contract', () => {
  it('every module is arity 1 or 2 and exposes the contract functions', () => {
    for (const m of Object.values(CRAFT_MODULES)) {
      expect([1, 2]).toContain(m.arity)
      for (const fn of ['applicable', 'outcomes', 'cost', 'toRiskSteps', 'evaluate'] as const) {
        expect(typeof m[fn]).toBe('function')
      }
    }
  })
  it('recombine is the arity-2 (two-item combine) module', () => {
    expect(CRAFT_MODULES.recombine.arity).toBe(2)
    expect(Object.values(CRAFT_MODULES).filter(m => m.arity === 1).length).toBeGreaterThanOrEqual(7)
  })
})

describe('two-item combine (arity 2) is expressible', () => {
  // Illustrative recombinator: random base from the two inputs, random mod selection;
  // mod-loss is the brick outcome. Stub probabilities — shape check only.
  const recombinator: CraftModule = {
    id: 'recombinator', title: 'Recombinator (example)', arity: 2,
    applicable: (inputs) => ({ ok: inputs.length === 2 }),
    outcomes: (inputs): OutcomeDistribution => {
      const [a, b] = inputs as readonly [ItemState, ItemState]
      const merged = withAffix(a, b.affixes[0] ?? { modId: 'none', group: 'none', slot: 'prefix' })
      return { outcomes: [{ p: 0.6, state: merged }, { p: 0.4, state: a }], notes: ['0.4 = mod-loss brick'] }
    },
    cost: () => ({ steps: [], lowConfidence: true }),
    toRiskSteps: () => [{ kind: 'slam', label: 'recombine', pSuccess: 0.6, consumable: { name: 'Recombinator' }, recoverable: false }],
    evaluate: () => ({ method: 'recombinator', supported: false, reason: 'example only', expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] }),
  }

  it('accepts a two-item input set and yields a distribution with a brick (mod-loss) outcome', () => {
    const a = withAffix(newItemState({ base: 'A', itemClass: 'Ring', ilvl: 84 }), { modId: 'mA', group: 'gA', slot: 'prefix' })
    const b = withAffix(newItemState({ base: 'B', itemClass: 'Ring', ilvl: 84 }), { modId: 'mB', group: 'gB', slot: 'suffix' })
    const inputs = [a, b] as InputSet
    expect(recombinator.applicable(inputs, { mods: {} }, { desired: [], method: { kind: 'chaos-spam' } }).ok).toBe(true)
    const dist = recombinator.outcomes(inputs, { mods: {} }, { desired: [], method: { kind: 'chaos-spam' } })
    expect(dist.outcomes.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 6)
    expect(dist.notes?.join(' ')).toMatch(/mod-loss|brick/)
  })
})

describe('resource-conditioned (memory strands) is expressible', () => {
  const strandConditioning: ResourceConditioning = {
    resource: 'memoryStrands', consumes: 1,
    // Bias toward higher TIER (not more desirable) outcomes while strands remain.
    reweight: (dist, level) => (level > 0 ? { outcomes: dist.outcomes.map(o => ({ ...o, p: o.p })), notes: ['tier-biased while strands remain'] } : dist),
  }

  it('re-weights a distribution and depletes the resource', () => {
    let s = newItemState({ base: 'x', itemClass: 'Ring', ilvl: 84, resources: { memoryStrands: 3 } })
    const dist: OutcomeDistribution = { outcomes: [{ p: 1, state: s }] }
    const reweighted = strandConditioning.reweight(dist, s.resources.memoryStrands ?? 0)
    expect(reweighted.notes?.join(' ')).toMatch(/tier/)
    s = consumeResource(s, strandConditioning.resource, strandConditioning.consumes)
    expect(s.resources.memoryStrands).toBe(2)
  })
})
