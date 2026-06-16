/**
 * data layer — GGG patch-notes fetcher (Track B, Phase B1).
 *
 * Fetches the raw HTML/text of an official Path of Exile patch-notes forum thread.
 * Knows nothing about parsing or game logic — it just retrieves bytes (on the shared
 * `fetchText` cache). The service layer (`patchNotesParser`) normalizes + structures.
 *
 * Reads PUBLIC patch notes only (ToS-clean). No automation, no auth.
 */
import { fetchText, type FetchJsonOptions } from './fetchJson'

/** GGG news/forum HTML has historically 403'd the default tool UA — a browser UA gets through
 *  (the same win proven on poewiki Cargo). Callers can still override via `opts.headers`. */
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export interface PatchNoteSource {
  /** Display version, e.g. "3.28.0". */
  version: string
  /** League / expansion name. */
  league: string
  /** Official GGG forum thread for the main content-update patch notes. */
  url: string
}

/**
 * Known patch-note sources. 3.28 (Mirage) is the dry-run corpus; 3.29 gets added
 * here on reveal day (July 16, 2026) and the rest of the pipeline is unchanged.
 */
export const PATCH_NOTE_SOURCES: Record<string, PatchNoteSource> = {
  '3.28': {
    version: '3.28.0',
    league: 'Mirage',
    url: 'https://www.pathofexile.com/forum/view-thread/3913392',
  },
}

/** Fetch raw patch-notes text for a known version key (e.g. "3.28") or a direct URL. */
export async function getPatchNotesRaw(versionOrUrl: string, opts?: FetchJsonOptions): Promise<{ source: PatchNoteSource | null; raw: string }> {
  const known = PATCH_NOTE_SOURCES[versionOrUrl]
  const url = known?.url ?? versionOrUrl
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`getPatchNotesRaw: "${versionOrUrl}" is not a known version key or a URL`)
  }
  const raw = await fetchText(url, { ...opts, headers: { 'User-Agent': BROWSER_UA, ...opts?.headers } })
  return { source: known ?? null, raw }
}
