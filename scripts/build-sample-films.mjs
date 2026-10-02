/* Build the three approved sample films (docs/Sample Films (draft).md, owner-approved 2026-10-02) as
   Kinolot film documents — the same shape the app saves to turn_projects.doc — from their beats and
   screenplay in docs/samples/*.md. Nothing is generated: the scenes, beat maps and screenplay are the
   approved text, parsed; each film's world, cast and research are entered below from the approved draft.

     node scripts/build-sample-films.mjs          → writes supabase/sample-films/<slug>.json
     node scripts/build-sample-films.mjs --check  → builds in memory and validates, writes nothing

   The import into the admin account is scripts/import-sample-films.mjs (Mac only: it uses the
   Supabase Management API token). Card snapshots are left out on purpose — the app stamps one from
   the card when the film opens (app.jsx), so no scene reads as "needs redraft". */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (f) => readFileSync(ROOT + f, "utf8");
const BY = { at: Date.parse("2026-10-02T12:00:00Z"), model: "Kinolot sample film", modelId: "" };

/* ── the films (from docs/Sample Films (draft).md, approved 2026-10-02) ─────────────────────── */
const FILMS = [
  {
    slug: "glass-hours", file: "docs/samples/Glass Hours.md",
    title: "Glass Hours", format: "film", framework: "threeact", genre: "family drama",
    logline: "When the cracked furnace of her family's Murano glassworks gives her one month to sell, the workshop's last master must decide whether to teach the young deckhand who watches through her window everything she never taught her own son.",
    premise: "What would happen if the last master of a dying glass workshop could save it only by giving away the one thing she has kept to herself — her craft?",
    controllingIdea: { value: "A craft survives", cause: "when it is given away rather than kept", polarity: "ironic" },
    centerOfGood: "Graziella's hands: she has never once dropped a gather someone else depended on.",
    setting: { period: "present day, a winter of acqua alta", duration: "one month", location: "a single family glass furnace on the Fondamenta dei Vetrai, Murano", conflict: "personal and institutional" },
    synopsis: [
      ["setup", "The Setup", "At 72, Graziella Fiorin still lights the family furnace alone every dawn. Her son Luca arrives from Milan with an offer from a Scandinavian hotel group, which wants the building, and she refuses it. Every evening a young vaporetto deckhand, Samir Haddad, watches her work through the window; she chases him off. Then the furnace crown cracks, and the repair costs more than a year's sales: she has a month."],
      ["confrontation", "The Confrontation / Complication", "Samir comes back with cullet he gathered from the canal and asks to work for nothing. Graziella tests him, he burns his hand and doesn't drop the pipe, and she starts to teach him. Luca has already promised the buyer a chandelier for the hotel lobby as part of the sale; Graziella decides to make it with Samir, as her answer. Luca finds Samir at his late father's bench, and the old wound opens: she never let her own son touch the pipe. The hotel offers Samir a bellhop job with papers. Rushing, they ruin the anneal and the chandelier cracks in the lehr. Samir leaves."],
      ["resolution", "The Resolution", "By the canal, Graziella tells Luca the truth: she kept him from the trade to spare him its poverty. He tells her he wanted it anyway. Luca goes to the hotel's staff door and brings Samir back. That night the three of them blow the piece together, and it holds. When the buyer comes for the keys, Graziella offers her the chandelier and a different deal: the hotel funds the furnace as a working studio, with an apprenticeship that gives Samir his papers. At dawn Samir works at the second bench, and Graziella watches."],
    ],
    research: {
      memory: "The dread of being the last one who knows how; the quiet hurt of a child who left the family trade.",
      imagination: "5 a.m., the furnace roar, the second bench nobody sits at, a cold espresso on the marver, the smell of hot iron; a boy's breath fogging the workshop window every evening.",
      world: "Murano's glass furnaces: the fornace, the gather, the canna (blowpipe), the marver, annealing in the lehr, reticello (the net pattern where every glass thread crosses another). Energy costs closed or paused many furnaces in 2022–23; Venetian buildings are being bought for hotels.",
      roles: [
        { who: "Graziella Fiorin", role: "the last master glassblower of a family furnace", whatHappens: "Lights the furnace at dawn, gathers and shapes alone, sells pieces to the few shops still buying.", howItFeels: "Holding a whole tradition in two ageing hands.", frustrating: "Gas bills, a cracked crown, and no one to steady the pipe.", lovely: "The moment the glass holds its shape and the room goes quiet." },
        { who: "Samir Haddad", role: "a Tunisian vaporetto deckhand", whatHappens: "Ropes the boats at every stop, watches the city from the water, sends money home.", howItFeels: "Being needed everywhere and belonging nowhere.", frustrating: "Papers, short contracts, being looked through.", lovely: "The furnace light through a workshop window on the way home." },
      ],
    },
    cast: [
      ["graziella", "GRAZIELLA FIORIN", "Protagonist · legacy — the last master glassblower of her family's furnace, 72", "To keep the furnace in Fiorin hands, unchanged.", "To let the craft pass into someone else's hands.", "From keeping the craft to giving it away", { accent: "soft Venetian accent", pitch: "low, warm, gravelly", pace: "slow", quirks: "counts in breaths" }],
      ["luca", "LUCA FIORIN", "Antagonist · the market — her son, a Milan property consultant, 34", "To sell, and free them both from the furnace.", "To admit he always wanted the pipe.", "From selling the furnace to working at it", { accent: "neutral Milanese Italian accent", pitch: "clear, mid", pace: "quick, clipped", quirks: "never finishes apologies" }],
      ["samir", "SAMIR HADDAD", "Ally · the outsider — a Tunisian vaporetto deckhand, 19", "A trade that brings papers and dignity.", "To belong without waiting for permission.", "From watching through the window to working the second bench", { accent: "soft Tunisian accent with Venetian Italian picked up on the boats", pitch: "light, careful", pace: "quiet, measured", quirks: "repeats instructions under his breath" }],
      ["annika", "ANNIKA LUND", "Catalyst · capital — acquisitions manager for Ljusa Hotels, 41", "To close the deal by the month's end.", "", "", { accent: "light Swedish accent in English", pitch: "even, warm", pace: "measured", quirks: "warm-professional" }],
      ["oreste", "ORESTE", "Texture — the old furnace mason, 78", "To tell the truth about the crown.", "", "", { accent: "broad Venetian accent", pitch: "rough", pace: "slow", quirks: "talks to the furnace, not to people" }],
    ],
    drivers: { graziella: "graziella", luca: "luca", samir: "samir", annika: "annika", oreste: "oreste" },
  },
  {
    slug: "kelpfold", file: "docs/samples/Kelpfold - What the Sea Gave Back.md",
    title: "Kelpfold — What the Sea Gave Back", format: "commercial", framework: "kishotenketsu", genre: "brand film",
    logline: "On a storm-dark morning in a northern fishing harbour, a girl in a yellow rain shell waits on the quay for her grandfather's boat, and finds out what her coat used to be.",
    premise: "What would happen if a child learned that the thing keeping her dry was once a danger to the sea her grandfather works?",
    controllingIdea: { value: "Care comes back", cause: "when we pull back what was lost", polarity: "idealistic" },
    centerOfGood: "Maren gives her grandfather the shelter he gives everyone else.",
    setting: { period: "present day", duration: "one morning", location: "a small fishing harbour in Lofoten, Norway", conflict: "environmental" },
    synopsis: [
      ["ki", "Ki — Introduction", "Rain blows sideways across the harbour; umbrellas turn inside out. Maren, nine, runs down the quay in a bright yellow Kelpfold shell."],
      ["sho", "Shō — Development", "She waits at the end of the quay, dry, while the storm passes over her, until a small boat comes out of the spray. It sits low in the water."],
      ["ten", "Ten — The Twist", "It isn't fish. Her grandfather Tor hauls a tangle of ghost net onto the quay. Maren touches the green fibres, then her own sleeve: the same green, and a label that reads \"This shell was 2.4 kg of lost net.\""],
      ["ketsu", "Ketsu — Reconciliation", "She opens her coat and pulls him in under it, both of them laughing in the rain. Super: Kelpfold. Made from what the sea gave back."],
    ],
    research: {
      memory: "Waiting for someone at the water's edge; the pride of wearing a grown-up's gift.",
      imagination: "Sideways rain, red fishing huts, gulls standing into the wind, a boat's lights through spray.",
      world: "Lost and abandoned fishing gear is a large share of ocean plastic; old nylon nets can be recovered and recycled into new fabric. Kelpfold (invented) makes waterproof rain shells from recovered ghost nets.",
      roles: [
        { who: "Tor", role: "a fisherman who now hauls ghost nets", whatHappens: "Goes out at dawn in all weather and drags lost net out of the sea.", howItFeels: "Cleaning up a house nobody else will.", frustrating: "The weight, the cold, the next squall.", lovely: "Bringing back what the sea gave up." },
      ],
    },
    cast: [
      ["maren", "MAREN", "Protagonist — a fisherman's granddaughter, 9", "To be the first one at the quay when the boat comes in.", "To understand what her grandfather does out there.", "From waiting for him to sheltering him", { accent: "", pitch: "", pace: "", quirks: "no dialogue; laughter" }],
      ["tor", "TOR", "Mentor — her grandfather, a fisherman in his seventies who now hauls ghost nets", "To get the net ashore before the next squall.", "To let himself be looked after.", "From refusing shelter to accepting it", { accent: "soft northern Norwegian accent", pitch: "low", pace: "slow", quirks: "one optional line" }],
    ],
    drivers: { maren: "maren", tor: "tor" },
  },
  {
    slug: "third-mainland", file: "docs/samples/Third Mainland.md",
    title: "Third Mainland", format: "musicvideo", framework: "herosjourney", genre: "alt-soul music video",
    logline: "On the night of their mother's burial, a young tailor carries the family sewing machine on the last bus across Lagos's longest bridge to the sister who blames her for staying behind.",
    premise: "What would happen if the only way to bring two estranged sisters back together was the machine their mother sewed on — carried across a city that never stops moving?",
    controllingIdea: { value: "Family is rejoined", cause: "when we carry what we were left, not what we're owed", polarity: "idealistic" },
    centerOfGood: "Temi keeps carrying the machine when every reason to put it down arrives.",
    setting: { period: "present day", duration: "one night, 10 p.m. to dawn", location: "Lagos: a tailoring kiosk in Yaba, a yellow danfo, the Third Mainland Bridge, nurses' quarters on Lagos Island", conflict: "personal and environmental" },
    synopsis: [
      ["departure", "The Departure", "After the burial, Temi sits in their mother's empty kiosk with the old treadle machine. A voice note from her sister Folake, a nurse on the Island: \"Bring it, or don't come.\" Temi straps the machine to a trolley and boards the last danfo, where the old driver, Baba Sule, knew their mother's shop."],
      ["initiation", "The Initiation", "On the bridge, traffic stops dead and then the rain comes. A passenger's market bag tears and Temi mends it by phone light on the machine's case, so the bus starts to help her. At the Island end, the trolley hits a kerb, the machine falls and the treadle belt snaps."],
      ["return", "The Return", "Temi carries the machine the last streets in her arms and knocks at Folake's gate at 4 a.m. Folake finds the belt in Temi's pocket. At dawn the sisters re-thread it together, and the machine runs. On the bridge behind them, the morning traffic begins."],
    ],
    research: {
      memory: "The chores a parent leaves behind; the sibling who left and the sibling who stayed.",
      imagination: "The kiosk's single bulb, bolts of Ankara print, the machine's treadle under a dust sheet; the conductor calling the route; the lagoon black under the bridge, Island lights ahead.",
      world: "Yellow danfo minibuses run Lagos's routes; the Third Mainland Bridge crosses the lagoon from the mainland to Lagos Island; tailoring kiosks and aso ebi (matching family cloth for ceremonies) are part of family occasions. The song \"Third Mainland\" and the artist Adaeze Rae are invented.",
      roles: [
        { who: "Temi Ogunleye", role: "an apprentice tailor who kept her mother's kiosk", whatHappens: "Hems, takes in and alters by one bulb late into the night.", howItFeels: "Keeping a door open for people who left.", frustrating: "Power cuts, late payers, being the one who stayed.", lovely: "The treadle's rhythm when a seam runs true." },
        { who: "Folake Ogunleye", role: "a night-shift nurse on Lagos Island", whatHappens: "Twelve-hour shifts, quarters by the hospital, money sent home.", howItFeels: "Holding everyone else's emergencies.", frustrating: "Never being home; being blamed for leaving.", lovely: "A patient going home at dawn." },
      ],
    },
    cast: [
      ["temi", "TEMI OGUNLEYE", "Protagonist — apprentice tailor who kept their mother's kiosk, 22", "To deliver the machine and be forgiven.", "To forgive herself for being the one who stayed.", "From carrying it alone to sewing with her sister", { accent: "soft Lagos Yoruba-English accent", pitch: "bright", pace: "quick", quirks: "hums when nervous" }],
      ["folake", "FOLAKE OGUNLEYE", "Threshold guardian — her sister, a night-shift nurse on the Island, 31", "Not to need anything from home.", "To admit she misses it.", "From shutting the gate to opening it", { accent: "Lagos accent", pitch: "crisp, tired", pace: "precise", quirks: "precise words" }],
      ["sule", "BABA SULE", "Mentor — the danfo driver who took their mother's orders, 60s", "To finish the route on time.", "", "", { accent: "deep Yoruba-accented voice", pitch: "deep", pace: "unhurried", quirks: "teases" }],
      ["adaeze", "ADAEZE RAE", "The artist — seen performing on the danfo's roof under the bridge lights", "", "", "", { accent: "", pitch: "", pace: "", quirks: "sings" }],
    ],
    drivers: { temi: "temi", folake: "folake", "baba sule": "sule", sule: "sule", adaeze: "adaeze" },
  },
];

/* ── scene kinds by framework (the app's own plot-point ids) ─────────────────────────────────── */
const KINDS = {
  "glass-hours": { 4: "incite", 8: "midpoint", 12: "act-climax", 15: "story-climax", 16: "resolution" },
  kelpfold: { 1: "plant", 2: "deepen", 3: "ten", 4: "ketsu" },
  "third-mainland": { 1: "ordinary-world", 2: "call", 3: "mentor", 4: "threshold", 5: "tests", 6: "ordeal", 7: "road-back", 8: "elixir" },
};
const PLOT = {
  "glass-hours": { 1: "Hook", 6: "Pinch point", 10: "Pinch point" },
};
const ROMAN = { I: 1, II: 2, III: 3 };
const KTK = { ki: 1, "shō": 2, sho: 2, ten: 3, ketsu: 4 };
const HJ_ACT = (n) => (n <= 3 ? 1 : n <= 6 ? 2 : 3);

/* ── parsing ────────────────────────────────────────────────────────────────────────────────── */
const num = (s) => Number(String(s).replace(/−/g, "-").replace(/^\+/, ""));
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
function headerField(sec, label) {
  const m = sec.match(new RegExp("^- \\*\\*" + label + ":\\*\\*\\s*(.+(?:\\n  .+)*)", "m"));
  return m ? clean(m[1]) : "";
}
function parseBeats(sec) {
  const a = sec.indexOf("**Beats**"), b = sec.search(/\*\*(Screenplay|Script)\*\*/);
  const body = sec.slice(a + 9, b);
  const items = body.split(/\n(?=\d+\.\s)/).map((x) => x.trim()).filter((x) => /^\d+\.\s/.test(x));
  return items.map((raw, i) => {
    const t = clean(raw.replace(/^\d+\.\s*/, ""));
    const turn = /\(turn\)/i.test(t);
    const s = t.replace(/\(turn\)\s*/gi, "");
    // "Drive — <tactic>: <what happens>" — a tactic is a short name (≤ 5 words, no sentence
    // punctuation); a side written as a plain sentence keeps it all as its description
    const side = (txt) => {
      const t2 = clean(txt);
      const c = t2.indexOf(":");
      const head = c > 0 ? t2.slice(0, c) : "";
      if (head && head.split(/\s+/).length <= 5 && !/[.;!?"“”]/.test(head)) return { a: cap(head), d: clean(t2.slice(c + 1)) };
      return { a: "", d: t2 };
    };
    const cap = (x) => { const v = clean(x); return v ? v.charAt(0).toUpperCase() + v.slice(1) : ""; };
    const dm = s.match(/Drive\s*—\s*(.+?)(?=\s*React\s*—|$)/);
    const rm = s.match(/React\s*—\s*(.+)$/);
    const drive = dm ? side(dm[1]) : { a: "", d: rm ? "" : clean(s) };
    const react = rm ? side(rm[1]) : { a: "", d: "" };
    return { n: i + 1, drive, react, turn };
  });
}
const CUE_RE = /^[A-Z][A-Z0-9'’ .\-]{1,40}(\s\((V\.O\.|O\.S\.|CONT'D|SINGING)\))*$/;
const NOT_CUE = /^(INT[. ]|EXT[. ]|INSERT|SUPER|CUT TO|FADE|WIDE|CLOSE|SMASH|MATCH|BACK TO|LATER|MONTAGE|END)/;
function parseScript(sec) {
  const m = sec.match(/\*\*(?:Screenplay|Script)\*\*[^\n]*\n+```\n([\s\S]*?)```/);
  if (!m) throw new Error("no script block");
  const blocks = [];
  let beat = 1;
  const paras = m[1].split(/\n\s*\n/);
  for (const p of paras) {
    let lines = p.split("\n").map((l) => l.trim()).filter(Boolean);
    while (lines.length && /^\[b(\d+)\]$/.test(lines[0])) { beat = Number(lines[0].match(/\d+/)[0]); lines = lines.slice(1); }
    if (!lines.length) continue;
    const first = lines[0];
    if (/^(INT|EXT)[. ]/.test(first) && lines.length === 1) { blocks.push({ beat, type: "scene", text: first }); continue; }
    if (/^(INT|EXT)[. ]/.test(first)) { blocks.push({ beat, type: "scene", text: first }); lines = lines.slice(1); if (!lines.length) continue; }
    if (CUE_RE.test(lines[0]) && !NOT_CUE.test(lines[0]) && lines.length > 1) {
      blocks.push({ beat, type: "char", text: lines[0].replace(/\s+/g, " ") });
      let buf = [], inParen = false, paren = [];
      const flush = () => { if (buf.length) { blocks.push({ beat, type: "dia", text: clean(buf.join(" ")) }); buf = []; } };
      for (const l of lines.slice(1)) {
        if (inParen || l.startsWith("(")) {
          flush(); paren.push(l); inParen = !l.endsWith(")");
          if (!inParen) { blocks.push({ beat, type: "paren", text: clean(paren.join(" ")).replace(/^\(|\)$/g, "") }); paren = []; }
          continue;
        }
        buf.push(l);
      }
      flush();
      continue;
    }
    if (lines.length === 1 && /^[A-Z ]+(TO|OUT|IN)[:.]$/.test(first)) { blocks.push({ beat, type: "trans", text: first }); continue; }
    blocks.push({ beat, type: "action", text: clean(lines.join(" ")) });
  }
  return blocks;
}
function valueWordFor(axis, c) { return c > 0 ? axis.pos : c < 0 ? axis.neg : axis.pos + " / " + axis.neg; }
const CONF = (s) => { const t = String(s || "").toLowerCase(); return t.startsWith("inner") ? 0 : t.startsWith("extra") ? 2 : 1; };

function buildFilm(F) {
  const md = read(F.file);
  const secs = md.split(/\n(?=## Scene \d+ — )/).filter((s) => s.startsWith("## Scene "));
  const ids = (n) => F.slug.split("-").map((w) => w[0]).join("") + "-s" + String(n).padStart(2, "0");
  const scenes = [], beatsMap = {}, drafts = {};
  const nameOf = Object.fromEntries(F.cast.map((c) => [c[0], c[1]]));
  for (const sec of secs) {
    const hm = sec.match(/^## Scene (\d+) — (.+?)\s{2,}\(([^)]+)\)/);
    if (!hm) throw new Error(F.slug + ": bad scene heading: " + sec.split("\n")[0]);
    const no = Number(hm[1]), title = clean(hm[2]), tag = hm[3];
    const id = ids(no);
    const act = F.framework === "threeact" ? ROMAN[(tag.match(/Act (I{1,3})/) || [])[1]]
      : F.framework === "kishotenketsu" ? KTK[tag.toLowerCase().split(/[ ·]/)[0]] : HJ_ACT(no);
    if (!act) throw new Error(F.slug + " scene " + no + ": no act from " + tag);
    const loc = headerField(sec, "Slugline");
    const driverText = headerField(sec, "Driver").toLowerCase();
    const driver = F.drivers[driverText] || F.drivers[driverText.split(/[ (,]/)[0]];
    if (!driver) throw new Error(F.slug + " scene " + no + ": unknown driver " + driverText);
    const reactor = headerField(sec, "Reactor");
    const axisM = headerField(sec, "Value at stake").match(/^(.+?)\s*↔\s*(.+?)$/);
    if (!axisM) throw new Error(F.slug + " scene " + no + ": no value axis");
    const axis = { pos: clean(axisM[1]), neg: clean(axisM[2].replace(/\(.*$/, "")) };
    const charges = (headerField(sec, "Open → close").match(/[+−-]?\d(?![\d.])/g) || []).map(num);
    if (charges.length < 2) throw new Error(F.slug + " scene " + no + ": no charges");
    const openCharge = charges[0], closeCharge = charges[charges.length - 1];
    const desire = clean((sec.match(/\*\*Desire:\*\*\s*(.+)/) || [])[1]).replace(/\.$/, "");
    const obstacle = clean((sec.match(/\*\*Obstacle:\*\*\s*(.+)/) || [])[1]).replace(/\.$/, "");
    const rows = parseBeats(sec);
    const turnAt = (rows.find((r) => r.turn) || rows[rows.length - 1]).n;
    const blocks = parseScript(sec);
    const kind = (KINDS[F.slug] || {})[no] || "normal";
    const result = rows.filter((r) => r.n === 1 || r.n === turnAt || r.n === rows.length)
      .map((r) => r.drive.d || r.react.d).filter(Boolean).join(" ");
    scenes.push({
      id, no, act, title, loc, kind, plot: (PLOT[F.slug] || {})[no] || "", seq: "",
      value: axis, openCharge, closeCharge, openValue: valueWordFor(axis, openCharge), closeValue: valueWordFor(axis, closeCharge),
      conf: CONF(headerField(sec, "Conflict source")), confAuthored: true,
      driver, objective: desire, summary: result,
    });
    const rowObjs = rows.map((r) => ({ n: r.n, id: "beat-" + id + "-" + r.n, drive: r.drive, react: r.react }));
    beatsMap[id] = {
      by: BY, desire, obstacle, result, turnAt, turnBeatId: "beat-" + id + "-" + turnAt,
      driverLabel: nameOf[driver] || driver.toUpperCase(),
      reactorLabel: clean(reactor.replace(/\(.*?\)/g, "").replace(/\s+([,;])/g, "$1").replace(/[,;]\s*$/, "")).toUpperCase() || "",
      rows: rowObjs,
    };
    drafts[id] = { ai: false, auto: false, by: BY, blocks };
  }
  scenes.sort((a, b) => a.no - b.no);
  const characters = F.cast.map(([id, name, role, conscious, unconscious, arc, voice]) => ({
    id, name, role, conscious, unconscious, arc, voice,
  }));
  const paras = F.synopsis.map(([key, label, text]) => ({ key, label, text }));
  const synopsis = { paras }; paras.forEach((p) => { synopsis[p.key] = p.text; });
  const lead = F.research.roles[0] || {};
  const research = {
    memory: F.research.memory, imagination: F.research.imagination,
    fact: { world: F.research.world, roles: F.research.roles,
      role: lead.role || "", whatHappens: lead.whatHappens || "", howItFeels: lead.howItFeels || "", frustrating: lead.frustrating || "", lovely: lead.lovely || "" },
    sources: [], grounded: false,
  };
  const sourceBrief = "LOGLINE: " + F.logline + "\n\nSYNOPSIS — " + F.title + ":" + paras.map((p) => "\n" + p.label + ": " + p.text).join("")
    + "\n\nWORLD & ROLE (researched, keep names/period/craft consistent with this):\nWorld: " + F.research.world + (lead.role ? "\nProtagonist's role: " + lead.role : "");
  const doc = {
    _rev: 1, blank: true, room: "writers", view: "spine", artView: "lookbook", selId: scenes[0].id,
    project: {
      title: F.title, format: F.format, framework: F.framework, genre: F.genre,
      logline: F.logline, premise: F.premise, controllingIdea: F.controllingIdea, centerOfGood: F.centerOfGood,
      setting: F.setting, synopsis, research, sourceBrief, sourceBriefAt: new Date(BY.at).toISOString(),
      sampleFilm: { slug: F.slug, source: F.file, version: 1 },
    },
    scenes, beatsMap, drafts, characters,
    continuityMap: {}, history: {}, props: [], locations: [], shots: [], lookbook: [], lookbookNote: "", lookbookApplied: {},
    propsSeeded: false, locsSeeded: false, visualsSeeded: false, sluglineUnits: [],
    trash: { props: [], shots: [], locations: [], characters: [] },
  };
  return doc;
}

/* ── validation (the pipeline's free checks) ────────────────────────────────────────────────── */
const TARGET = { "glass-hours": [16, 4, 6], kelpfold: [4, 2, 3], "third-mainland": [8, 2, 3] };
export function validate(slug, doc) {
  const [n, bmin, bmax] = TARGET[slug];
  const problems = [];
  if (doc.scenes.length !== n) problems.push(`${doc.scenes.length} scenes, expected ${n}`);
  const castIds = new Set(doc.characters.map((c) => c.id));
  doc.scenes.forEach((s, i) => {
    const tag = `scene ${s.no}`;
    if (s.no !== i + 1) problems.push(`${tag}: out of order`);
    if (!castIds.has(s.driver)) problems.push(`${tag}: driver ${s.driver} not in cast`);
    const o = s.openCharge, c = s.closeCharge;
    const turns = (o > 0 && c < 0) || (o < 0 && c > 0) || (o === 0 && Math.abs(c) >= 2);
    const settles = ["resolution", "elixir", "ketsu"].includes(s.kind);
    const ktkMove = ["plant", "deepen"].includes(s.kind) && o !== c;
    if (!turns && !settles && !ktkMove) problems.push(`${tag}: does not turn (${o} → ${c})`);
    const b = doc.beatsMap[s.id];
    if (!b || b.rows.length < bmin || b.rows.length > bmax) problems.push(`${tag}: ${b ? b.rows.length : 0} beats, expected ${bmin}–${bmax}`);
    if (b && b.rows.some((r) => !r.drive.d && !r.react.d)) problems.push(`${tag}: an empty beat`);
    const d = doc.drafts[s.id];
    if (!d || !d.blocks.length) problems.push(`${tag}: no screenplay`);
    else {
      if (d.blocks[0].type !== "scene") problems.push(`${tag}: screenplay doesn't open on its slugline`);
      if (d.blocks.some((x) => x.beat < 1 || x.beat > b.rows.length)) problems.push(`${tag}: a block maps to no beat`);
      let run = 0, who = "";
      for (const x of d.blocks) {
        if (x.type === "char") { who = x.text; run = 0; }
        else if (x.type === "dia") { run += x.text.split(/\s+/).length; if (run > 60 && !/SINGING|ADAEZE/.test(who)) problems.push(`${tag}: ${who} speaks ${run} words unbroken`); }
        else if (x.type !== "paren") run = 0;
      }
    }
  });
  return problems;
}

/* ── main ───────────────────────────────────────────────────────────────────────────────────── */
export function buildAll() { return FILMS.map((F) => ({ slug: F.slug, title: F.title, doc: buildFilm(F) })); }
if (import.meta.url === "file://" + process.argv[1]) {
  const check = process.argv.includes("--check");
  let bad = 0;
  if (!check) mkdirSync(ROOT + "supabase/sample-films", { recursive: true });
  for (const f of buildAll()) {
    const problems = validate(f.slug, f.doc);
    const blocks = Object.values(f.doc.drafts).reduce((n, d) => n + d.blocks.length, 0);
    console.log(`${f.slug}: ${f.doc.scenes.length} scenes, ${blocks} screenplay blocks, ${problems.length ? problems.length + " problem(s)" : "valid"}`);
    problems.forEach((p) => console.log("  - " + p));
    bad += problems.length;
    if (!check) writeFileSync(ROOT + `supabase/sample-films/${f.slug}.json`, JSON.stringify({ title: f.title, doc: f.doc }, null, 2) + "\n");
  }
  process.exit(bad ? 1 : 0);
}
