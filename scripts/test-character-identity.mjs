#!/usr/bin/env node
/* ============================================================================
   HEADLESS CHARACTER-IDENTITY TESTS

   The suite loads the shared source helper in a vm, rather than reproducing
   its regular expressions in the test.  It covers the direct Odette case,
   attribution boundaries, explicit precedence, film scoping, assertions and
   the reusable React notice's confirmation/update path.
   ============================================================================ */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const sandbox = { console, setTimeout, clearTimeout, CustomEvent: class {
  constructor(type, opts) { this.type = type; this.detail = opts && opts.detail; }
} };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.dispatchEvent = () => {};
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
vm.createContext(sandbox);
vm.runInContext(readFileSync("app/character-identity.js", "utf8"), sandbox, {
  filename: "app/character-identity.js",
});

const report = sandbox.turnIdentityReport;
const assertCharacter = sandbox.turnAssertCharacterIdentity;
const assertProject = sandbox.turnAssertProjectIdentity;
const prompt = sandbox.turnIdentityPrompt;
assert.equal(typeof report, "function");
assert.equal(typeof assertCharacter, "function");

const scene = (id, no, blocks) => ({ id, no, title: "Scene " + no });
const draft = blocks => ({ blocks });
const action = text => ({ type: "action", text });
const dialogue = text => ({ type: "dia", text });
const scenes = [scene("s1", 1), scene("s2", 2)];
const drafts = {
  s1: draft([action("ODETTE BRUMFIELD — a man who handles the way other men handle relics; He unties the cord.")]),
  s2: draft([action("Odette watches the door while a man waits outside.")]),
};

let passes = 0;
let failures = 0;
const ok = (name, fn) => {
  try { fn(); passes++; }
  catch (error) { failures++; console.log("FAIL " + name + " — " + error.message); }
};

ok("Odette exact action declaration detects he/him", () => {
  const odette = { id: "odette", name: "ODETTE BRUMFIELD", pronouns: "she/her", pronounProvenance: "user" };
  const r = report(odette, { scenes: [scenes[0]], drafts, cast: [odette] });
  assert.equal(r.scriptPronouns, "he/him");
  assert.equal(r.status, "conflict");
  assert.ok(r.issues.some(i => i.source === "screenplay" && i.sceneId === "s1" &&
    i.sceneNo === 1 && i.quote.includes("ODETTE BRUMFIELD — a man")));
});

ok("nearby man is not attributed to Odette", () => {
  const odette = { id: "odette", name: "Odette", pronouns: "she/her" };
  const r = report(odette, { scenes: [scenes[1]], drafts, cast: [odette] });
  assert.equal(r.scriptPronouns, "");
  assert.equal(r.status, "unverified");
  assert.equal(r.issues.length, 0);
});

ok("follow-up pronouns are not attributed across a shared action block", () => {
  const odette = {id:"odette",name:"ODETTE",pronouns:"he/him"};
  const marcus = {id:"marcus",name:"MARCUS",pronouns:"she/her"};
  const r = report(odette,{scenes:[scenes[0]],cast:[odette,marcus],
    drafts:{s1:draft([action("MARCUS guides ODETTE — a man — into the room. She shuts the door.")])}});
  assert.equal(r.scriptPronouns,"he/him");
  assert.equal(r.issues.length,0);
});

ok("a later gendered noun is not an immediate declaration", () => {
  const odette = { id: "odette", name: "Odette", pronouns: "she/her" };
  const bob = { id: "bob", name: "BOB" };
  const r = report(odette, {
    scenes: [scenes[0]],
    drafts: { s1: draft([action("Odette talks to BOB, a man who waits by the door.")]) },
    cast: [odette, bob],
  });
  assert.equal(r.scriptPronouns, "");
  assert.equal(r.issues.length, 0);
});

ok("dialogue is not screenplay identity evidence", () => {
  const odette = { id: "odette", name: "Odette", pronouns: "she/her" };
  const r = report(odette, {
    scenes: [scenes[0]],
    drafts: { s1: draft([dialogue("ODETTE is a woman.")]) },
    cast: [odette],
  });
  assert.equal(r.scriptPronouns, "");
  assert.equal(r.status, "unverified");
});

ok("plural and possessive references are ignored", () => {
  const odette = { id: "odette", name: "Odette", pronouns: "she/her" };
  const r = report(odette, {
    scenes: [scenes[0]],
    drafts: { s1: draft([action("Odette and Lira are women. Odette's mother enters.")]) },
    cast: [odette, { id: "lira", name: "Lira" }],
  });
  assert.equal(r.scriptPronouns, "");
  assert.equal(r.issues.length, 0);
});

ok("ambiguous shared first names are not used as evidence", () => {
  const odette = { id: "odette", name: "Odette Brumfield", pronouns: "she/her" };
  const bell = { id: "bell", name: "Odette Bell", pronouns: "she/her" };
  const r = report(odette, {
    scenes: [scenes[0]],
    drafts: { s1: draft([action("Odette — a man.")]) },
    cast: [odette, bell],
  });
  assert.equal(r.scriptPronouns, "");
  assert.equal(r.status, "unverified");
});

ok("canonical explicit pronouns win over profile and visual evidence", () => {
  const c = {
    id: "c", name: "C", pronouns: "He/Him", pronounProvenance: "user",
    role: "a woman who runs the archive",
    gender: "female",
    coreBody: "C is a woman with a steady gaze.",
  };
  const r = report(c, { scenes: [], drafts: {}, cast: [c] });
  assert.equal(r.pronouns, "he/him");
  assert.equal(r.status, "conflict");
  assert.ok(r.issues.some(i => i.source === "profile"));
  assert.ok(r.issues.some(i => i.source === "visual"));
});

ok("outdated conscious/unconscious self prose is guidance, not a block", () => {
  const c = {
    id: "c", name: "C", pronouns: "he/him", pronounProvenance: "user",
    psyche: "She hungers for a life outside the archive.",
    unconscious: "She fears becoming invisible.",
  };
  const r = report(c, { scenes: [], drafts: {}, cast: [c] });
  assert.equal(r.status, "unverified");
  assert.equal(r.issues.length, 0);
  assert.ok(r.advisories.length >= 2);
});

ok("quoted and third-party profile prose is not identity evidence", () => {
  const c = {
    id: "c", name: "C", pronouns: "he/him",
    psyche: "He says, 'She is a woman.' Her mother is mentioned in the report.",
    description: "He/him and she/her are quoted examples about other people.",
  };
  const r = report(c, { scenes: [], drafts: {}, cast: [c] });
  assert.equal(r.status, "unverified");
  assert.equal(r.issues.length, 0);
});

ok("visual prose requires an explicit subject, not a stray gender word", () => {
  const c = {
    id: "c", name: "C", pronouns: "he/him", pronounProvenance: "user",
    coreBody: "Long hair, a woman-shaped silhouette, and a red coat.",
  };
  const r = report(c, { scenes: [], drafts: {}, cast: [c] });
  assert.equal(r.issues.length, 0);
});

ok("provenance does not erase a valid persisted canonical pick", () => {
  const c = { id: "c", name: "C", pronouns: "she/her", pronounProvenance: "inferred" };
  const r = report(c, { scenes: [], drafts: {}, cast: [c] });
  assert.equal(r.pronouns, "she/her");
  assert.equal(r.status, "unverified");
  assert.doesNotThrow(() => sandbox.turnAssertCharacterIdentity(c, { scenes: [], drafts: {}, cast: [c] }));
});

ok("unset human identity is distinct from an unverified explicit identity", () => {
  const blank = { id: "blank", name: "BLANK", role: "Antagonist" };
  assert.equal(report(blank, { scenes: [], drafts: {}, cast: [blank] }).status, "unset");
  assert.throws(() => assertCharacter(blank, { scenes: [], drafts: {}, cast: [blank] }), /unresolved character identity/i);
  const explicit = { id: "explicit", name: "EXPLICIT", pronouns: "she/her" };
  assert.equal(report(explicit, { scenes: [], drafts: {}, cast: [explicit] }).status, "unverified");
  assert.doesNotThrow(() => assertCharacter(explicit, { scenes: [], drafts: {}, cast: [explicit] }));
});

ok("animals are not blocked by blanket unset enforcement", () => {
  const dog = { id: "dog", name: "PATCH", species: "dog" };
  assert.doesNotThrow(() => assertCharacter(dog, { scenes: [], drafts: {}, cast: [dog] }));
});

ok("project assertion scopes to selected cast and live scenes", () => {
  const good = { id: "good", name: "GOOD", pronouns: "she/her" };
  const bad = { id: "bad", name: "BAD", pronouns: "she/her" };
  const r = assertProject({
    characterIds: ["good"],
    scenes: [scenes[1]],
    drafts: {},
    cast: [good, bad],
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].pronouns, "she/her");
});

ok("project fallback reports unset cast without blanket blocking", () => {
  const texture = { id: "texture", name: "TEXTURE" };
  const reports = assertProject({ scenes: [], drafts: {}, cast: [texture] });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, "unset");
});

ok("identity prompt never guesses from a name or role", () => {
  const text = prompt([
    { name: "Odette Brumfield", role: "a man who handles relics" },
    { name: "Mara", role: "a woman in red" },
  ]);
  assert.match(text, /Odette Brumfield — pronouns unknown/);
  assert.match(text, /Mara — pronouns unknown/);
  assert.doesNotMatch(text, /Odette Brumfield[^\n]*he\/him/);
});

/* UI update smoke test. The component uses only createElement/useState, so a
   tiny React host is enough to exercise its explicit confirmation path. */
const uiReact = {
  Fragment: "fragment",
  useState: initial => [initial, () => {}],
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
};
sandbox.React = uiReact;
sandbox.appConfirm = async () => true;
vm.runInContext(readFileSync("app/character-identity-ui.jsx", "utf8"), sandbox, {
  filename: "app/character-identity-ui.jsx",
});
const runUiSmoke = async () => {
  const updates = [];
  const c = { id: "odette", name: "ODETTE BRUMFIELD", pronouns: "she/her", pronounProvenance: "user" };
  const tree = sandbox.CharacterIdentityNotice({
    character: c, scenes: [scenes[0]], drafts, cast: [c],
    onUpdate: (id, patch) => updates.push({ id, patch }),
  });
  const findButton = node => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button") return node;
    for (const child of node.children || []) {
      const found = Array.isArray(child)
        ? child.map(findButton).find(Boolean)
        : findButton(child);
      if (found) return found;
    }
    return null;
  };
  const button = findButton(tree);
  assert.ok(button);
  await button.props.onClick();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, "odette");
  assert.equal(updates[0].patch.pronouns, "he/him");
  assert.equal(updates[0].patch.pronounProvenance, "user");
};
try {
  await runUiSmoke();
  passes++;
} catch (error) {
  failures++;
  console.log("FAIL identity notice updates only after confirmation — " + error.message);
}

/* The UI smoke test is async; report after all checks have settled. */
console.log("RESULT: " + (failures ? "FAIL — " : "OK — ") + passes + " passed, " + failures + " failed");
process.exit(failures ? 1 : 0);