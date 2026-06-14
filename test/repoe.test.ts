import { describe, it, expect, beforeEach } from 'vitest'
import { getMods, getEssences, getRepoeFreshness, REPOE_BASE } from '../src/data/repoe'
import { clearFetchJsonCache } from '../src/data/fetchJson'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

describe('data/repoe loader', () => {
  beforeEach(() => clearFetchJsonCache())

  it('loads mods through the injected fetch + fetchJson cache', async () => {
    const fake = { IncreasedLife11: { domain: 'item', generation_type: 'prefix', required_level: 81, groups: ['IncreasedLife'], is_essence_only: false, spawn_weights: [{ tag: 'default', weight: 1000 }], name: 'x', type: 'x' } }
    let calls = 0
    const fetchImpl = (async (url: string) => { calls++; expect(url).toBe(`${REPOE_BASE}/mods.min.json`); return jsonResponse(fake) }) as unknown as typeof fetch
    const mods = await getMods({ fetchImpl })
    expect(mods.IncreasedLife11.groups).toContain('IncreasedLife')
    await getMods({ fetchImpl }) // cached
    expect(calls).toBe(1)
  })

  it('loads essences (item_class → forced mod id)', async () => {
    const fake = { greed: { name: 'Deafening Essence of Greed', item_level_restriction: 81, level: 7, mods: { 'Body Armour': 'IncreasedLife11' } } }
    const fetchImpl = (async () => jsonResponse(fake)) as unknown as typeof fetch
    const ess = await getEssences({ fetchImpl, ttlMs: 0 })
    expect(ess.greed.mods['Body Armour']).toBe('IncreasedLife11')
  })

  it('parses Last-Modified for the freshness check', async () => {
    const fetchImpl = (async () => new Response(null, { status: 200, headers: { 'last-modified': 'Sat, 13 Jun 2026 11:34:50 GMT' } })) as unknown as typeof fetch
    const f = await getRepoeFreshness(fetchImpl)
    expect(f.ok).toBe(true)
    expect(f.lastModified?.getUTCFullYear()).toBe(2026)
    expect(f.lastModified?.getUTCMonth()).toBe(5) // June (0-indexed)
  })
})
