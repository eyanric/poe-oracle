import { describe, it, expect } from 'vitest'
import type { RepoeMod } from '../src/data/repoe'
import { harvestModule } from '../src/services/harvest'
import { newItemState, withBlockedGroup, withMeta, type ItemState } from '../src/services/itemState'
import type { CraftDataContext, InputSet, ModuleParams } from '../src/services/craftModule'
import { harvestCraft, LIFEFORCE_BY_TAG } from '../src/data/harvestCrafts'

const mod = (group: string, tags: string[], weight = 1000): RepoeMod => ({
  domain: 'item', name: group, type: group, required_level: 1, is_essence_only: false, generation_type: 'prefix',
  groups: [group], spawn_weights: [{ tag: 'body_armour', weight }, { tag: 'default', weight: 0 }],
  generation_weights: [], implicit_tags: tags, adds_tags: [], text: `+ ${group}`,
})
const MODS: Record<string, RepoeMod> = {
  IncreasedLife: mod('IncreasedLife', ['life']),
  LifeRegeneration: mod('LifeRegeneration', ['life']),
  EnergyShield: mod('EnergyShield', ['defences'], 500),
}
const data: CraftDataContext = { mods: MODS }
const rare = (over: Partial<Parameters<typeof newItemState>[0]> = {}): ItemState =>
  newItemState({ base: 'Vaal Regalia', itemClass: 'Body Armour', ilvl: 84, tags: ['body_armour', 'default'], ...over })
const lifeTarget = { slot: 'prefix' as const, group: 'IncreasedLife', label: 'Increased Life' }
const params = (craft: 'reforge' | 'augment' | 'remove'): ModuleParams => ({ desired: [lifeTarget], method: { kind: 'harvest', craft, tag: 'life' } })

describe('Harvest data (3.28)', () => {
  it('maps life → Wild lifeforce and exposes confirmed/low confidence', () => {
    expect(LIFEFORCE_BY_TAG.life).toBe('Wild')
    expect(harvestCraft('reforge', 'fire')?.costConfidence).toBe('confirmed') // 50 Wild
    expect(harvestCraft('reforge', 'life')?.costConfidence).toBe('low') // amount unconfirmed
    expect(harvestCraft('augment', 'life')).toMatchObject({ colour: 'Wild', amount: 17500, sacred: 1 })
  })
})

describe('Harvest module on the interface', () => {
  it('is arity-1 and does NOT respect meta-locks', () => {
    expect(harvestModule.arity).toBe(1)
    expect(harvestModule.respectsLocks).toBe(false)
  })

  it('reforge-with-tag → a real distribution (tag guaranteed, target is a share)', () => {
    const r = harvestModule.evaluate([rare()] as InputSet, data, params('reforge'))
    expect(r.supported).toBe(true)
    // life pool = IncreasedLife + LifeRegeneration (both 'life') ⇒ P(target)=0.5
    expect(r.perAttemptProb).toBeCloseTo(0.5, 6)
    expect(r.blueprint!.steps[0]).toMatchObject({ kind: 'keep-trying', consumable: { name: 'Wild Crystallised Lifeforce' } })
  })

  it('THE CONTRAST: augment is a distribution on an OPEN pool, DETERMINISTIC when blocked', () => {
    const open = harvestModule.evaluate([rare()] as InputSet, data, params('augment'))
    expect(open.perAttemptProb).toBeCloseTo(0.5, 6) // two life groups open
    expect(open.blueprint!.steps[0].kind).toBe('keep-trying')

    // block the other life group → pool reduced to the desired ⇒ deterministic
    const blocked = harvestModule.evaluate([withBlockedGroup(rare(), 'LifeRegeneration')] as InputSet, data, params('augment'))
    expect(blocked.perAttemptProb).toBe(1)
    expect(blocked.expectedAttempts).toBe(1)
    expect(blocked.blueprint!.steps[0].kind).toBe('fixed') // guaranteed
    expect(blocked.notes.join(' ')).toMatch(/DETERMINISTIC/)
  })

  it('outcomes() reflects the blocked→deterministic payoff over item state', () => {
    const blocked = harvestModule.outcomes([withBlockedGroup(rare(), 'LifeRegeneration')] as InputSet, data, params('augment'))
    expect(blocked.outcomes).toHaveLength(1)
    expect(blocked.outcomes[0].p).toBe(1)
    const open = harvestModule.outcomes([rare()] as InputSet, data, params('augment'))
    expect(open.outcomes.length).toBe(2) // hit + miss
  })

  it('remove-tag is deterministic (fixed lifeforce step)', () => {
    const r = harvestModule.evaluate([rare()] as InputSet, data, { desired: [], method: { kind: 'harvest', craft: 'remove', tag: 'life' } })
    expect(r.supported).toBe(true)
    expect(r.expectedAttempts).toBe(1)
    expect(r.blueprint!.steps[0].kind).toBe('fixed')
  })

  it('IGNORES meta-locks: a reforge on a locked item is supported and flagged DANGEROUS (not safe)', () => {
    const locked = withMeta(rare(), { lockSuffixes: true })
    const r = harvestModule.evaluate([locked] as InputSet, data, params('reforge'))
    expect(r.supported).toBe(true) // reforge proceeds despite the lock
    expect(r.notes.join(' ')).toMatch(/IGNORES|WIPE/)
    // and the risk steps are NOT a protected slam — it's a keep-trying reforge
    expect(harvestModule.toRiskSteps([locked] as InputSet, data, params('reforge')).every(s => s.kind !== 'slam')).toBe(true)
  })
})
