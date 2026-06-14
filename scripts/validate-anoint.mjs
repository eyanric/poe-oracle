/**
 * Anointing — validation (Tier-1 deterministic module B). Run with tsx.
 *
 *   npm run validate:anoint
 *
 * Shows, live: a named notable (seed recipe) → its 3 oils priced live (deterministic, P=1);
 * explicit-oils costing for any anoint; eligibility (amulet) + abstract/unknown rejects.
 * Analysis-only; read-only. Oils now resolve from the economy snapshot (poe.watch oil category).
 */
import { getBaseItems } from '../src/data/repoe.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'

const league = await resolveCurrentLeague()
const bases = await getBaseItems()
const snap = await getEconomyProvider().getEconomySnapshot(league)
const divine = searchEconomy(snap, 'Divine Orb', 'currency', 1)[0]?.chaosValue ?? null
const div = (c) => (c == null ? '—' : `${c.toFixed(0)}c${divine ? ` (${(c / divine).toFixed(2)} div)` : ''}`)

const amulet = Object.values(bases).find(b => b.name === 'Onyx Amulet' && b.release_state === 'released')
console.log(`=== Anoint validation — ${amulet.name} · League: ${league} ===\n`)

console.log('--- oils (live, from snapshot) ---')
console.log(`  snapshot oils: ${snap.oils.length} · Golden ${div(searchEconomy(snap, 'Golden Oil', 'oil', 1)[0]?.chaosValue)} · Clear ${div(searchEconomy(snap, 'Clear Oil', 'oil', 1)[0]?.chaosValue)}`)

// ── (1) named notable (seed recipe) → 3 oils priced live ────────────────────────
console.log('\n--- (1) named notable via seed recipe (deterministic) ---')
const wod = await estimateCraftCostLive({ baseName: amulet.name, ilvl: 1, desired: [], method: { kind: 'anoint', notable: 'Whispers of Doom' } }, league)
console.log(`  ${wod.method}: ${wod.consumables.map(c => `${c.qty}× ${c.name}`).join(' + ')} ⇒ ${div(wod.totalChaos)} · risk ${wod.risk?.category ?? '—'} · P/attempt ${(wod.perAttemptProb * 100).toFixed(0)}%`)
for (const n of wod.notes) console.log(`    ${n}`)

// ── (2) explicit oils (any anoint) ──────────────────────────────────────────────
console.log('\n--- (2) explicit oils (prices any anoint) ---')
const expl = await estimateCraftCostLive({ baseName: amulet.name, ilvl: 1, desired: [], method: { kind: 'anoint', oils: ['Clear', 'Sepia', 'Amber'] } }, league)
console.log(`  ${expl.method}: ${expl.consumables.map(c => `${c.qty}× ${c.name}`).join(' + ')} ⇒ ${div(expl.totalChaos)}`)

// ── (3) eligibility + rejects ───────────────────────────────────────────────────
console.log('\n--- (3) eligibility + rejects ---')
const ring = Object.values(bases).find(b => b.name === 'Two-Stone Ring' && b.release_state === 'released')
const onRing = await estimateCraftCostLive({ baseName: ring.name, ilvl: 1, desired: [], method: { kind: 'anoint', notable: 'Whispers of Doom' } }, league)
console.log(`  anoint on a ring: supported=${onRing.supported} — ${onRing.reason}`)
const unknown = await estimateCraftCostLive({ baseName: amulet.name, ilvl: 1, desired: [], method: { kind: 'anoint', notable: 'Some Unseeded Notable' } }, league)
console.log(`  unseeded notable: supported=${unknown.supported} — ${unknown.reason}`)
const abstract = await estimateCraftCostLive({ baseName: amulet.name, ilvl: 1, desired: [], method: { kind: 'anoint' } }, league)
console.log(`  abstract (no notable/oils): supported=${abstract.supported} — ${abstract.reason}`)

console.log('\n⚠ notable→recipe table is a curated SEED (not in the export) — pass explicit oils for unseeded notables; populate from poedb.')
console.log('⚠ Variants flagged, NOT modelled: ring (Blight-ravaged), cluster jewels, Blight-unique pools, Mirage Cord Belt (would league-gate).')
