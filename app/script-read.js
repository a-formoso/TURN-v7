/* script-read.js — BRING YOUR OWN SCRIPT, phase 2: THE READ (owner 2026-10-18; docs/Script Import Plan.md).
   An imported screenplay is READ into the pipeline, never rewritten: one writing call per scene fills its scene card
   (title, summary, value at stake, opening / closing charge, kind, driver, objective, turning point) and its BEATS —
   made by GROUPING the scene's existing lines (each block gets a beat number; no word changes) — then one call reads
   the cast and one reads the film's brief (logline, synopsis in the structure's shape, premise, controlling idea).
   Where the method would flag a scene (it doesn't turn, it repeats the last scene's charge) that is a dismissable
   STORY NOTE, an observation, never a rewrite.

   The default reading engine is Gemini 4 Argon (owner); a trial / no-plan account reads on the light default engine.
   Every call is held and settled on the server like any writing call. Prompts are in the Infinite Studio AI method's
   own terms and name no vendor; replies pass through scrubAnalysis (ai.jsx).

   window.ScriptRead = { engineFor, estimate, buildScenePrompt, parseSceneReply, readScene, readCast, readFilm,
     methodNotes, applyBeats, READ_ENGINE_USD } */
(function(root){
  "use strict";
  const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const clip = (s, n) => { const t = clean(s); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };
  const g = (name) => root[name] || (typeof globalThis !== "undefined" ? globalThis[name] : undefined);

  /* the reading engines' list prices per 1M tokens — the SAME as supabase/functions/image-proxy/billing-pricing.mjs
     (TEXT_PROVIDER_USD_PER_1M and TEXT_PRICE_CHANGES; test-script-read checks they agree). Only for the price shown
     before a read; the server holds and settles each call on what it really used. */
  const READ_ENGINE_USD = {
    "gemini-4-argon":  { input:2, output:10, changes:[{ from:"2026-12-01T00:00:00Z", input:4, output:20 }] },
    "gemini-3.8-flash":{ input:0.75, output:3.75, changes:[{ from:"2027-01-01T00:00:00Z", input:1.5, output:7.5 }] },
    "claude-opus-5-5": { input:4, output:20 },
    "claude-fable-5-2":{ input:8, output:40 },
    "gpt-6-astra":     { input:10, output:50 },
    "gpt-6.1-sol":     { input:2, output:10 },
  };
  const DEFAULT_ENGINE = "gemini-4-argon";
  const SCENE_MAX_TOKENS = 8000, CAST_MAX_TOKENS = 12000, FILM_MAX_TOKENS = 8000;

  function engineFor(){
    let free = false;
    try{ free = typeof root.turnOnFreeTier === "function" && !!root.turnOnFreeTier(); }catch(e){}
    const models = Array.isArray(root.WRITING_MODELS) ? root.WRITING_MODELS : [];
    const has = id => !models.length || models.some(m => m.id === id);
    if(free) return root.TURN_FREE_TIER_WRITING_MODEL || "gemini-3.8-flash";
    return has(DEFAULT_ENGINE) ? DEFAULT_ENGINE : ((models[0] && models[0].id) || DEFAULT_ENGINE);
  }
  function ratesOf(modelId, nowMs){
    const r = READ_ENGINE_USD[modelId] || READ_ENGINE_USD[DEFAULT_ENGINE];
    let input = r.input, output = r.output;
    (r.changes || []).forEach(c => { if((nowMs || Date.now()) >= Date.parse(c.from)){ input = c.input; output = c.output; } });
    return { input, output };
  }
  const tokensOf = chars => Math.ceil(chars / 3.6);
  /* the price of reading these scenes (plus the cast and the film's brief), as a range of credits */
  function estimate(film, modelId, opts){
    opts = opts || {};
    const ids = opts.sceneIds || (film.scenes || []).map(s => s.id);
    const r = ratesOf(modelId || engineFor(), opts.nowMs);
    const usdOf = (inTok, outTok) => (inTok * r.input + outTok * r.output) / 1e6;
    let lo = 0, hi = 0, chars = 0;
    ids.forEach(id => {
      const d = (film.drafts || {})[id] || {};
      const c = (d.blocks || []).reduce((n, b) => n + String(b.text || "").length + 12, 0);
      chars += c;
      const inTok = tokensOf(4200 + Math.min(c, 40000) + 1800);
      lo += usdOf(inTok, 1400); hi += usdOf(inTok, 4200);
    });
    if(opts.withFilm !== false){
      const sum = tokensOf(3000 + ids.length * 420);
      lo += usdOf(sum, 2000) + usdOf(sum + tokensOf(6000), 2500);
      hi += usdOf(sum, 5000) + usdOf(sum + tokensOf(9000), 7000);
    }
    const toCredits = usd => { const f = root.turnCreditsFromProviderUsd; const c = typeof f === "function" ? f(usd) : usd / 0.01; return Math.max(1, Math.ceil(c)); };
    return { lo:toCredits(lo), hi:Math.max(toCredits(lo), toCredits(hi)), scenes:ids.length, words:Math.round(chars / 6), modelId:modelId || engineFor() };
  }

  /* ---------- the scene read ---------- */
  const TYPE_WORD = { scene:"HEADING", action:"ACTION", char:"CUE", dia:"LINE", paren:"PAREN", trans:"TRANSITION" };
  function blocksText(blocks){
    return (blocks || []).map((b, i) => "[" + (i + 1) + "] " + (TYPE_WORD[b.type] || String(b.type || "ACTION").toUpperCase()) + ": " + String(b.text || "").replace(/\s+/g, " ").trim()).join("\n");
  }
  function frameworkBits(frameworkId){
    const fw = typeof g("frameworkOf") === "function" ? g("frameworkOf")({ framework:frameworkId }) : null;
    const acts = fw && fw.acts ? Object.entries(fw.acts).map(([n, l]) => n + " = " + l).join("; ") : "1 = Setup; 2 = Complication; 3 = Resolution";
    const kinds = fw && Array.isArray(fw.kindOpts) ? fw.kindOpts.map(([id, l]) => id + " (" + l + ")").join(", ") : "normal (Scene), incite (Inciting Incident), act-climax (Act Climax), midpoint (Mid-Act Climax), crisis (Crisis), story-climax (Story Climax), resolution (Resolution)";
    const kindIds = fw && Array.isArray(fw.kindOpts) ? fw.kindOpts.map(([id]) => id) : ["normal","incite","act-climax","midpoint","crisis","story-climax","resolution"];
    const actNos = fw && fw.acts ? Object.keys(fw.acts).map(Number).filter(Boolean) : [1, 2, 3];
    return { label:(fw && fw.label) || "Three-Act Turns", acts, kinds, kindIds, actNos };
  }
  function buildScenePrompt(c){
    const fw = frameworkBits(c.framework);
    const so = (c.prev || []).slice(-6).map(p => "Scene " + p.no + " · " + p.title + ": " + clip(p.summary, 220)
      + " (" + (p.openValue || "?") + " " + sgn(p.openCharge) + " → " + (p.closeValue || "?") + " " + sgn(p.closeCharge) + ")").join("\n");
    const cast = (c.cast || []).map(ch => ch.id + " = " + ch.name + ((ch.aliases || []).length ? " (also " + ch.aliases.join(", ") + ")" : "")).join("; ");
    const n = (c.blocks || []).length;
    const beatsWanted = n <= 6 ? "1–2" : n <= 16 ? "2–4" : n <= 40 ? "3–5" : "4–6";
    return [
      "You are reading a finished screenplay into the Infinite Studio AI method's story spine. READ, DON'T REWRITE: the writer's words are final. Never quote a line back changed, never suggest new lines, never invent events that aren't on the page.",
      "",
      "FILM: " + (c.title || "Untitled") + (c.format ? " · " + c.format : "") + " · read as " + fw.label + " (acts: " + fw.acts + ")",
      "THIS IS SCENE " + c.no + " OF " + c.total + ".",
      cast ? "CAST (id = name): " + cast : "",
      so ? "THE STORY SO FAR (as read):\n" + so : "This is the first scene read.",
      "",
      "THE SCENE, block by block (numbers are the blocks' positions):",
      blocksText(c.blocks),
      "",
      "Read it and return ONLY JSON with these keys:",
      '{"title":"2–5 words naming the scene","summary":"2–3 sentences, present tense, what happens and why it matters",',
      '"act":<one of ' + fw.actNos.join(", ") + '>,',
      '"valueAtStake":{"positive":"OneWord","negative":"OneWord"},',
      '"openValue":"OneWord","openCharge":<-3..3>,"closeValue":"OneWord","closeCharge":<-3..3>,',
      '"kind":"one of: ' + fw.kinds + '","plot":"Exposition | Rising Action | Complication | Reversal | Falling Action | Resolution",',
      '"driver":"the cast id of who drives the scene (pursues the want)","objective":"what the driver wants here, one sentence",',
      '"turningPoint":"the moment the value changes, one sentence (or that it does not)","conf":<1 inner | 2 personal | 3 extra-personal: the main source of conflict>,',
      '"driverLabel":"NAME","reactorLabel":"NAME or FORCE that opposes","desire":"one sentence","obstacle":"one sentence",',
      '"beats":[{"from":<first block>,"to":<last block>,"drive":{"a":"2–4 word action","d":"one sentence of what the driver does in these lines"},"react":{"a":"2–4 word reaction","d":"one sentence"}}],',
      '"turnAt":<the beat number where the value turns>,',
      '"notes":["at most 2 short observations, only if the scene does not turn its value or repeats the last scene\'s charge — an observation, not an instruction"],',
      '"unsure":["the keys you had to guess, e.g. closeCharge"]}',
      "",
      "BEATS: " + beatsWanted + " beats. Beats GROUP the existing blocks in order: beat 1 starts at block 1, each beat starts right after the previous one ends, the last ends at block " + n + ". No gaps, no overlaps, no reordering.",
      "CHARGES: -3 (worst) … +3 (best) on the value at stake, for the driver. A scene TURNS when its closing charge is on the other side of its opening charge.",
    ].filter(x => x !== "").join("\n");
  }
  const sgn = v => { const n = Number(v) || 0; return (n > 0 ? "+" : "") + n; };
  const charge = (v, fb) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-3, Math.min(3, n)) : (fb == null ? 0 : fb); };
  const word = (v, fb) => { const w = clean(v).split(" ")[0] || ""; return w ? w.slice(0, 18) : (fb || ""); };
  /* the beats GROUP the blocks: contiguous, in order, covering every block — else one beat holds the scene */
  function validBeats(beats, n){
    if(!Array.isArray(beats) || !beats.length) return null;
    const out = [];
    let next = 1;
    for(const b of beats){
      const from = Math.round(Number(b && b.from)), to = Math.round(Number(b && b.to));
      if(from !== next || !(to >= from) || to > n) return null;
      out.push({ from, to, drive:b.drive || {}, react:b.react || {} });
      next = to + 1;
    }
    return next === n + 1 ? out : null;
  }
  function parseSceneReply(j, c){
    if(!j || typeof j !== "object") return null;
    const n = (c.blocks || []).length;
    const fw = frameworkBits(c.framework);
    const keep = c.keepWords || [];
    const scrub = s => { const f = g("scrubAnalysis"); return typeof f === "function" ? f(clean(s), keep) : clean(s); };
    let beats = validBeats(j.beats, n);
    const regrouped = !beats;
    if(!beats) beats = [{ from:1, to:n, drive:(j.beats && j.beats[0] && j.beats[0].drive) || {}, react:(j.beats && j.beats[0] && j.beats[0].react) || {} }];
    const castIds = new Set((c.cast || []).map(x => x.id));
    const driver = castIds.has(clean(j.driver)) ? clean(j.driver)
      : ((c.cast || []).find(x => clean(x.name).toLowerCase() === clean(j.driver).toLowerCase()) || {}).id || c.fallbackDriver || "";
    const openCharge = charge(j.openCharge, 0), closeCharge = charge(j.closeCharge, 0);
    const vs = j.valueAtStake && typeof j.valueAtStake === "object" ? j.valueAtStake : {};
    const card = {
      title:clip(scrub(j.title), 60) || c.fallbackTitle || "",
      summary:clip(scrub(j.summary), 600),
      act:fw.actNos.indexOf(Number(j.act)) >= 0 ? Number(j.act) : c.fallbackAct,
      openValue:word(j.openValue, openCharge >= 0 ? word(vs.positive) : word(vs.negative)),
      openCharge,
      closeValue:word(j.closeValue, closeCharge >= 0 ? word(vs.positive) : word(vs.negative)),
      closeCharge,
      ...(word(vs.positive) && word(vs.negative) ? { value:{ pos:word(vs.positive), neg:word(vs.negative) } } : {}),
      kind:fw.kindIds.indexOf(clean(j.kind)) >= 0 ? clean(j.kind) : "normal",
      plot:clip(scrub(j.plot), 24),
      driver,
      objective:clip(scrub(j.objective), 240),
      turningPoint:clip(scrub(j.turningPoint), 240),
      conf:[1, 2, 3].indexOf(Number(j.conf)) >= 0 ? Number(j.conf) : 1,
    };
    const rows = beats.map((b, i) => ({ n:i + 1,
      drive:{ a:clip(scrub(b.drive.a), 40), d:clip(scrub(b.drive.d), 240) },
      react:{ a:clip(scrub(b.react.a), 40), d:clip(scrub(b.react.d), 240) } }));
    const turnAt = Math.max(1, Math.min(rows.length, Math.round(Number(j.turnAt)) || rows.length));
    const beatBlock = {
      driverLabel:clip(scrub(j.driverLabel), 40).toUpperCase(), reactorLabel:clip(scrub(j.reactorLabel), 40).toUpperCase(),
      desire:clip(scrub(j.desire), 240), obstacle:clip(scrub(j.obstacle), 240), turnAt, rows, readFromScript:true };
    const beatOf = [];
    beats.forEach((b, i) => { for(let k = b.from; k <= b.to; k++) beatOf[k - 1] = i + 1; });
    const notes = (Array.isArray(j.notes) ? j.notes : []).map(x => clip(scrub(x), 220)).filter(Boolean).slice(0, 2);
    const unsure = (Array.isArray(j.unsure) ? j.unsure : []).map(x => clean(x).slice(0, 30)).filter(Boolean).slice(0, 8);
    return { card, beats:beatBlock, beatOf, notes, unsure:regrouped ? unsure.concat(["beats"]) : unsure, regrouped };
  }
  /* the screenplay's blocks with the read's beat numbers — the WORDS are untouched (checked) */
  function applyBeats(blocks, beatOf){
    const out = (blocks || []).map((b, i) => ({ ...b, beat:beatOf[i] || 1 }));
    out.forEach((b, i) => { if(b.text !== blocks[i].text || b.type !== blocks[i].type) throw new Error("A read must never change the screenplay's words."); });
    return out;
  }
  /* the method's own observations, added to the read's: no turn; the same charge side as the scene before */
  function methodNotes(card, prevCard){
    const out = [];
    const ct = g("chargeTurn");
    const turned = typeof ct === "function" ? ct(card.openCharge, card.closeCharge).turned : Math.sign(card.openCharge) * Math.sign(card.closeCharge) < 0;
    if(!turned) out.push("This scene doesn’t turn its value (" + sgn(card.openCharge) + " → " + sgn(card.closeCharge) + ") — it may be exposition, or a turn the read missed.");
    if(prevCard && Math.sign(prevCard.closeCharge) !== 0 && Math.sign(prevCard.closeCharge) === Math.sign(card.closeCharge) && Math.sign(card.openCharge) === Math.sign(card.closeCharge))
      out.push("It ends on the same side as the scene before (" + sgn(prevCard.closeCharge) + ", " + sgn(card.closeCharge) + ").");
    return out;
  }
  async function complete(prompt, modelId, maxTokens){
    const c = root.claude;
    if(!c || typeof c.complete !== "function") throw new Error("The writing engine isn’t available — sign in to read your script.");
    return c.complete({ messages:[{ role:"user", content:prompt }], modelId, maxTokens });
  }
  const json = (txt) => { const f = g("extractJSON"); if(typeof f === "function") return f(txt); try{ return JSON.parse(String(txt).replace(/^[^{]*/, "").replace(/[^}]*$/, "")); }catch(e){ return null; } };
  async function readScene(c){
    const reply = await complete(buildScenePrompt(c), c.modelId, SCENE_MAX_TOKENS);
    const r = parseSceneReply(json(reply), c);
    if(!r) throw Object.assign(new Error("The read came back unreadable for scene " + c.no + "."), { readFailure:"invalid" });
    // the method's own notes first; the read's are kept when they say something else
    const own = methodNotes(r.card, c.prevCard);
    const says = (re) => own.some(n => re.test(n));
    const theirs = r.notes.filter(n => !((says(/doesn.t turn/) && /\bturn|same side|stays|flat\b/i.test(n)) || (says(/same side as the scene before/) && /same side|previous|before/i.test(n))));
    r.notes = own.concat(theirs).slice(0, 3);
    return r;
  }

  /* ---------- the cast ---------- */
  function readCastPrompt(c){
    const lines = (c.cast || []).map(ch => {
      const said = (ch.samples || []).slice(0, 6).map(t => "  “" + clip(t, 140) + "”").join("\n");
      return "- " + ch.id + " = " + ch.name + " · " + ch.lines + " line" + (ch.lines !== 1 ? "s" : "") + " in " + ch.scenes + " scene" + (ch.scenes !== 1 ? "s" : "")
        + (ch.voiceOnly ? " · only heard (V.O./O.S.)" : "") + (ch.described ? "\n  described: " + clip(ch.described, 260) : "") + (said ? "\n" + said : "");
    }).join("\n");
    const so = (c.scenes || []).map(s => "Scene " + s.no + " · " + s.title + ": " + clip(s.summary, 160)).join("\n");
    return [
      "You are reading a finished screenplay's CAST into the Infinite Studio AI method. READ, DON'T REWRITE: describe only what the script shows or plainly implies; leave a field empty rather than invent.",
      "FILM: " + (c.title || "Untitled"),
      "THE SCENES (as read):\n" + so,
      "THE CHARACTERS (id = name, what they say):\n" + lines,
      "",
      'Return ONLY JSON: {"cast":[{"id":"<the id>","role":"Protagonist | Antagonist | Supporting | Minor","conscious":"what they consciously want, one sentence","unconscious":"what they need without knowing it, one sentence or empty","arc":"how they change, \\"from → to\\", or empty","look":"only what the script says about how they look, or empty","voice":"how they speak, one short phrase"}]}',
      "Exactly one Protagonist: the character whose want drives the most scenes.",
    ].join("\n");
  }
  async function readCast(c){
    const reply = await complete(readCastPrompt(c), c.modelId, CAST_MAX_TOKENS);
    const j = json(reply);
    const list = j && Array.isArray(j.cast) ? j.cast : [];
    const keep = c.keepWords || [];
    const scrub = s => { const f = g("scrubAnalysis"); return typeof f === "function" ? f(clean(s), keep) : clean(s); };
    const ids = new Set((c.cast || []).map(x => x.id));
    const out = {};
    list.forEach(x => { const id = clean(x && x.id); if(!ids.has(id)) return;
      const role = ["Protagonist","Antagonist","Supporting","Minor"].indexOf(clean(x.role)) >= 0 ? clean(x.role) : "";
      out[id] = { ...(role ? { role } : {}), conscious:clip(scrub(x.conscious), 240), unconscious:clip(scrub(x.unconscious), 240),
        arc:clip(scrub(x.arc), 160), look:clip(scrub(x.look), 400), speech:clip(scrub(x.voice), 140) }; });
    // exactly one Protagonist
    const pro = Object.keys(out).filter(id => out[id].role === "Protagonist");
    pro.slice(1).forEach(id => { out[id].role = "Supporting"; });
    return out;
  }

  /* ---------- the film's brief ---------- */
  function readFilmPrompt(c){
    const fw = typeof g("frameworkOf") === "function" ? g("frameworkOf")({ framework:c.framework }) : null;
    const paras = (fw && fw.synopsis && fw.synopsis.paras) || [{ key:"setup", label:"Setup" }, { key:"confrontation", label:"Confrontation" }, { key:"resolution", label:"Resolution" }];
    const so = (c.scenes || []).map(s => "Scene " + s.no + " (act " + s.act + ") · " + s.title + ": " + clip(s.summary, 200)
      + " [" + (s.openValue || "?") + " " + sgn(s.openCharge) + " → " + (s.closeValue || "?") + " " + sgn(s.closeCharge) + "]").join("\n");
    const cast = (c.cast || []).map(ch => ch.name + (ch.role ? " (" + ch.role + ")" : "")).join(", ");
    return { paras, prompt:[
      "You are reading a finished screenplay into the Infinite Studio AI method's STORY BRIEF. READ, DON'T REWRITE: describe the film as written.",
      "FILM: " + (c.title || "Untitled") + (c.format ? " · " + c.format : ""),
      "CAST: " + cast,
      "THE SCENES (as read):\n" + so,
      "",
      'Return ONLY JSON: {"logline":"one sentence: protagonist, want, obstacle","premise":"What would happen if …? (one question)","genre":"Genre / Subgenre",',
      '"controllingIdea":{"value":"the value the climax lands on","cause":"why, as the film argues it","polarity":"idealistic | pessimistic | ironic"},',
      '"setting":{"period":"","duration":"","location":"","conflict":"Inner … · Personal … · Extra-personal …"},',
      '"synopsis":[' + paras.map(p => '{"key":"' + p.key + '","text":"' + (p.label || p.key) + ', 2–4 sentences"}').join(",") + ']}',
    ].join("\n") };
  }
  async function readFilm(c){
    const { paras, prompt } = readFilmPrompt(c);
    const j = json(await complete(prompt, c.modelId, FILM_MAX_TOKENS));
    if(!j) return null;
    const keep = c.keepWords || [];
    const scrub = s => { const f = g("scrubAnalysis"); return typeof f === "function" ? f(clean(s), keep) : clean(s); };
    const syn = (Array.isArray(j.synopsis) ? j.synopsis : []).map(x => {
      const p = paras.find(pp => pp.key === clean(x && x.key)); return p && clean(x.text) ? { key:p.key, label:p.label || p.key, text:clip(scrub(x.text), 900) } : null; }).filter(Boolean);
    const ci = j.controllingIdea && typeof j.controllingIdea === "object" ? j.controllingIdea : {};
    const st = j.setting && typeof j.setting === "object" ? j.setting : {};
    return { logline:clip(scrub(j.logline), 300), premise:clip(scrub(j.premise), 300), genre:clip(scrub(j.genre), 60),
      controllingIdea:{ value:clip(scrub(ci.value), 120), cause:clip(scrub(ci.cause), 200),
        polarity:["idealistic","pessimistic","ironic"].indexOf(clean(ci.polarity)) >= 0 ? clean(ci.polarity) : "" },
      setting:{ period:clip(scrub(st.period), 120), duration:clip(scrub(st.duration), 120), location:clip(scrub(st.location), 160), conflict:clip(scrub(st.conflict), 200) },
      synopsis:syn.length ? { paras:syn } : null };
  }

  root.ScriptRead = { engineFor, estimate, ratesOf, buildScenePrompt, parseSceneReply, readScene, readCast, readCastPrompt, readFilm, readFilmPrompt,
    methodNotes, applyBeats, validBeats, blocksText, READ_ENGINE_USD, DEFAULT_ENGINE, ratesOf };
})(typeof window !== "undefined" ? window : globalThis);
