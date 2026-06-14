import { describe, it, expect } from 'vitest'
import {
  nCr, pSlotSurvive, pSlotSurviveNNN, recombineIlvl, analyzeRecombine, recombineModule, RECOMBINATOR_COUNT_DIST,
} from '../src/services/recombine'
import type { RepoeMod } from '../src/data/repoe'
import { evaluateInputs, evaluateMethod, type DesiredMod } from '../src/services/craftMethods'
import { newItemState, type Affix, type ItemState } from '../src/services/itemState'
import type { InputSet, CraftDataContext, ModuleParams } from '../src/services/craftModule'

const data: CraftDataContext = { mods: {} }
const affix = (group: string, slot: 'prefix' | 'suffix', exclusive = false): Affix => ({ modId: group, group, slot, exclusive })
const ring = (ilvl: number, pre: string[], suf: string[] = [], excl: string[] = []): ItemState =>
  newItemState({ base: 'Vermillion Ring', itemClass: 'Ring', ilvl, affixes: [...pre.map(g => affix(g, 'prefix', excl.includes(g))), ...suf.map(g => affix(g, 'suffix', excl.includes(g)))] })
const want = (group: string, slot: 'prefix' | 'suffix' = 'prefix'): DesiredMod => ({ slot, group, label: group })

describe('recombine math', () => {
  it('nCr basics', () => {
    expect(nCr(4, 3)).toBe(4)
    expect(nCr(4, 4)).toBe(1)
    expect(nCr(4, 5)).toBe(0)
  })

  it('Stage-B compounding is exact (3 desired of a 4-pool, final count 3 ⇒ 1/4)', () => {
    // single-count distribution to isolate Stage-B: pool 4, always pick 3
    const dist = { 4: [0, 0, 0, 1] }
    expect(pSlotSurvive(4, 3, dist)).toBeCloseTo(nCr(1, 0) / nCr(4, 3), 6) // = 1/4 = 0.25
    expect(pSlotSurvive(4, 3, dist)).toBeCloseTo(0.25, 6)
  })

  it('junk mods lower target survival', () => {
    const dist = { 2: [0, 0, 1], 3: [0, 0, 0, 1] } // always max
    const clean = pSlotSurvive(2, 2, dist) // both wanted, pool exactly 2 → 1.0
    const withJunk = pSlotSurvive(3, 2, dist) // 2 wanted in a 3-pool, pick 3 → still 1.0; pick 2 would drop
    expect(clean).toBe(1)
    expect(withJunk).toBeLessThanOrEqual(1)
    expect(pSlotSurvive(4, 2)).toBeLessThan(pSlotSurvive(2, 2)) // default dist: more junk = lower
  })

  it('d=0 → 1.0 (slot not targeted); d>3 → 0 (cap)', () => {
    expect(pSlotSurvive(3, 0)).toBe(1)
    expect(pSlotSurvive(5, 4)).toBe(0)
  })

  it('output ilvl = min(max, floor(avg)+2)', () => {
    expect(recombineIlvl(80, 84)).toBe(84) // floor(82)+2=84, capped at max 84
    expect(recombineIlvl(84, 84)).toBe(84) // floor(84)+2=86 capped at 84
    expect(recombineIlvl(70, 84)).toBe(79) // floor(77)+2=79 < 84
  })

  it('every Stage-A row is a probability distribution (sums to 1)', () => {
    for (const arr of Object.values(RECOMBINATOR_COUNT_DIST)) {
      expect(arr.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    }
  })
})

describe('analyzeRecombine', () => {
  it('independent pools + product P(target)', () => {
    const a = ring(84, ['Life', 'PhysDmg'], ['FireRes'])
    const b = ring(84, ['ColdDmg'], ['ColdRes'])
    // want Life (prefix) + FireRes (suffix): prefix pool 3, suffix pool 2
    const r = analyzeRecombine(a, b, [want('Life', 'prefix'), want('FireRes', 'suffix')])
    expect(r.supported).toBe(true)
    expect(r.prefixPool).toBe(3)
    expect(r.suffixPool).toBe(2)
    expect(r.pTarget).toBeCloseTo(r.pPrefix * r.pSuffix, 6)
    expect(r.pTarget).toBeGreaterThan(0)
  })

  it('a desired mod absent from BOTH inputs is unsupported (recombine never creates mods)', () => {
    const r = analyzeRecombine(ring(84, ['Life']), ring(84, ['Mana']), [want('CritMultiplier')])
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/not present/)
  })

  it('EXCLUSIVE collision: wanting two exclusive mods is a guaranteed brick (P=0)', () => {
    const a = ring(84, ['ExclusiveA'], [], ['ExclusiveA'])
    const b = ring(84, ['ExclusiveB'], [], ['ExclusiveB'])
    const r = analyzeRecombine(a, b, [want('ExclusiveA'), want('ExclusiveB')])
    expect(r.exclusiveCollision).toBe(true)
    expect(r.pTarget).toBe(0)
    expect(r.reason).toMatch(/exclusive/i)
  })
})

// ── NNN (non-native modifiers) ──────────────────────────────────────────────────
const mod = (spawn: { tag: string; weight: number }[]): RepoeMod => ({
  domain: 'item', name: 'x', type: 'x', required_level: 1, is_essence_only: false, generation_type: 'prefix',
  groups: [], spawn_weights: spawn, generation_weights: [], implicit_tags: [], adds_tags: [],
})
const aff = (group: string, slot: 'prefix' | 'suffix', opts: Partial<Affix> = {}): Affix => ({ modId: group, group, slot, ...opts })
const item = (itemClass: string, ilvl: number, tags: string[], affixes: Affix[]): ItemState => newItemState({ base: 'x', itemClass, ilvl, tags, affixes })

describe('NNN (non-native modifiers)', () => {
  it('reject-and-redraw lever: NNN padding raises survival of high-count targets', () => {
    // want 3, pool exactly 3 (no pad) vs pool 6 (3 native + 3 NNN pad)
    expect(pSlotSurviveNNN(3, 3, 3)).toBeCloseTo(0.3, 6)
    expect(pSlotSurviveNNN(6, 3, 3)).toBeCloseTo(0.6, 6)
    expect(pSlotSurviveNNN(6, 3, 3)).toBeGreaterThan(pSlotSurviveNNN(3, 3, 3))
  })

  it('analyzeRecombine: NNN pad raises P(target) (lever exposed)', () => {
    const A = item('Ring', 84, [], [aff('Life', 'prefix'), aff('Phys', 'prefix'), aff('Cold', 'prefix')])
    const B = item('Ring', 84, [], [aff('Pad1', 'prefix', { nonNative: true }), aff('Pad2', 'prefix', { nonNative: true }), aff('Pad3', 'prefix', { nonNative: true })])
    const r = analyzeRecombine(A, B, [want('Life'), want('Phys'), want('Cold')])
    expect(r.nnnLever.withPad).toBeGreaterThan(r.nnnLever.withoutPad)
    expect(r.nnnLever.withoutPad).toBeCloseTo(0.3, 2)
    expect(r.pTarget).toBeCloseTo(0.6, 2)
  })

  it('base-choice branch flips legality (data-derived): native to A-base, NNN on B-base', () => {
    const mods = { OnlyDex: mod([{ tag: 'dex_armour', weight: 1000 }, { tag: 'default', weight: 0 }]) }
    const A = item('Shield', 84, ['dex_armour', 'default'], [aff('OnlyDex', 'prefix'), aff('IntLife', 'prefix')])
    const B = item('Shield', 84, ['int_armour', 'default'], [aff('SpellDmg', 'prefix')])
    const withFlip = analyzeRecombine(A, B, [want('OnlyDex')], mods) // B-base branch zeroes (OnlyDex illegal on int)
    const noData = analyzeRecombine(A, B, [want('OnlyDex')]) // no legality data → native both branches
    expect(withFlip.pTarget).toBeGreaterThan(0)
    expect(withFlip.pTarget).toBeLessThan(noData.pTarget) // the int-base branch contributes 0
    expect(withFlip.pTarget).toBeCloseTo(noData.pTarget / 2, 2)
  })

  it('fractured retention is tied to the base choice (kept only if its base wins)', () => {
    const A = item('Ring', 84, [], [aff('Life', 'prefix')])
    const B = item('Ring', 84, [], [aff('FracLife', 'suffix', { fractured: true })])
    const r = analyzeRecombine(A, B, [want('FracLife', 'suffix')])
    // survives only in the B-final branch (50%): 0.5 × pSlotSurvive(1,1)=0.9
    expect(r.pTarget).toBeCloseTo(0.45, 2)
  })

  it('exclusive + NNN compose: one exclusive is fine, two still brick', () => {
    const padded = analyzeRecombine(
      item('Ring', 84, [], [aff('Excl', 'prefix', { exclusive: true }), aff('Life', 'prefix')]),
      item('Ring', 84, [], [aff('Pad', 'prefix', { nonNative: true })]),
      [want('Excl'), want('Life')],
    )
    expect(padded.supported).toBe(true)
    expect(padded.pTarget).toBeGreaterThan(0)

    const twoExcl = analyzeRecombine(
      item('Ring', 84, [], [aff('Excl1', 'prefix', { exclusive: true })]),
      item('Ring', 84, [], [aff('Excl2', 'prefix', { exclusive: true }), aff('Pad', 'prefix', { nonNative: true })]),
      [want('Excl1'), want('Excl2')],
    )
    expect(twoExcl.exclusiveCollision).toBe(true)
    expect(twoExcl.pTarget).toBe(0)
  })
})

describe('arity-2 through the interface', () => {
  it('recombine module is arity 2 + league-gated (flagged off until availability confirmed)', () => {
    expect(recombineModule.arity).toBe(2)
    expect(recombineModule.leagues).toContain('Settlers')
  })

  it('routes through evaluateInputs with TWO inputs; arity mismatch is rejected', () => {
    const a = ring(84, ['Life']), b = ring(84, ['Mana'])
    const inputs = [a, b] as InputSet
    const params: ModuleParams = { desired: [want('Life')], method: { kind: 'recombine' }, inputValuesChaos: [10, 5] }
    const ok = evaluateInputs(inputs, data, params)
    expect(ok.supported).toBe(true)
    expect(ok.blueprint!.steps[0].kind).toBe('keep-trying')
    // input items folded into per-attempt cost as direct-chaos extras
    expect(ok.blueprint!.steps[0].extra?.map(e => e.chaos)).toEqual([10, 5])

    // arity guard: a single-item method given 2 inputs, or recombine given 1, is rejected
    const wrong = evaluateMethod(a, data, params) // 1 input to an arity-2 method
    expect(wrong.supported).toBe(false)
    expect(wrong.reason).toMatch(/input item/i)
  })

  it('non-matching league excludes recombine (same path as Rancour)', () => {
    const a = ring(84, ['Life']), b = ring(84, ['Mana'])
    const r = evaluateInputs([a, b] as InputSet, { mods: {}, currentLeague: 'Mirage' }, { desired: [want('Life')], method: { kind: 'recombine' } })
    expect(r.supported).toBe(false)
    expect(r.reason).toMatch(/league-specific/)
  })
})
