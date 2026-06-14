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
  generation_weights?: SpawnWeight[]
  implicit_tags?: string[]
  adds_tags?: string[]
}

export interface RepoeBaseItem {
  name: string
  domain: string
  item_class: string
  tags: string[]
  release_state: string
  implicits?: string[]
}

export interface RepoeEssence {
  name: string
  item_level_restriction: number | null
  level: number
  /** item_class → forced mod id */
  mods: Record<string, string>
}

export interface RepoeFossil {
  name: string
  added_mods: string[]
  forced_mods: string[]
  positive_mod_weights: SpawnWeight[]
  negative_mod_weights: SpawnWeight[]
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
