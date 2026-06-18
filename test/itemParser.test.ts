import { describe, it, expect } from 'vitest'
import { parseClipboardItemText } from '../src/services/ItemParser'

// PoB EXPORT item format: UPPERCASE rarity, no `--------` dividers, metadata (Unique ID/Item Level/
// Implicits) inlined right after the name/base. The header parser must read name/base as the contiguous
// content lines after Rarity and stop at the first metadata line — never letting a metadata or mod line
// bleed into name or baseType. (Regression: a Magic tincture's `Unique ID:` was captured as the base.)
describe('applyHeader — metadata-aware name/base (PoB export format)', () => {
  it('(a) a Unique with no base line leaves baseType empty — never a metadata string', () => {
    const item = parseClipboardItemText(
      ['Rarity: UNIQUE', 'The Goddess Unleashed', 'Unique ID: deadbeefcafe1234', 'Item Level: 84', 'Implicits: 1', '+1 to Level of Socketed Gems'].join('\n'),
    )
    expect(item.name).toBe('The Goddess Unleashed')
    expect(item.baseType).toBe('') // missing base → empty (the flag), not "Unique ID: …" and not the mod
    expect(item.baseType).not.toMatch(/Unique ID/i)
  })

  it('(b) a standard name → base → Unique ID layout is unchanged', () => {
    const item = parseClipboardItemText(
      ['Rarity: UNIQUE', 'Headhunter', 'Leather Belt', 'Unique ID: abc123def456', 'Item Level: 84', 'Implicits: 1'].join('\n'),
    )
    expect(item.name).toBe('Headhunter')
    expect(item.baseType).toBe('Leather Belt')
  })

  it('(c) a Magic item with metadata after the name keeps name=base (the Unique ID: repro)', () => {
    const item = parseClipboardItemText(
      ['Rarity: MAGIC', 'Enriched Rosethorn Tincture of Mastery', 'Unique ID: 533a4d8711f1ccc1', 'Item Level: 85', 'Quality: 30', 'LevelReq: 68', 'Implicits: 1', '262% increased Critical Strike Chance with Melee Weapons'].join('\n'),
    )
    expect(item.name).toBe('Enriched Rosethorn Tincture of Mastery')
    expect(item.baseType).toBe('Enriched Rosethorn Tincture of Mastery')
    expect(item.baseType).not.toMatch(/Unique ID/i)
  })

  it('(c2) a Normal item never reads a Quality property as the base', () => {
    const item = parseClipboardItemText(['Rarity: NORMAL', 'Quicksilver Flask', 'Quality: +20%', 'Item Level: 60'].join('\n'))
    expect(item.name).toBe('Quicksilver Flask')
    expect(item.baseType).toBe('Quicksilver Flask')
  })

  it('the in-game clipboard format (proper-case rarity, dividers) is unchanged', () => {
    const rare = parseClipboardItemText(
      ['Item Class: Rings', 'Rarity: Rare', 'Vortex Whorl', 'Iron Ring', '--------', 'Item Level: 84', '--------', '+25 to maximum Life'].join('\n'),
    )
    expect(rare.name).toBe('Vortex Whorl')
    expect(rare.baseType).toBe('Iron Ring')

    const magic = parseClipboardItemText(['Item Class: Rings', 'Rarity: Magic', 'Hale Sapphire Ring of the Drake', '--------', 'Item Level: 60'].join('\n'))
    expect(magic.name).toBe('Hale Sapphire Ring of the Drake')
    expect(magic.baseType).toBe('Hale Sapphire Ring of the Drake')
  })
})
