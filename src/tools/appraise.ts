/**
 * appraise / watch MCP tools — thin zod/registration + rendering wrappers around
 * the pure appraisal logic in `services/appraisal.ts`.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  appraiseOne,
  appraiseClipboard,
  type AppraisalResult,
  type ParsedItemSummary,
  type ValueTier,
  type Liquidity,
} from '../services/appraisal'
import { resolveCurrentLeague } from '../services/LeagueResolver'

const WATCH_CAP = 12

export function registerAppraiseTool(server: McpServer): void {
  server.registerTool(
    'appraise',
    {
      title: 'Appraise (reconcile price)',
      description:
        'Reconcile poe.watch + poe.ninja against a bounded LIVE official-trade sample: aggregator ' +
        'consensus + divergence flag, live low/median, tier-aware liquidity, listingSpread vs a ' +
        'freshness-gated ACTIONABLE margin with confidence. Read-only; you trade manually in-game.',
      inputSchema: {
        query: z.string().describe('Item or currency name, e.g. "Divine Orb" or "Headhunter".'),
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
        divergenceThresholdPct: z.number().optional().describe('Divergence flag threshold in percent (default 15).'),
        maxListings: z.number().optional().describe('Cap on live item listings sampled (default 10, cheapest online).'),
        freshnessWindowSec: z.number().optional().describe('Only listings this fresh count toward the actionable margin (default 1800 = 30m).'),
        minFreshDepth: z.number().optional().describe('Minimum fresh listings required to report an actionable margin (default 3).'),
      },
    },
    async ({ query, league, ...opts }) => {
      const resolved = league ?? (await resolveCurrentLeague())
      const result = await appraiseOne(query, resolved, opts)
      return { content: [{ type: 'text', text: renderAppraisal(result) }], structuredContent: result }
    },
  )
}

export function registerPriceCheckItemTool(server: McpServer): void {
  server.registerTool(
    'price_check_item',
    {
      title: 'Price-check item (paste)',
      description:
        'Paste a full PoE item from the in-game clipboard (Ctrl+C in game) and get a price + flip ' +
        'verdict. Parses the item, then reconciles poe.watch + poe.ninja against a bounded LIVE ' +
        'official-trade sample — mod-aware stat search for rares, name/exchange for uniques and ' +
        'currency. Same reconciliation as `appraise`, but driven by the actual item text. ' +
        'Read-only; you trade manually in-game.',
      inputSchema: {
        itemText: z.string().describe('The full item text copied from the game (Ctrl+C on a hovered item).'),
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
        divergenceThresholdPct: z.number().optional().describe('Divergence flag threshold in percent (default 15).'),
        maxListings: z.number().optional().describe('Cap on live item listings sampled (default 10, cheapest online).'),
        freshnessWindowSec: z.number().optional().describe('Only listings this fresh count toward the actionable margin (default 1800 = 30m).'),
        minFreshDepth: z.number().optional().describe('Minimum fresh listings required to report an actionable margin (default 3).'),
      },
    },
    async ({ itemText, league, ...opts }) => {
      const resolved = league ?? (await resolveCurrentLeague())
      const result = await appraiseClipboard(itemText, resolved, opts)
      return { content: [{ type: 'text', text: renderAppraisal(result) }], structuredContent: result }
    },
  )
}

export function registerWatchTool(server: McpServer): void {
  server.registerTool(
    'watch',
    {
      title: 'Watchlist (appraise many)',
      description:
        `On-demand appraisal of a small list of items (max ${WATCH_CAP}), paced by the trade rate ` +
        'limiter, returned as a snapshot sorted by actionable margin (or divergence). Stateless, ' +
        'no scheduling/polling — re-run it yourself when you want a fresh look.',
      inputSchema: {
        items: z.array(z.string()).describe(`Item/currency names to appraise (max ${WATCH_CAP}).`),
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
        sortBy: z.enum(['actionableMargin', 'divergence']).optional().describe('Sort key (default actionableMargin).'),
        freshnessWindowSec: z.number().optional().describe('Freshness window for the actionable margin (default 1800).'),
        maxListings: z.number().optional().describe('Cap on live item listings sampled per item (default 10).'),
      },
    },
    async ({ items, league, sortBy, freshnessWindowSec, maxListings }) => {
      const resolved = league ?? (await resolveCurrentLeague())
      const list = items.slice(0, WATCH_CAP)
      const key = sortBy ?? 'actionableMargin'

      const rows: WatchRow[] = []
      for (const q of list) {
        // Sequential on purpose: live trade calls flow through the shared
        // GggRateLimiter, which paces and backs off across the whole list.
        try {
          rows.push(toWatchRow(await appraiseOne(q, resolved, { freshnessWindowSec, maxListings })))
        } catch (err) {
          rows.push({ query: q, error: (err as Error).message })
        }
      }
      sortRows(rows, key)

      const structured = { league: resolved, sortBy: key, count: rows.length, rows }
      return { content: [{ type: 'text', text: renderWatch(resolved, key, rows) }], structuredContent: structured }
    },
  )
}

// ── Watch rows ───────────────────────────────────────────────────────────────

interface WatchRow {
  query: string
  category?: string
  chaos?: number
  tier?: ValueTier
  liquidity?: Liquidity['rating']
  freshestAgeSec?: number | null
  divergent?: boolean
  divergencePct?: number | null
  listingSpreadPct?: number | null
  actionableMarginPct?: number | null
  confidence?: 'high' | 'medium' | 'low'
  error?: string
}

function toWatchRow(a: AppraisalResult): WatchRow {
  const liveMedian = a.live && a.live.median > 0 ? a.live.median : null
  const aggAvg = a.aggregators.length ? a.aggregators.reduce((s, r) => s + r.chaosValue, 0) / a.aggregators.length : null
  return {
    query: a.query,
    category: a.category,
    chaos: liveMedian ?? aggAvg ?? 0,
    tier: a.liquidity.tier,
    liquidity: a.liquidity.rating,
    freshestAgeSec: a.live?.snapshotAgeSec ?? null,
    divergent: a.divergence.divergent,
    divergencePct: a.divergence.pct,
    listingSpreadPct: a.margin.listingSpread?.spreadPct ?? null,
    actionableMarginPct: a.margin.actionable?.marginPct ?? null,
    confidence: a.margin.confidence.label,
  }
}

function sortRows(rows: WatchRow[], key: 'actionableMargin' | 'divergence'): void {
  const val = (r: WatchRow) => (key === 'divergence' ? r.divergencePct : r.actionableMarginPct)
  rows.sort((a, b) => {
    if (a.error) return 1
    if (b.error) return -1
    const av = val(a), bv = val(b)
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return bv - av
  })
}

// ── Rendering ────────────────────────────────────────────────────────────────

/**
 * One-line summary of a pasted item (rarity/name/base, iLvl, quality, links,
 * corrupt/unid flags, influences, mod counts). Pure — unit-tested without network.
 */
export function formatParsedItemHeader(item: ParsedItemSummary): string {
  const title = item.name && item.name !== item.baseType ? `"${item.name}" (${item.baseType})` : item.baseType
  const parts = [`${item.rarity} ${title}`.trim()]
  if (item.itemLevel > 0) parts.push(`iLvl ${item.itemLevel}`)
  if (item.quality > 0) parts.push(`Q${item.quality}`)
  if (item.links >= 5) parts.push(`${item.links}L`)
  if (item.unidentified) parts.push('unidentified')
  if (item.corrupted) parts.push('corrupted')
  if (item.influences.length) parts.push(item.influences.join('/'))
  const modCount = item.explicitMods.length + item.implicitMods.length
  if (modCount > 0) parts.push(`${item.explicitMods.length} explicit / ${item.implicitMods.length} implicit mods`)
  return `**Item:** ${parts.join(' · ')}`
}

function renderAppraisal(a: AppraisalResult): string {
  const lines: string[] = [`**Appraisal — "${a.query}"** · League: ${a.league} · ${a.category}`]
  if (a.parsedItem) lines.push(formatParsedItemHeader(a.parsedItem))
  lines.push('')

  lines.push('**Aggregators:**')
  for (const r of a.aggregators) {
    const div = r.divineValue && r.divineValue >= 0.1 ? ` (${r.divineValue.toFixed(2)} div)` : ''
    lines.push(`- ${r.source}: ${r.chaosValue.toFixed(1)}c${div} · ${r.listingCount} listings${r.lowConfidence ? ' ⚠' : ''}`)
  }
  if (a.aggregators.length === 0) lines.push('- (no aggregator price — rares aren\'t indexed; rely on the live check)')
  if (a.divergence.pct != null) {
    lines.push(
      `- Divergence: ${a.divergence.pct.toFixed(1)}%` +
        (a.divergence.divergent ? `  ⚠ DIVERGENT (> ${a.divergence.thresholdPct}%) — reconcile against live` : '  (in agreement)'),
    )
  }
  lines.push('')

  lines.push('**Live (official trade):**')
  if (a.live && a.live.count > 0 && a.live.low > 0) {
    const age = a.live.snapshotAgeSec != null ? `, freshest ${fmtAge(a.live.snapshotAgeSec)}` : ''
    lines.push(
      `- ${a.live.kind}: low ${a.live.low.toFixed(1)}c · median ${a.live.median.toFixed(1)}c · ` +
        `${a.live.count} listing${a.live.count === 1 ? '' : 's'} (sample ${a.live.sampleSize}${age})`,
    )
    if (a.live.tradeUrl) lines.push(`- ${a.live.tradeUrl}`)
  } else {
    lines.push(`- unavailable${a.live?.note ? ` (${a.live.note})` : ''}`)
  }
  lines.push('')

  lines.push(`**Liquidity:** ${a.liquidity.rating.toUpperCase()} — ${a.liquidity.rationale}`)
  const ls = a.margin.listingSpread
  if (ls) lines.push(`**Listing spread (raw, not actionable):** ${ls.low.toFixed(1)}c → ${ls.median.toFixed(1)}c = ${ls.spreadPct.toFixed(0)}%`)
  const act = a.margin.actionable
  if (act) {
    lines.push(
      `**Actionable margin:** buy ${act.buy.toFixed(1)}c → sell ${act.sellRef.toFixed(1)}c = ${act.marginChaos.toFixed(1)}c ` +
        `(${act.marginPct.toFixed(0)}%) · fresh depth ${act.freshDepth} · confidence ${a.margin.confidence.label}. ${a.margin.caveat}`,
    )
  } else {
    lines.push(`**Actionable margin:** none — ${a.margin.reason} (confidence ${a.margin.confidence.label})`)
  }
  return lines.join('\n')
}

function renderWatch(league: string, key: string, rows: WatchRow[]): string {
  const lines: string[] = [`**Watchlist** — League: ${league} · ${rows.length} items · sorted by ${key}`, '']
  lines.push('| Item | Price | Tier | Liq | Fresh | Div% | ActMargin% | Conf |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    if (r.error) {
      lines.push(`| ${r.query} | — | — | — | — | — | error: ${r.error} | — |`)
      continue
    }
    const price = r.chaos != null ? `${r.chaos.toFixed(1)}c` : '—'
    const fresh = r.freshestAgeSec != null ? fmtAge(r.freshestAgeSec) : '—'
    const divp = r.divergencePct != null ? `${r.divergencePct.toFixed(0)}${r.divergent ? '⚠' : ''}` : '—'
    const am = r.actionableMarginPct != null ? `${r.actionableMarginPct.toFixed(0)}%` : 'null'
    lines.push(`| ${r.query} | ${price} | ${r.tier} | ${r.liquidity} | ${fresh} | ${divp} | ${am} | ${r.confidence} |`)
  }
  return lines.join('\n')
}

function fmtAge(sec: number): string {
  if (sec < 90) return `${sec}s`
  if (sec < 5400) return `${Math.round(sec / 60)}m`
  if (sec < 172800) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}
