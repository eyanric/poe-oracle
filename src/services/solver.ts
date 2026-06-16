/**
 * services — Path Solver: THE SPINE (increment 1) + MULTI-STEP SEARCH (increment 2).
 *
 * The differentiator. The whole method library was built on a common interface so this can exist.
 * Increment 1 (`solve`) ranks the cheapest risk-adjusted SINGLE method or ENCAPSULATED recipe.
 * Increment 2 (`searchPlans`) turns that into a bounded branch-and-bound search over method
 * SEQUENCES — scoped to PROTECT-THEN-PROCEED plans (build one side, lock it, roll the other), which
 * reuses the protection in `itemState` so there is NO cross-step failure-reproduction (deferred to
 * increment 3). The spine's single-method result is the depth-1 base case ⇒ no regression.
 *
 * Pure orchestration over the existing registry — no new mechanics. Reuses: CRAFT_MODULES /
 * evaluateMethod (action set), itemState (+ stateKey + meta-lock protection), modWeightIndex
 * (producibility), estimateCraftCost + craftRisk (cost/p50/p90/p95/brick), ladderCost (encapsulated
 * recipe), rarePricing (specific-variant buy-side). Clean-room; analysis-only; manual-invoke.
 */
import type { RepoeBaseItem } from '../data/repoe'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName } from '../data/repoe'
import { getBenchOptions } from '../data/repoe'
import { estimateCraftCost, type CraftDeps, type CraftCostEstimate, type MethodSpec, type BuySide } from './craftCost'
import type { DesiredMod } from './craftMethods'
import { normalizeBench } from './benchCrafting'
import { newItemState, stateKey, withAffix, withAnoint, withSynthImplicit, withMeta, withBlockedGroup, RARITY_CAPS, type ItemState, type Slot } from './itemState'
import { buildBaseModIndex, modRollProbability } from './modWeightIndex'
import { evaluateLadder } from './ladderCost'
import { pSlotSurviveNNN, RECOMBINATOR_COUNT_DIST } from './recombine'
import { getEconomyProvider } from './EconomyProvider'
import { resolveCurrentLeague } from './LeagueResolver'
import { estimateRarePriceLive } from './rarePricing'
import { searchEconomy } from './economySearch'
import { modProducers, classifyMod, resolveTargets, type TargetCandidate, type ModDomain } from './modProducer'
import { respectsLock, blockedOnLockedItem } from './lockMatrix'
import type { RiskCategory } from './craftRisk'

/** A specific named mod — the shape the UI per-mod picker emits. No abstract "any T1".
 *  `minTier` (opt-in) widens it to "this group at tier ≥ floor" (1 = best); absent ⇒ exact.
 *  `anoint: true` ⇒ the target is an amulet ENCHANT (the notable named by `modId`), not an affix;
 *  `synthImplicit: true` ⇒ a synthesised-item IMPLICIT (named by `modId`), also not a prefix/suffix;
 *  `slot` is then nominal/ignored — matched against the enchant/implicit slot, not prefix/suffix. */
export interface SpecificMod { slot: Slot; group?: string; modId?: string; label: string; minTier?: number; anoint?: boolean; synthImplicit?: boolean }
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
  // Anoint / synthesis-implicit targets occupy the enchant / implicit slot — affix methods can't roll
  // them, so a single such target gets ONLY its producer (empty if not in the recipe/pool).
  if (target.desired.length === 1 && (target.desired[0].anoint || target.desired[0].synthImplicit)) {
    return modProducers(target.desired[0], base, target.ilvl, deps.mods)
  }
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
    // SPECIALIZED producers (influence / eldritch / veiled) — the producer index, increment 3a.
    specs.push(...modProducers(target.desired[0], base, target.ilvl, deps.mods))
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

function solverVerdict(cheapest: { expectedChaos: number | null; p90: number | null; confidence: PathConfidence } | null, buySide: BuySide | null): SolverVerdict {
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

/** Load deps + the SPECIFIC-VARIANT buy-side (mod-filtered trade, not baseline) — shared by both wrappers. */
async function loadSolverContext(target: TargetSpec, league?: string): Promise<{ deps: CraftDeps; resolved: string; buySide: BuySide | null }> {
  const resolved = league ?? (await resolveCurrentLeague())
  const [mods, baseItems, essences, fossilsRaw, benchOptions] = await Promise.all([
    getMods(), getBaseItems(), getEssences(), getFossils(), getBenchOptions(),
  ])
  const snapshot = await getEconomyProvider().getEconomySnapshot(resolved)
  const deps: CraftDeps = { mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), bench: normalizeBench(benchOptions, mods), snapshot, league: resolved }

  let buySide: BuySide | null = null
  const base = findBase(target.base, baseItems)
  if (base && target.desired.length) {
    const est = await estimateRarePriceLive({ baseType: base.name, itemClass: base.item_class, itemLevel: target.ilvl, mods: target.desired.map(d => d.label) }, resolved)
    if (est.priced && est.range) {
      buySide = { source: 'rare-comparables', label: `${base.name} with target mods`, lowChaos: est.range.low, medianChaos: est.range.median, confidence: est.confidence, tradeUrl: est.tradeUrl, unpricedMods: est.unpricedMods, note: `${est.range.count} comparable(s)` }
    }
  }
  return { deps, resolved, buySide }
}

/** Live wrapper (increment 1): single-method/recipe ranking. */
export async function solveLive(target: TargetSpec, league?: string): Promise<SolveResult> {
  const { deps, resolved, buySide } = await loadSolverContext(target, league)
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

// ════════════════════════════════════════════════════════════════════════════════
// Increment 2 — MULTI-STEP SEARCH (protect-then-proceed)
// ════════════════════════════════════════════════════════════════════════════════

/** Search bounds (reported in the result). */
export const SOLVER_DEPTH_CAP = 6
export const SOLVER_BEAM_WIDTH = 64

export type MoveKind = 'method' | 'recipe' | 'lock' | 'unlock' | 'scour'
/** Effect on existing mods: additive (adds, destroys nothing), destructive (reforge/scour), protective (lock). */
export type MoveEffect = 'additive' | 'destructive' | 'protective'
export interface PlanMove {
  kind: MoveKind
  label: string
  chaos: number | null
  /** Risk-adjusted (p90) for this step; deterministic steps ≈ chaos. */
  p90: number | null
  perAttemptProb: number
  confidence: PathConfidence
  flags: string[]
  /** Desired mods this move lands (for method/recipe moves). */
  produces?: SpecificMod[]
  slot?: Slot
  /** How this move affects existing mods (drives the reproduction cost). */
  effect: MoveEffect
  /** Does this move respect "prefixes/suffixes cannot be changed" metamods? */
  respectsLocks: boolean
}
export interface Plan {
  moves: PlanMove[]
  expectedChaos: number | null
  /** Conservative Σ of per-step p90 (the ranking metric). */
  p90: number | null
  rankChaos: number
  confidence: PathConfidence
  flags: string[]
  depth: number
}
export interface MultiStepResult {
  base: string
  ilvl: number
  league?: string
  stampDate?: string
  desired: SpecificMod[]
  excluded: SpecificMod[]
  startKey: string
  plans: Plan[]
  cheapestPlan: Plan | null
  buySide: BuySide | null
  verdict: SolverVerdict
  search: { nodes: number; memoHits: number; pruned: number; depthCap: number; beamWidth: number }
  notes: string[]
}

// Destructive methods reforge/remove existing explicit mods (vs additive add-to-open-slot methods).
const DESTRUCTIVE_METHOD_KINDS = new Set(['alt-regal', 'chaos-spam', 'essence', 'fossil', 'harvest', 'veiled-chaos', 'strand-craft', 'eldritch-annul'])
const moveEffectOf = (methodKind: string): MoveEffect => (DESTRUCTIVE_METHOD_KINDS.has(methodKind) ? 'destructive' : 'additive')
// Lock interaction is the single source of truth in lockMatrix.ts (Harvest reforge + Scour RESPECT;
// only Awakener's / Dominance / Unravelling ignore; Essence + Fossil are BLOCKED on a locked item).
const respectsLocksOf = (methodKind: string): boolean => respectsLock(methodKind)
const minConf = (a: PathConfidence, b: PathConfidence): PathConfidence =>
  a === 'low' || b === 'low' ? 'low' : a === 'medium' || b === 'medium' ? 'medium' : 'high'
const anointId = (d: SpecificMod): string => d.modId ?? d.group ?? d.label
const modPresent = (s: ItemState, d: SpecificMod): boolean =>
  d.anoint
    ? s.anoint === anointId(d) // enchant slot — the notable, not an affix
    : d.synthImplicit
      ? (s.synthImplicits ?? []).includes(anointId(d)) // implicit slot — synthesised implicit
      : s.affixes.some(a => {
          if (a.slot !== d.slot) return false
          if (d.minTier != null && d.group) return a.group === d.group && (a.tier ?? Infinity) <= d.minTier // floored: group at tier ≤ floor
          return d.modId ? a.modId === d.modId : d.group ? a.group === d.group : false
        })
const affixOf = (d: SpecificMod) => ({ slot: d.slot, group: d.group ?? d.modId ?? d.label, modId: d.modId ?? d.group ?? d.label, tier: d.minTier })
const asRare = (s: ItemState): ItemState => (s.rarity === 'rare' ? s : { ...s, rarity: 'rare', caps: { ...RARITY_CAPS.rare } })
const priceOf = (deps: CraftDeps, name: string): number | null => { const m = searchEconomy(deps.snapshot, name, 'currency', 1)[0]; return m && m.chaosValue > 0 ? m.chaosValue : null }

interface Node {
  state: ItemState
  remaining: SpecificMod[]
  moves: PlanMove[]
  accChaos: number
  accP90: number
  confidence: PathConfidence
  flags: Set<string>
  depth: number
}
const nodeKey = (n: Node): string => `${stateKey(n.state)}||${n.remaining.map(d => d.anoint ? `anoint:${anointId(d)}` : d.synthImplicit ? `synth:${anointId(d)}` : `${d.slot}:${d.group ?? d.modId}`).sort().join(',')}`

/** A method move producing a desired subset on the current (open-slot-respecting) state. */
function methodMove(target: TargetSpec, sub: SpecificMod[], spec: MethodSpec, deps: CraftDeps): { move: PlanMove } | null {
  const cand = methodCandidate({ ...target, desired: sub }, spec, deps)
  if (!cand.supported || !Number.isFinite(cand.rankChaos)) return null
  return { move: { kind: 'method', label: cand.title, chaos: cand.expectedChaos, p90: cand.p90 ?? cand.expectedChaos, perAttemptProb: cand.perAttemptProb, confidence: cand.confidence, flags: cand.flags, produces: sub, effect: moveEffectOf(spec.kind), respectsLocks: respectsLocksOf(spec.kind) } }
}

/** Successor state after a method move lands `sub` (intended-outcome branch): add the mods to a rare item. */
function applyProduce(state: ItemState, sub: SpecificMod[]): ItemState {
  let s = asRare(state)
  for (const d of sub) {
    if (modPresent(s, d)) continue
    s = d.anoint ? withAnoint(s, anointId(d)) // anoint → enchant slot
      : d.synthImplicit ? withSynthImplicit(s, anointId(d)) // synthesis → implicit slot
      : withAffix(s, affixOf(d))
  }
  return s
}

function expand(node: Node, target: TargetSpec, base: RepoeBaseItem, deps: CraftDeps): Node[] {
  const { state, remaining } = node
  const remP = remaining.filter(d => d.slot === 'prefix' && !d.anoint && !d.synthImplicit)
  const remS = remaining.filter(d => d.slot === 'suffix' && !d.anoint && !d.synthImplicit)
  const remSlot = remaining.filter(d => d.anoint || d.synthImplicit) // enchant / implicit producers
  const present = target.desired.filter(d => modPresent(state, d))
  const lockedP = !!state.meta.lockPrefixes, lockedS = !!state.meta.lockSuffixes
  const hasLock = lockedP || lockedS
  const children: Node[] = []

  const pushChild = (move: PlanMove, nextState: ItemState): void => {
    if (move.chaos == null) return
    const remainingAfter = target.desired.filter(d => !modPresent(nextState, d))
    children.push({
      state: nextState, remaining: remainingAfter, moves: [...node.moves, move],
      accChaos: node.accChaos + move.chaos, accP90: node.accP90 + (move.p90 ?? move.chaos),
      confidence: minConf(node.confidence, move.confidence), flags: new Set([...node.flags, ...move.flags]), depth: node.depth + 1,
    })
  }

  // (a) produce-via-method: the whole remaining set (depth-1 completion) + each single affix side.
  const subsets: SpecificMod[][] = [remaining]
  if (remP.length && remS.length) { subsets.push(remP); subsets.push(remS) }
  // Each anoint / synthesis implicit is its own slot move (produced independently of affixes); only
  // split out when the target is mixed (a lone one is already covered by the whole-remaining subset).
  if (remaining.length > 1) for (const a of remSlot) subsets.push([a])
  for (const sub of subsets) {
    if (!sub.length) continue
    for (const spec of methodSpecsFor({ ...target, desired: sub }, base, deps)) {
      // BLOCKED moves (Essence / Fossil) are illegal once a Cannot-Be-Changed metamod is present — don't
      // generate them. Destructive moves are otherwise allowed; their REPRODUCTION cost (re-making what
      // they wipe, respectsLocks-aware) is charged in planExpectedCost so plans compete on true cost.
      if (hasLock && blockedOnLockedItem(spec.kind)) continue
      const mm = methodMove(target, sub, spec, deps)
      if (mm) pushChild(mm.move, applyProduce(state, sub))
    }
    // encapsulated recipe (NNN ladder) for this subset, when its shape matches.
    const rec = nnnLadderRecipe({ ...target, desired: sub }, base, deps)
    if (rec) pushChild({ kind: 'recipe', label: rec.title, chaos: rec.expectedChaos, p90: rec.expectedChaos, perAttemptProb: rec.perAttemptProb, confidence: rec.confidence, flags: rec.flags, produces: sub, effect: 'additive', respectsLocks: true }, applyProduce(state, sub))
  }

  // (b) LOCK a fully-produced side so the other side can be rolled without destroying it.
  const lockCraft = deps.bench?.meta.lockPrefixes
  const lockCraftS = deps.bench?.meta.lockSuffixes
  if (remP.length === 0 && remS.length > 0 && present.some(d => d.slot === 'prefix') && !lockedP && lockCraft) {
    const c = (priceOf(deps, lockCraft.costName) ?? 0) * lockCraft.costAmount
    pushChild({ kind: 'lock', label: 'lock prefixes (cannot be changed)', chaos: c, p90: c, perAttemptProb: 1, confidence: 'low', flags: ['⚠ bench/meta cost stale-flagged (RePoE pre-3.28)'], slot: 'prefix', effect: 'protective', respectsLocks: true }, withBlockGroups(withMeta(asRare(state), { lockPrefixes: true }), present.filter(d => d.slot === 'prefix')))
  }
  if (remS.length === 0 && remP.length > 0 && present.some(d => d.slot === 'suffix') && !lockedS && lockCraftS) {
    const c = (priceOf(deps, lockCraftS.costName) ?? 0) * lockCraftS.costAmount
    pushChild({ kind: 'lock', label: 'lock suffixes (cannot be changed)', chaos: c, p90: c, perAttemptProb: 1, confidence: 'low', flags: ['⚠ bench/meta cost stale-flagged (RePoE pre-3.28)'], slot: 'suffix', effect: 'protective', respectsLocks: true }, withBlockGroups(withMeta(asRare(state), { lockSuffixes: true }), present.filter(d => d.slot === 'suffix')))
  }

  // (c) SCOUR — reset for a fresh re-roll. RESPECTS "cannot be changed": a locked side is kept (Scour
  // removes only the unlocked mods), so no reproduction for the locked side. Memoization + b&b prevent
  // it from looping. Only meaningful when there are unlocked affixes to clear.
  const clearable = state.affixes.filter(a => !((a.slot === 'prefix' && lockedP) || (a.slot === 'suffix' && lockedS)))
  if (clearable.length) {
    const c = priceOf(deps, 'Orb of Scouring') ?? 1
    const kept = state.affixes.filter(a => (a.slot === 'prefix' && lockedP) || (a.slot === 'suffix' && lockedS))
    const scoured = newItemState({ base: base.name, itemClass: base.item_class, ilvl: target.ilvl, tags: base.tags, rarity: kept.length ? 'rare' : 'normal', affixes: kept, meta: state.meta })
    pushChild({ kind: 'scour', label: 'Orb of Scouring (reset)', chaos: c, p90: c, perAttemptProb: 1, confidence: 'high', flags: [], effect: 'destructive', respectsLocks: true }, scoured)
  }
  return children
}

const withBlockGroups = (s: ItemState, mods: SpecificMod[]): ItemState =>
  mods.reduce((acc, d) => withBlockedGroup(acc, d.group ?? d.modId ?? d.label), s)

/**
 * Expected cost of a plan WITH reproduction (increment 3b): Σ per-step cost, plus for each DESTRUCTIVE step
 * the cost of REPRODUCING every secured desired mod it destroys. "destroys" = present ∧ ¬(metamod-locked ∧
 * step respects locks) (fracture isn't tracked at plan level). This generalizes `ladderCost`'s insight (a
 * destructive step reproduces what it wipes) to a heterogeneous sequence. Protected plans have a zero
 * reproduction term ⇒ cost identical to increment 2 (no regression). The recombinator recipe keeps its own
 * probabilistic per-attempt reproduction inside `ladderCost`; this is the single-item deterministic re-make.
 */
export function planExpectedCost(moves: PlanMove[], cost: (m: PlanMove) => number = m => m.chaos ?? 0): number {
  let total = 0
  const secured: { cost: number; mods: SpecificMod[] }[] = []
  const locked = new Set<Slot>()
  for (const mv of moves) {
    const c = cost(mv)
    total += c
    if (mv.kind === 'lock' && mv.slot) { locked.add(mv.slot); continue }
    if (mv.effect === 'destructive') {
      for (const s of secured) {
        if (s.mods.some(m => !(locked.has(m.slot) && mv.respectsLocks))) total += s.cost // reproduce the wiped mod
      }
    }
    if (mv.produces?.length) secured.push({ cost: c, mods: mv.produces })
  }
  return total
}

const invCdfAttempts = (p: number): number => (p >= 1 ? 1 : Math.max(1, Math.ceil(Math.log(1 - Math.random()) / Math.log(1 - p))))
/**
 * Monte-Carlo of a plan's cost — samples geometric retries per step (+ deterministic reproduction of wiped
 * secured mods). Its mean converges to `planExpectedCost` (a sanity check on the closed form). Test-only.
 */
export function simulatePlanCost(moves: PlanMove[], runs = 20000): number {
  let sum = 0
  for (let r = 0; r < runs; r++) {
    let cost = 0
    const secured: { own: number; mods: SpecificMod[] }[] = []
    const locked = new Set<Slot>()
    for (const mv of moves) {
      const p = mv.perAttemptProb > 0 && mv.perAttemptProb <= 1 ? mv.perAttemptProb : 1
      const ownPerAttempt = (mv.chaos ?? 0) * p
      cost += invCdfAttempts(p) * ownPerAttempt
      if (mv.kind === 'lock' && mv.slot) { locked.add(mv.slot); continue }
      if (mv.effect === 'destructive') {
        for (const s of secured) if (s.mods.some(m => !(locked.has(m.slot) && mv.respectsLocks))) cost += s.own
      }
      if (mv.produces?.length) secured.push({ own: mv.chaos ?? 0, mods: mv.produces })
    }
    sum += cost
  }
  return sum / runs
}

/**
 * Bounded branch-and-bound search over method SEQUENCES (protect-then-proceed). Memoized on
 * `(stateKey, remaining)`; beam-limited frontier; depth cap. Returns ranked complete plans.
 */
export function searchPlans(target: TargetSpec, deps: CraftDeps, buySide: BuySide | null = null): MultiStepResult {
  const notes: string[] = []
  const abstract = target.desired.filter(d => !isSpecific(d))
  const base = findBase(target.base, deps.baseItems)
  const start = target.start ?? (base ? newItemState({ base: base.name, itemClass: base.item_class, ilvl: target.ilvl, tags: base.tags, rarity: 'normal' }) : newItemState({ base: target.base, itemClass: 'unknown', ilvl: target.ilvl }))
  const startKey = stateKey(start)
  const search = { nodes: 0, memoHits: 0, pruned: 0, depthCap: SOLVER_DEPTH_CAP, beamWidth: SOLVER_BEAM_WIDTH }
  const shell = (reason: string): MultiStepResult => ({ base: target.base, ilvl: target.ilvl, desired: target.desired, excluded: target.excluded ?? [], startKey, plans: [], cheapestPlan: null, buySide, verdict: { decision: 'unknown', confidence: 'low', rationale: reason }, search, notes: [reason] })
  if (abstract.length) return shell(`abstract target not supported — name the specific mod(s): ${abstract.map(a => a.label).join(', ')}. Specificity is the product.`)
  if (!base) return shell(`base item "${target.base}" not found in RePoE`)

  // Mutually-exclusive classes can't coexist on one item — reject a target mixing them.
  const classes = new Set<string>()
  for (const d of target.desired) for (const c of classifyMod(d, base, target.ilvl, deps.mods).classes) classes.add(c)
  if (classes.has('influence') && classes.has('eldritch')) {
    return shell('eldritch ⊥ influence — target mixes influence and eldritch mods, which cannot coexist on one item.')
  }
  if (classes.has('synthesis') && classes.has('eldritch')) {
    return shell('eldritch ⊥ synthesis — eldritch currency deletes synthesis implicits, so the two cannot coexist on one item.')
  }

  const startRemaining = target.desired.filter(d => !modPresent(start, d))
  let frontier: Node[] = [{ state: start, remaining: startRemaining, moves: [], accChaos: 0, accP90: 0, confidence: 'high', flags: new Set(), depth: 0 }]
  const visited = new Map<string, number>()
  const complete: Plan[] = []
  let best = Infinity // best complete plan's accP90 (branch-and-bound bound)

  while (frontier.length) {
    const next: Node[] = []
    for (const node of frontier) {
      if (node.accP90 >= best) { search.pruned++; continue } // b&b
      const key = nodeKey(node)
      const seen = visited.get(key)
      if (seen != null && seen <= node.accP90) { search.memoHits++; continue } // memoization
      visited.set(key, node.accP90)
      search.nodes++
      if (node.remaining.length === 0) { // complete plan — cost WITH reproduction (3b)
        const expectedChaos = planExpectedCost(node.moves, m => m.chaos ?? 0)
        const p90 = planExpectedCost(node.moves, m => m.p90 ?? m.chaos ?? 0)
        const plan: Plan = { moves: node.moves, expectedChaos, p90, rankChaos: p90, confidence: node.confidence, flags: [...node.flags], depth: node.depth }
        complete.push(plan)
        best = Math.min(best, plan.rankChaos) // b&b bound on true cost; accP90 (Σ, no repro) is the admissible lower bound
        continue
      }
      if (node.depth >= SOLVER_DEPTH_CAP) continue
      for (const child of expand(node, target, base, deps)) if (child.accP90 < best) next.push(child)
    }
    // beam: keep the cheapest B frontier nodes.
    frontier = next.sort((a, b) => a.accP90 - b.accP90).slice(0, SOLVER_BEAM_WIDTH)
  }

  const plans = complete.sort((a, b) => a.rankChaos - b.rankChaos)
  const cheapestPlan = plans[0] ?? null
  if (!plans.length) notes.push('no single/multi-step plan reaches this target on the core + influence/eldritch/veiled/anoint method set (synthesis producer is deferred — implicit pool not in the export).')
  if (cheapestPlan?.confidence === 'low') notes.push('⚠ cheapest plan rests on flagged low-confidence magnitudes — not authoritative; see flags.')
  notes.push(`searched ${search.nodes} nodes (memo hits ${search.memoHits}, pruned ${search.pruned}); protected + unprotected plans compete on true expected cost (destructive steps charged reproduction, respectsLocks-aware).`)

  return { base: target.base, ilvl: target.ilvl, desired: target.desired, excluded: target.excluded ?? [], startKey, plans, cheapestPlan, buySide, verdict: solverVerdict(cheapestPlan, buySide), search, notes }
}

/** Live wrapper (increment 2): multi-step ranked plans + specific-variant craft-vs-buy. */
export async function searchPlansLive(target: TargetSpec, league?: string): Promise<MultiStepResult> {
  const { deps, resolved, buySide } = await loadSolverContext(target, league)
  const result = searchPlans(target, deps, buySide)
  result.league = resolved
  result.stampDate = new Date().toISOString().slice(0, 10)
  return result
}

// ── Query surface: resolve (stat → identity) → pick → solve (the shared front door) ──

/** A target a caller can express as a human stat `query` OR a pinned identity (modId/group/+flags). */
export interface QueryTarget {
  query?: string
  slot?: Slot
  group?: string
  modId?: string
  label?: string
  minTier?: number
  /** Pin the domain to cut ambiguity (e.g. only the `influence` identity of a shared stat). */
  domain?: ModDomain
  anoint?: boolean
  synthImplicit?: boolean
}
export interface QueryCraftSpec { base: string; ilvl: number; desired: QueryTarget[]; excluded?: QueryTarget[] }

export interface ResolveTargetsResult { base: string; ilvl: number; league: string; query: string; candidates: TargetCandidate[] }

/** Live wrapper for `resolveTargets` — stat/group query → candidate identities on a base (the picker entry point). */
export async function resolveTargetsLive(query: string, baseName: string, ilvl: number, league?: string): Promise<ResolveTargetsResult> {
  const resolved = league ?? (await resolveCurrentLeague())
  const [mods, baseItems] = await Promise.all([getMods(), getBaseItems()])
  const base = findBase(baseName, baseItems)
  return { base: base?.name ?? baseName, ilvl, league: resolved, query, candidates: base ? resolveTargets(query, base, ilvl, mods) : [] }
}

interface Ambiguity { query: string; candidates: TargetCandidate[] }
export type QuerySolveResult =
  | { kind: 'solved'; result: MultiStepResult }
  | { kind: 'disambiguation'; base: string; ilvl: number; league: string; ambiguities: Ambiguity[]; message: string }
  | { kind: 'unresolved'; base: string; ilvl: number; league: string; unresolved: string[]; message: string }

const firstLine = (s: string): string => s.split('\n')[0].trim()
/** Distinct-identity key: synthesis is modId-keyed (each tier a separate reroll target); else domain|group. */
const identityKey = (c: TargetCandidate): string => (c.domain === 'synthImplicit' ? `synth|${c.modId}` : `${c.domain}|${c.group}`)

/** Map a resolved candidate (one identity, possibly several tiers) to a solver `SpecificMod`. */
function candidateToSpec(cands: TargetCandidate[], minTier?: number): SpecificMod {
  const c = cands[0]
  const label = firstLine(c.label)
  if (c.domain === 'anoint') return { slot: c.slot, modId: c.modId, label, anoint: true }
  if (c.domain === 'synthImplicit') return { slot: c.slot, modId: c.modId, label, synthImplicit: true }
  // explicit / influence / veiled / eldritch — target the GROUP (any tier; minTier widens "tier-or-better").
  return { slot: c.slot, group: c.group, label, minTier }
}

export type QueryResolution = { kind: 'spec'; spec: SpecificMod } | { kind: 'ambiguous'; candidates: TargetCandidate[] } | { kind: 'unresolved' }

/** Resolve ONE query target → a pinned spec, an ambiguity (multiple identities), or unresolved.
 *  Pure (no I/O) — the disambiguation decision the front door + UI picker share. */
export function resolveQueryTarget(t: QueryTarget, base: RepoeBaseItem, ilvl: number, mods: CraftDeps['mods']): QueryResolution {
  // Pinned identity (no query) — pass through as a SpecificMod (the existing modId-keyed path).
  if (!t.query) {
    if (!t.modId && !t.group) return { kind: 'unresolved' }
    return { kind: 'spec', spec: { slot: t.slot ?? 'prefix', group: t.group, modId: t.modId, label: t.label ?? t.modId ?? t.group ?? '?', minTier: t.minTier, anoint: t.anoint, synthImplicit: t.synthImplicit } }
  }
  const all = resolveTargets(t.query, base, ilvl, mods)
  if (!all.length) return { kind: 'unresolved' }
  // anoint/synthesis occupy the enchant/implicit slot, not an affix slot — so a bare affix query
  // defaults to the affix domains, and those producer slots are OPT-IN (pin `domain`). This avoids
  // making every "+life" query ambiguous, without ever picking between same-slot affix identities.
  const isAffix = (c: TargetCandidate): boolean => c.domain !== 'anoint' && c.domain !== 'synthImplicit'
  const affix = all.filter(isAffix)
  const pool = t.domain ? all.filter(c => c.domain === t.domain) : affix.length ? affix : all
  if (!pool.length) return { kind: 'unresolved' }
  const ids = new Map<string, TargetCandidate[]>()
  for (const c of pool) (ids.get(identityKey(c)) ?? ids.set(identityKey(c), []).get(identityKey(c))!).push(c)
  if (ids.size === 1) return { kind: 'spec', spec: candidateToSpec([...ids.values()][0], t.minTier) }
  return { kind: 'ambiguous', candidates: pool }
}

/**
 * The front door: turn a craft request whose targets may be human stat queries into a solved plan —
 * OR, when a stat maps to several distinct identities (a Hunter implicit vs a same-stat explicit), a
 * DISAMBIGUATION response listing the candidates (never guessing which the user meant). Unambiguous
 * stats and pinned modIds proceed straight to `searchPlans`. Mirrors the UI picker's resolve→pick→solve.
 */
export async function solveCraftQuery(input: QueryCraftSpec, league?: string): Promise<QuerySolveResult> {
  const resolved = league ?? (await resolveCurrentLeague())
  const [mods, baseItems] = await Promise.all([getMods(), getBaseItems()])
  const base = findBase(input.base, baseItems)
  if (!base) return { kind: 'unresolved', base: input.base, ilvl: input.ilvl, league: resolved, unresolved: [input.base], message: `base item "${input.base}" not found in RePoE` }

  const desired: SpecificMod[] = []
  const excluded: SpecificMod[] = []
  const ambiguities: Ambiguity[] = []
  const unresolved: string[] = []
  for (const [list, out] of [[input.desired, desired], [input.excluded ?? [], excluded]] as const) {
    for (const t of list) {
      const r = resolveQueryTarget(t, base, input.ilvl, mods)
      if (r.kind === 'spec') out.push(r.spec)
      else if (r.kind === 'ambiguous') ambiguities.push({ query: t.query!, candidates: r.candidates })
      else unresolved.push(t.query ?? t.label ?? t.modId ?? t.group ?? '?')
    }
  }
  if (ambiguities.length) {
    return { kind: 'disambiguation', base: base.name, ilvl: input.ilvl, league: resolved, ambiguities,
      message: 'Ambiguous target(s): a stat maps to multiple distinct mod identities (different domains/tiers are different crafts). Re-call solve_craft with the chosen modId (or pin `domain`/`minTier`).' }
  }
  if (unresolved.length) {
    return { kind: 'unresolved', base: base.name, ilvl: input.ilvl, league: resolved, unresolved,
      message: `Could not resolve to any mod identity on ${base.name}: ${unresolved.join(', ')}. Check the stat text, base, or ilvl.` }
  }
  const result = await searchPlansLive({ base: base.name, ilvl: input.ilvl, desired, excluded }, resolved)
  return { kind: 'solved', result }
}
