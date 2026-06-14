/**
 * LeagueResolver — resolve the current PoE 1 challenge (temp) league.
 *
 * Two independent LIVE sources, both of which list the active softcore challenge
 * league first and neither of which is "Standard" by default:
 *
 *   PRIMARY  — the official Trade API league list
 *              (https://www.pathofexile.com/api/trade/data/leagues). Updates the
 *              instant a new league launches, so it's correct through a rollover.
 *   FALLBACK — poe.ninja's index-state economyLeagues
 *              (https://poe.ninja/poe1/api/data/index-state). (Replaces the old
 *              homepage scrape, which is now a data-less SPA shell.)
 *
 * Result cached ~10 min. **Never silently defaults to Standard.** Through a
 * league rollover the new league is picked automatically; during a gap where
 * only permanent leagues exist, resolution throws a clear error rather than
 * falling back to Standard. A temporary *event* league (non-permanent) is
 * returned as the current league if present.
 */
import { log } from './log'

const USER_AGENT =
  process.env.POE_MCP_USER_AGENT ??
  'Mozilla/5.0 (compatible; poe-oracle/0.2; +https://github.com/eyanric/poe-oracle)'

const CACHE_TTL_MS = 10 * 60_000

/** Permanent / non-challenge leagues we must never treat as "current". */
const PERMANENT = new Set(['standard', 'hardcore', 'ssf standard', 'ssf hardcore'])

interface TradeLeague {
  id: string
  realm?: string
  text?: string
}
interface TradeLeaguesResponse {
  result: TradeLeague[]
}
interface NinjaIndexState {
  economyLeagues?: Array<{ name: string; url?: string; displayName?: string }>
}

/** Injectable IO so the resolution logic can be unit-tested without network. */
export interface LeagueResolverDeps {
  /** PRIMARY: official trade-data leagues list. */
  fetchTradeLeagues: () => Promise<TradeLeaguesResponse>
  /** FALLBACK: poe.ninja PoE1 index-state (economyLeagues). */
  fetchNinjaIndexState: () => Promise<NinjaIndexState>
  now: () => number
}

/**
 * From an ordered league list, pick the main softcore challenge league: the
 * first id that is not permanent and not a Hardcore/Ruthless/SSF variant.
 * Returns null if only permanent/variant leagues are present (a rollover gap).
 */
export function pickChallengeLeague(ids: string[]): string | null {
  for (const id of ids) {
    const lower = id.toLowerCase()
    if (PERMANENT.has(lower)) continue
    if (lower.includes('ruthless')) continue
    if (lower.includes('ssf')) continue
    if (lower.startsWith('hardcore') || lower.startsWith('hc ')) continue
    return id
  }
  return null
}

export class LeagueResolver {
  private cache: { league: string; expiresAt: number } | null = null

  constructor(private readonly deps: LeagueResolverDeps) {}

  /** Clear the memoised league (mainly for tests). */
  clearCache(): void {
    this.cache = null
  }

  async resolveCurrentLeague(): Promise<string> {
    if (this.cache && this.deps.now() < this.cache.expiresAt) {
      return this.cache.league
    }

    let primaryErr: unknown
    try {
      const data = await this.deps.fetchTradeLeagues()
      const ids = (data.result ?? [])
        .filter(l => (l.realm ?? 'pc') === 'pc')
        .map(l => l.id)
      const league = pickChallengeLeague(ids)
      if (league) return this.store(league)
      primaryErr = new Error('no challenge league in trade-data leagues list (rollover gap?)')
    } catch (err) {
      primaryErr = err
    }
    log.warn('[LeagueResolver] PRIMARY (trade-data leagues) failed:', primaryErr)

    let fallbackErr: unknown
    try {
      const state = await this.deps.fetchNinjaIndexState()
      const names = (state.economyLeagues ?? []).map(l => l.name)
      const league = pickChallengeLeague(names)
      if (league) return this.store(league)
      fallbackErr = new Error('no challenge league in poe.ninja index-state (rollover gap?)')
    } catch (err) {
      fallbackErr = err
    }
    log.warn('[LeagueResolver] FALLBACK (poe.ninja index-state) failed:', fallbackErr)

    // Fail closed — never return Standard.
    throw new Error(
      'Could not resolve the current PoE league from any source ' +
        '(trade-data leagues + poe.ninja index-state both yielded no challenge league). ' +
        'This is expected during a league-rollover gap — pass an explicit `league` argument to proceed.'
    )
  }

  private store(league: string): string {
    this.cache = { league, expiresAt: this.deps.now() + CACHE_TTL_MS }
    log.info(`[LeagueResolver] current league resolved → ${league}`)
    return league
  }
}

// ── Default (live) wiring ────────────────────────────────────────────────────

const defaultDeps: LeagueResolverDeps = {
  fetchTradeLeagues: async () => {
    const res = await fetch('https://www.pathofexile.com/api/trade/data/leagues', {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`trade-data leagues HTTP ${res.status}`)
    return (await res.json()) as TradeLeaguesResponse
  },
  fetchNinjaIndexState: async () => {
    const res = await fetch('https://poe.ninja/poe1/api/data/index-state', {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`poe.ninja index-state HTTP ${res.status}`)
    return (await res.json()) as NinjaIndexState
  },
  now: () => Date.now(),
}

/** Process-wide resolver using live HTTP. */
export const leagueResolver = new LeagueResolver(defaultDeps)

/** Convenience: resolve the current league via the default live resolver. */
export function resolveCurrentLeague(): Promise<string> {
  return leagueResolver.resolveCurrentLeague()
}
