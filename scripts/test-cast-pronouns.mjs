#!/usr/bin/env node
/* ============================================================================
   HEADLESS CAST-PRONOUN TESTS — charPronouns / castPronounBlock (ai.jsx).
   Runs against the MINIFIED dist build in a stubbed vm sandbox and asserts
   the gender-consistency machinery: explicit sheet pronouns win, keyword
   inference still works, unset pronouns produce the HARD-ERROR cast-block
   wording, and the block never invents pronouns. Deterministic asserts only —
   any mismatch exits 1. Run AFTER `npm run build`:

     node scripts/test-cast-pronouns.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const noop = () => {};
const makeSandbox = () => ({
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  React: new Proxy({}, { get: (t, k) => (k === "createElement" ? () => null : noop) }),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  navigator: { userAgent: "node-test" },
  location: { href: "", search: "", hash: "", origin: "" },
  CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; } },
  Image: class {},
  document: {
    createElement: () => ({ getContext: () => null, style: {}, setAttribute: noop, appendChild: noop }),
    getElementById: () => null,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
    body: { appendChild: noop, removeChild: noop },
  },
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
  addEventListener: noop, removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
});
const sandbox = makeSandbox();
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
// ai.jsx reads cameoInferGender if present; run WITHOUT it first (fallback path),
// then load cameo.js for the shared-inference path.
vm.runInContext(readFileSync("dist/app/ai.js", "utf8"), sandbox, { filename: "dist/app/ai.js" });

const charPronouns = sandbox.window.charPronouns;
const castPronounBlock = sandbox.window.castPronounBlock;
if (typeof charPronouns !== "function") { console.log("FAIL window.charPronouns missing from dist build"); process.exit(1); }
if (typeof castPronounBlock !== "function") { console.log("FAIL window.castPronounBlock missing from dist build"); process.exit(1); }

let failures = 0, passes = 0;
const ok = (name, cond, detail) => {
  if (cond) passes++;
  else { failures++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
};

/* ---- charPronouns: precedence and fallback ------------------------------ */
ok("explicit she/her wins", charPronouns({ name: "ODETTE", pronouns: "she/her", role: "watchman" }) === "she/her");
ok("explicit he/him wins over female keywords", charPronouns({ name: "X", pronouns: "he/him", role: "a mother of three" }) === "he/him");
ok("fallback infers female from prose", charPronouns({ name: "LIRA", role: "a widow who runs the till", identity: "shopkeeper, mother of two" }) === "she/her");
ok("fallback infers male from prose", charPronouns({ name: "KETT", role: "a retired watchman, father of one" }) === "he/him");
ok("fallback returns empty for genderless prose", charPronouns({ name: "ODETTE", role: "Antagonist", identity: "exiled royalty" }) === "",
  "the Odette case: sparse record must NOT invent a pronoun");
ok("missing character yields empty", charPronouns(null) === "" || charPronouns(undefined) === "");
ok("pronouns with whitespace trimmed", charPronouns({ name: "A", pronouns: "  she/her  " }) === "she/her");

/* ---- castPronounBlock: the prompt contract ------------------------------ */
const cast = [
  { id: "odette", name: "ODETTE", role: "Antagonist", pronouns: "she/her", physique: { age: "late 30s" } },
  { id: "piotr", name: "PIOTR", role: "a retired watchman, father of one" },
  { id: "blank",  name: "BLANK", role: "" },
];
const block = castPronounBlock(cast);
ok("block present for non-empty cast", typeof block === "string" && block.length > 0);
ok("explicit pronouns printed", /ODETTE[^\n]*she\/her/.test(block), block.split("\n").find(l => l.startsWith("ODETTE")));
ok("inferred pronouns printed", /PIOTR[^\n]*he\/him/.test(block), block.split("\n").find(l => l.startsWith("PIOTR")));
ok("unset character gets HARD-ERROR name-only wording",
  /BLANK[^\n]*pronouns UNSET[^\n]*HARD ERROR/.test(block),
  block.split("\n").find(l => l.startsWith("BLANK")));
ok("unset line forbids all pronouns", /NAME only; writing he\/she\/they for them/.test(block));
ok("house rule still bans singular they", /NEVER singular they\/them/.test(block));
ok("age parenthetical rule intact", /AGES ARE CANON/.test(block));
ok("apparent age rides the cast line", /ODETTE[^\n]*apparent age: late 30s/.test(block));
ok("empty cast yields empty block", castPronounBlock([]) === "" || castPronounBlock([]) === castPronounBlock(null));
ok("nameless entries skipped", !castPronounBlock([{ id: "x" }]).includes("undefined"));

/* ---- shared inference path (cameoInferGender loaded) -------------------- */
vm.runInContext(readFileSync("dist/app/cameo.js", "utf8"), sandbox, { filename: "dist/app/cameo.js" });
if (typeof sandbox.cameoInferGender === "function" || typeof sandbox.window.cameoInferGender === "function") {
  ok("shared inference: female", charPronouns({ name: "MARA", role: "an actress and mother" }) === "she/her");
  ok("shared inference: male", charPronouns({ name: "REEF", role: "an actor, a widower" }) === "he/him");
  ok("shared inference: neutral stays empty", charPronouns({ name: "ODETTE", role: "Antagonist", identity: "exiled royalty" }) === "");
  ok("explicit still wins with shared inference", charPronouns({ name: "ODETTE", pronouns: "she/her", role: "a watchman" }) === "she/her");
} else {
  console.log("NOTE cameoInferGender not exported by dist/app/cameo.js — fallback-only checks ran");
}

/* ---- pronoun merge rules mirrored by the articulation prompts ----------- */
// The model's JSON pronouns are validated against ^(he/him|she/her)$ and an
// explicit sheet pick always wins; replicate both rules against sample payloads.
const mergeOk = (raw, existing) => {
  const pr = String(raw || "").toLowerCase().trim();
  return (/^(he\/him|she\/her)$/.test(pr) && !existing) ? pr : null;
};
ok("merge accepts she/her", mergeOk("she/her", "") === "she/her");
ok("merge accepts He/Him case-insensitively", mergeOk("He/Him", "") === "he/him");
ok("merge rejects they/them", mergeOk("they/them", "") === null);
ok("merge rejects garbage", mergeOk("attack helicopter", "") === null);
ok("merge never overrides an explicit sheet pick", mergeOk("he/him", "she/her") === null);

/* ---- RUNTIME: aiCastPsychology actually merges pronouns -----------------
   Regression guard for the TDZ bug the static checks above cannot see: the
   merge must run INSIDE the real function, not a replicated copy. Stub the
   model and assert the returned map carries validated pronouns. */
const aiCastPsychology = sandbox.window.aiCastPsychology;
if (typeof aiCastPsychology !== "function") {
  failures++; console.log("FAIL window.aiCastPsychology missing from dist build");
} else {
  sandbox.window.claude = { complete: async () => JSON.stringify({ cast: [
    { id: "odette", pronouns: "she/her", conscious: "c", unconscious: "u", arc: "a", humanTruth: "h",
      voiceDNA:{vocabulary:"legal claims",syntax:"clipped",rhythm:"measured",directness:"blunt",imagery:"contracts",avoids:"apologies",stressShift:"fragments"} },
    { id: "piotr",  pronouns: "He/Him",  conscious: "c", arc: "a", humanTruth: "h" },
    { id: "kett",   pronouns: "they/them", conscious: "c", arc: "a", humanTruth: "h" },
  ] }) };
  const castIn = [
    // roles keep everyone inside the depth-budget filter (orbit <= 2 — a plain
    // "Watchman"/"Fixer" is third circle and correctly gets no psychology pass)
    { id: "odette", name: "ODETTE", role: "Antagonist", voiceDNA:{syntax:"writer-owned syntax"} }, // preserve manual DNA
    { id: "piotr",  name: "PIOTR",  role: "Mentor", pronouns: "he/him" }, // explicit -> never overridden
    { id: "kett",   name: "KETT",   role: "Ally" },                       // invalid value -> rejected
  ];
  const psych = await aiCastPsychology(castIn, [], { title: "T", genre: "drama", controllingIdea: {} });
  ok("batch returns a map", !!psych && typeof psych === "object", JSON.stringify(psych));
  ok("batch adopts validated pronouns", !!(psych && psych.odette && psych.odette.pronouns === "she/her"),
    psych && JSON.stringify(psych.odette));
  ok("batch normalizes case", !!(psych && psych.piotr && !("pronouns" in psych.piotr)),
    "piotr already had an explicit sheet pick — merge must not touch it; got " + (psych && JSON.stringify(psych.piotr)));
  ok("batch rejects they/them", !!(psych && psych.kett && !("pronouns" in psych.kett)),
    "got " + (psych && JSON.stringify(psych.kett)));
  ok("batch still merges other fields", !!(psych && psych.odette && psych.odette.conscious === "c"),
    "TDZ check: if the merge threw, every field would be missing");
  ok("batch populates missing Voice DNA", psych?.odette?.voiceDNA?.vocabulary === "legal claims",
    psych && JSON.stringify(psych.odette));
  ok("batch preserves manually authored Voice DNA", psych?.odette?.voiceDNA?.syntax === "writer-owned syntax",
    psych && JSON.stringify(psych.odette));
  delete sandbox.window.claude;
}

/* ---- the prompts must ASK for pronouns ---------------------------------- */
const src = readFileSync("app/ai.jsx", "utf8");
const single = src.match(/async function aiDraftCharacter[\s\S]*?window\.aiDraftCharacter/);
const batch  = src.match(/async function aiCastPsychology[\s\S]*?window\.aiCastPsychology/);
ok("single-character prompt requests pronouns", !!single && /"pronouns":"he\/him\|she\/her"/.test(single[0]));
ok("batch prompt requests pronouns for every character", !!batch && /REQUIRED for EVERY character regardless of depth budget/.test(batch[0]));
ok("batch JSON spec includes pronouns", !!batch && /"pronouns":"he\/him\|she\/her"/.test(batch[0]));
ok("batch JSON spec requests all Voice DNA fields", !!batch && /"voiceDNA":\{"vocabulary":"\.\.\.","syntax":"\.\.\.","rhythm":"\.\.\.","directness":"\.\.\.","imagery":"\.\.\.","avoids":"\.\.\.","stressShift":"\.\.\."\}/.test(batch[0]));

/* ---- agents.jsx: unset-canon drift branch exists ------------------------- */
const agents = readFileSync("app/agents.jsx", "utf8");
ok("drift check fires when canon is unset", /scriptPron && !canonPron/.test(agents));
ok("unset-canon proposal named", agents.includes("Pronouns unset — "));
ok("reject path points to the Cast panel", /pronouns still unset — set them in the Cast panel/.test(agents));

console.log("RESULT: " + (failures ? "FAIL — " : "OK — ") + passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);
