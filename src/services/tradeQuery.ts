/**
 * tradeQuery — pure construction of official Trade-API search queries from a
 * parsed clipboard item (mod-aware for rares/magics). Ported from VAAL's
 * TradeApiService query builder (KEEP: query building, not automation).
 */
import type { ParsedClipboardItem } from './ItemParser'

export interface TradeStatEntry {
  id: string
  text: string
  /** 'explicit' | 'implicit' | 'pseudo' | 'enchant' | 'crafted' | 'fractured' | … */
  type: string
}
export type StatIndex = Map<string, TradeStatEntry>

export interface TradeQuery {
  query: Record<string, unknown>
  sort: Record<string, string>
}

/** Normalise mod text for stat-id lookup (numbers → #). */
function normalizeMod(text: string): string {
  return text.toLowerCase().replace(/[+-]?\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim()
}

/** Build a lookup keyed by `${type}|${normalizedText}` from /api/trade/data/stats. */
export function indexStats(data: { result?: Array<{ entries?: TradeStatEntry[] }> }): StatIndex {
  const idx: StatIndex = new Map()
  for (const cat of data.result ?? []) {
    for (const e of cat.entries ?? []) {
      idx.set(`${e.type}|${normalizeMod(e.text)}`, e)
    }
  }
  return idx
}

export function findStatId(modText: string, type: string, idx: StatIndex): TradeStatEntry | null {
  return idx.get(`${type}|${normalizeMod(modText)}`) ?? null
}

function itemClassToTradeCategory(itemClass: string): string | null {
  const map: Record<string, string> = {
    Amulets: 'accessory.amulet', Amulet: 'accessory.amulet',
    Rings: 'accessory.ring', Ring: 'accessory.ring',
    Belts: 'accessory.belt', Belt: 'accessory.belt',
    'Body Armours': 'armour.chest', 'Body Armour': 'armour.chest',
    Helmets: 'armour.helmet', Helmet: 'armour.helmet',
    Gloves: 'armour.gloves', Boots: 'armour.boots',
    Shields: 'armour.shield', Shield: 'armour.shield',
    Quivers: 'armour.quiver', Quiver: 'armour.quiver',
    Bows: 'weapon.bow', Bow: 'weapon.bow',
    Claws: 'weapon.claw', Claw: 'weapon.claw',
    Daggers: 'weapon.dagger', Dagger: 'weapon.dagger',
    'One Hand Swords': 'weapon.onesword', 'One Hand Axes': 'weapon.oneaxe', 'One Hand Maces': 'weapon.onemace',
    Sceptres: 'weapon.sceptre', Sceptre: 'weapon.sceptre',
    Staves: 'weapon.staff', Staff: 'weapon.staff',
    'Two Hand Swords': 'weapon.twosword', 'Two Hand Axes': 'weapon.twoaxe', 'Two Hand Maces': 'weapon.twomace',
    Wands: 'weapon.wand', Wand: 'weapon.wand',
    'Thrusting One Hand Swords': 'weapon.onesword',
    Jewels: 'jewel', Jewel: 'jewel', 'Abyss Jewels': 'jewel.abyss', 'Cluster Jewels': 'jewel.cluster',
    Flasks: 'flask', Flask: 'flask',
  }
  return map[itemClass] ?? null
}

interface Filters {
  type_filters?: { filters: Record<string, { option?: string; min?: number; max?: number }> }
  misc_filters?: { filters: Record<string, { option?: string; min?: number; max?: number }> }
  socket_filters?: { filters: { links?: { min?: number } } }
  map_filters?: { filters: { map_tier?: { min?: number; max?: number } } }
}
interface StatFilter { id: string; value?: { min?: number; max?: number } }

/**
 * Build a trade query for an item. Rares/Magics → base type + a "count" stat
 * filter over their explicit mods (≥60% must match). Uniques/gems/currency/maps
 * → name/type. Returns null if there's nothing searchable.
 */
export function buildTradeQuery(item: ParsedClipboardItem, idx: StatIndex): TradeQuery | null {
  const query: Record<string, unknown> = { status: { option: 'online' } }
  const filters: Filters = {}

  if (item.rarity === 'Unique') {
    query.name = item.name
    query.type = item.baseType
    if (item.links >= 5) filters.socket_filters = { filters: { links: { min: item.links } } }
    if (item.corrupted) filters.misc_filters = { filters: { corrupted: { option: 'true' } } }
  } else if (item.rarity === 'Gem') {
    query.type = item.name
    filters.misc_filters = {
      filters: {
        gem_level: { min: item.gemLevel || 1 },
        ...(item.quality > 0 ? { quality: { min: item.quality } } : {}),
        corrupted: { option: item.corrupted ? 'true' : 'false' },
      },
    }
  } else if (item.rarity === 'Currency' || item.rarity === 'Divination Card') {
    query.type = item.name
  } else if (item.itemClass.includes('Map') && item.mapTier > 0) {
    query.type = item.baseType || item.name
    filters.map_filters = { filters: { map_tier: { min: item.mapTier, max: item.mapTier } } }
  } else if (item.rarity === 'Rare' || item.rarity === 'Magic') {
    query.type = item.baseType
    const category = item.baseType.includes('Cluster Jewel') ? 'jewel.cluster' : itemClassToTradeCategory(item.itemClass)
    if (category) filters.type_filters = { filters: { category: { option: category } } }
    if (item.itemLevel >= 82) {
      filters.misc_filters = { filters: { ilvl: { min: item.itemLevel - 2 } } }
    }
    if (item.links >= 5) filters.socket_filters = { filters: { links: { min: item.links } } }
    for (const inf of item.influences) {
      filters.misc_filters ??= { filters: {} }
      filters.misc_filters.filters[`${inf.toLowerCase()}_item`] = { option: 'true' }
    }
    const statFilters: StatFilter[] = []
    for (const mod of item.explicitMods.slice(0, 6)) {
      const stat = findStatId(mod, 'explicit', idx)
      if (!stat) continue
      const nums = mod.match(/[+-]?\d+(\.\d+)?/g)
      if (nums && nums.length > 0) {
        const v = parseFloat(nums[0])
        const margin = Math.max(Math.abs(v * 0.15), 5)
        statFilters.push({ id: stat.id, value: { min: Math.round(v - margin) } })
      } else {
        statFilters.push({ id: stat.id })
      }
    }
    if (statFilters.length > 0) {
      const minMatches = Math.max(2, Math.ceil(statFilters.length * 0.6))
      query.stats = [{ type: 'count', filters: statFilters, value: { min: minMatches } }]
    } else if (!category) {
      return null // nothing to search on (rare with no recognised mods or category)
    }
  } else {
    query.type = item.baseType || item.name
  }

  query.filters = filters
  return { query, sort: { price: 'asc' } }
}
