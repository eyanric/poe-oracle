/**
 * services — clean-room spawn-weight & probability model (Track A, Phase 2).
 *
 * Pure functions over the RePoE DATA exports (loaded by `data/repoe`). No MCP,
 * no network, no GPL code. This is the layer Phase 1 left as a "minimal slice";
 * it now models the eight mechanics the EV math needs:
 *
 *   1. mod-group exclusivity        5. magic mod-count distribution
 *   2. prefix/suffix slot caps      6. meta-mods (cannot-roll / multimod / locks)
 *   3. ilvl gating                  7. essence forcing (deterministic)
 *   4. tag-based weighting          8. fossil dedupe + tag reweighting
 *
 * Every element is unit-tested in test/craftingModel.test.ts.
 */
import type { RepoeMod, RepoeFossil, SpawnWeight } from '../data/repoe'

export type Slot = 'prefix' | 'suffix'
export type Rarity = 'normal' | 'magic' | 'rare'

/** A mod that can roll on a specific base, with its effective weight on that base. */
export interface ModEntry {
  id: string
  mod: RepoeMod
  group: string
  slot: Slot
  /** Effective spawn weight on this base after tag + fossil reweighting. */
  weight: number
}

/** Affix caps by rarity (element 2). Normal items carry no explicit mods. */
export const SLOT_CAPS: Record<Rarity, Record<Slot, number>> = {
  normal: { prefix: 0, suffix: 0 },
  magic: { prefix: 1, suffix: 1 },
  rare: { prefix: 3, suffix: 3 },
}

/**
 * P(a freshly alteration/transmute'd MAGIC item has 2 affixes vs 1) (element 5).
 *
 * This is NOT in the RePoE export — it is a hardcoded game constant. The value
 * below is the community-modelled estimate; any EV that depends on it is flagged
 * `lowConfidence` so we never report false precision on alt-spam legs.
 */
export const MAGIC_TWO_AFFIX_PROB = 0.5

// ── Effective weight: tag-based weighting (element 4) ─────────────────────────

/** First weight whose tag is in `baseTags` (or the `default` fallback). */
function firstMatchingWeight(weights: SpawnWeight[] | undefined, baseTags: Set<string>): number | null {
  if (!weights) return null
  for (const w of weights) {
    if (w.tag === 'default' || baseTags.has(w.tag)) return w.weight
  }
  return null
}

/**
 * The mod's effective spawn weight on a base with `baseTags`: the first matching
 * `spawn_weights` entry, scaled by the first matching `generation_weights` PERCENT
 * multiplier (e.g. `attack_dagger:100` keeps it, `wand:50` halves it). Returns 0
 * when the mod cannot roll on the base.
 */
export function effectiveWeight(mod: RepoeMod, baseTags: Set<string>): number {
  const base = firstMatchingWeight(mod.spawn_weights, baseTags)
  if (!base || base <= 0) return 0
  const genPct = firstMatchingWeight(mod.generation_weights, baseTags)
  if (genPct == null) return base
  return Math.round((base * genPct) / 100)
}

// ── Meta-mod classification (element 6) ───────────────────────────────────────

const hasTag = (mod: RepoeMod, tag: string): boolean => (mod.implicit_tags ?? []).includes(tag)

export const isAttackMod = (mod: RepoeMod): boolean => hasTag(mod, 'attack')
export const isCasterMod = (mod: RepoeMod): boolean => hasTag(mod, 'caster')

/** Meta-craft constraints that reshape the rollable pool. */
export interface MetaMods {
  /** "Cannot roll Attack Modifiers" — drops every mod tagged `attack`. */
  blockAttack?: boolean
  /** "Cannot roll Caster Modifiers" — drops every mod tagged `caster`. */
  blockCaster?: boolean
  /** "Prefixes Cannot Be Changed" — the prefix slots are locked (no prefix rolls). */
  lockPrefixes?: boolean
  /** "Suffixes Cannot Be Changed" — the suffix slots are locked (no suffix rolls). */
  lockSuffixes?: boolean
}

// ── Fossil reweighting (element 8) ────────────────────────────────────────────

/**
 * Per-mod fossil effect: forbidden/allowed tag gating + a PERCENT weight
 * multiplier (1000 → ×10, 0 → cannot roll). Multiple fossils compound (product
 * of multipliers; AND of allow/forbid gates). Returns the multiplier, or `null`
 * if the fossil set forbids the mod entirely.
 */
export function fossilWeightMultiplier(mod: RepoeMod, fossils: RepoeFossil[]): number | null {
  let mult = 1
  for (const f of fossils) {
    if (f.forbidden_tags?.some(t => hasTag(mod, t))) return null
    if (f.allowed_tags?.length && !f.allowed_tags.some(t => hasTag(mod, t))) return null
    for (const w of f.negative_mod_weights ?? []) {
      if (hasTag(mod, w.tag)) mult *= w.weight / 100
    }
    for (const w of f.positive_mod_weights ?? []) {
      if (hasTag(mod, w.tag)) mult *= w.weight / 100
    }
  }
  return mult
}

// ── Pool construction ─────────────────────────────────────────────────────────

export interface PoolOptions {
  /** Groups already occupied on the item — element 1 removes their whole group. */
  usedGroups?: Set<string>
  /** Include `is_essence_only` mods (only true when an essence supplies them). */
  allowEssenceOnly?: boolean
  /** Meta-craft constraints (element 6). */
  meta?: MetaMods
  /** Fossils whose tag reweighting/gating applies (element 8). */
  fossils?: RepoeFossil[]
}

/**
 * Build the rollable pool for one slot on a specific base at a given ilvl,
 * applying every gating element: domain, slot, ilvl (3), essence-only exclusion,
 * tag weighting (4), group exclusivity (1), meta blocks (6) and fossils (8).
 */
export function buildSlotPool(
  mods: Record<string, RepoeMod>,
  baseTags: Set<string>,
  ilvl: number,
  slot: Slot,
  opts: PoolOptions = {},
): ModEntry[] {
  const { usedGroups, allowEssenceOnly, meta, fossils } = opts
  if (slot === 'prefix' && meta?.lockPrefixes) return []
  if (slot === 'suffix' && meta?.lockSuffixes) return []

  const out: ModEntry[] = []
  for (const id in mods) {
    const mod = mods[id]
    if (mod.domain !== 'item' || mod.generation_type !== slot) continue
    if (mod.is_essence_only && !allowEssenceOnly) continue
    if (mod.required_level > ilvl) continue
    if (meta?.blockAttack && isAttackMod(mod)) continue
    if (meta?.blockCaster && isCasterMod(mod)) continue

    const group = mod.groups?.[0] ?? id
    if (usedGroups && mod.groups?.some(g => usedGroups.has(g))) continue

    let weight = effectiveWeight(mod, baseTags)
    if (weight <= 0) continue
    if (fossils?.length) {
      const mult = fossilWeightMultiplier(mod, fossils)
      if (mult == null) continue
      weight = weight * mult
      if (weight <= 0) continue
    }
    out.push({ id, mod, group, slot, weight })
  }
  return out
}

// ── Probability primitives ────────────────────────────────────────────────────

export const totalWeight = (pool: ModEntry[]): number => pool.reduce((s, e) => s + e.weight, 0)

/**
 * P(the mod rolled into this slot is one matched by `match`), given that the slot
 * IS filled — i.e. share of slot weight. Used for both alt and per-draw rare odds.
 */
export function slotShare(pool: ModEntry[], match: (e: ModEntry) => boolean): number {
  const total = totalWeight(pool)
  if (total <= 0) return 0
  return pool.filter(match).reduce((s, e) => s + e.weight, 0) / total
}

export interface MagicOccupancy {
  /** P(prefix slot is filled on a fresh magic item). */
  pPrefix: number
  /** P(suffix slot is filled on a fresh magic item). */
  pSuffix: number
}

/**
 * Magic mod-count distribution (element 5). A magic item has 1 or 2 affixes; a
 * 2-affix item is always 1 prefix + 1 suffix (caps are 1/1), and a 1-affix item
 * lands in prefix-vs-suffix by relative pool weight. This is what fixes Phase 1's
 * "every alt yields a prefix" simplification — an alt can yield no prefix at all.
 */
export function magicOccupancy(
  prefixTotal: number,
  suffixTotal: number,
  pTwoAffix = MAGIC_TWO_AFFIX_PROB,
): MagicOccupancy {
  const denom = prefixTotal + suffixTotal
  if (denom <= 0) return { pPrefix: 0, pSuffix: 0 }
  const pPrefixIfOne = prefixTotal / denom
  return {
    pPrefix: pTwoAffix + (1 - pTwoAffix) * pPrefixIfOne,
    pSuffix: pTwoAffix + (1 - pTwoAffix) * (1 - pPrefixIfOne),
  }
}

/**
 * P(a specific target mod appears in `slots` independent rare affix slots), using
 * the standard 1-(1-share)^n approximation. Exact for n=1; for n>1 the
 * without-replacement / group-removal correction is small while the target weight
 * is a tiny fraction of pool weight (the usual case), so we approximate and flag.
 */
export function pPresentInSlots(share: number, slots: number): number {
  if (share <= 0 || slots <= 0) return 0
  return 1 - Math.pow(1 - share, slots)
}
