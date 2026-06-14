/**
 * League-start intelligence MCP tools (Track B) — thin zod/registration + rendering
 * wrappers around the structured-input services. These gather the DETERMINISTIC inputs
 * (patch notes, build costs) and expose the output contract; the predictive synthesis
 * is Claude's job at runtime (web search over meta feeds + reasoning), by design.
 *
 * Read-only / manual-invoke: a tool runs when Claude calls it. No auto-pollers.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getPatchNotesRaw, PATCH_NOTE_SOURCES } from '../data/patchNotes'
import { parsePatchNotes, summarizePatchNotes, type ParsedPatchNotes } from '../services/patchNotesParser'
import { estimateBuildCostLive, type GearPiece, type BuildCostEstimate } from '../services/buildCost'
import { emptyLeagueStartPlan, PREDICTIVE_CAVEAT } from '../services/leagueStartPlan'

export function registerLeagueStartTools(server: McpServer): void {
  registerPatchNotesTool(server)
  registerBuildCostTool(server)
  registerPlanContractTool(server)
}

// ── get_patch_notes (B1) ──────────────────────────────────────────────────────

function registerPatchNotesTool(server: McpServer): void {
  server.registerTool(
    'get_patch_notes',
    {
      title: 'Get structured patch notes',
      description:
        'Fetch official GGG patch notes and return them STRUCTURED: new/changed skills (active + ' +
        'support), new/changed uniques, mechanic/Atlas changes, buffs, nerfs, and currency/economy ' +
        'changes — with the full sectioned raw text kept so nothing is dropped. Pass a known version ' +
        `key (${Object.keys(PATCH_NOTE_SOURCES).join(', ')}) or a direct forum URL. Read-only. The ` +
        'buff/nerf split is a keyword heuristic to surface candidates for your reasoning, not an oracle.',
      inputSchema: {
        versionOrUrl: z.string().describe('Known version key (e.g. "3.28") or a pathofexile.com patch-notes URL.'),
        leagueOverride: z.string().optional().describe('Force the league name when the title line is noisy.'),
        versionOverride: z.string().optional().describe('Force the version when the title line is noisy.'),
      },
    },
    async ({ versionOrUrl, leagueOverride, versionOverride }) => {
      const { source, raw } = await getPatchNotesRaw(versionOrUrl)
      const parsed = parsePatchNotes(raw, {
        league: leagueOverride ?? source?.league,
        version: versionOverride ?? source?.version,
      })
      return { content: [{ type: 'text', text: renderPatchNotes(parsed) }], structuredContent: parsed as unknown as Record<string, unknown> }
    },
  )
}

// ── estimate_build_cost (B2) ──────────────────────────────────────────────────

function registerBuildCostTool(server: McpServer): void {
  server.registerTool(
    'estimate_build_cost',
    {
      title: 'Estimate build cost + budget tier',
      description:
        'Price a build\'s gear list at current rates via the economy services and assign a budget ' +
        'tier (starter / functional / aspirational) in chaos + divine. Input is a plain item list ' +
        '(a PoB import reduces to this — PoB parsing is a future hook). Rares are not indexed by ' +
        'aggregators, so unpriced slots make the total a LOWER BOUND — flagged, with divine-denominated ' +
        'sums preferred. Read-only; league + date stamped.',
      inputSchema: {
        items: z
          .array(
            z.object({
              slot: z.string().describe('Slot label, e.g. "Body Armour".'),
              name: z.string().describe('Item name to price, e.g. "Tabula Rasa".'),
              category: z.string().optional().describe('Category hint: unique / currency / gem / …'),
              qty: z.number().optional().describe('Quantity (default 1).'),
            }),
          )
          .describe('The gear list to price.'),
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
      },
    },
    async ({ items, league }) => {
      const result = await estimateBuildCostLive(items as GearPiece[], league)
      return { content: [{ type: 'text', text: renderBuildCost(result) }], structuredContent: result as unknown as Record<string, unknown> }
    },
  )
}

// ── league_start_plan_contract (B3) ───────────────────────────────────────────

function registerPlanContractTool(server: McpServer): void {
  server.registerTool(
    'league_start_plan_contract',
    {
      title: 'League-start plan contract (blank)',
      description:
        'Return the blank league-start-plan contract for the runtime workflow to fill: viable builds ' +
        '(with B2 budget tiers), early item/mechanic spikes + reasoning, and 0–72h farm/flip priorities. ' +
        'Use this as the output skeleton after pulling patch notes (get_patch_notes), web-searching the ' +
        'current meta feeds, and costing candidates (estimate_build_cost). See docs/league-start-workflow.md.',
      inputSchema: {
        league: z.string().describe('Target league name, e.g. "Mirage" or the 3.29 league.'),
        version: z.string().describe('Target version, e.g. "3.29.0".'),
        dataAsOf: z.string().describe('As-of date of the inputs (YYYY-MM-DD).'),
      },
    },
    async ({ league, version, dataAsOf }) => {
      const plan = emptyLeagueStartPlan(league, version, dataAsOf)
      const text =
        `**League-start plan contract — ${league} (${version})**\n\n` +
        'Fill these sections, then validate against the contract:\n' +
        '- `viableBuilds[]` — { name, archetype, budgetTier, estCostDivine, why, sourceHook }\n' +
        '- `earlySpikes[]` — { kind: item|mechanic, subject, reasoning, confidence }\n' +
        '- `farmFlipPriorities[]` — { window: 0-48h|48-72h, activity, rationale }\n' +
        '- `confidence`, `caveats[]` (must include the predictive caveat), `sources[]`\n\n' +
        `Mandatory caveat: "${PREDICTIVE_CAVEAT}"`
      return { content: [{ type: 'text', text }], structuredContent: plan as unknown as Record<string, unknown> }
    },
  )
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderPatchNotes(p: ParsedPatchNotes): string {
  const s = summarizePatchNotes(p)
  const lines: string[] = [
    `**Patch notes — ${p.league ?? '?'} (${p.version ?? '?'})**`,
    `Sections: ${s.sections} · skills ${s.skills} · uniques ${s.uniques} · mechanics ${s.mechanics} · buffs ${s.buffs} · nerfs ${s.nerfs} · currency ${s.currency}`,
    '',
  ]
  const block = (title: string, entries: { text: string; tags: string[] }[], cap = 8) => {
    if (!entries.length) return
    lines.push(`**${title}** (${entries.length})`)
    for (const e of entries.slice(0, cap)) lines.push(`- ${e.text}${e.tags.length ? ` _[${e.tags.join(', ')}]_` : ''}`)
    if (entries.length > cap) lines.push(`- …and ${entries.length - cap} more`)
    lines.push('')
  }
  block('Skills (new / changed)', p.categories.skills)
  block('Uniques', p.categories.uniques)
  block('Mechanics / Atlas', p.categories.mechanics)
  block('Currency / Economy', p.categories.currency)
  block('Notable nerfs', p.categories.nerfs, 6)
  block('Notable buffs', p.categories.buffs, 6)
  lines.push('_Buff/nerf split is a keyword heuristic — verify against the raw section text before acting._')
  return lines.join('\n')
}

function renderBuildCost(r: BuildCostEstimate): string {
  const div = (c: number | null) => (c == null ? '—' : r.divineChaos ? `${(c / r.divineChaos).toFixed(2)} div` : `${c.toFixed(0)}c`)
  const lines: string[] = [
    `**Build cost — ${r.league} · ${r.stampDate}** · ${r.pieceCount} pieces`,
    `**Tier: ${r.tier.toUpperCase()}** · total ${r.totalChaos != null ? `${r.totalChaos.toFixed(0)}c (${div(r.totalChaos)})` : '— (unpriced)'}`,
    '',
    '| Slot | Item | Qty | Price |',
    '|---|---|---|---|',
  ]
  for (const p of r.pieces) {
    const price = p.chaos != null ? `${p.chaos.toFixed(0)}c (${div(p.chaos)})${p.lowConfidence ? ' ⚠' : ''}` : `— ${p.note ?? ''}`
    lines.push(`| ${p.slot} | ${p.name} | ${p.qty} | ${price} |`)
  }
  lines.push('')
  if (r.lowConfidence) lines.push('⚠ **LOW CONFIDENCE** — prefer the divine total; unpriced rares make it a floor.')
  for (const n of r.notes) lines.push(`- ${n}`)
  return lines.join('\n')
}
