#!/usr/bin/env node
/* Screenplay format check + honest failures (incident 2026-09-27, and its review).

   In a Feature Film build, scenes 1 "4 A.M. Tide Check", 4 "Wrenham Goes Dark" and 25
   "Telemetry Blinks Back" (and Callback Sc 12 "Nobody Answering") ended as rough
   stand-ins, and "Redraft script from beats" then failed on them every time with NO
   message. Root cause: validateScreenplayBlocks() rejected every action line matching
   /(?:^|\s)[A-Z][A-Z .'’-]{1,30}:\s*[“"']?[A-Z]/ as "dialogue embedded in action" — which
   is also how professional scripts write on-screen text, inserts and readouts (INSERT —
   PHONE: …, SUPER: …, OPERATOR: CARROW, N.). The rejection reason was then thrown away.

   This runs the REAL app files (formats, frameworks, contract, scene-order, spine,
   script, ai, agents, shot-screenplay, locations) in node:vm with a stubbed
   window.claude.complete that replays canned model replies — no network — and the REAL
   writer handlers extracted from app.jsx / script.jsx. It proves:
     1. the reproduced failing outputs (the REAL incident beat maps, written with CAPS
        readouts) validate, stay correctly structured, and commit on redraft/draft;
     2. devices are normalised into the right block types — never a real speaker's line
        (THIRD GUARD, CARD DEALER, a building's SUPER, a cast member called Banner), and a
        voice keeps only its own words (the action around it stays action);
     3. documentary / commercial / music-video devices pass;
     4. genuine dialogue smuggled into action is STILL rejected — through device / voice
        words in the label, in any sentence, after a CAPS readout, shouted in CAPS — while
        readouts with names, "US", telegraphic app text and on-screen text messages pass;
     5. the Script check warns on exactly what the writers reject ("unclear" is a note);
     6. no failure is silent or misleading: every writer and batch says WHY, per scene;
        a provider-account failure is never shown to non-admins as "credits"; a repeated
        failure is never swallowed by the toast de-dupe; the admin line fits the toast;
        pressing Redraft again tells the model what was rejected;
     7. the story build says WHY a stand-in landed, and its retries carry the rejection;
     8. prompts and MUSE's facts carry no project's names; downstream readers ignore
        on-screen words; the cache keys that load this fix stay in step.
   node scripts/test-screenplay-validator.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (f)=>readFileSync(f, "utf8");
let checks = 0, failed = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0,6).join("\n    ")); }
};

/* ---------------- sandbox: the real app files ---------------- */
const noop = ()=>{};
const box = {
  console, clearTimeout, setInterval, clearInterval,
  setTimeout:(f)=>setTimeout(f, 0),            // the build's retry breathers run instantly
  React: new Proxy({}, { get:(t,k)=> k==="createElement" ? ()=>null : k==="Fragment" ? "frag" : k==="useRef" ? (x)=>({ current:x }) : noop }),
  ReactDOM: new Proxy({}, { get:()=>noop }),
  localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
  navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
  CustomEvent: class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
  Image: class {},
  document:{ createElement:()=>({ getContext:()=>null, style:{}, setAttribute:noop, appendChild:noop, classList:{ add:noop, remove:noop } }),
    getElementById:()=>null, addEventListener:noop, removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], createTextNode:()=>({}),
    body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
  requestAnimationFrame:noop, cancelAnimationFrame:noop, addEventListener:noop, removeEventListener:noop, dispatchEvent:noop,
  matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
  fetch:()=>{ throw new Error("network disabled in this test"); },
};
box.window = box; box.globalThis = box; box.self = box;
box.__replies = []; box.__prompts = []; box.__toasts = [];
box.appToast = (m, t)=>box.__toasts.push({ m:String(m), t });
// installed BEFORE ai.jsx, so its proxy shim is skipped; __truncateNext simulates a cut-off reply
box.claude = { complete: async (opts)=>{
  box.__prompts.push(((opts && opts.messages) || []).map(m=>m.content).join("\n"));
  box.__lastWritingTruncated = !!box.__truncateNext; box.__truncateNext = false;
  const r = box.__replies.shift();
  // r.toast: like the real complete(), toast the (already masked) error before throwing
  if(r instanceof Error){ if(r.toast) box.appToast(r.message, "error"); throw r; }
  return r == null ? "" : r;
} };
const errT = (m)=>Object.assign(new Error(m), { toast:true });
vm.createContext(box);
for(const f of ["app/formats.jsx","app/frameworks.jsx","app/contract.jsx","app/scene-order.js",
  "app/spine.jsx","app/script.jsx","app/ai.jsx","app/agents.jsx","app/shot-screenplay.js","app/locations.jsx"])
  vm.runInContext(read(f), box, { filename:f });
const realToast = box.appToast;                                   // ai.jsx's own toast (de-dupe + error sink)
const captureToast = (m, t, o)=>box.__toasts.push({ m:String(m), t, o });
box.appToast = captureToast;                                      // capture instead of the DOM
box.appConfirm = async ()=>true;
box.__warns = []; box.__infos = [];
box.console = { ...console, warn:(...a)=>box.__warns.push(a), info:(...a)=>box.__infos.push(a) };   // the admin logs, captured
const plain = (x)=>JSON.parse(JSON.stringify(x));
const reset = ()=>{ box.__replies = []; box.__prompts = []; box.__toasts = []; box.__warns = []; box.__infos = [];
  box.turnIsAdmin = false; box.__truncateNext = false; box.turnCast = undefined; box.turnErrorSink = null; box.appToast = captureToast; };
const VENDOR_RE = /claude|anthropic|openai|\bgpt|gemini|gemma|opus|sonnet|fable|kimi/i;
// the rule that caused the incident — kept here only to prove each reproduced line tripped it
const LEGACY_RE = /(?:^|\s)[A-Z][A-Z .'’-]{1,30}:\s*[“"']?[A-Z]/;

/* BLOCK_SPEC-shaped reply: segs = [[beatN, [[type,text],...]], ...] */
const reply = (segs)=>JSON.stringify({ beats:segs.map(([n, blocks])=>({ n, blocks:blocks.map(([type,text])=>({ type, text })) })) });

/* ---------------- the REAL incident beat maps (read-only copy, 2026-09-27) ----------------
   Feature Film Sc 1 / 4 / 25 and Callback (TV episode) Sc 12, verbatim from the live project. */
const REAL = {
  FF1: {"no": 1, "title": "4 A.M. Tide Check", "slug": "INT. NELL'S FLAT, INLAND TOWN - NIGHT", "turnAt": 4, "driverLabel": "NELL CARROW", "reactorLabel": "EMRYS PRYDDERCH", "rows": [{"n": 1, "drive": {"a": "Grabs", "d": "Nell Carrow jolts awake at 4:00 without an alarm and gropes for the phone on the bedside crate. Nell Carrow thumbs open the tide app before the room comes into focus, squinting at the blurred Saltmere gauge line."}, "react": {"a": "Mocks", "d": "The tide app shows the Saltmere gauge tracking prediction exactly, a calm green curve. The calm green curve leaves Nell Carrow nothing to do, and Nell Carrow's thumb keeps hovering over the screen anyway, refreshing a chart that needs no one."}}, {"n": 2, "drive": {"a": "Retreats", "d": "Nell Carrow drops the phone face-down on the bedside crate, pads into the dark kitchen and fills the kettle, deliberately turning away from the drawer beneath the counter."}, "react": {"a": "Exposes", "d": "The kettle's steam fogs the window, and in the black glass Nell Carrow's reflection hangs over the drawer beneath the counter, the same face that ran on every news feed during the Holmsey inquiry. Nell Carrow looks away from the reflection too late."}}, {"n": 3, "drive": {"a": "Surrenders", "d": "Nell Carrow yanks open the drawer beneath the counter and digs past the folded Holmsey inquiry findings to the laminated gate-sequence card, edges worn soft, Emrys Prydderch's pencilled timing notes copied into its margin."}, "react": {"a": "Accuses", "d": "The laminated card's header, WRENHAM SLUICE: SECTOR GATE CLOSURE, AUTHORISED OPERATORS ONLY, sits directly above Emrys Prydderch's old margin note in faded pencil: 'Count it aloud. The gate listens.' The laminated card names a job Nell Carrow was stripped of, and Nell Carrow's grip on the laminated card goes white at the knuckles."}}, {"n": 4, "drive": {"a": "Rehearses", "d": "Nell Carrow props the laminated card against the salt pot and runs the Wrenham closure by hand on the kitchen table: palm flat for isolation, twist of the wrist for the hydraulic bleed, two fingers walking the gate leaves shut, counting aloud in Emrys Prydderch's slow cadence."}, "react": {"a": "Steadies", "d": "By step nine, the step where Holmsey went wrong, Nell Carrow's hands stop trembling on the kitchen table. The count carries through without a stumble, and Emrys Prydderch's pencilled rhythm on the laminated card holds Nell Carrow's breathing level to the final seal."}}, {"n": 5, "drive": {"a": "Keeps", "d": "Nell Carrow wipes the laminated card on a sleeve and, instead of burying the laminated card back in the drawer beneath the Holmsey inquiry findings, stands the laminated card upright against the work boots by the door."}, "react": {"a": "Stirs", "d": "Nell Carrow picks up the phone one last time. On the tide app, the Wrenham gauge line has lifted a hair above prediction. Nell Carrow notes the gap, says nothing, and does not look away from the screen."}}]},
  FF4: {"no": 4, "title": "Wrenham Goes Dark", "slug": "INT. AGENCY CONTROL ROOM - NIGHT", "turnAt": 4, "driverLabel": "DILYS FENWICK", "reactorLabel": "GRAHAM PELL", "rows": [{"n": 1, "drive": {"a": "Verifies", "d": "Dilys Fenwick sees the Wrenham Sluice telemetry trace stutter on the control-room wall display. Dilys runs the standard handshake ping sequence, reads each timestamp aloud and types it into the fault log with the calm cadence of a routine night."}, "react": {"a": "Endorses", "d": "Graham Pell appears on the wall screen from a kitchen at home and nods at Dilys Fenwick's by-the-book fault entry. Graham Pell says a flaky link in a storm is nothing new and to carry on logging."}}, {"n": 2, "drive": {"a": "Escalates", "d": "Dilys Fenwick pulls up the surge model beside the dropping Wrenham Sluice signal and formally requests a field crew to Wrenham before the spring-tide peak, citing the procedure number from the Agency manual."}, "react": {"a": "Deflects", "d": "Graham Pell quotes the managed-retreat protocol back at Dilys Fenwick. No crews go into a drowned sector at night, and Wrenham Sluice is already on the retreat schedule. The request is denied, pleasantly."}}, {"n": 3, "drive": {"a": "Reroutes", "d": "Dilys Fenwick bypasses the dead fibre by patching the Wrenham Sluice link through the old backup radio relay by hand, and forces one last status packet onto the control-room screen. The packet shows hydraulic pressure falling and the sector gate hanging open."}, "react": {"a": "Reframes", "d": "Graham Pell reads the open-gate packet on the shared screen without a flicker. Graham Pell instructs Dilys Fenwick to code the event not as a failure but as 'asset decommissioned pending review.'"}}, {"n": 4, "drive": {"a": "Transmits", "d": "Dilys Fenwick types the Saltmere surge arrival time into the Wrenham Sluice channel, the accurate timing the manual says must reach the gate. As Dilys Fenwick hits send, the Wrenham trace flatlines on the wall display. The message sits undelivered, addressed to no one."}, "react": {"a": "Closes", "d": "Graham Pell watches the Wrenham Sluice trace die on the shared screen and tells Dilys Fenwick to close the incident. Saltmere drops to an evacuation advisory only, and Graham Pell's signature authority will cover it."}}, {"n": 5, "drive": {"a": "Transgresses", "d": "Dilys Fenwick enters Graham Pell's order into the log word for word. Then Dilys Fenwick opens the archived Wrenham Sluice staff roster, finds Emrys Prydderch's number, and copies it by hand onto a sticky note, off the record."}, "react": {"a": "Disengages", "d": "Graham Pell thanks Dilys Fenwick for a clean shift and ends the call. The wall screen goes black beside the dead Wrenham Sluice trace, and no one is left watching Saltmere."}}]},
  FF25: {"no": 25, "title": "Telemetry Blinks Back", "slug": "INT. AGENCY OPS ROOM - NIGHT", "turnAt": 4, "driverLabel": "GRAHAM PELL", "reactorLabel": "DILYS FENWICK", "rows": [{"n": 1, "drive": {"a": "Scrutinises", "d": "Graham Pell, passing behind the duty desk with a cold coffee, stops dead at Dilys Fenwick's console. Graham Pell leans in to watch the Wrenham Sluice tile on the telemetry wall stutter from grey to green, with a diesel load curve climbing beneath the tile."}, "react": {"a": "Reports", "d": "Dilys Fenwick reads the Wrenham Sluice handshake aloud by the book: controller live, relays cycling, gate actuator responding. Dilys Fenwick reaches for the Saltmere emergency line to flag that a closure may be possible before the surge."}}, {"n": 2, "drive": {"a": "Dismisses", "d": "Graham Pell lays two fingers on the Saltmere emergency handset and presses it back into the cradle before Dilys Fenwick can lift it. Graham Pell calls the Wrenham Sluice signal a sensor ghost from salt in a dead cabinet and tells Dilys Fenwick to tag it as a fault."}, "react": {"a": "Counters", "d": "Dilys Fenwick does not tag the Wrenham Sluice signal. Dilys Fenwick zooms the diesel load curve on the console and points out that a ghost does not draw fuel. Dilys Fenwick highlights the operator credential on the handshake: CARROW, N."}}, {"n": 3, "drive": {"a": "Isolates", "d": "Graham Pell reads the name CARROW, N. on the console without a flicker. Graham Pell quietly orders Dilys Fenwick to pull the Wrenham Sluice tile off the shared regional display 'so the night shift doesn't start rumours'."}, "react": {"a": "Complies", "d": "Dilys Fenwick drags the Wrenham Sluice tile off the regional wall so that it glows only on the duty console. Dilys Fenwick's other hand writes the timestamp in the paper watch log, where Graham Pell cannot delete it."}}, {"n": 4, "drive": {"a": "Commands", "d": "Graham Pell turns away from Dilys Fenwick and keys the secure field radio. Graham Pell orders Bram Szotak to take the RIB out to Wrenham Sluice tonight and 'make the site safe': isolate the actuator and pull the controller boards. Graham Pell's voice is level, but the knuckles on the radio handset have gone white."}, "react": {"a": "Probes", "d": "Bram Szotak's voice crackles back over the secure field radio asking for the order in writing, because there is a live signal and possibly people on site. Graham Pell answers that the order stands on regional director's authority and closes the channel before Bram Szotak can reply."}}, {"n": 5, "drive": {"a": "Buries", "d": "Graham Pell opens the archived Holmsey closure inquiry on the duty console and scrolls to Nell Carrow's signature on the final gate log. Graham Pell then instructs Dilys Fenwick to record Wrenham Sluice as unauthorised access by a dismissed operator, with no closure capability."}, "react": {"a": "Yields", "d": "Dilys Fenwick types the false entry word for word. Dilys Fenwick's finger hangs over the enter key while the Wrenham Sluice tile keeps blinking green on the duty console, then presses. The paper watch log stays open beside the keyboard."}}]},
  CB12: {"no": 12, "title": "Nobody Answering", "slug": "INT. DISPATCH ROOM - NIGHT", "turnAt": 4, "driverLabel": "MARISOL VEGA", "reactorLabel": "LUPE CARRILLO", "rows": [{"n": 1, "drive": {"a": "Braces", "d": "Marisol slides the headset back on at the console, still holding the fitness-evaluation form that carries the lie Marisol told Dr. Ingrid Paszek, and takes an incoming call stamped Tuesday the 14th."}, "react": {"a": "Pleads", "d": "Ray Halvorsen's voice hums through the headset from inside a cruiser pinned at the Salt Wash crossing, water rising, and breaks off with 'Why isn't anybody answering?' before the line drops to static."}}, {"n": 2, "drive": {"a": "Assembles", "d": "Marisol cues the logged calls on the console recorder one after another, Lupe Carrillo's call from 118 Mesquite Road, Arturo Benavides's call about the yard, and Ray Halvorsen's call from Salt Wash, and fast-forwards each one to its final seconds."}, "react": {"a": "Echoes", "d": "Every recording on the console recorder ends with the same words in a different voice, Lupe Carrillo crying 'Why isn't anybody answering?' over Tom\u00e1s Carrillo's coughing, and the recorder's waveform display shows only flat static under all three voices."}}, {"n": 3, "drive": {"a": "Gambles", "d": "Marisol breaks protocol and keys the transmit pedal into the dead line on Lupe Carrillo's call, pressing the headset mic to Marisol's lips and saying, 'I'm here, Lupe, I'm answering,' over and over."}, "react": {"a": "Ignores", "d": "Lupe Carrillo's voice on the recording goes on as if the dispatch room were empty, asking the ringing line why nobody picks up, and Marisol hears that from the 14th's side of the call, no one is sitting at the Tamarisk console at all."}}, {"n": 4, "drive": {"a": "Realizes", "d": "Marisol yanks the storm advisory off the fax tray, lays it beside the posted duty roster for Tuesday the 14th, and traces the phone trunk and generator line on the wall schematic with a finger, understanding that the storm will kill the Tamarisk console that night. Marisol stops listening to the dead line and uncaps a grease pencil."}, "react": {"a": "Yields", "d": "The static in the headset stops sounding like a verdict against Marisol's sanity and starts sounding like a timetable, as Marisol writes the time, address and caller name of every call of the 14th across the console's plexiglass map: Lupe Carrillo, 118 Mesquite Road, Tom\u00e1s Carrillo in the attic; Ray Halvorsen, Salt Wash crossing; Arturo Benavides, the yard."}}, {"n": 5, "drive": {"a": "Commits", "d": "Marisol unplugs the headset from the console, clips the handheld radio to Marisol's belt, pockets the truck keys and the grease-penciled route copied onto the back of the fitness-evaluation form, and circles Tuesday the 14th on the duty roster."}, "react": {"a": "Rings", "d": "The console lights with one more call dated the 14th, Lupe Carrillo's voice starting again, and Marisol lets it ring, no longer needing to hear the ending, because Marisol now plans to be standing at 118 Mesquite Road when Lupe Carrillo dials."}}]}
};
const bmOf = (k)=>{ const r = REAL[k]; return { driverLabel:r.driverLabel, reactorLabel:r.reactorLabel, desire:"", obstacle:"", result:"", turnAt:r.turnAt, rows:r.rows }; };
const sceneOf = (k)=>{ const r = REAL[k]; return { id:"real-"+k, no:r.no, act:1, title:r.title, loc:r.slug, driver:"x", summary:r.title, objective:"",
  openValue:"Calm", openCharge:1, closeValue:"Dread", closeCharge:-2 }; };
const PROJ_FF = { title:"Feature Film", format:"feature", genre:"thriller" };
const PROJ_CB = { title:"Callback", format:"series", genre:"drama" };

/* Opus-style replies on those beat maps, written the way the model writes screen text:
   CAPS LABEL: CAPS TEXT. Each [ "action", … ] line marked with ⚑ tripped the old rule. */
const FLAG = "⚑";
const R = {
  FF1: [
    [1, [["action","4:00. No alarm. NELL CARROW (40s) is awake anyway, one hand already groping across the bedside crate."],
         ["action","The phone's glow finds her face. She thumbs open the tide app before her eyes have focused."],
         ["action",FLAG+"ON THE SCREEN: SALTMERE GAUGE — TRACKING PREDICTION."],
         ["action","Nothing to do. Her thumb hovers anyway. Refresh. Refresh."]]],
    [2, [["action","She drops the phone face-down and pads into the dark kitchen."],
         ["action","The kettle. She fills it with her back to the drawer beneath the counter."],
         ["action","Steam fogs the window. In the black glass her reflection hangs over the drawer: the face from every news feed during the Holmsey inquiry."],
         ["action","She looks away. Too late."]]],
    [3, [["action","Nell yanks the drawer open. Digs past the folded inquiry findings to a laminated card, edges worn soft."],
         ["action",FLAG+"The header: WRENHAM SLUICE: SECTOR GATE CLOSURE. AUTHORISED OPERATORS ONLY."],
         ["action","Beneath it, in EMRYS PRYDDERCH's faded pencil: Count it aloud. The gate listens."],
         ["action","Her knuckles go white on the laminate."]]],
    [4, [["action","She props the card against the salt pot."],
         ["action","Palm flat on the table. Isolation. A twist of the wrist. Hydraulic bleed. Two fingers walk the gate leaves shut."],
         ["char","NELL"],["paren","under her breath, slow"],["dia","Seven. Eight. Nine."],
         ["action","Step nine. Where Holmsey went wrong. Her hands stop trembling."],
         ["char","NELL"],["dia","Ten. Seal."]]],
    [5, [["action","She wipes the card on her sleeve. Doesn't bury it. Stands it upright against the work boots by the door."],
         ["action","One last look at the phone."],
         ["action",FLAG+"WRENHAM GAUGE: ABOVE PREDICTION."],
         ["action","Nell notes the gap. Says nothing. Doesn't look away."]]],
  ],
  FF4: [
    [1, [["action","A wall of telemetry. One trace stutters: Wrenham Sluice."],
         ["action","DILYS FENWICK (50s) runs the handshake ping, reading each timestamp aloud as she types it into the fault log."],
         ["char","DILYS"],["dia","Oh-three-twelve. No return. Oh-three-thirteen. No return."],
         ["action","GRAHAM PELL (60s) appears on the wall screen, a kitchen behind him."],
         ["char","GRAHAM"],["dia","Flaky link in a storm. Log it and carry on."]]],
    [2, [["action","Dilys drags the surge model up beside the dropping signal."],
         ["char","DILYS"],["dia","Requesting a field crew to Wrenham before the peak. Procedure four-one-seven."],
         ["char","GRAHAM"],["paren","pleasantly"],["dia","Managed retreat, Dilys. No crews into a drowned sector at night."],
         ["action",FLAG+"STATUS: REQUEST DENIED."]]],
    [3, [["action","Dilys yanks a patch cable and reroutes Wrenham through the old backup radio relay by hand."],
         ["action",FLAG+"One packet crawls onto the screen. HYDRAULIC PRESSURE: FALLING. SECTOR GATE: OPEN."],
         ["char","GRAHAM"],["dia","Code it as asset decommissioned pending review."]]],
    [4, [["action","Dilys types the Saltmere surge arrival time into the Wrenham channel. Hits send."],
         ["action","The Wrenham trace flatlines."],
         ["action",FLAG+"MESSAGE STATUS: Undelivered."],
         ["char","GRAHAM"],["dia","Close the incident. Saltmere drops to advisory. My signature covers it."]]],
    [5, [["action","Dilys enters his order word for word."],
         ["action","Then she opens the archived Wrenham staff roster and finds a name: Emrys Prydderch."],
         ["action","She copies his number onto a sticky note. By hand."],
         ["char","GRAHAM"],["dia","Clean shift. Thank you, Dilys."],
         ["action","The wall screen goes black beside the dead trace. Nobody is watching Saltmere."]]],
  ],
  FF25: [
    [1, [["action","GRAHAM PELL passes behind the duty desk with a cold coffee, and stops."],
         ["action","On the telemetry wall the Wrenham Sluice tile stutters from grey to green. A diesel load curve climbs beneath it."],
         ["action",FLAG+"CONTROLLER: LIVE. RELAYS: CYCLING. ACTUATOR: RESPONDING."],
         ["action","Dilys reaches for the Saltmere emergency line."]]],
    [2, [["action","Two of Graham's fingers press the handset back into its cradle."],
         ["char","GRAHAM"],["dia","Salt in a dead cabinet. A ghost. Tag it as a fault."],
         ["action","Dilys doesn't tag it. She zooms the load curve."],
         ["char","DILYS"],["dia","Ghosts don't burn diesel."],
         ["action",FLAG+"She highlights the handshake. OPERATOR: CARROW, N."]]],
    [3, [["action","Graham reads the name without a flicker."],
         ["char","GRAHAM"],["paren","quietly"],["dia","Take it off the regional wall. The night shift doesn't need rumours."],
         ["action","Dilys drags the tile to her own console. Her other hand writes the time in the paper watch log."]]],
    [4, [["action","Graham turns away and keys the secure field radio."],
         ["char","GRAHAM"],["paren","into radio"],["dia","Bram. Take the RIB to Wrenham tonight. Make the site safe. Pull the boards."],
         ["char","BRAM SZOTAK (V.O.)"],["paren","filtered"],["dia","Put that in writing. There's a live signal. Could be people."],
         ["char","GRAHAM"],["dia","Regional director's authority. Out."],
         ["action","His knuckles are white on the handset."]]],
    [5, [["action","Graham opens the archived Holmsey inquiry and scrolls to a signature on the final gate log: Nell Carrow."],
         ["char","GRAHAM"],["dia","Record it as unauthorised access by a dismissed operator. No closure capability."],
         ["action",FLAG+"ENTRY: Unauthorised access by dismissed operator."],
         ["action","Her finger hangs over the enter key. The tile blinks green. She presses."],
         ["action","The paper watch log stays open beside the keyboard."]]],
  ],
  CB12: [
    [1, [["action","MARISOL VEGA (30s) slides the headset back on, the fitness-evaluation form still in her other hand."],
         ["action",FLAG+"CALL DATE: TUESDAY THE 14TH."],
         ["char","RAY HALVORSEN (V.O.)"],["paren","filtered, water roaring"],["dia","I'm pinned at Salt Wash. Why isn't anybody answering?"],
         ["action","Static."]]],
    [2, [["action","Marisol cues the logged calls on the recorder, one after another, and fast-forwards each to its last seconds."],
         ["char","LUPE CARRILLO (V.O.)"],["paren","recorded, crying"],["dia","Why isn't anybody answering?"],
         ["action",FLAG+"ANI: BLANK. ALI: BLANK. Under every voice, flat static."]]],
    [3, [["action","Marisol breaks protocol and stamps the transmit pedal into the dead line."],
         ["char","MARISOL"],["paren","into mic"],["dia","I'm here, Lupe. I'm answering. I'm here."],
         ["char","LUPE CARRILLO (V.O.)"],["dia","Why doesn't anybody pick up?"],
         ["action","From the 14th's side of the call, the Tamarisk console is empty."]]],
    [4, [["action","Marisol yanks the storm advisory off the fax tray and lays it beside the duty roster for Tuesday the 14th."],
         ["action","Her finger traces the phone trunk and the generator line on the wall schematic."],
         ["action","She stops listening. Uncaps a grease pencil."],
         ["action",FLAG+"CALLER: LUPE CARRILLO. ADDRESS: 118 MESQUITE ROAD."]]],
    [5, [["action","She unplugs the headset, clips the handheld radio to her belt, pockets the truck keys and the route on the back of the evaluation form."],
         ["action","She circles Tuesday the 14th on the roster."],
         ["action","The console lights. One more call dated the 14th."],
         ["action","Marisol lets it ring."]]],
  ],
};
const flagged = (segs)=>segs.flatMap(([,bl])=>bl).filter(([t,x])=>t==="action" && x.startsWith(FLAG)).map(([,x])=>x.slice(1));
const unflag = (segs)=>segs.map(([n,bl])=>[n, bl.map(([t,x])=>[t, x.startsWith(FLAG) ? x.slice(1) : x])]);

/* ======================= 1. the reproduced failing outputs ======================= */
await test("each reproduced screen/readout line is one the old rule rejected (so these ARE the incident)", ()=>{
  for(const k of Object.keys(R)){
    const lines = flagged(R[k]);
    assert.ok(lines.length>=3, k+" carries its readout lines");
    for(const l of lines) assert.ok(LEGACY_RE.test(l), k+": the legacy rule matched "+JSON.stringify(l));
  }
  // the real Sc 1 beat card itself hands the model a colon header
  assert.ok(LEGACY_RE.test(REAL.FF1.rows[2].react.d), "FF Sc 1 beat 3 text contains WRENHAM SLUICE: SECTOR GATE CLOSURE");
});

await test("FF Sc 1/4/25 and Callback Sc 12 (real beat maps, CAPS readouts) now validate and stay correctly structured", ()=>{
  for(const k of Object.keys(R)){
    const res = reply(unflag(R[k])), bm = bmOf(k);
    const v = box.resolveScreenplayResponse(res, sceneOf(k), bm, { requireAllBeats:true });
    assert.equal(v.valid, true, k+" issues: "+JSON.stringify(v.issues));
    // every readout line is still an ACTION block, word for word
    for(const l of flagged(R[k])) assert.ok(v.blocks.some(b=>b.type==="action" && b.text===l), k+" keeps as action: "+l);
    // every beat has prose, and cue→paren→dialogue bundles are intact
    const beatsPresent = new Set(v.blocks.filter(b=>b.type!=="scene").map(b=>Number(b.beat)));
    bm.rows.forEach(r=>assert.ok(beatsPresent.has(r.n), k+" beat "+r.n+" present"));
    v.blocks.forEach((b,i)=>{ if(b.type==="dia"){ let j=i-1; if(v.blocks[j].type==="paren") j--; assert.equal(v.blocks[j].type, "char", k+" dialogue keeps its cue"); } });
    // radio/recorded voices written as proper (V.O.) blocks are untouched
    if(k==="FF25") assert.ok(v.blocks.some(b=>b.type==="char" && b.text==="BRAM SZOTAK (V.O.)"));
    if(k==="CB12") assert.ok(v.blocks.filter(b=>b.type==="char" && /\(V\.O\.\)$/.test(b.text)).length===3);
  }
});

await test("Redraft script from beats (aiPolishScene) commits them, and the build's drafter writes them", async ()=>{
  for(const k of Object.keys(R)){
    reset();
    const scene = sceneOf(k), bm = bmOf(k), proj = k==="CB12" ? PROJ_CB : PROJ_FF;
    box.__replies = [reply(unflag(R[k]))];
    const report = {};
    const pol = await box.aiPolishScene(scene, bm, box.autoDraftScene(scene, bm, null).blocks, null, proj, report);
    assert.ok(pol && pol.polished && pol.blocks.length>10, k+" redraft committed");
    assert.equal(report.failure, undefined, k+" no failure recorded");
    box.__replies = [reply(unflag(R[k]))];
    const dr = await box.aiDraftScene(scene, bm, null, proj, [], [scene]);
    assert.equal(dr.ai, true, k+" build draft is a real screenplay, not a stand-in");
    assert.equal(dr.auto, false);
  }
});

/* ======================= 2. normalised into the right block types ======================= */
const SC = { id:"n1", no:9, title:"Norm", loc:"INT. OPS CENTRE - NIGHT" };
const types = (bl)=>bl.filter(b=>b.type!=="scene" || b.text!==box.slugText(SC.loc)).map(b=>b.type+"|"+b.text);
const one = (blocks, opts)=>box.resolveScreenplayResponse(reply([[1, blocks]]), SC, null, opts||{});
await test("misfiled screenplay devices are normalised (never reworded) into the right block types", ()=>{
  const v = one([
    ["char","SUPER"],["dia","WRENHAM, 4:07 A.M."],
    ["char","PHONE (ON SCREEN)"],["dia","KING TIDE ADVISORY — HIGH WATER 04:52"],
    ["char","PHONE SCREEN"],["action","The Wrenham gauge line runs flat from 03:58."],
    ["action","The phone buzzes. RECORDED VOICE: The person you are calling is not available."],
    ["action","VOICEMAIL: “You've reached Nina. Leave it after the beep.”"],
    ["action","CUT TO:"],
    ["action","SMASH CUT TO: EXT. SEA WALL - NIGHT"],
    ["scene","INSERT - PHONE SCREEN"],["action","TIDEWATCH — WRENHAM: NO DATA SINCE 03:58"],["scene","BACK TO SCENE"],
  ]);
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.deepEqual(plain(types(v.blocks)), [
    "action|SUPER: WRENHAM, 4:07 A.M.",
    "action|PHONE (ON SCREEN): KING TIDE ADVISORY — HIGH WATER 04:52",
    "action|PHONE SCREEN: The Wrenham gauge line runs flat from 03:58.",
    "action|The phone buzzes.",
    "char|RECORDED VOICE (V.O.)","dia|The person you are calling is not available.",
    "char|VOICEMAIL (V.O.)","dia|You've reached Nina. Leave it after the beep.",
    "trans|CUT TO:",
    "trans|SMASH CUT TO:","scene|EXT. SEA WALL - NIGHT",
    "action|INSERT - PHONE SCREEN","action|TIDEWATCH — WRENHAM: NO DATA SINCE 03:58","action|BACK TO SCENE",
  ]);
  assert.ok(v.normalized.length>=8, "each conversion is noted for admins: "+v.normalized.length);
});

await test("a real speaker's cue is never demoted to action, whatever device word it contains", ()=>{
  const cast = [{ name:"Bruce Banner" }, { name:"Nina Carrow" }];
  const pairs = [
    ["THIRD GUARD","Halt! Who goes there?"], ["THIRD WITCH","When shall we three meet again?"], ["FIRST GUARD","Halt!"],
    ["CARD DEALER","Place your bets."], ["SIGN LANGUAGE INTERPRETER","Thank you all for coming."],
    ["SUPER","Rent's due Friday."], ["TITLE","My lord, the carriage is here."], ["SCREEN","Access denied, Doctor."],
    ["BANNER","Stay back."], ["NINA (TEXT)","Where are you?"],
  ];
  const v = one(pairs.flatMap(([c,d])=>[["char",c],["dia",d]]), { cast });
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.deepEqual(plain(types(v.blocks)), pairs.flatMap(([c,d])=>["char|"+c, "dia|"+d]), "every cue + line stays a speaking character");
  assert.deepEqual(plain(v.normalized), []);
  // …and the Script check has nothing to say about them either
  const rep = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:SC.loc }, ...v.blocks] }, null);
  assert.deepEqual(plain(rep.issues), []);
});

await test("a nameless voice keeps only its own words; descriptions and named voices are never re-cued", ()=>{
  const cast = [{ name:"Nina Carrow" }, { name:"Dev Okafor" }, { name:"Bram Szotak" }, { name:"Lupe Carrillo" }];
  const v = one([
    ["action","The machine clicks. VOICEMAIL: \"You've reached Nina.\" Dev hangs up."],
    ["action","Dev listens. RADIO: Unit four, respond. Unit four. He doesn't move."],
    ["action","ANNOUNCER: Flights are delayed. The crowd groans and surges toward the desk."],
    ["action","Dev keys the radio. DISPATCH: All units, Salt Wash is closed."],
    ["action","RECORDED VOICE (distorted): Please hold."],
    ["action","TV: A reporter stands in front of the flooded quay."],
    ["action","RADIO: Static, then a burst of Spanish."],
    ["action","RECORDING: Lupe's 911 call plays, then cuts out."],
    ["action","INTERCOM: It crackles, then dies."],
  ], { cast });
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.deepEqual(plain(types(v.blocks)), [
    "action|The machine clicks.", "char|VOICEMAIL (V.O.)", "dia|You've reached Nina.", "action|Dev hangs up.",
    "action|Dev listens.", "char|RADIO (V.O.)", "dia|Unit four, respond. Unit four.", "action|He doesn't move.",
    "char|ANNOUNCER (V.O.)", "dia|Flights are delayed.", "action|The crowd groans and surges toward the desk.",
    "action|Dev keys the radio.", "char|DISPATCH (V.O.)", "dia|All units, Salt Wash is closed.",
    "char|RECORDED VOICE (V.O.)", "paren|distorted", "dia|Please hold.",
    "action|TV: A reporter stands in front of the flooded quay.",
    "action|RADIO: Static, then a burst of Spanish.",
    "action|RECORDING: Lupe's 911 call plays, then cuts out.",
    "action|INTERCOM: It crackles, then dies.",
  ]);
  // a voice label that names a cast member is that character's line: rejected, never a new speaker
  for(const [l, c] of [["BRAM OVER RADIO: Put it in writing.", cast], ["RADIO (BRAM): Put it in writing.", cast], ["PA: Flights are delayed.", [{ name:"Pa" }]]]){
    const w = one([["action", l]], { cast:c });
    assert.equal(w.valid, false, "rejected: "+l);
    assert.ok(!w.blocks.some(b=>b.type==="char"), "no invented cue for "+l+": "+JSON.stringify(types(w.blocks)));
  }
});

await test("radio / phone dialogue written as proper blocks with (V.O.) / (O.S.) / (FILTERED) is accepted untouched", ()=>{
  const segs = [[1, [
    ["action","Dev keys the desk radio."],
    ["char","DEV"],["dia","Wrenham, ops. Nina, talk to me."],
    ["char","NINA (V.O.)"],["paren","filtered, breathless"],["dia","Checking the housing. Stand by."],
    ["char","NINA (FILTERED)"],["dia","It's spray on the transducer."],
    ["char","HOLLIS (O.S.)"],["dia","Put her on speaker."],
    ["char","DISPATCHER (V.O.)"],["paren","over radio"],["dia","Unit four, respond."],
    ["char","NINA (V.O.) (CONT'D)"],["dia","Ten minutes."],
  ]]];
  const v = box.resolveScreenplayResponse(reply(segs), SC, null, {});
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.deepEqual(plain(types(v.blocks)), segs[0][1].map(([t,x])=>t+"|"+x));
});

await test("admins see what the normaliser tidied in an ACCEPTED reply (console); nobody else is bothered", async ()=>{
  const scene = sceneOf("FF1"), bm = bmOf("FF1");
  const tidy = reply(unflag(R.FF1).map(([n,bl])=>[n, n===1 ? [["char","SUPER"],["dia","WRENHAM, 4:00 A.M."], ...bl] : bl]));
  reset(); box.turnIsAdmin = true; box.__replies = [tidy];
  assert.ok(await box.aiPolishScene(scene, bm, [], null, PROJ_FF, {}), "committed");
  assert.equal(box.__infos.length, 1);
  assert.ok(String(box.__infos[0][0]).startsWith("[screenplay] Scene 1 redraft: tidied 1 element") && box.__infos[0][1][0].includes("SUPER"));
  reset(); box.__replies = [tidy];
  assert.ok(await box.aiPolishScene(scene, bm, [], null, PROJ_FF, {}));
  assert.equal(box.__infos.length, 0, "non-admins get no console noise");
  assert.ok(box.__lastScreenplayNormalized.notes[0].includes("SUPER"), "…but the newest notes stay inspectable");
});

/* ======================= 3. format devices ======================= */
await test("documentary, commercial and music-video devices pass (and VO becomes a narrator cue)", ()=>{
  const lines = {
    commercial:["SUPER: FREE ON iOS AND ANDROID","END CARD: TIDEWATCH. KNOW BEFORE IT COMES.","DISCLAIMER: Terms apply."],
    documentary:["ARCHIVE: Newsreel of the 1953 flood, sandbags on the quay.","INTERVIEW — HARBOUR MASTER: The gauge never lies.",
      "LOWER THIRD: DR. ELLIS HART, OCEANOGRAPHER","CHYRON: WRENHAM, 31 JANUARY 1953","TITLE CARD: THE GAUGE"],
    musicvideo:["VERSE 1: The artist in the lamp room.","CHORUS: The artist walks the sea wall as spray explodes behind her.",
      "PRE-CHORUS: Performance, lens-close.","BRIDGE: Narrative — the flood siren, slow motion.","PERFORMANCE: The artist to camera."],
  };
  for(const [fmt, ls] of Object.entries(lines)) for(const l of ls){
    const v = one([["action", l]]);
    assert.equal(v.valid, true, fmt+" "+l+" "+JSON.stringify(v.issues));
    assert.ok(v.blocks.some(b=>b.type==="action" && b.text===l), fmt+" stays an action line: "+l);
  }
  const vo = one([["action","VO: Know before it comes."]]);
  assert.equal(vo.valid, true);
  assert.deepEqual(plain(types(vo.blocks)), ["char|NARRATOR (V.O.)","dia|Know before it comes."]);
});

/* ======================= 4. genuine smuggled dialogue vs readouts ======================= */
const CAST = [{ id:"nina", name:"Nina Carrow" }, { id:"dev", name:"Dev Okafor" }];
const BM2 = (l)=>({ rows:[{ n:1, drive:{ d:"ops centre hums" }, react:{ d:"" } }, { n:2, drive:{ d:l }, react:{ d:"" } }] });
const verdict = (l, cast)=>box.resolveScreenplayResponse(reply([[1, [["action","The ops centre hums."]]], [2, [["action", l]]]]), SC, BM2(l), { requireAllBeats:true, cast:cast||CAST });
const assertRejected = (l, cast)=>{
  const v = verdict(l, cast);
  assert.equal(v.valid, false, "rejected: "+l);
  assert.deepEqual(plain(v.issues), ["character cue or dialogue embedded in action"], l);
  const d = v.details.find(x=>x.issue==="character cue or dialogue embedded in action");
  assert.ok(d && d.text===l && d.beat===2, "details name the line and beat: "+JSON.stringify(d));
};
const assertAccepted = (l, cast)=>{ const v = verdict(l, cast); assert.equal(v.valid, true, "accepted: "+l+" "+JSON.stringify(v.issues)); };
const SMUGGLED = [
  "MARCUS: Sorry, sir.",                            // unknown speaker, plainly spoken
  "DEV: Wrenham, ops. Nina, talk to me.",           // a cast member
  "DEV (into radio): Wrenham, ops.",                // cue extension (the old rule missed this)
  "Dev: Wrenham, ops.",                             // mixed-case cast name (the old rule missed this)
  "BRAM (V.O.): Need that in writing.",             // V.O. extension (the old rule missed this)
  "MARA: “Stop.”",                        // quoted line
  "GUARD: Hands where I can see them.",             // person-role label
  "Nina turns at the door. NINA: Go back to bed.",  // mid-paragraph
];
await test("genuine dialogue smuggled into action is STILL rejected (with the offending line and beat)", ()=>{
  for(const l of SMUGGLED) assertRejected(l);
});

await test("a device or voice word in the label, or in a cast name, never hides a character's line", ()=>{
  const FF = [{ name:"Graham Pell" }, { name:"Dilys Fenwick" }, { name:"Bram Szotak" }, { name:"Nina Carrow" }];
  for(const l of ["ON SCREEN - GRAHAM: Flaky link in a storm.", "GRAHAM ON SCREEN: Flaky link in a storm.", "WALL SCREEN - GRAHAM: Flaky link.",
    "PHONE - DILYS: Graham, it's open.", "MAN ON SCREEN: You have been warned.", "GUARD ON MONITOR: Stay where you are!",
    "PHONE: Where are you? Answer me!", "INTERVIEW - NINA: The gauge never lies.", "Graham appears on the wall screen. GRAHAM: Flaky link in a storm.",
    "GRAHAM (ON SCREEN): Flaky link in a storm."])
    assertRejected(l, FF);
  // names that contain a device / voice / direction word are still people
  for(const [l, name] of [["BELL: Get out of there, now!","Rosa Bell"], ["ROSA: Get out of there.","Rosa Bell"], ["PAGE: Over here.","Ellen Page"],
    ["SONG: Wait for me.","Min-jun Song"], ["BANNER: Stay back.","Bruce Banner"], ["HOOK: Bring me the boy.","Captain Hook"],
    ["CARD: Deal me in.","Card"], ["HORN: Hold the line.","Horn"], ["BRIDGES: I told you.","Jeff Bridges"], ["CLOSE: Not yet.","Glenn Close"],
    ["PA: Supper's on.","Pa"]])
    assertRejected(l, [{ name }]);
});

await test("spoken lines from unknown or minor speakers are caught in ANY sentence of the label's text", ()=>{
  for(const l of ["MARCUS: Hold it. I said hold it!", "MARCUS: Two minutes. Do you copy?", "KOWALSKI: Negative. We have no visual.",
    "HOLLIS: Last orders. Come on, you lot, out.", "GUARD: Hands up. Now.", "GUARD: HALT!", "CARD DEALER: Place your bets.",
    "THIRD WITCH: When shall we three meet again?", "MARCUS (40s) waits at the gate. MARCUS: The gate is open."])
    assertRejected(l, []);
});

await test("a readout never merges into the next speaker's label, and a shouted CAPS line still counts", ()=>{
  for(const l of ["The phone lights up: MISSED CALL. NINA: Pick up, pick up.", "SCREEN: LOW BATTERY. NINA: Charge it.",
    "WRENHAM GAUGE: ABOVE PREDICTION. NINA: Seven. Eight. Nine.", "DEV: GET DOWN!", "Dev turns. DEV: GET DOWN.", "NINA: NO."])
    assertRejected(l);
  assertAccepted("NINA: Charge it.".replace("NINA: Charge it.", "SCREEN: LOW BATTERY."));
});

await test("incident-style readouts pass: role + a name, a name + number, 'US', telegraphic app text, field labels", ()=>{
  for(const l of ["SLUICE ENGINEER: Emrys Prydderch, 07700 900123.", "DUTY MANAGER: Graham Pell.", "ASSIGNED OFFICER: Ray Halvorsen, Salt Wash crossing.",
    "ASSIGNED OFFICER: Ray Halvorsen, last seen at the Salt Wash crossing.", "SLUICE ENGINEER: Emrys Prydderch, on call until the end of the shift.",
    "DRIVER: Tomás Carrillo.", "ORIGIN: US Coast Guard relay.", "SOURCE: Unknown, possibly US military.", "CALLER: Lupe Carrillo, 118 Mesquite Road.",
    "TIDEWATCH: Wrenham gauge running high.", "TIDEWATCH: Move to higher ground.", "TIDEWATCH: No data since 03:58.", "CALLER ID: Unknown number.",
    "OPERATOR: CARROW, N. Graham doesn't react.", "ANI: BLANK. ALI: BLANK. Under every voice, flat static.", "SCREEN: Retry connection?",
    "WARNING: Do not enter!", "ENTRY: Unauthorised access by dismissed operator.", "NINA'S PHONE: 2 MISSED CALLS", "CLOSE ON: NINA's hands."])
    assertAccepted(l, [{ name:"Graham Pell" }, { name:"Nell Carrow" }, { name:"Nina Carrow" }]);
});

await test("a message a cast member SENDS, shown on a phone, passes — a call or a video caller does not", ()=>{
  for(const l of ["INSERT — PHONE: NINA: Where are you?", "A text from DEV: Where are you?", "ON SCREEN — a message from NINA: Call me back.",
    "The phone lights up. NINA: Wrenham's dark. Call me.", "EMAIL FROM NINA: I'm done.", "TEXT — DEV: On my way.", "NINA (TEXT): Where are you?"])
    assertAccepted(l);
  for(const l of ["Dev picks up the phone. NINA: Where are you?", "The phone rings. NINA: Hello?", "ON SCREEN: NINA (V.O.): Where are you?"])
    assertRejected(l);
});

await test("an unknown NAME: + plain sentence is accepted (it may be a readout) and the drafter checks the WORKING cast", async ()=>{
  assertAccepted("MARCUS: The gate is open.", []);
  assertAccepted("MARCUS: Open the gate.", []);
  // the build drafts before the live cast syncs: its working cast must reach the check.
  // EMRYS has no cue in this reply and is not the driver/reactor — only the cast knows him.
  reset();
  const scene = sceneOf("FF25"), bm = bmOf("FF25");
  const withEmrys = reply(unflag(R.FF25).map(([n,bl])=>[n, n===4 ? [...bl, ["action","EMRYS: Put it in writing first."]] : bl]));
  box.__replies = [withEmrys];
  const blind = await box.aiDraftScene(scene, bm, null, PROJ_FF, [], [scene]);
  assert.equal(blind.auto, false, "without the cast, EMRYS: + a plain sentence could be a readout: accepted");
  box.__replies = [withEmrys];
  const dr = await box.aiDraftScene(scene, bm, null, PROJ_FF, [{ name:"Emrys Prydderch" }], [scene]);
  assert.equal(dr.auto, true, "the working cast makes EMRYS a speaker: rejected");
  assert.ok(dr.failure.details.some(d=>d.text==="EMRYS: Put it in writing first."));
});

/* ======================= 5. the Script check agrees with the writers ======================= */
await test("the Script check warns on exactly what the writers reject; an unclear line is an uncounted note", ()=>{
  const devices = Object.values(R).flatMap(flagged).concat(["INSERT - PHONE: KING TIDE ADVISORY","SUPER: 4:07 A.M.","OPERATOR: CARROW, N."]);
  const rep = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:"INT. OPS CENTRE - NIGHT" }, ...devices.map(t=>({ beat:1, type:"action", text:t }))] }, null);
  assert.deepEqual(plain(rep.issues), [], "no warning or note on devices");
  box.turnCast = CAST;
  const rep2 = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:"INT. OPS CENTRE - NIGHT" }, ...SMUGGLED.map(t=>({ beat:1, type:"action", text:t }))] }, null);
  box.turnCast = undefined;
  assert.equal(rep2.issues.filter(x=>x.code==="dialogue-in-action").length, SMUGGLED.length);
  // a spoken nameless voice left in action warns (the writers would have re-cued or rejected it)
  const rv = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:SC.loc }, { beat:1, type:"action", text:"RADIO: Unit four, respond." }] }, null);
  assert.deepEqual(plain(rv.issues.map(x=>x.code)), ["dialogue-in-action"]);
  // an unknown NAME: + plain sentence: a "Check this line" note, not a warning, not counted
  const sc = { id:"u1", no:3, title:"U", loc:"INT. GATEHOUSE - NIGHT" };
  const d = { blocks:[{ beat:1, type:"scene", text:sc.loc }, { beat:1, type:"action", text:"MARCUS: The gate is open." }] };
  const ru = box.screenplayFormatReport(sc, d, null);
  assert.deepEqual(plain(ru.issues.map(x=>[x.code, x.severity])), [["check-action-label","info"]]);
  assert.ok(ru.issues[0].message.includes("MARCUS"));
  assert.equal(ru.stats.warnings, 0); assert.equal(ru.stats.notes, 1);
  assert.deepEqual(plain(box.sceneMissing(sc, { u1:d })), [], "the scene is not listed as having dialogue in action");
});

await test("for every line in this file, 'the writers reject it' and 'the Script check warns' are the same answer", ()=>{
  const lines = [...SMUGGLED, ...Object.values(R).flatMap(flagged), "MARCUS: The gate is open.", "TIDEWATCH: Wrenham gauge running high.",
    "RADIO: Unit four, respond.", "INSERT — PHONE: NINA: Where are you?", "DEV: GET DOWN!", "SLUICE ENGINEER: Emrys Prydderch, 07700 900123.",
    "PHONE: Where are you? Answer me!", "TV: A reporter stands in front of the flooded quay.", "GUARD: HALT!", "SCREEN: LOW BATTERY. NINA: Charge it."];
  box.turnCast = CAST;
  for(const l of lines){
    const writers = !box.validateScreenplayBlocks([{ beat:1, type:"action", text:l }], null, { cast:CAST }).valid;
    const check = box.screenplayFormatReport(SC, { blocks:[{ beat:1, type:"scene", text:SC.loc }, { beat:1, type:"action", text:l }] }, null)
      .issues.some(x=>x.code==="dialogue-in-action");
    assert.equal(check, writers, l);
  }
  box.turnCast = undefined;
  // and a scene the writers just produced never shows the warning
  for(const k of Object.keys(R)){
    const v = box.resolveScreenplayResponse(reply(unflag(R[k])), sceneOf(k), bmOf(k), { requireAllBeats:true });
    const rep = box.screenplayFormatReport(sceneOf(k), { blocks:v.blocks }, bmOf(k));
    assert.deepEqual(plain(rep.issues.filter(x=>x.code==="dialogue-in-action")), [], k);
  }
});

/* ======================= 6. never silent, never misleading ======================= */
const SMUGGLED_REPLY = (k)=>reply(unflag(R[k]).map(([n,bl])=>[n, n===2 ? [...bl, ["action","GRAHAM: Leave it, Dilys. That's an order."]] : bl]));
const CM11 = "The studio's engine is briefly unavailable — please try again in a moment. (ref CM-11)";   // what non-admins' complete() throws
const CM14 = "The studio's engine is briefly unavailable — please try again in a moment. (ref CM-14)";
const PLAN = "Choose a plan to start creating — every generation runs on your plan's credits.";          // the proxy's 402, the user's own plan

await test("aiPolishScene / aiDraftScene / aiWriteBeatText / aiRecastDriver record WHY they came back empty-handed", async ()=>{
  reset();
  const scene = sceneOf("FF4"), bm = bmOf("FF4");
  const cases = [
    [SMUGGLED_REPLY("FF4"), "invalid"], ["", "empty"], ["Sorry, I can't help with that.", "unreadable"],
    [new Error("Writing model: Your credit balance is too low to access the API."), "credits"],   // an admin's raw provider error
    [new Error(CM11), "credits"], [new Error(PLAN), "plan"], [new Error(CM14), "service"],
    [new Error("Sign in to use the writing AI — it runs on your server."), "signin"],
  ];
  for(const [r, kind] of cases){
    box.__replies = [r]; const report = {};
    assert.equal(await box.aiPolishScene(scene, bm, [], null, PROJ_FF, report), null);
    assert.equal(report.failure && report.failure.kind, kind, "redraft failure kind for "+String(r).slice(0,40));
  }
  box.__replies = [reply(unflag(R.FF4))]; box.__truncateNext = true; const tr = {};
  assert.equal(await box.aiPolishScene(scene, bm, [], null, PROJ_FF, tr), null);
  assert.equal(tr.failure.kind, "truncated");
  // the build drafter: the stand-in carries the failure, but never persists it
  box.__replies = [SMUGGLED_REPLY("FF4")];
  const dr = await box.aiDraftScene(scene, bm, null, PROJ_FF, [], [scene]);
  assert.equal(dr.auto, true);
  assert.equal(dr.failure.kind, "invalid");
  assert.ok(!Object.keys(dr).includes("failure") && JSON.parse(JSON.stringify(dr)).failure===undefined && !("failure" in { ...dr }), "the failure is not saved with the draft");
  // write-missing-beat
  box.__replies = [reply([[3, [["action","GRAHAM: Code it. Now."]]]])]; const wb = {};
  assert.equal(await box.aiWriteBeatText(scene, bm, 3, { blocks:[{ beat:1, type:"char", text:"GRAHAM" }, { beat:1, type:"dia", text:"Log it." }] }, null, PROJ_FF, wb), null);
  assert.equal(wb.failure.kind, "invalid");
  assert.ok(box.__lastScreenplayFailure && box.__lastScreenplayFailure.kind==="invalid" && box.__lastScreenplayFailure.raw.includes("GRAHAM: Code it"));
  // driver recast: a reply with the wrong number of beats is a failure, not a half-recast
  const rows3 = JSON.stringify({ summary:"Dilys drives.", objective:"x", desire:"x", antagonism:"x", result:"x",
    rows:[1,2,3].map(n=>({ n, drive:{ a:"Acts", d:"Dilys acts "+n }, react:{ a:"Reacts", d:"Graham reacts "+n } })) });
  box.__replies = [rows3]; const rc = {};
  assert.equal(await box.aiRecastDriver(scene, bm, [{ id:"dilys", name:"Dilys Fenwick" }, { id:"graham", name:"Graham Pell" }], "dilys", "graham", PROJ_FF, rc), null);
  assert.equal(rc.failure.kind, "incomplete");
  assert.equal(box.screenplayFailureReason(rc.failure), "the rewrite came back with 3 of the scene’s 5 beats");
});

/* the REAL writer handlers from app.jsx (and runPolish from script.jsx), run against stubs */
const appSrc = read("app/app.jsx"), scriptSrc = read("app/script.jsx");
const fnSrc = (src, name, indent)=>{
  indent = indent || "  ";
  const start = src.indexOf("\n"+indent+"const "+name+" = ");
  assert.ok(start>=0, "found "+name);
  const end = src.indexOf("\n"+indent+"};", start);
  return src.slice(start+1, end+indent.length+3);
};
const APP_FNS = ["rememberRejection","draftOne","draftAll","polishScene","redraftScene","redraftAllStale","_offerDriverRecast"];
const makeApp = (scenes, bms, over)=>{
  scenes = Array.isArray(scenes) ? scenes : [scenes];
  const committed = [], calls = { updateScene:[], setBeatsMap:[], setDrafts:0 };
  let mutable = true;
  const env = {
    canMutateWritersRoom:()=>mutable, setPolishBusy:()=>{}, scenesInStoryOrder:(x)=>x.slice(), scenes,
    autoDraftScene:box.autoDraftScene, aiPolishScene:box.aiPolishScene, aiDraftScene:box.aiDraftScene, aiAuthorScene:null, aiAvailable:()=>true,
    project:PROJ_FF, characters:[{ id:"dilys", name:"Dilys Fenwick" }, { id:"graham", name:"Graham Pell" }],
    currentProjectId:"p1", projIdRef:{ current:"p1" }, writersRoomReadOnlyRef:{ current:false }, draftingRef:{ current:false },
    drafts:{}, setDrafts:()=>{ calls.setDrafts++; }, setDrafting:()=>{}, setScenes:()=>{}, setBeatsFor:()=>{},
    commitVersion:(id, d)=>{ committed.push({ id, d }); return true; }, stampDraft:(d)=>d,
    beatsMap:Object.fromEntries(scenes.map((s,i)=>[s.id, (Array.isArray(bms) ? bms[i] : bms)])),
    polishRetryRef:{ current:{} }, lastPolishFailureRef:{ current:null },
    redraftingAll:null, setRedraftingAll:()=>{}, staleMap:Object.fromEntries(scenes.map(s=>[s.id, ["summary"]])),
    setRecastBusy:()=>{}, updateScene:(...a)=>calls.updateScene.push(a), setBeatsMap:(...a)=>calls.setBeatsMap.push(a),
    ...(over||{}),
  };
  const names = Object.keys(env);
  const body = APP_FNS.map(n=>fnSrc(appSrc, n)).join("\n");
  const fn = vm.runInContext("(function("+names.join(",")+"){\n"+body+"\n return { "+APP_FNS.join(", ")+" }; })", box);
  return { ...fn(...names.map(n=>env[n])), committed, calls, env, setMutable:(v)=>{ mutable = v; } };
};

await test("a rejected Script-view redraft is never silent: one plain toast, draft unchanged, no vendor named", async ()=>{
  reset();
  const scene = sceneOf("FF4"), bm = bmOf("FF4"), app = makeApp(scene, bm);
  box.__replies = [SMUGGLED_REPLY("FF4")];
  assert.equal(await app.polishScene(scene, bm), false);
  assert.equal(app.committed.length, 0, "nothing replaced the current draft");
  assert.equal(box.__toasts.length, 1);
  const t = box.__toasts[0];
  assert.equal(t.t, "error");
  assert.equal(t.m, "Couldn’t redraft Scene 4 — the new draft broke screenplay format (a character’s line was written inside an action paragraph), so it was discarded. Your current draft is unchanged. Press Redraft again — the next attempt is told what the check rejected.");
  assert.ok(t.o && t.o.force, "the answer to a click is never de-duplicated away");
  assert.ok(!VENDOR_RE.test(t.m) && !t.m.includes("[admin"));
  assert.equal(box.__warns.length, 0, "non-admins get no technical console log");
  // admins also get the offending line and the technical reason — all inside the toast's 400 characters
  reset(); box.turnIsAdmin = true; box.__replies = [SMUGGLED_REPLY("FF4")];
  await app.polishScene(scene, bm);
  const a = box.__toasts[0].m;
  assert.ok(a.length<=400, "fits the toast: "+a.length);
  assert.ok(a.includes("[admin: beat 2: “GRAHAM: Leave it, Dilys. That's an order.” · invalid — format check rejected the reply"), a);
  assert.ok(!/claude|anthropic/i.test(a));
  assert.equal(box.__warns.length, 1);
  assert.ok(String(box.__warns[0][0]).startsWith("[screenplay] Scene 4 redraft: beat 2:") && box.__warns[0][1].raw.includes("GRAHAM: Leave it"));
  // an offending line longer than the budget is cut at a word, never mid-word
  const long = box.screenplayFailureMessage("redraft", 4, { kind:"invalid", issues:["character cue or dialogue embedded in action"],
    details:[{ issue:"character cue or dialogue embedded in action", beat:2, text:"GRAHAM: "+"Leave it alone now ".repeat(12) }], technical:"format check rejected the reply: character cue or dialogue embedded in action" }, { kept:"Your current draft is unchanged.", retryLabel:"press Redraft again", carries:true });
  const quoted = (long.match(/“([^”]*)…”/)||[])[1] || "";
  const original = "GRAHAM: "+"Leave it alone now ".repeat(12);
  assert.ok(long.length<=400 && quoted.length>40 && original.startsWith(quoted) && original.charAt(quoted.length)===" ", "cut at a word: "+long);
});

await test("pressing Redraft again tells the model what was rejected; a success forgets it", async ()=>{
  reset();
  const scene = sceneOf("FF4"), bm = bmOf("FF4"), app = makeApp(scene, bm);
  box.__replies = [SMUGGLED_REPLY("FF4"), SMUGGLED_REPLY("FF4"), reply(unflag(R.FF4)), reply(unflag(R.FF4))];
  await app.polishScene(scene, bm);
  await app.polishScene(scene, bm);
  assert.ok(!box.__prompts[0].includes("A PREVIOUS ATTEMPT AT THIS SCENE WAS REJECTED"), "the first press is the plain request");
  assert.ok(box.__prompts[1].includes("A PREVIOUS ATTEMPT AT THIS SCENE WAS REJECTED by the screenplay format check: character cue or dialogue embedded in action")
    && box.__prompts[1].includes("The rejected action line was: \"GRAHAM: Leave it, Dilys. That's an order.\""), "the second press carries the rejection and the line");
  assert.equal(await app.polishScene(scene, bm), true);
  assert.ok(box.__prompts[2].includes("A PREVIOUS ATTEMPT"), "still carried until a success");
  assert.equal(await app.polishScene(scene, bm), true);
  assert.ok(!box.__prompts[3].includes("A PREVIOUS ATTEMPT"), "a success clears it");
  // Draft with MUSE's stand-in primes the Redraft it points to
  reset();
  const app2 = makeApp(scene, bm);
  box.__replies = [SMUGGLED_REPLY("FF4"), reply(unflag(R.FF4))];
  await app2.draftOne(scene);
  assert.equal(box.__toasts.length, 1);
  assert.equal(box.__toasts[0].m, "Couldn’t draft Scene 4 — the new draft broke screenplay format (a character’s line was written inside an action paragraph), so it was discarded. A rough structural draft from its beats stands in. Press Redraft script from beats — the next attempt is told what the check rejected.");
  await app2.polishScene(scene, bm);
  assert.ok(box.__prompts[1].includes("A PREVIOUS ATTEMPT AT THIS SCENE WAS REJECTED"), "the redraft after a stand-in is told too");
  // scene ids repeat across films: another film's scene with the same id is NOT told
  reset();
  const shared = { current:{} };
  const filmA = makeApp(scene, bm, { polishRetryRef:shared, currentProjectId:"filmA" });
  const filmB = makeApp(scene, bm, { polishRetryRef:shared, currentProjectId:"filmB" });
  box.__replies = [SMUGGLED_REPLY("FF4"), reply(unflag(R.FF4))];
  await filmA.polishScene(scene, bm);
  await filmB.polishScene(scene, bm);
  assert.ok(!box.__prompts[1].includes("A PREVIOUS ATTEMPT") && !box.__prompts[1].includes("GRAHAM: Leave it"), "film A's rejected line never reaches film B's prompt");
});

await test("every failure kind reads honestly; provider billing is shown to admins only; a missing beat blames nobody's cards", async ()=>{
  const scene = sceneOf("FF25"), bm = bmOf("FF25"), app = makeApp(scene, bm);
  const kept = " Your current draft is unchanged. ";
  const expect = [
    // non-admin: the masked provider-account error stays masked, with its ref for support
    [false, new Error(CM11), "Couldn’t redraft Scene 25 — the writing service is briefly unavailable (ref CM-11)."+kept+"Press Redraft again in a moment; if it keeps failing, quote ref CM-11 to support."],
    [false, new Error(CM14), "Couldn’t redraft Scene 25 — the writing service is briefly unavailable (ref CM-14)."+kept+"Press Redraft again in a moment; if it keeps failing, quote ref CM-14 to support."],
    // the user's OWN plan (proxy 402)
    [false, new Error(PLAN), "Couldn’t redraft Scene 25 — your account has no plan credits left for writing."+kept+"Choose a plan or add credits, then press Redraft again."],
    [false, new Error("Sign in to use the writing AI — it runs on your server."), "Couldn’t redraft Scene 25 — you’re signed out of the writing service."+kept+"Sign in, then press Redraft again."],
    [false, "", "Couldn’t redraft Scene 25 — the writing model sent back an empty reply."+kept+"Press Redraft again in a moment."],
    [false, reply(unflag(R.FF25).filter(([n])=>n!==3)), "Couldn’t redraft Scene 25 — the new draft broke screenplay format (beat 3 was left unwritten), so it was discarded."+kept+"Press Redraft again — the next attempt is told what the check rejected."],
  ];
  for(const [admin, r, msg] of expect){
    reset(); box.turnIsAdmin = admin; box.__replies = [r];
    assert.equal(await app.polishScene(scene, bm), false);
    assert.deepEqual(box.__toasts.map(x=>x.m), [msg]);
    assert.ok(!VENDOR_RE.test(msg) && !/credit balance|out of credits|see the other message|beat card/i.test(msg), msg);
  }
  // admins are told it is the provider account
  reset(); box.turnIsAdmin = true; box.__replies = [new Error("Writing model: Your credit balance is too low to access the API.")];
  await app.polishScene(scene, bm);
  assert.ok(box.__toasts[0].m.startsWith("Couldn’t redraft Scene 25 — the writing provider’s account is out of credits. Your current draft is unchanged. Top up the provider account, then press Redraft again. [admin: credits — Writing model: Your credit balance is too low"), box.__toasts[0].m);
  reset(); box.__replies = [reply(unflag(R.FF25))]; box.__truncateNext = true;
  await app.polishScene(scene, bm);
  assert.ok(box.__toasts[0].m.includes("the writing model’s reply was cut off before the scene was finished"));
  // polishScene's own fallbacks: a writer that returns nothing, or throws, still explains itself
  for(const stub of [async ()=>null, async ()=>{ throw new Error("boom"); }]){
    reset();
    const app3 = makeApp(scene, bm, { aiPolishScene:stub });
    assert.equal(await app3.polishScene(scene, bm), false);
    assert.deepEqual(box.__toasts.map(x=>x.m), ["Couldn’t redraft Scene 25 — the writing service returned an error. Your current draft is unchanged. Press Redraft again in a moment."]);
  }
  // redraftScene (stale marker / Beats tab): exactly one message either way, never the old guess
  reset(); box.__replies = [SMUGGLED_REPLY("FF4")];
  assert.equal(await app.redraftScene(scene, bm, { confirm:false }), false);
  assert.equal(box.__toasts.length, 1);
  assert.ok(!box.__toasts[0].m.includes("may be unreachable"));
  reset(); box.__replies = [SMUGGLED_REPLY("FF4")];
  assert.equal(await app.redraftScene(scene, bm, { confirm:false, quiet:true }), false);
  assert.equal(box.__toasts.length, 0, "a batch caller (Redraft all) reports once itself");
  assert.equal(app.env.lastPolishFailureRef.current.kind, "invalid");
  reset(); box.__replies = [reply(unflag(R.FF25))];
  assert.equal(await app.redraftScene(scene, bm, { confirm:false }), true);
  assert.deepEqual(box.__toasts.map(x=>x.t), ["ok"]);
});

await test("a repeated failure is never swallowed by the toast de-dupe (the real appToast)", async ()=>{
  reset();
  const sunk = [];
  box.appToast = realToast; box.turnErrorSink = (m)=>{ sunk.push(m); return true; };
  const scene = sceneOf("FF25"), bm = bmOf("FF25"), app = makeApp(scene, bm);
  box.__replies = [errT(CM11), errT(CM11)];
  await app.polishScene(scene, bm);
  await app.polishScene(scene, bm);     // pressed again within the 30 s billing de-dupe window
  const redraftMsgs = sunk.filter(m=>m.startsWith("Couldn’t redraft Scene 25"));
  assert.equal(redraftMsgs.length, 2, "both presses answered: "+JSON.stringify(sunk));
  assert.equal(sunk.filter(m=>m===CM11).length, 1, "the service's own repeat is still collapsed");
  realToast("same message", "error"); realToast("same message", "error");
  assert.equal(sunk.filter(m=>m==="same message").length, 1, "de-dupe still works for everything else");
  reset();
});

await test("Draft with MUSE, Draft all and Redraft all name EACH failed scene with ITS reason", async ()=>{
  const s4 = sceneOf("FF4"), s25 = sceneOf("FF25"), s1 = sceneOf("FF1");
  // Draft with MUSE: a stand-in is announced
  reset();
  let app = makeApp(s25, bmOf("FF25"));
  box.__replies = [errT(CM14)];
  await app.draftOne(s25);
  assert.deepEqual(box.__toasts.filter(x=>x.m.startsWith("Couldn’t draft")).map(x=>x.m),
    ["Couldn’t draft Scene 25 — the writing service is briefly unavailable (ref CM-14). A rough structural draft from its beats stands in. Press Redraft script from beats in a moment; if it keeps failing, quote ref CM-14 to support."]);
  // Draft all: a format rejection and a service error are two different reasons
  reset();
  app = makeApp([s4, s25], [bmOf("FF4"), bmOf("FF25")]);
  box.__replies = [SMUGGLED_REPLY("FF4"), new Error(CM14)];
  await app.draftAll();
  assert.equal(box.__toasts.length, 1);
  assert.equal(box.__toasts[0].m, "2 scenes got a rough structural draft instead — Scene 4: the new draft broke screenplay format (a character’s line was written inside an action paragraph); Scene 25: the writing service is briefly unavailable (ref CM-14). Open each and press Redraft script from beats — the next attempt is told what the check rejected; if it keeps failing, quote ref CM-14 to support.");
  assert.ok(app.env.polishRetryRef.current["p1::"+s4.id] && !app.env.polishRetryRef.current["p1::"+s25.id], "only the format rejection is remembered for the redraft");
  // Redraft all: format, service, and a scene the film went read-only on — each its own reason
  reset();
  let owner = null;
  app = makeApp([s4, s25, s1], [bmOf("FF4"), bmOf("FF25"), bmOf("FF1")], {
    aiPolishScene: async (s, ...rest)=>{ const r = await box.aiPolishScene(s, ...rest); if(s.id===s1.id) owner.setMutable(false); return r; } });
  owner = app;
  box.__replies = [SMUGGLED_REPLY("FF4"), new Error(CM14), reply(unflag(R.FF1))];
  await app.redraftAllStale();
  assert.equal(box.__toasts.length, 1);
  // (the full reasons would pass 400 characters, so the short form is used — still one per scene)
  assert.equal(box.__toasts[0].m, "Redrafted 0 of 3 scenes — the rest are still marked and unchanged. Scene 4: failed the screenplay format check; Scene 25: the service was unavailable (ref CM-14); Scene 1: the film became read-only, so it was left as is. Redraft them again — the next attempt is told what the check rejected; if it keeps failing, quote ref CM-14 to support.");
  assert.ok(box.__toasts[0].m.length<=400);
  // many scenes, many reasons: still one message inside the toast, each scene with its own reason
  const many = box.screenplayBatchFailureMessage("Redrafted 0 of 6 scenes — the rest are still marked and unchanged. ", [
    { no:1, failure:{ kind:"invalid", issues:["character cue or dialogue embedded in action"] } }, { no:2, failure:{ kind:"service", ref:"CM-14" } },
    { no:3, failure:{ kind:"truncated" } }, { no:4, failure:{ kind:"plan" } }, { no:5, failure:{ kind:"empty" } }, { no:6, failure:{ kind:"invalid", issues:["missing screenplay section for beat 2"] } }],
    { next:"Redraft them again", carries:true });
  assert.equal(many, "Redrafted 0 of 6 scenes — the rest are still marked and unchanged. Scenes 1, 6: format check; Scene 2: service (ref CM-14); Scene 3: cut off; Scene 4: plan credits; Scene 5: empty reply. Redraft them again — the next attempt is told what the check rejected; choose a plan or add credits first; shorten long beat cards; if it keeps failing, quote ref CM-14 to support.");
  assert.ok(many.length<=400, many.length);
  assert.ok(box.__toasts[0].o && box.__toasts[0].o.force);
  // admins get the technical tail without pushing the summary past the toast's 400 characters
  reset(); box.turnIsAdmin = true;
  app = makeApp([s4, s25], [bmOf("FF4"), bmOf("FF25")]);
  box.__replies = [SMUGGLED_REPLY("FF4"), new Error(CM14)];
  await app.draftAll();
  assert.ok(box.__toasts[0].m.length<=400 && box.__toasts[0].m.includes("[admin: beat 2: “GRAHAM: Leave it"), box.__toasts[0].m.length+" "+box.__toasts[0].m);
});

await test("a driver recast that comes back incomplete changes nothing and says why (never 'may be unreachable')", async ()=>{
  reset();
  const scene = { ...sceneOf("FF4"), driver:"graham" }, bm = bmOf("FF4");
  const app = makeApp(scene, bm);
  const rows = (k)=>JSON.stringify({ summary:"Dilys drives.", objective:"o", desire:"d", antagonism:"a", result:"r",
    rows:Array.from({ length:k }, (_,i)=>({ n:i+1, drive:{ a:"Acts", d:"Dilys acts "+(i+1) }, react:{ a:"Reacts", d:"Graham reacts "+(i+1) } })) });
  box.__replies = [rows(3)];
  await app._offerDriverRecast(scene.id, "graham", "dilys");
  assert.equal(app.calls.updateScene.length + app.calls.setBeatsMap.length, 0, "nothing applied");
  assert.deepEqual(box.__toasts.map(x=>x.m), ["Couldn’t recast Scene 4 — the rewrite came back with 3 of the scene’s 5 beats. Nothing was changed. Set the driver back and forth to retry."]);
  reset(); box.__replies = [errT(CM14)];
  await app._offerDriverRecast(scene.id, "graham", "dilys");
  assert.ok(box.__toasts.some(x=>x.m==="Couldn’t recast Scene 4 — the writing service is briefly unavailable (ref CM-14). Nothing was changed. Set the driver back and forth to retry in a moment; if it keeps failing, quote ref CM-14 to support."), JSON.stringify(box.__toasts));
  reset(); box.__replies = [rows(5)];
  await app._offerDriverRecast(scene.id, "graham", "dilys");
  assert.equal(app.calls.setBeatsMap.length, 1, "a complete recast applies");
  assert.ok(box.__toasts.some(x=>x.t==="ok" && x.m.startsWith("Scene 4 recast for Dilys Fenwick")));
  assert.ok(!appSrc.includes("Couldn\\u2019t recast the scene \\u2014 the writing model may be unreachable"));
});

await test("the Script view's own paths explain themselves (runPolish throw, write-missing-beat)", async ()=>{
  const body = fnSrc(scriptSrc, "runPolish", "    ");
  const make = (onPolish)=>vm.runInContext("(function(readOnly,polishing,live,setPolishing,setPolishWait,setJustPolished,onPolish,scene,beats){\n"+body+"\n return runPolish; })", box)
    (false, false, true, ()=>{}, ()=>{}, ()=>{}, onPolish, { no:7 }, null);
  reset();
  await make(async ()=>{ throw new Error("unexpected"); })();
  assert.deepEqual(box.__toasts.map(x=>x.m), ["Couldn’t redraft Scene 7 — something went wrong. Your current draft is unchanged; press Redraft again."]);
  reset();
  await make(async ()=>false)();
  assert.equal(box.__toasts.length, 0, "a reported failure is not announced twice");
  assert.ok(scriptSrc.includes("aiWriteBeatText(scene, beats, n, screenplay, prevScene, project, report)") &&
    scriptSrc.includes('window.screenplayFailureMessage("write beat "+n+" of", scene.no, report.failure'), "write-missing-beat names its reason");
  const m = box.screenplayFailureMessage("write beat 3 of", 4, { kind:"invalid", issues:["character cue without dialogue"] }, { kept:"The script is unchanged." });
  assert.equal(m, "Couldn’t write beat 3 of Scene 4 — the new draft broke screenplay format (a character name had no line after it), so it was discarded. The script is unchanged. Try again.");
  assert.ok(!appSrc.includes("Couldn\\u2019t redraft \\u2014 the writing model may be unreachable") && !appSrc.includes("the rest are still marked; the writing model may be unreachable"), "no more guessing copy on redraft");
  assert.ok(appSrc.includes("draftScene:(s,b,p,o)=>window.aiDraftScene(s,b,p,model.project,model.characters,model.scenes,o),"), "the build's retries reach the drafter");
});

await test("write-missing-beat never ships a cue without its line (the cap moves past an open bundle)", async ()=>{
  reset();
  const scene = sceneOf("FF1"), bm = bmOf("FF1");
  box.turnCast = CAST;
  box.__replies = [reply([[2, [["action","Nina's phone rings out on the counter."], ["action","The screen dims. VOICEMAIL: You've reached Nina. Leave a message."],
    ["action","Dev stares at it."], ["char","DEV"], ["dia","Pick up."]]]])];
  const r = await box.aiWriteBeatText(scene, bm, 2, { blocks:[{ beat:1, type:"char", text:"DEV" }, { beat:1, type:"dia", text:"Nina?" }] }, null, PROJ_FF, {});
  const ts = r.blocks.map(b=>b.type+"|"+b.text);
  assert.deepEqual(plain(ts.slice(-2)), ["char|DEV", "dia|Pick up."], JSON.stringify(ts));
  assert.ok(ts.includes("char|VOICEMAIL (V.O.)"));
});

/* ======================= 7. the story build ======================= */
async function build(k, replyFor, admin){
  reset(); box.turnIsAdmin = !!admin;
  const scene = sceneOf(k), bm = bmOf(k);
  const model = { scenes:[{ ...scene }], beats:{ [scene.id]:bm }, drafts:{}, characters:[], project:PROJ_FF };
  const events = []; let calls = 0;
  const ctx = { model, emit:(e)=>events.push(e), cancelled:()=>false, sync:()=>{}, switchedFilms:()=>false,
    ai:{ available:true, authorScene:async()=>null,
      draftScene:async (s,b,p,o)=>{ calls++; box.__replies = [replyFor(calls)]; return box.aiDraftScene(s,b,p,PROJ_FF,[],model.scenes,o); } } };
  const r = await box.writeScenesSeq(ctx, [0]);
  return { r, calls, events, draft:model.drafts[scene.id], prompts:box.__prompts.slice() };
}
await test("the build says WHY a stand-in landed, and its retries tell the model what to fix", async ()=>{
  for(const k of Object.keys(R)){ const b = await build(k, ()=>reply(unflag(R[k]))); assert.equal(b.calls, 1, k); assert.deepEqual(plain(b.r.failures), []); assert.equal(b.draft.ai, true); }
  const bad = await build("FF4", ()=>SMUGGLED_REPLY("FF4"));
  assert.equal(bad.calls, 3);
  assert.ok(!bad.prompts[0].includes("A PREVIOUS ATTEMPT AT THIS SCENE WAS REJECTED"));
  assert.ok(bad.prompts[1].includes("A PREVIOUS ATTEMPT AT THIS SCENE WAS REJECTED by the screenplay format check: character cue or dialogue embedded in action")
    && bad.prompts[1].includes("GRAHAM: Leave it, Dilys. That's an order."));
  assert.ok(bad.prompts[2].includes("A PREVIOUS ATTEMPT AT THIS SCENE WAS REJECTED"), "the automatic retry round carries it too");
  assert.deepEqual(plain(bad.r.failures.map(f=>f.why)), ["the model’s screenplay kept failing the format check (a character’s line was written inside an action paragraph), so a rough structural draft stands in — open it and redraft"]);
  assert.equal(bad.draft.auto, true);
  assert.ok(!Object.keys(bad.draft).includes("failure") && JSON.parse(JSON.stringify(bad.draft)).failure===undefined, "the stored stand-in carries no failure field");
  // the provider account (masked for non-admins) vs the user's own plan vs a transport error
  const cr = await build("FF1", ()=>new Error(CM11));
  assert.deepEqual(plain(cr.r.failures.map(f=>f.why)), ["the writing service was briefly unavailable (ref CM-11), so a rough structural draft stands in — open it and redraft in a moment"]);
  const pl = await build("FF1", ()=>new Error(PLAN));
  assert.deepEqual(plain(pl.r.failures.map(f=>f.why)), ["your account ran out of plan credits for writing, so a rough structural draft stands in — choose a plan or add credits, then open it and redraft"]);
  const tx = await build("FF1", ()=>new Error("Couldn't reach the writing model: Failed to fetch."));
  assert.deepEqual(plain(tx.r.failures.map(f=>f.why)), ["the model call kept failing, so a rough structural draft stands in — open it and redraft"]);
  const crA = await build("FF1", ()=>new Error("Writing model: Your credit balance is too low to access the API."), true);
  assert.ok(crA.r.failures[0].why.startsWith("the writing provider’s account ran out of credits, so a rough structural draft stands in — top it up, then open it and redraft [admin: credits"), crA.r.failures[0].why);
  const good = await build("FF25", (n)=> n===1 ? SMUGGLED_REPLY("FF25") : reply(unflag(R.FF25)));
  assert.equal(good.calls, 2); assert.deepEqual(plain(good.r.failures), []); assert.equal(good.draft.ai, true);
  assert.ok(good.events.some(e=>/didn't take/.test(e.t)));
  const adm = await build("FF4", ()=>SMUGGLED_REPLY("FF4"), true);
  assert.ok(adm.r.failures[0].why.includes("[admin: beat 2: “GRAHAM: Leave it, Dilys. That's an order.” · invalid — format check rejected the reply"), adm.r.failures[0].why);
  for(const f of [...bad.r.failures, ...cr.r.failures, ...pl.r.failures, ...tx.r.failures]){
    assert.ok(!VENDOR_RE.test(f.why), f.why);
  }
  assert.ok(!/credit/i.test(cr.r.failures[0].why), "a non-admin is never told the provider is out of credits");
});

/* ======================= 8. prompts, MUSE, downstream, cache keys ======================= */
const PROJECT_NOUNS = /WRENHAM|CARROW|KING TIDE|SALTMERE|PRYDDERCH|DILYS|GRAHAM/i;
await test("the writing prompts carry no project's names (placeholders only) and teach the accepted forms", async ()=>{
  const spec = vm.runInContext("BLOCK_SPEC", box);
  assert.ok(!PROJECT_NOUNS.test(spec), "BLOCK_SPEC is generic");
  assert.ok(spec.includes("ON-SCREEN TEXT is not dialogue") && spec.includes("INSERT — PHONE: <WHAT THE SCREEN SHOWS>") && spec.includes("A text from <NAME>: <message>") && spec.includes("(V.O.) or (O.S.)"));
  const note = box.screenplayRetryNote({ kind:"invalid", issues:["character cue or dialogue embedded in action"], details:[] });
  assert.ok(!PROJECT_NOUNS.test(note) && note.includes("A text from <NAME>: <message>"), "the retry note is generic too");
  const neutral = { id:"x1", no:2, title:"Harbour", loc:"INT. HARBOUR OFFICE - DAY", summary:"A clerk files a report.", openValue:"Calm", openCharge:1, closeValue:"Worry", closeCharge:-1 };
  const nbm = { driverLabel:"CLERK", reactorLabel:"", rows:[{ n:1, drive:{ a:"Files", d:"The clerk files a report." }, react:{ a:"Waits", d:"Nobody answers." } }] };
  reset(); box.__replies = ["", "", ""];
  await box.aiDraftScene(neutral, nbm, null, { title:"Other Film", format:"feature" }, [], []);
  await box.aiPolishScene(neutral, nbm, [], null, { title:"Other Film", format:"feature" }, {});
  await box.aiWriteBeatText(neutral, nbm, 1, { blocks:[{ beat:1, type:"action", text:"The office is quiet." }] }, null, { title:"Other Film", format:"feature" }, {});
  assert.equal(box.__prompts.length, 3);
  box.__prompts.forEach((p,i)=>assert.ok(!PROJECT_NOUNS.test(p), "prompt "+i+" leaks a project noun: "+(p.match(PROJECT_NOUNS)||[])[0]));
});

await test("APP_FEATURES: accurate about the Script check, no billing detail, no project names (and survives MUSE's filter)", ()=>{
  const brief = vm.runInContext("appBrief()", box);
  const at = brief.indexOf("Screenplay format check (on-screen text, inserts & honest failures)");
  assert.ok(at>=0);
  const entry = brief.slice(at, brief.indexOf("\n•", at+10) < 0 ? undefined : brief.indexOf("\n•", at+10));
  assert.ok(entry.includes("ON-SCREEN TEXT IS STANDARD FORMAT, NOT DIALOGUE") && entry.includes("NEVER SILENT") && entry.includes("Couldn't redraft Scene N"));
  assert.ok(entry.includes("STILL REJECTED: a character's spoken line packed into an action paragraph"));
  assert.ok(entry.includes("THE SCRIPT CHECK MATCHES THE WRITERS") && entry.includes("fires on exactly the lines the writers reject") && entry.includes("'Check this line' note"), "the Script check is described as it behaves");
  assert.ok(entry.includes("pressing Redraft again tells the model what the check rejected"));
  assert.ok(!entry.includes("follows the same rules, so on-screen text no longer triggers it"), "the overstated claim is gone");
  const raw = vm.runInContext("APP_FEATURES.find(f=>f.name.startsWith('Screenplay format check')).what", box);
  assert.ok(!/account is the problem|credit|billing|provider/i.test(raw), "no billing detail for MUSE to repeat");
  assert.ok(!PROJECT_NOUNS.test(raw), "no project's names");
  assert.ok(!/McKee|Anthropic|\bClaude\b/.test(entry));
});

await test("downstream readers ignore on-screen words: set dressing and who is physically in the shot", ()=>{
  const ff25 = unflag(R.FF25).flatMap(([,bl])=>bl).filter(([t])=>t==="action").map(([,x])=>x).join(" ");
  const ff4 = unflag(R.FF4).flatMap(([,bl])=>bl).filter(([t])=>t==="action").map(([,x])=>x).join(" ");
  const excl = { "graham pell":1, graham:1, pell:1, dilys:1, "dilys fenwick":1, fenwick:1 };
  const d25 = box.deriveUnitDressing(ff25, excl).map(x=>x.toLowerCase()), d4 = box.deriveUnitDressing(ff4, excl).map(x=>x.toLowerCase());
  for(const w of ["controller","live","relays","cycling","actuator","responding","operator","carrow"]) assert.ok(!d25.includes(w), "FF25 dressing has no readout word "+w+": "+d25);
  for(const w of ["status","request denied","hydraulic pressure","falling","sector gate","open","message status","entry"]) assert.ok(!d4.includes(w), "FF4 dressing has no readout word "+w+": "+d4);
  assert.ok(d4.includes("cable") && d4.includes("radio"), "real dressing survives: "+d4);
  assert.equal(box.screenplayStripScreenText("She highlights the handshake. OPERATOR: CARROW, N."), "She highlights the handshake.");
  const chars = [{ id:"dilys", name:"Dilys Fenwick" }, { id:"nell", name:"Nell Carrow" }, { id:"graham", name:"Graham Pell" }];
  const scene = { id:"s25", no:25, loc:"INT. AGENCY OPS ROOM - NIGHT" };
  const shot = (text)=>box.shotBeatScreenplay(scene, 2, { drafts:{ s25:{ blocks:[{ beat:1, type:"scene", text:scene.loc }, { beat:2, type:"action", text }] } }, characters:chars });
  const r = shot("She highlights the handshake. OPERATOR: CARROW, N.");
  assert.ok(!r.physicalCharacterIds.includes("nell") && r.mentionedCharacterIds.includes("nell"), "a name on a readout is a mention: "+JSON.stringify(r));
  assert.ok(shot("CLOSE ON: NELL CARROW's hands on the gate wheel.").physicalCharacterIds.includes("nell"), "a camera label still photographs her");
  assert.ok(shot("NELL CARROW (40s) sits up in the dark.").physicalCharacterIds.includes("nell"));
  assert.ok(shot("Nell reads the screen. OPERATOR: CARROW, N.").physicalCharacterIds.includes("nell"), "named in the room too: physical");
});

await test("script.jsx and ai.jsx load in step: shared cache key, never a pre-fix key, and a stale pair is reported", ()=>{
  const html = read("TURN.html");
  const key = (f)=>(html.match(new RegExp(f.replace(/\./g, "\\.")+"\\?v=([^\"']+)")) || [])[1] || "";
  const STALE = ["20260925-redraft1", "20260927-merge1", "20260927-tablocks2", "20260927-spcheck1", "20260926-decisions1", "20260911-shot-screenplay"];
  for(const f of ["app/script.jsx", "app/ai.jsx", "app/agents.jsx", "app/app.jsx", "app/locations.jsx", "app/shot-screenplay.js"]){
    const k = key(f);
    assert.ok(k && !STALE.includes(k) && k.slice(0,8)>="20260927", f+" carries a post-fix cache key: "+k);
  }
  assert.equal(key("app/script.jsx"), key("app/ai.jsx"), "the classifier (script.jsx) and its callers (ai.jsx) are cached together");
  assert.equal(box.SP_LABELS_VERSION, vm.runInContext("SP_LABELS_EXPECTED", box));
  reset();
  assert.equal(box.screenplayLabelsInStep(), true);
  const v = box.SP_LABELS_VERSION; box.SP_LABELS_VERSION = undefined;
  assert.equal(box.screenplayLabelsInStep(), false);
  assert.ok(box.__warns.some(w=>/out of step/.test(String(w[0]))), "a stale script.jsx is reported, not silent");
  box.SP_LABELS_VERSION = v;
});

console.log(`${checks} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
