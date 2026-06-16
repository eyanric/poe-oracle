/**
 * craft query surface (the front door) — validation. Run with tsx.
 *
 *   npm run validate:query-surface
 *
 * resolve_target (stat → candidate identities) + solve_craft accepting human stat queries, composing
 * resolve → pick → solve. Ambiguous stats return the candidates (never a guessed identity). Read-only.
 */
import { resolveTargetsLive, solveCraftQuery } from '../src/services/solver.js'

const show = (label, v) => console.log(`  ${label}: ${v}`)
console.log('=== craft query surface ===\n')

// ── resolve_target: ambiguous (cross-domain), unambiguous, pseudo ────────────────
const ms = await resolveTargetsLive('increased Movement Speed', 'Iron Greaves', 84)
const msDomains = [...new Set(ms.candidates.map(c => c.domain))]
console.log('--- resolve_target ---')
show('ambiguous "increased Movement Speed" (Iron Greaves)', `${ms.candidates.length} candidates across domains [${msDomains.join(', ')}]`)
const lr = await resolveTargetsLive('increased Light Radius', 'Two-Stone Ring', 84)
const lrIds = [...new Set(lr.candidates.filter(c => !['anoint', 'synthImplicit'].includes(c.domain)).map(c => `${c.domain}|${c.group}`))]
show('unambiguous "increased Light Radius" (Ring)', `${lr.candidates.length} candidates, ${lrIds.length} affix identity (${lrIds[0]})`)
const res = await resolveTargetsLive('Resistance', 'Two-Stone Ring', 84)
show('pseudo "Resistance" (Ring)', `${res.candidates.length} candidates across ${new Set(res.candidates.map(c => c.group)).size} groups (contributing set)`)
const anoint = await resolveTargetsLive('Whispers of Doom', 'Onyx Amulet', 84)
show('anoint "Whispers of Doom" (Onyx Amulet)', `${anoint.candidates.length} candidate, domain=${anoint.candidates[0]?.domain}`)

// ── solve_craft: pinned modId (no regression), unambiguous stat, ambiguous stat ──
console.log('\n--- solve_craft ---')
const byModId = await solveCraftQuery({ base: 'Two-Stone Ring', ilvl: 84, desired: [{ modId: lr.candidates.find(c => c.domain === 'explicit')?.modId, label: 'Light Radius', slot: 'suffix' }] })
show('pinned modId target', `kind=${byModId.kind} · cheapest=${byModId.result?.cheapestPlan?.moves.map(m => m.label).join(' → ')} (${byModId.result?.cheapestPlan?.expectedChaos?.toFixed(0)}c)`)
const byStat = await solveCraftQuery({ base: 'Two-Stone Ring', ilvl: 84, desired: [{ query: 'increased Light Radius' }] })
show('unambiguous stat → solved', `kind=${byStat.kind} · cheapest=${byStat.result?.cheapestPlan?.moves.map(m => m.label).join(' → ')} (${byStat.result?.cheapestPlan?.expectedChaos?.toFixed(0)}c)`)
const amb = await solveCraftQuery({ base: 'Iron Greaves', ilvl: 84, desired: [{ query: 'increased Movement Speed' }] })
show('ambiguous stat → disambiguation (no pick)', `kind=${amb.kind} · ${amb.ambiguities?.[0]?.candidates.length} candidates offered`)
console.log(`    domains offered: ${[...new Set(amb.ambiguities?.[0]?.candidates.map(c => c.domain) ?? [])].join(', ')} — pin one, e.g. domain:'eldritch-implicit'`)
const pinned = await solveCraftQuery({ base: 'Iron Greaves', ilvl: 84, desired: [{ query: 'increased Movement Speed', domain: 'explicit' }] })
show('  same stat pinned to explicit → solved', `kind=${pinned.kind} · ${pinned.result?.cheapestPlan?.moves.map(m => m.label).join(' → ')}`)

// ── producer domains flow through: anoint → producer → plan ──────────────────────
console.log('\n--- producer domains flow through ---')
const anointSolve = await solveCraftQuery({ base: 'Onyx Amulet', ilvl: 84, desired: [{ query: 'Whispers of Doom' }] })
show('anoint stat → producer → plan', `kind=${anointSolve.kind} · ${anointSolve.result?.cheapestPlan?.moves.map(m => m.label).join(' → ')} (${anointSolve.result?.cheapestPlan?.expectedChaos?.toFixed(0)}c)`)
const synth = await resolveTargetsLive('maximum Life', 'Two-Stone Ring', 84)
const synthCand = synth.candidates.find(c => c.domain === 'synthImplicit')
show('synthesis implicit resolves', `synthImplicit candidate: ${synthCand?.modId ?? '(none matched "maximum Life" text)'} — producer = Vivid Vulture reroll (plan gated on the beast price, flagged)`)

// ── verdict + flags surfaced in the solved response ──────────────────────────────
console.log('\n--- verdict + flags surfaced ---')
const r = byStat.result
show('verdict', `${r?.verdict.decision} (${r?.verdict.confidence}) — ${r?.verdict.rationale}`)
show('cheapest-plan flags', `${r?.cheapestPlan?.flags.length ?? 0} flag(s)${r?.cheapestPlan?.flags.length ? ': ' + r.cheapestPlan.flags[0].slice(0, 60) : ''}`)

console.log('\n⚠ Disambiguation NEVER guesses: a cross-domain stat returns candidates; the caller (or UI picker) pins the identity. resolve → pick → solve is the shared front door.')
