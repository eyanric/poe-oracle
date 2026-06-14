/**
 * Parity guard for the method-module refactor: runs estimateCraftCost across the full
 * method matrix with fixed deps (deterministic — slam Monte Carlo uses a fixed seed) and
 * snapshots the key outputs. Snapshots are written PRE-refactor; the refactor must leave
 * them byte-identical (zero behaviour change). Any snapshot diff is a regression.
 */
import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem, RepoeEssence, RepoeFossil } from '../src/data/repoe'
import { estimateCraftCost, type CraftSpec, type CraftDeps, type BuySide, type CraftCostEstimate } from '../src/services/craftCost'
import type { BenchData } from '../src/services/benchCrafting'
import type { EconomySnapshot, CurrencyPrice, ItemPrice } from '../src/services/economyTypes'

const mod = (m: Partial<RepoeMod> & Pick<RepoeMod, 'generation_type' | 'groups'>): RepoeMod => ({
  domain: 'item', name: 'x', type: 'x', required_level: 1, is_essence_only: false,
  spawn_weights: [{ tag: 'body_armour', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], ...m,
})
const MODS: Record<string, RepoeMod> = {
  IncreasedLife11: mod({ generation_type: 'prefix', groups: ['IncreasedLife'], required_level: 81, name: 'Rapturous', text: '+(120-129) to maximum Life', implicit_tags: ['life'] }),
  EnergyShield: mod({ generation_type: 'prefix', groups: ['EnergyShield'], spawn_weights: [{ tag: 'body_armour', weight: 500 }, { tag: 'default', weight: 0 }] }),
  ColdRes: mod({ generation_type: 'suffix', groups: ['ColdResistance'], text: '+(41-45)% to Cold Resistance', spawn_weights: [{ tag: 'default', weight: 1000 }] }),
}
const BASES: Record<string, RepoeBaseItem> = {
  vr: { name: 'Vaal Regalia', domain: 'item', item_class: 'Body Armour', release_state: 'released', tags: ['body_armour', 'armour', 'int_armour', 'default'] },
}
const ESSENCES: Record<string, RepoeEssence> = {
  greed: { name: 'Deafening Essence of Greed', item_level_restriction: 81, level: 7, mods: { 'Body Armour': 'IncreasedLife11' } },
}
const cur = (name: string, chaos: number, listings = 50): CurrencyPrice => ({ currencyTypeName: name, chaosEquivalent: chaos, receive: { value: chaos, listing_count: listings }, source: 'test' })
const item = (name: string, chaos: number, divine: number): ItemPrice => ({ name, baseType: name, chaosValue: chaos, divineValue: divine, listingCount: 50, source: 'test' })
const SNAPSHOT: EconomySnapshot = {
  league: 'Mirage', fetchedAt: 0, source: 'test',
  currency: [cur('Divine Orb', 500), cur('Orb of Alteration', 0.1, 2), cur('Regal Orb', 0.2, 3), cur('Chaos Orb', 1), cur('Exalted Orb', 5), cur('Orb of Alchemy', 0.5)],
  fragments: [], essences: [item('Deafening Essence of Greed', 3, 0.006)], divCards: [],
  uniqueWeapons: [], uniqueArmours: [item('Shroud of the Lightless', 3000, 6)], uniqueAccessories: [],
  uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [],
}
const BENCH: BenchData = {
  crafts: [
    { modId: 'BenchLife', slot: 'prefix', label: '+(80-89) to maximum Life', itemClasses: ['Body Armour'], costName: 'Orb of Alteration', costAmount: 2, meta: null },
    { modId: 'BenchFireRes', slot: 'suffix', label: '+(40-45)% to Fire Resistance', itemClasses: ['Body Armour'], costName: 'Orb of Alchemy', costAmount: 2, meta: null },
  ],
  meta: {
    multimod: { modId: 'MM', slot: 'suffix', label: 'Can have up to 3 Crafted Modifiers', itemClasses: ['Body Armour'], costName: 'Divine Orb', costAmount: 2, meta: 'multimod' },
    lockSuffixes: { modId: 'LS', slot: 'prefix', label: 'Suffixes Cannot Be Changed', itemClasses: ['Body Armour'], costName: 'Divine Orb', costAmount: 2, meta: 'lockSuffixes' },
  },
}
const buySide: BuySide = { source: 'rare-comparables', label: 'comp', lowChaos: 1500, medianChaos: 2500, confidence: 'high' }
const deps: CraftDeps = { mods: MODS, baseItems: BASES, essences: ESSENCES, fossils: new Map<string, RepoeFossil>(), bench: BENCH, snapshot: SNAPSHOT, league: 'Mirage', today: '2026-06-14' }

const life = { slot: 'prefix' as const, group: 'IncreasedLife', label: 'Increased Life' }
const cold = { slot: 'suffix' as const, group: 'ColdResistance', label: 'Cold Resistance' }

const MATRIX: Record<string, CraftSpec> = {
  essence: { baseName: 'Vaal Regalia', ilvl: 84, desired: [], method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' } },
  'alt-regal-1': { baseName: 'Vaal Regalia', ilvl: 84, desired: [life], method: { kind: 'alt-regal' } },
  'alt-regal-2': { baseName: 'Vaal Regalia', ilvl: 84, desired: [life, cold], method: { kind: 'alt-regal' } },
  'chaos-spam': { baseName: 'Vaal Regalia', ilvl: 84, desired: [life], method: { kind: 'chaos-spam' } },
  bench: { baseName: 'Vaal Regalia', ilvl: 84, desired: [], method: { kind: 'bench', benchMods: ['maximum Life'] } },
  multimod: { baseName: 'Vaal Regalia', ilvl: 84, desired: [], method: { kind: 'multimod', benchMods: ['maximum Life', 'Fire Resistance'] } },
  'slam-unprotected': { baseName: 'Vaal Regalia', ilvl: 84, desired: [life], method: { kind: 'slam', baseValueChaos: 1000 } },
  'slam-protected': { baseName: 'Vaal Regalia', ilvl: 84, desired: [life], method: { kind: 'slam', protect: 'suffixes', baseValueChaos: 1000 } },
  'with-buyside': { baseName: 'Vaal Regalia', ilvl: 84, desired: [life], method: { kind: 'alt-regal' } },
}

const round = (n: number | null | undefined) => (n == null ? n : Number(n.toFixed(4)))
function summary(r: CraftCostEstimate) {
  return {
    method: r.method, supported: r.supported, reason: r.reason,
    expectedAttempts: round(r.expectedAttempts), perAttemptProb: round(r.perAttemptProb),
    totalChaos: round(r.totalChaos), totalDivine: round(r.totalDivine),
    consumables: r.consumables.map(c => ({ name: c.name, qty: round(c.qty), chaosTotal: round(c.chaosTotal), low: c.lowConfidence })),
    risk: r.risk && {
      category: r.risk.category, determinism: round(r.risk.determinism.score),
      dist: { mean: round(r.risk.distribution.mean), p50: round(r.risk.distribution.p50), p90: round(r.risk.distribution.p90), p95: round(r.risk.distribution.p95), method: r.risk.distribution.method },
      bricks: r.risk.bricks.map(b => ({ label: b.label, failureProb: round(b.failureProb), valueAtRisk: round(b.valueAtRisk) })),
    },
    verdict: { decision: r.verdict.decision, confidence: r.verdict.confidence, riskAdjusted: r.verdict.riskAdjusted, marginChaos: round(r.verdict.marginChaos) },
    lowConfidence: r.lowConfidence,
  }
}

describe('method-module parity matrix (zero behaviour change)', () => {
  for (const [name, spec] of Object.entries(MATRIX)) {
    it(`${name} output is stable`, () => {
      const d = name === 'with-buyside' ? { ...deps, buySide } : deps
      expect(summary(estimateCraftCost(spec, d))).toMatchSnapshot()
    })
  }
})
