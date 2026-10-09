/* script.jsx — Script view + auto-draft engine.
   Left gutter = SUBTEXT (beats). Right page = TEXT (screenplay).
   Automation drafts every scene from a rolling story-state, with transition
   hinges + a continuity ledger threaded scene to scene. */

const BLOCK_CLASS = { scene:"spb-scene", action:"spb-action", char:"spb-char", paren:"spb-paren", dia:"spb-dia", trans:"spb-trans" };
/* an act number as a roman numeral, for ANY act count (2026-09-28: the old three-entry
   table printed "ACT III → undefined" at a Kishōtenketsu film's Ten → Ketsu cut). Anything
   that isn't a whole act number is shown as it is. */
function actRoman(act){
  const n = Number(act);
  if(!Number.isInteger(n) || n<1 || n>39) return (act==null || act==="") ? "\u2014" : String(act);
  const R = [[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let out = "", r = n;
  R.forEach(([v,s])=>{ while(r>=v){ out += s; r -= v; } });
  return out;
}

function parseSlug(loc){
  let left = String(loc||"").trim();
  let time = "";
  /* time of day = trailing segment after the LAST separator, when it reads like a
     time. A "\u00b7"-only split misses industry hyphen slugs (INT. SHOP - DAWN). */
  const tm = left.match(/[\u00b7\u2013\u2014,\-]\s*([A-Za-z][A-Za-z'\u2019 ]{1,26})\s*$/);
  if(tm && /\b(night|day|dawn|dusk|morning|evening|afternoon|noon|midday|midnight|sunset|sunrise|twilight|magic hour|golden hour|continuous|later|moments? later|same time)\b/i.test(tm[1])){
    time = tm[1].trim();
    left = left.slice(0, tm.index).replace(/[\u00b7\u2013\u2014,\-\s]+$/,"").trim();
  }
  const intext = /^EXT/.test(left) ? "EXT" : /^INT\/EXT/.test(left) ? "INT/EXT" : "INT";
  const place = left.replace(/^(INT\/EXT\.|INT\.|EXT\.)\s*/,"").trim();
  return { intext, place, time };
}
function slugText(loc){ return String(loc).replace(/\s*\u00b7\s*/g," \u2013 "); }

/* a structure whose movements don't run on clash, so an act break needn't flip the charge
   (Kishōtenketsu: "no clash required" — its twist recontextualizes). Every other framework
   uses the classic turn rule and keeps the three-act advice. */
function _actBreakNoClash(fw){ return !!fw && fw.id==="kishotenketsu"; }
/* the hinge between two consecutive scenes — McKee's Principle of Transition. project
   (optional) picks the framework, so the act-break note fits its structure; the open film
   by default. */
function sceneTransition(prev, cur, project){
  if(!prev) return { type:"COLD OPEN", cls:"act", gloss:"The film opens cold \u2014 no setup, straight into motion." };
  if(prev.act !== cur.act){
    const type = `ACT ${actRoman(prev.act)} \u2192 ${actRoman(cur.act)}`;
    const fw = typeof frameworkOf==="function" ? frameworkOf(project || window.turnProject) : null;
    // 2026-09-28: a four-movement Kishōtenketsu film names the movement it enters and gets no
    // "the charge must alternate" advice, which contradicts its own "no clash required"
    if(_actBreakNoClash(fw)){
      const lab = (fw.acts && fw.acts[cur.act]) ? String(fw.acts[cur.act]).replace(/\s+[\u2014\u2013]\s+(.+)$/," ($1)") : "";
      return { type, cls:"act",
               gloss:"Movement break \u2014 the story crosses into "+(lab || "a new movement")+". No clash is required here; the charge doesn\u2019t have to alternate." };
    }
    return { type, cls:"act",
             gloss:"Act break \u2014 the story crosses into a new movement; the charge must alternate here." };
  }
  const a = parseSlug(prev.loc), b = parseSlug(cur.loc);
  const ps = Math.sign(prev.closeCharge), cs = Math.sign(cur.openCharge);
  if(ps!==0 && cs!==0 && ps!==cs)
    return { type:"CONTRAST CUT", cls:"contrast",
             gloss:`The cut flips the charge \u2014 ${prev.closeValue} (${chargeStr(prev.closeCharge)}) collides with ${cur.openValue} (${chargeStr(cur.openCharge)}).` };
  if(a.place === b.place)
    return { type:"CONTINUOUS", cls:"", gloss:"Same space \u2014 the action flows on without a real break." };
  if(a.time !== b.time)
    // NBSPs keep "DAWN \u2192 DAY." one unbreakable unit \u2014 on a narrow phone the wrap
    // falls after "Time moves:" instead of splitting the two times apart
    return { type:"TIME CUT", cls:"", gloss:`Time moves: ${a.time||"\u2014"}\u00a0\u2192\u00a0${b.time||"\u2014"}.` };
  return { type:"HARD CUT", cls:"", gloss:`New location \u2014 ${b.place}.` };
}

/* the story-state carried across the cut into this scene.
   "Serves spine" is the film's controlling idea \u2014 derived from THIS project, never
   hardcoded (it used to leak the Matrix sample's spine into every story). */
function sceneCarry(prev, cur, project){
  const b = parseSlug(cur.loc);
  const ci = (project && project.controllingIdea) || {};
  const spine = (ci.value||"").trim() || ((project && (project.logline||project.premise))||"").trim();
  const cells = [
    { lab:"Location", val:b.place },
    { lab:"Time", val:b.time || "\u2014" },
  ];
  if(spine) cells.push({ lab:"Serves spine", val: spine.length>72 ? spine.slice(0,71)+"\u2026" : spine });
  if(prev) cells.push({
    lab:"Emotional carry",
    node:React.createElement(React.Fragment,null,
      React.createElement("em",{className:prev.closeCharge<0?"neg":""},`${prev.closeValue} ${chargeStr(prev.closeCharge)}`),
      " \u2192 ",
      React.createElement("em",{className:cur.openCharge<0?"neg":""},`${cur.openValue} ${chargeStr(cur.openCharge)}`)),
  });
  return cells;
}

/* AUTO-DRAFT: expand a scene's beats (subtext) into screenplay blocks (text) */
function autoDraftScene(scene, beats, prevScene){
  const blocks = [{ beat:1, type:"scene", text:slugText(scene.loc) }];
  if(beats && beats.rows){
    beats.rows.forEach(r=>{
      blocks.push({ beat:r.n, type:"action", text:`${r.drive.d} ${r.react.d}` });
    });
  } else {
    blocks.push({ beat:1, type:"action", text:scene.summary });
  }
  const slugCount = blocks.filter(b=>b.type==="scene").length;
  return { auto:true, blocks,
    note: slugCount>1 ? `This unit spans ${slugCount} sluglines.` : null };
}

/* ROUGH STAND-IN (docs/Story Pipeline.md step 7, owner-approved 2026-09-27): a draft that
   autoDraftScene built from the beat cards (because the writer's draft was rejected, or no
   writing model was reachable) is NOT a written screenplay, however finished its sentences
   read. It is marked as such in the Script view, the Script check never shows it as clean,
   and it keeps that mark until MUSE writes the scene.
   - A fresh stand-in is the structural draft itself: auto:true, no ai flag, no `by` stamp
     (every draft MUSE writes carries ai:true and a `by` stamp).
   - A manual edit clears `auto` (the version is a "Manual edit" now), so the edit handlers
     carry the mark forward as standIn:true (keepStandInMark). Writing one missing beat
     keeps it too: the rest of the scene is still the beat cards.
   - A successful Draft / Redraft / story build REPLACES the whole draft object with MUSE's
     own ({ blocks, ai:true, by, … }), which has no standIn key, so the mark clears there
     and nowhere else. Undo back to the stand-in brings the mark back with it. */
function isStandInDraft(d){
  if(!d || !Array.isArray(d.blocks) || !d.blocks.length) return false;
  if(d.standIn === true) return true;
  return d.auto === true && !d.ai && !d.by;
}
function keepStandInMark(prev, next){
  return (next && isStandInDraft(prev)) ? { ...next, standIn:true } : next;
}

window.parseSlug = parseSlug;
window.sceneTransition = sceneTransition;
window.sceneCarry = sceneCarry;
window.autoDraftScene = autoDraftScene;
window.isStandInDraft = isStandInDraft;
window.keepStandInMark = keepStandInMark;

/* LONG FOR THIS FORMAT, for the Script view: the scene's estimated screen time (sceneRuntime,
   spine.jsx) against its budget (sceneBudgetFor, formats.jsx) — the same inputs the spine's
   scene card uses, so the two never disagree. null when the helpers are missing. */
function scriptLengthInfo(scene, draft, beats, project, sceneCount){
  if(!scene || typeof sceneBudgetFor!=="function" || typeof sceneRuntime!=="function" || typeof sceneLengthCheck!=="function") return null;
  const budget = sceneBudgetFor(project, sceneCount);
  const rt = sceneRuntime(scene, draft, beats, budget);
  const chk = sceneLengthCheck(rt, budget);
  return { sec:rt.sec, approx:!!rt.approx, budget, long:!!chk.long, ratio:chk.ratio||0 };
}
window.scriptLengthInfo = scriptLengthInfo;

function _spClean(t){
  return String(t||"").replace(/\s+/g," ").trim();
}
function _spShort(t, max){
  const s = _spClean(t);
  const n = max || 72;
  return s.length > n ? s.slice(0, n-1).trim()+"…" : s;
}
function screenplayBeatExcerpt(screenplay, beatN, max){
  const blocks = ((screenplay&&screenplay.blocks)||[]).filter(b=>Number(b.beat)===Number(beatN));
  if(!blocks.length) return "";
  const pieces = [];
  for(let i=0;i<blocks.length;i++){
    const b = blocks[i] || {};
    const txt = _spClean(b.text);
    if(!txt) continue;
    if(b.type==="scene") continue;
    if(b.type==="char"){
      const par = blocks[i+1] && blocks[i+1].type==="paren" ? _spClean(blocks[i+1].text) : "";
      let di = i+(par?2:1); const dia = blocks[di] || {};
      if(dia.type==="dia" && _spClean(dia.text)){
        let line = txt+": "+(par?"("+par+") ":"")+_spClean(dia.text);
        // the same speech continued after a mid-speech "(beat)" (cue → dia → paren → dia)
        while(blocks[di+1] && blocks[di+1].type==="paren" && blocks[di+2] && blocks[di+2].type==="dia" && _spClean(blocks[di+2].text)){
          line += " ("+_spClean(blocks[di+1].text).replace(/^\(|\)$/g,"")+") "+_spClean(blocks[di+2].text);
          di += 2;
        }
        pieces.push(line);
        i=di; continue;
      }
    }
    if(b.type==="paren") continue;
    pieces.push(txt);
    if(pieces.join(" ").length >= (max||72)) break;
  }
  if(!pieces.length){
    const slug = blocks.find(b=>b.type==="scene" && _spClean(b.text));
    if(slug) pieces.push(_spClean(slug.text));
  }
  return _spShort(pieces.join(" "), max||72);
}
function screenplayBeatNumbers(screenplay, beats){
  const nums = new Set();
  ((beats&&beats.rows)||[]).forEach(r=>nums.add(Number(r.n)));
  ((screenplay&&screenplay.blocks)||[]).forEach(b=>{ if(b.beat!=null) nums.add(Number(b.beat)); });
  return Array.from(nums).filter(n=>Number.isFinite(n)).sort((a,b)=>a-b);
}
window.screenplayBeatExcerpt = screenplayBeatExcerpt;
window.screenplayBeatNumbers = screenplayBeatNumbers;

/* ACTION-LINE LABELS — "LABEL: text" inside an action paragraph. Professional scripts
   use this shape for on-screen text and inserts (INSERT — PHONE: …, SUPER: …, a readout
   such as <FIELD>: <VALUE>), and a model also uses it to smuggle a character's line into
   action ("MARCUS: Sorry, sir."). The two look alike, so this classifies each label by
   WHO or WHAT it names and HOW the text after it reads, instead of rejecting every caps
   label followed by a capital (2026-09-27 incident: screen-heavy scenes such as a tide
   app or a telemetry wall were rejected on every attempt). Shared by the screenplay
   writers' validator (ai.jsx) and the Script check below — the writers reject exactly
   the kinds the Script check warns about (dialogue, voice); "unclear" is only a note.

   WHAT A LABEL NAMES (screenplayLabelClass), checked in this order:
     speaker   — a known cast / cue name anywhere in it ("GRAHAM ON SCREEN", "PHONE —
                 DILYS", "BRAM OVER RADIO", "RADIO (BRAM)"), unless the name only OWNS or
                 SENDS written text ("NINA'S PHONE", "EMAIL FROM NINA", "TEXT — DEV") or
                 keeps a paper record or picture (keepsake, below). Inside a CAPS record a
                 name glued to the next FIELD ("…WELFARE CHK — PRUITT, OPAL — NOTE: …",
                 "SUBSCRIBER: LUSK, ELI / CITY: …") is the previous field's value, so the
                 label is only that field (_spRecordField) — never when the name opens the
                 sentence ("PRUITT, OPAL — NOTE:" too), follows a lead-in that speaks
                 ("Opal whispers:"), the label carries a voice extension, the field carries
                 someone's own words (MESSAGE, TRANSCRIPT, REPLY), or its text reads as speech
     keepsake  — a paper record or picture a cast member keeps, the owner's name opening
                 that part of the label ("ARCHIVE — GRACINDA'S ALBUM", "LEONOR'S DIARY"): its
                 words count as dialogue only if they read as spoken (quotes, I / you / we, a
                 question, a contraction, an interjection, an order, a greeting, someone
                 addressed, a "!"); shown on a screen ("INSERT: LEONOR'S DIARY: …", "(SMS)")
                 it is a device like a sent message. Still a speaker: "NINA'S DIARY (V.O.)"
                 or any bracket but a visual word, a year / page or a production note;
                 "GRACINDA'S ALBUM — LEONOR" (another cast member); "HOLDING GRACINDA'S
                 ALBUM" and "LEONOR, GRACINDA'S ALBUM" (someone else holds it); "NINA'S
                 MOTHER" (not a kept object)
     testimony — a documentary's planned testimony naming its subject, in exactly this
                 shape: "EXPECTED TESTIMONY — <cast name>:" (a dash or slash, the name alone,
                 no brackets or only a production note). Its text passes only as a NOTE of
                 what they will cover (see the kind below), never as their words. "INTERVIEW —
                 NINA:", "TESTIMONY — NINA:", "EXPECTED TESTIMONY — NINA'S MOTHER:" and
                 "EXPECTED TESTIMONY — NINA (V.O.):" stay that person's line. A cast name in
                 mixed case with a colon after it, "EXPECTED TESTIMONY: Nina: …" or
                 "EXPECTED TESTIMONY — Nina: …", is read as this named form too (2026-09-28)
     role      — a person by role ("GUARD", "THIRD GUARD", "MAN ON SCREEN", "DUTY MANAGER")
     voice     — a nameless voice (VOICEMAIL, NARRATOR, RADIO, TV, DISPATCH, RECORDED …)
     written   — a surface that SHOWS words (INSERT, SUPER, TEXT, STATUS, LOG, GAUGE …)
     direction — camera / sound / edit / song section (CLOSE ON, SFX, CUT TO, CHORUS …)
     live      — a screen or phone that can carry a person (SCREEN, MONITOR, PHONE,
                 INTERVIEW, ARCHIVE …): words there count as dialogue only if spoken
     data      — a field name (ID, DATE, SOURCE, ADDRESS, PRESSURE …)
   A compound label is read by its HEAD word (the last word before any "ON/FROM/OVER…"
   phrase): "CARD DEALER" is a dealer, "TITLE CARD" a card, "SIGN LANGUAGE INTERPRETER"
   an interpreter, so a device word inside a person's label never hides them.

   WHAT THE TEXT IS (kind):
     dialogue — a speaker's line packed into action (any words after a known speaker —
                shouted CAPS too — a cue extension such as (V.O.) / (into radio), a role
                label with a sentence or an order, or plainly spoken words after any
                label: I / you / we, a contraction, an interjection, a question, quotes).
                A PRODUCTION note in the brackets ("(record, do not prompt)", "(sit-down,
                to be recorded)", "(b-roll)", "(archive)") is not a cue extension — only
                when EVERY part of the brackets is a production phrase or a cast name, so
                "(archive, voiceover)", "(crying, sit-down)", "(to Leonor, record)" stay
                cue extensions, as do bare "(recorded)" and "(off-camera)". The text is
                then read as if the brackets were not there — but the note says someone is
                filmed: after a cast member it names, an unknown label ("MARCUS (record):")
                or a kept object with a person note ("GRACINDA'S ALBUM (sit-down):"), only
                a lowercase note of what they will cover ("how the soles of his feet read
                the tide") or a third-person account ("Her account of the night the wall
                went.", "How the soles of his feet…") passes — other capitalised words,
                I / you / we or a quote are their line; after a screen label ("INTERVIEW
                (sit-down):") a question, a contraction, an interjection, a greeting or
                someone addressed still counts as spoken; a "!" or "?" after any label
                with a note does too; all-CAPS words read as before.
                After "EXPECTED TESTIMONY — <cast name>:" (docs/Story Pipeline.md step 5,
                "Page forms": "<subject> on <topic>") EVERY sentence, and every part after
                a colon, must open as a TOPIC: "on …" / "about …", a third-person account
                of something ("her account of the flood night, and what her father said",
                "Her account of the night the wall went.") or an indirect question ("how
                the salt pans were worked") — lowercase words alone ("i never went back",
                "nobody came"), "In her own words, …", "Her words: …", "Her testimony: …",
                a statement, CAPS words, quotes, I / you / we (a lowercase "i" too), "!" or
                "?", a contraction, an interjection, an order, a greeting or someone
                addressed are their line. Any "EXPECTED TESTIMONY" label, with or without
                the name, also rejects a quoted span ("…on what her father said: “Keep the
                pans.”"): words in quotes are lines written for a real person — except a
                quoted title or nickname (the report "Salt and Tide, 1953", the "Iron Wall")
     voice    — spoken words after a nameless voice label (the writers turn it into a cue)
     device   — on-screen text, inserts, supers, camera or sound direction, song sections,
                a description of what a screen or speaker shows ("TV: A reporter stands…"),
                and a message a character SENDS that appears on a screen ("A text from DEV:
                …", "INSERT — PHONE: NINA: …", "The phone lights up. NINA: …")
     data     — a readout value: CAPS, digits, a name ("DUTY MANAGER: Graham Pell."), or a
                telegraphic phrase ("TIDEWATCH: Wrenham gauge running high.")
     unclear  — an unknown label followed by a full sentence that is not clearly speech
                ("MARCUS: The gate is open.") — accepted, but the Script check lists it
   How far a label's text reaches: the first sentence, and the sentences after it until
   narration resumes (a sentence opening with He / She / The / A / a cast name …), so
   "OPERATOR: CARROW, N. Graham doesn't react." reads only "CARROW, N." as the readout. */
// ai.jsx checks this: a stale cached script.jsx is reported, never silent. v3 (2026-09-27, page
// forms): the testimony class and the shared dialogue grammar (screenplaySpeechLinks) — the
// writers' validator and the Script check both accept a mid-speech parenthetical
const SP_LABELS_VERSION = 3;
const _SP_WORDS = s=>new Set(s.split(/\s+/).filter(Boolean));
const _SP_WRITTEN = _SP_WORDS(
  "INSERT SUPER SUPERIMPOSE SUPERIMPOSED TITLE TITLES CARD CHYRON CAPTION CAPTIONS SUBTITLE SUBTITLES "+
  "TEXT TEXTS SMS MMS EMAIL E-MAIL MAIL MESSAGE MESSAGES DM CHAT NOTIFICATION BANNER ALERT WARNING CAUTION DANGER "+
  "ERROR FAULT POPUP POP-UP READOUT DISPLAY LOG ENTRY HEADER HEADLINE SIGN PLACARD POSTER NOTE NOTICE LABEL STATUS "+
  "TICKER CRAWL GRAPHIC GRAPHICS PAGE LETTER FILE DOCUMENT FORM RECORD MAP WEBSITE URL LINK LOGO TAGLINE PACKSHOT "+
  "DISCLAIMER LEGEND GAUGE METER DIAL CLOCK TIMER COUNTDOWN TELEMETRY TILE WALL CONSOLE TERMINAL PRINTOUT FAX "+
  "WHITEBOARD SCREENSHOT PHOTO PHOTOGRAPH IMAGE APP LOCKSCREEN PREVIEW INBOX CALENDAR BADGE TAG PROMPT INSTRUCTION "+
  "INSTRUCTIONS TRANSCRIPT RESULT RESULTS HANDSHAKE");
// a paper record or picture a person KEEPS — read as an object only when a cast member owns it
// ("ARCHIVE — GRACINDA'S ALBUM"), never on its own, so "DIARY — NINA:" is still Nina
const _SP_KEEPSAKE = _SP_WORDS(
  "ALBUM SCRAPBOOK SKETCHBOOK YEARBOOK DIARY JOURNAL NOTEBOOK LOGBOOK LEDGER REGISTER DEED LEASE CERTIFICATE "+
  "CLIPPING CLIPPINGS NEWSPAPER POSTCARD SNAPSHOT POLAROID PORTRAIT DRAWING SKETCH PAINTING RECEIPT TICKET "+
  "INVOICE CONTRACT PASSPORT ROSTER MANIFEST");
const _SP_LIVE = _SP_WORDS(
  "SCREEN SCREENS ONSCREEN ON-SCREEN MONITOR MONITORS VIDEO FEED CCTV WEBCAM CAMERA FOOTAGE CLIP ARCHIVE NEWSREEL "+
  "INTERVIEW TESTIMONY PHONE MOBILE CELL CELLPHONE SMARTPHONE LAPTOP TABLET COMPUTER CALL FACETIME LIVESTREAM STREAM");
const _SP_DIRECTION = _SP_WORDS(
  "CLOSE CLOSEUP CLOSE-UP ANGLE POV WIDE SHOT SCENE LATER MONTAGE FLASHBACK INTERCUT CUT DISSOLVE FADE WIPE SMASH "+
  "MATCH BACK SERIES SFX FX SOUND SOUNDS MUSIC SCORE SONG KLAXON ALARM SIREN BELL HORN BEEP BUZZER RINGTONE STATIC "+
  "VERSE CHORUS PRE-CHORUS BRIDGE HOOK INTRO OUTRO BREAKDOWN DROP INSTRUMENTAL PERFORMANCE NARRATIVE LYRIC LYRICS SILENCE");
const _SP_VOICE = _SP_WORDS("VOICE VOICES VOICEMAIL VOICEOVER VOICE-OVER VO V.O ANSWERPHONE NARRATOR NARRATION ANNOUNCER ANNCR TANNOY INTERCOM LOUDSPEAKER SPEAKERPHONE PA P.A");
const _SP_VOICE_HEAD = _SP_WORDS("RADIO SCANNER TV TELEVISION BROADCAST RECORDING ANNOUNCEMENT MACHINE DISPATCH HQ");
const _SP_ROLE = _SP_WORDS(
  "MAN WOMAN MEN WOMEN BOY GIRL KID KIDS CHILD TEEN TEENAGER GUY LADY GENTLEMAN GUARD COP OFFICER SERGEANT SGT "+
  "DETECTIVE INSPECTOR CONSTABLE TROOPER DEPUTY SHERIFF AGENT SOLDIER CAPTAIN LIEUTENANT SAILOR PILOT NURSE DOCTOR "+
  "PARAMEDIC MEDIC SURGEON FIREFIGHTER FIREMAN WAITER WAITRESS BARTENDER BARMAN CLERK CASHIER DRIVER CABBIE COURIER "+
  "RECEPTIONIST SECRETARY ASSISTANT MANAGER BOSS FOREMAN WORKER TECHNICIAN ENGINEER JANITOR PRIEST VICAR PASTOR "+
  "TEACHER STUDENT JUDGE LAWYER STRANGER CUSTOMER PASSENGER NEIGHBOUR NEIGHBOR FRIEND MOTHER FATHER MUM MOM DAD "+
  "SISTER BROTHER SON DAUGHTER WIFE HUSBAND AUNT UNCLE GRANDMOTHER GRANDFATHER GRAN GRANNY GRANDMA GRANDPA "+
  "DISPATCHER REPORTER JOURNALIST CALLER CROWD ALL EVERYONE");
const _SP_DATA = _SP_WORDS(
  "ID NO NUM NUMBER NAME NAMES DATE TIME TIMESTAMP SOURCE ORIGIN DESTINATION ADDRESS LOCATION POSITION COORDINATES "+
  "GRID SECTOR ZONE UNIT CODE REF REFERENCE TYPE PRIORITY LEVEL SIGNAL STRENGTH SPEED DEPTH HEIGHT PRESSURE TEMP "+
  "TEMPERATURE ETA ETD DURATION COUNT TOTAL BALANCE ACCOUNT CASE INCIDENT SUBJECT RE CC FROM TO REASON CAUSE "+
  "CREDENTIAL CREDENTIALS USER USERNAME LOGIN ACCESS ANI ALI MODE PHASE STAGE STEP LOAD FUEL BATTERY POWER VOLTAGE "+
  "FREQUENCY CHANNEL VALUE READING TIDE WIND VISIBILITY");
const _SP_PREP = _SP_WORDS("ON OVER FROM BY IN VIA THROUGH AT OF FOR WITH TO INTO ONTO");
const _SP_HONORIFIC = _SP_WORDS("MR MR. MRS MRS. MS MS. DR DR. MISS SIR MADAM");
// a parenthetical that names a VISUAL device ("PHONE (ON SCREEN)") rather than a voice
const _SP_VISUAL_PAREN = /\b(?:ON[- ]?SCREEN|TEXT|DISPLAY|READOUT|INSERT|SUPER|CAPTION|GRAPHIC)\b/i;
/* a PRODUCTION note in the brackets — what the crew records, not how a line is delivered:
   "(record, do not prompt)", "(Armindo, sit-down, to be recorded)", "(b-roll)", "(archive)".
   EVERY part of the brackets (split at , ; / + & "and") must be one of these phrases or a cast
   name, so one delivery or performance word anywhere — "(archive, voiceover)", "(crying,
   sit-down)", "(V/O, record)", "(to Leonor, sit-down)", "(off-screen, to be recorded)",
   "(softly, record)" — keeps the whole bracket a cue extension. "(off-camera)" is the spelled-out
   O.C. extension, and bare "(recorded)" is playback of that person's voice: neither is a note.
   PERSON notes say someone is filmed talking; NEUTRAL ones are footage or paperwork. */
const _SP_NOTE_PERSON_RE = /^(?:(?:(?:still |yet )?to be (?:recorded|filmed|shot|captured|scheduled)|to (?:record|film|shoot))(?: later| on location)?|(?:recorded|filmed|shot|record|film|shoot) later|record(?: only)?|do not (?:prompt|script|stage|coach|lead|feed|direct)|don[’']t (?:prompt|script|stage|coach|lead)|no prompting|unprompted|unscripted|unstaged|sit[- ]?down(?: interview)?|(?:family |formal |informal |follow[- ]up |on[- ]camera |walking |group )?interview|in (?:his|her|their) own words)$/i;
const _SP_NOTE_NEUTRAL_RE = /^(?:b[- ]?roll|archive(?: footage| film| photos?| stills?)?|archival(?: footage| film| photos?)?|stock(?: footage)?|library(?: footage)?|found footage|home movies?|home video|(?:8|16|35) ?mm|cutaways?|handheld|wild ?track|location sound|observational|obs|verit[eé]|fly[- ]on[- ]the[- ]wall|pick[- ]?ups?|placeholder|tbc|tbd|pending|if cleared|(?:rights|clearance) pending|to be (?:sourced|cleared|licensed|confirmed))$/i;
/* a keepsake's brackets that keep it an object: an on-screen word ("(INSERT)"), a year or a page
   ("(1962)", "(p. 4)") or a production note — anything else, "(V.O.)", "(reading)", "(softly)",
   "(LEONOR)", makes the label that person's */
const _SP_OBJECT_PAREN_RE = /^(?:(?:c\.|circa)\s*)?(?:1[89]|20)\d\ds?$|^(?:p|pp|pg|page|vol|no)\.?\s*\d+$/i;
/* fields a CAPS record (a CAD log, an ALI readout, a case file) runs through beyond the written
   and data words above — read only by _spRecordField, never as label classes of their own */
const _SP_RECORD_FIELD = _SP_WORDS(
  "NOTES REMARK REMARKS COMMENT COMMENTS NARRATIVE DISPOSITION DISPO NATURE COMPLAINT DETAIL DETAILS SUMMARY RESPONSE "+
  "OUTCOME CALLBACK CBN AGE DOB SEX GENDER CITY STATE ZIP POSTCODE COUNTY CONTACT ASSIGNED FLAG FLAGS HISTORY HAZARD "+
  "HAZARDS RELATIONSHIP KIN MEDS MEDICATION MEDICATIONS ALLERGY ALLERGIES OCCUPATION EMPLOYER VEHICLE PLATE CHARGE "+
  "CHARGES OFFENCE OFFENSE VERDICT SENTENCE ROOM BED WARD DIAGNOSIS CONDITION CLASS SUBSCRIBER CARRIER");
// ...but never a field that carries someone's own words ("— PRUITT, OPAL — MESSAGE:" is hers)
const _SP_MESSAGE_FIELD = _SP_WORDS("TEXT TEXTS SMS MMS EMAIL E-MAIL MAIL MESSAGE MESSAGES DM CHAT TRANSCRIPT LETTER QUOTE REPLY STATEMENT SAYS SAID");
// a lead-in that SHOWS a record ("The log reads:", "Tomas pulls up the log:") — never one that speaks
const _SP_SHOWS_RE = /\b(?:reads?|shows?|showing|displays?|displaying|lists?|listing|flashes|scrolls?|scrolling|prints?|printout|pulls? up|brings? up|logs?|entry|entries|records?|files?|screens?|monitors?|display|readout|card|form|sheet|page|insert|terminal|console|report|ticket|board|tablet|laptop|computer)\b/i;
const _SP_SAYS_RE = /\b(?:says?|said|saying|tells?|told|asks?|asked|answers?|answered|repl(?:y|ies|ied)|whispers?|whispered|shouts?|shouted|yells?|yelled|screams?|screamed|calls?(?! up)|called|mutters?|muttered|murmurs?|murmured|sings?|sang|breathes|pleads?|begs?|cries|cried|sobs?|hisses|snaps|barks|orders?|announces?|speaks?|spoke|aloud|out loud|reads?\s+(?:it\s+|them\s+|this\s+)?out|into (?:the |her |his |a )?(?:mic|microphone|phone|radio|headset|handset|receiver))\b/i;
// speech signs a role label does not look for, read in the mixed-case sentences of a record field
// or a kept page: an order opening a sentence ("Come home.", "Forgive him.", "Mama, come home."),
// a greeting, an endearment addressed ("…, dear."). A sign-off ("Love, Gracinda.") is a signature.
const _SP_RECORD_ORDER_RE = /^(?:Come|Go|Get|Give|Take|Bring|Send|Tell|Say|Ask|Call|Answer|Forgive|Forget|Remember|Leave|Let|Help|Save|Find|Stop|Wait|Stay|Hold|Keep|Look|Listen|Watch|Mind|Hurry|Run|Move|Hide|Promise|Trust|Believe|Pray|Kiss|Hug|Please|Open|Close|Shut|Turn|Put|Sit|Stand|Try|Pick|Drop|Wake|Walk|Follow|Meet|Be|Do|Don[’']t|Make|Check|Knock|Lock|Breathe|Relax|Calm)\b/i;
const _SP_FAMILY_RE = /^(?:Mama|Mamma|Mum|Mummy|Mom|Mommy|Mother|Papa|Pa|Dad|Daddy|Father|Grandma|Grandpa|Granny|Darling|Honey|Sweetheart|Love|Son|Kid|Baby)$/;
const _SP_GREETING_RE = /^(?:Good[- ]?(?:bye|night|morning|evening|afternoon|luck)|Bye|Farewell|Hello|Hi|Hey)\b/i;
const _SP_SIGNOFF_RE = /^(?:Love|Yours(?: truly| ever| always)?|Regards|Always|Forever|Fondly|Warmly|Best|Kisses|Hugs|x+)\s*,\s*[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+(?:\s[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)?\s*[.…]*$/i;
const _SP_ENDEARMENT_RE = /,\s*(?:dear|darling|honey|love|sweetheart|sweetie|son|kid|mate|pal|buddy|boss|officer|mum|mom|mama|dad|papa|grandma|grandpa|baby|babe)\s*[.…,;]*["”’']?\s*$/i;
/* a note of what a filmed person will cover, in the third person — not their words: "How the
   soles of his feet read the night's tide", "Leonor's own account of the moment", "Her account
   of the night the wall went", "In her own words, the night the wall went", "Hands, heel and
   clay: how he reads the tide". Never with an auxiliary ("Her account was a lie.") or a verb
   right after the account ("His story never changed.") */
const _SP_ACCOUNT_RE = /^(?:(?:[A-Z][a-zà-ÿ'’-]+(?:\s[A-Z][a-zà-ÿ'’-]+)?[’']s|His|Her|Their)\s+(?:own\s+)?(?:account|recollection|memory|memories|testimony|telling|version|story|words|description)(?=\s+(?:of|about|from|in|as|at)\b|\s*[,.;:—–…]|\s*$)|In (?:his|her|their) own words\b|(?:[^.!?:]*:\s*)?(?:How|What|Why|Where|When|Whether|Who|how|what|why|where|when|whether|who)\s+(?:the|his|her|their|its|he|she|they)\b)/;
const _SP_AUX_RE = /\b(?:is|was|were|are|am|be|been|has|had|have|will|would|can|could|should|shall|must|may|might|did|does|do)\b/i;
/* a label: CAPS words joined by spaces, a spaced dash, an em/en dash or a slash. Dots sit
   INSIDE a word (V.O., P.A.) or end the whole label — never between two words, so a
   readout ending in a period ("MISSED CALL. NINA:") can't swallow the next name. */
const _SP_TOK = "(?:(?:MR|MRS|MS|DR|ST|SGT|LT|CAPT|CPT|DET|PROF|REV|INSP|FR)\\.|[A-Z0-9#][A-Z0-9'\u2019&#]*(?:[.\\-][A-Z0-9'\u2019&#]+)*)";
const _SP_SEP = "(?:\\s*[\u2014\u2013\\/]\\s*|\\s+-\\s*|\\s*-\\s+|\\s+)";
const _SP_LABEL_RE = new RegExp("(^|[\\s\u201c\"\u2018'(\\[\u2014\u2013])((?=[A-Z])"+_SP_TOK+"(?:"+_SP_SEP+_SP_TOK+"){0,5}\\.?)(\\s*\\(([^()]{1,40})\\))?\\s*:(?=\\s|$|[\"\u201c'\u2018])","g");
const _SP_MIXED_RE = /(^|[.!?]["”’']?\s+)([A-Z][a-z'’]+(?:\s[A-Z][a-z'’]+){0,2})(\s*\(([^()]{1,40})\))?:\s/g;
// pronoun-level speech: I / me / my / you / we / us / our / let's (case-aware: "US" the
// country and "ME" in a readout are not pronouns), "sir", "ma'am" — and a lowercase "i" used
// as the pronoun ("i never went back", "i'm"), never "i.e." or "i/o"
const _SP_PRON_RE = /\b(?:[Mm]e|[Mm]y|[Mm]ine|[Mm]yself|[Yy]ou|[Yy]our|[Yy]ours|[Yy]ourself|[Yy]ourselves|[Ww]e|[Uu]s|[Oo]ur|[Oo]urs|[Oo]urselves|[Ll]et[’']s)\b|\bI(?:[’'](?:m|ve|ll|d))?\s+[a-z]|(?:^|[\s"“‘(\[—–-])i(?:[’'](?:m|ve|ll|d)\b|\s+[a-z])|\b(?:sir|ma[’']am)\b/;
// lighter speech signs, read in the FIRST sentence only: a contraction, an interjection, a question
const _SP_WEAK_RE = /[A-Za-z](?:n[’']t|[’'](?:re|ve|ll|m|d))\b|^(?:[Oo]h|[Hh]ey|[Yy]eah|[Yy]ep|[Nn]ope|[Oo]kay|[Oo]k|[Ss]orry|[Tt]hanks|[Tt]hank you|[Hh]ello|[Hh]i|[Ll]isten|[Hh]mm|[Uu]h|[Uu]m|[Hh]uh|[Ww]ow)\b|^[Pp]lease,|\?/;
// an order a person shouts — read only after a ROLE label ("GUARD: Hands up."): an app or a
// sign gives orders too ("TIDEWATCH: Move to higher ground."), so it never counts elsewhere
const _SP_IMPERATIVE_RE = /^(?:Hold (?:it|on|still|position|fire)|Stop|Wait|Go(?: on| back| home)?\b|Get (?:down|out|back|up|in|off|away|clear)|Stay|Move|Run|Come (?:on|here|back|in|with)|Look(?: out| at| here)?\b|Listen|Hurry|Freeze|Halt|Hands up|Drop (?:it|the)|Shut (?:up|it|the)|Help|Quiet|Easy|Careful|Enough|Leave (?:it|me|him|her|them|now)|Answer (?:me|it)|Pick up|Talk to|Tell (?:me|him|her|them)|Give (?:me|it|him|her)|Show (?:me|us)|Open (?:up|the|it|this|that)|Close (?:the|it|that|this)|Back off|Stand (?:down|back|up|still)|Sit down|Calm down|Keep (?:going|moving|quiet|still|back)|Watch out|Over here|Don[’']t|Let (?:me|him|her|them|go))\b/;
// narration resumes: a sentence that opens like action prose
const _SP_NARRATION_RE = /^(?:He|She|They|It|His|Her|Their|Its|The|A|An|Then|Nobody|No one|Someone|Everyone|Somewhere|Outside|Inside|Behind|Beside|Across|Above|Below|Beneath)\b/;
// a message that appears on a phone: "a text from DEV:", "The phone lights up. NINA: …"
const _SP_MSG_FROM_RE = /\b(?:text|texts|text message|message|messages|email|e-mail|sms|dm|note|notification|reply|post|preview|caption)\s+(?:from|by)\s*$/i;
const _SP_MSG_EVENT_RE = /\b(?:phone|mobile|cell(?:phone)?|smartphone|lock ?screen|watch|pager)\b[^.!?]*\b(?:lights? up|lit up|glows?|flash(?:es)?(?: up)?|pings?|chimes?)\b|\b(?:text|message|notification|sms|email|e-mail|dm)\b[^.!?]*\b(?:arrives?|appears?|pops? up|comes? in|lands?|flashes up)\b/i;
// what a screen or speaker SHOWS / makes, rather than words it speaks
const _SP_DESCRIBE_RE = /^(?:A|An|The|It|Its|Static|Silence|Nothing|Dead air|White noise|Hiss|Hissing|Crackle|Crackling|Feedback|Garbled|Muffled|Distorted|Indistinct|Chatter|Crosstalk|Noise|Music|Beep|Beeping|Clicks?|Dial tone|Ringing|Busy signal|Laughter|Applause|Screams?|Breathing|Footsteps|Snow)\b|\b(?:plays|loops|repeats|crackles|hisses|dies|fades|stops|starts|continues|ends|rings|beeps|clicks|buzzes|drones|blares|flickers|shows|stands|sits|cuts (?:out|off)|goes (?:dead|silent|quiet))\b/;

function _spTokenIn(set, t){ return set.has(t) || (t.length>3 && /S$/.test(t) && set.has(t.slice(0,-1))); }
function _spParseLabel(label){
  const base = String(label||"").replace(/\s*\([^()]*\)\s*$/,"").replace(/\s+/g," ").trim().toUpperCase();
  const segs = base.split(/\s*[\u2014\u2013\/]\s*|\s+-\s*|\s*-\s+/).map(seg=>
    seg.split(" ").filter(Boolean).map(w=>({
      t:w.replace(/[’']S$/,"").replace(/^[#.'’]+|[.'’]+$/g,""),
      poss:/[’']S$/.test(w) && w.length>2,
    })).filter(x=>x.t && !/^#?\d+$/.test(x.t))
  ).filter(sg=>sg.length);
  return { base, segs };
}
/* a segment's HEAD word: the last word before an "ON / FROM / OVER …" phrase; a leading
   locative ("ON THE SCREEN") is the device itself */
function _spHead(seg){
  let i = 0;
  if(seg.length>1 && _SP_PREP.has(seg[0].t)){ const rest = seg.filter(x=>x.t!=="THE" && !_SP_PREP.has(x.t)); return rest.length ? rest[rest.length-1].t : seg[seg.length-1].t; }
  while(i<seg.length && !(i>0 && _SP_PREP.has(seg[i].t))) i++;
  return seg[Math.max(0,i-1)].t;
}
/* where a known speaker sits in the label: "subject", "owner" (NINA'S), "author" (FROM
   NINA), "object" (ON NINA) — or null */
function _spSpeakerIn(P, speakers){
  if(!speakers || !speakers.size) return null;
  if(speakers.has(P.base)) return { seg:0, role:"subject" };
  for(let s=0;s<P.segs.length;s++){
    const seg = P.segs[s];
    if(speakers.has(seg.map(x=>x.t).join(" "))) return { seg:s, role:seg.some(x=>x.poss) ? "owner" : "subject" };
    for(let i=0;i<seg.length;i++){
      const pair = i+1<seg.length ? seg[i].t+" "+seg[i+1].t : "";
      if(!(speakers.has(seg[i].t) || (pair && speakers.has(pair)))) continue;
      const preps = seg.slice(0,i).filter(x=>_SP_PREP.has(x.t)).map(x=>x.t);
      const lastPrep = preps[preps.length-1];
      const role = (seg[i].poss || (pair && seg[i+1].poss)) ? "owner"
        : (lastPrep==="FROM" || lastPrep==="BY") ? "author" : lastPrep ? "object" : "subject";
      return { seg:s, role };
    }
  }
  return null;
}
function _spHeadClass(h){
  if(_spTokenIn(_SP_ROLE, h)) return "role";
  if(_spTokenIn(_SP_VOICE, h) || _spTokenIn(_SP_VOICE_HEAD, h)) return "voice";
  if(_spTokenIn(_SP_WRITTEN, h)) return "written";
  if(_spTokenIn(_SP_DIRECTION, h)) return "direction";
  if(_spTokenIn(_SP_LIVE, h)) return "live";
  if(_spTokenIn(_SP_DATA, h)) return "data";
  return "";
}
/* what a bare label NAMES — see the header comment. ext: the label's parenthetical. */
function screenplayLabelClass(label, speakers, ext){
  const P = _spParseLabel(label);
  if(!P.base || !P.segs.length) return "";
  const heads = P.segs.map(_spHead);
  const hc = heads.map(_spHeadClass);
  const lowerThird = /\bLOWER THIRD\b|\bLOCK ?SCREEN\b|\bHOME SCREEN\b/.test(P.base);
  const sp = _spSpeakerIn(P, speakers);
  if(sp){
    const segHead = hc[sp.seg];
    const writtenBefore = hc.slice(0, sp.seg).includes("written");
    if(writtenBefore) return "written";                                           // TEXT — DEV
    if((sp.role==="owner" || sp.role==="author") && (segHead==="written" || segHead==="live" || lowerThird)) return "written"; // NINA'S PHONE, EMAIL FROM NINA
    if((sp.role==="owner" || sp.role==="object") && segHead==="direction") return "direction"; // NINA'S POV, CLOSE ON NINA
    // GRACINDA'S ALBUM: a thing she keeps. Never when her name does not open that part of the
    // label ("HOLDING GRACINDA'S ALBUM"), another cast member is in it ("GRACINDA'S ALBUM —
    // LEONOR", or a "thing" that is itself someone in the cast), or the brackets make it a
    // person's ("NINA'S DIARY (V.O.)", "(reading)", "(LEONOR)")
    const kseg = P.segs[sp.seg], kh = heads[sp.seg];
    const opens = kseg[0].poss || (kseg.length>2 && kseg[1].poss && speakers.has(kseg[0].t+" "+kseg[1].t));
    if(sp.role==="owner" && opens && _spTokenIn(_SP_KEEPSAKE, kh) && !_spOtherSpeaker(P, sp, speakers) && _spObjectExt(ext, speakers)) return "keepsake";
    // EXPECTED TESTIMONY — LEONOR: a documentary's planned testimony naming its subject
    if(_spExpectedTestimony(P, sp, speakers, ext)) return "testimony";
    return "speaker";
  }
  const e = String(ext||"").replace(/\s+/g," ").trim().toUpperCase();
  if(e && speakers && speakers.has(e)) return "speaker";                          // RADIO (BRAM)
  if(lowerThird) return "written";
  const idx = (c)=>hc.indexOf(c);
  if(idx("role")>=0 && !(idx("written")>=0 && idx("written")<idx("role"))) return "role"; // TEXT — MOTHER is written
  if(P.segs.some(sg=>sg.some(x=>_spTokenIn(_SP_VOICE, x.t))) || /^(?:PRE-?)?RECORDED\b|^AUTOMATED\b/.test(P.base) || idx("voice")>=0) return "voice";
  for(const c of ["written","direction","live","data"]) if(idx(c)>=0) return c;
  return "";
}
function _spFirstSentence(s){
  const t = String(s||"").trim();
  const m = t.match(/^[\s\S]*?[.!?…]+(?=["”’']?(?:\s|$))["”’']?/);
  return (m ? m[0] : t).trim();
}
function _spStartsWithSpeaker(sentence, speakers){
  if(!speakers || !speakers.size) return false;
  const w = String(sentence||"").trim().split(/\s+/).slice(0,2).map(x=>x.replace(/[’']s$/i,"").replace(/[^A-Za-z'’-]/g,"").toUpperCase());
  return !!w[0] && (speakers.has(w[0]) || (w[1] && speakers.has(w[0]+" "+w[1])));
}
/* a bracket that is ONLY a production note (see _SP_NOTE_PERSON_RE): { person, names } or null.
   person — a part says someone is filmed talking (sit-down, interview, record, do not prompt);
   names — a part is a cast member ("Armindo, sit-down, to be recorded") */
function _spProductionNote(ext, speakers){
  const parts = String(ext||"").split(/\s*(?:[,;\/+&]|\band\b)\s*/i).map(x=>x.replace(/[.\s]+$/,"").trim()).filter(Boolean);
  let note = false, person = false, names = false;
  for(const p of parts){
    if(_SP_NOTE_PERSON_RE.test(p)){ note = person = true; continue; }
    if(_SP_NOTE_NEUTRAL_RE.test(p)){ note = true; continue; }
    if(speakers && speakers.has(p.toUpperCase().replace(/[’']S$/,"").replace(/\s+/g," "))){ names = true; continue; }
    return null;
  }
  return note ? { person, names } : null;
}
/* "EXPECTED TESTIMONY — LEONOR" (docs/Story Pipeline.md step 5, "Page forms"): exactly two parts —
   "EXPECTED TESTIMONY", then the subject's name alone (a cast member, no possessive, no other
   word) — with no brackets or only a production note ("(record)", "(Leonor, sit-down)"). A voice
   or delivery bracket ("(V.O.)", "(softly)") keeps it her line. */
function _spExpectedTestimony(P, sp, speakers, ext){
  if(!sp || sp.role!=="subject" || sp.seg!==1 || P.segs.length!==2) return false;
  if(P.segs[0].map(x=>x.t).join(" ")!=="EXPECTED TESTIMONY") return false;
  const name = P.segs[1];
  if(name.some(x=>x.poss) || !speakers.has(name.map(x=>x.t).join(" "))) return false;
  return !String(ext||"").trim() || !!_spProductionNote(ext, speakers);
}
/* "EXPECTED TESTIMONY: Leonor: …" / "EXPECTED TESTIMONY — Leonor: …" — a cast member's name in
   mixed case with a colon right after it (docs/Story Pipeline.md step 5 accepts "EXPECTED
   TESTIMONY: <subject> on <topic>", never words written for them). 2026-09-28: the mixed-case
   name was never read as a label, so her invented line passed both checks as the unnamed
   form's text; screenplayActionLabels now reads it as the NAMED form and holds it to that
   form's topic rule. (A CAPS name is already a label of its own.) Groups: 4 the label's
   brackets, 5 the name, 7 the name's brackets. */
const _SP_TESTIMONY_NAMED_RE = /(^|[^A-Za-z])(EXPECTED TESTIMONY)(\s*\(([^()]{1,40})\))?(?:\s*:|\s*[\u2014\u2013\/]|\s+-)\s*([A-Z\u00c0-\u00dd][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff'\u2019-]*(?:\s[A-Z\u00c0-\u00dd][A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff'\u2019-]*){0,2})(\s*\(([^()]{1,40})\))?:(?=\s|$)/g;
/* any label that is planned testimony: "EXPECTED TESTIMONY", with or without its subject's name */
function _spTestimonyLabel(label){ return /^EXPECTED TESTIMONY(?:$|\s*[—–\/]|\s+-\s)/.test(_spParseLabel(label).base); }
/* a quoted span — words written for someone: "…", “…”, ‘two words’ or 'two words' (an
   apostrophe — "father's", "’53" — is not a quote) */
const _SP_QUOTE_SPAN_RE = /["“”]|‘[^‘’]*\s[^‘’]*’|(?:^|[\s(—–-])'[^']*\s[^']*'(?=$|[\s.,;:!?…)—–-])/;
/* quoted words in planned testimony: true when a quote is a LINE written for someone. A quoted
   TITLE or NICKNAME is not — the report "Salt and Tide, 1953", the "Iron Wall", the song “Mar
   Salgado”: up to eight words, each capitalised (or a number, or a small joining word such as
   "and", "of", "de"), no sentence punctuation, no I / me / we / you. An unmatched quote mark is
   read as a line. */
const _SP_TITLE_JOIN = _SP_WORDS("a an the and or of in on at to for by with from de da do das dos del la le el y e van von");
function _spTitleSpan(inner){
  const t = String(inner||"").trim();
  if(!t || /[.!?…]/.test(t)) return false;
  const words = t.split(/\s+/).map(w=>w.replace(/^[(\[]+|[),;:—–\]]+$/g,"")).filter(Boolean);
  if(!words.length || words.length>8 || !/^[A-Z0-9À-Ý]/.test(words[0])) return false;
  if(words.some(w=>/^(?:i|me|my|mine|we|us|our|ours|you|your|yours)$/i.test(w))) return false;
  return words.every(w=>/^[A-Z0-9À-Ý]/.test(w) || _SP_TITLE_JOIN.has(w));
}
function _spQuotesLine(text){
  const t = String(text||"");
  if(!_SP_QUOTE_SPAN_RE.test(t)) return false;
  const spans = [], re = /"([^"“”]*)"|“([^“”"]*)”|‘([^‘’]*)’|(?:^|[\s(—–-])'([^']*\s[^']*)'(?=$|[\s.,;:!?…)—–-])/g;
  let m, rest = t;
  while((m = re.exec(t))){ spans.push(m[1]!=null ? m[1] : m[2]!=null ? m[2] : m[3]!=null ? m[3] : m[4]); rest = rest.replace(m[0], " "); }
  if(!spans.length || /["“”]|‘[^‘’]*\s/.test(rest)) return true;            // a stray quote mark
  return spans.some(x=>!_spTitleSpan(x));
}
/* what the named form's text must be (docs/Story Pipeline.md step 5: "EXPECTED TESTIMONY:
   <subject> on <topic>"): every sentence, and every part after a colon, opens as a TOPIC —
   "on …" / "about …", a third-person account OF something ("her account of the flood night",
   "Leonor's recollection of …") or an indirect question ("how the salt pans were worked", "what
   the tide took"). Lowercase words alone are no licence ("i never went back", "nobody came"),
   and "In her own words, …" / "Her words: …" / "Her testimony: …" introduce words, not a topic. */
const _SP_TOPIC_RE = /^(?:(?:on|about|regarding)\s+\S|(?:(?:[A-Za-zÀ-ÿ'’-]+(?:\s[A-Za-zÀ-ÿ'’-]+)?[’']s|his|her|their)\s+(?:own\s+)?(?:account|recollection|memory|memories|telling|version|story|description|testimony)\s+(?:of|about|from|on)\s+\S)|(?:how|what|why|where|when|whether|who)\s+(?:the|his|her|their|its|he|she|they|a|an)\b)/i;
/* the brackets of a kept object that leave it an object: none, a visual word, a year or page, a note */
function _spObjectExt(ext, speakers){
  const e = String(ext||"").trim();
  return !e || _SP_VISUAL_PAREN.test(e) || _SP_OBJECT_PAREN_RE.test(e) || !!_spProductionNote(e, speakers);
}
/* a cast member in the label other than the keepsake's owner: "GRACINDA'S ALBUM — LEONOR" */
function _spOtherSpeaker(P, sp, speakers){
  const own = P.segs[sp.seg][0].poss ? 1 : 2;               // "GRACINDA'S" / "GRACINDA SARMENTO'S"
  return P.segs.some((seg, s)=>seg.some((x, i)=>!(s===sp.seg && i<own) &&
    (speakers.has(x.t) || (i+1<seg.length && speakers.has(x.t+" "+seg[i+1].t)))));
}
/* the text before a label ends with a cast name and a comma: "LEONOR, GRACINDA'S ALBUM:" */
function _spNameComma(pre, speakers){
  const m = String(pre||"").match(/([A-Za-zÀ-ÖØ-öø-ÿ'’-]+)(?:\s+([A-Za-zÀ-ÖØ-öø-ÿ'’-]+))?,\s*$/);
  if(!m || !speakers || !speakers.size) return false;
  const a = m[1].toUpperCase(), b = m[2] ? m[2].toUpperCase() : "";
  return speakers.has(b || a) || (!!b && speakers.has(a+" "+b));
}
/* a note of what a filmed person will cover, not their words — see _SP_ACCOUNT_RE. Every
   sentence of it opens as an account or in lowercase, and none has an auxiliary */
function _spAccountNote(text){
  const t = String(text||"").trim();
  if(!_SP_ACCOUNT_RE.test(t) || _SP_AUX_RE.test(t)) return false;
  return (t.match(/[^.…]+[.…]*/g) || []).every(x=>{ x = x.trim(); return !x || /^[a-z]/.test(x) || _SP_ACCOUNT_RE.test(x); });
}
/* one sentence ADDRESSES someone: a greeting, an endearment, or a cast member ("Tomas." /
   "Tomas, …" opening it, "…, Tomas." closing a clause) */
function _spAddressed(x, speakers){
  const t = String(x||"").trim().replace(/^["“‘']+|["”’']+$/g,"").trim();
  if(_SP_SIGNOFF_RE.test(t)) return false;                                  // "Love, Gracinda." signs it
  if(_SP_GREETING_RE.test(t) || _SP_ENDEARMENT_RE.test(t)) return true;
  const open = t.match(/^([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)\s*(?:[,.…;]|$)/);
  if(open && _spIsCast(open[1], speakers)) return true;
  const re = /,\s*([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+)\s*(?=[,.…;]|$)/g;
  let m; while((m = re.exec(t))) if(_spIsCast(m[1], speakers)) return true;
  return false;
}
function _spIsCast(w, speakers){ return !!speakers && speakers.has(String(w).toUpperCase()); }
/* speech a role label would not catch, in one mixed-case sentence of a record field or a kept
   page: an order opening it ("Come home.", "Mama, come home."), "he's" / "there's", or it
   addresses someone (_spAddressed). CAPS record text is left to the role rules. */
function _spRecordSpeech(x, speakers){
  const t = String(x||"").trim().replace(/^["“‘']+|["”’']+$/g,"").trim();
  if(!/[a-z]/.test(t)) return false;
  const lead = t.match(/^([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]+),?\s+(.+)$/);
  const rest = lead && (_SP_FAMILY_RE.test(lead[1]) || _spIsCast(lead[1], speakers)) ? lead[2] : "";
  if(_SP_RECORD_ORDER_RE.test(t) || (rest && _SP_RECORD_ORDER_RE.test(rest))) return true;
  if(/\b(?:he|she|it|that|there|here|who|what|where|how|everyone|nobody|somebody|someone)[’']s\b/i.test(t)) return true;
  return _spAddressed(t, speakers);
}
/* the sentences of a label's text */
function _spSentences(all){ return (String(all||"").match(/[^.…]+[.…]*["”’']?/g) || []).map(x=>x.trim()).filter(Boolean); }
/* how many characters of `content` belong to its label: a quoted span, or the first
   sentence plus the sentences after it until narration resumes */
function _spReachLen(content, speakers){
  const t = String(content||"");
  if(!t.trim()) return 0;
  const lead = t.length - t.replace(/^\s+/,"").length;
  const body = t.slice(lead);
  const open = body.charAt(0);
  const close = open==="“" ? "”" : open==="‘" ? "’" : (open==='"' || open==="'") ? open : "";
  if(close){
    for(let i=1;i<body.length;i++){
      if(body.charAt(i)!==close && !(open==='"' && body.charAt(i)==="”")) continue;
      if(close==="'" || close==="’"){ const nx = body.charAt(i+1); if(nx && /[A-Za-z]/.test(nx)) continue; }   // You've, Nina's
      let j = i+1; while(j<body.length && /[.,!?…]/.test(body.charAt(j))) j++;
      return lead + j;
    }
  }
  const ends = [], bre = /[.!?…]+["”’']?(?=\s|$)/g;
  let mm; while((mm = bre.exec(body))) ends.push(mm.index + mm[0].length);
  if(!ends.length || body.slice(ends[ends.length-1]).trim()) ends.push(body.length);
  let len = ends[0];
  // a CAPS readout ("ACTUATOR: RESPONDING.") ends where lowercase prose resumes
  const capsFirst = !/[a-z]/.test(body.slice(0, ends[0]));
  for(let k=1;k<ends.length;k++){
    const st = body.slice(ends[k-1], ends[k]).trim();
    if(!st) continue;
    if((capsFirst && /[a-z]/.test(st)) || _SP_NARRATION_RE.test(st) || _spStartsWithSpeaker(st, speakers)) break;
    len = ends[k];
  }
  return lead + body.slice(0, len).replace(/\s+$/,"").length;
}
const _SP_FINITE_RE = /\b(?:the|a|an|this|that|these|those|is|are|was|were|am|be|been|being|has|have|had|does|did|do|will|would|can|could|should|shall|may|might|must|he|she|they|it|his|her|their|its|there|here)\b/;
/* a full sentence (not a telegraphic readout like "Wrenham gauge running high.") */
function _spIsSentence(plain){
  if(!/^[A-Z]/.test(plain)) return false;
  const lowerWords = plain.split(/\s+/).filter(w=>/^[a-z]/.test(w.replace(/^["“‘'(]+/,""))).length;
  if(lowerWords<2) return false;
  return _SP_FINITE_RE.test(plain.charAt(0).toLowerCase()+plain.slice(1));
}
/* a readout that opens with a person's name: "Emrys Prydderch, 07700 900123." */
function _spProperStart(plain){
  return /^(?:(?:Dr|Mr|Mrs|Ms|St|Sgt|Lt|Capt|Det|Prof)\.?\s+)?[A-Z][a-zà-ÿ’'-]+(?:\s+(?:[A-Z][a-zà-ÿ’'-]+|[A-Z]\.))+\s*(?:[,.;]|$)/.test(plain);
}
function _spTextKind(cls, ext, content, reach, ctx){
  const unq = x=>String(x||"").trim().replace(/^["“‘']+|["”’']+$/g,"").trim();
  const first = _spFirstSentence(reach || content);
  const plain = unq(first), all = unq(reach || content);
  if(!plain) return "data";                                       // "CLOSED BY:" at the end of a line
  const hasLower = /[a-z]/.test(all), firstLower = /[a-z]/.test(plain);
  const quoted = /^["“‘']/.test(String(reach||"").trim()) && hasLower;
  // roman numerals after a capitalised word ("Phase I", "Act I") are not the pronoun
  const pron = hasLower && _SP_PRON_RE.test(all.replace(/\b[A-Z][a-z]+ I\b/g,""));
  const vocative = !!(ctx && ctx.speakers) && /^[A-Z][A-Za-z'’-]+,\s/.test(plain) && _spStartsWithSpeaker(plain, ctx.speakers);
  const weak = firstLower && (_SP_WEAK_RE.test(plain) || vocative);
  const imperative = _SP_IMPERATIVE_RE.test(plain);
  const visualExt = !!ext && _SP_VISUAL_PAREN.test(ext);
  // a production note is not a cue extension — except after a nameless voice, which the
  // writers re-cue with the note as its parenthetical ("NARRATOR (V.O.)" + "(to be recorded)").
  // A keepsake's brackets were vetted as an object's ("(1962)", "(archive)"): never a cue either
  const pnote = !!ext && !visualExt ? _spProductionNote(ext, ctx && ctx.speakers) : null;
  const cueExt = !!ext && !visualExt && !(pnote && cls!=="voice") && cls!=="keepsake";
  // (all-CAPS words never read the brackets — "NEWSREEL (archive): FLOOD!" is a headline as before)
  const note = !!pnote && hasLower;
  // a named speaker's (TEXT) / (SMS) is a message shown on a screen; their (ON SCREEN)
  // is the person on a video call — still that character speaking
  const writtenExt = !!ext && /\b(?:TEXT|SMS|E-?MAIL|MESSAGE|CAPTION|SUPER|INSERT|READOUT|DISPLAY|GRAPHIC)\b/i.test(ext);
  // planned testimony ("EXPECTED TESTIMONY", with or without its subject's name) never quotes
  // anyone: words in quotes are a line written for a real person (a quoted title or nickname is
  // not — _spQuotesLine)
  if(ctx && ctx.testimony && _spQuotesLine(reach || content)) return "dialogue";
  // EXPECTED TESTIMONY — LEONOR: a NOTE of what she will cover, never her words — every sentence
  // (and every part after a colon) opens as a topic (_SP_TOPIC_RE: "on the flood night", "her
  // account of the flood night", "how the salt pans were worked"), nothing that reads as spoken;
  // CAPS text is a shouted line, as after any named speaker
  if(cls==="testimony"){
    if(!/[A-Za-z]/.test(all)) return "data";
    const ss = _spSentences(all), sp = ctx && ctx.speakers;
    if(!hasLower || quoted || pron || weak || imperative || /[!?]/.test(all)
      || ss.some(x=>_SP_WEAK_RE.test(x) || _spRecordSpeech(x, sp))) return "dialogue";
    const parts = ss.flatMap(x=>x.replace(/[.…]+$/,"").split(/:/)).map(x=>x.trim()).filter(Boolean);
    return (parts.length && parts.every(x=>_SP_TOPIC_RE.test(x))) ? "data" : "dialogue";
  }
  if(cls==="speaker" || cls==="keepsake"){
    if(!/[A-Za-z]/.test(all)) return "data";
    if(writtenExt) return "device";
    // a message a character sends, shown on a screen ("INSERT — PHONE: NINA: …"), and a kept
    // page shown the same way ("INSERT: LEONOR'S DIARY: I never told him.")
    if(!ext && ctx && ctx.written) return "device";
    if(cls==="speaker") return "dialogue";                        // "DEV: GET DOWN!" counts too
  }
  // (a keepsake "(ON SCREEN)" is still judged by its words below)
  if(cls==="written" || cls==="direction" || (visualExt && cls!=="keepsake")) return "device";
  // a production note says someone is being filmed: a cast member the note names ("TESTIMONY
  // BED (Armindo, sit-down, to be recorded):") is the person on camera, and so may be an
  // unknown label ("MARCUS (record):") or someone sat with a kept object ("GRACINDA'S ALBUM
  // (sit-down):"). Only a lowercase note of what they will cover ("how the soles of his feet
  // read the night's tide") or a third-person account ("Her account of the night the wall
  // went.", "How the soles of his feet…") passes; other capitalised words are their line
  const filmed = note && (!cls || (cls==="keepsake" && pnote.person) || ((cls==="live" || cls==="data" || cls==="keepsake") && pnote.names));
  if(filmed) cls = "role";
  if(cueExt && hasLower) return cls==="voice" ? "voice" : "dialogue";
  if(cls==="voice") return !hasLower ? "data" : (!pron && _SP_DESCRIBE_RE.test(plain)) ? "device" : "voice";
  const sp = ctx && ctx.speakers;
  // a kept object shows words or pictures; anything that reads as spoken is the owner's line:
  // quotes, I / you / we, a question, a contraction, an interjection, a "!", an order ("Come
  // home.", "Mama, come home."), a greeting, or someone addressed ("Keep the pans, Leonor.")
  if(cls==="keepsake") return (quoted || pron || weak || imperative || /[!?]/.test(all) || _spSentences(all).some(x=>_spRecordSpeech(x, sp))) ? "dialogue" : "device";
  // with a production note a screen label is a person being filmed ("INTERVIEW (sit-down): What
  // happened?"): a question, a contraction, an interjection, a "!", a greeting or someone
  // addressed ("Leonor. The wall is gone.") is their line too
  if(cls==="live") return (quoted || pron || (note && (weak || /[!?]/.test(all) || _spSentences(all).some(x=>_spAddressed(x, sp))))) ? "dialogue" : "device";
  if(note && /[!?]/.test(all)) return "dialogue";                     // CROWD (b-roll): Out! Out!
  if(filmed && !/^[a-z]/.test(plain))                                 // MARCUS (record): Two minutes.
    return (_spAccountNote(all) && !pron && !quoted && !weak && !imperative) ? "data" : "dialogue";
  if(!firstLower) return (cls==="role" && /[!?]/.test(first)) ? "dialogue" : "data";   // GUARD: HALT!
  if(/^[a-z0-9]/.test(plain) || cls==="data") return pron ? "dialogue" : "data";
  if(_spProperStart(plain) && !pron) return "data";
  const sentence = _spIsSentence(plain);
  if(cls==="role") return (quoted || pron || weak || imperative || sentence) ? "dialogue" : "data";
  return (quoted || pron || weak) ? "dialogue" : sentence ? "unclear" : "data";
}
/* a CAPS record whose field VALUE is a person's name, glued to the NEXT field's label by a
   separator: "INSERT — CAD LOG: WELFARE CHK — PRUITT, OPAL — NOTE: 'NO PROWLER.'",
   "SUBSCRIBER: LUSK / ADDRESS: 14 LARKSPUR RD". The label pattern reads "OPAL — NOTE" and
   "LUSK / ADDRESS" as one label naming a cast member; inside a record it is the field
   NOTE / ADDRESS, and the name is the value before it. Re-anchored to the field only when
   ALL of these hold:
     0. the label is all CAPS and carries no voice extension ("OPAL — NOTE (V.O.):" is hers),
     1. the name sits in a segment BEFORE the field ("ON SCREEN - GRAHAM:" stays Graham's),
     2. the field alone names a written surface, a data field or a record field (NOTE,
        STATUS, ADDRESS, REMARKS, DISPOSITION, CITY …), or a person's field with a CAPS
        value ("CALLER: PRUITT, OPAL.") — never one that carries someone's own words
        (MESSAGE, TEXT, TRANSCRIPT, QUOTE, REPLY),
     3. the record runs right up to the name: the sentence before it is CAPS record text,
        or a lead-in that SHOWS the record ("The log reads:", "Tomas pulls up the log:") —
        never when the name opens the sentence ("NINA — NOTE: Go back to bed.", "PRUITT,
        OPAL — NOTE: …": the surname of "SURNAME, FIRST" is the name too) and never after a
        lead-in that speaks ("Opal whispers:", "He says:", "…into the phone:"),
     4. the field's text is not speech: no "!" or "?" anywhere; no sentence of it would be a
        line after a person's role label (quotes, I / you / we, a contraction, an
        interjection, an order such as "Go back to bed.", a vocative, a full sentence); and
        no mixed-case sentence opens with an order or a greeting ("Come home.", "Mama,
        come home.", "Goodbye, Tomas."), says "he's" / "there's", or addresses a cast
        member or a "dear" ("Tomas. Come home.", "Come home, Walt.", "…, dear."). CAPS
        record text reads as before (the CAD style: "ASK ABOUT THE LILACS.").
   Returns { start, label } for the field alone, or null. */
function _spRecordField(s, h, stop, speakers){
  if(!speakers || !speakers.size || /[a-z]/.test(h.label)) return null;
  if(h.ext && !_SP_VISUAL_PAREN.test(h.ext)) return null;          // "OPAL — NOTE (V.O.):" is a voice, not a field
  const raw = s.slice(h.start, h.end).replace(/\s*(?:\([^()]*\))?\s*:$/, "");
  const sepRe = /\s*[—–\/]\s*|\s+-\s*|\s*-\s+/g;
  let m, cut = -1;
  while((m = sepRe.exec(raw))) cut = m.index + m[0].length;
  if(cut<=0 || cut>=raw.length) return null;
  const field = raw.slice(cut).replace(/\s+/g," ").trim();
  if(!_spSpeakerIn(_spParseLabel(raw.slice(0, cut).replace(/[\s—–\/-]+$/,"")), speakers)) return null;   // 1
  const fw = _spParseLabel(field).segs.flat().map(x=>x.t);                                                     // 2
  if(fw.some(t=>_spTokenIn(_SP_MESSAGE_FIELD, t))) return null;
  const fc = screenplayLabelClass(field, speakers, h.ext);
  const after = s.slice(h.end, stop);
  const reach = after.slice(0, _spReachLen(after, speakers)).trim();
  // a person's field (CALLER, OFFICER, DISPATCHER) only with a CAPS value: "CALLER: PRUITT, OPAL."
  if(!(fc==="written" || fc==="data" || (fc==="role" && !/[a-z]/.test(reach)) ||
    ((fc==="" || fc==="direction") && fw.some(t=>_spTokenIn(_SP_RECORD_FIELD, t))))) return null;
  const pre = s.slice(0, h.start);                                                                             // 3
  const sm = pre.match(/(?:^|[.!?…]["”’']?\s)([^.!?…]*)$/);
  // the SURNAME of a "PRUITT, OPAL" value is part of the name, not record text before it
  let lead = (sm ? sm[1] : pre).replace(/(?:[A-Z][A-Z'’.-]*\s+)?[A-Z][A-Z'’-]*,\s*$/, "");
  let shown = false;
  if(/[a-z]/.test(lead)){
    const c = lead.lastIndexOf(":");
    const intro = c<0 ? "" : lead.slice(0, c);
    if(!_SP_SHOWS_RE.test(intro) || _SP_SAYS_RE.test(intro)) return null;
    lead = lead.slice(c + 1); shown = true;
  }
  if(/[a-z]/.test(lead) || !(shown || /[A-Z0-9]/.test(lead))) return null;
  if(/[!?]/.test(reach)) return null;                                                                          // 4
  const ss = _spSentences(reach);                                                                               // …in ANY sentence
  if([reach, ...ss].some(x=>_spTextKind("role", "", x, x, { speakers })==="dialogue") || ss.some(x=>_spRecordSpeech(x, speakers))) return null;
  return { start:h.start + cut, label:field };
}
/* every "LABEL:" in one action paragraph, classified. speakers: a Set from
   screenplaySpeakers(). Each hit: { start, end, label, ext, content, reach, reachEnd,
   labelClass, kind, last } — reach/reachEnd: the words that belong to the label. */
function screenplayActionLabels(text, speakers){
  const s = String(text||"");
  const hits = [];
  _SP_LABEL_RE.lastIndex = 0;
  let m;
  while((m = _SP_LABEL_RE.exec(s))){
    const start = m.index + m[1].length;
    hits.push({ start, end:m.index + m[0].length, label:m[2].replace(/\s+/g," ").trim(), ext:m[4] ? m[4].trim() : "" });
  }
  // a MIXED-case label counts only when it is a known speaker ("Dev: Wrenham, ops.")
  if(speakers && speakers.size){
    _SP_MIXED_RE.lastIndex = 0;
    while((m = _SP_MIXED_RE.exec(s))){
      const start = m.index + m[1].length;
      if(hits.some(h=>h.start===start)) continue;
      if(_spSpeakerIn(_spParseLabel(m[2]), speakers)) hits.push({ start, end:m.index + m[0].length - 1, label:m[2], ext:m[4] ? m[4].trim() : "" });
    }
    // "EXPECTED TESTIMONY: Leonor: …" is the named form (_SP_TESTIMONY_NAMED_RE): one label,
    // "EXPECTED TESTIMONY — Leonor", replacing the unnamed label it starts with
    _SP_TESTIMONY_NAMED_RE.lastIndex = 0;
    while((m = _SP_TESTIMONY_NAMED_RE.exec(s))){
      const name = m[5].replace(/\s+/g," ").trim();
      if(!/[a-z\u00df-\u00ff]/.test(name) || !speakers.has(name.toUpperCase())) continue;
      const start = m.index + m[1].length, end = m.index + m[0].length;
      for(let k=hits.length-1;k>=0;k--) if(hits[k].start>=start && hits[k].start<end) hits.splice(k,1);
      hits.push({ start, end, label:"EXPECTED TESTIMONY \u2014 "+name, ext:(m[7] || m[4] || "").trim() });
    }
    hits.sort((a,b)=>a.start-b.start);
  }
  // a name inside a CAPS record is the previous field's value, not part of the next label
  hits.forEach((h,i)=>{
    const f = _spRecordField(s, h, i+1<hits.length ? hits[i+1].start : s.length, speakers);
    if(f){ h.start = f.start; h.label = f.label; }
  });
  const out = [];
  hits.forEach((h,i)=>{
    const stop = i+1<hits.length ? hits[i+1].start : s.length;
    const raw = s.slice(h.end, stop);
    const rlen = _spReachLen(raw, speakers);
    const reach = raw.slice(0, rlen).trim();
    let cls = screenplayLabelClass(h.label, speakers, h.ext);
    // "LEONOR, GRACINDA'S ALBUM:" — a cast member glued to a kept object by a comma is that person
    if(cls==="keepsake" && _spNameComma(s.slice(0, h.start), speakers)) cls = "speaker";
    // is this label's text a message SHOWN on a screen? (only matters for a speaker or a keepsake)
    let written = false;
    if(cls==="speaker" || cls==="keepsake"){
      const prev = out[out.length-1];
      const between = prev ? s.slice(prev.end, h.start) : "";
      if(prev && prev.labelClass==="written" && /^[\s—–-]*$/.test(between)) written = true;   // INSERT — PHONE: NINA: …
      const pre = s.slice(0, h.start);
      const mm = pre.match(/([^.!?…]*[.!?…]+["”’']?\s*)?([^.!?…]*)$/) || [];
      if(_SP_MSG_FROM_RE.test(mm[2]||"")) written = true;                                    // a text from DEV: …
      const ctxText = (mm[1]||"")+(mm[2]||""), ev = ctxText.match(_SP_MSG_EVENT_RE);
      // "The phone lights up. NINA: …" — but not "The phone lights up: MISSED CALL. NINA: …",
      // where the screen already showed its own words and NINA is a new, spoken element
      if(ev && !/:/.test(ctxText.slice(ev.index + ev[0].length))) written = true;
    }
    out.push({ ...h, content:raw.trim(), reach, reachEnd:h.end + rlen, labelClass:cls,
      kind:_spTextKind(cls, h.ext, raw, reach, { speakers, written, testimony:_spTestimonyLabel(h.label) }), last:i===hits.length-1 });
  });
  return out;
}
/* the kinds the screenplay writers reject and the Script check warns about */
function screenplayRejectsLabel(h){ return !!h && (h.kind==="dialogue" || h.kind==="voice"); }
/* the first smuggled-dialogue label in an action paragraph (a leftover voice counts:
   the writers turn every convertible one into a cue first), or null */
function screenplayEmbeddedDialogue(text, speakers){
  return screenplayActionLabels(text, speakers).find(screenplayRejectsLabel) || null;
}
/* on-screen-text cue phrases no character could be called */
const _SP_CUE_WRITTEN_RE = /^(?:INSERT\b.*|(?:SUPER(?:IMPOSED?)?|MAIN|END|OPENING|CLOSING)\s+(?:CARD|TITLES?)|TITLE\s+CARD|LOWER\s+THIRD|CHYRON|SUPERIMPOSED?|SUPER\s+TITLE|CAPTIONS?|SUBTITLES?|TEXT\s+MESSAGES?|SMS|READOUT|NOTIFICATION|(?:LOCK|HOME)\s+SCREEN)$/;
const _SP_CUE_LIVE_RE = /^(?:ON[- ]?(?:THE\s+)?SCREEN\b.*|ONSCREEN\b.*|(?:PHONE|MOBILE|CELL|LAPTOP|TABLET|COMPUTER|WALL|TV|CONSOLE|DASHBOARD|WATCH|SECURITY)\s+(?:SCREEN|DISPLAY|READOUT|MONITOR))$/;
// a single word that is usually a device but can name a person (a building's SUPER, Bruce BANNER)
const _SP_CUE_DEVICE_WORD = _SP_WORDS("SUPER TITLE CARD SCREEN SIGN BANNER TEXT DISPLAY LEGEND GRAPHIC TICKER CRAWL DISCLAIMER");
/* Is this CHARACTER CUE really an on-screen device (so cue + "dialogue" is one action
   line)? Never for a known speaker or a person's label (THIRD GUARD, CARD DEALER); a
   written device phrase always; a live screen only when the words aren't spoken; an
   ambiguous single word (SUPER, TITLE, BANNER…) only over CAPS on-screen text. */
function screenplayCueDevice(cue, next, speakers){
  const t = String(cue||"").replace(/\s+/g," ").trim().toUpperCase();
  const pm = t.match(/\(([^()]*)\)\s*$/);
  const base = t.replace(/\s*\([^()]*\)\s*$/,"").replace(/[\s:]+$/,"").trim();
  if(!base) return false;
  if(speakers && _spSpeakerIn(_spParseLabel(base), speakers)) return false;
  const nx = String(next||"").trim();
  const spoken = /^["“‘']/.test(nx) || _SP_PRON_RE.test(nx);
  if(pm && _SP_VISUAL_PAREN.test(pm[1])) return /TEXT|INSERT|SUPER|CAPTION|READOUT|DISPLAY|GRAPHIC/.test(pm[1]) || !spoken;
  if(_SP_CUE_WRITTEN_RE.test(base)) return true;
  if(_SP_CUE_LIVE_RE.test(base)) return !spoken;
  if(_SP_CUE_DEVICE_WORD.has(base)) return !!nx && !/[a-z]/.test(nx);
  return false;
}
/* a cue on the page that is NOT a person: a voice label or an on-screen device */
function _spCueIsNotPerson(raw){
  const t = String(raw||"").replace(/\s+/g," ").trim().toUpperCase();
  const pm = t.match(/\(([^()]*)\)\s*$/);
  const base = t.replace(/\s*\([^()]*\)\s*$/,"").trim();
  if(pm && _SP_VISUAL_PAREN.test(pm[1])) return true;
  if(_SP_CUE_WRITTEN_RE.test(base) || _SP_CUE_LIVE_RE.test(base) || _SP_CUE_DEVICE_WORD.has(base)) return true;
  const c = screenplayLabelClass(base, null);
  return c==="voice" || c==="written" || c==="direction" || c==="live";
}
/* the names that SPEAK in this scene: the cast (full, first and last names, ids) and the
   beat map's driver/reactor — always, whatever their names say ("Rosa Bell", "Bruce
   Banner", a character called Pa) — plus every character cue on the page, and every name
   the action introduces with an age ("MARCUS (40s)"), but never a voice or device cue
   such as RECORDED VOICE or PHONE (ON SCREEN) */
function screenplaySpeakers(blocks, bm, cast, extra){
  const out = new Set();
  const norm = raw=>String(raw||"").replace(/\s*\([^()]*\)/g,"").replace(/\s+/g," ").trim().toUpperCase();
  const addParts = (full)=>{
    if(full.length<2) return;
    out.add(full);
    const parts = full.split(" ").filter(p=>p.length>=2 && !_SP_HONORIFIC.has(p));
    if(parts.length>1){ out.add(parts[0]); if(parts[parts.length-1].length>=3) out.add(parts[parts.length-1]); }
  };
  const addPerson = raw=>addParts(norm(raw));
  const addCue = raw=>{ if(!_spCueIsNotPerson(raw)) addParts(norm(raw)); };
  (Array.isArray(cast)?cast:[]).forEach(c=>{ if(c){ addPerson(c.name); if(c.id && /^[a-z]{3,24}$/i.test(c.id)) addPerson(String(c.id)); } });
  if(bm){ addPerson(bm.driverLabel); addPerson(bm.reactorLabel); }
  (Array.isArray(blocks)?blocks:[]).forEach(b=>{
    if(!b) return;
    if(b.type==="char") addCue(b.text);
    else if(b.type==="action"){
      const re = /(?:^|[^A-Za-z])([A-Z][A-Z'’-]+(?:\s+[A-Z][A-Z'’-]+){0,2})\s*\(\s*(?:(?:(?:early|mid|late)[\s-]*)?\d0(?:s|’s|'s)|\d{2})\s*\)/g;
      let m; while((m = re.exec(String(b.text||"")))) addPerson(m[1]);
    }
  });
  (Array.isArray(extra)?extra:[]).forEach(addCue);
  return out;
}
/* the action text with its ON-SCREEN words removed (the label and the words it shows),
   for readers that look for physical things in action prose — set dressing, who is in
   the room. "She highlights the handshake. OPERATOR: CARROW, N." → "She highlights the
   handshake." Spoken or direction labels are left alone. */
function screenplayStripScreenText(text, speakers){
  const s = String(text||"");
  const hits = screenplayActionLabels(s, speakers||null)
    .filter(h=>(h.kind==="device" || h.kind==="data" || h.kind==="unclear") && h.labelClass!=="direction");
  if(!hits.length) return s;
  let out = "", at = 0;
  hits.forEach(h=>{ out += s.slice(at, h.start); at = Math.max(at, h.reachEnd); });
  out += s.slice(at);
  return out.replace(/\s+([.,;:!?])/g,"$1").replace(/\s{2,}/g," ").trim();
}
window.SP_LABELS_VERSION = SP_LABELS_VERSION;
window.screenplayLabelClass = screenplayLabelClass;
window.screenplayActionLabels = screenplayActionLabels;
window.screenplayRejectsLabel = screenplayRejectsLabel;
window.screenplayEmbeddedDialogue = screenplayEmbeddedDialogue;
window.screenplayCueDevice = screenplayCueDevice;
window.screenplaySpeakers = screenplaySpeakers;
window.screenplayStripScreenText = screenplayStripScreenText;

/* THE DIALOGUE GRAMMAR the Script check and the writers' validator (validateScreenplayBlocks,
   ai.jsx) share: a cue, an optional parenthetical, then dialogue — and a MID-SPEECH
   parenthetical between two dialogue blocks of the same speech continues it (cue → dia →
   "(beat)" → dia), the standard form (docs/Story Pipeline.md step 5, "Page forms"). Two
   dialogue blocks in a row, dialogue after action, and a parenthetical with no dialogue after it
   are still out of the grammar — a speech that resumes after action needs its cue again,
   "NAME (CONT’D)" (the writers' normaliser adds it). Returns, per block, true when a "paren"
   or "dia" block sits in a speech. */
function screenplaySpeechLinks(blocks){
  const list = Array.isArray(blocks) ? blocks : [];
  const ok = new Array(list.length).fill(false);
  for(let i=0;i<list.length;i++){
    const b = list[i] || {}, p = list[i-1] || {}, n = list[i+1] || {};
    if(b.type==="paren") ok[i] = n.type==="dia" && (p.type==="char" || (p.type==="dia" && ok[i-1]));
    else if(b.type==="dia") ok[i] = p.type==="char" || (p.type==="paren" && ok[i-1]);
  }
  return ok;
}
window.screenplaySpeechLinks = screenplaySpeechLinks;

/* A PARENTHETICAL THAT CARRIES A LINE — "(JOHN: Out.)", "(beat; Mara: Where?)": a speaker label
   (a CAPS name, or a cast member's name) followed by words. A parenthetical is tone or business
   inside ONE speech (a mid-speech "(beat)" included); another person's words there would never
   be cued, voiced or counted, so the writers reject it and the Script check flags it. A cue
   extension ("(V.O.: …)") is not a name. */
function screenplayParenLine(text, speakers){
  const t = String(text||"").replace(/^\s*\(\s*|\s*\)\s*$/g,"");
  const re = /(?:^|[\s;,—–(-])([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]*){0,3})\s*:\s*\S/g;
  let m;
  while((m = re.exec(t))){
    const label = m[1].replace(/\s+/g," ").trim(), up = label.toUpperCase();
    if(/^(?:V\.?\s?O\.?|O\.?\s?S\.?|O\.?\s?C\.?|CONT[’']?D\.?|FILTERED)$/i.test(label)) continue;
    if(label===up && /[A-Z]{2}/.test(label)) return true;                      // "JOHN:", "OFFICER REYES:"
    if(speakers && (speakers.has(up) || up.split(" ").some(w=>speakers.has(w)))) return true;   // "John:"
  }
  return false;
}
window.screenplayParenLine = screenplayParenLine;

/* SCRIPT CHECK — deterministic screenplay grammar + production-unit visibility.
   Read-only by design: this reports what is on the page and never rewrites it. */
function screenplayFormatReport(scene, screenplay, beats){
  const blocks = (screenplay && Array.isArray(screenplay.blocks)) ? screenplay.blocks : [];
  const beatSet = new Set(((beats&&beats.rows)||[]).map(r=>Number(r.n)).filter(Number.isFinite));
  const issues = [], units = [];
  const add = (code,severity,blockIndex,beat,message)=>
    issues.push({code,severity,blockIndex,beat,message});
  const clean = b=>String((b&&b.text)||"").trim();
  // who speaks in this scene (its own cues + the live cast) — lets the dialogue-in-action
  // check tell "NINA: Go." (a smuggled line) from "OPERATOR: CARROW, N." (a readout)
  const speakers = screenplaySpeakers(blocks, beats, window.turnCast);
  blocks.forEach((b,i)=>{
    const t=clean(b), beat=Number(b&&b.beat);
    if(!t) add("empty-block","error",i,beat,"Empty "+((b&&b.type)||"screenplay")+" element.");
    if(Number.isFinite(beat) && beatSet.size && !beatSet.has(beat))
      add("unknown-beat","warn",i,beat,"This text is assigned to Beat "+beat+", which is not in the current beat map.");
    if(!b || b.type!=="scene" || !t || /^\s*INTERCUT\b/i.test(t)) return;
    const p=(typeof parseSlugline==="function")?parseSlugline(t):null;
    if(!p || !p.place || !p.intExt)
      add("bad-slugline","error",i,beat,"Scene heading needs INT., EXT., or INT./EXT. followed by a location.");
    else {
      units.push({blockIndex:i,beat,label:[p.intExt+".",String(p.place).toUpperCase(),p.time?String(p.time).toUpperCase():""].filter(Boolean).join(" — ")});
      if(!p.time) add("missing-time","warn",i,beat,"Production heading has no time of day.");
    }
    if(t!==t.toUpperCase()) add("slugline-case","warn",i,beat,"Scene headings should be uppercase.");
  });
  // the dialogue grammar the writers use (screenplaySpeechLinks): a mid-speech "(beat)" between
  // two dialogue blocks of one speech is standard form, never an orphan
  const linked = screenplaySpeechLinks(blocks);
  for(let i=0;i<blocks.length;i++){
    const b=blocks[i]||{}, t=clean(b), beat=Number(b.beat);
    if(b.type==="char"){
      let j=i+1;
      if(blocks[j]&&blocks[j].type==="paren") j++;
      if(!blocks[j] || blocks[j].type!=="dia" || !clean(blocks[j]))
        add("cue-without-dialogue","error",i,beat,"Character cue is not followed by dialogue.");
    } else if(b.type==="dia"){
      if(!linked[i])
        add("orphan-dialogue","error",i,beat,"Dialogue has no character cue.");
    } else if(b.type==="paren"){
      if(!linked[i])
        add("orphan-parenthetical","error",i,beat,"Parenthetical must sit between a character cue and dialogue, or between two lines of the same speech.");
      else if(screenplayParenLine(t, speakers))
        add("dialogue-in-parenthetical","warn",i,beat,"This parenthetical appears to contain another character’s line; give it its own character cue and dialogue.");
    } else if(b.type==="action" && t){
      // on-screen text, inserts and readouts (INSERT — PHONE: …, SUPER: …, <FIELD>: <VALUE>)
      // are standard action-line devices and are NOT flagged. The warning fires on exactly
      // what the screenplay writers reject (screenplayRejectsLabel: a speaker's line, a
      // spoken voice), so a line the model just wrote never trips it; an unknown label followed
      // by a plain sentence ("MARCUS: The gate is open.") is only an INFO note to review.
      const labels = screenplayActionLabels(t, speakers);
      if(labels.some(screenplayRejectsLabel))
        add("dialogue-in-action","warn",i,beat,"This action paragraph appears to contain dialogue; use a character cue and dialogue block.");
      else {
        const u = labels.find(h=>h.kind==="unclear");
        if(u) add("check-action-label","info",i,beat,"Check “"+u.label+":” — if a character is speaking, make it a character cue and dialogue; if it is on-screen text or a readout, it is fine as written.");
      }
    }
  }
  if(blocks.length && !units.length)
    add("missing-heading","error",0,Number(blocks[0]&&blocks[0].beat),"This dramatic scene has no valid production scene heading.");
  // a rough stand-in is never "clean": its blocks can be well formed while the scene is
  // still the beat cards, not a screenplay (Story Pipeline step 7). A WARNING, so the Script
  // check button counts it and never shows green; listed first, it points at the top.
  if(isStandInDraft(screenplay))
    issues.unshift({code:"stand-in",severity:"warn",blockIndex:0,beat:Number(blocks[0]&&blocks[0].beat),
      message:"This scene is a rough stand-in built from its beat cards — it hasn’t been written yet. Press Redraft script from beats to write it."});
  const errors=issues.filter(x=>x.severity==="error").length;
  const notes=issues.filter(x=>x.severity==="info").length;
  return {issues,units,stats:{blocks:blocks.length,productionUnits:units.length,errors,warnings:issues.length-errors-notes,notes}};
}
window.screenplayFormatReport = screenplayFormatReport;

/* professional-completeness audit: which required screenplay elements is this scene
   missing? Returns a short list of human labels (empty = scene is complete). */
function sceneMissing(scene, drafts){
  const d = drafts && drafts[scene.id];
  if(!d || !d.blocks || !d.blocks.length) return ["not drafted"];
  const blocks = d.blocks;
  const out = [];
  if(!blocks.some(b=>b.type==="action" && String(b.text||"").trim())) out.push("action");
  const rep=screenplayFormatReport(scene,d,null);
  if(rep.issues.some(x=>x.code==="missing-heading"||x.code==="bad-slugline"||x.code==="empty-block"&&blocks[x.blockIndex]&&blocks[x.blockIndex].type==="scene")) out.push("scene heading");
  if(rep.issues.some(x=>x.code==="missing-time")) out.push("time of day");
  if(rep.issues.some(x=>x.code==="cue-without-dialogue"||x.code==="orphan-dialogue"||x.code==="orphan-parenthetical")) out.push("dialogue cue");
  if(rep.issues.some(x=>x.code==="dialogue-in-action")) out.push("dialogue in action");
  return out;
}
window.sceneMissing = sceneMissing;

/* CONTINUITY CHECKER — flags references with no prior setup, premature references,
   and setups (setup:true) that never pay off. */
function continuityReport(scenes, CONT, FACTS){
  const estAt = {}, refIdx = {};
  scenes.forEach((s,i)=>{ const c = CONT[s.id]||{}; (c.establishes||[]).forEach(f=>{ if(estAt[f]===undefined) estAt[f]=i; }); });
  scenes.forEach((s,i)=>{ const c = CONT[s.id]||{}; (c.references||[]).forEach(f=>{ (refIdx[f]=refIdx[f]||[]).push(i); }); });
  const conflicts = [];
  scenes.forEach((s,i)=>{ const c = CONT[s.id]||{}; (c.references||[]).forEach(f=>{
    const e = estAt[f]; const label = (FACTS[f]&&FACTS[f].label)||f;
    if(e===undefined) conflicts.push({ sceneId:s.id, sceneNo:s.no, kind:"unestablished", label, fact:f,
      msg:"leans on \u201c"+label+"\u201d, which is never set up in any earlier scene." });
    else if(e>i) conflicts.push({ sceneId:s.id, sceneNo:s.no, kind:"premature", label, fact:f,
      msg:"refers to \u201c"+label+"\u201d before it is established (set up later, in Sc."+String(scenes[e].no).padStart(2,"0")+")." });
  }); });
  Object.keys(FACTS).forEach(f=>{ if(FACTS[f].setup){ const e = estAt[f];
    if(e!==undefined){ const paid = (refIdx[f]||[]).some(j=>j>e);
      if(!paid) conflicts.push({ sceneId:scenes[e].id, sceneNo:scenes[e].no, kind:"dangling", label:FACTS[f].label, fact:f,
        msg:"sets up \u201c"+FACTS[f].label+"\u201d but nothing later pays it off." }); } } });
  return { conflicts, total: scenes.length };
}
window.continuityReport = continuityReport;

const CONFLICT_KIND = {
  unestablished:{ sev:"error", lab:"Payoff without setup", ic:"alert", fix:"Plant this earlier, or cut the reference." },
  premature:{ sev:"error", lab:"Referenced too early", ic:"alert", fix:"Move the setup before this scene." },
  dangling:{ sev:"warn", lab:"Dangling setup", ic:"scissors", fix:"Pay it off in a later scene, or cut the setup." },
};

/* ---------- view ---------- */
function isSpTransition(t){ return /^(?:CUT|DISSOLVE|SMASH CUT|MATCH CUT|FADE|WIPE|JUMP CUT)\b.*(?:TO|OUT|IN)[:.]?$/i.test(String(t).trim()); }
function ScriptBlock({ b, contd, sceneNo, flash, blockIndex }){
  let type = b.type, text = b.text;
  const fl = flash ? " spb-flash" : "";
  if(type==="action" && isSpTransition(text)){ type="trans"; text=text.toUpperCase(); }
  if(type==="char"){
    text = text.toUpperCase();
    if(contd && !/\(CONT\u2019?D\)\s*$/i.test(text)) text = text + " (CONT\u2019D)";
  }
  // shooting-script convention: the scene number flanks the slugline in both margins
  if(type==="scene" && sceneNo!=null){
    return React.createElement("div",{className:(BLOCK_CLASS.scene)+" numbered"+fl,"data-sp-block-index":blockIndex},
      React.createElement("span",{className:"spb-scnum"},sceneNo),
      React.createElement("span",{className:"spb-sctext"},text),
      React.createElement("span",{className:"spb-scnum"},sceneNo));
  }
  return React.createElement("div",{className:(BLOCK_CLASS[type]||"spb-action")+fl,"data-sp-block-index":blockIndex}, text);
}

/* the text a line holds while it is being edited (no-break spaces as spaces, no trailing
   line breaks) — what EditableBlock commits, and what a × click commits first (2026-09-28) */
function _editableText(el){ return String((el && el.innerText) || "").replace(/\u00a0/g," ").replace(/\n+$/,""); }
/* EDIT MODE keys (2026-09-28): a block keeps one key for as long as it lives, and an edited
   copy inherits it (_spInheritKey), so removing an earlier line never hands the line being
   typed in — its DOM node — to the next block. The keys were bare indexes, and the typing
   was lost. */
const _SP_BLOCK_KEYS = new WeakMap();
let _spBlockKeyN = 0;
function _spBlockKey(b){
  let k = _SP_BLOCK_KEYS.get(b);
  if(k==null){ k = "b"+(++_spBlockKeyN); _SP_BLOCK_KEYS.set(b, k); }
  return k;
}
function _spInheritKey(from, to){ if(from && to && _SP_BLOCK_KEYS.has(from)) _SP_BLOCK_KEYS.set(to, _SP_BLOCK_KEYS.get(from)); return to; }
/* `blocks` (the block list on the page) with the words of the line being typed in written
   in. A line commits on blur, and the × keeps the focus where it is, so a × click used to
   drop them (2026-09-28). The edited copy keeps its key, so the line keeps its caret. */
function _spWithPendingText(blocks){
  const ae = (typeof document!=="undefined" && document) ? document.activeElement : null;
  if(!ae || !ae.isContentEditable || typeof ae.closest!=="function" || !Array.isArray(blocks)) return blocks;
  const host = ae.closest("[data-sp-block-index]");
  const gi = host ? Number(host.getAttribute("data-sp-block-index")) : -1;
  const b = (Number.isInteger(gi) && gi>=0) ? blocks[gi] : null;
  if(!b) return blocks;
  const text = _editableText(ae);
  return text===(b.text||"") ? blocks : blocks.map((x,j)=> j===gi ? _spInheritKey(x, { ...x, text }) : x);
}
/* EDIT MODE: a single screenplay block as a directly-editable line. Uncontrolled
   contentEditable — React never manages its text (no children in the vdom), so
   re-renders mid-typing can't reset the caret; the raw text is pushed in via a ref
   effect on mount and after each committed change. Commits on blur only when changed. */
function EditableBlock({ b, onCommit, onRemove, flash, sceneNo, blockIndex }){
  const ref = React.useRef(null);
  const raw = b.text || "";
  // (compared as committed text, so words committed while the line keeps the focus — a ×
  // click — don't reset it and jump the caret over a no-break space)
  React.useEffect(()=>{ if(ref.current && _editableText(ref.current) !== raw) ref.current.innerText = raw; },[raw]);
  const cls = (BLOCK_CLASS[b.type]||"spb-action") + " sp-editable" + (flash?" spb-flash":"");
  const commit = ()=>{
    if(!ref.current) return;
    const v = _editableText(ref.current);
    if(v !== raw) onCommit(v);
  };
  // single-line block types blur on Enter; action/dialogue allow line breaks
  const oneLine = b.type==="scene" || b.type==="char" || b.type==="paren" || b.type==="trans";
  const editableProps = {
    ref, contentEditable:true, suppressContentEditableWarning:true,
    spellCheck:true, "data-ph":"…", onBlur:commit,
    onKeyDown:(e)=>{ if(oneLine && e.key==="Enter"){ e.preventDefault(); e.currentTarget.blur(); } }
  };
  // industry formatting holds while EDITING too: the first slugline keeps its
  // scene-number flanks (only the text between them stays editable)
  if(b.type==="scene" && sceneNo!=null){
    return React.createElement("div",{className:BLOCK_CLASS.scene+" numbered"+(flash?" spb-flash":""),"data-sp-block-index":blockIndex},
      React.createElement("span",{className:"spb-scnum"},sceneNo),
      React.createElement("span",{...editableProps, className:"spb-sctext sp-editable"}),
      React.createElement("span",{className:"spb-scnum"},sceneNo));
  }
  // every other element carries a remove control while editing — deleting commits
  // a version like any manual edit, so Undo restores the element
  return React.createElement("div",{className:"sp-editwrap","data-sp-block-index":blockIndex},
    React.createElement("div",{...editableProps, className:cls}),
    onRemove && React.createElement("button",{className:"sp-del-btn",
      title:"Remove this element (Undo restores it)","aria-label":"Remove this element",
      onMouseDown:(e)=>e.preventDefault(), onClick:onRemove},"×"));
}

/* EDIT MODE: insert a new screenplay element into a beat — the industry parts
   (action, character cue + line, parenthetical, mini-slugline, transition). */
function AddBlockRow({ onAdd }){
  const [open, setOpen] = React.useState(false);
  const OPTS = [
    ["action","Action"],
    ["charline","Character + line"],
    ["paren","Parenthetical"],
    ["scene","Mini-slugline"],
    ["trans","Transition"],
  ];
  return React.createElement("div",{className:"sp-addrow"},
    !open
      ? React.createElement("button",{className:"sp-add-btn",title:"Insert a screenplay element into this beat",
          onClick:()=>setOpen(true)}, "+ Add")
      : React.createElement(React.Fragment,null,
          OPTS.map(o=>React.createElement("button",{key:o[0],className:"sp-add-chip",
            onClick:()=>{ setOpen(false); onAdd(o[0]); }},o[1])),
          React.createElement("button",{className:"sp-add-chip ghost",onClick:()=>setOpen(false)},"\u00d7")));
}

/* the (CONT'D) bookkeeping the main page does, reusable for any block list */
function buildContdSet(blocks){
  const set = new Set(); let last = null;
  (blocks||[]).forEach(b=>{
    if(b.type==="char"){ const nm = String(b.text).toUpperCase().replace(/\s*\(CONT\u2019?D\)\s*$/i,"");
      if(last && nm===last) set.add(b); last = nm; }
    else if(b.type==="scene" || b.type==="trans") last = null;
  });
  return set;
}

function TransitionBar({ trans, out, fromTo }){
  if(!trans) return null;
  return React.createElement("div",{className:`sp-trans ${out?"out":""}`},
    React.createElement("span",{className:`ttype ${trans.cls}`},trans.type),
    React.createElement("span",{className:"tgloss"},trans.gloss),
    fromTo && React.createElement("span",{className:"tdir"},React.createElement(Icon.arrowSmall,{s:12}),fromTo));
}

function CarryLedger({ cells }){
  return React.createElement("div",{className:"sp-carry"},
    React.createElement("div",{className:"clab2"},React.createElement(Icon.layers,{s:11}),"Story-state carried into this scene"),
    cells.map((c,i)=>React.createElement("div",{key:i,className:"cell"},
      React.createElement("div",{className:"clab"},c.lab),
      React.createElement("div",{className:"cval"},c.node || c.val))));
}

function ContinuityReport({ report, ledger, onJump, onClose, currentId }){
  const conflicts = report.conflicts;
  const L = ledger || {};
  // the check can only see what the ledger mapped: say so instead of reporting "clean"
  const ledgerRow = L.onBuild && (!L.mapped || L.stale) && React.createElement("div",{className:"cont-ledger"},
    React.createElement("span",null, !L.mapped
      ? "This film's setups and payoffs haven't been mapped yet, so there is nothing to check. Build the continuity ledger: it reads the written scenes and lists what each one sets up and what later scenes rely on (writing credits)."
      : "The script changed since the continuity ledger was built. Rebuild it so the check reads the current scenes."),
    React.createElement("button",{className:"draft-btn sm",disabled:!!L.busy||!!L.readOnly,onClick:L.onBuild},
      React.createElement(Icon.sparkles,{s:13}), L.busy ? "Reading the film\u2026" : (L.mapped ? "Rebuild ledger" : "Build continuity ledger")));
  return React.createElement("div",{className:"cont-report"},
    React.createElement("div",{className:"cont-report-head"},
      React.createElement("div",{className:"t"},
        React.createElement(Icon.layers,{s:14}),"Continuity check"),
      React.createElement("div",{className:"sub"},
        conflicts.length ? conflicts.length+" issue"+(conflicts.length>1?"s":"")+" across "+report.total+" scenes"
          : (L.onBuild && !L.mapped) ? report.total+" scenes \u00b7 not mapped yet" : report.total+" scenes \u00b7 no conflicts"),
      React.createElement("button",{className:"ai-x",onClick:onClose},React.createElement(Icon.x,{s:14}))),
    React.createElement("div",{className:"cont-explain"},
      "Tracks what every scene ", React.createElement("b",null,"sets up"), " and ", React.createElement("b",null,"pays off"),
      ". It flags a payoff with no earlier setup, a reference that lands before its setup, or a setup that never pays off \u2014 and updates live as you reorder or edit scenes."),
    ledgerRow,
    conflicts.length===0
      ? (L.onBuild && !L.mapped) ? null : React.createElement("div",{className:"cont-clean"},
          React.createElement("span",{className:"ic"},React.createElement(Icon.check,{s:18})),
          "Every referenced fact is set up before it's used, and every setup pays off.")
      : conflicts.map((c,i)=>{
          const k = CONFLICT_KIND[c.kind];
          const IcC = Icon[k.ic] || Icon.alert;
          const here = c.sceneId===currentId;
          // reachable from the keyboard (2026-10-09)
          return React.createElement("div",{key:i,className:`cont-row ${k.sev}`,role:"button",tabIndex:0,
            onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onJump(c.sceneId); } },
            onClick:()=>onJump(c.sceneId)},
            React.createElement("span",{className:"ic"},React.createElement(IcC,{s:16})),
            React.createElement("div",{className:"body"},
              React.createElement("div",{className:"kind"},k.lab,
                React.createElement("span",{className:"sc"},"Sc."+String(c.sceneNo).padStart(2,"0"))),
              React.createElement("div",{className:"msg"},"Scene "+String(c.sceneNo).padStart(2,"0")+" "+c.msg),
              React.createElement("div",{className:"fix"},React.createElement(Icon.wand,{s:11})," ",k.fix)),
            React.createElement("span",{className:"cont-jump"},
              here ? "Viewing" : "Go to scene", React.createElement(Icon.arrowSmall,{s:13})));
        }));
}

function ScriptCheckReport({ scene, report, onClose, onIssue }){
  const issues=report.issues||[], units=report.units||[], st=report.stats||{};
  return React.createElement("div",{className:"script-check-report"},
    React.createElement("div",{className:"cont-report-head"},
      React.createElement("div",{className:"t"},React.createElement(Icon.script,{s:14}),"Script check"),
      React.createElement("div",{className:"sub"},
        (st.errors||0)+" error"+(st.errors===1?"":"s")+" · "+(st.warnings||0)+" warning"+(st.warnings===1?"":"s")),
      React.createElement("button",{className:"ai-x",onClick:onClose,title:"Close script check"},React.createElement(Icon.x,{s:14}))),
    React.createElement("div",{className:"script-check-split"},
      React.createElement("div",{className:"script-check-story"},
        React.createElement("span",{className:"script-check-kicker"},"Dramatic story scene"),
        React.createElement("b",null,"Sc."+String(scene.no).padStart(2,"0")+" · "+scene.title),
        React.createElement("span",null,"One dramatic movement in the story spine.")),
      React.createElement("div",{className:"script-check-arrow"},React.createElement(Icon.arrowSmall,{s:16})),
      React.createElement("div",{className:"script-check-units"},
        React.createElement("span",{className:"script-check-kicker"},"Production units · "+units.length),
        units.length
          ? React.createElement("div",{className:"script-check-unitlist"},units.map((u,i)=>
              React.createElement("button",{key:i,type:"button",onClick:()=>onIssue({blockIndex:u.blockIndex}),
                title:"Go to this production heading"},(i+1)+". "+u.label)))
          : React.createElement("span",{className:"script-check-none"},"No valid production headings"))),
    React.createElement("div",{className:"script-check-explain"},
      "A story scene is the dramatic unit. Every INT./EXT. heading inside it is a separate production unit for locations, scheduling and coverage."),
    issues.length===0
      ? React.createElement("div",{className:"cont-clean"},
          React.createElement("span",{className:"ic"},React.createElement(Icon.check,{s:18})),
          "The screenplay blocks are structurally clean.")
      : React.createElement("div",{className:"script-check-issues"},issues.map((x,i)=>
          React.createElement("button",{key:x.code+"-"+x.blockIndex+"-"+i,type:"button",
            className:"script-check-issue "+x.severity,onClick:()=>onIssue(x)},
            React.createElement("span",{className:"ic",style:x.severity==="info"?{color:"var(--txt-3)"}:undefined},React.createElement(x.severity==="error"?Icon.alert:Icon.info,{s:14})),
            React.createElement("span",{className:"script-check-issuebody"},
              React.createElement("b",null,x.code==="stand-in"?"Rough stand-in":x.severity==="error"?"Format error":x.severity==="info"?"Check this line":"Format note"),
              React.createElement("span",null,x.message)),
            React.createElement("span",{className:"script-check-goto"},x.code==="stand-in"?"Whole scene · Go to top":"Beat "+(Number.isFinite(x.beat)?x.beat:"—")+" · Go to line")))));
}

function ScriptView({ scene, beats, drafts, scenes, onSelectScene, onDraftOne, onDraftAll, onPolish, drafting, total,
                     history, labelOf, onRevert, onRedo, onEditScene, continuityMap, project, onBeatFocus, readOnly,
                     facts, ledgerInfo, ledgerStale, ledgerBusy, onBuildLedger,
                     staleChanges, staleCount, onRedraftStale, onKeepDraft, onRedraftAll, redraftingAll, redraftBusy,
                     getDraft, filmKey }){
  const CONT = continuityMap || (window.TURN_DATA||{}).CONTINUITY || {};
  // this film's own facts (the continuity ledger); the sample's only as a legacy fallback
  const FACTS = facts || (window.TURN_DATA||{}).FACTS || {};
  const ledger = { info:ledgerInfo, stale:ledgerStale, busy:ledgerBusy, onBuild:onBuildLedger,
    mapped:Object.keys(FACTS).length>0, readOnly };
  const live = typeof aiAvailable==="function" && aiAvailable();
  const [activeBeat, setActiveBeat] = React.useState(null);
  const [showReport, setShowReport] = React.useState(false);
  const [showScriptCheck, setShowScriptCheck] = React.useState(false);
  const [polishing, setPolishing] = React.useState(false);
  const [polishWait, setPolishWait] = React.useState(false);
  const [justPolished, setJustPolished] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [beatWriting, setBeatWriting] = React.useState(null);   // beat # being AI-written into a gap
  // Undo/Redo flash — the Set of blocks (of the version being restored) that DIFFER
  // from what's on screen, so the user sees exactly what the undo changed.
  const [verFlash, setVerFlash] = React.useState(null);
  const verFlashTimer = React.useRef(null);
  // 2026-09-28: the NEWEST props, for work that lands after an await ('Write this beat'). By
  // then the click-time `drafts` / `onEditScene` can be stale: an edit, Undo or a redraft made
  // meanwhile, or another film opened. getDraft(id) / filmKey() (app.jsx, optional) read the
  // app's live state; liveRef.closed is set once this view is gone and gets no new props.
  const liveRef = React.useRef(null);
  liveRef.current = { drafts, onEditScene, getDraft, filmKey, sceneId:scene ? scene.id : null };
  React.useEffect(()=>{ liveRef.closed = false; return ()=>{ liveRef.closed = true; }; },[]);
  React.useEffect(()=>{ setActiveBeat(null); setShowScriptCheck(false); setPolishing(false); setPolishWait(false); setJustPolished(false); setEditing(false); setVerFlash(null); setBeatWriting(null); },[scene && scene.id]);
  React.useEffect(()=>{ if(readOnly) setEditing(false); },[readOnly]);
  // once the restored version renders, bring the first changed block into view if it's
  // off-screen (essential on mobile, where the change is usually below the fold)
  React.useEffect(()=>{
    if(!verFlash) return;
    const t = setTimeout(()=>{
      const el = document.querySelector(".spb-flash");
      if(!el) return;
      const r = el.getBoundingClientRect();
      if(r.top < 0 || r.bottom > (window.innerHeight||document.documentElement.clientHeight))
        el.scrollIntoView({ behavior:"smooth", block:"center" });
    }, 80);
    return ()=>clearTimeout(t);
  },[verFlash]);

  if(!scene) return React.createElement("div",{className:"script-scroll"},
    React.createElement("div",{className:"script-empty"},
      React.createElement("div",{className:"ico"},React.createElement(Icon.script,{s:26})),
      React.createElement("h3",null,"Select a scene"),
      React.createElement("p",null,"Pick a scene from the spine or the story panel to draft its screenplay.")));

  const orderedScenes=(typeof scenesInStoryOrder==="function")?scenesInStoryOrder(scenes):scenes;
  const idx = orderedScenes.findIndex(s=>s.id===scene.id);
  const prevScene = orderedScenes[idx-1] || null;
  const nextScene = orderedScenes[idx+1] || null;
  const screenplay = drafts[scene.id];
  const draftedCount = orderedScenes.filter(s=>drafts[s.id]).length;
  const go = (d, e)=>{ if(e && e.stopPropagation) e.stopPropagation(); const n = orderedScenes[idx+d]; if(n) onSelectScene(n.id); };

  const transIn = sceneTransition(prevScene, scene, project);
  const transOut = nextScene ? sceneTransition(scene, nextScene, project) : null;
  const carry = sceneCarry(prevScene, scene, project);

  const report = continuityReport(orderedScenes, CONT, FACTS);
  const sceneConflicts = report.conflicts.filter(c=>c.sceneId===scene.id);
  const scriptCheck = screenplayFormatReport(scene, screenplay, beats);
  const jumpToScriptIssue = (issue)=>{
    const el=document.querySelector('[data-sp-block-index="'+issue.blockIndex+'"]');
    if(!el) return;
    el.scrollIntoView({behavior:"smooth",block:"center"});
    el.classList.remove("spb-check-flash"); void el.offsetWidth; el.classList.add("spb-check-flash");
    setTimeout(()=>el.classList.remove("spb-check-flash"),2200);
  };

  // ---- auto-draft control / progress ----
  let control = null;
  if(drafting){
    const pct = Math.round((drafting.i/total)*100);
    const now = orderedScenes[Math.min(drafting.i, total-1)];
    control = React.createElement("div",{className:"draft-prog"},
      React.createElement("div",{className:"orb"}),
      React.createElement("div",null,
        React.createElement("div",{className:"lbl"},`Drafting Sc.${String(now?now.no:total).padStart(2,"0")} \u00b7 threading continuity\u2026`),
        React.createElement("div",{className:"bar"},React.createElement("i",{style:{width:pct+"%"}}))));
  } else if(draftedCount < total){
    control = React.createElement("button",{className:"draft-btn sm",onClick:onDraftAll,disabled:readOnly||!!drafting,
      title:readOnly?"View-only access":"Draft every undrafted scene \u2014 asks first (writing credits)"},
      React.createElement(Icon.sparkles,{s:14}),`Auto-draft all (${total-draftedCount} left)`);
  }

  // continuity button
  // an unmapped film has nothing to check — never show it as a green "clean"
  const unmapped = !!ledger.onBuild && !ledger.mapped;
  const contBtn = React.createElement("button",{
    className:`cont-btn ${report.conflicts.length?"warn":unmapped?"":"ok"}`,onClick:()=>setShowReport(v=>!v),
    title:unmapped?"Setups and payoffs aren't mapped for this film yet":undefined},
    React.createElement(report.conflicts.length||unmapped?Icon.alert:Icon.check,{s:14}),
    report.conflicts.length ? `Continuity \u00b7 ${report.conflicts.length}` : unmapped ? "Continuity \u00b7 not mapped" : (ledger.stale ? "Continuity \u00b7 stale" : "Continuity"));
  // the badge counts real problems only; "Check this line" notes are listed inside
  const scriptCheckCount = scriptCheck.issues.filter(x=>x.severity!=="info").length;
  const scriptCheckBtn = screenplay && React.createElement("button",{
    className:`cont-btn ${scriptCheckCount?"warn":"ok"}`,onClick:()=>setShowScriptCheck(v=>!v)},
    React.createElement(scriptCheckCount?Icon.alert:Icon.check,{s:14}),
    scriptCheckCount ? `Script check · ${scriptCheckCount}` : "Script check");


  // ---- screenplay present: render the STORED draft directly (no blend) ----
  let body = null, polishUI = null, versionUI = null;
  const hb = history || {back:[],fwd:[]};
  if(screenplay){
    const groupByBeat = (blocks)=>{ const m={}, order=[]; blocks.forEach(b=>{ if(!m[b.beat]){m[b.beat]=[];order.push(b.beat);} m[b.beat].push(b); }); return {m,order}; };
    const { m:fg } = groupByBeat(screenplay.blocks);
    // shooting-script numbering: only the scene's OPENING slugline carries the number —
    // secondary (mid-scene) sluglines render as plain headings
    const firstSlugBlock = screenplay.blocks.find(b=>b.type==="scene");
    const order = screenplayBeatNumbers(screenplay, beats);
    // mark a character cue as (CONT'D) when the same speaker returns after intervening action
    const contdSet = buildContdSet(screenplay.blocks);

    // Polish: generate a NEW version (old one is pushed to history by commitVersion)
    const runPolish = async ()=>{
      if(readOnly || polishing || !live) return;
      setPolishing(true); setPolishWait(true); setJustPolished(false);
      let ok = false;
      // onPolish (app.jsx polishScene) explains its own failures in a toast; an unexpected
      // throw is still never silent
      if(onPolish){ try{ ok = await onPolish(scene, beats); }catch(e){
        if(window.appToast) window.appToast("Couldn\u2019t redraft Scene "+scene.no+" \u2014 something went wrong. Your current draft is unchanged; press Redraft again.","error", { force:true });
      } }
      setPolishWait(false); setPolishing(false);
      if(ok){ setJustPolished(true); setTimeout(()=>setJustPolished(false), 1400); }
    };
    // ONE name for one lever (user ruling 2026-07-13): this is the same engine as
    // the Beats tab's button — the scene rebuilt from its CURRENT beats — so it
    // carries the same label here. The centered overlay mirrors the Beats tab's.
    if(live) polishUI = React.createElement(React.Fragment,null,
      React.createElement("button",
        // always the accent style — the primary action must read consistently orange
        // whether or not the current draft is already polished (user ruling 2026-07-19)
        {className:"draft-btn sm",onClick:runPolish,disabled:readOnly||polishing,
         title:"Rewrite this scene's screenplay from its CURRENT beat cards (one writing call, writing credits) — the previous draft stays in version history (Undo restores it)"},
        React.createElement(Icon.wand,{s:14}),
        polishWait ? "Redrafting\u2026"
          // full label on desktop; CSS shortens the middle word out at <=400px
          : React.createElement(React.Fragment,null,"Redraft ",
              React.createElement("span",{className:"redraft-long"},"script "),"from beats")));

    // undo / redo — one linear history of the scene's screenplay states (manual edits,
    // AI polishes and drafts all push onto the same stack). Appears once there's history.
    // Before swapping versions, diff the incoming blocks against what's on screen and
    // FLASH the changed ones (the version's block objects become the rendered ones, so
    // identity survives the swap), scrolling the first change into view if off-screen.
    const flashDiff = (target)=>{
      if(!target || !Array.isArray(target.blocks)) return;
      const cur = (screenplay && screenplay.blocks) || [];
      const nxt = target.blocks;
      const changed = new Set();
      for(let i=0; i<Math.max(cur.length, nxt.length); i++){
        const a=cur[i], b=nxt[i];
        if(!b){ if(nxt.length) changed.add(nxt[nxt.length-1]); break; }   // lines removed at the end — mark the new last block
        if(!a || a.text!==b.text || a.type!==b.type) changed.add(b);
      }
      if(!changed.size) return;
      setVerFlash(changed);
      clearTimeout(verFlashTimer.current);
      verFlashTimer.current = setTimeout(()=>setVerFlash(null), 2600);
    };
    if(hb.back.length || hb.fwd.length){
      // the version's engine rides its Undo/Redo tooltip too ("AI draft · Kimi K3")
      const labelWithBy = (v)=>{ const l=labelOf(v); return (v && !v.edited && v.by && v.by.model) ? l+" · "+v.by.model : l; };
      const prevLabel = hb.back.length ? labelWithBy(hb.back[hb.back.length-1]) : null;
      const nextLabel = hb.fwd.length ? labelWithBy(hb.fwd[0]) : null;
      versionUI = React.createElement("div",{className:"ver-ctl"},
        React.createElement("button",{className:"ver-btn",disabled:readOnly||!hb.back.length||polishing,
          title: prevLabel?("Undo — back to "+prevLabel):"Nothing to undo",
          onClick:()=>{ if(polishing) return; flashDiff(hb.back[hb.back.length-1]); onRevert(scene.id); }},
          React.createElement(Icon.undo,{s:13}), "Undo"),
        React.createElement("button",{className:"ver-btn",disabled:readOnly||!hb.fwd.length||polishing,
          title: nextLabel?("Redo — forward to "+nextLabel):"Nothing to redo",
          onClick:()=>{ if(polishing) return; flashDiff(hb.fwd[0]); onRedo(scene.id); }},
          React.createElement(Icon.redo,{s:13}), "Redo"));
    }

    // edit-mode keys (_spBlockKey): stable per block; a repeat in one list gets a suffix
    const usedKeys = new Set();
    const editKey = (b)=>{ let k = _spBlockKey(b); if(usedKeys.has(k)) k = k+"~"+usedKeys.size; usedKeys.add(k); return k; };

    // EDIT: rewrite one block's raw text and commit it as a new version (so Undo/Redo
    // covers manual edits too). Matches the block by identity in the canonical block list.
    const commitEdit = (b, newText)=>{
      if(!onEditScene) return;
      let gi = screenplay.blocks.indexOf(b);
      // the block was replaced meanwhile (a new version arrived): find it again by its key, then by its
      // type and old text; if it's really gone, say so instead of dropping the words (2026-10-09)
      if(gi<0){ const k = _spBlockKey(b);
        gi = screenplay.blocks.findIndex(x=>x && _spBlockKey(x)===k);
        if(gi<0) gi = screenplay.blocks.findIndex(x=>x && x.type===b.type && String(x.text||"")===String(b.text||"")); }
      if(gi<0){ if(typeof window.appToast==="function") window.appToast("That line changed while you were editing it, so your edit wasn't applied \u2014 here's what you typed: \u201c"+String(newText||"").slice(0,140)+"\u201d","error",{ force:true }); return; }
      const nextBlocks = screenplay.blocks.map((x,j)=> j===gi ? _spInheritKey(x, {...x, text:newText}) : x);
      onEditScene(scene.id, keepStandInMark(screenplay, { ...screenplay, blocks:nextBlocks, edited:true, polished:false, ai:false, auto:false, by:null }));
    };

    // EDIT MODE: remove one element outright (the direct undo for an added box).
    // Commits as a version like any edit, so Undo brings it back. A line still being typed
    // in keeps its words: they are committed in the same version (2026-09-28).
    const removeBlock = (b)=>{
      if(!onEditScene) return;
      const gi = screenplay.blocks.indexOf(b);
      if(gi<0) return;
      const blocks = _spWithPendingText(screenplay.blocks).filter((x,j)=> j!==gi);
      onEditScene(scene.id, keepStandInMark(screenplay, { ...screenplay, blocks, edited:true, polished:false, ai:false, auto:false, by:null }));
    };

    // EDIT MODE: insert new element(s) at the END of a beat's blocks. "charline"
    // = a character cue plus an empty dialogue line in one press.
    const insertBlock = (beatN, kind)=>{
      if(!onEditScene) return;
      const blocks = _spWithPendingText(screenplay.blocks).slice();
      let at = -1;
      for(let j=0;j<blocks.length;j++){ if((blocks[j].beat||1)===beatN) at = j; }
      if(at<0){ for(let j=0;j<blocks.length;j++){ if((blocks[j].beat||1)<beatN) at = j; } }
      const fresh = kind==="charline"
        ? [ { beat:beatN, type:"char", text:"" }, { beat:beatN, type:"dia", text:"" } ]
        : [ { beat:beatN, type:kind, text:"" } ];
      blocks.splice(at+1, 0, ...fresh);
      onEditScene(scene.id, keepStandInMark(screenplay, { ...screenplay, blocks, edited:true, polished:false, ai:false, auto:false, by:null }));
    };
    const beatRow = (n)=> beats && beats.rows.find(r=>r.n===n);
    // WRITE A MISSING BEAT: the map defines beat N but no screenplay block dramatizes it.
    // One click AI-writes just that beat's prose (neighbouring text as read-only context),
    // splices it in beat order and commits a NEW version (Undo restores the gap).
    // 2026-09-28: the beat lands in the scene's LATEST script (liveRef), not the one on screen
    // at the click, so edits, Undo or a redraft made while the model wrote survive; it is dropped,
    // with a message, if another film is open now or the gap has been filled meanwhile.
    const writeMissingBeat = async (n)=>{
      if(readOnly || beatWriting || !live || !onEditScene) return;
      setBeatWriting(n);
      const report = {};
      const sid = scene.id, sno = scene.no;
      const filmAtClick = typeof filmKey==="function" ? filmKey() : null;
      const say = (m)=>{ if(window.appToast) window.appToast(m, "error", { force:true }); };
      try{
        const res = (typeof aiWriteBeatText==="function") ? await aiWriteBeatText(scene, beats, n, screenplay, prevScene, project, report) : null;
        if(res && res.blocks && res.blocks.length){
          // (liveRef is optional: the handler tests run this without the view)
          const LR = typeof liveRef==="object" && liveRef ? liveRef : { current:null };
          const L = LR.current || {};
          // another film is open now — its scene with this id is a different scene
          if(typeof L.filmKey==="function" && L.filmKey()!==filmAtClick){
            say("Beat "+n+" of Scene "+sno+" was finished after you switched films, so it wasn\u2019t added \u2014 nothing changed in either film. Go back to that film and press Write this beat again.");
            return;
          }
          const seen = L.drafts ? L.drafts[sid] : screenplay;
          const latest = typeof L.getDraft==="function" ? L.getDraft(sid) : seen;
          // the Script view closed meanwhile: its last props can be out of date, so only a
          // scene the app confirms untouched since then is safe to write into
          if(LR.closed && (typeof L.getDraft!=="function" || latest!==seen)){
            say("Beat "+n+" of Scene "+sno+" wasn\u2019t added: the Script view closed while it was being written, so the scene\u2019s latest text couldn\u2019t be checked. The script is unchanged \u2014 open the scene and press Write this beat again.");
            return;
          }
          if(!latest || !Array.isArray(latest.blocks)){
            say("Scene "+sno+" no longer has a script, so beat "+n+" wasn\u2019t added.");
            return;
          }
          // the gap was filled meanwhile (an edit, Undo or a redraft): never write over it
          const beatWords = (d)=>(d.blocks||[]).filter(b=>String(b.beat)===String(n)).map(b=>String(b.text||"").trim()).filter(Boolean).join("\n");
          if(beatWords(latest)!==beatWords(screenplay)){
            say("Beat "+n+" of Scene "+sno+" already has text now, so the new version wasn\u2019t added. Your script is unchanged.");
            return;
          }
          const blocks = latest.blocks.slice();
          let at = -1;   // after the last block belonging to an EARLIER beat (slug rides as beat 1)
          for(let j=0;j<blocks.length;j++){ if((Number(blocks[j].beat)||1) < n) at = j; }
          blocks.splice(at+1, 0, ...res.blocks);
          const commit = L.onEditScene || onEditScene;
          const ok = commit(sid, keepStandInMark(latest, { ...latest, blocks, ai:true, auto:false, edited:false, by:res.by||null }));
          if(ok!==false && !LR.closed){
            setVerFlash(new Set(res.blocks));
            clearTimeout(verFlashTimer.current);
            verFlashTimer.current = setTimeout(()=>setVerFlash(null), 2600);
          }
        } else if(window.appToast) window.appToast(report.failure && typeof window.screenplayFailureMessage==="function"
          ? window.screenplayFailureMessage("write beat "+n+" of", scene.no, report.failure, { kept:"The script is unchanged." })
          : "Couldn't write this beat — try again.","error", { force:true });
      } finally {
        // another scene may be open, with a beat of its own being written: leave its spinner
        const LR = typeof liveRef==="object" && liveRef ? liveRef : { current:null };
        if(!LR.closed && (!LR.current || LR.current.sceneId===sid)) setBeatWriting(null);
      }
    };
    body = React.createElement(React.Fragment,null,
      polishWait && React.createElement("div",{className:"polish-note"},
        React.createElement(Icon.wand,{s:12}),"Rewriting the prose\u2026 beats stay locked, only the words change."),
      React.createElement("div",{className:`script-body ${justPolished?"just-polished":""} ${editing?"editing":""}`,onMouseLeave:()=>!editing&&setActiveBeat(null)},
        order.map(n=>{
          const r = beatRow(n);
          const scriptBeat = screenplayBeatExcerpt(screenplay, n, 88);
          const missingScript = !!r && !scriptBeat;
          const on = activeBeat===n;
          return React.createElement("div",{key:n,className:`sp-seg ${on?"on":""} ${missingScript?"missing-script":""}`},
            React.createElement("div",{className:`sp-gut ${on?"on":""}`,
              title:(r ? ((r.drive&&r.drive.a)||("Beat "+n))+" / "+((r.react&&r.react.a)||"Reaction")+"\n" : "")+
                (scriptBeat ? ("Screenplay: "+scriptBeat) : "No screenplay text is assigned to this beat"),
              onMouseEnter:()=>setActiveBeat(n),role:"button",tabIndex:0,"aria-label":"Beat "+n+(scriptBeat?"":" \u2014 no screenplay text yet"),
              onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); setActiveBeat(n); onBeatFocus && onBeatFocus(n); } },
              onClick:()=>{ setActiveBeat(n); onBeatFocus && onBeatFocus(n); }},
              React.createElement("div",{className:"bnum"},n),
              React.createElement("div",{className:"blab"}, r ? r.drive.a : "Unmapped beat")),
            React.createElement("div",{className:"sp-page"},
              React.createElement("div",{className:"sp-page-inner"},
                (fg[n]||[]).length
                  ? (fg[n]||[]).map((b,i)=> editing
                  ? React.createElement(EditableBlock,{key:editKey(b),b,blockIndex:screenplay.blocks.indexOf(b),onCommit:(t)=>commitEdit(b,t),onRemove:()=>removeBlock(b),sceneNo:(b===firstSlugBlock?scene.no:null),flash:!!(verFlash&&verFlash.has(b))})
                  : React.createElement(ScriptBlock,{key:i,b,blockIndex:screenplay.blocks.indexOf(b),contd:contdSet.has(b),sceneNo:(b===firstSlugBlock?scene.no:null),flash:!!(verFlash&&verFlash.has(b))}))
                  : React.createElement("div",{className:"spb-missing-wrap"},
                      React.createElement("div",{className:"spb-action spb-missing"},"No screenplay text assigned to this beat."),
                      // one-click gap fix — only when the beat map defines this beat and a writing model is live
                      r && live && onEditScene && React.createElement("button",{className:"spb-write-btn",
                        disabled: readOnly||beatWriting!=null,
                        title:"Writes JUST this beat's prose from its beat-map action/reaction ("+((r.drive&&r.drive.a)||"Action")+" / "+((r.react&&r.react.a)||"Reaction")+"), bridging the surrounding text — committed as a new version, Undo restores the gap (one writing call, writing credits).",
                        onClick:()=>writeMissingBeat(n)},
                        beatWriting===n
                          ? React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin"}),"Writing beat "+n+"…")
                          : React.createElement(React.Fragment,null,React.createElement(Icon.sparkles,{s:12}),"Write this beat from the beat map"))),
                 editing && !readOnly && React.createElement(AddBlockRow,{onAdd:(kind)=>insertBlock(n, kind)}))));
        })),
      transOut && React.createElement(TransitionBar,{trans:transOut,out:true,
        fromTo:`to Sc.${String(nextScene.no).padStart(2,"0")} ${nextScene.title}`}));
  }

  // EDIT toggle — only when there's a draft to edit and the parent supports committing
  const editBtn = (screenplay && onEditScene) ? React.createElement("button",
    { className:`draft-btn sm ${editing?"":"ghost"}`, onClick:()=>setEditing(e=>!e), disabled:readOnly||polishing,
      title: editing?"Finish editing the screenplay":"Edit the screenplay text directly" },
    React.createElement(editing?Icon.check:Icon.pencil,{s:14}),
    editing ? "Done editing" : "Edit") : null;

  // several scenes out of date: redraft them all from the header. Declared BEFORE `header`,
  // which renders it (2026-09-28: it sat below, so the lowered `var` was still undefined when
  // the header was built and the button never appeared; native const would throw).
  const redraftAllBtn = (staleCount>1 && onRedraftAll) ? React.createElement("button",{className:"cont-btn stale",
      disabled:readOnly||!!redraftingAll,onClick:onRedraftAll,title:"Rewrite every out-of-date script from its current card and beats"},
    React.createElement(Icon.history,{s:14}),
    redraftingAll ? ("Redrafting "+redraftingAll.i+" / "+redraftingAll.total) : ("Redraft "+staleCount+" out-of-date")) : null;
  const missing = (typeof sceneMissing==="function") ? sceneMissing(scene, drafts) : [];
  const header = React.createElement("div",{className:"script-head"},
    React.createElement("div",{className:"meta"},
      React.createElement("div",{className:"script-title-row"},
        React.createElement("div",{className:"script-title"},scene.title)),
      // STATUS LINE — a real warning and a neutral note sit on one row rather than
      // stacking as two competing pills; see styles.css for why the note is quiet.
      (screenplay && missing.length>0) && React.createElement("div",{className:"script-status"},
        React.createElement("div",{className:"script-missing"},React.createElement(Icon.alert,{s:12}),
          "Missing: "+missing.join(", ")))),
    // two groups so mobile can stack them as two lines with the SAME desktop look:
    // A = the housed glued strip (Continuity/Undo/Redo/Edit), B = Redraft + pager.
    // "Redraft N out-of-date" is its own housed strip between them (2026-09-28): inside A it pushed
    // Edit (and Undo/Redo) out of a phone's sideways-scrolling strip; on its own it takes its own
    // line on a phone and wraps with the others in a narrow column.
    React.createElement("div",{className:"script-tools"},
      React.createElement("div",{className:"st-group a"}, contBtn, scriptCheckBtn, versionUI, editBtn),
      redraftAllBtn && React.createElement("div",{className:"st-group r"}, redraftAllBtn),
      React.createElement("div",{className:"st-group b"}, polishUI, control,
        React.createElement("div",{className:"script-scenestep",title:"Step through the screenplay scene by scene"},
          React.createElement("button",{className:"panel-collapse",onClick:(e)=>go(-1,e),disabled:idx<=0,
            title:"Previous scene",style:{opacity:idx<=0?.4:1}},React.createElement(Icon.chevL,{s:14})),
          `Scene ${idx+1} / ${scenes.length}`,
          React.createElement("button",{className:"panel-collapse",onClick:(e)=>go(1,e),disabled:idx>=scenes.length-1,
            title:"Next scene",style:{opacity:idx>=scenes.length-1?.4:1}},React.createElement(Icon.chevR,{s:14}))))));

  // NEEDS REDRAFT: this scene's card changed after its script was written
  const staleFlag = (screenplay && staleChanges && staleChanges.length) ? React.createElement("div",
    {className:"cont-inline stale-inline",role:"status"},
    React.createElement("span",{className:"ic"},React.createElement(Icon.history,{s:15})),
    React.createElement("div",{className:"tx"},
      React.createElement("b",null,"Script out of date: "),
      "the scene card changed after this draft (",staleChanges.join(", "),"). The screenplay may no longer match it."),
    React.createElement("div",{className:"stale-acts"},
      React.createElement("button",{className:"draft-btn sm",disabled:readOnly||!!redraftBusy,onClick:()=>onRedraftStale&&onRedraftStale(scene)},
        React.createElement(Icon.sparkles,{s:13}), redraftBusy ? "Redrafting\u2026" : "Redraft script"),
      React.createElement("button",{className:"draft-btn sm ghost",disabled:readOnly||!!redraftBusy,onClick:()=>onKeepDraft&&onKeepDraft(scene.id),
        title:"The script is fine as written \u2014 adopt the current card as its baseline"},"Keep this draft"))) : null;
  // ROUGH STAND-IN (Story Pipeline step 7): a plain marker in words, not a provenance badge —
  // the scene is still its beat cards, so say so with the one action that writes it
  const standInFlag = isStandInDraft(screenplay) ? React.createElement("div",
    {className:"cont-inline standin-inline",role:"status","data-standin":"1"},
    React.createElement("span",{className:"ic"},React.createElement(Icon.alert,{s:15})),
    React.createElement("div",{className:"tx"},
      React.createElement("b",null,"Rough stand-in: "),
      "built from the beat cards — this scene hasn’t been written yet. ",
      live ? "Press Redraft script from beats to write it."
           : "Once a writing model is available, Redraft script from beats writes it.")) : null;
  // LONG FOR THIS FORMAT (docs/Story Pipeline.md step 5, owner-approved 2026-09-27): the same
  // free check as the scene card (no model call) — the draft's estimated screen time against
  // the scene's budget (the format's runtime ÷ the scene count). Nothing is rewritten.
  const lengthInfo = scriptLengthInfo(scene, screenplay, beats, project, orderedScenes.length);
  const longFlag = (lengthInfo && lengthInfo.long) ? React.createElement("div",
    {className:"cont-inline warn long-inline",role:"status","data-long":"1"},
    React.createElement("span",{className:"ic"},React.createElement(Icon.clock,{s:15})),
    React.createElement("div",{className:"tx"},
      React.createElement("b",null,"Long for this format: "),
      "about "+fmtClock(lengthInfo.sec)+" of screen time against a budget of about "+fmtClock(lengthInfo.budget.sec)+
      " ("+budgetPhrase(lengthInfo.budget)+"). Nothing is rewritten automatically — trim it with Edit, or reshape the beats and press Redraft script from beats, which writes to the budget.")) : null;

  // inline per-scene continuity flag
  const inlineFlag = sceneConflicts.length ? React.createElement("div",
    {className:`cont-inline ${sceneConflicts.every(c=>CONFLICT_KIND[c.kind].sev==="warn")?"warn":""}`},
    React.createElement("span",{className:"ic"},React.createElement(Icon.alert,{s:15})),
    React.createElement("div",{className:"tx"},
      React.createElement("b",null,"Continuity: "),
      sceneConflicts.map(c=>c.msg).join("  \u00b7  "))) : null;

  // empty state (undrafted)
  if(!screenplay){
    return React.createElement("div",{className:"script-scroll"},
      header,
      showReport && React.createElement(ContinuityReport,{report,ledger,currentId:scene.id,onJump:(id)=>onSelectScene(id),onClose:()=>setShowReport(false)}),
      showScriptCheck && screenplay && React.createElement(ScriptCheckReport,{scene,report:scriptCheck,onClose:()=>setShowScriptCheck(false),onIssue:jumpToScriptIssue}),
      React.createElement(TransitionBar,{trans:transIn,fromTo:prevScene?`from Sc.${String(prevScene.no).padStart(2,"0")}`:null}),
      React.createElement(CarryLedger,{cells:carry}),
      React.createElement("div",{className:"script-empty"},
        React.createElement("div",{className:"ico"},React.createElement(Icon.wand,{s:26})),
        React.createElement("h3",null,"Not drafted yet"),
        React.createElement("p",null, beats
          ? `This scene's ${beats.rows.length} beats are mapped. ${live?"Draft expands them into original prose, threading":"Expanding them inherits"} the story-state above.`
          : "Map this scene into beats first, then it can be expanded into screenplay."),
        React.createElement("div",{style:{display:"flex",gap:10,justifyContent:"center"}},
          // disabled while any draft runs — the keyboard could start a second paid one behind the overlay (2026-10-09)
          React.createElement("button",{className:"draft-btn",disabled:readOnly||!!drafting,onClick:()=>onDraftOne(scene),
            title:"Write this scene's screenplay"+(beats?"":" (its beats first)")+" (writing credits)"},
            React.createElement(Icon.wand,{s:15}),live?"Draft":"Draft this scene"),
          React.createElement("button",{className:"draft-btn ghost",disabled:readOnly||!!drafting,onClick:onDraftAll,
            title:"Draft every undrafted scene \u2014 asks first (writing credits)"},
            React.createElement(Icon.sparkles,{s:15}),"Auto-draft all"))));
  }

  return React.createElement("div",{className:"script-scroll"},
    header,
    showReport && React.createElement(ContinuityReport,{report,ledger,currentId:scene.id,onJump:(id)=>onSelectScene(id),onClose:()=>setShowReport(false)}),
    showScriptCheck && React.createElement(ScriptCheckReport,{scene,report:scriptCheck,onClose:()=>setShowScriptCheck(false),onIssue:jumpToScriptIssue}),
    standInFlag,
    staleFlag,
    longFlag,
    inlineFlag,
    React.createElement(TransitionBar,{trans:transIn,fromTo:prevScene?`from Sc.${String(prevScene.no).padStart(2,"0")} ${prevScene.title}`:null}),
    React.createElement(CarryLedger,{cells:carry}),
    body);
}
window.ScriptView = ScriptView;
