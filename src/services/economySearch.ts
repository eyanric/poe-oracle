/**
 * economySearch — pure, dependency-free search over an EconomySnapshot.
 *
 * Lives in services (no zod / no MCP) so it can be shared by both the MCP tools
 * and the VAAL Electron app via the core barrel.
 */
import { isLowConfidence, type EconomySnapshot, type CurrencyPrice } from './economyTypes'

export interface PriceMatch {
  name: string
  /** Item base type (for trade search); undefined for currency. */
  baseType?: string
  category: string
  chaosValue: number
  /** Value expressed in Divine Orbs, when a Divine price is known. */
  divineValue: number | null
  listingCount: number
  lowConfidence: boolean
  source?: string
  /** Match quality (3=exact, 2=prefix, 1=substring). Internal ranking aid. */
  score: number
}

function matchScore(query: string, name: string): number {
  const q = query.toLowerCase()
  const n = name.toLowerCase()
  if (n === q) return 3
  if (n.startsWith(q)) return 2
  if (n.includes(q)) return 1
  return 0
}

/**
 * Chaos-per-Divine, resolved per source so each provider's rows divide by that
 * provider's own Divine Orb (matters in "both" mode); falls back to any Divine.
 */
function divineChaosBySource(snapshot: EconomySnapshot): (source?: string) => number | null {
  const bySource = new Map<string | undefined, number>()
  let fallback: number | null = null
  for (const c of snapshot.currency) {
    if (c.currencyTypeName === 'Divine Orb' && c.chaosEquivalent > 0) {
      bySource.set(c.source, c.chaosEquivalent)
      if (fallback === null) fallback = c.chaosEquivalent
    }
  }
  return source => bySource.get(source) ?? fallback
}

function currencyMatches(
  list: CurrencyPrice[],
  category: string,
  query: string,
  divineChaos: (source?: string) => number | null,
): PriceMatch[] {
  const out: PriceMatch[] = []
  for (const c of list) {
    const score = matchScore(query, c.currencyTypeName)
    if (score === 0) continue
    const dc = divineChaos(c.source)
    out.push({
      name: c.currencyTypeName,
      category,
      chaosValue: c.chaosEquivalent,
      divineValue: dc ? c.chaosEquivalent / dc : null,
      listingCount: c.receive?.listing_count ?? c.pay?.listing_count ?? 0,
      lowConfidence: isLowConfidence(c),
      source: c.source,
      score,
    })
  }
  return out
}

function itemMatches(
  list: EconomySnapshot['essences'],
  category: string,
  query: string,
): PriceMatch[] {
  const out: PriceMatch[] = []
  for (const i of list) {
    const label = i.name || i.baseType
    const score = matchScore(query, label)
    if (score === 0) continue
    out.push({
      name: i.variant ? `${label} (${i.variant})` : label,
      baseType: i.baseType,
      category,
      chaosValue: i.chaosValue,
      divineValue: i.divineValue ?? null,
      listingCount: i.listingCount,
      lowConfidence: isLowConfidence(i),
      source: i.source,
      score,
    })
  }
  return out
}

/**
 * Search a snapshot for a name across currency + item categories.
 * Pure + deterministic so it can be unit-tested with a mock snapshot.
 */
export function searchEconomy(
  snapshot: EconomySnapshot,
  query: string,
  category?: string,
  limit = 12,
): PriceMatch[] {
  const divineChaos = divineChaosBySource(snapshot)
  const cat = category?.toLowerCase().trim()
  const results: PriceMatch[] = []

  if (!cat || cat === 'currency') results.push(...currencyMatches(snapshot.currency, 'Currency', query, divineChaos))
  if (!cat || cat === 'fragment' || cat === 'fragments')
    results.push(...currencyMatches(snapshot.fragments, 'Fragment', query, divineChaos))
  if (!cat || cat === 'essence' || cat === 'essences')
    results.push(...itemMatches(snapshot.essences, 'Essence', query))
  if (!cat || cat === 'divcard' || cat === 'card' || cat === 'divinationcard')
    results.push(...itemMatches(snapshot.divCards, 'Divination Card', query))
  if (!cat || cat === 'unique') {
    results.push(...itemMatches(snapshot.uniqueWeapons, 'Unique Weapon', query))
    results.push(...itemMatches(snapshot.uniqueArmours, 'Unique Armour', query))
    results.push(...itemMatches(snapshot.uniqueAccessories, 'Unique Accessory', query))
    results.push(...itemMatches(snapshot.uniqueFlasks, 'Unique Flask', query))
    results.push(...itemMatches(snapshot.uniqueJewels, 'Unique Jewel', query))
  }
  if (!cat || cat === 'gem' || cat === 'skillgem')
    results.push(...itemMatches(snapshot.skillGems, 'Skill Gem', query))
  if (!cat || cat === 'map' || cat === 'maps')
    results.push(...itemMatches(snapshot.maps, 'Map', query))
  if (!cat || cat === 'scarab' || cat === 'scarabs')
    results.push(...itemMatches(snapshot.scarabs, 'Scarab', query))

  // Confident matches first, then by match quality, then by price.
  results.sort(
    (a, b) =>
      Number(a.lowConfidence) - Number(b.lowConfidence) ||
      b.score - a.score ||
      b.chaosValue - a.chaosValue,
  )
  return results.slice(0, limit)
}
