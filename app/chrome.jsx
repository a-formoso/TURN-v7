/* chrome.jsx — TopBar + LeftRail */

/* The product is KINOLOT (say KEE-no-lot), by Infinite Studio AI — owner decision 2026-09-28.
   "TURN" is the internal codename only (TURN.html, turn_* tables, window.TURN_* …) and never
   appears in copy a user can see.

   The mark is "The Lot" (owner decision 2026-09-28, logo direction B): three soundstage bays with
   arched roofs on a baseline — the middle bay filled amber, the outer bays outlined in the text
   colour (currentColor, so it follows the dark and paper themes). KINOLOT_MARK is the ONE geometry
   every logo draws: this component, favicon.svg (a thicker 16/32px cut of the same bays), the app
   icon and the share image (apple-touch-icon.png, og-image.png — rendered by
   scripts/render-identity.mjs). scripts/test-identity.mjs pins them together. The value-charge
   zig-zag is the story graph's glyph, not the logo. */
const KINOLOT_MARK = Object.freeze({
  box:"0 0 64 64",           // the reference box the geometry is drawn in
  crop:"4 20 56 29.25",      // the mark's own bounds (strokes included), for inline use. Its BOTTOM is the ground
                             // line's bottom edge (47.5 + 3.5/2), so on a baseline-aligned row the roofs stand on the
                             // text line exactly (owner 2026-09-29: "the logo sits at the bottom with its text")
  outer:Object.freeze(["M9 46 V31 A7.5 7.5 0 0 1 24 31 V46", "M40 46 V31 A7.5 7.5 0 0 1 55 31 V46"]),
  middle:"M24.5 46 V31 A7.5 7.5 0 0 1 39.5 31 V46 Z",
  base:"M6 47.5 H58",
  stroke:3.5,
  amber:"#F29A43",           // ≈ --accent oklch(0.76 0.145 62), fixed so the mark reads the same on every surface
});
window.KINOLOT_MARK = KINOLOT_MARK;
/* the mark alone, decorative (the wordmark or the surrounding button names it). Sized by CSS
   (.brand-mark and each surface's rule); the drawing is anchored to the box's bottom edge. The amber bay is drawn
   first so the outer bays' inner walls sit on its edges and its roof lines up with theirs. */
function BrandMark(){
  const M = KINOLOT_MARK, ce = React.createElement;
  return ce("svg",{ className:"brand-mark", viewBox:M.crop, preserveAspectRatio:"xMidYMax meet", fill:"none", "aria-hidden":"true", focusable:"false" },
    ce("path",{ className:"brand-mark-bay", d:M.middle, fill:M.amber, stroke:M.amber, strokeWidth:M.stroke, strokeLinejoin:"round" }),
    ce("g",{ stroke:"currentColor", strokeWidth:M.stroke, strokeLinejoin:"round", strokeLinecap:"round" },
      ce("path",{ d:M.outer[0] }), ce("path",{ d:M.outer[1] }), ce("path",{ d:M.base })));
}
window.BrandMark = BrandMark;
/* the wordmark: "Kinolot" in Spectral 600, one colour — the mark carries the amber (.brand-name) */
function BrandWordmark(){
  return React.createElement("span",{className:"brand-name"},"Kinolot");
}
window.BrandWordmark = BrandWordmark;

/* "N of M scenes drafted" for the Film menu (2026-11-12, audit A9). A rough stand-in — the structural draft the app
   puts in from the beat cards when the writing engine fails — used to be counted as drafted, so a film read
   "16 of 16" with scenes nobody had written. It is counted apart and named. */
function filmDraftedLabel(scenes, drafts){
  const list = Array.isArray(scenes) ? scenes : [], D = drafts || {};
  const standIn = (d)=> (typeof window!=="undefined" && typeof window.isStandInDraft==="function") ? !!window.isStandInDraft(d) : false;
  let written = 0, rough = 0;
  list.forEach(s=>{ const d = s && D[s.id]; if(!d) return; if(standIn(d)) rough++; else written++; });
  return written+" of "+list.length+" scenes drafted"+(rough ? " \u00b7 "+rough+" rough stand-in"+(rough!==1?"s":"") : "");
}
window.filmDraftedLabel = filmDraftedLabel;
function ExportMenu({ project, scenes, drafts, onReset }){
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(()=>{
    if(!open) return;
    const close=(e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return ()=>document.removeEventListener("mousedown", close);
  },[open]);
  const draftedLabel = filmDraftedLabel(scenes, drafts);
  const run=(kind)=>{ setOpen(false); try{ window.TURNExport[kind](project, scenes, drafts); }catch(e){ console.error(e); } };
  const items=[
    ["pdf", Icon.film, "Screenplay (PDF)", "Preview, then print / save as PDF"],
    ["fountain", Icon.script, "Screenplay (.fountain)", "Opens in Final Draft, Highland\u2026"],
    ["outline", Icon.layers, "Story outline (.txt)", "Premise, idea & spine"],
    ["csv", Icon.grid, "Spine data (.csv)", "Scenes, charges, turns"],
  ];
  return React.createElement("div",{className:"export-wrap",ref:ref},
    React.createElement("button",{className:`tb-btn ${open?"on":""}`,onClick:()=>setOpen(o=>!o),title:"Export the screenplay / story"},
      React.createElement(Icon.download,{s:14})),
    open && React.createElement("div",{className:"export-menu"},
      React.createElement("div",{className:"export-head"},
        "Export \u00b7 ",React.createElement("span",{style:{color:"var(--txt-2)"}}, draftedLabel)),
      items.map(([kind,Ic,title,sub])=>
        React.createElement("button",{key:kind,className:"export-item",onClick:()=>run(kind)},
          React.createElement("span",{className:"export-item-ic"},React.createElement(Ic,{s:16})),
          React.createElement("span",{className:"export-item-t"},
            React.createElement("span",{className:"t"},title),
            React.createElement("span",{className:"s"},sub)))),
      // admin-only (app.jsx passes onReset only for the admin account)
      onReset && React.createElement("div",{className:"export-foot"},
        React.createElement("button",{className:"export-item reset",
          onClick:async ()=>{ setOpen(false); const ok=await window.appConfirm({title:"Reset to the sample story?",body:"This permanently discards your edits, drafts and version history.",confirmLabel:"Reset",danger:true}); if(ok) onReset(); }},
          React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.undo,{s:16})),
          React.createElement("span",{className:"export-item-t"},
            React.createElement("span",{className:"t"},"Reset to sample story"),
            React.createElement("span",{className:"s"},"Discard edits, restore The Matrix demo")))) ));
}

/* the top bar's "Brief" button shows only in the Writers' Room, once the film has a brief or a
   logline to show. One rule for the button and for its ⋯ menu entry on a phone. */
function storyBriefShown(room, project){
  return room==="writers" && !!project && !!(project.sourceBrief||project.logline||project.premise);
}
window.storyBriefShown = storyBriefShown;

/* OverflowMenu — the top bar's "Film ⋯" menu (homepage style, owner 2026-10-16): in every room and at
   every width it holds the film's actions the bar no longer shows as buttons — New Story, the Story
   brief, Team, the exports (the Writers' Room's screenplay formats, the Art Room's shot list /
   stripboard / art bible), Appearance (light / dark / system)
   and the admin-only Reset (Render styles and API keys moved to the account menu, 2026-10-22). On a phone it also lists the Art
   Room tabs. */
const FILM_EXPORTS = [
  ["pdf", Icon.film, "Screenplay (PDF)", "Preview, then print / save as PDF"],
  ["fountain", Icon.script, "Screenplay (.fountain)", "Opens in Final Draft, Highland…"],
  ["outline", Icon.layers, "Story outline (.txt)", "Premise, idea & spine"],
  ["csv", Icon.grid, "Spine data (.csv)", "Scenes, charges, turns"],
];
function OverflowMenu({ onNewStory, onImportScript, onImportDraft, project, scenes, drafts, onReset, room, artView, setArtView, artTabLocks, hiddenArtTabs, theme, onTheme }){
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(()=>{
    if(!open) return;
    const close=(e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return ()=>document.removeEventListener("mousedown", close);
  },[open]);
  const run=(kind)=>{ setOpen(false); try{ window.TURNExport[kind](project, scenes, drafts); }catch(e){ console.error(e); } };
  // export: a Writers' Room action, only once a story exists (the Film menu shows in the Stage too since 2026-10-16)
  const inWriters = room==="writers" && (scenes||[]).length>0;
  const draftedLabel = filmDraftedLabel(scenes, drafts);
  const themeNow = ["light","dark","system"].indexOf(theme)>=0 ? theme : "system";
  const artExports = room!=="art" ? [] : [
    typeof window.turnExportShotList==="function" && ["shots","Export shot list","Printable AD-style table",()=>window.turnExportShotList()],
    typeof window.turnExportBreakdown==="function" && ["strip","Export stripboard","One coloured strip per scene",()=>window.turnExportBreakdown()],
    typeof window.turnExportArtBible==="function" && ["bible","Export art department bible","Cast, props and locations",()=>window.turnExportArtBible()],
  ].filter(Boolean);
  // PHONE ONLY (CSS shows .export-art-tabs at ≤700px, where the tab bar is icons only): the Art Room
  // tabs by name, each locked one with its padlock and the step it follows (docs/Story Pipeline.md
  // step 9) — named like the tab bar, with the format's department name in brackets where it differs
  // ("unlocks after Characters (Subjects)"). A locked tab still opens — onto its lock card.
  const artTabs = (room==="art" && typeof setArtView==="function")
    ? (window.ART_TABS||[]).filter(t=>!(hiddenArtTabs&&hiddenArtTabs[t.id])) : [];
  // The Story brief (with its "Rebuild as a new film") and Team live here at every width since the
  // homepage-style bar (2026-10-16). The brief shows by storyBriefShown; Team while team.jsx registers
  // window.turnTeamMenu for a saved film (its own top-bar button stays mounted but hidden, so its
  // window still opens from here).
  // TEAM IS COMING SOON (owner decision 2026-10-02): for everyone but the admin the entry
  // team.jsx registers is { soon:true, hint, notify } — shown with a "Soon" chip, disabled-
  // looking (aria-disabled), and a tap only closes the menu and shows the coming-soon notice.
  const briefShown = storyBriefShown(room, project);
  const teamEntry = window.turnTeamMenu || null;
  const team = teamEntry && (typeof teamEntry.open==="function" || teamEntry.soon) ? teamEntry : null;
  const openBrief = ()=>{ setOpen(false); window.dispatchEvent(new CustomEvent("turn-open-brief")); };
  // "Film ⋯" shows in every room at every width (homepage style, 2026-10-16); on a phone it
  // folds to the ⋯ alone (styles.css)
  return React.createElement("div",{className:"overflow-wrap film-menu"+(room==="art"?" in-art":""),ref:ref},
    React.createElement("button",{type:"button",className:`tb-btn film-menu-btn ${open?"on":""}`,onClick:()=>setOpen(o=>!o),
        "aria-label":"Film menu — more actions","aria-haspopup":"menu","aria-expanded":open?"true":"false",
        title:"Film — new story, brief, team, export, appearance"},
      React.createElement("span",{className:"film-menu-lab"},"Film"),
      React.createElement("span",{className:"film-menu-dots","aria-hidden":"true"},"⋯")),
    open && React.createElement("div",{className:"export-menu film-menu-pop",style:{maxWidth:"min(300px, calc(100vw - 24px))"}},
      React.createElement("button",{className:"export-item",onClick:()=>{ setOpen(false); onNewStory&&onNewStory(); }},
        React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.plus,{s:16})),
        React.createElement("span",{className:"export-item-t"},
          React.createElement("span",{className:"t"},"New Story"),
          React.createElement("span",{className:"s"},"Start from an idea"))),
      // IMPORT A SCREENPLAY / A NEW DRAFT (2026-10-18, docs/Script Import Plan.md)
      typeof onImportScript==="function" && React.createElement("button",{className:"export-item",onClick:()=>{ setOpen(false); onImportScript(); }},
        React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.script,{s:16})),
        React.createElement("span",{className:"export-item-t"},
          React.createElement("span",{className:"t"},"Import a screenplay"),
          React.createElement("span",{className:"s"},"A finished script, word for word, as a new film"))),
      typeof onImportDraft==="function" && React.createElement("button",{className:"export-item",onClick:()=>{ setOpen(false); onImportDraft(); }},
        React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.refresh||Icon.history||Icon.script,{s:16})),
        React.createElement("span",{className:"export-item-t"},
          React.createElement("span",{className:"t"},"Import a new draft"),
          React.createElement("span",{className:"s"},"A revised draft of this film\u2019s script \u2014 matched scene by scene"))),
      briefShown && React.createElement("button",{type:"button",className:"export-item",onClick:openBrief},
        React.createElement("span",{className:"export-item-ic"},React.createElement((Icon.book||Icon.file||Icon.layers),{s:16})),
        React.createElement("span",{className:"export-item-t"},
          React.createElement("span",{className:"t"},"Story brief"),
          React.createElement("span",{className:"s"},project.sourceBrief
            ? "What this story was built from · rebuild as a new film"
            : "The logline this story was built from"))),
      team && team.soon && React.createElement("button",{type:"button",className:"export-item is-soon",
          "aria-disabled":"true",title:team.hint,
          onClick:()=>{ setOpen(false); if(typeof team.notify==="function") team.notify(); }},
        React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.user,{s:16})),
        React.createElement("span",{className:"export-item-t"},
          React.createElement("span",{className:"t"},"Team"),
          team.hint && React.createElement("span",{className:"s"},team.hint)),
        React.createElement("span",{className:"soon-chip","aria-hidden":"true"},"Soon")),
      team && !team.soon && React.createElement("button",{type:"button",className:"export-item",onClick:()=>{ setOpen(false); team.open(); }},
        React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.user,{s:16})),
        React.createElement("span",{className:"export-item-t"},
          React.createElement("span",{className:"t"},"Team"),
          team.hint && React.createElement("span",{className:"s"},team.hint))),
      artTabs.length>0 && React.createElement("div",{className:"export-art-tabs",role:"group","aria-label":"Art Room tabs"},
        React.createElement("div",{className:"export-subhead"},"Art Room tabs"),
        artTabs.map(t=>{
          const lock = artTabLocks && artTabLocks[t.id];
          const locked = !!(lock && lock.locked);
          const TabIc = Icon[t.icon]||Icon.user;
          return React.createElement("button",{key:"tab-"+t.id,type:"button",
              className:"export-item"+(locked?" is-locked":"")+(artView===t.id?" on":""),
              "aria-current":artView===t.id?"page":undefined,
              title:locked ? (t.label+" \u2014 locked. "+lock.waitingFor) : t.label,
              onClick:()=>{ setOpen(false); setArtView(t.id); }},
            React.createElement("span",{className:"export-item-ic"},React.createElement(locked?(Icon.padlock||TabIc):TabIc,{s:16})),
            React.createElement("span",{className:"export-item-t"},
              React.createElement("span",{className:"t"},t.label),
              locked && React.createElement("span",{className:"s"},"Locked \u00b7 unlocks after "+(lock.afterLabel||lock.unlockLabel))));
        })),
      inWriters && React.createElement("div",{className:"export-subhead"},"Export · ",
        React.createElement("span",{className:"film-menu-count"},draftedLabel)),
      inWriters && FILM_EXPORTS.map(([kind,Ic,title,sub])=>
        React.createElement("button",{key:kind,className:"export-item",onClick:()=>run(kind)},
          React.createElement("span",{className:"export-item-ic"},React.createElement(Ic,{s:16})),
          React.createElement("span",{className:"export-item-t"},
            React.createElement("span",{className:"t"},title),
            React.createElement("span",{className:"s"},sub)))),
      // Art Room exports live HERE, not on the Art Room screen (user ruling 2026-07-19).
      // Each registers itself while it can run: the shot list from the Shots tab, the
      // stripboard from the Breakdown tab, the art department bible from any Art Room tab.
      artExports.length>0 && React.createElement(React.Fragment,null,
        React.createElement("div",{className:"export-subhead"},"Export"),
        artExports.map(([key,title,sub,fn])=>
          React.createElement("button",{key,className:"export-item",onClick:()=>{ setOpen(false); fn(); }},
            React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.download,{s:16})),
            React.createElement("span",{className:"export-item-t"},
              React.createElement("span",{className:"t"},title),
              React.createElement("span",{className:"s"},sub))))),
      // (owner 2026-10-28) no Always-show-prompts switch here any more: every card has its prompt as a folded section
      // APPEARANCE — the theme switch the bar used to carry as an icon (the menu stays open: it's a setting)
      onTheme && React.createElement(React.Fragment,null,
        React.createElement("div",{className:"export-subhead"},"Appearance"),
        React.createElement("div",{className:"film-theme-row",role:"group","aria-label":"Appearance"},
          [["light","Light",Icon.sun],["dark","Dark",Icon.moon],["system","System",Icon.monitor]].map(([m,lab,Ic])=>
            React.createElement("button",{key:m,type:"button",className:"film-theme-btn"+(themeNow===m?" on":""),
                "aria-pressed":themeNow===m?"true":"false",title:lab+" mode",onClick:()=>onTheme(m)},
              React.createElement(Ic,{s:14}),lab)))),
      // (Render styles and API keys moved to the account menu's Admin group, owner 2026-10-22)
      // admin-only (app.jsx passes onReset only for the admin account)
      onReset && React.createElement("div",{className:"export-foot"},
        React.createElement("button",{className:"export-item reset",
          onClick:async ()=>{ setOpen(false); const ok=await window.appConfirm({title:"Reset to the sample story?",body:"This permanently discards your edits, drafts and version history.",confirmLabel:"Reset",danger:true}); if(ok) onReset(); }},
          React.createElement("span",{className:"export-item-ic"},React.createElement(Icon.undo,{s:16})),
          React.createElement("span",{className:"export-item-t"},
            React.createElement("span",{className:"t"},"Reset to sample story"))))));
}
window.OverflowMenu = OverflowMenu;

/* ViewNav — the room's view tabs (Writers' Spine/Audit/Board/Script, or the Art
   Room tabs) as a full-width bar directly beneath the top bar, at every screen
   size. Moved out of the top bar to free its space; the panel toggles ride along
   at the edges (Writers' Room only). Replaces the old mobile-only bottom bar. */
/* the Art Room's page heading: each tab's title and what it holds (homepage style, 2026-10-16) */
const ART_TITLES = { lookbook:["The ","lookbook."], characters:["The ","cast."], props:["The ","props."],
  locations:["Every place, ","as one set."], stylebible:["The ","color script."], shots:["The ","shots."],
  storyboard:["The ","storyboards."], breakdown:["The ","breakdown."] };
const ART_SUBS = {
  lookbook:"The film's visual north star: a short statement and the references every department reads.",
  characters:"A reference sheet for every character, and how each one's look changes across the film.",
  props:"Every object the story handles; a worn or carried prop matches its owner's look.",
  locations:"Reusable sets for every scene, built from the screenplay. A place and its rooms are one set: the place's image comes first, and its rooms take their look from it.",
  stylebible:"The film's colour system, and the look of every scene.",
  shots:"Every beat broken into shots, with their frames rendered in order.",
  storyboard:"Each scene's boards, composed from its rendered shot frames.",
  breakdown:"What every scene still needs before it can be shot." };
function ViewNav({ room, view, setView, artView, setArtView, railOpen, inspOpen, onToggleRail, onToggleInsp, onCoordinate, onProductionCheck, productionReadOnly, onAgents, staleTabs, attnTabs, hiddenTabs, tabLocks, readOnly, jobTabs }){
  // The Stage is a single full-width assembly view — no sub-view tabs (don't fall through
  // to the Writers' Room tabs); its own header carries the context.
  if(room==="stage") return null;
  // the former Audit tab is the Board's Table layout
  const writersNav = [["spine","Spine",Icon.graph],["board","Board",Icon.board],["script","Script",Icon.script]];
  // a format may hide tabs entirely (registry `tabs` map — used sparingly)
  const artNav = (window.ART_TABS||[]).filter(t=>!(hiddenTabs&&hiddenTabs[t.id])).map(t=>[t.id,t.label,Icon[t.icon]||Icon.user]);
  const inArt = room==="art";
  const nav = inArt ? artNav : writersNav;
  const cur = inArt ? artView : view;
  const setCur = inArt ? setArtView : setView;
  // Each room's primary action, pinned to the right of the centered tab strip:
  // Art Room → Run pre-production only; Writers' Room → the Story Editors panel.
  const cta = inArt
    ? (onCoordinate && React.createElement("button",{className:"tb-btn accent vn-cta",onClick:onCoordinate,disabled:readOnly,
          title:readOnly?"Your role can't change the Art Room here, so pre-production can't run":"Art Coordinator — runs pre-production in dependency order: lookbook → cast → props → wardrobe → locations → colour → shot coverage, in one click (shot frames and storyboards stay in their tabs)"},
          React.createElement(Icon.robot,{s:14}),React.createElement("span",{className:"vn-cta-lab"},"Run pre-production")))
    : (onAgents && React.createElement("button",{className:"tb-btn accent vn-cta",onClick:onAgents,disabled:readOnly,
        title:readOnly?"Your role can't change the story here, so the Story Editors can't run":"Story Editors — AI editors that refine your story: Story Doctor, Script Supervisor, Setups & Payoffs, Final Read"},
        React.createElement(Icon.robot,{s:14}),React.createElement("span",{className:"vn-cta-lab"},"Story Editors")));
  const tabButtons = nav.map(([id,lab,Ic])=>{
          // TAB LOCKS (docs/Story Pipeline.md step 9): a locked Art Room tab stays visible with a
          // padlock; clicking it still opens the tab, which shows its lock card (what it waits for
          // + a button to the step that unlocks it). Its accessible name says "locked".
          const lock = inArt && tabLocks && tabLocks[id];
          const locked = !!(lock && lock.locked);
          // yellow "needs you" dot beats the amber lookbook-stale dot when both apply —
          // it marks a waiting one-tap action, not just drift
          const attn = !locked && inArt && attnTabs && attnTabs[id];
          const stale = !locked && inArt && staleTabs && staleTabs[id];
          // (2026-10-30) a tab still working while you look at another one (turnArtJobs) — e.g. "Generating images · 3 of 8"
          const job = inArt && cur!==id && jobTabs && jobTabs[id];
           return React.createElement("button",{key:id,className:`seg ${cur===id?"on":""}${locked?" locked":""}`,onClick:()=>setCur(id),
             "aria-current":cur===id?"page":undefined,
            "aria-label": locked ? (lab+" (locked)") : undefined,
            title: locked ? (lab+" \u2014 locked. "+lock.waitingFor)
              : job ? (lab+" \u2014 still working: "+job)
              : attn ? (lab+" — a character sheet is waiting to wear its new props: tap \u201cUpdate sheet with new wardrobe\u201d on the card")
              : (stale ? (lab+" — the Lookbook changed since this was drafted") : lab)},
            React.createElement(Ic,{s:14}),React.createElement("span",{className:"seg-lab"},lab),
            locked ? React.createElement("span",{className:"seg-lock","aria-hidden":"true"},React.createElement(Icon.padlock||Icon.alert,{s:12}))
              : job ? React.createElement("span",{className:"seg-job-dot","aria-label":"still working"})
              : attn ? React.createElement("span",{className:"seg-attn-dot"})
              : (stale && React.createElement("span",{className:"seg-stale-dot"})));
        });
  // (the Art Room's "Blender Studio" button was here until 2026-11-16: owner, "Remove it now". Locations are built in
  // 3D in the browser, in each card's 4 · Previs. The workspace's code and its server side are untouched.)
  const studioBtn = null;
  // the 1st-AD pass: the script read into the cast sheets, then every Art Room layer
  // held to the script. Open to a Writer too (its script cards are theirs to apply).
  const productionBtn = inArt && onProductionCheck && React.createElement("button",{type:"button",className:"tb-btn vn-studio",
    onClick:onProductionCheck,disabled:!!productionReadOnly,"aria-label":"Production check",
    title:productionReadOnly?"Your role can't change this film's script or Art Room here, so the Production check can't run"
      :"Production check — reads the script into the cast sheets (pronouns, scale, details, voice), then holds props, locations, render styles, wardrobe and shots to the script. Every change asks for your approval."},
    React.createElement(Icon.clipboard||Icon.check,{s:14}),React.createElement("span",{className:"vn-cta-lab"},"Production check"));
  // THE ART ROOM'S PAGE HEADING (homepage style, owner 2026-10-16 — "update the Art Room UI the same way"
  // as the Writers' Room): eyebrow, the tab's title, what it holds, the room's three actions on the right,
  // and the eight tabs as underlined text below (the same tab buttons: locks, dots and names unchanged).
  // It keeps the .viewnav class, so the focus-the-current-tab code still finds its tab.
  if(inArt){
    const t = ART_TITLES[cur] || ["The ", String(((window.ART_TABS||[]).find(x=>x.id===cur)||{}).label||"Art Room").toLowerCase()+"."];
    return React.createElement("header",{className:"viewnav viewnav-art art-head"},
      React.createElement("div",{className:"wr-head-in art-head-in"},
        React.createElement("div",{className:"art-head-top"},
          React.createElement("div",{className:"wr-head-copy"},
            // the open tab's department ("Storyboard Artist" and its \u24d8) joins the eyebrow (owner 2026-10-24): each tab
            // renders it through ArtDeptTitle, which portals into this slot
            React.createElement("div",{className:"wr-eyebrow art-eyebrow"},"02 \u00b7 Pre-production",
              React.createElement("span",{id:"art-dept-slot",className:"art-dept-slot"})),
            React.createElement("h1",{className:"wr-title"},t[0],React.createElement("em",null,t[1])),
            React.createElement("p",{className:"wr-sub"},ART_SUBS[cur]||"")),
          React.createElement("div",{className:"wr-actions art-head-actions"},
            studioBtn, productionBtn, cta)),
        React.createElement("nav",{className:"art-tabs","aria-label":"Art Room views"},
          // on a narrow screen the row scrolls sideways: keep the open tab in view
          React.createElement("div",{className:"segmented art-tabs-row",onScroll:(e)=>turnTabEdgeFade(e.currentTarget),ref:(el)=>{
            if(!el) return;
            if(el.scrollWidth>el.clientWidth){
              const on = el.querySelector(".seg.on");
              if(on) el.scrollLeft = Math.max(0, on.offsetLeft - el.offsetLeft - 16); }
            turnTabEdgeFade(el); }},tabButtons))));
  }
  // viewnav-art: the Art Room's eight tabs + three actions need their own narrow-width rule (styles.css)
  return React.createElement("nav",{className:"viewnav"+(inArt?" viewnav-art":""),"aria-label":inArt?"Art Room views":"Writers' Room views"},
    // LEFT zone — story-panel toggle. DRAWER MODES ONLY (hidden ≥1100px via CSS):
    // on desktop the panels collapse/expand from inside (panel-collapse / CollapsedStrip).
    React.createElement("div",{className:"vn-side vn-left"},
      !inArt && React.createElement("button",{className:`tb-icon vn-paneltoggle ${railOpen?"on":""}`,onClick:onToggleRail,
        "aria-pressed":railOpen?"true":"false","aria-label":"Toggle story panel",title:"Toggle story panel"},
        React.createElement(Icon.panelLeft,{s:16}))),
    // CENTER — the room's view tabs WITH the room's agent CTA, centered as one unit
    React.createElement("div",{className:"vn-center"},
      React.createElement("div",{className:"segmented"},tabButtons),
      studioBtn,
      productionBtn,
      cta),
    // RIGHT zone — the inspector toggle, drawer modes only (balances the left zone)
    React.createElement("div",{className:"vn-side vn-right"},
      !inArt && React.createElement("button",{className:`tb-icon vn-paneltoggle ${inspOpen?"on":""}`,onClick:onToggleInsp,
        "aria-pressed":inspOpen?"true":"false","aria-label":"Toggle inspector",title:"Toggle inspector"},
        React.createElement(Icon.panelRight,{s:16}))));
}
window.ViewNav = ViewNav;

/* ArtDeptTitle — an Art Room tab's department name and its \u24d8 ("Storyboard Artist"), shown in the page heading's eyebrow
   ("02 \u00b7 PRE-PRODUCTION \u00b7 STORYBOARD ARTIST \u24d8", owner 2026-10-24) instead of a row of its own. With no heading on
   the page it renders where it stands, as before. */
/* a tab kept alive for its background work (ArtRoom, 2026-10-30) is hidden: its department name stays out of the heading */
const ArtPaneHidden = (typeof React.createContext==="function") ? React.createContext(false) : null;
window.ArtPaneHidden = ArtPaneHidden;
function ArtDeptTitle({ className, style, children }){
  const paneHidden = (ArtPaneHidden && typeof React.useContext==="function") ? React.useContext(ArtPaneHidden) : false;
  const find = ()=> (typeof document!=="undefined" && document.getElementById) ? document.getElementById("art-dept-slot") : null;
  const [slot, setSlot] = React.useState(find);
  React.useEffect(()=>{ const s = find(); if(s!==slot) setSlot(s); });
  if(paneHidden) return null;
  if(slot && slot.isConnected && typeof ReactDOM!=="undefined" && ReactDOM.createPortal)
    return ReactDOM.createPortal(React.createElement("span",{className:"art-dept"},
      React.createElement("span",{className:"art-dept-sep","aria-hidden":"true"},":"), children), slot);
  return React.createElement("div",{className,style},children);
}
window.ArtDeptTitle = ArtDeptTitle;

/* WritersHeader — the Writers' Room page heading in the homepage style (owner 2026-10-16, from the
   "Kinolot Rooms in the Homepage Style" board): the room's eyebrow, the view as a big Spectral title
   ("The value spine." / "The story board." / "The screenplay."), what the view shows (the film's name /
   scene count / length line was dropped, owner 2026-10-20: it read as stray text), and on the right the Spine / Board / Script tabs over the two actions: Draft scene (the
   selected scene — or Open script once it's drafted) and the amber Story Editors. Replaces the
   Writers' Room's ViewNav bar; the panel toggles ride along below 1100px, as they did there. */
const WRITERS_TITLES = { spine:["The value ","spine."], board:["The story ","board."], script:["The ","screenplay."] };
/* each view's department (owner 2026-10-24) and what its \u24d8 says */
const WRITERS_DEPTS = {
  spine:["Story Architect","The value spine: every scene's emotional charge from where it opens to where it closes, end to end \u2014 above the line it closes positive, below it negative. Follow a character to see the scenes they drive; drag a scene card, or use its \u22ee \u2192 Move to\u2026, to reorder; the Key names the colours."],
  board:["Head Writer","The story board: every scene as a card, grouped by act. Columns shows the shape of each act; Table reads every scene's turn at once. Click a card to open it in the Scene panel."],
  script:["Screenwriter","The screenplay, scene by scene: draft a scene from its card and beats, redraft it, edit it by hand and check its continuity. Every draft is kept in the scene's version history."],
};
function WritersHeader({ view, setView, project, scenes, runtimeTotal, sub, scene, sceneDrafted, drafting,
                         onDraftScene, onAgents, readOnly, railOpen, inspOpen, onToggleRail, onToggleInsp }){
  const h = React.createElement;
  const tabs = [["spine","Spine"],["board","Board"],["script","Script"]];
  const t = WRITERS_TITLES[view] || WRITERS_TITLES.spine;
  const no = scene ? String(scene.no||"").padStart(2,"0") : "";
  // the selected scene's next step: draft it (the beats are authored first when it has none), or read it
  const showDraft = view!=="script" && !!scene && typeof onDraftScene==="function";
  const draftLab = sceneDrafted ? "Open script" : (drafting ? "Drafting…" : "Draft scene");
  const draftTitle = sceneDrafted ? ("Open Scene "+no+"'s screenplay in the Script view")
    : readOnly ? "Your role can't change the story here, so scenes can't be drafted"
    : drafting ? "A draft is being written — the Script view shows its progress"
    : ("Draft Scene "+no+(scene && scene.title ? " — "+scene.title : "")+": writes its screenplay from the card and its beats (writing credits)");
  return h("header",{className:"wr-head"},
    h("div",{className:"wr-head-in"},
      h("div",{className:"wr-head-copy"},
        // the view's department joins the eyebrow, as in the Art Room (owner 2026-10-24): "01 · Development: Story Architect \u24d8"
        h("div",{className:"wr-eyebrow art-eyebrow"},"01 · Development",
          WRITERS_DEPTS[view] && h("span",{className:"art-dept"},
            h("span",{className:"art-dept-sep","aria-hidden":"true"},":"), WRITERS_DEPTS[view][0],
            window.InfoTip && h(window.InfoTip,{label:"About the "+(view==="script"?"Script":view==="board"?"Board":"Spine"),text:WRITERS_DEPTS[view][1]}))),
        h("h1",{className:"wr-title"},t[0],h("em",null,t[1])),
        sub ? h("p",{className:"wr-sub"},String(sub).replace(/\.?\s*$/,".")) : null),
      h("div",{className:"wr-head-side"},
        h("nav",{className:"wr-tabs","aria-label":"Writers' Room views"},
          tabs.map(([id,lab])=>h("button",{key:id,type:"button",className:"wr-tab"+(view===id?" on":""),
            "aria-current":view===id?"page":undefined,onClick:()=>setView(id)},lab))),
        h("div",{className:"wr-actions"},
          // story-panel / inspector toggles: drawer and tablet widths only (hidden ≥1100px, as in ViewNav)
          onToggleRail && h("button",{type:"button",className:`tb-icon vn-paneltoggle wr-paneltoggle ${railOpen?"on":""}`,onClick:onToggleRail,
            "aria-pressed":railOpen?"true":"false","aria-label":"Toggle story panel",title:"Toggle story panel"},
            h(Icon.panelLeft,{s:16})),
          showDraft && h("button",{type:"button",className:"hs-btn wr-draft",onClick:onDraftScene,
            disabled:!sceneDrafted && (readOnly || !!drafting),title:draftTitle},
            h(sceneDrafted ? Icon.script : Icon.pencil,{s:15}),draftLab),
          onAgents && h("button",{type:"button",className:"hs-btn primary wr-agents vn-cta",onClick:onAgents,disabled:readOnly,
            title:readOnly?"Your role can't change the story here, so the Story Editors can't run":"Story Editors — AI editors that refine your story: Story Doctor, Script Supervisor, Setups & Payoffs, Final Read"},
            h("span",{className:"vn-cta-lab"},"Story Editors"),h("span",{className:"wr-arrow","aria-hidden":"true"},"→")),
          onToggleInsp && h("button",{type:"button",className:`tb-icon vn-paneltoggle wr-paneltoggle ${inspOpen?"on":""}`,onClick:onToggleInsp,
            "aria-pressed":inspOpen?"true":"false","aria-label":"Toggle inspector",title:"Toggle inspector"},
            h(Icon.panelRight,{s:16}))))));
}
window.WritersHeader = WritersHeader;

const ROOMS = [
  { id:"writers", label:"Writers' Room", phase:"Development", icon:"script", live:true, entitlement:"writers_room" },
  { id:"art", label:"The Art Room", phase:"Pre-production", icon:"palette", live:true, entitlement:"art_room" },
  { id:"stage", label:"The Stage", phase:"Production", icon:"clapper", live:true, entitlement:"stage" },
  { id:"cutting", label:"The Cutting Room", phase:"Post", icon:"scissorsCut", live:false },
];
window.ROOMS = ROOMS;

function RoomSwitcher({ room, setRoom, hasStory, roomEntitlements }){
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(()=>{
    const h=(e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h);
  },[]);
  const cur = ROOMS.find(r=>r.id===room) || ROOMS[0];
  // until a story exists, every room downstream of the Writers' Room is locked
  const planLocked = (r)=> r.live && r.id!=="writers" && roomEntitlements && roomEntitlements[r.entitlement]===false;
  const storyLocked = (r)=> r.live && r.id!=="writers" && !hasStory;
  const locked = (r)=> planLocked(r) || storyLocked(r);
  const lockLabel = (r)=>{
    // on a shared film the rooms follow the OWNER's plan (Team, 2026-10-03): not the viewer's to upgrade
    if(planLocked(r) && roomEntitlements && roomEntitlements.shared) return "Not on this film's plan";
    if(planLocked(r)) return (typeof window.turnRoomRequiredPlan==="function" ? window.turnRoomRequiredPlan(r.id) : "Upgrade")+" plan";
    if(storyLocked(r)) return "Needs a story";
    return "";
  };
  return React.createElement("div",{className:"room-switch",ref},
    React.createElement("button",{className:"room-btn",onClick:()=>setOpen(o=>!o),
      "aria-haspopup":"menu","aria-expanded":open?"true":"false","aria-label":`Production room: ${cur.label}`},
      React.createElement("span",{className:"room-btn-ic"},React.createElement(Icon[cur.icon]||Icon.script,{s:14})),
      React.createElement("span",{className:"room-btn-t"},
        React.createElement("span",{className:"room-btn-name"},cur.label),
        React.createElement("span",{className:"room-btn-phase"},cur.phase)),
      React.createElement(Icon.chevD,{s:14})),
    open && React.createElement("div",{className:"room-menu"},
      React.createElement("div",{className:"room-menu-h"},"Production pipeline"),
      ROOMS.map((r,i)=>
        React.createElement("button",{key:r.id,
          className:`room-item ${room===r.id?"on":""} ${(r.live&&!locked(r))?"":"soon"}`,
           "aria-current":room===r.id?"page":undefined,
           "aria-disabled":(!r.live||locked(r))?"true":undefined,
           "aria-label":`${r.label}, ${r.phase}${!r.live?", coming soon":locked(r)?", "+lockLabel(r):""}`,
          title: planLocked(r) && roomEntitlements && roomEntitlements.shared ? `${r.label} isn't on this film's plan` :
            planLocked(r) ? `${r.label} requires the ${typeof window.turnRoomRequiredPlan==="function" ? window.turnRoomRequiredPlan(r.id) : "right"} plan` :
            storyLocked(r) ? "Create a story first — this room works on your story" : undefined,
           onClick:()=>{ if(r.live&&!locked(r)){ setRoom(r.id); setOpen(false); } }},
          React.createElement("span",{className:"room-item-no"},i+1),
          React.createElement("span",{className:"room-item-ic"},React.createElement(Icon[r.icon]||Icon.script,{s:16})),
          React.createElement("span",{className:"room-item-t"},
            React.createElement("span",{className:"room-item-name"},r.label),
            React.createElement("span",{className:"room-item-phase"},r.phase)),
          !r.live
            ? React.createElement("span",{className:"room-item-soon"},"Soon")
            : locked(r)
              ? React.createElement("span",{className:"room-item-soon"},lockLabel(r))
              : (room===r.id && React.createElement("span",{className:"room-item-dot"}))))));
}

function ThemeToggle({ theme, onTheme }){
  /* one icon; click cycles light → dark → system → light. Shows current mode,
     tooltip says what the next tap will do — far lighter on the bar (esp. mobile). */
  const order = ["light","dark","system"];
  const meta = { light:[Icon.sun,"Light"], dark:[Icon.moon,"Dark"], system:[Icon.monitor,"System"] };
  const cur = order.indexOf(theme)>=0 ? theme : "system";
  const next = order[(order.indexOf(cur)+1) % order.length];
  const [Ic, lbl] = meta[cur];
  return React.createElement("button",{className:"tb-icon theme-cycle",onClick:()=>onTheme(next),
    title:`${lbl} mode \u00b7 tap for ${meta[next][1]}`,"aria-label":`Appearance: ${lbl}. Switch to ${meta[next][1]}`},
    React.createElement(Ic,{s:16}));
}
window.ThemeToggle = ThemeToggle;

/* User API keys — stored locally on this device. The server proxy will use these
   per-request when present, falling back to its environment secrets otherwise. */
const TURN_API_KEY_STORE = "turn.providerApiKeys.v1";
const TURN_API_PROVIDERS = [
  { id:"anthropic", label:"Anthropic", hint:"Writing, the Story Editors and Frances when that text provider is selected", placeholder:"sk-ant-..." },
  { id:"openai", label:"OpenAI", hint:"OpenAI text models when selected; GPT Image is routed through fal.ai", placeholder:"sk-..." },
  { id:"google", label:"Google AI Studio", hint:"Gemini text models when selected; Nano Banana images are routed through fal.ai", placeholder:"AIza..." },
  { id:"elevenlabs", label:"ElevenLabs", hint:"Voice design, library, clone, text-to-speech and speech-to-text through the server proxy", placeholder:"sk_..." },
  { id:"fal", label:"fal.ai", hint:"Image generation and Stage video generation through the server proxy", placeholder:"fal..." },
];
function turnSanitizeApiKey(k){
  return String(k||"")
    .replace(/[\s\u00a0\u200b-\u200d\ufeff]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim();
}
function turnReadApiKeys(){
  try{ const j=JSON.parse(localStorage.getItem(TURN_API_KEY_STORE)||"{}"); return (j&&typeof j==="object")?j:{}; }catch(e){ return {}; }
}
function turnWriteApiKeys(keys){
  try{
    const clean={};
    Object.entries(keys||{}).forEach(([id,k])=>{ k=turnSanitizeApiKey(k); if(k) clean[id]=k; });
    Object.keys(clean).length ? localStorage.setItem(TURN_API_KEY_STORE, JSON.stringify(clean)) : localStorage.removeItem(TURN_API_KEY_STORE);
    window.dispatchEvent(new CustomEvent("turn-api-keys-changed"));
  }catch(e){}
}
function turnGetApiKey(id){ return turnSanitizeApiKey(turnReadApiKeys()[id]||""); }
function turnSetApiKey(id, key){ const keys=turnReadApiKeys(); key=turnSanitizeApiKey(key); if(key) keys[id]=key; else delete keys[id]; turnWriteApiKeys(keys); }
function turnHasApiKey(id){ return !!turnGetApiKey(id); }
function turnApiKeysForProxy(ids){
  const keys = turnReadApiKeys(), out = {};
  (ids||[]).forEach(id=>{ const k=turnSanitizeApiKey(keys[id]||""); if(k) out[id]=k; });
  return Object.keys(out).length ? out : undefined;
}
window.turnApiProviders = TURN_API_PROVIDERS;
window.turnSanitizeApiKey = window.turnSanitizeApiKey || turnSanitizeApiKey;
window.turnReadApiKeys = turnReadApiKeys;
window.turnGetApiKey = turnGetApiKey;
window.turnSetApiKey = turnSetApiKey;
window.turnHasApiKey = turnHasApiKey;
window.turnApiKeysForProxy = turnApiKeysForProxy;

function ApiKeysModal({ onClose }){
  const [draft, setDraft] = React.useState({});
  const [tick, setTick] = React.useState(0);
  const saved = turnReadApiKeys();
  React.useEffect(()=>{ const h=(e)=>{ if(e.key==="Escape") onClose(); }; document.addEventListener("keydown",h); return ()=>document.removeEventListener("keydown",h); },[]);
  const setVal = (id,v)=>setDraft(d=>({ ...d, [id]:v }));
  const save = (p)=>{ turnSetApiKey(p.id, draft[p.id]||""); setDraft(d=>({ ...d, [p.id]:"" })); setTick(t=>t+1); if(window.appToast) window.appToast(p.label+" API key saved locally.","success"); };
  const remove = async (p)=>{
    const ok = !window.appConfirm || await window.appConfirm({ title:"Remove API key?", body:"Removes the "+p.label+" key from this browser. Server-side keys, if configured, will still work." });
    if(!ok) return;
    turnSetApiKey(p.id,""); setDraft(d=>({ ...d, [p.id]:"" })); setTick(t=>t+1);
  };
  return React.createElement("div",{className:"bible-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"bible-modal api-keys-mgr",key:tick},
      React.createElement("div",{className:"bible-head"},
        React.createElement("div",{className:"bible-title"},
          React.createElement((Icon.key||Icon.lock||Icon.layers),{s:16}),"API keys",
          React.createElement("span",{className:"bible-sub"},"stored locally on this device")),
        React.createElement("button",{className:"bible-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16}))),
      React.createElement("div",{className:"api-keys-body"},
        React.createElement("div",{className:"api-keys-note"},
          "Keys are saved in this browser only. When a generation uses your server proxy, Kinolot sends the relevant key with that request; if no user key is saved, the proxy falls back to its server secret. They are not synced across devices."),
        TURN_API_PROVIDERS.map(p=>{
          const has = !!saved[p.id];
          const val = draft[p.id] || "";
          return React.createElement("div",{className:"api-key-row",key:p.id},
            React.createElement("div",{className:"api-key-meta"},
              React.createElement("div",{className:"api-key-title"},p.label,
                React.createElement("span",{className:"api-key-status "+(has?"on":"")},has?"saved":"not set")),
              React.createElement("div",{className:"api-key-hint"},p.hint)),
            React.createElement("div",{className:"api-key-edit"},
              React.createElement("input",{className:"api-key-input",type:"password",autoComplete:"off",spellCheck:false,
                value:val,onChange:e=>setVal(p.id,e.target.value),
                placeholder:has?"Paste a new key to replace the saved one":p.placeholder}),
              React.createElement("button",{className:"styles-mini",disabled:!turnSanitizeApiKey(val),onClick:()=>save(p)},"Save"),
              React.createElement("button",{className:"styles-mini danger",disabled:!has,onClick:()=>remove(p),title:"Remove saved key"},
                React.createElement(Icon.trash||Icon.x,{s:14}))));
        }))));
}
window.ApiKeysModal = ApiKeysModal;

/* ADMIN: the Film Bible viewer — the whole continuity JSON the studio reads from,
   shown read-only with a Copy button. getBible() builds it fresh on open. */
function FilmBibleModal({ getBible, onClose }){
  const [copied, setCopied] = React.useState(false);
  const json = React.useMemo(()=>{ try{ return JSON.stringify(getBible()||{}, null, 2); }catch(e){ return "// couldn't build the bible: "+(e&&e.message||e); } },[]);
  const copy = ()=>{ try{ navigator.clipboard.writeText(json); setCopied(true); setTimeout(()=>setCopied(false), 1600); }catch(e){} };
  React.useEffect(()=>{ const h=(e)=>{ if(e.key==="Escape") onClose(); }; document.addEventListener("keydown",h); return ()=>document.removeEventListener("keydown",h); },[]);
  return React.createElement("div",{className:"bible-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"bible-modal"},
      React.createElement("div",{className:"bible-head"},
        React.createElement("div",{className:"bible-title"},
          React.createElement(Icon.layers,{s:16}),"Film Bible — continuity JSON",
          React.createElement("span",{className:"bible-sub"},"deterministic projection of the live story · admin only")),
        React.createElement("div",{className:"bible-head-acts"},
          React.createElement("button",{className:"bible-btn"+(copied?" on":""),onClick:copy},
            React.createElement((Icon[copied?"check":"copy"]||Icon.check),{s:14}), copied?"Copied":"Copy JSON"),
          React.createElement("button",{className:"bible-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16})))),
      React.createElement("pre",{className:"bible-pre"}, json)));
}
window.FilmBibleModal = FilmBibleModal;

/* Manage render styles. Every signed-in user manages their OWN personal locked styles
   (private, capped at 10 — delete to make room). ADMIN additionally sees and manages the
   GLOBAL platform list everyone sees: bundled presets and admin-published styles in one
   curated order. Admin can publish, remove/hide, restore and reorder. The combined global
   pool is capped at 100. Two tiers — see app/artroom.jsx engine + supabase/styles.sql. */
function RenderStylesModal({ onClose }){
  if(typeof window.useRenderStyleVersion==="function") window.useRenderStyleVersion();   // re-render on change
  const isAdmin = !!(window.turnIsStyleAdmin && window.turnIsStyleAdmin());
  const personalCap = window.turnPersonalStyleCap || 10;
  const globalCap = window.turnGlobalStyleCap || 100;
  const [busy, setBusy] = React.useState("");
  const lists = (typeof window.turnListStyles==="function") ? window.turnListStyles() : { user:[], global:[] };
  const userCount = (lists.user||[]).length, atCap = userCount >= personalCap;
  const allGlobalCount = (typeof window.turnAllGlobalStyleCount==="function") ? window.turnAllGlobalStyleCount() : (lists.global||[]).length;
  const globalFull = allGlobalCount >= globalCap;
  const globalList = (lists.globalVisible || []).filter(Boolean);
  const hiddenGlobalList = (lists.globalHidden || []).filter(Boolean);
  const globalRenders = new Set((globalList||[]).map(g=>g.render?JSON.stringify(g.render):"").filter(Boolean));
  React.useEffect(()=>{ const h=(e)=>{ if(e.key==="Escape") onClose(); }; document.addEventListener("keydown",h); return ()=>document.removeEventListener("keydown",h); },[]);
  const publish = async (s)=>{ setBusy("p:"+s.key);
    try{ const k = await window.turnPublishGlobalStyle(s.label, s.render);
      if(!k && window.appToast) window.appToast("Couldn't publish — admin only, or the global render-style cap ("+globalCap+") has been reached."); }
    finally{ setBusy(""); } };
  const delGlobal = async (s)=>{
    if(window.appConfirm && !(await window.appConfirm({ title:"Delete global style?", body:"Every signed-in user loses \""+s.label+"\"." }))) return;
    setBusy("g:"+s.key); try{ await window.turnDeleteGlobalStyle(s.key); } finally{ setBusy(""); } };
  const delUser = async (s)=>{
    if(window.appConfirm && !(await window.appConfirm({ title:"Delete your saved style?", body:"Removes \""+s.label+"\" from your saved styles." }))) return;
    setBusy("u:"+s.key); try{ await window.turnUnlockRenderStyle(s.key); } finally{ setBusy(""); } };
  const moveGlobal = async (s,dir)=>{ setBusy("m:"+s.key);
    try{ if(window.turnMoveGlobalStyle) await window.turnMoveGlobalStyle(s.key, dir); }
    finally{ setBusy(""); } };
  const restoreGlobal = async (s)=>{ setBusy("r:"+s.key);
    try{ if(window.turnRestoreGlobalStyle) await window.turnRestoreGlobalStyle(s.key); }
    finally{ setBusy(""); } };
  // unified platform row — built-in presets and admin-published globals are curated together
  const globalRow = (s,idx)=> React.createElement("div",{className:"styles-row"+(s.builtIn?" styles-row-builtin":""),key:s.key},
    React.createElement("span",{className:"styles-row-name"},s.label),
    React.createElement("span",{className:"styles-row-badge"+(!s.builtIn?" styles-row-badge-curated":"")},s.builtIn?"preset":"global"),
    React.createElement("div",{className:"styles-row-acts"},
      React.createElement("button",{className:"styles-mini styles-mini-square",disabled:!!busy||idx<=0,title:"Move up",
        onClick:()=>moveGlobal(s,-1)},"↑"),
      React.createElement("button",{className:"styles-mini styles-mini-square",disabled:!!busy||idx>=globalList.length-1,title:"Move down",
        onClick:()=>moveGlobal(s,1)},"↓"),
      React.createElement("button",{className:"styles-mini danger",disabled:!!busy,title:s.builtIn?"Hide this preset for all signed-in users":"Delete this global style for all signed-in users",
        onClick:()=>delGlobal(s)}, React.createElement(Icon.trash||Icon.x,{s:14}))));
  const hiddenRow = (s)=> React.createElement("div",{className:"styles-row styles-row-hidden",key:s.key},
    React.createElement("span",{className:"styles-row-name"},s.label),
    React.createElement("span",{className:"styles-row-badge"},"hidden preset"),
    React.createElement("div",{className:"styles-row-acts"},
      React.createElement("button",{className:"styles-mini",disabled:!!busy||globalFull,title:globalFull?"Global cap reached — remove another style before restoring":"Restore this preset for all users",
        onClick:()=>restoreGlobal(s)},"Restore")));
  // personal style row — every signed-in user; admin additionally gets “Publish to global” button
  const userRow = (s)=> React.createElement("div",{className:"styles-row",key:s.key},
    React.createElement("span",{className:"styles-row-name"},s.label),
    React.createElement("div",{className:"styles-row-acts"},
      isAdmin && React.createElement("button",{className:"styles-mini",disabled:!!busy||globalRenders.has(JSON.stringify(s.render))||globalFull,
        title:globalRenders.has(JSON.stringify(s.render))?"Already a global style":(globalFull?("Global render-style cap ("+globalCap+") reached — delete a global style first"):"Make this style a global preset everyone sees"),
        onClick:()=>publish(s)}, globalRenders.has(JSON.stringify(s.render))?"Global ✓":"→ Make global"),
      React.createElement("button",{className:"styles-mini danger",disabled:!!busy,title:"Delete this saved style",
        onClick:()=>delUser(s)}, React.createElement(Icon.trash||Icon.x,{s:14}))));
  return React.createElement("div",{className:"bible-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"bible-modal styles-mgr"},
      React.createElement("div",{className:"bible-head"},
        React.createElement("div",{className:"bible-title"},
          React.createElement((Icon.sparkles||Icon.layers),{s:16}), "Render styles",
          React.createElement("span",{className:"bible-sub"}, isAdmin?"global + your personal styles":"your personal saved styles")),
        React.createElement("button",{className:"bible-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16}))),
      React.createElement("div",{className:"styles-body"},
        // GLOBAL tier — visible to admin only; shows built-ins + curated as one unified pool
        isAdmin && React.createElement("div",{className:"styles-sec-h"},"Global render styles — everyone sees these",
          React.createElement("span",{className:"styles-sec-sub"+(globalFull?" warn":"")},
            allGlobalCount+" / "+globalCap+(globalFull?" · cap reached — delete a global style to add another":" · shared platform presets"))),
        isAdmin && React.createElement("div",{className:"styles-global-list"},
          (globalList||[]).map(globalRow),
          !(globalList||[]).length && React.createElement("div",{className:"styles-empty styles-empty-sm"},
            "No global render styles yet — promote one from your personal styles below or restore a hidden preset.")),
        isAdmin && !!(hiddenGlobalList||[]).length && React.createElement("div",{className:"styles-sec-h styles-sec-h-sub"},"Hidden presets",
          React.createElement("span",{className:"styles-sec-sub"},"restore any removed built-in")),
        isAdmin && !!(hiddenGlobalList||[]).length && React.createElement("div",{className:"styles-global-list"},
          (hiddenGlobalList||[]).map(hiddenRow)),
        // PERSONAL tier — everyone signed in; capped at 10
        React.createElement("div",{className:"styles-sec-h"},isAdmin?"Your personal styles":"Your saved styles",
          React.createElement("span",{className:"styles-sec-sub"+(atCap?" warn":"")}, userCount+" / "+personalCap+(atCap?" · full — delete one to save more":" · private to you, reusable everywhere"))),
        (lists.user||[]).length
          ? (lists.user||[]).map(userRow)
          : React.createElement("div",{className:"styles-empty"},"None yet — pick Surprise me ✨ on any card and click 🔒 Lock this style to save it here."))));
}
window.RenderStylesModal = RenderStylesModal;

/* StoryBriefModal — shows the logline + synopsis (the composed brief) the story's spine,
   beats and cast were built from, so the user can review exactly what was generated and
   spot where anything deviated. Saved at build time on project.sourceBrief. */
function StoryBriefModal({ project, onClose, onRebuild }){
  // the rebuild is a full story build that starts as soon as it's confirmed, so the
  // WRITING MODEL is chosen here first (like the New Story window). It is the same one
  // setting as the Writing dock: a pick here moves the dock, and a dock change made
  // while this window is open shows here.
  const _curMid = ()=> (typeof window.getWritingModelId==="function") ? window.getWritingModelId("story") : "";
  const [mid, setMid] = React.useState(_curMid);
  React.useEffect(()=>{
    const h = ()=> setMid(_curMid());
    window.addEventListener("turn-writing-model-changed", h);
    return ()=>window.removeEventListener("turn-writing-model-changed", h);
  },[]);
  const pickModel = (id)=>{ setMid(id); if(typeof window.setWritingModelId==="function") window.setWritingModelId(id); };
  const _rec = (window.recommendedWritingModelId && window.recommendedWritingModelId("story")) || "";
  const p = project || {};
  const brief = (p.sourceBrief||"").trim();
  const logline = (p.logline||p.premise||"").trim();
  React.useEffect(()=>{ const h=(e)=>{ if(e.key==="Escape") onClose(); }; document.addEventListener("keydown",h); return ()=>document.removeEventListener("keydown",h); },[]);
  const when = p.sourceBriefAt ? new Date(p.sourceBriefAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) : "";
  return React.createElement("div",{className:"bible-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"bible-modal brief-modal"},
      React.createElement("div",{className:"bible-head"},
        React.createElement("div",{className:"bible-title"},
          React.createElement((Icon.book||Icon.file||Icon.layers),{s:16}),"Story brief — what the spine was built from",
          when && React.createElement("span",{className:"bible-sub"},"generated "+when)),
        React.createElement("button",{className:"bible-x",onClick:onClose,title:"Close"},React.createElement(Icon.x,{s:16}))),
      // RECOVERY / RE-ROLL: the brief is the story's true source — rebuild runs the
      // full Adaptation build again from it into a BRAND-NEW film (a fresh telling,
      // never an in-place overwrite: the current film and all its art stay intact).
      brief && onRebuild && React.createElement("div",{className:"brief-rebuild-row"},
        React.createElement("button",{className:"flag-btn primary",onClick:()=>{ onClose(); onRebuild(); },
          title:"Builds a fresh telling from this brief \u2014 this film stays untouched. Runs the full story build again into a NEW film: spine, cast and script freshly generated."},
          React.createElement(Icon.sparkles,{s:14}),"Rebuild as a new film"),
        // the model picker sits at the row's far right
        React.createElement("label",{className:"brief-model-pick",title:"The writing model the rebuild runs on \u2014 the same setting as the Writing dock and the New Story window"},
          React.createElement("span",{className:"obj-lab",style:{marginBottom:0}},"Writing model"),
          React.createElement("select",{className:"brief-model-sel",value:mid,"aria-label":"Writing model for the rebuild",
              onChange:(e)=>pickModel(e.target.value)},
            (window.WRITING_MODELS||[]).map(m=>React.createElement("option",{key:m.id,value:m.id,title:m.note||""},
              m.label + (m.id===_rec ? "  \u00b7 recommended" : "")))))),
      brief
        ? React.createElement("pre",{className:"bible-pre brief-pre"}, brief)
        : React.createElement("div",{className:"brief-empty"},
            logline
              ? React.createElement(React.Fragment,null,
                  React.createElement("div",{className:"brief-empty-lab"},"Logline"),
                  React.createElement("p",{className:"brief-empty-log"},logline),
                  React.createElement("p",{className:"brief-empty-note"},"No saved synopsis — this story was built before briefs were saved. New stories save their full logline + synopsis here."))
              : React.createElement("p",{className:"brief-empty-note"},"No saved brief yet. Start a story with New Story and its logline + synopsis are saved here for review."))));
}
window.StoryBriefModal = StoryBriefModal;

/* The top bar is a stacking context (z-index:30), and every menu or window opened from it — the ⋯
   menu, Export, the room / film / account menus, the Story brief, Team, the Film bible — renders
   inside it, so on a phone the Scene drawer, the Frances bubble and the Writing dock covered them.
   styles.css raises the bar while one is open with .topbar:has(…); this mirrors that selector as a
   class (.topbar.is-raised) for browsers without :has(). Only child-list changes inside the bar are
   watched, so toggling the class never re-triggers it. Returns the cleanup for useEffect. */
const TOPBAR_LAYER_SEL = ".export-menu, .room-menu, .proj-menu, .acct-menu, .bible-overlay, .nb-dock-panel";
/* the top bar's engine slot (homepage style, 2026-10-16). The Writing and Images pickers render into
   it through a portal; without it (an older layout, a test page) they float at the right edge as before. */
const TOPBAR_ENGINE_SLOT_ID = "tb-engines";
function useTopbarEngineSlot(){
  const find = ()=>{ const el = (typeof document!=="undefined") ? document.getElementById(TOPBAR_ENGINE_SLOT_ID) : null;
    return el && el.isConnected ? el : null; };
  const [slot, setSlot] = React.useState(find);
  React.useEffect(()=>{
    const sync = ()=> setSlot(find());
    sync();
    window.addEventListener("turn-engine-slot", sync);
    return ()=>window.removeEventListener("turn-engine-slot", sync);
  },[]);
  return slot && slot.isConnected ? slot : null;
}
window.useTopbarEngineSlot = useTopbarEngineSlot;
/* a tab strip that scrolls sideways shows a soft edge where more tabs sit off screen (mobile step 1, 2026-11-03):
   .fade-l / .fade-r from its scroll position (styles.css) */
function turnTabEdgeFade(el){
  if(!el || !el.classList) return;
  const max = el.scrollWidth - el.clientWidth;
  el.classList.toggle("fade-l", max > 2 && el.scrollLeft > 2);
  el.classList.toggle("fade-r", max > 2 && el.scrollLeft < max - 2);
}
window.turnTabEdgeFade = turnTabEdgeFade;
function turnWatchTopbarLayer(bar){
  if(!bar || typeof bar.querySelector!=="function" || typeof MutationObserver!=="function") return undefined;
  const sync = ()=>{
    const up = !!bar.querySelector(TOPBAR_LAYER_SEL);
    if(bar.classList.contains("is-raised")!==up) bar.classList.toggle("is-raised", up);
  };
  const mo = new MutationObserver(sync);
  mo.observe(bar, { childList:true, subtree:true });
  sync();
  return ()=>mo.disconnect();
}
window.turnWatchTopbarLayer = turnWatchTopbarLayer;

function TopBar({ room, setRoom, project, scenes, drafts, onReset, onNewStory, onImportScript, onImportDraft, onAgents, onViewBible, onManageStyles, onRebuildFromBrief, hasFilmStyle, theme, onTheme, authSlot, projectSlot, teamSlot, presenceSlot, notifySlot, roomEntitlements, onHome, artView, setArtView, artTabLocks, hiddenArtTabs }){
  const [bibleOpen, setBibleOpen] = React.useState(false);
  const [briefOpen, setBriefOpen] = React.useState(false);
  const [stylesOpen, setStylesOpen] = React.useState(false);
  const [apiKeysOpen, setApiKeysOpen] = React.useState(false);
  React.useEffect(()=>{ const h=()=>setApiKeysOpen(true); window.addEventListener("turn-open-api-keys",h); return ()=>window.removeEventListener("turn-open-api-keys",h); },[]);
  // the account menu's Admin rows (2026-10-22) open the same windows the Film menu used to
  React.useEffect(()=>{ const h=()=>setStylesOpen(true); window.addEventListener("turn-open-styles",h); return ()=>window.removeEventListener("turn-open-styles",h); },[]);
  // the phone ⋯ menu's "Story brief" entry opens the same window as the Brief button
  React.useEffect(()=>{ const h=()=>setBriefOpen(true); window.addEventListener("turn-open-brief",h); return ()=>window.removeEventListener("turn-open-brief",h); },[]);
  // while a menu or window opened from the bar is up, the bar sits above the drawers, the Frances
  // bubble and the Writing dock (styles.css .topbar:has(…) / .topbar.is-raised)
  const barRef = React.useRef(null);
  React.useEffect(()=>turnWatchTopbarLayer(barRef.current),[]);
  // tell the engine pickers their slot is in the page (they mount in the same commit, before it exists)
  const engineSlotRef = React.useRef(null);
  React.useEffect(()=>{ try{ window.dispatchEvent(new CustomEvent("turn-engine-slot")); }catch(e){} },[]);
  // the phone's Engines row closes on a tap outside it (an engine's own menu sits inside it)
  const [enginesOpen, setEnginesOpen] = React.useState(false);
  const enginesWrapRef = React.useRef(null);
  React.useEffect(()=>{
    if(!enginesOpen) return undefined;
    const h = (e)=>{ const w = enginesWrapRef.current; if(w && !w.contains(e.target)) setEnginesOpen(false); };
    document.addEventListener("pointerdown", h, true);
    return ()=>document.removeEventListener("pointerdown", h, true);
  },[enginesOpen]);
  React.useEffect(()=>{ setEnginesOpen(false); },[room]);
  return React.createElement("div",{className:"topbar",ref:barRef},
    bibleOpen && onViewBible && React.createElement(FilmBibleModal,{ getBible:onViewBible, onClose:()=>setBibleOpen(false) }),
    briefOpen && React.createElement(StoryBriefModal,{ project, onClose:()=>setBriefOpen(false), onRebuild:onRebuildFromBrief }),
    stylesOpen && onManageStyles && React.createElement(RenderStylesModal,{ onClose:()=>setStylesOpen(false) }),
    apiKeysOpen && React.createElement(ApiKeysModal,{ onClose:()=>setApiKeysOpen(false) }),
    React.createElement("div",{className:"tb-left"},
      onHome
        ? React.createElement("button",{className:"brand brand-btn",onClick:onHome,title:"Home — all your films","aria-label":"Kinolot — Home"},
            React.createElement(BrandMark,null),
            React.createElement(BrandWordmark,null))
        : React.createElement("div",{className:"brand"},
            React.createElement(BrandMark,null),
            React.createElement(BrandWordmark,null)),
      React.createElement("div",{className:"topbar-divider"}),
      // the project title first, then the department (room) switcher to its right
      React.createElement("div",{className:"context-group"},
        projectSlot || null,
        React.createElement(RoomSwitcher,{room,setRoom,hasStory:(scenes||[]).length>0,roomEntitlements}))),

    React.createElement("div",{className:"tb-right"},
      // HOMEPAGE-STYLE BAR (owner 2026-10-16): the engines this room runs on, who's here, the bell, the
      // "Film ⋯" menu and the account. The engine pickers render INTO this slot (aiwriter.jsx WritingDock,
      // artroom.jsx NbDock, through useTopbarEngineSlot) — the Writers' Room shows its writing engine, the
      // Art Room its writing and image engines; the slot hides itself when no room puts one there.
      // ON A PHONE the engines fold into one Engines button (owner 2026-11-03, mobile step 1: the pickers sat on top of
      // the room switcher); it opens them as a row under the bar. The slot stays in the page, so the pickers keep it.
      React.createElement("div",{className:"tb-engines-wrap"+(enginesOpen?" open":""),ref:enginesWrapRef},
        React.createElement("button",{type:"button",className:"tb-engines-toggle","aria-label":"Engines","aria-expanded":enginesOpen?"true":"false",
          title:"The writing and image engines",onClick:()=>setEnginesOpen(o=>!o)},
          React.createElement(Icon.sparkles,{s:16})),
        React.createElement("div",{className:"tb-engines",id:TOPBAR_ENGINE_SLOT_ID,ref:engineSlotRef,role:"group","aria-label":"Engines"})),
      presenceSlot || null,      // who else has this film open right now
      notifySlot || null,        // the owner's bell: who joined your films (team.jsx TeamNotifications)
      // Team opens from the Film menu (window.turnTeamMenu); the button stays mounted, hidden, because
      // its window renders beside it
      teamSlot ? React.createElement("span",{className:"tb-team-slot"},teamSlot) : null,
      // the Film menu: New Story, the Story brief, Team, the exports, Appearance and the admin's
      // Reset — in every room, at every width (each entry under its own conditions)
      React.createElement(OverflowMenu,{onNewStory,onImportScript,onImportDraft,project,scenes,drafts,onReset,room,
        artView,setArtView,artTabLocks,hiddenArtTabs,theme,onTheme}),
      authSlot || React.createElement("div",{className:"avatar"},"MV")),
  );
}
window.TopBar = TopBar;

/* collapsed vertical strip — left or right */
function CollapsedStrip({ side, label, icon:Ic, onExpand, flagCount, buttonless }){
  // buttonless (the inspector, right): drop the strip's own expand button — it would sit
  // right under the top-bar's inspector toggle and read as a duplicate. The whole strip is
  // clickable to reopen instead, and the top-bar toggle still works.
  return React.createElement("div",{className:`strip ${side}${buttonless?" strip-clickable":""}`,
      ...(buttonless ? { onClick:onExpand,
        onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onExpand(); } },
        title:`Expand ${label}`, role:"button", tabIndex:0, "aria-label":`Expand ${label}` } : {})},
    buttonless ? null : React.createElement("button",{className:"strip-btn",onClick:onExpand,title:`Expand ${label}`},
      React.createElement(Ic,{s:16})),
    React.createElement("div",{className:"strip-label"},label),
    flagCount ? React.createElement("div",{className:"strip-flag",title:`${flagCount} scenes don't turn`},
      React.createElement("div",{className:"dot"},React.createElement(Icon.alert,{s:12})),flagCount) : null);
}
window.CollapsedStrip = CollapsedStrip;

function RailSection({ label, icon:Ic, onAdd, defaultOpen=true, children }){
  const [open, setOpen] = React.useState(defaultOpen);
  const prevDef = React.useRef(defaultOpen);
  React.useEffect(()=>{ if(prevDef.current!==defaultOpen){ setOpen(defaultOpen); prevDef.current=defaultOpen; } },[defaultOpen]);
  return React.createElement("div",{className:`rail-sec ${open?"":"folded"}`},
    React.createElement("div",{className:"rail-sec-head clickable",onClick:()=>setOpen(o=>!o)},
      React.createElement("span",{className:"eyebrow"},
        React.createElement("span",{className:"rail-fold-ic"},React.createElement(open?Icon.chevD:Icon.chevR,{s:12})),
        Ic&&React.createElement(Ic,{s:12}),label),
      onAdd&&React.createElement("button",{className:"rail-add",onClick:(e)=>{e.stopPropagation();onAdd();}},
        React.createElement(Icon.plus,{s:14}))),
    open && children);
}

/* ---- left rail: SETTING (story world) ---- */
const _SLUG_PREFIX = /^\s*(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?)\s+/i;
/* "INT. FATHER'S HOUSE - NIGHT" -> { place:"Father's House", tod:"NIGHT" } */
function railSlugParts(loc){
  const raw = String(loc||"").trim(); if(!raw) return null;
  const body = raw.replace(_SLUG_PREFIX,"");
  const cut = body.lastIndexOf(" - ");
  const place = (cut>0 ? body.slice(0,cut) : body).trim();
  const tod = (cut>0 ? body.slice(cut+3) : "").trim().toUpperCase();
  const nice = place.toLowerCase().replace(/(^|[\s\-\/(])([a-z\u00e0-\u00ff])/g,(m,p1,ch)=>p1+ch.toUpperCase());
  return { place:nice, key:place.toUpperCase(), tod };
}
function railTodKind(tod){
  if(/NIGHT|MIDNIGHT|LATE/.test(tod)) return "night";
  if(/DAWN|DUSK|SUNSET|SUNRISE|EVENING|TWILIGHT|MAGIC HOUR/.test(tod)) return "dusk";
  if(/DAY|MORNING|NOON|AFTERNOON/.test(tod)) return "day";
  return "other";
}
const _CONF_NAMES = ["Inner","Personal","Extra-personal"];
function WorldPane({ project, scenes, edit, setSetting }){
  const st = project.setting || {};
  const order = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]);
  const slugs = order.map(sc=>({ sc, p:railSlugParts(sc.loc) }));
  // places the script actually visits, most-used first
  const places = {};
  slugs.forEach(({p})=>{ if(p && p.place){ const e = places[p.key] || (places[p.key] = { name:p.place, n:0 }); e.n++; } });
  const topPlaces = Object.values(places).sort((x,y)=>y.n-x.n);
  const conf = [0,0,0];
  order.forEach(sc=>{ const c = Number(sc.conf)||0; if(c>=1 && c<=3) conf[c-1]++; });
  const confTotal = conf[0]+conf[1]+conf[2];
  const fields = [
    { k:"period", lab:"Period", Ic:Icon.calendar, ph:"When the story happens" },
    { k:"duration", lab:"Duration", Ic:Icon.clock, ph:"How much time it spans",
      extra: order.length ? React.createElement("div",{className:"world-ctx"},
        React.createElement("div",{className:"world-tod",role:"img","aria-label":"Time of day across the film"},
          slugs.map(({sc,p},i)=>React.createElement("span",{key:sc.id||i,className:"world-tod-cell "+railTodKind(p?p.tod:""),
            title:"Scene "+(sc.no||i+1)+(p&&p.tod?" \u00b7 "+p.tod:"")}))),
        React.createElement("div",{className:"world-ctx-note"},
          ["day","dusk","night"].map(k=>{ const n = slugs.filter(({p})=>railTodKind(p?p.tod:"")===k).length;
            return n ? React.createElement("span",{key:k,className:"world-key "+k},n+" "+k+(n!==1?"s":"")) : null; }))) : null },
    { k:"location", lab:"Location", Ic:Icon.pin, ph:"A bounded, concrete place",
      extra: topPlaces.length ? React.createElement("div",{className:"world-ctx"},
        React.createElement("div",{className:"world-ctx-lab"},"In the script \u00b7 "+topPlaces.length+" place"+(topPlaces.length!==1?"s":"")),
        // one line per place, its scene count on the right
        React.createElement("div",{className:"world-places"},
          topPlaces.slice(0,5).map(pl=>React.createElement("div",{key:pl.name,className:"world-place",title:pl.n+" scene"+(pl.n!==1?"s":"")},
            React.createElement("span",null,pl.name), React.createElement("b",null,pl.n))),
          topPlaces.length>5 && React.createElement("div",{className:"world-place more"},"+"+(topPlaces.length-5)+" more"))) : null },
    { k:"conflict", lab:"Conflict", Ic:Icon.layers, ph:"The level of conflict: inner, personal, institutional, environmental",
      extra: confTotal ? React.createElement("div",{className:"world-ctx"},
        React.createElement("div",{className:"world-ctx-lab"},"Conflict source by scene"),
        React.createElement("div",{className:"world-conf"},
          conf.map((n,i)=> n ? React.createElement("span",{key:i,className:"world-conf-seg c"+(i+1),style:{flexGrow:n},
            title:_CONF_NAMES[i]+" \u00b7 "+n+" scene"+(n!==1?"s":"")}) : null)),
        React.createElement("div",{className:"world-ctx-note"},
          conf.map((n,i)=> n ? React.createElement("span",{key:i,className:"world-key c"+(i+1)},n+" "+_CONF_NAMES[i].toLowerCase()) : null))) : null },
  ];
  return React.createElement("div",{className:"world-pane"},
    fields.map(f=>React.createElement("div",{key:f.k,className:"world-field"+(String(st[f.k]||"").trim()?"":" empty")},
      // a hairline row with a mono label, like the Premise tab (owner 2026-10-21: one look across the rail)
      React.createElement("div",{className:"world-head"},
        React.createElement("span",{className:"world-lab"},f.lab)),
      React.createElement(EditText,{value:st[f.k]||"",multiline:true,readOnly:edit,className:"rail-setting-val",
        placeholder:f.ph,onCommit:(v)=>setSetting(f.k, v)}),
      f.extra || null)));
}

/* ---- left rail: CAST ---- */
/* "MIRROR · THE PRODIGAL — the brother who ran" -> { tags:["Mirror","The Prodigal"], desc:"the brother who ran" } */
function railRoleParts(role){
  const r = String(role||""); const at = r.indexOf("\u2014");
  const head = at<0 ? r : r.slice(0,at), desc = at<0 ? "" : r.slice(at+1).trim();
  const tags = head.split(/\u00b7|\|/).map(t=>t.trim()).filter(Boolean)
    .map(t=> t===t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)([a-z\u00e0-\u00ff])/g,(m,p1,ch)=>p1+ch.toUpperCase()) : t);
  return (at<0 && tags.length===1 && tags[0].length>28) ? { tags:[], desc:r } : { tags, desc };
}
/* "TOMASZ WRÓBEL" -> "Tomasz Wróbel" (a name typed in capitals, as screenplays cue it); a mixed-case name is kept */
function railNameCase(name){
  const n = String(name||"");
  if(!/\p{L}/u.test(n) || n!==n.toUpperCase()) return n;
  return n.toLowerCase().replace(/(^|[\s\-'\u2019.])(\p{L})/gu,(m,p1,ch)=>p1+ch.toUpperCase());
}
window.railNameCase = railNameCase;
function CastPane({ characters, scenes, selChar, onSelectChar }){
  const order = (typeof scenesInStoryOrder==="function") ? scenesInStoryOrder(scenes||[]) : (scenes||[]);
  const beatsMap = ((window.turnContinuity||{}).beatsMap) || {};
  const lead = (typeof window.protagonistOf==="function") ? window.protagonistOf(characters, order) : null;
  // the protagonist first; the rest keep their cast order
  const list = lead ? [lead].concat((characters||[]).filter(c=>c.id!==lead.id)) : (characters||[]);
  const faces = (c, sc)=>{ const b = beatsMap[sc.id]; if(!b || typeof window.castMemberByLabel!=="function") return false;
    const r = window.castMemberByLabel(b.reactorLabel, characters); return !!(r && r.id===c.id && sc.driver!==c.id); };
  if(!list.length) return React.createElement("div",{className:"cast-empty"},"No cast yet \u2014 the story build designs it from the synopsis.");
  return React.createElement("div",{className:"cast-pane"},
    list.map(c=>{
      const rp = railRoleParts(c.role);
      const driven = order.filter(sc=>sc.driver===c.id).length;
      const isLead = lead && c.id===lead.id;
      const pick = ()=> onSelectChar && onSelectChar(c.id);
      let lastAct = null;
      return React.createElement("div",{key:c.id,role:"button",tabIndex:0,
          className:"cast-card"+(selChar===c.id?" sel":"")+(isLead?" lead":""),
          onClick:pick, onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); pick(); } }},
        React.createElement("div",{className:"cast-top"},
          React.createElement("div",{className:"cast-av",style:{background:c.color}},
            (c.name||"?").split(" ").map(w=>w[0]||"").slice(0,2).join("")),
          React.createElement("div",{className:"cast-id"},
            React.createElement("div",{className:"cast-name",title:c.name||""},railNameCase(c.name)||"Unnamed"),
            // the role as one quiet line ("Protagonist · The Applicant"), not boxed tags (owner 2026-10-21)
            rp.tags.length ? React.createElement("div",{className:"cast-role"},rp.tags.join(" \u00b7 ")) : null),
),
        rp.desc && React.createElement("div",{className:"cast-desc"},rp.desc),
        // where they carry the film: the scene strip, with how many scenes they drive at its end
        React.createElement("div",{className:"cast-foot"},
        order.length ? React.createElement("div",{className:"cast-track",role:"img",
            "aria-label":(c.name||"This character")+" drives "+driven+" of "+order.length+" scenes"},
          order.map((sc,i)=>{
            const brk = lastAct!==null && sc.act!==lastAct; lastAct = sc.act;
            const kind = sc.driver===c.id ? "drive" : faces(c, sc) ? "face" : "";
            return React.createElement("span",{key:sc.id||i,className:"cast-cell"+(kind?" "+kind:"")+(brk?" brk":""),
              style: kind==="drive" ? {background:c.color} : undefined,
              title:"Scene "+(sc.no||i+1)+(sc.title?" \u00b7 "+sc.title:"")+(kind==="drive"?" \u2014 drives":kind==="face"?" \u2014 faces the driver":"")});
          })) : null,
          React.createElement("div",{className:"cast-drives",title:"Drives "+driven+" of "+order.length+" scene"+(order.length!==1?"s":"")},
            React.createElement("b",null,driven), React.createElement("span",null,"drives"))));
    }),
    React.createElement("div",{className:"cast-legend"},
      React.createElement("span",null,React.createElement("i",{className:"cast-cell drive"}),"drives the scene"),
      React.createElement("span",null,React.createElement("i",{className:"cast-cell face"}),"faces the driver")));
}

function LeftRail({ project, characters, scenes, selChar, onSelectChar, onContract, onGenre, onProject, onCollapse, compact, readOnly }){
  const ci = project.controllingIdea || {};
  // STORY-LEVEL INPUTS are editable here (approved 2026-09-25 by owner): premise,
  // controlling idea, Center of Good, setting and the synopsis by act all feed every
  // scene prompt. `onProject(patch | p=>patch)` merges into the project.
  const edit = readOnly || !onProject;
  const setIdea = (k,v)=> onProject && onProject(p=>({ controllingIdea:{ ...(p.controllingIdea||{}), [k]:v } }));
  const setSetting = (k,v)=> onProject && onProject(p=>({ setting:{ ...(p.setting||{}), [k]:String(v||"").trim() } }));
  const fw = (typeof frameworkOf==="function") ? frameworkOf(project) : null;
  const shape = (fw && fw.synopsis && fw.synopsis.paras) || [];
  const synTextOf = (proj, pg)=>{ const have = (typeof synopsisParasOf==="function") ? synopsisParasOf(proj) : [];
    return ((have.find(h=>h.key===pg.key) || have.find(h=>h.label===pg.label) || {}).text) || ""; };
  const setSynopsis = (key, v)=> onProject && onProject(p=>({ synopsis:{ paras: shape.map(pg=>({ key:pg.key, label:pg.label,
    text: pg.key===key ? String(v||"").trim() : synTextOf(p, pg) })) } }));
  const secOpen = !compact;
  const railTabs = [["premise","Premise"],["setting","Setting"],["cast","Cast"]];
  const [railTabState,setRailTabState] = React.useState(()=>{
    try{
      const saved = sessionStorage.getItem("turn-writers-left-tab");
      return railTabs.some(([id])=>id===saved) ? saved : "premise";
    }catch(e){ return "premise"; }
  });
  const setRailTab = (id)=>{
    setRailTabState(id);
    try{ sessionStorage.setItem("turn-writers-left-tab",id); }catch(e){}
  };
  return React.createElement("div",{className:"rail"},
    // Reuse the inspector's primary tabs verbatim so both sidebars share one
    // interaction language. Cast is story-derived, so this header never offers
    // manual character creation.
    React.createElement("div",{className:"insp-tabs rail-tabs",role:"tablist","aria-label":"Story information"},
      // Mirror the right inspector: its tabs begin at the panel's inner edge and
      // its collapse control sits on the outer edge. On the left rail, that
      // means collapse belongs first (far left) and the tabs align right.
      React.createElement("button",{className:"panel-collapse rail-panel-collapse",onClick:onCollapse,
        title:"Collapse story panel","aria-label":"Collapse story panel"},React.createElement(Icon.chevL,{s:14})),
      railTabs.map(([id,lab])=>React.createElement("button",{key:id,type:"button",role:"tab",
        "aria-selected":railTabState===id,className:`insp-tab ${railTabState===id?"on":""}`,
        onClick:()=>setRailTab(id)},lab)),
      ),
    React.createElement("div",{className:"rail-scroll"},

      // PREMISE + CONTROLLING IDEA
      railTabState==="premise" && React.createElement("div",{className:"rail-tab-pane",role:"tabpanel"},
        React.createElement("div",{className:"idea-card"},
          React.createElement("div",{className:"eyebrow",style:{marginBottom:4},title:"The open question the story explores \u2014 every scene prompt reads it"},"Premise"),
          React.createElement(EditText,{value:project.premise||"",multiline:true,className:"premise premise-edit",readOnly:edit,
            placeholder:"What would happen if\u2026?",onCommit:(v)=>onProject&&onProject({premise:String(v||"").trim()})}),
          // GENRE rides into every writing prompt ("FILM: Title — genre"); the story build
          // drafts it, and older films can set it here
          React.createElement("div",{className:"rail-genre",title:"The film's genre \u2014 every writing prompt reads it"},
            React.createElement("span",{className:"eyebrow"},"Genre"),
            React.createElement(EditText,{value:project.genre||"",placeholder:"Add a genre (e.g. psychological thriller)",
              readOnly:readOnly||!onGenre,onCommit:(v)=>onGenre&&onGenre(v)})),
          React.createElement("div",{className:"ctrl-idea ctrl-idea-edit"},
            React.createElement("div",{className:"eyebrow",style:{marginBottom:6},title:"Value + cause: the meaning the climax will prove. Every scene prompt reads it."},"Controlling Idea"),
            React.createElement(EditText,{value:ci.value||"",className:"val",readOnly:edit,placeholder:"Value (e.g. Love survives)",onCommit:(v)=>setIdea("value",String(v||"").trim())}),
            React.createElement(EditText,{value:ci.cause||"",className:"cause",multiline:true,readOnly:edit,placeholder:"because\u2026 / when\u2026",onCommit:(v)=>setIdea("cause",String(v||"").trim())}),
            React.createElement("select",{className:"insp-select ctrl-polarity",disabled:edit,value:ci.polarity||"ironic",
              title:"The ending's charge",onChange:(e)=>setIdea("polarity",e.target.value)},
              [["idealistic","Idealistic ending"],["pessimistic","Pessimistic ending"],["ironic","Ironic ending"]].map(([k,l])=>React.createElement("option",{key:k,value:k},l)))),
          // CENTER OF GOOD — the film-level empathy anchor (sympathy optional, empathy
          // absolute). Drafted by the story build; fed to every scene draft via storyContext.
          React.createElement("div",{className:"ctrl-idea"},
            React.createElement("div",{className:"eyebrow",style:{marginBottom:6},
              title:"Where the audience's identification anchors \u2014 it can live inside a dark protagonist (the one loyalty they never betray), but it must exist, even with monsters."},"Center of Good"),
            React.createElement(EditText,{value:project.centerOfGood||"",className:"cause",multiline:true,readOnly:edit,
              placeholder:"Where the audience's empathy lives\u2026",onCommit:(v)=>onProject&&onProject({centerOfGood:String(v||"").trim()})})))),

      // SYNOPSIS BY ACT — each scene prompt reads its own act's paragraph
      railTabState==="premise" && shape.length>0 && React.createElement(RailSection,
        {label:"Synopsis by act",icon:Icon.script||Icon.layers,defaultOpen:false},
        React.createElement("div",{className:"rail-synopsis"},
          shape.map(pg=>React.createElement("div",{key:pg.key,className:"rail-syn-para"},
            React.createElement("div",{className:"obj-lab",title:pg.guide||""},pg.label),
            React.createElement(EditText,{value:synTextOf(project, pg),multiline:true,readOnly:edit,
              placeholder:"What happens in this movement\u2026",onCommit:(v)=>setSynopsis(pg.key, v)}))))),

      // STORY CONTRACT — outer plot · inner arc · which change the climax pays off
      railTabState==="premise" && (typeof ContractSection==="function") && React.createElement(RailSection,
        {label:"Story Contract",icon:Icon.bolt,defaultOpen:secOpen},
        React.createElement(ContractSection,{project,scenes,onContract,readOnly})),

      // SETTING — the story world, each field read against the film it describes
      railTabState==="setting" && React.createElement("div",{className:"rail-tab-pane rail-setting-pane",role:"tabpanel"},
        React.createElement(WorldPane,{project, scenes, edit, setSetting})),

      // CHARACTERS — one card per cast member with where they carry the film
      railTabState==="cast" && React.createElement("div",{className:"rail-tab-pane rail-cast-pane",role:"tabpanel"},
        React.createElement(CastPane,{characters, scenes, selChar, onSelectChar})),
    ));
}
window.LeftRail = LeftRail;
