/**
 * NNN-ladder cost TEST — GloomyC double-block shield (5×T1: 3 prefix + 2 suffix on an INT
 * Spirit Shield). Evaluates ONE fixed ladder (not the solver). Run with tsx.
 *
 *   npm run nnn:ladder
 *
 * Part A: model rung rates vs the guide's ~30% (rung 2) / ~14% (rung 3) + Stage-A sensitivity.
 * Part B: total expected cost with failure-reproduction (the new ladderCost primitive) +
 * per-rung breakdown + expected single-mod donor count. League treated as Settlers (recombine
 * is gated off in Mirage) — model validation, not a live craft recommendation.
 */
import { getMods, getBaseItems } from '../src/data/repoe.js'
import { buildSlotPool } from '../src/services/craftingModel.js'
import { isNative } from '../src/services/modLegality.js'
import { pSlotSurviveNNN, analyzeRecombine, RECOMBINATOR_COUNT_DIST } from '../src/services/recombine.js'
import { newItemState } from '../src/services/itemState.js'
import { evaluateLadder } from '../src/services/ladderCost.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

const div = (c, d) => (c == null ? '—' : `${c.toFixed(0)}c${d ? ` (${(c / d).toFixed(2)} div)` : ''}`)
console.log('=== NNN-ladder test — double-block Spirit Shield (3p2s, 5×T1) ===\n')

// ── data-grounded NNN: a STR/DEX shield mod is non-native to an INT Spirit Shield ──
const [mods, bases] = await Promise.all([getMods(), getBaseItems()])
const spirit = Object.values(bases).find(b => b.name === 'Spirit Shield' && b.release_state === 'released')
  || Object.values(bases).find(b => /Spirit Shield/.test(b.name))
const intTags = new Set(spirit.tags)
// find a mod that rolls on a STR/DEX shield base but NOT on the INT Spirit Shield
const strShield = Object.values(bases).find(b => b.item_class === 'Shield' && b.tags.includes('str_armour'))
let nnnExample
if (strShield) {
  const strPool = buildSlotPool(mods, new Set(strShield.tags), 84, 'prefix', {})
  nnnExample = strPool.find(e => !isNative(e.mod, intTags, 84))
}
console.log('--- data-grounded NNN classification ---')
console.log(`  Spirit Shield [${spirit.tags.join(', ')}]`)
console.log(nnnExample
  ? `  e.g. "${(nnnExample.mod.text || nnnExample.id)}" rolls on ${strShield.name} but isNative(Spirit Shield)=${isNative(nnnExample.mod, intTags, 84)} ⇒ NNN pad ✓`
  : '  ⚠ could not auto-locate an NNN example (representative classification assumed)')

// ── ladder compositions (REPRESENTATIVE — flagged) ─────────────────────────────
// donors padded so non-desired slots are NNN; mNative per slot = only the desired natives.
// rung1: 2 single-mod donors → 2 desired prefixes; rung2: 2 two-mod donors → 3 desired prefixes;
// rung3: 3-prefix intermediate + 2-suffix donor → 3p+2s.
const rungComp = {
  rung1: { pre: { nTotal: 6, mNative: 2, d: 2 }, suf: { nTotal: 6, mNative: 0, d: 0 } },
  rung2: { pre: { nTotal: 6, mNative: 3, d: 3 }, suf: { nTotal: 6, mNative: 0, d: 0 } },
  rung3: { pre: { nTotal: 6, mNative: 3, d: 3 }, suf: { nTotal: 6, mNative: 2, d: 2 } },
}
const rungP = (comp, dist) => pSlotSurviveNNN(comp.pre.nTotal, comp.pre.mNative, comp.pre.d, dist) * pSlotSurviveNNN(comp.suf.nTotal, comp.suf.mNative, comp.suf.d, dist)

// cross-check rung3 against analyzeRecombine (NNN-aware module) on built item-states
const aff = (g, slot, o = {}) => ({ modId: g, group: g, slot, ...o })
const item = (affixes) => newItemState({ base: 'x', itemClass: 'Shield', ilvl: 84, tags: [...intTags], affixes })
const r3inter = item([aff('P1', 'prefix'), aff('P2', 'prefix'), aff('P3', 'prefix'), aff('n1', 'suffix', { nonNative: true }), aff('n2', 'suffix', { nonNative: true }), aff('n3', 'suffix', { nonNative: true })])
const r3donor = item([aff('q1', 'prefix', { nonNative: true }), aff('q2', 'prefix', { nonNative: true }), aff('q3', 'prefix', { nonNative: true }), aff('S1', 'suffix'), aff('S2', 'suffix'), aff('s3', 'suffix', { nonNative: true })])
const r3module = analyzeRecombine(r3inter, r3donor, [
  { slot: 'prefix', group: 'P1', label: 'P1' }, { slot: 'prefix', group: 'P2', label: 'P2' }, { slot: 'prefix', group: 'P3', label: 'P3' },
  { slot: 'suffix', group: 'S1', label: 'S1' }, { slot: 'suffix', group: 'S2', label: 'S2' },
]).pTarget

// ── Part A: rung rates vs guide + Stage-A sensitivity ──────────────────────────
console.log('\n--- Part A: rung rates (model vs guide) ---')
const P = {
  rung1: rungP(rungComp.rung1, RECOMBINATOR_COUNT_DIST),
  rung2: rungP(rungComp.rung2, RECOMBINATOR_COUNT_DIST),
  rung3: rungP(rungComp.rung3, RECOMBINATOR_COUNT_DIST),
}
console.log(`  default Stage-A: rung1 ${(P.rung1 * 100).toFixed(0)}% · rung2 ${(P.rung2 * 100).toFixed(0)}% (guide ~30%) · rung3 ${(P.rung3 * 100).toFixed(0)}% (guide ~14%)`)
console.log(`  cross-check rung3 via analyzeRecombine module = ${(r3module * 100).toFixed(0)}% (matches pSlotSurviveNNN ${(P.rung3 * 100).toFixed(0)}%: ${Math.abs(r3module - P.rung3) < 1e-6})`)
// sensitivity: a less top-heavy Stage-A distribution (down-weight high counts)
const CONSERVATIVE = { ...RECOMBINATOR_COUNT_DIST, 6: [0, 0.3, 0.5, 0.2], 5: [0, 0.35, 0.45, 0.2], 4: [0, 0.4, 0.45, 0.15] }
const Pc = { rung2: rungP(rungComp.rung2, CONSERVATIVE), rung3: rungP(rungComp.rung3, CONSERVATIVE) }
console.log(`  Stage-A SENSITIVITY (conservative table): rung2 ${(Pc.rung2 * 100).toFixed(0)}% · rung3 ${(Pc.rung3 * 100).toFixed(0)}% ← rung3 lands ~guide; Stage-A is the dominant lever`)

// ── Part B: cost cascade (failure-reproduction) ────────────────────────────────
console.log('\n--- Part B: expected cost (failure-reproduction) ---')
const league = await resolveCurrentLeague()
// rung0 unit cost ≈ alt→regal for one mod (reuse the currency cost model); representative donor.
const r0 = await estimateCraftCostLive({ baseName: 'Vaal Regalia', ilvl: 84, desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'Life' }], method: { kind: 'alt-regal' } }, league)
const rung0Chaos = r0.totalChaos ?? 3
const divine = r0.divineChaos
const RECOMB_CHAOS = 20      // ⚠ recombinator currency not priced in Mirage (Settlers) — representative parameter
const PAD_CHAOS = 60         // ⚠ rung1 NNN slam-padding (bench-block + slam) — representative parameter
console.log(`  rung0 unit (alt→regal 1 mod, live): ${div(rung0Chaos, divine)} · recomb param ${RECOMB_CHAOS}c · pad param ${PAD_CHAOS}c (both flagged)`)

const buildLadder = (p) => [
  { label: 'rung0 single-mod donor', pSuccess: 1, baseProductionChaos: rung0Chaos },
  { label: 'rung1 two-mod donor (+NNN pad)', pSuccess: p.rung1, recombCostChaos: RECOMB_CHAOS, extraCostChaos: PAD_CHAOS, inputs: [{ fromRung: 0, count: 2 }] },
  { label: 'rung2 intermediate (3p)', pSuccess: p.rung2, recombCostChaos: RECOMB_CHAOS, inputs: [{ fromRung: 1, count: 2 }] },
  { label: 'rung3 final 3p2s', pSuccess: p.rung3, recombCostChaos: RECOMB_CHAOS, inputs: [{ fromRung: 2, count: 1 }, { fromRung: 1, count: 1 }] },
]
for (const [name, p] of [['default Stage-A (model)', P], ['guide-calibrated (conservative Stage-A)', { rung1: P.rung1, ...Pc }]]) {
  const res = evaluateLadder(buildLadder(p))
  console.log(`\n  [${name}] TOTAL ≈ ${div(res.totalChaos, divine)}  (UPPER BOUND)`)
  for (const r of res.rungs) console.log(`    ${r.label}: p=${(r.pSuccess * 100).toFixed(0)}% · cost/unit ${div(r.costPerUnit, divine)} · contributes ${div(r.contribution, divine)}`)
  console.log(`    expected single-mod donors consumed: ${res.expectedUnitsConsumed[0].toFixed(0)}`)
}

console.log('\n⚠ UPPER BOUND: assumes a failed recombine loses ALL inputs. Failed bases often still carry desired mods and can be re-padded/re-smashed → true cost is LOWER (partial-salvage is a future refinement).')
console.log('⚠ Rung rates use the flagged Stage-A table + representative donor compositions; recomb/pad costs are parameters. The rate calibration (Part A) dominates the cost.')
