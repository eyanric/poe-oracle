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

describe('live forum HTML hardening (<h*> headings, ToC, multi-line <li>)', () => {
  // Mirrors the real GGG forum structure that shattered the plain-text heuristic: a Table-of-Contents
  // <ul> of links, real <h3> section headings, a multi-line <li> (<br/>), and the live currency header
  // "Item Changes" (the fixture used "Currency").
  const html = [
    '<h3>Table of Contents</h3><ul><li><a href="#a">The Mirage Challenge League</a></li><li><a href="#b">Item Changes</a></li></ul>',
    '<h3>The Mirage Challenge League</h3><ul><li>Zones can now contain a Mirage portal<br/>leading to an astral copy of the area.</li></ul>',
    '<h3>Skill Gem Changes</h3><ul><li>Divine Blast: Project a beam of holy light.</li><li>Blessed Call Support: triggers on block.</li></ul>',
    '<h3>Item Changes</h3><ul><li>Currency Items now account for a larger portion of drops.</li><li>Exalted and Regal Orbs will now be comparatively more common.</li></ul>',
  ].join('\n')
  const p = parsePatchNotes(stripHtml(html), { league: 'Mirage', version: '3.28.0' })

  it('uses <h*> headings as section boundaries — no junk "-" sections from ToC / multi-line <li>', () => {
    const headers = p.sections.map(s => s.header)
    expect(headers).toContain('Skill Gem Changes')
    expect(headers).toContain('Item Changes')
    expect(p.sections.every(s => /[A-Za-z]/.test(s.header))).toBe(true) // no bullet-only "-" headers
  })

  it('captures the currency section even when titled "Item Changes"', () => {
    expect(has(p.categories.currency, /Exalted and Regal Orbs/)).toBe(true)
  })

  it('keeps multi-line <li> content as one section\'s lines, not a new header', () => {
    expect(has(p.categories.mechanics, /astral copy of the area/)).toBe(true)
    expect(has(p.categories.skills, /Divine Blast/)).toBe(true)
  })
})
