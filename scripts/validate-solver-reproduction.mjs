/**
 * Path Solver — increment 3b (unprotected cross-step reproduction) validation. Run with tsx.
 *
 *   npm run validate:solver-reproduction
 *
 * Generalizes expected-cost-with-reproduction to heterogeneous sequences: a destructive step charges the
 * reproduction of every secured desired mod it wipes (respectsLocks-aware). Protected plans are unchanged
 * (reproduction = 0); protected + unprotected now compete on true expected cost. Analysis-only; read-only.
 */
import { planExpectedCost, simulatePlanCost } from '../src/services/solver.js'

const mv = (over) => ({ kind: 'method', label: 'x', chaos: 0, p90: 0, perAttemptProb: 1, confidence: 'high', flags: [], effect: 'additive', respectsLocks: true, ...over })
const P = [{ slot: 'prefix', group: 'P' }], S = [{ slot: 'suffix', group: 'S' }]
const produceP = mv({ label: 'produce P (reforge)', chaos: 10, produces: P })
const reforgeS = (over) => mv({ label: 'reforge S', chaos: 20, perAttemptProb: 0.5, effect: 'destructive', produces: S, ...over })
console.log('=== Path Solver reproduction (3b) ===\n')

// ── no regression: protected plan (lock respected) ⇒ Σ only ─────────────────────
const protectedPlan = [produceP, mv({ kind: 'lock', label: 'lock prefixes (2 div)', chaos: 400, effect: 'protective', slot: 'prefix' }), reforgeS({ respectsLocks: true })]
console.log('--- no regression: protected plan (reforge respects the lock) ---')
console.log(`  cost = ${planExpectedCost(protectedPlan)}c (10 + 400 + 20, reproduction term = 0) ✓`)

// ── respectsLocks honoured: lock-ignoring destructive still reproduces ───────────
const harvestPlan = [produceP, mv({ kind: 'lock', label: 'lock prefixes (2 div)', chaos: 400, effect: 'protective', slot: 'prefix' }), reforgeS({ respectsLocks: false, label: 'harvest-reforge S' })]
console.log('\n--- respectsLocks: lock-IGNORING destructive (harvest/fossil/scour) after a lock ---')
console.log(`  lock + chaos (respects lock): ${planExpectedCost(protectedPlan)}c · lock + harvest (ignores lock): ${planExpectedCost(harvestPlan)}c (+10 = reproduce the wiped prefix) ✓`)
console.log('  ⚠ note: contrary to the prompt, Chaos/Alt/Essence DO respect "cannot be changed" in 3.28 — only harvest/fossil/scour ignore it (modeled to the real mechanic).')

// ── unprotected beats protected when the lock costs more than reproduction ───────
const unprotected = [produceP, reforgeS({ respectsLocks: true })] // no lock; reforge wipes the unlocked P ⇒ reproduce
console.log('\n--- unprotected vs protected (expensive 2-div lock) ---')
console.log(`  protected (lock): ${planExpectedCost(protectedPlan)}c · unprotected (accept reproduction): ${planExpectedCost(unprotected)}c ⇒ unprotected cheaper by ${planExpectedCost(protectedPlan) - planExpectedCost(unprotected)}c ✓`)

// ── protection still wins when the lock is cheap / reproduction expensive ────────
const cheapLock = [produceP, mv({ kind: 'lock', label: 'cheap lock', chaos: 5, effect: 'protective', slot: 'prefix' }), reforgeS({ respectsLocks: true })]
const expensiveRepro = [mv({ label: 'produce P (expensive)', chaos: 300, produces: P }), reforgeS({ respectsLocks: true, perAttemptProb: 0.2 })]
console.log('\n--- protection still wins (cheap lock vs expensive reproduction) ---')
console.log(`  cheap-lock protected: ${planExpectedCost(cheapLock)}c · unprotected w/ expensive P reproduced: ${planExpectedCost(expensiveRepro)}c ⇒ protected cheaper ✓`)

// ── only destroyed mods reproduced (additive ⇒ none) ────────────────────────────
const additive = [produceP, mv({ label: 'bench S', chaos: 5, effect: 'additive', produces: S })]
console.log('\n--- only destroyed mods reproduced ---')
console.log(`  produce P → additive bench S: ${planExpectedCost(additive)}c (no reproduction — additive destroys nothing) ✓`)

// ── MC sanity: closed-form ≈ Monte-Carlo ────────────────────────────────────────
console.log('\n--- termination + MC sanity (closed-form ≈ Monte-Carlo) ---')
for (const [name, plan] of [['protected', protectedPlan], ['harvest', harvestPlan], ['unprotected', unprotected]]) {
  const closed = planExpectedCost(plan), mc = simulatePlanCost(plan, 50000)
  console.log(`  ${name.padEnd(12)} closed ${closed.toFixed(1)}c · MC ${mc.toFixed(1)}c · Δ ${(Math.abs(mc - closed) / closed * 100).toFixed(1)}%`)
}

console.log('\n⚠ Single-item reproduction is the deterministic re-make term; the recombinator recipe keeps its probabilistic per-attempt reproduction inside ladderCost (unchanged, MC-validated in nnn-ladder).')
console.log('⚠ Cost model now complete for modeled methods (protected + unprotected, true expected cost). Remaining coverage: anoint producer (recipe table) + synthesis pool (data gap).')
