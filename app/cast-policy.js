/* cast-policy.js — migrations and invariants for the story-derived cast. */
(function(){
  function scalarList(v){ return Array.isArray(v) ? v : []; }
  function lower(v){ return String(v == null ? "" : v).trim().toLowerCase(); }
  function containsWord(value, word){
    if(!word) return false;
    var escaped = word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    return new RegExp("(^|[^a-z0-9])"+escaped+"([^a-z0-9]|$)","i").test(String(value||""));
  }

  /* One narrowly-scoped repair for the accidental Cast + entries in The Last
     Word. It only removes timestamp-id manual records, only when the exact trio
     is present, and only when none of them is used by scenes, shots, props or
     screenplay text. Story-derived characters and purposeful legacy manual
     characters are left untouched. */
  function turnPruneAccidentalManualCast(characters, doc){
    var list = scalarList(characters);
    doc = doc || {};
    if(lower(doc.project && doc.project.title)!=="the last word") return list;

    var scenes = scalarList(doc.scenes);
    var shots = scalarList(doc.shots);
    var props = scalarList(doc.props);
    var draftsText = Object.keys(doc.drafts||{}).map(function(k){
      var v = doc.drafts[k];
      return typeof v==="string" ? v : JSON.stringify(v||"");
    }).join("\n");

    function isUsed(c){
      var id = String(c.id||"");
      var name = String(c.name||"").trim();
      if(scenes.some(function(s){
        if(!s) return false;
        if(String(s.driver||"")===id) return true;
        return scalarList(s.cast).some(function(v){
          return String(v&&v.id||v||"")===id || lower(v&&v.name||v)===lower(name);
        });
      })) return true;
      if(shots.some(function(s){
        return s && scalarList(s.subjects).some(function(v){ return String(v&&v.id||v||"")===id; });
      })) return true;
      if(props.some(function(p){ return p && String(p.ownerId||"")===id; })) return true;
      return containsWord(draftsText, name);
    }

    var candidates = list.filter(function(c){
      if(!c || c.manual!==true || !/^char-[a-z0-9]+$/i.test(String(c.id||""))) return false;
      var name = lower(c.name);
      return (name==="alex" || name==="new character") && !isUsed(c);
    });
    var alex = candidates.filter(function(c){ return lower(c.name)==="alex"; });
    var unnamed = candidates.filter(function(c){ return lower(c.name)==="new character"; });
    if(alex.length!==1 || unnamed.length!==2) return list;

    var remove = new Set(candidates.map(function(c){ return c.id; }));
    return list.filter(function(c){ return !remove.has(c&&c.id); });
  }

  window.turnPruneAccidentalManualCast = turnPruneAccidentalManualCast;
})();
