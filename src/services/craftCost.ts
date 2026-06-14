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
 */
import type { RepoeMod, RepoeBaseItem, RepoeEssence, RepoeFossil } from '../data/repoe'
import { getMods, getBaseItems, getEssences, getFossils, dedupeFossilsByName } from '../data/repoe'
import { searchEconomy } from './economySearch'
import type { EconomySnapshot } from './economyTypes'
import { getEconomyProvider } from './EconomyProvider'
import { resolveCurrentLeague } from './LeagueResolver'
import { expectedAttempts, type CraftContext, type CraftMethod, type DesiredMod } from './craftMethods'
import type { MetaMods } from './craftingModel'

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
  finished: { query: string; chaos: number | null; divine: number | null; lowConfidence: boolean } | null
  verdict: { decision: 'craft' | 'buy' | 'unknown'; marginChaos: number | null; marginDivine: number | null; rationale: string }
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
    totalChaos: null, totalDivine: null, divineChaos, finished: null,
    verdict: { decision: 'unknown', marginChaos: null, marginDivine: null, rationale: reason },
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

  // ── Price the finished item (craft-vs-buy) ────────────────────────────────
  let finished: CraftCostEstimate['finished'] = null
  if (spec.finishedItemQuery) {
    const m = searchEconomy(deps.snapshot, spec.finishedItemQuery, undefined, 1)[0]
    finished = m
      ? { query: spec.finishedItemQuery, chaos: m.chaosValue, divine: m.divineValue ?? (divineChaos ? m.chaosValue / divineChaos : null), lowConfidence: m.lowConfidence }
      : { query: spec.finishedItemQuery, chaos: null, divine: null, lowConfidence: true }
  }

  // ── Verdict ───────────────────────────────────────────────────────────────
  const lowConfidence = ev.lowConfidence || consumables.some(c => c.lowConfidence) || anyUnpriced || (finished?.lowConfidence ?? false)
  let verdict: CraftCostEstimate['verdict']
  if (finished?.chaos != null && totalChaos != null) {
    const marginChaos = finished.chaos - totalChaos
    const decision = marginChaos > 0 ? 'craft' : 'buy'
    verdict = {
      decision,
      marginChaos,
      marginDivine: divineChaos ? marginChaos / divineChaos : null,
      rationale:
        decision === 'craft'
          ? `crafting (~${fmtChaos(totalChaos, divineChaos)}) is cheaper than buying (~${fmtChaos(finished.chaos, divineChaos)}); margin ${fmtChaos(marginChaos, divineChaos)}.`
          : `buying (~${fmtChaos(finished.chaos, divineChaos)}) is cheaper than crafting (~${fmtChaos(totalChaos, divineChaos)}); craft loses ${fmtChaos(-marginChaos, divineChaos)}.`,
    }
  } else {
    verdict = {
      decision: 'unknown', marginChaos: null, marginDivine: null,
      rationale: !spec.finishedItemQuery
        ? 'no finished-item price requested — craft cost only.'
        : 'finished item or craft total could not be priced — verdict withheld.',
    }
  }
  if (lowConfidence) notes.push('LOW CONFIDENCE — prefer the divine-denominated figures; chaos micro-prices and unmodelled affix-count constants make tighter precision unreliable.')

  return {
    league: deps.league, stampDate, base: base.name, ilvl: spec.ilvl, method: ev.method, supported: true,
    expectedAttempts: ev.expectedAttempts, perAttemptProb: ev.perAttemptProb, consumables,
    totalChaos, totalDivine, divineChaos, finished, verdict, lowConfidence, notes,
  }
}

function fmtChaos(chaos: number, divineChaos: number | null): string {
  if (divineChaos && chaos >= divineChaos * 0.2) return `${(chaos / divineChaos).toFixed(2)} div`
  return `${chaos.toFixed(1)}c`
}

/** Live wrapper: loads RePoE, resolves the league, fetches the economy snapshot. */
export async function estimateCraftCostLive(spec: CraftSpec, league?: string): Promise<CraftCostEstimate> {
  const resolved = league ?? (await resolveCurrentLeague())
  const [mods, baseItems, essences, fossilsRaw] = await Promise.all([getMods(), getBaseItems(), getEssences(), getFossils()])
  const snapshot = await getEconomyProvider().getEconomySnapshot(resolved)
  return estimateCraftCost(spec, {
    mods, baseItems, essences, fossils: dedupeFossilsByName(fossilsRaw), snapshot, league: resolved,
  })
}
