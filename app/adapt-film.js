/* adapt-film.js — ADAPT INTO A NEW FILM (Import a screenplay, phase 6; owner 2026-10-18; docs/Script Import Plan.md §9).
   From the Story Editors: a film becomes a NEW film beside it — in another format (a feature into a micro-drama, a
   pilot into a short), as a rewrite pass in the Infinite Studio AI method, or in another structure. The source film
   is never touched: the new film is built by the story build (Adaptation, Story Pipeline step 3 on) from a brief made
   here from the source — its logline, controlling idea, synopsis, the story scene by scene and its people by name.

   window.AdaptFilm = { composeBrief, MODES, BRIEF_MAX } */
(function(root){
  "use strict";
  const clean = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  const BRIEF_MAX = 4000;   // what the spine build reads of a brief (ai.jsx aiBuildSpine)
  const MODES = {
    retell: { label:"Retell it in the new shape",
      tell:"RETELL this story in the new format and structure: keep its premise, its people (by name), its world and what it means; compress, expand, merge or invent scenes as the new shape needs." },
    rewrite: { label:"A rewrite pass in the method",
      tell:"REWRITE this story as a new draft in the Infinite Studio AI method: keep its premise, its people (by name), its world and its order of events, and make every scene turn its value, sharpen each turning point and build the progression to an irreversible climax." },
  };
  const labelOf = (list, id) => { const f = (list || []).find(x => x && x.id === id); return f ? (f.label || id) : (id || ""); };

  /* src = { project, scenes (story order), characters }; to = { format, framework, mode, note, formats, frameworks } */
  function composeBrief(src, to){
    src = src || {}; to = to || {};
    const P = src.project || {};
    const formats = to.formats || root.FORMATS || [], frameworks = to.frameworks || root.FRAMEWORKS || [];
    const mode = MODES[to.mode] ? to.mode : "retell";
    const fromFmt = labelOf(formats, P.format || "film"), toFmt = labelOf(formats, to.format || P.format || "film");
    const fromFw = labelOf(frameworks, P.framework || "threeact"), toFw = labelOf(frameworks, to.framework || P.framework || "threeact");
    const head = [
      "ADAPTATION — a new film made from an existing one: “" + (clean(P.title) || "Untitled") + "” (" + fromFmt + ", " + fromFw + ").",
      "Make it a " + toFmt + " in the " + toFw + " structure. " + MODES[mode].tell,
      "Its best lines may be kept where they still fit; everything else is written new.",
      clean(to.note) ? "THE WRITER'S NOTE: " + clean(to.note).slice(0, 400) : "",
    ].filter(Boolean).join("\n");
    const ci = P.controllingIdea || {};
    const paras = (P.synopsis && Array.isArray(P.synopsis.paras)) ? P.synopsis.paras.map(p => clean(p && p.text)).filter(Boolean) : [];
    const story = [
      clean(P.logline) ? "LOGLINE: " + clean(P.logline) : "",
      clean(ci.value) ? "CONTROLLING IDEA: " + clean([ci.value, ci.cause].join(" ")) : "",
      paras.length ? "SYNOPSIS: " + paras.join(" ") : "",
    ].filter(Boolean);
    const scenes = (src.scenes || []).filter(s => s && !s.notInDraft);
    const sceneLine = (s, i, short) => {
      const what = clean(s.summary) || clean(s.loc) || "";
      const turn = !short && (clean(s.openValue) || clean(s.closeValue)) ? " (" + (clean(s.openValue) || "?") + " → " + (clean(s.closeValue) || "?") + ")" : "";
      return (i + 1) + ". " + (clean(s.title) || "Scene " + (i + 1)) + (what ? " — " + (short ? what.slice(0, 90) : what.slice(0, 220)) : "") + turn;
    };
    const chars = (src.characters || []).filter(c => c && clean(c.name)).slice(0, 14).map(c => {
      const bits = [clean(c.role), clean(c.conscious) ? "wants " + clean(c.conscious).slice(0, 80) : "", clean(c.unconscious) ? "needs " + clean(c.unconscious).slice(0, 80) : ""].filter(Boolean);
      return clean(c.name) + (bits.length ? " — " + bits.join("; ") : "");
    });
    const build = (short, scenesShown, synMax) => {
      const st = story.map(l => /^SYNOPSIS: /.test(l) ? l.slice(0, synMax) : l);
      const list = scenes.slice(0, scenesShown).map((s, i) => sceneLine(s, i, short));
      const more = scenes.length > scenesShown ? "… and " + (scenes.length - scenesShown) + " more scene" + (scenes.length - scenesShown !== 1 ? "s" : "") + " to the end." : "";
      return [head, st.join("\n"), scenes.length ? "THE STORY, SCENE BY SCENE (" + scenes.length + "):\n" + list.join("\n") + (more ? "\n" + more : "") : "",
        chars.length ? "THE PEOPLE (keep their names):\n" + chars.join("\n") : ""].filter(Boolean).join("\n\n");
    };
    // fit the spine build's limit: shorter scene lines first, then fewer of them, then a shorter synopsis
    let out = build(false, scenes.length, 1600);
    if(out.length > BRIEF_MAX) out = build(true, scenes.length, 1200);
    for(let n = scenes.length; out.length > BRIEF_MAX && n > 6; n = Math.floor(n * 0.8)) out = build(true, n, 900);
    if(out.length > BRIEF_MAX) out = build(true, Math.min(6, scenes.length), 500);
    return out.slice(0, BRIEF_MAX);
  }

  root.AdaptFilm = { composeBrief, MODES, BRIEF_MAX };
})(typeof window !== "undefined" ? window : globalThis);
