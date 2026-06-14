/**
 * EconomyProvider — source-agnostic economy interface + selector.
 *
 * Select with `ECONOMY_PROVIDER`:
 *   - "poewatch" (default) — api.poe.watch
 *   - "poeninja"           — poe.ninja PoE1 stash namespace (PoeNinjaProvider)
 *   - "both"               — query both and merge (each row tagged with its source)
 */
import { log } from './log'
import type { CurrencyPrice, EconomySnapshot, ItemPrice } from './economyTypes'
import { PoeWatchService } from './PoeWatchService'
import { PoeNinjaProvider } from './PoeNinjaProvider'

export interface EconomyProvider {
  readonly name?: string
  getCurrencyPrices(league: string): Promise<CurrencyPrice[]>
  getEconomySnapshot(league: string): Promise<EconomySnapshot>
}

export function getEconomyProvider(env: NodeJS.ProcessEnv = process.env): EconomyProvider {
  const choice = (env.ECONOMY_PROVIDER ?? 'poewatch').toLowerCase()
  if (choice === 'poeninja' || choice === 'ninja') return PoeNinjaProvider.getInstance()
  if (choice === 'both' || choice === 'all') return MultiEconomyProvider.getInstance()
  return PoeWatchService.getInstance()
}

const ITEM_FIELDS: Array<keyof EconomySnapshot> = [
  'essences', 'divCards', 'uniqueWeapons', 'uniqueArmours', 'uniqueAccessories',
  'uniqueFlasks', 'uniqueJewels', 'skillGems', 'maps', 'scarabs', 'oils',
]

/** Queries every provider and concatenates rows, each already tagged with `source`. */
export class MultiEconomyProvider implements EconomyProvider {
  private static instance: MultiEconomyProvider
  readonly name = 'poe.watch+poe.ninja'
  private readonly providers: EconomyProvider[] = [
    PoeWatchService.getInstance(),
    PoeNinjaProvider.getInstance(),
  ]

  static getInstance(): MultiEconomyProvider {
    if (!MultiEconomyProvider.instance) MultiEconomyProvider.instance = new MultiEconomyProvider()
    return MultiEconomyProvider.instance
  }

  async getCurrencyPrices(league: string): Promise<CurrencyPrice[]> {
    const results = await Promise.allSettled(this.providers.map(p => p.getCurrencyPrices(league)))
    return this.collect(results).flat()
  }

  async getEconomySnapshot(league: string): Promise<EconomySnapshot> {
    const results = await Promise.allSettled(this.providers.map(p => p.getEconomySnapshot(league)))
    const snapshots = this.collect(results)

    const merged: EconomySnapshot = {
      league,
      fetchedAt: Date.now(),
      source: this.name,
      currency: snapshots.flatMap(s => s.currency),
      fragments: snapshots.flatMap(s => s.fragments),
      essences: [], divCards: [], uniqueWeapons: [], uniqueArmours: [],
      uniqueAccessories: [], uniqueFlasks: [], uniqueJewels: [], skillGems: [],
      maps: [], scarabs: [], oils: [],
    }
    for (const field of ITEM_FIELDS) {
      ;(merged[field] as ItemPrice[]) = snapshots.flatMap(s => s[field] as ItemPrice[])
    }
    return merged
  }

  private collect<T>(results: PromiseSettledResult<T>[]): T[] {
    const out: T[] = []
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.push(r.value)
      else log.warn(`[economy] provider ${this.providers[i].name} failed:`, r.reason)
    })
    return out
  }
}
