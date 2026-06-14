/**
 * isPoeItemText — heuristic for "is this clipboard string a copied PoE item?".
 *
 * PoE item clipboard text always has a `Rarity:` line near the top and the
 * 8-dash `--------` section separators. Used by VAAL's clipboard watcher to
 * decide whether a clipboard change is worth pricing. Pure / no I/O.
 */
export function isPoeItemText(text: string | null | undefined): boolean {
  if (!text || text.length < 16 || text.length > 20_000) return false
  return /(^|\n)Rarity:\s/.test(text) && text.includes('--------')
}
