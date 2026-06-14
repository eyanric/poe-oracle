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
import { findBenchCraft, type BenchData, type BenchCraft } from './benchCrafting'

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
  /** Item class (for bench-craft applicability). */
  itemClass?: string
  /** Loaded bench/meta data (for bench/multimod/slam methods). */
  bench?: BenchData
}

export type CraftMethod =
  | { kind: 'essence'; forcedModId: string; essenceName: string }
  | { kind: 'alt-regal' }
  | { kind: 'chaos-spam' }
  | { kind: 'fossil'; fossils: RepoeFossil[]; fossilNames: string[] }
  | { kind: 'bench'; benchMods: string[] }
  | { kind: 'multimod'; benchMods: string[] }
  | { kind: 'slam'; protect?: 'prefixes' | 'suffixes'; baseValueChaos?: number }

/**
 * An UNPRICED craft plan the risk engine runs once `craftCost` prices each step's
 * consumable. Steps mirror `craftRisk` step kinds; a fixed step may carry a direct
 * chaos value (e.g. the value of the base being slammed) instead of a consumable.
 */
export type PlanStepBlueprint =
  | { kind: 'keep-trying'; label: string; p: number; consumable: { name: string; category?: string }; qty?: number }
  | { kind: 'fixed'; label: string; consumable?: { name: string; category?: string }; qty?: number; chaos?: number }
  | { kind: 'slam'; label: string; pSuccess: number; consumable: { name: string; category?: string }; recoverable: boolean; qty?: number }
export interface PlanBlueprint {
  label: string
  steps: PlanStepBlueprint[]
}

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
  /** When set, craftCost prices this multi-step plan (bench/multimod/slam) for the risk engine. */
  blueprint?: PlanBlueprint
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

// ── Methods: bench / multimod / slam (deterministic + meta-protected gambles) ──

const STALE_COST_NOTE =
  '⚠ bench/meta COSTS are low-confidence — RePoE export amounts read as pre-3.28 (multimod 2 div, ' +
  'bench in alt/chaos), not the 3.28 "standardized ~4 Exalted" rework. Structure is reliable; amounts may be stale.'

function resolveBenchMods(ctx: CraftContext, terms: string[]): { found: BenchCraft[]; missing: string[] } {
  const found: BenchCraft[] = []
  const missing: string[] = []
  for (const t of terms) {
    const c = ctx.bench && ctx.itemClass ? findBenchCraft(ctx.bench, ctx.itemClass, t) : null
    if (c) found.push(c)
    else missing.push(t)
  }
  return { found, missing }
}

const benchStep = (c: BenchCraft): PlanStepBlueprint => ({
  kind: 'fixed', label: `bench: ${c.label}`, consumable: { name: c.costName, category: 'currency' }, qty: c.costAmount,
})

function bench(ctx: CraftContext, method: Extract<CraftMethod, { kind: 'bench' }>): ExpectedAttemptsResult {
  if (!ctx.bench || !ctx.itemClass) return unsupported('bench', 'bench data / item class unavailable')
  const { found, missing } = resolveBenchMods(ctx, method.benchMods)
  if (missing.length) return unsupported('bench', `no bench craft for: ${missing.join(', ')} on ${ctx.itemClass}`)
  return {
    method: 'bench craft', supported: true, expectedAttempts: 1, perAttemptProb: 1, consumables: [],
    blueprint: { label: 'bench', steps: found.map(benchStep) },
    lowConfidence: true,
    notes: [`Deterministic: ${found.length} guaranteed bench mod(s).`, STALE_COST_NOTE],
  }
}

function multimod(ctx: CraftContext, method: Extract<CraftMethod, { kind: 'multimod' }>): ExpectedAttemptsResult {
  if (!ctx.bench || !ctx.itemClass) return unsupported('multimod', 'bench data / item class unavailable')
  const mm = ctx.bench.meta.multimod
  if (!mm) return unsupported('multimod', 'multimod meta-mod not found in bench data')
  if (method.benchMods.length < 2) return unsupported('multimod', 'multimod is only worth it for ≥2 crafted mods')
  const { found, missing } = resolveBenchMods(ctx, method.benchMods)
  if (missing.length) return unsupported('multimod', `no bench craft for: ${missing.join(', ')} on ${ctx.itemClass}`)
  const steps: PlanStepBlueprint[] = [
    { kind: 'fixed', label: 'meta: Can have multiple Crafted Modifiers', consumable: { name: mm.costName, category: 'currency' }, qty: mm.costAmount },
    ...found.map(benchStep),
  ]
  return {
    method: 'multimod', supported: true, expectedAttempts: 1, perAttemptProb: 1, consumables: [],
    blueprint: { label: 'multimod', steps },
    lowConfidence: true,
    notes: [`Deterministic: multimod + ${found.length} bench mods, all guaranteed.`, STALE_COST_NOTE],
  }
}

function slam(ctx: CraftContext, desired: DesiredMod[], method: Extract<CraftMethod, { kind: 'slam' }>): ExpectedAttemptsResult {
  if (desired.length === 0) return unsupported('slam', 'no target mod for the open slot')
  const d = desired[0]
  const pool = buildSlotPool(ctx.mods, ctx.baseTags, ctx.ilvl, d.slot, { meta: ctx.meta })
  const pSuccess = slotShare(pool, matcher(d))
  if (pSuccess <= 0) return unsupported('slam', `${d.label} cannot roll in the open ${d.slot} slot (weight 0)`)

  const recoverable = !!method.protect
  const steps: PlanStepBlueprint[] = []
  if ((method.baseValueChaos ?? 0) > 0) steps.push({ kind: 'fixed', label: 'built base (value at risk)', chaos: method.baseValueChaos })
  if (method.protect) {
    const metaCraft = method.protect === 'prefixes' ? ctx.bench?.meta.lockPrefixes : ctx.bench?.meta.lockSuffixes
    if (!metaCraft) return unsupported('slam', `protective meta "${method.protect} cannot be changed" not found in bench data`)
    steps.push({ kind: 'fixed', label: `meta: ${method.protect} cannot be changed`, consumable: { name: metaCraft.costName, category: 'currency' }, qty: metaCraft.costAmount })
  }
  steps.push({ kind: 'slam', label: `Exalt slam → ${d.label}`, pSuccess, consumable: { name: 'Exalted Orb', category: 'currency' }, recoverable })

  const notes = [
    `Exalt slam P(${d.label}) = ${(pSuccess * 100).toFixed(1)}% (share of open ${d.slot} slot).`,
    recoverable
      ? `PROTECTED (${method.protect} locked) → a miss is recoverable (re-slam), NOT a brick.`
      : `UNPROTECTED → a miss BRICKS: the built base (${(method.baseValueChaos ?? 0).toFixed(0)}c) is lost.`,
    STALE_COST_NOTE,
  ]
  return {
    method: `exalt slam${method.protect ? ` (protected: ${method.protect})` : ' (unprotected)'}`,
    supported: true, expectedAttempts: pSuccess > 0 ? 1 / pSuccess : Infinity, perAttemptProb: pSuccess,
    consumables: [], blueprint: { label: 'slam', steps }, lowConfidence: true, notes,
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
    case 'bench':
      return bench(ctx, method)
    case 'multimod':
      return multimod(ctx, method)
    case 'slam':
      return slam(ctx, desired, method)
  }
}
