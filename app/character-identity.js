/* character-identity.js — shared, evidence-bounded identity checks.
 *
 * This is deliberately a small deterministic layer.  It does not infer a
 * person's gender from their name, clothes, body, occupation, or a nearby
 * word in the screenplay.  A screenplay observation is only evidence when a
 * named subject is immediately declared as a man/woman (or an equivalent
 * singular word) in an action block.  The visual and profile readers use the
 * same narrow rule and never inspect an image as if its contents were canon.
 */
(function(root){
  "use strict";

  var W = root || (typeof window !== "undefined" ? window : {});
  var own = Object.prototype.hasOwnProperty;

  var PRONOUN_ALIASES = {
    "he/him":"he/him", "he/his":"he/him", "he":"he/him", "him":"he/him",
    "she/her":"she/her", "she/hers":"she/her", "she":"she/her", "her":"she/her",
    "they/them":"they/them", "they/their":"they/them", "they":"they/them", "them":"they/them",
  };
  var GENDER_WORDS = {
    man:"he/him", male:"he/him", boy:"he/him", gentleman:"he/him",
    woman:"she/her", female:"she/her", girl:"she/her", lady:"she/her",
  };
  function text(value){
    return value == null ? "" : String(value);
  }

  function normalized(value){
    return text(value).trim().toLowerCase().replace(/\s+/g," ");
  }

  function normalizePronouns(value){
    var v = normalized(value).replace(/\s*\/\s*/g,"/");
    return PRONOUN_ALIASES[v] || "";
  }
  W.turnNormalizePronouns = normalizePronouns;

  function canonicalPronouns(character){
    if(!character || typeof character !== "object") return "";
    /*
     * Persisted pronouns are the compatibility-safe canon.  Provenance is
     * retained for audit/display, but must not make old or newly generated
     * records disagree with the writer/media layers: a valid stored value
     * remains canonical regardless of who wrote it.
     */
    return normalizePronouns(character.pronouns);
  }

  function contextOf(input){
    var supplied = input && typeof input === "object" ? input : {};
    var live = W.turnIdentityContext || W.turnContinuity || {};
    var scenes = Array.isArray(supplied.scenes)
      ? supplied.scenes
      : (Array.isArray(live.scenes) ? live.scenes : []);
    var drafts = own.call(supplied,"drafts")
      ? (supplied.drafts || {})
      : (live.drafts || {});
    var cast = Array.isArray(supplied.cast)
      ? supplied.cast
      : (Array.isArray(live.cast) ? live.cast
        : (Array.isArray(live.characters) ? live.characters
          : (Array.isArray(W.turnCast) ? W.turnCast : [])));
    return { scenes:scenes, drafts:drafts, cast:cast };
  }

  function escapeRegExp(value){
    return text(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  }

  function namePattern(value){
    var parts = text(value).trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return "";
    return parts.map(escapeRegExp).join("\\s+");
  }

  function namesFor(character, cast){
    var name = text(character && character.name).trim();
    if(!name) return [];
    var full = namePattern(name);
    var words = name.split(/\s+/).filter(Boolean);
    var first = words[0] || "";
    var firstLower = normalized(first);
    var firstOwners = (cast || []).filter(function(c){
      var n = text(c && c.name).trim().split(/\s+/).filter(Boolean);
      return n.length && normalized(n[0]) === firstLower;
    });
    var out = [];
    if(full) out.push({ value:name, pattern:full, full:true });
    /*
     * A short first name is navigation shorthand, not proof, when another
     * cast member shares it.  Full names remain valid in that case.
     */
    if(words.length === 1 || firstOwners.length <= 1){
      if(first && normalized(first) !== normalized(name))
        out.push({ value:first, pattern:namePattern(first), full:false });
    }
    return out;
  }

  function draftFor(drafts, scene){
    if(!drafts || !scene) return null;
    if(Array.isArray(drafts)){
      return drafts.find(function(d){ return d && String(d.id) === String(scene.id); }) || null;
    }
    return drafts[scene.id] || drafts[String(scene.id)] || null;
  }

  function actionBlocks(draft){
    if(!draft) return [];
    var blocks = Array.isArray(draft) ? draft : draft.blocks;
    if(Array.isArray(blocks)) return blocks.filter(function(b){
      return b && normalized(b.type) === "action" && text(b.text).trim();
    });
    /*
     * A raw string has no trustworthy action/dialogue boundary.  Deliberately
     * do not read it: exact screenplay evidence must come from an action block.
     */
    return [];
  }

  function sourceEvidence(source, quote, observed, scene){
    var item = {
      source:source,
      quote:text(quote),
      observedPronouns:observed,
    };
    if(scene && scene.id != null) item.sceneId = scene.id;
    if(scene && scene.no != null) item.sceneNo = scene.no;
    return item;
  }

  function hasOtherCastName(block, targetMatch, character, cast){
    var targetName = normalized(character && character.name);
    var names = [];
    (cast || []).forEach(function(c){
      if(!c || !c.name) return;
      namesFor(c,cast).forEach(function(n){
        if(normalized(c.name) === targetName && normalized(n.value) === normalized(targetMatch.value)) return;
        names.push({ owner:c, name:n });
      });
    });
    if(names.some(function(entry){
      var re = new RegExp("(^|[^A-Za-z0-9_])"+entry.name.pattern+"(?=$|[^A-Za-z0-9_])","i");
      return re.test(block);
    })) return true;
    /*
     * Draft action often capitalises a newly introduced person before that
     * person has entered the cast.  Treat an additional all-caps token as an
     * attribution boundary too.  The conservative false-negative is safer
     * than assigning a follow-up pronoun to the wrong named subject.
     */
    var targetWords = normalized(character && character.name).split(/\s+/);
    var common = {the:true,a:true,an:true,and:true,but:true,then:true,now:true,one:true,two:true};
    var caps = block.match(/\b[A-Z][A-Z0-9'-]{2,}\b/g) || [];
    return caps.some(function(token){
      var low = normalized(token);
      return !common[low] && targetWords.indexOf(low)<0;
    });
  }

  function directDeclaration(textBlock, match){
    var matchedLength = typeof match.length === "number" ? match.length : text(match.match).length;
    var after = textBlock.slice(match.index + matchedLength);
    /*
     * The parenthetical is intentionally limited to the immediate age/name
     * qualifier.  Anything later in the paragraph is context, not a
     * declaration about the named person.
     */
    var prefix = "\\s*(?:\\([^)]{1,80}\\)\\s*)?";
    var sep = "(?:(?:—|–|-|:|,)\\s*|(?:is|was|becomes|appears as)\\s+)";
    var gender = "(?:an?\\s+|the\\s+)?(man|male|boy|gentleman|woman|female|girl|lady)\\b";
    var pron = "(he|him|his|she|her|hers|they|them|their)\\b";
    var m = after.match(new RegExp("^" + prefix + sep + gender,"i"));
    if(m) return { pronouns:GENDER_WORDS[normalized(m[1])] || "", end:after.indexOf(m[0]) + m[0].length };
    var p = after.match(new RegExp("^" + prefix + sep + pron,"i"));
    if(p){
      var token = normalized(p[1]);
      return { pronouns:normalizePronouns(token), end:after.indexOf(p[0]) + p[0].length };
    }
    return null;
  }

  function followUpPronoun(textBlock, tail){
    /*
     * Only sentence-leading subject pronouns after a direct declaration are
     * considered.  Object pronouns ("she watches him") and possessives do not
     * identify the named subject.  `tail` begins after the declaration.
     */
    var p = tail.match(/(?:^|[.;:!?—–]\s+)(He|She|They)\b/);
    return p ? normalizePronouns(p[1]) : "";
  }

  function screenplayEvidence(character, scenes, drafts, cast){
    var out = [];
    var names = namesFor(character,cast);
    if(!names.length) return out;
    (scenes || []).forEach(function(scene){
      var draft = draftFor(drafts,scene);
      actionBlocks(draft).forEach(function(block){
        var value = text(block.text);
        var matches = [];
        names.forEach(function(n){
          var re = new RegExp("(^|[^A-Za-z0-9_])("+n.pattern+")(?=$|[^A-Za-z0-9_])","ig");
          var m;
          while((m = re.exec(value))){
            matches.push({ value:n.value, index:m.index + m[1].length, length:m[2].length, full:n.full });
            if(!re.global) break;
          }
        });
        matches.sort(function(a,b){ return a.index-b.index || b.length-a.length; });
        matches = matches.filter(function(match,index){
          return index===0 || match.index!==matches[index-1].index;
        });
        matches.forEach(function(match){
          var before = value.slice(0,match.index);
          if(/(?:'|’)\s*s\s*$/.test(before)) return; // possessive reference
          var declaration = directDeclaration(value,{ index:match.index, match:value.slice(match.index,match.index+match.length) });
          if(!declaration || !declaration.pronouns) return;
          out.push(sourceEvidence("screenplay",value,declaration.pronouns,scene));

          // Later pronouns may refer to someone before or after this name.
          // Only the direct named declaration is sufficiently bounded evidence.
        });
      });
    });
    return out;
  }

  function profileTextFields(character){
    var fields = [
      ["role",character && character.role],
      ["identity",character && character.identity],
      ["description",character && character.description],
      ["profile",character && character.profile],
      ["bio",character && character.bio],
      ["narrative identity",character && character.narrativeIdentity],
      ["psyche",character && character.psyche],
      ["conscious",character && character.conscious],
      ["unconscious",character && character.unconscious],
      ["inner life",character && character.innerLife],
      ["internal life",character && character.internalLife],
      ["personality",character && character.personality],
      ["desire",character && character.desire],
      ["need",character && character.need],
      ["fear",character && character.fear],
      ["wound",character && character.wound],
      ["arc",character && character.arc],
      ["gender",character && character.gender],
      ["sex",character && character.sex],
      ["profile pronouns",character && character.profilePronouns],
    ];
    return fields.filter(function(pair){ return typeof pair[1] === "string" && pair[1].trim(); });
  }

  function subjectPronoun(value,character){
    var name = namePattern(text(character && character.name).trim());
    if(!name) return "";
    var lead = "(?:^|[.!?;]\\s*)"+name+
      "\\s*(?:(?:is)\\s+|(?:—|–|-|:|,)\\s*)";
    var match = text(value).match(new RegExp(lead+"(he|she|they)\\b","i"));
    return match ? normalizePronouns(match[1]) : "";
  }

  function subjectGender(value,character,strict){
    var name = namePattern(text(character && character.name).trim());
    if(!name) return "";
    var boundary = strict ? "[.!?;]" : "[.!?;,:—–-]";
    var lead = "(?:^|"+boundary+"\\s*)"+name+
      "\\s*(?:(?:is)\\s+|(?:—|–|-|:|,)\\s*)";
    var match = text(value).match(new RegExp(lead+
      "(?:an?\\s+|the\\s+)?(man|male|boy|gentleman|woman|female|girl|lady)\\b","i"));
    return match ? GENDER_WORDS[normalized(match[1])] || "" : "";
  }

  function dedicatedIdentity(value){
    var v = text(value).trim();
    if(!v) return "";
    var slash = v.match(/^(he\s*\/\s*him|she\s*\/\s*her|they\s*\/\s*them)$/i);
    if(slash) return normalizePronouns(slash[1]);
    var word = normalized(v).replace(/^(?:an?|the)\s+/,"").split(/\s+/)[0];
    return GENDER_WORDS[word] || "";
  }

  function advisoryPronoun(value){
    var match = text(value).match(/(?:^|[.!?;]\s*)(He|She|They)\b/i);
    return match ? normalizePronouns(match[1]) : "";
  }

  function explicitProfilePronouns(character){
    var out = [];
    profileTextFields(character).forEach(function(pair){
      var value = text(pair[1]);
      var dedicated = pair[0] === "gender" || pair[0] === "sex" || pair[0] === "profile pronouns";
      if(dedicated){
        var explicit = dedicatedIdentity(value);
        if(explicit) out.push({ field:pair[0], evidence:sourceEvidence("profile",value,explicit,null) });
      }else{
        /*
         * Free prose qualifies only when the named character is the immediate
         * subject.  Generic "She hungers" and quoted/third-party prose stay
         * advisory or inert; they must never hard-block media generation.
         */
        var pronoun = subjectPronoun(value,character);
        if(pronoun) out.push({ field:pair[0], evidence:sourceEvidence("profile",value,pronoun,null) });
        var gender = subjectGender(value,character);
        if(gender) out.push({ field:pair[0], evidence:sourceEvidence("profile",value,gender,null) });
      }
    });
    return out;
  }

  function profileAdvisories(character){
    var advisoryFields = {
      psyche:true, conscious:true, unconscious:true, "inner life":true,
      "internal life":true, personality:true, desire:true, need:true,
      fear:true, wound:true, arc:true,
    };
    var out = [];
    profileTextFields(character).forEach(function(pair){
      if(!advisoryFields[pair[0]]) return;
      var observed = advisoryPronoun(pair[1]);
      if(observed) out.push({
        source:"profile-advisory",
        quote:text(pair[1]),
        observedPronouns:observed,
        message:"The "+pair[0]+" text uses "+observed+
          " in generic prose. Review it after any identity change; this advisory is not a canon conflict.",
      });
    });
    return out;
  }

  function visualTextFields(character){
    if(!character || typeof character !== "object") return [];
    var out = [];
    if(typeof character.coreBody === "string" && character.coreBody.trim())
      out.push(["core body",character.coreBody,false]);
    var physique = character.physique;
    if(physique && typeof physique === "object"){
      Object.keys(physique).forEach(function(key){
        if(typeof physique[key] === "string" && physique[key].trim())
          out.push(["physique."+key,physique[key],key==="gender"||key==="sex"||key==="pronouns"]);
      });
    }
    return out;
  }

  function profileEvidence(character){
    return explicitProfilePronouns(character).map(function(x){ return x.evidence; });
  }

  function visualEvidence(character){
    var out = [];
    visualTextFields(character).forEach(function(pair){
      var value = text(pair[1]);
      if(pair[2]){
        var explicit = dedicatedIdentity(value);
        if(explicit) out.push(sourceEvidence("visual",value,explicit,null));
      }else{
        var pronoun = subjectPronoun(value,character);
        if(pronoun) out.push(sourceEvidence("visual",value,pronoun,null));
        var gender = subjectGender(value,character,true);
        if(gender) out.push(sourceEvidence("visual",value,gender,null));
      }
    });
    return out;
  }

  function uniquePronouns(evidence){
    var seen = {}, out = [];
    (evidence || []).forEach(function(item){
      if(!item || !item.observedPronouns || seen[item.observedPronouns]) return;
      seen[item.observedPronouns] = true; out.push(item.observedPronouns);
    });
    return out;
  }

  function sourceLabel(source){
    return source === "screenplay" ? "The screenplay"
      : source === "visual" ? "The visual specification"
      : "The character profile";
  }

  function identityReport(character, input){
    var ctx = contextOf(input);
    var canonical = canonicalPronouns(character);
    var script = screenplayEvidence(character,ctx.scenes,ctx.drafts,ctx.cast);
    var profile = profileEvidence(character);
    var visual = visualEvidence(character);
    var advisories = profileAdvisories(character);
    var all = script.concat(profile,visual);
    var observed = uniquePronouns(all);
    var scriptObserved = uniquePronouns(script);
    var issues = [];
    var name = text(character && character.name).trim() || "This character";

    if(canonical){
      all.forEach(function(item){
        if(item.observedPronouns === canonical) return;
        issues.push({
          source:item.source, quote:item.quote,
          sceneId:item.sceneId, sceneNo:item.sceneNo,
          observedPronouns:item.observedPronouns,
          message:sourceLabel(item.source)+" identifies "+name+" as "+item.observedPronouns+
            ", while the profile is canonically set to "+canonical+". Review before redrafting.",
        });
      });
    }else if(observed.length > 1){
      all.forEach(function(item){
        issues.push({
          source:item.source, quote:item.quote,
          sceneId:item.sceneId, sceneNo:item.sceneNo,
          observedPronouns:item.observedPronouns,
          message:"Identity evidence conflicts for "+name+": "+sourceLabel(item.source)+
            " identifies them as "+item.observedPronouns+" while other direct evidence says "+
            observed.filter(function(v){ return v!==item.observedPronouns; }).join(" / ")+". Review before redrafting.",
        });
      });
    }

    /*
     * Do not expose undefined location keys in the public contract.  It makes
     * callers' serialization stable and ensures screenplay issues always carry
     * their exact scene pointer while profile/visual evidence remains film-wide.
     */
    issues = issues.map(function(item){
      var out = {
        source:item.source, quote:item.quote,
        observedPronouns:item.observedPronouns, message:item.message,
      };
      if(item.sceneId != null) out.sceneId = item.sceneId;
      if(item.sceneNo != null) out.sceneNo = item.sceneNo;
      return out;
    });

    var status = issues.length ? "conflict" : (canonical ? "unverified" : "unset");
    return {
      pronouns:canonical,
      scriptPronouns:scriptObserved.length === 1 ? scriptObserved[0] : "",
      issues:issues,
      status:status,
      advisories:advisories,
    };
  }
  W.turnIdentityReport = identityReport;

  function isNonHuman(character){
    var blob = [
      character && character.species, character && character.kind,
      character && character.type, character && character.entityType,
    ].join(" ").toLowerCase();
    return /\b(animal|dog|cat|horse|bird|fish|wolf|fox|bear|dragon|creature|pet|robot|android|machine|vehicle|monster|plant)\b/.test(blob);
  }

  function identityError(report,character,reason){
    var name = text(character && character.name).trim() || "This character";
    var err = new Error(reason || (name+" has an unresolved character identity. Choose explicit pronouns or review the screenplay evidence."));
    err.identityReport = report;
    err.characterId = character && character.id;
    return err;
  }

  W.turnAssertCharacterIdentity = function(character,context){
    var report = identityReport(character,context);
    if(report.status === "conflict")
      throw identityError(report,character,"Identity conflict for "+(text(character && character.name).trim()||"this character")+
        ": screenplay, profile, or visual evidence disagrees with the canonical pronouns. Review the evidence before continuing.");
    if(report.status === "unset" && !isNonHuman(character))
      throw identityError(report,character);
    return report;
  };

  W.turnAssertProjectIdentity = function(options){
    options = options && typeof options === "object" ? options : {};
    var ctx = contextOf(options);
    var cast = ctx.cast || [];
    var ids = Array.isArray(options.characterIds) ? options.characterIds : null;
    var selected = ids
      ? cast.filter(function(c){ return c && ids.some(function(id){ return String(id)===String(c.id); }); })
      : cast;
    /*
     * A project-wide media request often carries the whole cast, including
     * props, animals, and unnamed texture characters.  Only a known
     * contradiction is project-blocking here; a human with unset pronouns is
     * still checked by the character-specific media guard when that person is
     * actually used as a subject.
     */
    var reports = selected.map(function(character){
      var report = identityReport(character,ctx);
      if(report.status === "conflict")
        throw identityError(report,character,"Identity conflict for "+
          (text(character && character.name).trim()||"this character")+
          ": screenplay, profile, or visual evidence disagrees with the canonical pronouns. Review the evidence before continuing.");
      return report;
    });
    return reports;
  };

  W.turnIdentityPrompt = function(cast){
    var list = Array.isArray(cast) ? cast
      : (Array.isArray(W.turnCast) ? W.turnCast
        : ((W.turnContinuity && Array.isArray(W.turnContinuity.characters)) ? W.turnContinuity.characters : []));
    if(!list.length) return "";
    var lines = list.filter(function(c){ return c && c.name; }).map(function(c){
      var pronouns = canonicalPronouns(c);
      return String(c.name).trim()+" — "+(pronouns
        ? "canonical pronouns: "+pronouns
        : "pronouns unknown; use the name only and do not infer gender");
    });
    if(!lines.length) return "";
    return "CANONICAL CHARACTER IDENTITY BINDING — explicit profile pronouns win. "+
      "Do not guess from names, appearance, roles, or nearby text. If a source conflicts, "+
      "stop for review; never auto-override the profile.\n"+lines.join("\n");
  };
})(typeof window !== "undefined" ? window : this);