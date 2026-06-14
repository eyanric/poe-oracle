/**
 * parse_pob MCP tool (Phase 1) — thin zod/registration + rendering wrapper around
 * the PoB fetch (`data/pob`) + parser (`services/pobParser`). Read-only / manual-invoke.
 *
 * Accepts a pobb.in / pastebin link or a raw base64 export code. When the passive-tree
 * data is available, allocated keystone/notable/mastery NAMES are resolved via
 * `passiveTree` (Phase 2); otherwise the allocated node ids + counts are returned.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { getPobCode } from '../data/pob'
import { parsePobCode, type ParsedPob } from '../services/pobParser'
import {
  resolveAllocatedNodes,
  loadPassiveTree,
  lookupNode,
  pathBetween,
  distance,
  statsForNodes,
  type AllocatedNodes,
} from '../services/passiveTree'

export function registerPobTools(server: McpServer): void {
  registerPobTool(server)
  registerPassiveTreeTool(server)
}

function registerPobTool(server: McpServer): void {
  server.registerTool(
    'parse_pob',
    {
      title: 'Parse a Path of Building export',
      description:
        'Decode a Path of Building build from a pobb.in / pastebin link or a raw export code and ' +
        'return it structured: class / ascendancy / level, the main skill + gem links by slot, every ' +
        'equipped item with mods, PoB-reported stats (Life/ES/resists/DPS), the passive-tree spec(s), ' +
        'and — when tree data is available — the allocated keystones / notables / masteries by name. ' +
        'Read-only; analysis only.',
      inputSchema: {
        source: z.string().describe('A pobb.in/pastebin URL, or a raw base64 PoB export code.'),
        resolveTree: z.boolean().optional().describe('Resolve allocated node ids to keystone/notable names (default true).'),
      },
    },
    async ({ source, resolveTree }) => {
      let parsed: ParsedPob
      try {
        const { code } = await getPobCode(source)
        parsed = parsePobCode(code)
      } catch (err) {
        return { content: [{ type: 'text', text: `**parse_pob** — could not parse: ${(err as Error).message}` }], isError: true }
      }

      let allocated: AllocatedNodes | null = null
      if (resolveTree !== false && parsed.trees[0]?.nodeIds.length) {
        try {
          allocated = await resolveAllocatedNodes(parsed.trees[0].nodeIds)
        } catch {
          allocated = null // tree data unavailable — fall back to ids only
        }
      }

      const structured = { ...parsed, allocated }
      return { content: [{ type: 'text', text: render(parsed, allocated) }], structuredContent: structured as unknown as Record<string, unknown> }
    },
  )
}

// ── passive_tree (Phase 2) ────────────────────────────────────────────────────

function registerPassiveTreeTool(server: McpServer): void {
  server.registerTool(
    'passive_tree',
    {
      title: 'Passive-tree lookup / pathing / stat delta',
      description:
        'Query the GGG passive tree: look up a node (by id or name) with its stats/type; find the ' +
        'shortest path + point distance between two nodes; or total the stat delta of allocating a ' +
        'set of nodes. Read-only over GGG\'s data export.',
      inputSchema: {
        op: z.enum(['lookup', 'path', 'stats']).describe('lookup a node · path/distance between two · stat delta of a node set'),
        node: z.union([z.string(), z.number()]).optional().describe('lookup: node id or name.'),
        from: z.union([z.string(), z.number()]).optional().describe('path: start node id or name.'),
        to: z.union([z.string(), z.number()]).optional().describe('path: end node id or name.'),
        nodes: z.array(z.number()).optional().describe('stats: allocated node ids.'),
      },
    },
    async ({ op, node, from, to, nodes }) => {
      const tree = await loadPassiveTree()
      const idOf = (v: string | number | undefined) => {
        if (v == null) return null
        const n = lookupNode(tree, v)
        return n ? n.id : null
      }

      if (op === 'lookup') {
        const n = node != null ? lookupNode(tree, node) : null
        const text = n
          ? `**${n.name}** (id ${n.id}, ${n.type})\n${n.stats.join('\n') || '_(no stats)_'}`
          : `node "${node}" not found`
        return { content: [{ type: 'text', text }], structuredContent: (n ?? { found: false }) as unknown as Record<string, unknown> }
      }
      if (op === 'path') {
        const a = idOf(from), b = idOf(to)
        if (a == null || b == null) return { content: [{ type: 'text', text: 'path: from/to not found' }], isError: true }
        const path = pathBetween(tree, a, b)
        const dist = distance(tree, a, b)
        const text = path
          ? `**Distance ${dist} points.** Path: ${path.map(id => tree.nodes.get(id)?.name || id).join(' → ')}`
          : 'no path between those nodes'
        return { content: [{ type: 'text', text }], structuredContent: { distance: dist, path } as unknown as Record<string, unknown> }
      }
      // stats
      const r = statsForNodes(tree, nodes ?? [])
      const text = `**Allocating ${r.nodes.length} node(s)** (${r.unresolved} unresolved):\n${r.stats.join('\n') || '_(no stats)_'}`
      return { content: [{ type: 'text', text }], structuredContent: r as unknown as Record<string, unknown> }
    },
  )
}

function render(p: ParsedPob, allocated: AllocatedNodes | null): string {
  const lines: string[] = [
    `**PoB build — ${p.className}${p.ascendancy ? ` (${p.ascendancy})` : ''}, level ${p.level}**`,
    p.mainSkill ? `Main skill: **${p.mainSkill}**` : '',
    '',
  ]

  const stat = (k: string) => (p.stats[k] != null ? p.stats[k].toLocaleString() : '—')
  lines.push(
    `**Stats:** Life ${stat('Life')} · ES ${stat('EnergyShield')} · ` +
      `Res ${stat('FireResist')}/${stat('ColdResist')}/${stat('LightningResist')}/${stat('ChaosResist')} · ` +
      `DPS ${stat('TotalDPS')}${p.stats.TotalEHP != null ? ` · EHP ${stat('TotalEHP')}` : ''}`,
    '',
  )

  lines.push('**Skill groups:**')
  for (const g of p.skillGroups) {
    const gems = g.gems.map(gm => `${gm.name}${gm.level ? ` (${gm.level}/${gm.quality})` : ''}`).join(', ')
    lines.push(`- ${g.slot}${g.main ? ' ⭐' : ''}: ${gems}`)
  }
  lines.push('')

  lines.push('**Items:**')
  for (const it of p.items) {
    lines.push(`- ${it.slot ?? '?'}: ${it.name || it.baseType} _(${it.rarity.toLowerCase()})_`)
  }
  lines.push('')

  const t = p.trees[0]
  if (t) {
    lines.push(`**Passive tree:** ${t.nodeCount} nodes allocated${t.treeVersion ? ` (tree ${t.treeVersion})` : ''}`)
    if (allocated) {
      if (allocated.keystones.length) lines.push(`- Keystones: ${allocated.keystones.join(', ')}`)
      if (allocated.notables.length) lines.push(`- Notables (${allocated.notables.length}): ${allocated.notables.slice(0, 12).join(', ')}${allocated.notables.length > 12 ? '…' : ''}`)
      if (allocated.masteries.length) lines.push(`- Masteries: ${allocated.masteries.join(', ')}`)
      if (allocated.unresolved) lines.push(`- _(${allocated.unresolved} node id(s) not found in the loaded tree)_`)
    } else {
      lines.push('- _(tree data not loaded — allocated node ids only)_')
    }
  }
  if (p.progression.length > 1) {
    lines.push('', '**Progression stages:**')
    for (const s of p.progression) lines.push(`- ${s.title}: ${s.nodeCount} nodes`)
  }
  return lines.filter(l => l !== '').join('\n')
}
