/**
 * services — pseudo-mod normalization (Track A completion: rare pricing).
 *
 * Rares aren't fungible: comparables must match on what MATTERS (total life, total
 * elemental resistance, total attributes…) rather than on exact per-mod rolls. This
 * collapses an item's mods into the official trade "pseudo" stats, the same approach
 * Awakened PoE Trade uses.
 *
 * Pure + deterministic (unit-tested). The ruleset is a curated APT-style mapping —
 * RePoE has no native "pseudo" grouping, so the aggregation rules live here, by design.
 * Kept free of any craft-specific coupling so PoB upgrade-pathing can reuse it.
 */

/** A normalized pseudo total, ready to drop into a trade stat filter. */
export interface PseudoTotal {
  /** Official trade pseudo stat id, e.g. "pseudo.pseudo_total_life". */
  id: string
  label: string
  value: number
}

/** Importance weight — drives which pseudos the query-builder keeps (higher = more value-driving). */
export const PSEUDO_IMPORTANCE: Record<string, number> = {
  'pseudo.pseudo_total_life': 100,
  'pseudo.pseudo_total_energy_shield': 90,
  'pseudo.pseudo_total_resistance': 70,
  'pseudo.pseudo_total_elemental_resistance': 75,
  'pseudo.pseudo_total_fire_resistance': 55,
  'pseudo.pseudo_total_cold_resistance': 55,
  'pseudo.pseudo_total_lightning_resistance': 55,
  'pseudo.pseudo_total_chaos_resistance': 50,
  'pseudo.pseudo_total_all_attributes': 45,
  'pseudo.pseudo_total_strength': 40,
  'pseudo.pseudo_total_dexterity': 40,
  'pseudo.pseudo_total_intelligence': 40,
  'pseudo.pseudo_total_mana': 35,
}

const num = (s: string): number => {
  const m = s.match(/[+-]?\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}

interface Accum {
  life: number; es: number; mana: number
  fire: number; cold: number; lightning: number; chaos: number
  str: number; dex: number; int: number
}

/**
 * Accumulate a single mod line into the running totals. Returns true if it matched
 * any pseudo rule (so callers can flag mods that fell through, i.e. weren't priced on).
 */
function accumulate(acc: Accum, mod: string): boolean {
  const t = mod.toLowerCase()
  let matched = false
  const add = (v: keyof Accum, n: number) => { acc[v] += n; matched = true }

  if (/to maximum life\b/.test(t)) add('life', num(t))
  if (/to maximum energy shield\b/.test(t) && !/increased/.test(t)) add('es', num(t))
  if (/to maximum mana\b/.test(t) && !/increased/.test(t)) add('mana', num(t))

  // Resistances — singles, duals, and "all elemental".
  if (/to all elemental resistances\b/.test(t)) { const n = num(t); add('fire', n); add('cold', n); add('lightning', n) }
  else {
    const dual = t.match(/to (fire|cold|lightning) and (fire|cold|lightning) resistances\b/)
    if (dual) { const n = num(t); add(dual[1] as keyof Accum, n); add(dual[2] as keyof Accum, n) }
    else {
      if (/to fire resistance\b/.test(t)) add('fire', num(t))
      if (/to cold resistance\b/.test(t)) add('cold', num(t))
      if (/to lightning resistance\b/.test(t)) add('lightning', num(t))
    }
  }
  if (/to chaos resistance\b/.test(t)) add('chaos', num(t))

  // Attributes — singles + "to all attributes".
  if (/to all attributes\b/.test(t)) { const n = num(t); add('str', n); add('dex', n); add('int', n) }
  else {
    if (/to strength\b/.test(t)) add('str', num(t))
    if (/to dexterity\b/.test(t)) add('dex', num(t))
    if (/to intelligence\b/.test(t)) add('int', num(t))
  }

  return matched
}

/** Compute pseudo totals from a list of mod texts (explicit/implicit/fractured/crafted). */
export function computePseudoTotals(mods: string[]): { totals: PseudoTotal[]; unmatched: string[] } {
  const acc: Accum = { life: 0, es: 0, mana: 0, fire: 0, cold: 0, lightning: 0, chaos: 0, str: 0, dex: 0, int: 0 }
  const unmatched: string[] = []
  for (const m of mods) {
    if (!m.trim()) continue
    if (!accumulate(acc, m)) unmatched.push(m)
  }

  const totals: PseudoTotal[] = []
  const push = (id: string, label: string, value: number) => { if (value > 0) totals.push({ id, label, value }) }
  const ele = acc.fire + acc.cold + acc.lightning
  const allRes = ele + acc.chaos
  const attrs = acc.str + acc.dex + acc.int

  push('pseudo.pseudo_total_life', '+# total maximum Life', acc.life)
  push('pseudo.pseudo_total_energy_shield', '+# total maximum Energy Shield', acc.es)
  push('pseudo.pseudo_total_mana', '+# total maximum Mana', acc.mana)
  push('pseudo.pseudo_total_elemental_resistance', '+#% total Elemental Resistance', ele)
  push('pseudo.pseudo_total_resistance', '+#% total Resistance', allRes)
  push('pseudo.pseudo_total_fire_resistance', '+#% total Fire Resistance', acc.fire)
  push('pseudo.pseudo_total_cold_resistance', '+#% total Cold Resistance', acc.cold)
  push('pseudo.pseudo_total_lightning_resistance', '+#% total Lightning Resistance', acc.lightning)
  push('pseudo.pseudo_total_chaos_resistance', '+#% total Chaos Resistance', acc.chaos)
  push('pseudo.pseudo_total_all_attributes', '+# total to all Attributes', attrs)
  push('pseudo.pseudo_total_strength', '+# total Strength', acc.str)
  push('pseudo.pseudo_total_dexterity', '+# total Dexterity', acc.dex)
  push('pseudo.pseudo_total_intelligence', '+# total Intelligence', acc.int)

  return { totals, unmatched }
}
