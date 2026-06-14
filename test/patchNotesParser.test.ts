import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePatchNotes, stripHtml, summarizePatchNotes } from '../src/services/patchNotesParser'

/**
 * Corpus: test/fixtures/patch-notes-3.28-mirage.txt — a representative slice of the
 * real 3.28.0 Mirage patch notes (sourced from pathofexile.com/forum/view-thread/3913392),
 * in canonical GGG section+bullet format. Used to prove the parser plumbing on real data.
 */
const corpus = readFileSync(
  fileURLToPath(new URL('./fixtures/patch-notes-3.28-mirage.txt', import.meta.url)),
  'utf8',
)
const parsed = parsePatchNotes(corpus)
const has = (entries: { text: string }[], re: RegExp) => entries.some(e => re.test(e.text))

describe('parsePatchNotes — 3.28 Mirage corpus', () => {
  it('captures league + version from the title', () => {
    expect(parsed.league).toBe('Mirage')
    expect(parsed.version).toBe('3.28.0')
  })

  it('keeps every section lossless (nothing silently dropped)', () => {
    const headers = parsed.sections.map(s => s.header)
    expect(headers).toContain('New Skill Gems')
    expect(headers).toContain('Unique Items')
    expect(headers).toContain('Atlas of Worlds')
    expect(headers).toContain('Currency')
    // total raw lines preserved equals the sum of every section's lines
    const totalLines = parsed.sections.reduce((s, sec) => s + sec.lines.length, 0)
    expect(totalLines).toBeGreaterThanOrEqual(40)
  })

  it('captures new active and support skills', () => {
    expect(has(parsed.categories.skills, /Divine Blast/)).toBe(true)
    expect(has(parsed.categories.skills, /Blessed Call/)).toBe(true)
    expect(has(parsed.categories.skills, /Exceptional Support Gems/)).toBe(true)
    expect(has(parsed.categories.skills, /Sweep .*renamed to Holy Sweep/)).toBe(true)
    const divineBlast = parsed.categories.skills.find(e => /Divine Blast/.test(e.text))!
    expect(divineBlast.tags).toContain('active')
    expect(divineBlast.tags).toContain('new')
    const blessedCall = parsed.categories.skills.find(e => /Blessed Call/.test(e.text))!
    expect(blessedCall.tags).toContain('support')
  })

  it('captures new and changed uniques', () => {
    expect(has(parsed.categories.uniques, /Lioneye's Glare/)).toBe(true)
    expect(has(parsed.categories.uniques, /Pledge of Hands/)).toBe(true)
    expect(has(parsed.categories.uniques, /Replica Gifts from Above/)).toBe(true)
  })

  it('captures mechanic / Atlas changes', () => {
    expect(has(parsed.categories.mechanics, /begin your exploration at the centre/)).toBe(true)
    expect(has(parsed.categories.mechanics, /Favoured Map system has been removed/)).toBe(true)
    expect(has(parsed.categories.mechanics, /Mirage portal/)).toBe(true)
  })

  it('captures currency / economy changes', () => {
    expect(has(parsed.categories.currency, /Coin of Knowledge/)).toBe(true)
    expect(has(parsed.categories.currency, /Cartographer's Chisels can no longer be obtained/)).toBe(true)
    expect(has(parsed.categories.currency, /Exalted and Regal Orbs will now be comparatively more common/)).toBe(true)
  })

  it('classifies notable buffs and nerfs by direction', () => {
    expect(has(parsed.categories.nerfs, /Earthshatter effectiveness reduced/)).toBe(true)
    expect(has(parsed.categories.nerfs, /Cartographer's Chisels can no longer be obtained/)).toBe(true)
    expect(has(parsed.categories.buffs, /Penance Brand now deals 10% more damage/)).toBe(true)
    expect(has(parsed.categories.buffs, /Holy Flame Totem now fires/)).toBe(true)
  })

  it('summarize gives non-trivial counts in every bucket', () => {
    const s = summarizePatchNotes(parsed)
    for (const k of ['skills', 'uniques', 'mechanics', 'buffs', 'nerfs', 'currency']) {
      expect(s[k]).toBeGreaterThan(0)
    }
  })
})

describe('stripHtml', () => {
  it('passes through plain text unchanged', () => {
    expect(stripHtml('New Skill Gems\n- Divine Blast: stuff.')).toBe('New Skill Gems\n- Divine Blast: stuff.')
  })
  it('converts list items to bullets and decodes entities', () => {
    const html = '<h2>Currency</h2><ul><li>Coin of Knowledge &amp; Power</li><li>Exalted Orbs &gt; Chaos</li></ul>'
    const parsedHtml = parsePatchNotes(stripHtml(html), { league: 'Mirage', version: '3.28.0' })
    expect(has(parsedHtml.categories.currency, /Coin of Knowledge & Power/)).toBe(true)
    expect(has(parsedHtml.categories.currency, /Exalted Orbs > Chaos/)).toBe(true)
  })
})
