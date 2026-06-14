/**
 * data layer — Path of Building export fetcher (parse_pob, Phase 1).
 *
 * Resolves a share link (pobb.in / pastebin) to its RAW export code, or passes a
 * raw base64 code straight through. Knows nothing about decoding or build logic —
 * it just returns the export-code string (on the shared `fetchText` cache). The
 * service layer (`pobParser`) decodes + structures.
 *
 * Clean-room: we consume the public export-code format, not PoB source. Read-only.
 */
import { fetchText, type FetchJsonOptions } from './fetchJson'

export interface PobSource {
  kind: 'pobb.in' | 'pastebin' | 'raw'
  /** The URL fetched for the raw code (absent for a raw pasted code). */
  rawUrl?: string
}

/**
 * Map a PoB share input to the URL that returns its raw export code, or null when
 * the input is already a raw code (not a URL).
 *   pobb.in/<id> | pobb.in/u/<user>/<id>  → append /raw
 *   pastebin.com/<id>                      → pastebin.com/raw/<id>
 */
export function resolvePobRawUrl(input: string): { url: string | null; source: PobSource } {
  const trimmed = input.trim()
  if (!/^https?:\/\//i.test(trimmed)) return { url: null, source: { kind: 'raw' } }

  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return { url: null, source: { kind: 'raw' } }
  }
  const host = u.hostname.replace(/^www\./, '')

  if (host === 'pobb.in') {
    const path = u.pathname.replace(/\/+$/, '')
    const url = `https://pobb.in${path}/raw`
    return { url, source: { kind: 'pobb.in', rawUrl: url } }
  }
  if (host === 'pastebin.com') {
    const id = u.pathname.replace(/^\/+/, '').replace(/^raw\//, '')
    const url = `https://pastebin.com/raw/${id}`
    return { url, source: { kind: 'pastebin', rawUrl: url } }
  }
  // Unknown host that still looks like a URL — try it verbatim (may already be raw).
  return { url: trimmed, source: { kind: 'raw', rawUrl: trimmed } }
}

/** Resolve + fetch the raw export code for a link, or return a pasted raw code as-is. */
export async function getPobCode(input: string, opts?: FetchJsonOptions): Promise<{ code: string; source: PobSource }> {
  const { url, source } = resolvePobRawUrl(input)
  if (!url) return { code: input.trim(), source }
  const code = (await fetchText(url, opts)).trim()
  return { code, source }
}
