/* voices-ui.jsx — the Voices tab (Art Room), Phase 1 of the audio-first Stage.
   Each speaking character gets a LOCKED voice the way Cameo locks a face: designed
   from the bible, picked from the library, or a REAL PERSON's voice (2026-10-11: recorded
   in the app or uploaded, with consent — see "REAL VOICES" below). Locking writes
   `voiceLock` (a voiceId + settings) onto the character via onUpdate. Generation runs
   through voicegen.jsx → the server proxy, so no ElevenLabs key is in the browser.
   See docs/Voice & Lip-Sync (Seedance) Plan.md §8A. */

const _vcEl = React.createElement;

function vcAudioIcon(playing){
  return playing
    ? _vcEl("span",{className:"vc-pause-mark","aria-hidden":"true"})
    : _vcEl(Icon.play,{s:12});
}

// parse the canonical "FUNCTION · ARCHETYPE — IDENTITY" role string
function vcParseRole(role){
  const r = String(role||"");
  let identity="", head=r;
  const dash = r.split(/\s[—-]\s/);
  if(dash.length>1){ identity = dash.slice(1).join(" ").trim(); head = dash[0]; }
  const dot = head.split(/\s·\s/);
  return { fn:(dot[0]||"").trim(), archetype:(dot[1]||"").trim(), identity };
}

/* origin/heritage read from the identity text — capitalized (possibly hyphenated)
   descriptors like "Turkish-Kurdish minicab driver" or "Glaswegian fixer" become the
   accent ElevenLabs actually needs NAMED (ethnic/biographical facts alone produce a
   generic neutral voice — the model doesn't infer accent from backstory). */
function vcOriginFrom(text, charName){
  const nameWords = new Set(String(charName||"").toUpperCase().split(/\s+/));
  for(const w of String(text||"").split(/\s+/)){
    const clean = w.replace(/[^A-Za-z-]/g,"");
    if(!clean || clean.length<4 || nameWords.has(clean.toUpperCase())) continue;
    const parts = clean.split("-");
    if(parts.length && parts.every(p=>/^[A-Z][a-z]{2,}$/.test(p))) return clean;
  }
  return "";
}

/* AN ACCENT BY ITS SOUNDS (owner 2026-10-27): "a French accent" gave an American voice; "a soft uvular R made at the back
   of the throat" fixed it. A voice model given only a country's name drifts to a neutral voice, so an accent saved as a
   name gets the telltale sounds of the commonest accents added. An accent that already says how it sounds, or one this
   table doesn't know, is left as written. */
const VC_ACCENT_SOUNDS = [
  [/\b(french|parisian|paris|marseille|lyon)\b/i, "soft uvular R made at the back of the throat, a dropped H, short pure vowels, stress falling at the end of each phrase"],
  [/\b(italian|tuscan|florentine|roman|neapolitan|sicilian|venetian|milanese|elban)\b/i, "a tapped or rolled R, every vowel fully sounded, words often ending on a vowel, a sing-song rise and fall"],
  [/\b(spanish|castilian|madrid|andalusian|mexican|argentin\w*|colombian|latin american)\b/i, "a tapped R, short pure vowels, an even syllable-by-syllable rhythm"],
  [/\b(portuguese|brazilian|lisbon|rio)\b/i, "nasal vowels, a soft guttural R, an S that slides toward SH, a flowing rhythm"],
  [/\b(german|bavarian|berlin|austrian|swiss german)\b/i, "W said close to V, a guttural CH at the back of the throat, crisp final consonants, firm even stress"],
  [/\b(russian|ukrainian|moscow|slavic|polish)\b/i, "a rolled R, soft palatalised consonants, a harsh back-of-the-throat H, a heavy, flat rhythm"],
  [/\b(cockney|east london)\b/i, "dropped H, glottal stops in place of T, TH said as F or V"],
  [/\b(glasgow|glaswegian|scottish|scots|edinburgh)\b/i, "a tapped R, short clipped vowels, a glottal stop for T"],
  [/\b(irish|dublin|cork|belfast)\b/i, "a soft rolling R, TH turned toward T and D, a lilting, rising rhythm"],
  [/\b(american south|southern american|texan|texas|deep south|southern us)\b/i, "long drawn-out vowels, I flattened toward AH, a slow, easy rhythm"],
  [/\b(australian|aussie)\b/i, "wide gliding vowels (DAY toward DIE), a rise at the end of statements"],
  [/\b(indian|hindi|punjabi|mumbai|delhi)\b/i, "T and D made with the tongue curled back, a tapped R, an even syllable-timed rhythm"],
  [/\b(jamaican|caribbean)\b/i, "dropped H, TH said as T or D, open vowels, a sing-song rhythm"],
  [/\b(nigerian|ghanaian|west african)\b/i, "full clear vowels, an even syllable-timed rhythm with a tonal rise and fall"],
  [/\b(japanese|tokyo|osaka)\b/i, "R and L merged into one light tapped sound, a vowel added after final consonants, an even, flat rhythm"],
  [/\b(chinese|mandarin|cantonese|beijing|shanghai)\b/i, "final consonants softened or dropped, a clipped syllable-by-syllable rhythm, tones carried into the sentence"],
  [/\b(arabic|egyptian|lebanese|syrian|saudi|moroccan)\b/i, "a guttural H and Q at the back of the throat, a rolled R, P said close to B"],
  [/\b(turkish|istanbul)\b/i, "a tapped R, clear even vowels, stress falling on the last syllable"],
];
const VC_ACCENT_SOUND_WORDS = /\b(uvular|rolled|tapped|glottal|vowels?|consonants?|throat|dropped|lilt\w*|drawl\w*|rhythm|stress|nasal|guttural|palatal\w*|th said|said as)\b/i;
function vcAccentSound(accent){
  const a = String(accent||"").trim();
  if(!a || VC_ACCENT_SOUND_WORDS.test(a) || /\bneutral\b|\bno (?:noticeable )?accent\b/i.test(a)) return a;
  const hit = VC_ACCENT_SOUNDS.find(([re])=>re.test(a));
  return hit ? a.replace(/[.;,\s]+$/,"")+": "+hit[1] : a;
}
window.vcAccentSound = vcAccentSound;

// a non-empty, editable VOICE descriptor built deterministically from the bible
// (no AI call) — every clause describes SOUND (age/gender → explicit accent →
// pitch/timbre → habitual cadence → quirks → recording quality); biography words are
// dropped because they don't change the voice. The character's authored VOICE
// BLOCK (c.voice = { accent, pitch, pace, quirks } — written at spine build and
// enriched by the Production check's script read) wins over every heuristic. User refines before
// designing.
function buildVoiceSpec(c){
  const role = vcParseRole(c.role);
  const pron = c.canonicalPronouns || c.pronouns || "";
  const gender = pron==="she/her" ? "female" : pron==="he/him" ? "male" : "";
  const phys = c.physique||{};
  // (2026-10-12, Character fidelity steps 5 · 7) the card's apparent age — the writer's choice when they updated the character
  // to match a likeness — else the age range the story build gave the cast
  const age = phys.age || phys.ageRange || phys.ageBand || String(c.ageRange||"").trim() || "";
  const fn = (role.fn||"").toLowerCase();
  const vb = c.voice || {};
  // role-based delivery is only the FALLBACK when the voice block has no pitch/pace
  let pitch = String(vb.pitch||"").trim(), pace = String(vb.pace||"").trim();
  if(!pitch || !pace){
    let dPitch = "medium pitch, natural grounded timbre", dPace = "even, unhurried pacing";
    if(/antagonist|villain|rival/.test(fn)){ dPitch="low pitch, controlled and quiet with a cold edge"; dPace="deliberate pacing"; }
    else if(/protagonist|hero|lead/.test(fn)){ dPitch="low-medium pitch, warm, clear and expressive"; dPace="measured pacing"; }
    else if(/mentor|guide/.test(fn)){ dPitch="low pitch, weathered and reassuring"; dPace="slow, patient pacing"; }
    else if(/comic|wildcard/.test(fn)){ dPitch="lighter pitch, bright and quick"; dPace="playful pacing"; }
    if(!pitch) pitch = dPitch;
    if(!pace) pace = dPace;
  } else {
    if(!/pitch|timbre|voice/i.test(pitch)) pitch = pitch+" pitch";
    if(!/pac|rhythm|tempo/i.test(pace)) pace = pace+" pacing";
  }
  // accent priority: authored voice block → legacy voiceAccent → identity heuristic
  const origin = String(vb.accent||"").trim() || String(c.voiceAccent||"").trim() || vcOriginFrom(role.identity, c.name);
  const accent = origin
    ? vcAccentSound(/\baccent|dialect|speaks\b/i.test(origin) ? origin : ("speaks English with a noticeable "+origin+" accent"))
    : "";
  const quirks = String(vb.quirks||"").trim();
  const base = [
    [age, gender, "voice"].filter(Boolean).join(" "),
    accent,
    pitch+"; "+pace,
    quirks,
    "clean close-mic recording, dry, with no background noise"
  ].filter(Boolean).join("; ")+".";
  const identity = (typeof window.turnIdentityPrompt==="function")
    ? String(window.turnIdentityPrompt([c])||"").trim() : "";
  return identity ? (base+" "+identity) : base;
}

// who actually needs a voice — characters in-frame on any shot that has dialogue;
// falls back to scene drivers when no shots/dialogue exist yet
function speakingCharIds(characters, scenes, shots){
  const set = new Set();
  const norm=v=>String(v||"").toLowerCase().replace(/\(cont'?d\)/ig,"").replace(/[^a-z0-9]+/g," ").trim();
  const byName=name=>{ const n=norm(name); return (characters||[]).find(c=>norm(c&&c.name)===n); };
  const byScene = {}; (shots||[]).forEach(sh=>{ (byScene[sh.sceneId]=byScene[sh.sceneId]||[]).push(sh); });
  (scenes||[]).forEach(scene=>{
    (byScene[scene.id]||[]).forEach(sh=>{
      if(!String(sh.dialogue||"").trim()&&!(Array.isArray(sh.dialogueLines)&&sh.dialogueLines.length)) return;
      let exact=false;
      (Array.isArray(sh.dialogueLines)?sh.dialogueLines:[]).forEach(row=>{
        const c=(row&&row.speakerId&&(characters||[]).find(x=>x.id===row.speakerId))||byName(row&&row.speaker);
        if(c){ set.add(c.id); exact=true; }
      });
      const stamped=(sh.lineAudio&&sh.lineAudio.speakerId&&(characters||[]).find(c=>c.id===sh.lineAudio.speakerId))
        ||byName(sh.lineAudio&&sh.lineAudio.speaker);
      if(stamped){ set.add(stamped.id); exact=true; }
      if(exact) return; // a remote/VO speaker is not required to be physically in frame
      const ids = (typeof inFrameCast==="function") ? inFrameCast(sh, scene, characters||[]) : (sh.subjects||[]);
      (ids||[]).forEach(id=>set.add(id));
    });
  });
  if(!set.size) (scenes||[]).forEach(s=>{ if(s.driver) set.add(s.driver); });
  return set;
}
window.speakingCharIds = speakingCharIds;

const VC_SRC_LABEL = { designed:"Designed", library:"Library", cloned:"Real voice" };
const VC_AUDITION_TEXT = window.VG_VOICE_MASTER_TEXT || "That quick beige fox jumped in the air over each thin dog. Look out, I shout, for he's foiled you again, creating chaos";
function vcStableSeed(id){
  const s=String(id||"voice");let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}
  // inside the signed 32-bit range (2026-10-25: half the cast — "ottavio" hashed to 4,120,027,253 — got a 422 from
  // voice design); a seed already below it is unchanged, so earlier designs keep theirs
  return (h>>>0)%2147483647;
}

/* ── REAL VOICES (2026-10-11, owner — "every user can give a character their own voice or another
   person's"; approved design, "go ahead with all of it") ───────────────────────────────────────────
   A real voice belongs to a PERSON, like a likeness: "Add a real voice" asks whose it is (Me / Someone
   else + their name), that they're 18 or over, and the attestation the server records word for word
   (VC_RV_ATTEST). It is recorded IN THE APP reading a short passage (a length meter, a level check,
   quiet-room advice) or made from uploaded files, cloned once on the server (voicegen.jsx elCloneVoice),
   heard on a short test line, then given to the character ("Use this voice") or thrown away ("Try
   again" deletes it). Cloned once, it's the account's: any character in any film can use it (the
   Real voice tab, the Library's "Your voices"). Face and voice stay independent on the card
   (vcFaceVoiceLine); a character whose likeness is a person with a real voice is offered that voice
   first (vcPairedRealVoice). The Voices window (VoicesManager) lists the account's real voices and
   deletes one for good: this film's characters lose it and their voiced lines are marked to revoice
   (the same rule as removing a voice: app.jsx updateCharacter). On a shared film the owner and an
   Art director may add one (the Art Room is read-only for the other roles); the film's owner holds
   it and pays for it, the server records who attested. */
const VC_RV_ATTEST = "This is my own voice, or the person whose voice this is has agreed to it being cloned and used for characters in my films. They are 18 or over.";
const VC_RV_ADULT = { me:"I'm 18 or over", someone:"They're 18 or over" };
const VC_RV_LIMITS = { minSeconds:30, goodSeconds:60, targetSeconds:90, maxSeconds:300, maxFiles:25, maxBytes:30*1024*1024 };
const VC_RV_ACCEPT = ".mp3,.wav,.m4a,.webm,.ogg,.oga,.opus,.flac,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/wave,audio/mp4,audio/x-m4a,audio/m4a,audio/aac,audio/webm,audio/ogg,audio/flac,audio/x-flac";
/* about 90 seconds read aloud: plain sentences, questions, a list, surprise, doubt and warmth — the range
   a character's lines will need. No names of places, products or people. */
const VC_RV_SCRIPT = [
  "Good morning. I'm reading this so you can hear how I really sound — not a performance, just me.",
  "Have you ever noticed how a city changes when it rains? The streets go quiet, the lights stretch across the pavement, and everyone suddenly walks a little faster. I love that. I always have.",
  "Last summer I took the early train to the coast. The carriage was nearly empty, and then the sea appeared all at once, silver and enormous. I laughed out loud. An old man across the aisle looked up and smiled, as if he knew exactly what I meant.",
  "Not every day is like that, of course. Some mornings the coffee is cold, the bus is late, and nothing goes to plan. Honestly? Those days make the good ones better.",
  "Can you hear the difference when I ask a question? And when I'm sure of something, I say it plainly: this matters to me.",
  "Wait — did I lock the door? No. It's fine. I'm sure it's fine.",
  "I'm grateful for small things: a friend who calls back, a song I'd forgotten, the smell of fresh bread in the evening.",
  "So, what happens next? We'll find out together. Thank you for listening. Take care, and I'll see you soon.",
];
const VC_RV_TEST_LINE = "Hi, it's me. This is how I'll sound in the film — does it feel right to you?";
const VC_RV_TIPS = "Find a quiet room, away from fans, traffic and echoing walls. Hold the microphone about a hand's width away and read naturally, as if you were talking to a friend. One person speaking, no music.";
const VC_RV_NOISE_NOTE = "Helps with a noisy recording. On a clean one it can lower the quality, so leave it off unless you need it.";

/* whose voice + the two ticks: { personKind:"me"|"someone", personName, adult, attest } */
function vcRvConsentValid(v){
  return !!(v && (v.personKind==="me" || (v.personKind==="someone" && String(v.personName||"").trim()))
    && v.adult===true && v.attest===true);
}
/* what the server is sent (voicegen.jsx elCloneVoice → op clone consent) */
function vcRvConsentPayload(v){
  return { personKind:v.personKind, personName:v.personKind==="someone" ? String(v.personName||"").trim().slice(0,80) : "", adult:true, attest:true };
}
function vcRvFmt(sec){
  const s = Math.max(0, Math.round(Number(sec)||0));
  return Math.floor(s/60)+":"+String(s%60).padStart(2,"0");
}
/* the recordings as the server will judge them (voice-registry.mjs cloneSamples): 1–25 files, 30 MB in all,
   30 s to 5 min of audio when every length is known (a file whose length can't be read here is checked there) */
function vcRvSamplesCheck(samples){
  const list = Array.isArray(samples) ? samples.filter(Boolean) : [];
  const L = VC_RV_LIMITS;
  let seconds = 0, unknown = 0, bytes = 0;
  list.forEach(s=>{ bytes += Number(s.bytes)||0; if(Number(s.seconds)>0) seconds += Number(s.seconds); else unknown++; });
  seconds = Math.round(seconds*10)/10;
  const out = (ok, state, message)=>({ ok, state, message, seconds, unknown, bytes, count:list.length });
  if(!list.length) return out(false, "empty", "Record the reading, or add recordings of the voice.");
  if(list.length > L.maxFiles) return out(false, "toomany", "Use at most "+L.maxFiles+" recordings.");
  if(bytes > L.maxBytes) return out(false, "toobig", "The recordings are too large together (30 MB at most). About 2 minutes of speech is plenty.");
  if(seconds > L.maxSeconds) return out(false, "long", "That's more than 5 minutes of audio. About 1 to 2 minutes of clear speech is best.");
  if(!unknown && seconds < L.minSeconds) return out(false, "short", "That's only "+Math.round(seconds)+" second"+(Math.round(seconds)===1?"":"s")+". Record at least 30 seconds — about a minute and a half works best.");
  if(!unknown && seconds < L.goodSeconds) return out(true, "fair", "Enough to clone. At least a minute is recommended for a closer match.");
  if(unknown) return out(true, "unknown", "The length of "+(unknown===1?"one file":unknown+" files")+" can't be read here — it's checked when you clone (30 seconds to 5 minutes in all).");
  return out(true, "good", "A good length.");
}
/* one level reading (0..1 linear): clipping beats quiet */
function vcRvLevelVerdict(rms, peak){
  if(Number(peak) >= 0.98) return "clip";
  if(Number(rms) < 0.012) return "quiet";
  return "ok";
}
const VC_RV_LEVEL_TEXT = {
  quiet:"Too quiet — move a little closer to the microphone, or speak up.",
  clip:"Too loud — it's distorting. Move back a little or speak a bit softer.",
};
/* the recorder's format: the first one the browser can make (the server reads WebM, Ogg and MP4 lengths) */
function vcRvPickMime(isSupported){
  const pref = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/ogg","audio/mp4;codecs=mp4a.40.2","audio/mp4"];
  if(typeof isSupported!=="function") return "";
  for(const m of pref){ try{ if(isSupported(m)) return m; }catch(e){} }
  return "";
}
/* a real person's voice this account may use: its own, or one linked to the open film */
function vcIsRealVoice(v){ return !!(v && v.voiceId && v.kind==="cloned" && (v.own || v.onFilm)); }
function vcRealVoicesOf(voices){ return (Array.isArray(voices) ? voices : []).filter(vcIsRealVoice); }
/* the Library tab: "Your voices", "On this film" and the stock voices — never another account's recorded voice
   (the server filters them out; a recorded voice that is neither ours nor the film's is dropped here too) */
function vcLibraryGroups(voices){
  const list = (Array.isArray(voices) ? voices : []).filter(v=>v && v.voiceId);
  const recordedCat = (v)=>/^(cloned|generated|professional_clone)$/i.test(String(v.category||""));
  return {
    own: list.filter(v=>v.own),
    film: list.filter(v=>!v.own && v.onFilm),
    stock: list.filter(v=>!v.own && !v.onFilm && !v.kind && !recordedCat(v)),
  };
}
function vcLockSourceFor(v){
  if(v && v.kind==="cloned") return "cloned";
  if(v && (v.own || v.onFilm) && v.kind==="designed") return "designed";
  return "library";
}
/* the person a real voice is: someone's name, or the "me" label (the attester's display name) */
function vcVoicePerson(v){
  if(!v) return "";
  const real = v.real || v;
  if(real.personKind==="someone") return String(real.personName||real.label||v.name||"").trim();
  const label = String(real.label||v.voiceName||v.name||"").trim();
  return (!label || /^my voice$/i.test(label)) ? "" : label;
}
function vcPossessive(name){ const n = String(name||"").trim(); return n ? n+"'s" : "your"; }
// "Use Sam's voice"; this account's own "Me" voice is "Use your voice"
function vcVoiceUseLabel(v){ return (v && v.own && v.personKind==="me") ? "Use your voice" : "Use "+vcPossessive(vcVoicePerson(v))+" voice"; }
/* may this person add a voice of their own here — a real one or a designed one (they count together: the studio's
   voice plan holds a fixed number of voices for everyone, owner 2026-10-11) — and if not, why (said next to the
   disabled button). customVoices from the server; realVoices on an older one. */
function vcRvAddState(o){
  o = o || {};
  const cv = o.customVoices || o.realVoices || null;
  const count = cv ? (cv.limit==null ? (cv.used+" voice"+(cv.used===1?"":"s")+" used") : (cv.used+" of "+cv.limit+" voices used")) : "";
  const no = (why)=>({ can:false, why, count });
  if(!o.ready) return no("Sign in to add a voice of your own.");
  if(o.readOnly) return no("Your role on this film can't add voices — the film's owner or an Art director can.");
  if(cv && cv.limit===0) return no("Voices of your own need a Director or Producer plan.");
  if(cv && cv.limit!=null && cv.used>=cv.limit) return no(cv.used+" of "+cv.limit+" voices used — delete one in Voices to add another.");
  return { can:true, why:"", count };
}
/* the likeness on the card is a person with a real voice in this account: offer it first.
   "Me" likeness ↔ a "me" voice of this account; "Someone else" ↔ a "someone" voice with the same name. */
function vcNormName(n){ return String(n||"").normalize ? String(n||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim().toLowerCase() : String(n||"").replace(/\s+/g," ").trim().toLowerCase(); }
function vcPairedRealVoice(likeness, voices){
  const c = likeness && likeness.available!==false && likeness.consent;
  if(!c) return null;
  const real = vcRealVoicesOf(voices);
  if(c.subject==="self") return real.find(v=>v.own && v.personKind==="me") || null;
  if(c.subject==="other" && vcNormName(c.name)) return real.find(v=>v.personKind==="someone" && vcNormName(v.personName)===vcNormName(c.name)) || null;
  return null;
}
/* the offer at the top of the Voice popup: { text, button } */
function vcPairText(c, likeness, paired){
  const self = !!(likeness && likeness.consent && likeness.consent.subject==="self");
  const who = self ? "" : (String((likeness && likeness.consent && likeness.consent.name)||"").trim() || vcVoicePerson(paired));
  const pos = self ? "your" : vcPossessive(who);
  return { text:((c && c.name) || "This character")+" has "+pos+" likeness — "+pos+" real voice is in your voices.",
    button:"Use "+pos+" voice" };
}
/* the card's line: which face and which voice — "Face: Sam (likeness) · Voice: Sam (real voice)" */
function vcFaceVoiceLine(likeness, lock){
  const parts = [];
  if(likeness && likeness.locked!==false){
    const c = likeness.consent || {};
    const who = (c.subject==="other" && String(c.name||"").trim()) ? String(c.name).trim()
      : (c.subject==="self" ? (likeness.mine===false ? "a teammate" : "you") : "");
    parts.push("Face: "+(who ? who+" (likeness)" : "likeness"));
  }
  if(lock && lock.voiceId){
    if(lock.source==="cloned"){ const who = vcVoicePerson(lock); parts.push("Voice: "+(who || "you")+" (real voice)"); }
    else if(lock.source==="designed") parts.push("Voice: designed");
    else parts.push("Voice: from the library");
  }else if(parts.length) parts.push("Voice: not cast yet");
  return parts.join(" · ");
}
/* taking a voice off a character only unlinks it: asked first */
function vcUnlinkConfirm(c, lock){
  const n = (c && c.name) || "this character";
  const real = lock && lock.source==="cloned";
  const who = real ? vcVoicePerson(lock) : "";
  return { title:"Take this voice off "+n+"?",
    body:n+" will need another voice, and lines already voiced with it are marked to revoice."
      +(real ? " "+(who ? vcPossessive(who)+" real voice" : "The real voice")+" stays in your voices — delete it for good in Voices." : ""),
    confirmLabel:"Remove voice", cancelLabel:"Cancel", danger:true };
}
function vcVoiceUsers(voiceId, characters){
  return (Array.isArray(characters) ? characters : []).filter(c=>c && c.voiceLock && String(c.voiceLock.voiceId||"")===String(voiceId||""));
}
/* how a voice of the account is named in the Voices window, its confirm and its toast */
function vcOwnVoiceTitle(v){
  if(v && v.kind==="designed") return "the designed voice \u201c"+(String(v.name||"").trim() || "Designed voice")+"\u201d";
  return vcPossessive(vcVoicePerson(v))+" real voice";
}
function vcDeleteConfirm(v, users){
  const names = (users||[]).map(c=>c.name||"A character");
  return { title:"Delete "+vcOwnVoiceTitle(v)+" for good?",
    body:"It's deleted everywhere and can't be undone. Every film that uses it will need another voice for those characters."
      +(names.length ? " In this film these characters lose it, and their lines voiced with it are marked to revoice:" : " No character in this film uses it."),
    items:names.length ? names : undefined,
    confirmLabel:"Delete voice", cancelLabel:"Cancel", danger:true };
}
/* lock one of the account's (or the film's) recorded voices — or a stock one — on a character. A recorded voice
   is linked to the open film first (attachVoice, free), so everyone on the film can voice lines with it; a
   refusal (not this account's / deleted) stops the lock, any other failure doesn't. */
async function vcLockRecordedVoice(v, deps){
  const d = deps || {};
  if(!v || !v.voiceId) throw new Error("Which voice?");
  const source = vcLockSourceFor(v);
  const recorded = !!(v.own || v.onFilm || v.kind);
  let linked = null;
  if(recorded && typeof d.attach==="function"){
    try{ linked = await d.attach(v.voiceId); }
    catch(e){ if(e && (e.code==="voice_not_allowed" || e.code==="voice_deleted")) throw e; }
  }
  const name = source==="cloned" ? (vcVoicePerson(v) || v.name || "Real voice") : (v.name || v.voiceId);
  const prov = source==="cloned" ? { real:{ personKind:v.personKind||"", personName:v.personName||"", label:v.name||"" } } : null;
  return { lock:d.lock(v.voiceId, name, source, prov), linked };
}
/* delete a real voice for good (the Voices window): asked first; then this film's characters lose it */
async function vcDeleteRealVoiceFlow(o){
  const { voice, characters, onUpdate, confirm, del } = o || {};
  if(!voice || !voice.voiceId) return { deleted:false, unlinked:[] };
  const users = vcVoiceUsers(voice.voiceId, characters);
  const ok = typeof confirm==="function" ? await confirm(vcDeleteConfirm(voice, users)) : true;
  if(!ok) return { deleted:false, unlinked:[], cancelled:true };
  await del(voice.voiceId);
  users.forEach(c=>{ if(typeof onUpdate==="function") onUpdate(c.id, { voiceLock:null }); });
  return { deleted:true, unlinked:users.map(c=>c.id) };
}
/* when this browser added each real voice — only a fallback since 2026-10-11: the server's list carries each voice's
   own createdAt (the same on every device), which wins */
const VC_RV_ADDED_KEY = "turn_real_voices_added";
function vcRvAddedAt(voiceId){ try{ return (JSON.parse(localStorage.getItem(VC_RV_ADDED_KEY)||"{}")||{})[voiceId] || ""; }catch(e){ return ""; } }
function vcRvRememberAdded(voiceId){
  try{ const m = JSON.parse(localStorage.getItem(VC_RV_ADDED_KEY)||"{}")||{}; m[voiceId] = new Date().toISOString();
    const keys = Object.keys(m); if(keys.length>200) keys.slice(0, keys.length-200).forEach(k=>delete m[k]);
    localStorage.setItem(VC_RV_ADDED_KEY, JSON.stringify(m)); }catch(e){}
}
function vcErrorText(e, fallback){ return String((e && e.message) || fallback || "Something went wrong."); }
function vcMeasureSeconds(url){
  return new Promise((resolve)=>{
    try{
      const a = new Audio(); let done = false;
      const fin = (s)=>{ if(done) return; done = true; resolve(s); };
      a.addEventListener("loadedmetadata", ()=>{ const s = Number(a.duration); fin(isFinite(s) && s>0 ? Math.round(s*10)/10 : 0); });
      a.addEventListener("error", ()=>fin(0));
      setTimeout(()=>fin(0), 6000);
      a.preload = "metadata"; a.src = url;
    }catch(e){ resolve(0); }
  });
}
function vcReadDataUrl(blob){
  return new Promise((res)=>{ try{ const r = new FileReader(); r.onload = ()=>res(String(r.result||"")); r.onerror = ()=>res(""); r.readAsDataURL(blob); }catch(e){ res(""); } });
}
function vcPortal(el){
  const RD = window.ReactDOM;
  return (RD && typeof RD.createPortal==="function" && typeof document!=="undefined" && document.body) ? RD.createPortal(el, document.body) : el;
}
Object.assign(window, { VC_RV_ATTEST, VC_RV_LIMITS, VC_RV_SCRIPT, VC_RV_TEST_LINE, vcRvConsentValid, vcRvConsentPayload, vcRvSamplesCheck,
  vcRvLevelVerdict, vcRvPickMime, vcIsRealVoice, vcRealVoicesOf, vcLibraryGroups, vcLockSourceFor, vcVoicePerson, vcVoiceUseLabel,
  vcRvAddState, vcPairedRealVoice, vcPairText, vcFaceVoiceLine, vcUnlinkConfirm, vcDeleteConfirm, vcVoiceUsers, vcLockRecordedVoice,
  vcDeleteRealVoiceFlow, vcRvAddedAt, vcRvRememberAdded });

/* "Whose voice is this?" — Me / Someone else (their name), 18 or over, and the attestation word for word */
function VcRvConsentFields({ value, onChange }){
  const v = value || {};
  const set = (patch)=> onChange && onChange({ ...v, ...patch });
  // another answer reads another sentence: both boxes are ticked again for it
  const pick = (k)=> set({ personKind:k, adult:k===v.personKind ? !!v.adult : false, attest:k===v.personKind ? !!v.attest : false });
  return _vcEl("div",{ className:"cameo-whose vc-rv-whose" },
    _vcEl("div",{ className:"cameo-whose-q" },"Whose voice is this?"),
    _vcEl("div",{ className:"cameo-whose-opts", role:"radiogroup", "aria-label":"Whose voice is this?" },
      [["me","Me"],["someone","Someone else"]].map(([k,label])=>_vcEl("button",{ key:k, type:"button", role:"radio",
        "aria-checked":v.personKind===k?"true":"false", "data-person":k, className:"cameo-whose-opt"+(v.personKind===k?" on":""),
        onClick:()=>pick(k) }, label))),
    v.personKind==="someone" && _vcEl("input",{ className:"cameo-subject", type:"text", value:v.personName||"", maxLength:80,
      "data-role":"rv-name", "aria-label":"Their name", placeholder:"Their name (required)",
      onChange:(e)=>set({ personName:e.target.value }) }),
    v.personKind && _vcEl("label",{ className:"cameo-check" },
      _vcEl("input",{ type:"checkbox", checked:!!v.adult, "data-role":"rv-adult", onChange:(e)=>set({ adult:e.target.checked }) }),
      _vcEl("span",null, VC_RV_ADULT[v.personKind])),
    v.personKind && _vcEl("label",{ className:"cameo-check" },
      _vcEl("input",{ type:"checkbox", checked:!!v.attest, "data-role":"rv-attest", onChange:(e)=>set({ attest:e.target.checked }) }),
      _vcEl("span",null, VC_RV_ATTEST)));
}

/* the in-app recorder: the passage to read, a length meter (the whole set, aiming at about 90 s), a level check */
function VcRecorder({ baseSeconds, takeNo, onRecorded, disabled }){
  const [phase, setPhase] = React.useState("idle");      // idle | asking | recording | saving | denied | unsupported
  const [elapsed, setElapsed] = React.useState(0);
  const [level, setLevel] = React.useState(0);
  const [warn, setWarn] = React.useState("");
  const r = React.useRef({});
  const cleanup = ()=>{
    const x = r.current;
    if(x.raf) cancelAnimationFrame(x.raf);
    if(x.tick) clearInterval(x.tick);
    if(x.stream) try{ x.stream.getTracks().forEach(t=>t.stop()); }catch(e){}
    if(x.ctx) try{ x.ctx.close(); }catch(e){}
    r.current = {};
  };
  React.useEffect(()=>()=>{ const x = r.current; if(x.rec && x.rec.state!=="inactive"){ x.discard = true; try{ x.rec.stop(); }catch(e){} } cleanup(); },[]);
  const L = VC_RV_LIMITS;
  const start = async ()=>{
    if(disabled || phase==="recording" || phase==="asking") return;
    const md = typeof navigator!=="undefined" && navigator.mediaDevices;
    if(!md || typeof md.getUserMedia!=="function" || typeof MediaRecorder==="undefined"){ setPhase("unsupported"); return; }
    setPhase("asking"); setWarn(""); setElapsed(0); setLevel(0);
    let stream;
    try{ stream = await md.getUserMedia({ audio:{ echoCancellation:true, noiseSuppression:false, autoGainControl:false, channelCount:1 } }); }
    catch(e){ setPhase("denied"); return; }
    const mime = vcRvPickMime((m)=>MediaRecorder.isTypeSupported(m));
    let rec;
    try{ rec = mime ? new MediaRecorder(stream, { mimeType:mime }) : new MediaRecorder(stream); }
    catch(e){ try{ stream.getTracks().forEach(t=>t.stop()); }catch(_e){} setPhase("unsupported"); return; }
    const x = { stream, rec, chunks:[], t0:Date.now(), quietSince:0, clipUntil:0, lastUi:0 };
    r.current = x;
    rec.ondataavailable = (e)=>{ if(e.data && e.data.size) x.chunks.push(e.data); };
    rec.onstop = async ()=>{
      const seconds = Math.round((Date.now()-x.t0)/100)/10;
      const blob = new Blob(x.chunks, { type:rec.mimeType || mime || "audio/webm" });
      const discard = x.discard;
      cleanup();
      if(discard) return;
      setPhase("saving");
      const dataUrl = await vcReadDataUrl(blob);
      setPhase("idle"); setElapsed(0); setLevel(0); setWarn("");
      if(dataUrl && blob.size) onRecorded && onRecorded({ id:"rec-"+Date.now().toString(36), kind:"recording",
        name:"Recording "+(takeNo||1), dataUrl, seconds, bytes:blob.size, mime:blob.type });
    };
    // the level: an analyser on the same stream (nothing leaves the device while you record)
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if(AC){
        const ctx = new AC(); const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser();
        an.fftSize = 2048; src.connect(an); x.ctx = ctx;
        const buf = new Float32Array(an.fftSize);
        const loop = ()=>{
          if(r.current!==x) return;
          an.getFloatTimeDomainData(buf);
          let sum = 0, peak = 0; for(let i=0;i<buf.length;i++){ const s = Math.abs(buf[i]); sum += s*s; if(s>peak) peak = s; }
          const rms = Math.sqrt(sum/buf.length), now = Date.now(), verdict = vcRvLevelVerdict(rms, peak);
          if(verdict==="clip") x.clipUntil = now+2000;
          if(verdict==="quiet"){ if(!x.quietSince) x.quietSince = now; } else x.quietSince = 0;
          if(now - x.lastUi > 100){
            x.lastUi = now;
            setLevel(Math.min(1, rms*6));
            setWarn(now < x.clipUntil ? "clip" : (x.quietSince && now-x.quietSince > 1800 ? "quiet" : ""));
          }
          x.raf = requestAnimationFrame(loop);
        };
        x.raf = requestAnimationFrame(loop);
      }
    }catch(e){}
    x.tick = setInterval(()=>{
      const s = (Date.now()-x.t0)/1000;
      setElapsed(s);
      if((Number(baseSeconds)||0)+s >= L.maxSeconds || s >= L.maxSeconds){ try{ rec.stop(); }catch(e){} }
    }, 250);
    try{ rec.start(1000); setPhase("recording"); }catch(e){ cleanup(); setPhase("unsupported"); }
  };
  const stop = ()=>{ const x = r.current; if(x.rec && x.rec.state!=="inactive"){ try{ x.rec.stop(); }catch(e){} } };
  const total = (Number(baseSeconds)||0) + (phase==="recording" ? elapsed : 0);
  const pct = (s)=> Math.min(100, s/L.targetSeconds*100);
  const recording = phase==="recording";
  return _vcEl("div",{ className:"vc-rv-rec", "data-phase":phase },
    _vcEl("div",{ className:"vc-rv-script", "aria-label":"Read this aloud" },
      _vcEl("div",{ className:"vc-lab" },"Read this aloud"),
      VC_RV_SCRIPT.map((p,i)=>_vcEl("p",{ key:i }, p))),
    _vcEl("div",{ className:"vc-rv-meter", role:"meter", "aria-label":"Recorded length", "aria-valuemin":0, "aria-valuemax":L.targetSeconds,
        "aria-valuenow":Math.round(total) },
      _vcEl("div",{ className:"vc-rv-meter-bar"+(total>=L.goodSeconds?" good":total>=L.minSeconds?" fair":"") , style:{ width:pct(total)+"%" } }),
      _vcEl("span",{ className:"vc-rv-mark min", style:{ left:pct(L.minSeconds)+"%" }, title:"30 seconds: the least that can be cloned" }),
      _vcEl("span",{ className:"vc-rv-mark rec", style:{ left:pct(L.goodSeconds)+"%" }, title:"1 minute: recommended" })),
    _vcEl("div",{ className:"vc-rv-meter-t" },
      _vcEl("b",null, vcRvFmt(total)), " recorded · aim for about 1:30 (at least 1:00; 0:30 is the least that works)"),
    recording && _vcEl("div",{ className:"vc-rv-level"+(warn?" "+warn:"") },
      _vcEl("span",{ className:"vc-rv-level-lab" },"Level"),
      _vcEl("span",{ className:"vc-rv-level-track" }, _vcEl("span",{ className:"vc-rv-level-bar", style:{ width:Math.round(level*100)+"%" } })),
      warn && _vcEl("span",{ className:"vc-rv-level-warn", role:"status" }, VC_RV_LEVEL_TEXT[warn])),
    phase==="denied" && _vcEl("div",{ className:"vc-err" },"The microphone is blocked. Allow it in the browser's address bar, or upload recordings instead."),
    phase==="unsupported" && _vcEl("div",{ className:"vc-err" },"This browser can't record here. Upload recordings instead."),
    _vcEl("div",{ className:"vc-actions" },
      recording
        ? _vcEl("button",{ type:"button", className:"vc-btn primary vc-rv-stop", onClick:stop, "data-role":"rv-stop" },
            _vcEl("span",{ className:"vc-rv-dot", "aria-hidden":"true" }), "Stop · "+vcRvFmt(elapsed))
        : _vcEl("button",{ type:"button", className:"vc-btn primary", onClick:start, disabled:disabled || phase==="asking" || phase==="saving",
            "data-role":"rv-record" }, _vcEl(Icon.mic,{ s:14 }),
            phase==="asking" ? "Allow the microphone…" : phase==="saving" ? "Saving…" : (takeNo>1 ? "Record another take" : "Start recording"))),
    _vcEl("div",{ className:"vc-note vc-rv-tips" }, _vcEl(Icon.info||Icon.alert,{ s:12 }), _vcEl("span",null, VC_RV_TIPS)));
}

/* "Add a real voice": whose it is, the recordings, the clone, the test line, then Use / Try again */
function RealVoiceModal({ character, modelId, onClose, onUse }){
  const [consent, setConsent] = React.useState({ personKind:"", personName:"", adult:false, attest:false });
  const [samples, setSamples] = React.useState([]);
  const [tab, setTab] = React.useState("record");
  const [removeNoise, setRemoveNoise] = React.useState(false);
  const [step, setStep] = React.useState("add");          // add | cloning | preview
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [cloned, setCloned] = React.useState(null);
  const [testUrl, setTestUrl] = React.useState("");
  const [testBusy, setTestBusy] = React.useState(false);
  const [testErr, setTestErr] = React.useState("");
  const audioRef = React.useRef(null);
  const aliveRef = React.useRef(true);
  React.useEffect(()=>{ aliveRef.current = true; return ()=>{ aliveRef.current = false; try{ audioRef.current && audioRef.current.pause(); }catch(e){} }; },[]);
  const check = vcRvSamplesCheck(samples);
  const consentOk = vcRvConsentValid(consent);
  const cloneCr = (typeof window.vgVoiceOpCredits==="function") ? window.vgVoiceOpCredits("clone") : 0;
  const testCr = (typeof window.vgLineCredits==="function") ? window.vgLineCredits(VC_RV_TEST_LINE, modelId||window.VG_TTS_MODEL||"") : 0;
  const cr = (n)=> n+" credit"+(n===1?"":"s");
  const name = (character && character.name) || "this character";
  const play = (url)=>{
    if(!url) return;
    try{ if(audioRef.current) audioRef.current.pause(); const a = new Audio(url); audioRef.current = a; const p = a.play(); if(p && p.catch) p.catch(()=>{}); }catch(e){}
  };
  const addFiles = async (e)=>{
    const files = Array.from((e.target && e.target.files) || []);
    if(e.target) e.target.value = "";
    if(!files.length) return;
    const room = VC_RV_LIMITS.maxFiles - samples.length;
    if(room<=0){ setErr("Use at most "+VC_RV_LIMITS.maxFiles+" recordings."); return; }
    const take = files.slice(0, room);
    const added = [];
    for(const f of take){
      const dataUrl = await vcReadDataUrl(f);
      if(!dataUrl) continue;
      const seconds = await vcMeasureSeconds(dataUrl);
      added.push({ id:"file-"+Date.now().toString(36)+"-"+added.length, kind:"file", name:String(f.name||"Recording").slice(0,80), dataUrl, seconds, bytes:f.size||0, mime:f.type||"" });
    }
    if(!aliveRef.current) return;
    // adding files ADDS them: what's already there stays
    setSamples(prev=>[...prev, ...added].slice(0, VC_RV_LIMITS.maxFiles));
    setErr(files.length>take.length ? "Only "+VC_RV_LIMITS.maxFiles+" recordings can be used — "+(files.length-take.length)+" weren't added." : "");
  };
  const runTest = async (voiceId)=>{
    setTestBusy(true); setTestErr("");
    try{
      const r = await window.elGenerate("", VC_RV_TEST_LINE, { voiceId, modelId:modelId||window.VG_TTS_MODEL, force:true });
      if(!aliveRef.current) return;
      setTestUrl(r.audioUrl||""); play(r.audioUrl);
    }catch(e){ if(aliveRef.current) setTestErr(vcErrorText(e, "The test line couldn't be made.")); }
    if(aliveRef.current) setTestBusy(false);
  };
  const clone = async ()=>{
    if(busy || !consentOk || !check.ok) return;
    setBusy(true); setErr(""); setStep("cloning");
    try{
      const r = await window.elCloneVoice(samples.map(s=>s.dataUrl), { consent:vcRvConsentPayload(consent), removeNoise,
        meName:String(window.turnUserDisplayName||"").trim() });
      if(!aliveRef.current) return;
      vcRvRememberAdded(r.voiceId);
      // the ticks are asked again for the next clone
      setConsent(c=>({ ...c, adult:false, attest:false }));
      setCloned({ ...r, own:true, kind:"cloned" });
      setStep("preview");
      runTest(r.voiceId);
    }catch(e){ if(aliveRef.current){ setErr(vcErrorText(e, "The voice couldn't be cloned.")); setStep("add"); } }
    if(aliveRef.current) setBusy(false);
  };
  const tryAgain = async ()=>{
    if(busy || !cloned) return;
    setBusy(true); setErr("");
    try{ if(audioRef.current) audioRef.current.pause(); }catch(e){}
    try{ await window.elDeleteVoice(cloned.voiceId); }
    catch(e){ setErr("That try couldn't be deleted ("+vcErrorText(e,"")+"). It's still in Voices, where you can delete it."); }
    if(!aliveRef.current) return;
    setCloned(null); setTestUrl(""); setTestErr(""); setSamples([]); setStep("add"); setBusy(false);
  };
  const use = async ()=>{
    if(busy || !cloned) return;
    setBusy(true); setErr("");
    try{ if(onUse) await onUse(cloned); if(aliveRef.current) onClose(); }
    catch(e){ if(aliveRef.current){ setErr(vcErrorText(e, "That voice couldn't be used.")); setBusy(false); } }
  };
  const close = ()=>{ if(step==="cloning") return; onClose(); };
  const who = cloned ? vcVoicePerson(cloned) : "";
  return vcPortal(_vcEl("div",{ className:"cameo-overlay vc-rv-overlay", onClick:close,
      onKeyDown:(e)=>{ if(e.key==="Escape"){ e.stopPropagation(); close(); } } },
    _vcEl("div",{ className:"cameo-modal vc-rv-modal", role:"dialog", "aria-modal":"true", "aria-label":"Add a real voice", "data-testid":"real-voice-window",
        onClick:(e)=>e.stopPropagation() },
      _vcEl("div",{ className:"cameo-head" },
        _vcEl("div",null,
          _vcEl("div",{ className:"cameo-title" }, _vcEl(Icon.mic,{ s:16 }), " Add a real voice"),
          _vcEl("div",{ className:"cameo-sub" }, step==="preview"
            ? "Listen to the new voice before you give it to "+name+"."
            : "A real person's voice — yours or someone else's — cloned once, then usable for any character in your films.")),
        _vcEl("button",{ className:"cameo-x", onClick:close, "aria-label":"Close", disabled:step==="cloning" }, _vcEl(Icon.x,{ s:16 }))),
      step!=="preview"
        ? _vcEl("div",{ className:"vc-rv-body" },
            _vcEl(VcRvConsentFields,{ value:consent, onChange:setConsent }),
            _vcEl("div",{ className:"vc-modes vc-rv-tabs", role:"tablist" },
              [["record","Record here"],["upload","Upload files"]].map(([k,label])=>_vcEl("button",{ key:k, type:"button", role:"tab",
                "aria-selected":tab===k?"true":"false", className:"vc-mode"+(tab===k?" on":""), onClick:()=>setTab(k) }, label))),
            tab==="record"
              ? _vcEl(VcRecorder,{ baseSeconds:check.seconds, takeNo:samples.filter(s=>s.kind==="recording").length+1, disabled:busy,
                  onRecorded:(s)=>setSamples(prev=>[...prev, s].slice(0, VC_RV_LIMITS.maxFiles)) })
              : _vcEl("div",{ className:"vc-rv-upload" },
                  _vcEl("label",{ className:"vc-upload" }, _vcEl(Icon.plus,{ s:14 }), samples.length ? "Add more recordings" : "Choose recordings",
                    _vcEl("input",{ type:"file", accept:VC_RV_ACCEPT, multiple:true, onChange:addFiles, style:{ display:"none" }, "data-role":"rv-files" })),
                  _vcEl("div",{ className:"vc-note" }, _vcEl(Icon.info||Icon.alert,{ s:12 }),
                    _vcEl("span",null,"MP3, WAV, M4A, WebM, Ogg or FLAC — up to 25 files, 30 MB in all. About 1 to 2 minutes of one person speaking clearly is best."))),
            samples.length>0 && _vcEl("div",{ className:"vc-rv-samples" },
              samples.map(s=>_vcEl("div",{ key:s.id, className:"vc-preview vc-rv-sample" },
                _vcEl("button",{ type:"button", className:"vc-play", onClick:()=>play(s.dataUrl), "aria-label":"Play "+s.name }, _vcEl(Icon.play,{ s:12 })),
                _vcEl("span",{ className:"vc-preview-lab" }, s.name),
                _vcEl("span",{ className:"vc-rv-sample-len" }, s.seconds>0 ? vcRvFmt(s.seconds) : "length unknown"),
                _vcEl("button",{ type:"button", className:"vc-btn ghost", onClick:()=>setSamples(prev=>prev.filter(x=>x.id!==s.id)),
                  "aria-label":"Remove "+s.name }, "Remove")))),
            samples.length>0 && _vcEl("div",{ className:"vc-rv-check "+check.state, role:"status" },
              (check.seconds>0 ? vcRvFmt(check.seconds)+" in all · " : "")+check.message),
            _vcEl("label",{ className:"cameo-check vc-rv-noise" },
              _vcEl("input",{ type:"checkbox", checked:removeNoise, "data-role":"rv-noise", onChange:(e)=>setRemoveNoise(e.target.checked) }),
              _vcEl("span",null, _vcEl("b",null,"Remove background noise"), " — "+VC_RV_NOISE_NOTE)),
            err && _vcEl("div",{ className:"vc-err", role:"alert" }, err))
        : _vcEl("div",{ className:"vc-rv-body" },
            _vcEl("div",{ className:"vc-rv-done" }, _vcEl(Icon.check,{ s:14 }),
              _vcEl("span",null, (who ? vcPossessive(who)+" voice" : "The voice")+" is ready.")),
            _vcEl("div",{ className:"vc-master-text" },"“"+VC_RV_TEST_LINE+"”"),
            _vcEl("div",{ className:"vc-actions" },
              testUrl
                ? _vcEl("button",{ type:"button", className:"vc-btn", onClick:()=>play(testUrl), "data-role":"rv-replay" }, _vcEl(Icon.play,{ s:12 }), "Play again")
                : _vcEl("button",{ type:"button", className:"vc-btn", disabled:testBusy, onClick:()=>runTest(cloned.voiceId), "data-role":"rv-test" },
                    testBusy ? _vcEl(React.Fragment,null,_vcEl("span",{ className:"ns-spin" }),"Making the test line…")
                      : ("Hear the test line"+(testCr ? " · about "+cr(testCr) : "")))),
            testErr && _vcEl("div",{ className:"vc-err" }, testErr),
            _vcEl("div",{ className:"vc-note" }, _vcEl(Icon.info||Icon.alert,{ s:12 }),
              _vcEl("span",null,"Not quite right? Try again deletes this one and you record again. Closing keeps it in your voices without giving it to "+name+".")),
            err && _vcEl("div",{ className:"vc-err", role:"alert" }, err)),
      _vcEl("div",{ className:"cameo-acts" },
        step!=="preview"
          ? _vcEl(React.Fragment,null,
              _vcEl("button",{ className:"cameo-btn ghost", type:"button", onClick:close, disabled:step==="cloning" },"Cancel"),
              _vcEl("button",{ className:"cameo-btn primary", type:"button", "data-role":"rv-clone", onClick:clone,
                disabled:busy || !consentOk || !check.ok,
                title:!consentOk ? "Say whose voice this is and tick both boxes" : (!check.ok ? check.message : "") },
                step==="cloning" ? _vcEl(React.Fragment,null,_vcEl("span",{ className:"ns-spin" }),"Cloning…")
                  : ("Clone voice"+(cloneCr ? " · "+cr(cloneCr) : ""))))
          : _vcEl(React.Fragment,null,
              _vcEl("button",{ className:"cameo-btn ghost", type:"button", onClick:tryAgain, disabled:busy, "data-role":"rv-retry" },"Try again"),
              _vcEl("button",{ className:"cameo-btn primary", type:"button", onClick:use, disabled:busy, "data-role":"rv-use" },
                onUse ? "Use this voice" : "Done"))),
      step!=="preview" && _vcEl("div",{ className:"vc-rv-foot" },
        "After cloning, the new voice reads a short test line for you to hear"+(testCr ? " (about "+cr(testCr)+")" : "")+"."))));
}

/* the Voices window — the account's own voices, so people can free room themselves (owner 2026-10-11): "Real voices"
   (whose, when, which characters of THIS film use them) and "Designed voices", each with Delete */
function VoicesManager({ characters, onUpdate, onClose }){
  const [state, setState] = React.useState({ loading:true, voices:[], customVoices:null, realVoices:null, err:"" });
  const [busy, setBusy] = React.useState("");
  const load = async ()=>{
    try{
      const r = await window.elListVoicesFull({ quiet:true });
      setState({ loading:false, voices:r.voices||[], customVoices:r.customVoices||null, realVoices:r.realVoices||null, err:"" });
    }catch(e){ setState(s=>({ ...s, loading:false, err:vcErrorText(e, "Your voices couldn't be loaded.") })); }
  };
  React.useEffect(()=>{ if(typeof window.voiceProxyReady==="function" && window.voiceProxyReady()) load();
    else setState({ loading:false, voices:[], customVoices:null, realVoices:null, err:"Sign in to see your voices." }); },[]);
  const real = state.voices.filter(v=>v && v.own && v.kind==="cloned");
  const designed = state.voices.filter(v=>v && v.own && v.kind==="designed");
  const toast = (m,k)=>{ try{ if(typeof window.appToast==="function") window.appToast(m,k); }catch(e){} };
  const doDelete = async (v)=>{
    if(busy) return; setBusy(v.voiceId);
    try{
      const r = await vcDeleteRealVoiceFlow({ voice:v, characters, onUpdate, confirm:window.appConfirm, del:window.elDeleteVoice });
      if(r.deleted){
        const n = r.unlinked.length, t = vcOwnVoiceTitle(v);
        toast(t.charAt(0).toUpperCase()+t.slice(1)+" was deleted."+(n ? " "+n+" character"+(n===1?"":"s")+" in this film need"+(n===1?"s":"")+" another voice." : ""), "success");
        await load();
      }
    }catch(e){ toast(vcErrorText(e, "The voice couldn't be deleted."), "error"); }
    setBusy("");
  };
  const own = real.length + designed.length;
  const count = vcRvAddState({ ready:true, customVoices:state.customVoices || (state.realVoices ? { used:own, limit:state.realVoices.limit } : { used:own, limit:null }) }).count;
  const row = (v)=>{
    const users = vcVoiceUsers(v.voiceId, characters);
    const at = v.createdAt || vcRvAddedAt(v.voiceId) || (users.map(c=>c.voiceLock.lockedAt).filter(Boolean).sort()[0] || "");
    const name = v.kind==="designed" ? (String(v.name||"").trim() || "Designed voice") : (vcVoicePerson(v) || "Your voice");
    const kind = v.kind==="designed" ? "Designed" : (v.personKind==="me" ? "Me" : "Someone else");
    return _vcEl("div",{ key:v.voiceId, className:"cameo-mgr-row", "data-voice":v.voiceId },
      _vcEl("div",{ className:"cameo-mgr-noimg" }, _vcEl(v.kind==="designed" ? Icon.sparkles : Icon.mic,{ s:16 })),
      _vcEl("div",{ className:"cameo-mgr-meta" },
        _vcEl("div",{ className:"cameo-mgr-name" }, name),
        _vcEl("div",{ className:"cameo-mgr-prov" }, [kind, at ? "added "+new Date(at).toLocaleDateString() : ""].filter(Boolean).join(" \u00b7 ")),
        _vcEl("div",{ className:"cameo-mgr-store" },
          _vcEl("span",{ className:"cameo-store-pill "+(users.length?"cloud":"local") },
            users.length ? "In this film: "+users.map(c=>c.name||"a character").join(", ") : "Not used in this film"))),
      _vcEl("div",{ className:"cameo-mgr-acts" },
        _vcEl("button",{ className:"cameo-mgr-btn danger", disabled:!!busy, "data-role":"rv-delete", onClick:()=>doDelete(v) },
          busy===v.voiceId ? "Deleting\u2026" : "Delete")));
  };
  const section = (title, list, key)=> list.length ? _vcEl("div",{ className:"cameo-mgr-sec", key, "data-group":key },
    _vcEl("div",{ className:"cameo-mgr-sec-t" }, title), list.map(row)) : null;
  return vcPortal(_vcEl("div",{ className:"cameo-overlay", onClick:onClose, onKeyDown:(e)=>{ if(e.key==="Escape"){ e.stopPropagation(); onClose(); } } },
    _vcEl("div",{ className:"cameo-modal mgr", role:"dialog", "aria-modal":"true", "aria-label":"Voices", "data-testid":"voices-manager", onClick:(e)=>e.stopPropagation() },
      _vcEl("div",{ className:"cameo-head" },
        _vcEl("div",null,
          _vcEl("div",{ className:"cameo-title" }, _vcEl(Icon.mic,{ s:16 }), " Voices"),
          _vcEl("div",{ className:"cameo-sub", "data-role":"vm-count" }, count+" \u00b7 your own voices, kept privately with your account")),
        _vcEl("button",{ className:"cameo-x", onClick:onClose, "aria-label":"Close" }, _vcEl(Icon.x,{ s:16 }))),
      _vcEl("div",{ className:"cameo-mgr-body" },
        state.loading ? _vcEl("div",{ className:"cameo-mgr-empty" }, _vcEl("span",{ className:"ns-spin" }), "Loading your voices\u2026")
        : state.err ? _vcEl("div",{ className:"vc-err" }, state.err)
        : !own ? _vcEl("div",{ className:"cameo-mgr-empty" }, _vcEl(Icon.mic,{ s:24 }),
            _vcEl("div",null,"No voices of your own yet. On any character card, open ", _vcEl("b",null,"Voice"), " to design one, or ", _vcEl("b",null,"Real voice"), " \u2192 ", _vcEl("b",null,"Add a real voice"), "."))
        : _vcEl(React.Fragment,null,
            section("Real voices", real, "real"),
            section("Designed voices", designed, "designed"),
            _vcEl("div",{ className:"vc-note" }, _vcEl(Icon.info||Icon.alert,{ s:12 }),
              _vcEl("span",null,"Designed and real voices count together. Deleting one frees room for a new one.")))))));
}
window.RealVoiceModal = RealVoiceModal;
window.VoicesManager = VoicesManager;

function VoiceCard({ c, project, speaks, onUpdate, titleId, readOnly, cast }){
  const lock = c.voiceLock && c.voiceLock.voiceId ? c.voiceLock : null;
  const projectId=(project&&project.id)||window.__turnCurrentProjectId||"local";
  const masterAssetId=(typeof window.vgVoiceMasterAssetId==="function")
    ? window.vgVoiceMasterAssetId(c.id) : ("voice-master-"+c.id);
  const masterFileName=(typeof window.vgVoiceMasterFileName==="function")
    ? window.vgVoiceMasterFileName(c.name) : ((c.name||"Character").replace(/[^A-Za-z0-9]+/g,"_")+"_voice.mp3");
  const masterAudio=window.useVoiceGen(masterAssetId);
  const masterStatus=(typeof window.vgVoiceMasterStatus==="function")
    ? window.vgVoiceMasterStatus(lock,masterAudio.audioUrl,masterAudio.meta,projectId)
    : {ready:!!masterAudio.audioUrl,state:masterAudio.audioUrl?"ready":"missing",reason:""};
  const [spec, setSpec] = React.useState(()=> c.voiceSpec || buildVoiceSpec(c));
  // Per-character delivery model. Once a voice is locked, its model is part of that
  // canonical production master and never follows a later app-default migration.
  // WHAT THE VOICE BUTTONS COST (owner 2026-10-06 — Characters review): designing is a flat voice-design call;
  // the voice file is the canonical phrase, priced per character like any line
  const vcDesignPrice = (typeof window.turnCreditCost==="function") ? (" \u00b7 about "+window.turnCreditCost(0.10)+" credit"+(window.turnCreditCost(0.10)===1?"":"s")) : "";
  const vcMasterCr = (typeof window.vgLineCredits==="function" && window.VG_VOICE_MASTER_TEXT)
    ? window.vgLineCredits(window.VG_VOICE_MASTER_TEXT, (lock&&lock.modelId)||window.VG_TTS_MODEL||"") : 0;
  const vcMasterPrice = vcMasterCr ? (" \u00b7 about "+vcMasterCr+" credit"+(vcMasterCr===1?"":"s")) : "";
  const effModel = (typeof window.vgDeliveryModelOf==="function") ? window.vgDeliveryModelOf(lock) : ((lock&&lock.modelId) || window.VG_TTS_MODEL || "eleven_v4");
  const [ttsModel, setTtsModel] = React.useState(effModel);
  // the offered models, plus a retired one this voice is still locked on (it keeps it until another is chosen)
  const ttsModels = (()=>{
    const list = window.VG_TTS_MODELS || [{ id:"eleven_v4", label:"Lifelike (v4)" }];
    if(!effModel || list.some(m=>m.id===effModel)) return list;
    const retired = (window.VG_RETIRED_TTS_MODELS||[]).find(m=>m.id===effModel);
    return [...list, retired || { id:effModel, label:effModel }];
  })();
  const changeDelivery = (v)=>{
    setTtsModel(v);
    if(lock){
      const revision=Date.now().toString(36);
      const next={ ...lock, modelId:v, modelChosen:true, revision, revisedAt:new Date().toISOString() };
      next.fingerprint=(typeof window.vgVoiceLockSignature==="function")?window.vgVoiceLockSignature(next):"";
      onUpdate(c.id, { voiceLock:next });
      if(typeof window.appToast==="function"){
        const m = ttsModels.find(x=>x.id===v);
        window.appToast("Delivery model set to "+((m&&m.label)||v)+" — existing lines are marked for revoice.","ok");
      }
    }
  };
  const [mode, setMode] = React.useState("design");       // design | library | clone
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [previews, setPreviews] = React.useState([]);     // design previews
  const [library, setLibrary] = React.useState([]);       // library voices
  // the voices this account may use (free to list): the Real voice tab, the Library groups, the likeness pairing
  const [vlist, setVlist] = React.useState({ loaded:false, voices:[], customVoices:null, realVoices:null });
  const [rvOpen, setRvOpen] = React.useState(false);       // "Add a real voice"
  const [mgrOpen, setMgrOpen] = React.useState(false);     // the Voices window
  const ready = (typeof voiceProxyReady==="function") && voiceProxyReady();
  const aliveRef = React.useRef(true);
  const audioRef = React.useRef(null); // { audio, url } — private to this character card
  const [playingUrl, setPlayingUrl] = React.useState("");
  const stopAudio = React.useCallback((discard)=>{
    const current=audioRef.current;
    if(!current) return;
    try{ current.audio.pause(); }catch(e){}
    if(discard){
      current.audio.onended=null;
      current.audio.onerror=null;
      audioRef.current=null;
    }
    if(aliveRef.current) setPlayingUrl("");
  },[]);
  const toggleAudio = React.useCallback((url)=>{
    if(!url) return;
    const current=audioRef.current;
    if(current && current.url===url){
      if(!current.audio.paused && !current.audio.ended){
        current.audio.pause();
        if(aliveRef.current) setPlayingUrl("");
        return;
      }
      if(current.audio.ended){ try{ current.audio.currentTime=0; }catch(e){} }
      if(aliveRef.current) setPlayingUrl(url);
      try{
        const started=current.audio.play();
        if(started && typeof started.catch==="function") started.catch(()=>{
          if(aliveRef.current && audioRef.current===current) setPlayingUrl("");
        });
      }catch(e){ if(aliveRef.current && audioRef.current===current) setPlayingUrl(""); }
      return;
    }
    if(current){
      try{ current.audio.pause(); }catch(e){}
      current.audio.onended=null;
      current.audio.onerror=null;
    }
    const audio=new Audio(url);
    const entry={audio,url};
    audioRef.current=entry;
    audio.onended=()=>{
      if(audioRef.current!==entry) return;
      try{ audio.currentTime=0; }catch(e){}
      if(aliveRef.current) setPlayingUrl("");
    };
    audio.onerror=()=>{
      if(audioRef.current!==entry) return;
      audioRef.current=null;
      if(aliveRef.current) setPlayingUrl("");
    };
    if(aliveRef.current) setPlayingUrl(url);
    try{
      const started=audio.play();
      if(started && typeof started.catch==="function") started.catch(audio.onerror);
    }catch(e){ audio.onerror(); }
  },[]);
  React.useEffect(()=>{
    aliveRef.current=true;
    return ()=>{
      aliveRef.current=false;
      const current=audioRef.current;
      if(current){
        try{ current.audio.pause(); }catch(e){}
        current.audio.onended=null;
        current.audio.onerror=null;
        audioRef.current=null;
      }
    };
  },[c.id]);
  const isPlaying=(url)=>!!url && playingUrl===url;

  const loadVoices = React.useCallback(async (quiet)=>{
    const r = await window.elListVoicesFull({ quiet:!!quiet, identityCharacter:c, identityCharacterIds:[c.id],
      identityCast:[c], identityContext:{characterIds:[c.id],cast:[c]} });
    if(aliveRef.current) setVlist({ loaded:true, voices:r.voices||[], customVoices:r.customVoices||null, realVoices:r.realVoices||null });
    return r;
  },[c.id]);
  React.useEffect(()=>{
    if(!ready || typeof window.elListVoicesFull!=="function") return;
    loadVoices(true).catch(()=>{});   // quiet: opening the popup never opens the Plans window
  },[c.id, ready]);
  const likeness = (typeof window.turnLikenessInfo==="function") ? window.turnLikenessInfo(c.id) : null;
  const paired = vcPairedRealVoice(likeness, vlist.voices);
  const realList = vcRealVoicesOf(vlist.voices);
  // designed and real voices count together (customVoices): one rule for "Add a real voice" and Design's save / lock
  const addState = vcRvAddState({ ready, readOnly:!!readOnly, customVoices:vlist.customVoices, realVoices:vlist.realVoices });
  const initials = (c.name||"?").split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const roleSummary = (c.role||"").split(/\s[—-]\s/)[0] || "Character";

  const lockVoice = (voiceId, voiceName, source, provenance)=>{
    const fallbackName = (typeof clipWords==="function") ? clipWords(spec,40) : spec.slice(0,40);
    const now=new Date().toISOString();
    const next={
      voiceId, voiceName: voiceName||fallbackName, source,
      // a real person's voice: whose it is (it never follows the character's description or pronouns)
      ...(source==="cloned" && provenance && provenance.real ? { real:{ personKind:provenance.real.personKind||"", personName:provenance.real.personName||"", label:provenance.real.label||"" } } : {}),
      modelId: ttsModel || (window.VG_TTS_MODEL||"eleven_v3"),
      modelChosen:true,
      identityRevision: c.identityRevision!=null ? String(c.identityRevision) : "",
      identityPronouns: c.canonicalPronouns || c.pronouns || "",
      defaults: window.VG_DEFAULTS || { stability:0.7, similarity:0.75, style:0.1, speed:1.0, speakerBoost:true },
      revision:Date.now().toString(36), lockedAt:now, specSnapshot:source==="cloned" ? "" : spec,
      auditionText:(provenance&&provenance.auditionText)||VC_AUDITION_TEXT,
      auditionSeed:(provenance&&provenance.seed)!=null?provenance.seed:null,
      designModel:(provenance&&provenance.designModel)||"",
      generatedVoiceId:(provenance&&provenance.generatedVoiceId)||"",
      master:null,
      consent: source==="cloned", sync:false,
    };
    next.fingerprint=(typeof window.vgVoiceLockSignature==="function")?window.vgVoiceLockSignature(next):"";
    onUpdate(c.id, source==="cloned" ? { voiceLock:next } : { voiceSpec: spec, voiceLock:next });
    setPreviews([]); setErr("");
    return next;
  };

  const renderMaster = async (voiceLock,force)=>{
    const r=await window.elGenerateVoiceMaster(c,voiceLock,{force:!!force,projectId,
      identityCharacter:c,identityCharacterIds:[c.id],identityCast:[c],
      identityContext:{characterIds:[c.id],cast:[c]} });
    const master={assetId:r.assetId||masterAssetId,fileName:r.fileName||masterFileName,
      text:r.text||VC_AUDITION_TEXT,durationMs:r.durationMs||0,hash:r.hash||"",
      voiceId:voiceLock.voiceId,voiceRevision:voiceLock.revision||"",
      voiceSignature:r.voiceSignature||voiceLock.fingerprint||"",modelId:r.modelId||voiceLock.modelId||"",
      provider:r.provider||"",backend:r.backend||"",renderedAt:r.renderedAt||new Date().toISOString()};
    onUpdate(c.id,{voiceLock:{...voiceLock,master}});
    if(aliveRef.current) toggleAudio(r.audioUrl);
    return r;
  };

  const design = async ()=>{
    if(busy) return; stopAudio(true); setBusy(true); setErr(""); setPreviews([]);
    try{ const ps = await window.elDesignVoice(spec, { text:VC_AUDITION_TEXT,seed:vcStableSeed(c.id),identityCharacter:c, identityCharacterIds:[c.id],
      identityCast:[c], identityContext:{characterIds:[c.id],cast:[c]} }); setPreviews(ps||[]);
      if(!ps || !ps.length) setErr("No previews came back — tweak the description and try again.");
    }catch(e){ setErr(String((e&&e.message)||"Couldn't design a voice.")); }
    setBusy(false);
  };
  const lockPreview = async (p)=>{
    if(busy) return; setBusy(true); setErr("");
    stopAudio(true);
    try{ const r = await window.elSaveVoice(p.generatedVoiceId, { name:c.name, description:spec,
        identityCharacter:c, identityCharacterIds:[c.id], identityCast:[c], identityContext:{characterIds:[c.id],cast:[c]} });
      // a designed voice is this account's: linked to the film so everyone on it can voice its lines (free)
      try{ if(typeof window.elAttachVoice==="function") await window.elAttachVoice(r.voiceId); }catch(e){}
      const next=lockVoice(r.voiceId, r.name, "designed",p);
      loadVoices(true).catch(()=>{});   // the count of the account's voices moved
      try{ await renderMaster(next,false); }
      catch(e){ setErr("Voice locked, but its named master file could not be generated yet. Retry below. "+String((e&&e.message)||"")); }
    }
    catch(e){ setErr(String((e&&e.message)||"Couldn't lock that voice.")); }
    setBusy(false);
  };
  const browse = async ()=>{
    if(busy) return; stopAudio(true); setBusy(true); setErr(""); setLibrary([]);
    try{ const r = await loadVoices(false); const vs = r.voices||[]; setLibrary(vs); if(!vs.length) setErr("No library voices yet."); }
    catch(e){ setErr(String((e&&e.message)||"Couldn't load the library.")); }
    setBusy(false);
  };
  // a voice from the account / the film / the library: a recorded one is linked to the film first (vcLockRecordedVoice)
  const useVoice = async (v)=>{
    if(busy || !v) return; stopAudio(true); setBusy(true); setErr("");
    try{ await vcLockRecordedVoice(v, { lock:lockVoice, attach:window.elAttachVoice }); }
    catch(e){ setErr(vcErrorText(e, "That voice couldn't be used.")); if(e && e.code==="voice_deleted") loadVoices(true).catch(()=>{}); }
    if(aliveRef.current) setBusy(false);
  };
  // "Use this voice" after a clone (RealVoiceModal): locked on this character, linked to the film
  const useCloned = async (v)=>{
    await vcLockRecordedVoice({ ...v, own:true, kind:"cloned" }, { lock:lockVoice, attach:window.elAttachVoice });
    loadVoices(true).catch(()=>{});
  };
  // taking a voice off only unlinks it from this character — asked first
  const removeLock = async ()=>{
    const ok = typeof window.appConfirm==="function" ? await window.appConfirm(vcUnlinkConfirm(c, lock)) : true;
    if(!ok) return;
    stopAudio(true); onUpdate(c.id,{ voiceLock:null });
  };
  const test = async (force)=>{
    if(busy || !lock) return; stopAudio(true); setBusy(true); setErr("");
    try{ await renderMaster(lock,!!force); }
    catch(e){ setErr(String((e&&e.message)||"Couldn't render the voice master.")); }
    setBusy(false);
  };

  return _vcEl("div",{className:"vc-card"+(lock?" locked":"")+(speaks?"":" silent")},
    _vcEl("div",{className:"vc-head"},
      _vcEl("span",{className:"vc-av",style:{background:c.color||"var(--bg-4)"}}, initials),
      _vcEl("div",{className:"vc-id"},
        _vcEl("div",{className:"vc-name",id:titleId||undefined}, c.name||"Character"),
        _vcEl("div",{className:"vc-role"}, roleSummary)),
      speaks ? _vcEl("span",{className:"vc-tag speaks"},"Speaks")
             : _vcEl("span",{className:"vc-tag"},"No dialogue")),

    // the likeness on this card is a person whose real voice is in this account: offered first
    paired && !(lock && lock.voiceId===paired.voiceId) && !readOnly && _vcEl("div",{className:"vc-pair","data-testid":"voice-pair-offer"},
      _vcEl(Icon.userScan,{s:14}),
      _vcEl("span",{className:"vc-pair-t"}, vcPairText(c, likeness, paired).text),
      _vcEl("button",{className:"vc-btn primary",type:"button",onClick:()=>useVoice(paired),disabled:busy,"data-role":"rv-pair-use"}, vcPairText(c, likeness, paired).button)),
    lock
      ? _vcEl("div",{className:"vc-locked"},
          _vcEl("div",{className:"vc-locked-row"},
            _vcEl(Icon.check,{s:14}),
            _vcEl("span",{className:"vc-locked-name"}, lock.voiceName||"Voice"),
            _vcEl("span",{className:"vc-src"}, VC_SRC_LABEL[lock.source]||lock.source)),
          _vcEl("div",{className:"vc-role"},"Canonical voice · "+((ttsModels.find(m=>m.id===effModel)||{}).label||effModel)
            +(lock.voiceId?(" · ID "+String(lock.voiceId).slice(0,8)):"")
            +(lock.lockedAt?(" · locked "+new Date(lock.lockedAt).toLocaleDateString()):"")),
          _vcEl("div",{className:"vc-note"},
            _vcEl("span",null,lock.source==="cloned"
              ? ((vcVoicePerson(lock) ? vcPossessive(vcVoicePerson(lock))+" real voice" : "A real person's voice")+" — it doesn't change with the character's description or pronouns.")
              : (lock.specSnapshot||c.voiceSpec||"This voice is the character's reusable production master."))),
          _vcEl("div",{className:"vc-master","data-testid":"character-voice-master","data-state":masterStatus.state},
            _vcEl("div",{className:"vc-master-head"},
              _vcEl("div",null,
                _vcEl("div",{className:"vc-lab"},"Voice master"),
                _vcEl("div",{className:"vc-master-file"},masterFileName)),
              _vcEl("div",{className:"vc-master-tools"},
                window.InfoTip && _vcEl(window.InfoTip,{
                  label:"How the voice master is used",
                  text:"Scene dialogue is synthesized from its exact screenplay words using this same voice ID; the sample phrase is never substituted for a line."
                }),
                _vcEl("span",{className:"vc-master-state "+masterStatus.state},masterStatus.ready?"Ready":"Needs render"))),
            _vcEl("div",{className:"vc-master-text"},"“"+VC_AUDITION_TEXT+"”"),
            !masterStatus.ready && masterStatus.reason && _vcEl("div",{className:"vc-note vc-master-note"},masterStatus.reason),
            _vcEl("div",{className:"vc-actions vc-master-actions"},
              _vcEl("button",{className:"vc-btn audio-toggle"+(masterStatus.ready?" playback":"")+(isPlaying(masterAudio.audioUrl)?" playing":""),type:"button",
                onClick:masterStatus.ready?()=>toggleAudio(masterAudio.audioUrl):()=>test(false),
                disabled:masterStatus.ready?false:(busy||!ready),
                "aria-pressed":masterStatus.ready?(isPlaying(masterAudio.audioUrl)?"true":"false"):undefined,
                "aria-label":masterStatus.ready?((isPlaying(masterAudio.audioUrl)?"Pause":"Play")+" the saved canonical voice master for "+(c.name||"character")):"Generate the canonical voice master",
                title:masterStatus.ready?(isPlaying(masterAudio.audioUrl)?"Pause the saved canonical voice master":"Play the saved canonical voice master"):("Generate the canonical voice master"+vcMasterPrice)},
                masterStatus.ready?vcAudioIcon(isPlaying(masterAudio.audioUrl)):_vcEl(Icon.sparkles,{s:14}),
                masterStatus.ready?(isPlaying(masterAudio.audioUrl)?"Pause":"Play"):(busy?"…":("Generate voice file"+vcMasterPrice))),
              masterStatus.ready && _vcEl("a",{className:"vc-btn",href:masterAudio.audioUrl,download:masterFileName,
                title:"Download "+masterFileName},"Download"),
              masterStatus.ready && _vcEl("button",{className:"vc-btn ghost",onClick:()=>test(true),disabled:busy||!ready,title:"Render the canonical phrase again with the current voice settings"+vcMasterPrice},"Regenerate"+vcMasterPrice))),
          _vcEl("div",{className:"vc-field"},
            _vcEl("div",{className:"vc-lab"},"Delivery model"),
            _vcEl("select",{className:"vc-delivery",value:effModel,
              title:"How this canonical voice renders its lines — switching marks existing lines for revoice",
              onChange:e=>changeDelivery(e.target.value)},
              ttsModels.map(m=>_vcEl("option",{key:m.id,value:m.id,title:m.note},m.label+(m.note?(" — "+m.note):""))))),
          _vcEl("div",{className:"vc-actions"},
            _vcEl("button",{className:"vc-btn ghost",onClick:removeLock,"data-role":"voice-remove",title:"Take this voice off "+(c.name||"the character")+" (the voice itself isn't deleted)"},"Remove")),
          err && _vcEl("div",{className:"vc-err"}, err))

      : _vcEl("div",{className:"vc-body"},
          !ready && _vcEl("div",{className:"vc-note"},
            _vcEl(Icon.alert,{s:12}),
            _vcEl("span",null,"Voice runs on the studio's servers — sign in to design and lock voices.")),
          _vcEl("div",{className:"vc-modes"},
            ["design","library","clone"].map(m=> _vcEl("button",{key:m,className:"vc-mode"+(mode===m?" on":""),"data-mode":m,onClick:()=>{ stopAudio(true); setMode(m); setErr(""); }},
              m==="design"?"Design":m==="library"?"Library":"Real voice"))),

          // the description and "From character" are for DESIGNING a voice: a real person's voice doesn't use them
          mode==="design" && _vcEl("div",{className:"vc-field"},
            _vcEl("div",{className:"vc-lab"},"Voice description",
              _vcEl("button",{className:"vc-rebuild",type:"button",
                title:"Rebuild this description from the character's bible (age, role, derived accent)",
                onClick:()=>{
                  const built = buildVoiceSpec(c);
                  const changed = built !== spec;
                  setSpec(built);
                  if(typeof window.appToast==="function")
                    window.appToast(changed
                      ? "Voice description rebuilt from "+(c.name||"the character")+"'s bible."
                      : "Already matches "+(c.name||"the character")+"'s bible — nothing to change.", "ok");
                }},"↺ From character")),
            _vcEl("textarea",{className:"ns-input vc-spec",value:spec,rows:3,
              onChange:e=>setSpec(e.target.value),
              placeholder:"40s male voice; speaks English with a noticeable Turkish accent; low-medium pitch, warm and slightly gravelly; measured pacing; clear studio-quality recording"}),
            // ElevenLabs won't infer accent from backstory — it must be NAMED, or the
            // voice comes out generic. Soft nudge, never a block.
            mode==="design" && spec.trim() && !/\baccent|dialect\b/i.test(spec) && _vcEl("div",{className:"vc-note vc-accent-note"},
              _vcEl(Icon.alert,{s:12}),
              _vcEl("span",null,"No accent named — describe it explicitly (e.g. “speaks English with a slight Turkish accent”) or the voice will sound generic. Backstory words like a job or heritage don’t change the sound."))),
          mode!=="library" && _vcEl("div",{className:"vc-field"},
            _vcEl("div",{className:"vc-lab"},"Delivery model"),
            _vcEl("select",{className:"vc-delivery",value:ttsModel,
              title:"How the locked voice will render its lines — saved with the lock",
              onChange:e=>changeDelivery(e.target.value)},
              ttsModels.map(m=>_vcEl("option",{key:m.id,value:m.id,title:m.note},m.label+(m.note?(" — "+m.note):""))))),

          mode==="design" && _vcEl(React.Fragment,null,
            // a designed voice is saved as one of the account's own voices: the count up front, and no design or
            // lock once the plan's voices are used (the previews couldn't be kept) — 2026-10-11
            ready && addState.count && _vcEl("div",{className:"vc-lab"},"Your voices",_vcEl("span",{className:"vc-rv-count","data-role":"design-count"}, addState.count)),
            _vcEl("button",{className:"vc-btn primary",onClick:design,disabled:busy||!ready||!spec.trim()||(ready&&!addState.can),
              "data-role":"design-voices",title:(ready&&!addState.can)?addState.why:undefined},
              busy?_vcEl(React.Fragment,null,_vcEl("span",{className:"ns-spin"}),"Designing…"):_vcEl(React.Fragment,null,_vcEl(Icon.sparkles,{s:14}),"Design voices"+vcDesignPrice)),
            previews.length>0 && _vcEl("div",{className:"vc-previews"},
              _vcEl("div",{className:"vc-note"},"Every option uses the same audition line: “"+VC_AUDITION_TEXT+"”"),
              previews.map((p,i)=> _vcEl("div",{key:p.generatedVoiceId||i,className:"vc-preview"},
                _vcEl("button",{className:"vc-play"+(isPlaying(p.audioUrl)?" playing":""),type:"button",onClick:()=>toggleAudio(p.audioUrl),
                  title:isPlaying(p.audioUrl)?"Pause":"Play","aria-pressed":isPlaying(p.audioUrl)?"true":"false",
                  "aria-label":(isPlaying(p.audioUrl)?"Pause":"Play")+" Option "+(i+1)+" for "+(c.name||"character"),
                  "data-voice-option":i+1}, vcAudioIcon(isPlaying(p.audioUrl))),
                _vcEl("span",{className:"vc-preview-lab"},"Option "+(i+1)),
                _vcEl("button",{className:"vc-btn",onClick:()=>lockPreview(p),disabled:busy||!addState.can,title:addState.can?undefined:addState.why,"data-role":"design-lock"},"Lock this")))),
            ready && !addState.can && addState.why && _vcEl("div",{className:"vc-note","data-role":"design-why"}, _vcEl(Icon.alert,{s:12}), _vcEl("span",null,addState.why))),

          mode==="library" && _vcEl(React.Fragment,null,
            _vcEl("button",{className:"vc-btn primary",onClick:browse,disabled:busy||!ready},
              busy?"Loading…":"Browse library"),
            library.length>0 && (()=>{
              const g = vcLibraryGroups(library);
              const row = (v)=> _vcEl("div",{key:v.voiceId,className:"vc-preview","data-voice":v.voiceId},
                v.previewUrl && _vcEl("button",{className:"vc-play"+(isPlaying(v.previewUrl)?" playing":""),type:"button",onClick:()=>toggleAudio(v.previewUrl),
                  title:isPlaying(v.previewUrl)?"Pause":"Play","aria-pressed":isPlaying(v.previewUrl)?"true":"false",
                  "aria-label":(isPlaying(v.previewUrl)?"Pause ":"Play ")+(v.name||"library voice")+" for "+(c.name||"character")}, vcAudioIcon(isPlaying(v.previewUrl))),
                _vcEl("span",{className:"vc-preview-lab"}, (v.kind==="cloned" ? (vcVoicePerson(v)||"Your voice") : (v.name||v.voiceId))),
                v.kind && _vcEl("span",{className:"vc-src"}, v.kind==="cloned" ? "Real voice" : "Designed"),
                _vcEl("button",{className:"vc-btn",onClick:()=>useVoice(v),disabled:busy},"Lock"));
              const group = (title, list, key, max)=> list.length ? _vcEl("div",{key,className:"vc-lib-group","data-group":key},
                _vcEl("div",{className:"vc-lab"}, title), list.slice(0, max||list.length).map(row)) : null;
              return _vcEl("div",{className:"vc-previews"},
                group("Your voices", g.own, "own"),
                group("On this film", g.film, "film"),
                group("Voice library", g.stock, "stock", 24));
            })()),

          mode==="clone" && _vcEl("div",{className:"vc-rv-tab","data-testid":"real-voice-tab"},
            _vcEl("div",{className:"vc-lab"},"Real voices", addState.count && _vcEl("span",{className:"vc-rv-count","data-role":"rv-count"}, addState.count)),
            realList.length
              ? _vcEl("div",{className:"vc-previews"},
                  realList.map(v=>_vcEl("div",{key:v.voiceId,className:"vc-preview","data-voice":v.voiceId},
                    _vcEl("span",{className:"vc-preview-lab"}, vcVoicePerson(v)||"Your voice",
                      _vcEl("span",{className:"vc-rv-who"}, v.personKind==="me" ? " · Me" : " · Someone else", v.onFilm && !v.own ? " · on this film" : "")),
                    _vcEl("button",{className:"vc-btn",onClick:()=>useVoice(v),disabled:busy,"data-role":"rv-use-existing"}, vcVoiceUseLabel(v)))))
              : _vcEl("div",{className:"vc-note"}, _vcEl(Icon.mic,{s:12}),
                  _vcEl("span",null,"Give "+(c.name||"this character")+" a real person's voice — yours or a friend's. Record about a minute and a half reading a short passage, or upload recordings.")),
            _vcEl("div",{className:"vc-actions"},
              _vcEl("button",{className:"vc-btn primary",type:"button",onClick:()=>{ stopAudio(true); setRvOpen(true); },
                disabled:busy||!addState.can,title:addState.why||"Record or upload a real person's voice","data-role":"rv-add"},
                _vcEl(Icon.plus,{s:14}),"Add a real voice"),
              ready && _vcEl("button",{className:"vc-btn ghost",type:"button",onClick:()=>setMgrOpen(true),"data-role":"rv-manage"},"Manage voices")),
            !addState.can && addState.why && _vcEl("div",{className:"vc-note","data-role":"rv-why"}, _vcEl(Icon.alert,{s:12}), _vcEl("span",null,addState.why))),

          err && _vcEl("div",{className:"vc-err"}, err)),
    rvOpen && _vcEl(RealVoiceModal,{ character:c, modelId:ttsModel, onClose:()=>{ setRvOpen(false); loadVoices(true).catch(()=>{}); }, onUse:useCloned }),
    mgrOpen && _vcEl(VoicesManager,{ characters:cast||[c], onUpdate, onClose:()=>{ setMgrOpen(false); loadVoices(true).catch(()=>{}); } }));
}

/* VoiceModal is deliberately NON-modal and card-contained. CharacterSheets owns the
   set of open character IDs, while each mounted CharacterSheet hosts its own dimmer +
   Voice card so several characters' cards can remain open independently. */
function VoiceModal({ character, project, speaks, onUpdate, onClose, readOnly, cast }){
  const safeId=String((character&&character.id)||"character").replace(/[^A-Za-z0-9_-]/g,"-");
  const titleId="voice-window-title-"+safeId;
  const popupId="voice-popup-"+safeId;
  const overlayRef=React.useRef(null);
  const panelRef=React.useRef(null);
  React.useEffect(()=>{
    const overlay=overlayRef.current;
    const siblings=overlay&&overlay.parentElement
      ? Array.from(overlay.parentElement.children).filter(el=>el!==overlay) : [];
    const previous=siblings.map(el=>({el,inert:el.hasAttribute("inert"),ariaHidden:el.getAttribute("aria-hidden")}));
    siblings.forEach(el=>{ el.setAttribute("inert",""); el.setAttribute("aria-hidden","true"); });
    if(panelRef.current){ try{ panelRef.current.focus({preventScroll:true}); }catch(e){ panelRef.current.focus(); } }
    return ()=>{
      previous.forEach(row=>{
        if(row.inert) row.el.setAttribute("inert",""); else row.el.removeAttribute("inert");
        if(row.ariaHidden==null) row.el.removeAttribute("aria-hidden"); else row.el.setAttribute("aria-hidden",row.ariaHidden);
      });
      requestAnimationFrame(()=>{
        const trigger=Array.from(document.querySelectorAll('[data-testid="voice-popup-trigger"]'))
          .find(el=>el.getAttribute("data-character-id")===String(character&&character.id));
        if(trigger){ try{ trigger.focus({preventScroll:true}); }catch(e){ trigger.focus(); } }
      });
    };
  },[character&&character.id]);
  return _vcEl("div",{className:"voice-card-overlay",ref:overlayRef,"data-testid":"voice-card-overlay",
      "data-character-id":character&&character.id,
      onClick:e=>{ if(e.target===e.currentTarget) onClose&&onClose(); }},
    _vcEl("section",{
        className:"dt-panel voice-modal voice-window",ref:panelRef,id:popupId,
        role:"dialog","aria-modal":"false","aria-labelledby":titleId,tabIndex:-1,
        "data-testid":"voice-popup","data-character-id":character&&character.id,
        onKeyDown:e=>{ if(e.key==="Escape"){ e.stopPropagation(); onClose&&onClose(); } }},
      _vcEl("button",{className:"ag-x voice-modal-x",type:"button",onClick:onClose,
        "aria-label":"Close voice design for "+((character&&character.name)||"character"),
        "data-testid":"voice-popup-close",title:"Close "+((character&&character.name)||"voice")}, _vcEl(Icon.x,{s:18})),
      _vcEl("div",{className:"dt-scroll voice-modal-scroll"},
        _vcEl(VoiceCard,{c:character,project,speaks,onUpdate,titleId,readOnly,cast}))));
}
window.VoiceModal = VoiceModal;
