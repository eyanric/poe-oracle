/**
 * data layer — RePoE loader.
 *
 * The maintained fork's PoE1 JSON exports (`repoe-fork.github.io`). We consume the
 * DATA exports, never the GPL code. Built on the data-layer `fetchJson` cache so
 * every dataset is fetched once per TTL. Services compose these; the data layer
 * never imports upward (tools → services → data).
 *
 * NOTE: legacy `brather1ng/RePoE` is intentionally NOT used (needs a custom PyPoE
 * fork to regenerate — a dead end). This fork is actively maintained per patch.
 */
import { fetchJson, type FetchJsonOptions } from './fetchJson'

export const REPOE_BASE = 'https://repoe-fork.github.io'

export interface SpawnWeight {
  tag: string
  weight: number
}

export interface RepoeMod {
  domain: string
  /** 'prefix' | 'suffix' | 'unique' | 'corrupted' | 'enchantment' | ... */
  generation_type: string
  name: string
  required_level: number
  groups: string[]
  type: string
  is_essence_only: boolean
  spawn_weights: SpawnWeight[]
  /** Per-tag PERCENT multiplier applied to the matched spawn weight (first match wins). */
  generation_weights?: SpawnWeight[]
  /** Tags the mod itself carries — incl. `attack`/`caster` (drives meta-mod blocks). */
  implicit_tags?: string[]
  /** Tags the mod ADDS to the item once present (e.g. `has_attack_mod`). */
  adds_tags?: string[]
  /** Human mod text with the roll range, e.g. "+(160-174) to maximum Life". */
  text?: string
}

export interface RepoeBaseItem {
  name: string
  domain: string
  item_class: string
  tags: string[]
  release_state: string
  implicits?: string[]
  drop_level?: number
}

export interface RepoeEssence {
  name: string
  item_level_restriction: number | null
  level: number
  /** item_class → forced mod id */
  mods: Record<string, string>
  type?: { tier: number; is_corruption_only: boolean }
}

export interface RepoeFossil {
  name: string
  added_mods: string[]
  forced_mods: string[]
  /** Tags whose mods are boosted — weight is a PERCENT multiplier (1000 = ×10). */
  positive_mod_weights: SpawnWeight[]
  /** Tags whose mods are suppressed — weight 0 = cannot roll that tag. */
  negative_mod_weights: SpawnWeight[]
  /** When non-empty, ONLY mods carrying one of these tags can roll. */
  allowed_tags?: string[]
  /** Mods carrying any of these tags cannot roll. */
  forbidden_tags?: string[]
}

export interface RepoeItemClass {
  name: string
  category?: string
  influence_tags?: string[]
}

/** A crafting-bench option — `actions.add_explicit_mod` is the crafted mod id it applies. */
export interface RepoeBenchOption {
  master?: string
  bench_tier?: number
  item_classes: string[]
  actions: { add_explicit_mod?: string; [k: string]: unknown }
  /** Currency metadata path → amount (e.g. `Metadata/Items/Currency/CurrencyModValues`: 2). */
  cost?: Record<string, number>
}

const fileUrl = (name: string): string => `${REPOE_BASE}/${name}.min.json`

export const getMods = (o?: FetchJsonOptions): Promise<Record<string, RepoeMod>> =>
  fetchJson(fileUrl('mods'), o)
export const getBaseItems = (o?: FetchJsonOptions): Promise<Record<string, RepoeBaseItem>> =>
  fetchJson(fileUrl('base_items'), o)
export const getEssences = (o?: FetchJsonOptions): Promise<Record<string, RepoeEssence>> =>
  fetchJson(fileUrl('essences'), o)
export const getFossils = (o?: FetchJsonOptions): Promise<Record<string, RepoeFossil>> =>
  fetchJson(fileUrl('fossils'), o)
export const getItemClasses = (o?: FetchJsonOptions): Promise<Record<string, RepoeItemClass>> =>
  fetchJson(fileUrl('item_classes'), o)
export const getBenchOptions = (o?: FetchJsonOptions): Promise<RepoeBenchOption[]> =>
  fetchJson(fileUrl('crafting_bench_options'), o)

/**
 * Fossils export is keyed by metadata path (445 entries) but most are empty
 * placeholders; only ~25 are real player fossils. Collapse to one entry per
 * distinct fossil NAME, preferring the record that actually carries effects.
 */
export function dedupeFossilsByName(
  fossils: Record<string, RepoeFossil>,
): Map<string, RepoeFossil> {
  const hasEffect = (f: RepoeFossil): boolean =>
    (f.added_mods?.length ?? 0) > 0 ||
    (f.forced_mods?.length ?? 0) > 0 ||
    (f.positive_mod_weights?.length ?? 0) > 0 ||
    (f.negative_mod_weights?.length ?? 0) > 0 ||
    (f.allowed_tags?.length ?? 0) > 0 ||
    (f.forbidden_tags?.length ?? 0) > 0
  const out = new Map<string, RepoeFossil>()
  for (const f of Object.values(fossils)) {
    if (!f?.name) continue
    const existing = out.get(f.name)
    if (!existing || (!hasEffect(existing) && hasEffect(f))) out.set(f.name, f)
  }
  return out
}

export interface RepoeFreshness {
  ok: boolean
  /** Parsed `Last-Modified` of the exports (GitHub Pages doesn't publish a version file). */
  lastModified: Date | null
  raw: string | null
}

/** HEAD the mods export to read its `Last-Modified` (freshness — see docs/repoe-validation.md). */
export async function getRepoeFreshness(fetchImpl: typeof fetch = fetch): Promise<RepoeFreshness> {
  const res = await fetchImpl(fileUrl('mods'), { method: 'HEAD' })
  const raw = res.headers.get('last-modified')
  const t = raw ? Date.parse(raw) : NaN
  return { ok: res.ok, lastModified: Number.isFinite(t) ? new Date(t) : null, raw }
}
