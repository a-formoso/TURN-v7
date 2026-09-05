---
name: Asset migration ownership
description: Safety rules for asynchronously copying legacy generated assets into derived slots
---
Automatic asset migration must refuse one-to-many destination mappings. Never choose the first matching time, side, state, or production unit.

**Why:** A legacy location can map to several valid derived plates such as Night and Dawn. Guessing silently assigns the same paid image to unrelated slots and can hide the original ownership mistake.

**How to apply:** Proceed only when exactly one destination is valid. Preserve the source asset and card when ambiguous; do not delete, clear, or “repair” pixels without provenance.

Async migration must revalidate the live destination after every storage/network boundary and hold the same safeguards as normal generation: a per-ID ownership token, live cancellation predicate, and start-time film epoch passed into persistence.

**Why:** Unit cardinality, target occupancy, cancellation state, or the active film can change while bytes and metadata are loading. IDs repeat across films, so a late unscoped commit can write an old asset into another project.

**How to apply:** Re-derive the target immediately before commit, claim its generation registry, recheck emptiness after claiming, pass epoch plus cancellation to the commit, and mutate UI/source state only if ownership still holds afterward.