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
import { type ItemState, type Slot, type Affix } from './itemState'
import { isNative } from './modLegality'
import type { RepoeMod } from '../data/repoe'
import type { CraftModule, InputSet, CraftDataContext, ModuleParams, OutcomeDistribution } from './craftModule'
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
 * P(all `d` desired native mods of one slot survive), with NNN reject-and-redraw.
 * Stage-A rolls the final count `c` keyed on the TOTAL pool `nTotal` (NNN padding inflates
 * it); Stage-B then selects from the `mNative` native-eligible mods only (NNN self-reject and
 * are redrawn). = Σ_c P(c | nTotal) · C(mNative−d, c'−d)/C(mNative, c'), c' = min(c, mNative, 3).
 * Exact selection given the (flagged) Stage-A table. `pSlotSurvive(n,d) = pSlotSurviveNNN(n,n,d)`.
 */
export function pSlotSurviveNNN(nTotal: number, mNative: number, d: number, dist = RECOMBINATOR_COUNT_DIST): number {
  if (d === 0) return 1
  if (d > 3 || d > mNative) return 0
  const table = dist[Math.min(nTotal, 6)] ?? [1]
  let p = 0
  for (let c = d; c < table.length; c++) {
    const cPrime = Math.min(c, mNative, 3)
    if (cPrime < d) continue
    p += table[c] * (nCr(mNative - d, cPrime - d) / nCr(mNative, cPrime))
  }
  return p
}

/** All-native slot survival (no NNN). */
export const pSlotSurvive = (n: number, d: number, dist = RECOMBINATOR_COUNT_DIST): number => pSlotSurviveNNN(n, n, d, dist)

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
  /** NNN padding lever: P(target) with the NNN pad present vs if it weren't there. */
  nnnLever: { withoutPad: number; withPad: number }
}

/** Is this pooled affix native to the chosen final base? Data-derived; falls back to the flag. */
function affixNative(affix: Affix, finalTags: Set<string>, ilvl: number, mods?: Record<string, RepoeMod>): boolean {
  const m = mods && affix.modId ? mods[affix.modId] : undefined
  return m ? isNative(m, finalTags, ilvl) : !affix.nonNative
}

interface SlotBranch { p: number; pNoPad: number; nTotal: number; mNative: number; targetNative: boolean }

function slotBranch(final: ItemState, other: ItemState, slot: Slot, desired: DesiredMod[], ilvl: number, mods?: Record<string, RepoeMod>): SlotBranch {
  const finalTags = new Set(final.tags)
  // Fractured mods are retained only if their origin base is the chosen base → drop the other's fractured.
  const pool = [...affixesOfSlot(final, slot), ...affixesOfSlot(other, slot).filter(a => !a.fractured)]
  const native = pool.filter(a => affixNative(a, finalTags, ilvl, mods))
  const dHere = desired.filter(d => d.slot === slot)
  // every desired must be present AND native on this base/branch (else it can't survive here).
  const targetNative = dHere.every(d => native.some(a => matches(d, a)))
  const d = dHere.length
  const nTotal = pool.length
  const mNative = native.length
  if (!targetNative) return { p: 0, pNoPad: 0, nTotal, mNative, targetNative: false }
  return { p: pSlotSurviveNNN(nTotal, mNative, d), pNoPad: pSlotSurviveNNN(mNative, mNative, d), nTotal, mNative, targetNative: true }
}

/**
 * Pure recombine analysis from two inputs + a desired set, NNN-aware. Computes over BOTH
 * 50/50 base-choice branches (legality flips with the chosen base) and exposes the NNN
 * padding lever. `mods` (optional) enables data-derived legality; without it, affix
 * `nonNative` flags are used. Stage-A table + exclusive set remain low-confidence.
 */
export function analyzeRecombine(a: ItemState, b: ItemState, desired: DesiredMod[], mods?: Record<string, RepoeMod>): RecombineAnalysis {
  const combinedPre = [...affixesOfSlot(a, 'prefix'), ...affixesOfSlot(b, 'prefix')]
  const combinedSuf = [...affixesOfSlot(a, 'suffix'), ...affixesOfSlot(b, 'suffix')]
  const find = (d: DesiredMod) => (d.slot === 'prefix' ? combinedPre : combinedSuf).find(x => matches(d, x))
  const empty = { pPrefix: 0, pSuffix: 0, pTarget: 0, prefixPool: combinedPre.length, suffixPool: combinedSuf.length, nnnLever: { withoutPad: 0, withPad: 0 } }

  const missing = desired.filter(d => !find(d))
  if (missing.length) {
    return { supported: false, reason: `desired mod(s) not present on either input: ${missing.map(m => m.label).join(', ')}`, exclusiveCollision: false, ...empty }
  }
  // exclusive collision: at most ONE exclusive mod survives ⇒ wanting two is impossible.
  if (desired.filter(d => find(d)?.exclusive).length > 1) {
    return { supported: true, reason: `two exclusive modifiers can't co-exist on a recombine (≤1 survives) — guaranteed brick`, exclusiveCollision: true, ...empty }
  }

  const ilvl = recombineIlvl(a.ilvl, b.ilvl)
  // both 50/50 base-choice branches; legality is computed against the chosen base.
  const branches = [{ final: a, other: b }, { final: b, other: a }].map(({ final, other }) => {
    const pre = slotBranch(final, other, 'prefix', desired, ilvl, mods)
    const suf = slotBranch(final, other, 'suffix', desired, ilvl, mods)
    return { pre, suf, joint: pre.p * suf.p, jointNoPad: pre.pNoPad * suf.pNoPad }
  })
  const avg = (f: (x: typeof branches[number]) => number) => 0.5 * f(branches[0]) + 0.5 * f(branches[1])
  return {
    supported: true,
    pPrefix: avg(b2 => b2.pre.p),
    pSuffix: avg(b2 => b2.suf.p),
    pTarget: avg(b2 => b2.joint),
    prefixPool: combinedPre.length,
    suffixPool: combinedSuf.length,
    exclusiveCollision: false,
    nnnLever: { withoutPad: avg(b2 => b2.jointNoPad), withPad: avg(b2 => b2.joint) },
  }
}

/** Recombinator currency by the item category being combined. */
function recombinatorFor(itemClass: string): string {
  const c = itemClass.toLowerCase()
  if (/ring|amulet|belt/.test(c)) return 'Jewellery Recombinator'
  if (/armour|helmet|glove|boot|shield|quiver/.test(c)) return 'Armour Recombinator'
  return 'Weapon Recombinator'
}

function evaluateRecombine(a: ItemState, b: ItemState, params: ModuleParams, mods?: Record<string, RepoeMod>): ExpectedAttemptsResult {
  const r = analyzeRecombine(a, b, params.desired, mods)
  const currency = recombinatorFor(a.itemClass)
  const ilvl = recombineIlvl(a.ilvl, b.ilvl)
  const [vA = 0, vB = 0] = params.inputValuesChaos ?? []
  const notes: string[] = [
    `Recombine (${currency}): base 50/50 of the two inputs, output ilvl ${ilvl}; pools prefix=${r.prefixPool} suffix=${r.suffixPool} (independent, NNN reject-and-redraw over both base branches).`,
    'Stage-A count distribution is a flagged representative table; Stage-B selection is exact; exclusive set + NNN replacement semantics are low-confidence. Cap 3/3.',
  ]
  if (!r.supported) return { method: 'recombine', supported: false, reason: r.reason, expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes }
  if (r.exclusiveCollision || r.pTarget <= 0) {
    return { method: 'recombine', supported: false, reason: r.reason ?? 'target set has probability 0', expectedAttempts: Infinity, perAttemptProb: 0, consumables: [], lowConfidence: true, notes }
  }
  notes.push(`P(target) ${(r.pTarget * 100).toFixed(1)}% per combine (pre ${(r.pPrefix * 100).toFixed(1)}% × suf ${(r.pSuffix * 100).toFixed(1)}%, branch-averaged); brick ≈ ${((1 - r.pTarget) * 100).toFixed(1)}%.`)
  if (r.nnnLever.withPad > r.nnnLever.withoutPad + 1e-9) {
    notes.push(`NNN padding lever: P(target) ${(r.nnnLever.withoutPad * 100).toFixed(1)}% → ${(r.nnnLever.withPad * 100).toFixed(1)}% with the non-native pad (junk inflates the count, self-rejects, freeing slots for the natives).`)
  }
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
  evaluate: (inputs: InputSet, data: CraftDataContext, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    return evaluateRecombine(a, b, params, data.mods)
  },
  applicable: (inputs: InputSet, data: CraftDataContext, params) => {
    if (inputs.length !== 2) return { ok: false, reason: 'recombine needs exactly two input items' }
    const [a, b] = inputs as readonly [ItemState, ItemState]
    const r = analyzeRecombine(a, b, params.desired, data.mods)
    return { ok: r.supported && r.pTarget > 0, reason: r.reason }
  },
  outcomes: (inputs: InputSet, data: CraftDataContext, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    return outcomes(a, b, params, evaluateRecombine(a, b, params, data.mods))
  },
  cost: (inputs: InputSet, data: CraftDataContext, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    const r = evaluateRecombine(a, b, params, data.mods)
    return { steps: r.blueprint?.steps ?? [], lowConfidence: true, notes: ['Stage-A table + exclusive set + NNN replacement are low-confidence'] }
  },
  toRiskSteps: (inputs: InputSet, data: CraftDataContext, params) => {
    const [a, b] = inputs as readonly [ItemState, ItemState]
    return evaluateRecombine(a, b, params, data.mods).blueprint?.steps ?? []
  },
}
