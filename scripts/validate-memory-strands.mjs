/**
 * Memory Strands — validation (Tier-2, resource-conditioned). Run with tsx.
 *
 *   npm run validate:memory-strands
 *
 * Exercises the depleting-resource arity end-to-end: (1) strand-boosted roll vs un-stranded baseline;
 * (2) depletion + revert-at-0; (3) sequence EV across depletion; (4) Remembrance replenish;
 * (5) Unravelling consume-all gamble incl. the whiff. ⚠ magnitudes flagged. Analysis-only; read-only.
 */
import { getMods, getBaseItems } from '../src/data/repoe.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { resolveBaseModIndex } from '../src/services/modWeightIndex.js'
import { strandSequenceEV, strandBoost, STRANDS_PER_CRAFT } from '../src/services/memoryStrands.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

const league = await resolveCurrentLeague()
const [mods, bases] = await Promise.all([getMods(), getBaseItems()])
const body = Object.values(bases).find(b => b.name === 'Vaal Regalia' && b.release_state === 'released')
const idx = resolveBaseModIndex(body, mods, 84)
const desired = idx.prefixes.sort((a, b) => a.tier - b.tier || b.weight - a.weight)[0] // a high-tier prefix
console.log(`=== Memory Strands validation — ${body.name} · League: ${league} ===\n`)
console.log(`desired: ${desired.group} (T${desired.tier}) — "${(desired.text || '').replace(/\n/g, ' / ')}"`)

const run = (strands) => estimateCraftCostLive({ baseName: body.name, ilvl: 84, memoryStrands: strands, desired: [{ slot: 'prefix', group: desired.group, label: desired.group }], method: { kind: 'strand-craft', currency: 'Chaos Orb' } }, league)

// ── (1)+(3) boosted roll vs baseline + sequence EV ──────────────────────────────
console.log('\n--- (1) strand-boosted roll vs un-stranded ---')
const [s0, s100] = await Promise.all([run(0), run(100)])
console.log(`  0 strands:   P ${(s0.perAttemptProb * 100).toFixed(2)}% (boost ×${strandBoost(0).toFixed(2)}) ⇒ ~${s0.expectedAttempts.toFixed(1)} attempts`)
console.log(`  100 strands: P ${(s100.perAttemptProb * 100).toFixed(2)}% (boost ×${strandBoost(100).toFixed(2)}) ⇒ ~${s100.expectedAttempts.toFixed(1)} attempts  ← higher-tier bias`)
console.log(`  revert-at-0: 0-strand P == base weight-index roll = ${s0.perAttemptProb > 0}`)

console.log('\n--- (3) sequence EV across depletion ---')
const base = s0.perAttemptProb
for (const st of [0, 20, 50, 100]) {
  const seq = strandSequenceEV(base, st)
  console.log(`  from ${String(st).padStart(3)} strands: ~${seq.expectedAttempts.toFixed(1)} attempts (${seq.boostedCrafts} boosted crafts, ${STRANDS_PER_CRAFT}/craft) vs ${(1 / base).toFixed(1)} un-stranded`)
}
console.log('  strand-craft notes:'); for (const n of s100.notes) console.log(`    ${n}`)

// ── (2) depletion on the output state (resource-conditioned shape) ───────────────
console.log('\n--- (2) depletion (outcome state) ---')
const { CRAFT_MODULES } = await import('../src/services/craftMethods.js')
const { newItemState } = await import('../src/services/itemState.js')
const st = newItemState({ base: body.name, itemClass: body.item_class, ilvl: 84, tags: [...body.tags], resources: { memoryStrands: 100 } })
const dist = CRAFT_MODULES['strand-craft'].outcomes([st], { mods }, { desired: [{ slot: 'prefix', group: desired.group, label: 'x' }], method: { kind: 'strand-craft' } })
console.log(`  before 100 strands → after craft: ${dist.outcomes[0].state.resources.memoryStrands} strands (depleted ${STRANDS_PER_CRAFT})`)
console.log(`  resourceConditioning hook present: ${!!CRAFT_MODULES['strand-craft'].resourceConditioning} (resource=${CRAFT_MODULES['strand-craft'].resourceConditioning?.resource}, consumes=${CRAFT_MODULES['strand-craft'].resourceConditioning?.consumes})`)

// ── (4) Remembrance (replenish, normal item) ────────────────────────────────────
console.log('\n--- (4) Orb of Remembrance ---')
const rem = await estimateCraftCostLive({ baseName: body.name, ilvl: 84, rarity: 'normal', desired: [], method: { kind: 'remembrance' } }, league)
const remRare = await estimateCraftCostLive({ baseName: body.name, ilvl: 84, rarity: 'rare', desired: [], method: { kind: 'remembrance' } }, league)
console.log(`  normal item: supported=${rem.supported} ⇒ ${rem.consumables[0]?.qty}× ${rem.consumables[0]?.name}`)
console.log(`  rare item:   supported=${remRare.supported} — ${remRare.reason}`)

// ── (5) Unravelling (consume-all gamble + whiff) ────────────────────────────────
console.log('\n--- (5) Orb of Unravelling (consume-all gamble) ---')
for (const strands of [0, 10, 50, 100]) {
  const u = await estimateCraftCostLive({ baseName: body.name, ilvl: 84, memoryStrands: strands, desired: [], method: { kind: 'unravelling' } }, league)
  console.log(`  ${String(strands).padStart(3)} strands: supported=${u.supported}${u.supported ? ` — ${u.notes[0]}` : ` — ${u.reason}`}`)
}

console.log('\n⚠ strand magnitudes (boost/strand, strands/craft, unravel odds) are flagged caller-overridable constants — verify in-game.')
console.log('⚠ Unravelling is genuine RNG post-3.26.0d (can whiff entirely); ignores meta-locks; no Elevated. Hinekora\'s Lock NOT modelled.')
