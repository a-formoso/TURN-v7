#!/usr/bin/env node
/* test-frances-voice-limit.mjs — Frances's daily question limit COVERS NEW STORY VOICE (owner
   decision 2026-09-29): each live voice session uses one of the same 50 free daily questions as
   the chat. Offline (no network, no Supabase project, no credentials), this proves:
     P. THE PROXY — the REAL supabase/functions/image-proxy/index.ts (Node type stripping), with a
        stub Supabase client whose service-role RPC reaches the real supabase/frances-daily-limit.sql
        on PGlite, and a stub session endpoint: a voice session takes ONE slot (through the same
        limiter and turn_frances_consume as the text task) before the session call; voice and typed
        questions share one count; at the limit → 429 "frances_daily_limit" (limit / used /
        resets_at) and NO session call; invalid requests take no slot; FRANCES_DAILY_LIMIT applies;
        admins are exempt; fail-open (function missing, no service key, a hung call) opens the
        session and logs once; a burst → 429 "frances_busy", nothing counted, no session call; and
        nothing else in the live path changed. Skipped (not failed) on a Node without type
        stripping or module.registerHooks.
     L. THE CLIENT — app/livevoice.js in node:vm with WebRTC stubs, counting down with the real
        francesBackIn from app/ai.jsx: the limit and busy answers become calm lines (Error.code
        says which), asked once, never retried, the microphone released; other errors and the
        normal path are unchanged; New Story shows the line; the typed interview isn't counted.
     F. What Frances knows (APP_FEATURES → museFacts) and the docs quote the client's exact lines;
        every place naming the number agrees; no vendor, codename or server words reach the user.

   node scripts/test-frances-voice-limit.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";
import * as nodeModule from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { FRANCES_DAILY_LIMIT_DEFAULT } from "../supabase/functions/image-proxy/frances-limit.mjs";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (f)=>readFileSync(ROOT + f, "utf8");
const SQL = read("supabase/frances-daily-limit.sql");
let checks = 0, failed = 0, skipped = 0;
const test = async (name, fn)=>{
  try{ await fn(); checks++; console.log("PASS", name); }
  catch(e){ failed++; console.log("FAIL", name, "\n   ", String((e && e.stack) || e).split("\n").slice(0, 8).join("\n    ")); }
};
const skip = (name, why)=>{ skipped++; console.log("SKIP", name, "—", why); };
const j = (x)=>JSON.stringify(x);
const noop = ()=>{};

// the exact user-facing lines (the client's; the docs and Frances's facts must quote them)
const LIMIT_LINE_5H = "That’s today’s 50 free questions with Frances — voice included. She’ll be back after midnight UTC (in about 5 hours). You can use the typed interview in the meantime.";
const BUSY_LINE = "One conversation at a time, please — try again in a moment.";

/* ======================= the SQL on PGlite (as in test-frances-limit.mjs) ======================= */
const SUPABASE_STUB = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$f$;
create or replace function auth.role() returns text language sql stable as $f$
  select nullif(coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                         (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')), '')::text
$f$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;
const U = {
  alice: "a11ce000-0000-4000-8000-000000000001", bob: "b0b00000-0000-4000-8000-000000000002",
  carol: "ca201000-0000-4000-8000-000000000003", dave: "da7e0000-0000-4000-8000-000000000004",
  erin:  "e2100000-0000-4000-8000-000000000005", admin: "ad000000-0000-4000-8000-0000000000ad",
};
const runFile = async (db)=>{ try{ await db.exec(SQL); return { ok:true }; }catch(e){ await db.exec("rollback").catch(noop); return { ok:false, error:e.message }; } };
const usage = async (db, user)=>(await db.query(
  "select questions from public.turn_frances_usage where user_id = $1 and day = (now() at time zone 'UTC')::date", [user])).rows.map((r)=>r.questions)[0] ?? 0;

/* ======================= P. the real image-proxy index.ts ======================= */
const canRunTs = !!(process.features && process.features.typescript) && typeof nodeModule.registerHooks === "function";
if(!canRunTs){
  skip("P the real index.ts", "this Node ("+process.version+") has no type stripping or module.registerHooks; the static checks in P9 and F still run");
}else{
  const pdb = new PGlite();
  await pdb.exec(SUPABASE_STUB);
  for(const [name, id] of Object.entries(U)) await pdb.query("insert into auth.users(id, email) values ($1, $2)", [id, name+"@example.com"]);
  assert.ok((await runFile(pdb)).ok);
  const ENV = { SUPABASE_URL:"https://example.supabase.co", SUPABASE_ANON_KEY:"anon-key", SUPABASE_SERVICE_ROLE_KEY:"service-key",
    ANTHROPIC_API_KEY:"sk-test", OPENAI_API_KEY:"sk-live-test" };
  const USERS = { "tok-alice":{ id:U.alice, email:"alice@example.com" }, "tok-bob":{ id:U.bob, email:"bob@example.com" },
    "tok-carol":{ id:U.carol, email:"carol@example.com" }, "tok-dave":{ id:U.dave, email:"dave@example.com" },
    "tok-erin":{ id:U.erin, email:"erin@example.com" }, "tok-admin":{ id:U.admin, email:"admin@infinitestudioai.com" } };
  const W = { consume:null, rpcs:[], sessions:[], texts:[], warns:[], seq:[] };
  const pgliteConsume = async (name, args)=>{
    try{
      const r = await pdb.transaction(async (t)=>{
        await t.query("select set_config('request.jwt.claims', $1, true)", [j({ role:"service_role" })]);
        await t.exec("set local role service_role");
        return (await t.query(`select public.${name}(p_user => $1, p_limit => $2) as r`, [args.p_user, args.p_limit])).rows[0].r;
      });
      return { data:r, error:null };
    }catch(e){ return { data:null, error:{ message:e.message, code:e.code } }; }
  };
  const chain = (res)=>{ const c = { select:()=>c, eq:()=>c, gte:()=>c, limit:()=>c, order:()=>c, then:(ok, bad)=>Promise.resolve(res).then(ok, bad) }; return c; };
  globalThis.__francesVoiceTestCreateClient = (url, key)=>{
    if(!key) throw new Error("supabaseKey is required.");
    if(key === ENV.SUPABASE_ANON_KEY) return {
      auth:{ getUser:async (tok)=>USERS[tok] ? { data:{ user:USERS[tok] }, error:null } : { data:{ user:null }, error:{ message:"invalid token" } } },
      from:(t)=>t === "turn_credits" ? chain({ data:[{ plan:"studio", remaining:100 }], error:null })
        : t === "turn_usage_events" ? chain({ count:0, error:null }) : chain({ data:[], error:null }),
      // billing fixes (2026-09-30): Frances's cap follows the plan (5 / 15 / 30 / 50); a Producer keeps 50 here
      rpc:async (name, args)=>{ W.rpcs.push(["user", name, args]);
        if(name === "turn_credit_regime") return { data:[{ switched:false, usd_per_credit:"0.03" }], error:null };
        return { data:[{ remaining:100, plan:"studio" }], error:null }; },
    };
    if(key === ENV.SUPABASE_SERVICE_ROLE_KEY) return { rpc:(name, args)=>{ W.rpcs.push(["service", name, args]); W.seq.push("slot"); return (W.consume || pgliteConsume)(name, args); } };
    throw new Error("unexpected key "+key);
  };
  nodeModule.registerHooks({
    resolve(spec, ctx, next){
      if(spec === "https://esm.sh/@supabase/supabase-js@2")
        return { url:"data:text/javascript,export const createClient = (...a) => globalThis.__francesVoiceTestCreateClient(...a);", shortCircuit:true };
      return next(spec, ctx);
    },
  });
  let handler = null;
  globalThis.Deno = { serve:(h)=>{ handler = h; }, env:{ get:(k)=>ENV[k] } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init)=>{
    const u = String(url);
    if(u === "https://api.openai.com/v1/live/sessions"){
      W.seq.push("session");
      W.sessions.push({ body:JSON.parse(init.body), auth:init.headers.Authorization });
      return new Response(j({ session:{ id:"sess_"+W.sessions.length }, transport:{ type:"webrtc", sdp:"v=0\r\nanswer\r\n" } }),
        { status:201, headers:{ "content-type":"application/json" } });
    }
    if(u === "https://api.anthropic.com/v1/messages"){
      W.texts.push(JSON.parse(init.body));
      return new Response(j({ content:[{ type:"text", text:"Open Export in the top bar." }], usage:{ input_tokens:12, output_tokens:8 }, stop_reason:"end_turn" }),
        { status:200, headers:{ "content-type":"application/json" } });
    }
    throw new Error("network disabled in this test: "+u);
  };
  const realWarn = console.warn, realEmit = process.emitWarning;
  console.warn = (...a)=>{ W.warns.push(a.join(" ")); };
  process.emitWarning = noop;   // Node's note that index.ts is parsed as an ES module
  try{ await import(ROOT + "supabase/functions/image-proxy/index.ts"); }
  finally{ process.emitWarning = realEmit; }
  const post = async (token, body)=>{
    const res = await handler(new Request("https://example.supabase.co/functions/v1/image-proxy", {
      method:"POST", headers:{ Authorization:"Bearer "+token, "Content-Type":"application/json" }, body:j(body) }));
    return { status:res.status, headers:res.headers, json:await res.json() };
  };
  const OFFER = "v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\ns=-\r\n";
  const LIVE = (extra = {})=>({ task:"live", mode:"new-story", sdp:OFFER, context:{ formatLabel:"film" }, ...extra });
  const MUSE = ()=>({ task:"text", usageKind:"muse", provider:"anthropic", model:"claude-opus-5", messages:[{ role:"user", content:"How do I export my screenplay?" }] });
  const reset = ()=>{ W.rpcs = []; W.sessions = []; W.texts = []; W.consume = null; W.seq = []; };
  const slots = ()=>W.rpcs.filter((r)=>r[1] === "turn_frances_consume");
  try{
    await test("P1 a voice session takes one slot through the service-role RPC (limit 50) BEFORE the session call, and opens", async ()=>{
      reset();
      const r = await post("tok-alice", LIVE());
      assert.equal(r.status, 201, j(r.json));
      assert.equal(r.json.transport.sdp, "v=0\r\nanswer\r\n");
      assert.deepEqual(slots(), [["service", "turn_frances_consume", { p_user:U.alice, p_limit:50 }]]);
      assert.deepEqual(W.seq, ["slot", "session"], "the slot is taken first");
      assert.equal(W.sessions.length, 1);
      assert.equal(W.sessions[0].body.transport.sdp, OFFER, "the offer is still forwarded byte-for-byte");
      assert.equal(await usage(pdb, U.alice), 1);
      assert.equal(W.rpcs.filter((x)=>x[1] === "turn_record_usage_event").length, 0, "voice still records no usage");
    });
    await test("P2 one slot per session, and voice shares ONE daily count with typed Frances questions", async ()=>{
      reset();
      for(let i = 0; i < 3; i++) assert.equal((await post("tok-bob", LIVE())).status, 201);
      assert.equal(await usage(pdb, U.bob), 3, "three sessions, three slots");
      assert.equal((await post("tok-bob", MUSE())).status, 200, "a typed question");
      assert.equal(await usage(pdb, U.bob), 4, "the chat's question lands on the same count");
      assert.equal(slots().length, 4);
      assert.equal(W.sessions.length, 3);
    });
    await test("P3 at the limit: 429 frances_daily_limit with limit / used / resets_at, CORS, and NO session call — for voice and chat alike", async ()=>{
      reset();
      ENV.FRANCES_DAILY_LIMIT = "2";
      try{
        assert.equal((await post("tok-carol", LIVE())).status, 201);
        assert.equal((await post("tok-carol", MUSE())).status, 200);
        const sessionsBefore = W.sessions.length;
        const r = await post("tok-carol", LIVE());
        assert.equal(r.status, 429, j(r.json));
        assert.equal(r.json.error, "frances_daily_limit");
        assert.equal(r.json.limit, 2); assert.equal(r.json.used, 2);
        assert.match(r.json.resets_at, /^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
        assert.equal(Date.parse(r.json.resets_at) - Date.parse(new Date().toISOString().slice(0, 10)+"T00:00:00Z"), 24*3600*1000);
        assert.equal(r.headers.get("access-control-allow-origin"), "*");
        assert.equal(W.sessions.length, sessionsBefore, "no session call");
        // asking again is refused again, still without a session call or a count
        assert.equal((await post("tok-carol", LIVE())).status, 429);
        assert.equal((await post("tok-carol", MUSE())).status, 429, "the chat is at the limit too");
        assert.equal(W.sessions.length, sessionsBefore);
        assert.equal(await usage(pdb, U.carol), 2);
        // another person is unaffected
        assert.equal((await post("tok-dave", LIVE())).status, 201);
      }finally{ delete ENV.FRANCES_DAILY_LIMIT; }
      // the secret: an unusable value means 50
      ENV.FRANCES_DAILY_LIMIT = "lots";
      try{ reset(); assert.equal((await post("tok-carol", LIVE())).status, 201); assert.equal(slots()[0][2].p_limit, 50); }
      finally{ delete ENV.FRANCES_DAILY_LIMIT; }
    });
    await test("P4 a request that can't open a session takes no slot (no audio offer, another mode, no server key)", async ()=>{
      reset();
      const before = await usage(pdb, U.erin);
      assert.match((await post("tok-erin", LIVE({ sdp:"" }))).json.error, /valid browser audio offer/);
      assert.match((await post("tok-erin", LIVE({ sdp:"x".repeat(70000) }))).json.error, /valid browser audio offer/);
      assert.match((await post("tok-erin", LIVE({ mode:"help" }))).json.error, /not available/);
      const key = ENV.OPENAI_API_KEY; delete ENV.OPENAI_API_KEY;
      try{ assert.match((await post("tok-erin", LIVE())).json.error, /not configured on the server/); }
      finally{ ENV.OPENAI_API_KEY = key; }
      assert.deepEqual(slots(), []); assert.equal(W.sessions.length, 0);
      assert.equal(await usage(pdb, U.erin), before);
    });
    await test("P5 admins are exempt: no slot is asked for, and a session opens even when the count would refuse", async ()=>{
      reset();
      W.consume = async ()=>({ data:{ allowed:false, used:50, limit:50, resets_at:"2026-09-30T00:00:00Z" }, error:null });
      for(let i = 0; i < 3; i++) assert.equal((await post("tok-admin", LIVE())).status, 201);
      assert.deepEqual(slots(), []); assert.equal(W.sessions.length, 3);
      assert.equal(await usage(pdb, U.admin), 0);
    });
    await test("P6 fail open: the function missing, the real SQL dropped, no service key, a hung call — the session opens, each kind logged once", async ()=>{
      reset(); W.warns = [];
      W.consume = async ()=>({ data:null, error:{ code:"PGRST202", message:"Could not find the function public.turn_frances_consume(p_limit, p_user) in the schema cache" } });
      for(const tok of ["tok-dave", "tok-erin"]){ const r = await post(tok, LIVE()); assert.equal(r.status, 201, j(r.json)); }
      assert.equal(W.warns.length, 1, W.warns.join("\n"));
      assert.match(W.warns[0], /Frances daily limit not enforced \(missing: .*Run supabase\/frances-daily-limit\.sql/);
      W.consume = null;
      await pdb.exec("drop function public.turn_frances_consume(uuid, integer)");
      assert.equal((await post("tok-dave", LIVE())).status, 201);
      assert.equal(W.warns.length, 1, "already logged");
      assert.ok((await runFile(pdb)).ok, "put it back");
      const key = ENV.SUPABASE_SERVICE_ROLE_KEY; delete ENV.SUPABASE_SERVICE_ROLE_KEY;
      try{ assert.equal((await post("tok-dave", LIVE())).status, 201); }finally{ ENV.SUPABASE_SERVICE_ROLE_KEY = key; }
      assert.equal(W.warns.length, 2); assert.match(W.warns[1], /\(error: supabaseKey is required\.\)/);
      // a call that never answers is cut off at the limiter's 8 s (shortened here) and the session opens
      W.consume = ()=>new Promise(noop);
      const realSetTimeout = globalThis.setTimeout, asked = [];
      globalThis.setTimeout = (f, ms, ...a)=>{ asked.push(ms); return realSetTimeout(f, ms === 8000 ? 25 : ms, ...a); };
      const t0 = Date.now();
      try{ assert.equal((await post("tok-dave", LIVE())).status, 201); }
      finally{ globalThis.setTimeout = realSetTimeout; }
      assert.ok(asked.includes(8000), "the limiter waited 8000 ms: "+j(asked));
      assert.ok(Date.now() - t0 < 6000);
      assert.equal(W.warns.length, 3); assert.match(W.warns[2], /\(timeout: no answer within 8000 ms\)/);
      assert.equal(W.sessions.length, 5, "every one of them opened");
      assert.ok(!W.warns.some((l)=>l.includes(U.dave) || l.includes(U.erin)), "no account id in the log");
    });
    await test("P7 a burst: 429 frances_busy, no session call, nothing counted, nothing logged; the next start opens", async ()=>{
      reset(); W.warns = [];
      const before = await usage(pdb, U.bob);
      await pdb.exec(`create function public.frances_test_lock() returns trigger language plpgsql as $$
                        begin raise exception using errcode = '55P03', message = 'canceling statement due to lock timeout'; end $$;
                      create trigger frances_test_lock before insert on public.turn_frances_usage for each row execute function public.frances_test_lock();`);
      let r;
      try{ r = await post("tok-bob", LIVE()); }
      finally{ await pdb.exec("drop trigger frances_test_lock on public.turn_frances_usage; drop function public.frances_test_lock();"); }
      assert.equal(r.status, 429, j(r.json));
      assert.deepEqual(r.json, { error:"frances_busy", message:"One question at a time, please — ask me again in a moment.", limit:50, used:before });
      assert.equal(r.headers.get("access-control-allow-origin"), "*");
      W.consume = async ()=>({ data:null, error:{ code:"55P03", message:"canceling statement due to lock timeout" } });
      const r2 = await post("tok-bob", LIVE());
      assert.equal(r2.status, 429); assert.equal(r2.json.error, "frances_busy");
      assert.equal(W.sessions.length, 0, "no session call");
      assert.equal(await usage(pdb, U.bob), before, "nothing counted");
      assert.deepEqual(W.warns, [], "busy is the limit working, not a failure to log");
      W.consume = null;
      assert.equal((await post("tok-bob", LIVE())).status, 201);
      assert.equal(await usage(pdb, U.bob), before + 1);
    });
    await test("P8 a session that fails to open after the slot is taken is not refunded (the text task's rule), and says so plainly", async ()=>{
      reset();
      const before = await usage(pdb, U.erin);
      const saved = globalThis.fetch;
      globalThis.fetch = async (url, init)=>String(url) === "https://api.openai.com/v1/live/sessions"
        ? new Response(j({ error:{ message:"upstream unavailable" } }), { status:503, headers:{ "content-type":"application/json" } }) : saved(url, init);
      let r;
      try{ r = await post("tok-erin", LIVE()); }finally{ globalThis.fetch = saved; }
      assert.equal(r.status, 200); assert.equal(r.json.error, "upstream unavailable");
      assert.equal(await usage(pdb, U.erin), before + 1);
    });
  }finally{
    console.warn = realWarn; globalThis.fetch = realFetch;
  }
}

await test("P9 index.ts: the live check uses the same limiter and RPC, sits after validation and before the session call; nothing else in the live path changed", ()=>{
  const ts = read("supabase/functions/image-proxy/index.ts");
  const liveOf = (src)=>src.slice(src.indexOf('  if (task === "live") {'), src.indexOf("  // ── task: TEXT completion"));
  const live = liveOf(ts);
  assert.ok(live.length > 500);
  const at = (s)=>{ const i = live.indexOf(s); assert.ok(i >= 0, "missing: "+s); return i; };
  const check = at("const francesVoiceCheck: any = await francesLimit({");
  assert.ok(at('if (mode !== "new-story")') < check && at("if (!sdp.trim() || sdp.length > 65536)") < check && at("if (!liveKey)") < check, "after the request is validated");
  assert.ok(check < at('await fetch("https://api.openai.com/v1/live/sessions"'), "before the session call");
  for(const s of ['isAdmin, userId: authUser.id, limit: francesDailyLimit(Deno.env.get("FRANCES_DAILY_LIMIT")),',
    'createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!).rpc(FRANCES_LIMIT_RPC, args),',
    "if (!francesVoiceCheck.serve) return json(francesVoiceCheck.body, francesVoiceCheck.status);"]) at(s);
  assert.equal((ts.match(/createFrancesLimiter\(/g) || []).length, 1, "the one module-scope limiter (logged once per instance, shared with the text task)");
  assert.equal((ts.match(/francesLimit\(/g) || []).length, 2, "the text task and the live task");
  // the rest of the live path is byte-for-byte what 59e4bff had
  let head = null;
  try{ head = execSync("git show 59e4bff:supabase/functions/image-proxy/index.ts", { cwd:ROOT, encoding:"utf8", maxBuffer:64*1024*1024, stdio:["ignore", "pipe", "ignore"] }); }catch(_e){}
  if(!head){ console.log("     (git history unavailable: skipped the byte-for-byte comparison)"); return; }
  const start = live.indexOf("    // FRANCES'S DAILY QUESTION LIMIT COVERS VOICE");
  const end = live.indexOf("\n", live.indexOf("if (!francesVoiceCheck.serve)")) + 1;
  assert.ok(start > 0 && end > start);
  // billing fixes (2026-09-30): the live path's two provider-error replies no longer pass the
  // provider's own words (accounts, keys, quotas) to the user — admins still see them
  const ERR_SCRUB = [
    ["        return json({ error: detail || `Frances's live voice could not start (${response.status}).`, status: response.status }, 200);\n",
     "        // the provider's own words are logged, never shown (they can name accounts, keys or quotas)\n"
     + "        return json({ error: say(detail, `Frances's live voice could not start (${response.status}). Please try again.`), status: response.status }, 200);\n"],
    ["        : \"The server could not open Frances's live voice: \" + ((e as any)?.message || e) }, 200);\n",
     "        : isAdmin ? \"The server could not open Frances's live voice: \" + ((e as any)?.message || e)\n"
     + "        : \"Frances's live voice couldn't open right now. Please try again.\" }, 200);\n"],
  ];
  // owner decision K (2026-10-09, MUSE Protocol §3): she may say which plan a feature comes with, never a price or billing
  const POWERS = "If asked what powers you, say: I'm Frances; let's keep our focus on your story.";
  ERR_SCRUB.push([POWERS + "\",\n",
    POWERS + " Which plan a feature comes with, exactly as you were told (e.g. who can share a film), you may say — never a price, a credit amount or billing.\",\n"]);
  let expected = liveOf(head);
  for(const [from, to] of ERR_SCRUB){ assert.ok(expected.includes(from), "59e4bff has: "+from); expected = expected.replace(from, to); }
  assert.equal(live.slice(0, start) + live.slice(end), expected, "only the limit block (and the error scrubbing) changed in the live path");
});

/* ======================= L. the client: app/livevoice.js ======================= */
function aiSandbox(){
  const store = new Map();
  const box = {
    console:{ ...console, warn:noop, info:noop, log:noop }, clearTimeout, setInterval, clearInterval, setTimeout:(f)=>setTimeout(f, 0),
    React:new Proxy({ createElement:(t, p, ...c)=>({ t, p, c }), useState:(x)=>[x, noop], useRef:(x)=>({ current:x }), useEffect:noop, useMemo:(f)=>f() }, { get:(t, k)=> (k in t) ? t[k] : noop }),
    localStorage:{ getItem:(k)=>store.has(k) ? store.get(k) : null, setItem:(k, v)=>store.set(k, String(v)), removeItem:(k)=>store.delete(k) },
    sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" },
    CustomEvent:class { constructor(type, o){ this.type = type; this.detail = o && o.detail; } },
    document:{ createElement:()=>({ style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null, addEventListener:noop,
      removeEventListener:noop, querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, requestAnimationFrame:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }),
    fetch:()=>{ throw new Error("network disabled in this test"); },
  };
  box.window = box; box.globalThis = box; box.self = box;
  box.claude = { complete:async ()=>"" };
  vm.createContext(box);
  for(const f of ["app/formats.jsx", "app/frameworks.jsx", "app/contract.jsx", "app/scene-order.js", "app/story-data.jsx", "app/spine.jsx", "app/ai.jsx"])
    vm.runInContext(read(f), box, { filename:f });
  return box;
}
const ai = aiSandbox();
const res = (status, body)=>({ status, clone(){ return { json:async ()=>{ if(body instanceof Error) throw body; return body; } }; } });
const inMins = (m)=>new Date(Date.now() + m*60000 + 20000).toISOString();   // +20 s so rounding lands on m

/* app/livevoice.js with WebRTC stubs. `answer(body)` is the proxy: it returns supabase-js's { data, error }. */
function liveClient(answer, { backIn = true, safeError = null } = {}){
  const seen = { invokes:[], tracksStopped:0, peersClosed:0, remote:[], errors:[], statuses:[] };
  const track = { enabled:true, stop(){ seen.tracksStopped++; } };
  class Channel {
    constructor(){ this.readyState = "open"; this.l = {}; this.sent = []; }
    addEventListener(t, f){ (this.l[t] ||= []).push(f); }
    send(s){ this.sent.push(JSON.parse(s)); }
    close(){ this.readyState = "closed"; }
    emit(t, ev){ (this.l[t] || []).forEach((f)=>f(ev)); }
  }
  class Peer {
    constructor(){ this.iceGatheringState = "complete"; this.connectionState = "new"; this.localDescription = null; this.l = {}; }
    addEventListener(t, f){ (this.l[t] ||= []).push(f); }
    removeEventListener(){}
    addTrack(){}
    createDataChannel(){ this.channel = new Channel(); seen.channel = this.channel; return this.channel; }
    async createOffer(){ return { type:"offer", sdp:"v=0\r\noffer\r\n" }; }
    async setLocalDescription(d){ this.localDescription = d; }
    async setRemoteDescription(d){ seen.remote.push(d); setTimeout(()=>this.channel.emit("message", { data:j({ type:"session.started", session:{ id:"sess_ok" } }) }), 0); }
    close(){ seen.peersClosed++; }
  }
  const box = {
    console:{ ...console, warn:noop, info:noop, log:noop }, setTimeout, clearTimeout,
    location:{ protocol:"https:", hostname:"kinolot.example" },
    navigator:{ mediaDevices:{ getUserMedia:async ()=>({ getTracks:()=>[track], getAudioTracks:()=>[track] }) } },
    RTCPeerConnection:Peer, MediaStream:class { constructor(t){ this.t = t; } },
    Audio:class { play(){ return Promise.resolve(); } pause(){} },
    TURN_SUPABASE:{ imageProxy:true },
    sbClient:()=>({ functions:{ invoke:async (fn, o)=>{ seen.invokes.push([fn, o.body]); return answer(o.body); } } }),
  };
  box.window = box; box.globalThis = box;
  if(backIn) box.francesBackIn = ai.francesBackIn;          // the chat's real countdown (app/ai.jsx)
  if(safeError) box.turnSafeError = safeError;
  vm.createContext(box);
  vm.runInContext(read("app/livevoice.js"), box, { filename:"app/livevoice.js" });
  const start = ()=>box.turnStartLiveVoice({ mode:"new-story", context:{ formatLabel:"film" },
    onError:(m)=>seen.errors.push(m), onStatus:(s)=>seen.statuses.push(s) });
  return { box, seen, start };
}
const refused = (status, body)=>()=>({ data:null, error:{ message:"Edge Function returned a non-2xx status code", context:res(status, body) } });
const rejection = async (p)=>{ try{ await p; }catch(e){ return e; } throw new Error("expected the start to be refused"); };

await test("L1 at the limit the start is refused with the calm line (code frances_daily_limit): asked once, never retried, the mic released", async ()=>{
  const c = liveClient(refused(429, { error:"frances_daily_limit", message:"That’s today’s 50 free questions with Frances. She’ll be back after midnight UTC.", limit:50, used:50, resets_at:inMins(5*60) }));
  const e = await rejection(c.start());
  assert.equal(e.message, LIMIT_LINE_5H);
  assert.equal(e.code, "frances_daily_limit");
  assert.deepEqual(j(e.francesLimit), j({ limit:50, resetsAt:e.francesLimit.resetsAt }));
  assert.equal(c.seen.invokes.length, 1, "asked once, never retried");
  assert.equal(c.seen.invokes[0][1].task, "live");
  await new Promise((r)=>setTimeout(r, 30));
  assert.equal(c.seen.invokes.length, 1, "and nothing retries later");
  assert.equal(c.seen.tracksStopped, 1, "the microphone is released");
  assert.equal(c.seen.peersClosed, 1, "the connection is closed");
  assert.deepEqual(c.seen.remote, [], "no session was attached");
  assert.deepEqual(c.seen.errors, [], "no audio-error callback: the start itself is refused");
});
await test("L2 the line names the server's limit and counts down exactly like the chat's reply", async ()=>{
  const line = async (body, opts)=>(await rejection(liveClient(refused(429, { error:"frances_daily_limit", ...body }), opts).start())).message;
  assert.equal(await line({ limit:50, resets_at:inMins(60) }), "That’s today’s 50 free questions with Frances — voice included. She’ll be back after midnight UTC (in about an hour). You can use the typed interview in the meantime.");
  assert.equal(await line({ limit:50, resets_at:inMins(30) }), "That’s today’s 50 free questions with Frances — voice included. She’ll be back after midnight UTC (in about 30 minutes). You can use the typed interview in the meantime.");
  assert.equal(await line({ limit:20, resets_at:inMins(3*60) }), "That’s today’s 20 free questions with Frances — voice included. She’ll be back after midnight UTC (in about 3 hours). You can use the typed interview in the meantime.");
  assert.equal(await line({ limit:1 }), "That’s today’s 1 free question with Frances — voice included. She’ll be back after midnight UTC. You can use the typed interview in the meantime.");
  for(const bad of [{}, { limit:"many" }, { limit:50, resets_at:"soon" }, { limit:50, resets_at:inMins(-10) }, { limit:50, resets_at:inMins(30*60) }])
    assert.equal(await line(bad), "That’s today’s 50 free questions with Frances — voice included. She’ll be back after midnight UTC. You can use the typed interview in the meantime.", j(bad));
  // same countdown as the chat (both come from francesBackIn in app/ai.jsx)
  for(const m of [1, 2, 30, 44, 45, 89, 90, 100, 5*60, 24*60, 25*60]){
    const resets_at = inMins(m);
    const chat = ai.francesLimitReply({ limit:50, resets_at }).match(/UTC(.*)\.$/)[1];
    const voice = (await line({ limit:50, resets_at })).match(/UTC(.*)\. You can/)[1];
    assert.equal(voice, chat, m+" minutes");
  }
  // without app/ai.jsx loaded the line still reads calmly, only without the countdown
  assert.equal(await line({ limit:50, resets_at:inMins(60) }, { backIn:false }), "That’s today’s 50 free questions with Frances — voice included. She’ll be back after midnight UTC. You can use the typed interview in the meantime.");
  // the app's safe-error filter never touches it
  assert.equal(await line({ limit:50, resets_at:inMins(60) }, { safeError:()=>"FILTERED" }), "That’s today’s 50 free questions with Frances — voice included. She’ll be back after midnight UTC (in about an hour). You can use the typed interview in the meantime.");
});
await test("L3 a burst is refused with 'One conversation at a time…' (code frances_busy): asked once, never retried", async ()=>{
  const c = liveClient(refused(429, { error:"frances_busy", message:"One question at a time, please — ask me again in a moment.", limit:50 }));
  const e = await rejection(c.start());
  assert.equal(e.message, BUSY_LINE); assert.equal(e.code, "frances_busy");
  await new Promise((r)=>setTimeout(r, 30));
  assert.equal(c.seen.invokes.length, 1);
  assert.equal(c.seen.tracksStopped, 1);
  // a 2xx carrying either code (defensive) reads the same
  const d = await rejection(liveClient(()=>({ data:{ error:"frances_daily_limit", limit:50 }, error:null })).start());
  assert.equal(d.code, "frances_daily_limit");
  assert.equal(d.message, "That’s today’s 50 free questions with Frances — voice included. She’ll be back after midnight UTC. You can use the typed interview in the meantime.");
  assert.equal((await rejection(liveClient(()=>({ data:{ error:"frances_busy" }, error:null })).start())).message, BUSY_LINE);
});
await test("L4 other refusals are unchanged: another 429, an unreadable body, 401, 404 and a relayed provider error", async ()=>{
  const msg = async (answer)=>{ const e = await rejection(liveClient(answer).start()); assert.equal(e.code, undefined); return e.message; };
  assert.equal(await msg(refused(429, { error:"rate_limited" })), "rate_limited");
  assert.equal(await msg(refused(429, new Error("not json"))), "Couldn’t reach Frances: Edge Function returned a non-2xx status code.");
  assert.equal(await msg(refused(401, {})), "Sign in to talk with Frances.");
  assert.equal(await msg(refused(404, {})), "Live voice isn’t available right now. You can use the typed interview in the meantime.");
  assert.equal(await msg(()=>({ data:{ error:"Frances's live voice could not start (503)." }, error:null })), "Frances's live voice could not start (503).");
});
await test("L5 the normal path is unchanged: a session opens and Frances is asked to begin", async ()=>{
  const c = liveClient(()=>({ data:{ session:{ id:"sess_ok" }, transport:{ type:"webrtc", sdp:"v=0\r\nanswer\r\n" } }, error:null }));
  const session = await c.start();
  assert.equal(session.sessionId, "sess_ok");
  assert.equal(j(c.seen.remote), j([{ type:"answer", sdp:"v=0\r\nanswer\r\n" }]));
  assert.equal(c.seen.invokes.length, 1);
  assert.equal(c.seen.channel.sent[0].type, "session.commentary.append", "Frances is asked to begin");
  assert.deepEqual(c.seen.statuses.slice(0, 2), ["connecting", "listening"]);
  await session.close({ timeoutMs:500 });
});
await test("L6 New Story shows the refusal's line in its message area and keeps the typed interview; the typed interview isn't counted", ()=>{
  const story = read("app/newstory.jsx");
  const live = story.slice(story.indexOf("function NSLiveInterview"), story.indexOf("function NSInterview"));
  assert.match(live, /catch\(e\)\{\s*if\(alive\)\{ setStatus\("failed"\); setErr\(String\(\(e&&e\.message\)\|\|"Couldn’t start live voice\."\)\); \}/, "the refusal's message is what the screen shows");
  assert.match(live, /"Use typed interview"/);
  assert.ok(!/setAttempt\(n=>n\+1\)[\s\S]*setTimeout|setInterval/.test(live), "no automatic retry in New Story");
  // the typed interview runs on the writing path, never on Frances's free (counted) path
  const aiSrc = read("app/ai.jsx");
  const seed = aiSrc.slice(aiSrc.indexOf("async function aiSeedInterview("), aiSrc.indexOf("async function aiSeedInterview(") + 4000);
  assert.match(seed, /window\.claude\.complete\(/);
  assert.ok(!/museComplete|usageKind:\s*"muse"/.test(seed));
});

/* ======================= F. what Frances knows, the docs, the brand ======================= */
const VENDOR = /anthropic|claude|openai|chatgpt|\bgpt|gemini|gemma|google|moonshot|kimi|\bopus\b|\bfable\b|sonnet|haiku|mythos|elevenlabs|\bfal\b|supabase|stripe|mckee/i;
const INFRA = /\bproxy\b|edge function|api keys?\b|_API_KEY|redeploy|server secret|\bsql\b|\brpc\b|turn_[a-z_]+|\.sql\b/i;
const BILLING = /\b(?:pricing|prices?|billing|checkout|subscriptions?|credits?|provider-cost|margin)\b|\$\d/i;
const flat = (s)=>String(s).replace(/\s+/g, " ");
await test("F1 Frances knows voice counts: her entry and New Story's say so with the exact lines, and that part reaches her without vendor, server or billing words", ()=>{
  const fr = ai.APP_FEATURES.find((f)=>f.name === "Frances (help assistant)").what;
  assert.ok(fr.includes("VOICE COUNTS TOO: each New Story voice conversation with Frances ('Talk it through') uses one of the same daily questions as it starts, however long it lasts. It counts even if it then fails to connect, so each 'Try live again' after a failed start uses another. The typed interview isn't counted."));
  assert.ok(fr.includes("'"+LIMIT_LINE_5H+"'"));
  const ns = ai.APP_FEATURES.find((f)=>String(f.name).startsWith("New Story (format")).what;
  // caps by plan (billing fixes, 2026-09-30): the number depends on the account
  assert.ok(ns.includes("LIVE VOICE COUNTS TOWARD FRANCES'S DAILY LIMIT: each live voice conversation with Frances uses one of her free questions for the day (between 5 and 50 a day, depending on the account; the count starts again at midnight UTC)"));
  // no refund (P8): a start that then fails to connect still counts, and Frances can tell people so
  assert.ok(ns.includes("taken once as the conversation starts, however long it lasts. It counts even if it then fails to connect, so each 'Try live again' after a failed start uses another."));
  assert.ok(ns.includes("'"+LIMIT_LINE_5H+"'") && ns.includes("'"+BUSY_LINE+"'"));
  const pub = (name)=>ai.museFacts().find((f)=>String(f.name).startsWith(name)).what;
  const frPub = pub("Frances (help assistant)"), nsPub = pub("New Story (format");
  assert.ok(frPub.includes("uses one of the same daily questions as it starts") && frPub.includes(LIMIT_LINE_5H));
  for(const t of [frPub, nsPub]) assert.ok(t.includes("It counts even if it then fails to connect, so each 'Try live again' after a failed start uses another."), "the no-refund rule reaches Frances");
  assert.ok(nsPub.includes("each live voice conversation with Frances uses one of her free questions for the day") && nsPub.includes(LIMIT_LINE_5H) && nsPub.includes(BUSY_LINE));
  const voicePart = (s)=>s.slice(s.search(/VOICE COUNTS TOO|LIVE VOICE COUNTS TOWARD/), s.indexOf("nothing is counted for it", s.search(/VOICE COUNTS TOO|LIVE VOICE COUNTS TOWARD/)) + 30);
  for(const part of [voicePart(frPub), voicePart(nsPub)]){
    assert.ok(part.length > 100);
    assert.ok(!VENDOR.test(part) && !INFRA.test(part) && !BILLING.test(part), part);
  }
  const p = ai.museSystemPrompt({ now:"Does a voice conversation count toward my 50 daily questions with Frances?" }, null);
  assert.ok(p.includes("voice included"), "the question brings the voice fact along");
});
await test("F2 the docs quote the client's exact lines; the prompt's rules are unchanged", ()=>{
  const live = read("app/livevoice.js");
  assert.ok(live.includes('const LIVE_BUSY_LINE = "'+BUSY_LINE+'";'));
  assert.ok(live.includes('" with Frances — voice included. She’ll be back after midnight UTC"+when+". You can use the typed interview in the meantime."'));
  const doc = flat(read("docs/MUSE Protocol.md")), rd = flat(read("supabase/README.md"));
  for(const [name, text] of [["MUSE Protocol", doc], ["supabase/README.md", rd]]){
    assert.ok(text.includes("**Voice counts too** (owner decision 2026-09-29)"), name);
    assert.ok(text.includes(LIMIT_LINE_5H), name+": the limit line");
    assert.ok(text.includes(BUSY_LINE), name+": the busy line");
    assert.ok(text.includes("frances_daily_limit") && text.includes("frances_busy"), name);
    assert.ok(/typed New Story interview is not counted/.test(text), name);
  }
  assert.ok(doc.includes("New Story voice uses a server-created GPT-Live session over WebRTC"), "the voice paragraph test-gpt-live pins is intact");
  assert.ok(rd.includes("`node scripts/test-frances-voice-limit.mjs`"));
  // deploy order: an older livevoice.js shows the bare code, so the app ships first (review 2026-09-29)
  assert.ok(!/live once `image-proxy` is deployed/.test(rd), "the README no longer says deploying the proxy alone is enough");
  for(const s of ["**Deploy order: the app first, then `image-proxy`.**", "shows the bare code (`frances_daily_limit` or `frances_busy`)",
    "new cache keys in `TURN.html` for `app/livevoice.js?v=` (also add the new key to the regex in `scripts/test-gpt-live.mjs`)",
    "and only then deploy `image-proxy`", "only once the app with the new `app/livevoice.js` and `app/ai.jsx` cache keys is live (see **Deploy order** above)",
    "Giving the slot back would need a small service-role decrement function in `frances-daily-limit.sql`"]) assert.ok(rd.includes(s), "README: "+s);
  assert.ok(doc.includes("Ship the app (new `app/livevoice.js` and `app/ai.jsx` cache keys) before deploying the proxy"), "MUSE Protocol: deploy order");
  assert.ok(doc.includes("A session that then fails to open is not given back"), "MUSE Protocol: no refund");
  // the limiter's own header says the live task uses it too
  const helperHead = read("supabase/functions/image-proxy/frances-limit.mjs").split("*/")[0].replace(/\s+/g, " ");
  assert.ok(helperHead.includes("ALSO (index.ts, live task; owner decision 2026-09-29): each New Story voice session takes one slot through this same limiter"), "helper header names the live task");
  assert.ok(helperHead.includes("scripts/test-frances-voice-limit.mjs") && helperHead.includes("A slot is never given back"), "helper header: test and no-refund rule");
  // the rules part of Frances's prompt is what 59e4bff had (the limit is a fact, not a rule)
  let head = null;
  try{ head = execSync("git show 59e4bff:app/ai.jsx", { cwd:ROOT, encoding:"utf8", maxBuffer:64*1024*1024, stdio:["ignore", "pipe", "ignore"] }); }catch(_e){}
  if(head){
    const box = aiSandboxFrom(head);
    const rules = (b)=>{ const s = b.museSystemPrompt({ now:"hi" }, null); return s.slice(0, s.indexOf("\n\nABOUT THIS APP")); };
    // (owner 2026-10-09, Team review — decision K) the one approved plan-eligibility sentence aside
    const K_RULE = " Which plan a feature comes with, exactly as your facts state it (e.g. who can share a film), you may say \u2014 never a price, a credit amount or billing.";
    assert.equal(rules(ai).replace(K_RULE, ""), rules(box));
  }
});
function aiSandboxFrom(aiSource){
  const box = { console:{ ...console, warn:noop, info:noop, log:noop }, setTimeout:(f)=>setTimeout(f, 0), clearTimeout, setInterval, clearInterval,
    React:new Proxy({ createElement:(t, p, ...c)=>({ t, p, c }), useState:(x)=>[x, noop], useRef:(x)=>({ current:x }), useEffect:noop, useMemo:(f)=>f() }, { get:(t, k)=> (k in t) ? t[k] : noop }),
    localStorage:{ getItem:()=>null, setItem:noop, removeItem:noop }, sessionStorage:{ getItem:()=>null, setItem:noop, removeItem:noop },
    navigator:{ userAgent:"node-test" }, location:{ href:"", search:"", hash:"", origin:"" }, CustomEvent:class {},
    document:{ createElement:()=>({ style:{}, setAttribute:noop, appendChild:noop }), getElementById:()=>null, addEventListener:noop, removeEventListener:noop,
      querySelector:()=>null, querySelectorAll:()=>[], body:{ appendChild:noop, removeChild:noop }, head:{ appendChild:noop } },
    addEventListener:noop, removeEventListener:noop, dispatchEvent:noop, requestAnimationFrame:noop,
    matchMedia:()=>({ matches:false, addEventListener:noop, removeEventListener:noop }), fetch:()=>{ throw new Error("offline"); } };
  box.window = box; box.globalThis = box; box.self = box; box.claude = { complete:async ()=>"" };
  vm.createContext(box);
  for(const f of ["app/formats.jsx", "app/frameworks.jsx", "app/contract.jsx", "app/scene-order.js", "app/story-data.jsx", "app/spine.jsx"]) vm.runInContext(read(f), box, { filename:f });
  vm.runInContext(aiSource, box, { filename:"app/ai.jsx@59e4bff" });
  return box;
}
await test("F3 every place naming the number agrees, and the voice lines carry no vendor, codename or server words", ()=>{
  const n = FRANCES_DAILY_LIMIT_DEFAULT;
  const live = read("app/livevoice.js");
  assert.match(live, new RegExp("const limit = n > 0 \\? n : "+n+";"), "the client's fallback");
  assert.match(live, new RegExp("Number\\(body\\.limit\\)\\) : "+n+","), "the error's fallback");
  assert.match(read("app/ai.jsx"), new RegExp("^const FRANCES_DAILY_LIMIT = "+n+";$", "m"));
  for(const text of [ai.APP_FEATURES.find((f)=>f.name === "Frances (help assistant)").what, ai.APP_FEATURES.find((f)=>String(f.name).startsWith("New Story (format")).what,
    flat(read("docs/MUSE Protocol.md")), flat(read("supabase/README.md"))]){
    const named = [...text.matchAll(/today’s (\d+) free questions with Frances — voice included/g)].map((x)=>Number(x[1]));
    assert.ok(named.length >= 1); named.forEach((x)=>assert.equal(x, n));
  }
  for(const line of [LIMIT_LINE_5H, BUSY_LINE]){
    assert.ok(!VENDOR.test(line) && !INFRA.test(line) && !BILLING.test(line), line);
    assert.ok(!/\bMUSE\b|\bTURN\b|Cinema Machine/.test(line), line);
  }
  assert.doesNotMatch(live, /OPENAI_API_KEY/, "the browser still never names the service key");
});

console.log("\n"+checks+" checks passed"+(failed ? ", "+failed+" FAILED" : "")+(skipped ? ", "+skipped+" skipped" : ""));
process.exit(failed ? 1 : 0);
