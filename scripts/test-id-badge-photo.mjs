#!/usr/bin/env node
/* A BADGE WITH ITS WEARER'S PICTURE ON IT (owner 2026-11-17: "how do we solve characters wearing / carrying a badge
   with their picture on it?" — "Yes, build both").

   1  COSTUME: a badge, pass or lanyard card among what a character wears. Their sheet (and the photo-based sheet, and
      any shot they are in) is told that IF it carries a photo, the photo is that same person, with unreadable printing.
      It is written as a rule of its own, so it does not contradict "no text" and "exactly one face".
   2  HERO PROP: an ID card, badge, pass, passport or licence with its own prop card shows its owner's face, taken from
      the owner's character sheet (which already goes out with the prop's sheet). On by itself for such an object; the
      card has a tick.
   3  The QA check reads the wearer's small photo and micro-print as part of the object.

     node scripts/test-id-badge-photo.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 5).join("\n    ")); } };
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, "missing: " + a); const j = src.indexOf(b, i); assert.ok(j > i, "missing: " + b); return src.slice(i, j); };

const art = read("app/artroom.jsx"), props = read("app/props.jsx"), shots = read("app/shots.jsx"), ai = read("app/ai.jsx"), css = read("app/styles.css");
const box = { console, String, Array, JSON, Object };
box.window = box; vm.createContext(box);
vm.runInContext(between(art, "const ID_ITEM_RX = ", "/* resolve a visual field with legacy fallback").replace(/^const /gm, "var "), box);
vm.runInContext(between(props, "function propShowsOwner(p){", "/* shared useImageGen plumbing for prop sheets"), box);

test("1 what counts as an ID item: a badge, pass or card that names its kind, a lanyard, a passport, a licence — not any badge, not any card", () => {
  const yes = ["green PCO licence badge on a lanyard at the chest", "staff ID badge", "an I.D. card", "press pass", "police warrant card", "visitor pass clipped to the lapel",
    "a lanyard", "name tag", "his passport", "driving licence", "driver's license", "photo ID", "hospital staff card", "security badge"];
  for (const t of yes) assert.ok(box.turnIdItem(t), "should count: " + t);
  const no = ["thick worn gold ring", "sheriff's star", "a pin badge", "the card", "playing cards", "boarding", "black leather belt", "", null];
  for (const t of no) assert.equal(box.turnIdItem(t), "", "should not count: " + t);
  assert.equal(box.turnIdItem("green PCO licence badge on a lanyard"), "licence badge");
  assert.equal(box.charIdItem({ accessories: "gold ring; staff ID badge" }), "id badge");
  assert.equal(box.charIdItem({ wardrobeMask: "navy uniform with a lanyard" }), "lanyard");
  assert.equal(box.charIdItem({ accessories: "gold ring", props: "the key" }), ""); assert.equal(box.charIdItem(null), "");
});

test("2 the rule a prompt carries: the wearer's own face on the small photo, unreadable printing; it is conditional", () => {
  const r = box.idPhotoRule("LIAQAT HUSSAIN");
  assert.match(r, /^ID badge, pass or photo card: if one worn or carried by LIAQAT HUSSAIN has a photo on it, that small photo is a passport-style picture of LIAQAT HUSSAIN/);
  assert.match(r, /the same face, hair and skin tone — never another person/);
  assert.match(r, /tiny unreadable lines and blocks, with no legible words, names, numbers or logos$/);
  assert.match(box.idPhotoRule(""), /worn or carried by this character/);
});

test("3 the character sheet: a rule of its own in the wardrobe, the one exception to no-text, a note on the one-face rule — only when the character wears one", () => {
  const sheet = between(art, "function buildCharRefPrompt(", "window.buildCharRefPrompt = buildCharRefPrompt;");
  assert.ok(sheet.includes('turnIdItem([accAll.join("; "), clean(mask)].filter(Boolean).join(" ; "))'), "read from what the sheet really draws: the worn items and the outfit");
  assert.ok(sheet.includes("id_photo_rule: _idRule || undefined,"));
  assert.ok(sheet.includes('.concat(_idRule ? ["the one exception to the no-text rule: a worn ID badge or pass may carry its small photo and unreadable micro-print (see wardrobe.id_photo_rule)"] : []);'));
  assert.ok(sheet.includes('+ (_idRule ? " (The tiny photo on a worn ID badge is part of that object, not another view of the character: keep it very small.)" : ""),'));
  // the sheet made from a dropped photo says it too
  const photo = between(art, "function buildRefFromPhotoPrompt(c, project){", "window.buildRefFromPhotoPrompt = buildRefFromPhotoPrompt;");
  assert.ok(photo.includes('turnIdItem([mask, c.accessories].filter(Boolean).join(" ; "))') && photo.includes('s += idPhotoRule(c.name || "this character")+". ";'));
});

test("4 a shot says it once for whoever in frame wears or carries one", () => {
  const b = { console, String, Array, window: null }; b.window = b; vm.createContext(b);
  b.charIdItem = box.charIdItem; b.idPhotoRule = box.idPhotoRule;
  const END = '"ID BADGES: "));';
  const i = shots.indexOf("  const _idWearers = "), j = shots.indexOf(END, i);
  assert.ok(i > 0 && j > i, "the clause is in the shot's staging");
  const code = shots.slice(i, j + END.length);
  const run = (subjects) => vm.runInContext("(function(subjects, clean, stage){\n" + code + "\n return stage; })", b)(subjects, (x) => String(x || "").trim(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(run([{ name: "Liaqat", accessories: "PCO licence badge on a lanyard" }, { name: "Eshita", accessories: "gold ring" }]))),
    ["ID BADGES: if one worn or carried by Liaqat has a photo on it, that small photo is a passport-style picture of Liaqat — the same face, hair and skin tone — never another person; its printing is tiny unreadable lines and blocks, with no legible words, names, numbers or logos"]);
  assert.match(run([{ name: "Amy", accessories: "staff ID badge" }, { name: "Jamil", wardrobeMask: "suit, press pass" }])[0], /worn or carried by each of Amy, Jamil has a photo on it/);
  assert.deepEqual(JSON.parse(JSON.stringify(run([{ name: "Eshita", accessories: "gold ring" }]))), [], "nobody wears one: nothing is added");
});

test("5 a prop that shows its owner's photo: by itself for an ID object that belongs to someone; the card's tick decides otherwise", () => {
  const P = (o) => ({ id: "p1", ownerId: "liaqat", ownerName: "Liaqat", name: "licence badge", ...o });
  assert.equal(box.propShowsOwner(P({})), true);
  assert.equal(box.propShowsOwner(P({ name: "the card", form: "a laminated police warrant card in a leather wallet" })), true, "its description says so");
  assert.equal(box.propShowsOwner(P({ name: "the card", aliases: ["Liaqat's ID card"] })), true, "…or one of its other names");
  assert.equal(box.propShowsOwner(P({ name: "the key" })), false);
  assert.equal(box.propShowsOwner(P({ name: "the key", ownerPhoto: true })), true, "ticked by hand (a framed portrait, a wanted poster)");
  assert.equal(box.propShowsOwner(P({ ownerPhoto: false })), false, "unticked by hand");
  assert.equal(box.propShowsOwner(P({ ownerId: "" })), false, "an object nobody owns shows nobody");
  const note = box.propOwnerNote(P({ kind: "carried" }));
  assert.match(note, /^Reference image: Liaqat's character sheet\./);
  assert.match(note, /This object carries a photo of Liaqat: the small photo on it is a passport-style picture of Liaqat with exactly the face, hair and skin tone of the portrait in the attached character sheet — never another person\. Copy only the face; do not copy the sheet's layout or panels onto the object\.$/);
  assert.doesNotMatch(box.propOwnerNote(P({ name: "the key", kind: "carried" })), /carries a photo/);
  // in the sheet's own spec too, and on the card
  assert.ok(props.includes("owner_photo_rule: propShowsOwner(p) ? propOwnerPhotoRule(p) : undefined,"));
  assert.ok(props.includes('"data-testid":"prop-owner-photo"') && props.includes('onChange:e=>onUpdate(p.id,{ownerPhoto:!!e.target.checked})') && props.includes('"Shows "+(p.ownerName||"its owner")+"\'s photo"'));
  assert.ok(props.includes("ownerUrl?[{url:ownerUrl,kind:\"owner\""), "the owner's sheet already goes out with the prop's sheet: nothing new is attached");
  assert.ok(css.includes(".prop-owner-photo{position:relative;display:flex;align-items:center;gap:8px;"));
});

test("6 the QA check: the wearer's small photo and micro-print are part of the object; a different person on it is a fault", () => {
  const qa = between(ai, "async function aiImageQA(item){", "window.aiImageQA = aiImageQA;");
  assert.ok(qa.includes("ID BADGES: a worn or carried ID badge, pass or photo card may show a small photo of the SAME person who wears it and fine unreadable micro-print"));
  assert.ok(qa.includes("never report it as text on the image or as an extra face") && qa.includes("clearly shows a DIFFERENT person than the wearer (a deviation)"));
});

test("7 Frances knows both ways, in the app's own words", () => {
  const f = between(ai, 'APP_FEATURES.push({ name:"ID badges, passes and cards with the character\'s own photo (Characters, Props, Shots)"', "function appBrief(){");
  for (const k of ["'Accessories \\u2014 worn'", "'Shows <owner>'s photo'", "'Visual lock'", "'Update sheet with new wardrobe'", "THE QA CHECK"]) assert.ok(f.includes(k), k);
});

console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
