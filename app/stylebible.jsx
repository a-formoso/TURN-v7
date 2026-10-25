/* stylebible.jsx — project-wide visual Style Bible (data layer).
   A style PRESET is a reusable cinematic look built on the 60/30/10 colour rule:
   60% dominant, 30% secondary, 10% accent — plus a grade, lighting mood, lens and
   texture note. Scenes are each ASSIGNED a preset (project.styleBible.sceneStyles
   maps sceneId -> presetId); the AI reads the whole film and decides which preset
   fits each scene. Locations and (later) Shots read the assigned preset to render
   matching, on-palette plates. */

/* Starter presets — generic placeholder looks shown before a film is styled. They are
   a fallback only: "Light the film" (the Colorist) DESIGNS a bespoke palette unique to the film
   (authored from its genre/world/themes/arc) and REPLACES these, then color-scripts
   each scene along the value-charge spine. Each palette is [dominant, secondary,
   accent] = the 60 / 30 / 10 split. */
const STYLE_PRESETS_DEFAULT = [
  { id:"neutral",   name:"Neutral / Natural",  grade:"true-to-life colour, balanced contrast",
    palette:["#8a8f96","#c9cdd2","#d8a657"], dominantLabel:"cool grey", secondaryLabel:"soft light grey", accentLabel:"warm amber",
    lighting:"motivated naturalistic light, soft key, gentle falloff",
    lens:"35–50mm, shallow-to-mid depth", texture:"clean digital, fine natural grain" },
  { id:"teal-orange", name:"Teal & Orange",    grade:"blockbuster teal shadows, warm skin",
    palette:["#1e3d44","#d98a4b","#f2e6d8"], dominantLabel:"deep teal", secondaryLabel:"warm orange", accentLabel:"cream highlight",
    lighting:"crisp key with cool ambient fill, strong separation",
    lens:"anamorphic 40mm, oval bokeh", texture:"glossy contrast, subtle halation" },
  { id:"noir",      name:"Hard Noir",          grade:"high-contrast monochrome-leaning, crushed blacks",
    palette:["#111317","#5b626b","#e8e6df"], dominantLabel:"near-black", secondaryLabel:"steel grey", accentLabel:"bone white",
    lighting:"single hard source, deep shadow, venetian slats",
    lens:"32mm, deep focus", texture:"silver-halide grain, smoke haze" },
  { id:"warm-golden", name:"Warm / Golden Hour", grade:"honeyed warm grade, lifted blacks",
    palette:["#caa15a","#7a5b34","#fbf0d6"], dominantLabel:"golden amber", secondaryLabel:"umber", accentLabel:"pale gold",
    lighting:"low warm sun, long shadows, glowing backlight",
    lens:"85mm, creamy bokeh", texture:"soft bloom, gentle film grain" },
  { id:"cold-clinical", name:"Cold / Clinical", grade:"desaturated cool grade, clean whites",
    palette:["#9fb1bd","#dfe7ec","#33424d"], dominantLabel:"pale steel blue", secondaryLabel:"clinical white", accentLabel:"slate",
    lighting:"flat even fluorescent, low shadow",
    lens:"40mm, mid depth", texture:"crisp, low grain" },
];
window.STYLE_PRESETS_DEFAULT = STYLE_PRESETS_DEFAULT;

/* Film-stock / capture looks — a project-wide processing layer applied on top of the
   scene grade at the shot (see filmStockClause + buildShotPrompt). Each `clause` is the
   exact text appended to the frame prompt. "none" = clean digital, no extra look. */
const FILM_STOCKS = [
  { id:"none",        name:"None (clean digital)", clause:"" },
  { id:"portra",      name:"Kodak Portra 400/800", clause:"Shot on Kodak Portra 400/800 film: warm pastel colour, soft natural skin tones, low contrast, creamy highlight roll-off, fine organic grain." },
  { id:"16mm",        name:"16mm Film Grain (Indie / Documentary)", clause:"Captured on 16mm film: pronounced organic grain, slightly soft resolution, raw indie / documentary texture, subtle gate weave and halation." },
  { id:"cinestill800t", name:"CineStill 800T", clause:"Shot on CineStill 800T tungsten film: cool night-balanced cast, signature red halation glowing around highlights and practical lights, fine grain, cinematic low light." },
  { id:"trix",        name:"Kodak Tri-X 400 (B&W)", clause:"Shot on Kodak Tri-X 400 black-and-white film: monochrome (no colour), rich gritty grain, deep blacks, punchy photojournalistic contrast." },
  { id:"technicolor", name:"Technicolor (Golden-Age Vibrance)", clause:"Three-strip Technicolor look: hyper-saturated golden-age vibrance, bold primary reds, greens and blues, glossy luminous highlights, rich saturated palette." },
  { id:"bleachbypass", name:"Bleach Bypass", clause:"Bleach-bypass processing: desaturated muted colour over raised contrast, crushed metallic shadows, silvery highlights, a gritty hard-edged look." },
  { id:"tealorange", name:"Teal & Orange", clause:"Blockbuster teal-and-orange grade: teal-pushed shadows, warm orange skin tones, strong colour separation, glossy filmic contrast." },
];
window.FILM_STOCKS = FILM_STOCKS;

/* the prompt clause for the project's chosen film stock (empty when none) */
function filmStockClause(project){
  const id = project && project.styleBible && project.styleBible.filmStock;
  if(!id || id==="none") return "";
  const fs = FILM_STOCKS.find(x=>x.id===id);
  return (fs && fs.clause) ? (fs.clause+" ") : "";
}
window.filmStockClause = filmStockClause;

/* THE LOOK A VIDEO GETS (owner 2026-10-05 — Color review): the same look the shot frames get —
   the scene's grade, its 60/30/10 palette, lens character and texture, and the film's stock (a
   black-and-white stock stays black-and-white through the motion). Video prompts used to carry
   only the look's name and grade. "" when there is no look and no stock. */
function turnVideoLookText(preset, project){
  const t = (x)=> String(x||"").replace(/\s+/g," ").trim().replace(/[.;]+$/,"");
  const parts = [];
  if(preset){
    const head = [t(preset.name), t(preset.grade)].filter(Boolean).join(" \u2014 ");
    if(head) parts.push(head);
    const pal = Array.isArray(preset.palette) ? preset.palette : [];
    if(pal.length>=3) parts.push("colour 60/30/10: "+(t(preset.dominantLabel)||"dominant")+" "+pal[0]+", "
      +(t(preset.secondaryLabel)||"secondary")+" "+pal[1]+", "+(t(preset.accentLabel)||"accent")+" "+pal[2]);
    // ONE LENS SOURCE (2026-10-25, owner: "fix the lens conflict"): with the film's Capture set (the Color tab), its
    // words are the lens in every clip prompt — the look's own lens note would contradict it ("vintage anamorphic"
    // under "Spherical 35mm at T2.8"), so it's left out here; without a Capture the look's lens stands
    if(t(preset.lens) && !turnFilmCapture(project)) parts.push("lens character: "+t(preset.lens));
    if(t(preset.texture)) parts.push("texture: "+t(preset.texture));
  }
  const stock = t(filmStockClause(project));
  if(stock) parts.push(stock);
  return parts.join("; ");
}
window.turnVideoLookText = turnVideoLookText;

/* THE FILM'S CAPTURE, CHECKED (2026-10-25): Capture (Color tab) is the film's lens and optics in every clip prompt.
   turnCaptureConflicts says where it disagrees with the film itself — a lens kind (anamorphic / spherical) the
   film's looks don't use, or an aspect ratio that isn't the film's format — and turnCaptureForPrompt leaves a
   disagreeing ratio out of the prompt (the clip renders in the film's format either way; the words would only
   invite letterboxing). The Color tab shows the conflicts under Capture. */
function turnFilmCapture(project){ return String((((project||{}).styleBible)||{}).capture||"").trim(); }
const _CAPTURE_RATIO_RE = /\b(\d(?:\.\d{1,2})?)\s*:\s*1\b|\b(16|9|4|3|21|5|2)\s*:\s*(9|16|3|4|5|2)\b/g;
function _ratioValue(m){ if(!m) return 0; if(m[1]) return Number(m[1]); const a=Number(m[2]), b=Number(m[3]); return b ? a/b : 0; }
function _filmRatio(project){
  const a = String((typeof aspectFor==="function" ? aspectFor(project) : "16:9")||"16:9").split(":").map(Number);
  return (a[0]>0 && a[1]>0) ? a[0]/a[1] : 16/9;
}
function turnCaptureConflicts(project){
  const cap = turnFilmCapture(project);
  if(!cap) return [];
  const out = [];
  const sb = styleBibleOf(project), used = new Set(Object.values(sb.sceneStyles||{}));
  const lensOf = (x)=> /anamorphic/i.test(x) ? "anamorphic" : /spherical/i.test(x) ? "spherical" : "";
  const capLens = lensOf(cap);
  const lookLenses = Array.from(new Set((sb.presets||[]).filter(p=>p && (!used.size || used.has(p.id))).map(p=>lensOf(p.lens||"")).filter(Boolean)));
  if(capLens && lookLenses.length && lookLenses.indexOf(capLens)<0)
    out.push({ kind:"lens", capture:capLens, looks:lookLenses[0],
      text:"Capture says "+capLens+", but this film's looks say "+lookLenses[0]+". Clip prompts follow Capture; the frames follow the looks — change one so the takes match their frames." });
  const film = _filmRatio(project), fa = (typeof aspectFor==="function" ? aspectFor(project) : "16:9");
  let m; _CAPTURE_RATIO_RE.lastIndex = 0;
  const seen = new Set();
  while((m = _CAPTURE_RATIO_RE.exec(cap))){
    const v = _ratioValue(m), word = m[0];
    if(v>0 && Math.abs(v-film)>0.04 && !seen.has(word)){ seen.add(word);
      out.push({ kind:"ratio", capture:word, film:fa,
        text:"Capture names "+word+", but this film is "+fa+". Clips render "+fa+", so "+word+" is left out of their prompts — take it out of Capture, or change the film's format." }); }
  }
  return out;
}
function turnCaptureForPrompt(project){
  const cap = turnFilmCapture(project);
  if(!cap) return "";
  const film = _filmRatio(project);
  return cap.replace(_CAPTURE_RATIO_RE, (w, a, b, c)=>{ const v = a ? Number(a) : (Number(c) ? Number(b)/Number(c) : 0);
      return (v>0 && Math.abs(v-film)>0.04) ? "" : w; })
    .replace(/\s*,\s*(?=[,.;])/g,"").replace(/,\s*,/g,",").replace(/\(\s*\)/g,"").replace(/\s{2,}/g," ")
    .replace(/\s+([,.;])/g,"$1").replace(/^[,.;\s]+/,"").trim();
}
window.turnFilmCapture = turnFilmCapture; window.turnCaptureConflicts = turnCaptureConflicts; window.turnCaptureForPrompt = turnCaptureForPrompt;

function styleBibleOf(project){
  const sb = (project && project.styleBible) || {};
  return {
    presets: (sb.presets && sb.presets.length) ? sb.presets : STYLE_PRESETS_DEFAULT,
    sceneStyles: sb.sceneStyles || {},
    // free-text visual references that guide bespoke palette design (see
    // aiAssignSceneStyles) — auto-filled from the Lookbook by the write-through effect
    // in app.jsx until the user edits the field, then theirs.
    refs: sb.refs || "",
    // the last auto-filled lookbook brief — refs !== lookbookSynced means the user took
    // the field over (syncs stop; also lets the Visual Researcher skip self-fed refs).
    lookbookSynced: sb.lookbookSynced || "",
    // uploaded reference images: [{ id, thumb (small dataURL), colors:[hex] }].
    // The sampled palette rides with every still (the Colorist also LOOKS at stills that kept a 384px view); we sample client-side and feed
    // those hues into the design prompt.
    refImages: sb.refImages || [],
    // project-wide film-stock / capture look (id into FILM_STOCKS); "none" = clean digital.
    filmStock: sb.filmStock || "none",
    // scenes whose look the user chose in the film-strip — Light the film keeps them (2026-10-03)
    sceneStylesManual: sb.sceneStylesManual || {},
    // the Colorist's reason for each scene's look, and for the palette as a whole
    sceneWhy: sb.sceneWhy || {},
    paletteWhy: sb.paletteWhy || "",
  };
}
window.styleBibleOf = styleBibleOf;

function presetById(project, id){
  const { presets } = styleBibleOf(project);
  return presets.find(p=>p.id===id) || null;
}
window.presetById = presetById;

/* the preset assigned to a given scene id (or null) */
function scenePreset(project, sceneId){
  const { sceneStyles } = styleBibleOf(project);
  return presetById(project, sceneStyles[sceneId]);
}
window.scenePreset = scenePreset;

