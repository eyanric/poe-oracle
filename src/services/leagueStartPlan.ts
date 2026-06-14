/**
 * services — league-start plan CONTRACT (Track B, Phase B3).
 *
 * This is the structured output the runtime workflow fills. The MCP tools supply the
 * deterministic inputs (patch notes via B1, build costs via B2); Claude supplies the
 * meta/build-popularity reasoning at runtime (web search over poe.ninja/builds,
 * Maxroll, etc. — deliberately NOT in the MCP). This module defines the shape both
 * sides agree on, a blank template, and a validator that enforces the honesty caveat.
 */
import type { BudgetTier } from './buildCost'

export type Confidence = 'low' | 'medium' | 'high'

export interface ViableBuild {
  name: string
  archetype: string
  budgetTier: BudgetTier
  /** From B2 cost estimation, when priced; null if not yet costed. */
  estCostDivine: number | null
  /** Why it's viable league-start — the reasoning hook (patch synergy / known meta). */
  why: string
  /** Where the meta signal came from, e.g. "poe.ninja/builds", "Maxroll guide", "patch-note synergy". */
  sourceHook: string
}

export interface EarlySpike {
  kind: 'item' | 'mechanic'
  subject: string
  reasoning: string
  confidence: Confidence
}

export interface FarmFlipPriority {
  window: '0-48h' | '48-72h'
  activity: string
  rationale: string
}

export interface LeagueStartPlan {
  league: string
  version: string
  /** When the plan was composed. */
  generatedAt: string
  /** As-of date of the underlying data (patch notes + prices). */
  dataAsOf: string
  viableBuilds: ViableBuild[]
  earlySpikes: EarlySpike[]
  farmFlipPriorities: FarmFlipPriority[]
  confidence: Confidence
  caveats: string[]
  /** Feeds/URLs consulted at runtime (transparency). */
  sources: string[]
}

/** The mandatory honesty caveat — predictions ride on the reasoning layer, not the plumbing. */
export const PREDICTIVE_CAVEAT =
  'Predictive quality depends on the runtime reasoning + live meta feeds, not on this pipeline. ' +
  'Prices and meta move fast in the first days of a league; treat as directional, re-check before committing currency.'

export function emptyLeagueStartPlan(league: string, version: string, dataAsOf: string): LeagueStartPlan {
  return {
    league,
    version,
    generatedAt: new Date().toISOString().slice(0, 10),
    dataAsOf,
    viableBuilds: [],
    earlySpikes: [],
    farmFlipPriorities: [],
    confidence: 'low',
    caveats: [PREDICTIVE_CAVEAT],
    sources: [],
  }
}

export interface PlanValidation {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** Enforce the contract: required identity, at least one of each section, and the honesty caveat. */
export function validateLeagueStartPlan(plan: LeagueStartPlan): PlanValidation {
  const errors: string[] = []
  const warnings: string[] = []
  if (!plan.league) errors.push('league is required')
  if (!plan.version) errors.push('version is required')
  if (!plan.dataAsOf) errors.push('dataAsOf is required')
  if (plan.viableBuilds.length === 0) errors.push('at least one viable build is required')
  if (plan.farmFlipPriorities.length === 0) errors.push('at least one farm/flip priority is required')
  if (!plan.caveats.some(c => /predict/i.test(c))) {
    errors.push('the predictive-quality caveat must be present (use PREDICTIVE_CAVEAT)')
  }
  if (plan.earlySpikes.length === 0) warnings.push('no early spikes listed')
  if (plan.sources.length === 0) warnings.push('no sources cited — runtime should record the feeds consulted')
  for (const b of plan.viableBuilds) {
    if (b.estCostDivine == null) warnings.push(`build "${b.name}" has no costed budget (run estimate_build_cost)`)
  }
  return { ok: errors.length === 0, errors, warnings }
}
