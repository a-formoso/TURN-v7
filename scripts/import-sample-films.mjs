/* Import the three approved sample films into the ADMIN account (admin@infinitestudioai.com) as
   ordinary films — owner request 2026-10-02. Mac only: it uses the Supabase Management API token
   (~/.supabase/access-token) and runs SQL as the project owner.

     node scripts/import-sample-films.mjs            → dry run: says what it would add or skip
     node scripts/import-sample-films.mjs --apply    → adds the films that aren't there yet

   Safe to re-run: a film whose doc already carries project.sampleFilm.slug in the admin account is
   skipped, never duplicated or overwritten (edit the working copy in the app; re-importing a changed
   script is a separate, deliberate step). The documents come from scripts/build-sample-films.mjs,
   validated before anything is sent. Nothing is generated and no credits are spent. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { buildAll, validate } from "./build-sample-films.mjs";

const REF = "vubenblfdzginlqiglzw";
const ADMIN = "admin@infinitestudioai.com";
const apply = process.argv.includes("--apply");
const token = readFileSync(homedir() + "/.supabase/access-token", "utf8").trim();

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error("SQL failed (" + r.status + "): " + JSON.stringify(body).slice(0, 300));
  return body;
}
// a dollar-quote tag that can't occur inside the text
const quote = (text) => { let tag = "k"; while (text.includes("$" + tag + "$")) tag += "x"; return "$" + tag + "$" + text + "$" + tag + "$"; };

const films = buildAll();
for (const f of films) {
  const problems = validate(f.slug, f.doc);
  if (problems.length) { console.error(f.slug + " is not valid — nothing imported:\n  " + problems.join("\n  ")); process.exit(1); }
}
const admin = await sql(`select id from auth.users where lower(email) = '${ADMIN}'`);
if (!Array.isArray(admin) || admin.length !== 1) { console.error("Admin account not found."); process.exit(1); }
const owner = admin[0].id;
const have = await sql(`select doc->'project'->'sampleFilm'->>'slug' as slug, title from public.turn_projects where owner = '${owner}' and doc->'project' ? 'sampleFilm'`);
const haveSlugs = new Set((have || []).map((r) => r.slug));

for (const f of films) {
  if (haveSlugs.has(f.slug)) { console.log(`skip  ${f.title} — already in the admin account`); continue; }
  if (!apply) { console.log(`would add  ${f.title} (${f.doc.scenes.length} scenes)`); continue; }
  const rows = await sql(`insert into public.turn_projects (owner, title, doc, project_kind)
    values ('${owner}', ${quote(f.title)}, ${quote(JSON.stringify(f.doc))}::jsonb, 'film')
    returning id, title, jsonb_array_length(doc->'scenes') as scenes`);
  console.log(`added ${rows[0].title} — ${rows[0].scenes} scenes (id ${rows[0].id})`);
}
if (!apply) console.log("\nDry run. Run with --apply to add them.");
