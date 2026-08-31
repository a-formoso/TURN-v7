---
name: RLS INSERT..RETURNING self-reference trap
description: Why a healthy-looking INSERT policy still throws "new row violates row-level security" on Supabase/Postgres
---

**Rule:** `INSERT ... RETURNING` (supabase-js `.insert().select()`) requires the new row to pass the table's **SELECT** policy too, not just the INSERT policy. If the select policy delegates to a helper function that re-queries the same table for that id, the check always fails for brand-new rows — the row being inserted isn't visible to queries inside its own statement's snapshot. Error text is the misleading "new row violates row-level security policy", pointing everyone at the (healthy) insert policy.

**Why:** Burned a multi-session debugging chase on TURN film creation: insert policy, token role, user id, and expiry were all verified healthy; the culprit was `turn_projects_select_collab` using only `turn_can_access_project(id)` after the team-collaboration migration.

**How to apply:**
- Any select policy on a table that receives `insert().select()` must include a direct on-row check (`owner = auth.uid()`) OR'd before any self-referential helper.
- Helpers that query OTHER pre-existing tables (e.g. membership checks for child tables) are fine.
- When diagnosing RLS insert failures with a verified-healthy insert policy: decode the client JWT at the failure site (role/sub/exp) to rule out auth, then inspect the SELECT policy for self-reference.
