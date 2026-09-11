---
name: Optional RPC degradation
description: The live Supabase project may lag the SQL files in supabase/; client paths must decide explicitly what a missing RPC means and carry per-call failure reasons.
---

**Rule:** the deployed database is not guaranteed to have every RPC defined in `supabase/*.sql`. When a client path depends on one, decide explicitly whether its absence (PGRST202) means "pre-migration contract, proceed and warn once" (safety nets like upload-intent reservations, spend dedupe) or "hard stop" (anything that authorizes or bills). Failure reasons must travel with the call's return value, never through module-level "last error" state.

**Why:** a missing safety-net RPC once made every cloud image save fail with a bare "image upload failed"; the isolated tests never saw it because their adapters always had the function. A shared last-error slot was then shown to swap reasons between concurrent saves.

**How to apply:** probe the live DB with the anon key before assuming a function exists (PGRST202 = absent; permission error or `[]` = present). Regressions for save paths should include a pre-migration adapter, a refused adapter, and two concurrent failures.
