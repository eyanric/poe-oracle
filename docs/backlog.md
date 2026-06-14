# ORACLE backlog

Deferred ideas that are part of larger planned features — not yet scheduled.

- **Foulborn unique variants (3.28 Mirage).** Researched during Harvest v2: Foulborn is **NOT** a Harvest/
  Rancour craftable mod source — it is a Mirage **unique-item variant**. A "Foulborn <Unique>" has one or
  more of its modifiers replaced by *mutated* ("Foulborn") modifiers correlated with the original, dropped
  via Betrayal/Corpse content. So it must NOT be modeled in craft mod-pools (would be wrong). It IS a
  unique-pricing concern: a Foulborn variant is a distinct, separately-priced item — i.e. exactly the
  "specific variant required" case of the unique-pricing item below. Defer with that feature; tag Mirage-only.

- **Unique pricing by required roll/variant (build-cost).** Unique pricing in `estimate_build_cost`
  should classify uniques as *"specific mod-roll/variant required"* vs *"any copy"* and price the
  required version via mod-filtered trade queries (reuse the rare-pricing service). PoB exports already
  encode the build's actual rolls + variant tags, so the signal is in `ParsedPob.items`. Averaged/baseline
  unique prices understate build cost when a build needs a specific roll/variant (Watcher's Eye,
  Forbidden Flame/Flesh, high-roll thresholds). Deferred — part of a larger planned feature.
