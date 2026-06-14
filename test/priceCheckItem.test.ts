import { describe, it, expect } from 'vitest'
import { formatParsedItemHeader } from '../src/tools/appraise'
import type { ParsedItemSummary } from '../src/services/appraisal'

function item(overrides: Partial<ParsedItemSummary> = {}): ParsedItemSummary {
  return {
    rarity: 'Rare', name: '', baseType: 'Vaal Regalia', itemClass: 'Body Armour',
    itemLevel: 0, quality: 0, links: 0, corrupted: false, unidentified: false,
    influences: [], explicitMods: [], implicitMods: [],
    ...overrides,
  }
}

describe('formatParsedItemHeader', () => {
  it('renders name + base, iLvl, quality, links, influences and mod counts for a rare', () => {
    const h = formatParsedItemHeader(item({
      name: 'Dread Ward', baseType: 'Vaal Regalia', itemLevel: 84, quality: 20, links: 6,
      influences: ['Shaper'], explicitMods: ['a', 'b', 'c', 'd', 'e', 'f'], implicitMods: ['x'],
    }))
    expect(h).toBe('**Item:** Rare "Dread Ward" (Vaal Regalia) · iLvl 84 · Q20 · 6L · Shaper · 6 explicit / 1 implicit mods')
  })

  it('omits the quoted name when it equals the base (e.g. currency/unnamed)', () => {
    const h = formatParsedItemHeader(item({ rarity: 'Currency', name: 'Divine Orb', baseType: 'Divine Orb' }))
    expect(h).toBe('**Item:** Currency Divine Orb')
  })

  it('flags unidentified and corrupted, and hides sub-5 links', () => {
    const h = formatParsedItemHeader(item({ baseType: 'Leather Belt', itemLevel: 60, links: 3, unidentified: true, corrupted: true }))
    expect(h).toContain('unidentified')
    expect(h).toContain('corrupted')
    expect(h).not.toContain('3L')
  })
})
