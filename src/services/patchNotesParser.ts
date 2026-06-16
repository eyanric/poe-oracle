/**
 * services — patch-notes parser (Track B, Phase B1).
 *
 * Turns raw GGG patch-notes text (or forum HTML) into structured categories the
 * league-start workflow consumes: new/changed skills (active + support), uniques,
 * mechanic/Atlas changes, buffs/nerfs, and currency/economy changes. The full
 * sectioned raw text is kept alongside so nothing is silently dropped.
 *
 * Pure + deterministic (unit-tested against the 3.28 Mirage corpus). The buff/nerf
 * and category split is keyword-heuristic by design — it surfaces candidates for
 * Claude's runtime reasoning, it is not an authoritative classifier.
 */

export type SkillKind = 'active' | 'support'
export type ChangeKind = 'new' | 'change'
export type Direction = 'buff' | 'nerf'

export interface PatchEntry {
  /** Section header this line appeared under. */
  section: string
  /** The change text (one bullet / line). */
  text: string
  /** Heuristic tags: skill kind, new-vs-change, buff/nerf. */
  tags: string[]
}

export interface PatchSection {
  header: string
  /** Every raw line under the header — nothing dropped. */
  lines: string[]
}

export interface ParsedPatchNotes {
  league: string | null
  version: string | null
  /** Full sectioned raw text (lossless). */
  sections: PatchSection[]
  categories: {
    skills: PatchEntry[]
    uniques: PatchEntry[]
    mechanics: PatchEntry[]
    buffs: PatchEntry[]
    nerfs: PatchEntry[]
    currency: PatchEntry[]
  }
  /** Length of the normalized text — a cheap "did we actually get notes" signal. */
  normalizedLength: number
}

const BULLET = /^\s*[-•*]\s+/

// ── HTML normalization (live forum pages) ────────────────────────────────────

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

/** Sentinel marking a real HTML heading (`<h1-6>`) so the parser can use it as a section boundary
 *  on live forum pages, instead of the plain-text "non-bullet line = header" heuristic (which a
 *  multi-line `<li>` or a Table-of-Contents `<ul>` would otherwise shatter into junk sections). */
export const HDR_MARK = String.fromCharCode(1)

/** Minimal HTML → text: headings → sentinel-marked lines, list items → bullets, blocks → line breaks. */
export function stripHtml(input: string): string {
  if (!input.includes('<')) return input
  let s = input
  s = s.replace(/<h[1-6][^>]*>/gi, `\n${HDR_MARK}`).replace(/<\/h[1-6]>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|div|tr|ul|ol)>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch)
  return s
}

// ── Classification heuristics ────────────────────────────────────────────────

type PrimaryCategory = 'skill' | 'unique' | 'mechanic' | 'currency' | 'other'

function sectionCategory(header: string): PrimaryCategory {
  const h = header.toLowerCase()
  if (/\b(skill|gem)s?\b/.test(h) || /support/.test(h)) return 'skill'
  if (/unique/.test(h)) return 'unique'
  // live notes title the currency section "Item Changes" (the fixture used "Currency").
  if (/\b(currency|economy)\b/.test(h) || /\bitem changes?\b/.test(h)) return 'currency'
  if (/\b(atlas|map|league|mechanic|endgame|ascendanc|breach|delve|ritual|scarab|keepers)\b/.test(h)) return 'mechanic'
  return 'other'
}

const supportRe = /\bsupport\b/i
const newRe = /\b(new|added|introduced|reworked and renamed|has been added)\b/i
const nerfRe = /\b(reduced|decreased|lowered|less\b|no longer|can no longer|removed|nerf|down from)\b/i
const buffRe = /\b(increased|more\b|added damage|improved|enhanced|doubled|now (fires|grants|deals)|up from|buffed|significantly (increased|boosted))\b/i

function entryTags(section: string, text: string, primary: PrimaryCategory): string[] {
  const tags: string[] = []
  if (primary === 'skill') tags.push(supportRe.test(section) || supportRe.test(text) ? 'support' : 'active')
  if (newRe.test(section) || newRe.test(text)) tags.push('new')
  else tags.push('change')
  if (nerfRe.test(text)) tags.push('nerf')
  if (buffRe.test(text)) tags.push('buff')
  return tags
}

// ── Parser ───────────────────────────────────────────────────────────────────

const VERSION_RE = /\b(\d+\.\d+(?:\.\d+)?)\b/
const LEAGUE_RE = /Path of Exile:\s*([A-Z][A-Za-z' ]+?)(?:\s+Patch|\s*$|\n)/

export interface ParseOptions {
  /** Override the league/version when the title line is noisy (live HTML). */
  league?: string
  version?: string
}

export function parsePatchNotes(raw: string, opts: ParseOptions = {}): ParsedPatchNotes {
  const text = stripHtml(raw)
  const allLines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)

  const version = opts.version ?? (text.match(VERSION_RE)?.[1] ?? null)
  const league = opts.league ?? (text.match(LEAGUE_RE)?.[1]?.trim() ?? null)

  const sections: PatchSection[] = []
  let current: PatchSection | null = null
  let sawTitle = false

  // Live forum HTML carries real <h*> headings (sentinel-marked by stripHtml). When present, use ONLY
  // those as section boundaries and treat every other line as content — so a multi-line <li> or the
  // page's Table-of-Contents <ul> can't fabricate junk sections. Plain text (the fixture) has no
  // sentinels and keeps the "non-bullet line = header" heuristic, byte-for-byte unchanged.
  const htmlMode = allLines.some(l => l.startsWith(HDR_MARK))

  for (const line of allLines) {
    if (htmlMode) {
      if (line.startsWith(HDR_MARK)) {
        current = { header: line.slice(HDR_MARK.length).trim(), lines: [] }
        sections.push(current)
      } else {
        const t = line.replace(BULLET, '').trim()
        if (!t) continue
        if (!current) { current = { header: '(preamble)', lines: [] }; sections.push(current) }
        current.lines.push(t)
      }
      continue
    }
    const isBullet = BULLET.test(line)
    if (!isBullet) {
      // First non-bullet line that carries the version is the title — skip it.
      if (!sawTitle && (league ? line.includes(league) : VERSION_RE.test(line))) {
        sawTitle = true
        continue
      }
      // Otherwise a non-bullet line opens a new section.
      current = { header: line, lines: [] }
      sections.push(current)
    } else if (current) {
      current.lines.push(line.replace(BULLET, '').trim())
    } else {
      // Bullets before any header — stash under a synthetic section so nothing drops.
      current = { header: '(preamble)', lines: [line.replace(BULLET, '').trim()] }
      sections.push(current)
    }
  }

  const categories: ParsedPatchNotes['categories'] = { skills: [], uniques: [], mechanics: [], buffs: [], nerfs: [], currency: [] }
  for (const sec of sections) {
    const primary = sectionCategory(sec.header)
    for (const text of sec.lines) {
      const tags = entryTags(sec.header, text, primary)
      const entry: PatchEntry = { section: sec.header, text, tags }
      if (primary === 'skill') categories.skills.push(entry)
      else if (primary === 'unique') categories.uniques.push(entry)
      else if (primary === 'mechanic') categories.mechanics.push(entry)
      else if (primary === 'currency') categories.currency.push(entry)
      if (tags.includes('buff')) categories.buffs.push(entry)
      if (tags.includes('nerf')) categories.nerfs.push(entry)
    }
  }

  return { league, version, sections, categories, normalizedLength: text.length }
}

/** Compact counts — handy for snapshotting / "did the parse capture content". */
export function summarizePatchNotes(p: ParsedPatchNotes): Record<string, number> {
  return {
    sections: p.sections.length,
    skills: p.categories.skills.length,
    uniques: p.categories.uniques.length,
    mechanics: p.categories.mechanics.length,
    buffs: p.categories.buffs.length,
    nerfs: p.categories.nerfs.length,
    currency: p.categories.currency.length,
  }
}
