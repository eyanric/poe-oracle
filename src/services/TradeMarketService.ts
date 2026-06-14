/**
 * TradeMarketService — bounded, on-demand reads from the OFFICIAL PoE Trade API.
 *
 * ANALYSIS ONLY. This never automates the trade action: no realtime/live-search
 * websocket, no background scanner, no auto-whisper, no auto-buy/sell. Each call
 * is a single user-initiated lookup of a small sample of listings.
 *
 *   Items    → POST /api/trade/search/{league} + GET /api/trade/fetch/{ids}
 *              (cap to the N cheapest ONLINE listings).
 *   Currency → POST /api/trade/exchange/{league}  (the bulk currency-exchange
 *              endpoint) as the live reference instead of item search.
 *   Static   → GET /api/trade/data/static         (currency name → tradeId).
 *
 * GGG's dynamic rate-limit headers are honoured via GggRateLimiter; a 429 stops
 * and backs off (never retried within a call). POESESSID (from env) is sent when
 * present — the endpoints also work unauthenticated at stricter IP limits.
 */
import { log } from './log'
import { GggRateLimiter } from './RateLimiter'
import type { ParsedClipboardItem } from './ItemParser'
import { buildTradeQuery, indexStats, type StatIndex } from './tradeQuery'

const HOST = 'https://www.pathofexile.com'
const USER_AGENT =
  process.env.POE_MCP_USER_AGENT ??
  'poe-oracle/0.3 (appraise; +https://github.com/eyanric/poe-oracle)'

/** One sampled live listing: price in chaos + age in seconds. */
export interface LiveListing {
  chaos: number
  ageSec: number | null
}

/** A reconciled live-market quote, all values in chaos. */
export interface LiveQuote {
  source: 'pathofexile.com/trade'
  kind: 'currency-exchange' | 'item-search'
  unit: 'chaos'
  low: number
  median: number
  /** Total market depth — item search `total`, or the exchange `total` (full online book). */
  count: number
  /** How many listings were actually summarized. */
  sampleSize: number
  /** Age of the freshest sampled listing, in seconds. */
  snapshotAgeSec: number | null
  /** Per-listing price + age — drives the freshness-gated actionable margin. */
  samples: LiveListing[]
  /** Deep link to the official trade search behind this quote, when available. */
  tradeUrl?: string
  note?: string
}

// ── Raw shapes ───────────────────────────────────────────────────────────────

interface ExchangeOffer {
  exchange: { currency: string; amount: number }
  item: { currency: string; amount: number; stock?: number }
}
interface ExchangeListing {
  indexed?: string
  offers?: ExchangeOffer[]
}
interface ExchangeResponse {
  /** Full count of the online exchange book (equals result size — not paginated). */
  total?: number
  result?: Record<string, { listing?: ExchangeListing }>
}
interface SearchResponse {
  id: string
  result?: string[]
  total?: number
}
interface FetchResponse {
  result?: Array<{ listing?: { indexed?: string; price?: { amount: number; currency: string } } }>
}
interface StaticGroup {
  id: string
  entries?: Array<{ id: string; text: string }>
}
interface StaticResponse {
  result?: StaticGroup[]
}

// ── Pure parse/summary helpers (exported for tests) ──────────────────────────

function ageSec(indexed: string | undefined, now: number): number | null {
  if (!indexed) return null
  const t = Date.parse(indexed)
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null
}

/** Summarize a list of chaos values → low / median / count. */
export function summarize(values: number[]): { low: number; median: number; count: number } {
  const v = [...values].filter(n => n > 0).sort((a, b) => a - b)
  if (v.length === 0) return { low: 0, median: 0, count: 0 }
  const mid = Math.floor(v.length / 2)
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
  return { low: v[0], median, count: v.length }
}

/** Chaos-per-`wantId` ratios from a bulk-exchange response (have = chaos). */
export function parseExchangeRatios(
  body: ExchangeResponse,
  wantId: string,
  haveId = 'chaos',
  now = Date.now(),
): Array<{ chaosPerUnit: number; ageSec: number | null }> {
  const out: Array<{ chaosPerUnit: number; ageSec: number | null }> = []
  for (const row of Object.values(body.result ?? {})) {
    const offer = row.listing?.offers?.[0]
    if (!offer) continue
    if (offer.exchange.currency !== haveId || offer.item.currency !== wantId) continue
    if (offer.item.amount <= 0) continue
    out.push({
      chaosPerUnit: offer.exchange.amount / offer.item.amount,
      ageSec: ageSec(row.listing?.indexed, now),
    })
  }
  return out
}

/** Chaos-converted prices from a fetch response, dropping unknown currencies. */
export function parseFetchPrices(
  body: FetchResponse,
  currencyToChaos: Record<string, number>,
  now = Date.now(),
): Array<{ chaos: number; ageSec: number | null }> {
  const out: Array<{ chaos: number; ageSec: number | null }> = []
  for (const row of body.result ?? []) {
    const price = row.listing?.price
    if (!price) continue
    const rate = currencyToChaos[price.currency]
    if (!rate || price.amount <= 0) continue
    out.push({ chaos: price.amount * rate, ageSec: ageSec(row.listing?.indexed, now) })
  }
  return out
}

// ── Service ──────────────────────────────────────────────────────────────────

export class TradeMarketService {
  private static instance: TradeMarketService
  private readonly limiter = new GggRateLimiter()
  private currencyIds: Map<string, string> | null = null
  private statIndex: StatIndex | null = null
  private statIndexLoading: Promise<StatIndex> | null = null

  static getInstance(): TradeMarketService {
    if (!TradeMarketService.instance) TradeMarketService.instance = new TradeMarketService()
    return TradeMarketService.instance
  }

  /** Live currency reference (chaos per 1 unit) via the bulk exchange endpoint. */
  async currencyReference(league: string, currencyName: string): Promise<LiveQuote | null> {
    const wantId = await this.currencyTradeId(currencyName)
    if (!wantId) return { ...this.empty('currency-exchange'), note: `no trade id for "${currencyName}"` }
    if (wantId === 'chaos') return { ...this.empty('currency-exchange'), note: 'chaos is the reference unit' }

    const body = await this.post<ExchangeResponse>(`/api/trade/exchange/${encodeURIComponent(league)}`, {
      query: { status: { option: 'online' }, have: ['chaos'], want: [wantId] },
      sort: { have: 'asc' },
    })
    if (!body) return { ...this.empty('currency-exchange'), note: 'exchange request failed or rate-limited' }

    const now = Date.now()
    const ratios = parseExchangeRatios(body, wantId, 'chaos', now)
    if (ratios.length === 0) return { ...this.empty('currency-exchange'), note: 'no online exchange listings' }
    const s = summarize(ratios.map(r => r.chaosPerUnit))
    const ages = ratios.map(r => r.ageSec).filter((n): n is number => n !== null)
    return {
      source: 'pathofexile.com/trade',
      kind: 'currency-exchange',
      unit: 'chaos',
      low: s.low,
      median: s.median,
      count: body.total ?? ratios.length, // exchange `total` = full online book
      sampleSize: ratios.length,
      snapshotAgeSec: ages.length ? Math.min(...ages) : null,
      samples: ratios.map(r => ({ chaos: r.chaosPerUnit, ageSec: r.ageSec })),
    }
  }

  /**
   * Live item reference (chaos) via search + fetch of the N cheapest online
   * listings. Searches by name only — unique names are unambiguous, and
   * aggregator "base types" are unreliable (poe.watch reports a category group
   * like "belts", not the real base "Leather Belt", which 400s the search).
   */
  async itemReference(
    league: string,
    name: string,
    currencyToChaos: Record<string, number>,
    maxListings: number,
  ): Promise<LiveQuote | null> {
    const search = await this.post<SearchResponse>(`/api/trade/search/${encodeURIComponent(league)}`, {
      query: { status: { option: 'online' }, name },
      sort: { price: 'asc' },
    })
    if (!search) return { ...this.empty('item-search'), note: 'search failed or rate-limited' }
    const total = search.total ?? 0
    const ids = (search.result ?? []).slice(0, maxListings)
    if (ids.length === 0) return { ...this.empty('item-search'), note: 'no online listings' }

    const fetched = await this.get<FetchResponse>(
      `/api/trade/fetch/${ids.join(',')}?query=${encodeURIComponent(search.id)}`,
    )
    if (!fetched) return { ...this.empty('item-search'), note: 'fetch failed or rate-limited' }

    const now = Date.now()
    const prices = parseFetchPrices(fetched, currencyToChaos, now)
    if (prices.length === 0) return { ...this.empty('item-search'), count: total, note: 'listings priced in unsupported currency' }
    const s = summarize(prices.map(p => p.chaos))
    const ages = prices.map(p => p.ageSec).filter((n): n is number => n !== null)
    return {
      source: 'pathofexile.com/trade',
      kind: 'item-search',
      unit: 'chaos',
      low: s.low,
      median: s.median,
      count: total, // authoritative market depth
      sampleSize: prices.length,
      snapshotAgeSec: ages.length ? Math.min(...ages) : null,
      samples: prices.map(p => ({ chaos: p.chaos, ageSec: p.ageSec })),
      tradeUrl: `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${search.id}`,
    }
  }

  /**
   * Mod-aware live reference for a parsed clipboard item (rares/magics use a
   * stat-filter search; uniques/gems/currency/maps fall back to name/type). Same
   * bounded search+fetch path, with a trade-site deep link.
   */
  async priceCheckItem(
    league: string,
    item: ParsedClipboardItem,
    currencyToChaos: Record<string, number>,
    maxListings: number,
  ): Promise<LiveQuote | null> {
    const idx = await this.ensureStatIndex()
    const built = buildTradeQuery(item, idx)
    if (!built) return { ...this.empty('item-search'), note: 'no searchable mods/base for this item' }

    const search = await this.post<SearchResponse>(`/api/trade/search/${encodeURIComponent(league)}`, built)
    if (!search) return { ...this.empty('item-search'), note: 'search failed or rate-limited' }
    const total = search.total ?? 0
    const tradeUrl = `https://www.pathofexile.com/trade/search/${encodeURIComponent(league)}/${search.id}`
    const ids = (search.result ?? []).slice(0, maxListings)
    if (ids.length === 0) return { ...this.empty('item-search'), count: total, tradeUrl, note: 'no online listings' }

    const fetched = await this.get<FetchResponse>(
      `/api/trade/fetch/${ids.join(',')}?query=${encodeURIComponent(search.id)}`,
    )
    if (!fetched) return { ...this.empty('item-search'), tradeUrl, note: 'fetch failed or rate-limited' }

    const now = Date.now()
    const prices = parseFetchPrices(fetched, currencyToChaos, now)
    if (prices.length === 0) return { ...this.empty('item-search'), count: total, tradeUrl, note: 'listings priced in unsupported currency' }
    const s = summarize(prices.map(p => p.chaos))
    const ages = prices.map(p => p.ageSec).filter((n): n is number => n !== null)
    return {
      source: 'pathofexile.com/trade',
      kind: 'item-search',
      unit: 'chaos',
      low: s.low,
      median: s.median,
      count: total,
      sampleSize: prices.length,
      snapshotAgeSec: ages.length ? Math.min(...ages) : null,
      samples: prices.map(p => ({ chaos: p.chaos, ageSec: p.ageSec })),
      tradeUrl,
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** Load + cache the trade stat index (mod text → stat id). */
  private async ensureStatIndex(): Promise<StatIndex> {
    if (this.statIndex) return this.statIndex
    if (this.statIndexLoading) return this.statIndexLoading
    this.statIndexLoading = (async () => {
      const data = await this.get<{ result?: Array<{ entries?: Array<{ id: string; text: string; type: string }> }> }>(
        '/api/trade/data/stats',
      )
      const idx = data ? indexStats(data) : new Map<string, never>() as StatIndex
      this.statIndex = idx
      this.statIndexLoading = null
      log.info(`[trade] stat index loaded (${idx.size} entries)`)
      return idx
    })()
    return this.statIndexLoading
  }

  private empty(kind: LiveQuote['kind']): LiveQuote {
    return { source: 'pathofexile.com/trade', kind, unit: 'chaos', low: 0, median: 0, count: 0, sampleSize: 0, snapshotAgeSec: null, samples: [] }
  }

  private async currencyTradeId(name: string): Promise<string | null> {
    if (!this.currencyIds) {
      const body = await this.get<StaticResponse>('/api/trade/data/static')
      const map = new Map<string, string>()
      for (const group of body?.result ?? []) {
        if (!/currency|fragment/i.test(group.id)) continue
        for (const e of group.entries ?? []) map.set(e.text.toLowerCase(), e.id)
      }
      this.currencyIds = map
    }
    return this.currencyIds.get(name.toLowerCase()) ?? null
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
    if (json) h['Content-Type'] = 'application/json'
    const sessid = process.env.POESESSID
    if (sessid) h.Cookie = `POESESSID=${sessid}`
    return h
  }

  private async get<T>(path: string): Promise<T | null> {
    return this.request<T>('GET', path)
  }
  private async post<T>(path: string, body: unknown): Promise<T | null> {
    return this.request<T>('POST', path, body)
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T | null> {
    try {
      const pacing = this.limiter.nextDelayMs()
      if (pacing > 0) log.info(`[trade] pacing ${Math.round(pacing)}ms before ${path} (GGG rate limit)`)
      await this.limiter.acquire()
      const res = await fetch(`${HOST}${path}`, {
        method,
        headers: this.headers(method === 'POST'),
        body: body ? JSON.stringify(body) : undefined,
      })
      this.limiter.noteResponse(res.status, n => res.headers.get(n))
      if (res.status === 429) {
        log.warn(`[trade] 429 rate-limited on ${path} — backing off ${Math.round(this.limiter.nextDelayMs() / 1000)}s`)
        return null
      }
      if (!res.ok) {
        log.warn(`[trade] ${path}: HTTP ${res.status}`)
        return null
      }
      const text = (await res.text()).trim()
      if (!text || text.startsWith('<')) {
        log.warn(`[trade] ${path}: non-JSON response`)
        return null
      }
      return JSON.parse(text) as T
    } catch (err) {
      log.warn(`[trade] ${path}: request failed:`, err)
      return null
    }
  }
}
