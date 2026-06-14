/**
 * services — build-cost estimation (Track B, Phase B2).
 *
 * Prices a build's gear list at current rates via the economy services and assigns a
 * budget tier (starter / functional / aspirational) in chaos + divine. Carries the
 * low-confidence discipline: thin/unpriced legs are flagged, divine-denominated sums
 * are preferred, and the league + date are stamped.
 *
 * PoB import is a future hook — for now the input is a plain item list (which is what
 * a PoB parse would reduce to anyway). `estimateBuildCost` is pure over a snapshot;
 * `estimateBuildCostLive` resolves the league + fetches prices.
 */
import { searchEconomy } from './economySearch'
import type { EconomySnapshot } from './economyTypes'
import { getEconomyProvider } from './EconomyProvider'
import { resolveCurrentLeague } from './LeagueResolver'
import { parsePobCode, type ParsedPob } from './pobParser'
import { getPobCode } from '../data/pob'

export interface GearPiece {
  /** Slot label, e.g. "Weapon", "Body Armour", "Amulet". Free-form. */
  slot: string
  /** Item name to price, e.g. "Tabula Rasa" or "Divine Orb". */
  name: string
  /** Economy category hint (unique / currency / gem …) to disambiguate the search. */
  category?: string
  /** Quantity (default 1) — e.g. for jewels or currency stacks. */
  qty?: number
}

export type BudgetTier = 'starter' | 'functional' | 'aspirational' | 'unknown'

export interface PricedPiece {
  slot: string
  name: string
  qty: number
  chaos: number | null
  divine: number | null
  lowConfidence: boolean
  note?: string
}

export type BuildCostEstimate = {
  league: string
  stampDate: string
  pieceCount: number
  pieces: PricedPiece[]
  totalChaos: number | null
  totalDivine: number | null
  divineChaos: number | null
  /** Slots that could not be priced (rares aren't indexed by aggregators). */
  unpricedSlots: string[]
  tier: BudgetTier
  lowConfidence: boolean
  notes: string[]
}

/**
 * Budget-tier thresholds in DIVINE (league-start framing). Heuristic + tunable —
 * meant to bucket a build, not to be a precise valuation.
 */
export const TIER_THRESHOLDS_DIVINE = { starter: 10, functional: 100 } as const

export function classifyTier(totalDivine: number | null): BudgetTier {
  if (totalDivine == null) return 'unknown'
  if (totalDivine <= TIER_THRESHOLDS_DIVINE.starter) return 'starter'
  if (totalDivine <= TIER_THRESHOLDS_DIVINE.functional) return 'functional'
  return 'aspirational'
}

function divineChaosOf(snapshot: EconomySnapshot): number | null {
  const m = searchEconomy(snapshot, 'Divine Orb', 'currency', 1)[0]
  return m && m.chaosValue > 0 ? m.chaosValue : null
}

export interface BuildCostDeps {
  snapshot: EconomySnapshot
  league: string
  today?: string
}

export function estimateBuildCost(items: GearPiece[], deps: BuildCostDeps): BuildCostEstimate {
  const stampDate = deps.today ?? new Date().toISOString().slice(0, 10)
  const divineChaos = divineChaosOf(deps.snapshot)
  const notes: string[] = []

  const pieces: PricedPiece[] = items.map(it => {
    const qty = it.qty ?? 1
    const m = searchEconomy(deps.snapshot, it.name, it.category, 1)[0]
    if (!m || m.chaosValue <= 0) {
      return { slot: it.slot, name: it.name, qty, chaos: null, divine: null, lowConfidence: true, note: 'no live price (rare/unindexed?)' }
    }
    const chaos = m.chaosValue * qty
    return {
      slot: it.slot, name: it.name, qty,
      chaos,
      divine: m.divineValue != null ? m.divineValue * qty : divineChaos ? chaos / divineChaos : null,
      lowConfidence: m.lowConfidence,
    }
  })

  const unpricedSlots = pieces.filter(p => p.chaos == null).map(p => p.slot)
  const pricedChaos = pieces.reduce((s, p) => s + (p.chaos ?? 0), 0)
  const anyUnpriced = unpricedSlots.length > 0
  const totalChaos = pieces.length > 0 ? pricedChaos : null
  const totalDivine = totalChaos != null && divineChaos ? totalChaos / divineChaos : null

  if (anyUnpriced) notes.push(`${unpricedSlots.length} piece(s) had no live price (${unpricedSlots.join(', ')}) — total is a LOWER BOUND.`)
  const tier = classifyTier(totalDivine)
  const lowConfidence = anyUnpriced || pieces.some(p => p.lowConfidence)
  if (lowConfidence) notes.push('LOW CONFIDENCE — prefer the divine figure; unpriced rares and thin prices make the total a floor, not a quote.')
  notes.push(`Tier thresholds (heuristic): ≤${TIER_THRESHOLDS_DIVINE.starter} div starter · ≤${TIER_THRESHOLDS_DIVINE.functional} div functional · else aspirational.`)

  return {
    league: deps.league, stampDate, pieceCount: pieces.length, pieces,
    totalChaos, totalDivine, divineChaos, unpricedSlots, tier, lowConfidence, notes,
  }
}

export async function estimateBuildCostLive(items: GearPiece[], league?: string): Promise<BuildCostEstimate> {
  const resolved = league ?? (await resolveCurrentLeague())
  const snapshot = await getEconomyProvider().getEconomySnapshot(resolved)
  return estimateBuildCost(items, { snapshot, league: resolved })
}

/**
 * Convert a parsed PoB build into a priceable gear list (the PoB import hook Track B
 * B2 left open). Uniques price by name; rares fall through to base type (unpriced,
 * flagged) since aggregators don't index them.
 */
export function gearListFromPob(pob: ParsedPob): GearPiece[] {
  const out: GearPiece[] = []
  for (const it of pob.items) {
    const isUnique = it.rarity?.toUpperCase() === 'UNIQUE'
    const name = isUnique ? it.name || it.baseType : it.baseType || it.name
    if (!name) continue
    out.push({ slot: it.slot ?? it.baseType ?? 'Item', name, category: isUnique ? 'unique' : undefined })
  }
  return out
}

/** Estimate a build's cost straight from a PoB link / export code. */
export async function estimateBuildCostFromPobLive(source: string, league?: string): Promise<BuildCostEstimate> {
  const { code } = await getPobCode(source)
  return estimateBuildCostLive(gearListFromPob(parsePobCode(code)), league)
}
