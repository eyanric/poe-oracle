/**
 * services — expected-attempts / consumable model per crafting METHOD (Phase 2).
 *
 * Turns the spawn-weight model (`craftingModel`) into "how many attempts, and what
 * do they consume" for each method ORACLE supports. The spec is explicit that a
 * compound multi-mod target is NOT a naive product of per-mod probabilities — we
 * model the method's actual sequence (e.g. the magic 2-affix mechanic for an
 * alt→regal two-mod craft), and mark anything we can't yet sequence as
 * `supported: false` rather than guessing.
 *
 * Pure over data; pricing lives one layer up in `craftCost`.
 */
import type { RepoeMod, RepoeFossil } from '../data/repoe'
import {
  buildSlotPool,
  slotShare,
  totalWeight,
  magicOccupancy,
  pPresentInSlots,
  type Slot,
  type ModEntry,
  type MetaMods,
} from './craftingModel'

/** One mod the craft is trying to land. Matches by specific id or by group (any tier). */
export interface DesiredMod {
  slot: Slot
  group?: string
  modId?: string
  label: string
}

export interface CraftContext {
  mods: Record<string, RepoeMod>
  baseTags: Set<string>
  ilvl: number
  meta?: MetaMods
}

export type CraftMethod =
  | { kind: 'essence'; forcedModId: string; essenceName: string }
  | { kind: 'alt-regal' }
  | { kind: 'chaos-spam' }
  | { kind: 'fossil'; fossils: RepoeFossil[]; fossilNames: string[] }

/** Expected consumable usage across the WHOLE craft (qty already EV-multiplied). */
export interface ConsumableUse {
  name: string
  qty: number
  /** Economy category hint for `searchEconomy`. */
  category?: string
}

export interface ExpectedAttemptsResult {
  method: string
  supported: boolean
  reason?: string
  /** Expected attempts of the primary rolling step (alts, chaos, fossil rolls…). */
  expectedAttempts: number
  /** P(hit) per primary attempt. */
  perAttemptProb: number
  consumables: ConsumableUse[]
  /** True when an unmodelled game constant (magic/rare affix counts) drives the EV. */
  lowConfidence: boolean
  notes: string[]
}

const matcher = (d: DesiredMod) => (e: ModEntry): boolean =>
  d.modId ? e.id === d.modId : d.group ? e.group === d.group : false

function unsupported(method: string, reason: string): ExpectedAttemptsResult {
  return { method, supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes: [] }
}

/**
 * GGG rare affix-count weights are not in the RePoE export. Equal-weight estimate
 * over the {4,5,6}-mod outcomes; any rare-reroll EV is flagged low-confidence.
 */
const RARE_AFFIX_TOTALS = [4, 5, 6]

/** Expected number of filled slots of `slot` on a freshly-rolled rare. */
function expectedRareSlots(prefixTotal: number, suffixTotal: number, slot: Slot): number {
  const denom = prefixTotal + suffixTotal
  if (denom <= 0) return 0
  const frac = (slot === 'prefix' ? prefixTotal : suffixTotal) / denom
  const avgTotal = RARE_AFFIX_TOTALS.reduce((s, t) => s + t, 0) / RARE_AFFIX_TOTALS.length
  return Math.min(3, avgTotal * frac)
}

// ── Method: essence (deterministic forced mod) ───────────────────────────────

function essence(ctx: CraftContext, desired: DesiredMod[], m: Extract<CraftMethod, { kind: 'essence' }>): ExpectedAttemptsResult {
  const forced = ctx.mods[m.forcedModId]
  if (!forced) return unsupported(`essence (${m.essenceName})`, `forced mod ${m.forcedModId} not found`)
  const forcedGroup = forced.groups?.[0] ?? m.forcedModId

  // The essence guarantees its mod. We model the deterministic single-mod target.
  const extras = desired.filter(d => d.modId !== m.forcedModId && d.group !== forcedGroup)
  if (extras.length > 0) {
    return unsupported(
      `essence (${m.essenceName})`,
      `essence guarantees only its forced mod (${forced.name}); the additional desired mod(s) ` +
        `${extras.map(e => e.label).join(', ')} come from the random rare portion, which this method does not yet sequence`,
    )
  }
  return {
    method: `essence (${m.essenceName})`,
    supported: true,
    expectedAttempts: 1,
    perAttemptProb: 1,
    consumables: [{ name: m.essenceName, qty: 1, category: 'essence' }],
    lowConfidence: false,
    notes: [`${m.essenceName} forces ${forced.name} — guaranteed in one use (P=1).`],
  }
}

// ── Method: alt → regal (magic mod-count aware) ──────────────────────────────

function altRegal(ctx: CraftContext, desired: DesiredMod[]): ExpectedAttemptsResult {
  const method = 'alt → regal'
  if (desired.length === 0) return unsupported(method, 'no target mod specified')
  if (desired.length > 2) return unsupported(method, 'alt→regal models at most one prefix + one suffix (magic caps are 1/1)')

  const prefixPool = buildSlotPool(ctx.mods, ctx.baseTags, ctx.ilvl, 'prefix', { meta: ctx.meta })
  const suffixPool = buildSlotPool(ctx.mods, ctx.baseTags, ctx.ilvl, 'suffix', { meta: ctx.meta })
  const pTotal = totalWeight(prefixPool)
  const sTotal = totalWeight(suffixPool)
  const occ = magicOccupancy(pTotal, sTotal)
  const poolFor = (s: Slot) => (s === 'prefix' ? prefixPool : suffixPool)
  const pSlot = (s: Slot) => (s === 'prefix' ? occ.pPrefix : occ.pSuffix)

  // P that a single desired mod lands in its slot on one alt'd magic item.
  const pOne = (d: DesiredMod): number => pSlot(d.slot) * slotShare(poolFor(d.slot), matcher(d))

  if (desired.some(d => slotShare(poolFor(d.slot), matcher(d)) <= 0)) {
    return unsupported(method, `a desired mod cannot roll on this base/ilvl (weight 0): ${desired.map(d => d.label).join(', ')}`)
  }

  let pHit: number
  const notes: string[] = []
  if (desired.length === 1) {
    pHit = pOne(desired[0])
    notes.push(
      `P(${desired[0].label}) per alt = P(${desired[0].slot} present ${(pSlot(desired[0].slot) * 100).toFixed(0)}%) × ` +
        `share-of-${desired[0].slot} ${(slotShare(poolFor(desired[0].slot), matcher(desired[0])) * 100).toFixed(1)}%.`,
    )
  } else {
    if (desired[0].slot === desired[1].slot) {
      return unsupported(method, 'two same-slot mods cannot co-exist on a magic item (one prefix + one suffix only)')
    }
    // 2-affix magic item is exactly 1 prefix + 1 suffix; mods are independent by weight.
    const pre = desired.find(d => d.slot === 'prefix')!
    const suf = desired.find(d => d.slot === 'suffix')!
    const pTwoAffix = occ.pPrefix + occ.pSuffix - 1 // = P(both slots filled) = P(2-affix)
    pHit = pTwoAffix * slotShare(prefixPool, matcher(pre)) * slotShare(suffixPool, matcher(suf))
    notes.push(
      `Two-mod alt→regal: P(both) per alt = P(2-affix ${(pTwoAffix * 100).toFixed(0)}%) × ` +
        `share-prefix ${(slotShare(prefixPool, matcher(pre)) * 100).toFixed(1)}% × share-suffix ${(slotShare(suffixPool, matcher(suf)) * 100).toFixed(1)}%. ` +
        `Models "alt until both present, then regal" (a conservative upper bound vs alt-then-augment).`,
    )
  }

  if (pHit <= 0) return unsupported(method, 'computed per-alt probability is zero')
  const expectedAlts = 1 / pHit
  notes.push('Magic affix-count is an unmodelled game constant — EV flagged low-confidence.')
  return {
    method,
    supported: true,
    expectedAttempts: expectedAlts,
    perAttemptProb: pHit,
    consumables: [
      { name: 'Orb of Alteration', qty: expectedAlts, category: 'currency' },
      { name: 'Regal Orb', qty: 1, category: 'currency' },
    ],
    lowConfidence: true,
    notes,
  }
}

// ── Methods: chaos-spam & fossil (rare reroll) ───────────────────────────────

function rareReroll(
  ctx: CraftContext,
  desired: DesiredMod[],
  method: string,
  consumable: ConsumableUse,
  fossils?: RepoeFossil[],
): ExpectedAttemptsResult {
  if (desired.length === 0) return unsupported(method, 'no target mod specified')
  if (desired.length > 1) {
    return unsupported(method, 'rare-reroll EV for multi-mod targets needs full without-replacement affix simulation (not yet modelled)')
  }
  const d = desired[0]
  const opts = { meta: ctx.meta, fossils }
  const prefixPool = buildSlotPool(ctx.mods, ctx.baseTags, ctx.ilvl, 'prefix', opts)
  const suffixPool = buildSlotPool(ctx.mods, ctx.baseTags, ctx.ilvl, 'suffix', opts)
  const pTotal = totalWeight(prefixPool)
  const sTotal = totalWeight(suffixPool)
  const pool = d.slot === 'prefix' ? prefixPool : suffixPool
  const share = slotShare(pool, matcher(d))
  if (share <= 0) return unsupported(method, `${d.label} cannot roll on this base/ilvl under these fossils (weight 0)`)

  const slots = expectedRareSlots(pTotal, sTotal, d.slot)
  const pHit = pPresentInSlots(share, slots)
  if (pHit <= 0) return unsupported(method, 'computed per-reroll probability is zero')
  const attempts = 1 / pHit
  return {
    method,
    supported: true,
    expectedAttempts: attempts,
    perAttemptProb: pHit,
    consumables: [{ ...consumable, qty: consumable.qty * attempts }],
    lowConfidence: true,
    notes: [
      `P(${d.label}) per reroll ≈ 1-(1-share)^slots with share ${(share * 100).toFixed(1)}% over ~${slots.toFixed(1)} ${d.slot} slots.`,
      'Rare affix-count is an unmodelled game constant — EV flagged low-confidence.',
    ],
  }
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function expectedAttempts(ctx: CraftContext, desired: DesiredMod[], method: CraftMethod): ExpectedAttemptsResult {
  switch (method.kind) {
    case 'essence':
      return essence(ctx, desired, method)
    case 'alt-regal':
      return altRegal(ctx, desired)
    case 'chaos-spam':
      return rareReroll(ctx, desired, 'chaos-spam', { name: 'Chaos Orb', qty: 1, category: 'currency' })
    case 'fossil':
      return rareReroll(
        ctx,
        desired,
        `fossil (${method.fossilNames.join(' + ')})`,
        { name: method.fossilNames[0], qty: 1, category: 'currency' },
        method.fossils,
      )
  }
}
