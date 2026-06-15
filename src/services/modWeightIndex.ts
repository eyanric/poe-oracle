/**
 * services — per-base resolved spawn-weight INDEX (the "full weighted mod list").
 *
 * The precision the tool exists for: cost specific named mods at specific tiers on a
 * specific base using their REAL spawn weights. The weights are already in repoe-fork
 * `mods.json` — this DERIVES a cached, base-keyed index from that export (tag-priority
 * resolution via `effectiveWeight`); it is not a scrape or a re-derivation of weights.
 *
 * `P(roll specific mod) = resolvedWeight(mod, base) / Σ resolvedWeight(eligible same-affix
 * mods)`. Pool sums are hot, so the per-base index is cached. Base spawn weights only —
 * fossil/essence/influence deltas are layered by their own methods (note, not rebuilt here).
 */
import type { RepoeMod, RepoeBaseItem } from '../data/repoe'
import { effectiveWeight, type Slot } from './craftingModel'

export interface ModWeightEntry {
  modId: string
  name: string
  text?: string
  group: string
  affix: Slot
  /** Resolved spawn weight on THIS base (tag-priority; 0s are excluded). */
  weight: number
  /** required_level (ilvl the tier needs). */
  ilvl: number
  /** Tier within the group, 1 = highest required_level (best). Derived. */
  tier: number
  domain: string
  generationType: string
}

export interface BaseModIndex {
  base: string
  itemClass: string
  ilvl: number
  prefixes: ModWeightEntry[]
  suffixes: ModWeightEntry[]
  prefixTotal: number
  suffixTotal: number
}

/** Assign dense tier ranks within each group (1 = highest required_level). */
function assignTiers(entries: ModWeightEntry[]): void {
  const byGroup = new Map<string, ModWeightEntry[]>()
  for (const e of entries) (byGroup.get(e.group) ?? byGroup.set(e.group, []).get(e.group)!).push(e)
  for (const group of byGroup.values()) {
    const levels = [...new Set(group.map(e => e.ilvl))].sort((a, b) => b - a)
    for (const e of group) e.tier = levels.indexOf(e.ilvl) + 1
  }
}

/**
 * Build the complete eligible weighted mod list for a base at `ilvl`. Excludes
 * essence-only mods (they can't roll from base currency) and any mod whose resolved
 * weight is 0 on this base. Derived from `mods.json` — authoritative, current 3.28.
 */
export function buildBaseModIndex(baseName: string, itemClass: string, baseTags: Set<string>, ilvl: number, mods: Record<string, RepoeMod>): BaseModIndex {
  const prefixes: ModWeightEntry[] = []
  const suffixes: ModWeightEntry[] = []
  for (const modId in mods) {
    const m = mods[modId]
    if (m.domain !== 'item' || (m.generation_type !== 'prefix' && m.generation_type !== 'suffix')) continue
    if (m.is_essence_only || m.required_level > ilvl) continue
    const weight = effectiveWeight(m, baseTags)
    if (weight <= 0) continue
    const entry: ModWeightEntry = {
      modId, name: m.name, text: m.text, group: m.groups?.[0] ?? modId, affix: m.generation_type as Slot,
      weight, ilvl: m.required_level, tier: 0, domain: m.domain, generationType: m.generation_type,
    }
    ;(m.generation_type === 'prefix' ? prefixes : suffixes).push(entry)
  }
  assignTiers(prefixes)
  assignTiers(suffixes)
  return {
    base: baseName, itemClass, ilvl, prefixes, suffixes,
    prefixTotal: prefixes.reduce((s, e) => s + e.weight, 0),
    suffixTotal: suffixes.reduce((s, e) => s + e.weight, 0),
  }
}

const cache = new Map<string, BaseModIndex>()
/** Test/maintenance helper. */
export function clearModWeightIndexCache(): void { cache.clear() }

/** Cached per-(base, ilvl) index. */
export function resolveBaseModIndex(base: RepoeBaseItem, mods: Record<string, RepoeMod>, ilvl: number): BaseModIndex {
  const key = `${base.name}|${ilvl}`
  const hit = cache.get(key)
  if (hit) return hit
  const idx = buildBaseModIndex(base.name, base.item_class, new Set(base.tags), ilvl, mods)
  cache.set(key, idx)
  return idx
}

export interface ModTarget {
  affix: Slot
  /** A specific mod id (a named mod at a specific tier). */
  modId?: string
  /** A mod group (the named mod family, any tier). */
  group?: string
  /** Tier floor (1 = best). Present ⇒ "group at tier ≤ minTier"; the modId only identifies the group. */
  minTier?: number
}

/** Is a target specific enough to cost? (named by modId or group — not "any prefix".) */
export const isSpecificTarget = (t: { modId?: string; group?: string }): boolean => !!(t.modId || t.group)

/**
 * P(rolling the target mod) on this base = resolvedWeight(target) / same-affix pool total. `modId` →
 * that exact tier; `group` → the family (sum of its tiers); `minTier` → the group's qualifying tiers
 * (tier ≤ floor), i.e. P(tier-or-better). Returns 0 for an abstract target (caller rejects those).
 */
export function modRollProbability(index: BaseModIndex, target: ModTarget): number {
  const pool = target.affix === 'prefix' ? index.prefixes : index.suffixes
  const total = target.affix === 'prefix' ? index.prefixTotal : index.suffixTotal
  if (total <= 0) return 0
  const group = target.group ?? (target.modId ? pool.find(e => e.modId === target.modId)?.group : undefined)
  let weight = 0
  if (target.minTier != null && group) weight = pool.filter(e => e.group === group && e.tier <= target.minTier!).reduce((s, e) => s + e.weight, 0)
  else if (target.modId) weight = pool.find(e => e.modId === target.modId)?.weight ?? 0
  else if (target.group) weight = pool.filter(e => e.group === target.group).reduce((s, e) => s + e.weight, 0)
  return weight / total
}
