import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodePobCode, parsePob } from '../src/services/pobParser'

// Regression net for REAL pobb.in exports (shapes hand-built fixtures never modelled): the CRUX is that
// our extracted stats == PoB's own <PlayerStat> values, plus items/mods/tree are complete.
const REAL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real')
const load = (id: string) => decodePobCode(readFileSync(join(REAL_DIR, `${id}.txt`), 'utf8'))

/** Every <PlayerStat> in the export, by name (PoB writes value-first in real exports). */
function rawPlayerStats(xml: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of xml.matchAll(/<PlayerStat\b([^>]*?)\/?>/g)) {
    const stat = (m[1].match(/\bstat="([^"]*)"/) ?? [])[1]
    const v = Number((m[1].match(/\bvalue="([^"]*)"/) ?? [])[1])
    if (stat && Number.isFinite(v)) out[stat] = v
  }
  return out
}

describe('real PoB export — 0mLsHPwVEPfp (Scion/Ascendant, CI/ES, 1-life)', () => {
  const xml = load('0mLsHPwVEPfp')
  const p = parsePob(xml)

  it('parses identity', () => {
    expect(p.className).toBe('Scion')
    expect(p.ascendancy).toBe('Ascendant')
    expect(p.level).toBe(100)
    expect(p.mainSkill).toMatch(/Smite/)
  })

  it('THE CRUX: every PlayerStat is surfaced equal to PoB\'s own computed value', () => {
    const raw = rawPlayerStats(xml)
    expect(Object.keys(raw).length).toBeGreaterThan(50)
    for (const [stat, value] of Object.entries(raw)) {
      expect(p.stats[stat], `stat ${stat}`).toBeCloseTo(value, 6)
    }
    // a CI build: 1 life, real ES
    expect(p.stats.Life).toBe(1)
    expect(p.stats.EnergyShield).toBeGreaterThan(1000)
  })

  it('parses every equipped item with mods + itemLevel (PoB-export format, not clipboard)', () => {
    expect(p.items.length).toBeGreaterThan(20)
    expect(p.items.every(i => i.itemLevel > 0)).toBe(true)
    const totalMods = p.items.reduce((s, i) => s + i.mods.length, 0)
    expect(totalMods).toBeGreaterThan(100)
    // mods are clean — PoB's {crafted}/{fractured}/{range:…} tags stripped
    expect(p.items.some(i => i.mods.some(m => /[{}]/.test(m)))).toBe(false)
  })

  it('labels influence from the export\'s `X Item` lines', () => {
    const influenced = p.items.filter(i => i.influences?.length)
    expect(influenced.length).toBeGreaterThan(0)
    expect(p.items.find(i => i.name === 'Beast Jack')?.influences).toEqual(['Shaper', 'Redeemer'])
  })

  it('extracts the passive tree', () => {
    expect(p.trees.length).toBeGreaterThan(0)
    expect(p.trees[0].nodeCount).toBeGreaterThan(100)
  })
})
