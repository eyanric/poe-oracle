import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodePobCode, parsePob } from '../src/services/pobParser'

// Data-driven regression net over the whole REAL-export corpus (test/fixtures/real/*.txt). Each vendored
// pobb.in build asserts the universal invariants; the CRUX is that every PoB <PlayerStat> is surfaced
// equal to PoB's own computed value. Drop a new export in (npm run validate:pob -- <id>) and it's covered.
const REAL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'real')
const files = existsSync(REAL_DIR) ? readdirSync(REAL_DIR).filter(f => f.endsWith('.txt')) : []

const rawPlayerStats = (xml: string): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const m of xml.matchAll(/<PlayerStat\b([^>]*?)\/?>/g)) {
    const stat = (m[1].match(/\bstat="([^"]*)"/) ?? [])[1]
    const v = Number((m[1].match(/\bvalue="([^"]*)"/) ?? [])[1])
    if (stat && Number.isFinite(v)) out[stat] = v
  }
  return out
}

describe('real PoB export corpus', () => {
  it('has vendored fixtures', () => expect(files.length).toBeGreaterThan(0))

  describe.each(files)('%s', file => {
    const xml = decodePobCode(readFileSync(join(REAL_DIR, file), 'utf8'))
    const p = parsePob(xml)

    it('parses identity + a main skill (active skill set)', () => {
      expect(p.className).toBeTruthy()
      expect(p.level).toBeGreaterThan(0)
      expect(p.mainSkill, 'main skill').toBeTruthy()
    })

    it('THE CRUX: every PlayerStat surfaced == PoB\'s own computed value', () => {
      const raw = rawPlayerStats(xml)
      expect(Object.keys(raw).length).toBeGreaterThan(20)
      for (const [stat, value] of Object.entries(raw)) {
        expect(p.stats[stat], `stat ${stat}`).toBeCloseTo(value, 6)
      }
    })

    it('captures equipped items with mods', () => {
      expect(p.items.length).toBeGreaterThan(0)
      expect(p.items.reduce((s, i) => s + i.mods.length, 0)).toBeGreaterThan(0)
      expect(p.items.some(i => i.mods.some(m => /[{}]/.test(m))), 'no PoB tag leakage').toBe(false)
    })
  })
})
