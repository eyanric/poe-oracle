/**
 * Catalysts — validation (Tier-1 deterministic module A). Run with tsx.
 *
 *   npm run validate:catalysts
 *
 * Shows, live: (1) magnitude scaling on a real jewellery base (Prismatic → resistance mod value
 * at 20% vs un-catalysed) + the deterministic cost to target quality; (2) the roll-weight bias is
 * NOT modelled (removed in 3.15); (3) Mirage gating of Sinistral/Dextral. Analysis-only; read-only.
 */
import { getMods, getBaseItems } from '../src/data/repoe.js'
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { magnitudeMultiplier, catalystTags, catalystEligibility } from '../src/services/catalysts.js'
import { effectiveWeight } from '../src/services/craftingModel.js'
import { newItemState } from '../src/services/itemState.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'
import { getEconomyProvider } from '../src/services/EconomyProvider.js'
import { searchEconomy } from '../src/services/economySearch.js'

const league = await resolveCurrentLeague()
const [mods, bases] = await Promise.all([getMods(), getBaseItems()])
const snap = await getEconomyProvider().getEconomySnapshot(league)
const divine = searchEconomy(snap, 'Divine Orb', 'currency', 1)[0]?.chaosValue ?? null
const div = (c) => (c == null ? '—' : `${c.toFixed(0)}c${divine ? ` (${(c / divine).toFixed(2)} div)` : ''}`)

const ring = Object.values(bases).find(b => b.name === 'Two-Stone Ring' && b.release_state === 'released')
console.log(`=== Catalysts validation — ${ring.name} · League: ${league} ===\n`)

// ── (1) magnitude scaling on a real resistance mod ──────────────────────────────
console.log('--- (1) magnitude scaling (Prismatic → resistance, 20%) ---')
const ringTags = new Set(ring.tags)
const resMod = Object.values(mods).find(m =>
  (m.generation_type === 'prefix' || m.generation_type === 'suffix') &&
  effectiveWeight(m, ringTags) > 0 && (m.implicit_tags || []).includes('resistance') && /Resistance/.test(m.text || ''))
const mult = magnitudeMultiplier(20)
console.log(`  Prismatic tags: [${catalystTags('prismatic').join(', ')}] · 20% quality ⇒ ×${mult.toFixed(2)} magnitude`)
if (resMod) {
  const maxVal = resMod.stats?.[0]?.max
  console.log(`  e.g. "${(resMod.text || '').replace(/\n/g, ' / ')}" → at 20%: top roll ${maxVal} → ${maxVal != null ? (maxVal * mult).toFixed(1) : '—'} (×${mult.toFixed(2)})`)
}

// ── deterministic cost to target quality, priced live ───────────────────────────
const r = await estimateCraftCostLive({ baseName: ring.name, ilvl: 84, desired: [], method: { kind: 'catalyst', catalyst: 'prismatic', quality: 20 } }, league)
console.log(`\n--- deterministic cost to 20% (priced live) ---`)
console.log(`  ${r.method}: ${r.consumables[0].qty} × Prismatic Catalyst @ ${div(r.consumables[0].chaosEach)} ⇒ ${div(r.totalChaos)} · risk ${r.risk?.category ?? '—'}`)
for (const n of r.notes) console.log(`    ${n}`)

// ── (3) Mirage gating of Sinistral/Dextral ──────────────────────────────────────
console.log('\n--- (3) Mirage gating (Sinistral/Dextral) ---')
const ringState = newItemState({ base: ring.name, itemClass: 'Ring', ilvl: 84, tags: [...ring.tags] })
for (const lg of [league, 'Standard']) {
  const e = catalystEligibility(ringState, 'sinistral', lg)
  console.log(`  Sinistral in "${lg}": ok=${e.ok}${e.reason ? ` — ${e.reason}` : ''}`)
}
// core catalyst (Tempering = defence) is NOT gated
console.log(`  Tempering (CORE defence catalyst) in "Standard": ok=${catalystEligibility(ringState, 'tempering', 'Standard').ok} (core — not Mirage, despite the prompt grouping)`)

console.log('\n⚠ Roll-weight bias REMOVED in 3.15.0 — catalysts only scale magnitude in 3.28 (not modelled = correct).')
console.log('⚠ Catalyst→tag map curated (PoE wiki); quality-per-catalyst is ilvl-dependent (~10–20 to cap) — flagged representative.')
