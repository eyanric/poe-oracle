import { describe, it, expect } from 'vitest'
import { computePseudoTotals } from '../src/services/pseudoMods'
import {
  buildComparableQuery,
  priceRangeFromSamples,
  rangeConfidence,
  estimateRarePrice,
  type RareItemSpec,
  type SearchFn,
} from '../src/services/rarePricing'
import type { LiveQuote } from '../src/services/TradeMarketService'

// ── pseudo-mod normalization ──────────────────────────────────────────────────

describe('computePseudoTotals', () => {
  it('sums life across flat-life mods', () => {
    const { totals } = computePseudoTotals(['+80 to maximum Life', '+29 to maximum Life'])
    expect(totals.find(t => t.id === 'pseudo.pseudo_total_life')?.value).toBe(109)
  })

  it('rolls single + all-elemental resistances into the elemental + total pseudos', () => {
    const { totals } = computePseudoTotals(['+42% to Fire Resistance', '+15% to all Elemental Resistances'])
    const ele = totals.find(t => t.id === 'pseudo.pseudo_total_elemental_resistance')
    // fire 42+15, cold 15, lightning 15 = 87
    expect(ele?.value).toBe(87)
    expect(totals.find(t => t.id === 'pseudo.pseudo_total_fire_resistance')?.value).toBe(57)
  })

  it('includes chaos res in total resistance but not elemental', () => {
    const { totals } = computePseudoTotals(['+40% to Cold Resistance', '+12% to Chaos Resistance'])
    expect(totals.find(t => t.id === 'pseudo.pseudo_total_elemental_resistance')?.value).toBe(40)
    expect(totals.find(t => t.id === 'pseudo.pseudo_total_resistance')?.value).toBe(52)
  })

  it('handles dual resistances and all-attributes', () => {
    const { totals } = computePseudoTotals(['+18% to Fire and Cold Resistances', '+10 to all Attributes'])
    expect(totals.find(t => t.id === 'pseudo.pseudo_total_fire_resistance')?.value).toBe(18)
    expect(totals.find(t => t.id === 'pseudo.pseudo_total_cold_resistance')?.value).toBe(18)
    expect(totals.find(t => t.id === 'pseudo.pseudo_total_all_attributes')?.value).toBe(30)
  })

  it('reports mods it could not map to a pseudo', () => {
    const { unmatched } = computePseudoTotals(['+80 to maximum Life', '10% increased Attack Speed'])
    expect(unmatched).toEqual(['10% increased Attack Speed'])
  })
})

// ── query-builder heuristic ───────────────────────────────────────────────────

describe('buildComparableQuery', () => {
  const ringSpec: RareItemSpec = {
    baseType: 'Vermillion Ring', itemClass: 'Ring', itemLevel: 84,
    mods: ['+80 to maximum Life', '+42% to Fire Resistance', '+38% to Cold Resistance', '+12 to Dexterity', '8% increased Attack Speed'],
  }

  it('selects value-driving pseudos, drops noise, loosens the min, caps the count', () => {
    const built = buildComparableQuery(ringSpec, { maxStats: 3, looseness: 0.15 })!
    const ids = built.queriedStats.map(s => s.id)
    expect(ids).toContain('pseudo.pseudo_total_life')
    expect(ids.length).toBeLessThanOrEqual(3)
    // life min is loosened: 80 × 0.85 = 68
    expect(built.queriedStats.find(s => s.id === 'pseudo.pseudo_total_life')?.min).toBe(68)
    // attack speed (no pseudo) never appears
    expect(JSON.stringify(built.built)).not.toMatch(/attack/i)
  })

  it('collapses elemental res aggregate over individual fire/cold', () => {
    const built = buildComparableQuery(ringSpec, { maxStats: 5 })!
    const ids = built.queriedStats.map(s => s.id)
    expect(ids).toContain('pseudo.pseudo_total_elemental_resistance')
    expect(ids).not.toContain('pseudo.pseudo_total_fire_resistance')
  })

  it('sets base type, ilvl bracket and influence/corruption filters', () => {
    const built = buildComparableQuery({ ...ringSpec, influences: ['Shaper'], corrupted: true }, {})!
    const q = built.built.query as Record<string, unknown>
    expect(q.type).toBe('Vermillion Ring')
    const filters = q.filters as { misc_filters?: { filters: Record<string, unknown> } }
    expect(filters.misc_filters?.filters.ilvl).toEqual({ min: 82 })
    expect(filters.misc_filters?.filters.shaper_item).toEqual({ option: 'true' })
    expect(filters.misc_filters?.filters.corrupted).toEqual({ option: 'true' })
  })

  it('returns null when nothing is specific enough to query on', () => {
    expect(buildComparableQuery({ baseType: '', itemClass: 'Ring', mods: ['8% increased Attack Speed'] })).toBeNull()
  })
})

// ── distribution → range + confidence ─────────────────────────────────────────

describe('priceRangeFromSamples', () => {
  it('derives a low-percentile→median range and ignores bait as the estimate', () => {
    const r = priceRangeFromSamples([1, 95, 100, 105, 110, 120])! // 1 = bait
    expect(r.cheapest).toBe(1)
    expect(r.low).toBeGreaterThan(90) // trimmed past the bait
    expect(r.median).toBeGreaterThanOrEqual(r.low)
  })
  it('returns null for an empty set', () => {
    expect(priceRangeFromSamples([])).toBeNull()
  })
})

describe('rangeConfidence', () => {
  it('few results or wide spread → low', () => {
    expect(rangeConfidence(2, 10)).toBe('low')
    expect(rangeConfidence(20, 200)).toBe('low')
  })
  it('deep + tight → high', () => {
    expect(rangeConfidence(20, 20)).toBe('high')
  })
  it('middle → medium', () => {
    expect(rangeConfidence(5, 30)).toBe('medium')
  })
})

// ── estimateRarePrice orchestration (injected search) ─────────────────────────

const quoteOf = (prices: number[], total = prices.length): LiveQuote => ({
  source: 'pathofexile.com/trade', kind: 'item-search', unit: 'chaos',
  low: prices.length ? Math.min(...prices) : 0, median: 0, count: total, sampleSize: prices.length,
  snapshotAgeSec: null, samples: prices.map(chaos => ({ chaos, ageSec: 60 })), tradeUrl: 'https://trade/x',
})

const spec: RareItemSpec = { baseType: 'Vermillion Ring', itemClass: 'Ring', itemLevel: 84, mods: ['+80 to maximum Life', '+42% to Fire Resistance'] }

describe('estimateRarePrice', () => {
  it('prices from comparable listings with a divine conversion', async () => {
    const search: SearchFn = async () => quoteOf([90, 100, 110, 120, 130, 140, 150, 160], 40)
    const r = await estimateRarePrice(spec, { search, divineChaos: 200 })
    expect(r.priced).toBe(true)
    expect(r.range!.median).toBeGreaterThan(0)
    expect(r.divine!.median).toBeCloseTo(r.range!.median / 200, 6)
    expect(r.marketDepth).toBe(40)
  })

  it('widens once when over-constrained, then prices', async () => {
    let calls = 0
    const search: SearchFn = async () => {
      calls++
      return calls === 1 ? quoteOf([], 0) : quoteOf([50, 60, 70, 80], 12)
    }
    const r = await estimateRarePrice(spec, { search, divineChaos: 200 })
    expect(calls).toBe(2)
    expect(r.priced).toBe(true)
    expect(r.notes.join(' ')).toMatch(/widened/)
  })

  it('does NOT fabricate a number when even the widened query is empty', async () => {
    const search: SearchFn = async () => quoteOf([], 0)
    const r = await estimateRarePrice(spec, { search, divineChaos: 200 })
    expect(r.priced).toBe(false)
    expect(r.reason).toMatch(/no comparable listings/)
    expect(r.range).toBeNull()
  })

  it('flags low confidence when a search is rate-limited (null quote)', async () => {
    const search: SearchFn = async () => null
    const r = await estimateRarePrice(spec, { search, divineChaos: 200 })
    expect(r.priced).toBe(false)
    expect(r.reason).toMatch(/rate-limited|failed/)
  })

  it('surfaces mods not captured by pseudo-pricing', async () => {
    const search: SearchFn = async () => quoteOf([100, 110, 120, 130, 140], 20)
    const withNoise: RareItemSpec = { ...spec, mods: [...spec.mods!, '12% increased Attack Speed'] }
    const r = await estimateRarePrice(withNoise, { search, divineChaos: 200 })
    expect(r.unpricedMods).toContain('12% increased Attack Speed')
    expect(r.notes.join(' ')).toMatch(/not captured/)
  })
})
