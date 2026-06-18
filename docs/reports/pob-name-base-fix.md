# Report — metadata-aware name/base in the PoB item header

**Date:** 2026-06-17 · **League:** Mirage (live corpus) · **Status:** 🟢 shipped. Gates green
(typecheck ✓ · lint ✓ · 430 tests ✓ · build ✓ · **parity snapshot byte-identical**). Pushed.
**Parser-only (rung-1)** — `ItemParser.applyHeader` only. Mod extraction, unique-bucket logic, the
variant matcher, economy, and the solver are untouched.

## Repro (pinned before any code change)

Source build `pobb.in/0mLsHPwVEPfp`, slot **Flask 1**, a `Rarity: MAGIC` tincture:

```
Rarity: MAGIC
Enriched Rosethorn Tincture of Mastery
Unique ID: 533a4d8711f1ccc12956813ebf78acb431e805db33cda7aa24a2f889bcf3764d
Item Level: 85
…
```

- **name** `"Enriched Rosethorn Tincture of Mastery"` (correct) · **baseType** `"Unique ID: 533a4d87…"` ← **wrong**.

## Root cause (broader than the "Unique ID:" symptom)

The flagged symptom was `Unique ID:` landing in `baseType`, but the actual trigger is **case-sensitive
rarity routing**, and the bleed class is wider. A corpus sweep of what lands at the name(0)/base(1)
positions showed metadata **only ever** at the *base* position, and **only for MAGIC items** — never
Rare/Unique:

```
=== metadata at NAME position (index 0) ===   (none)
=== metadata at BASE position (index 1) ===
  [MAGIC] Unique ID: …      [MAGIC] Armour: …      [MAGIC] Crafted: true
  [MAGIC] Energy Shield: …  [MAGIC] Item Level: …
```

Why: PoB **export** emits rarity in **UPPERCASE** (`MAGIC`/`NORMAL`/`RARE`/`UNIQUE`), but `applyHeader`
compared `item.rarity === 'Magic'` (case-sensitive) → the Magic/Normal branch never matched, so MAGIC
items fell through to the **two-line** branch (`name=afterRarity[0]`, `baseType=afterRarity[1]`). A Magic
item has a *single* combined name line, so index 1 is whatever comes next — `Unique ID:`, `Armour:`,
`Crafted: true`, … This also explains why Rare/Unique (genuinely two lines: name, base) always parsed
correctly and the variant pricing worked.

## Fix — case-insensitive routing + metadata-aware, contiguous header block

`applyHeader` now reads name/base as the **contiguous content lines right after `Rarity:`, terminated by
the first metadata/property line**, and matches rarity **case-insensitively**:

- **Case-insensitive rarity** (the root cause): `MAGIC`/`NORMAL` take the single-line path (`base=name`),
  so they never read a following metadata line as the base.
- **Stop at first metadata line:** a new `isHeaderMetadata` predicate reuses the existing guards
  (`KNOWN_PROPERTY_RE`, `METADATA_RE`, influence-flag, `(…)`/`{…}`) and adds the PoB-export markers
  `POB_HEADER_META_RE` = `Unique ID|LevelReq|Implicits|Variant|Selected Variant|Crafted|Prefix|Suffix`
  (colon-anchored) plus `*`-prefixed lines. Each marker is colon/anchor-guarded, so a real name or base —
  which has no leading marker — is never skipped.
- **No valid base line → `baseType` empty (the flag), never a metadata string and never a mod.** Stopping
  at the first metadata line is what keeps a *mod* out of the base when a Unique has no base line (a mod
  isn't "metadata", so a naive "skip metadata" filter would have grabbed it).

Magic/Normal: `base = block[0]`, `name = base`. Rare/Unique: `name = block[0]`, `base = block[1] ?? ''`.
Any other rarity (gem/currency): unchanged (`base = block[1] ?? name`).

## Validation

- **Corpus sweep (6 builds):** zero metadata bleed in any item's name/base. The repro now parses
  `base = "Enriched Rosethorn Tincture of Mastery"` (= name).
- **No name/base moved where already correct:** for Rare/Unique, index 0/1 are never metadata (sweep
  above), so the contiguous block equals the old first-two-lines → byte-identical name/base. Confirmed by
  `pobCorpus.test.ts` (19) + `pobParser.test.ts` (14) staying green (`Belly of the Beast`, `Headhunter`,
  Ring 1 `RARE`, every `<PlayerStat>`).
- **`estimate_build_cost` total unchanged on `0mLsHPwVEPfp`:** the only changed piece is Flask 1, which is
  **non-unique** (`gearListFromPob` uppercases rarity for `isUnique`, so it stays a base lookup). Its
  priced name changed `"Unique ID: <hash>"` → `"Enriched Rosethorn Tincture of Mastery"`; both miss every
  economy bucket (`searchEconomy` needs an entry name to contain the query — no currency/unique/gem/map
  contains a 5-word tincture name), so the tincture is **unpriced before and after**. All uniques
  (Screams/Voices×3/Thread/Forbidden/Watcher's Eye) parse identically → variant pricing unaffected.
- **Unit tests** (`test/itemParser.test.ts`, 5): (a) Unique with no base line → `baseType === ''`, never
  `Unique ID: …` and never the mod; (b) standard name→base→`Unique ID:` unchanged; (c) the Magic tincture
  repro → `name === base`, no `Unique ID:` bleed; (c2) a Normal item never reads `Quality:` as the base;
  and the in-game clipboard format (proper-case rarity, `--------` dividers) is unchanged.

## Out of scope / notes

- The clipboard path (proper-case rarity, dividers) was always correct and stays byte-identical — the new
  guards only ever skip colon/`*`-anchored metadata that a real name/base never matches.
- Not a parse defect, but visible in the gear-list dump: one jewel shows as `Foulborn The Blue Nightmare`
  (name line as PoB exported it — no metadata bleed, priced as a unique). Left as-is.
