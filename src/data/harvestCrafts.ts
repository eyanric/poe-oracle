/**
 * data layer — Harvest craft set + lifeforce mechanics (CURRENT 3.28 iteration).
 *
 * ⚠ FRESHNESS — Harvest is the most version-volatile method. There is NO machine-readable
 * export (RePoE has no harvest file; poewiki/poedb 403 to automated fetch), so this is a
 * CURATED dataset transcribed from current 3.28 community sources (Maxroll Harvest crafting
 * guide + poe.ninja lifeforce categories), 2026-06-14. What it reflects:
 *   - Current iteration = spend coloured Lifeforce (Vivid/Primal/Wild + Sacred) on recipes
 *     at the Sacred Grove / Horticrafting station. The old "reforge keeping prefixes/suffixes"
 *     crafts are GONE; the forcing craft is now "add a [tag] mod and remove a random other".
 *   - Lifeforce colour → mod-tag mapping is from Maxroll's reforge table (authoritative).
 *   - Per-craft lifeforce AMOUNTS are the low-confidence part: only a subset were confirmed
 *     verbatim; the rest are representative and flagged `costConfidence: 'low'`. Lifeforce is
 *     live-priceable (poe.ninja trades each colour) — amounts × live price flow through economy.
 *
 * Consume DATA (game facts), not GPL code. Pure module (static tables).
 */

export type LifeforceColour = 'Vivid' | 'Primal' | 'Wild' | 'Sacred'
export type HarvestCraftKind = 'reforge' | 'augment' | 'remove'

/** Lifeforce item names as they appear in the economy (poe.ninja / poe.watch). */
export const LIFEFORCE_ITEM: Record<LifeforceColour, string> = {
  Vivid: 'Vivid Crystallised Lifeforce',
  Primal: 'Primal Crystallised Lifeforce',
  Wild: 'Wild Crystallised Lifeforce',
  Sacred: 'Sacred Crystallised Lifeforce',
}

/** Crystallised Rancour — Mirage-only lifeforce (drops from Corpse-Grown monsters in Harvest-in-Mirage). */
export const RANCOUR_ITEM = 'Crystallised Rancour'
export const MIRAGE_LEAGUE = 'Mirage'

/**
 * Mod-tag → lifeforce colour (Maxroll 3.28 reforge table — authoritative):
 *   Wild  → Fire, Attack, Life
 *   Vivid → Cold, Physical, Chaos, Speed
 *   Primal→ Lightning, Defence, Caster, Critical
 */
export const LIFEFORCE_BY_TAG: Record<string, LifeforceColour> = {
  fire: 'Wild', attack: 'Wild', life: 'Wild',
  cold: 'Vivid', physical: 'Vivid', chaos: 'Vivid', speed: 'Vivid',
  lightning: 'Primal', defence: 'Primal', caster: 'Primal', critical: 'Primal',
}

/** Harvest tag → the mod `implicit_tags` token used to match the mod pool (heuristic). */
export const HARVEST_TAG_TO_MODTAG: Record<string, string> = {
  fire: 'fire', cold: 'cold', lightning: 'lightning', chaos: 'chaos',
  physical: 'physical', life: 'life', attack: 'attack', caster: 'caster',
  defence: 'defences', critical: 'critical', speed: 'speed',
  // Crystallised Rancour (Mirage-only) reforge tags:
  minion: 'minion', attribute: 'attribute', mana: 'mana',
}

export interface HarvestCraft {
  kind: HarvestCraftKind
  tag: string
  colour: LifeforceColour
  amount: number
  /** Sacred Lifeforce also required (the high-end forcing crafts). */
  sacred?: number
  /** Crystallised Rancour also required (Mirage-only reforges: minion/attribute/mana). */
  rancour?: number
  /** Restricts the craft to a league (via league-availability gating). Omitted ⇒ core. */
  league?: string
  /** 'confirmed' = transcribed verbatim from a current source; 'low' = representative, verify. */
  costConfidence: 'confirmed' | 'low'
}

/**
 * Crystallised Rancour reforges (Mirage-only). Cost: N regular Lifeforce + M Rancour.
 * Sourced from a single community guide (u4n, 2026-06-14) — UNVERIFIED vs in-game ⇒ low-confidence.
 */
const RANCOUR_REFORGE: Record<string, { colour: LifeforceColour; amount: number; rancour: number }> = {
  minion: { colour: 'Primal', amount: 200, rancour: 3 },
  attribute: { colour: 'Vivid', amount: 200, rancour: 2 },
  mana: { colour: 'Primal', amount: 200, rancour: 2 },
}
export const RANCOUR_TAGS = Object.keys(RANCOUR_REFORGE)

const colourOf = (tag: string): LifeforceColour => LIFEFORCE_BY_TAG[tag] ?? 'Wild'

// Reforge-with-[tag]: reroll all mods, ≥1 guaranteed of [tag]. Cheap.
// Confirmed verbatim (Maxroll): fire/cold/lightning 50, chaos 100. Others representative.
const REFORGE_AMOUNT: Record<string, { amount: number; confidence: 'confirmed' | 'low' }> = {
  fire: { amount: 50, confidence: 'confirmed' }, cold: { amount: 50, confidence: 'confirmed' },
  lightning: { amount: 50, confidence: 'confirmed' }, chaos: { amount: 100, confidence: 'confirmed' },
}
// Add-a-[tag]-and-remove-a-random-other (the forcing/augment craft): N colour + 1 Sacred.
// Confirmed (Maxroll): Fire/Phys/Attack 15000; Life/Defence/Caster/Critical 17500; Speed 20000.
const AUGMENT_AMOUNT: Record<string, number> = {
  fire: 15000, physical: 15000, attack: 15000,
  life: 17500, defence: 17500, caster: 17500, critical: 17500,
  speed: 20000, cold: 15000, lightning: 15000, chaos: 15000,
}
const AUGMENT_CONFIRMED = new Set(['fire', 'physical', 'attack', 'life', 'defence', 'caster', 'critical', 'speed'])

export const HARVEST_TAGS = Object.keys(HARVEST_TAG_TO_MODTAG)

/** Look up the craft definition for (kind, tag), or null if the tag isn't Harvest-craftable. */
export function harvestCraft(kind: HarvestCraftKind, tag: string): HarvestCraft | null {
  const t = tag.toLowerCase()
  if (!(t in HARVEST_TAG_TO_MODTAG)) return null
  // Rancour reforges (Mirage-only): minion / attribute / mana — reforge only.
  if (t in RANCOUR_REFORGE) {
    if (kind !== 'reforge') return null
    const r = RANCOUR_REFORGE[t]
    return { kind, tag: t, colour: r.colour, amount: r.amount, rancour: r.rancour, league: MIRAGE_LEAGUE, costConfidence: 'low' }
  }
  const colour = colourOf(t)
  if (kind === 'reforge') {
    const r = REFORGE_AMOUNT[t] ?? { amount: 75, confidence: 'low' as const }
    return { kind, tag: t, colour, amount: r.amount, costConfidence: r.confidence }
  }
  if (kind === 'augment') {
    return { kind, tag: t, colour, amount: AUGMENT_AMOUNT[t] ?? 17500, sacred: 1, costConfidence: AUGMENT_CONFIRMED.has(t) ? 'confirmed' : 'low' }
  }
  // remove [tag] — amounts not confirmed from a current source; representative + flagged.
  return { kind, tag: t, colour, amount: 30, costConfidence: 'low' }
}

export const HARVEST_PROVENANCE =
  'Curated 2026-06-14 from Maxroll 3.28 Harvest guide + poe.ninja lifeforce categories. ' +
  'Colour→tag mapping confirmed; reforge fire/cold/lightning(50)/chaos(100) + augment ' +
  'Fire/Phys/Attack(15000)/Life/Defence/Caster/Critical(17500)/Speed(20000)+1 Sacred confirmed; ' +
  'other amounts representative (costConfidence:"low"). No "reforge keeping prefixes/suffixes" (removed). ' +
  'Crystallised Rancour (Mirage-only) reforges minion(200 Primal+3)/attribute(200 Vivid+2)/mana(200 Primal+2) ' +
  'from a single community source (u4n) — UNVERIFIED vs in-game, low-confidence.'
