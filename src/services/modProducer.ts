/**
 * services — mod → producing-methods INDEX (path solver, increment 3a).
 *
 * The reverse lookup each method module's pool/eligibility already implies, INVERTED: given a
 * SPECIFIC named desired mod on a base, which SPECIALIZED methods can produce it (with params)?
 * The spine/multi-step search already covers the core set (essence/chaos/slam/alt-regal/bench/
 * multimod + the NNN recipe); this adds the DATA-COMPLETE specialized producers — INFLUENCE,
 * ELDRITCH, VEILED — whose producibility is derivable from the tags/domains we already consume.
 *
 * Eligibility is MANDATORY, not advisory: a producer is proposed only when the mod is genuinely of
 * that class ON THAT BASE (membership in the class's resolved pool implies eligibility). A plain
 * explicit yields ZERO specialized candidates (no false positives). The `eldritch ⊥ influence`
 * exclusion is enforced at the plan level by `classifyMod` (the solver rejects a target mixing them).
 *
 * DEFERRED (seams, not built here): anoint (needs the notable→oil recipe table), synthesis (the
 * implicit pool is NOT in repoe-fork — unclassifiable, so a synthesis target gets no specialized
 * candidate ⇒ not guessed), catalyst (scales an existing mod's magnitude — a refinement, not a
 * producer), strand (a state-conditioning boost, not a producer). Clean-room; analysis-only.
 */
import type { RepoeBaseItem, RepoeMod } from '../data/repoe'
import type { MethodSpec } from './craftCost'
import type { Slot } from './itemState'
import { buildInfluenceIndex, INFLUENCES } from './influence'
import { buildEldritchIndex, ELDRITCH_BASE_TAGS } from './eldritch'
import { buildVeiledPool } from './veiled'
import { resolveBaseModIndex, modRollProbability } from './modWeightIndex'

/** Minimal target-mod shape (structurally compatible with the solver's SpecificMod). */
export interface ProducerMod { slot: Slot; group?: string; modId?: string }
export type ModClass = 'influence' | 'eldritch' | 'veiled' | 'core'
export interface Classification { classes: Set<ModClass>; specs: MethodSpec[] }

const matches = (e: { modId: string; group: string }, mod: ProducerMod): boolean =>
  mod.modId ? e.modId === mod.modId : mod.group ? e.group === mod.group : false

const cache = new Map<string, Classification>()
export function clearModProducerCache(): void { cache.clear() }

/**
 * Classify a desired mod into ALL specialized producing classes that apply on this base, with the
 * method specs that can produce it. A mod may have several routes (e.g. a +%Life group rollable by
 * more than one influence, or a mod that is both a veiled unveil AND a Conqueror influence mod) —
 * we return them ALL so the search ranks by cost. Cached per (base, ilvl, slot, mod). Eldritch is
 * disjoint from influence/veiled by data (separate generation_type), so they never co-classify a
 * single mod — that disjointness is what the plan-level `eldritch ⊥ influence` guard relies on.
 */
export function classifyMod(mod: ProducerMod, base: RepoeBaseItem, ilvl: number, mods: Record<string, RepoeMod>): Classification {
  const key = `${base.name}|${ilvl}|${mod.slot}|${mod.modId ?? mod.group ?? '?'}`
  const hit = cache.get(key)
  if (hit) return hit
  const tags = new Set(base.tags)
  const classes = new Set<ModClass>()
  const specs: MethodSpec[] = []

  // INFLUENCE — every influence whose {slot}_{codename}-gated pool contains the mod (all routes).
  for (const inf of INFLUENCES) {
    const idx = buildInfluenceIndex(tags, inf, ilvl, mods)
    if ([...idx.prefixes, ...idx.suffixes].some(e => e.affix === mod.slot && matches(e, mod))) {
      classes.add('influence'); specs.push({ kind: 'add-influence', influence: inf })
    }
  }
  // ELDRITCH — an eldritch-EXCLUSIVE implicit only: in the eldritch pool, NOT influence, and NOT a
  // plain explicit on the base (an eldritch implicit is a separate slot — if the group also rolls as
  // a normal affix, an explicit target means that affix, not the implicit). Side from slot.
  if (!classes.has('influence') && ELDRITCH_BASE_TAGS.some(t => base.tags.includes(t))) {
    const plain = modRollProbability(resolveBaseModIndex(base, mods, ilvl), { affix: mod.slot, group: mod.group, modId: mod.modId })
    if (plain <= 0) {
      const side = mod.slot === 'suffix' ? 'eater' : 'exarch'
      if (buildEldritchIndex(tags, side, mods).entries.some(e => matches(e, mod))) { classes.add('eldritch'); specs.push({ kind: 'eldritch-implicit' }) }
    }
  }
  // VEILED — a Betrayal unveil outcome (unveiled domain). Both orbs draw the same pool.
  if (buildVeiledPool(tags, mod.slot, ilvl, mods).entries.some(e => matches(e, mod))) {
    classes.add('veiled'); specs.push({ kind: 'veiled-chaos' }, { kind: 'veiled-exalt' })
  }
  if (!classes.size) classes.add('core')

  const result: Classification = { classes, specs }
  cache.set(key, result)
  return result
}

/** The specialized method specs that can produce a desired mod (empty for core/unclassifiable). */
export function modProducers(mod: ProducerMod, base: RepoeBaseItem, ilvl: number, mods: Record<string, RepoeMod>): MethodSpec[] {
  return classifyMod(mod, base, ilvl, mods).specs
}
