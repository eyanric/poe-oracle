import { describe, it, expect } from 'vitest'
import {
  valueTier, liquidityRating, divergence,
  median, freshListings, trimLowOutliers, computeMargin,
} from '../src/services/appraisal'
import { summarize, parseExchangeRatios, parseFetchPrices } from '../src/services/TradeMarketService'

describe('valueTier', () => {
  it('buckets by chaos value', () => {
    expect(valueTier(50)).toBe('commodity')
    expect(valueTier(500)).toBe('mid')
    expect(valueTier(50_000)).toBe('high')
    expect(valueTier(250_000)).toBe('mirror')
  })
})

describe('liquidityRating (tier-aware)', () => {
  it('treats a couple of listings as the whole market at mirror tier, but nothing at commodity', () => {
    expect(liquidityRating(2, 'mirror').rating).toBe('moderate')
    expect(liquidityRating(1, 'mirror').rating).toBe('thin')
    expect(liquidityRating(2, 'commodity').rating).toBe('illiquid')
    expect(liquidityRating(100, 'commodity').rating).toBe('liquid')
  })

  it('explains the rating', () => {
    expect(liquidityRating(3, 'high').rationale).toBe('3 live listings at high tier')
  })
})

describe('divergence', () => {
  it('flags the Divine Orb split (~26%) above the 15% threshold', () => {
    const d = divergence(616, 488, 15)
    expect(d.pct).toBeCloseTo(26.2, 1)
    expect(d.divergent).toBe(true)
  })

  it('does not flag small gaps', () => {
    expect(divergence(100, 105, 15).divergent).toBe(false)
  })

  it('returns null/false when a side is missing', () => {
    expect(divergence(null, 5, 15)).toEqual({ pct: null, divergent: false })
  })
})

describe('summarize', () => {
  it('returns low/median/count and ignores non-positive', () => {
    expect(summarize([9, 8, 8])).toEqual({ low: 8, median: 8, count: 3 })
    expect(summarize([10, 20])).toEqual({ low: 10, median: 15, count: 2 })
    expect(summarize([])).toEqual({ low: 0, median: 0, count: 0 })
  })
})

describe('parseExchangeRatios', () => {
  it('computes chaos-per-unit from bulk-exchange offers (have chaos, want divine)', () => {
    const body = {
      result: {
        a: { listing: { indexed: '2026-06-13T18:00:00Z', offers: [{ exchange: { currency: 'chaos', amount: 600 }, item: { currency: 'divine', amount: 1 } }] } },
        b: { listing: { indexed: '2026-06-13T18:00:00Z', offers: [{ exchange: { currency: 'chaos', amount: 1220 }, item: { currency: 'divine', amount: 2 } }] } },
        c: { listing: { offers: [{ exchange: { currency: 'chaos', amount: 5 }, item: { currency: 'alch', amount: 1 } }] } }, // wrong want → skipped
      },
    }
    const r = parseExchangeRatios(body, 'divine', 'chaos', Date.parse('2026-06-13T18:00:00Z'))
    expect(r.map(x => x.chaosPerUnit)).toEqual([600, 610])
  })
})

describe('parseFetchPrices', () => {
  it('converts listing prices to chaos and drops unsupported currencies', () => {
    const body = {
      result: [
        { listing: { price: { amount: 8, currency: 'divine' } } },
        { listing: { price: { amount: 50, currency: 'chaos' } } },
        { listing: { price: { amount: 1, currency: 'mirror' } } }, // no rate → dropped
      ],
    }
    const prices = parseFetchPrices(body, { chaos: 1, divine: 200 }).map(p => p.chaos)
    expect(prices).toEqual([1600, 50])
  })
})

describe('margin helpers', () => {
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBe(0)
  })

  it('freshListings keeps only listings within the window with a known age', () => {
    expect(freshListings([{ chaos: 10, ageSec: 60 }, { chaos: 20, ageSec: 5000 }, { chaos: 30, ageSec: null }], 1800)).toEqual([10])
  })

  it('trimLowOutliers drops a below-cluster bait price but keeps the cluster', () => {
    expect(trimLowOutliers([100, 102, 98, 101, 5])).toEqual([100, 102, 98, 101])
  })
})

describe('computeMargin (actionable, freshness-gated)', () => {
  it('excludes STALE and below-cluster OUTLIER listings from the actionable buy', () => {
    const samples = [
      { chaos: 4000, ageSec: 60 },
      { chaos: 4100, ageSec: 120 },
      { chaos: 4200, ageSec: 90 },
      { chaos: 3950, ageSec: 30 },
      { chaos: 50, ageSec: 60 },    // FRESH but bait outlier below the cluster
      { chaos: 2000, ageSec: 7200 }, // cheap but STALE (outside 30m window)
    ]
    const v = computeMargin({ samples, aggregatorChaos: [4100, 4090], divergencePct: 0.2, freshnessWindowSec: 1800, minFreshDepth: 3 })
    expect(v.actionable).not.toBeNull()
    expect(v.actionable!.buy).toBe(3950) // not 50 (outlier), not 2000 (stale)
    expect(v.actionable!.marginPct).toBeLessThan(5) // realistic, not the phantom spread
    expect(v.listingSpread!.spreadPct).toBeGreaterThan(50) // raw spread still huge (50 → median)
  })

  it('GATES the margin to null when there is no fresh depth (stale-only data)', () => {
    const stale = [{ chaos: 4000, ageSec: 9396 }, { chaos: 4100, ageSec: 9400 }] // ~2.6h old (Headhunter case)
    const v = computeMargin({ samples: stale, aggregatorChaos: [4196, 4094], divergencePct: 2.5, freshnessWindowSec: 1800, minFreshDepth: 3 })
    expect(v.actionable).toBeNull()
    expect(v.reason).toMatch(/insufficient fresh liquidity/i)
    expect(v.confidence.label).toBe('low')
    expect(v.listingSpread).not.toBeNull() // raw spread still reported
  })
})
