/**
 * services — modifier LEGALITY primitive (shared).
 *
 * `isNative(mod, baseTags, ilvl)`: can this modifier legally exist on a base? Derived
 * from DATA (not a hand list) — the base's tags must hit the mod's spawn-weights with
 * nonzero weight AND the base must meet the mod's required level. Because influence-
 * gated mods key their spawn-weights on influence tags, passing a base-tag set that
 * INCLUDES the chosen base's influence tags also covers influence legality.
 *
 * Reusable beyond recombinators: Awakener's Orb (output legality of merged influence),
 * Synthesis (fractured-fuse legality), and any "is this mod allowed here" check.
 */
import type { RepoeMod } from '../data/repoe'
import { effectiveWeight } from './craftingModel'

/**
 * True when `mod` can roll/exist on a base with `baseTags` at item level `ilvl`.
 * NON-native (the recombinator NNN case) = this returns false for the chosen final base
 * (attribute/tag mismatch, missing influence, or ilvl too low).
 */
export function isNative(mod: RepoeMod, baseTags: Set<string>, ilvl: number): boolean {
  if (mod.required_level > ilvl) return false
  return effectiveWeight(mod, baseTags) > 0
}
