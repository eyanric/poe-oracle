/**
 * services — crafting METHOD-MODULE contract (multi-arity).
 *
 * The common interface every crafting method implements so the risk engine (today)
 * and the path solver (later) compose methods uniformly. Supports three shapes:
 *   1. single-item transform   — arity 1 (essence, fossil, bench, slam, …)
 *   2. two-item combine        — arity 2 (recombinators: outcome distribution over
 *      a random base + random mod selection from both inputs; mod-loss = the brick)
 *   3. resource-conditioned    — a method/resource (e.g. memory strands) that
 *      re-weights another craft's outcome distribution and depletes (see
 *      `ResourceConditioning`).
 *
 * Methods expose PURE/queryable functions (no real craft executed — a search must
 * explore paths side-effect-free). `evaluate` is the bridge to today's risk engine
 * (the expected-attempts/consumable model `craftCost` prices); the solver will consume
 * `outcomes` / `cost` / `toRiskSteps` directly.
 */
import type { ItemState, Slot } from './itemState'
import type { RepoeMod } from '../data/repoe'
import type { BenchData } from './benchCrafting'
import type { PlanStepBlueprint, ExpectedAttemptsResult, DesiredMod, CraftMethod } from './craftMethods'

/** Static (non-item-specific) data a module reads. */
export interface CraftDataContext {
  mods: Record<string, RepoeMod>
  bench?: BenchData
}

/** Arity 1 (single-item transform) or arity 2 (combine, e.g. recombinator). */
export type InputSet = readonly [ItemState] | readonly [ItemState, ItemState]

export interface OutcomeState {
  p: number
  state: ItemState
}
export interface OutcomeDistribution {
  outcomes: OutcomeState[]
  notes?: string[]
}

/** Off-market price supplied by the caller (Harvest / beast / Aisling), filled later. */
export interface ManualPrice {
  consumable: string
  chaos: number
}

export interface CostResult {
  /** Per-use steps mapped onto craftRisk; `craftCost` live-prices them. */
  steps: PlanStepBlueprint[]
  lowConfidence: boolean
  /** Consumables NOT on the open market — caller supplies a `ManualPrice` for each. */
  manualPriceHooks?: string[]
  notes?: string[]
}

export interface Applicability {
  ok: boolean
  reason?: string
  /** Slots/targets the method can act on, when relevant. */
  slots?: Slot[]
}

/**
 * A method or per-item resource that re-weights ANOTHER craft's outcome distribution
 * and is consumed per use — e.g. 3.28 memory strands biasing toward higher tiers.
 */
export interface ResourceConditioning {
  resource: string
  consumes: number
  reweight(dist: OutcomeDistribution, level: number): OutcomeDistribution
}

export interface ModuleParams {
  desired: DesiredMod[]
  method: CraftMethod
  /** Off-market prices for this use (Harvest/beast/Aisling), when applicable. */
  manualPrices?: ManualPrice[]
}

/**
 * A crafting method module. `inputs` carries 1 or 2 item states (arity); all query
 * functions are pure so a path search can explore without side effects.
 */
export interface CraftModule {
  id: string
  title: string
  arity: 1 | 2
  /**
   * Does this method respect "prefixes/suffixes cannot be changed" meta-mods?
   * Bench/slam = true; Harvest reforge = FALSE (it ignores meta-locks and will wipe
   * "locked" affixes — so `toRiskSteps` must not call such a reforge protected/safe).
   * Omitted ⇒ true.
   */
  respectsLocks?: boolean
  /** Can it act on these inputs/params? (which slots/targets). */
  applicable(inputs: InputSet, ctx: CraftDataContext, params: ModuleParams): Applicability
  /** Resulting item-state DISTRIBUTION of one use (the solver iterates this). */
  outcomes(inputs: InputSet, ctx: CraftDataContext, params: ModuleParams): OutcomeDistribution
  /** Per-use cost as craftRisk steps + flags + manual-price hooks. */
  cost(inputs: InputSet, ctx: CraftDataContext, params: ModuleParams): CostResult
  /** Map onto craftRisk step types (fixed / keep-trying / slam incl. recoverable). */
  toRiskSteps(inputs: InputSet, ctx: CraftDataContext, params: ModuleParams): PlanStepBlueprint[]
  /** Present when this module re-weights another craft's outcomes (resource-conditioned). */
  resourceConditioning?: ResourceConditioning
  /** Bridge to today's risk engine — the expected-attempts evaluation craftCost prices. */
  evaluate(inputs: InputSet, ctx: CraftDataContext, params: ModuleParams): ExpectedAttemptsResult
}

export type CraftModuleRegistry = Record<string, CraftModule>
