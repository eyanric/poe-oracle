/**
 * Craft query surface — the FRONT DOOR (resolve → pick → solve).
 *
 * `resolve_target` turns a human stat/group query into the concrete candidate mod IDENTITIES on a base
 * (the disambiguation entry point); `solve_craft` (in craft.ts) then accepts either a pinned modId or a
 * stat query, resolving unambiguous ones and returning a disambiguation response for ambiguous ones.
 * The separate UI picker consumes the SAME contract. Read-only / analysis only.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolveTargetsLive, type ResolveTargetsResult } from '../services/solver'

export function registerResolveTargetTool(server: McpServer): void {
  server.registerTool(
    'resolve_target',
    {
      title: 'Resolve a stat query → candidate mod identities (disambiguation)',
      description:
        'Turn a human stat/group query (e.g. "increased maximum Life", "Hunter cold damage", ' +
        '"Whispers of Doom") on a base + ilvl into the concrete candidate mod IDENTITIES: each a ' +
        '{ modId, label (tier text), domain (explicit | eldritch-implicit | veiled | influence | anoint | ' +
        'synthImplicit), slot, tier, weight }. A stat that exists across DOMAINS or TIERS returns multiple ' +
        'candidates — the caller (or the UI picker) picks the intended identity, then calls solve_craft with ' +
        'the chosen modId. This is the disambiguation entry point; it never guesses. Read-only.',
      inputSchema: {
        query: z.string().describe('Human stat / group / notable, e.g. "maximum Life" or "Whispers of Doom".'),
        base: z.string().describe('Base item name, e.g. "Two-Stone Ring".'),
        ilvl: z.number().describe('Item level.'),
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
      },
    },
    async ({ query, base, ilvl, league }) => {
      const r = await resolveTargetsLive(query, base, ilvl, league)
      return { content: [{ type: 'text', text: renderResolve(r) }], structuredContent: r as unknown as Record<string, unknown> }
    },
  )
}

function renderResolve(r: ResolveTargetsResult): string {
  const lines: string[] = [`**resolve_target — "${r.query}" on ${r.base} (ilvl ${r.ilvl})** · ${r.league}`, '']
  if (!r.candidates.length) {
    lines.push('⚠ No candidate identities — check the stat text, base, or ilvl.')
    return lines.join('\n')
  }
  const byDomain = [...new Set(r.candidates.map(c => c.domain))]
  lines.push(`${r.candidates.length} candidate(s) across ${byDomain.length} domain(s): ${byDomain.join(', ')}`,
    r.candidates.length > 1 ? '_Ambiguous — pick the intended identity, then solve_craft with its modId._' : '_Unambiguous._',
    '', '| modId | domain | slot | tier | weight | label |', '|---|---|---|---|---|---|')
  for (const c of r.candidates.slice(0, 24)) {
    lines.push(`| ${c.modId} | ${c.domain}${c.influence ? `:${c.influence}` : ''} | ${c.slot} | ${c.tier ?? '—'} | ${c.weight || '—'} | ${(c.label || '').replace(/\n/g, ' / ').slice(0, 44)} |`)
  }
  return lines.join('\n')
}
