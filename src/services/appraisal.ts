/**
 * appraisal — pure (zod-free) reconciliation logic shared by the MCP tools and
 * the VAAL app. Aggregator consensus + divergence, a bounded live trade
 * reference, tier-aware liquidity, and a freshness-gated ACTIONABLE margin.
 */
import type { EconomySnapshot } from './economyTypes'
import { PoeWatchService } from './PoeWatchService'
import { PoeNinjaProvider } from './PoeNinjaProvider'
import { TradeMarketService, type LiveQuote, type LiveListing } from './TradeMarketService'
import type { EconomyProvider } from './EconomyProvider'
import { searchEconomy, type PriceMatch } from './economySearch'
import { parseClipboardItemText, type ParsedClipboardItem } from './ItemParser'

const DEFAULT_DIVERGENCE_PCT = 15
const DEFAULT_MAX_LISTINGS = 10
const DEFAULT_FRESHNESS_WINDOW_SEC = 1800 // 30 min
const DEFAULT_MIN_FRESH_DEPTH = 3

// ── Pure scoring helpers ─────────────────────────────────────────────────────

export type ValueTier = 'commodity' | 'mid' | 'high' | 'mirror'

export function valueTier(chaos: number): ValueTier {
  if (chaos < 100) return 'commodity'
  if (chaos < 5_000) return 'mid'
  if (chaos < 100_000) return 'high'
  return 'mirror'
}

export interface Liquidity {
  rating: 'liquid' | 'moderate' | 'thin' | 'illiquid'
  rationale: string
}

export function liquidityRating(count: number, tier: ValueTier): Liquidity {
  const thresholds: Record<ValueTier, [number, number, number]> = {
    commodity: [50, 15, 3],
    mid: [20, 6, 2],
    high: [8, 3, 1],
    mirror: [3, 2, 1],
  }
  const [liquid, moderate, thin] = thresholds[tier]
  const rating: Liquidity['rating'] =
    count >= liquid ? 'liquid' : count >= moderate ? 'moderate' : count >= thin ? 'thin' : 'illiquid'
  return { rating, rationale: `${count} live listing${count === 1 ? '' : 's'} at ${tier} tier` }
}

export interface Divergence {
  pct: number | null
  divergent: boolean
}

export function divergence(a: number | null, b: number | null, thresholdPct: number): Divergence {
  if (a == null || b == null || a <= 0 || b <= 0) return { pct: null, divergent: false }
  const pct = (Math.abs(a - b) / Math.min(a, b)) * 100
  return { pct, divergent: pct > thresholdPct }
}

export function median(xs: number[]): number {
  const v = [...xs].sort((a, b) => a - b)
  if (v.length === 0) return 0
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export function freshListings(samples: LiveListing[], windowSec: number): number[] {
  return samples.filter(s => s.ageSec != null && s.ageSec <= windowSec).map(s => s.chaos).filter(x => x > 0)
}

export function trimLowOutliers(prices: number[]): number[] {
  if (prices.length <= 3) return [...prices]
  const med = median(prices)
  const mad = median(prices.map(p => Math.abs(p - med)))
  if (mad === 0) return [...prices]
  const lower = med - 3 * mad
  return prices.filter(p => p >= lower)
}

export interface MarginVerdict {
  listingSpread: { low: number; median: number; spreadPct: number } | null
  actionable: { buy: number; sellRef: number; marginChaos: number; marginPct: number; freshDepth: number } | null
  reason?: string
  confidence: { score: number; label: 'high' | 'medium' | 'low' }
}

export function computeMargin(opts: {
  samples: LiveListing[]
  aggregatorChaos: number[]
  divergencePct: number | null
  freshnessWindowSec: number
  minFreshDepth: number
}): MarginVerdict {
  const { samples, aggregatorChaos, divergencePct, freshnessWindowSec, minFreshDepth } = opts

  const all = samples.map(s => s.chaos).filter(x => x > 0)
  const listingSpread =
    all.length >= 2
      ? { low: Math.min(...all), median: median(all), spreadPct: (median(all) - Math.min(...all)) / Math.min(...all) * 100 }
      : null

  const fresh = freshListings(samples, freshnessWindowSec)
  const freshDepth = fresh.length
  let actionable: MarginVerdict['actionable'] = null
  let reason: string | undefined

  if (freshDepth < minFreshDepth) {
    reason = `insufficient fresh liquidity (${freshDepth} listing(s) within ${Math.round(freshnessWindowSec / 60)}m, need ${minFreshDepth})`
  } else {
    const trimmed = trimLowOutliers(fresh)
    const buy = Math.min(...trimmed)
    const freshMed = median(fresh)
    const aggConsensus = aggregatorChaos.length ? aggregatorChaos.reduce((a, b) => a + b, 0) / aggregatorChaos.length : freshMed
    const sellRef = Math.min(freshMed, aggConsensus > 0 ? aggConsensus : freshMed)
    const marginChaos = sellRef - buy
    actionable = { buy, sellRef, marginChaos, marginPct: buy > 0 ? (marginChaos / buy) * 100 : 0, freshDepth }
  }

  const ages = samples.map(s => s.ageSec).filter((n): n is number => n != null)
  const freshest = ages.length ? Math.min(...ages) : null
  const clamp = (x: number) => Math.max(0, Math.min(1, x))
  const depthF = clamp(freshDepth / (minFreshDepth * 2))
  const freshF = freshest == null ? 0 : freshest < 300 ? 1 : freshest <= freshnessWindowSec ? 0.6 : 0.2
  const agreeF = divergencePct == null ? 0.5 : clamp(1 - divergencePct / 50)
  let score = 0.45 * depthF + 0.3 * freshF + 0.25 * agreeF
  if (!actionable) score = Math.min(score, 0.33)
  if (divergencePct != null && divergencePct > 100) score = Math.min(score, 0.33)
  const label: 'high' | 'medium' | 'low' = score > 0.66 ? 'high' : score > 0.33 ? 'medium' : 'low'

  return { listingSpread, actionable, reason, confidence: { score: Number(score.toFixed(2)), label } }
}

// ── Aggregator lookup ────────────────────────────────────────────────────────

function emptySnapshot(league: string): EconomySnapshot {
  return {
    league, fetchedAt: 0, currency: [], fragments: [], essences: [], divCards: [],
    uniqueWeapons: [], uniqueArmours: [], uniqueAccessories: [], uniqueFlasks: [],
    uniqueJewels: [], skillGems: [], maps: [], scarabs: [],
  }
}

/** Best aggregator match for a name — currency first (cheap), else full snapshot. */
async function bestMatch(provider: EconomyProvider, league: string, query: string): Promise<PriceMatch | null> {
  const currency = await provider.getCurrencyPrices(league)
  const curSnap = emptySnapshot(league)
  curSnap.currency = currency
  const cm = searchEconomy(curSnap, query, undefined, 1)
  if (cm.length && (cm[0].category === 'Currency' || cm[0].category === 'Fragment')) return cm[0]

  const snap = await provider.getEconomySnapshot(league)
  return searchEconomy(snap, query, undefined, 1)[0] ?? null
}

async function divineChaosOf(provider: EconomyProvider, league: string): Promise<number> {
  const currency = await provider.getCurrencyPrices(league)
  const divine = currency.find(c => c.currencyTypeName === 'Divine Orb')
  return divine && divine.chaosEquivalent > 0 ? divine.chaosEquivalent : 0
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface AggRow {
  source?: string
  category: string
  chaosValue: number
  divineValue: number | null
  listingCount: number
  lowConfidence: boolean
}

export interface ParsedItemSummary {
  rarity: string
  name: string
  baseType: string
  itemClass: string
  itemLevel: number
  quality: number
  links: number
  corrupted: boolean
  unidentified: boolean
  influences: string[]
  explicitMods: string[]
  implicitMods: string[]
}

export type AppraisalResult = {
  query: string
  league: string
  category: string
  parsedItem?: ParsedItemSummary
  aggregators: AggRow[]
  divergence: { pct: number | null; divergent: boolean; thresholdPct: number }
  live: LiveQuote | null
  liquidity: Liquidity & { tier: ValueTier; depth: number }
  margin: MarginVerdict & { freshnessWindowSec: number; caveat: string }
}

export interface AppraiseOptions {
  divergenceThresholdPct?: number
  maxListings?: number
  freshnessWindowSec?: number
  minFreshDepth?: number
  /** Skip the live trade call — the cheap path (aggregators only). */
  skipLive?: boolean
}

function aggRow(m: PriceMatch | null): AggRow | null {
  if (!m) return null
  return {
    source: m.source,
    category: m.category,
    chaosValue: m.chaosValue,
    divineValue: m.divineValue,
    listingCount: m.listingCount,
    lowConfidence: m.lowConfidence,
  }
}

function summariseItem(item: ParsedClipboardItem): ParsedItemSummary {
  return {
    rarity: item.rarity, name: item.name, baseType: item.baseType, itemClass: item.itemClass,
    itemLevel: item.itemLevel, quality: item.quality, links: item.links, corrupted: item.corrupted,
    unidentified: item.unidentified, influences: item.influences,
    explicitMods: item.explicitMods, implicitMods: item.implicitMods,
  }
}

/** Assemble the verdict from the gathered aggregator matches + live quote. */
function buildResult(p: {
  query: string
  league: string
  mWatch: PriceMatch | null
  mNinja: PriceMatch | null
  live: LiveQuote | null
  category: string
  isCurrency: boolean
  threshold: number
  windowSec: number
  minFreshDepth: number
  parsedItem?: ParsedItemSummary
}): AppraisalResult {
  const liveOk = !!p.live && p.live.count > 0 && p.live.low > 0
  const div = divergence(p.mWatch?.chaosValue ?? null, p.mNinja?.chaosValue ?? null, p.threshold)
  const aggChaos = [p.mWatch?.chaosValue, p.mNinja?.chaosValue].filter((n): n is number => typeof n === 'number' && n > 0)
  const consensusChaos = liveOk ? p.live!.median : aggChaos.length ? aggChaos.reduce((a, b) => a + b, 0) / aggChaos.length : 0
  const tier = valueTier(consensusChaos)
  const depth = p.isCurrency ? Math.max(p.mWatch?.listingCount ?? 0, p.mNinja?.listingCount ?? 0) : p.live?.count ?? 0
  const liquidity = liquidityRating(depth, tier)

  const marginVerdict = computeMargin({
    samples: p.live?.samples ?? [],
    aggregatorChaos: aggChaos,
    divergencePct: div.pct,
    freshnessWindowSec: p.windowSec,
    minFreshDepth: p.minFreshDepth,
  })

  return {
    query: p.query,
    league: p.league,
    category: p.category,
    parsedItem: p.parsedItem,
    aggregators: [aggRow(p.mWatch), aggRow(p.mNinja)].filter((r): r is AggRow => r !== null),
    divergence: { pct: div.pct, divergent: div.divergent, thresholdPct: p.threshold },
    live: p.live,
    liquidity: { ...liquidity, tier, depth },
    margin: { ...marginVerdict, freshnessWindowSec: p.windowSec, caveat: 'Indicative — verify in-game before any bulk trade.' },
  }
}

// ── Public entry points ──────────────────────────────────────────────────────

/** Appraise by NAME (currency/unique/etc.). Used by the MCP `appraise`/`watch` tools. */
export async function appraiseOne(query: string, league: string, opts: AppraiseOptions = {}): Promise<AppraisalResult> {
  const watch = PoeWatchService.getInstance()
  const ninja = PoeNinjaProvider.getInstance()
  const trade = TradeMarketService.getInstance()

  const threshold = opts.divergenceThresholdPct ?? DEFAULT_DIVERGENCE_PCT
  const cap = opts.maxListings ?? DEFAULT_MAX_LISTINGS
  const windowSec = opts.freshnessWindowSec ?? DEFAULT_FRESHNESS_WINDOW_SEC
  const minFreshDepth = opts.minFreshDepth ?? DEFAULT_MIN_FRESH_DEPTH

  const [mWatch, mNinja, divineChaos] = await Promise.all([
    bestMatch(watch, league, query),
    bestMatch(ninja, league, query),
    divineChaosOf(ninja, league),
  ])
  const primary = mWatch ?? mNinja
  const isCurrency = !!primary && (primary.category === 'Currency' || primary.category === 'Fragment')

  let live: LiveQuote | null = null
  if (!opts.skipLive) {
    if (isCurrency && primary) {
      live = await trade.currencyReference(league, primary.name)
    } else {
      const name = (primary?.name ?? query).replace(/\s*\(.*\)$/, '').trim()
      const c2c: Record<string, number> = { chaos: 1 }
      if (divineChaos > 0) c2c.divine = divineChaos
      live = await trade.itemReference(league, name, c2c, cap)
    }
  }

  return buildResult({
    query, league, mWatch, mNinja, live,
    category: primary?.category ?? 'unknown', isCurrency, threshold, windowSec, minFreshDepth,
  })
}

/**
 * Appraise a copied clipboard item. Rares/Magics use a MOD-AWARE trade search;
 * currency/uniques/gems use name/exchange. `skipLive` gives the cheap path
 * (aggregators only) for the on-clipboard-change update.
 */
export async function appraiseClipboard(itemText: string, league: string, opts: AppraiseOptions = {}): Promise<AppraisalResult> {
  const watch = PoeWatchService.getInstance()
  const ninja = PoeNinjaProvider.getInstance()
  const trade = TradeMarketService.getInstance()

  const threshold = opts.divergenceThresholdPct ?? DEFAULT_DIVERGENCE_PCT
  const cap = opts.maxListings ?? DEFAULT_MAX_LISTINGS
  const windowSec = opts.freshnessWindowSec ?? DEFAULT_FRESHNESS_WINDOW_SEC
  const minFreshDepth = opts.minFreshDepth ?? DEFAULT_MIN_FRESH_DEPTH

  const item = parseClipboardItemText(itemText)
  const name = item.name || item.baseType
  const isCurrency = item.rarity === 'Currency' || item.itemClass.includes('Fragment')

  const [mWatch, mNinja, divineChaos] = await Promise.all([
    bestMatch(watch, league, name),
    bestMatch(ninja, league, name),
    divineChaosOf(ninja, league),
  ])

  let live: LiveQuote | null = null
  if (!opts.skipLive) {
    const c2c: Record<string, number> = { chaos: 1 }
    if (divineChaos > 0) c2c.divine = divineChaos
    live = isCurrency
      ? await trade.currencyReference(league, name)
      : await trade.priceCheckItem(league, item, c2c, cap)
  }

  const category = mWatch?.category ?? mNinja?.category ?? `${item.rarity} ${item.itemClass}`.trim()
  return buildResult({
    query: name, league, mWatch, mNinja, live, category, isCurrency, threshold, windowSec, minFreshDepth,
    parsedItem: summariseItem(item),
  })
}
