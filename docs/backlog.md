# ORACLE backlog

Deferred ideas that are part of larger planned features — not yet scheduled.

- **Unique pricing by required roll/variant (build-cost).** Unique pricing in `estimate_build_cost`
  should classify uniques as *"specific mod-roll/variant required"* vs *"any copy"* and price the
  required version via mod-filtered trade queries (reuse the rare-pricing service). PoB exports already
  encode the build's actual rolls + variant tags, so the signal is in `ParsedPob.items`. Averaged/baseline
  unique prices understate build cost when a build needs a specific roll/variant (Watcher's Eye,
  Forbidden Flame/Flesh, high-roll thresholds). Deferred — part of a larger planned feature.
