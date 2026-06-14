/**
 * Track B — league-start pipeline DRY-RUN against 3.28 (Mirage), end to end.
 *
 *   npm run dryrun:league   (tsx scripts/dryrun-league-start-3.28.mjs)
 *
 * Proves the PLUMBING on real data: B1 parses the real 3.28 notes corpus → B2 prices
 * two known 3.28 builds LIVE → B3 assembles + validates a league-start plan. It does
 * NOT validate predictive quality (that rides on the runtime reasoning layer and is
 * only testable once 3.29 data exists). Exits non-zero on any plumbing failure.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parsePatchNotes, summarizePatchNotes } from '../src/services/patchNotesParser.js'
import { estimateBuildCostLive } from '../src/services/buildCost.js'
import { emptyLeagueStartPlan, validateLeagueStartPlan } from '../src/services/leagueStartPlan.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

let failures = 0
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}

console.log('=== Track B league-start DRY-RUN — 3.28 Mirage (plumbing only) ===\n')

// ── B1: parse the real 3.28 notes corpus ─────────────────────────────────────
console.log('--- B1: patch-notes ingestion ---')
const corpus = readFileSync(fileURLToPath(new URL('../test/fixtures/patch-notes-3.28-mirage.txt', import.meta.url)), 'utf8')
const notes = parsePatchNotes(corpus)
const sum = summarizePatchNotes(notes)
ok('league/version parsed', notes.league === 'Mirage' && notes.version === '3.28.0', `${notes.league} ${notes.version}`)
ok('every category captured something', Object.entries(sum).filter(([k]) => k !== 'sections').every(([, v]) => v > 0), JSON.stringify(sum))
console.log('      sample skills:', notes.categories.skills.slice(0, 3).map(e => e.text.split(':')[0]).join(' · '))
console.log('      sample nerfs:', notes.categories.nerfs.slice(0, 2).map(e => e.text.slice(0, 48)).join(' · '))

// ── B2: price two known 3.28 builds live ─────────────────────────────────────
console.log('\n--- B2: build-cost estimation (live) ---')
const league = await resolveCurrentLeague()
const starter = await estimateBuildCostLive(
  [
    { slot: 'Body Armour', name: 'Tabula Rasa', category: 'unique' },
    { slot: 'Helmet', name: 'Goldrim', category: 'unique' },
    { slot: 'Boots', name: 'Wanderlust', category: 'unique' },
    { slot: 'Wand', name: 'Lifesprig', category: 'unique', qty: 2 },
  ],
  league,
)
const endgame = await estimateBuildCostLive(
  [
    { slot: 'Belt', name: 'Headhunter', category: 'unique' },
    { slot: 'Flask', name: 'Mageblood', category: 'unique' },
  ],
  league,
)
const divOf = r => (r.totalDivine != null ? `${r.totalDivine.toFixed(2)} div` : '—')
ok('starter build priced & tiered', starter.totalChaos != null, `${starter.tier} · ${divOf(starter)}`)
ok('endgame build priced & tiered', endgame.totalChaos != null, `${endgame.tier} · ${divOf(endgame)}`)
console.log(`      starter pieces: ${starter.pieces.map(p => `${p.name}=${p.chaos != null ? p.chaos.toFixed(0) + 'c' : 'n/a'}`).join(', ')}`)
console.log(`      endgame pieces: ${endgame.pieces.map(p => `${p.name}=${p.chaos != null ? (p.divine ?? 0).toFixed(1) + 'd' : 'n/a'}`).join(', ')}`)

// ── B3: assemble + validate a league-start plan ──────────────────────────────
// In the real workflow Claude fills this from patch notes + live meta web search.
// Here we stand in for that reasoning layer using the real 3.28 patch signals above.
console.log('\n--- B3: synthesis against the plan contract ---')
const plan = emptyLeagueStartPlan('Mirage', '3.28.0', new Date().toISOString().slice(0, 10))
plan.viableBuilds = [
  { name: 'RF Inquisitor (league-start)', archetype: 'Righteous Fire', budgetTier: starter.tier, estCostDivine: starter.totalDivine, why: 'Holy gem additions + RF untouched; cheap tanky leveling into mapping', sourceHook: 'patch-note synergy (Holy skills) + known meta' },
  { name: 'Headhunter mapper (aspirational)', archetype: 'Speed/MF', budgetTier: endgame.tier, estCostDivine: endgame.totalDivine, why: 'Currency-larger drop pool + scarab buffs reward fast clear', sourceHook: 'patch-note (currency drop buff) + economy' },
]
plan.earlySpikes = [
  { kind: 'item', subject: 'Exalted Orb / Regal Orb', reasoning: 'patch makes Exalted & Regal "comparatively more common" + bench standardized to Exalts → early demand + supply shift', confidence: 'medium' },
  { kind: 'mechanic', subject: 'Mirage Wishes', reasoning: 'new league mechanic; loot/coin caches likely farmed hard in first days', confidence: 'low' },
]
plan.farmFlipPriorities = [
  { window: '0-48h', activity: 'Run Mirage Wishes + sell early uniques/currency', rationale: 'new-league liquidity; flip cheap starter uniques (Tabula etc.)' },
  { window: '48-72h', activity: 'Map for Voidstones; flip Exalted/Regal as bench demand ramps', rationale: 'currency-meta shift toward Exalts' },
]
plan.confidence = 'low'
plan.sources = ['pathofexile.com/forum/view-thread/3913392', 'live economy snapshot', '(runtime: poe.ninja/builds, Maxroll)']
const v = validateLeagueStartPlan(plan)
ok('assembled plan satisfies the contract', v.ok, v.errors.join('; ') || 'valid')
if (v.warnings.length) console.log('      warnings:', v.warnings.join(' · '))

console.log('\n--- Dry-run plan (3.28) ---')
for (const b of plan.viableBuilds) console.log(`  • [${b.budgetTier}] ${b.name} (~${b.estCostDivine != null ? b.estCostDivine.toFixed(2) + ' div' : '?'}) — ${b.why}`)
for (const s of plan.earlySpikes) console.log(`  ↑ ${s.subject} [${s.confidence}] — ${s.reasoning}`)
for (const f of plan.farmFlipPriorities) console.log(`  ⏱ ${f.window}: ${f.activity}`)

console.log(`\n=== ${failures === 0 ? 'DRY-RUN PLUMBING GREEN' : failures + ' PLUMBING CHECK(S) FAILED'} ===`)
console.log('NOTE: this proves plumbing/contracts/cost-math on real data — NOT predictive quality.')
process.exit(failures === 0 ? 0 : 1)
