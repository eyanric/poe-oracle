import { describe, it, expect } from 'vitest'
import { isPoeItemText } from '../src/services/clipboardDetect'
import { parseClipboardItemText } from '../src/services/ItemParser'
import { indexStats, findStatId, buildTradeQuery } from '../src/services/tradeQuery'

const RARE_RING = [
  'Item Class: Rings',
  'Rarity: Rare',
  'Vortex Whorl',
  'Iron Ring',
  '--------',
  'Item Level: 84',
  '--------',
  '+25 to maximum Life',
  '+42% to Fire Resistance',
  '+18% to Cold Resistance',
  '+15% to Lightning Resistance',
  '+30 to maximum Mana',
].join('\n')

const UNIQUE = [
  'Item Class: Belts',
  'Rarity: Unique',
  'Headhunter',
  'Leather Belt',
  '--------',
  'Item Level: 84',
].join('\n')

describe('isPoeItemText', () => {
  it('accepts real PoE item clipboard text and rejects noise', () => {
    expect(isPoeItemText(RARE_RING)).toBe(true)
    expect(isPoeItemText(UNIQUE)).toBe(true)
    expect(isPoeItemText('just some copied text')).toBe(false)
    expect(isPoeItemText('')).toBe(false)
    expect(isPoeItemText(null)).toBe(false)
  })
})

describe('stat index', () => {
  const idx = indexStats({
    result: [{ entries: [
      { id: 'explicit.stat_life', text: '# to maximum Life', type: 'explicit' },
      { id: 'explicit.stat_fire', text: '#% to Fire Resistance', type: 'explicit' },
      { id: 'explicit.stat_cold', text: '#% to Cold Resistance', type: 'explicit' },
    ] }],
  })

  it('matches item mods to stat ids regardless of the numeric value', () => {
    expect(findStatId('+25 to maximum Life', 'explicit', idx)?.id).toBe('explicit.stat_life')
    expect(findStatId('+42% to Fire Resistance', 'explicit', idx)?.id).toBe('explicit.stat_fire')
    expect(findStatId('+99% to Cold Resistance', 'explicit', idx)?.id).toBe('explicit.stat_cold')
    expect(findStatId('+10 to Strength', 'explicit', idx)).toBeNull()
  })
})

describe('buildTradeQuery', () => {
  const idx = indexStats({
    result: [{ entries: [
      { id: 'explicit.stat_life', text: '# to maximum Life', type: 'explicit' },
      { id: 'explicit.stat_fire', text: '#% to Fire Resistance', type: 'explicit' },
      { id: 'explicit.stat_cold', text: '#% to Cold Resistance', type: 'explicit' },
    ] }],
  })

  it('builds a mod-aware count query for a rare (base type + recognised stats)', () => {
    const item = parseClipboardItemText(RARE_RING)
    expect(item.rarity).toBe('Rare')
    expect(item.explicitMods.length).toBeGreaterThanOrEqual(3)

    const q = buildTradeQuery(item, idx)!
    expect(q.query.type).toBe('Iron Ring')
    // category derived from item class
    expect(JSON.stringify(q.query.filters)).toContain('accessory.ring')
    // a "count" stat group over the 3 recognised mods (Life/Fire/Cold; Lightning/Mana unindexed)
    const stats = q.query.stats as Array<{ type: string; filters: unknown[]; value: { min: number } }>
    expect(stats[0].type).toBe('count')
    expect(stats[0].filters).toHaveLength(3)
    expect(stats[0].value.min).toBeGreaterThanOrEqual(2)
  })

  it('searches a unique by name + base type', () => {
    const item = parseClipboardItemText(UNIQUE)
    const q = buildTradeQuery(item, idx)!
    expect(q.query.name).toBe('Headhunter')
    expect(q.query.type).toBe('Leather Belt')
    expect(q.query.stats).toBeUndefined()
  })
})
