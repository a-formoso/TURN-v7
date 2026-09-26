#!/usr/bin/env node
/* ============================================================================
   SERIES / SHOW PRODUCTION CONTRACTS

   Covers the durable Show -> Episode boundary without provider calls:
   - pure hydration, cast-reconciliation, scene-ref and grouping invariants
   - browser -> cloud lifecycle wiring (conversion/create/delete/bible saves)
   - transactional SQL + collaboration/RLS installation contract
   - Project Switcher recovery and destructive-action UX
   - MUSE's public capability manifest

   This test intentionally reads source as well as executing app/series.js. The
   SQL and UI are browser/database boundaries that cannot be meaningfully faked
   by a unit test; their required names and fail-safe routes are therefore kept
   as explicit, reviewable source contracts.

     node scripts/test-series-production.mjs
   ============================================================================ */
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

let passes = 0;
let failures = 0;
const ok = (name, condition, detail = "") => {
  if (condition) passes++;
  else {
    failures++;
    console.log("FAIL " + name + (detail ? " — " + detail : ""));
  }
};
const same = (name, got, want) => {
  const actual = JSON.stringify(got);
  const expected = JSON.stringify(want);
  ok(name, actual === expected, "got " + actual + "; expected " + expected);
};
const plain = value => JSON.parse(JSON.stringify(value));
const source = path => existsSync(path) ? readFileSync(path, "utf8") : "";
const section = (text, start, end) => {
  const from = text.indexOf(start);
  if (from < 0) return "";
  const to = end ? text.indexOf(end, from + start.length) : -1;
  return text.slice(from, to < 0 ? undefined : to);
};

/* ── Pure Show / Episode invariants ─────────────────────────────────────── */
const seriesSource = source("app/series.js");
const teamSource = source("app/team.jsx");
const box = { console, Set, Map, JSON };
box.window = box;
box.globalThis = box;
vm.createContext(box);
if (seriesSource) vm.runInContext(seriesSource, box, { filename: "app/series.js" });
const S = box.turnSeries || {};

for (const name of [
  "isShowDoc", "sharedBible", "hydrateEpisode", "mergeAdaptationCast",
  "prepareBibleForEpisode", "bibleForEpisode", "mergeEntitySceneRefs", "mergeEpisodeSceneRefs", "nextEpisodeNo", "groups",
  "normalizeProjectRow", "validBibleShape", "sharedTrash", "episodeTrash", "mergeSharedTrash", "combineTrash",
  "locationMetaSlice", "episodeLocationMetaMap", "rebuildLocationMetaProjection", "mergeEpisodeLocationMeta",
]) ok("series helper exported: " + name, typeof S[name] === "function");

if (typeof S.isShowDoc === "function") {
  ok("Show marker accepts persisted boolean", S.isShowDoc({ isShow: true }));
  ok("Show marker accepts PostgREST string", S.isShowDoc({ isShow: "TRUE" }));
  ok("normalized project kind identifies a Show without legacy JSON", S.isShowDoc({ project_kind: "SHOW" }));
  ok("normalized project kind overrides a stale legacy marker",
    !S.isShowDoc({ project_kind: "episode", isShow: "TRUE" }));
  ok("episode is not mistaken for Show", !S.isShowDoc({ showId: "show-1", episodeNo: 1 }));
}

if (typeof S.normalizeProjectRow === "function") {
  const recovered = plain(S.normalizeProjectRow({
    id:"legacy-orphan", project_kind:"film", show_id:null, episode_no:null,
    showId:"missing-show", episodeNo:"7", isShow:"false",
    doc:{showId:"missing-show",episodeNo:7,seriesCreateRequestId:"stale-request",scenes:[{id:"s1"}]},
  }));
  ok("normalized standalone film ignores stale legacy Episode markers",
    recovered.showId === null && recovered.episodeNo === null && recovered.isShow === false);
  same("normalized standalone film stays openable without losing story data", recovered.doc,
    {scenes:[{id:"s1"}]});

  const episode = plain(S.normalizeProjectRow({
    id:"episode",project_kind:"EPISODE",show_id:"canonical-show",episode_no:2,
    showId:"stale-show",episodeNo:"99",doc:{showId:"stale-show",episodeNo:99,scenes:[{id:"s2"}]},
  }));
  ok("normalized Episode columns override stale JSON relationship mirrors",
    episode.showId === "canonical-show" && episode.episodeNo === 2
      && episode.doc.showId === "canonical-show" && episode.doc.episodeNo === 2);

  const show = plain(S.normalizeProjectRow({
    id:"show",project_kind:"show",showId:"impossible-child",episodeNo:4,
    doc:{showId:"impossible-child",episodeNo:4,bible:{characters:[]}},
  }));
  ok("normalized Show cannot retain Episode markers",
    show.isShow === true && show.showId === null && show.episodeNo === null
      && show.doc.isShow === true && !("showId" in show.doc) && !("episodeNo" in show.doc));
}

/* Room editability and section persistence must derive from one role model. */
const roleBox = { window:null };
roleBox.window = roleBox;
vm.createContext(roleBox);
const roleHelpers = section(teamSource, "const TEAM_ROLE_SECTIONS", "function teamCanManage");
if (roleHelpers) vm.runInContext(roleHelpers, roleBox, { filename:"app/team.jsx#role-helpers" });
ok("role helper exported: teamCanWriteRoom", typeof roleBox.teamCanWriteRoom === "function");
ok("role helper exported: teamCanWriteSection", typeof roleBox.teamCanWriteSection === "function");
if (typeof roleBox.teamCanWriteRoom === "function" && typeof roleBox.teamCanWriteSection === "function") {
  ok("Writer can mutate Writers' Room", roleBox.teamCanWriteRoom("writer", "writers"));
  ok("Writer cannot mutate Art Room", !roleBox.teamCanWriteRoom("writer", "art"));
  ok("Art director can mutate Art Room", roleBox.teamCanWriteRoom("art_director", "art"));
  ok("Art director sees Writers' Room as read-only", !roleBox.teamCanWriteRoom("art_director", "writers"));
  ok("View-only role cannot mutate either room",
    !roleBox.teamCanWriteRoom("view_only", "writers") && !roleBox.teamCanWriteRoom("view_only", "art"));
  ok("Art director section scope keeps Bible work but denies story work",
    roleBox.teamCanWriteSection("art_director", "characters")
      && roleBox.teamCanWriteSection("art_director", "shots")
      && !roleBox.teamCanWriteSection("art_director", "scenes")
      && !roleBox.teamCanWriteSection("art_director", "drafts"));
}

if (typeof S.sharedBible === "function") {
  same("shared Bible has one normalized shape", plain(S.sharedBible({
    characters: [{ id: "c1" }], locations: "bad", props: null,
    lookbook: [{ id: "tone" }], lookbookNote: 42, privateEpisodeField: true,
  })), {
    characters: [{ id: "c1" }], locations: [], props: [],
    lookbook: [{ id: "tone" }], lookbookNote: "",
    trash:{characters:[],locations:[],props:[]},
  });
}

if (typeof S.validBibleShape === "function") {
  const complete={characters:[],locations:[],props:[],lookbook:[],lookbookNote:"",
    trash:{characters:[],locations:[],props:[]}};
  ok("an explicitly empty canonical Bible is valid", S.validBibleShape(complete));
  ok("a missing canonical Bible department fails closed",
    !S.validBibleShape({characters:[],locations:[],props:[],lookbook:[],lookbookNote:""}));
  ok("a malformed shared restore-bin bucket fails closed",
    !S.validBibleShape({...complete,trash:{characters:[],locations:"bad",props:[]}}));
  ok("a shared tombstone without a durable id fails closed",
    !S.validBibleShape({...complete,trash:{characters:[{name:"Lost"}],locations:[],props:[]}}));
  ok("a malformed Episode scene-reference map fails closed",
    !S.validBibleShape({...complete,characters:[{id:"A",episodeScenes:{ep1:"s1"}}]}));
  ok("a malformed per-Episode location metadata map fails closed",
    !S.validBibleShape({...complete,locations:[{id:"house",episodeLocationMeta:{ep1:{times:"Night"}}}]}));
  ok("unknown per-Episode location metadata fields fail closed",
    !S.validBibleShape({...complete,locations:[{id:"house",episodeLocationMeta:{ep1:{weather:"Rain"}}}]}));
  ok("a Show Bible cannot keep one entity both active and deleted",
    !S.validBibleShape({...complete,characters:[{id:"A"}],
      trash:{characters:[{id:"A"}],locations:[],props:[]}}));
  ok("the canonical Show restore bin cannot contain Episode-owned shots",
    !S.validBibleShape({...complete,trash:{characters:[],locations:[],props:[],shots:[]}}));
}

if (typeof S.hydrateEpisode === "function") {
  const episode = {
    id: "episode-2", showId: "show-1", episodeNo: 2,
    project: { title: "Episode 2", format: "film", episodeOnly: true },
    scenes: [{ id: "e2-s1" }], drafts: { "e2-s1": { blocks: ["own story"] } },
    shots: [{ id: "e2-shot" }],
    characters: [{ id: "stale-character" }], locations: [{ id: "stale-location" }],
    props: [{ id: "stale-prop" }], lookbook: [{ id: "stale-look" }],
    lookbookNote: "stale note",
    trash:{
      characters:[{id:"legacy-deleted",scenes:["e2-s1"]}],
      locations:[{id:"house",scenes:["stale"]}],
      props:[],shots:[{id:"e2-deleted-shot"}],
    },
  };
  const show = {
    isShow: true, format: "limited-series",
    bible: {
      characters: [], // an explicit empty Show department is authoritative
      locations: [{ id: "house" }], props: [], lookbook: [{ id: "show-look" }],
      lookbookNote: "show canon",
      trash:{characters:[{id:"show-deleted",scenes:["e1-s1","e2-s1"],
        episodeScenes:{"episode-1":["e1-s1"],"episode-2":["e2-s1"]}}],locations:[],props:[]},
    },
  };
  const beforeEpisode = JSON.stringify(episode);
  const beforeShow = JSON.stringify(show);
  const hydrated = plain(S.hydrateEpisode(episode, show, "episode-2"));
  same("episode story remains episode-owned", {
    scenes: hydrated.scenes, drafts: hydrated.drafts, shots: hydrated.shots,
  }, { scenes: episode.scenes, drafts: episode.drafts, shots: episode.shots });
  same("Show Bible replaces every stale episode copy", {
    characters: hydrated.characters, locations: hydrated.locations,
    props: hydrated.props, lookbook: hydrated.lookbook, lookbookNote: hydrated.lookbookNote,
  }, {characters:show.bible.characters,locations:show.bible.locations,props:show.bible.props,
    lookbook:show.bible.lookbook,lookbookNote:show.bible.lookbookNote});
  same("hydration combines Show-owned entity trash with Episode-owned shot trash", {
    characters:hydrated.trash.characters.map(x=>({id:x.id,scenes:x.scenes})),
    locations:hydrated.trash.locations.map(x=>x.id),
    props:hydrated.trash.props.map(x=>x.id),shots:hydrated.trash.shots.map(x=>x.id),
  }, {characters:[{id:"show-deleted",scenes:["e2-s1"]},{id:"legacy-deleted",scenes:["e2-s1"]}],
    locations:[],props:[],shots:["e2-deleted-shot"]});
  same("Show-owned format reaches the episode", hydrated.project, {
    title: "Episode 2", format: "limited-series", episodeOnly: true,
  });
  ok("hydration does not mutate episode input", JSON.stringify(episode) === beforeEpisode);
  ok("hydration does not mutate Show input", JSON.stringify(show) === beforeShow);
  ok("missing Show fails closed", S.hydrateEpisode(episode, null) === null);
  ok("malformed Show fails closed", S.hydrateEpisode(episode, { bible: show.bible }) === null);
  ok("Show marker without a complete Bible fails closed", S.hydrateEpisode(episode, {isShow:true}) === null);
  ok("malformed Show trash fails closed", S.hydrateEpisode(episode,
    {...show,bible:{...show.bible,trash:{characters:[],locations:"bad",props:[]}}}) === null);
}

if (typeof S.mergeAdaptationCast === "function") {
  const existing = [
    { id: "marcus", name: "MARCUS TILLMON", role: "Canonical protagonist", physique: "" },
    { id: "odette", name: "ODETTE BRUMFIELD", role: "Catalyst" },
  ];
  const incoming = [
    { id: "generated-marcus", name: "Marcus Tillmon", role: "Replacement", physique: "Lean" },
    { id: "daniel", name: "DANIEL TILLMON", role: "Mirror" },
  ];
  const scenes = [{ id: "s1", driver: "generated-marcus" }, { id: "s2", driver: "odette" }];
  const before = JSON.stringify({ existing, incoming, scenes });
  const merged = plain(S.mergeAdaptationCast(existing, incoming, scenes));
  ok("adaptation does not duplicate a canonical character by name",
    merged.characters.filter(c => /marcus/i.test(c.name)).length === 1);
  const marcus = merged.characters.find(c => c.id === "marcus");
  ok("existing canonical fact wins over generated replacement", marcus?.role === "Canonical protagonist");
  ok("generated cast fills a missing canonical field", marcus?.physique === "Lean");
  ok("a genuinely new cast member is appended", merged.characters.some(c => c.id === "daniel"));
  ok("scene driver remaps to retained canonical id", merged.scenes[0]?.driver === "marcus");
  ok("unrelated scene driver remains unchanged", merged.scenes[1]?.driver === "odette");
  ok("cast reconciliation does not mutate inputs", JSON.stringify({ existing, incoming, scenes }) === before);

  const collision = plain(S.mergeAdaptationCast(
    [{ id:"alex", name:"ALEX MORGAN", role:"Existing" }],
    [{ id:"alex", name:"ALEX CHEN", role:"New lead" }],
    [{ id:"s1", driver:"alex", cast:["alex"] }],
  ));
  const alexChen = collision.characters.find(c => c.name === "ALEX CHEN");
  ok("a generated id collision never merges two differently named people",
    collision.characters.length === 2 && alexChen && alexChen.id !== "alex");
  ok("scene references remap to the collision-safe canonical id",
    collision.scenes[0]?.driver === alexChen?.id && collision.scenes[0]?.cast[0] === alexChen?.id);

  const restricted = plain(S.mergeAdaptationCast(
    [{ id:"marcus", name:"MARCUS TILLMON", role:"Canonical protagonist", physique:"" }],
    [{ id:"generated-marcus", name:"Marcus Tillmon", physique:"Generated overwrite" },
      { id:"intruder", name:"UNAPPROVED CHARACTER", role:"New lead" }],
    [{ id:"s1", driver:"intruder", reactor:"generated-marcus", cast:["generated-marcus","intruder"] }],
    {allowNew:false},
  ));
  same("a restricted Episode story build cannot add to or fill the Show cast",
    restricted.characters,[{id:"marcus",name:"MARCUS TILLMON",role:"Canonical protagonist",physique:""}]);
  ok("restricted generated references resolve only to canonical Show characters",
    restricted.scenes[0].driver==="marcus" && restricted.scenes[0].reactor==="marcus"
      && restricted.scenes[0].cast.length===1 && restricted.scenes[0].cast[0]==="marcus");
  same("restricted cast reconciliation reports blocked discoveries",
    restricted.blockedNames,["UNAPPROVED CHARACTER"]);
}

if (typeof S.mergeEntitySceneRefs === "function") {
  const merged=plain(S.mergeEntitySceneRefs([
    {id:"old",scenes:["open-a"],episodeScenes:{ep1:["open-a"],ep2:["foreign-a"]}},
    {id:"duplicate",scenes:["open-b"],episodeScenes:{ep1:["open-b"],ep3:["foreign-b"]}},
  ],{id:"old"},"ep1"));
  same("deduplicating shared canon preserves every Episode's namespaced scene references",merged,{
    scenes:["open-a","open-b"],
    episodeScenes:{ep1:["open-a","open-b"],ep2:["foreign-a"],ep3:["foreign-b"]},
  });
}

if (typeof S.mergeEpisodeSceneRefs === "function") {
  const merged=plain(S.mergeEpisodeSceneRefs({
    id:"phone",scenes:["old","other"],episodeScenes:{e1:["old"],e2:["other","s1"]},
  },["new","new"],"e1"));
  same("scene-ref merge makes the open episode slice authoritative",merged.scenes,["new"]);
  same("scene-ref merge preserves only namespaced slices from other episodes",
    merged.episodeScenes,{e1:["new"],e2:["other","s1"]});
  ok("a deleted open-episode scene id cannot survive through the old flat union",
    !merged.scenes.includes("old") && !merged.episodeScenes.e1.includes("old"));
  same("legacy flat scene refs fail closed instead of guessing another episode's ownership",
    plain(S.mergeEpisodeSceneRefs(["old","other"],["new"],"e1")),["new"]);
}

if (typeof S.prepareBibleForEpisode === "function" && typeof S.bibleForEpisode === "function") {
  const e1Stored = S.prepareBibleForEpisode({
    characters: [], locations: [], lookbook: [], lookbookNote: "",
    props: [{ id: "phone", scenes: ["s1", "s2"] }],
  }, "episode-1");
  const e2Working = S.bibleForEpisode(e1Stored, "episode-2", "episode-1", 2);
  e2Working.props[0].scenes = ["s1"]; // local ids may repeat across episodes
  const bothStored = plain(S.prepareBibleForEpisode(e2Working, "episode-2"));
  same("identical local scene ids remain namespaced by episode",
    bothStored.props[0].episodeScenes,
    { "episode-1": ["s1", "s2"], "episode-2": ["s1"] });
  same("Episode 1 materializes only its own shared-entity references",
    plain(S.bibleForEpisode(bothStored, "episode-1", "episode-1", 1).props[0].scenes), ["s1", "s2"]);
  same("Episode 2 materializes only its own shared-entity references",
    plain(S.bibleForEpisode(bothStored, "episode-2", "episode-1", 2).props[0].scenes), ["s1"]);

  const legacyE1=S.bibleForEpisode({characters:[],locations:[],lookbook:[],lookbookNote:"",
    props:[{id:"letter",scenes:["s1"],episodeScenes:{__episode1__:["s1"]}}]},"real-e1",null,1);
  same("resolving legacy Episode 1 migrates its temporary alias",
    plain(legacyE1.props[0].episodeScenes),{"real-e1":["s1"]});
  const persistedLegacy=plain(S.prepareBibleForEpisode(legacyE1,"real-e1"));
  ok("the __episode1__ alias never survives the next Bible persistence",
    !Object.prototype.hasOwnProperty.call(persistedLegacy.props[0].episodeScenes,"__episode1__"));

  const deletedInE1=plain(S.prepareBibleForEpisode({characters:[],locations:[],props:[],lookbook:[],lookbookNote:"",
    trash:{characters:[],locations:[],props:[{id:"letter",scenes:["e1-s1"]}]}} ,"episode-1"));
  same("a shared trash entry stores its originating Episode scene slice",
    deletedInE1.trash.props[0].episodeScenes,{"episode-1":["e1-s1"]});
  const openedInE2=plain(S.bibleForEpisode(deletedInE1,"episode-2","episode-1",2));
  same("opening another Episode cannot inherit a deleted entity's local scene ids",
    {scenes:openedInE2.trash.props[0].scenes,episodeScenes:openedInE2.trash.props[0].episodeScenes},
    {scenes:[],episodeScenes:{"episode-1":["e1-s1"]}});

  const trashedLocation=plain(S.bibleForEpisode({characters:[],locations:[],props:[],lookbook:[],lookbookNote:"",
    trash:{characters:[],props:[],locations:[{id:"house",times:["Night"],areas:["Kitchen"],intExt:"INT",
      scope:"atomic",parentKey:"",continuityRootKey:"house",episodeLocationMeta:{
        "episode-1":{times:["Night"],areas:["Kitchen"],intExt:"INT",scope:"atomic",parentKey:"",continuityRootKey:"house"},
      }}]}},"episode-2","episode-1",2));
  same("shared trashed locations do not leak a sibling Episode's compatibility projection",{
    times:trashedLocation.trash.locations[0].times,
    areas:trashedLocation.trash.locations[0].areas,
    intExt:trashedLocation.trash.locations[0].intExt,
    scope:trashedLocation.trash.locations[0].scope,
    parentKey:trashedLocation.trash.locations[0].parentKey,
    continuityRootKey:trashedLocation.trash.locations[0].continuityRootKey,
  },{times:[],areas:[],intExt:"",scope:"",parentKey:"",continuityRootKey:""});

  const locE1=plain(S.prepareBibleForEpisode({characters:[],props:[],lookbook:[],lookbookNote:"",
    locations:[{id:"house",key:"house",scenes:["s1"],times:["Night"],areas:["Kitchen"],
      intExt:"INT",scope:"atomic",parentKey:"",continuityRootKey:"house"}]},"episode-1"));
  const locE2=plain(S.bibleForEpisode(locE1,"episode-2","episode-1",2));
  same("a new Episode does not inherit another Episode's derived location usage",
    {times:locE2.locations[0].times,areas:locE2.locations[0].areas,intExt:locE2.locations[0].intExt,
      scope:locE2.locations[0].scope,parentKey:locE2.locations[0].parentKey,
      continuityRootKey:locE2.locations[0].continuityRootKey},
    {times:[],areas:[],intExt:"",scope:"",parentKey:"",continuityRootKey:""});
  const locE2Untouched=plain(S.prepareBibleForEpisode(locE2,"episode-2"));
  same("saving an untouched Episode cannot materialize a sibling location hierarchy",
    locE2Untouched.locations[0].episodeLocationMeta["episode-2"],
    {times:[],areas:[],intExt:"",scope:"",parentKey:"",continuityRootKey:""});
  locE2.locations[0]=plain(S.mergeEpisodeLocationMeta(locE2.locations[0],{
    times:["Dawn"],areas:["Living Room"],intExt:"EXT",scope:"compound",
    parentKey:"",continuityRootKey:"house"},"episode-2"));
  locE2.locations[0].scenes=["s1"]; // local ids may repeat here too
  const locStored=plain(S.prepareBibleForEpisode(locE2,"episode-2"));
  same("location usage is namespaced by Episode instead of last-writer-wins",
    locStored.locations[0].episodeLocationMeta,{
      "episode-1":{times:["Night"],areas:["Kitchen"],intExt:"INT",scope:"atomic",parentKey:"",continuityRootKey:"house"},
      "episode-2":{times:["Dawn"],areas:["Living Room"],intExt:"EXT",scope:"compound",parentKey:"",continuityRootKey:"house"},
    });
  same("stored location compatibility fields expose a safe Show-wide projection",{
    times:locStored.locations[0].times,areas:locStored.locations[0].areas,
    intExt:locStored.locations[0].intExt,scope:locStored.locations[0].scope,
  },{times:["Night","Dawn"],areas:["Kitchen","Living Room"],intExt:"INT/EXT",scope:"compound"});
  same("Episode 1 rehydrates only its own location metadata",plain((()=>{
    const l=S.bibleForEpisode(locStored,"episode-1","episode-1",1).locations[0];
    return {times:l.times,areas:l.areas,intExt:l.intExt,scope:l.scope};
  })()),{times:["Night"],areas:["Kitchen"],intExt:"INT",scope:"atomic"});
  same("Episode 2 rehydrates only its own location metadata",plain((()=>{
    const l=S.bibleForEpisode(locStored,"episode-2","episode-1",2).locations[0];
    return {times:l.times,areas:l.areas,intExt:l.intExt,scope:l.scope};
  })()),{times:["Dawn"],areas:["Living Room"],intExt:"EXT",scope:"compound"});

  const hierarchyA=plain(S.rebuildLocationMetaProjection({id:"room",key:"room"},{
    "episode-z":{parentKey:"z-house",continuityRootKey:"z-house",scope:"atomic"},
    "episode-a":{parentKey:"a-house",continuityRootKey:"a-house",scope:"atomic"},
  }));
  const hierarchyB=plain(S.rebuildLocationMetaProjection({id:"room",key:"room"},{
    "episode-a":{parentKey:"a-house",continuityRootKey:"a-house",scope:"atomic"},
    "episode-z":{parentKey:"z-house",continuityRootKey:"z-house",scope:"atomic"},
  }));
  same("conflicting hierarchy discoveries resolve deterministically, independent of save order",
    {a:[hierarchyA.parentKey,hierarchyA.continuityRootKey],b:[hierarchyB.parentKey,hierarchyB.continuityRootKey]},
    {a:["a-house","a-house"],b:["a-house","a-house"]});
}

if (typeof S.nextEpisodeNo === "function") {
  const rows = [
    { showId: "show-a", episodeNo: "1" }, { showId: "show-a", episodeNo: 2 },
    { showId: "show-a", episodeNo: 4 }, { showId: "show-b", episodeNo: 99 },
  ];
  ok("episode numbering ignores another Show", S.nextEpisodeNo(rows, "show-a") === 5);
  ok("persisted Show counter fences stale local rows", S.nextEpisodeNo(rows, "show-a", 8) === 9);
  ok("an empty Show begins with Episode 1", S.nextEpisodeNo([], "show-a") === 1);
}

if (typeof S.groups === "function") {
  const rows = [
    { id: "show-a", title: "A", isShow: "TRUE" },
    { id: "ep-a", title: "A E01", showId: "show-a", episodeNo: 1 },
    { id: "show-b", title: "B", project_kind: "show" },
    { id: "ep-b", title: "B E01", showId: "show-b", episodeNo: 1 },
    { id: "film", title: "Film" },
    { id: "orphan", title: "Recover me", showId: "missing", episodeNo: 3 },
    { id: "normalized-film", title: "Recovered", project_kind:"film", showId:"missing", episodeNo:8 },
  ];
  const grouped = plain(S.groups(rows));
  same("grouping finds legacy-uppercase and normalized Shows", grouped.shows.map(p => p.id), ["show-a", "show-b"]);
  same("grouping preserves standalone films", grouped.standalone.map(p => p.id), ["film", "normalized-film"]);
  same("inaccessible-parent episodes remain recoverable", grouped.unavailable.map(p => p.id), ["orphan"]);
  ok("a valid nested episode is not misreported as standalone or orphan",
    !grouped.standalone.concat(grouped.unavailable).some(p => p.id === "ep-a"));
}

/* ── Browser lifecycle wiring ───────────────────────────────────────────── */
const html = source("TURN.html");
const app = source("app/app.jsx");
const cloud = source("app/cloud.jsx");
const authUI = source("app/auth-ui.jsx");
const homeDashboard = source("app/home-dashboard.jsx");
const ai = source("app/ai.jsx");
const readme = source("supabase/README.md");
const sqlPath = "supabase/series-production.sql";
const sql = source(sqlPath);

/* Execute the Show-Bible merge itself: source-pattern checks cannot catch a
   merge that accidentally drops a concurrently-added entity or another
   Episode's namespaced scene references. */
const bibleMergeSource = section(cloud, "function _seriesJsonSame", "async function cloudSaveBibleSections");
if (bibleMergeSource) {
  const mergeBox = { JSON, Set, Map, Object, String, Array };
  mergeBox.window=mergeBox;
  mergeBox.turnSeries=S;
  vm.createContext(mergeBox);
  vm.runInContext(bibleMergeSource
    + "\nthis.mergeDepartment=_mergeEpisodeBibleDepartment;this.mergeSharedTrash=_seriesMergeSharedTrash;",
    mergeBox);
  const mergeDepartment = mergeBox.mergeDepartment;
  const mergeSharedTrash = mergeBox.mergeSharedTrash;
  const baseline = [
    { id:"A", label:"alpha", scenes:["a1"], episodeScenes:{ep1:["a1"],ep2:["a2"]} },
    { id:"B", label:"bravo", scenes:["b1"], episodeScenes:{ep1:["b1"]} },
  ];
  const incoming = [
    { id:"A", label:"alpha local", scenes:["a3"], episodeScenes:{ep1:["a3"],ep2:["stale"]} },
  ];
  const latest = [
    { id:"A", label:"alpha", remoteNote:"kept", scenes:["a1","a2"], episodeScenes:{ep1:["a1"],ep2:["a2"]} },
    baseline[1],
    { id:"C", label:"concurrent", scenes:["c2"], episodeScenes:{ep2:["c2"]} },
  ];
  const merged = plain(mergeDepartment(latest,incoming,baseline,"ep1"));
  ok("three-way Bible merge succeeds for disjoint local work", merged.ok);
  same("three-way Bible merge applies deletion without dropping a concurrent addition",
    merged.value.map(item=>item.id), ["A","C"]);
  const mergedA=merged.value.find(item=>item.id==="A");
  same("three-way Bible merge retains remote-only canonical fields",
    {label:mergedA?.label,remoteNote:mergedA?.remoteNote}, {label:"alpha local",remoteNote:"kept"});
  same("three-way Bible merge changes only the caller Episode scene slice",
    mergedA?.episodeScenes, {ep1:["a3"],ep2:["a2"]});
  same("derived flat scenes are rebuilt from all authoritative Episode slices",
    mergedA?.scenes, ["a3","a2"]);

  const overlap = plain(mergeDepartment(
    [{id:"A",label:"remote",episodeScenes:{ep1:["a1"]},scenes:["a1"]}],
    [{id:"A",label:"local",episodeScenes:{ep1:["a1"]},scenes:["a1"]}],
    [{id:"A",label:"base",episodeScenes:{ep1:["a1"]},scenes:["a1"]}], "ep1"));
  ok("overlapping Bible field edits fail visibly", !overlap.ok && overlap.conflicts.includes("A.label"));

  const deleteConflict = plain(mergeDepartment(
    [{id:"B",label:"changed remotely"}], [], [{id:"B",label:"base"}], "ep1"));
  ok("an Episode cannot delete an entity changed remotely since its baseline",
    !deleteConflict.ok && deleteConflict.conflicts.some(c=>/delete conflicted/.test(c)));

  const absentOwnSlice = plain(mergeDepartment(
    [{id:"A",scenes:["other"],episodeScenes:{ep2:["other"]}}],
    [{id:"A",scenes:[],episodeScenes:{ep1:[]}}],
    [{id:"A",scenes:["other"],episodeScenes:{ep2:["other"]}}], "ep1"));
  same("a derived scene union is never mistaken for a missing caller slice",
    absentOwnSlice.value[0].episodeScenes, {ep2:["other"],ep1:[]});

  const locSlice=(times,areas,intExt,scope="atomic",parentKey="",continuityRootKey="house")=>
    ({times,areas,intExt,scope,parentKey,continuityRootKey});
  const projected=(map)=>plain(S.rebuildLocationMetaProjection({id:"house",key:"house",
    scenes:["s1"],episodeScenes:{ep1:["s1"],ep2:["s1"]}},map));
  const locationBaseline=[projected({ep1:locSlice(["Night"],["Kitchen"],"INT"),
    ep2:locSlice(["Day"],["Kitchen"],"INT")})];
  const locationIncoming=[projected({ep1:locSlice(["Dawn"],["Kitchen"],"INT"),
    ep2:locSlice(["stale"],["Wrong room"],"EXT")})];
  const locationLatest=[projected({ep1:locSlice(["Night"],["Kitchen"],"INT"),
    ep2:locSlice(["Night"],["Exterior"],"EXT")})];
  const mergedLocation=plain(mergeDepartment(locationLatest,locationIncoming,locationBaseline,"ep1",null,"locations"));
  ok("disjoint location metadata edits in different Episodes merge",mergedLocation.ok);
  same("location merge ignores stale sibling metadata from the caller snapshot",
    mergedLocation.value[0].episodeLocationMeta,{
      ep1:locSlice(["Dawn"],["Kitchen"],"INT"),ep2:locSlice(["Night"],["Exterior"],"EXT")});
  same("location merge rebuilds the Show-wide union after preserving sibling slices",{
    times:mergedLocation.value[0].times,areas:mergedLocation.value[0].areas,intExt:mergedLocation.value[0].intExt,
  },{times:["Dawn","Night"],areas:["Kitchen","Exterior"],intExt:"INT/EXT"});

  const emptyTrash={characters:[],locations:[],props:[]};
  const independentTrash=plain(mergeSharedTrash(
    {characters:[{id:"remote-deleted"}],locations:[],props:[]},
    {characters:[],locations:[],props:[{id:"local-deleted"}]}, emptyTrash));
  ok("independent shared deletes in different Episodes merge", independentTrash.ok);
  same("the shared restore bin retains both independent tombstones", independentTrash.value,
    {characters:[{id:"remote-deleted"}],locations:[],props:[{id:"local-deleted"}]});

  const restoredTrash=plain(mergeSharedTrash(
    {characters:[{id:"restore-me"}],locations:[{id:"remote-deleted"}],props:[]},
    {characters:[],locations:[],props:[]},
    {characters:[{id:"restore-me"}],locations:[],props:[]}));
  ok("restoring a shared entity composes with an unrelated remote delete", restoredTrash.ok);
  same("restore removes only its tombstone", restoredTrash.value,
    {characters:[],locations:[{id:"remote-deleted"}],props:[]});

  const trashConflict=plain(mergeSharedTrash(
    {characters:[{id:"A",note:"remote"}],locations:[],props:[]},
    {characters:[{id:"A",note:"local"}],locations:[],props:[]},
    {characters:[{id:"A",note:"base"}],locations:[],props:[]}));
  ok("overlapping edits to one shared tombstone fail visibly",
    !trashConflict.ok && trashConflict.conflicts.includes("trash.characters.A.note"));

  vm.runInContext("this.rebaseBible=_seriesRebaseBibleAfterReplay;", mergeBox);
  const rebaseBible=mergeBox.rebaseBible;
  const replayCheckpoint={
    characters:[{id:"A",label:"local checkpoint"},{id:"X",label:"added before interruption"}],
    locations:[],props:[],lookbook:[],lookbookNote:"base",
    trash:{characters:[],locations:[],props:[]},
  };
  const replayLatest={
    characters:[{id:"A",label:"local checkpoint"},{id:"X",label:"added before interruption"},
      {id:"C",label:"concurrent collaborator addition"}],
    locations:[],props:[],lookbook:[],lookbookNote:"base",
    trash:{characters:[],locations:[],props:[]},
  };
  const currentAfterReplay={
    characters:[{id:"A",label:"newer local edit"}],
    locations:[],props:[],lookbook:[],lookbookNote:"base",
    trash:{characters:[],locations:[],props:[]},
  };
  const replayRebased=plain(rebaseBible(replayLatest,currentAfterReplay,replayCheckpoint,"ep1"));
  ok("recovery rebase succeeds for a newer disjoint local edit", replayRebased.ok);
  same("recovery rebase preserves a concurrent addition and honours a post-journal deletion",
    replayRebased.bible.characters.map(item=>item.id),["A","C"]);
  ok("recovery rebase keeps the newer local field value",
    replayRebased.bible.characters.find(item=>item.id==="A")?.label==="newer local edit");
}

const seriesTag = html.search(/<script[^>]+app\/series\.js/i);
const appTag = html.search(/<script[^>]+app\/app(?:\.jsx|\.js)/i);
ok("TURN loads the series invariants", seriesTag >= 0);
ok("series invariants load before the application", seriesTag >= 0 && appTag >= 0 && seriesTag < appTag);

const makeShowBlock = section(app, "const makeShow", "const createEpisode");
const createProjectBlock = section(app, "const createProject", "/* Dashboard");
const createEpisodeBlock = section(app, "const createEpisode", "const renameProject");
const deleteProjectBlock = section(app, "const deleteProject", "const [agentLaunch");
const saveBlock = section(app, "const bibleSavedRef", "/* UNLOAD GUARD");
const conflictBlock = section(app, "const _docConflictCheck", "// persist the editable story");
const loadBlock = section(app, "const flushPendingProjectSave", "/* on sign-in");
const signOutBlock = section(app, "const signOut", "// ---- cloud projects");
const newStoryBlock = section(app, "// New Story intake", "// MUSE —");

ok("conversion uses the durable conversion boundary", /cloudConvertProjectToShow/.test(makeShowBlock));
ok("conversion does not directly create an unattached Show", !/cloudCreateProject\s*\(/.test(makeShowBlock));
ok("successful conversion adopts persisted Episode 1 metadata",
  /showId/.test(makeShowBlock) && /episodeNo/.test(makeShowBlock));
ok("new episode uses the server-backed episode creator", /cloudCreateShowEpisode/.test(createEpisodeBlock));
ok("new episode does not directly race cloudCreateProject", !/cloudCreateProject\s*\(/.test(createEpisodeBlock));
ok("new episode format is not copied from the currently open unrelated film",
  !/format\s*:\s*\(project\s*&&\s*project\.format\)/.test(createEpisodeBlock));
ok("whole Show deletion is wired in the app", /cloudDeleteShow/.test(app));
ok("Project Switcher receives whole-Show deletion", /onDeleteShow\s*:/.test(app));
ok("Project Switcher receives series busy state", /\bseriesBusy\s*(?::|,)/.test(app));
ok("ordinary delete checks durable success before changing React state", (() => {
  const cloudCall = deleteProjectBlock.indexOf("await cloudDeleteProject(id)");
  const successCheck = deleteProjectBlock.indexOf("if(!(r&&r.ok))",cloudCall);
  const stateChange = deleteProjectBlock.indexOf("const remaining=all.filter",successCheck);
  return cloudCall >= 0 && successCheck > cloudCall && stateChange > successCheck;
})());
ok("episode hydration uses the fail-closed shared helper", /turnSeries\.hydrateEpisode/.test(app));
ok("New Story cast merges into the Show Bible", /turnSeries\.mergeAdaptationCast/.test(app));
ok("shared entity scene references preserve other episodes", /turnSeries\.mergeEpisodeSceneRefs/.test(app));
ok("derived shared location metadata is written through the Episode namespace",
  /turnSeries\.mergeEpisodeLocationMeta/.test(app) && /episodeLocationMeta/.test(app));
ok("Show-Bible merging treats location metadata as one caller-owned Episode slice",
  /department==="locations"/.test(cloud) && /\.episodeLocationMeta\."\+episodeId/.test(cloud));
ok("shared Bible saves use department-level merge", /cloudSaveBibleSections/.test(saveBlock));
ok("shared Bible no longer overwrites the whole Show doc", !/cloudSaveDoc\s*\(\s*currentShowId/.test(saveBlock));
ok("shared Bible saves send the episode's last accepted baseline for three-way merge",
  /cloudSaveBibleSections\s*\([^)]*[\s\S]{0,240}?baseline\s*:\s*_bibleBaseline/.test(saveBlock));
ok("Bible save baseline advances only after confirmed success", (() => {
  const call = saveBlock.search(/cloudSaveBibleSections/);
  const afterCall = call < 0 ? "" : saveBlock.slice(call);
  const success = afterCall.search(/\.ok\b/);
  const baseline = afterCall.search(/bibleSavedRef\.current\s*=/);
  return call >= 0 && success >= 0 && baseline > success;
})());
ok("overlapping save conflicts keep the local edit visible and unsaved",
  /dirtyRef\.current\s*=\s*true/.test(conflictBlock)
  && /setSaveState\(["']failed["']\)/.test(conflictBlock)
  && /Your local edit is still visible and has NOT been saved/.test(conflictBlock));
ok("cloud conflict replacement requires an explicit destructive confirmation",
  /appConfirm\s*\(\s*\{[\s\S]{0,500}?confirmLabel\s*:\s*["']Load cloud version["'][\s\S]{0,100}?cancelLabel\s*:\s*["']Keep my edits["'][\s\S]{0,100}?danger\s*:\s*true/.test(conflictBlock)
  && /if\s*\(!replaceLocal\)\s*\{[\s\S]{0,300}?return\s*;/.test(conflictBlock));
ok("confirmed conflict replacement retires the local journal before loading server truth",
  /_seriesOutboxRows\(conflictedProjectId,conflictedShowId\)[\s\S]{0,100}?_seriesOutboxClear/.test(conflictBlock)
  && /loadProjectIntoState\(conflictedProjectId,\{discardPending:true\}\)/.test(conflictBlock));
ok("successful Bible merges hydrate locally edited departments from server truth",
  /_adoptBibleTheirs\s*\(\s*scoped\s*,\s*\[\s*\]\s*\)/.test(saveBlock)
  && /authoritative even for departments this window just edited/.test(saveBlock));
ok("a stale Bible save hands its authoritative merge to the queued generation",
  /const\s+bibleRebaseRef\s*=\s*React\.useRef\(null\)/.test(saveBlock)
  && /bibleRebaseRef\.current\s*=\s*\{projectId:ctx\.projectId,showId:ctx\.showId,[\s\S]{0,120}?latest:merged,checkpoint:_bibleStored\}/.test(saveBlock));
ok("a queued generation rebases before it computes the next Bible write",
  /const\s+queued\s*=\s*bibleRebaseRef\.current/.test(saveBlock)
  && /applyBibleRebase\(queued\.latest,queued\.checkpoint/.test(saveBlock)
  && saveBlock.indexOf("applyBibleRebase(queued.latest,queued.checkpoint")
      < saveBlock.indexOf("const _bibleKeys=sharedKeys.filter"));
ok("project switching flushes pending writes before hydration replaces state", (() => {
  const flush = loadBlock.indexOf("flushPendingProjectSave(fromId)");
  const hydrate = loadBlock.indexOf("hydratingRef.current = true");
  return flush >= 0 && hydrate > flush;
})());
ok("creating a film or episode cannot strand edits in the previously open project",
  /flushPendingProjectSave\(ownerId\)/.test(createProjectBlock)
  && /flushPendingProjectSave\(ownerId\)/.test(createEpisodeBlock));
ok("signing out flushes the open project and aborts logout on save failure", (() => {
  const flush=signOutBlock.indexOf("flushPendingProjectSave(currentProjectId)");
  const abort=signOutBlock.indexOf("return false");
  const logout=signOutBlock.indexOf("cloudSignOut");
  return flush>=0 && abort>flush && logout>abort;
})());
ok("ordinary Episode deletion uses the series lifecycle RPC and surfaces cleanup warnings",
  /cloudDeleteShowEpisode\s*\(\s*id\s*\)/.test(deleteProjectBlock)
  && /cleanupWarning/.test(deleteProjectBlock));
ok("hydration never declares pending edits saved",
  !/hydratingRef\.current\s*\)\s*\{[^}]{0,160}?dirtyRef\.current\s*=\s*false/.test(saveBlock));
ok("autosave requests execute through one serialized promise queue",
  /launched\s*=\s*saveQueueRef\.current[\s\S]{0,100}?\.then\(performSave\)/.test(saveBlock)
  && /saveQueueRef\.current\s*=\s*launched/.test(saveBlock));
ok("save responses are fenced to their project, Show scope, and latest generation",
  /_saveScopeActive/.test(saveBlock) && /_saveGenerationLatest/.test(saveBlock)
  && /_docSaveResult\s*=\s*\(r,\s*ctx\)/.test(saveBlock));
ok("older save responses cannot adopt cloud state into a newer edit",
  /_saveGenerationLatest\(ctx\)\s*&&\s*ep/.test(saveBlock)
  && /_saveGenerationLatest\(ctx\)\)\s*_adoptTheirs/.test(saveBlock));
ok("a two-row Episode + Show Bible save journals both patches before either write", (()=>{
  const journal=saveBlock.indexOf("_seriesOutboxPut({episodeId:ctx.projectId");
  const episodeWrite=saveBlock.indexOf("cloudSaveSections(ctx.projectId,_epChanged",journal);
  const bibleWrite=saveBlock.indexOf("cloudSaveBibleSections(ctx.showId,_biblePatch",journal);
  return journal>=0 && episodeWrite>journal && bibleWrite>journal;
})());
ok("the paired-save journal is fail-closed, bounded, and cleared only after both writes succeed", (()=>{
  const pair=saveBlock.indexOf("_seriesOutboxPut({episodeId:ctx.projectId");
  const blocked=saveBlock.indexOf("if(!_pairJournalKey) return",pair);
  const joined=saveBlock.indexOf("for(const job of jobs)",pair);
  const failure=saveBlock.indexOf("if(!(r&&r.ok)) return",joined);
  const clear=saveBlock.indexOf("_seriesOutboxClear(_pairJournalKey)",failure);
  return /SERIES_PAIR_OUTBOX_MAX_ENTRIES/.test(loadBlock)
    && /SERIES_PAIR_OUTBOX_MAX_ENTRY_CHARS/.test(loadBlock)
    && pair>=0 && blocked>pair && joined>blocked && failure>joined && clear>failure;
})());
ok("a paired save persists Episode-owned story before shared Show canon", (()=>{
  const episodeJob=saveBlock.indexOf('jobs.push({kind:"episode"');
  const bibleJob=saveBlock.indexOf('jobs.push({kind:"bible"');
  const loop=saveBlock.indexOf("for(const job of jobs)",episodeJob);
  return episodeJob>=0 && bibleJob>episodeJob && loop>bibleJob && !/Promise\.all\(jobs\)/.test(saveBlock);
})());
ok("Episode + Show hydration replays and then re-reads an interrupted paired save", (()=>{
  const replay=loadBlock.indexOf("_replaySeriesPairOutbox(id,d.showId)");
  const rereadEpisode=loadBlock.indexOf("cloudLoadProject(id)",replay);
  const rereadShow=loadBlock.indexOf("cloudLoadProject(d.showId)",replay);
  const hydrate=loadBlock.indexOf("turnSeries.hydrateEpisode",replay);
  return replay>=0 && rereadEpisode>replay && rereadShow>rereadEpisode && hydrate>rereadShow;
})());
ok("paired-save replay carries both the Episode project and Show Bible baselines",
  /episodeBaseline\s*:\s*_episodeSectionSaveOpts\(_epChanged,true\)/.test(saveBlock)
  && /baseline\s*:\s*item\.episodeBaseline/.test(loadBlock)
  && /baseline\s*:\s*item\.bibleBaseline/.test(loadBlock));
ok("paired-save recovery captures every changed Episode section baseline through the Episode wrapper",
  /const\s+_sectionSaveOpts\s*=\s*\(sections,fullRecoveryBaseline\)/.test(saveBlock)
  && /k!==["']project["']&&!fullRecoveryBaseline/.test(saveBlock)
  && /const\s+_episodeSectionSaveOpts\s*=\s*\(sections,fullRecoveryBaseline\)[\s\S]{0,160}?_sectionSaveOpts\(sections,fullRecoveryBaseline\)/.test(saveBlock)
  && /_episodeSectionSaveOpts\(_epChanged,true\)/.test(saveBlock));
ok("an Episode replay conflicts instead of overwriting a newer same-section edit",
  /Object\.prototype\.hasOwnProperty\.call\(sectionBaseline,k\)/.test(cloud)
  && /sectionConflicts\.push\(k\)/.test(cloud)
  && /Episode changed after an interrupted save/.test(cloud));
ok("top-level project saves pass their acknowledged baseline in standalone and Episode scopes",
  /cloudSaveSections\(ctx\.projectId,_epChanged,_episodeSectionSaveOpts\(_epChanged\)\)/.test(saveBlock)
  && /cloudSaveSections\(ctx\.projectId,_changed,_sectionSaveOpts\(_changed\)\)/.test(saveBlock));
ok("a Series Show write is gated only by the Bible departments in its patch",
  /const\s+_writeBible\s*=\s*_bibleKeys\.length>0[\s\S]{0,140}?stableJson\(_biblePatch\)!==stableJson\(_bibleBaselinePatch\)/.test(saveBlock)
  && !/const\s+_writeBible\s*=\s*_bibleKeys\.length>0\s*&&\s*stableJson\(_bibleStored\)/.test(saveBlock));
ok("room mutability derives from the shared role helper",
  /teamCanWriteRoom\s*===\s*["']function["'][\s\S]{0,120}?teamCanWriteRoom\(shareRole,id\)/.test(app));
ok("Art directors get a read-only Writers' Room without losing Art Room editability",
  /const\s+writersRoomReadOnly\s*=\s*!_sharedCanWriteRoom\(["']writers["']\)/.test(app)
  && /const\s+artRoomReadOnly\s*=\s*!_sharedCanWriteRoom\(["']art["']\)/.test(app)
  && /readOnly:writersRoomBlocked/.test(app)
  && /canReview:!roomReadOnly/.test(app));
const writersAgentBlock = section(app, "const agentCtxFactory", "const artAgentCtxFactory = (");
ok("Writers' Room agents fence commits and cancellation against live role changes",
  /if\s*\(writersRoomReadOnlyRef\.current\)/.test(writersAgentBlock)
  && /cancelled:[^\n]*writersRoomReadOnlyRef\.current/.test(writersAgentBlock));
ok("denied local sections roll back instead of becoming phantom Saved state",
  /const\s+prior\s*=\s*lastSentRef\.current\[k\]/.test(saveBlock)
  && /setter\(JSON\.parse\(prior\)\)/.test(saveBlock)
  && /if\s*\(_deniedLocal\)/.test(saveBlock)
  && /dirtyRef\.current\s*=\s*true/.test(saveBlock)
  && /await\s+new\s+Promise\(resolve=>setTimeout\(resolve,0\)\)[\s\S]{0,80}?return\s+false/.test(saveBlock));
ok("Show conversion waits for the commit's autosave before crossing storage scope", (() => {
  const yieldToEffects = makeShowBlock.indexOf("setTimeout(resolve,0)");
  const flush = makeShowBlock.indexOf("flushPendingProjectSave(ownerProjectId)");
  const boundary = makeShowBlock.indexOf("seriesBoundaryRef.current={projectId:ownerProjectId");
  const convert = makeShowBlock.indexOf("cloudConvertProjectToShow");
  return yieldToEffects >= 0 && flush > yieldToEffects && boundary > flush && convert > boundary
    && /seriesBoundaryRef\.current[\s\S]{0,400}?ctx\.showId/.test(saveBlock);
})());
ok("Show conversion preserves a registered Show-capable format",
  /registeredFormat\.needsShow&&registeredFormat\.id/.test(makeShowBlock)
  && /fmt:seriesFormatId/.test(makeShowBlock)
  && !/format\s*:\s*["']series["']/.test(makeShowBlock));
ok("Show conversion immediately replaces the source film's normalized row identity",
  /showMeta\s*=\s*\{[\s\S]{0,180}?project_kind\s*:\s*["']show["']/.test(makeShowBlock)
    && /episodeMeta\s*=\s*\{[\s\S]{0,180}?project_kind\s*:\s*["']episode["'][\s\S]{0,180}?show_id\s*:\s*show\.id/.test(makeShowBlock));
ok("failed automatic Show conversion is fenced against a seriesBusy retry loop", (()=>{
  const automatic=section(app,"/* Series is not merely a badge", "const [agentLaunch");
  const checked=automatic.indexOf("autoSeriesAttemptRef.current[projectKey]===attemptKey");
  const armed=automatic.indexOf("autoSeriesAttemptRef.current[projectKey]=attemptKey");
  const launch=automatic.indexOf("makeShow({automatic:true})");
  return /const autoSeriesAttemptRef\s*=\s*React\.useRef/.test(app)
    && checked>=0 && armed>checked && launch>armed;
})());
ok("New Story locks Show format only when it builds into the blank current Episode",
  /newStoryBuildsCurrentEpisode\s*=\s*!!\(currentShowId\s*&&\s*!scenes\.length\)/.test(app)
  && /initialFormat\s*:\s*newStoryBuildsCurrentEpisode\s*\?\s*newStoryEpisodeFormat\s*:\s*undefined/.test(newStoryBlock)
  && /formatLocked\s*:\s*newStoryBuildsCurrentEpisode/.test(newStoryBlock));
ok("New Story from a populated Episode keeps free format choice at the launch boundary",
  /effectiveFormatId\s*=\s*newStoryBuildsCurrentEpisode\s*\?\s*newStoryEpisodeFormat\s*:\s*formatId/.test(newStoryBlock));

/* ── Cloud boundaries ───────────────────────────────────────────────────── */
for (const fn of [
  "cloudConvertProjectToShow", "cloudCreateShowEpisode", "cloudDeleteShowEpisode", "cloudDeleteShow", "cloudSaveBibleSections",
]) {
  ok("cloud helper defined: " + fn, new RegExp("async\\s+function\\s+" + fn + "\\b").test(cloud));
  ok("cloud helper exported: " + fn, new RegExp("window\\." + fn + "\\s*=").test(cloud));
}
ok("conversion prefers its transactional RPC", /rpc\s*\(\s*["']turn_convert_project_to_show["']/.test(cloud));
ok("lifecycle RPC responses are normalized before entering client state",
  (cloud.match(/_cloudNormalizeSeriesRow\(data\.(?:show|episode)\)/g)||[]).length>=3);
ok("project lists carry normalized project_kind for Show classification",
  /select\(["'][^"']*\bproject_kind\b[^"']*["']\)/.test(cloud));
ok("project lists carry canonical Episode relationship columns",
  /select\(["'][^"']*\bshow_id\b[^"']*\bepisode_no\b[^"']*["']\)/.test(cloud));
ok("project list and load paths normalize canonical series rows",
  /const rows = \(data \|\| \[\]\)\.map\(_cloudNormalizeSeriesRow\)/.test(cloud)
    && /return _cloudNormalizeSeriesRow\(data\)/.test(
      section(cloud,"async function cloudLoadProject","MULTI-WINDOW SAVE FENCE")));
ok("project lists retain a legacy JSON-marker fallback before the series migration",
  /if\s*\(error\s*&&\s*\/project_kind\|schema cache\/i/.test(cloud)
    && /select\(legacyFields\)/.test(cloud));
const convertCloudBlock = section(cloud, "async function cloudConvertProjectToShow", "window.cloudConvertProjectToShow");
ok("conversion fails closed when its transaction RPC is not installed",
  /series-production database migration[\s\S]{0,100}?No projects were changed/i.test(convertCloudBlock));
ok("conversion has no orphan-prone browser multi-write fallback",
  !/cloudCreateProject\s*\(|cloudPatchDoc\s*\(|cloudDeleteProject\s*\(/.test(convertCloudBlock));
ok("ambiguous conversion responses read back the committed Show and Episode pair",
  /_seriesReconcileConversion\s*\(\s*sb\s*,\s*episodeId/.test(convertCloudBlock)
  && /async function _seriesReadConvertedPair[\s\S]*sourceEpisodeId[\s\S]*reconciled:true/.test(cloud));
ok("unconfirmed conversion keeps an explicit safe-retry state",
  /retryState\s*:\s*\{operation\s*:\s*["']convert-project-to-show["']\s*,\s*episodeId/.test(cloud)
  && /Try Create show again; TURN will safely reconcile the same Episode 1/i.test(cloud));
ok("episode creation prefers its transactional RPC", /rpc\s*\(\s*["']turn_create_show_episode["']/.test(cloud));
const createEpisodeCloudBlock = section(cloud, "async function cloudCreateShowEpisode", "window.cloudCreateShowEpisode");
ok("episode creation sends a durable idempotency key", /p_request_id\s*:\s*requestId/.test(cloud));
ok("ambiguous Episode-create responses retain a retry-safe request", /retrySafe\s*:\s*true/.test(cloud)
  && /safely resume the same request/i.test(cloud));
ok("Episode request ids are supplied by one UI intent rather than browser-global storage",
  /async function cloudCreateShowEpisode\(showId,\s*blankDoc,\s*opts\)/.test(cloud)
  && /_seriesEpisodeRequest\(opts\)/.test(createEpisodeCloudBlock)
  && !/localStorage|sessionStorage/.test(section(cloud,"function _seriesEpisodeRequest","function _seriesAmbiguousTransport")));
ok("only an ambiguous Episode-create result is retained for an explicit retry",
  /episodeCreateRetryRef\.current\s*=\s*\(result&&result\.retrySafe&&result\.requestId\)/.test(createEpisodeBlock)
  && /cloudCreateShowEpisode\(showId,emptyDoc\(\),requestId\?\{requestId\}:undefined\)/.test(createEpisodeBlock)
  && /episodeCreateRetryRef\.current\s*=\s*null/.test(createEpisodeBlock));
ok("ambiguous Episode-create outcomes return their exact intent id",
  /retrySafe:true,\s*requestId[\s\S]{0,120}?operation\s*:\s*["']create-show-episode["']/.test(createEpisodeCloudBlock));
ok("Episode creation fails closed when its transaction RPC is not installed",
  /series-production database migration[\s\S]{0,100}?No projects were changed/i.test(createEpisodeCloudBlock));
ok("Episode creation has no race-prone browser counter fallback",
  !/cloudPatchDoc\s*\(|cloudCreateProject\s*\(/.test(createEpisodeCloudBlock));
ok("Episode creation never trusts a browser-computed episode counter",
  !/knownMax/.test(createEpisodeBlock) && /cloudCreateShowEpisode\s*\(showId,\s*blankDoc,\s*opts\)/.test(createEpisodeCloudBlock));
const lifecycleExecSource=section(cloud,"function _seriesError","window.cloudCreateShowEpisode=cloudCreateShowEpisode;");
if(lifecycleExecSource){
  const uuid1="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const uuid2="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const state={mode:"conversion-committed",ids:[uuid1,uuid2],rpcIds:[]};
  const rows={
    episode:{id:"episode-1",showId:"show-1",doc:{showId:"show-1",episodeNo:1}},
    show:{id:"show-1",project_kind:"show",doc:{isShow:true,sourceEpisodeId:"episode-1"}},
  };
  const sb={
    async rpc(name,args){
      if(name==="turn_convert_project_to_show")
        return state.mode==="conversion-committed"
          ? {data:null,error:{message:"network response lost"}}
          : {data:null,error:{message:"network response lost"}};
      state.rpcIds.push(args.p_request_id);
      if(state.mode==="episode-success")
        return {data:{episode:{id:"episode-2",doc:{episodeNo:2}},episode_no:2,show:{id:"show-1",doc:{}}},error:null};
      return {data:null,error:{message:"network response lost"}};
    },
    from(){
      let id="";
      const q={
        select(){ return q; },
        eq(key,value){ if(key==="id") id=String(value); return q; },
        async single(){
          const row=id==="episode-1" ? rows.episode : id==="show-1" ? rows.show : null;
          return {data:row,error:row?null:{message:"not found"}};
        },
      };
      return q;
    },
  };
  const lifecycleBox={window:null,String,RegExp,Number,Math,Array,Object,Uint8Array,
    crypto:{randomUUID:()=>state.ids.shift()},
    sbClient:()=>sb,_seriesRpcMissing:()=>false,
    _cloudNormalizeSeriesRow:row=>row,cloudNoteDocRev:()=>{}};
  lifecycleBox.window=lifecycleBox;
  vm.createContext(lifecycleBox);
  vm.runInContext(lifecycleExecSource
    +"\nthis.convert=cloudConvertProjectToShow;this.createEpisode=cloudCreateShowEpisode;",lifecycleBox);
  const reconciled=plain(await lifecycleBox.convert("episode-1","Show",{},{}));
  ok("lost conversion response adopts its verified committed pair",
    reconciled.ok && reconciled.reconciled && reconciled.show.id==="show-1" && reconciled.episode.id==="episode-1");
  rows.episode={id:"episode-1",doc:{}};
  const retryConversion=plain(await lifecycleBox.convert("episode-1","Show",{},{}));
  ok("unverifiable conversion response preserves explicit retry state",
    !retryConversion.ok && retryConversion.retrySafe
      && retryConversion.retryState.operation==="convert-project-to-show"
      && retryConversion.retryState.episodeId==="episode-1");
  state.mode="episode-ambiguous";
  const ambiguousCreate=plain(await lifecycleBox.createEpisode("show-1",{}));
  state.mode="episode-success";
  const resumedCreate=plain(await lifecycleBox.createEpisode("show-1",{},{
    requestId:ambiguousCreate.requestId,
  }));
  const freshCreate=plain(await lifecycleBox.createEpisode("show-1",{}));
  ok("same Episode-create intent reuses its id after an ambiguous response",
    ambiguousCreate.retrySafe && resumedCreate.ok
      && state.rpcIds[0]===uuid1 && state.rpcIds[1]===uuid1);
  ok("a later unrelated Episode-create intent receives a fresh id",
    freshCreate.ok && state.rpcIds[2]===uuid2 && state.rpcIds[2]!==state.rpcIds[1]);
}
ok("whole Show deletion is RPC-only", (() => {
  const block = section(cloud, "async function cloudDeleteShow", "window.cloudDeleteShow");
  return /turn_delete_show/.test(block) && !/\.from\s*\(\s*["']turn_projects["']/.test(block);
})());
ok("whole Show deletion fails safely when migration is missing", /series-production database migration[\s\S]{0,100}?No projects were deleted/i.test(cloud));
const deleteShowCloudBlock = section(cloud, "async function cloudDeleteShow", "window.cloudDeleteShow");
ok("Show deletion inventories assets before its database RPC", (() => {
  const inventory = deleteShowCloudBlock.indexOf("_seriesDeleteInventory");
  const rpc = deleteShowCloudBlock.indexOf('rpc("turn_delete_show"');
  return inventory >= 0 && rpc > inventory;
})());
ok("Show deletion inventories generated assets and optional cameos",
  /_seriesRowsForProjects[\s\S]{0,180}turn_generations/.test(cloud)
  && /_seriesRowsForProjects[\s\S]{0,180}turn_cameos/.test(cloud));
ok("Show asset cleanup uses exact object keys, never a Storage prefix listing",
  /_seriesScopedStoragePath/.test(cloud) && /_seriesRemoveExactPaths/.test(deleteShowCloudBlock)
  && !/\.storage[\s\S]{0,100}\.list\s*\(/.test(deleteShowCloudBlock));
ok("Show cleanup adopts transaction-time generation and cameo paths returned by the delete RPC",
  /generation_storage_paths/.test(deleteShowCloudBlock) && /cameo_storage_paths/.test(deleteShowCloudBlock)
  && /_seriesScopedStoragePath/.test(deleteShowCloudBlock));
ok("Show asset cleanup happens only after durable database deletion", (() => {
  const rpc = deleteShowCloudBlock.indexOf('rpc("turn_delete_show"');
  const cleanup = deleteShowCloudBlock.indexOf("_seriesRemoveExactPaths");
  return rpc >= 0 && cleanup > rpc;
})());
ok("post-commit asset cleanup failure does not misreport the Show deletion",
  /cleanupWarning/.test(deleteShowCloudBlock)
  && /catch\s*\([^)]*\)\s*\{[\s\S]{0,180}?return\s*\{\s*ok\s*:\s*true/.test(deleteShowCloudBlock));
ok("lost Show-delete response is resolved by reading the Show row back",
  /responseLost/.test(deleteShowCloudBlock) && /_seriesConfirmProjectAbsent\s*\(\s*sb\s*,\s*showId\s*\)/.test(deleteShowCloudBlock));
ok("confirmed absent Show cleans the preflight manifest but reports transaction-window uncertainty",
  /unverifiedTransactionManifest/.test(deleteShowCloudBlock)
  && /Preflight assets were cleaned/.test(deleteShowCloudBlock)
  && /!manifestUncertain/.test(deleteShowCloudBlock));
ok("uncertain Show-delete state never attempts asset cleanup", (()=>{
  const confirmation=deleteShowCloudBlock.indexOf("_seriesConfirmProjectAbsent");
  const uncertain=deleteShowCloudBlock.indexOf("uncertain:true",confirmation);
  const cleanup=deleteShowCloudBlock.indexOf("_seriesRemoveExactPaths",confirmation);
  return confirmation>=0 && uncertain>confirmation && cleanup>uncertain;
})());
ok("successful Show asset cleanup releases its short-lived grant",
  /turn_finish_asset_cleanup/.test(deleteShowCloudBlock));
const deleteEpisodeCloudBlock = section(cloud, "async function cloudDeleteShowEpisode", "window.cloudDeleteShowEpisode");
ok("single Episode deletion is RPC-only", /turn_delete_show_episode/.test(deleteEpisodeCloudBlock)
  && !/\.from\s*\(\s*["']turn_projects["']\s*\)\s*\.delete/.test(deleteEpisodeCloudBlock));
ok("Episode deletion inventories assets before its database RPC", (() => {
  const inventory = deleteEpisodeCloudBlock.indexOf("_seriesDeleteEpisodeInventory");
  const rpc = deleteEpisodeCloudBlock.indexOf('rpc("turn_delete_show_episode"');
  return inventory >= 0 && rpc > inventory;
})());
ok("Episode cleanup adopts transaction-time generation and cameo paths",
  /generation_storage_paths/.test(deleteEpisodeCloudBlock) && /cameo_storage_paths/.test(deleteEpisodeCloudBlock));
ok("Episode cleanup subtracts assets still referenced by its surviving family",
  /protected_storage_paths/.test(deleteEpisodeCloudBlock)
  && /for\s*\(const path of protectedPaths\)\s*exactPaths\.delete\(path\)/.test(deleteEpisodeCloudBlock)
  && /survivingProjectIds/.test(cloud));
ok("Episode cleanup runs only after the durable delete RPC", (() => {
  const rpc = deleteEpisodeCloudBlock.indexOf('rpc("turn_delete_show_episode"');
  const cleanup = deleteEpisodeCloudBlock.indexOf("_seriesRemoveExactPaths");
  return rpc >= 0 && cleanup > rpc;
})());
ok("post-commit Episode cleanup failure remains a cleanup warning",
  /cleanupWarning/.test(deleteEpisodeCloudBlock)
  && /catch\s*\([^)]*\)\s*\{[\s\S]{0,180}?return\s*\{\s*ok\s*:\s*true/.test(deleteEpisodeCloudBlock));
ok("lost Episode-delete response is resolved without deleting unverified assets",
  /responseLost/.test(deleteEpisodeCloudBlock)
  && /_seriesConfirmProjectAbsent\s*\(\s*sb\s*,\s*episodeId\s*\)/.test(deleteEpisodeCloudBlock)
  && /uncertain:true/.test(deleteEpisodeCloudBlock));
ok("confirmed absent Episode reports its missing transaction-time asset manifest",
  /unverifiedTransactionManifest/.test(deleteEpisodeCloudBlock)
  && /Preflight assets were cleaned/.test(deleteEpisodeCloudBlock));
ok("client recognizes the authoritative final-Episode refusal",
  /finalEpisode\s*:\s*true/.test(deleteEpisodeCloudBlock) && /Delete the Show to remove its final Episode/.test(cloud));
ok("shared-Bible save preserves Show metadata and untouched departments",
  /const\s+next\s*=\s*\{\s*\.\.\.cloudDoc\s*,\s*bible/.test(cloud)
  && /const\s+bible\s*=\s*\{\s*\.\.\.\(\(cloudDoc/.test(cloud));
const bibleSaveCloudBlock=section(cloud,"async function cloudSaveBibleSections","window.cloudSaveBibleSections");
ok("shared-Bible save uses a revision fence", /doc->>_rev/.test(bibleSaveCloudBlock));
ok("project delete returns an explicit durable result", /async function cloudDeleteProject[\s\S]{0,1000}?return\s*\{\s*ok\s*:\s*true/.test(cloud));

const rpcMissingSource=section(cloud,"function _seriesRpcMissing","function _seriesError");
if(rpcMissingSource){
  const rpcBox={String,RegExp}; vm.createContext(rpcBox);
  vm.runInContext(rpcMissingSource+"\nthis.isMissing=_seriesRpcMissing;",rpcBox);
  ok("RPC setup detection recognizes the exact absent lifecycle function",
    rpcBox.isMissing({code:"PGRST202",message:"Could not find the function public.turn_create_show_episode"},"turn_create_show_episode"));
  ok("an internal undefined SQL helper is not mistaken for a missing lifecycle RPC",
    !rpcBox.isMissing({code:"42883",message:"function public.some_internal_helper(uuid) does not exist"},"turn_create_show_episode"));
  ok("generic schema-cache failures do not clear lifecycle retry state",
    !rpcBox.isMissing({code:"PGRST204",message:"schema cache missing column"},"turn_create_show_episode"));
}

const projectMergeSource=section(cloud,"function _seriesMergeProjectObject","/* COLLABORATIVE SECTION SAVE");
if(projectMergeSource){
  const projectBox={JSON,Set,Object,Array}; vm.createContext(projectBox);
  vm.runInContext("function _seriesJsonSame(a,b){return JSON.stringify(a)===JSON.stringify(b);}\n"
    +projectMergeSource+"\nthis.mergeProject=_seriesMergeProjectObject;",projectBox);
  const baseline={title:"Base",genre:"Drama",styleBible:{tone:"old"}};
  const latest={title:"Base",genre:"Drama",styleBible:{tone:"new"},remoteFlag:true};
  const incoming={title:"Writer title",genre:"Drama",styleBible:{tone:"old"}};
  const disjoint=plain(projectBox.mergeProject(latest,incoming,baseline));
  same("project three-way merge preserves disjoint writer and art-direction changes",
    disjoint.value,{title:"Writer title",genre:"Drama",styleBible:{tone:"new"},remoteFlag:true});
  const overlapProject=plain(projectBox.mergeProject(
    {title:"Remote",genre:"Drama"},{title:"Local",genre:"Drama"},{title:"Base",genre:"Drama"}));
  ok("project three-way merge surfaces overlapping key edits",
    !overlapProject.ok && overlapProject.conflicts.includes("project.title"));
  ok("project merge fails closed without its acknowledged baseline",
    !projectBox.mergeProject(latest,incoming,undefined).ok);
}
const sectionSaveBlock=section(cloud,"async function cloudSaveSections","window.cloudSaveSections");
ok("cloud section save invokes the baseline-aware project merge",
  /_seriesMergeProjectObject/.test(sectionSaveBlock) && /opts\.baseline/.test(sectionSaveBlock));

const promotionBlock = section(cloud, "function _seriesStableHash", "window.cloudPromoteProjectAssets");
ok("asset promotion uses deterministic retry-stable object keys",
  /_seriesMigrationTarget/.test(promotionBlock) && /_seriesStableHash\s*\(\s*sourcePath\s*\)/.test(promotionBlock)
  && !/turnStamp\s*\(|turnShortId\s*\(/.test(promotionBlock));
ok("asset promotion persists a stable row idempotency key",
  /seriesMigrationKey/.test(promotionBlock) && /seriesMigrationStatus\s*:\s*["']complete["']/.test(promotionBlock));
ok("an ambiguous promotion mutation is read back before cleanup",
  /mutationError[\s\S]{0,700}?_seriesDestinationRow/.test(promotionBlock));
ok("promotion cleanup protects paths referenced by every destination row",
  /select\(["']entity_id,storage_path,refs,history["']\)\.eq\(["']project_id["'],toProjectId\)/.test(promotionBlock)
  && /protectedPaths/.test(promotionBlock));
ok("asset promotion never rolls back a potentially committed destination row",
  !/turn_generations["']\)\.delete\s*\(/.test(promotionBlock));

const uploadIntentCloudBlock = section(cloud, "const _seriesPendingUploadIntents", "function cloudRowPaths");
const cloudCommitBlock = section(cloud, "async function cloudCommit", "async function cloudAssetLoad");
const cameoSyncBlock = section(cloud, "async function cloudSyncCameo", "async function cloudLoadCameo");
ok("every new Storage key reserves an exact upload intent before bytes are sent", (() => {
  const begin=uploadIntentCloudBlock.indexOf("_seriesBeginAssetUploadIntent(sb,projectId,path)");
  const upload=uploadIntentCloudBlock.indexOf(".upload(path, blob");
  return /rpc\(["']turn_begin_asset_upload["']/.test(uploadIntentCloudBlock)
    && begin>=0 && upload>begin;
})());
ok("an ambiguous upload compensates while its exact intent remains live",
  /if\(error\)\{[\s\S]{0,260}?cloudRemovePaths\(\[path\]\)/.test(uploadIntentCloudBlock)
  && /catch\(e\)\{[\s\S]{0,180}?cloudRemovePaths\(\[path\]\)/.test(uploadIntentCloudBlock));
ok("upload intent is finished only after confirmed Storage removal",
  /if\(!error\)\{[\s\S]{0,240}?_seriesFinishAssetUploadIntents\(unique\)/.test(uploadIntentCloudBlock)
  && /rpc\(["']turn_finish_asset_upload["']/.test(uploadIntentCloudBlock));
ok("generation commit retires exact upload intents only after its row is durable", (() => {
  const mutation=cloudCommitBlock.indexOf("cloudCasGen(projectId,uid,entityId,row,fields)");
  const durable=cloudCommitBlock.indexOf("written.storage_path!==newPath",mutation);
  const finish=cloudCommitBlock.indexOf("_seriesFinishAssetUploadIntents(created)",durable);
  return mutation>=0 && durable>mutation && finish>durable;
})());
ok("Cameo upload race checks row errors and compensates exact uncommitted angles",
  /const\s*\{error\}\s*=\s*await\s+sb\.from\(["']turn_cameos["']\)\.upsert/.test(cameoSyncBlock)
  && /if\(error\)\s*throw\s+error/.test(cameoSyncBlock)
  && /cloudRemovePaths\(angleRows\.map/.test(cameoSyncBlock));

/* Supabase can commit an insert and lose only its HTTP response. Exercise that
   exact failure: readback must adopt the committed row, and cleanup must not
   delete the object which that row now references. */
const promotionExecSource = section(cloud, "function cloudRowPaths", "window.cloudPromoteProjectAssets=cloudPromoteProjectAssets;");
if (promotionExecSource) {
  const owner="11111111-1111-4111-8111-111111111111";
  const from="22222222-2222-4222-8222-222222222222";
  const to="33333333-3333-4333-8333-333333333333";
  const sourceRow={project_id:from,owner,entity_id:"hero",storage_path:owner+"/"+from+"/character/hero/sheet.png",
    meta:{version:2},refs:[],history:[],updated_at:"before"};
  const makePromotionHarness=({commitInsert=true,failReadback=false}={})=>{
    const state={destination:[],objects:new Set(),removed:[],readbacks:0};
    const runSelect=filters=>{
      const projectId=filters.project_id;
      if(projectId===from) return [sourceRow];
      let rows=state.destination.filter(r=>String(r.project_id)===String(projectId));
      if(filters.entity_id!=null) rows=rows.filter(r=>String(r.entity_id)===String(filters.entity_id));
      if(filters.entity_ids) rows=rows.filter(r=>filters.entity_ids.map(String).includes(String(r.entity_id)));
      return rows;
    };
    const sb={
      from(){
        let action="select", payload=null, filters={};
        const q={
          select(){ return q; },
          eq(key,value){ filters[key]=value; return q; },
          in(key,value){ filters[key==="entity_id"?"entity_ids":key]=value; return q; },
          insert(value){ action="insert"; payload=value; return q; },
          update(value){ action="update"; payload=value; return q; },
          async single(){
            if(action==="insert"){
              if(commitInsert) state.destination.push({...payload,updated_at:"committed"});
              return {data:null,error:{message:"network response lost"}};
            }
            const rows=runSelect(filters); return {data:rows[0]||null,error:null};
          },
          async maybeSingle(){
            state.readbacks++;
            if(failReadback) return {data:null,error:{message:"readback unavailable"}};
            const rows=runSelect(filters); return {data:rows[0]||null,error:null};
          },
          then(resolve,reject){ return Promise.resolve({data:runSelect(filters),error:null}).then(resolve,reject); },
        };
        return q;
      },
      storage:{from(){ return {
        async copy(_source,target){ state.objects.add(target); return {error:null}; },
        async remove(paths){ for(const path of paths){ state.removed.push(path); state.objects.delete(path); } return {error:null}; },
      }; }},
    };
    const pbox={JSON,Set,Map,Object,String,Array,Date,Math,Uint8Array,window:null,
      sbClient:()=>sb,turnSafeSeg:s=>String(s).replace(/[^a-zA-Z0-9_:-]/g,"_"),turnBucket:()=>"assets",
      cloudGetSession:async()=>({user:{id:owner}}),cloudCasGen:async()=>null};
    pbox.window=pbox;
    vm.createContext(pbox);
    vm.runInContext(promotionExecSource+"\nthis.promote=cloudPromoteProjectAssets;",pbox);
    return {state,promote:pbox.promote};
  };
  const ambiguous=makePromotionHarness();
  const first=plain(await ambiguous.promote(from,to,["hero"]));
  ok("lost promotion response adopts the committed destination row", first.ok && first.moved===1);
  ok("lost promotion response never deletes a committed row's object",
    ambiguous.state.destination.length===1 && ambiguous.state.removed.length===0 && ambiguous.state.objects.size===1);
  const stablePath=[...ambiguous.state.objects][0];
  const retry=plain(await ambiguous.promote(from,to,["hero"]));
  ok("promotion retry reuses the committed entity instead of duplicating it",
    retry.ok && retry.skipped===1 && ambiguous.state.destination.length===1 && [...ambiguous.state.objects][0]===stablePath);

  const rejected=makePromotionHarness({commitInsert:false});
  const failed=plain(await rejected.promote(from,to,["hero"]));
  ok("confirmed failed promotion removes only its unreferenced copy",
    !failed.ok && rejected.state.destination.length===0 && rejected.state.removed.length===1);

  const unknown=makePromotionHarness({commitInsert:true,failReadback:true});
  const uncertain=plain(await unknown.promote(from,to,["hero"]));
  ok("unverifiable promotion commit retains bytes for a safe retry",
    !uncertain.ok && /retained/i.test(uncertain.cleanupWarning||"") && unknown.state.removed.length===0);
}

/* ── Database installation and access inheritance ──────────────────────── */
ok("series production migration exists", existsSync(sqlPath));
if (sql) {
  ok("migration normalizes Show linkage", /\bshow_id\s+uuid\b/i.test(sql));
  ok("migration normalizes episode number", /\bepisode_no\s+integer\b/i.test(sql));
  ok("migration normalizes project kind", /\bproject_kind\s+text\b/i.test(sql));
  ok("migration scrubs stale relation markers from recovered standalone films",
    /project_kind\s*=\s*'film'[\s\S]{0,220}?doc\s*\?\s*'showId'/i.test(sql)
      && /doc\s*=\s*p\.doc\s*-\s*'showId'\s*-\s*'episodeNo'/i.test(sql));
  ok("episode number is unique inside one Show",
    /(?:create\s+unique\s+index|unique\s*\()[\s\S]{0,240}?show_id[\s\S]{0,120}?episode_no/i.test(sql));
  for (const rpc of ["turn_convert_project_to_show", "turn_create_show_episode", "turn_delete_show_episode", "turn_delete_show"])
    ok("transactional RPC installed: " + rpc, new RegExp("create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?" + rpc, "i").test(sql));
  ok("conversion RPC validates its episode argument", /p_episode_id\s+uuid/i.test(sql));
  ok("the database validates the complete canonical Show Bible at its write boundary",
    /create\s+or\s+replace\s+function\s+public\.turn_series_bible_is_valid/i.test(sql)
    && /turn_sync_project_series_metadata[\s\S]{0,3600}?turn_series_bible_is_valid\(new\.doc\s*->\s*'bible'\)/i.test(sql));
  ok("database Bible validation rejects malformed shared entities and restore-bin entries",
    /turn_series_entity_list_is_valid/i.test(sql)
    && /normalized_trash\s*:=\s*public\.turn_series_shared_trash/i.test(sql)
    && /normalized_trash\s+is\s+distinct\s+from\s+p_bible\s*->\s*'trash'/i.test(sql)
    && /episodeScenes value must be an array/i.test(sql));
  ok("Episode rows are constrained to their shot-only restore bin",
    /turn_series_episode_trash_is_valid\(new\.doc\s*->\s*'trash'\)/i.test(sql)
    && /an Episode owns only trash\.shots/i.test(sql));
  ok("new Shows persist the episode-scoped Bible-reference schema version",
    /show_doc\s*:=\s*jsonb_build_object[\s\S]{0,500}?'schemaVersion'\s*,\s*3/i.test(sql));
  ok("conversion RPC removes Episode 1's duplicate shared departments",
    /episode_doc\s*:=\s*\([\s\S]{0,700}?-\s*'characters'[\s\S]{0,120}?-\s*'locations'[\s\S]{0,120}?-\s*'props'[\s\S]{0,120}?-\s*'lookbook'[\s\S]{0,120}?-\s*'lookbookNote'/i.test(sql));
  const legacyBackfillSqlBlock = section(sql, "-- Backfill valid legacy Shows", "-- Duplicate numbers");
  ok("legacy Episode backfill establishes a canonical Show Bible before stripping duplicates", (() => {
    const recover=legacyBackfillSqlBlock.indexOf("show_patch := jsonb_build_object");
    const persist=legacyBackfillSqlBlock.indexOf("set doc = canonical_doc",recover);
    const strip=legacyBackfillSqlBlock.indexOf("update public.turn_projects e",persist);
    return recover>=0 && persist>recover && strip>persist
      && /sourceEpisodeId/.test(legacyBackfillSqlBlock)
      && /'bible',\s*bible/.test(legacyBackfillSqlBlock);
  })());
  ok("legacy shared departments are shape-validated before any duplicate is erased",
    /Malformed values abort the migration/i.test(legacyBackfillSqlBlock)
    && /jsonb_typeof\(child_row\.doc\s*->\s*department\)\s+is\s+distinct\s+from\s+expected_type/i.test(legacyBackfillSqlBlock)
    && /malformed duplicate shared department/i.test(legacyBackfillSqlBlock));
  ok("legacy Bible recovery scans every linked Episode deterministically",
    /where\s+e\.project_kind\s*=\s*'episode'[\s\S]{0,180}?e\.show_id\s*=\s*show_row\.id[\s\S]{0,180}?e\.doc\s*\?\s*department[\s\S]{0,120}?order\s+by\s+e\.episode_no\s*,\s*e\.id/i.test(legacyBackfillSqlBlock));
  ok("legacy Bible recovery fails closed on divergent Episode copies",
    /candidate\s+is\s+distinct\s+from\s*\(child_row\.doc\s*->\s*department\)[\s\S]{0,240}?irreconcilable Episode copies/i.test(legacyBackfillSqlBlock));
  ok("legacy cleanup is idempotent once Episode duplicates are gone",
    /where\s+e\.project_kind\s*=\s*'episode'[\s\S]{0,180}?e\.doc\s*\?\s*'characters'/i.test(legacyBackfillSqlBlock));
  ok("legacy shared tombstones move to the Show before Episode bins are stripped", (()=>{
    const gather=legacyBackfillSqlBlock.indexOf("turn_series_prepare_shared_trash(child_row.doc -> 'trash'");
    const persist=legacyBackfillSqlBlock.indexOf("'bible', bible",gather);
    const strip=legacyBackfillSqlBlock.indexOf("'trash', public.turn_series_episode_trash",persist);
    return gather>=0 && persist>gather && strip>persist;
  })());
  ok("creation RPC validates its Show argument", /p_show_id\s+uuid/i.test(sql));
  ok("Episode creation idempotency key is unique inside a Show",
    /unique\s+index[\s\S]{0,180}?show_episode_request[\s\S]{0,220}?seriesCreateRequestId/i.test(sql));
  ok("Episode creation returns a committed request replay under the Show lock",
    /turn_create_show_episode[\s\S]{0,3000}?for\s+update[\s\S]{0,1600}?seriesCreateRequestId[\s\S]{0,1000}?idempotent_replay/i.test(sql));
  ok("episode numbering is reserved under a row lock", /turn_create_show_episode[\s\S]{0,5000}?for\s+update/i.test(sql));
  ok("an empty durable Show creates Episode 1 rather than skipping to Episode 2", (() => {
    const block = section(sql, "create function public.turn_create_show_episode", "create function public.turn_delete_show_episode");
    return /select\s+coalesce\s*\(\s*max[\s\S]{0,300}?,\s*0\s*\)[\s\S]{0,100}?into\s+high_no/i.test(block)
      && !/high_no\s*:=\s*greatest\s*\([\s\S]{0,240}?,\s*1\s*\)/i.test(block)
      && /next_no\s*:=\s*high_no\s*\+\s*1/i.test(block);
  })());
  ok("new Episode RPC strips duplicate Show-owned departments from seed data", (() => {
    const block = section(sql, "create function public.turn_create_show_episode", "create function public.turn_delete_show_episode");
    return /seed_doc\s*:=\s*[\s\S]{0,500}?-\s*'characters'[\s\S]{0,120}?-\s*'locations'[\s\S]{0,120}?-\s*'props'[\s\S]{0,120}?-\s*'lookbook'[\s\S]{0,120}?-\s*'lookbookNote'/i.test(block);
  })());
  ok("new Episodes retain only shot tombstones from their seed document", (()=>{
    const block=section(sql,"create function public.turn_create_show_episode","create function public.turn_delete_show_episode");
    return /-\s*'trash'[\s\S]{0,180}?'trash'\s*,\s*public\.turn_series_episode_trash/i.test(block);
  })());
  ok("whole Show delete includes linked episodes", /turn_delete_show[\s\S]{0,15000}?delete\s+from\s+(?:public\.)?turn_projects[\s\S]{0,800}?show_id/i.test(sql));
  const deleteEpisodeSqlBlock = section(sql, "create function public.turn_delete_show_episode", "create function public.turn_delete_show(p_show_id");
  ok("single Episode delete locks its Show and family before deciding",
    /from public\.turn_projects s[\s\S]{0,100}?for update/.test(deleteEpisodeSqlBlock)
    && /family_count\s*<=\s*1/.test(deleteEpisodeSqlBlock));
  ok("single Episode delete atomically rejects the final Episode",
    /delete the Show to remove its final Episode/i.test(deleteEpisodeSqlBlock));
  ok("direct REST deletion of normalized Shows and Episodes is blocked",
    /turn_guard_series_project_delete/.test(sql)
    && /deleting an Episode requires the series lifecycle operation/i.test(sql));
  ok("single Episode deletion records its cleanup grant before deleting the row", (() => {
    const grant = deleteEpisodeSqlBlock.indexOf("insert into public.turn_asset_cleanup_grants");
    const del = deleteEpisodeSqlBlock.indexOf("delete from public.turn_projects");
    return grant >= 0 && del > grant;
  })());
  ok("single Episode server snapshot protects surviving family references",
    /surviving_project_ids/.test(deleteEpisodeSqlBlock)
    && /protected_storage_paths/.test(deleteEpisodeSqlBlock));
  ok("single Episode deletion prunes both continuity maps from active and deleted shared entities",
    /turn_series_prune_episode_from_bible/i.test(sql)
    && /episodeScenes/.test(section(sql, "create or replace function public.turn_series_prune_episode_from_bible", "-- Every ordinary doc"))
    && /episodeLocationMeta/.test(section(sql, "create or replace function public.turn_series_prune_episode_from_bible", "-- Every ordinary doc"))
    && /pruned_bible\s*:=\s*public\.turn_series_prune_episode_from_bible/i.test(deleteEpisodeSqlBlock));
  const pruneEpisodeBibleSqlBlock = section(sql,
    "create or replace function public.turn_series_prune_episode_from_bible",
    "-- Every ordinary doc");
  ok("Episode pruning rebuilds flat scene compatibility data only from surviving Episode slices",
    /foreach\s+bucket\s+in\s+array\s+array\['active','trash'\]/i.test(pruneEpisodeBibleSqlBlock)
    && /from\s+jsonb_each\(scene_map\)/i.test(pruneEpisodeBibleSqlBlock)
    && /partition\s+by\s+scene\.value/i.test(pruneEpisodeBibleSqlBlock)
    && /jsonb_build_object\('scenes',\s*scene_union\)/i.test(pruneEpisodeBibleSqlBlock));
  ok("Episode pruning rebuilds location projections and explicitly blanks the final removed slice",
    /from\s+jsonb_each\(location_map\)/i.test(pruneEpisodeBibleSqlBlock)
    && /location_slice_count\s*=\s*0/i.test(pruneEpisodeBibleSqlBlock)
    && /'times',\s*'\[\]'::jsonb[\s\S]{0,300}?'continuityRootKey',\s*''/i.test(pruneEpisodeBibleSqlBlock)
    && /'intExt',\s*case[\s\S]{0,220}?has_int\s+and\s+has_ext/i.test(pruneEpisodeBibleSqlBlock));
  const bibleKeyGuardSqlBlock = section(sql,
    "create or replace function public.turn_validate_show_bible_episode_keys",
    "-- ── 2. Inherited membership");
  ok("Show Bible namespaces can reference only live Episodes of their own Show",
    /episodeScenes/.test(bibleKeyGuardSqlBlock)
    && /episodeLocationMeta/.test(bibleKeyGuardSqlBlock)
    && /new\.doc\s*->\s*'bible'\s*->\s*department/i.test(bibleKeyGuardSqlBlock)
    && /new\.doc\s*->\s*'bible'\s*->\s*'trash'\s*->\s*department/i.test(bibleKeyGuardSqlBlock)
    && /e\.project_kind\s*=\s*'episode'/i.test(bibleKeyGuardSqlBlock)
    && /e\.show_id\s*=\s*new\.id/i.test(bibleKeyGuardSqlBlock));
  ok("Show Bible namespace validation serializes with Episode deletion and is not publicly callable",
    /for\s+key\s+share/i.test(bibleKeyGuardSqlBlock)
    && /create\s+trigger\s+turn_validate_show_bible_episode_keys/i.test(bibleKeyGuardSqlBlock)
    && /before\s+update\s+of\s+doc/i.test(bibleKeyGuardSqlBlock)
    && /revoke\s+all\s+on\s+function\s+public\.turn_validate_show_bible_episode_keys\(\)\s+from\s+public/i.test(bibleKeyGuardSqlBlock));
  ok("Show Bible Episode-key guard is installed only after legacy relationship backfill",
    sql.indexOf("create or replace function public.turn_validate_show_bible_episode_keys")
      > sql.indexOf("select set_config('turn.series_lifecycle', 'false', true)"));
  ok("whole Show deletion records exact-path cleanup tombstones transactionally",
    /turn_asset_cleanup_grants/.test(sql)
    && /turn_delete_show[\s\S]{0,12000}?insert\s+into\s+public\.turn_asset_cleanup_grants\s*\(\s*path\s*,\s*project_id[\s\S]{0,3000}?delete\s+from\s+public\.turn_projects/i.test(sql));
  ok("Storage cleanup grant is exact-path, owner-scoped, short-lived, and DELETE-only",
    /turn_can_delete_asset_path[\s\S]{0,1500}?g\.path\s*=\s*\$1[\s\S]{0,240}?g\.owner\s*=\s*auth\.uid\(\)[\s\S]{0,300}?g\.expires_at/i.test(sql)
    && /turn_asset_cleanup_grants\s*\([\s\S]{0,120}?path\s+text\s+primary\s+key/i.test(sql)
    && /interval\s+'1 hour'/i.test(sql)
    && /policy\s+"turn assets delete collab"[\s\S]{0,250}?turn_can_delete_asset_path/i.test(sql));
  ok("Episode cleanup grants exclude every server-computed protected path",
    /authorized_cleanup_paths/i.test(deleteEpisodeSqlBlock)
    && /jsonb_array_elements_text\(protected_storage_paths\)\s+protected\(path\)/i.test(deleteEpisodeSqlBlock)
    && /where\s+protected\.path\s*=\s*candidate\.path/i.test(deleteEpisodeSqlBlock)
    && /jsonb_array_elements_text\(authorized_cleanup_paths\)\s+exact\(path\)/i.test(deleteEpisodeSqlBlock));
  const uploadIntentSqlBlock = section(sql, "create table if not exists public.turn_asset_upload_intents", "create or replace function public.turn_can_delete_asset_path");
  const uploadBeginSqlBlock = section(sql, "create function public.turn_begin_asset_upload", "-- Finishing is idempotent");
  const assetDeleteAuthSqlBlock = section(sql, "create or replace function public.turn_can_delete_asset_path", "revoke all on function public.turn_can_delete_asset_path");
  ok("upload reservations are exact and uploader-bound while cleanup obligations are durable",
    /project_id\s+uuid\s+not\s+null\s*,/i.test(uploadIntentSqlBlock)
    && !/project_id\s+uuid[^,\n]*references\s+public\.turn_projects/i.test(uploadIntentSqlBlock)
    && /path\s+text\s+primary\s+key/i.test(uploadIntentSqlBlock)
    && /uploader\s+uuid\s+not\s+null/i.test(uploadIntentSqlBlock)
    && /interval\s+'30 minutes'/i.test(uploadIntentSqlBlock));
  ok("only a current Art Room writer can reserve a canonical caller/project path",
    /turn_begin_asset_upload/i.test(uploadIntentSqlBlock)
    && /folders\[1\]\s+is\s+distinct\s+from\s+caller::text/i.test(uploadIntentSqlBlock)
    && /turn_storage_project_id\(p_path\)\s+is\s+distinct\s+from\s+p_project_id/i.test(uploadIntentSqlBlock)
    && /not\s+public\.turn_can_write_assets\(p_project_id\)/i.test(uploadIntentSqlBlock)
    && /pg_advisory_xact_lock[\s\S]{0,120}?turn_asset_upload:/i.test(uploadIntentSqlBlock)
    && /active_count\s*>=\s*256/i.test(uploadIntentSqlBlock));
  ok("an upload intent cannot be minted for an existing committed object",
    /from\s+storage\.objects\s+o[\s\S]{0,160}?o\.bucket_id\s*=\s*'turn-assets'[\s\S]{0,100}?o\.name\s*=\s*p_path/i.test(uploadIntentSqlBlock)
    && /exact path already exists/i.test(uploadIntentSqlBlock));
  ok("an exact upload path can have only one live reservation, even across the same user's tabs",
    /insert\s+into\s+public\.turn_asset_upload_intents[\s\S]{0,300}?on\s+conflict\s*\(path\)\s+do\s+nothing/i.test(uploadBeginSqlBlock)
    && !/on\s+conflict\s*\(path\)\s+do\s+update/i.test(uploadBeginSqlBlock));
  ok("upload intent cleanup can retire only the caller's supplied exact paths",
    /turn_finish_asset_upload/i.test(uploadIntentSqlBlock)
    && /i\.uploader\s*=\s*caller[\s\S]{0,100}?i\.path\s*=\s*any/i.test(uploadIntentSqlBlock));
  ok("a deleted-project collaborator gets DELETE permission only for their exact upload obligation",
    /i\.path\s*=\s*\$1/i.test(assetDeleteAuthSqlBlock)
    && /i\.uploader\s*=\s*auth\.uid\(\)/i.test(assetDeleteAuthSqlBlock)
    && /q\.path\s*=\s*\$1/i.test(assetDeleteAuthSqlBlock)
    && /q\.uploader\s*=\s*auth\.uid\(\)/i.test(assetDeleteAuthSqlBlock));
  ok("expired and deletion-interrupted uploads move to an exact durable cleanup queue",
    /create\s+table\s+if\s+not\s+exists\s+public\.turn_asset_cleanup_queue/i.test(uploadIntentSqlBlock)
    && /turn_queue_expired_asset_uploads/i.test(uploadIntentSqlBlock)
    && /turn_queue_project_asset_uploads/i.test(uploadIntentSqlBlock)
    && /perform\s+public\.turn_queue_project_asset_uploads\(cleanup_project_ids\)/i.test(sql));
  ok("the durable queue has a service-only lease and acknowledgement contract",
    /turn_claim_asset_cleanup_batch/i.test(uploadIntentSqlBlock)
    && /for\s+update\s+skip\s+locked/i.test(uploadIntentSqlBlock)
    && /turn_complete_asset_cleanup/i.test(uploadIntentSqlBlock)
    && /grant\s+execute\s+on\s+function\s+public\.turn_claim_asset_cleanup_batch\(integer\)\s+to\s+service_role/i.test(uploadIntentSqlBlock));
  ok("committing a generation retires every referenced upload intent transactionally",
    /turn_finish_generation_upload_intents/i.test(uploadIntentSqlBlock)
    && /after\s+insert\s+or\s+update\s+of\s+storage_path\s*,\s*refs\s*,\s*history\s+on\s+public\.turn_generations/i.test(uploadIntentSqlBlock)
    && /delete\s+from\s+public\.turn_asset_upload_intents/i.test(uploadIntentSqlBlock));
  ok("optional Cameo commits get the same transactional upload-intent retirement",
    /turn_finish_cameo_upload_intents/i.test(uploadIntentSqlBlock)
    && /to_regclass\s*\(\s*'public\.turn_cameos'\s*\)/i.test(uploadIntentSqlBlock)
    && /after insert or update of angles on public\.turn_cameos/i.test(uploadIntentSqlBlock));
  ok("delete RPC safely returns exact optional cameo angle paths",
    /to_regclass\s*\(\s*'public\.turn_cameos'\s*\)/i.test(sql)
    && /turn_delete_show[\s\S]{0,7000}?cameo_storage_paths/i.test(sql));
  ok("delete RPC closes the preflight race with transaction-time generation paths",
    /turn_delete_show[\s\S]{0,10000}?generation_storage_paths/i.test(sql));
  ok("delete RPC locks project and generation rows before its final asset snapshot", (() => {
    const block = section(sql, "create function public.turn_delete_show(p_show_id", "create function public.turn_finish_asset_cleanup");
    const projectLock = block.indexOf("from public.turn_projects p");
    const generationLock = block.indexOf("from public.turn_generations g");
    const snapshot = block.indexOf("into generation_storage_paths");
    return projectLock >= 0 && generationLock > projectLock && snapshot > generationLock
      && /from public\.turn_projects p[\s\S]{0,180}for update/.test(block.slice(projectLock, generationLock))
      && /from public\.turn_generations g[\s\S]{0,180}for update/.test(block.slice(generationLock, snapshot));
  })());
  ok("Show and Episode deletion lock optional cameo rows before snapshot", (() => {
    const showBlock = section(sql, "create function public.turn_delete_show(p_show_id", "create function public.turn_finish_asset_cleanup");
    const episodeLock = deleteEpisodeSqlBlock.indexOf("$lock_cameos$");
    const episodeSnapshot = deleteEpisodeSqlBlock.indexOf("$cameos$");
    const showLock = showBlock.indexOf("$lock_cameos$");
    const showSnapshot = showBlock.indexOf("$cameos$");
    return episodeLock >= 0 && episodeSnapshot > episodeLock && showLock >= 0 && showSnapshot > showLock
      && /for update/.test(deleteEpisodeSqlBlock.slice(episodeLock, episodeSnapshot))
      && /for update/.test(showBlock.slice(showLock, showSnapshot));
  })());
  ok("successful client cleanup can revoke its tombstones early",
    /create\s+function\s+public\.turn_finish_asset_cleanup/i.test(sql));
  ok("migration accounts for collaboration membership", /turn_project_members/i.test(sql));
  ok("membership email identity is normalized and unique case-insensitively",
    /turn_normalize_member_email/i.test(sql)
    && /partition\s+by\s+m\.project_id\s*,\s*lower\(btrim\(m\.member_email\)\)/i.test(sql)
    && /unique\s+index[\s\S]{0,180}?turn_project_members_project_email_ci_key[\s\S]{0,160}?lower\(member_email\)/i.test(sql));
  ok("membership access inherits between episode and Show",
    /show_id[\s\S]{0,5000}?turn_project_members|turn_project_members[\s\S]{0,5000}?show_id/i.test(sql));
  ok("conversion promotes and retires direct Episode 1 memberships atomically",
    /turn_convert_project_to_show[\s\S]{0,10000}?insert\s+into\s+public\.turn_project_members[\s\S]{0,2400}?update\s+public\.turn_project_members[\s\S]{0,400}?status\s*=\s*'removed'/i.test(sql));
  ok("legacy membership migration is limited to the recorded source Episode",
    /sourceEpisodeId[\s\S]{0,1800}?insert\s+into\s+public\.turn_project_members|insert\s+into\s+public\.turn_project_members[\s\S]{0,1800}?sourceEpisodeId/i.test(sql));
  ok("canonical Show membership changes retire matching legacy Episode grants",
    /turn_retire_legacy_episode_memberships/i.test(sql)
    && /after\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.turn_project_members/i.test(sql));
  ok("legacy episode access cannot leak to sibling episodes",
    /(?:not\s+to|never[^\n]{0,60})\s+sibling|sibling[^\n]{0,80}(?:not|never|does not leak)/i.test(sql));
  ok("Show and Episode ownership cannot split",
    /Show and its Episodes must have the same owner|same[ -]owner/i.test(sql));
  ok("ordinary saves cannot silently move or renumber an Episode",
    /moving or renumbering an Episode requires a series lifecycle operation/i.test(sql));
  ok("collaborative UPDATE access cannot rename the project row",
    /turn_guard_collaborator_project_columns[\s\S]{0,1800}?new\.title\s+is\s+distinct\s+from\s+old\.title[\s\S]{0,240}?only the owner can rename/i.test(sql));
  ok("collaborative UPDATE access cannot rewrite normalized series lifecycle columns",
    /turn_guard_collaborator_project_columns[\s\S]{0,2200}?new\.project_kind\s+is\s+distinct\s+from\s+old\.project_kind[\s\S]{0,400}?new\.show_id\s+is\s+distinct\s+from\s+old\.show_id[\s\S]{0,400}?new\.episode_no\s+is\s+distinct\s+from\s+old\.episode_no/i.test(sql));
  ok("collaborator row-envelope guard covers direct REST updates without intercepting ordinary doc saves",
    /before\s+update\s+of\s+id\s*,\s*owner\s*,\s*title\s*,\s*created_at\s*,\s*updated_at\s*,\s*project_kind\s*,\s*show_id\s*,\s*episode_no[\s\S]{0,180}?turn_guard_collaborator_project_columns/i.test(sql));
  ok("direct inserts cannot manufacture normalized Shows or Episodes",
    /tg_op\s*=\s*'INSERT'[\s\S]{0,180}?desired_is_show[\s\S]{0,180}?lifecycle_allowed[\s\S]{0,220}?creating a Show or Episode requires the series lifecycle operation/i.test(sql));
  ok("conversion and Episode creation explicitly enter the lifecycle boundary", (() => {
    const convert=section(sql,"create function public.turn_convert_project_to_show","create function public.turn_create_show_episode");
    const create=section(sql,"create function public.turn_create_show_episode","create function public.turn_delete_show_episode");
    return /set_config\s*\(\s*'turn\.series_lifecycle'\s*,\s*'true'/i.test(convert)
      && /set_config\s*\(\s*'turn\.series_lifecycle'\s*,\s*'true'/i.test(create);
  })());
  ok("every Episode write canonicalizes its format from the parent Show",
    /select\s+p\.owner[\s\S]{0,240}?parent_format[\s\S]{0,1800}?jsonb_build_object\s*\(\s*'format'\s*,\s*parent_format\s*\)/i.test(sql));
  ok("role-scope enforcement is updated for the normalized family", /turn_enforce_project_role_scope|role.scope|role_scope/i.test(sql));
  ok("security-definer RPCs pin their search path", /security\s+definer[\s\S]{0,240}?search_path/i.test(sql));
}
const roleInstall = readme.indexOf("enforce-role-scopes.sql");
const seriesInstall = readme.indexOf("series-production.sql");
ok("setup guide installs the series migration", seriesInstall >= 0);
ok("series migration follows role-scope enforcement", roleInstall >= 0 && seriesInstall > roleInstall);

/* ── Project Switcher reliability / recovery UX ────────────────────────── */
ok("switcher groups through the shared invariant", /turnSeries\.groups\s*\(\s*projects\s*\|\|\s*\[\]\s*\)/.test(authUI));
ok("all list surfaces classify Shows case-insensitively through the shared helper",
  /turnSeries\.isShowDoc/.test(app) && /turnSeries\.isShowDoc/.test(authUI)
    && /turnSeries\.isShowDoc/.test(homeDashboard) && /turnSeries\.isShowDoc/.test(cloud));
ok("switcher labels the mixed collection Projects (films and shows)", /"proj-menu-lab"\},"Projects"\)/.test(authUI));
ok("Show rows expose owner rename and delete actions", /Rename show/.test(authUI) && /Delete show/.test(authUI));
const destructiveSeriesUX = app + "\n" + authUI;
ok("whole-Show confirmation names episodes, shared Bible, and assets",
  /Delete [^\n]*show/i.test(destructiveSeriesUX) && /episode/.test(destructiveSeriesUX)
  && /shared bible/i.test(destructiveSeriesUX) && /asset/i.test(destructiveSeriesUX));
ok("final-Episode escalation is decided by the server, not a cached switcher count",
  !/siblings\.length\s*===\s*1[\s\S]{0,300}?requestDeleteShow/.test(authUI)
  && /r&&r\.finalEpisode/.test(deleteProjectBlock)
  && /cloudListProjects/.test(deleteProjectBlock)
  && /liveSiblings\.length>1/.test(deleteProjectBlock)
  && /deleteShow\(target\.showId,liveSiblings\.map/.test(deleteProjectBlock));
ok("empty owned Shows offer Episode 1", /No episodes yet[^\n]*create Episode 1/.test(authUI) && /Create Episode 1/.test(authUI));
ok("empty shared Shows explain that no episodes are available", /No episodes available to you/.test(authUI));
ok("orphan episodes have an explicit recovery group", /Show unavailable/.test(authUI) && /Recovery/.test(authUI));
ok("episode creation presents an honest busy state", /Creating…/.test(authUI));
ok("series actions await their persistence handlers", /await\s+fn\s*\(/.test(authUI));
ok("late episode creation cannot hijack newer navigation",
  /const launchProjectId=projIdRef\.current/.test(app)
  && /const launchLoadSeq=loadSeqRef\.current/.test(app)
  && /homeOpenRef\.current===launchHomeOpen/.test(app)
  && /Your current screen was left unchanged/.test(app));
ok("film creation captures one navigation scope and exposes a superseded durable result",
  /const launchScope=opts\.launchScope\|\|/.test(createProjectBlock)
  && /launchStillActive/.test(createProjectBlock)
  && /superseded:true/.test(createProjectBlock));
ok("New Story and rebuild reuse one create intent and retry only a null mint result", (()=>{
  const intents=app.match(/const createOpts=\{[^\n]*requestId[^\n]*launchScope/g)||[];
  const nullRetries=app.match(/if\(!minted\)/g)||[];
  const superseded=app.match(/minted&&minted\.superseded/g)||[];
  const calls=app.match(/createProject\(undefined,createOpts\)/g)||[];
  return intents.length>=2 && nullRetries.length>=2 && superseded.length>=2 && calls.length>=4;
})());
ok("failed series actions keep the menu open and report the error",
  /actionOk/.test(authUI) && /appToast/.test(authUI) && /if\s*\(done\)\s*setOpen\s*\(false\)/.test(authUI));
const accountChipBlock = section(authUI, "function AccountChip", "window.AccountChip");
ok("closed account chip prioritizes save health over collaborator role", (() => {
  const roleBranch=accountChipBlock.indexOf(": scopedRole");
  return roleBranch>0
    && accountChipBlock.indexOf('saveState==="failed"') < roleBranch
    && accountChipBlock.indexOf('saveState==="retrying"') < roleBranch
    && accountChipBlock.indexOf('saveState==="saving"') < roleBranch;
})());
ok("account menu keeps collaborator role as secondary detail",
  /Project role:\s*["']?\+scopedRole/.test(accountChipBlock));
ok("an unavailable collaborator role is visibly read-only instead of masquerading as synced",
  /const unknownSharedRole/.test(app)
  && /Role unavailable/.test(app)
  && /roleUnavailable:unknownSharedRole/.test(app)
  && /Project role unavailable/.test(accountChipBlock)
  && /Role unavailable/.test(teamSource)
  && /SHARED · /.test(homeDashboard) && /roleLabel\(p\.shareRole\)/.test(homeDashboard));

/* ── MUSE product truth ────────────────────────────────────────────────── */
const showsFeature = section(ai, "SHOWS (series):", "Then bring the idea");
// The long New Story entry owns the base description; later additions deliberately
// extend that same entry through `_sharedBibleFeature.what += ...`.
const seriesManifestSource = showsFeature + "\n"
  + section(ai, "const _newStoryFeature", "const _lookbookFeature") + "\n"
  + section(ai, "const _sharedBibleFeature", "window.APP_FEATURES");
ok("MUSE explains durable film-to-Episode-1 conversion",
  /Episode 1/i.test(seriesManifestSource) && /(durable|persist|reload|database)/i.test(seriesManifestSource));
ok("MUSE explains Show-owned format and shared Bible",
  /format/i.test(seriesManifestSource) && /shared BIBLE/i.test(seriesManifestSource));
ok("MUSE distinguishes building into a blank Episode from starting a separate project",
  /blank current Episode/i.test(seriesManifestSource) && /unrelated project/i.test(seriesManifestSource));
ok("MUSE explains collision-safe episode numbering",
  /(collision|unique|atomic|locked|transaction)/i.test(seriesManifestSource) && /episode/i.test(seriesManifestSource));
ok("MUSE explains Show rename and whole-Show deletion",
  /rename/i.test(seriesManifestSource) && /delete/i.test(seriesManifestSource));
ok("MUSE explains normalized legacy relation recovery",
  /LEGACY RELATION RECOVERY/i.test(seriesManifestSource)
    && /standalone Film/i.test(seriesManifestSource) && /story intact/i.test(seriesManifestSource));
ok("MUSE explains ambiguous lifecycle reconciliation and intent-scoped Episode retries",
  /LIFECYCLE RESPONSE RECOVERY/i.test(seriesManifestSource)
    && /reads back and verifies/i.test(seriesManifestSource)
    && /request id belongs only to that create intent/i.test(seriesManifestSource));
ok("MUSE explains save-health precedence over collaborator role labels",
  /Saving, Retrying and Not saved always take precedence/i.test(seriesManifestSource)
    && /role remains secondary/i.test(seriesManifestSource));
ok("MUSE explains that cloud conflicts never auto-reload over local work",
  /CONFLICT CHOICE/i.test(seriesManifestSource)
    && /keeps this window's local edit visible/i.test(seriesManifestSource)
    && /never auto-reloads over local work/i.test(seriesManifestSource));
ok("MUSE explains exact series asset cleanup and durable abandoned-upload recovery",
  /SERIES STORAGE SAFETY/i.test(seriesManifestSource)
    && /exact unshared image keys/i.test(seriesManifestSource)
    && /durable exact-path cleanup obligation/i.test(seriesManifestSource)
    && /unique without regard to letter casing/i.test(seriesManifestSource));

console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
