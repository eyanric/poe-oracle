/**
 * services — Path of Building export parser (parse_pob, Phase 1).
 *
 * Decodes a PoB export code (base64url → zlib-inflate → XML) and structures it:
 * class/ascendancy/level, gem links by slot, equipped items with full mods, the
 * passive-tree spec(s) (allocated node ids + counts + titles), and PoB's reported
 * stats. Keystone/notable NAMES need the tree data export — resolved by
 * `passiveTree.resolveAllocatedNodes` (Phase 2), kept separate so this parser has
 * no tree dependency.
 *
 * Clean-room: we parse the public export FORMAT, not PoB source. The XML parser is a
 * minimal, tolerant reader tailored to PoB's output (no external dep).
 */
import zlib from 'node:zlib'
import { parseClipboardItemText } from './ItemParser'

// ── Minimal XML ───────────────────────────────────────────────────────────────

export interface XmlNode {
  tag: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#xD;': '\r', '&#xA;': '\n', '&#x9;': '\t' }
function decodeEntities(s: string): string {
  let out = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  for (const [e, c] of Object.entries(ENTITIES)) out = out.split(e).join(c)
  return out
}

const TAG_RE = /<(\/)?([A-Za-z_][\w:-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g
const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"/g

/** Tolerant XML → tree, sufficient for PoB exports (attrs, nesting, text bodies). */
export function parseXml(xml: string): XmlNode | null {
  const cleaned = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let lastIndex = 0
  let m: RegExpExecArray | null

  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(cleaned)) !== null) {
    const [full, closing, tag, attrStr, selfClose] = m
    const between = cleaned.slice(lastIndex, m.index).trim()
    if (between) stack[stack.length - 1].text += decodeEntities(between)
    lastIndex = m.index + full.length

    if (closing) {
      if (stack.length > 1 && stack[stack.length - 1].tag === tag) stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    let a: RegExpExecArray | null
    ATTR_RE.lastIndex = 0
    while ((a = ATTR_RE.exec(attrStr)) !== null) attrs[a[1]] = decodeEntities(a[2])
    const node: XmlNode = { tag, attrs, children: [], text: '' }
    stack[stack.length - 1].children.push(node)
    if (!selfClose) stack.push(node)
  }
  return root.children[0] ?? null
}

const find = (n: XmlNode, tag: string): XmlNode | undefined => n.children.find(c => c.tag === tag)
const findAll = (n: XmlNode, tag: string): XmlNode[] => n.children.filter(c => c.tag === tag)
const numAttr = (n: XmlNode, k: string): number => { const v = Number(n.attrs[k]); return Number.isFinite(v) ? v : 0 }

// ── Decode ────────────────────────────────────────────────────────────────────

/** base64url → zlib-inflate → XML string. Throws a clear error if it isn't a PoB code. */
export function decodePobCode(code: string): string {
  const cleaned = code.trim().replace(/\s+/g, '')
  if (!cleaned) throw new Error('empty PoB code')
  const b64 = cleaned.replace(/-/g, '+').replace(/_/g, '/')
  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    throw new Error('PoB code is not valid base64')
  }
  let xml: string | null = null
  for (const fn of [zlib.inflateSync, zlib.inflateRawSync, zlib.gunzipSync]) {
    try {
      xml = fn(buf).toString('utf8')
      break
    } catch {
      /* try next codec */
    }
  }
  if (!xml) throw new Error('could not inflate PoB code (not zlib/gzip data)')
  if (!xml.includes('<PathOfBuilding')) throw new Error('decoded data is not a Path of Building export')
  return xml
}

// ── Structured output ─────────────────────────────────────────────────────────

export interface PobGem {
  name: string
  skillId?: string
  level: number
  quality: number
  enabled: boolean
  /** A support gem (vs an active skill gem). */
  support: boolean
}

export interface PobSkillGroup {
  slot: string
  /** This group holds the build's main active skill. */
  main: boolean
  enabled: boolean
  gems: PobGem[]
}

export interface PobItem {
  id: string
  slot?: string
  rarity: string
  name: string
  baseType: string
  itemLevel: number
  mods: string[]
  /** Influence(s) on the item (Shaper/Elder/Conqueror/Eldritch) — from the export's `X Item` lines. */
  influences?: string[]
  raw: string
}

const POB_INFLUENCES = ['Shaper', 'Elder', 'Warlord', 'Hunter', 'Redeemer', 'Crusader', 'Searing Exarch', 'Eater of Worlds']

/**
 * PoB EXPORT item format ≠ the in-game clipboard format: it has no `--------` section dividers, uses
 * `Implicits: N` then the mod lines (with `{crafted}`/`{fractured}`/`{range:…}` tag prefixes), and
 * embeds metadata (Unique ID, *BasePercentile, `X Item` influence flags). Extract the mods directly —
 * everything after the `Implicits: N` marker, tags stripped. Returns null for the clipboard format.
 */
function extractPobItemMods(raw: string): string[] | null {
  const lines = raw.split('\n').map(l => l.trim())
  const implIdx = lines.findIndex(l => /^Implicits:\s*\d+/i.test(l))
  if (implIdx < 0) return null
  const mods: string[] = []
  for (const line of lines.slice(implIdx + 1)) {
    const m = line.replace(/^(\{[^}]*\}\s*)+/, '').trim() // drop {crafted}/{fractured}/{range:…}/{tags:…}
    if (!m || /^(Corrupted|Mirrored|Split|Synthesised Item|Fractured Item)$/i.test(m)) continue
    mods.push(m)
  }
  return mods.length ? mods : null
}

const extractInfluences = (raw: string): string[] =>
  POB_INFLUENCES.filter(inf => new RegExp(`^${inf} Item$`, 'm').test(raw))

export interface PobTreeSpec {
  title?: string
  treeVersion?: string
  nodeCount: number
  nodeIds: number[]
  url?: string
}

export interface ParsedPob {
  className: string
  ascendancy: string
  level: number
  mainSkill?: string
  /** PoB's own reported stats (Life, EnergyShield, resists, DPS…). */
  stats: Record<string, number>
  skillGroups: PobSkillGroup[]
  items: PobItem[]
  trees: PobTreeSpec[]
  /** Each tree spec's title + allocated node count (progression stages). */
  progression: Array<{ title: string; nodeCount: number }>
}

function parseGem(g: XmlNode): PobGem {
  const name = g.attrs.nameSpec || g.attrs.skillId || 'Unknown'
  const skillId = g.attrs.skillId || g.attrs.gemId || undefined
  // PoB marks supports via skillId prefix or the gem name; fall back to a name check.
  const support = /Support$/i.test(name) || /^Support/i.test(skillId ?? '')
  return {
    name,
    skillId,
    level: numAttr(g, 'level') || 1,
    quality: numAttr(g, 'quality'),
    enabled: g.attrs.enabled !== 'false',
    support,
  }
}

function parseSkills(root: XmlNode): { groups: PobSkillGroup[]; mainSkill?: string } {
  const skills = find(root, 'Skills')
  if (!skills) return { groups: [] }
  // Skills may nest groups under a <SkillSet>; handle both flat and set-wrapped. Builds with leveling
  // guides carry MANY sets — use the ACTIVE one (`activeSkillSet` → matching `id`), not the first.
  const sets = findAll(skills, 'SkillSet')
  const activeId = skills.attrs.activeSkillSet
  const container = sets.find(s => s.attrs.id === activeId) ?? sets[0] ?? skills
  const mainGroupIdx = numAttr(find(root, 'Build') ?? root, 'mainSocketGroup')

  const groups: PobSkillGroup[] = []
  const skillNodes = findAll(container, 'Skill')
  skillNodes.forEach((s, i) => {
    const gems = findAll(s, 'Gem').map(parseGem)
    groups.push({
      slot: s.attrs.slot || s.attrs.label || `Group ${i + 1}`,
      main: i + 1 === mainGroupIdx,
      enabled: s.attrs.enabled !== 'false',
      gems,
    })
  })
  // Main skill = the designated group's first active (non-support) gem. Some builds point
  // `mainSocketGroup` at an empty header/annotation group — fall back to the first group that
  // actually holds an active skill (enabled first) rather than reporting none.
  const activeGem = (g?: PobSkillGroup): string | undefined => g?.gems.find(x => !x.support)?.name
  const mainSkill =
    activeGem(groups.find(g => g.main)) ??
    activeGem(groups.find(g => g.enabled && g.gems.some(x => !x.support))) ??
    activeGem(groups.find(g => g.gems.some(x => !x.support)))
  return { groups, mainSkill }
}

function parseItems(root: XmlNode): PobItem[] {
  const itemsNode = find(root, 'Items')
  if (!itemsNode) return []

  // slot map from the active item set
  const slotByItemId = new Map<string, string>()
  const sets = findAll(itemsNode, 'ItemSet')
  const activeSetId = itemsNode.attrs.activeItemSet
  const activeSet = sets.find(s => s.attrs.id === activeSetId) ?? sets[0]
  if (activeSet) {
    for (const slot of findAll(activeSet, 'Slot')) {
      if (slot.attrs.itemId && slot.attrs.name) slotByItemId.set(slot.attrs.itemId, slot.attrs.name)
    }
  }

  const items: PobItem[] = []
  for (const it of findAll(itemsNode, 'Item')) {
    const raw = it.text.trim()
    if (!raw) continue
    const parsed = parseClipboardItemText(raw)
    // PoB EXPORT format (Implicits: N, no `----`) → extract directly; else the clipboard parse.
    // Merge every captured mod line — for a PoB item we want all of them (incl. enchants/crafts).
    const mods = extractPobItemMods(raw) ?? [...new Set([...parsed.affixMods, ...parsed.implicitMods, ...parsed.enchantMods])]
    const influences = extractInfluences(raw)
    // PoB export has `Item Level: N` without the `----` dividers the clipboard parser needs.
    const itemLevel = parsed.itemLevel || Number((raw.match(/^Item Level:\s*(\d+)/m) ?? [])[1]) || 0
    items.push({
      id: it.attrs.id ?? '',
      slot: it.attrs.id ? slotByItemId.get(it.attrs.id) : undefined,
      rarity: parsed.rarity,
      name: parsed.name,
      baseType: parsed.baseType,
      itemLevel,
      mods,
      influences: influences.length ? influences : undefined,
      raw,
    })
  }
  return items
}

function parseTrees(root: XmlNode): PobTreeSpec[] {
  const treeNode = find(root, 'Tree')
  if (!treeNode) return []
  return findAll(treeNode, 'Spec').map(spec => {
    const nodeIds = (spec.attrs.nodes ?? '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n) && n > 0)
    return {
      title: spec.attrs.title,
      treeVersion: spec.attrs.treeVersion,
      nodeCount: nodeIds.length,
      nodeIds,
      url: find(spec, 'URL')?.text.trim() || undefined,
    }
  })
}

/** Parse decoded PoB XML into the structured build. */
export function parsePob(xml: string): ParsedPob {
  const root = parseXml(xml)
  if (!root || root.tag !== 'PathOfBuilding') throw new Error('not a PathOfBuilding document')

  const build = find(root, 'Build') ?? root
  const stats: Record<string, number> = {}
  for (const ps of findAll(build, 'PlayerStat')) {
    const stat = ps.attrs.stat
    const value = Number(ps.attrs.value)
    if (stat && Number.isFinite(value)) stats[stat] = value
  }

  const { groups, mainSkill } = parseSkills(root)
  const trees = parseTrees(root)

  const ascend = build.attrs.ascendClassName || ''
  return {
    className: build.attrs.className || 'Unknown',
    ascendancy: ascend === 'None' ? '' : ascend,
    level: numAttr(build, 'level') || 1,
    mainSkill,
    stats,
    skillGroups: groups,
    items: parseItems(root),
    trees,
    progression: trees.map((t, i) => ({ title: t.title || `Tree ${i + 1}`, nodeCount: t.nodeCount })),
  }
}

/** Decode + parse in one step (the common path). */
export function parsePobCode(code: string): ParsedPob {
  return parsePob(decodePobCode(code))
}
