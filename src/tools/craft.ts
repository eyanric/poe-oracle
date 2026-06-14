/**
 * calc_craft_cost MCP tool (Track A, Phase 3) — thin zod/registration + rendering
 * wrapper around the pure cost model in `services/craftCost.ts`.
 *
 * Read-only / analysis only: it informs a manual decision, never acts in-game.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { estimateCraftCostLive, type CraftSpec, type CraftCostEstimate, type MethodSpec } from '../services/craftCost'
import type { DesiredMod } from '../services/craftMethods'

const slotEnum = z.enum(['prefix', 'suffix'])

export function registerCraftCostTool(server: McpServer): void {
  server.registerTool(
    'calc_craft_cost',
    {
      title: 'Calculate craft cost (expected) + craft-vs-buy',
      description:
        'Estimate the expected cost to craft a target mod set on a base item via a chosen method ' +
        '(essence / alt-regal / chaos-spam / fossil), using clean-room RePoE spawn weights for ' +
        'expected attempts and the LIVE economy for consumable + finished-item prices. Returns ' +
        'expected attempts, a per-consumable breakdown, total in chaos + divine, the live buy ' +
        'price of the finished item, and a craft-vs-buy verdict. Confidence is capped on unmodelled ' +
        'mechanics (magic/rare affix-count) and thin chaos micro-prices. Read-only; you craft manually.',
      inputSchema: {
        baseName: z.string().describe('Base item name, e.g. "Vaal Regalia".'),
        ilvl: z.number().describe('Item level of the base (gates which mod tiers can roll).'),
        desiredMods: z
          .array(
            z.object({
              slot: slotEnum,
              group: z.string().optional().describe('Mod group, e.g. "IncreasedLife" (matches any tier).'),
              modId: z.string().optional().describe('Specific RePoE mod id, e.g. "IncreasedLife11".'),
              label: z.string().describe('Human label for output, e.g. "Increased Life".'),
            }),
          )
          .describe('Target mods to land. essence auto-targets its forced mod, so it may be empty there.'),
        method: z.enum(['essence', 'alt-regal', 'chaos-spam', 'fossil', 'bench', 'multimod', 'slam']).describe('Crafting method.'),
        essenceName: z.string().optional().describe('Required for method=essence, e.g. "Deafening Essence of Greed".'),
        fossilNames: z.array(z.string()).optional().describe('Required for method=fossil, e.g. ["Pristine Fossil"].'),
        benchMods: z.array(z.string()).optional().describe('Required for method=bench/multimod: bench-craft search terms, e.g. ["maximum Life", "Fire Resistance"].'),
        protect: z.enum(['prefixes', 'suffixes']).optional().describe('method=slam: lock this affix side (cannot be changed) so a miss is recoverable, not a brick.'),
        baseValueChaos: z.number().optional().describe('method=slam: chaos value of the base being slammed (the value-at-risk if it bricks).'),
        meta: z
          .object({
            blockAttack: z.boolean().optional(),
            blockCaster: z.boolean().optional(),
            lockPrefixes: z.boolean().optional(),
            lockSuffixes: z.boolean().optional(),
          })
          .optional()
          .describe('Meta-craft constraints (cannot-roll attack/caster, prefixes/suffixes cannot be changed).'),
        finishedItemQuery: z.string().optional().describe('Name to price the finished item for the craft-vs-buy verdict.'),
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
      },
    },
    async ({ baseName, ilvl, desiredMods, method, essenceName, fossilNames, benchMods, protect, baseValueChaos, meta, finishedItemQuery, league }) => {
      const methodSpec = toMethodSpec(method, { essenceName, fossilNames, benchMods, protect, baseValueChaos })
      if ('error' in methodSpec) {
        return { content: [{ type: 'text', text: `**calc_craft_cost** — input error: ${methodSpec.error}` }], isError: true }
      }
      const spec: CraftSpec = {
        baseName,
        ilvl,
        desired: desiredMods as DesiredMod[],
        method: methodSpec,
        meta,
        finishedItemQuery,
      }
      const result = await estimateCraftCostLive(spec, league)
      return { content: [{ type: 'text', text: render(result) }], structuredContent: result }
    },
  )
}

function toMethodSpec(
  method: string,
  o: { essenceName?: string; fossilNames?: string[]; benchMods?: string[]; protect?: 'prefixes' | 'suffixes'; baseValueChaos?: number },
): MethodSpec | { error: string } {
  if (method === 'essence') {
    if (!o.essenceName) return { error: 'method=essence requires essenceName' }
    return { kind: 'essence', essenceName: o.essenceName }
  }
  if (method === 'fossil') {
    if (!o.fossilNames?.length) return { error: 'method=fossil requires fossilNames' }
    return { kind: 'fossil', fossilNames: o.fossilNames }
  }
  if (method === 'bench') {
    if (!o.benchMods?.length) return { error: 'method=bench requires benchMods' }
    return { kind: 'bench', benchMods: o.benchMods }
  }
  if (method === 'multimod') {
    if (!o.benchMods?.length) return { error: 'method=multimod requires benchMods' }
    return { kind: 'multimod', benchMods: o.benchMods }
  }
  if (method === 'slam') return { kind: 'slam', protect: o.protect, baseValueChaos: o.baseValueChaos }
  if (method === 'alt-regal') return { kind: 'alt-regal' }
  return { kind: 'chaos-spam' }
}

function money(chaos: number | null, divineChaos: number | null): string {
  if (chaos == null) return '—'
  const div = divineChaos ? ` (${(chaos / divineChaos).toFixed(2)} div)` : ''
  return `${chaos.toFixed(1)}c${div}`
}

function render(r: CraftCostEstimate): string {
  const lines: string[] = [
    `**calc_craft_cost — ${r.base} (ilvl ${r.ilvl})** · ${r.method}`,
    `League: ${r.league} · ${r.stampDate} · prices move; this is an expected-value estimate.`,
    '',
  ]
  if (!r.supported) {
    lines.push(`⚠ **Unsupported:** ${r.reason}`)
    lines.push('', '_The model marks targets it cannot yet sequence rather than guessing._')
    return lines.join('\n')
  }

  lines.push(
    `**Expected attempts:** ${r.expectedAttempts.toFixed(1)} ` +
      `(P(hit)/attempt = ${(r.perAttemptProb * 100).toFixed(2)}%)`,
    '',
    '**Consumables (expected, whole craft):**',
    '| Consumable | Qty | Each | Total |',
    '|---|---|---|---|',
  )
  for (const c of r.consumables) {
    lines.push(
      `| ${c.name}${c.lowConfidence ? ' ⚠' : ''} | ${c.qty.toFixed(c.qty < 10 ? 2 : 0)} | ` +
        `${money(c.chaosEach, r.divineChaos)} | ${money(c.chaosTotal, r.divineChaos)} |`,
    )
  }
  lines.push('')
  lines.push(
    `**Total expected craft cost:** ${r.totalChaos != null ? money(r.totalChaos, r.divineChaos) : '— (incomplete pricing)'}` +
      (r.totalDivine != null ? `  ≈ **${r.totalDivine.toFixed(2)} div**` : ''),
  )

  if (r.risk) {
    const d = r.risk.distribution
    lines.push(
      `**Cost distribution:** expected ${money(d.mean, r.divineChaos)} · p50 ${money(d.p50, r.divineChaos)} · ` +
        `p90 ${money(d.p90, r.divineChaos)} · p95 ${money(d.p95, r.divineChaos)} _(${d.method})_`,
      `**Risk:** ${r.risk.category.toUpperCase()} · determinism ${r.risk.determinism.score.toFixed(2)}` +
        r.risk.bricks.map(b => ` · ⚠ ${b.label} ${(b.failureProb * 100).toFixed(0)}% brick risking ${money(b.valueAtRisk, r.divineChaos)}`).join(''),
    )
  }

  if (r.buySide) {
    const b = r.buySide
    lines.push(
      `**Buy side (${b.source}):** ${money(b.lowChaos, r.divineChaos)} – ${money(b.medianChaos, r.divineChaos)} ` +
        `· ${b.confidence} confidence${b.tradeUrl ? ` · ${b.tradeUrl}` : ''}`,
    )
  }
  const v = r.verdict
  const tag =
    v.decision === 'craft-likely-cheaper' ? '🟢 CRAFT likely cheaper'
      : v.decision === 'buy-likely-cheaper' ? '🔴 BUY likely cheaper'
        : v.decision === 'overlapping' ? '🟡 OVERLAPPING — no clear edge'
          : '⚪ UNKNOWN'
  lines.push(`**Verdict:** ${tag}${v.riskAdjusted ? ' (risk-adjusted)' : ''} (${v.confidence} conf) — ${v.rationale}`)

  if (r.lowConfidence) lines.push('', `⚠ **${'LOW CONFIDENCE'}** — trust the divine figures over chaos micro-prices.`)
  if (r.notes.length) {
    lines.push('', '**Notes:**')
    for (const n of r.notes) lines.push(`- ${n}`)
  }
  return lines.join('\n')
}
