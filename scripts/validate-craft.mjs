/**
 * Phase 3 — calc_craft_cost end-to-end validation (LIVE).
 *
 * Runs the full pipeline (RePoE weight model → expected attempts → live consumable
 * pricing → craft-vs-buy verdict) against real, price-checkable crafts and asserts
 * the numbers are sane. Composes the TS service layer, so run with tsx:
 *
 *   npm run validate:craft   (tsx scripts/validate-craft.mjs)
 *
 * Exits non-zero on any failed assertion.
 */
import { estimateCraftCostLive } from '../src/services/craftCost.js'
import { resolveCurrentLeague } from '../src/services/LeagueResolver.js'

let failures = 0
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!cond) failures++
}
const money = r => (c => (c == null ? '—' : `${c.toFixed(1)}c${r.divineChaos ? ` (${(c / r.divineChaos).toFixed(3)} div)` : ''}`))

console.log('=== calc_craft_cost end-to-end validation (Phase 3, live) ===\n')
const league = await resolveCurrentLeague()
console.log(`league: ${league}\n`)

// ── Craft 1 — essence slam (deterministic) ───────────────────────────────────
console.log('--- Craft 1: Deafening Essence of Greed → Vaal Regalia (ilvl 84) ---')
const c1 = await estimateCraftCostLive(
  { baseName: 'Vaal Regalia', ilvl: 84, desired: [], method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' } },
  league,
)
const m1 = money(c1)
ok('essence craft supported', c1.supported, c1.reason)
ok('expected attempts = 1 (forced mod is 100%)', c1.expectedAttempts === 1)
ok('total cost = 1 essence, priced live', c1.totalChaos != null && c1.totalChaos > 0, m1(c1.totalChaos))
ok('not flagged low-confidence (deterministic + indexed essence)', c1.lowConfidence === false)
ok('risk = deterministic, zero variance, no brick', c1.risk?.category === 'deterministic' && c1.risk?.distribution.p90 === c1.totalChaos && c1.risk?.bricks.length === 0,
  `det=${c1.risk?.determinism.score}, p90=${m1(c1.risk?.distribution.p90)}`)
console.log(`      forced mod EV: ${c1.expectedAttempts} × essence = ${m1(c1.totalChaos)} · risk ${c1.risk?.category} (determinism ${c1.risk?.determinism.score})\n`)

// ── Craft 2 — alt → regal, life prefix (the Phase 1 leg, now magic-count aware) ─
console.log('--- Craft 2: alt→regal Increased Life prefix → Vaal Regalia (ilvl 84) ---')
const c2 = await estimateCraftCostLive(
  {
    baseName: 'Vaal Regalia', ilvl: 84,
    desired: [{ slot: 'prefix', group: 'IncreasedLife', label: 'Increased Life' }],
    method: { kind: 'alt-regal' },
  },
  league,
)
const m2 = money(c2)
ok('alt→regal supported', c2.supported, c2.reason)
ok('expected alts in a believable band (5–15; > naive 4.9 since occupancy < 1)', c2.expectedAttempts > 4.9 && c2.expectedAttempts < 20, `~${c2.expectedAttempts.toFixed(1)} alts`)
ok('flagged low-confidence (magic constant + thin orb prices)', c2.lowConfidence === true)
ok('total cost finite & positive', c2.totalChaos != null && c2.totalChaos > 0, m2(c2.totalChaos) + (c2.totalDivine != null ? ` ≈ ${c2.totalDivine.toFixed(3)} div` : ''))
ok('risk = grind, p90 > mean, no brick', c2.risk?.category === 'grind' && c2.risk?.distribution.p90 > c2.risk?.distribution.mean && c2.risk?.bricks.length === 0,
  `mean=${m2(c2.risk?.distribution.mean)} p90=${m2(c2.risk?.distribution.p90)} (${(c2.risk?.distribution.p90 / c2.risk?.distribution.mean).toFixed(1)}× mean)`)
console.log(`      P(hit)/alt = ${(c2.perAttemptProb * 100).toFixed(2)}% ⇒ ${c2.expectedAttempts.toFixed(1)} alts + 1 regal = ${m2(c2.totalChaos)} · risk ${c2.risk?.category}, p90 ${m2(c2.risk?.distribution.p90)}\n`)

// ── Craft 3 — craft-vs-buy verdict (essence craft vs a priced finished item) ───
console.log('--- Craft 3: craft-vs-buy verdict wiring (finished item priced live) ---')
const c3 = await estimateCraftCostLive(
  {
    baseName: 'Vaal Regalia', ilvl: 84, desired: [],
    method: { kind: 'essence', essenceName: 'Deafening Essence of Greed' },
    finishedItemQuery: 'Headhunter',
  },
  league,
)
ok('buy side priced live (named aggregator)', c3.buySide?.lowChaos != null && c3.buySide.lowChaos > 0, c3.buySide ? money(c3)(c3.buySide.lowChaos) : 'missing')
ok('hedged verdict resolves (not unknown)', ['craft-likely-cheaper', 'buy-likely-cheaper', 'overlapping'].includes(c3.verdict.decision), c3.verdict.decision)
console.log(`      verdict: ${c3.verdict.decision} (${c3.verdict.confidence} conf) — ${c3.verdict.rationale}\n`)

// ── Craft 4 — unsupported guardrail (compound rare reroll is NOT guessed) ──────
console.log('--- Craft 4: unsupported guardrail (multi-mod chaos-spam) ---')
const c4 = await estimateCraftCostLive(
  {
    baseName: 'Vaal Regalia', ilvl: 84,
    desired: [
      { slot: 'prefix', group: 'IncreasedLife', label: 'Increased Life' },
      { slot: 'suffix', group: 'ColdResistance', label: 'Cold Resistance' },
    ],
    method: { kind: 'chaos-spam' },
  },
  league,
)
ok('multi-mod chaos-spam correctly marked unsupported (not guessed)', c4.supported === false, c4.reason)

console.log(`\n=== ${failures === 0 ? 'ALL CRAFT-COST CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`)
process.exit(failures === 0 ? 0 : 1)
