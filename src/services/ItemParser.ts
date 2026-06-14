export interface ParsedClipboardItem {
  raw: string
  rarity: string
  name: string
  baseType: string
  itemClass: string
  itemLevel: number
  quality: number
  sockets: number
  links: number
  corrupted: boolean
  explicitMods: string[]
  implicitMods: string[]
  enchantMods: string[]
  craftedMods: string[]
  fracturedMods: string[]
  affixMods: string[]
  mapTier: number
  gemLevel: number
  stackSize: number
  influences: string[]
  unidentified: boolean
  mirrored: boolean
}

export interface AutomationParsedItem {
  rarity: string
  mods: string[]
  fracturedCount: number
}

const EXPLICIT_TAGS = new Set(['augmented', 'crafted', 'fractured', 'veiled'])
const IMPLICIT_TAGS = new Set(['implicit', 'searing exarch', 'eater of worlds'])
const NON_EXPLICIT_TAGS = new Set(['enchant', 'implicit', 'scourge', 'searing exarch', 'eater of worlds'])
const METADATA_RE = /^(Corrupted|Mirrored|Unidentified|Split|Shaper Item|Elder Item|Crusader Item|Warlord Item|Hunter Item|Redeemer Item|Synthesised Item|Fractured Item|Scouring Lock)$/i
const KNOWN_PROPERTY_RE = /^(Requirements|Level|Strength|Dexterity|Intelligence|Sockets|Quality|Map Tier|Stack Size|Item Level|Gem Tags|Cost|Experience):/

type ParsedTaggedLine = {
  text: string
  tag: string | null
}

function splitSections(lines: string[]): string[][] {
  const sections: string[][] = []
  let current: string[] = []

  for (const line of lines) {
    if (line === '--------') {
      if (current.length > 0) sections.push(current)
      current = []
      continue
    }
    current.push(line)
  }

  if (current.length > 0) sections.push(current)
  return sections
}

function parseTaggedLine(line: string): ParsedTaggedLine {
  const suffix = line.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (suffix) {
    return { text: suffix[1].trim(), tag: suffix[2].trim().toLowerCase() }
  }

  const prefix = line.match(/^\{([^}]+)\}\s*(.+)$/)
  if (prefix) {
    return { text: prefix[2].trim(), tag: prefix[1].trim().toLowerCase() }
  }

  return { text: line.trim(), tag: null }
}

function parseInteger(line: string, pattern: RegExp): number | null {
  const match = line.match(pattern)
  return match ? parseInt(match[1], 10) : null
}

function applyHeader(item: ParsedClipboardItem, header: string[]): void {
  for (const line of header) {
    const classMatch = line.match(/^Item Class:\s*(.+)/)
    if (classMatch) {
      item.itemClass = classMatch[1].trim()
      continue
    }

    const rarityMatch = line.match(/^Rarity:\s*(.+)/)
    if (rarityMatch) {
      item.rarity = rarityMatch[1].trim()
    }
  }

  const rarityIdx = header.findIndex(line => line.startsWith('Rarity:'))
  if (rarityIdx === -1) return

  const afterRarity = header.slice(rarityIdx + 1).map(line => line.trim()).filter(Boolean)
  if (item.rarity === 'Rare' || item.rarity === 'Unique') {
    item.name = afterRarity[0] ?? ''
    item.baseType = afterRarity[1] ?? ''
    return
  }

  if (item.rarity === 'Magic' || item.rarity === 'Normal') {
    item.baseType = afterRarity[0] ?? ''
    item.name = item.baseType
    return
  }

  item.name = afterRarity[0] ?? ''
  item.baseType = afterRarity[1] ?? item.name
}

function applySectionProperty(item: ParsedClipboardItem, line: string): boolean {
  const itemLevel = parseInteger(line, /^Item Level:\s*(\d+)/)
  if (itemLevel !== null) {
    item.itemLevel = itemLevel
    return true
  }

  const quality = parseInteger(line, /^Quality:\s*\+?(\d+)%/)
  if (quality !== null) {
    item.quality = quality
    return true
  }

  const mapTier = parseInteger(line, /^Map Tier:\s*(\d+)/)
  if (mapTier !== null) {
    item.mapTier = mapTier
    return true
  }

  const stackSize = parseInteger(line, /^Stack Size:\s*(\d+)/)
  if (stackSize !== null) {
    item.stackSize = stackSize
    return true
  }

  const gemLevel = parseInteger(line, /^Level:\s*(\d+)/)
  if (gemLevel !== null && item.rarity === 'Gem') {
    item.gemLevel = gemLevel
    return true
  }

  const socketMatch = line.match(/^Sockets:\s*(.+)/)
  if (socketMatch) {
    const raw = socketMatch[1]
    item.sockets = raw.replace(/[-\s]/g, '').length
    item.links = Math.max(...raw.split(/\s+/).map(group => group.split('-').length), 0)
    return true
  }

  if (line === 'Corrupted') {
    item.corrupted = true
    return true
  }

  if (line === 'Unidentified') {
    item.unidentified = true
    return true
  }

  if (line === 'Mirrored') {
    item.mirrored = true
    return true
  }

  if (/^(Shaper|Elder|Crusader|Redeemer|Hunter|Warlord) Item$/.test(line)) {
    item.influences.push(line.replace(' Item', ''))
    return true
  }

  if (KNOWN_PROPERTY_RE.test(line)) return true
  if (METADATA_RE.test(line)) return true
  if (/^Note:/i.test(line)) return true
  if (/^Right click to/i.test(line)) return true
  if (/^Place into/i.test(line)) return true
  if (/^\(.*\)$/.test(line)) return true
  if (/^\{.*\}$/.test(line)) return true

  return false
}

function pushAffix(item: ParsedClipboardItem, entry: ParsedTaggedLine): void {
  if (!entry.text) return

  if (entry.tag === 'crafted') {
    item.craftedMods.push(entry.text)
    item.affixMods.push(entry.text)
    return
  }

  if (entry.tag === 'fractured') {
    item.fracturedMods.push(entry.text)
    item.affixMods.push(entry.text)
    return
  }

  item.explicitMods.push(entry.text)
  item.affixMods.push(entry.text)
}

export function parseAutomationItemText(text: string): AutomationParsedItem {
  const lines = text.split(/\r?\n/).map(line => line.trim())
  const rarityLine = lines.find(line => line.startsWith('Rarity:'))
  const rarity = rarityLine?.split(':')[1]?.trim().toLowerCase() ?? 'unknown'

  const sections = text.split(/--------/)
  const ilIdx = sections.findIndex(section => /\bItem Level:/i.test(section))
  if (ilIdx === -1) return { rarity, mods: [], fracturedCount: 0 }

  const skipRe = [
    /^(Corrupted|Mirrored|Unidentified|Split|Shaper Item|Elder Item|Crusader Item|Warlord Item|Hunter Item|Redeemer Item|Synthesised Item|Fractured Item|Scouring Lock)$/i,
    /^Note:/i,
  ]

  const mods: string[] = []
  let fracturedCount = 0

  for (const section of sections.slice(ilIdx + 1)) {
    const sectionLines = section
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)

    if (sectionLines.length === 0) continue

    const allNonExplicit = sectionLines.every(line => {
      const tagMatch = line.match(/\(([^)]+)\)$/)
      if (!tagMatch) return false
      const tag = tagMatch[1].toLowerCase()
      return !EXPLICIT_TAGS.has(tag)
    })
    if (allNonExplicit) continue

    for (const line of sectionLines) {
      if (skipRe.some(re => re.test(line))) continue
      if (/^\(.*\)$/.test(line)) continue
      if (/^\{.*\}$/.test(line)) continue
      if (/Right click to/i.test(line)) continue

      const lineTagMatch = line.match(/\(([^)]+)\)$/)
      if (lineTagMatch) {
        const tag = lineTagMatch[1].toLowerCase()
        if (!EXPLICIT_TAGS.has(tag)) continue
      }

      const isFractured = /\(fractured\)$/i.test(line)
      if (isFractured) fracturedCount++
      mods.push(line.replace(/\s*\((augmented|fractured|crafted|veiled)\)$/i, '').trim())
    }
  }

  return { rarity, mods, fracturedCount }
}

export function parseClipboardItemText(text: string): ParsedClipboardItem {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(line => line.trim())
  const sections = splitSections(lines)

  const item: ParsedClipboardItem = {
    raw: text,
    rarity: '',
    name: '',
    baseType: '',
    itemClass: '',
    itemLevel: 0,
    quality: 0,
    sockets: 0,
    links: 0,
    corrupted: false,
    explicitMods: [],
    implicitMods: [],
    enchantMods: [],
    craftedMods: [],
    fracturedMods: [],
    affixMods: [],
    mapTier: 0,
    gemLevel: 0,
    stackSize: 0,
    influences: [],
    unidentified: false,
    mirrored: false,
  }

  if (sections.length === 0) return item

  applyHeader(item, sections[0])

  let sawAnyModSection = false
  let usedImplicitFallback = false

  for (const section of sections.slice(1)) {
    const remaining: ParsedTaggedLine[] = []

    for (const rawLine of section) {
      const line = rawLine.trim()
      if (!line) continue
      if (applySectionProperty(item, line)) continue
      remaining.push(parseTaggedLine(line))
    }

    if (remaining.length === 0) continue

    const allEnchant = remaining.every(entry => entry.tag === 'enchant')
    if (allEnchant) {
      sawAnyModSection = true
      for (const entry of remaining) {
        if (entry.text) item.enchantMods.push(entry.text)
      }
      continue
    }

    const allImplicitLike = remaining.every(entry => entry.tag !== null && NON_EXPLICIT_TAGS.has(entry.tag))
    if (allImplicitLike) {
      sawAnyModSection = true
      for (const entry of remaining) {
        if (entry.text && entry.tag && IMPLICIT_TAGS.has(entry.tag)) {
          item.implicitMods.push(entry.text)
        }
      }
      continue
    }

    const plainOnly = remaining.every(entry => entry.tag === null)
    if (plainOnly && !usedImplicitFallback && !sawAnyModSection && remaining.length <= 4) {
      sawAnyModSection = true
      for (const entry of remaining) {
        if (entry.text) item.implicitMods.push(entry.text)
      }
      usedImplicitFallback = true
      continue
    }

    sawAnyModSection = true
    for (const entry of remaining) {
      if (!entry.text) continue
      if (entry.tag === null || EXPLICIT_TAGS.has(entry.tag)) {
        pushAffix(item, entry)
        continue
      }
      if (entry.tag === 'enchant') {
        item.enchantMods.push(entry.text)
        continue
      }
      if (IMPLICIT_TAGS.has(entry.tag)) {
        item.implicitMods.push(entry.text)
      }
    }
  }

  return item
}

export function toAutomationParsedItem(item: ParsedClipboardItem): AutomationParsedItem {
  return {
    rarity: item.rarity.toLowerCase(),
    mods: [...item.affixMods],
    fracturedCount: item.fracturedMods.length,
  }
}