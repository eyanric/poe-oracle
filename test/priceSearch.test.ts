import { describe, it, expect } from 'vitest'
import { searchEconomy } from '../src/services/economySearch'
import { mapCurrency, mapItems, type PoeWatchEntry } from '../src/services/PoeWatchService'
import { mapNinjaCurrency, mapNinjaItems } from '../src/services/PoeNinjaProvider'
import type { EconomySnapshot } from '../src/services/economyTypes'

function makeSnapshot(over: Partial<EconomySnapshot> = {}): EconomySnapshot {
  return {
    league: 'Mirage',
    fetchedAt: 0,
    currency: [],
    fragments: [],
    essences: [],
    divCards: [],
    uniqueWeapons: [],
    uniqueArmours: [],
    uniqueAccessories: [],
    uniqueFlasks: [],
    uniqueJewels: [],
    skillGems: [],
    maps: [],
    scarabs: [],
    oils: [],
    ...over,
  }
}

function pwEntry(over: Partial<PoeWatchEntry>): PoeWatchEntry {
  return {
    id: 1, name: 'X', category: 'currency', group: 'currency', frame: 5,
    mean: 0, min: 0, max: 0, divine: null, daily: 0, ...over,
  }
}

describe('searchEconomy', () => {
  it('prices a currency with chaos, derived divine, listing count, source, and confidence', () => {
    const snapshot = makeSnapshot({
      currency: [
        { currencyTypeName: 'Divine Orb', chaosEquivalent: 215, receive: { value: 0, listing_count: 1200 }, source: 'poe.ninja' },
        { currencyTypeName: 'Chaos Orb', chaosEquivalent: 1, receive: { value: 0, listing_count: 9000 } },
      ],
    })

    const [top] = searchEconomy(snapshot, 'Divine Orb')
    expect(top.name).toBe('Divine Orb')
    expect(top.chaosValue).toBe(215)
    expect(top.divineValue).toBeCloseTo(1, 5)
    expect(top.listingCount).toBe(1200)
    expect(top.lowConfidence).toBe(false)
    expect(top.source).toBe('poe.ninja')
  })

  it('ranks exact above substring among confident matches', () => {
    const snapshot = makeSnapshot({
      currency: [
        { currencyTypeName: 'Orb of Alteration', chaosEquivalent: 0.1, receive: { value: 0, listing_count: 100 } },
        { currencyTypeName: 'Orb', chaosEquivalent: 5, receive: { value: 0, listing_count: 100 } },
      ],
    })
    expect(searchEconomy(snapshot, 'Orb')[0].name).toBe('Orb')
  })

  it('demotes low-confidence matches below confident ones regardless of price', () => {
    const snapshot = makeSnapshot({
      currency: [
        // expensive but thin → low confidence (no listings)
        { currencyTypeName: 'Sacred Orb', chaosEquivalent: 99999, receive: { value: 0, listing_count: 1 } },
        // cheaper but well-listed → confident
        { currencyTypeName: 'Sacred Crystal', chaosEquivalent: 5, receive: { value: 0, listing_count: 500 } },
      ],
    })
    const results = searchEconomy(snapshot, 'Sacred')
    expect(results[0].name).toBe('Sacred Crystal')
    expect(results[0].lowConfidence).toBe(false)
    expect(results[1].lowConfidence).toBe(true)
  })

  it('honours category filter and passes item divine/listings through', () => {
    const snapshot = makeSnapshot({
      currency: [{ currencyTypeName: 'Headhunter', chaosEquivalent: 1 }],
      uniqueAccessories: [
        { name: 'Headhunter', baseType: 'Leather Belt', chaosValue: 15000, divineValue: 70, listingCount: 42, source: 'poe.watch' },
      ],
    })
    const results = searchEconomy(snapshot, 'Headhunter', 'unique')
    expect(results).toHaveLength(1)
    expect(results[0].category).toBe('Unique Accessory')
    expect(results[0].divineValue).toBe(70)
    expect(results[0].source).toBe('poe.watch')
  })
})

describe('poe.watch mappers', () => {
  it('maps currency: mean→chaos, daily→listings, sets source + confidence, drops zero-value rows', () => {
    const out = mapCurrency([
      pwEntry({ name: 'Divine Orb', mean: 588.18, divine: 1.02, daily: 35 }),
      pwEntry({ name: 'Transmutation Shard', mean: 69172, daily: 1 }), // thin → low confidence
      pwEntry({ name: 'Mirror of Kalandra', mean: 0, daily: 0 }), // dropped (no price)
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ currencyTypeName: 'Divine Orb', chaosEquivalent: 588.18, lowConfidence: false, source: 'poe.watch' })
    expect(out[1].lowConfidence).toBe(true) // daily 1 < floor
  })

  it('mapItems with uniqueOnly keeps frame===3 and carries divine/listings/source', () => {
    const uniques = mapItems([
      pwEntry({ name: 'Headhunter', category: 'accessory', frame: 3, mean: 15000, divine: 70, daily: 42 }),
      pwEntry({ name: 'Leather Belt', category: 'accessory', frame: 0, mean: 1, daily: 5 }),
    ], true)
    expect(uniques).toHaveLength(1)
    expect(uniques[0]).toMatchObject({ name: 'Headhunter', divineValue: 70, listingCount: 42, source: 'poe.watch' })
  })
})

describe('poe.ninja mappers', () => {
  it('maps currency: chaosEquivalent + receive.listing_count, source, confidence flags', () => {
    const out = mapNinjaCurrency([
      { currencyTypeName: 'Divine Orb', chaosEquivalent: 488.2, receive: { value: 580, listing_count: 123 } },
      { currencyTypeName: 'Sketchy Orb', chaosEquivalent: 5000, receive: { value: 0, listing_count: 2 }, lowConfidenceReceiveSparkLine: true },
      { currencyTypeName: 'Dead Orb', chaosEquivalent: 0, receive: { value: 0, listing_count: 0 } }, // dropped
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ currencyTypeName: 'Divine Orb', chaosEquivalent: 488.2, lowConfidence: false, source: 'poe.ninja' })
    expect(out[0].receive?.listing_count).toBe(123)
    expect(out[1].lowConfidence).toBe(true)
  })

  it('maps items: chaos/divine/listings + source + low-confidence on thin listings', () => {
    const out = mapNinjaItems([
      { name: 'Kingmaker', baseType: 'Despot Axe', chaosValue: 234280, divineValue: 400, listingCount: 3, links: 6 },
    ])
    expect(out[0]).toMatchObject({ name: 'Kingmaker', chaosValue: 234280, divineValue: 400, listingCount: 3, source: 'poe.ninja' })
    expect(out[0].lowConfidence).toBe(true) // 3 < floor of 5
  })
})
