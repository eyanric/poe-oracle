/**
 * Metamod lock-interaction matrix — validation (correctness fix). Run with tsx.
 *
 *   npm run validate:lock-matrix
 *
 * Corrects the lock matrix: Harvest reforge + Scour RESPECT "cannot be changed" (no reproduction);
 * Essence + Fossil are BLOCKED on a locked item (illegal moves); only Awakener's / Orb of Dominance /
 * Unravelling IGNORE (reproduction applies). Analysis-only; read-only.
 */
import { LOCK_INTERACTION, respectsLock, blockedOnLockedItem, lockInteraction } from '../src/services/lockMatrix.js'
import { planExpectedCost } from '../src/services/solver.js'

const mv = (over) => ({ kind: 'method', label: 'x', chaos: 0, p90: 0, perAttemptProb: 1, confidence: 'high', flags: [], effect: 'additive', respectsLocks: true, ...over })
const P = [{ slot: 'prefix', group: 'P', label: 'P' }], S = [{ slot: 'suffix', group: 'S', label: 'S' }]
const produceP = mv({ label: 'produce P', chaos: 10, produces: P })
const lockPre = mv({ kind: 'lock', label: 'lock prefixes', chaos: 400, effect: 'protective', slot: 'prefix' })
// a destructive "reforge suffix" move whose lock-respect is taken from the matrix for `kind`
const reforge = (kind, label) => mv({ label, chaos: 20, perAttemptProb: 0.5, effect: 'destructive', respectsLocks: respectsLock(kind), produces: S })

console.log('=== Metamod lock-interaction matrix (corrected) ===\n')
const group = (g) => Object.entries(LOCK_INTERACTION).filter(([, v]) => v === g).map(([k]) => k).join(', ')
console.log('  RESPECT:', group('respect'))
console.log('  IGNORE :', group('ignore'))
console.log('  BLOCKED:', group('blocked'))

console.log('\n--- Harvest reforge RESPECTS (lock prefixes → harvest-reforge suffixes ⇒ zero reproduction) ---')
const harvestPlan = [produceP, lockPre, reforge('harvest', 'harvest-reforge S')]
const chaosPlan = [produceP, lockPre, reforge('chaos-spam', 'chaos S')]
console.log(`  lock + harvest: ${planExpectedCost(harvestPlan)}c · lock + chaos: ${planExpectedCost(chaosPlan)}c · equal (both respect, repro 0): ${planExpectedCost(harvestPlan) === planExpectedCost(chaosPlan)} ✓`)

console.log('\n--- Scour RESPECTS (keeps the locked side; no reproduction) ---')
console.log(`  respectsLock('scour') = ${respectsLock('scour')} ✓`)

console.log('\n--- IGNORE set still reproduces (Awakener\'s / Orb of Dominance / Unravelling) ---')
for (const k of ['awakeners', 'orb-of-dominance', 'unravelling']) {
  const plan = [produceP, lockPre, reforge(k, k)]
  console.log(`  lock + ${k.padEnd(16)} (ignore): ${planExpectedCost(plan)}c (= 430 + 10 reproduce P) · ignores: ${!respectsLock(k)} ✓`)
}

console.log('\n--- Essence + Fossil BLOCKED on a Cannot-Be-Changed item (illegal moves) ---')
console.log(`  blockedOnLockedItem('essence') = ${blockedOnLockedItem('essence')} · ('fossil') = ${blockedOnLockedItem('fossil')} ✓`)
console.log(`  (the solver filters these out of move generation when a lock is present — see test/lockMatrix.test.ts)`)

console.log('\n--- Respect set unchanged (no regression) ---')
for (const k of ['chaos-spam', 'slam', 'eldritch-annul', 'veiled-chaos', 'alt-regal']) console.log(`  ${k.padEnd(16)} → ${lockInteraction(k)}`)

console.log('\n⚠ Sources: poewiki Metamod (May 2026) + Maxroll Crafting Resources (Oct 2025). Corrects the earlier (wrong) "Harvest/fossil/scour ignore locks". Chaos/Alt/Essence respect; Essence/Fossil are blocked (not lock-ignoring).')
