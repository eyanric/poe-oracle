/**
 * services — the SINGLE SOURCE OF TRUTH for how each crafting method interacts with the
 * "Prefixes / Suffixes Cannot Be Changed" metamods (current 3.28). The solver + the method modules
 * read this; nobody hard-codes a second copy.
 *
 *  - RESPECT  — affects only the UNLOCKED side; the locked side is untouched ⇒ NO reproduction.
 *               Chaos, Veiled Chaos, Exalted (slam), Annulment, Divine, Alteration/Regal,
 *               HARVEST REFORGE, ORB OF SCOURING, bench/multimod, and all additive currencies.
 *  - IGNORE   — reforges/affects EVERYTHING incl. the locked side ⇒ reproduction applies.
 *               Awakener's Orb, Orb of Dominance (Maven's Orb), Orb of Unravelling.
 *  - BLOCKED  — the game refuses these on a Cannot-Be-Changed item ("can't use this currency on
 *               items with a modifier that affects modifier outcomes") ⇒ illegal moves, never
 *               generated. Essence, Fossil.
 *
 * Sources: poewiki *Metamod* (May 2026) — Chaos keeps existing prefixes under "Prefixes Cannot Be
 * Changed"; Maxroll *Crafting Resources* (Oct 2025) — "Harvest reforges respect Cannot Be Changed,
 * unlike Fossils and Essences." Corrects the earlier (wrong) "Harvest/fossil/scour ignore locks".
 */
export type LockInteraction = 'respect' | 'ignore' | 'blocked'

/** Method kind → metamod-lock interaction. Anything unlisted defaults to `respect` (the common case). */
export const LOCK_INTERACTION: Record<string, LockInteraction> = {
  // RESPECT
  'chaos-spam': 'respect', 'veiled-chaos': 'respect', 'alt-regal': 'respect',
  slam: 'respect', 'eldritch-annul': 'respect', harvest: 'respect', scour: 'respect',
  bench: 'respect', multimod: 'respect', 'add-influence': 'respect', 'eldritch-implicit': 'respect',
  'eldritch-exalt': 'respect', 'veiled-exalt': 'respect', anoint: 'respect', catalyst: 'respect',
  'strand-craft': 'respect', synthesise: 'respect', 'synthesis-reroll': 'respect', remembrance: 'respect',
  // IGNORE
  awakeners: 'ignore', 'orb-of-dominance': 'ignore', unravelling: 'ignore', recombine: 'ignore',
  // BLOCKED on a Cannot-Be-Changed item
  essence: 'blocked', fossil: 'blocked',
}

export const lockInteraction = (methodKind: string): LockInteraction => LOCK_INTERACTION[methodKind] ?? 'respect'
/** Does the method leave metamod-locked mods intact? (blocked methods don't wipe them either ⇒ true.) */
export const respectsLock = (methodKind: string): boolean => lockInteraction(methodKind) !== 'ignore'
/** Is the method illegal on an item carrying a Cannot-Be-Changed metamod (must not be generated)? */
export const blockedOnLockedItem = (methodKind: string): boolean => lockInteraction(methodKind) === 'blocked'
