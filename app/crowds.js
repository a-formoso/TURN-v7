/* CROWDS — one group image per crowd the screenplay calls for (owner-approved 2026-10-27, "go ahead with 5 and 6").
   The casting models of a fashion show, the passengers on a ferry: background people who recur shot after shot. A crowd
   is DERIVED from the screenplay's action lines (as the cast is — never added by hand): a group noun ("passengers",
   "guests", "a crowd") in a scene's action makes, or extends, that crowd. Its card in Characters › Crowds generates ONE
   image of the group (different faces, the scene's wardrobe, a plain grey background), and that image goes with every
   shot frame and Stage clip whose action names the crowd, so the same people recur instead of new strangers each cut.
   What the user changes on a card is kept in project.crowds[key] ({look, count, off}); the list itself always follows
   the screenplay. Never a named character: the reference says so every time it is attached. */
(function(){
  const CROWD_NOUNS = [
    ["crowd","Crowd","crowds?|throngs?|mob|extras|onlookers?|bystanders?|spectators?|audience|congregation"],
    ["passenger","Passengers","passengers"],
    ["guest","Guests","guests|partygoers|party-goers"],
    ["model","Models","models"],
    ["dancer","Dancers","dancers"],
    ["soldier","Soldiers","soldiers|troops"],
    ["worker","Workers","workers|labourers|laborers|dockers|dockworkers"],
    ["student","Students","students|pupils"],
    ["tourist","Tourists","tourists|sightseers"],
    ["commuter","Commuters","commuters"],
    ["diner","Diners","diners"],
    ["patron","Patrons","patrons|regulars|drinkers|clubbers"],
    ["mourner","Mourners","mourners"],
    ["press","Press","reporters|journalists|photographers|paparazzi"],
    ["protester","Protesters","protesters|protestors|demonstrators"],
    ["shopper","Shoppers","shoppers|customers"],
    ["villager","Villagers","villagers|locals|townspeople|townsfolk"],
    ["sailor","Sailors","sailors|deckhands|crew members|crewmen"],
    ["waiter","Waiters","waiters|waitresses|servers"],
    ["nurse","Nurses","nurses|orderlies"],
    ["pedestrian","Pedestrians","pedestrians|passers-?by"],
    ["traveller","Travellers","travell?ers"],
    ["refugee","Refugees","refugees|migrants"],
    ["prisoner","Prisoners","prisoners|inmates"],
    ["child","Children","children|kids"],
    ["officer","Police officers","police officers|policemen|cops|guards"],
    ["monk","Monks","monks|nuns|priests"],
  ];
  const _rx = (src)=> new RegExp("\\b(?:"+src+")\\b","i");
  const _clean = (s)=> String(s||"").replace(/\s+/g," ").trim();
  const _actionText = (scene, drafts)=>{
    const d = drafts && scene && drafts[scene.id];
    const blocks = d && Array.isArray(d.blocks) ? d.blocks : [];
    return blocks.filter(b=>b && b.type==="action").map(b=>_clean(b.text)).filter(Boolean).join(" ");
  };
  const _sentences = (text)=> String(text||"").split(/(?<=[.!?])\s+/).map(_clean).filter(Boolean);
  // how many people its image shows: a few → 4, a crowd/dozens → 8, else 6 (the card can change it, 3–10)
  const _count = (sentence)=>{
    if(/\b(a few|few|two|three|four|a handful|handful|a couple|couple|pair)\b/i.test(sentence)) return 4;
    if(/\b(dozens|hundreds|packed|throng|crowd|crowds|mob|swarm|teeming|full of)\b/i.test(sentence)) return 8;
    return 6;
  };
  function crowdImageId(c){ return "crowd-"+String((c&&c.key)||c||""); }
  /* the crowds of the film, in screenplay order: {key, id, name, pattern, scenes, excerpts, look, count, off} */
  function deriveCrowds(scenes, drafts, overlay){
    const ov = overlay && typeof overlay==="object" ? overlay : {};
    const byKey = new Map();
    (Array.isArray(scenes) ? scenes : []).forEach(s=>{
      if(!s || !s.id) return;
      const text = _actionText(s, drafts);
      if(!text) return;
      const sentences = _sentences(text);
      CROWD_NOUNS.forEach(([key,name,src])=>{
        const rx = _rx(src);
        const hits = sentences.filter(x=>rx.test(x));
        if(!hits.length) return;
        let c = byKey.get(key);
        if(!c){ c = {key, id:crowdImageId(key), name, pattern:src, scenes:[], sceneNos:[], excerpts:[], autoCount:_count(hits[0])}; byKey.set(key,c); }
        c.scenes.push(s.id); if(s.no!=null) c.sceneNos.push(s.no);
        hits.forEach(h=>{ if(c.excerpts.length<3 && c.excerpts.indexOf(h)<0) c.excerpts.push(h.length>240 ? h.slice(0,237)+"…" : h); });
      });
    });
    return Array.from(byKey.values()).map(c=>{
      const o = ov[c.key] || {};
      const count = Math.max(3, Math.min(10, Number(o.count)||c.autoCount||6));
      return { ...c, look:_clean(o.look), count, off:!!o.off };
    });
  }
  /* the crowds a shot shows: in its scene, and named by its own action (a crowd that isn't named stays out) */
  function crowdsForShot(crowds, scene, sh){
    if(!scene || !sh) return [];
    const text = [sh.action, sh.composition, sh.vidText].map(_clean).join(" ");
    return (crowds||[]).filter(c=>c && !c.off && c.scenes.indexOf(scene.id)>=0 && _rx(c.pattern).test(text));
  }
  /* the attached reference's line — background only, never a named character, never a lineup */
  function crowdReferenceNote(c){
    const n = (c && c.name) || "Crowd";
    return "the "+n.toUpperCase()+" crowd reference — anonymous background extras only: take these people's faces, ages, builds and wardrobe so the same "
      +n.toLowerCase()+" recur from shot to shot. None of them is a named character. Never a lineup or a copy of the reference's poses: place them naturally in the scene, few near the camera, the cast in front and sharp";
  }
  /* the group image's prompt (one image call) */
  function crowdImagePrompt(c, opts){
    const o = opts || {};
    const n = c.count || 6, name = c.name || "Crowd";
    const what = name==="Crowd" ? "background extras" : name.toLowerCase();
    const lines = [
      "A film casting reference image: a group of "+n+" "+what+" — the anonymous background people of one film, photographed together.",
      c.look ? "Their look: "+c.look+"." : "",
      (c.excerpts||[]).length ? "From the screenplay: "+c.excerpts.join(" ") : "",
      o.style ? "Render style: "+o.style+"." : "",
      o.lookbook ? o.lookbook : "",
      "All "+n+" stand side by side in one row, full body from head to shoes, facing the camera, evenly lit, on a plain mid-grey studio background with nothing else in it.",
      "Every person is clearly a different individual: face, age, build, skin tone and hair all vary; wardrobe true to the screenplay's period, place and occasion, consistent as a group.",
      "No named or main character, no famous person, no text, no labels, no numbers, no props beyond what they would carry."
    ];
    return lines.filter(Boolean).join("\n");
  }
  window.CROWD_NOUNS = CROWD_NOUNS;
  window.crowdImageId = crowdImageId;
  window.deriveCrowds = deriveCrowds;
  window.crowdsForShot = crowdsForShot;
  window.crowdReferenceNote = crowdReferenceNote;
  window.crowdImagePrompt = crowdImagePrompt;
  /* the film's crowds right now (project.crowds overlay + the screenplay) — for the Shots room and the Stage */
  window.turnFilmCrowds = function(project){
    const C = window.turnContinuity || {};
    const overlay = (project && project.crowds) || window.turnProjectCrowds || {};
    return deriveCrowds(C.scenes||[], C.drafts||{}, overlay);
  };
})();
