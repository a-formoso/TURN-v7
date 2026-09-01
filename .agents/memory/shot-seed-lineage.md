---
name: Shot seed lineage & meta rebuild trap
description: Chain provenance for shot frames is derived (never flagged); the image-gen commit hook builds meta fresh, so persistent meta keys must be re-supplied on edit renders.
---

**Rule 1 — derived chain staleness.** Shot frames record `meta.seedSource` (seed shot id + that frame's version/iso). Staleness is recomputed on read (`shotChainStatus`), never written as a flag: reorder/regenerate/delete upstream and dependents report stale automatically. Cold sync cache or missing lineage → "unverified", never "stale" — only a PROVEN broken chain may trigger a paid re-render. Lineage is DIRECT, not transitive: descendants further down go stale link-by-link as each repaired frame commits (ordered runs propagate it); copy/UI must not claim instant whole-chain flagging.

**Rule 2 — the commit hook rebuilds meta from scratch.** The shared image-gen hook assembles commit meta FRESH each render (no spread of the prior meta), then Object.assigns `metaStart`/`metaExtra` results. Any key that must survive an in-place EDIT render (lineage, provenance stamps) has to be explicitly re-read from the prior meta and returned by `metaStart` — otherwise the edit silently drops it.

**Why:** architect review found the manual card path had silently diverged from the headless renderer (missing carried props); unification plus recorded lineage fixed it, and the edit-path drop was only caught by checking how the hook merges meta.

**How to apply:** when adding any persistent per-asset meta key, check every entry point that commits that asset (manual card, headless agent, edit mode, QC repair) writes or re-supplies it; verify fallback prompt paths (e.g. `buildSimple`) receive the same render-plan context as the main path.
