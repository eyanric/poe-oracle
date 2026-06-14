/**
 * PoeWatchService — economy data from api.poe.watch.
 *
 * Why not poe.ninja? As of this slice, poe.ninja retired its public
 * `/api/data/*overview` endpoints (they return Cloudflare-cached 404s for every
 * path/header/league) and moved the PoE1 economy UI behind `/poe1/` with a
 * non-public data API. poe.watch is an open, currently-live PoE1 economy API
 * that carries chaos value, divine value, and listing counts.
 *
 * It exposes the SAME shape as the ported PoeNinjaService (EconomySnapshot /
 * CurrencyPrice) so the tools are source-agnostic. VAAL's 10-min cache and the
 * non-JSON ("Cloudflare HTML") rejection guard are preserved in spirit.
 */
import { log } from './log'
import {
  MIN_CONFIDENT_LISTINGS,
  type CurrencyPrice,
  type EconomySnapshot,
  type ItemPrice,
} from './economyTypes'
import type { EconomyProvider } from './EconomyProvider'

const SOURCE = 'poe.watch'

const BASE = 'https://api.poe.watch'
const USER_AGENT =
  process.env.POE_MCP_USER_AGENT ??
  'poe-oracle/0.1.0 (+https://github.com/eyanric/poe-oracle; consolidated PoE data MCP)'
const CACHE_TTL = 10 * 60_000

/** One row from poe.watch `/get?category=…&league=…`. */
export interface PoeWatchEntry {
  id: number
  name: string
  category: string
  group: string
  /** PoE frame type: 3 = unique, 5 = currency, 6 = divination card, … */
  frame: number
  mean: number
  min: number
  max: number
  divine: number | null
  /** Number of listings sampled that day — used as a listing-count proxy. */
  daily: number
  lowConfidence?: boolean
  icon?: string
  variation?: string | null
  gemLevel?: number | null
  gemQuality?: number | null
  links?: number | null
}

/** EconomySnapshot field ← poe.watch category (and whether to keep uniques only). */
const ITEM_SOURCES: Array<{ field: keyof EconomySnapshot; category: string; uniqueOnly: boolean }> = [
  { field: 'essences', category: 'essence', uniqueOnly: false },
  { field: 'divCards', category: 'card', uniqueOnly: false },
  { field: 'skillGems', category: 'gem', uniqueOnly: false },
  { field: 'maps', category: 'map', uniqueOnly: false },
  { field: 'scarabs', category: 'scarab', uniqueOnly: false },
  { field: 'oils', category: 'oil', uniqueOnly: false },
  { field: 'uniqueWeapons', category: 'weapon', uniqueOnly: true },
  { field: 'uniqueArmours', category: 'armour', uniqueOnly: true },
  { field: 'uniqueAccessories', category: 'accessory', uniqueOnly: true },
  { field: 'uniqueFlasks', category: 'flask', uniqueOnly: true },
  { field: 'uniqueJewels', category: 'jewel', uniqueOnly: true },
]

// ── Pure mappers (exported for unit testing) ─────────────────────────────────

export function mapCurrency(entries: PoeWatchEntry[]): CurrencyPrice[] {
  return entries
    .filter(e => e.mean > 0)
    .map(e => {
      const listings = e.daily ?? 0
      return {
        currencyTypeName: e.name,
        chaosEquivalent: e.mean,
        receive: { value: e.mean, listing_count: listings },
        lowConfidence: !!e.lowConfidence || listings < MIN_CONFIDENT_LISTINGS,
        source: SOURCE,
      }
    })
}

export function mapItems(entries: PoeWatchEntry[], uniqueOnly: boolean): ItemPrice[] {
  return entries
    .filter(e => (uniqueOnly ? e.frame === 3 : true) && e.mean > 0)
    .map(e => {
      const listings = e.daily ?? 0
      return {
        name: e.name,
        baseType: e.group || e.name,
        chaosValue: e.mean,
        divineValue: e.divine ?? 0,
        listingCount: listings,
        icon: e.icon,
        links: e.links ?? undefined,
        variant: e.variation ?? undefined,
        lowConfidence: !!e.lowConfidence || listings < MIN_CONFIDENT_LISTINGS,
        source: SOURCE,
      }
    })
}

// ── Service ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }

export class PoeWatchService implements EconomyProvider {
  private static instance: PoeWatchService
  readonly name = 'poe.watch'
  private readonly cache = new Map<string, CacheEntry<unknown>>()

  static getInstance(): PoeWatchService {
    if (!PoeWatchService.instance) PoeWatchService.instance = new PoeWatchService()
    return PoeWatchService.instance
  }

  invalidateCache(): void {
    this.cache.clear()
  }

  async getCurrencyPrices(league: string): Promise<CurrencyPrice[]> {
    const key = `currency:${league}`
    const cached = this.getCached<CurrencyPrice[]>(key)
    if (cached) return cached
    const data = mapCurrency(await this.fetchCategory(league, 'currency'))
    this.setCache(key, data)
    return data
  }

  async getEconomySnapshot(league: string): Promise<EconomySnapshot> {
    const key = `snapshot:${league}`
    const cached = this.getCached<EconomySnapshot>(key)
    if (cached) return cached

    log.info(`[poe.watch] fetching economy snapshot for league: ${league}`)

    const [currencyRaw, fragmentRaw, ...itemRaws] = await Promise.all([
      this.fetchCategory(league, 'currency'),
      this.fetchCategory(league, 'fragment'),
      ...ITEM_SOURCES.map(s => this.fetchCategory(league, s.category)),
    ])

    const snapshot: EconomySnapshot = {
      league,
      fetchedAt: Date.now(),
      currency: mapCurrency(currencyRaw),
      fragments: mapCurrency(fragmentRaw),
      essences: [],
      divCards: [],
      uniqueWeapons: [],
      uniqueArmours: [],
      uniqueAccessories: [],
      uniqueFlasks: [],
      uniqueJewels: [],
      skillGems: [],
      maps: [],
      scarabs: [],
      oils: [],
    }
    ITEM_SOURCES.forEach((s, i) => {
      ;(snapshot[s.field] as ItemPrice[]) = mapItems(itemRaws[i], s.uniqueOnly)
    })

    this.setCache(key, snapshot)
    log.info(
      `[poe.watch] snapshot complete: ${snapshot.currency.length} currencies, ` +
        `${snapshot.divCards.length} div cards, ${snapshot.uniqueAccessories.length} unique accessories`
    )
    return snapshot
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async fetchCategory(league: string, category: string): Promise<PoeWatchEntry[]> {
    try {
      const url = `${BASE}/get?category=${encodeURIComponent(category)}&league=${encodeURIComponent(league)}`
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } })
      if (!res.ok) {
        log.warn(`[poe.watch] ${category}: HTTP ${res.status} for league "${league}"`)
        return []
      }
      const text = (await res.text()).trim()
      // Guard: a Cloudflare/HTML challenge is not our JSON array.
      if (!text || text.startsWith('<')) {
        log.warn(`[poe.watch] ${category}: non-JSON response (HTML/empty)`)
        return []
      }
      const body = JSON.parse(text)
      if (!Array.isArray(body)) {
        log.warn(`[poe.watch] ${category}: unexpected non-array payload`)
        return []
      }
      return body as PoeWatchEntry[]
    } catch (err) {
      log.warn(`[poe.watch] ${category}: fetch failed:`, err)
      return []
    }
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }
    return entry.data as T
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL })
  }
}
