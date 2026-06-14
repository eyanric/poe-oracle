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
import { expectedAttempts, type CraftContext, type CraftMethod, type DesiredMod } from './craftMethods'
import { buildSlotPool, type MetaMods } from './craftingModel'
import { computePseudoTotals } from './pseudoMods'
import { estimateRarePriceLive, type RareItemSpec } from './rarePricing'

export type MethodSpec =
  | { kind: 'essence'; essenceName: string }
  | { kind: 'alt-regal' }
  | { kind: 'chaos-spam' }
  | { kind: 'fossil'; fossilNames: string[] }

export interface CraftSpec {
  baseName: string
  ilvl: number
  desired: DesiredMod[]
  method: MethodSpec
  meta?: MetaMods
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
  buyLowChaos: number | null
  buyMedianChaos: number | null
  /** Crisp margin ONLY when both sides are confident AND non-overlapping; else null. */
  marginChaos: number | null
  confidence: 'low' | 'medium' | 'high'
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
  if (m.kind === 'alt-regal' || m.kind === 'chaos-spam') return { method: m, desired: spec.desired }
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
    totalChaos: null, totalDivine: null, divineChaos, buySide: deps.buySide ?? null,
    verdict: { decision: 'unknown', craftChaos: null, buyLowChaos: null, buyMedianChaos: null, marginChaos: null, confidence: 'low', rationale: reason },
    lowConfidence: true, notes,
  })

  if (!base) return unsupportedShell(`base item "${spec.baseName}" not found in RePoE`)

  const { method, desired, error } = resolveMethod(spec, base, deps)
  if (error) return unsupportedShell(error)

  const ctx: CraftContext = { mods: deps.mods, baseTags: new Set(base.tags), ilvl: spec.ilvl, meta: spec.meta }
  const ev = expectedAttempts(ctx, desired, method)
  notes.push(...ev.notes)

  if (!ev.supported) {
    const shell = unsupportedShell(ev.reason ?? 'unsupported target/method')
    shell.method = ev.method
    return shell
  }

  // ── Price the consumables ─────────────────────────────────────────────────
  const consumables: PricedConsumable[] = ev.consumables.map(c => {
    const { chaos, low } = priceConsumable(deps.snapshot, c.name, c.category)
    return { name: c.name, qty: c.qty, chaosEach: chaos, chaosTotal: chaos != null ? chaos * c.qty : null, lowConfidence: low }
  })
  const anyUnpriced = consumables.some(c => c.chaosTotal == null)
  const totalChaos = anyUnpriced ? null : consumables.reduce((s, c) => s + (c.chaosTotal ?? 0), 0)
  const totalDivine = totalChaos != null && divineChaos ? totalChaos / divineChaos : null
  if (anyUnpriced) notes.push(`Some consumables had no live price (${consumables.filter(c => c.chaosTotal == null).map(c => c.name).join(', ')}) — total is incomplete.`)

  // ── Hedged craft-vs-buy verdict (buy side pre-resolved by the live wrapper) ──
  const craftLow = ev.lowConfidence || consumables.some(c => c.lowConfidence) || anyUnpriced
  const buySide = deps.buySide ?? null
  const verdict = hedgedVerdict(totalChaos, craftLow, buySide, divineChaos)
  // lowConfidence reflects the CRAFT-COST side; the verdict carries its own confidence.
  const lowConfidence = craftLow
  if (lowConfidence) notes.push('LOW CONFIDENCE (craft cost) — prefer the divine-denominated figures; chaos micro-prices and unmodelled affix-count constants make tighter precision unreliable.')
  if (buySide?.unpricedMods?.length) notes.push(`Buy-side could not price ${buySide.unpricedMods.length} target mod(s) (${buySide.unpricedMods.slice(0, 3).join('; ')}) — the true comparable may cost more.`)

  return {
    league: deps.league, stampDate, base: base.name, ilvl: spec.ilvl, method: ev.method, supported: true,
    expectedAttempts: ev.expectedAttempts, perAttemptProb: ev.perAttemptProb, consumables,
    totalChaos, totalDivine, divineChaos, buySide, verdict, lowConfidence, notes,
  }
}

function fmtChaos(chaos: number, divineChaos: number | null): string {
  if (divineChaos && chaos >= divineChaos * 0.2) return `${(chaos / divineChaos).toFixed(2)} div`
  return `${chaos.toFixed(1)}c`
}

/**
 * Compare the (point) expected craft cost against the buy RANGE and hedge: a crisp
 * margin is only emitted when both sides are confident AND the craft point sits clear
 * of the range. Otherwise "overlapping / no clear edge" or a confidence-capped lean.
 */
export function hedgedVerdict(
  craftChaos: number | null,
  craftLow: boolean,
  buy: BuySide | null,
  divineChaos: number | null,
): HedgedVerdict {
  if (craftChaos == null || !buy) {
    return {
      decision: 'unknown', craftChaos,
      buyLowChaos: buy?.lowChaos ?? null, buyMedianChaos: buy?.medianChaos ?? null,
      marginChaos: null, confidence: 'low',
      rationale: !buy ? 'no buy-side price available — craft cost only.' : 'craft total could not be priced — verdict withheld.',
    }
  }
  const { lowChaos, medianChaos } = buy
  const decision: HedgedVerdict['decision'] =
    craftChaos <= lowChaos ? 'craft-likely-cheaper' : craftChaos >= medianChaos ? 'buy-likely-cheaper' : 'overlapping'
  const confidence: HedgedVerdict['confidence'] =
    craftLow || buy.confidence === 'low' ? 'low' : buy.confidence === 'high' ? 'high' : 'medium'
  const bothConfident = !craftLow && buy.confidence === 'high'

  let marginChaos: number | null = null
  if (bothConfident && decision === 'craft-likely-cheaper') marginChaos = lowChaos - craftChaos
  if (bothConfident && decision === 'buy-likely-cheaper') marginChaos = craftChaos - medianChaos

  const f = (c: number) => fmtChaos(c, divineChaos)
  const buyStr = `buy ${f(lowChaos)}–${f(medianChaos)} (${buy.confidence} conf, ${buy.source})`
  const edge = marginChaos != null ? `, ~${f(marginChaos)} edge` : ' (margin not crisp — confidence capped)'
  const rationale =
    decision === 'craft-likely-cheaper'
      ? `craft ~${f(craftChaos)} vs ${buyStr} — craft likely cheaper${edge}.`
      : decision === 'buy-likely-cheaper'
        ? `craft ~${f(craftChaos)} vs ${buyStr} — buy likely cheaper${edge}.`
        : `craft ~${f(craftChaos)} sits inside the ${buyStr} — overlapping, no clear edge.`

  return { decision, craftChaos, buyLowChaos: lowChaos, buyMedianChaos: medianChaos, marginChaos, confidence, rationale }
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
  const [mods, baseItems, essences, fossilsRaw] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils()])
  const snapshot = await getEconomyProvider().getEconomySnapshot(resolved)
  const deps: CraftDeps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), snapshot, league: resolved }

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
