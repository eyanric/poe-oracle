/**
 * economyTypes — the canonical, source-agnostic economy shape.
 *
 * Every provider (poe.watch, poe.ninja) normalizes to these types so tools never
 * care where prices come from. `lowConfidence` and `source` are carried through
 * so the tool layer can demote thin prices and label which provider answered.
 */

export interface CurrencyPrice {
  currencyTypeName: string
  /** Value in Chaos Orbs. */
  chaosEquivalent: number
  /** How many chaos per 1 of this currency (pay direction). */
  pay?: { value: number; listing_count: number }
  /** How many of this currency per 1 chaos (receive direction). */
  receive?: { value: number; listing_count: number }
  /** True when the price is thin/uncertain (provider flag or low listing count). */
  lowConfidence?: boolean
  /** Provider that produced this row, e.g. "poe.watch" | "poe.ninja". */
  source?: string
}

export interface ItemPrice {
  name: string
  baseType: string
  chaosValue: number
  divineValue: number
  listingCount: number
  icon?: string
  links?: number
  variant?: string
  levelRequired?: number
  itemClass?: number
  lowConfidence?: boolean
  source?: string
}

export interface EconomySnapshot {
  league: string
  fetchedAt: number
  /** Provider(s) that produced this snapshot. */
  source?: string
  currency: CurrencyPrice[]
  fragments: CurrencyPrice[]
  essences: ItemPrice[]
  divCards: ItemPrice[]
  uniqueWeapons: ItemPrice[]
  uniqueArmours: ItemPrice[]
  uniqueAccessories: ItemPrice[]
  uniqueFlasks: ItemPrice[]
  uniqueJewels: ItemPrice[]
  skillGems: ItemPrice[]
  maps: ItemPrice[]
  scarabs: ItemPrice[]
}

/** Flat lookup: item name → chaos value. */
export type PriceMap = Map<string, number>

/** Default listing-count floor below which a price is treated as low-confidence. */
export const MIN_CONFIDENT_LISTINGS = 5

/** Is this entry thin/uncertain? Provider flag OR listing count under the floor. */
export function isLowConfidence(
  entry: { lowConfidence?: boolean; listingCount?: number; receive?: { listing_count: number } },
  minListings = MIN_CONFIDENT_LISTINGS,
): boolean {
  if (entry.lowConfidence) return true
  const listings = entry.listingCount ?? entry.receive?.listing_count ?? 0
  return listings < minListings
}
