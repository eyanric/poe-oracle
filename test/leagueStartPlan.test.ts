import { describe, it, expect } from 'vitest'
import {
  emptyLeagueStartPlan,
  validateLeagueStartPlan,
  PREDICTIVE_CAVEAT,
  type LeagueStartPlan,
} from '../src/services/leagueStartPlan'

describe('league-start plan contract', () => {
  it('blank template carries identity + the predictive caveat', () => {
    const p = emptyLeagueStartPlan('Mirage', '3.28.0', '2026-06-14')
    expect(p.league).toBe('Mirage')
    expect(p.caveats).toContain(PREDICTIVE_CAVEAT)
    expect(p.viableBuilds).toHaveLength(0)
  })

  it('a blank plan fails validation (needs builds + priorities)', () => {
    const v = validateLeagueStartPlan(emptyLeagueStartPlan('Mirage', '3.28.0', '2026-06-14'))
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/viable build/)
    expect(v.errors.join(' ')).toMatch(/farm\/flip/)
  })

  it('a fully filled plan validates, and a missing caveat is an error', () => {
    const plan: LeagueStartPlan = {
      league: 'Mirage', version: '3.28.0', generatedAt: '2026-06-14', dataAsOf: '2026-06-14',
      viableBuilds: [{ name: 'RF Juggernaut', archetype: 'Righteous Fire', budgetTier: 'starter', estCostDivine: 3, why: 'cheap, tanky, patch left RF intact', sourceHook: 'poe.ninja/builds' }],
      earlySpikes: [{ kind: 'item', subject: 'Tabula Rasa', reasoning: 'always spikes day 1', confidence: 'high' }],
      farmFlipPriorities: [{ window: '0-48h', activity: 'Heist for currency', rationale: 'liquid early' }],
      confidence: 'medium', caveats: [PREDICTIVE_CAVEAT], sources: ['poe.ninja/builds'],
    }
    expect(validateLeagueStartPlan(plan).ok).toBe(true)

    const noCaveat = { ...plan, caveats: ['something else'] }
    const v = validateLeagueStartPlan(noCaveat)
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/caveat/)
  })

  it('warns when a viable build has no costed budget', () => {
    const plan: LeagueStartPlan = {
      league: 'Mirage', version: '3.28.0', generatedAt: '2026-06-14', dataAsOf: '2026-06-14',
      viableBuilds: [{ name: 'X', archetype: 'Y', budgetTier: 'unknown', estCostDivine: null, why: 'z', sourceHook: 'q' }],
      earlySpikes: [], farmFlipPriorities: [{ window: '48-72h', activity: 'maps', rationale: 'r' }],
      confidence: 'low', caveats: [PREDICTIVE_CAVEAT], sources: [],
    }
    const v = validateLeagueStartPlan(plan)
    expect(v.ok).toBe(true)
    expect(v.warnings.join(' ')).toMatch(/no costed budget/)
  })
})
