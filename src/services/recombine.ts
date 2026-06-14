/**
 * services — Recombinators (the first arity-2 / two-item combine method).
 *
 * PoE 1 Settlers-of-Kalguur ruleset (NOT the PoE 2 recombinator). Proves the arity-2
 * contract end-to-end; the same plumbing later carries Awakener's Orb (merge two
 * influences) and Synthesis (fuse fractured items).
 *
 * Mechanics modeled:
 *  - base selection 50/50; output ilvl = min(max(i1,i2), floor((i1+i2)/2)+2).
 *  - prefix and suffix pools are INDEPENDENT.
 *  - per pool: Stage A rolls the final mod COUNT (keyed on pool size — flagged table);
 *    Stage B selects WHICH mods without replacement (exact compounding).
 *  - exclusive-mod collision: ≤1 "exclusive" mod survives ⇒ wanting two is impossible (brick).
 *  - caps 3 prefix / 3 suffix.
 *
 * ⚠ DATA CONFIDENCE: the Stage-A count distribution is NOT in repoe-fork and even
 * community data is small-sample — it is a flagged representative table
 * (`costConfidence:'low'`). The exclusive-mod SET has no clean flag in the export, so
 * exclusivity is caller-supplied (`Affix.exclusive`) — structure in place, unparameterised.
 * Stage-B compounding is exact.
 */
import { type ItemState, type Slot } from './itemState'
import type { CraftModule, InputSet, ModuleParams, OutcomeDistribution } from './craftModule'
import type { ExpectedAttemptsResult, DesiredMod } from './craftMethods'

/**
 * Stage-A: pool size → P(final count) (index = count, capped at 3). Representative /
 * low-confidence — see file header. Community sample sizes are small; correct here when
 * a better source lands.
 */
export const RECOMBINATOR_COUNT_DIST: Record<number, number[]> = {
  0: [1],
  1: [0.1, 0.9],
  2: [0.05, 0.35, 0.6],
  3: [0.0, 0.25, 0.45, 0.3],
  4: [0, 0.15, 0.45, 0.4],
  5: [0, 0.1, 0.4, 0.5],
  6: [0, 0.05, 0.35, 0.6],
}

export function nCr(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

/**
 * P(all `d` desired mods of one slot survive), given a combined pool of `n` of that slot.
 * = Σ_c P(finalCount=c | n) · C(n−d, c−d)/C(n, c). Exact for the Stage-B selection.
 */
export function pSlotSurvive(n: number, d: number, dist = RECOMBINATOR_COUNT_DIST): number {
  if (d === 0) return 1
  if (d > 3 || d > n) return 0
  const table = dist[Math.min(n, 6)] ?? [1]
  let p = 0
  for (let c = d; c < table.length; c++) p += table[c] * (nCr(n - d, c - d) / nCr(n, c))
  return p
}

/** Output item level per the Settlers formula. */
export const recombineIlvl = (i1: number, i2: number): number => Math.min(Math.max(i1, i2), Math.floor((i1 + i2) / 2) + 2)

const affixesOfSlot = (s: ItemState, slot: Slot) => s.affixes.filter(a => a.slot === slot)
const matches = (d: DesiredMod, a: { modId?: string; group: string }) => (d.modId ? a.modId === d.modId : a.group === d.group)

export interface RecombineAnalysis {
  supported: boolean
  reason?: string
  pPrefix: number
  pSuffix: number
  pTarget: number
  prefixPool: number
  suffixPool: number
  exclusiveCollision: boolean
}

/** Pure recombine analysis from two input states + a desired set. */
export function analyzeRecombine(a: ItemState, b: ItemState, desired: DesiredMod[]): RecombineAnalysis {
  const combinedPre = [...affixesOfSlot(a, 'prefix'), ...affixesOfSlot(b, 'prefix')]
  const combinedSuf = [...affixesOfSlot(a, 'suffix'), ...affixesOfSlot(b, 'suffix')]
  const find = (d: DesiredMod) => (d.slot === 'prefix' ? combinedPre : combinedSuf).find(x => matches(d, x))

  // every desired mod must already exist on an input (recombine combines, never creates).
  const missing = desired.filter(d => !find(d))
  if (missing.length) {
    return { supported: false, reason: `desired mod(s) not present on either input: ${missing.map(m => m.label).join(', ')}`, pPrefix: 0, pSuffix: 0, pTarget: 0, prefixPool: combinedPre.length, suffixPool: combinedSuf.length, exclusiveCollision: false }
  }

  // exclusive collision: at most ONE exclusive mod survives ⇒ wanting two is impossible.
  const desiredExclusive = desired.filter(d => find(d)?.exclusive).length
  if (desiredExclusive > 1) {
    return { supported: true, reason: `two exclusive modifiers can't co-exist on a recombine (≤1 survives) — guaranteed brick`, pPrefix: 0, pSuffix: 0, pTarget: 0, prefixPool: combinedPre.length, suffixPool: combinedSuf.length, exclusiveCollision: true }
  }

  const dPre = desired.filter(d => d.slot === 'prefix').length
  const dSuf = desired.filter(d => d.slot === 'suffix').length
  const pPrefix = pSlotSurvive(combinedPre.length, dPre)
  const pSuffix = pSlotSurvive(combinedSuf.length, dSuf)
  return { supported: true, pPrefix, pSuffix, pTarget: pPrefix * pSuffix, prefixPool: combinedPre.length, suffixPool: combinedSuf.length, exclusiveCollision: false }
}

/** Recombinator currency by the item category being combined. */
function recombinatorFor(itemClass: string): string {
  const c = itemClass.toLowerCase()
  if (/ring|amulet|belt/.test(c)) return 'Jewellery Recombinator'
  if (/armour|helmet|glove|boot|shield|quiver/.test(c)) return 'Armour Recombinator'
  return 'Weapon Recombinator'
}

function evaluateRecombine(a: ItemState, b: ItemState, params: ModuleParams): ExpectedAttemptsResult {
  const r = analyzeRecombine(a, b, params.desired)
  const currency = recombinatorFor(a.itemClass)
  const ilvl = recombineIlvl(a.ilvl, b.ilvl)
  const [vA = 0, vB = 0] = params.inputValuesChaos ?? []
  const notes: string[] = [
    `Recombine (${currency}): base 50/50 of the two inputs, output ilvl ${ilvl}; pools prefix=${r.prefixPool} suffix=${r.suffixPool} (independent).`,
    'Stage-A count distribution is a flagged representative table; Stage-B selection is exact; exclusive set is caller-supplied (low-confidence). Cap 3/3.',
  ]
  if (!r.supported) return { method: 'recombine', supported: false, reason: r.reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes }
  if (r.exclusiveCollision || r.pTarget <= 0) {
    return { method: 'recombine', supported: false, reason: r.reason ?? 'target set has probability 0', expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes }
  }
  notes.push(`P(target) = P(prefixes ${(r.pPrefix * 100).toFixed(1)}%) × P(suffixes ${(r.pSuffix * 100).toFixed(1)}%) = ${(r.pTarget * 100).toFixed(1)}% per combine; brick (target not achieved) ≈ ${((1 - r.pTarget) * 100).toFixed(1)}%.`)
  const extra = [
    { chaos: vA, label: 'input item A', qty: 1 },
    { chaos: vB, label: 'input item B', qty: 1 },
  ]
  return {
    method: 'recombine', supported: true, expectedAttempts: 1 / r.pTarget, perAttemptProb: r.pTarget,
    consumables: [], lowConfidence: true,
    blueprint: { label: 'recombine', steps: [{ kind: 'keep-trying', label: `Recombine → target`, p: r.pTarget, consumable: { name: currency, category: 'currency' }, qty: 1, extra }] },
    notes,
  }
}

function outcomes(a: ItemState, b: ItemState, params: ModuleParams, r: ExpectedAttemptsResult): OutcomeDistribution {
  if (!r.supported) return { outcomes: [{ p: 1, state: a }], notes: [r.reason ?? 'unsupported'] }
  // 50/50 which input is the base; both carry the (target) mods on success.
  return { outcomes: [{ p: 0.5, state: a }, { p: 0.5, state: b }], notes: ['base 50/50; mod survival folded into perAttemptProb'] }
}

export const recombineModule: CraftModule = {
  id: 'recombine',
  title: 'Recombinator (combine)',
  arity: 2,
  // Recombinators are not guaranteed every league — confirm 3.28 availability. (See report.)
  leagues: ['Settlers', 'Kalguur'],
  evaluate: (inputs: InputSet, _data, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    return evaluateRecombine(a, b, params)
  },
  applicable: (inputs: InputSet, _data, params) => {
    if (inputs.length !== 2) return { ok: false, reason: 'recombine needs exactly two input items' }
    const [a, b] = inputs as readonly [ItemState, ItemState]
    const r = analyzeRecombine(a, b, params.desired)
    return { ok: r.supported && r.pTarget > 0, reason: r.reason }
  },
  outcomes: (inputs: InputSet, _data, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    return outcomes(a, b, params, evaluateRecombine(a, b, params))
  },
  cost: (inputs: InputSet, _data, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    const r = evaluateRecombine(a, b, params)
    return { steps: r.blueprint?.steps ?? [], lowConfidence: true, notes: ['Stage-A table + exclusive set are low-confidence'] }
  },
  toRiskSteps: (inputs: InputSet, _data, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    return evaluateRecombine(a, b, params).blueprint?.steps ?? []
  },
}
