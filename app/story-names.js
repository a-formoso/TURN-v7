/* THE NAMES A STORY BUILD GIVES PEOPLE (owner 2026-11-12, Writers' Room audit B5 and B6).

   B6 — a name becomes an id. A character's id is made from their name. It used to keep only the letters a-z, so
   "Inês" became "ins" and a name in another script became nothing at all (every such driver was "lead").
   Now accents are folded to their plain letter ("ines"), and a name with no Latin letters gets a short stable id
   of its own. Ids stay plain a-z / 0-9: they are used in storage keys.

   B5 — the same names kept coming back. Asked for "distinctive" names, the writing engine reaches for the same few
   every time (in the audit: "Teodor" in 12 of 24 scene lists). A list of banned names only moves the habit to the
   next favourite. So the app hands the engine something it cannot repeat: initials drawn at random here, a
   different draw for every call, plus the names this writer's other films on this device already use.

   Nothing here renames a person the writer named, and stored films are never changed. */
(function(root){
  "use strict";

  var FOLD = { "\u00df":"ss", "\u00e6":"ae", "\u0153":"oe", "\u00f8":"o", "\u0111":"d", "\u00f0":"d", "\u00fe":"th",
               "\u0142":"l", "\u0131":"i", "\u0127":"h", "\u014b":"n" };
  var FOLD_RE = /[\u00df\u00e6\u0153\u00f8\u0111\u00f0\u00fe\u0142\u0131\u0127\u014b]/g;
  var NOT_WORD = /[^\p{L}\p{N}\p{M}]+/gu;

  /* lower case, accents folded to the plain letter: "Inês" → "ines", "Søren" → "soren", "Łukasz" → "lukasz" */
  function fold(s){
    return String(s==null ? "" : s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
      .replace(FOLD_RE, function(ch){ return FOLD[ch] || ch; });
  }
  /* a comparison key for two spellings of one name ("INÊS" and "Inês Duarte" share their first word); letters of
     every script are kept, so two different names never both come out empty */
  function key(s){ return fold(s).replace(NOT_WORD," ").trim(); }

  /* a short code in plain letters only, so an id made from it reads back as itself */
  function hashLetters(s){
    var h = 0x811c9dc5;
    for(var i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    var out = "";
    for(var k=0;k<7;k++){ out += String.fromCharCode(97 + (h % 26)); h = Math.floor(h/26); }
    return out;
  }
  /* the id a name gets: plain a-z, at most `max` letters; a name with no Latin letters gets "n" + a short code in letters that
     is the same every time for the same name; "" only when there is no name at all */
  function id(raw, max){
    var f = fold(raw), n = max || 12;
    var latin = f.replace(/[^a-z]/g,"").slice(0,n);
    if(latin) return latin;
    var other = f.replace(NOT_WORD,"");
    return other ? ("n"+hashLetters(other)).slice(0,n) : "";
  }
  /* true when the id alone can no longer show the name ("ines" for Inês, a code for a name in another script) */
  function idLosesName(raw){
    var plain = String(raw==null ? "" : raw).trim().toLowerCase().replace(/\s+/g,"");
    return !!plain && plain!==id(raw, 99);
  }
  /* "inês" → "Inês", "o'neill" → "O'Neill" is not attempted: only the first letter of each word is raised */
  function display(raw){
    return String(raw==null ? "" : raw).trim().replace(/[_]+/g," ").replace(/\s+/g," ").split(" ")
      .map(function(w){ return w ? w.charAt(0).toLocaleUpperCase()+w.slice(1) : w; }).join(" ").slice(0,40);
  }

  /* ---- B5: initials drawn here, not chosen by the engine ---- */
  // Only initials that are common in most of the world's naming traditions. Seen live (2026-11-12): given I, O, W, Y
  // or Z the engine moved the story to a place where such names are usual (a baker's story went to Istanbul for
  // "Y, K, I, Z"; W, Z and K together made five leads of eight Polish). The place must come from the story.
  var LETTERS = "AABBCCDDEEFFGGHHJJKKLLMMNNPPRRSSTTV";
  function draw(n, rnd){
    var r = typeof rnd==="function" ? rnd : Math.random, pool = LETTERS.split(""), out = [];
    while(out.length<n && pool.length){
      var ch = pool[Math.floor(r()*pool.length) % pool.length];
      out.push(ch);
      pool = pool.filter(function(x){ return x!==ch; });
    }
    return out;
  }

  // the engine's habits, seen live or long known; kept short on purpose — the drawn initials do the real work
  var OVERUSED = ["Teodor","Odile","Priya","Elara","Lyra","Kael","Kai","Mira","Maya","Lena","Elias","Marcus","Sarah",
    "Alex","Jack","Sam","Elena","Amara","Zara","Aria",
    "Reid","Chen","Walker","Cole","Hayes","Stone","Vance","Kane","Thorne","Voss","Marlowe"];

  var RECENT_MAX = 48, RECENT_SHOWN = 24;
  // words of a cast entry that are not a name ("The Clerk", "Old Man", "Jan van der Berg")
  var NOT_A_NAME = { the:1, and:1, old:1, young:1, man:1, woman:1, boy:1, girl:1, van:1, von:1, der:1, den:1, del:1, dos:1, das:1, bin:1, ibn:1 };
  function recentKey(){ return "turn-recent-names:"+String((root && (root.turnUserId || root.turnUserEmail)) || "local"); }
  function store(){ try{ return (root && root.localStorage) || null; }catch(e){ return null; } }
  function recent(){
    try{
      var s = store(); if(!s) return [];
      var list = JSON.parse(s.getItem(recentKey()) || "[]");
      return Array.isArray(list) ? list.filter(function(x){ return typeof x==="string" && x; }).slice(0,RECENT_MAX) : [];
    }catch(e){ return []; }
  }
  /* remember the names a finished build gave its cast (each word of a name, newest first) so the next film's new
     people are called something else; kept on this device, per account */
  function remember(names){
    try{
      var s = store(); if(!s) return [];
      var seen = {}, out = [];
      var add = function(w){
        var word = display(String(w||"").replace(/[^\p{L}\p{M}'\u2019-]+/gu,""));
        var k = key(word);
        if(k.length<3 || seen[k] || NOT_A_NAME[k]) return;
        seen[k] = 1; out.push(word);
      };
      (Array.isArray(names) ? names : []).forEach(function(nm){ String(nm||"").split(/\s+/).forEach(add); });
      recent().forEach(add);
      out = out.slice(0,RECENT_MAX);
      s.setItem(recentKey(), JSON.stringify(out));
      return out;
    }catch(e){ return []; }
  }

  /* the paragraph a writing call is given wherever it may have to name someone.
     opts: { family:true } also draws family-name initials; { rnd } a random source (tests);
           { where } the words for "what the writer already wrote" in that prompt. */
  function brief(opts){
    var o = opts || {};
    var first = draw(8, o.rnd), last = o.family ? draw(6, o.rnd) : [];
    var used = recent().slice(0, RECENT_SHOWN);
    return "NAMES FOR NEW PEOPLE \u2014 invented people that "+(o.where || "the text above")+" does not already name "+
      "(a person it names keeps exactly that name, and a real person keeps their real name): their names fit the "+
      "story's place, period and culture. "+
      "So that one film's cast does not echo another's, each new person's FIRST name begins with the next letter of "+
      "this list, taken in order, one letter per person: "+first.join(", ")+
      (last.length ? ("; and each new FAMILY name with the next letter of this one: "+last.join(", ")) : "")+
      ". The story's place and period come from the story itself and are settled first; the letters only choose among "+
      "names that belong there \u2014 never move a story, or change who its people are, to suit a letter. Skip a letter "+
      "only when no name that fits the story begins with it. No new person shares a first-name initial "+
      "with anyone else in the film. Never give a new person one of these: "+OVERUSED.join(", ")+"."+
      (used.length ? (" This writer's other films already use these, so a new person gets none of them: "+used.join(", ")+".") : "")+
      " ";
  }

  root.KinolotNames = { fold:fold, key:key, id:id, idLosesName:idLosesName, display:display,
    draw:draw, brief:brief, recent:recent, remember:remember, OVERUSED:OVERUSED, LETTERS:LETTERS };
})(typeof window!=="undefined" ? window : globalThis);
