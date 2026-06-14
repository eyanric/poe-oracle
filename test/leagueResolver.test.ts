import { describe, it, expect, vi } from 'vitest'
import {
  LeagueResolver,
  pickChallengeLeague,
  type LeagueResolverDeps,
} from '../src/services/LeagueResolver'

const tradeList = (...ids: string[]) => ({ result: ids.map(id => ({ id, realm: 'pc' })) })
const indexState = (...names: string[]) => ({ economyLeagues: names.map(name => ({ name })) })

// Realistic orderings (challenge league(s) first, then permanent).
const STEADY = ['Mirage', 'Hardcore Mirage', 'Ruthless Mirage', 'HC Ruthless Mirage', 'Standard', 'Hardcore', 'Ruthless']
const ROLLOVER = ['Keepers of the Flame', 'Hardcore Keepers of the Flame', 'Ruthless Keepers of the Flame', 'Standard', 'Hardcore']
const GAP = ['Standard', 'Hardcore', 'SSF Standard', 'SSF Hardcore', 'Ruthless', 'HC Ruthless']
const GAP_WITH_EVENT = ['Endless Delve (DE001)', 'Standard', 'Hardcore']

function makeDeps(over: Partial<LeagueResolverDeps> = {}): LeagueResolverDeps {
  return {
    fetchTradeLeagues: vi.fn(async () => tradeList(...STEADY)),
    fetchNinjaIndexState: vi.fn(async () => indexState(...STEADY)),
    now: () => 1_000_000,
    ...over,
  }
}

describe('pickChallengeLeague', () => {
  it('picks the main softcore challenge league, not a permanent or HC/Ruthless/SSF variant', () => {
    expect(pickChallengeLeague(STEADY)).toBe('Mirage')
    expect(pickChallengeLeague(ROLLOVER)).toBe('Keepers of the Flame')
  })

  it('returns null when only permanent/variant leagues exist (rollover gap)', () => {
    expect(pickChallengeLeague(GAP)).toBeNull()
  })

  it('returns a non-permanent event league when present in a gap', () => {
    expect(pickChallengeLeague(GAP_WITH_EVENT)).toBe('Endless Delve (DE001)')
  })
})

describe('LeagueResolver.resolveCurrentLeague', () => {
  it('STEADY STATE: resolves the current challenge league from trade-data leagues', async () => {
    const deps = makeDeps()
    const r = new LeagueResolver(deps)
    await expect(r.resolveCurrentLeague()).resolves.toBe('Mirage')
    expect(deps.fetchNinjaIndexState).not.toHaveBeenCalled()
  })

  it('ROLLOVER: auto-picks the new league once it appears first in the trade list', async () => {
    const deps = makeDeps({ fetchTradeLeagues: vi.fn(async () => tradeList(...ROLLOVER)) })
    const r = new LeagueResolver(deps)
    await expect(r.resolveCurrentLeague()).resolves.toBe('Keepers of the Flame')
  })

  it('caches within the TTL (does not refetch the primary source)', async () => {
    const deps = makeDeps()
    const r = new LeagueResolver(deps)
    await r.resolveCurrentLeague()
    await r.resolveCurrentLeague()
    expect(deps.fetchTradeLeagues).toHaveBeenCalledTimes(1)
  })

  it('FALLBACK: when PRIMARY fails, resolves from poe.ninja index-state', async () => {
    const deps = makeDeps({
      fetchTradeLeagues: vi.fn(async () => {
        throw new Error('cloudflare')
      }),
      fetchNinjaIndexState: vi.fn(async () => indexState(...STEADY)),
    })
    const r = new LeagueResolver(deps)
    await expect(r.resolveCurrentLeague()).resolves.toBe('Mirage')
    expect(deps.fetchNinjaIndexState).toHaveBeenCalledOnce()
  })

  it('GAP: only permanent leagues → throws (never returns Standard)', async () => {
    const deps = makeDeps({
      fetchTradeLeagues: vi.fn(async () => tradeList(...GAP)),
      fetchNinjaIndexState: vi.fn(async () => indexState(...GAP)),
    })
    const r = new LeagueResolver(deps)
    await expect(r.resolveCurrentLeague()).rejects.toThrow(/could not resolve the current poe league/i)
  })

  it('GAP with event league: returns the event league (non-Standard), not Standard', async () => {
    const deps = makeDeps({
      fetchTradeLeagues: vi.fn(async () => tradeList(...GAP_WITH_EVENT)),
    })
    const r = new LeagueResolver(deps)
    const league = await r.resolveCurrentLeague()
    expect(league).toBe('Endless Delve (DE001)')
    expect(league).not.toBe('Standard')
  })
})
