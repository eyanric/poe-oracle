/**
 * services — canonical mid-craft ITEM STATE (method-interface foundation).
 *
 * The shared currency every crafting method transforms. Methods (today: the risk
 * engine; later: the path solver) read and produce this. If it can't represent a
 * mechanic, every method + the solver inherit the gap — so it models comprehensively:
 * affixes + slot caps/occupancy, mod groups present + BLOCKED groups
 * (block-to-raise-augment-odds), tags, active meta-mods, influence/fractured/quality/
 * catalyst, and DEPLETING per-item resources (3.28 memory strands: conditions the tier
 * distribution of applied crafts and is consumed per craft — modelled here as shape).
 *
 * Pure + immutable: state transforms return new states so a search can explore paths
 * side-effect-free.
 */

export type Slot = 'prefix' | 'suffix'
export type Rarity = 'normal' | 'magic' | 'rare'

export interface Affix {
  modId: string
  group: string
  slot: Slot
  tier?: number
  /** Representative roll value (for pseudo/threshold reasoning). */
  value?: number
  text?: string
  /** Crafted (bench) or fractured affixes behave specially under some methods. */
  crafted?: boolean
  fractured?: boolean
  /** "Exclusive" modifier (Settlers recombinator class): at most one survives a combine. */
  exclusive?: boolean
  /** Fallback NNN marker (when no mod data to derive legality): non-native to the final base. */
  nonNative?: boolean
  /** Influenced modifier (Shaper/Elder/Conqueror) — Awakener's carry + Orb of Dominance read this. */
  influenced?: boolean
}

/** Active meta-mods that reshape what subsequent crafts can do. */
export interface MetaModsState {
  multimod?: boolean
  lockPrefixes?: boolean
  lockSuffixes?: boolean
  noAttack?: boolean
  noCaster?: boolean
}

/**
 * Depleting per-item resources that CONDITION outcome distributions and are consumed
 * per craft. `memoryStrands` is the 3.28 case (biases tier distribution); the map is
 * open so other resources slot in without a model change.
 */
export interface ItemResources {
  memoryStrands?: number
  [key: string]: number | undefined
}

export interface ItemState {
  base: string
  itemClass: string
  ilvl: number
  rarity: Rarity
  affixes: Affix[]
  /** Max affixes per slot for the rarity (rare 3/3, magic 1/1, normal 0/0). */
  caps: Record<Slot, number>
  /** Mod groups blocked from rolling (e.g. to raise augment odds for what's left). */
  blockedGroups: string[]
  tags: string[]
  meta: MetaModsState
  influence: string[]
  /** Fractured mod ids (locked through rerolls). */
  fractured: string[]
  quality: number
  catalyst?: string
  corrupted?: boolean
  resources: ItemResources
}

export const RARITY_CAPS: Record<Rarity, Record<Slot, number>> = {
  normal: { prefix: 0, suffix: 0 },
  magic: { prefix: 1, suffix: 1 },
  rare: { prefix: 3, suffix: 3 },
}

export interface NewItemStateInput {
  base: string
  itemClass: string
  ilvl: number
  rarity?: Rarity
  tags?: string[]
  meta?: MetaModsState
  influence?: string[]
  affixes?: Affix[]
  blockedGroups?: string[]
  fractured?: string[]
  quality?: number
  corrupted?: boolean
  resources?: ItemResources
}

/** Build a fresh item state (rarity defaults to rare; caps from rarity). */
export function newItemState(i: NewItemStateInput): ItemState {
  const rarity = i.rarity ?? 'rare'
  return {
    base: i.base,
    itemClass: i.itemClass,
    ilvl: i.ilvl,
    rarity,
    affixes: i.affixes ?? [],
    caps: { ...RARITY_CAPS[rarity] },
    blockedGroups: i.blockedGroups ?? [],
    tags: i.tags ?? [],
    meta: i.meta ?? {},
    influence: i.influence ?? [],
    fractured: i.fractured ?? [],
    quality: i.quality ?? 0,
    corrupted: i.corrupted,
    resources: i.resources ?? {},
  }
}

// ── Queries (pure) ─────────────────────────────────────────────────────────────

export const slotUsage = (s: ItemState, slot: Slot): number => s.affixes.filter(a => a.slot === slot).length

/** A slot is locked when its protective meta-mod is active (its affixes can't change). */
export const isSlotLocked = (s: ItemState, slot: Slot): boolean =>
  slot === 'prefix' ? !!s.meta.lockPrefixes : !!s.meta.lockSuffixes

/** Open (rollable) affix slots — 0 when the slot is locked. */
export const openSlots = (s: ItemState, slot: Slot): number =>
  isSlotLocked(s, slot) ? 0 : Math.max(0, s.caps[slot] - slotUsage(s, slot))

export const groupsPresent = (s: ItemState): Set<string> => new Set(s.affixes.map(a => a.group))

/** Can a mod of `group` roll into `slot`? Respects caps, locks, blocked + present groups. */
export function canRollGroup(s: ItemState, slot: Slot, group: string): boolean {
  if (openSlots(s, slot) <= 0) return false
  if (s.blockedGroups.includes(group)) return false
  if (groupsPresent(s).has(group)) return false
  return true
}

// ── Transforms (immutable — return new states) ─────────────────────────────────

export const withAffix = (s: ItemState, affix: Affix): ItemState => ({ ...s, affixes: [...s.affixes, affix] })

export const withBlockedGroup = (s: ItemState, group: string): ItemState =>
  s.blockedGroups.includes(group) ? s : { ...s, blockedGroups: [...s.blockedGroups, group] }

export const withMeta = (s: ItemState, patch: MetaModsState): ItemState => ({ ...s, meta: { ...s.meta, ...patch } })

/** Deplete a per-item resource (clamped at 0). */
export function consumeResource(s: ItemState, key: string, amount = 1): ItemState {
  const current = s.resources[key] ?? 0
  return { ...s, resources: { ...s.resources, [key]: Math.max(0, current - amount) } }
}

/**
 * Canonical, order-independent key for a state — equal states ⇒ equal keys. Used by the path
 * solver for dedupe / memoization (the search lands next increment; the key is implemented now).
 */
export function stateKey(s: ItemState): string {
  const affixes = s.affixes
    .map(a => `${a.slot}:${a.group}:${a.modId}:${a.tier ?? ''}${a.crafted ? 'c' : ''}${a.fractured ? 'f' : ''}`)
    .sort()
    .join('|')
  const meta = Object.entries(s.meta).filter(([, v]) => v).map(([k]) => k).sort().join(',')
  const res = Object.entries(s.resources).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).sort().join(',')
  return [
    s.base, s.itemClass, s.ilvl, s.rarity, affixes,
    [...s.blockedGroups].sort().join(','), meta,
    [...s.influence].sort().join(','), [...s.fractured].sort().join(','),
    s.quality, s.corrupted ? 'C' : '', s.catalyst ?? '', res,
  ].join('#')
}
