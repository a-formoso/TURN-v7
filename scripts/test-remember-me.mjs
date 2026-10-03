/* Remember me, the opening screen and the room-card buttons (owner 2026-10-03).
   - Remember me (on by default): unticked, the session lasts until the browser closes — a session
     cookie marks it alive; a new browser session without it drops the saved session BEFORE the
     client reads it. Ticked, nothing changes. Only after a successful sign in.
   - The opening screen: the mark, an animated spine, one status line; no Retry button or account
     chip up front; "Try again · Sign out" only after 20 s.
   - The room cards' buttons sit on one line (margin-top:auto wins over .lp-btn.full). */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseSync } from "@babel/core";

const read = (f) => readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, f) => {
  try { await f(); checks++; console.log("PASS", name); }
  catch (e) { failed++; console.log("FAIL", name); console.log(e); }
};

const cloud = read("app/cloud.jsx"), ast = parseSync(cloud, { sourceType: "script" });
function browser({ cookie = "" } = {}) {
  const store = {};
  const box = {
    console, location: { protocol: "https:" },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { _c: cookie, get cookie() { return this._c; }, set cookie(v) { const kv = v.split(";")[0]; this._c = this._c ? this._c + "; " + kv : kv; this.lastSet = v; } },
  };
  box.window = box; vm.createContext(box);
  vm.runInContext('const REMEMBER_FLAG = "turn-forget-session", ALIVE_COOKIE = "turn_session_alive";', box);
  for (const n of ["_sessionCookieAlive", "_markSessionCookie", "_forgetEndedSession", "cloudSetRememberMe"]) {
    const node = ast.program.body.find((x) => x.type === "FunctionDeclaration" && x.id.name === n);
    assert.ok(node, n); vm.runInContext(cloud.slice(node.start, node.end), box);
  }
  return { box, store };
}

await test("A1 unticked: the session is marked for this browser session only, with a session cookie", () => {
  const { box, store } = browser();
  store["turn-auth"] = "{session}";
  box.cloudSetRememberMe(false);
  assert.equal(store["turn-forget-session"], "1");
  assert.match(box.document.lastSet, /^turn_session_alive=1; path=\/; SameSite=Lax; Secure$/, "no expiry: it ends with the browser");
  box._forgetEndedSession();
  assert.equal(store["turn-auth"], "{session}", "same browser session (cookie present): still signed in");
});
await test("A2 a new browser session without the cookie drops the saved session before the client reads it", () => {
  const { box, store } = browser({ cookie: "" });
  store["turn-auth"] = "{session}"; store["turn-forget-session"] = "1";
  box._forgetEndedSession();
  assert.equal(store["turn-auth"], undefined);
  assert.equal(store["turn-forget-session"], undefined);
  assert.ok(cloud.includes("  _forgetEndedSession();\n  try{\n    window._sbClient = window.supabase.createClient("), "runs before the client is created");
});
await test("A3 ticked (the default): nothing is forgotten, and an earlier unticked choice is undone", () => {
  const { box, store } = browser({ cookie: "" });
  store["turn-auth"] = "{session}"; store["turn-forget-session"] = "1";
  box.cloudSetRememberMe(true);
  box._forgetEndedSession();
  assert.equal(store["turn-auth"], "{session}");
  const ui = read("app/auth-ui.jsx");
  assert.ok(ui.includes("const [remember, setRemember] = React.useState(true);"));
  assert.ok(ui.includes('if(mode==="signin" && typeof window.cloudSetRememberMe==="function") window.cloudSetRememberMe(remember);'));
  assert.ok(ui.includes('mode==="signin" && React.createElement("label",{className:"auth-remember"},'));
  // it also remembers the email (owner 2026-10-03), filled in next time — even after signing out
  assert.ok(ui.includes('return localStorage.getItem("turn-remember-email")||"";'));
  assert.ok(ui.includes('if(remember) localStorage.setItem("turn-remember-email", e); else localStorage.removeItem("turn-remember-email");'));
});

const app = read("app/app.jsx");
await test("B the opening screen: mark, spine, one line; the way out only when it's slow", () => {
  const scr = app.slice(app.indexOf("if(authGate && session && !currentProjectId){"), app.indexOf("const newStoryBuildsCurrentEpisode"));
  assert.ok(scr.includes("splashSpine()") && app.includes('className:"lp-splash-spine"') && app.includes('className:"lp-splash-wave"'));
  assert.equal((app.match(/splashSpine\(\)/g) || []).length, 2, "both opening screens");
  assert.ok(!scr.includes("AccountChip") && !scr.includes('"Retry now"') && !scr.includes("lp-splash-dot"));
  assert.ok(scr.includes("splashSlow && React.createElement(\"div\",{className:\"lp-splash-slow\"}"));
  assert.ok(app.includes("const t = setTimeout(()=>setSplashSlow(true), 20000);"));
  const css = read("app/styles.css");
  assert.ok(css.includes("@media (prefers-reduced-motion:reduce){ .lp-splash-wave{animation:none;"));
});
await test("C the room cards' buttons sit on one line", () => {
  const css = read("app/styles.css");
  const a = css.indexOf(".lp-card .lp-btn.lp-room-cta{margin-top:auto}"), b = css.indexOf(".lp-btn.full{");
  assert.ok(a > 0 && b > 0, "both rules exist; three classes outrank .lp-btn.full wherever it sits");
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
