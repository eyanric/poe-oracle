/**
 * services — crafting-bench + meta-mod model (bench/meta-crafting track).
 *
 * Normalizes RePoE's `crafting_bench_options` into deterministic bench crafts and the
 * meta-mods (multimod, prefixes/suffixes-cannot-be-changed, cannot-roll-attack/caster).
 *
 * ⚠ COST CONFIDENCE: the RePoE export's bench/meta costs read as PRE-3.28 (multimod &
 * "cannot be changed" = 2 Divine, "cannot roll" = 1 Divine, bench mods in alt/chaos/alch
 * amounts) — they do NOT reflect the 3.28 Mirage "bench costs standardized to ~4 Exalted"
 * rework. So every bench/meta cost is treated as LOW-CONFIDENCE and flagged. Structure
 * (which mod, slot, item-class, currency kind) is reliable; the AMOUNTS are stale.
 *
 * Pure over data; pricing happens in `craftCost`.
 */
import type { RepoeBenchOption, RepoeMod } from '../data/repoe'

/** Currency metadata path → economy name (for live pricing). */
export const BENCH_CURRENCY_NAMES: Record<string, string> = {
  CurrencyRerollMagic: 'Orb of Alteration',
  CurrencyUpgradeToMagic: 'Orb of Transmutation',
  CurrencyAddModToMagic: 'Orb of Augmentation',
  CurrencyUpgradeToRare: 'Orb of Alchemy',
  CurrencyRerollRare: 'Chaos Orb',
  CurrencyUpgradeMagicToRare: 'Regal Orb',
  CurrencyAddModToRare: 'Exalted Orb',
  CurrencyUpgradeRandomly: 'Orb of Chance',
  CurrencyModValues: 'Divine Orb',
  CurrencyCorrupt: 'Vaal Orb',
  CurrencyFlaskQuality: "Glassblower's Bauble",
  CurrencyArmourQuality: "Armourer's Scrap",
  CurrencyGemQuality: "Gemcutter's Prism",
}

export type MetaKind = 'multimod' | 'lockPrefixes' | 'lockSuffixes' | 'noAttack' | 'noCaster'

function metaKindOf(modId: string): MetaKind | null {
  if (/CanHaveMultipleCraftedMods/.test(modId)) return 'multimod'
  if (/CannotChangePrefixes/.test(modId)) return 'lockPrefixes'
  if (/CannotChangeSuffixes/.test(modId)) return 'lockSuffixes'
  if (/CannotRollAttack/.test(modId)) return 'noAttack'
  if (/CannotRollCaster/.test(modId)) return 'noCaster'
  return null
}

export interface BenchCraft {
  modId: string
  slot: 'prefix' | 'suffix'
  label: string
  itemClasses: string[]
  /** Cost currency name (economy) + amount. ⚠ amount is low-confidence (see file header). */
  costName: string
  costAmount: number
  tier?: number
  meta: MetaKind | null
}

export interface BenchData {
  crafts: BenchCraft[]
  /** Cheapest variant per meta kind. */
  meta: Partial<Record<MetaKind, BenchCraft>>
}

/** Normalize bench options → bench crafts + meta-mods, joining each to its RePoE mod. */
export function normalizeBench(options: RepoeBenchOption[], mods: Record<string, RepoeMod>): BenchData {
  const crafts: BenchCraft[] = []
  for (const o of options) {
    const modId = o.actions?.add_explicit_mod
    if (!modId) continue
    const mod = mods[modId]
    const [path, amount] = Object.entries(o.cost ?? {})[0] ?? []
    if (!path || amount == null) continue
    const costName = BENCH_CURRENCY_NAMES[path.split('/').pop() ?? ''] ?? path.split('/').pop() ?? path
    const meta = metaKindOf(modId)
    const slot: 'prefix' | 'suffix' =
      mod?.generation_type === 'prefix' ? 'prefix' : mod?.generation_type === 'suffix' ? 'suffix' : 'prefix'
    crafts.push({
      modId,
      slot,
      label: mod?.text || mod?.name || modId,
      itemClasses: o.item_classes ?? [],
      costName,
      costAmount: amount,
      tier: o.bench_tier,
      meta,
    })
  }

  const meta: BenchData['meta'] = {}
  for (const c of crafts) {
    if (!c.meta) continue
    const prev = meta[c.meta]
    if (!prev || c.costAmount < prev.costAmount) meta[c.meta] = c
  }
  return { crafts, meta }
}

/** Bench crafts applicable to an item class (excludes meta-mods). */
export function benchCraftsForClass(data: BenchData, itemClass: string): BenchCraft[] {
  return data.crafts.filter(c => !c.meta && c.itemClasses.includes(itemClass))
}

/**
 * Find a bench craft on an item class matching a free-text search term (against the
 * mod text / label) — returns the cheapest match. Bench mods are explicit picks, so
 * matching is by the stat words the caller asks for.
 */
export function findBenchCraft(data: BenchData, itemClass: string, term: string): BenchCraft | null {
  const t = term.toLowerCase()
  const matches = benchCraftsForClass(data, itemClass).filter(c => c.label.toLowerCase().includes(t))
  if (!matches.length) return null
  return matches.sort((a, b) => a.costAmount - b.costAmount)[0]
}
