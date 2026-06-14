/**
 * services — calc_craft_cost orchestration (Track A, Phase 3).
 *
 * Pipeline: weight model → expected attempts (`craftMethods`) → per-step consumable
 * usage → live-priced via the economy snapshot → total expected cost + a craft-vs-buy
 * verdict. Pricing discipline (carried from the Phase 1 caveat): consume the
 * `lowConfidence` flags, prefer divine-denominated sums when chaos is a thin micro-unit,
 * and never report false precision on unmodelled mechanics or thin data.
 *
 * `estimateCraftCost` is pure over loaded data + a snapshot (unit-testable). The live
 * wrapper `estimateCraftCostLive` loads RePoE + resolves the league + fetches prices.
 *
 * Buy side (Track A completion): for a rare craft target the live wrapper builds a
 * comparable-listing query from the target mods and resolves a confidence-flagged
 * RANGE via `rarePricing`; the verdict is then HEDGED — never a crisp margin when
 * either side is low-confidence.
 */
import type { RepoeMod, RepoeBaseItem, RepoeEssence, RepoeFossil } from '../data/repoe'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName } from '../data/repoe'
import { searchEconomy } from './economySearch'
import type { EconomySnapshot } from './economyTypes'
import { getEconomyProvider } from './EconomyProvider'
import { resolveCurrentLeague } from './LeagueResolver'
import { evaluateMethod, evaluateInputs, type CraftMethod, type DesiredMod, type PlanBlueprint } from './craftMethods'
import { newItemState, type Affix, type Slot } from './itemState'
import { analyzeRecombine, recombineIlvl } from './recombine'
import { buildSlotPool, type MetaMods } from './craftingModel'
import { computePseudoTotals } from './pseudoMods'
import { estimateRarePriceLive, type RareItemSpec } from './rarePricing'
import { riskProfile, type RiskProfile, type RiskCategory, type CraftPlan, type CraftStep } from './craftRisk'
import { normalizeBench, type BenchData } from './benchCrafting'
import { getBenchOptions } from '../data/repoe'

export type MethodSpec =
  | { kind: 'essence'; essenceName: string }
  | { kind: 'alt-regal' }
  | { kind: 'chaos-spam' }
  | { kind: 'fossil'; fossilNames: string[] }
  | { kind: 'bench'; benchMods: string[] }
  | { kind: 'multimod'; benchMods: string[] }
  | { kind: 'slam'; protect?: 'prefixes' | 'suffixes'; baseValueChaos?: number }
  | { kind: 'harvest'; craft: 'reforge' | 'augment' | 'remove'; tag: string }

export interface CraftSpec {
  baseName: string
  ilvl: number
  desired: DesiredMod[]
  method: MethodSpec
  meta?: MetaMods
  /** Mod groups already blocked (raises augment odds — Harvest augment reads these). */
  blockedGroups?: string[]
  /** Optional name to price-check the finished item for the craft-vs-buy verdict. */
  finishedItemQuery?: string
}

export interface PricedConsumable {
  name: string
  qty: number
  chaosEach: number | null
  chaosTotal: number | null
  lowConfidence: boolean
}

/** The resolved buy side — a confidence-flagged RANGE for rares, never a point price. */
export interface BuySide {
  source: 'rare-comparables' | 'named-aggregator'
  label: string
  lowChaos: number
  medianChaos: number
  confidence: 'low' | 'medium' | 'high'
  tradeUrl?: string
  /** Target mods not captured by pseudo-pricing (true value may be higher). */
  unpricedMods?: string[]
  note?: string
}

export interface HedgedVerdict {
  decision: 'craft-likely-cheaper' | 'buy-likely-cheaper' | 'overlapping' | 'unknown'
  craftChaos: number | null
  /** p90 (unlucky-tail) craft cost — the verdict accounts for variance, not just EV. */
  p90Chaos: number | null
  buyLowChaos: number | null
  buyMedianChaos: number | null
  /** Crisp margin ONLY when both sides are confident AND non-overlapping; else null. */
  marginChaos: number | null
  confidence: 'low' | 'medium' | 'high'
  /** Risk category of the craft side, when computed. */
  riskCategory: RiskCategory | null
  /** True when variance/brick risk overrode the EV-based lean. */
  riskAdjusted: boolean
  riskNote: string | null
  rationale: string
}

export type CraftCostEstimate = {
  league: string
  stampDate: string
  base: string
  ilvl: number
  method: string
  supported: boolean
  reason?: string
  expectedAttempts: number
  perAttemptProb: number
  consumables: PricedConsumable[]
  totalChaos: number | null
  totalDivine: number | null
  divineChaos: number | null
  buySide: BuySide | null
  /** Cost distribution + determinism + brick analysis (null if cost couldn't be priced). */
  risk: RiskProfile | null
  verdict: HedgedVerdict
  lowConfidence: boolean
  notes: string[]
}

export interface CraftDeps {
  mods: Record<string, RepoeMod>
  baseItems: Record<string, RepoeBaseItem>
  essences: Record<string, RepoeEssence>
  fossils: Map<string, RepoeFossil>
  snapshot: EconomySnapshot
  league: string
  /** Bench/meta data (for bench/multimod/slam methods). */
  bench?: BenchData
  /** Pre-resolved buy side (the live wrapper fills this; tests inject it). */
  buySide?: BuySide | null
  /** YYYY-MM-DD stamp (injected for deterministic tests). */
  today?: string
}

function findBaseItem(baseItems: Record<string, RepoeBaseItem>, name: string): RepoeBaseItem | undefined {
  const lower = name.toLowerCase()
  let fallback: RepoeBaseItem | undefined
  for (const b of Object.values(baseItems)) {
    if (b.name?.toLowerCase() !== lower) continue
    if (b.release_state === 'released') return b
    fallback ??= b
  }
  return fallback
}

/** Resolve the friendlier MethodSpec into the concrete CraftMethod + effective desired set. */
function resolveMethod(
  spec: CraftSpec,
  base: RepoeBaseItem,
  deps: CraftDeps,
): { method: CraftMethod; desired: DesiredMod[]; error?: string } {
  const m = spec.method
  if (m.kind === 'alt-regal' || m.kind === 'chaos-spam' || m.kind === 'bench' || m.kind === 'multimod' || m.kind === 'slam' || m.kind === 'harvest') {
    return { method: m, desired: spec.desired }
  }
  if (m.kind === 'fossil') {
    const fossils: RepoeFossil[] = []
    for (const n of m.fossilNames) {
      const f = deps.fossils.get(n)
      if (!f) return { method: m as unknown as CraftMethod, desired: spec.desired, error: `unknown fossil: ${n}` }
      fossils.push(f)
    }
    return { method: { kind: 'fossil', fossils, fossilNames: m.fossilNames }, desired: spec.desired }
  }
  // essence — derive the forced mod from the essence + the base's item class
  const ess = Object.values(deps.essences).find(e => e.name?.toLowerCase() === m.essenceName.toLowerCase())
  if (!ess) return { method: m as unknown as CraftMethod, desired: spec.desired, error: `unknown essence: ${m.essenceName}` }
  const forcedModId = ess.mods?.[base.item_class]
  if (!forcedModId) {
    return { method: m as unknown as CraftMethod, desired: spec.desired, error: `${ess.name} does not apply to item class "${base.item_class}"` }
  }
  const forced = deps.mods[forcedModId]
  // Target the forced mod (the deterministic guarantee) plus whatever else the user asked for.
  const forcedDesired: DesiredMod = {
    slot: forced?.generation_type === 'suffix' ? 'suffix' : 'prefix',
    modId: forcedModId,
    label: forced?.name ?? forcedModId,
  }
  const rest = spec.desired.filter(d => d.modId !== forcedModId && d.group !== forced?.groups?.[0])
  return { method: { kind: 'essence', forcedModId, essenceName: ess.name }, desired: [forcedDesired, ...rest] }
}

function divineChaosOf(snapshot: EconomySnapshot): number | null {
  const m = searchEconomy(snapshot, 'Divine Orb', 'currency', 1)[0]
  return m && m.chaosValue > 0 ? m.chaosValue : null
}

function priceConsumable(snapshot: EconomySnapshot, name: string, category?: string): { chaos: number | null; low: boolean } {
  const m = searchEconomy(snapshot, name, category, 1)[0]
  if (!m || m.chaosValue <= 0) return { chaos: null, low: true }
  return { chaos: m.chaosValue, low: m.lowConfidence }
}

export function estimateCraftCost(spec: CraftSpec, deps: CraftDeps): CraftCostEstimate {
  const stampDate = deps.today ?? new Date().toISOString().slice(0, 10)
  const base = findBaseItem(deps.baseItems, spec.baseName)
  const divineChaos = divineChaosOf(deps.snapshot)
  const notes: string[] = []

  const unsupportedShell = (reason: string): CraftCostEstimate => ({
    league: deps.league, stampDate, base: spec.baseName, ilvl: spec.ilvl, method: spec.method.kind,
    supported: false, reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [],
    totalChaos: null, totalDivine: null, divineChaos, buySide: deps.buySide ?? null, risk: null,
    verdict: { decision: 'unknown', craftChaos: null, p90Chaos: null, buyLowChaos: null, buyMedianChaos: null, marginChaos: null, confidence: 'low', riskCategory: null, riskAdjusted: false, riskNote: null, rationale: reason },
    lowConfidence: true, notes,
  })

  if (!base) return unsupportedShell(`base item "${spec.baseName}" not found in RePoE`)

  // Specific-named-mod contract: reject abstract targets ("any T1 prefix"). Specificity is
  // the product — every cost rides on a named mod's REAL resolved weight, never a representative one.
  const abstract = spec.desired.filter(d => !d.group && !d.modId)
  if (abstract.length) {
    return unsupportedShell('abstract target not supported — name the specific mod (group or modId), not "any prefix/tier". Specificity is the product.')
  }

  const { method, desired, error } = resolveMethod(spec, base, deps)
  if (error) return unsupportedShell(error)

  // Compose through the method-module interface: build the item state, evaluate the module.
  const state = newItemState({ base: base.name, itemClass: base.item_class, ilvl: spec.ilvl, tags: base.tags, meta: spec.meta ?? {}, blockedGroups: spec.blockedGroups })
  const ev = evaluateMethod(state, { mods: deps.mods, bench: deps.bench, currentLeague: deps.league }, { desired, method })
  notes.push(...ev.notes)

  if (!ev.supported) {
    const shell = unsupportedShell(ev.reason ?? 'unsupported target/method')
    shell.method = ev.method
    return shell
  }

  // ── Price into a CraftPlan: blueprint methods (bench/multimod/slam) or the
  //    geometric consumable model — both end at a priced plan for the risk engine. ─
  const priced = ev.blueprint
    ? priceBlueprint(ev.blueprint, deps.snapshot)
    : priceConsumables(ev.consumables, deps.snapshot, ev)
  const { consumables, plan } = priced
  const anyUnpriced = consumables.some(c => c.chaosTotal == null)
  if (anyUnpriced) notes.push(`Some steps had no live price (${consumables.filter(c => c.chaosTotal == null).map(c => c.name).join(', ')}) — total is incomplete.`)

  // ── Risk profile: cost distribution + determinism + bricks ────────────────
  const risk = anyUnpriced ? null : riskProfile(plan, { seed: 0x5eed })
  if (risk) notes.push(...risk.notes)
  const totalChaos = risk ? risk.distribution.mean : null
  const totalDivine = totalChaos != null && divineChaos ? totalChaos / divineChaos : null

  // ── Hedged + risk-adjusted craft-vs-buy verdict ───────────────────────────
  const craftLow = ev.lowConfidence || consumables.some(c => c.lowConfidence) || anyUnpriced
  const buySide = deps.buySide ?? null
  const verdict = hedgedVerdict(totalChaos, craftLow, buySide, divineChaos, risk)
  // lowConfidence reflects the CRAFT-COST side; the verdict carries its own confidence.
  const lowConfidence = craftLow
  if (lowConfidence) notes.push('LOW CONFIDENCE (craft cost) — prefer the divine-denominated figures; chaos micro-prices and unmodelled affix-count constants make tighter precision unreliable.')
  if (buySide?.unpricedMods?.length) notes.push(`Buy-side could not price ${buySide.unpricedMods.length} target mod(s) (${buySide.unpricedMods.slice(0, 3).join('; ')}) — the true comparable may cost more.`)

  return {
    league: deps.league, stampDate, base: base.name, ilvl: spec.ilvl, method: ev.method, supported: true,
    expectedAttempts: ev.expectedAttempts, perAttemptProb: ev.perAttemptProb, consumables,
    totalChaos, totalDivine, divineChaos, buySide, risk, verdict, lowConfidence, notes,
  }
}

/**
 * Price the geometric consumable model into a CraftPlan: the per-attempt consumable
 * (qty scales with expected attempts, p < 1) becomes a keep-trying step; everything
 * else is a guaranteed fixed cost.
 */
function priceConsumables(
  uses: { name: string; qty: number; category?: string }[],
  snapshot: EconomySnapshot,
  ev: { expectedAttempts: number; perAttemptProb: number },
): { consumables: PricedConsumable[]; plan: CraftPlan } {
  const consumables: PricedConsumable[] = uses.map(c => {
    const { chaos, low } = priceConsumable(snapshot, c.name, c.category)
    return { name: c.name, qty: c.qty, chaosEach: chaos, chaosTotal: chaos != null ? chaos * c.qty : null, lowConfidence: low }
  })
  const steps: CraftStep[] = []
  for (const c of consumables) {
    if (c.chaosEach == null) continue
    const isKeepTrying =
      ev.perAttemptProb < 1 && Math.abs(c.qty - ev.expectedAttempts) <= Math.max(1e-6, ev.expectedAttempts * 1e-6)
    if (isKeepTrying) steps.push({ kind: 'keep-trying', label: c.name, p: ev.perAttemptProb, costPerAttempt: c.chaosEach })
    else steps.push({ kind: 'fixed', label: c.name, cost: c.chaosTotal ?? c.chaosEach })
  }
  return { consumables, plan: { label: 'craft', steps } }
}

/**
 * Price a blueprint (bench/multimod/slam) into a CraftPlan: each step's consumable is
 * priced live (or a direct chaos value used as-is), preserving keep-trying / fixed /
 * slam (with its recoverable flag — protection vs brick).
 */
function priceBlueprint(bp: PlanBlueprint, snapshot: EconomySnapshot): { consumables: PricedConsumable[]; plan: CraftPlan } {
  const consumables: PricedConsumable[] = []
  const steps: CraftStep[] = []
  for (const s of bp.steps) {
    const qty = ('qty' in s ? s.qty : undefined) ?? 1
    let unit: number | null
    let low = false
    let displayName: string
    if (s.kind === 'fixed' && s.chaos != null) {
      unit = s.chaos
      displayName = s.label
    } else {
      const cons = (s as { consumable?: { name: string; category?: string } }).consumable!
      const p = priceConsumable(snapshot, cons.name, cons.category)
      unit = p.chaos
      low = p.low
      displayName = `${s.label} (${cons.name})`
    }
    let stepCost = unit != null ? unit * qty : null
    consumables.push({ name: displayName, qty, chaosEach: unit, chaosTotal: unit != null ? unit * qty : null, lowConfidence: low })
    // Extra cost folded into the SAME per-use cost: priced by name (Rancour/Sacred) OR a
    // direct chaos value (recombine input items, which have no market name).
    for (const ex of s.extra ?? []) {
      const direct = ex.chaos != null
      const ep = direct ? { chaos: ex.chaos!, low: false } : priceConsumable(snapshot, ex.name!, ex.category)
      const eTotal = ep.chaos != null ? ep.chaos * ex.qty : null
      consumables.push({ name: `${s.label} (${ex.label ?? ex.name})`, qty: ex.qty, chaosEach: ep.chaos, chaosTotal: eTotal, lowConfidence: ep.low })
      if (eTotal != null && stepCost != null) stepCost += eTotal
      else if (eTotal == null) stepCost = null // an unpriced extra makes the step incomplete
    }
    if (stepCost == null) continue
    if (s.kind === 'keep-trying') steps.push({ kind: 'keep-trying', label: s.label, p: s.p, costPerAttempt: stepCost })
    else if (s.kind === 'slam') steps.push({ kind: 'slam', label: s.label, pSuccess: s.pSuccess, cost: stepCost, recoverable: s.recoverable })
    else steps.push({ kind: 'fixed', label: s.label, cost: stepCost })
  }
  return { consumables, plan: { label: bp.label, steps } }
}

function fmtChaos(chaos: number, divineChaos: number | null): string {
  if (divineChaos && chaos >= divineChaos * 0.2) return `${(chaos / divineChaos).toFixed(2)} div`
  return `${chaos.toFixed(1)}c`
}

/**
 * Compare the craft cost against the buy RANGE and hedge — now RISK-ADJUSTED: a crisp
 * margin is only emitted when both sides are confident AND non-overlapping; and even
 * when EV says craft is cheaper, a p90 craft cost above the buy price OR a material
 * brick risk flips the call to "buy is the safer play" (and says why — variance/brick).
 */
export function hedgedVerdict(
  craftChaos: number | null,
  craftLow: boolean,
  buy: BuySide | null,
  divineChaos: number | null,
  risk?: RiskProfile | null,
): HedgedVerdict {
  const f = (c: number) => fmtChaos(c, divineChaos)
  const p90 = risk?.distribution.p90 ?? null
  const riskCategory = risk?.category ?? null

  if (craftChaos == null || !buy) {
    return {
      decision: 'unknown', craftChaos, p90Chaos: p90,
      buyLowChaos: buy?.lowChaos ?? null, buyMedianChaos: buy?.medianChaos ?? null,
      marginChaos: null, confidence: 'low', riskCategory, riskAdjusted: false, riskNote: null,
      rationale: !buy ? 'no buy-side price available — craft cost only.' : 'craft total could not be priced — verdict withheld.',
    }
  }
  const { lowChaos, medianChaos } = buy
  let decision: HedgedVerdict['decision'] =
    craftChaos <= lowChaos ? 'craft-likely-cheaper' : craftChaos >= medianChaos ? 'buy-likely-cheaper' : 'overlapping'
  const confidence: HedgedVerdict['confidence'] =
    craftLow || buy.confidence === 'low' ? 'low' : buy.confidence === 'high' ? 'high' : 'medium'
  const bothConfident = !craftLow && buy.confidence === 'high'

  // Risk override: even on a favourable EV, variance or a brick can make buying safer.
  const materialBrick = (risk?.bricks ?? []).some(b => b.failureProb >= 0.05 && b.valueAtRisk > 0)
  const p90ExceedsBuy = p90 != null && p90 > medianChaos
  let riskAdjusted = false
  let riskNote: string | null = null
  if ((materialBrick || p90ExceedsBuy) && decision !== 'buy-likely-cheaper') {
    riskAdjusted = true
    decision = 'buy-likely-cheaper'
    if (materialBrick) {
      const b = risk!.bricks[0]
      riskNote = `brick risk: ${(b.failureProb * 100).toFixed(0)}% chance to lose ${f(b.valueAtRisk)} — buying avoids the catastrophic downside.`
    } else {
      riskNote = `p90 craft ${f(p90!)} exceeds the buy price — high variance makes buying the safer play even though expected craft cost is lower.`
    }
  } else if (riskCategory === 'high-brick') {
    riskNote = `unrecoverable brick step present — see value-at-risk.`
  }

  let marginChaos: number | null = null
  if (!riskAdjusted && bothConfident && decision === 'craft-likely-cheaper') marginChaos = lowChaos - craftChaos
  if (!riskAdjusted && bothConfident && decision === 'buy-likely-cheaper') marginChaos = craftChaos - medianChaos

  const buyStr = `buy ${f(lowChaos)}–${f(medianChaos)} (${buy.confidence} conf, ${buy.source})`
  const edge = marginChaos != null ? `, ~${f(marginChaos)} edge` : ' (margin not crisp — confidence capped)'
  const p90Str = p90 != null ? ` [p90 ${f(p90)}]` : ''
  let rationale: string
  if (riskAdjusted) {
    rationale = `craft EV ~${f(craftChaos)}${p90Str} vs ${buyStr} — ${riskNote}`
  } else if (decision === 'craft-likely-cheaper') {
    rationale = `craft ~${f(craftChaos)}${p90Str} vs ${buyStr} — craft likely cheaper${edge}.`
  } else if (decision === 'buy-likely-cheaper') {
    rationale = `craft ~${f(craftChaos)}${p90Str} vs ${buyStr} — buy likely cheaper${edge}.`
  } else {
    rationale = `craft ~${f(craftChaos)}${p90Str} sits inside the ${buyStr} — overlapping, no clear edge.`
  }

  return { decision, craftChaos, p90Chaos: p90, buyLowChaos: lowChaos, buyMedianChaos: medianChaos, marginChaos, confidence, riskCategory, riskAdjusted, riskNote, rationale }
}

/**
 * Turn a resolved craft target into a rare-pricing spec: pull each target mod's roll
 * text (specific tier, or the top tier available in the group at ilvl) and pseudo-
 * normalize. Reused by the live buy side; null when base/method can't resolve.
 */
export function craftTargetRareSpec(spec: CraftSpec, deps: CraftDeps): RareItemSpec | null {
  const base = findBaseItem(deps.baseItems, spec.baseName)
  if (!base) return null
  const { desired, error } = resolveMethod(spec, base, deps)
  if (error) return null

  const texts: string[] = []
  for (const d of desired) {
    let mod = d.modId ? deps.mods[d.modId] : undefined
    if (!mod && d.group) {
      const pool = buildSlotPool(deps.mods, new Set(base.tags), spec.ilvl, d.slot)
      mod = pool.filter(e => e.group === d.group).map(e => e.mod).sort((a, b) => b.required_level - a.required_level)[0]
    }
    if (mod?.text) texts.push(mod.text)
  }
  const { totals } = computePseudoTotals(texts)
  return { baseType: base.name, itemClass: base.item_class, itemLevel: spec.ilvl, pseudoTotals: totals }
}

/**
 * Live wrapper: loads RePoE, resolves the league + snapshot, then resolves the BUY
 * side — a named-aggregator price when `finishedItemQuery` is given, otherwise a
 * rare-comparables RANGE built from the target mods — and runs the hedged verdict.
 */
export async function estimateCraftCostLive(spec: CraftSpec, league?: string): Promise<CraftCostEstimate> {
  const resolved = league ?? (await resolveCurrentLeague())
  const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([
    getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions(),
  ])
  const snapshot = await getEconomyProvider().getEconomySnapshot(resolved)
  const deps: CraftDeps = {
    mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw),
    bench: normalizeBench(benchOptions, mods), snapshot, league: resolved,
  }

  let buySide: BuySide | null = null
  if (spec.finishedItemQuery) {
    const m = searchEconomy(snapshot, spec.finishedItemQuery, undefined, 1)[0]
    if (m && m.chaosValue > 0) {
      buySide = {
        source: 'named-aggregator', label: spec.finishedItemQuery,
        lowChaos: m.chaosValue, medianChaos: m.chaosValue,
        confidence: m.lowConfidence ? 'low' : 'high', note: 'single aggregator price (named item)',
      }
    }
  } else {
    const rareSpec = craftTargetRareSpec(spec, deps)
    if (rareSpec && rareSpec.pseudoTotals && rareSpec.pseudoTotals.length > 0) {
      const est = await estimateRarePriceLive(rareSpec, resolved)
      if (est.priced && est.range) {
        buySide = {
          source: 'rare-comparables', label: `${rareSpec.baseType} with target mods`,
          lowChaos: est.range.low, medianChaos: est.range.median, confidence: est.confidence,
          tradeUrl: est.tradeUrl, unpricedMods: est.unpricedMods,
          note: `${est.range.count} comparable listing(s)`,
        }
      }
    }
  }

  return estimateCraftCost(spec, { ...deps, buySide, today: undefined })
}

// ── Recombinator (arity-2 combine) ─────────────────────────────────────────────

export interface RecombineAffixSpec {
  group: string
  modId?: string
  label?: string
  /** Mark the mods you want to survive onto the output. */
  desired?: boolean
  /** Settlers "exclusive" modifier (≤1 survives) — caller-supplied (no data flag). */
  exclusive?: boolean
  /** Non-native pad (self-rejects on the final base) — fallback when modId can't be resolved from data. */
  nonNative?: boolean
  /** Fractured mod (retained only if its origin item is the chosen base). */
  fractured?: boolean
}
export interface RecombineInput {
  baseName?: string
  itemClass: string
  ilvl: number
  prefixes?: RecombineAffixSpec[]
  suffixes?: RecombineAffixSpec[]
  /** Value (chaos) of this input item — it's consumed each combine attempt. */
  valueChaos?: number
}
export type RecombineEstimate = {
  league: string
  stampDate: string
  supported: boolean
  reason?: string
  recombinator: string
  outputIlvl: number
  prefixPool: number
  suffixPool: number
  pPrefix: number
  pSuffix: number
  pTarget: number
  brickProb: number
  exclusiveCollision: boolean
  /** NNN padding lever: P(target) without the pad vs with it. */
  nnnLever: { withoutPad: number; withPad: number }
  expectedAttempts: number
  consumables: PricedConsumable[]
  totalChaos: number | null
  totalDivine: number | null
  divineChaos: number | null
  risk: RiskProfile | null
  lowConfidence: boolean
  notes: string[]
}

function toState(i: RecombineInput): { state: import('./itemState').ItemState; desired: DesiredMod[] } {
  const mk = (a: RecombineAffixSpec, slot: Slot): Affix => ({ modId: a.modId ?? a.group, group: a.group, slot, exclusive: a.exclusive, nonNative: a.nonNative, fractured: a.fractured, text: a.label })
  const affixes: Affix[] = [...(i.prefixes ?? []).map(a => mk(a, 'prefix')), ...(i.suffixes ?? []).map(a => mk(a, 'suffix'))]
  const desired: DesiredMod[] = [
    ...(i.prefixes ?? []).filter(a => a.desired).map(a => ({ slot: 'prefix' as Slot, group: a.group, modId: a.modId, label: a.label ?? a.group })),
    ...(i.suffixes ?? []).filter(a => a.desired).map(a => ({ slot: 'suffix' as Slot, group: a.group, modId: a.modId, label: a.label ?? a.group })),
  ]
  return { state: newItemState({ base: i.baseName ?? '', itemClass: i.itemClass, ilvl: i.ilvl, affixes }), desired }
}

const recombinatorCurrencyFor = (itemClass: string): string => {
  const c = itemClass.toLowerCase()
  if (/ring|amulet|belt/.test(c)) return 'Jewellery Recombinator'
  if (/armour|helmet|glove|boot|shield|quiver/.test(c)) return 'Armour Recombinator'
  return 'Weapon Recombinator'
}

export function estimateRecombine(a: RecombineInput, b: RecombineInput, deps: CraftDeps): RecombineEstimate {
  const stampDate = deps.today ?? new Date().toISOString().slice(0, 10)
  const divineChaos = divineChaosOf(deps.snapshot)
  const A = toState(a), B = toState(b)
  const desired = [...A.desired, ...B.desired].filter((d, i, arr) => arr.findIndex(x => x.slot === d.slot && (x.modId ?? x.group) === (d.modId ?? d.group)) === i)
  const analysis = analyzeRecombine(A.state, B.state, desired, deps.mods)
  const outputIlvl = recombineIlvl(a.ilvl, b.ilvl)
  const recombinator = recombinatorCurrencyFor(a.itemClass)

  const ev = evaluateInputs([A.state, B.state], { mods: deps.mods, bench: deps.bench, currentLeague: deps.league },
    { desired, method: { kind: 'recombine' }, inputValuesChaos: [a.valueChaos ?? 0, b.valueChaos ?? 0] })

  const base = {
    league: deps.league, stampDate, recombinator, outputIlvl,
    prefixPool: analysis.prefixPool, suffixPool: analysis.suffixPool,
    pPrefix: analysis.pPrefix, pSuffix: analysis.pSuffix, pTarget: analysis.pTarget,
    brickProb: analysis.pTarget > 0 ? 1 - analysis.pTarget : 1, exclusiveCollision: analysis.exclusiveCollision,
    nnnLever: analysis.nnnLever, divineChaos, notes: ev.notes,
  }
  if (!ev.supported) {
    return { ...base, supported: false, reason: ev.reason, expectedAttempts: Infinity, consumables: [], totalChaos: null, totalDivine: null, risk: null, lowConfidence: true }
  }
  const { consumables, plan } = priceBlueprint(ev.blueprint!, deps.snapshot)
  const anyUnpriced = consumables.some(c => c.chaosTotal == null)
  const risk = anyUnpriced ? null : riskProfile(plan, { seed: 0x5eed })
  const totalChaos = risk ? risk.distribution.mean : null
  if (anyUnpriced) base.notes.push(`Some steps unpriced (${consumables.filter(c => c.chaosTotal == null).map(c => c.name).join(', ')}) — total incomplete.`)
  return {
    ...base, supported: true, expectedAttempts: ev.expectedAttempts, consumables,
    totalChaos, totalDivine: totalChaos != null && divineChaos ? totalChaos / divineChaos : null, risk, lowConfidence: true,
  }
}

/** Live wrapper: loads mods + snapshot, resolves the league, runs the combine. */
export async function estimateRecombineLive(a: RecombineInput, b: RecombineInput, league?: string): Promise<RecombineEstimate> {
  const resolved = league ?? (await resolveCurrentLeague())
  const [mods, baseItems, essences, fossilsRaw] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils()])
  const snapshot = await getEconomyProvider().getEconomySnapshot(resolved)
  return estimateRecombine(a, b, { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), snapshot, league: resolved })
}
