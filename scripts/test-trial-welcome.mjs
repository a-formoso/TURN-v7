/* The trial welcome (owner request 2026-10-02): once per account, when its first signed-in balance
   shows the free trial (credits arrive with the first balance read after the email is confirmed).
   Not while a plan picked at sign-up is about to open its checkout, never over the plan / pack
   welcome or an invite landing; "seen" is kept in the account's metadata and this browser. */
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

const plans = read("app/plans.jsx"), ast = parseSync(plans, { sourceType: "script", presets: ["@babel/preset-react"] });
const box = { console }; box.window = box; vm.createContext(box);
vm.runInContext("var TRIAL_CREDITS = 50; function fmtCredits(n){ return Number(n).toLocaleString('en-US'); }", box);
for (const n of ["welcomeTrialCopy"]) {
  const node = ast.program.body.find((x) => x.type === "FunctionDeclaration" && x.id.name === n);
  vm.runInContext(plans.slice(node.start, node.end), box);
}

await test("A1 the card promises the approved trial and no more", () => {
  const c = box.welcomeTrialCopy(50);
  assert.equal(c.title, "Your 50 free credits are here");
  assert.equal(c.sub, "Your email is confirmed. 50 free credits are in your account — enough to try the Writers' Room on the lighter writing engine (a logline, a synopsis, the spine and its first scenes), plus draft images.");
  assert.equal(c.note, "Want more? Choose a plan any time from the account menu, or add a credit pack from $10.");
  assert.equal(box.welcomeTrialCopy(0).title, "Your 50 free credits are here", "an unknown amount says the trial's");
});
await test("A2 the card: the plan welcome's design, a dialog, Start a story and a way out", () => {
  const card = plans.slice(plans.indexOf("function WelcomeTrialCard"), plans.indexOf("window.WelcomeTrialCard = WelcomeTrialCard;"));
  assert.ok(card.includes('className:"welcome-card",role:"dialog","aria-modal":"true","aria-labelledby":"welcome-trial-title"'));
  assert.ok(card.includes('"Start a story"') && card.includes('"I\\u2019ll look around first"'));
});

const app = read("app/app.jsx");
await test("B1 it opens once, for a trial account with credits, and never in the way of a checkout or another welcome", () => {
  const eff = app.slice(app.indexOf("  React.useEffect(()=>{\n    if(trialWelcomeOpen || !session"), app.indexOf("},[session, creditBalance, welcomeOpen, creditPackOpen, inviteLanding]);"));
  assert.ok(eff.includes("if(trialWelcomeOpen || !session || !creditBalance || !creditBalance.trial || window.turnIsAdmin) return;"));
  assert.ok(eff.includes("if(!(Number(creditBalance.remaining)>0)) return;"));
  assert.ok(eff.includes("if(welcomeOpen || creditPackOpen || inviteLanding) return;"));
  assert.ok(eff.includes("window.turnIntendedPlanWaiting()") && eff.includes("(Date.now()-acct.at) < 48*3600*1000"));
  assert.ok(eff.includes("if(waiting || trialWelcomeSeen(session)) return;"));
});
await test("B2 closing it (either button) remembers it for the account and this browser", () => {
  assert.ok(app.includes('try{ localStorage.setItem(trialWelcomeKey(session), "1"); }catch(e){}'));
  assert.ok(app.includes('if(typeof window.cloudMarkTrialWelcomeSeen==="function") window.cloudMarkTrialWelcomeSeen();'));
  assert.ok(app.includes("onNewStory: ()=>{ closeTrialWelcome(); startNewStory(); },") && app.includes("onClose: closeTrialWelcome }),"));
  const cloud = read("app/cloud.jsx");
  assert.ok(cloud.includes("return m.turn_trial_welcome_seen === true;"));
  assert.ok(cloud.includes("await sb.auth.updateUser({ data:{ turn_trial_welcome_seen:true } });"));
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
