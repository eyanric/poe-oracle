/**
 * calc_craft_cost MCP tool (Track A, Phase 3) — thin zod/registration + rendering
 * wrapper around the pure cost model in `services/craftCost.ts`.
 *
 * Read-only / analysis only: it informs a manual decision, never acts in-game.
 */
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { estimateCraftCostLive, estimateRecombineLive, type CraftSpec, type CraftCostEstimate, type MethodSpec, type RecombineInput, type RecombineEstimate } from '../services/craftCost'
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
        method: z.enum(['essence', 'alt-regal', 'chaos-spam', 'fossil', 'bench', 'multimod', 'slam', 'harvest', 'eldritch-implicit', 'eldritch-exalt', 'eldritch-annul', 'add-influence', 'orb-of-dominance', 'catalyst', 'anoint']).describe('Crafting method.'),
        essenceName: z.string().optional().describe('Required for method=essence, e.g. "Deafening Essence of Greed".'),
        fossilNames: z.array(z.string()).optional().describe('Required for method=fossil, e.g. ["Pristine Fossil"].'),
        benchMods: z.array(z.string()).optional().describe('Required for method=bench/multimod: bench-craft search terms, e.g. ["maximum Life", "Fire Resistance"].'),
        protect: z.enum(['prefixes', 'suffixes']).optional().describe('method=slam: lock this affix side (cannot be changed) so a miss is recoverable, not a brick.'),
        baseValueChaos: z.number().optional().describe('method=slam: chaos value of the base being slammed (the value-at-risk if it bricks).'),
        harvestCraft: z.enum(['reforge', 'augment', 'remove']).optional().describe('Required for method=harvest: reforge-with-tag / augment-with-tag / remove-tag.'),
        harvestTag: z.string().optional().describe('Required for method=harvest: the mod tag, e.g. "life", "fire", "caster".'),
        eldritchTier: z.enum(['lesser', 'greater', 'grand', 'exceptional']).optional().describe('method=eldritch-implicit: ember/ichor tier (default exceptional = full pool). Side is the desired mod slot (prefix=Exarch, suffix=Eater).'),
        eldritchImplicitTier: z.number().optional().describe('method=eldritch-implicit: pin a value tier (1=highest).'),
        dominant: z.enum(['exarch', 'eater']).optional().describe('Required for method=eldritch-exalt/annul: which eldritch implicit is dominant (Exarch acts on prefixes, Eater on suffixes).'),
        addInfluence: z.enum(['shaper', 'elder', 'crusader', 'redeemer', 'hunter', 'warlord']).optional().describe('Required for method=add-influence: the influence to add (its Conqueror/Shaper/Elder exalt).'),
        catalyst: z.enum(['abrasive', 'accelerating', 'fertile', 'imbued', 'intrinsic', 'noxious', 'prismatic', 'tempering', 'turbulent', 'sinistral', 'dextral']).optional().describe('Required for method=catalyst: the catalyst type (scales matching-tag mod magnitudes on ring/amulet/belt). Sinistral/Dextral are Mirage.'),
        quality: z.number().optional().describe('method=catalyst: target quality % (cap 20, default 20).'),
        notable: z.string().optional().describe('method=anoint: the named notable to anoint (resolved via the seed recipe table).'),
        oils: z.array(z.string()).optional().describe('method=anoint: explicit 3 oils (e.g. ["Golden","Golden","Golden"]) — prices any anoint when the notable is not seeded.'),
        influence: z.array(z.string()).optional().describe('Item influence(s). eldritch ⊥ influence — influenced items are rejected for eldritch methods; add-influence requires NO existing influence.'),
        corrupted: z.boolean().optional().describe('Corrupted items cannot take eldritch implicits / influence.'),
        affixes: z.array(z.object({ slot: slotEnum, group: z.string().optional(), modId: z.string().optional(), label: z.string().optional(), influenced: z.boolean().optional() })).optional().describe('Existing affixes (eldritch annul reads the dominant side; Orb of Dominance counts `influenced` affixes — needs ≥2).'),
        blockedGroups: z.array(z.string()).optional().describe('Mod groups already blocked (raises Harvest augment odds — augment reads these).'),
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
    async ({ baseName, ilvl, desiredMods, method, essenceName, fossilNames, benchMods, protect, baseValueChaos, harvestCraft, harvestTag, eldritchTier, eldritchImplicitTier, dominant, addInfluence, catalyst, quality, notable, oils, influence, corrupted, affixes, blockedGroups, meta, finishedItemQuery, league }) => {
      const methodSpec = toMethodSpec(method, { essenceName, fossilNames, benchMods, protect, baseValueChaos, harvestCraft, harvestTag, eldritchTier, eldritchImplicitTier, dominant, addInfluence, catalyst, quality, notable, oils })
      if ('error' in methodSpec) {
        return { content: [{ type: 'text', text: `**calc_craft_cost** — input error: ${methodSpec.error}` }], isError: true }
      }
      const spec: CraftSpec = {
        baseName,
        ilvl,
        desired: desiredMods as DesiredMod[],
        method: methodSpec,
        meta,
        blockedGroups,
        influence,
        corrupted,
        affixes: affixes?.map(a => ({ slot: a.slot, group: a.group ?? a.modId ?? a.label ?? 'x', modId: a.modId ?? a.group ?? a.label ?? 'x', label: a.label, influenced: a.influenced })) as CraftSpec['affixes'],
        finishedItemQuery,
      }
      const result = await estimateCraftCostLive(spec, league)
      return { content: [{ type: 'text', text: render(result) }], structuredContent: result }
    },
  )
}

// ── calc_recombine (arity-2 combine) ──────────────────────────────────────────

const recombineAffix = z.object({
  group: z.string().describe('Mod group, e.g. "IncreasedLife".'),
  modId: z.string().optional(),
  label: z.string().optional(),
  desired: z.boolean().optional().describe('Mark mods you want to survive onto the output.'),
  exclusive: z.boolean().optional().describe('Settlers "exclusive" modifier (≤1 survives a combine).'),
})
const recombineItem = z.object({
  itemClass: z.string().describe('Item class, e.g. "Ring" / "Body Armour" (picks the recombinator type).'),
  ilvl: z.number(),
  baseName: z.string().optional(),
  prefixes: z.array(recombineAffix).optional(),
  suffixes: z.array(recombineAffix).optional(),
  valueChaos: z.number().optional().describe('Chaos value of this input item (consumed each attempt).'),
})

export function registerRecombineTool(server: McpServer): void {
  server.registerTool(
    'calc_recombine',
    {
      title: 'Recombinator (combine two items)',
      description:
        'Estimate a Settlers-ruleset recombine of TWO input items: P(target prefix/suffix set survives), ' +
        'brick probability (incl. the exclusive-mod collision), expected attempts, and cost (2 input items ' +
        '+ recombinator currency, live-priced) with a risk profile. Mark mods `desired` to target them and ' +
        '`exclusive` for Settlers exclusive mods. ⚠ Stage-A count distribution + the exclusive set are ' +
        'low-confidence (not in the data export); P-of-selection compounding is exact. Read-only.',
      inputSchema: {
        itemA: recombineItem,
        itemB: recombineItem,
        league: z.string().optional().describe('League name. Defaults to the current challenge league.'),
      },
    },
    async ({ itemA, itemB, league }) => {
      const result = await estimateRecombineLive(itemA as RecombineInput, itemB as RecombineInput, league)
      return { content: [{ type: 'text', text: renderRecombine(result) }], structuredContent: result as unknown as Record<string, unknown> }
    },
  )
}

function renderRecombine(r: RecombineEstimate): string {
  const money = (c: number | null) => (c == null ? '—' : `${c.toFixed(0)}c${r.divineChaos ? ` (${(c / r.divineChaos).toFixed(2)} div)` : ''}`)
  const lines: string[] = [
    `**Recombine — ${r.recombinator}** · League: ${r.league} · ${r.stampDate}`,
    `Output ilvl ${r.outputIlvl} · pools: ${r.prefixPool} prefix / ${r.suffixPool} suffix (independent, cap 3/3)`,
    '',
  ]
  if (!r.supported) {
    lines.push(`⚠ **Unsupported / brick:** ${r.reason}`)
    if (r.exclusiveCollision) lines.push('_(exclusive-mod collision — at most one exclusive survives)_')
    lines.push('', '_Stage-A distribution + exclusive set are low-confidence; P-selection is exact._')
    return lines.join('\n')
  }
  lines.push(
    `**P(target):** ${(r.pTarget * 100).toFixed(1)}% = prefixes ${(r.pPrefix * 100).toFixed(1)}% × suffixes ${(r.pSuffix * 100).toFixed(1)}%`,
    `**Brick (target not achieved):** ${(r.brickProb * 100).toFixed(1)}% · expected attempts ${r.expectedAttempts.toFixed(1)}`,
    `**Expected cost:** ${money(r.totalChaos)}${r.totalDivine != null ? ` ≈ ${r.totalDivine.toFixed(2)} div` : ''}`,
  )
  if (r.risk) lines.push(`**Risk:** ${r.risk.category.toUpperCase()} · p90 ${money(r.risk.distribution.p90)}`)
  lines.push('', '⚠ LOW CONFIDENCE — Stage-A count table + exclusive set are unconfirmed (not in the data export).')
  for (const n of r.notes) lines.push(`- ${n}`)
  return lines.join('\n')
}

function toMethodSpec(
  method: string,
  o: {
    essenceName?: string; fossilNames?: string[]; benchMods?: string[]; protect?: 'prefixes' | 'suffixes'; baseValueChaos?: number;
    harvestCraft?: 'reforge' | 'augment' | 'remove'; harvestTag?: string;
    eldritchTier?: 'lesser' | 'greater' | 'grand' | 'exceptional'; eldritchImplicitTier?: number; dominant?: 'exarch' | 'eater';
    addInfluence?: 'shaper' | 'elder' | 'crusader' | 'redeemer' | 'hunter' | 'warlord';
    catalyst?: 'abrasive' | 'accelerating' | 'fertile' | 'imbued' | 'intrinsic' | 'noxious' | 'prismatic' | 'tempering' | 'turbulent' | 'sinistral' | 'dextral'; quality?: number;
    notable?: string; oils?: string[];
  },
): MethodSpec | { error: string } {
  if (method === 'catalyst') {
    if (!o.catalyst) return { error: 'method=catalyst requires catalyst (e.g. prismatic|abrasive|...)' }
    return { kind: 'catalyst', catalyst: o.catalyst, quality: o.quality }
  }
  if (method === 'anoint') {
    if (!o.notable && !(o.oils && o.oils.length)) return { error: 'method=anoint requires notable or oils (3)' }
    return { kind: 'anoint', notable: o.notable, oils: o.oils }
  }
  if (method === 'add-influence') {
    if (!o.addInfluence) return { error: 'method=add-influence requires addInfluence (shaper|elder|crusader|redeemer|hunter|warlord)' }
    return { kind: 'add-influence', influence: o.addInfluence }
  }
  if (method === 'orb-of-dominance') return { kind: 'orb-of-dominance' }
  if (method === 'eldritch-implicit') return { kind: 'eldritch-implicit', tier: o.eldritchTier, implicitTier: o.eldritchImplicitTier }
  if (method === 'eldritch-exalt') {
    if (!o.dominant) return { error: 'method=eldritch-exalt requires dominant (exarch|eater)' }
    return { kind: 'eldritch-exalt', dominant: o.dominant }
  }
  if (method === 'eldritch-annul') {
    if (!o.dominant) return { error: 'method=eldritch-annul requires dominant (exarch|eater)' }
    return { kind: 'eldritch-annul', dominant: o.dominant }
  }
  if (method === 'harvest') {
    if (!o.harvestCraft || !o.harvestTag) return { error: 'method=harvest requires harvestCraft + harvestTag' }
    return { kind: 'harvest', craft: o.harvestCraft, tag: o.harvestTag }
  }
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
