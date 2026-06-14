import { describe, it, expect } from 'vitest'
import type { RepoeMod, RepoeBaseItem, RepoeEssence, RepoeFossil } from '../src/data/repoe'
import { estimateCraftCost, hedgedVerdict, type CraftSpec, type CraftDeps, type BuySide } from '../src/services/craftCost'
import type { RiskProfile } from '../src/services/craftRisk'
import type { EconomySnapshot, CurrencyPrice, ItemPrice } from '../src/services/economyTypes'

const mod = (m: Partial<RepoeMod> & Pick<RepoeMod, 'generation_type' | 'groups'>): RepoeMod => ({
  domain: 'item', name: 'x', type: 'x', required_level: 1, is_essence_only: false,
  spawn_weights: [{ tag: 'body_armour', weight: 1000 }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: [], adds_tags: [], ...m,
})

const MODS: Record<string, RepoeMod> = {
  IncreasedLife11: mod({ generation_type: 'prefix', groups: ['IncreasedLife'], required_level: 81, name: 'Rapturous', implicit_tags: ['life'] }),
  EnergyShield: mod({ generation_type: 'prefix', groups: ['EnergyShield'], spawn_weights: [{ tag: 'body_armour', weight: 500 }, { tag: 'default', weight: 0 }] }),
  ColdRes: mod({ generation_type: 'suffix', groups: ['ColdResistance'], spawn_weights: [{ tag: 'default', weight: 1000 }] }),
}

const BASES: Record<string, RepoeBaseItem> = {
  vr: { name: 'Vaal Regalia', domain: 'item', item_class: 'Body Armour', release_state: 'released', tags: ['body_armour', 'armour', 'int_armour', 'default'] },
}

const ESSENCES: Record<string, RepoeEssence> = {
  greed: { name: 'Deafening Essence of Greed', item_level_restriction: 81, level: 7, mods: { 'Body Armour': 'IncreasedLife11' } },
}

const cur = (name: string, chaos: number, listings = 50): CurrencyPrice => ({
  currencyTypeName: name, chaosEquivalent: chaos, receive: { value: chaos, listing_count: listings }, source: 'test',
})
const item = (name: string, chaos: number, divine: number, listings = 50): ItemPrice => ({
  name, baseType: name, chaosValue: chaos, divineValue: divine, listingCount: listings, source: 'test',
})

const SNAPSHOT: EconomySnapshot = {
  league: 'Mirage', fetchedAt: Date.now(), source: 'test',
  currency: [cur('Divine Orb', 500), cur('Orb of Alteration', 0.1, 2), cur('Regal Orb', 0.2, 3), cur('Chaos Orb', 1)],
  fragments: [], essences: [item('Deafening Essence of Greed', 3, 0.006)], divCards: [],
  uniqueWeapons: [], uniqueArmours: [item('Shroud of the Lightless', 3000, 6)], uniqueAccessories: [],
  uniqueFlasks: [], uniqueJewels: [], skillGems: [], maps: [], scarabs: [],
}

const deps: CraftDeps = {
  mods: MODS, baseItems: BASES, essences: ESSENCES, fossils: new Map<string, RepoeFossil>(),
  snapshot: SNAPSHOT, league: 'Mirage', today: '2026-06-14',
}

describe('estimateCraftCost', () => {
  it('prices a deterministic essence craft (1 attempt × essence price)', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84, desired: [],
      method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' },
    }
    const r = estimateCraftCost(spec, deps)
    expect(r.supported).toBe(true)
    expect(r.expectedAttempts).toBe(1)
    expect(r.totalChaos).toBeCloseTo(3, 6)
    expect(r.totalDivine).toBeCloseTo(3 / 500, 6)
    expect(r.lowConfidence).toBe(false)
  })

  it('prices an alt→regal craft and flags low confidence (magic constant + thin orbs)', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84,
      desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'Increased Life' }],
      method: { kind: 'alt-regal' },
    }
    const r = estimateCraftCost(spec, deps)
    expect(r.supported).toBe(true)
    expect(r.totalChaos).toBeGreaterThan(0)
    expect(r.consumables.map(c => c.name)).toContain('Orb of Alteration')
    expect(r.lowConfidence).toBe(true) // alt/regal are thin (listings < 5)
  })

  it('hedged verdict: craft clearly below a CONFIDENT buy range → craft likely cheaper, crisp margin', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84, desired: [],
      method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' },
    }
    const r = estimateCraftCost(spec, { ...deps, buySide: { source: 'rare-comparables', label: 'x', lowChaos: 3000, medianChaos: 3500, confidence: 'high' } })
    expect(r.verdict.decision).toBe('craft-likely-cheaper')
    expect(r.verdict.marginChaos).toBeCloseTo(3000 - 3, 0) // craft ~3c, both confident → crisp
    expect(r.buySide?.lowChaos).toBe(3000)
  })

  it('hedged verdict: craft inside the buy range → overlapping, no crisp margin', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84, desired: [],
      method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' },
    }
    const r = estimateCraftCost(spec, { ...deps, buySide: { source: 'rare-comparables', label: 'x', lowChaos: 2, medianChaos: 10, confidence: 'high' } })
    expect(r.verdict.decision).toBe('overlapping')
    expect(r.verdict.marginChaos).toBeNull()
  })

  it('hedged verdict: a LOW-confidence buy side never yields a crisp margin', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84, desired: [],
      method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' },
    }
    const r = estimateCraftCost(spec, { ...deps, buySide: { source: 'rare-comparables', label: 'x', lowChaos: 1, medianChaos: 2, confidence: 'low' } })
    expect(r.verdict.decision).toBe('buy-likely-cheaper') // craft 3 > median 2
    expect(r.verdict.marginChaos).toBeNull() // capped — buy side is low-confidence
    expect(r.verdict.confidence).toBe('low')
  })

  it('returns an unsupported shell for an unknown base', () => {
    const spec: CraftSpec = { baseName: 'Nonexistent Base', ilvl: 84, desired: [], method: { kind: 'chaos-spam' } }
    const r = estimateCraftCost(spec, deps)
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/not found/)
    expect(r.verdict.decision).toBe('unknown')
  })

  it('surfaces the essence item-class mismatch as unsupported', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84, desired: [],
      method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' },
    }
    const noClass: CraftDeps = { ...deps, essences: { greed: { ...ESSENCES.greed, mods: {} } } }
    const r = estimateCraftCost(spec, noClass)
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/does not apply/)
  })

  it('attaches a risk profile to a supported craft', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84, desired: [],
      method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' },
    }
    const r = estimateCraftCost(spec, deps)
    expect(r.risk?.category).toBe('deterministic') // essence
    expect(r.risk?.distribution.p90).toBe(r.totalChaos) // zero variance
  })

  it('risk-adjusts the verdict: alt-spam p90 above the buy price flips EV-cheaper → buy', () => {
    const spec: CraftSpec = {
      baseName: 'Vaal Regalia', ilvl: 84,
      desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'Increased Life' }],
      method: { kind: 'alt-regal' },
    }
    const r = estimateCraftCost(spec, deps) // craft EV ~0.39c, p90 ~0.6c
    const mean = r.risk!.distribution.mean
    const p90 = r.risk!.distribution.p90
    expect(p90).toBeGreaterThan(mean)
    // buy range straddles mean<low but p90>median → EV says craft, variance says buy
    const buySide: BuySide = { source: 'rare-comparables', label: 'x', lowChaos: mean + (p90 - mean) * 0.2, medianChaos: (mean + p90) / 2, confidence: 'high' }
    const v = estimateCraftCost(spec, { ...deps, buySide }).verdict
    expect(v.decision).toBe('buy-likely-cheaper')
    expect(v.riskAdjusted).toBe(true)
    expect(v.riskNote).toMatch(/p90/)
  })
})

describe('hedgedVerdict — brick override (unit)', () => {
  const buy: BuySide = { source: 'rare-comparables', label: 'finished', lowChaos: 1000, medianChaos: 1200, confidence: 'high' }
  it('a material brick flips an EV-cheaper craft to buy, citing value-at-risk', () => {
    const risk = {
      distribution: { mean: 500, std: 450, p50: 400, p90: 900, p95: 1100, method: 'monte-carlo' as const },
      determinism: { score: 0.1, cv: 0.9, std: 450, mean: 500, brickPenalty: 0.8, guaranteedCost: 100, probabilisticCost: 400 },
      bricks: [{ label: 'Exalt slam', failureProb: 0.8, valueAtRisk: 105 }],
      category: 'high-brick' as const,
      notes: [],
    } satisfies RiskProfile
    const v = hedgedVerdict(500, false, buy, 100, risk) // craft 500 < buyLow 1000 → EV says craft
    expect(v.decision).toBe('buy-likely-cheaper')
    expect(v.riskAdjusted).toBe(true)
    expect(v.riskNote).toMatch(/brick risk/)
    expect(v.marginChaos).toBeNull()
  })
})
