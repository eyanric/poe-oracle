/**
 * Economy tools — `currency_overview` and `price_check`.
 *
 * Provider-agnostic (poe.watch / poe.ninja / both via ECONOMY_PROVIDER). Both
 * tools default the league to the resolved current challenge league. Thin prices
 * are flagged via `lowConfidence`: currency_overview drops them from the top list
 * by default (so an outlier can't sit on top), price_check surfaces the flag.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { isLowConfidence } from '../services/economyTypes'
import { searchEconomy, type PriceMatch } from '../services/economySearch'
import { getEconomyProvider } from '../services/EconomyProvider'
import { resolveCurrentLeague } from '../services/LeagueResolver'

function fmtMatches(matches: PriceMatch[]): string {
  if (matches.length === 0) return 'No matching items found.'
  return matches
    .map(m => {
      const parts = [`**${m.name}** — ${m.chaosValue.toFixed(1)}c`]
      if (m.divineValue !== null && m.divineValue >= 0.1) parts.push(`${m.divineValue.toFixed(2)} div`)
      parts.push(`${m.listingCount} listings`)
      if (m.source) parts.push(m.source)
      parts.push(`(${m.category})`)
      if (m.lowConfidence) parts.push('⚠ low-confidence')
      return '- ' + parts.join('  ·  ')
    })
    .join('\n')
}

export function registerEconomyTools(server: McpServer): void {
  const economy = getEconomyProvider()

  server.registerTool(
    'currency_overview',
    {
      title: 'Currency Overview',
      description:
        'Top currency exchange rates (in Chaos Orb equivalent) for a PoE 1 league. ' +
        'Defaults to the current challenge league. Low-confidence (thin-listing) entries are ' +
        'excluded from the top list unless includeLowConfidence is set.',
      inputSchema: {
        league: z
          .string()
          .optional()
          .describe('League name (e.g. "Mirage", "Standard"). Defaults to the current challenge league.'),
        includeLowConfidence: z
          .boolean()
          .optional()
          .describe('Include thin/low-confidence prices (default false — they are excluded so outliers cannot top the list).'),
      },
    },
    async ({ league, includeLowConfidence }) => {
      const resolved = league ?? (await resolveCurrentLeague())
      const lines = await economy.getCurrencyPrices(resolved)
      const eligible = includeLowConfidence ? lines : lines.filter(c => !isLowConfidence(c))
      const top = [...eligible].sort((a, b) => b.chaosEquivalent - a.chaosEquivalent).slice(0, 20)

      const structured = {
        league: resolved,
        count: lines.length,
        excludedLowConfidence: includeLowConfidence ? 0 : lines.length - eligible.length,
        currencies: top.map(c => ({
          name: c.currencyTypeName,
          chaosValue: c.chaosEquivalent,
          listingCount: c.receive?.listing_count ?? c.pay?.listing_count ?? 0,
          lowConfidence: isLowConfidence(c),
          source: c.source,
        })),
      }
      const text =
        `**Currency Overview** — League: ${resolved} (${lines.length} currencies` +
        (structured.excludedLowConfidence ? `, ${structured.excludedLowConfidence} low-confidence hidden` : '') +
        `)\n\n` +
        (top.length
          ? top
              .map(c => {
                const lc = isLowConfidence(c) ? '  ⚠' : ''
                const src = c.source ? `  · ${c.source}` : ''
                return `- **${c.currencyTypeName}** — ${c.chaosEquivalent.toFixed(1)}c${src}${lc}`
              })
              .join('\n')
          : `No currency data for "${resolved}".`)
      return { content: [{ type: 'text', text }], structuredContent: structured }
    },
  )

  server.registerTool(
    'price_check',
    {
      title: 'Price Check',
      description:
        'Look up an item/currency by name and return its Chaos value, Divine value, listing count, ' +
        'source, and a low-confidence flag for thin prices. Defaults to the current challenge league.',
      inputSchema: {
        query: z.string().describe('Item or currency name to search for, e.g. "Divine Orb".'),
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
        category: z
          .string()
          .optional()
          .describe('Optional category hint: currency, fragment, unique, gem, divcard, map, scarab, essence.'),
      },
    },
    async ({ query, league, category }) => {
      const resolved = league ?? (await resolveCurrentLeague())
      const snapshot = await economy.getEconomySnapshot(resolved)
      const matches = searchEconomy(snapshot, query, category)
      const structured = {
        league: resolved,
        query,
        count: matches.length,
        matches: matches.map(({ score: _s, ...m }) => m),
      }
      const text = `**Price Check** — "${query}" · League: ${resolved}\n\n${fmtMatches(matches)}`
      return { content: [{ type: 'text', text }], structuredContent: structured }
    },
  )
}
