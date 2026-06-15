/**
 * services — Path Solver, increment 1: THE SPINE.
 *
 * The differentiator. The whole method library was built on a common interface so this can exist.
 * Increment 1 stands up the spine (target → state → applicable actions → goal test → risk-adjusted
 * cost ranking) and returns a CORRECT SHALLOW result: the cheapest risk-adjusted SINGLE modeled
 * method or ENCAPSULATED multi-stage recipe that reaches the target, with craft-vs-buy.
 *
 * ⚠ Multi-step cross-module sequence search is the NEXT increment — the spine is designed to support
 * it (canonical `stateKey` present, cost function compositional) but does NOT implement it here.
 *
 * Pure orchestration over the existing registry — no new mechanics. Reuses: CRAFT_MODULES /
 * evaluateMethod (action set), itemState (+ stateKey), modWeightIndex (producibility), estimateCraftCost
 * + craftRisk (cost/p50/p90/p95/brick), ladderCost (encapsulated recipe), rarePricing (specific-variant
 * buy-side). Clean-room; analysis/information only; manual-invoke.
 */
import type { RepoeBaseItem } from '../data/repoe'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName } from '../data/repoe'
import { getBenchOptions } from '../data/repoe'
import { estimateCraftCost, type CraftDeps, type CraftCostEstimate, type MethodSpec, type BuySide } from './craftCost'
import type { DesiredMod } from './craftMethods'
import { normalizeBench } from './benchCrafting'
import { newItemState, stateKey, type ItemState, type Slot } from './itemState'
import { buildBaseModIndex, modRollProbability } from './modWeightIndex'
import { evaluateLadder } from './ladderCost'
import { pSlotSurviveNNN, RECOMBINATOR_COUNT_DIST } from './recombine'
import { getEconomyProvider } from './EconomyProvider'
import { resolveCurrentLeague } from './LeagueResolver'
import { estimateRarePriceLive } from './rarePricing'
import type { RiskCategory } from './craftRisk'

/** A specific named mod — the shape the UI per-mod picker emits. No abstract "any T1". */
export interface SpecificMod { slot: Slot; group?: string; modId?: string; label: string }
export interface TargetSpec {
  base: string
  ilvl: number
  desired: SpecificMod[]
  excluded?: SpecificMod[]
  /** Starting state; defaults to a normal/white base of `base` at `ilvl`. */
  start?: ItemState
}

export type PathConfidence = 'low' | 'medium' | 'high'
export interface CandidatePath {
  id: string
  kind: 'method' | 'recipe'
  title: string
  supported: boolean
  reason?: string
  expectedChaos: number | null
  expectedDivine: number | null
  p50: number | null
  p90: number | null
  p95: number | null
  /** Risk-adjusted figure used for ranking (p90 ?? mean). */
  rankChaos: number
  perAttemptProb: number
  riskCategory: RiskCategory | null
  confidence: PathConfidence
  /** Flagged low-confidence magnitudes the path depends on (propagated). */
  flags: string[]
}

export interface SolverVerdict {
  decision: 'craft-likely-cheaper' | 'buy-likely-cheaper' | 'overlapping' | 'unknown'
  confidence: PathConfidence
  rationale: string
}

export interface SolveResult {
  base: string
  ilvl: number
  league?: string
  stampDate?: string
  desired: SpecificMod[]
  excluded: SpecificMod[]
  /** Canonical key of the start state (dedupe/memoization seam — search lands next increment). */
  startKey: string
  paths: CandidatePath[]
  cheapest: CandidatePath | null
  buySide: BuySide | null
  verdict: SolverVerdict
  notes: string[]
}

function findBase(name: string, baseItems: Record<string, RepoeBaseItem>): RepoeBaseItem | undefined {
  const lower = name.toLowerCase()
  let fallback: RepoeBaseItem | undefined
  for (const b of Object.values(baseItems)) {
    if (b.name?.toLowerCase() !== lower) continue
    if (b.release_state === 'released') return b
    fallback ??= b
  }
  return fallback
}

const isSpecific = (m: SpecificMod): boolean => !!(m.group || m.modId)
const flagsFromNotes = (notes: string[]): string[] => notes.filter(n => n.includes('⚠'))

/**
 * Method specs to try for a target. Gated by each method's CAPACITY so a candidate genuinely
 * produces the FULL desired set (the goal test) — single-mod methods aren't proposed for multi-mod
 * targets (where they'd land only one mod and falsely report "supported"). Methods the solver can't
 * infer params for without enumeration (eldritch/influence/catalyst/anoint/veiled/synthesis/strand)
 * are deferred to the next increment.
 */
function methodSpecsFor(target: TargetSpec, base: RepoeBaseItem, deps: CraftDeps): MethodSpec[] {
  const specs: MethodSpec[] = []
  const n = target.desired.length
  const groups = new Set(target.desired.map(d => d.group).filter(Boolean) as string[])
  const benchMods = target.desired.map(d => d.label)

  if (n === 1) {
    // essence — any essence whose forced mod (for this item class) lands the desired group (deterministic).
    const seenEss = new Set<string>()
    for (const e of Object.values(deps.essences)) {
      const forcedId = e.mods?.[base.item_class]
      if (!forcedId) continue
      const g = deps.mods[forcedId]?.groups?.[0]
      if (g && groups.has(g) && !seenEss.has(e.name)) { seenEss.add(e.name); specs.push({ kind: 'essence', essenceName: e.name }) }
    }
    specs.push({ kind: 'chaos-spam' }) // single-mod rare reroll
    specs.push({ kind: 'slam' })       // single-mod open-slot add
  }
  if (n <= 2) specs.push({ kind: 'alt-regal' }) // magic 1 prefix + 1 suffix
  specs.push({ kind: 'bench', benchMods })       // bench can land multiple
  if (n >= 2) specs.push({ kind: 'multimod', benchMods })
  return specs
}

const DIV = (c: number | null, divineChaos: number | null): number | null => (c != null && divineChaos ? c / divineChaos : null)

function methodCandidate(target: TargetSpec, spec: MethodSpec, deps: CraftDeps): CandidatePath {
  const est: CraftCostEstimate = estimateCraftCost(
    { baseName: target.base, ilvl: target.ilvl, desired: target.desired as DesiredMod[], method: spec },
    deps,
  )
  const dist = est.risk?.distribution
  const rankChaos = dist?.p90 ?? est.totalChaos ?? Infinity
  return {
    id: est.method, kind: 'method', title: est.method, supported: est.supported, reason: est.reason,
    expectedChaos: est.totalChaos, expectedDivine: est.totalDivine,
    p50: dist?.p50 ?? null, p90: dist?.p90 ?? null, p95: dist?.p95 ?? null,
    rankChaos, perAttemptProb: est.perAttemptProb,
    riskCategory: est.risk?.category ?? null,
    confidence: est.lowConfidence ? 'low' : 'high',
    flags: flagsFromNotes(est.notes),
  }
}

/**
 * ENCAPSULATED multi-stage recipe: the GloomyC double-block NNN recombinator ladder, costed via
 * `ladderCost`. Applicable only to its shape (a shield with a recombinator-scale multi-mod target) —
 * so it does NOT pollute simple, benchable targets (deterministic-cheap-first). ⚠ low-confidence:
 * Stage-A count table + recomb/pad params are flagged representatives; cost is an UPPER BOUND.
 */
function nnnLadderRecipe(target: TargetSpec, base: RepoeBaseItem, deps: CraftDeps): CandidatePath | null {
  const isShield = base.item_class === 'Shield' || base.tags?.includes('shield')
  if (!isShield || target.desired.length < 4) return null // recombinator territory only

  // rung-0 = the rarest single desired mod made via alt→regal on the real base (real weight).
  let rung0 = 0
  for (const d of target.desired) {
    const r = estimateCraftCost({ baseName: target.base, ilvl: target.ilvl, desired: [d as DesiredMod], method: { kind: 'alt-regal' } }, deps)
    if (r.totalChaos != null) rung0 = Math.max(rung0, r.totalChaos)
  }
  if (rung0 <= 0) return null
  const RECOMB = 20, PAD = 60 // ⚠ flagged representative params (recomb currency unpriced in Mirage)
  const dist = RECOMBINATOR_COUNT_DIST
  // representative 3p2s NNN compositions (mirrors scripts/nnn-ladder.mjs)
  const rungP = (pre: [number, number, number], suf: [number, number, number]): number =>
    pSlotSurviveNNN(pre[0], pre[1], pre[2], dist) * pSlotSurviveNNN(suf[0], suf[1], suf[2], dist)
  const p1 = rungP([6, 2, 2], [6, 0, 0]), p2 = rungP([6, 3, 3], [6, 0, 0]), p3 = rungP([6, 3, 3], [6, 2, 2])
  const res = evaluateLadder([
    { label: 'rung0 single-mod donor', pSuccess: 1, baseProductionChaos: rung0 },
    { label: 'rung1 two-mod (+NNN pad)', pSuccess: p1, recombCostChaos: RECOMB, extraCostChaos: PAD, inputs: [{ fromRung: 0, count: 2 }] },
    { label: 'rung2 intermediate 3p', pSuccess: p2, recombCostChaos: RECOMB, inputs: [{ fromRung: 1, count: 2 }] },
    { label: 'rung3 final 3p2s', pSuccess: p3, recombCostChaos: RECOMB, inputs: [{ fromRung: 2, count: 1 }, { fromRung: 1, count: 1 }] },
  ])
  return {
    id: 'nnn-recombinator-ladder', kind: 'recipe', title: 'NNN recombinator ladder (3p2s)', supported: true,
    expectedChaos: res.totalChaos, expectedDivine: DIV(res.totalChaos, divineOf(deps)),
    p50: null, p90: null, p95: null, rankChaos: res.totalChaos, perAttemptProb: p3,
    riskCategory: 'gamble', confidence: 'low',
    flags: [
      '⚠ Stage-A count distribution + recomb/pad params are flagged representatives.',
      '⚠ cost is an UPPER BOUND (failed recombine assumed to lose all inputs).',
    ],
  }
}

function divineOf(deps: CraftDeps): number | null {
  const m = deps.snapshot.currency.find(c => c.currencyTypeName === 'Divine Orb' && c.chaosEquivalent > 0)
  return m ? m.chaosEquivalent : null
}

function solverVerdict(cheapest: CandidatePath | null, buySide: BuySide | null): SolverVerdict {
  if (!cheapest || cheapest.expectedChaos == null) return { decision: 'unknown', confidence: 'low', rationale: 'no costable craft path' }
  if (!buySide) return { decision: 'unknown', confidence: cheapest.confidence, rationale: 'no live buy-side price for the target variant' }
  const p90 = cheapest.p90 ?? cheapest.expectedChaos
  const conf: PathConfidence = cheapest.confidence === 'low' || buySide.confidence === 'low' ? 'low' : buySide.confidence
  if (p90 < buySide.lowChaos) return { decision: 'craft-likely-cheaper', confidence: conf, rationale: `craft p90 ${p90.toFixed(0)}c < buy-low ${buySide.lowChaos.toFixed(0)}c` }
  if (cheapest.expectedChaos > buySide.medianChaos) return { decision: 'buy-likely-cheaper', confidence: conf, rationale: `craft ${cheapest.expectedChaos.toFixed(0)}c > buy-median ${buySide.medianChaos.toFixed(0)}c` }
  return { decision: 'overlapping', confidence: conf, rationale: 'craft and buy ranges overlap — no clear edge' }
}

/** Pure spine over loaded data + a buy-side. Ranks single methods + encapsulated recipes. */
export function solve(target: TargetSpec, deps: CraftDeps, buySide: BuySide | null = null): SolveResult {
  const notes: string[] = []
  const abstract = target.desired.filter(d => !isSpecific(d))
  const base = findBase(target.base, deps.baseItems)
  const start = target.start ?? (base ? newItemState({ base: base.name, itemClass: base.item_class, ilvl: target.ilvl, tags: base.tags, rarity: 'normal' }) : newItemState({ base: target.base, itemClass: 'unknown', ilvl: target.ilvl }))
  const shell = (reason: string): SolveResult => ({
    base: target.base, ilvl: target.ilvl, desired: target.desired, excluded: target.excluded ?? [],
    startKey: stateKey(start), paths: [], cheapest: null, buySide, verdict: { decision: 'unknown', confidence: 'low', rationale: reason }, notes: [reason],
  })
  if (abstract.length) return shell(`abstract target not supported — name the specific mod(s): ${abstract.map(a => a.label).join(', ')}. Specificity is the product.`)
  if (!base) return shell(`base item "${target.base}" not found in RePoE`)

  const candidates: CandidatePath[] = methodSpecsFor(target, base, deps).map(spec => methodCandidate(target, spec, deps))
  const recipe = nnnLadderRecipe(target, base, deps)
  if (recipe) candidates.push(recipe)

  const supported = candidates.filter(c => c.supported && Number.isFinite(c.rankChaos)).sort((a, b) => a.rankChaos - b.rankChaos)
  const unsupported = candidates.filter(c => !c.supported || !Number.isFinite(c.rankChaos))
  const cheapest = supported[0] ?? null
  if (cheapest?.confidence === 'low') notes.push('⚠ cheapest path rests on flagged low-confidence magnitudes — not authoritative; see flags.')
  if (!supported.length) notes.push('no modeled single method or encapsulated recipe reaches this target on this base (multi-step search is the next increment).')
  notes.push('increment 1 ranks single methods + encapsulated recipes only — multi-step cross-module sequencing is the next increment.')

  return {
    base: target.base, ilvl: target.ilvl, desired: target.desired, excluded: target.excluded ?? [],
    startKey: stateKey(start),
    paths: [...supported, ...unsupported], cheapest, buySide,
    verdict: solverVerdict(cheapest, buySide), notes,
  }
}

/** Live wrapper: load data + price the SPECIFIC-VARIANT buy-side (mod-filtered), then solve. */
export async function solveLive(target: TargetSpec, league?: string): Promise<SolveResult> {
  const resolved = league ?? (await resolveCurrentLeague())
  const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([
    getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions(),
  ])
  const snapshot = await getEconomyProvider().getEconomySnapshot(resolved)
  const deps: CraftDeps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league: resolved }

  // Specific-variant buy-side: price the required roll via mod-filtered trade (not the baseline).
  let buySide: BuySide | null = null
  const base = findBase(target.base, baseItems)
  if (base && target.desired.length) {
    const est = await estimateRarePriceLive({ baseType: base.name, itemClass: base.item_class, itemLevel: target.ilvl, mods: target.desired.map(d => d.label) }, resolved)
    if (est.priced && est.range) {
      buySide = { source: 'rare-comparables', label: `${base.name} with target mods`, lowChaos: est.range.low, medianChaos: est.range.median, confidence: est.confidence, tradeUrl: est.tradeUrl, unpricedMods: est.unpricedMods, note: `${est.range.count} comparable(s)` }
    }
  }

  const result = solve(target, deps, buySide)
  result.league = resolved
  result.stampDate = new Date().toISOString().slice(0, 10)
  return result
}

/** Producibility helper (reused by the spine + exposed for tests): can the mod roll on the base? */
export function canProduceByRoll(base: RepoeBaseItem, ilvl: number, target: SpecificMod, mods: Parameters<typeof buildBaseModIndex>[4]): boolean {
  const idx = buildBaseModIndex(base.name, base.item_class, new Set(base.tags), ilvl, mods)
  return modRollProbability(idx, { affix: target.slot, group: target.group, modId: target.modId }) > 0
}
