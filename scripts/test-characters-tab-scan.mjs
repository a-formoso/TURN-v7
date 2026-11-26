#!/usr/bin/env node
/* The Characters tab, easier to scan (owner 2026-11-17: "yes, go ahead with all of them in that order"), and the
   Likeness title on one line ("no line break; if you have to use initials for names, please do so").

   1 The last QA result is kept with the image it judged (its own meta, this exact version) and shown on the button;
     the report opens again for free, with "Check again" inside.
   2 The Art Room folds its heading on scroll at every size.
   3 One "More" menu over the cards for the rarely pressed buttons (a single one stays a button).
   4 The card in four rows (scripts/test-character-card-sections.mjs pins the sections and their groups).
   6 The bare numbers say what they count.
   7 The cast at a glance: a row of faces over the cards.
   L The Likeness title: the full name when it fits, else the first name and initials, else initials.

     node scripts/test-characters-tab-scan.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 4).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };
const plain = (v) => JSON.parse(JSON.stringify(v));

const art = read("app/artroom.jsx"), img = read("app/imagegen.jsx"), cloud = read("app/cloud.jsx"), cameo = read("app/cameo.jsx");
const app = read("app/app.jsx"), css = read("app/styles.css"), ai = read("app/ai.jsx"), html = read("TURN.html");

/* the small helpers, run for real */
const box = { console, Date, JSON, Number, String, Math, Object, Array };
box.window = box; vm.createContext(box);
vm.runInContext(between(art, "function qaKept(gen){", "window.qaKept = qaKept;"), box);
vm.runInContext(between(cameo, "function cameoNameForms(name){", "function CameoTitle("), box);
vm.runInContext(between(art, "function castFirstName(name){", "function CastOverview("), box);

await test("1a a kept result belongs to one image version: the same version shows it, another does not", () => {
  const report = { verdict: "minor", deviations: [{ what: "a" }, { what: "b" }], inventions: ["c"], script: { mismatches: [{}] } };
  const gen = (iso, qa) => ({ genMeta: { iso, ...(qa ? { qa } : {}) } });
  assert.equal(box.qaKept(gen("v1", { iso: "v1", at: 5, report })).at, 5);
  assert.equal(box.qaKept(gen("v2", { iso: "v1", at: 5, report })), null, "a regenerated, edited or restored image has no result of its own");
  assert.equal(box.qaKept(gen("v1")), null); assert.equal(box.qaKept({ genMeta: null }), null); assert.equal(box.qaKept(null), null);
  assert.equal(box.qaKept(gen("", { iso: "", report })), null, "an image with no version (an upload) keeps nothing");
  assert.equal(box.qaKept(gen("v1", { iso: "v1", report: "x" })), null);
});

await test("1b the button's words: the verdict and how many findings (deviations, inventions and script mismatches)", () => {
  assert.equal(box.qaBadgeText({ verdict: "minor", deviations: [{}, {}], inventions: ["x"], script: { mismatches: [{}] } }), "Minor drift · 4");
  assert.equal(box.qaBadgeText({ verdict: "major", deviations: [{}], inventions: [] }), "Major drift · 1");
  assert.equal(box.qaBadgeText({ verdict: "pass", deviations: [], inventions: [] }), "Faithful");
  assert.equal(box.qaFindingCount(null), 0);
  assert.equal(box.qaCheckedOn(0), ""); assert.match(box.qaCheckedOn(Date.UTC(2026, 10, 17, 12, 0)), /^Checked on .+\.$/);
});

await test("1c it is saved on the image's own meta, for that version only, on this device and in the cloud; nothing is charged", () => {
  const fn = between(img, "function nbSetAssetQa(id, expectedIso, qa){", "window.nbSetAssetQa=nbSetAssetQa;");
  assert.ok(fn.includes("const note={...qa,iso:expectedIso};"));
  assert.ok(fn.includes('if(!current || current.iso!==expectedIso) return {ok:false,error:"asset version changed"};'), "never onto another version");
  assert.ok(fn.includes("const meta={...current,qa:note};") && fn.includes('new CustomEvent("nb-meta-changed",{detail:{id}})'), "the card hears it");
  assert.ok(fn.includes("window.cloudSetAssetQa(scope,uid,id,expectedIso,note)"));
  assert.ok(!/nbGenerate|hold|credit/i.test(fn), "no image is made and nothing is spent");
  const c = between(cloud, "async function cloudSetAssetQa(", "window.cloudSetAssetQa=cloudSetAssetQa;");
  assert.ok(c.includes("row.meta.iso!==expectedIso") && c.includes("const meta={...(row.meta||{}),qa:{...(qa||{}),iso:expectedIso}};"));
  assert.ok(c.includes("storage_path:row.storage_path,meta,refs:row.refs||[],history:row.history||[]"), "the image, its references and its history are written back as they were");
});

await test("1d the button and the report: saved after a check; the kept result opens without a read; Check again reads once more", () => {
  const btn = between(art, "function QaCheckButton({", "window.QaCheckButton = QaCheckButton;");
  assert.ok(btn.includes("window.nbSetAssetQa(gen.id, iso, { at:Date.now(), report:plain })"), "kept when the check comes back");
  assert.ok(btn.includes("onClick:()=>{ if(kept && !busy) setReport({ ...kept.report, kept:true, checkedAt:kept.at }); else run(); }"), "a kept result opens: no read");
  assert.ok(btn.includes('busy ? "QA…" : kept ? qaBadgeText(kept.report) : "QA check"'));
  assert.ok(btn.includes("onRecheck: report.kept ? ()=>{ setReport(null); run(); } : undefined"));
  const rep = between(art, "function QaReport({", "window.QaCheckButton = QaCheckButton;");
  assert.ok(rep.includes('"data-role":"qa-recheck"') && rep.includes('"Check again"'));
  assert.ok(rep.includes("This is the saved result; opening it is free."));
  for (const k of [".qa-kept-dot.pass{background:var(--ok)}", ".qa-kept-dot.major{background:var(--alert)}", ".qa-foot .qa-recheck{margin-right:auto}"]) assert.ok(css.includes(k), k);
});

await test("2 the Art Room folds its heading on scroll at every size; the other rooms as before", () => {
  assert.ok(app.includes('useHeadAutoHide(vp==="mobile" || shortScreen || room==="art", room+"|"+view+"|"+artView);'));
  // (2026-11-25, "a little jerk ... smooth and with no latency") the fold is put on the root itself, in the scroll's own
  // frame: no state, so the app is not drawn again; each part starts from its measured height, and its gaps move with it
  assert.ok(!/headHidden|setHidden\(/.test(app), "the fold is no React state");
  assert.ok(app.includes('root.classList.add("head-hidden");') && app.includes('parts.forEach(e=>{ e.style.maxHeight = e.offsetHeight+"px"; });') && app.includes('document.addEventListener("scroll", onScroll, { capture:true, passive:true });'));
  assert.ok(!/\.wr-head-copy\{max-height:420px/.test(css) && css.includes(".app.hs.room-art .art-head-top{transition:gap .24s ease,margin .24s ease}") && css.includes(".app.hs.room-art .wr-head-side{transition:gap .24s ease}"));
  for (const k of [".app.hs.room-art.head-hidden .wr-head-copy,", ".app.hs.room-art.head-hidden .wr-actions{max-height:0;opacity:0;", ".app.hs.room-art.head-hidden .wr-head-in{padding-top:4px;padding-bottom:0;gap:0}"]) assert.ok(css.includes(k), k);
});

await test("3 one More menu over the cards: Regenerate sheets… and the two managers; a single one stays a button; the main buttons stay in view", () => {
  const sheets = between(art, "function CharacterSheets({", "/* ---- pre-production readiness");
  const more = between(sheets, '// ONE "MORE" MENU', "lookbookFirst && React.createElement");
  for (const k of ['"Regenerate sheets\\u2026"', '"Likenesses \\u00b7 "+cameoCount', '"data-testid":"voices-manager-btn"']) assert.ok(more.includes(k), "in the menu: " + k);
  assert.ok(more.includes("if(items.length===1) return items[0];"), "one button needs no menu");
  assert.ok(more.includes('"aria-haspopup":"menu"') && more.includes("hidden:!moreOpen"));
  const before = sheets.slice(0, sheets.indexOf('// ONE "MORE" MENU'));
  for (const k of ['"Design the cast"', '"Generate "+missingAll.length+" missing sheet"']) assert.ok(before.includes(k), "still a button of its own: " + k);
  assert.ok(css.includes(".art-more-pop[hidden]{display:none}"));
  // on a phone More shares the line of the button before it
  assert.ok(css.includes(".art-intro-actions:has(> .art-more) > :has(+ .art-more){grid-column:1}") && css.includes(".art-intro-actions:has(> .art-more) > .art-more{grid-column:2}"));
});

await test("6 the bare numbers say what they count", () => {
  assert.ok(art.includes('items.length+" scenes"));') && !art.includes('+" ("+items.length+")"'), "'38 scenes', not '01–04 (38)'");
  // (2026-11-20, owner) the style count left the three cards altogether: nobody adds styles from there any more
  for (const f of ["app/artroom.jsx", "app/props.jsx", "app/locations-ui.jsx"])
    assert.ok(!read(f).includes('+" of "+(window.turnGlobalStyleCap||40)+" styles")'), f + ": no style count on the card");
});

await test("7 the cast at a glance: over the cards from five characters up; a face, a first name, three marks and the QA dot; a press goes to the card", () => {
  assert.equal(box.castFirstName("LIAQAT HUSSAIN"), "Liaqat"); assert.equal(box.castFirstName("  neo "), "Neo"); assert.equal(box.castFirstName(""), "?");
  const ov = between(art, "function CastOverview({ list, faceIds, onGo }){", "window.CastOverview = CastOverview;");
  assert.ok(ov.includes("if(!(list && list.length > 4)) return null;"));
  assert.ok(ov.includes("Icon.image") && ov.includes("Icon.userScan") && ov.includes("Icon.mic") && ov.includes('"qa-kept-dot "+sev'));
  assert.ok(ov.includes("onClick:()=>onGo && onGo(c.id)"));
  assert.ok(!/generate\(|nbGenerate|onUpdate/.test(ov), "it only reads what is on the cards");
  const sheets = between(art, "function CharacterSheets({", "/* ---- pre-production readiness");
  assert.ok(sheets.includes("React.createElement(CastOverview,{ list:shown, faceIds:castFaceIds, onGo:goToCard }),"));
  assert.ok(sheets.includes("charPager.setPage(Math.floor(i/SHEETS_PER_PAGE))"), "the card's page of the grid first");
  for (const k of [".cast-strip{display:flex;", ".cast-mark.on{color:var(--pos-ink);opacity:1}", ".sheet-card.cast-go-flash{animation:castGoFlash 1.5s ease}"]) assert.ok(css.includes(k), k);
});

await test("L the Likeness title on one line: the full name, then the first name and initials, then initials", () => {
  assert.deepEqual(plain(box.cameoNameForms("MAUREEN SUTTON")), ["MAUREEN SUTTON", "MAUREEN S.", "M. S."]);
  assert.deepEqual(plain(box.cameoNameForms("Bartholomew Alexander Fitzgerald")), ["Bartholomew Alexander Fitzgerald", "Bartholomew A. F.", "B. A. F."]);
  assert.deepEqual(plain(box.cameoNameForms("Neo")), ["Neo"]); assert.deepEqual(plain(box.cameoNameForms("  a   b ")), ["a b", "a B.", "A. B."]);
  const t = between(cameo, "function CameoTitle({ name, tip }){", "window.cameoNameForms = cameoNameForms;");
  assert.ok(t.includes("if(el.scrollWidth > el.clientWidth + 1 && lvl < forms.length-1) setLvl(lvl+1);"), "measured where it is drawn");
  assert.equal(cameo.split("React.createElement(CameoTitle,{").length - 1, 2, "both steps of the window");
  for (const k of [".cameo-head-txt .cameo-title{min-width:0;white-space:nowrap}", ".cameo-title-t{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"]) assert.ok(css.includes(k), k);
  // the camera messages sit on the dark picture in both themes (the heading was dark on dark)
  assert.ok(css.includes(".cameo-msg-t{font-family:var(--f-display);font-size:15px;font-weight:600;color:#f5f3ee}"));
});

await test("P the pose figures in the brand's ink and amber (owner: 'more in-brand looking figures'): one line, pale head and shoulders, amber shoulders on the photo being taken; no face is coloured; the ghost over the camera has no fill", () => {
  const fig = between(cameo, "const CAMEO_POSE_BODY = ", "/* the generated pencil sketches");
  assert.ok(fig.includes('className:"cp-body"') && fig.includes('className:"cp-head"') && fig.includes('className:"cp-eye"'));
  assert.ok(fig.includes("right: CAMEO_POSE_3Q,") && fig.includes('transform:"translate(100 0) scale(-1 1)"'), "your right is your left, mirrored");
  assert.ok(!/strokeDasharray|cp-face/.test(fig), "no construction lines, no coloured face");
  for (const k of [".cameo-slot.active .cameo-slot-guide .cp-body{fill:var(--win-amber,#F29A43)}", ".cameo-slot-guide .cp-head{fill:var(--win-surface,var(--bg-1))}",
    ".cameo-slot.active{border-style:solid;border-color:var(--win-amber,#F29A43);", ".cameo-pose .cp-eye{fill:currentColor;stroke:none}"]) assert.ok(css.includes(k), k);
  assert.ok(!/\.cameo-guide-ghost[^{]*\.cp-(body|head)\{fill:(?!none)/.test(css), "the ghost stays a line drawing");
  const slotRules = css.split("\n").filter(l => /^\.cameo-slot(\.active|:hover|-guide|-lab i)/.test(l)).join("\n");
  assert.ok(!/oklch\(0\.(62|78) 0\.1[38] 29[56]/.test(slotRules), "no purple left on the slots");
});

await test("S the scale sheet shows height in the film, free: the character beside the whole cast and a door, from the sizes on the cards", () => {
  const shots = read("app/shots.jsx");
  const b = { console, Math, String, Number, Array, Object, Set, JSON };
  b.window = b; vm.createContext(b);
  vm.runInContext(between(shots, "function trueSizeMM(text){", "/* the scale class a true size falls in"), b);
  vm.runInContext(between(art, "function lineupSizeText(mm){", "function CharHeightLineup("), b);
  // who is in which scene (the app reads the screenplay; here a table)
  const IN = { liaqat: ["s1", "s2", "s3"], eshita: ["s1", "s2"], kieran: ["s3"], amy: ["s9"], nasir: ["s1", "s2", "s3"], bug: ["s1"] };
  b.scenesWhereCharacterAppears = (id) => IN[id] || [];
  b.scaleKnownObjects = (mm) => [{ name: "a grain of rice", mm: 6, size: "6 mm long" }];
  const C = (id, name, height) => ({ id, name, height });
  const cast = [C("liaqat", "LIAQAT HUSSAIN", "168 cm tall"), C("eshita", "ESHITA HUSSAIN", "160 cm tall"), C("kieran", "KIERAN ELLIS", "6 ft"),
    C("amy", "AMY ELLIS", "163 cm"), C("nasir", "NASIR FARUQUE", "170")];
  const L = plain(b.charHeightLineup(cast[0], cast, [], {}));
  // (owner 2026-11-18: "not all characters appear, allow user to see all characters in comparison") everyone is in it
  assert.deepEqual(L.rows.map(r => r.c.id), ["liaqat", "nasir", "eshita", "kieran", "amy"], "this character first, then who shares the most scenes, then everyone else");
  assert.deepEqual(L.rows.map(r => r.shared), [3, 3, 2, 1, 0]); assert.equal(L.more, 0, "nobody is left out");
  assert.deepEqual(L.sized.map(r => [r.c.id, r.mm]), [["liaqat", 1680], ["eshita", 1600], ["kieran", 1828.8], ["amy", 1630]]);
  const big = Array.from({ length: 30 }, (_, i) => C("x" + String(i).padStart(2, "0"), "PERSON " + String(i).padStart(2, "0"), (150 + i) + " cm"));
  assert.equal(plain(b.charHeightLineup(big[0], big, [], {})).sized.length, 30, "a cast of thirty: thirty columns");
  assert.deepEqual(L.unsized.map(r => r.c.id), ["nasir"], "a bare number is no size: named, not drawn");
  assert.deepEqual(L.ref, { name: "a door", mm: 2000, size: "2 m" }); assert.equal(L.scale, 2000, "the door is the tallest thing in a line-up of people");
  // a film of small creatures gets a familiar object of their size, not a door
  const small = plain(b.charHeightLineup(C("bug", "BUG", "15 mm long"), [C("bug", "BUG", "15 mm long")], [], {}));
  assert.equal(small.ref.name, "a grain of rice"); assert.equal(small.rows.length, 1);
  const none = plain(b.charHeightLineup(C("amy", "AMY", ""), [C("amy", "AMY", "")], [], {}));
  assert.equal(none.sized.length, 0); assert.equal(none.ref, null);
  // someone with no size of their own still sees the rest of the cast (and is told to write theirs)
  const noSize = plain(b.charHeightLineup(C("amy", "AMY", ""), cast, [], {}));
  assert.equal(noSize.rows[0].self, true); assert.deepEqual(noSize.sized.map(r => r.c.id), ["eshita", "kieran", "liaqat"]);
  assert.equal(b.lineupSizeText(1680), "168 cm"); assert.equal(b.lineupSizeText(15), "15 mm"); assert.equal(b.lineupSizeText(40000), "40 m"); assert.equal(b.lineupSizeText(0.2), "200 \u00b5m");
  const card = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  assert.ok(card.includes("React.createElement(CharHeightLineup,{ c, cast:cast||[c], scenes, drafts })),"), "the line-up is the whole Scale sheet section");
  const comp = between(art, "function CharHeightLineup({", "window.charHeightLineup = charHeightLineup;");
  // (owner 2026-11-17: "names … not glued up with one another … keep everything within the viewport on mobile") each bar
  // has its own caption under the ground line (name over size), cut inside its own column. (owner 2026-11-18: "welcome
  // horizontal scroll if necessary") columns of one width on a row that scrolls sideways INSIDE the card; no column is
  // hidden any more; the side with more people fades; the door is named beside the heading, where it cannot slide away
  assert.ok(comp.includes('className:"lineup-caps"') && comp.includes('className:"lineup-cap"+(r.self?" self":"")+((!r.self && !r.shared)?" far":"")'));
  assert.ok(!comp.includes("sixth") && !css.includes(".lineup .sixth"), "nobody is hidden on a narrow card");
  assert.ok(comp.includes('className:"lineup-scroll"+(edge.indexOf("l")>=0?" more-l":"")+(edge.indexOf("r")>=0?" more-r":""),tabIndex:edge?0:undefined,'), "reachable by keyboard when it scrolls");
  assert.ok(comp.includes('React.createElement("span",{className:"lineup-key"},') && comp.includes("new ResizeObserver(upd)"));
  for (const k of [".lineup-scroll{min-width:0;overflow-x:auto;overflow-y:hidden;", ".lineup-plot{min-width:100%;width:max-content}", ".lineup-col{flex:0 0 50px;min-width:0;",
    ".lineup-cap{flex:0 0 50px;min-width:0;", ".lineup-name{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;",
    ".lineup-scroll.more-r{-webkit-mask-image:linear-gradient(to right,#000 calc(100% - 34px),transparent);", ".lineup-col.far .lineup-bar{opacity:.55}",
    "@media (max-width:640px){ .lineup-col,.lineup-cap{flex-basis:46px} .lineup-chart,.lineup-caps{gap:4px} }"]) assert.ok(css.includes(k), k);
  assert.ok(!/\.lineup-name\{[^}]*position:absolute/.test(css), "no name hangs outside its column");
  assert.ok(!/generate\(|nbGenerate|onUpdate/.test(comp), "nothing is made or changed by it");
  assert.ok(comp.includes("has no unit. ") && comp.includes("No size yet. "), "a missing size is said in view: it needs doing");
});

await test("T the card's explaining lines (owner 2026-11-17): gone or behind an 'i'; the worn and carried lists tidy", () => {
  const card = between(art, "function CharacterSheet({", "\nfunction NbKeyBar(");
  for (const gone of ["Continuity objects \\u2014 worn or carried items that recur across scenes.", "Moments where this character's look changes", "sheet-props-note",
    '"Story props \\u2014 worn ones attach to this sheet; carried ones attach at the shot"'])
    assert.ok(!card.includes(gone), "still on the card: " + gone);
  assert.equal(card.split("char-scalesheet-hint").length - 1, 0, "no explaining paragraph left on the character card");
  // (the generated height chart image and its QA check left the card the same day: "remove selected element")
  assert.ok(!card.includes("Height chart image") && !card.includes("scaleGenWrapped") && !card.includes('noun:"scale sheet"'));
  assert.ok(between(art, "function CharHeightLineup({", "window.charHeightLineup = charHeightLineup;").includes('const oneUnit = (L.sized.length>1 && units.length===1) ? units[0] : "";'), "one unit for everyone: numbers over the bars, the unit once in the heading");
  for (const tip of ['label:"About height in the film"', 'label:"About story props"', 'label:"About lines for the video model"'])
    assert.ok(card.includes(tip) || art.includes(tip), tip);
  const lines = card.slice(card.indexOf('"Lines for the video model",'));
  assert.ok(lines.indexOf('label:"About lines for the video model"') < lines.indexOf('"aria-label":"How their lines are written for the video model"'), "the i sits beside the label, before the menu");
  assert.ok(card.includes('className:"sheet-2col owned-lists"'));
  const insp = read("app/inspector.jsx");
  assert.ok(insp.includes("rows: multiline?(rows||2):undefined });") && insp.includes('multiline:true,rows:1,onCommit:val=>setAt(i,val)'), "a short item is one line tall");
  for (const k of [".owned-lists .eil-row + .eil-row{border-top:1px solid var(--line)}", ".lineup-col.self .lineup-bar{background:var(--win-amber,#F29A43);border-color:var(--txt-0)}",
    "@media (max-width:640px){ .sheet-2col.owned-lists{grid-template-columns:minmax(0,1fr)} }"]) assert.ok(css.includes(k), k);
  // (2026-11-18) the one-column rule has to win over .sheet-2col's own two columns, which come later in the file
  assert.ok(css.indexOf(".sheet-2col.owned-lists{grid-template-columns:minmax(0,1fr)}") > 0 && !css.includes("{ .owned-lists{grid-template-columns:minmax(0,1fr)} }"));
  const ve = read("app/video-elements.jsx");
  assert.ok(ve.includes('label:"About the video element"'));
});

await test("F Frances knows; the changed files are served under a new key", () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"Cast overview, the character card in four rows, the kept QA result (Characters, Art Room)"', "function appBrief(){");
  for (const k of ["THE CAST AT A GLANCE", "THE CARD IN FOUR ROWS", "THE QA RESULT IS KEPT", "'Check again'", "ONE 'MORE' MENU", "THE HEADING FOLDS"]) assert.ok(f.includes(k), k);
  const KEYS = ["20261117-cast1", "20261117-cast2", "20261117-menu1", "20261117-tips2", "20261117-look1", "20261117-styles1", "20261117-styles2", "20261117-details1", "20261117-details2", "20261117-nosurprise1", "20261117-badge1", "20261118-items1", "20261118-popup1", "20261118-popup2", "20261118-idphoto1", "20261118-desc1", "20261118-desc2", "20261118-update1", "20261118-update2", "20261119-photo1", "20261119-keep1", "20261120-areas1", "20261120-lock1", "20261120-anchor1", "20261120-final1", "20261120-shots1", "20261120-guide1", "20261120-code1", "20261120-detail1", "20261120-gta1", "20261120-charge1", "20261120-charge2", "20261120-tidy1", "20261120-views1", "20261120-views2", "20261120-size1", "20261120-size2", "20261120-nohead1", "20261120-detail2", "20261120-versions1", "20261120-numbers1", "20261121-record1", "20261121-places1", "20261121-places2", "20261121-onecard1", "20261121-back1", "20261121-back2", "20261121-five1", "20261121-five2", "20261121-five3", "20261122-plan1", "20261122-plan2", "20261122-plan3", "20261122-end1", "20261122-end2", "20261122-previs1", "20261123-strip1", "20261123-strip2", "20261123-door1", "20261123-setcard1", "20261123-looks1", "20261123-light1", "20261124-figures1", "20261124-kit1", "20261124-kit2", "20261124-kit3", "20261124-paint1", "20261124-angle1", "20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3", "20261125-order1", "20261125-order2", "20261125-top1", "20261125-wide1", "20261125-drag1", "20261125-drag2", "20261125-drag3", "20261125-drag4", "20261125-drag5", "20261125-drag6", "20261125-walls1", "20261125-walls2", "20261125-walls3", "20261125-walls4", "20261125-walls5", "20261126-look1"];   // (the list grows with each key bump)
  for (const file of ["artroom.jsx", "cameo.jsx", "imagegen.jsx", "cloud.jsx", "app.jsx", "ai.jsx", "styles.css"])
    assert.ok(KEYS.some(k => html.includes("app/" + file + "?v=" + k + '"')), file);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
