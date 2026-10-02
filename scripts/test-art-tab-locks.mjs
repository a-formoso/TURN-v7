#!/usr/bin/env node
/* ============================================================================
   ART ROOM TAB LOCKS + THE BUILD STOPS AFTER THE LEDGER (owner-approved 2026-09-27)

   docs/Story Pipeline.md step 9, "The tabs unlock in that order": every Art Room
   tab stays visible; a locked tab shows what it is waiting for and a button to the
   step that unlocks it —
     Lookbook always · Characters once the Lookbook has a look · Props once every
     character has a written spec · Locations once every prop has a written spec, or
     "No props in this story" · Color once every location has a written spec · Shots
     once the Color tab has a look · Storyboards once shot coverage exists ·
     Breakdown / Production check / Blender Studio always open.
   A step with nothing to do unlocks the next one by itself; a tab that already has
   content is never locked; Run pre-production is unchanged; a TV Series episode
   unlocks from the Show's shared Bible.
   And the build-order paragraph: the story build runs the psychology check against
   the script, then the continuity ledger, and stops there — it no longer drafts the
   cast's visual look.

   Review pass (2026-09-27): the steps are a CHAIN (a rule counts once the step before
   it is open, so a cast-less film's Props waits for the Lookbook too); a locked tab's
   card points at the first OPEN step of its chain; a tab's "Recently deleted" bin and
   the "No props in this story" mark are content; lock copy names a tab by its tab-bar
   label with the format's name in brackets; a reference image dropped on a Lookbook
   card counts from any tab (image-slot store + image-slot-change) and the App memo
   re-checks when image caches fill.

   This test runs the REAL code without a browser or network:
   - app/art-tab-locks.js (the one pure decision) with the REAL predicates it reads:
     lookbook.jsx lookbookHasLook, artroom.jsx charVisualsDrafted, props.jsx
     propVisualsDrafted, locations.jsx locVisualsDrafted / scriptHasLocations and
     formats.jsx roomCopy (the format's recoloured tab names);
   - series.js hydrateEpisode, so an episode is judged on the state App really loads;
   - app.jsx's real tab-lock memo, the Props / Locations auto-seed effects and
     setNoPropsConfirmed under a minimal React hook runner (the same shape as
     test-save-conflict-order.mjs / test-lookbook-first.mjs), plus the real
     turnCastAutoDraftStep (the silent cast draft still starts);
   - cloud.jsx's real key-wise project merge and team.jsx's real role allow-list,
     for the "No props in this story" mark's persistence and role scope;
   - chrome.jsx ViewNav + OverflowMenu, artroom.jsx ArtTabLock + ArtRoom and
     props.jsx PropSheets rendered to element trees with a stub React;
   - agents.jsx agentAdaptation RUN end to end with stubbed model calls (and the real
     charVisualDefaults placeholders): no cast visual step, the psychology check runs
     before the continuity ledger, and the final message claims no character sheets;
   - image-slot.js's real slot store (its read-only imageSlotStored hook + the
     image-slot-change event) behind lookbook.jsx's "a dropped image" rule;
   - ai.jsx APP_FEATURES evaluated after its replace chain, so MUSE can answer
     "why is Props locked?".

     node scripts/test-art-tab-locks.mjs
   ============================================================================ */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = p => readFileSync(ROOT + p, "utf8");
let passes = 0, failures = 0;
const ok = (name, condition, detail) => {
  if (condition) passes++;
  else { failures++; console.log("FAIL " + name + (detail !== undefined ? " — " + JSON.stringify(detail) : "")); }
};
const between = (text, start, end) => {
  const from = text.indexOf(start);
  if (from < 0) throw new Error("source marker not found: " + start);
  const to = text.indexOf(end, from + start.length);
  if (to < 0) throw new Error("source end marker not found: " + end);
  return text.slice(from, to);
};
const lineOf = (text, prefix) => {
  const l = text.split("\n").find(x => x.startsWith(prefix));
  if (!l) throw new Error("source line not found: " + prefix);
  return l;
};
const tick = () => new Promise(r => setImmediate(r));
const plain = v => JSON.parse(JSON.stringify(v));

const locksSrc = read("app/art-tab-locks.js");
const app = read("app/app.jsx");
const art = read("app/artroom.jsx");
const look = read("app/lookbook.jsx");
const slotSrc = read("app/image-slot.js");
const propsSrc = read("app/props.jsx");
const locSrc = read("app/locations.jsx");
const formats = read("app/formats.jsx");
const series = read("app/series.js");
const chrome = read("app/chrome.jsx");
const agents = read("app/agents.jsx");
const ai = read("app/ai.jsx");
const team = read("app/team.jsx");
const cloud = read("app/cloud.jsx");
const icons = read("app/icons.jsx");
const css = read("app/styles.css");
const html = read("TURN.html");
const doc = read("docs/Story Pipeline.md");

/* ── one vm context holding the real predicates + the pure decision ─────── */
const box = { console, Promise, Object, Array, String, Number, Math, JSON, Set, Map };
box.window = box;
vm.createContext(box);
vm.runInContext(formats, box, { filename: "app/formats.jsx" });
vm.runInContext(between(look, "function lookbookCardDrafted(c)", "window.lookbookHasLook = lookbookHasLook;") + "window.lookbookHasLook = lookbookHasLook;", box, { filename: "app/lookbook.jsx" });
vm.runInContext(lineOf(art, "function vfield("), box, { filename: "app/artroom.jsx" });
vm.runInContext(between(art, "function charVisualsDrafted(c){", "/* prompt for image-to-image"), box, { filename: "app/artroom.jsx" });
vm.runInContext(between(propsSrc, "function propVisualsDrafted(p){", "/* A prop that rides as TEXT") + "window.propVisualsDrafted = propVisualsDrafted;", box, { filename: "app/props.jsx" });
vm.runInContext(lineOf(locSrc, "function titleCaseTime("), box, { filename: "app/locations.jsx" });
vm.runInContext(between(locSrc, "function parseSlugline(raw){", "/* split a compound slugline place"), box, { filename: "app/locations.jsx" });
vm.runInContext(lineOf(locSrc, "function scriptHasLocations(") + "\n" + lineOf(locSrc, "function locVisualsDrafted(") + "\nwindow.scriptHasLocations = scriptHasLocations; window.locVisualsDrafted = locVisualsDrafted;", box, { filename: "app/locations.jsx" });
vm.runInContext(locksSrc, box, { filename: "app/art-tab-locks.js" });
vm.runInContext(series, box, { filename: "app/series.js" });

const L = s => box.turnArtTabLocks(s);
const ORDER = ["lookbook", "characters", "props", "locations", "stylebible", "shots", "storyboard", "breakdown"];
const lockedIds = r => ORDER.filter(id => r[id] && r[id].locked);

/* fixtures */
const charU = (id, name) => ({ id, name: name || id });
const charD = (id, name) => ({ id, name: name || id, coreBody: "lean, weathered", wardrobeMask: "oil-stained parka" });
const propU = id => ({ id, name: "Brass key " + id, kind: "carried" });
const propD = id => ({ id, name: "Brass key " + id, kind: "carried", form: "long-shanked key", material: "tarnished brass" });
const locU = id => ({ id, key: id.toUpperCase(), name: id });
const locD = id => ({ id, key: id.toUpperCase(), name: id, architecture: "brick warehouse", lighting: "sodium spill" });
const SCENES = [{ id: "s1", no: 1, loc: "INT. WAREHOUSE - NIGHT" }, { id: "s2", no: 2, loc: "EXT. ROOFTOP - DAWN" }];
const NO_SLUGS = [{ id: "s1", no: 1, loc: "" }];
const NOTE = "Sodium-lit noir, wet asphalt, long lenses";
const CARD = { id: "look-1", source: "In the Mood for Love", category: "Wardrobe", note: "saturated reds in dim corridors" };
const BLANK_CARD = { id: "look-blank", source: "Palette study", category: "Palette", note: "", negativePrompt: "", manual: true, autoNamed: true };
const LOOK = { lookbook: [CARD], lookbookNote: NOTE };
const film = (extra = {}) => ({ project: { title: "Pine Soot", format: "film" }, characters: [], props: [], locations: [], shots: [],
  lookbook: [], lookbookNote: "", scenes: SCENES, ...extra });

/* ── A. the pure decision: every rule ────────────────────────────────────── */
{
  const r = L(film());
  ok("A every Art Room tab gets an entry", ORDER.every(id => r[id] && typeof r[id].locked === "boolean"), Object.keys(r));
  ok("A the entries cover exactly ART_TABS", plain(ORDER).join() === (() => {
    const b = { window: null }; b.window = b; vm.createContext(b);
    vm.runInContext(between(art, "const ART_TABS = [", "window.ART_TABS = ART_TABS;") + "window.ART_TABS = ART_TABS;", b);
    return b.ART_TABS.map(t => t.id).join();
  })());
  ok("A Lookbook is always open", !r.lookbook.locked && !L(film({ characters: [charU("a")] })).lookbook.locked);
  ok("A Breakdown is always open", !r.breakdown.locked && r.breakdown.unlockTab === null);
  // Production check + Blender Studio are view-bar buttons, never tabs: they are never gated
  const nav = between(chrome, "function ViewNav(", "window.ViewNav = ViewNav;");
  ok("A Production check and Blender Studio buttons never read the locks",
    !/tabLocks[^\n]*vn-studio|vn-studio[^\n]*tabLocks/.test(nav) && nav.includes('"aria-label":"Blender Studio"') && nav.includes('"aria-label":"Production check"'));
}
// A1 — Characters: once the Lookbook has a look
{
  const cast = [charU("mara"), charU("tobias")];
  ok("A1 empty Lookbook → Characters locked", L(film({ characters: cast })).characters.locked === true);
  const c = L(film({ characters: cast })).characters;
  ok("A1 Characters waits for the Lookbook and its button goes there", c.unlockTab === "lookbook" && c.unlockLabel === "Lookbook"
    && /Waiting for the Lookbook to have a look/.test(c.waitingFor) && /visual statement/.test(c.waitingFor) && /named touchstone or an image/.test(c.waitingFor), c);
  ok("A1 a visual statement unlocks Characters", !L(film({ characters: cast, lookbookNote: NOTE })).characters.locked);
  ok("A1 a whitespace statement does not", L(film({ characters: cast, lookbookNote: "  \n " })).characters.locked);
  ok("A1 a reference card with a note unlocks Characters", !L(film({ characters: cast, lookbook: [CARD] })).characters.locked);
  ok("A1 the blank '+ Add reference' placeholder does not", L(film({ characters: cast, lookbook: [BLANK_CARD] })).characters.locked);
  ok("A1 …a named touchstone does", !L(film({ characters: cast, lookbook: [{ ...BLANK_CARD, source: "Chungking Express", autoNamed: false }] })).characters.locked);
  box.nbGetImage = id => (id === "look-blank" ? "blob:frame" : "");
  ok("A1 …an image does (the same lookbookHasLook the silent draft uses)", !L(film({ characters: cast, lookbook: [BLANK_CARD] })).characters.locked);
  delete box.nbGetImage;
  // a reference image DROPPED on the card's "Drop a reference image" frame lives in the
  // <image-slot> store, not in `lookbook` — and its element only exists while the Lookbook
  // tab is open. The store is read directly, so it counts from every other tab too.
  box.imageSlotStored = id => (id === "lookref-look-blank" ? "data:image/webp;base64,UklGR" : null);
  ok("A1 an image DROPPED on a card counts while the Lookbook tab is closed (image-slot store)", !L(film({ characters: cast, lookbook: [BLANK_CARD] })).characters.locked);
  box.imageSlotStored = id => (id === "lookref-look-blank" ? "https://example.test/author-src.png" : null);
  ok("A1 …only a dropped image (a data URL) counts, not an author src", L(film({ characters: cast, lookbook: [BLANK_CARD] })).characters.locked);
  box.imageSlotStored = () => { throw new Error("slot store"); };
  ok("A1 …a throwing slot store is treated as no image", L(film({ characters: cast, lookbook: [BLANK_CARD] })).characters.locked);
  delete box.imageSlotStored;
  ok("A1 a character with a written spec keeps Characters open with no Lookbook (already built)", !L(film({ characters: [charD("mara"), charU("tobias")] })).characters.locked);
  ok("A1 a character with a sheet keeps Characters open with no Lookbook (already built)",
    !L(film({ characters: cast, hasImage: id => id === "tobias" })).characters.locked);
  ok("A1 …so does a character with only an appearance-state sheet",
    !L(film({ characters: [{ ...charU("tobias"), states: [{ id: "wet" }] }], hasImage: id => id === "tobias:wet" })).characters.locked);
  // the DEFAULT image check (what App uses): the bytes, or the asset's metadata when the bytes
  // are still in IndexedDB / the cloud URL cache hasn't filled — never a purge tombstone
  box.nbGetImage = id => (id === "tobias" ? "data:image/png;base64,x" : "");
  ok("A1 default image check: the image cache (nbGetImage) keeps Characters open", !L(film({ characters: cast })).characters.locked);
  box.nbGetImage = () => "";
  box.nbGetMeta = id => (id === "tobias" ? { iso: "2026-09-27T00:00:00Z", model: "x" } : null);
  ok("A1 default image check: the asset's metadata counts while the bytes are still loading", !L(film({ characters: cast })).characters.locked);
  box.nbGetMeta = id => (id === "tobias" ? { iso: "x", deleted: true } : null);
  ok("A1 default image check: a purged asset's tombstone metadata is not an image", L(film({ characters: cast })).characters.locked);
  delete box.nbGetImage; delete box.nbGetMeta;
  ok("A1 a throwing image lookup never locks work away (treated as no image, the rule still applies)",
    L(film({ characters: cast, hasImage: () => { throw new Error("idb"); } })).characters.locked === true);
}
// A2 — Props: every character has a written spec
{
  const r = L(film({ ...LOOK, characters: [charD("mara"), charU("tobias"), charU("idris")] }));
  ok("A2 one undrafted character → Props locked", r.props.locked === true);
  ok("A2 Props waits for Characters with a count and says sheets aren't required",
    r.props.unlockTab === "characters" && r.props.unlockLabel === "Characters"
    && /every card in Characters to have a written spec \(1 of 3 so far\)/.test(r.props.waitingFor)
    && /Generated sheets aren't required/.test(r.props.waitingFor)
    && r.props.progress && r.props.progress.done === 1 && r.props.progress.total === 3, r.props);
  ok("A2 every character drafted → Props unlocked (no sheet needed)", !L(film({ ...LOOK, characters: [charD("mara"), charD("tobias")] })).props.locked);
  ok("A2 half a spec is not a written spec (Body without Public wardrobe)",
    L(film({ ...LOOK, characters: [{ id: "m", name: "M", coreBody: "lean" }] })).props.locked);
  ok("A2 a legacy look/wardrobe spec counts (charVisualsDrafted's fallback)",
    !L(film({ ...LOOK, characters: [{ id: "m", name: "M", look: "lean", wardrobe: "parka" }] })).props.locked);
  ok("A2 NO characters at all → Props unlocked by itself once the Characters step is reached (the Lookbook has a look)",
    !L(film({ ...LOOK })).props.locked && !L(film({ lookbookNote: NOTE, characters: [] })).props.locked);
  // the step with nothing to do can only unlock the next one once it is itself open: a cast-less
  // commercial must not draft its hero product before the Lookbook exists (the double draft)
  const spot = L(film({ project: { title: "Spot", format: "commercial" } }));
  ok("A2 NO characters and an EMPTY Lookbook → Props stays locked, waiting for the Lookbook (the chain)",
    spot.characters.locked && spot.props.locked && spot.props.unlockTab === "lookbook" && spot.props.chained === true
    && /^Waiting for Characters \(Talent\), which is still locked\. Next step: give the Lookbook a look/.test(spot.props.waitingFor), spot.props);
  ok("A2 a prop card keeps Props open while the cast is undrafted (already built)",
    !L(film({ characters: [charU("mara")], props: [propU("p1")] })).props.locked);
}
// A3 — Locations: every prop has a written spec, or "No props in this story"
{
  const base = { ...LOOK, characters: [charD("mara")] };
  const r = L(film({ ...base, props: [propD("p1"), propU("p2")] }));
  ok("A3 one undrafted prop → Locations locked, waiting for Props with a count",
    r.locations.locked && r.locations.unlockTab === "props" && /every card in Props to have a written spec \(1 of 2 so far\)/.test(r.locations.waitingFor), r.locations);
  ok("A3 every prop drafted → Locations unlocked", !L(film({ ...base, props: [propD("p1"), propD("p2")] })).locations.locked);
  const z = L(film(base));
  ok("A3 ZERO props, not confirmed → Locations locked (an empty Props tab is not 'no props')", z.locations.locked === true);
  ok("A3 …and the card says how to confirm", /^Waiting for Props \u2014 give the story\u2019s objects a written spec there, or mark \u201cNo props in this story\u201d if it has none\.$/.test(z.locations.waitingFor) && z.locations.progress === null, z.locations.waitingFor);
  const conf = { ...base, project: { title: "Pine Soot", format: "film", noPropsConfirmed: true } };
  ok("A3 ZERO props + 'No props in this story' → Locations unlocked", !L(film(conf)).locations.locked);
  ok("A3 the mark is honoured only while there are no props (props appeared → their specs rule)",
    L(film({ ...conf, props: [propU("p1")] })).locations.locked && !L(film({ ...conf, props: [propD("p1")] })).locations.locked);
  ok("A3 only a literal true confirms (a stray string does not)", L(film({ ...base, project: { noPropsConfirmed: "yes" } })).locations.locked);
  ok("A3 a location card keeps Locations open (already built)", !L(film({ ...base, props: [propU("p1")], locations: [locU("warehouse")] })).locations.locked);
}
// A4 — Color: every location has a written spec (a script with no places has nothing to wait for)
{
  const base = { ...LOOK, characters: [charD("mara")], props: [propD("p1")] };
  const r = L(film({ ...base, locations: [locD("warehouse"), locU("rooftop")] }));
  ok("A4 one undrafted location → Color locked, waiting for Locations with a count",
    r.stylebible.locked && r.stylebible.unlockTab === "locations" && r.stylebible.unlockLabel === "Locations"
    && /every card in Locations to have a written spec \(1 of 2 so far\)/.test(r.stylebible.waitingFor), r.stylebible);
  ok("A4 every location drafted → Color unlocked", !L(film({ ...base, locations: [locD("warehouse"), locD("rooftop")] })).stylebible.locked);
  const pending = L(film({ ...base, locations: [] }));
  ok("A4 no location cards yet but the script names places → Color waits for them to be pulled in",
    pending.stylebible.locked && /pull the script's places in/.test(pending.stylebible.waitingFor), pending.stylebible);
  ok("A4 ZERO locations (the script names no place) → Color unlocked by itself", !L(film({ ...base, scenes: NO_SLUGS })).stylebible.locked);
  const sb = extra => ({ ...base, locations: [locU("warehouse")], project: { title: "x", styleBible: extra } });
  ok("A4 a Color look keeps Color open (already built)", !L(film(sb({ sceneStyles: { s1: "noir" } }))).stylebible.locked);
  ok("A4 references the user typed keep Color open", !L(film(sb({ refs: "Her, Blade Runner 2049", lookbookSynced: "" }))).stylebible.locked);
  ok("A4 the Lookbook's auto-filled references are not Color content", L(film(sb({ refs: NOTE, lookbookSynced: NOTE }))).stylebible.locked);
  ok("A4 an uploaded reference image keeps Color open", !L(film(sb({ refImages: [{ id: "r1", thumb: "data:", colors: ["#112233"] }] }))).stylebible.locked);
}
// A5 — Shots: the Color tab has a look (the colour system / film stock)
{
  const base = { ...LOOK, characters: [charD("mara")], props: [propD("p1")], locations: [locD("warehouse")] };
  const r = L(film(base));
  ok("A5 no colour look → Shots locked, waiting for Color",
    r.shots.locked && r.shots.unlockTab === "stylebible" && r.shots.unlockLabel === "Color"
    && /Waiting for the Color tab to have a look/.test(r.shots.waitingFor) && /film stock/.test(r.shots.waitingFor), r.shots);
  const withSb = sb => film({ ...base, project: { title: "x", styleBible: sb } });
  ok("A5 a scene assigned a look unlocks Shots", !L(withSb({ sceneStyles: { s1: "noir" } })).shots.locked);
  ok("A5 a bespoke palette (the Colorist's presets) unlocks Shots", !L(withSb({ presets: [{ id: "ash", name: "Ash" }] })).shots.locked);
  ok("A5 a film stock unlocks Shots", !L(withSb({ filmStock: "cinestill800t" })).shots.locked);
  ok("A5 film stock 'none' is not a look", L(withSb({ filmStock: "none" })).shots.locked);
  ok("A5 an empty sceneStyles map / empty values are not a look", L(withSb({ sceneStyles: {} })).shots.locked && L(withSb({ sceneStyles: { s1: "" } })).shots.locked);
  ok("A5 references alone are not a look (they keep COLOR open, not Shots)",
    L(withSb({ refs: "Her", lookbookSynced: "" })).shots.locked && !L(withSb({ refs: "Her", lookbookSynced: "" })).stylebible.locked);
  ok("A5 a shot keeps Shots open (already built)", !L(film({ ...base, shots: [{ id: "sh1", sceneId: "s1" }] })).shots.locked);
  ok("A5 turnColorHasLook is exported for the rest of the app", typeof box.turnColorHasLook === "function" && box.turnColorHasLook({ styleBible: { filmStock: "portra" } }) === true);
}
// A6 — Storyboards: shot coverage exists
{
  const r = L(film({ ...LOOK, characters: [charD("mara")], props: [propD("p1")], locations: [locD("warehouse")], project: { title: "x", styleBible: { filmStock: "portra" } } }));
  ok("A6 no shots (Shots open) → Storyboards locked, waiting for Shots",
    r.storyboard.locked && r.storyboard.unlockTab === "shots" && /Waiting for shot coverage/.test(r.storyboard.waitingFor), r.storyboard);
  ok("A6 one shot → Storyboards unlocked", !L(film({ shots: [{ id: "sh1" }] })).storyboard.locked);
  ok("A6 the storyboards are the shots' frames: there is no separate storyboard input (App passes none)",
    !/hasStoryboard/.test(locksSrc) && !/hasStoryboard/.test(app));
}
// A7 — the order, end to end: each step's work unlocks exactly the next tab
{
  const steps = [];
  let s = film({ characters: [charU("mara"), charU("tobias")] });
  steps.push(lockedIds(L(s)).join());
  s = { ...s, lookbookNote: NOTE }; steps.push(lockedIds(L(s)).join());
  s = { ...s, characters: [charD("mara"), charD("tobias")] }; steps.push(lockedIds(L(s)).join());
  s = { ...s, props: [propD("p1")] }; steps.push(lockedIds(L(s)).join());
  s = { ...s, locations: [locD("warehouse"), locD("rooftop")] }; steps.push(lockedIds(L(s)).join());
  s = { ...s, project: { ...s.project, styleBible: { sceneStyles: { s1: "noir" }, filmStock: "portra" } } }; steps.push(lockedIds(L(s)).join());
  s = { ...s, shots: [{ id: "sh1", sceneId: "s1" }] }; steps.push(lockedIds(L(s)).join());
  ok("A7 the tabs unlock one by one in pipeline order", plain(steps).join(" | ") === [
    "characters,props,locations,stylebible,shots,storyboard",
    "props,locations,stylebible,shots,storyboard",
    "locations,stylebible,shots,storyboard",
    "stylebible,shots,storyboard",
    "shots,storyboard",
    "storyboard",
    "",
  ].join(" | "), steps);
  const full = L(s);
  ok("A7 an unlocked tab carries no waiting copy or button", ORDER.every(id => !full[id].locked && full[id].waitingFor === "" && full[id].unlockTab === null));
}
// A8 — ANYTHING ALREADY BUILT STAYS REACHABLE (older films, work made out of order)
{
  // an older film: built before the locks, Lookbook empty, cast half-drafted, props undrafted,
  // no colour look — every department that holds work stays open
  const legacy = film({ characters: [charD("mara"), charU("tobias")], props: [propU("p1")], locations: [locU("warehouse")],
    project: { title: "Old film", styleBible: { refs: "Her", lookbookSynced: "" } }, shots: [{ id: "sh1" }] });
  ok("A8 a legacy film with content in every tab has NO locked tab", lockedIds(L(legacy)).length === 0, lockedIds(L(legacy)));
  // worn-prop cards built from a character sheet before every character had a spec
  const outOfOrder = film({ ...LOOK, characters: [charD("mara"), charU("tobias")], props: [propU("worn-collar")] });
  ok("A8 props made out of order keep Props open even though a character lacks a spec", !L(outOfOrder).props.locked && L(outOfOrder).locations.locked);
  // shots exist but the Color look was later cleared: Shots and Storyboards stay open
  ok("A8 shots keep Shots + Storyboards open after the colour look is cleared",
    (r => !r.shots.locked && !r.storyboard.locked)(L(film({ shots: [{ id: "sh1" }] }))));
}
// A9 — fail open: a missing or throwing predicate never locks anyone out
{
  const b = { console }; b.window = b; vm.createContext(b);
  vm.runInContext(locksSrc, b);
  const r = b.turnArtTabLocks(film({ characters: [charU("mara")], props: [propU("p1")] }));
  ok("A9 with no predicates loaded, only pure-data rules can lock (Locations has props, Shots/Storyboards have no data)",
    !r.characters.locked && !r.props.locked && !r.locations.locked && r.shots.locked && r.storyboard.locked, lockedIds(r));
  const t = b.turnArtTabLocks({ ...film({ characters: [charU("mara")] }), helpers: {
    lookbookHasLook: () => { throw new Error("boom"); }, charVisualsDrafted: () => { throw new Error("boom"); } } });
  ok("A9 a throwing predicate counts as satisfied", !t.characters.locked && !t.props.locked);
  ok("A9 helpers passed in win over window's (the function is testable in isolation)",
    b.turnArtTabLocks({ ...film({ characters: [charU("m")] }), helpers: { lookbookHasLook: () => false, charVisualsDrafted: () => false } }).characters.locked === true);
  ok("A9 no argument at all still answers", !!b.turnArtTabLocks().lookbook && b.turnArtTabLocks(null).breakdown.locked === false);
  ok("A9 junk entries in the lists are ignored", !L(film({ ...LOOK, characters: [null, 3, "x", charD("m")] })).props.locked);
  // lookbookHasLook fails OPEN on its own (the cast predicate says "no spec", so Characters is
  // open only because the look is assumed — not because a character counts as content)
  const noSpec = { charVisualsDrafted: () => false };
  ok("A9 lookbookHasLook not loaded → the look is assumed (Characters open, with an undrafted cast and no sheet)",
    b.turnArtTabLocks({ ...film({ characters: [charU("mara")] }), hasImage: () => false, helpers: noSpec }).characters.locked === false);
  ok("A9 a throwing lookbookHasLook → the look is assumed",
    b.turnArtTabLocks({ ...film({ characters: [charU("mara")] }), hasImage: () => false, helpers: { ...noSpec, lookbookHasLook: () => { throw new Error("boom"); } } }).characters.locked === false);
  ok("A9 …and a real 'no look' answer still locks it (the fail-open is only for a missing/throwing predicate)",
    b.turnArtTabLocks({ ...film({ characters: [charU("mara")] }), hasImage: () => false, helpers: { ...noSpec, lookbookHasLook: () => false } }).characters.locked === true);
}
// A10 — a tab's "Recently deleted" bin is content: emptying a tab never hides its Restore
{
  const legacy = { characters: [charD("mara")], props: [propD("p1"), propD("p2"), propU("p3"), propU("p4")] };
  const gone = L(film({ ...legacy, locations: [], trash: { characters: [], props: [], locations: [locU("a"), locU("b")], shots: [] } }));
  ok("A10 every location deleted (to re-pull them) → Locations stays open: its bin + its pull live in the tab",
    !gone.locations.locked && gone.locations.hasContent, gone.locations);
  ok("A10 …without the bin the same film would lock Locations (the rule itself is unchanged)",
    L(film({ ...legacy, locations: [], trash: { locations: [] } })).locations.locked);
  const shotsGone = L(film({ characters: [charD("m")], trash: { shots: [{ id: "sh1", _deletedAt: "x" }] } }));
  ok("A10 every shot deleted on a film with no Color look → Shots stays open to restore them",
    !shotsGone.shots.locked && shotsGone.storyboard.locked && shotsGone.storyboard.unlockTab === "shots", { shots: shotsGone.shots, sb: shotsGone.storyboard });
  ok("A10 a deleted character keeps Characters open with no Lookbook (restore from Characters)",
    !L(film({ trash: { characters: [charU("mara")] } })).characters.locked);
  ok("A10 a deleted prop keeps Props open while the cast is undrafted",
    !L(film({ ...LOOK, characters: [charU("mara")], trash: { props: [propU("p1")] } })).props.locked);
  ok("A10 the bin never satisfies the NEXT step's rule (only the active cards count)",
    L(film({ ...LOOK, characters: [charD("mara")], props: [], trash: { props: [propD("p1")] } })).locations.locked);
  ok("A10 a malformed bin is ignored", !L(film({ ...LOOK, trash: { props: "x", locations: null } })).lookbook.locked
    && L(film({ ...LOOK, characters: [charD("m")], trash: "junk" })).locations.locked);
}
// A11 — "No props in this story" is Props content: its Undo can never end up behind a lock
{
  const marked = { ...LOOK, project: { title: "x", format: "film", noPropsConfirmed: true } };
  const r0 = L(film({ ...marked, characters: [charD("mara")] }));
  ok("A11 marked with a fully drafted cast: Props and Locations open", !r0.props.locked && !r0.locations.locked);
  // a character is added later (by hand, the Production check, a series' shared cast) with no spec
  const r1 = L(film({ ...marked, characters: [charD("mara"), charU("newcomer")] }));
  ok("A11 a new undrafted character does NOT relock Props while the mark is set (its Undo stays reachable)",
    !r1.props.locked && r1.props.hasContent && !r1.locations.locked, { props: r1.props, locations: r1.locations });
  const undone = L(film({ ...LOOK, project: { title: "x", format: "film", noPropsConfirmed: false }, characters: [charD("mara"), charU("newcomer")] }));
  ok("A11 after Undo the rules apply again (Props waits for the newcomer's spec, Locations for Props)",
    undone.props.locked && undone.locations.locked && undone.locations.unlockTab === "characters");
}
// A12 — a lock card points at the FIRST OPEN step of its chain, never at another lock card
{
  const fresh = L(film({ characters: [charU("mara"), charU("tobias")], props: [], locations: [] }));
  const locked = lockedIds(fresh);
  ok("A12 fresh film: everything after the Lookbook is locked", locked.join() === "characters,props,locations,stylebible,shots,storyboard", locked);
  ok("A12 every locked tab's button goes to an OPEN tab (one hop, not six)", locked.every(id => fresh[fresh[id].unlockTab] && !fresh[fresh[id].unlockTab].locked), locked.map(id => id + "→" + fresh[id].unlockTab));
  ok("A12 …on a fresh film that is the Lookbook for all of them", locked.every(id => fresh[id].unlockTab === "lookbook" && fresh[id].unlockLabel === "Lookbook"));
  const sb = fresh.storyboard;
  ok("A12 Storyboards names the step it follows and the next thing to do",
    sb.chained && sb.after === "shots" && sb.afterLabel === "Shots"
    && sb.waitingFor === "Waiting for Shots, which is still locked. Next step: give the Lookbook a look \u2014 a visual statement, or a reference card with a note, a named touchstone or an image.", sb);
  ok("A12 Characters (the first locked step) keeps its own copy, unchained", !fresh.characters.chained && /^Waiting for the Lookbook to have a look/.test(fresh.characters.waitingFor));
  ok("A12 Color never says 'open it to pull the script's places in' while Locations is locked", !/pull the script's places in/.test(fresh.stylebible.waitingFor), fresh.stylebible.waitingFor);
  ok("A12 Locations never says 'mark No props in this story' while Props is locked", !/No props in this story/.test(fresh.locations.waitingFor), fresh.locations.waitingFor);
  ok("A12 Props never counts '0 of 2 so far' while Characters is locked", !/so far/.test(fresh.props.waitingFor), fresh.props.waitingFor);
  // mid-chain: the cast is half drafted → Locations/Color/… point at Characters with ITS count
  const mid = L(film({ ...LOOK, characters: [charD("mara"), charU("tobias")] }));
  ok("A12 mid-chain: a later locked tab points at the open step with the work (Characters) and carries its count",
    mid.stylebible.unlockTab === "characters" && mid.stylebible.progress && mid.stylebible.progress.done === 1 && mid.stylebible.progress.total === 2
    && /^Waiting for Locations, which is still locked\. Next step: give every card in Characters a written spec \(1 of 2 so far\)/.test(mid.stylebible.waitingFor), mid.stylebible);
  ok("A12 mid-chain: the next locked tab keeps its own copy (Props waits for Characters)", !mid.props.chained && mid.props.unlockTab === "characters" && /^Waiting for every card in Characters/.test(mid.props.waitingFor));
  // once the step before is open, its own copy is used (the actionable message)
  const open = L(film({ ...LOOK, characters: [charD("mara")] }));
  ok("A12 with Props open, Locations says how to confirm 'No props' (actionable there)", !open.locations.chained && /No props in this story/.test(open.locations.waitingFor));
  const locOpen = L(film({ ...LOOK, characters: [charD("mara")], project: { noPropsConfirmed: true } }));
  ok("A12 with Locations open and no cards yet, Color says to open it to pull the places in", !locOpen.stylebible.chained && /open it to pull the script's places in/.test(locOpen.stylebible.waitingFor), locOpen.stylebible);
  ok("A12 an unlocked tab has no 'after' / chain fields", ["lookbook", "breakdown"].every(id => fresh[id].after === null && fresh[id].chained === false && fresh[id].unlockTab === null));
  ok("A12 ZERO locations → Color opens by itself only once Locations is reached",
    L(film({ ...LOOK, characters: [charD("m")], scenes: NO_SLUGS })).stylebible.locked
    && !L(film({ ...LOOK, characters: [charD("m")], scenes: NO_SLUGS, project: { noPropsConfirmed: true } })).stylebible.locked);
}

/* ── B. the lock card copy: the tab bar's label + the FORMAT's name ─────── */
// Every mention of a tab starts with the label the tab bar shows (what the user clicks) and adds
// the format's department name in brackets where it differs — never the format name alone.
{
  const two = [charU("a"), charD("b")];
  // Props locked (a subject lacks a spec, no object cards yet); Locations locked (an object lacks a spec)
  const at = format => L(film({ ...LOOK, project: { title: "x", format }, characters: two }));
  const atProps = format => L(film({ ...LOOK, project: { title: "x", format }, characters: two, props: [propU("p")] }));
  const docu = at("documentary");
  ok("B documentary: Props (Artifacts & Archive) waits for every card in Characters (Subjects)",
    docu.props.name === "Artifacts & Archive" && docu.props.label === "Props" && docu.props.display === "Props (Artifacts & Archive)"
    && /every card in Characters \(Subjects\) to have a written spec \(1 of 2 so far\)/.test(docu.props.waitingFor)
    && docu.props.unlockLabel === "Characters (Subjects)" && docu.props.afterLabel === "Characters (Subjects)", docu.props);
  const docuP = atProps("documentary");
  ok("B documentary: Locations waits for every card in Props (Artifacts & Archive)",
    /every card in Props \(Artifacts & Archive\) to have a written spec/.test(docuP.locations.waitingFor) && docuP.locations.unlockLabel === "Props (Artifacts & Archive)", docuP.locations);
  const docuZero = L(film({ ...LOOK, project: { format: "documentary" }, characters: [charD("a")] }));
  ok("B documentary with no objects: 'Waiting for Props (Artifacts & Archive) … No props in this story'",
    /^Waiting for Props \(Artifacts & Archive\) — give the story’s objects a written spec there, or mark “No props in this story”/.test(docuZero.locations.waitingFor), docuZero.locations.waitingFor);
  const docuChars = L(film({ project: { format: "documentary" }, characters: two }));
  ok("B documentary: the Characters lock card is 'Characters (Subjects)' (the '(Casting)' tail is dropped)",
    docuChars.characters.name === "Subjects" && docuChars.characters.display === "Characters (Subjects)", docuChars.characters);
  const ad = at("commercial");
  ok("B commercial: Props (Product & Props) waits for Characters (Talent)", ad.props.display === "Props (Product & Props)" && /every card in Characters \(Talent\)/.test(ad.props.waitingFor) && ad.props.unlockLabel === "Characters (Talent)", ad.props);
  const mv = at("musicvideo");
  ok("B music video: plain 'Props' waits for Characters (Artist & Cast)", mv.props.display === "Props" && /every card in Characters \(Artist & Cast\)/.test(mv.props.waitingFor), mv.props);
  const sf = at("film");
  ok("B short film: the plain tab labels, no brackets", sf.props.display === "Props" && /every card in Characters to/.test(sf.props.waitingFor) && sf.stylebible.display === "Color" && !/\(/.test(sf.props.waitingFor.replace(/\(\d+ of \d+ so far\)/, "")));
  ok("B unknown / legacy format text falls back to the defaults", at("some old freeform text").props.display === "Props");
  // no copy anywhere names a format department WITHOUT its tab label in front of it
  for (const format of ["documentary", "commercial", "musicvideo"]) {
    const names = box.turnArtTabNames({ format }), labels = { characters: "Characters", props: "Props" };
    const r = L(film({ ...LOOK, project: { format }, characters: two, props: [propU("p")] }));
    const copy = Object.values(r).map(e => [e.display, e.waitingFor, e.unlockLabel, e.afterLabel].join(" | ")).join("\n");
    const bare = Object.keys(labels).filter(id => names[id] !== labels[id])
      .some(id => copy.split(names[id]).slice(0, -1).some(chunk => !chunk.endsWith(labels[id] + " (")));
    ok("B " + format + ": every format name follows its tab label ('Props (…)'), never alone", !bare, copy);
  }
  const names = box.turnArtTabNames({ format: "documentary" });
  ok("B turnArtTabNames names every tab", ORDER.every(id => typeof names[id] === "string" && names[id]) && names.characters === "Subjects" && names.props === "Artifacts & Archive" && names.lookbook === "Lookbook");
  const disp = box.turnArtTabDisplayNames({ format: "documentary" });
  ok("B turnArtTabDisplayNames: label + (format name) where they differ", disp.characters === "Characters (Subjects)" && disp.props === "Props (Artifacts & Archive)" && disp.locations === "Locations" && disp.stylebible === "Color");
}

/* ── C. TV Series: the episode unlocks from the Show's shared Bible ──────── */
{
  const showDoc = { isShow: true, format: "series", bible: {
    characters: [charD("mara"), charD("tobias")], locations: [locD("warehouse")], props: [propD("p1")],
    lookbook: [CARD], lookbookNote: NOTE, trash: { characters: [], locations: [], props: [] } } };
  const episodeDoc = { showId: "show-1", episodeNo: 2, scenes: SCENES, shots: [], characters: [], props: [], locations: [], lookbook: [], lookbookNote: "",
    project: { title: "Episode 2", format: "series" } };
  const ep = box.turnSeries.hydrateEpisode(episodeDoc, showDoc);
  ok("C the real hydrateEpisode merges the Bible (sanity)", ep && ep.characters.length === 2 && ep.lookbookNote === NOTE && ep.project.format === "series");
  const r = L({ project: ep.project, characters: ep.characters, props: ep.props, locations: ep.locations, shots: ep.shots, lookbook: ep.lookbook, lookbookNote: ep.lookbookNote, scenes: ep.scenes });
  ok("C an episode of a designed show: Characters → Color unlocked from the shared Bible", ["characters", "props", "locations", "stylebible"].every(id => !r[id].locked), lockedIds(r));
  ok("C …while its own shots (per episode) still gate Shots/Storyboards", r.shots.locked && r.storyboard.locked);
  const bare = box.turnSeries.hydrateEpisode(episodeDoc, { ...showDoc, bible: { characters: [charU("mara")], locations: [], props: [], lookbook: [], lookbookNote: "", trash: { characters: [], locations: [], props: [] } } });
  const rb = L({ project: bare.project, characters: bare.characters, props: bare.props, locations: bare.locations, shots: [], lookbook: bare.lookbook, lookbookNote: bare.lookbookNote, scenes: SCENES });
  ok("C a show whose Bible has no look yet: the episode's Characters waits for the (shared) Lookbook", rb.characters.locked && rb.characters.unlockTab === "lookbook");
  const epConf = box.turnSeries.hydrateEpisode({ ...episodeDoc, project: { ...episodeDoc.project, noPropsConfirmed: true } },
    { ...showDoc, bible: { ...showDoc.bible, props: [] } });
  ok("C 'No props in this story' is per episode and survives hydration (episode project is kept)",
    epConf.project.noPropsConfirmed === true && !L({ ...epConf, lookbook: epConf.lookbook }).locations.locked);
  // the Show's shared "Recently deleted" bin rides the merge too: an episode can restore a
  // Show-wide location it deleted even with the shared list emptied
  const binShow = { ...showDoc, bible: { ...showDoc.bible, locations: [], trash: { characters: [], props: [], locations: [locD("warehouse")] } } };
  const epBin = box.turnSeries.hydrateEpisode(episodeDoc, binShow);
  const rBin = L({ project: epBin.project, characters: epBin.characters, props: epBin.props, locations: epBin.locations, shots: [], trash: epBin.trash,
    lookbook: epBin.lookbook, lookbookNote: epBin.lookbookNote, scenes: SCENES });
  ok("C the Show's shared bin (merged into the episode's trash) keeps the episode's Locations reachable",
    epBin.trash && epBin.trash.locations.length === 1 && !rBin.locations.locked, { trash: epBin.trash, loc: rBin.locations });
  ok("C App feeds the same merged state to the locks (the memo reads the live characters/props/locations/bin/lookbook)",
    app.includes("const artLockInputs = { project, characters, props, locations, shots, trash, lookbook, lookbookNote, scenes };"));
}

/* ── minimal React hook runner (useState/useRef/useEffect/useMemo) ───────── */
function mount(factorySrc, initialProps, ctx = box) {
  const slots = []; let cursor = 0, fx = [], props = { ...initialProps }, out = null, dirty = false, inPass = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((d, j) => Object.is(d, b[j]));
  const useEffect = (fn, deps) => {
    const i = cursor++; const prev = slots[i];
    if (prev && deps && prev.deps && same(deps, prev.deps)) return;
    slots[i] = { deps, cleanup: prev && prev.cleanup };
    fx.push(() => { const s = slots[i]; if (s.cleanup) s.cleanup(); const c = fn(); s.cleanup = typeof c === "function" ? c : null; });
  };
  const React = {
    useState(init) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { v: typeof init === "function" ? init() : init };
      const s = slots[i];
      return [s.v, v => { const nv = typeof v === "function" ? v(s.v) : v; if (Object.is(nv, s.v)) return; s.v = nv; schedule(); }];
    },
    useRef(init) { const i = cursor++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; },
    useMemo(fn, deps) {
      const i = cursor++; const prev = slots[i];
      if (prev && same(deps, prev.deps)) return prev.v;
      slots[i] = { deps, v: fn() }; return slots[i].v;
    },
    useEffect,
    useLayoutEffect: useEffect,
  };
  const Comp = vm.runInContext(factorySrc, ctx)(React);
  function flush() {
    inPass = true;
    try {
      let n = 0;
      do {
        dirty = false; cursor = 0; fx = [];
        out = Comp(props);
        const run = fx; fx = []; run.forEach(f => f());
        if (++n > 100) throw new Error("render loop");
      } while (dirty);
    } finally { inPass = false; }
  }
  function schedule() { dirty = true; if (!inPass) flush(); }
  flush();
  return { get out() { return out; }, update(patch) { props = { ...props, ...patch }; flush(); } };
}

/* ── D. App wiring: the real memo + the auto-seeds never run behind a lock ─ */
const memoSrc = between(app, "  const artTabLocksOf = (s)=>", "  // re-draft one department from the updated Lookbook");
const propsSeedSrc = between(app, "  // auto-seed once per story: when you first open the Art Room with an empty", "  /* INITIAL CHARACTER -> WORN PROP BOOTSTRAP");
const locsSeedSrc = between(app, "  // auto-seed once per story: first time the Locations tab opens empty", "  // LOCATION HIERARCHY SYNC");
const noPropsSrc = between(app, "  const setNoPropsConfirmed = (on)=>{", "  const addProp = ()=>{");
/* the argument object of one React.createElement(Head,{…}) call, by balanced braces (strings and
   comments skipped) — so a wiring check can't match a prop that belongs to a LATER call */
const callArgs = (src, head) => {
  const at = src.indexOf(head);
  if (at < 0) throw new Error("call not found: " + head);
  let i = src.indexOf("{", at + head.length), depth = 0, q = null;
  const from = i;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === "\\") i++; else if (ch === q) q = null; continue; }
    if (ch === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) break; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { q = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error("unbalanced call: " + head);
};
// a tiny window event bus for the memo's cache re-check
const listeners = {};
box.addEventListener = (t, f) => { (listeners[t] = listeners[t] || new Set()).add(f); };
box.removeEventListener = (t, f) => { if (listeners[t]) listeners[t].delete(f); };
const fire = t => [...(listeners[t] || [])].forEach(f => f({ type: t, detail: {} }));
{
  const seeded = { props: 0, locs: 0 };
  let renders = 0;
  box.castHasProps = cs => (cs || []).some(c => c && (c.accessories || c.props));
  const factory = `(function(React){ return function SeedHarness(p){
    if(p.onRender) p.onRender();
    const { room, artView, project, characters, props, locations, shots, trash, lookbook, lookbookNote, scenes, hydrationTick } = p;
    const hydratingRef = React.useRef(false);
    const [propsSeeded, setPropsSeeded] = React.useState(false);
    const [locsSeeded, setLocsSeeded] = React.useState(false);
    const seedPropsFromCast = p.seedProps, pullLocationsFromScript = p.pullLocs;
    ${memoSrc}
    ${propsSeedSrc}
    ${locsSeedSrc}
    return { artTabLocks, locked:artTabLocked, propsSeeded, locsSeeded };
  }; })`;
  const base = { room: "art", artView: "lookbook", project: { title: "x", format: "film" }, characters: [charU("mara", "Mara")].map(c => ({ ...c, accessories: "brass collar" })),
    props: [], locations: [], shots: [], trash: { characters: [], props: [], locations: [], shots: [] }, lookbook: [], lookbookNote: "", scenes: SCENES, hydrationTick: 1,
    seedProps: () => { seeded.props++; }, pullLocs: () => { seeded.locs++; }, onRender: () => { renders++; } };
  const h = mount(factory, base);
  ok("D the real memo computes the locks inside App", h.out.artTabLocks && h.out.artTabLocks.props && h.out.locked("props") === true && h.out.locked("lookbook") === false);
  h.update({ artView: "props" });
  ok("D a LOCKED Props tab never auto-seeds props from the cast (the lock would vanish on its own)", seeded.props === 0 && h.out.propsSeeded === false, seeded);
  h.update({ artView: "locations" });
  ok("D a LOCKED Locations tab never pulls locations from the script", seeded.locs === 0 && h.out.locsSeeded === false, seeded);
  // the cast gets drafted (Lookbook + specs) → Props unlocks → the seed runs on the open tab
  h.update({ artView: "props", lookbookNote: NOTE, characters: [{ ...charD("mara", "Mara"), accessories: "brass collar" }] });
  ok("D once Props unlocks, the seed runs as before", seeded.props === 1, seeded);
  // mark no props → Locations unlocks → the location pull runs
  h.update({ artView: "locations", project: { title: "x", format: "film", noPropsConfirmed: true } });
  ok("D once Locations unlocks, the location pull runs as before", seeded.locs === 1, seeded);
  const empty = mount(factory, { ...base, scenes: [] });
  ok("D no story yet → no locks at all (the Art Room shows its onboarding instead)", Object.keys(empty.out.artTabLocks).length === 0 && empty.out.locked("props") === false);
  // the Recently-deleted bin reaches the memo: emptying Locations keeps it open
  const binned = mount(factory, { ...base, lookbookNote: NOTE, characters: [charD("mara")], props: [propU("p1")], trash: { ...base.trash, locations: [locU("a")] } });
  ok("D the App memo passes the bin: a Locations tab emptied into its bin stays open", binned.out.locked("locations") === false && binned.out.locked("stylebible") === true);
  ok("D the memo re-computes on the doc it reads, the bin and the image re-check tick (its deps list)",
    memoSrc.includes("[project, characters, props, locations, shots, trash, lookbook, lookbookNote, scenes, artLockTick]);"));
  ok("D both seed effects re-check when the locks change", propsSeedSrc.includes("hydrationTick, artTabLocks]);") && locsSeedSrc.includes("hydrationTick, artTabLocks]);"));

  // IMAGES LAND LATE: a character sheet in the (cloud) image cache, a reference image dropped on a
  // Lookbook card — neither is in the doc, so the memo re-checks on the cache / slot events
  const sheetOnly = { ...base, characters: [charU("mara")], lookbook: [], lookbookNote: "" };
  box.nbGetImage = () => "";
  const img = mount(factory, sheetOnly);
  ok("D before the image cache fills, a sheet-only cast reads as empty (Characters locked)", img.out.locked("characters") === true);
  renders = 0;
  fire("nb-prefetched");
  ok("D a cache event that changes nothing re-renders nothing", renders === 0 && img.out.locked("characters") === true, renders);
  box.nbGetImage = id => (id === "mara" ? "https://cdn.example.test/mara.webp" : "");
  fire("nb-prefetched");
  ok("D nb-prefetched: once the sheet is in the cache, Characters opens (already built stays reachable)", img.out.locked("characters") === false && renders === 1, renders);
  box.nbGetImage = () => "";
  fire("nb-gen-done");
  ok("D nb-gen-done (a sheet cleared) re-checks too", img.out.locked("characters") === true);
  delete box.nbGetImage;
  const dropped = mount(factory, { ...base, characters: [charU("mara")], lookbook: [BLANK_CARD] });
  ok("D a blank Lookbook card: Characters locked", dropped.out.locked("characters") === true);
  box.imageSlotStored = id => (id === "lookref-look-blank" ? "data:image/webp;base64,UklGR" : null);
  fire("image-slot-change");
  ok("D image-slot-change: an image dropped on the card unlocks Characters without any doc change", dropped.out.locked("characters") === false);
  delete box.imageSlotStored;
  ok("D the re-check listens to exactly the cache + slot events", /const evs = \["nb-prefetched","nb-gen-done","image-slot-change"\];/.test(memoSrc));

  // wiring: each call's OWN argument object (a regex can't wander into the next call)
  const viewNavArgs = callArgs(app, "React.createElement(ViewNav,");
  const topBarArgs = callArgs(app, "React.createElement(TopBar,");
  const artRoomArgs = callArgs(app, "React.createElement(ArtRoom,");
  ok("D App hands the locks to the tab bar (ViewNav's own props)", /(^|[,{])tabLocks:artTabLocks[,}]/.test(viewNavArgs), viewNavArgs.slice(0, 200));
  ok("D App hands the locks + tab setter to the top bar (⋮)", /[\s,{]artTabLocks,hiddenArtTabs:\(typeof tabHidden==="function"\)/.test(topBarArgs) && /[,{]setArtView[,}]/.test(topBarArgs), topBarArgs.slice(0, 300));
  ok("D the call scanner returns each call's whole object (ends before the next createElement)",
    viewNavArgs.endsWith("}") && !/React\.createElement\(ArtRoom/.test(viewNavArgs) && topBarArgs.includes("onNewStory:startNewStory") && !/React\.createElement\(ViewNav/.test(topBarArgs));
  ok("D App hands the locks + the tab setter to the Art Room", /[,{]tabLocks:artTabLocks[,}]/.test(artRoomArgs) && /[,{]setArtView[,}]/.test(artRoomArgs));
  ok("D sensitivity: removing ViewNav's tabLocks is caught even though ArtRoom still has one",
    !/(^|[,{])tabLocks:artTabLocks[,}]/.test(callArgs(app.replace("attnTabs:{ characters: wardrobeAttn },tabLocks:artTabLocks,", "attnTabs:{ characters: wardrobeAttn },"), "React.createElement(ViewNav,")));
}
// D2 — the silent cast draft keeps working with the locks
{
  const nb = { console, Object, Array, String, Number, JSON, Math }; nb.window = nb; vm.createContext(nb);
  vm.runInContext(between(look, "function lookbookCardDrafted(c)", "window.lookbookHasLook = lookbookHasLook;") + "window.lookbookHasLook = lookbookHasLook;", nb);
  vm.runInContext(between(app, "function turnAgentRunsActive(runs){", "/* The reverse gate:"), nb);
  const drafted = c => !!(c.coreBody && c.wardrobeMask);
  const step = (extra) => nb.turnCastAutoDraftStep({ canWrite: true, room: "art", visualsSeeded: false, hydrating: false,
    characters: [charU("mara"), charD("tobias")], lookbook: [], lookbookNote: "", agentRuns: {}, draftingAll: false, tried: false, latched: false, drafted, ...extra });
  for (const [label, lk] of [["no look", { lookbook: [], lookbookNote: "" }], ["statement", { lookbookNote: NOTE }], ["card", { lookbook: [CARD] }], ["blank card", { lookbook: [BLANK_CARD] }]]) {
    const starts = step({ ...lk, artView: "characters" }) === "start";
    // judged on an undrafted cast, so Characters is open only by the look rule (not by content)
    const lookUnlocks = !L(film({ ...lk, characters: [charU("mara")] })).characters.locked;
    ok("D2 the look that unlocks Characters is the look that lets the silent draft start (" + label + ")", starts === lookUnlocks, { starts, lookUnlocks });
  }
  ok("D2 with a look, the silent draft starts on Characters (normally the first non-Lookbook tab)", step({ lookbookNote: NOTE, artView: "characters" }) === "start");
  ok("D2 …and still starts on a remembered LOCKED tab (Props), so the cast lands and Props unlocks", step({ lookbookNote: NOTE, artView: "props" }) === "start");
  ok("D2 …never on the Lookbook tab itself", step({ lookbookNote: NOTE, artView: "lookbook" }) === "wait");
}
// D3 — "No props in this story": set, clear, persist, merge, role scope
{
  const calls = [];
  let project = { title: "Pine Soot", logline: "A sweep finds a letter." };
  let can = true;
  const nb = { console };
  nb.window = nb; vm.createContext(nb);
  nb.setProject = f => { const nx = typeof f === "function" ? f(project) : f; calls.push(nx === project ? "same" : "new"); project = nx; };
  nb.canMutateSharedFilm = () => can;
  vm.runInContext("(function(){" + noPropsSrc + " window.setNoPropsConfirmed = setNoPropsConfirmed; })()", nb);
  nb.setNoPropsConfirmed(true);
  ok("D3 'No props in this story' sets project.noPropsConfirmed = true (other project fields kept)", project.noPropsConfirmed === true && project.logline === "A sweep finds a letter.");
  nb.setNoPropsConfirmed(true);
  ok("D3 setting it again is a no-op (same object → no save churn)", calls[calls.length - 1] === "same");
  nb.setNoPropsConfirmed(false);
  ok("D3 an art-writing role can clear it again — stored as false, never deleted (the key-wise merge carries the Undo)",
    project.noPropsConfirmed === false && Object.prototype.hasOwnProperty.call(project, "noPropsConfirmed"));
  can = false; const before = project;
  nb.setNoPropsConfirmed(true);
  ok("D3 a role that can't write the Art Room can't set it (canMutateSharedFilm gate)", project === before && project.noPropsConfirmed === false);
  ok("D3 App gives the button only to Art Room-writing roles", app.includes("noPropsConfirmed:!!(project && project.noPropsConfirmed),onSetNoProps:roomReadOnly?null:setNoPropsConfirmed,"));
  // persistence: the flag rides the saved doc's `project` section (local JSON save + cloud section save + applyDoc)
  const saveDoc = between(app, "    const doc = { scenes, characters, props, locations,", "\n");
  ok("D3 autosave writes `project` (where the mark lives) and adds no new top-level section", saveDoc.includes(" project,") && !/noPropsConfirmed/.test(saveDoc));
  ok("D3 applyDoc restores `project` whole", app.includes("setProject(d.project||(isAdmin?PROJECT:"));
  const saved = JSON.parse(JSON.stringify({ project: { title: "Pine Soot", noPropsConfirmed: true }, props: [], characters: [charD("mara")] }));
  ok("D3 a saved-and-reloaded film still has Locations unlocked", !L(film({ ...LOOK, ...saved })).locations.locked);
  // the cloud's key-wise project merge: an Art director's mark and a Writer's logline edit both survive
  const mb = { console }; mb.window = mb; vm.createContext(mb);
  vm.runInContext(between(cloud, "function _seriesJsonSame(a,b){", "function _seriesOwnSceneSlice") + between(cloud, "function _seriesMergeProjectObject(latest,incoming,baseline){", "/* COLLABORATIVE SECTION SAVE"), mb, { filename: "app/cloud.jsx" });
  const baseline = { title: "Pine Soot", logline: "old" };
  const writerSaved = { title: "Pine Soot", logline: "A sweep finds a letter." };
  const m1 = mb._seriesMergeProjectObject(writerSaved, { ...baseline, noPropsConfirmed: true }, baseline);
  ok("D3 cloud merge: the mark lands next to a collaborator's concurrent logline edit", m1.ok && m1.value.noPropsConfirmed === true && m1.value.logline === "A sweep finds a letter.", m1);
  const m2 = mb._seriesMergeProjectObject(m1.value, { ...m1.value, noPropsConfirmed: false }, m1.value);
  ok("D3 cloud merge: Undo (false) is applied like any other change", m2.ok && m2.value.noPropsConfirmed === false, m2);
  // role scope: `project` is an Art-director section on BOTH sides (client + server) — no new section to reject
  const tb = { console }; tb.window = tb; vm.createContext(tb);
  vm.runInContext(between(team, "const TEAM_ROLE_SECTIONS = {", "/* plain-language name for what a role may NOT touch")
    + "window.teamCanWriteSection = teamCanWriteSection; window.teamCanWriteRoom = teamCanWriteRoom;", tb, { filename: "app/team.jsx" });
  ok("D3 client role scope: owner + Art director save `project`; View-only does not",
    tb.teamCanWriteSection("owner", "project") && tb.teamCanWriteSection("art_director", "project") && !tb.teamCanWriteSection("view_only", "project"));
  ok("D3 a Writer can't reach the button: the Art Room is read-only for them", tb.teamCanWriteRoom("writer", "art") === false && tb.teamCanWriteRoom("art_director", "art") === true);
  const sql = read("supabase/enforce-role-scopes.sql");
  const artDir = between(sql, "when 'art_director' then", "else array");
  ok("D3 server role scope (read-only check): the database already lets an Art director write `project`", /'project'/.test(artDir) && !/noPropsConfirmed/.test(sql));
}

/* ── E. the tab bar and the phone ⋮ menu ─────────────────────────────────── */
const noop = () => {};
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) });
const textOf = n => typeof n === "string" || typeof n === "number" ? String(n) : (!n || typeof n !== "object") ? "" : (n.children || []).map(textOf).join("");
const findAll = (tree, pred) => { const out = []; const walk = n => { if (!n || typeof n !== "object") return; if (pred(n)) out.push(n); (n.children || []).forEach(walk); }; walk(tree); return out; };
const hasClass = c => n => String(n.props && n.props.className || "").split(/\s+/).includes(c);
const iconProxy = new Proxy({}, { get: (_, k) => { const f = () => null; f.iconName = String(k); return f; } });
{
  const cb = { console, React: { Fragment: "fragment", createElement: el, useState: i => [typeof i === "function" ? i() : i, noop], useEffect: noop, useRef: () => ({ current: null }) },
    Icon: iconProxy, document: { addEventListener: noop, removeEventListener: noop }, localStorage: { getItem: () => null, setItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop }, turnInfo: () => ({ flagged: false }) };
  cb.window = cb; vm.createContext(cb);
  vm.runInContext(chrome, cb, { filename: "app/chrome.jsx" });
  vm.runInContext(between(art, "const ART_TABS = [", "window.ART_TABS = ART_TABS;") + "window.ART_TABS = ART_TABS;", cb);
  const locks = L(film({ project: { title: "x", format: "documentary" }, characters: [charU("a")], lookbookNote: NOTE }));
  let picked = null;
  const tree = cb.ViewNav({ room: "art", view: "spine", setView: noop, artView: "props", setArtView: id => { picked = id; }, tabLocks: locks, onCoordinate: noop });
  const segs = findAll(tree, hasClass("seg"));
  const seg = id => segs.find(n => textOf(n) === ((cb.ART_TABS.find(t => t.id === id) || {}).label));
  ok("E every Art Room tab stays VISIBLE in the tab bar", segs.length === cb.ART_TABS.length, segs.map(textOf));
  const propsSeg = seg("props"), charSeg = seg("characters");
  ok("E a locked tab is marked (class + padlock) and names what it waits for",
    hasClass("locked")(propsSeg) && findAll(propsSeg, hasClass("seg-lock")).length === 1
    && propsSeg.props["aria-label"] === "Props (locked)" && /^Props \u2014 locked\. Waiting for every card in Characters \(Subjects\) to have a written spec/.test(propsSeg.props.title), propsSeg && propsSeg.props);
  ok("E the padlock is decorative for screen readers (the name already says locked)", findAll(propsSeg, hasClass("seg-lock"))[0].props["aria-hidden"] === "true");
  ok("E an unlocked tab has no lock", !hasClass("locked")(charSeg) && findAll(charSeg, hasClass("seg-lock")).length === 0 && charSeg.props["aria-label"] === undefined);
  ok("E the remembered locked tab is still the current page", propsSeg.props["aria-current"] === "page");
  seg("stylebible").props.onClick();
  ok("E clicking a locked tab still opens it (onto its lock card)", picked === "stylebible");
  ok("E a locked tab shows no stale / needs-you dot", (() => {
    const t2 = cb.ViewNav({ room: "art", view: "spine", setView: noop, artView: "lookbook", setArtView: noop, tabLocks: locks, staleTabs: { props: true }, attnTabs: { props: true }, onCoordinate: noop });
    const p = findAll(t2, hasClass("seg")).find(n => textOf(n) === "Props");
    return findAll(p, n => hasClass("seg-stale-dot")(n) || hasClass("seg-attn-dot")(n)).length === 0;
  })());
  ok("E the Writers' Room tabs never show locks", findAll(cb.ViewNav({ room: "writers", view: "spine", setView: noop, artView: "props", setArtView: noop, tabLocks: locks, onAgents: noop }), hasClass("locked")).length === 0);
  ok("E the ViewNav's Production check / Blender Studio buttons are still rendered", findAll(tree, n => n.props && n.props["aria-label"] === "Blender Studio").length === 1);

  // the phone ⋮ menu (open)
  cb.React.useState = () => [true, noop];
  let went = null;
  const menu = cb.OverflowMenu({ room: "art", onNewStory: noop, project: {}, scenes: [], drafts: {}, artView: "props", setArtView: id => { went = id; }, artTabLocks: locks, hiddenArtTabs: {} });
  cb.React.useState = i => [typeof i === "function" ? i() : i, noop];
  const group = findAll(menu, hasClass("export-art-tabs"))[0];
  ok("E the ⋮ menu lists the Art Room tabs as a labelled group", group && group.props.role === "group" && group.props["aria-label"] === "Art Room tabs");
  const items = findAll(group, n => n.type === "button");
  ok("E …every tab, by name", items.length === cb.ART_TABS.length && items.map(n => findAll(n, hasClass("t"))[0]).map(textOf).join() === cb.ART_TABS.map(t => t.label).join());
  const pItem = items.find(n => textOf(findAll(n, hasClass("t"))[0]) === "Props");
  ok("E a locked tab in the ⋮ menu wears the padlock and 'Locked · unlocks after …' (tab label + the format's name)",
    hasClass("is-locked")(pItem) && /Locked \u00b7 unlocks after Characters \(Subjects\)$/.test(textOf(pItem))
    && findAll(pItem, n => typeof n.type === "function" && n.type.iconName === "padlock").length === 1, textOf(pItem));
  const lbItem = items.find(n => textOf(findAll(n, hasClass("t"))[0]) === "Lookbook");
  ok("E an open tab in the ⋮ menu has no lock line", !hasClass("is-locked")(lbItem) && !/Locked/.test(textOf(lbItem)));
  const sbItem = items.find(n => textOf(findAll(n, hasClass("t"))[0]) === "Storyboards");
  ok("E a chained locked tab names the step it follows (not the far step its card's button opens)",
    /Locked \u00b7 unlocks after Shots$/.test(textOf(sbItem)) && locks.storyboard.unlockTab === "characters", textOf(sbItem));
  ok("E the current tab is marked in the ⋮ menu", pItem.props["aria-current"] === "page");
  pItem.props.onClick();
  ok("E choosing a locked tab in the ⋮ menu opens it", went === "props");
  ok("E the ⋮ tab list is absent outside the Art Room", findAll(cb.OverflowMenu({ room: "writers", onNewStory: noop, project: {}, scenes: [], drafts: {}, setArtView: noop, artTabLocks: locks }), hasClass("export-art-tabs")).length === 0);
  ok("E TopBar passes the locks through to the ⋮ menu",
    chrome.includes("React.createElement(OverflowMenu,{onNewStory,project,scenes,drafts,onReset,room,\n        artView,setArtView,artTabLocks,hiddenArtTabs}),")
    && /function TopBar\(\{[^}]*artView, setArtView, artTabLocks, hiddenArtTabs \}\)/.test(chrome));
  ok("E Icon.padlock exists (named apart from Icon.lock, which the API-key buttons probe)", /\n  padlock:\(p\)=>I\(/.test(icons) && !/\n  lock:\(p\)=>/.test(icons));
}

/* ── F. the lock card + ArtRoom ──────────────────────────────────────────── */
{
  const ab = { console, React: { Fragment: "fragment", createElement: el, useState: i => [typeof i === "function" ? i() : i, noop], useEffect: noop, useRef: () => ({ current: null }), createContext: () => ({ Provider: "Provider" }) },
    Icon: iconProxy, ArtReviewContext: { Provider: "ArtReviewProvider" }, NbDock: function NbDock() { return null; },
    CharacterSheets: function CharacterSheets() { return null; }, ArtComingSoon: function ArtComingSoon() { return null; } };
  ab.window = ab; vm.createContext(ab);
  vm.runInContext(between(art, "const ART_TABS = [", "window.ART_TABS = ART_TABS;") + "window.ART_TABS = ART_TABS;", ab);
  vm.runInContext(locksSrc, ab);   // TURN_ART_TAB_ORDER for the card's build-order list
  vm.runInContext(between(art, "function ArtTabLock({", "function ArtRoom("), ab, { filename: "app/artroom.jsx" });
  vm.runInContext(between(art, "function ArtRoom(", "window.ArtRoom = ArtRoom;") + "window.ArtRoom = ArtRoom;", ab, { filename: "app/artroom.jsx" });
  const fmtLocks = format => L(film({ project: { title: "x", format }, ...LOOK, characters: [charD("a"), charU("b")] }));
  let went = null;
  const card = ab.ArtTabLock({ tab: "props", locks: fmtLocks("documentary"), onGo: id => { went = id; } });
  const h2 = findAll(card, n => n.type === "h2")[0];
  ok("F the lock card is a labelled region: heading names the tab (tab label + format name) as locked",
    card.type === "section" && h2 && card.props["aria-labelledby"] === h2.props.id && textOf(h2) === "Props (Artifacts & Archive) is locked", card.props);
  ok("F …says what it waits for", findAll(card, n => n.type === "p").map(textOf).join() === "Waiting for every card in Characters (Subjects) to have a written spec (1 of 2 so far). Generated sheets aren't required.");
  const go = findAll(card, hasClass("art-lock-go"))[0];
  ok("F …with ONE primary button to the step that unlocks it", go && go.type === "button" && go.props.type === "button" && textOf(go) === "Go to Characters (Subjects)"
    && findAll(card, n => n.type === "button").length === 1);
  const focused = [];
  ab.setTimeout = f => f();
  ab.document = { querySelector: sel => (sel === '.viewnav .seg[aria-current="page"]' ? { focus: () => focused.push(sel) } : null) };
  go.props.onClick();
  ok("F the button opens that step", went === "characters");
  ok("F …and hands keyboard focus to the tab it opened (the card unmounts)", focused.length === 1);
  delete ab.document;
  const meter = findAll(card, hasClass("art-lock-meter"))[0];
  ok("F a counted wait shows an accessible progress bar", meter && meter.props.role === "progressbar" && meter.props["aria-valuenow"] === 1 && meter.props["aria-valuemax"] === 2);
  const steps = findAll(card, hasClass("art-lock-step"));
  ok("F the build order lists every step with its state (locked ones say so to screen readers)",
    steps.length === 7 && steps.map(textOf).join(" · ") === "Lookbook · Characters · Props (locked) · Locations (locked) · Color (locked) · Shots (locked) · Storyboards (locked)"
    && hasClass("is-current")(steps[2]) && steps[2].props["aria-current"] === "step", steps.map(textOf));
  const adCard = ab.ArtTabLock({ tab: "props", locks: fmtLocks("commercial"), onGo: noop });
  ok("F commercial copy: 'Props (Product & Props) is locked … Characters (Talent) … Go to Characters (Talent)'",
    textOf(findAll(adCard, n => n.type === "h2")[0]) === "Props (Product & Props) is locked" && /every card in Characters \(Talent\)/.test(textOf(adCard)) && /Go to Characters \(Talent\)/.test(textOf(adCard)));
  const colorCard = ab.ArtTabLock({ tab: "shots", locks: L(film({ ...LOOK, characters: [charD("a")], props: [propD("p")], locations: [locD("warehouse")] })), onGo: noop });
  ok("F Shots copy: waits for the Color tab's look, button 'Go to Color', no meter",
    /Shots is locked/.test(textOf(colorCard)) && /Waiting for the Color tab to have a look/.test(textOf(colorCard)) && /Go to Color/.test(textOf(colorCard)) && findAll(colorCard, hasClass("art-lock-meter")).length === 0);
  const lookCard = ab.ArtTabLock({ tab: "characters", locks: L(film({ project: { format: "documentary" }, characters: [charU("a")] })), onGo: noop });
  ok("F documentary Characters copy: 'Characters (Subjects) is locked … Go to Lookbook'", /^Characters \(Subjects\) is locked/.test(textOf(findAll(lookCard, n => n.type === "h2")[0])) && /Go to Lookbook/.test(textOf(lookCard)));
  // a CHAINED lock: the card names the locked step before it and its ONE button opens the first open step
  const freshLocks = L(film({ characters: [charU("a")] }));
  let wentChain = null;
  const chainCard = ab.ArtTabLock({ tab: "storyboard", locks: freshLocks, onGo: id => { wentChain = id; } });
  const chainGo = findAll(chainCard, hasClass("art-lock-go"))[0];
  ok("F a chained card: 'Waiting for Shots, which is still locked. Next step: …' with 'Go to Lookbook' (an OPEN tab)",
    /^Waiting for Shots, which is still locked\. Next step: give the Lookbook a look/.test(findAll(chainCard, n => n.type === "p").map(textOf).join())
    && textOf(chainGo) === "Go to Lookbook" && !freshLocks[freshLocks.storyboard.unlockTab].locked);
  ab.setTimeout = f => f(); ab.document = { querySelector: () => null };
  chainGo.props.onClick();
  delete ab.document;
  ok("F …and the button opens that open step in one hop", wentChain === "lookbook");

  // ArtRoom: a locked tab renders ONLY the lock card, outside the view-only inert boundary
  const baseProps = { artView: "props", setArtView: noop, project: { id: "f1", title: "x", format: "film" }, characters: [charU("a")], scenes: SCENES, props: [], drafts: {},
    locations: [], shots: [], lookbook: [], lookbookNote: "", trash: {}, sluglineUnits: [] };
  ab.PropSheets = function PropSheets() { return null; };
  const lockedLocks = L(film({ characters: [charU("a")] }));
  const room = ab.ArtRoom({ ...baseProps, tabLocks: lockedLocks, readOnly: false });
  const artDiv = findAll(room, hasClass("artroom"))[0];
  ok("F ArtRoom: a locked tab shows the lock card instead of the tab", findAll(room, n => n.type === ab.ArtTabLock).length === 1 && findAll(room, n => n.type === ab.PropSheets).length === 0);
  // the card's button is wired to the Art Room's REAL tab setter (not a no-op)
  const picks = [];
  const wired = ab.ArtRoom({ ...baseProps, setArtView: id => picks.push(id), tabLocks: lockedLocks, readOnly: false });
  const cardEl = findAll(wired, n => n.type === ab.ArtTabLock)[0];
  ok("F ArtRoom hands the lock card its tab, the locks and setArtView as onGo",
    cardEl && cardEl.props.tab === "props" && cardEl.props.locks === lockedLocks && typeof cardEl.props.onGo === "function");
  cardEl.props.onGo("lookbook");
  ok("F …so 'Go to …' really switches the Art Room tab", picks.join() === "lookbook", picks);
  ab.setTimeout = f => f(); ab.document = { querySelector: () => null };
  findAll(ab.ArtTabLock(cardEl.props), hasClass("art-lock-go"))[0].props.onClick();
  delete ab.document;
  ok("F …end to end: the rendered card's button calls the Art Room's setter with the unlock tab", picks.join() === "lookbook,lookbook", picks);
  ok("F ArtRoom: the engine dock stays mounted (tools wrapper)", findAll(room, hasClass("artroom-tools")).length === 1 && findAll(room, n => n.type === ab.NbDock).length === 1);
  const roRoom = ab.ArtRoom({ ...baseProps, tabLocks: lockedLocks, readOnly: true });
  const roDiv = findAll(roRoom, hasClass("artroom"))[0], roTools = findAll(roRoom, hasClass("artroom-tools"))[0];
  ok("F ArtRoom view-only + locked: the lock card is NOT inert (readable, its button works) while the tools are",
    roDiv.props.inert === undefined && roTools.props.inert === "" && roDiv.props["aria-disabled"] === undefined);
  const roOpen = ab.ArtRoom({ ...baseProps, artView: "props", tabLocks: L(film({ ...LOOK, characters: [charD("a")] })), readOnly: true });
  const roOpenDiv = findAll(roOpen, hasClass("artroom"))[0];
  ok("F ArtRoom view-only + open tab: the whole room stays inert exactly as before", roOpenDiv.props.inert === "" && roOpenDiv.props["aria-disabled"] === "true"
    && findAll(roOpen, hasClass("artroom-tools"))[0].props.inert === undefined && findAll(roOpen, n => n.type === ab.PropSheets).length === 1);
  // a remembered per-film tab (artViewByProject) that is locked reopens on its lock card
  const nav = { console, localStorage: { getItem: () => null, setItem: noop, removeItem: noop } }; nav.window = nav; vm.createContext(nav);
  vm.runInContext(between(app, "const NAV_KEY = ", "function turnFirstStoryScene("), nav, { filename: "app/app.jsx" });
  const remembered = nav.turnNavArtViewFor(nav.turnNavArtViewMap({ f1: { v: "props", n: 3 }, f2: { v: "shots", n: 2 } }), "f1");
  const back = ab.ArtRoom({ ...baseProps, artView: remembered, tabLocks: lockedLocks });
  ok("F a remembered LOCKED tab (per film) reopens on its lock card", remembered === "props"
    && findAll(back, n => n.type === ab.ArtTabLock && n.props.tab === "props").length === 1 && findAll(back, n => n.type === ab.PropSheets).length === 0);
  const unl = ab.ArtRoom({ ...baseProps, artView: "props", tabLocks: undefined });
  ok("F ArtRoom with no locks passed (older callers) renders the tab", findAll(unl, n => n.type === ab.PropSheets).length === 1);
  ok("F ArtRoom hands the mark + its setter to the Props tab", art.includes("castHasProps,onMergeProps,noPropsConfirmed,onSetNoProps,"));
  ok("F ArtRoom skips preloading a locked tab's images", art.includes("if(lockedView) return [];"));
  ok("F Blender Studio host stays mounted on every tab (always open)", findAll(room, hasClass("artroom-tools"))[0] && art.includes("// Blender Studio is always open"));
}

/* ── G. Props tab: "No props in this story" ──────────────────────────────── */
{
  const pb = { console, Object, Array, String, Number, JSON, Math, Set, Map, React: null, Icon: iconProxy, document: { querySelector: () => null },
    requestAnimationFrame: noop, setTimeout: noop, performance: { now: () => 0 } };
  pb.window = pb; vm.createContext(pb);
  pb.React = { Fragment: "fragment", createElement: el, useState: i => [typeof i === "function" ? i() : i, noop], useEffect: noop, useRef: i => ({ current: i === undefined ? null : i }), useMemo: f => f(), useCallback: f => f };
  vm.runInContext(formats, pb);
  vm.runInContext(locksSrc, pb);
  Object.assign(pb, {
    useBatchGen: () => ({ activeId: null, advance: noop, setMsg: noop, begin: noop }), usePager: () => ({ slice: a => a }), scenesInStoryOrder: s => s || [],
    searchWordMatch: () => true, propHeadNoun: () => "", PropScreenplay: { characterScenes: () => [], group: () => "story", notInScreenplay: () => false, sheetTier: () => ({ tier: "own" }), nameIssue: () => "" },
    ImageLightbox: "ImageLightbox", NbKeyBar: "NbKeyBar", NbControls: "NbControls", BatchBar: null, PagerBar: "PagerBar", PropSheet: "PropSheet", PropExtractionReview: "PropExtractionReview",
  });
  vm.runInContext(between(propsSrc, "function propVisualsDrafted(p){", "/* A prop that rides as TEXT"), pb);
  vm.runInContext(between(propsSrc, "function PropSheets({", "window.PropSheets = PropSheets;") + "window.PropSheets = PropSheets;", pb, { filename: "app/props.jsx" });
  const render = extra => pb.PropSheets({ project: { title: "x", format: "film" }, props: [], characters: [], scenes: SCENES, drafts: {}, onUpdate: noop, onDraftAll: noop, onAdd: noop, castHasProps: false, ...extra });
  let set = [];
  const open = render({ noPropsConfirmed: false, onSetNoProps: v => set.push(v) });
  const btn = findAll(open, n => n.type === "button" && textOf(n) === "No props in this story")[0];
  ok("G zero props: the empty Props tab offers 'No props in this story'", !!btn && btn.props.type === "button" && /Locations tab unlocks/.test(btn.props.title));
  btn.props.onClick();
  ok("G …which sets the mark", set.join() === "true");
  const done = render({ noPropsConfirmed: true, onSetNoProps: v => set.push(v) });
  const status = findAll(done, hasClass("prop-noprops"))[0];
  ok("G confirmed: a status line says Locations is unlocked, with Undo", status && status.props.role === "status" && /Marked \u201cNo props in this story\u201d \u2014 Locations is unlocked\./.test(textOf(status))
    && findAll(done, n => n.type === "button" && textOf(n) === "No props in this story").length === 0);
  findAll(status, n => n.type === "button" && textOf(n) === "Undo")[0].props.onClick();
  ok("G Undo clears it", set.join() === "true,false");
  const ro = render({ noPropsConfirmed: true, onSetNoProps: null });
  ok("G a read-only role sees the mark but gets no button and no Undo",
    findAll(ro, hasClass("prop-noprops")).length === 1 && findAll(ro, n => n.type === "button" && /^(Undo|No props in this story)$/.test(textOf(n))).length === 0);
  ok("G a read-only role never gets the confirm button", findAll(render({ noPropsConfirmed: false, onSetNoProps: null }), n => n.type === "button" && textOf(n) === "No props in this story").length === 0);
  const withProps = pb.PropSheets({ project: { title: "x" }, props: [propD("p1")], characters: [], scenes: SCENES, drafts: {}, onUpdate: noop, onDraftAll: noop, onAdd: noop, noPropsConfirmed: false, onSetNoProps: noop });
  ok("G with props on the tab there is no 'No props' button", findAll(withProps, n => n.type === "button" && textOf(n) === "No props in this story").length === 0);
}

/* ── H. styles: light/dark tokens, keyboard focus, phone width ───────────── */
{
  const block = between(css, "/* ── Art Room TAB LOCKS", "\n}\n") + "\n}";
  ok("H the tab-lock CSS uses theme tokens only (light + dark follow the theme)", !/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i.test(block.replace(/\/\*[\s\S]*?\*\//g, "")), block.match(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i));
  ok("H locked tabs are muted and carry the padlock", /\.seg\.locked\{color:var\(--txt-3\)\}/.test(block) && /\.seg-lock\{/.test(block));
  ok("H keyboard focus is visible on tabs and the lock card button", /\.seg:focus-visible\{outline:2px solid/.test(block) && /\.art-lock-go:focus-visible\{outline:2px solid/.test(block));
  ok("H the ⋮ tab list is phone-only", /\.export-art-tabs\{display:none\}/.test(block) && /@media \(max-width:700px\)\{[^}]*\.export-art-tabs\{display:block\}/.test(block));
  ok("H phone width: the lock card keeps a 16px gutter, wraps, and the button is a 44px target",
    /\.art-lock\{[^}]*padding:40px 16px/.test(block) && /\.art-lock\{padding:28px 16px/.test(block) && /\.art-lock-go\{min-height:44px\}/.test(block)
    && /\.art-lock-order\{[^}]*flex-wrap:wrap/.test(block) && /overflow-wrap:anywhere/.test(block));
  ok("H the tools wrapper adds no box (layout unchanged)", /\.artroom-tools\{display:contents\}/.test(block));
  ok("H an sr-only helper exists for the '(locked)' step text", /\.sr-only\{position:absolute;width:1px;height:1px/.test(block));
}

/* ── I. the build: psychology check, then the continuity ledger, and it stops ─ */
{
  const build = between(agents, "async function agentAdaptation", "async function agentTableRead");
  ok("I the Adaptation build no longer calls the cast visual bible", !/aiCastVisualBible/.test(build) && !/visual bible/i.test(build));
  ok("I no 'Character sheets are ready' claim anywhere in the agents", !/Character sheets are ready/.test(agents) && !/arrive pre-filled/.test(agents));
  // RUN it: a stubbed model, the real agent
  const runBuild = async (source, opts = {}) => {
    const trace = [], visual = [];
    const b = { console, Promise, Object, Array, String, Number, Math, JSON, Set, Map, Date, setTimeout, clearTimeout };
    b.window = b; vm.createContext(b);
    b.chargeStr = v => String(v);
    b.aiCastPsychology = async (cast, scenes, P, o) => Object.fromEntries(cast.map(c => [c.id, o && o.mode === "reconcile" ? { arc: "revised" } : { conscious: "want", unconscious: "need" }]));
    b.aiCastVisualBible = async cast => { visual.push(cast.map(c => c.id)); return Object.fromEntries(cast.map(c => [c.id, { coreBody: "drafted body", wardrobeMask: "drafted wardrobe", palette: ["a", "b", "c"] }])); };
    // the REAL deterministic sheet placeholders the build still applies (artroom.jsx)
    vm.runInContext(between(opts.artSrc || art, "function paletteFromGradient(g){", "/* resolve a visual field with legacy fallback"), b, { filename: "app/artroom.jsx" });
    vm.runInContext(source, b, { filename: "app/agents.jsx" });
    const ledger = [];
    const ctx = {
      input: "A chimney sweep's apprentice finds a letter in the soot.", project: { title: "Untitled", format: "film" },
      model: opts.model || { scenes: [], beats: {}, drafts: {}, characters: [], project: {} },
      ai: { available: true,
        buildSpine: async () => ({ title: "Pine Soot", scenes: [0, 1, 2].map(i => ({ act: i + 1, title: "Scene " + i, loc: "INT. ATTIC - NIGHT", summary: "s", driver: "mara", openValue: "+", openCharge: -1, closeValue: "-", closeCharge: 2 })) }),
        buildStoryWorld: async () => ({ genre: "gothic", premise: "p", controllingIdea: { value: "v" }, setting: { period: "1890s" }, cast: [{ id: "mara", name: "Mara", role: "Protagonist" }, { id: "ivo", name: "Ivo", role: "Supporting" }] }),
        authorScene: async () => ({ patch: {}, beats: { rows: [{ n: 1, action: "a" }] } }),
        draftScene: async () => ({ blocks: [{ type: "action", text: "Soot falls." }] }),
        continuityLedger: async () => { ledger.push(1); return { map: {}, facts: { f1: { label: "the letter" } }, ledger: { built: 1 } }; } },
      propose: async () => true, emit: e => trace.push(e), sync: noop, cancelled: () => false,
    };
    await b.agentAdaptation(ctx);
    return { trace, visual, ctx, ledger, charDrafted: c => box.charVisualsDrafted(c) };
  };
  const run = await runBuild(agents);
  const acts = run.trace.filter(e => e.k === "act").map(e => e.t);
  const done = run.trace.filter(e => e.k === "done");
  ok("I the real build never drafts the cast's look", run.visual.length === 0, run.visual);
  ok("I the build ran the psychology check and the continuity ledger", acts.some(t => /Checking the cast's psychology against the choices the script shows/.test(t)) && acts.some(t => /Mapping continuity/.test(t)) && run.ledger.length === 1, acts);
  const iPsych = acts.findIndex(t => /Checking the cast's psychology against the choices the script shows/.test(t));
  const iLedger = acts.findIndex(t => /Mapping continuity/.test(t));
  ok("I the doc's order: the psychology check against the script, THEN the continuity ledger", iPsych >= 0 && iLedger > iPsych, { iPsych, iLedger, acts });
  ok("I the build stops there: the continuity ledger is the LAST step, then 'done'", iLedger === acts.length - 1 && run.trace[run.trace.length - 1].k === "done", acts.slice(-2));
  ok("I source order matches (the ledger call follows the psychology check's block, before the stop comment)",
    (b => b.indexOf("CHECK THE PSYCHOLOGY AGAINST THE SCRIPT") < b.lastIndexOf("await buildContinuityLedgerStep(ctx);")
      && b.lastIndexOf("await buildContinuityLedgerStep(ctx);") < b.indexOf("THE BUILD STOPS HERE"))(between(agents, "async function agentAdaptation", "async function agentTableRead")));
  ok("I exactly one 'done', and it claims no character sheets", done.length === 1 && !/character sheet|sheets are ready|visual bible/i.test(done[0].t), done);
  ok("I the 'done' message points to the Lookbook for the cast's look", /Pre-production starts in the Art Room with the Lookbook \u2014 the cast\u2019s look is designed from it\./.test(done[0].t), done[0] && done[0].t);
  ok("I no trace line mentions a visual bible or ready sheets", !run.trace.some(e => /visual bible|sheets are ready|Character sheets/i.test(e.t)), run.trace.map(e => e.t));
  const cast = run.ctx.model.characters;
  ok("I the built cast has its inner life but NO written visual spec", cast.length === 2 && cast.every(c => c.arc === "revised") && cast.every(c => !run.charDrafted(c)), cast);
  ok("I the build's deterministic sheet placeholders DID run (scale, height, negative prompt, palette swatches)…",
    cast.every(c => c.scaleClass && c.height && c.negativePrompt && Array.isArray(c.palette) && c.palette.length === 3), cast[0]);
  ok("I …and they are not a look: no Body, wardrobe or sheet prompt", cast.every(c => !c.coreBody && !c.wardrobeMask && !c.look && !c.wardrobe && !c.masterPrompt && !c.wardrobePrivate), cast[0]);
  const lookDefaults = art.replace("  return {\n    scaleClass: c.scaleClass", "  return {\n    coreBody: \"drafted body\", wardrobeMask: \"drafted wardrobe\",\n    scaleClass: c.scaleClass");
  const withLook = await runBuild(agents, { artSrc: lookDefaults });
  ok("I sensitivity: if the placeholders ever wrote a look, the 'NO written visual spec' check would fail",
    lookDefaults !== art && withLook.ctx.model.characters.length === 2 && withLook.ctx.model.characters.every(c => withLook.charDrafted(c)), withLook.ctx.model.characters[0]);
  ok("I …so right after a build, Props and everything after it is locked (and Characters waits for the Lookbook)",
    (r => r.characters.locked && r.props.locked && r.locations.locked)(L(film({ characters: cast }))));
  // "finish what exists" path: no cast visual step either
  const partial = { scenes: [{ id: "a", no: 1, title: "A" }, { id: "b", no: 2, title: "B" }], beats: {}, drafts: { a: { blocks: [{ type: "action", text: "x" }] } }, characters: [{ id: "mara", name: "Mara" }], project: {} };
  const fin = await runBuild(agents, { model: partial });
  ok("I 'finish the unwritten scenes' never drafts the cast's look", fin.visual.length === 0 && fin.trace.filter(e => e.k === "done").length === 1);
  // sensitivity: put the removed step back — the harness sees it
  const legacyStep = `
  if(ctx.ai.available && typeof window.aiCastVisualBible==="function" && ctx.model.characters && ctx.model.characters.length){
    ctx.emit({k:"act", t:"Designing the cast's visual bible for The Art Room \\u2014 look, wardrobe, palette\\u2026"});
    try{ const bible = await window.aiCastVisualBible(ctx.model.characters, ctx.model.scenes, ctx.model.project);
      if(bible){ ctx.model.characters = ctx.model.characters.map(c=> bible[c.id] ? {...c, ...bible[c.id]} : c);
        ctx.emit({k:"ok", t:"Character sheets are ready in The Art Room \\u2014 body, two wardrobe states, palette and a master grid prompt each."}); } }catch(e){}
  }
  ctx.emit({k:"done", t: r.failures.length`;
  const marker = "  ctx.emit({k:\"done\", t: r.failures.length\n    ? ('\\u201c'+spine.title";
  ok("I sensitivity: the done marker is found once in the build", agents.split(marker).length === 2);
  const legacy = await runBuild(agents.replace(marker, legacyStep + "\n    ? ('\\u201c'+spine.title"));
  ok("I sensitivity: with the old step restored the harness catches the visual draft + the sheets claim",
    legacy.visual.length === 1 && legacy.trace.some(e => /Character sheets are ready/.test(e.t)) && legacy.ctx.model.characters.every(c => legacy.charDrafted(c)), legacy.visual);
  ok("I the build's deterministic sheet defaults are labelled as not a drafted look", agents.includes("deterministic placeholders only"));
  ok("I Run pre-production is unchanged: the agents never read the tab locks", !/turnArtTabLocks|tabLocks|artTabLocked/.test(agents)
    && /then the CAST, then the PROPS/.test(agents));
}

/* ── J. MUSE product knowledge (APP_FEATURES after its replace chain) ───── */
{
  const src = between(ai, "const APP_FEATURES = [", "function appBrief(){");
  const fbox = { console }; fbox.window = fbox; vm.createContext(fbox);
  vm.runInContext(src + "\n;this.__F = APP_FEATURES;", fbox, { filename: "app/ai.jsx" });
  const F = fbox.__F;
  const locks = (F.find(f => /Art Room tab locks/.test(f.name)) || {}).what || "";
  const arr = (F.find(f => f.name === "Art Room") || {}).what || "";
  const cs = (F.find(f => f.name === "Character Sheets (Art Room)") || {}).what || "";
  const all = F.map(f => f.what).join("\n");
  ok("J MUSE has a tab-locks entry", locks.length > 500);
  ok("J MUSE: 'why is Props locked?' — every character needs a written spec, sheets not required, the card counts and links to Characters",
    /PROPS \u2014 once EVERY character has a written spec/.test(locks) && /generated sheets are NOT required/.test(locks) && /'why is Props locked\?'/.test(locks) && /'Go to Characters'/.test(locks));
  ok("J MUSE: every rule is described", /LOOKBOOK \u2014 always open/.test(locks) && /CHARACTERS \u2014 once the Lookbook has a look/.test(locks)
    && /LOCATIONS \u2014 once every prop has a written spec, or, when the story has NO props at all, once you press 'No props in this story'/.test(locks)
    && /COLOR \u2014 once every location has a written spec/.test(locks) && /SHOTS \u2014 once the Color tab has a look/.test(locks)
    && /STORYBOARDS \u2014 once shot coverage exists/.test(locks) && /BREAKDOWN, PRODUCTION CHECK and BLENDER STUDIO are always open/.test(locks));
  ok("J MUSE: nothing-to-do steps (once reached), already-built content, format names, series, Run pre-production, the phone ⋮",
    /no characters at all \u2192 Props opens as soon as the Lookbook has a look/.test(locks) && /a tab that already has content is NEVER locked/.test(locks)
    && /'Characters \(Subjects\)'/.test(locks) && /'Props \(Artifacts & Archive\)'/.test(locks) && /'Characters \(Talent\)'/.test(locks) && /'Props \(Product & Props\)'/.test(locks)
    && /TV SERIES EPISODE unlocks from the Show's shared Bible/.test(locks) && /RUN PRE-PRODUCTION is unchanged/.test(locks) && /\u22ee menu lists the Art Room tabs/.test(locks));
  ok("J MUSE: the chain — a locked step before it, and the button goes to the FIRST OPEN step",
    /THE STEPS ARE A CHAIN/.test(locks) && /FIRST OPEN step you can act on/.test(locks) && /on a fresh film every locked tab points to the Lookbook/.test(locks));
  ok("J MUSE: 'Recently deleted' bins and the 'No props' mark keep their tab open",
    /anything in that tab's 'Recently deleted' bin/.test(locks) && /the 'No props in this story' mark keeps Props open \(so its Undo is always reachable\)/.test(locks));
  ok("J MUSE: why Props can open early — the worn-prop bootstrap is named as the one exception (no false 'nothing is auto-created' claim)",
    /ONE EXCEPTION, on purpose: when a character's FIRST sheet is generated, that character's worn props are built in the background/.test(locks)
    && /that is why Props can open early/.test(locks) && !/Nothing is auto-created behind a locked tab/.test(all));
  ok("J MUSE: the per-episode 'No props' mark is stated plainly", /'No props in this story' is saved with each EPISODE \(not the Show\)/.test(locks));
  ok("J MUSE: the build no longer drafts the cast's look (tab-locks entry + Art Room entry)",
    /THE STORY BUILD NO LONGER DRAFTS THE CAST'S LOOK/.test(locks) && /STORY BUILD NO LONGER DRAFTS THE CAST'S LOOK/.test(arr)
    && /stops after the psychology check and the continuity ledger/.test(arr));
  ok("J MUSE: the old claim that the build drafts every character's spec is gone",
    !/the build itself already drafts every character's spec/.test(all) && !/Character sheets are ready in The Art Room/.test(all));
  ok("J MUSE Art Room: the tabs unlock in order and the empty-Lookbook Characters tab is locked",
    /The tabs UNLOCK IN THAT ORDER/.test(arr) && /the Characters tab is LOCKED until the Lookbook has a look/.test(arr));
  ok("J MUSE Character Sheets: the empty-Lookbook sentence follows the lock (replace chain intact)",
    /the Characters tab stays locked until the Lookbook has a look/.test(cs) && /The story build does not draft the cast's look/.test(cs)
    && /The cast is auto-drafted once the Lookbook has a look \(a visual statement or a reference card\), the first time you open an Art Room tab other than the Lookbook — never while an agent is running/.test(cs));
  ok("J MUSE never names the method's source or the model maker in the new text", !/McKee|Claude|Anthropic/.test(locks));
}

/* ── L. image-slot.js: a Lookbook drop is readable from any tab ─────────── */
{
  const events = [];
  const sb = { console, Promise, Object, JSON, Set, setTimeout,
    fetch: () => Promise.resolve({ ok: false }),
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } } };
  sb.window = sb; sb.dispatchEvent = e => events.push(e);
  vm.createContext(sb);
  const store = "(function(){ const STATE_FILE = '.image-slots.state.json';\n" + between(slotSrc, "  const subs = new Set();", "  // ── Image downscale")
    + "\n window.__setSlot = setSlot; window.__load = load; })()";
  vm.runInContext(store, sb, { filename: "app/image-slot.js" });
  ok("L the slot store exposes a read-only getter", typeof sb.imageSlotStored === "function" && sb.imageSlotStored("lookref-x") === null);
  sb.__setSlot("lookref-look-blank", { u: "data:image/webp;base64,UklGR", s: 1, x: 0, y: 0 });
  ok("L a drop is readable by id without its element", sb.imageSlotStored("lookref-look-blank") === "data:image/webp;base64,UklGR");
  ok("L …and announced with image-slot-change (App's lock re-check listens)", events.some(e => e.type === "image-slot-change" && e.detail && e.detail.id === "lookref-look-blank"), events);
  // the real lookbook predicate reads it: the lock opens from the Characters tab
  box.imageSlotStored = sb.imageSlotStored;
  ok("L the real lookbookHasLook sees the stored drop → Characters unlocks", !L(film({ characters: [charU("m")], lookbook: [BLANK_CARD] })).characters.locked);
  const n = events.length;
  sb.__setSlot("lookref-look-blank", null);
  ok("L clearing the drop is announced and the card is empty again",
    events.length > n && sb.imageSlotStored("lookref-look-blank") === null && L(film({ characters: [charU("m")], lookbook: [BLANK_CARD] })).characters.locked);
  sb.__setSlot("lookref-look-blank", "data:image/png;base64,iVBOR");
  ok("L a legacy bare data-URL slot value reads too", sb.imageSlotStored("lookref-look-blank") === "data:image/png;base64,iVBOR");
  delete box.imageSlotStored;
  await tick(); await tick();
  ok("L the sidecar load completing is announced too (id null)", events.some(e => e.type === "image-slot-change" && e.detail && e.detail.id === null));
  ok("L lookbook.jsx reads the store (data URLs only) behind the element read", /window\.imageSlotStored\("lookref-"\+c\.id\)/.test(look) && /stored\.startsWith\("data:image\/"\)/.test(look));
}

/* ── K. the pipeline doc this implements, parse + cache keys ─────────────── */
{
  ok("K the owner-approved doc blocks are the ones implemented", doc.includes("**The tabs unlock in that order** *(2026-09-27, owner-approved)*")
    && doc.includes("The build\nstops there *(2026-09-27, owner-approved)*: it does **not** draft the cast's visual look"));
  const babel = await import("@babel/core");
  const presetReact = (await import("@babel/preset-react")).default;
  for (const f of ["app/app.jsx", "app/artroom.jsx", "app/chrome.jsx", "app/props.jsx", "app/ai.jsx", "app/agents.jsx", "app/icons.jsx", "app/lookbook.jsx"]) {
    let error = null;
    try { babel.parseSync(read(f), { filename: ROOT + f, presets: [presetReact], babelrc: false, configFile: false }); } catch (e) { error = String(e.message).split("\n")[0]; }
    ok("K parse: " + f + " is valid JSX/JS", !error, error);
  }
  for (const [f, src] of [["app/art-tab-locks.js", locksSrc], ["app/image-slot.js", slotSrc]]) {
    let perr = null; try { new vm.Script(src); } catch (e) { perr = e.message; }
    ok("K parse: " + f + " is valid JS", !perr, perr);
  }
  const key = f => (html.match(new RegExp(f.replace(/\./g, "\\.") + "\\?v=([^\"']+)")) || [])[1] || "";
  // the first pass's files (styles + icons unchanged since) keep its key; every file the review pass
  // changed carries the review key
  // a later change's key also counts (the Admin Storage merge re-keyed styles.css and ai.jsx;
  // the screenplay format-check fix re-keyed app.jsx, ai.jsx and agents.jsx, twice; the episode-build
  // fix re-keyed app.jsx, ai.jsx, agents.jsx and props.jsx; the rough stand-in fix re-keyed ai.jsx
  // and agents.jsx, with script.jsx on ai.jsx's key; the screen-time-per-scene fix re-keyed
  // app.jsx and ai.jsx, with script.jsx on ai.jsx's key; the page-forms fix re-keyed ai.jsx,
  // with script.jsx on ai.jsx's key; the review fixes to those four re-keyed app.jsx, ai.jsx and
  // agents.jsx, with script.jsx on ai.jsx's key; the Writers' Room Round 1 fixes of 2026-09-28
  // re-keyed styles.css, app.jsx, chrome.jsx, ai.jsx and agents.jsx, among others)
  const LATER = ["20260927-merge1", "20260927-dock1", "20260927-spcheck1", "20260927-spcheck2", "20260927-epbuild1", "20260927-standin1", "20260927-screentime1", "20260927-pageforms1", "20260927-review1", "20260928-dock2", "20260928-round1", "20260928-brand1", "20260928-brand2", "20260929-look1", "20260929-look2", "20260929-look3", "20260929-look4", "20260930-portal1", "20260930-billing1", "20261001-tax1", "20261002-consent1", "20261002-tip1", "20261002-btn1", "20261002-team1", "20261002-scene1", "20261002-research1", "20261002-research2"];   // …and Manage plan (2026-09-30) re-keyed styles.css and ai.jsx — and the billing fixes (2026-09-30) re-keyed styles.css, app.jsx and ai.jsx — and the consumer-rights / tax change (2026-10-01) re-keyed styles.css and ai.jsx — and the 14-day note by the purchase buttons (2026-10-02) re-keyed styles.css and ai.jsx — and the note behind an ⓘ (2026-10-02) re-keyed styles.css and ai.jsx — and Team "Coming soon" (2026-10-02) re-keyed styles.css, app.jsx, chrome.jsx and ai.jsx: 20261002-team1
  for (const f of ["app/icons.jsx", "app/styles.css"])
    ok("K cache key bumped: " + f, key(f) === "20260927-tablocks1" || LATER.includes(key(f)), key(f));
  for (const f of ["app/app.jsx", "app/artroom.jsx", "app/chrome.jsx", "app/props.jsx", "app/ai.jsx", "app/agents.jsx", "app/art-tab-locks.js", "app/lookbook.jsx", "app/image-slot.js"])
    ok("K cache key bumped (review pass): " + f, key(f) === "20260927-tablocks2" || LATER.includes(key(f)), key(f));
  const at = html.indexOf('src="app/art-tab-locks.js'), ar = html.indexOf('src="app/artroom.jsx');
  ok("K art-tab-locks.js is a plain script loaded before the Art Room", at > 0 && at < ar && !/type="text\/babel" src="app\/art-tab-locks/.test(html));
}

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
