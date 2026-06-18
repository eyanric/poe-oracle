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
import { searchEconomy, type PriceMatch } from './economySearch'
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
  /** The item's mod lines (uniques only) — lets the variant matcher pick the build's actual variant. */
  mods?: string[]
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
  /** The specific unique variant priced (the build's actual one), e.g. "Large" or "Acceleration, Impenetrable". */
  variant?: string
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

// ── Variant-matched unique pricing ───────────────────────────────────────────
// Multi-variant uniques (Voices, Thread of Hope, Forbidden pair, Screams) list one price PER variant;
// picking the priciest listing is wrong in both directions vs the variant the build runs. The build's
// variant is recoverable from its mods, and the snapshot carries each variant as a parenthetical in
// `name`. A small per-archetype extractor + label-key join selects the right one (or flags it absent).

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')
const parenOf = (name: string): string | null => name.match(/\(([^)]*)\)\s*$/)?.[1] ?? null
const baseNameOf = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '').trim()
const firstCapture = (mods: string[], re: RegExp): string | null => {
  for (const m of mods) { const x = m.match(re); if (x) return norm(x[1]) }
  return null
}
/** Canonical key for a multi-token (e.g. Screams two shrine buffs) — order-independent. */
const tokenSet = (tokens: string[]): string | null => {
  const t = [...new Set(tokens.map(norm).filter(Boolean))].sort()
  return t.length ? t.join('|') : null
}

interface VariantSpec {
  /** The variant the build runs, from its mods (null ⇒ couldn't read it). */
  extract: (mods: string[]) => string | null
  /** The same key derived from a candidate listing's parenthetical label. */
  labelKey: (paren: string) => string | null
}
const FORBIDDEN: VariantSpec = {
  extract: mods => firstCapture(mods, /allocates (.+?) if you have/i),
  labelKey: paren => norm(paren),
}
/** Per-unique variant extractors (the four archetypes that appear in real builds). */
export const VARIANT_SPECS: Record<string, VariantSpec> = {
  'Thread of Hope': {
    extract: mods => firstCapture(mods, /only affects passives in (.+?) ring/i),
    labelKey: paren => norm(paren),
  },
  'Forbidden Flesh': FORBIDDEN,
  'Forbidden Flame': FORBIDDEN,
  'Screams of the Desiccated': {
    // the buff name is the single word immediately before "Shrine Buff" (e.g. "… Acceleration Shrine Buff …").
    extract: mods => tokenSet(mods.flatMap(m => [...m.matchAll(/(\w+) shrine buff/gi)].map(x => x[1]))),
    labelKey: paren => tokenSet(paren.split(',')),
  },
  'Voices': {
    extract: mods => firstCapture(mods, /adds (\d+) jewel socket passive skills/i),
    labelKey: paren => paren.match(/\d+/)?.[0] ?? null,
  },
}

export interface VariantPriceResult { match: PriceMatch | null; note?: string; lowConfidence: boolean }

/**
 * Price the unique variant the build actually runs. Returns `null` for an UNREGISTERED unique (caller
 * falls back). For a registered one: joins the build's extracted variant to the snapshot's per-variant
 * labels and returns the matching (preferably confident, then cheapest) listing — or `match:null` +
 * a flag when the build's variant is genuinely not listed (no substitution).
 */
export function priceUniqueForBuild(name: string, mods: string[], snapshot: EconomySnapshot): VariantPriceResult | null {
  const spec = VARIANT_SPECS[name]
  if (!spec) return null
  const want = spec.extract(mods)
  if (want == null) return null // registered but the variant mod wasn't found → fall back
  const sameName = searchEconomy(snapshot, name, 'unique', 500).filter(c => baseNameOf(c.name) === name)
  const matched = sameName.filter(c => { const p = parenOf(c.name); return p != null && spec.labelKey(p) === want })
  if (!matched.length) return { match: null, note: `variant '${want}' not listed`, lowConfidence: true }
  const confident = matched.filter(m => !m.lowConfidence)
  const pick = (confident.length ? confident : matched).sort((a, b) => a.chaosValue - b.chaosValue)[0]
  return { match: pick, lowConfidence: pick.lowConfidence }
}

export function estimateBuildCost(items: GearPiece[], deps: BuildCostDeps): BuildCostEstimate {
  const stampDate = deps.today ?? new Date().toISOString().slice(0, 10)
  const divineChaos = divineChaosOf(deps.snapshot)
  const notes: string[] = []

  const priced = (m: PriceMatch, qty: number, slot: string, name: string, lowConfidence: boolean): PricedPiece => {
    const chaos = m.chaosValue * qty
    return { slot, name, qty, chaos, divine: m.divineValue != null ? m.divineValue * qty : divineChaos ? chaos / divineChaos : null, lowConfidence }
  }

  const pieces: PricedPiece[] = items.map(it => {
    const qty = it.qty ?? 1
    // Multi-variant unique → price the variant the build actually runs (from its mods), not the priciest listing.
    if (it.category === 'unique' && it.mods?.length) {
      const vp = priceUniqueForBuild(it.name, it.mods, deps.snapshot)
      if (vp) {
        if (!vp.match) return { slot: it.slot, name: it.name, qty, chaos: null, divine: null, lowConfidence: true, note: vp.note }
        return { ...priced(vp.match, qty, it.slot, it.name, vp.lowConfidence), variant: parenOf(vp.match.name) ?? undefined }
      }
    }
    const m = searchEconomy(deps.snapshot, it.name, it.category, 1)[0]
    if (!m || m.chaosValue <= 0) {
      return { slot: it.slot, name: it.name, qty, chaos: null, divine: null, lowConfidence: true, note: 'no live price (rare/unindexed?)' }
    }
    return priced(m, qty, it.slot, it.name, m.lowConfidence)
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
    out.push({ slot: it.slot ?? it.baseType ?? 'Item', name, category: isUnique ? 'unique' : undefined, mods: isUnique ? it.mods : undefined })
  }
  return out
}

/** Estimate a build's cost straight from a PoB link / export code. */
export async function estimateBuildCostFromPobLive(source: string, league?: string): Promise<BuildCostEstimate> {
  const { code } = await getPobCode(source)
  return estimateBuildCostLive(gearListFromPob(parsePobCode(code)), league)
}
