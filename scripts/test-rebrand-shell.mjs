#!/usr/bin/env node
/* test-rebrand-shell.mjs — Kinolot rebrand guard for the app shell, marketing, legal, admin and
   Blender surfaces (owner decisions 2026-09-28; builder 1's files).

   What it pins:
   A. No user-visible string in these files says the internal codename "TURN", the old product
      name "Cinema Machine", the assistant's old name "MUSE", an old agent name, "the Agents",
      "table-reads", the curly or missing apostrophe of "Writers' Room", "Infinite Studio"
      without "AI", or the old "Studio plan". Only string literals, template text and JSX text
      are read — comments, identifiers, storage keys and event names are internal.
      Allowed literals: the admin server's byStatus KEY "outside the TURN asset layout" (matched
      as the server sends it, SHOWN as "outside the Kinolot asset layout"), and the legacy host
      cinemamachine.ai in LIVE_HOSTS.
   B. The page head (title, description, og:*), the favicon (the Kinolot mark "The Lot" on the app
      icon's dark tile since 2026-09-29 — not the old "E" or the zig-zag; scripts/test-identity.mjs
      pins the geometry), and the legal pages: product Kinolot, domain kinolot.infinitestudioai.com,
      "Kinolot by Infinite Studio AI" — with the legal wording itself pinned (a fingerprint of
      the text with the product name, domain, "Last updated" date and the owner's legal name and
      address neutralised), the billing numbers the Terms state read back from the code that charges
      them, and the 2026-10-01 compliance wording (who we are, prices in USD with tax included, the
      14-day right to cancel = the note behind the ⓘ next to every plan's and pack's name (2026-10-02:
      no checkout checkbox — choosing a plan or pack is the request to start), partial refunds, disputes, closing an account,
      30 days' notice, why we use data). LEGAL_SWITCH_DAY=1 fails while any "<…>" placeholder remains.
   C. Executed in a sandbox: the one-colour Spectral wordmark "Kinolot" (logo direction B, 2026-09-29;
      it replaced the two-tone "Kino" + accent "lot"); straight
      "Writers' Room"; the Story Editors / Art Coordinator tooltips; the plans (LIVE_HOSTS with
      the new home and the legacy hosts, the "studio" tier SHOWN as "Producer", a saved "Studio"
      override shown as "Producer", checkout footer "Kinolot by Infinite Studio AI"); the
      "writer" role SHOWN as "Co-writer" with every id unchanged; the account chip; the landing
      and Home footers ("Kinolot by Infinite Studio AI", the company linking to its site); the
      admin Storage page's copy and its display-time renaming of server text.
   D. The Blender add-on shows "Kinolot Bridge" / the "Kinolot" sidebar tab / author "Infinite
      Studio AI", keeps its package id (cinema_machine_bridge) so an existing install updates in
      place, and the packaged ZIP (and its page copy) matches the source.

   Run: node scripts/test-rebrand-shell.mjs  (no browser, no network) */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import zlib from "node:zlib";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "package.json"));
const babel = require("@babel/core");
const read = (f)=>readFileSync(join(ROOT, f), "utf8");

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if(cond){ pass++; console.log("PASS", name); }
  else { fail++; console.log("FAIL", name, extra!==undefined ? JSON.stringify(extra).slice(0, 700) : ""); }
}
function check(name, fn){
  try{ const r = fn(); ok(name, r!==false, r===false ? "returned false" : undefined); }
  catch(e){ ok(name, false, e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e)); }
}
const transform = (src, filename)=>babel.transformSync(src, { babelrc:false, configFile:false, filename,
  presets:[[require.resolve("@babel/preset-react"), { runtime:"classic" }]],
  plugins:[require.resolve("@babel/plugin-transform-block-scoping")] }).code;

/* ── A. user-visible strings in builder 1's JS files ─────────────────────────────── */
const FILES = ["app/chrome.jsx", "app/landing.jsx", "app/auth-ui.jsx", "app/plans.jsx", "app/home-dashboard.jsx",
  "app/team.jsx", "app/admin-storage.jsx", "app/blender-preview-ui.jsx", "app/blender-studio-setup.jsx"];
const BANNED = [
  ["the internal codename TURN", /\bTURN\b/],
  ["the old product name", /Cinema ?Machine/i],
  ["the assistant's old name", /\bMUSE\b/],
  ["an old agent name", /Consistency Check|Continuity Repair|Art Department Coordinator/],
  ["the Agents / table-reads (they are the Story Editors / Final Read)", /\bthe Agents\b|table-reads?\b/],
  ["a curly or missing Writers' Room apostrophe", /Writers’ Room|Writers’ Room|Writers Room\b|Writer's Room/],
  ["the company without AI", /Infinite Studio(?! AI)/],
  ["the plan name Studio", /\bStudio plan\b/],
];
const ALLOWED = new Set(["app/admin-storage.jsx|outside the TURN asset layout",   // the admin server's byStatus key
  "app/plans.jsx|cinemamachine.ai"]);                                          // a legacy host in LIVE_HOSTS
for(const f of FILES){
  const src = read(f); let ast;
  try{ ast = babel.parseSync(src, { filename:f, babelrc:false, configFile:false, sourceType:"script",
    presets:[require.resolve("@babel/preset-react")] }); }
  catch(e){ ok("A "+f+" parses", false, e.message); continue; }
  const hits = [];
  babel.traverse(ast, { enter(p){
    const n = p.node; let t = null;
    if(n.type==="StringLiteral") t = n.value; else if(n.type==="TemplateElement") t = n.value.cooked; else if(n.type==="JSXText") t = n.value;
    if(t==null || ALLOWED.has(f+"|"+t)) return;
    for(const [what, re] of BANNED) if(re.test(t)) hits.push(f+":"+n.loc.start.line+" "+what+": "+t.slice(0, 140));
  }});
  ok("A "+f+" shows no old, internal or drifting names", hits.length===0, hits);
}
check("A the allowed literals: the admin server's status key (matched, never shown) and a legacy host", ()=>{
  const src = read("app/admin-storage.jsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return src.split('"outside the TURN asset layout"').length===2 && src.includes('const OUTSIDE_LAYOUT = "outside the TURN asset layout";')
    && src.includes('" outside the Kinolot asset layout (review by hand)"');
});

/* ── B. page head, favicon, legal pages ─────────────────────────────────────────── */
const html = read("TURN.html");
const headTag = (re)=>{ const m = re.exec(html); return m ? m[1] : null; };
check("B the page title and share previews name Kinolot by Infinite Studio AI", ()=>{
  const title = headTag(/<title>([^<]*)<\/title>/), desc = headTag(/<meta name="description" content="([^"]*)"/);
  const site = headTag(/<meta property="og:site_name" content="([^"]*)"/), ogt = headTag(/<meta property="og:title" content="([^"]*)"/);
  const ogd = headTag(/<meta property="og:description" content="([^"]*)"/), type = headTag(/<meta property="og:type" content="([^"]*)"/);
  if(title!=="Kinolot — Story architecture for AI filmmakers" || ogt!==title || site!=="Kinolot" || type!=="website") return false;
  if(!/^Kinolot by Infinite Studio AI: /.test(desc) || !/Infinite Studio AI/.test(ogd)) return false;
  return [title, desc, site, ogt, ogd].every(t=>!BANNED.some(([, re])=>re.test(t)));
});
check("B the favicon is the Kinolot mark on the app icon's dark tile (the old 'E' and the zig-zag logo are gone)", ()=>{
  const svg = read("favicon.svg");
  const link = /<link rel="icon" type="image\/svg\+xml" href="favicon\.svg(\?v=[\w-]+)?" \/>/.test(html);
  // the geometry itself is pinned by scripts/test-identity.mjs; here: the tile, the amber bay, three arched bays
  return link && svg.includes('<rect width="64" height="64" rx="16" fill="#0E0F12"/>') && svg.includes('fill="#F29A43"')
    && (svg.match(/ A7\.25 7\.25 0 0 1 /g) || []).length===3 && !svg.includes("M16 14h32v8H24") && !/stop-color/.test(svg)
    && !/M14\.4 39\.7L25\.4 19\.9/.test(svg) && !read("app/chrome.jsx").includes('d:"M4 16l5-9 6 11 5-7"');
});
const legalMain = (f)=>{ const s = read(f); return s.slice(s.indexOf("<main>"), s.indexOf("</main>")); };
const visible = (s)=> s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]+>/g, " ")
  .replace(/&middot;/g, "·").replace(/&amp;/g, "&").replace(/&rarr;|&larr;/g, "").replace(/\s+/g, " ").trim();
/* the legal wording with the product name and domain neutralised; the rename must not move it.
   Changing it is an owner (and lawyer) decision — update the fingerprint only with that sign-off. */
/* 2026-09-28 owner sign-off: contact addresses switched (privacy@ for data requests; kinolot-support@,
   kinolot-billing@ and legal@ in the terms); no other wording changed.
   2026-10-01 owner sign-off ("yes, prepare the Terms and Privacy changes"): the billing-switch wording
   from docs/Billing Terms Proposal.md, as the rules stand from the switch day (supabase/billing-switch.sql);
   both pages go live that day with it. Terms: "The service" (credits, not "a paid plan is required"),
   "Plans and credits" rewritten (plans, what each includes, the trial, packs, holds, renders charged
   only if they finish, the video price check, Frances's daily limits) and a new "Payments, plan
   changes and refunds" section (upgrades, downgrades, failed payments, cancelling, refunds, disputes,
   a second subscription). Privacy: the trial's email fingerprint, the cancelling line. Both: the
   "Effective" date became "Last updated: <switch date>" and "Changes" points at the date at the top.
   Same day, after the reviews: Terms say plans renew automatically, how to switch plans (Change plan,
   by email for now), upgrade credits once the proration is paid, plan credits come back from a
   failed job only within their month, the 30-day render exception inside the rule, the video margin
   and length-billed renders, a New Story voice conversation counts as a Frances question, "on hold"
   (the app's word) for disputes, refunds of plan payments, monthly credits ending after failed
   retries, rate changes, and pack credits on closing an account. Privacy: the trial hash only when
   the trial is given, the billing records kept, and payment / refund / dispute records in retention.
   2026-10-01 owner decisions (the lawyer list: "Decide for me… keep the prices in dollars"; on closing
   an account: unused pack credits are NOT refunded — "no"): Terms: "Who we are" (trading name of
   <legal name>, <business address> — the owner fills both), prices in US dollars with any VAT or sales
   tax included, a "Your right to cancel" section (14 days, the unused part back, the checkout consent
   quoted word for word, renewals aren't a new purchase), partial refunds remove the same share of the
   credits, a closed dispute lifts the hold, closing an account refunds unused paid time only, and
   "Changes to these terms" (30 days' notice for a higher price or fewer credits, other changes shown
   in the app). Privacy: "Who we are" (the controller line), "Why we use your data" (contract,
   legitimate interests incl. the trial fingerprint, legal obligation incl. tax records — in the UK
   generally six years, consent), the payment country / US state kept for tax and the checkout
   consent record, tax records kept as long as tax law requires, correcting / objecting and the ICO.
   2026-10-01 review fixes (owner-authorised legal changes): the checkout consent v2 (the right is lost
   for credits used — CCR 2013 reg 37 for digital content — and the unused part back), "Your right to
   cancel" (id "cancel"): any clear statement, e.g. the email, or the cancellation form on the page
   (with the business address), the refund within 14 days to the same payment method; a closed
   dispute lifts ITS hold (another open dispute keeps the account on hold). Privacy: the EU
   representative line (<EU representative>), EU VAT records ten years, "International transfers".
   2026-10-02 owner decisions (on checkout: "I don't want to make terms of service a requirement on
   checkout — we don't need to create friction"; on the in-app step: "decide for me" → no extra step):
   Terms, "Your right to cancel": the tick-box bullet became "By choosing a plan or a credit pack, you
   ask us to start straight away…", quoting the note shown next to every purchase button (CHECKOUT_NOTE
   below) and keeping the rule that credits used from a purchase can't be cancelled. Privacy: its "a
   record that you chose to start straight away" is the click record (unchanged); "Billing information"
   now says we give Stripe your account email (owner decision E2 the same day: the app prefills it on
   the payment page and the webhook puts it on the Stripe customer when a wallet passed on another).
   2026-10-02 owner request (R2: "Turn this text … into a [tooltip], and place it to the right of every
   plan's name/title"): the note left the space under the purchase buttons for an ⓘ button next to each
   plan's and pack's name, so the Terms' "Next to the button you see this note:" became "Next to each
   plan's and pack's name, the ⓘ button shows this note:" — the note itself is quoted unchanged.
   2026-10-03 owner decision (Team relaunch: "Live as soon as built", asked whether the Terms clause and
   the Privacy fix should go out at once without a separate legal review): the Terms gained "Shared films"
   (who may share, the owner pays within budgets, a lapsed plan makes the film read-only, the film stays
   the owner's, the owner answers for their team, invitation emails) and Privacy says shared films are
   readable by the people the owner invites, adds a "Shared films" section and where a collaborator's
   files are kept; both dated 3 October 2026.
   2026-10-18 owner decision (Import a screenplay, "yes to all": a Terms line about uploaded scripts goes live with
   the public launch): Terms' "Your content and ownership" says an imported screenplay stays the writer's, that
   importing confirms they wrote it or have the rights, and that it is stored with the film and sent to the writing
   model only when they ask for the read (which never changes their words); Privacy's "Your creative content" says
   an imported screenplay is read on the device first and sent to a writing model only when the studio is asked to
   read it; both dated 18 October 2026. */
const LEGAL_FINGERPRINT = { "privacy.html":"494ae3ac3aed7b36", "terms.html":"bd521c6c4cc8e920" };
/* The "Last updated" line holds the placeholder until the switch day; the owner then writes the date
   on BOTH pages in the form "14 November 2026" (docs/Billing Rollout Runbook.md). The fingerprint
   reads either as {DATE}, so filling in the date needs no test change — any other change to the
   wording does. On the switch day run the test with LEGAL_SWITCH_DAY=1: the placeholder then FAILS
   instead of printing a NOTE (the pages describe the rules from the switch day, so they must not be
   published before it — keep them off main until then). */
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const LEGAL_DATE = "Last updated: (?:&lt;switch date&gt;|(?:[1-9]|[12]\\d|3[01]) (?:"+MONTHS+") 20\\d\\d)";
const SWITCH_DAY = process.env.LEGAL_SWITCH_DAY==="1";
const LEGAL_META = new RegExp('<div class="meta">Kinolot by Infinite Studio AI &middot; '+LEGAL_DATE+'</div>');
/* The owner's legal name and business address sit in <span data-fill="legal-name"> / <span
   data-fill="business-address"> on both pages (placeholders "<legal name>" / "<business address>"
   until the owner fills them in); the fingerprint reads their contents as {LEGAL_NAME} / {BUSINESS_ADDRESS},
   so filling them needs no test change, and a check below keeps them the same on both pages. */
/* privacy.html also names the EU data-protection representative in <span data-fill="eu-representative">
   ("<EU representative>" until the owner appoints one, or deletes that sentence while the service isn't
   offered in the EU) — read as {EU_REPRESENTATIVE}. */
const FILL_RE = /<span data-fill="(legal-name|business-address|eu-representative)">([^<]*)<\/span>/g;
const fills = (f)=>[...read(f).matchAll(FILL_RE)].map(m=>[m[1], m[2].replace(/\s+/g, " ").trim()]);
const FILL_TOKEN = { "legal-name":"{LEGAL_NAME}", "business-address":"{BUSINESS_ADDRESS}", "eu-representative":"{EU_REPRESENTATIVE}" };
const neutralFills = (h)=> h.replace(FILL_RE, (m, k)=>FILL_TOKEN[k]);
/* the EU representative sentence may be deleted by the owner (no EU offer yet): the fingerprint reads
   the pages without it, and the controller check accepts the section with or without it */
const EU_REP_SENTENCE = "If you are in the European Union, you can also contact our representative there for data protection: {EU_REPRESENTATIVE}.";
const EU_REP_RE = / ?If you are in the European Union, you can also contact our representative there for data protection: \{EU_REPRESENTATIVE\} ?\./g;
const legalText = (f)=> visible(neutralFills(legalMain(f))).replace(EU_REP_RE, "").replace(new RegExp(LEGAL_DATE, "g"), "Last updated: {DATE}")
  .replace(/Kinolot by Infinite Studio AI/g, "{PRODUCT} by {COMPANY}")
  .replace(/kinolot\.infinitestudioai\.com/g, "{DOMAIN}").replace(/Kinolot/g, "{PRODUCT}");
for(const f of ["privacy.html", "terms.html"]){
  const s = read(f), text = visible(s);
  check("B "+f+": Kinolot at kinolot.infinitestudioai.com, by Infinite Studio AI — no old name or host", ()=>
    /<a class="logo" href="\/"><svg class="mark" [^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Kinolot<\/a>/.test(s)
    && /<span class="foot-logo"><svg class="mark" [^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Kinolot<\/span>/.test(s)
    && LEGAL_META.test(s) && (s.match(/<div class="meta">/g) || []).length===1
    && text.includes("kinolot.infinitestudioai.com") && !/cinema\.infinitestudioai\.com|cinemamachine/i.test(s)
    && !BANNED.some(([, re])=>re.test(text)) && /<title>[^<]*— Kinolot<\/title>/.test(s));
  check("B "+f+": the legal wording is the signed-off text (fingerprint)", ()=>{
    const got = createHash("sha256").update(legalText(f)).digest("hex").slice(0, 16);
    if(got!==LEGAL_FINGERPRINT[f]){ console.log("  "+f+" fingerprint "+got); return false; }
    return true;
  });
  /* every "<…>" placeholder (written &lt;…&gt; in the page) is a NOTE until the switch day and a FAIL with
     LEGAL_SWITCH_DAY=1: the date, the owner's legal name and the business address */
  const holes = [...new Set([...s.matchAll(/&lt;([^&<>]{1,60})&gt;/g)].map(m=>"<"+m[1]+">"))];
  const hint = (h)=> h==="<switch date>" ? "write the date on both pages as e.g. \"14 November 2026\""
    : h==="<legal name>" || h==="<business address>" ? "fill it in inside <span data-fill=\""+(h==="<legal name>" ? "legal-name" : "business-address")+"\"> on both pages"
    : h==="<EU representative>" ? "name your EU representative inside <span data-fill=\"eu-representative\"> (or delete that sentence while you don't offer the service in the EU)"
    : "replace it";
  if(SWITCH_DAY) check("B "+f+": no \"<…>\" placeholder is left (LEGAL_SWITCH_DAY=1)", ()=>{
    if(holes.length) console.log("  "+f+" still has "+holes.join(", "));
    return holes.length===0;
  });
  else for(const h of holes)
    console.log("NOTE "+f+": "+h+" is still a placeholder — on the switch day "+hint(h)+", then run with LEGAL_SWITCH_DAY=1");
}
check("B the legal name and business address are given on both pages, the same everywhere (the placeholder or the owner's text)", ()=>{
  const all = [...fills("terms.html"), ...fills("privacy.html")];
  const of = (k)=>[...new Set(all.filter(([n])=>n===k).map(([, v])=>v))];
  const kinds = (f)=>[...new Set(fills(f).map(([n])=>n).filter(n=>n!=="eu-representative"))].sort().join(",");
  return kinds("terms.html")==="business-address,legal-name" && kinds("privacy.html")==="business-address,legal-name"
    && of("legal-name").length===1 && of("business-address").length===1 && of("legal-name")[0]!=="" && of("business-address")[0]!=="";
});
check("B privacy.html and terms.html carry the same 'Last updated' (both the placeholder, or the same date)", ()=>{
  const date = (f)=>(new RegExp(LEGAL_DATE).exec(read(f)) || [])[0];
  return !!date("privacy.html") && date("privacy.html")===date("terms.html");
});
/* the brand rule on the legal pages themselves (test-brand-guard's page scan checks retired names only):
   no McKee, no Claude / Anthropic and no AI vendor or model name in what a reader sees — the named
   providers are Stripe (payments) and Supabase (storage), which the pages name on purpose */
const LEGAL_VENDORS = /McKee|\bClaude\b|Anthropic|OpenAI|ChatGPT|\bGPT\b|Gemini|Google|DeepMind|\bfal(?:\.ai)?\b|ElevenLabs|Kling|Runway|Midjourney|Replicate|\bKimi\b|Moonshot|Nano Banana|\bVeo\b|\bSora\b|Seedance|Hailuo|MiniMax|\bLuma\b|\bPika\b|Mistral|\bLlama\b|\bxAI\b|\bGrok\b|\bMeta\b|Microsoft|Azure|\bAWS\b|Amazon/;
for(const f of ["privacy.html", "terms.html"])
  check("B "+f+": no McKee, Claude / Anthropic or AI vendor name in the page text", ()=>{
    const s = read(f), text = visible(s.replace(/<head>[\s\S]*?<\/head>/, " "));
    const m = LEGAL_VENDORS.exec(text);
    if(m) console.log("  "+f+": names "+JSON.stringify(m[0])+" — "+text.slice(Math.max(0, m.index-60), m.index+60));
    return !m && /<title>[^<]*<\/title>/.test(s) && !LEGAL_VENDORS.test((/<title>([^<]*)<\/title>/.exec(s) || [])[1] || "");
  });
/* the billing facts the Terms state are the ones the code charges by (2026-10-01): plan prices and
   allowances (app/plans.jsx PLANS = PLAN_ALLOWANCES.switched), the packs (CREDIT_PACKS), the trial
   (TRIAL_CREDITS, TRIAL_COPY), the no-plan rule and Frances's daily limits (image-proxy
   billing-policy.mjs), the 12-month pack lots and the video price check (quote x 1.1 + 2); after the
   reviews also: a New Story voice conversation counts as a Frances question (image-proxy's live task),
   the 30-day last resort (turn_release_stale_holds) and switching by email while the billing page
   can't switch plans (PORTAL_PLAN_SWITCHING). */
check("B terms.html states the plans, packs, trial, no-plan rule, Frances limits, render and switching rules the code uses", ()=>{
  const t = visible(read("terms.html")), plans = read("app/plans.jsx");
  const policy = read("supabase/functions/image-proxy/billing-policy.mjs"), proxy = read("supabase/functions/image-proxy/index.ts");
  const fmt = (n)=>Number(n).toLocaleString("en-US");
  const planRows = [...plans.matchAll(/\{ tier:"(\w+)",\s+name:"(\w+)",\s+price:"(\$\d+)", credits:(\d+),/g)];
  const allow = /switched: \{ writer:(\d+), director:(\d+), studio:(\d+) \}/.exec(plans);
  const packs = [...plans.matchAll(/\{ sku:"pack-\d+", name:"[^"]+", price:"(\$\d+)", credits:(\d+),[^}\n]*\bunit:"switched"/g)];
  const trial = /const TRIAL_CREDITS = (\d+);/.exec(plans);
  const copy = /const TRIAL_COPY = "New accounts get (\d+) free credits after confirming their email — (enough to try [^"]+)";/.exec(plans);
  const fr = /FRANCES_PLAN_LIMITS = Object\.freeze\(\{ none: (\d+), writer: (\d+), director: (\d+), studio: (\d+) \}\)/.exec(policy);
  if(planRows.length!==3 || !allow || packs.length!==3 || !trial || !copy || copy[1]!==trial[1] || !fr) return false;
  const byTier = { writer:allow[1], director:allow[2], studio:allow[3] };
  const ps = packs.map(([, price, c], i)=>fmt(c)+(i ? "" : " credits")+" for "+price);
  return planRows.every(([, tier, name, price, credits])=>credits===byTier[tier] && t.includes(name+" ("+price+" a month, "+fmt(credits)+" credits)"))
    && t.includes("any signed-in account can buy one: "+ps.slice(0, -1).join(", ")+" or "+ps[ps.length-1]+".")
    && t.includes("New accounts get "+trial[1]+" free credits once, after confirming their email address — "+copy[2])
    && policy.includes("Without a plan, credits cover writing on the default engines and draft images.")
    && t.includes("Without a plan, credits (from the free trial or a credit pack) cover writing on the default engines and draft images only.")
    && t.includes("(a New Story voice conversation counts as one): "+fr[1]+" without a plan (or while your account is on hold), "+fr[2]+" on Writer, "+fr[3]+" on Director and "+fr[4]+" on Producer.")
    && read("app/ai.jsx").includes("(a New Story voice conversation counts as one)") && /if \(task === "live"\) \{[\s\S]{0,6000}?const francesVoiceCheck: any = await francesLimit\(/.test(proxy)
    && read("supabase/billing-v2.sql").includes("pg_catalog.now() + interval '12 months'")
    && t.includes("Pack credits last 12 months from purchase")
    && proxy.includes("const quoteLimit = (q: number) => Math.ceil(q * 1.1 - 1e-9) + 2;") && t.includes("at most 10% plus 2 credits more.")
    // the 30-day last resort settles a render's hold at the amount set aside (turn_release_stale_holds)
    && /h\.created_at < pg_catalog\.now\(\) - interval '30 days'[\s\S]{0,80}perform public\.turn__finish_hold\(v_hold\.ref, v_hold\.held\);/.test(read("supabase/billing-v2.sql"))
    && t.includes("The one exception: if the provider never tells us the outcome within 30 days, we keep the credits set aside for it")
    // plan switching is by email until the billing page offers it (app/plans.jsx PORTAL_PLAN_SWITCHING):
    // turning switching on there fails this until the Terms' "For now…" line is updated with it
    && plans.includes("const PORTAL_PLAN_SWITCHING = false;")===t.includes("For now that means writing to kinolot-billing@infinitestudioai.com from your account email");
});
check("B the owner-approved storage-folder sentence and 'no ownership' stay word for word", ()=>
  visible(read("privacy.html")).includes("Files you create, such as generated images, are kept in private storage folders named after your account handle (taken from the part of your email address before the @) and your project's first title.")
  && visible(read("terms.html")).includes("We claim no ownership over your films.")
  && visible(read("terms.html")).includes('These terms are an agreement between you and Infinite Studio AI ("we", "us")'));

/* the 2026-10-01 compliance wording (owner decisions; see the fingerprint note above). Since
   2026-10-02 there is no checkout checkbox: a short note sits behind an ⓘ button next to every plan's
   and pack's name (app/plans.jsx, app/landing.jsx; the R2 tooltip, which replaced the note under the
   purchase buttons the same day), and choosing the plan or pack is the request to start straight away. The
   Terms quote that note word for word, and the app must show the same sentence: until the app carries
   it this is a NOTE, and on the switch day (LEGAL_SWITCH_DAY=1) a FAIL — the Terms must not describe a
   note the app doesn't show. The retired "Start now" checkbox sentence must not come back, in the
   Terms or the app. */
const CHECKOUT_NOTE = "Starts straight away. Cancel within 14 days and you get back the part you haven't used.";
const OLD_CHECKOUT_CONSENT = "Start now: I want to use my credits straight away.";
/* one <h2> section of a legal page as a reader sees it (up to the next <h2>), with the fills neutralised */
const legalSection = (f, h2)=>{ const m = legalMain(f), hit = new RegExp("<h2(?: [^>]*)?>"+h2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")+"</h2>").exec(m);
  if(!hit) return ""; const body = m.slice(hit.index+hit[0].length), j = body.search(/<h2[ >]/);
  return visible(neutralFills(j<0 ? body : body.slice(0, j))).replace(/ ([.,;:)])/g, "$1"); };   // "…</a>." reads "….", not "… ."
check("B terms.html says who we are (the trading name of the owner's legal name, at the business address)", ()=>
  legalSection("terms.html", "Who we are")==="Infinite Studio AI is the trading name of {LEGAL_NAME}, {BUSINESS_ADDRESS}. You can reach us at the addresses under Contact below."
  && /<h2>Who we are<\/h2>\s*<p>Infinite Studio AI is the trading name of <span data-fill="legal-name">/.test(read("terms.html")));
check("B terms.html: prices are in US dollars and include any VAT or sales tax (owner: keep the prices in dollars)", ()=>{
  const pay = legalSection("terms.html", "Payments, plan changes and refunds");
  return pay.startsWith("Prices are in US dollars and include any VAT or sales tax we have to charge where you live. If your card is in another currency, your bank converts the amount and may add a fee.")
    && !/plus (?:VAT|tax)|excluding (?:VAT|tax)|\bGBP\b|\bEUR\b|£|€/.test(visible(read("terms.html")));
});
check("B terms.html 'Your right to cancel' says what the ⓘ note next to each plan's and pack's name says (choosing is the request to start, 14 days, the unused part back, renewals aren't new purchases)", ()=>{
  const c = legalSection("terms.html", "Your right to cancel");
  return c.includes("You can cancel a plan or a credit pack within 14 days of buying it. To cancel, tell us within those 14 days in any clear way: for example, email kinolot-billing@infinitestudioai.com (writing from your account email helps us find your purchase), or send us the cancellation form below.")
    && !c.includes("from your account email within those 14 days")
    // 2026-10-02: no checkbox — choosing the plan or pack is the request; the note (behind the ⓘ by each plan's and
    // pack's name since the R2 tooltip) is quoted; used credits can't be cancelled; the retired "next to the button" is gone
    && c.includes("By choosing a plan or a credit pack, you ask us to start straight away, so you can use your credits at once. Next to each plan's and pack's name, the ⓘ button shows this note: \""+CHECKOUT_NOTE+"\" Once you use credits from a purchase, you can't cancel that part of it.")
    && !c.includes("Next to the button you see this note")
    && !/\btick(?:ed|s)?\b|check ?box|Before you pay/i.test(visible(read("terms.html"))) && !visible(read("terms.html")).includes(OLD_CHECKOUT_CONSENT)
    && c.includes("We refund you within 14 days of the day you tell us, to the card or other payment method you paid with.")
    // the model cancellation form (CCR 2013 Sch 3 Part B), to the business address
    && c.includes("Cancellation form (fill it in and send it only if you want to cancel a purchase): To: Infinite Studio AI, {BUSINESS_ADDRESS}, kinolot-billing@infinitestudioai.com I cancel my contract for the following: [the plan or credit pack] Bought on: [date] Name: [your name] Account email: [your email address] Date: [today's date]")
    // the ⓘ note by each plan's and pack's name links here
    && /<h2 id="cancel">Your right to cancel<\/h2>/.test(read("terms.html"))
    && c.includes("So when you cancel, you get back the part you haven't used, in proportion to the credits from that purchase you haven't spent: for example, with 300 of a pack's 1,000 credits left, you get back 30% of its price. Those unused credits are then removed from your account, and for a plan, the subscription ends.")
    && c.includes("A plan renewing each month isn't a new purchase, so it doesn't start a new 14 days.")
    // the refunds bullet points at it, and the example's numbers are a real pack (1,000 credits) and its share
    && legalSection("terms.html", "Payments, plan changes and refunds").includes("except as set out under Your right to cancel below or where the law requires otherwise.")
    && /\{ sku:"pack-\d+", name:"[^"]+", price:"\$\d+", credits:1000,[^}\n]*\bunit:"switched"/.test(read("app/plans.jsx"));
});
{
  /* the app side: any app file that carries the note ("Starts straight away. …") — the ⓘ tooltips
     by the plan and pack names, and what Frances is told about them (app/ai.jsx APP_FEATURES) — must use the Terms'
     sentence word for word (a curly or escaped apostrophe reads as the straight one), and a file that
     shows it must link it to /terms.html#cancel; no app file may still show the retired "Start now"
     checkbox sentence */
  const appFiles = readdirSync(join(ROOT, "app")).filter(n=>/\.(?:jsx?|mjs)$/.test(n)).map(n=>"app/"+n);
  const norm = (src)=>src.replace(/\\'/g, "'").replace(/\\u2019/g, "'").replace(/’/g, "'");
  const showing = appFiles.filter(f=>norm(read(f)).includes("Starts straight away."));
  const exact = showing.filter(f=>norm(read(f)).includes(CHECKOUT_NOTE));
  const linked = exact.filter(f=>read(f).includes("/terms.html#cancel"));
  check("B the app's ⓘ note by the plan and pack names, where present, is the Terms' sentence word for word and links to /terms.html#cancel", ()=>{
    if(showing.length!==exact.length) console.log("  drifted note text in "+showing.filter(f=>!exact.includes(f)).join(", "));
    if(exact.length && !linked.length) console.log("  the note is shown without a link to /terms.html#cancel ("+exact.join(", ")+")");
    return showing.length===exact.length && (!exact.length || linked.length>0);
  });
  check("B no app file shows the retired \"Start now\" checkbox sentence (the Terms no longer describe a checkbox)", ()=>{
    const old = appFiles.filter(f=>norm(read(f)).includes(OLD_CHECKOUT_CONSENT));
    if(old.length) console.log("  still shows the checkbox sentence: "+old.join(", "));
    return old.length===0;
  });
  if(SWITCH_DAY) check("B the app shows the note the Terms quote, linked to /terms.html#cancel (LEGAL_SWITCH_DAY=1)", ()=>exact.length>0 && linked.length>0);
  else if(!exact.length) console.log("NOTE the app doesn't show the ⓘ note by the plan and pack names yet (\""+CHECKOUT_NOTE+"\") — the Terms quote it; it must be live before the pages are");
}
check("B terms.html: partial refunds remove the same share; a closed dispute lifts the hold", ()=>{
  const pay = legalSection("terms.html", "Payments, plan changes and refunds");
  return pay.includes("If we refund part of a payment, we remove the same share of the credits it added (rounded up), but never more than you have left of them.")
    && pay.includes("When the dispute is closed, its hold is lifted (if another payment is still disputed, the account stays on hold until that one closes too). If it was decided in your favour, the unused credits from that payment are removed.")
    && !pay.includes("until we've spoken with you");
});
check("B terms.html: closing an account refunds unused paid time only — never pack credits (owner, 2026-10-01: \"no\")", ()=>{
  const end = legalSection("terms.html", "Ending your account");
  return end==="You can stop using the service and ask us to delete your account at any time by emailing kinolot-support@infinitestudioai.com. Credits left on your account, pack credits included, are deleted with it and aren't refunded, except as set out under Your right to cancel. We may close accounts that break these terms. If we close your account for any other reason, we refund the paid time you haven't used."
    && !/refund[^.]*pack credits|pack credits[^.]*(?:are|will be) refunded/i.test(visible(read("terms.html")));
});
check("B terms.html: 30 days' notice of a higher price or fewer credits, other changes shown in the app", ()=>{
  const ch = legalSection("terms.html", "Changes to these terms"), plans = legalSection("terms.html", "Plans and credits");
  return ch==="When we change these terms, we update the date at the top. Material changes to a paid plan, such as a higher price or fewer monthly credits, are announced in the app or by email at least 30 days before they apply to you, so you can cancel first. Other changes are shown in the app when they apply. Continuing to use the service after a change means you accept the new terms."
    && plans.includes("Prices and allowances may change. A higher price or fewer monthly credits on your plan is announced at least 30 days before it applies to you (see Changes to these terms below), so you can cancel first.")
    && !plans.includes("changes apply from your next billing cycle");
});
check("B privacy.html: the controller line, why we use data (lawful bases), the tax records, the ICO", ()=>{
  const who = legalSection("privacy.html", "Who we are"), why = legalSection("privacy.html", "Why we use your data");
  const t = visible(neutralFills(legalMain("privacy.html")));
  const whoBase = "Kinolot is run by Infinite Studio AI, the trading name of {LEGAL_NAME}, {BUSINESS_ADDRESS}. We are the controller of your personal information: we decide how it is used and are responsible for it under data protection law. You can reach us at privacy@infinitestudioai.com.";
  return (who===whoBase+" "+EU_REP_SENTENCE || who===whoBase)
    && legalSection("privacy.html", "International transfers")==="Some of the providers that run the service (hosting, payments and AI generation) are in the United States or other countries outside the UK and the European Union. When your information goes to them, it is protected by the safeguards the law requires, such as adequacy regulations (including the UK-US data bridge), the UK International Data Transfer Agreement or the UK Addendum to the EU Standard Contractual Clauses."
    && why==="To give you the service (our contract with you): your account, your films, generations, payments and support. Our legitimate interests: keeping the service secure and working, and preventing abuse of the free trial — that's what the email fingerprint is for. Legal obligations: keeping tax and accounting records, such as invoices and payment records, for as long as tax law requires (in the UK, generally six years; for EU VAT records, ten years). Your consent, where we ask for it. You can withdraw it at any time."
    && t.includes("For tax, we also keep the country of each payment (and, in the US, the state), taken from your billing address or card. When you buy, we keep a record that you chose to start straight away.")
    // 2026-10-02 (owner decision E2, the billing email): the account email goes to Stripe, prefilled and set on the customer
    && t.includes("We never see or store your card number. We give Stripe your account email, so the payment page starts with it and your receipts and invoices go to it, even if you pay with a digital wallet that passes on a different email.")
    && t.includes("(such as invoices and records of payments, refunds and disputes), which we keep for as long as tax law requires.")
    && t.includes("you can complain to the UK Information Commissioner's Office (ico.org.uk) or the data protection authority where you live.");
});

/* ── C. the surfaces, executed ──────────────────────────────────────────────────── */
const el = (type, props, ...children)=>({ type, props:props||{}, children:children.flat(Infinity) });
const walk = (n, f)=>{ if(!n || typeof n!=="object") return; if(Array.isArray(n)){ n.forEach(x=>walk(x, f)); return; } f(n); (n.children||[]).forEach(x=>walk(x, f)); };
const findAll = (tree, pred)=>{ const out = []; walk(tree, n=>{ if(pred(n)) out.push(n); }); return out; };
const hasClass = (c)=>(n)=> String((n.props && n.props.className) || "").split(/\s+/).includes(c);
const textOf = (n)=> (typeof n==="string" || typeof n==="number") ? String(n) : (!n || typeof n!=="object") ? ""
  : Array.isArray(n) ? n.map(textOf).join("") : (n.children||[]).map(textOf).join("");
/* renders function components too (so text inside them is visible), with a hook stub */
function makeReact(){
  const R = { Fragment:"fragment", createElement:el, state:null, calls:0,
    useState(init){ const i = R.calls++; const v = (R.state && i in R.state) ? R.state[i] : (typeof init==="function" ? init() : init); return [v, ()=>{}]; },
    useEffect(){}, useRef:(v)=>({ current:v===undefined ? null : v }), useMemo:(f)=>f(), useCallback:(f)=>f, useLayoutEffect(){},
    reset(state){ R.state = state || null; R.calls = 0; } };
  return R;
}
const deep = (n)=>{ if(!n || typeof n!=="object") return n; if(Array.isArray(n)) return n.map(deep);
  if(typeof n.type==="function"){ return deep(n.type({ ...n.props, children:n.children })); }
  return { ...n, children:(n.children||[]).map(deep) }; };
const noop = ()=>{};
const iconProxy = new Proxy({}, { get:()=>()=>null });
function box(extra){
  const React = makeReact();
  const b = { console, React, Icon:iconProxy, ReactDOM:{ createRoot:()=>({ render:noop, unmount:noop }) },
    document:{ addEventListener:noop, removeEventListener:noop, createElement:()=>({}), body:{ appendChild:noop } },
    localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop },
    CustomEvent:class { constructor(t){ this.type = t; } }, addEventListener:noop, removeEventListener:noop, dispatchEvent:()=>true,
    setTimeout, clearTimeout, setInterval:()=>0, clearInterval:noop, location:{ hostname:"localhost" }, ...(extra||{}) };
  b.window = b; vm.createContext(b); return b;
}
const run = (b, f)=> vm.runInContext(transform(read(f), f), b, { filename:f });

// chrome.jsx (+ team.jsx for the role names it shows)
const cb = box(); run(cb, "app/team.jsx"); run(cb, "app/chrome.jsx");
check("C the top-bar wordmark reads Kinolot, one colour (the mark carries the amber; no .brand-name b)", ()=>{
  cb.React.reset();
  const bar = cb.TopBar({ room:"writers", setRoom:noop, project:{ title:"F" }, scenes:[], drafts:{}, onNewStory:noop, theme:"dark", onTheme:noop, onHome:noop });
  const marks = findAll(bar, n=>n.type===cb.BrandWordmark);
  const wm = cb.BrandWordmark();
  const css = read("app/styles.css");
  return marks.length===1 && hasClass("brand-name")(wm) && wm.children.length===1 && wm.children[0]==="Kinolot"
    && textOf(wm)==="Kinolot" && !css.includes(".brand-name b");
});
check("C rooms say Writers' Room with a straight apostrophe; the Story Editors and Art Coordinator are named", ()=>{
  const nav = cb.ViewNav({ room:"writers", view:"spine", setView:noop, onAgents:noop, onToggleRail:noop, onToggleInsp:noop });
  const art = cb.ViewNav({ room:"art", artView:"characters", setArtView:noop, onCoordinate:noop });
  const cta = (t)=> findAll(t, hasClass("vn-cta"))[0];
  return cb.ROOMS[0].label==="Writers' Room" && nav.props["aria-label"]==="Writers' Room views"
    && cta(nav).props.title==="Story Editors — AI editors that refine your story: Story Doctor, Script Supervisor, Setups & Payoffs, Final Read"
    && /^Art Coordinator — runs pre-production/.test(cta(art).props.title)
    && cb.turnApiProviders[0].hint==="Writing, the Story Editors and Frances when that text provider is selected";
});

// plans.jsx
const pb = box({ CREDIT_SCALE:10 }); run(pb, "app/plans.jsx");
check("C checkout uses LIVE links on the new home and every legacy host, TEST links anywhere else", ()=>{
  const plan = pb.CINEMA_PLANS[0], link = (h)=>{ pb.location = { hostname:h }; return pb.turnPlanLink(plan); };
  const hosts = ["kinolot.infinitestudioai.com", "cinema.infinitestudioai.com", "cinema-machine.replit.app", "cinemamachine.ai"];
  return hosts.every(h=>link(h)===plan.live) && link("localhost")===plan.test && link("turn-v6.replit.dev")===plan.test
    && read("app/plans.jsx").includes('const LIVE_HOSTS = ["kinolot.infinitestudioai.com", "cinema.infinitestudioai.com", "cinema-machine.replit.app", "cinemamachine.ai"];');
});
check("C the top plan is SHOWN as Producer; its id, price and grant stay 'studio' / $149 / 5,000", ()=>{
  // Option A (billing fixes, owner decision 2026-09-30): 600 / 1,600 / 5,000 once the credit unit has
  // switched — the default when no regime has been read (app/pricing.jsx turnCreditRegime)
  const p = pb.CINEMA_PLANS.map(x=>[x.tier, x.name, x.price, x.credits]);
  const D = pb.turnPlanDisplayName;
  return JSON.stringify(p)===JSON.stringify([["writer","Writer","$19",600],["director","Director","$49",1600],["studio","Producer","$149",5000]])
    && D("studio")==="Producer" && D("Studio")==="Producer" && D("STUDIO")==="Producer" && D("writer")==="Writer" && D("director")==="Director"
    && D("pro")==="Director" && D("none")==="None" && D("")===""
    && pb.turnRoomRequiredPlan("stage")==="Producer" && pb.turnRoomRequiredPlan("art")==="Director" && pb.turnRoomRequiredPlan("writers")==="Writer"
    && pb.turnPlanForRes("4K")==="Producer" && pb.turnPlanForRes("1080p")==="Director" && pb.turnPlanForRes("720p")===null
    && pb.turnTierGates({ plan:"studio" }).maxRes==="4K";
});
check("C a saved plan-copy override that still says 'Studio' is shown as Producer; any other name is the admin's", ()=>{
  pb.turnApplyPlanCopy({ studio:{ name:"Studio" } });
  const a = pb.CINEMA_PLANS[2].name;
  pb.turnApplyPlanCopy({ studio:{ name:"Studio Max" } });
  const b = pb.CINEMA_PLANS[2].name;
  pb.turnApplyPlanCopy({ studio:{ name:"Producer" } });
  return a==="Producer" && b==="Studio Max" && pb.CINEMA_PLANS[2].tier==="studio" && pb.turnPlanDisplayName("studio")==="Producer";
});
check("C the checkout footer and the welcome cards say Kinolot by Infinite Studio AI (the exact phrase)", ()=>{
  pb.React.reset(); pb.usePlansVersion = ()=>0;
  const modal = pb.PlansModal({ onClose:noop, currentPlan:null });
  const foot = textOf(findAll(modal, hasClass("plans-foot"))[0]);
  pb.React.reset();
  const welcome = pb.WelcomePlanCard({ plan:"studio", credits:9000, activating:false, onNewStory:noop, onClose:noop });
  const pack = pb.WelcomeCreditPackCard({ credits:300, activating:false, onClose:noop });
  const choose = findAll(modal, hasClass("plan-cta")).map(textOf);
  return foot==="Secure checkout by Stripe · Kinolot by Infinite Studio AI · Billing questions: kinolot-billing@infinitestudioai.com"
    && textOf(findAll(welcome, hasClass("welcome-eyebrow"))[0])==="Kinolot" && textOf(findAll(pack, hasClass("welcome-eyebrow"))[0])==="Kinolot"
    && textOf(findAll(welcome, hasClass("welcome-title"))[0])==="Your Producer plan is live" && choose.includes("Choose Producer");
});

// team.jsx roles (in the chrome box)
check("C the 'writer' ROLE is SHOWN as Co-writer; its id, section map and write rules are unchanged", ()=>{
  const roles = cb.TEAM_ROLES.map(r=>[r.id, r.label]);
  return JSON.stringify(roles)===JSON.stringify([["view_only","View-only"],["writer","Co-writer"],["art_director","Art director"],["stage_editor","Stage editor"]])
    && cb.teamRoleLabel("writer")==="Co-writer" && cb.teamRoleLabel("producer_admin")==="Legacy role"
    && JSON.stringify(cb.TEAM_ROLE_SECTIONS.writer)===JSON.stringify(["scenes","beatsMap","drafts","history","continuityMap","project"])
    && cb.teamCanWriteSection("writer", "scenes") && !cb.teamCanWriteSection("writer", "characters")
    && /^Your Co-writer role covers the story/.test(cb.teamRoleScopeNote("writer"))
    // Team relaunched (owner 2026-10-03): the owner fixes a role in the Team window again
    && cb.teamRoleBlurb(null)==="The current collaborator role couldn't be verified, so access is read-only. Ask the film's owner to check your role in the Team window."
    && /Ask the film's owner to check your role in the Team window\.$/.test(cb.teamRoleScopeNote(""))
    && !/coming soon/i.test(cb.teamRoleScopeNote("")) && !/\bWriter\b/.test(cb.teamRoleScopeNote(""));
});

// auth-ui.jsx: sign-in mark, plan chip, account chip
const ab = box({ cloudConfigured:()=>true, cloudUserEmail:()=>"ana@example.com", turnCreditBalance:{ remaining:120, plan:"studio" },
  turnIsPaidPlan:()=>true, turnTextSpend:()=>({ calls:3, credits:12, since:null }), turnOpenPlans:noop, CREDIT_SCALE:10 });
run(ab, "app/plans.jsx"); run(ab, "app/team.jsx"); run(ab, "app/auth-ui.jsx");
check("C sign-in shows Kinolot; a Producer choice follows the visitor into sign-up", ()=>{
  ab.React.reset();
  const m = ab.AuthModal({ onClose:noop, onAuthed:noop, initialMode:"signup", plan:"studio", light:true });
  return textOf(findAll(m, hasClass("auth-mark"))[0])==="Kinolot" && textOf(findAll(m, hasClass("auth-plan"))[0]).startsWith("Producer plan · $149/mo");
});
check("C the account chip: Co-writer role, the Producer plan by name, Frances free, no codename in any tooltip", ()=>{
  ab.React.reset({ 0:true });
  const chip = ab.AccountChip({ session:{}, cloudActive:true, saveState:"saved", shareRole:"writer", onSignIn:noop, onSignOut:noop });
  const all = JSON.stringify(chip);
  ab.React.reset();
  const bad = ab.AccountChip({ session:{}, cloudActive:true, saveState:"saved", shareRole:"writer", roleUnavailable:true });
  ab.React.reset();
  const retry = ab.AccountChip({ session:{}, cloudActive:false, connectionState:"retrying" });
  const titles = [bad, retry].map(t=>findAll(t, hasClass("acct-cloud"))[0].props.title);
  return textOf(chip).includes("Co-writer") && textOf(chip).includes("Project role: Co-writer") && textOf(chip).includes("Producer · Synced") && textOf(chip).includes("Credits")
    && all.includes("MUSE")===false && titles.every(t=>t && !/\bTURN\b/.test(t))
    && titles[0].startsWith("Your role on this shared project couldn't be verified") && /retrying automatically/.test(titles[1]);
});

// landing.jsx + home-dashboard.jsx
const lb = box(); run(lb, "app/plans.jsx"); run(lb, "app/landing.jsx");
check("C the landing: 'Kinolot' in the nav, Producer on the pricing, footer 'Kinolot by Infinite Studio AI' linking to the company site", ()=>{
  lb.React.reset(); lb.usePlansVersion = ()=>0;
  const page = deep(lb.Landing({ onStart:noop, onSignIn:noop }));
  const logos = findAll(page, hasClass("lp-logo")).map(textOf);
  const brand = findAll(page, hasClass("lp-foot-brand"))[0];
  const link = brand && findAll(brand, n=>n.type==="a")[0];
  const tiers = findAll(page, hasClass("lp-tier-name")).map(textOf);
  return JSON.stringify(logos)===JSON.stringify(["Kinolot","Kinolot"]) && textOf(brand)==="Kinolotby Infinite Studio AI"
    && link.props.href==="https://infinitestudioai.com" && link.props.rel==="noopener" && link.props.target==="_blank"
    && JSON.stringify(tiers)===JSON.stringify(["Writer","Director","Producer"]) && !/Cinema|\bTURN\b|\bMUSE\b/.test(JSON.stringify(page));
});
check("C Home: the same one-colour wordmark beside the mark, the straight Writers' Room, the landing's footer brand", ()=>{
  const s = read("app/home-dashboard.jsx");
  return s.includes('h("span",{className:"hd-brand-name"},"Kinolot")') && s.includes('h(BrandMark,null)') && s.includes('name:"Writers\' Room"')
    && s.includes('(typeof LandingFootBrand==="function") ? h(LandingFootBrand,null) : h("span",{className:"lp-logo sm"},"Kinolot")')
    && read("app/styles.css").includes(".lp-foot-brand{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;min-width:0}");
});

// admin-storage.jsx
const sb = box(); vm.runInContext(transform(read("app/admin-storage.jsx"), "admin-storage.jsx"), sb, { filename:"app/admin-storage.jsx" });
check("C admin Storage: its copy says Kinolot, and server text is renamed at display time (codes and turn_* names kept)", ()=>{
  const L = sb.AdminStorageLib, t = L.serverText;
  const kept = L.keptLines({ kept:{ files:3, byStatus:{ "current, history":3, "outside the TURN asset layout":2 }, usedBy:[] } }, {});
  return t("path outside the TURN asset layout; review by hand")==="path outside the Kinolot asset layout; review by hand"
    && t("TURN_ROLE_SCOPE: denied")==="TURN_ROLE_SCOPE: denied" && t("see turn_admin.orphans")==="see turn_admin.orphans"
    && t(null)===null && t(undefined)===undefined && t("")===""
    && JSON.stringify(kept)===JSON.stringify(["3 still in use", "2 outside the Kinolot asset layout (review by hand)"])
    && L.MSG.reviewBody.startsWith("Only files nothing in Kinolot uses any more.") && L.MSG.tempAbout.startsWith("Images and videos Kinolot staged")
    && L.statusChip("unreferenced", false, false).title==="Nothing in Kinolot points at this file."
    && L.statusChip("orphan: project deleted", true).title==="Its project was deleted and nothing in Kinolot points at this file."
    && L.errorMessage({ code:"bad_request", status:400, message:"outside the TURN asset layout" })==="The server refused the request: outside the Kinolot asset layout"
    && !Object.values(L.MSG).some(m=>/\bTURN\b/.test(m));
});

/* ── D. the Blender add-on ──────────────────────────────────────────────────────── */
const PKG = "blender/cinema_machine_bridge";
const init = read(PKG+"/__init__.py");
check("D Blender shows 'Kinolot Bridge' by Infinite Studio AI, in a 'Kinolot' sidebar tab", ()=>{
  const info = /bl_info = \{([\s\S]*?)\n\}/.exec(init)[1];
  const cats = [...init.matchAll(/bl_category = "([^"]*)"/g)].map(m=>m[1]);
  const labels = [...init.matchAll(/bl_label = "([^"]*)"/g)].map(m=>m[1]);
  return info.includes('"name": "Kinolot Bridge"') && info.includes('"author": "Infinite Studio AI"')
    && info.includes('"location": "3D View > Sidebar > Kinolot"') && info.includes('"description": "Render an approved editable Blender proof through the Kinolot bridge"')
    && info.includes('"blender": (4, 2, 0)') && cats.length===2 && cats.every(c=>c==="Kinolot")
    && labels.includes("Kinolot") && labels.includes("Kinolot Studio") && labels.includes("Open Kinolot Studio");
});
check("D no text Blender shows or writes into the .blend says Cinema Machine or TURN, and no data name keeps the old 'CM ' prefix", ()=>{
  const shown = [];
  for(const f of ["__init__.py", "studio_scene.py", "studio_runtime.py", "renderer.py", "protocol.py", "studio_protocol.py"]){
    const s = read(PKG+"/"+f);
    for(const re of [/bl_(?:label|description) = "([^"]*)"/g, /\.report\(\{[^}]*\},\s*"([^"]*)"/g, /label\(text="([^"]*)"/g,
      /(?:StudioSceneError|RuntimeError|ValueError)\(\s*"([^"]*)"/g, /"name": "([^"]*)"/g, /"description": "([^"]*)"/g,
      // button / field text and property names and tooltips (layout.prop / layout.operator text=, *Property(name=, description=))
      /\btext="([^"]*)"/g, /Property\([^)]*?\bname="([^"]*)"/g, /\bdescription="([^"]*)"/g,
      // the data-blocks a proof render or a Studio workspace adds to the user's file: every bpy.data.*.new name and material
      /\.(?:scenes|worlds|collections|objects|cameras|lights|materials|meshes)\.new\(\s*"([^"]*)"/g, /_(?:new_)?material\((?:bpy,\s*)?"([^"]*)"/g,
      /_add_(?:box|cylinder|octahedron)\([^,]+,\s*"([^"]*)"/g, /\bname = "([^"]*)"/g])
      for(const m of s.matchAll(re)) shown.push(f+": "+m[1]);
  }
  // no exemptions: the proof scene / world / camera are found by their cinemaMachineProof tag, not their name
  const bad = shown.filter(t=>/Cinema ?Machine|\bTURN\b|: CM\s/i.test(t));
  if(bad.length) console.log("  ", bad);
  return bad.length===0 && shown.some(t=>t==="studio_scene.py: Kinolot Studio") && shown.some(t=>t==="renderer.py: Kinolot Proof")
    && shown.some(t=>t==="renderer.py: Kinolot Proof Camera") && shown.some(t=>/^studio_scene\.py: Kinolot Studio — $/.test(t))
    && shown.some(t=>t==="__init__.py: Function URL" || /Function URL/.test(t));
});
check("D the package id stays cinema_machine_bridge (an existing install updates in place, operators keep their ids)", ()=>
  existsSync(join(ROOT, PKG, "__init__.py")) && [...init.matchAll(/bl_idname = "([^"]*)"/g)].map(m=>m[1]).filter(x=>x.includes(".")).every(x=>x.startsWith("cinema_machine."))
  && /version": \(1, 0, 4\)/.test(init));
check("D the downloadable ZIP and its page copy are built from this source (names included)", ()=>{
  const zip = readFileSync(join(ROOT, "app/downloads/cinema-machine-blender.zip"));
  const files = {}; let off = zip.readUInt32LE(zip.length-6), count = zip.readUInt16LE(zip.length-12);
  for(let i = 0; i < count; i++){
    const nameLen = zip.readUInt16LE(off+28), extra = zip.readUInt16LE(off+30), comment = zip.readUInt16LE(off+32), local = zip.readUInt32LE(off+42);
    const name = zip.slice(off+46, off+46+nameLen).toString("utf8"), size = zip.readUInt32LE(off+20);
    const lName = zip.readUInt16LE(local+26), lExtra = zip.readUInt16LE(local+28);
    files[name] = zlib.inflateRawSync(zip.slice(local+30+lName+lExtra, local+30+lName+lExtra+size));
    off += 46+nameLen+extra+comment;
  }
  const same = Object.entries(files).every(([n, b])=>b.equals(readFileSync(join(ROOT, "blender", n))));
  const data = /window\.CinemaMachineBlenderAddon = Object\.freeze\((\{.*\})\);/.exec(read("app/blender-addon-data.js"));
  const bundle = data && JSON.parse(data[1]);
  return same && files["cinema_machine_bridge/__init__.py"].toString("utf8").includes('"name": "Kinolot Bridge"')
    && bundle.filename==="cinema-machine-blender.zip" && Buffer.from(bundle.base64, "base64").equals(zip) && bundle.byteLength===zip.length;
});
check("D the setup steps name 'Kinolot Bridge', the 'Kinolot' tab and the saved file kinolot-blender.zip (the packaged path keeps its internal name)", ()=>{
  const a = read("app/blender-preview-ui.jsx"), b = read("app/blender-studio-setup.jsx");
  return a.includes('"Select kinolot-blender.zip without unzipping it, then enable Kinolot Bridge."') && a.includes('"Connect Blender to Kinolot"')
    && a.includes("Choose the Kinolot tab.") && a.includes('link.download="kinolot-blender.zip"') && a.includes("Look for kinolot-blender.zip in your Downloads folder.")
    && b.includes('"Choose kinolot-blender.zip without unzipping it, then enable Kinolot Bridge."') && b.includes("open the Kinolot tab.");
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);
