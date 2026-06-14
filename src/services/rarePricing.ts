/**
 * services — rare-item pricing (Track A completion). REUSABLE: PoB upgrade-pathing
 * will call this directly, so it carries no craft-specific coupling.
 *
 * The honest problem: rares aren't fungible — there is no single price, only a
 * distribution of comparable listings. So this returns a CONFIDENCE-FLAGGED RANGE,
 * never a point price. Quality lives in which mods go into the query: too many → zero
 * comparables; too few → pricing against strictly-better items. That heuristic is the work.
 *
 * Rate-limits are a correctness requirement here (this fans out into trade queries):
 * identical queries are cached/deduped, the over-constrained widen is bounded to ONE
 * retry, and every request flows through TradeMarketService's single rate-limited path.
 */
import { computePseudoTotals, PSEUDO_IMPORTANCE, type PseudoTotal } from './pseudoMods'
import { itemClassToTradeCategory } from './tradeQuery'
import type { LiveQuote } from './TradeMarketService'
import { TradeMarketService } from './TradeMarketService'
import { getEconomyProvider } from './EconomyProvider'
import { resolveCurrentLeague } from './LeagueResolver'

export interface RareItemSpec {
  baseType: string
  itemClass: string
  itemLevel?: number
  influences?: string[]
  corrupted?: boolean
  /** Raw mod texts (clipboard) — normalized to pseudo internally. */
  mods?: string[]
  /** Pre-computed pseudo totals (e.g. a craft target) — used as-is if provided. */
  pseudoTotals?: PseudoTotal[]
}

export interface QueryBuildOptions {
  /** Max pseudo stat filters to include (too many → zero comparables). */
  maxStats?: number
  /** Query min = round(value × (1 − looseness)); higher looseness = broader comparables. */
  looseness?: number
  /** Per-pseudo floor below which a stat is treated as noise and dropped. */
  minInclude?: Record<string, number>
  /** Only constrain item level at/above this floor. */
  ilvlBracketFloor?: number
}

const DEFAULT_MIN_INCLUDE: Record<string, number> = {
  'pseudo.pseudo_total_life': 40,
  'pseudo.pseudo_total_energy_shield': 40,
  'pseudo.pseudo_total_elemental_resistance': 40,
  'pseudo.pseudo_total_resistance': 40,
  'pseudo.pseudo_total_fire_resistance': 25,
  'pseudo.pseudo_total_cold_resistance': 25,
  'pseudo.pseudo_total_lightning_resistance': 25,
  'pseudo.pseudo_total_chaos_resistance': 10,
  'pseudo.pseudo_total_all_attributes': 20,
  'pseudo.pseudo_total_strength': 20,
  'pseudo.pseudo_total_dexterity': 20,
  'pseudo.pseudo_total_intelligence': 20,
  'pseudo.pseudo_total_mana': 30,
}

interface BuiltQuery { query: Record<string, unknown>; sort: Record<string, string> }

/**
 * Collapse overlapping pseudos so we don't double-constrain: prefer the elemental-res
 * aggregate over the individual fire/cold/lightning, and prefer all-attributes over the
 * individual attribute stats. Returns the de-duplicated candidate set.
 */
function dedupePseudos(totals: PseudoTotal[]): PseudoTotal[] {
  const byId = new Map(totals.map(t => [t.id, t]))
  const drop = new Set<string>()
  if (byId.has('pseudo.pseudo_total_elemental_resistance')) {
    for (const id of ['pseudo.pseudo_total_fire_resistance', 'pseudo.pseudo_total_cold_resistance', 'pseudo.pseudo_total_lightning_resistance']) drop.add(id)
  }
  // total_resistance duplicates elemental unless chaos res is actually present.
  if (byId.has('pseudo.pseudo_total_resistance') && !byId.has('pseudo.pseudo_total_chaos_resistance')) {
    drop.add('pseudo.pseudo_total_resistance')
  }
  if (byId.has('pseudo.pseudo_total_all_attributes')) {
    for (const id of ['pseudo.pseudo_total_strength', 'pseudo.pseudo_total_dexterity', 'pseudo.pseudo_total_intelligence']) drop.add(id)
  }
  return totals.filter(t => !drop.has(t.id))
}

export interface BuiltComparableQuery {
  built: BuiltQuery
  /** The pseudo stats actually queried on (id + min). */
  queriedStats: Array<{ id: string; label: string; min: number }>
}

/**
 * Build a comparable-listing query: pick the value-driving pseudo subset (ranked by
 * importance, capped, noise dropped), each with a loosened minimum, plus base type,
 * ilvl bracket, influence and corruption filters. Returns null if there's nothing
 * specific enough to query on (avoids pricing against the entire base).
 */
export function buildComparableQuery(spec: RareItemSpec, opts: QueryBuildOptions = {}): BuiltComparableQuery | null {
  const maxStats = opts.maxStats ?? 4
  const looseness = opts.looseness ?? 0.15
  const minInclude = { ...DEFAULT_MIN_INCLUDE, ...opts.minInclude }
  const ilvlFloor = opts.ilvlBracketFloor ?? 82

  const totals = spec.pseudoTotals ?? computePseudoTotals(spec.mods ?? []).totals
  const candidates = dedupePseudos(totals)
    .filter(t => t.value >= (minInclude[t.id] ?? 0))
    .sort((a, b) => (PSEUDO_IMPORTANCE[b.id] ?? 0) - (PSEUDO_IMPORTANCE[a.id] ?? 0))
    .slice(0, maxStats)

  const queriedStats = candidates.map(t => ({ id: t.id, label: t.label, min: Math.max(1, Math.round(t.value * (1 - looseness))) }))

  const query: Record<string, unknown> = { status: { option: 'online' } }
  if (spec.baseType) query.type = spec.baseType

  const filters: Record<string, { filters: Record<string, unknown> }> = {}
  const category = itemClassToTradeCategory(spec.itemClass)
  if (category) filters.type_filters = { filters: { category: { option: category } } }
  const misc: Record<string, unknown> = {}
  if ((spec.itemLevel ?? 0) >= ilvlFloor) misc.ilvl = { min: spec.itemLevel! - 2 }
  for (const inf of spec.influences ?? []) misc[`${inf.toLowerCase()}_item`] = { option: 'true' }
  if (spec.corrupted) misc.corrupted = { option: 'true' }
  if (Object.keys(misc).length) filters.misc_filters = { filters: misc }
  if (Object.keys(filters).length) query.filters = filters

  if (queriedStats.length > 0) {
    query.stats = [{ type: 'and', filters: queriedStats.map(s => ({ id: s.id, value: { min: s.min } })) }]
  } else if (!query.type) {
    return null // nothing specific to search on
  }
  return { built: { query, sort: { price: 'asc' } }, queriedStats }
}

// ── Distribution → range ──────────────────────────────────────────────────────

const sortAsc = (xs: number[]) => [...xs].filter(x => x > 0).sort((a, b) => a - b)
function median(xs: number[]): number {
  const v = sortAsc(xs)
  if (!v.length) return 0
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
function percentile(xs: number[], p: number): number {
  const v = sortAsc(xs)
  if (!v.length) return 0
  const idx = Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))
  return v[idx]
}
/** Drop suspiciously-cheap bait (median − 3·MAD floor). */
function trimLowOutliers(xs: number[]): number[] {
  const v = sortAsc(xs)
  if (v.length <= 3) return v
  const med = median(v)
  const mad = median(v.map(x => Math.abs(x - med)))
  if (mad === 0) return v
  const lower = med - 3 * mad
  return v.filter(x => x >= lower)
}

export interface PriceRange {
  /** Low end of the comparable range (≈20th percentile after trimming bait). */
  low: number
  median: number
  /** Raw cheapest listing (often bait — shown, not used as the estimate). */
  cheapest: number
  count: number
  /** (median − low) / low, as a percent. */
  spreadPct: number
}

export function priceRangeFromSamples(prices: number[]): PriceRange | null {
  const raw = sortAsc(prices)
  if (!raw.length) return null
  const trimmed = trimLowOutliers(raw)
  const low = percentile(trimmed, 0.2)
  const med = median(trimmed)
  return {
    low,
    median: med,
    cheapest: raw[0],
    count: raw.length,
    spreadPct: low > 0 ? ((med - low) / low) * 100 : 0,
  }
}

export type RangeConfidence = 'low' | 'medium' | 'high'

/** Few results OR wide spread → low confidence. */
export function rangeConfidence(count: number, spreadPct: number): RangeConfidence {
  if (count < 3 || spreadPct > 150) return 'low'
  if (count < 8 || spreadPct > 60) return 'medium'
  return 'high'
}

// ── Estimate (orchestration) ──────────────────────────────────────────────────

export type SearchFn = (built: BuiltQuery, maxListings: number) => Promise<LiveQuote | null>

export interface RarePriceDeps {
  search: SearchFn
  divineChaos: number | null
  maxListings?: number
}

export type RarePriceEstimate = {
  priced: boolean
  reason?: string
  range: PriceRange | null
  /** Range expressed in divine, when the divine rate is known. */
  divine: { low: number; median: number } | null
  confidence: RangeConfidence
  queriedStats: Array<{ id: string; label: string; min: number }>
  /** Mods that matched no pseudo rule — i.e. value NOT captured in the query. */
  unpricedMods: string[]
  tradeUrl?: string
  marketDepth: number
  notes: string[]
}

function notPriced(reason: string, queriedStats: RarePriceEstimate['queriedStats'] = [], unpricedMods: string[] = []): RarePriceEstimate {
  return { priced: false, reason, range: null, divine: null, confidence: 'low', queriedStats, unpricedMods, marketDepth: 0, notes: [reason] }
}

export async function estimateRarePrice(spec: RareItemSpec, deps: RarePriceDeps, opts: QueryBuildOptions = {}): Promise<RarePriceEstimate> {
  const maxListings = deps.maxListings ?? 10
  const unpriced = spec.pseudoTotals ? [] : computePseudoTotals(spec.mods ?? []).unmatched
  const notes: string[] = []

  let build = buildComparableQuery(spec, opts)
  if (!build) return notPriced('nothing specific enough to query on (no value-driving mods or base)', [], unpriced)

  let quote = await deps.search(build.built, maxListings)
  if (!quote) return notPriced('trade search failed or was rate-limited — no estimate (try again shortly)', build.queriedStats, unpriced)

  // Over-constrained → widen ONCE (looser mins + one fewer stat), don't fabricate a number.
  if (quote.sampleSize === 0) {
    notes.push('initial query returned no comparables — widened (looser mins, fewer stats) and retried once.')
    const widened = buildComparableQuery(spec, { ...opts, maxStats: Math.max(1, (opts.maxStats ?? 4) - 1), looseness: Math.min(0.45, (opts.looseness ?? 0.15) + 0.15) })
    if (widened) {
      build = widened
      quote = (await deps.search(widened.built, maxListings)) ?? quote
    }
  }
  if (!quote || quote.sampleSize === 0) {
    const r = notPriced('no comparable listings even after widening — the mod set is too specific / thin market', build.queriedStats, unpriced)
    r.tradeUrl = quote?.tradeUrl
    r.marketDepth = quote?.count ?? 0
    return r
  }

  const range = priceRangeFromSamples(quote.samples.map(s => s.chaos))
  if (!range) return notPriced('listings returned but none priced in a known currency', build.queriedStats, unpriced)

  let confidence = rangeConfidence(quote.count || range.count, range.spreadPct)
  // Identity-only fallback (no pseudo stats matched) while the item HAS value mods we
  // couldn't capture: we'd be pricing the BASE, not a comparable. Never claim confidence.
  if (build.queriedStats.length === 0 && unpriced.length > 0) {
    confidence = 'low'
    notes.push('priced on base type/identity ONLY — no value-driving mods were captured, so this is a BASE price, NOT a comparable for the modded item.')
  }
  const divine = deps.divineChaos && deps.divineChaos > 0 ? { low: range.low / deps.divineChaos, median: range.median / deps.divineChaos } : null

  if (range.count < 3) notes.push(`only ${range.count} comparable listing(s) — treat as a rough floor, not a quote.`)
  if (range.spreadPct > 60) notes.push(`wide spread (${range.spreadPct.toFixed(0)}%) — the market disagrees; confidence capped.`)
  if (unpriced.length) notes.push(`${unpriced.length} mod(s) not captured by pseudo-pricing (${unpriced.slice(0, 4).join('; ')}${unpriced.length > 4 ? '…' : ''}) — true value may be higher.`)

  return {
    priced: true, range, divine, confidence,
    queriedStats: build.queriedStats, unpricedMods: unpriced,
    tradeUrl: quote.tradeUrl, marketDepth: quote.count || range.count, notes,
  }
}

// ── Live wrapper (cache + dedupe) ─────────────────────────────────────────────

interface CacheEntry { value: RarePriceEstimate; expiresAt: number }
const RARE_CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, CacheEntry>()

/** Clear the rare-price cache (tests/maintenance). */
export function clearRarePriceCache(): void { cache.clear() }

export async function estimateRarePriceLive(spec: RareItemSpec, league?: string, opts: QueryBuildOptions = {}): Promise<RarePriceEstimate & { league: string; stampDate: string }> {
  const resolved = league ?? (await resolveCurrentLeague())
  const stampDate = new Date().toISOString().slice(0, 10)

  const provider = getEconomyProvider()
  const currency = await provider.getCurrencyPrices(resolved)
  const divine = currency.find(c => c.currencyTypeName === 'Divine Orb')
  const divineChaos = divine && divine.chaosEquivalent > 0 ? divine.chaosEquivalent : null

  // Dedupe identical estimate requests within the TTL — the trade fan-out is the
  // expensive, rate-limited part, so don't repeat the same spec.
  const key = `${resolved}|${JSON.stringify(spec)}|${JSON.stringify(opts)}`
  const hit = cache.get(key)
  if (hit && Date.now() < hit.expiresAt) return { ...hit.value, league: resolved, stampDate }

  const trade = TradeMarketService.getInstance()
  const c2c: Record<string, number> = { chaos: 1 }
  if (divineChaos) c2c.divine = divineChaos
  const search: SearchFn = (built, maxListings) => trade.searchListings(resolved, built, c2c, maxListings)

  const estimate = await estimateRarePrice(spec, { search, divineChaos }, opts)
  if (estimate.priced) cache.set(key, { value: estimate, expiresAt: Date.now() + RARE_CACHE_TTL_MS })
  return { ...estimate, league: resolved, stampDate }
}
