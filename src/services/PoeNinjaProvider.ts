/**
 * PoeNinjaProvider — economy data from poe.ninja's CURRENT PoE1 namespace.
 *
 * poe.ninja retired the old `/api/data/*overview` endpoints (the 404s we hit) and
 * moved PoE1 to a versioned "stash" namespace (reverse-engineered from the live
 * site's Astro island + the Davenads reference, then confirmed empirically):
 *
 *   Currency/Fragment:
 *     GET https://poe.ninja/poe1/api/economy/stash/{version}/currency/overview
 *         ?league={LEAGUE}&type=Currency|Fragment&language=en
 *   Items (uniques, gems, maps, …):
 *     GET https://poe.ninja/poe1/api/economy/stash/{version}/item/overview
 *         ?league={LEAGUE}&type={ItemType}&language=en
 *   League/snapshot metadata:
 *     GET https://poe.ninja/poe1/api/data/index-state
 *
 * `{version}` = `0` resolves to the latest snapshot (confirmed for both currency
 * and item overviews), so we don't need to thread snapshot versions per request.
 *
 * Response shape is the *legacy-style* one (it did NOT change to the PoE2
 * id/primaryValue exchange shape):
 *   currency line: { currencyTypeName, chaosEquivalent, pay{value,listing_count},
 *                    receive{value,count,listing_count}, lowConfidenceReceiveSparkLine, … }
 *   item line:     { name, baseType, chaosValue, divineValue, listingCount, count,
 *                    links, levelRequired, icon, variant, … }
 *
 * This is a NEW adapter (new URLs + version handling), not a revival of the dead
 * legacy `PoeNinjaService`. Normalized to the shared economyTypes shape with a
 * derived `lowConfidence` flag and `source: "poe.ninja"`.
 */
import { log } from './log'
import { TokenBucket } from './rateLimit'
import {
  MIN_CONFIDENT_LISTINGS,
  type CurrencyPrice,
  type EconomySnapshot,
  type ItemPrice,
} from './economyTypes'
import type { EconomyProvider } from './EconomyProvider'

const BASE = 'https://poe.ninja/poe1/api/economy'
const VERSION = '0' // latest snapshot
const SOURCE = 'poe.ninja'
const USER_AGENT =
  process.env.POE_MCP_USER_AGENT ??
  'Mozilla/5.0 (compatible; poe-oracle/0.2; +https://github.com/eyanric/poe-oracle)'
const CACHE_TTL = 10 * 60_000

/** EconomySnapshot field ← poe.ninja item-overview `type`. Types absent for a league 404 → []. */
const ITEM_TYPES: Array<{ field: keyof EconomySnapshot; type: string }> = [
  { field: 'essences', type: 'Essence' },
  { field: 'divCards', type: 'DivinationCard' },
  { field: 'skillGems', type: 'SkillGem' },
  { field: 'maps', type: 'Map' },
  { field: 'scarabs', type: 'Scarab' },
  { field: 'uniqueWeapons', type: 'UniqueWeapon' },
  { field: 'uniqueArmours', type: 'UniqueArmour' },
  { field: 'uniqueAccessories', type: 'UniqueAccessory' },
  { field: 'uniqueFlasks', type: 'UniqueFlask' },
  { field: 'uniqueJewels', type: 'UniqueJewel' },
]

// ── Raw response shapes ──────────────────────────────────────────────────────

interface NinjaCurrencyLine {
  currencyTypeName: string
  chaosEquivalent: number
  pay?: { value: number; count?: number; listing_count?: number }
  receive?: { value: number; count?: number; listing_count?: number }
  lowConfidencePaySparkLine?: boolean
  lowConfidenceReceiveSparkLine?: boolean
}
interface NinjaCurrencyResponse { lines?: NinjaCurrencyLine[] }

interface NinjaItemLine {
  name: string
  baseType?: string
  chaosValue: number
  divineValue?: number
  listingCount?: number
  count?: number
  links?: number
  levelRequired?: number
  icon?: string
  variant?: string
  itemClass?: number
}
interface NinjaItemResponse { lines?: NinjaItemLine[] }

// ── Pure mappers (exported for unit testing) ─────────────────────────────────

export function mapNinjaCurrency(lines: NinjaCurrencyLine[]): CurrencyPrice[] {
  return lines
    .filter(l => l.chaosEquivalent > 0)
    .map(l => {
      const listings = l.receive?.listing_count ?? 0
      return {
        currencyTypeName: l.currencyTypeName,
        chaosEquivalent: l.chaosEquivalent,
        pay: l.pay ? { value: l.pay.value, listing_count: l.pay.listing_count ?? 0 } : undefined,
        receive: l.receive ? { value: l.receive.value, listing_count: listings } : undefined,
        // Confidence = listing depth (consistent with poe.watch). poe.ninja's
        // lowConfidence*SparkLine flags price-trend confidence, which over-flags
        // well-listed currencies in low-population leagues, so we don't use them.
        lowConfidence: listings < MIN_CONFIDENT_LISTINGS,
        source: SOURCE,
      }
    })
}

export function mapNinjaItems(lines: NinjaItemLine[]): ItemPrice[] {
  return lines
    .filter(l => l.chaosValue > 0)
    .map(l => {
      const listings = l.listingCount ?? 0
      return {
        name: l.name,
        baseType: l.baseType || l.name,
        chaosValue: l.chaosValue,
        divineValue: l.divineValue ?? 0,
        listingCount: listings,
        icon: l.icon,
        links: l.links || undefined,
        variant: l.variant,
        levelRequired: l.levelRequired,
        itemClass: l.itemClass,
        lowConfidence: listings < MIN_CONFIDENT_LISTINGS,
        source: SOURCE,
      }
    })
}

// ── Service ──────────────────────────────────────────────────────────────────

interface CacheEntry<T> { data: T; expiresAt: number }

export class PoeNinjaProvider implements EconomyProvider {
  private static instance: PoeNinjaProvider
  readonly name = SOURCE
  private readonly cache = new Map<string, CacheEntry<unknown>>()
  // poe.ninja is sensitive to bursts; ~12 req / 5 min. Be polite.
  private readonly bucket = new TokenBucket(12, 12 / 300)

  static getInstance(): PoeNinjaProvider {
    if (!PoeNinjaProvider.instance) PoeNinjaProvider.instance = new PoeNinjaProvider()
    return PoeNinjaProvider.instance
  }

  invalidateCache(): void {
    this.cache.clear()
  }

  async getCurrencyPrices(league: string): Promise<CurrencyPrice[]> {
    const key = `currency:${league}`
    const cached = this.getCached<CurrencyPrice[]>(key)
    if (cached) return cached
    const data = mapNinjaCurrency(await this.fetchCurrency(league, 'Currency'))
    this.setCache(key, data)
    return data
  }

  async getEconomySnapshot(league: string): Promise<EconomySnapshot> {
    const key = `snapshot:${league}`
    const cached = this.getCached<EconomySnapshot>(key)
    if (cached) return cached

    log.info(`[poe.ninja] fetching economy snapshot for league: ${league}`)
    const [currencyRaw, fragmentRaw, ...itemRaws] = await Promise.all([
      this.fetchCurrency(league, 'Currency'),
      this.fetchCurrency(league, 'Fragment'),
      ...ITEM_TYPES.map(t => this.fetchItems(league, t.type)),
    ])

    const snapshot: EconomySnapshot = {
      league,
      fetchedAt: Date.now(),
      source: SOURCE,
      currency: mapNinjaCurrency(currencyRaw),
      fragments: mapNinjaCurrency(fragmentRaw),
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
    }
    ITEM_TYPES.forEach((t, i) => {
      ;(snapshot[t.field] as ItemPrice[]) = mapNinjaItems(itemRaws[i])
    })

    this.setCache(key, snapshot)
    log.info(
      `[poe.ninja] snapshot complete: ${snapshot.currency.length} currencies, ` +
        `${snapshot.uniqueWeapons.length} unique weapons, ${snapshot.skillGems.length} gems`
    )
    return snapshot
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async fetchCurrency(league: string, type: string): Promise<NinjaCurrencyLine[]> {
    const url = `${BASE}/stash/${VERSION}/currency/overview?league=${encodeURIComponent(league)}&type=${type}&language=en`
    const body = await this.fetchJson<NinjaCurrencyResponse>(url, `currency/${type}`)
    return body?.lines ?? []
  }

  private async fetchItems(league: string, type: string): Promise<NinjaItemLine[]> {
    const url = `${BASE}/stash/${VERSION}/item/overview?league=${encodeURIComponent(league)}&type=${type}&language=en`
    const body = await this.fetchJson<NinjaItemResponse>(url, `item/${type}`)
    return body?.lines ?? []
  }

  private async fetchJson<T>(url: string, label: string): Promise<T | null> {
    try {
      await this.bucket.consume()
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json, text/plain, */*',
          // poe.ninja's economy API expects same-origin-ish requests.
          Referer: 'https://poe.ninja/poe1/economy',
        },
      })
      // A 404 means "no snapshot for this type/league" — normal; treat as empty.
      if (res.status === 404) return null
      if (!res.ok) {
        log.warn(`[poe.ninja] ${label}: HTTP ${res.status}`)
        return null
      }
      const text = (await res.text()).trim()
      if (!text || text.startsWith('<')) {
        log.warn(`[poe.ninja] ${label}: non-JSON response (HTML/Cloudflare?)`)
        return null
      }
      return JSON.parse(text) as T
    } catch (err) {
      log.warn(`[poe.ninja] ${label}: fetch failed:`, err)
      return null
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
