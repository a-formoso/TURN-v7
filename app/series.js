/* series.js — pure Show / Episode invariants shared by the UI and regression tests.
   No React and no network calls live here: the cloud layer owns transactions, while
   these helpers keep hydration, cast reconciliation and switcher grouping identical
   everywhere they are needed. */
(function(root){
  "use strict";

  var SHARED_ENTITY_KEYS = ["characters","locations","props"];
  var SHARED_TRASH_KEYS = ["characters","locations","props"];
  var LOCATION_META_FIELDS = ["times","areas","intExt","scope","parentKey","continuityRootKey"];
  /* `trash` is a Show-Bible department for shared entities. The Episode keeps
     only shot tombstones. Keeping the split in these pure helpers lets the
     existing Art Room continue to consume one combined restore-bin object while
     neither persistence row ever owns the wrong half. */
  var SHARED_KEYS = ["characters","locations","props","lookbook","lookbookNote","trash"];

  function trashArray(value){ return Array.isArray(value) ? value : []; }

  function sharedTrash(source){
    source = source && typeof source==="object" && !Array.isArray(source) ? source : {};
    return {
      characters:trashArray(source.characters),
      locations:trashArray(source.locations),
      props:trashArray(source.props),
    };
  }

  function episodeTrash(source){
    source = source && typeof source==="object" && !Array.isArray(source) ? source : {};
    return { shots:trashArray(source.shots) };
  }

  function mergeTrashList(primary, extra){
    var out=[], seen={};
    [trashArray(primary),trashArray(extra)].forEach(function(list){
      list.forEach(function(item){
        if(!item || typeof item!=="object") return;
        var id=item.id==null ? "" : String(item.id);
        if(!id || seen[id]) return;
        seen[id]=true; out.push(item);
      });
    });
    return out;
  }

  function mergeSharedTrash(primary, extra){
    var left=sharedTrash(primary), right=sharedTrash(extra), out={};
    SHARED_TRASH_KEYS.forEach(function(key){ out[key]=mergeTrashList(left[key],right[key]); });
    return out;
  }

  function combineTrash(showOwned, episodeOwned){
    return Object.assign({}, sharedTrash(showOwned), episodeTrash(episodeOwned));
  }

  function isShowDoc(doc){
    if(!doc) return false;
    var kind=doc.project_kind!=null ? doc.project_kind : doc.projectKind;
    if(kind!=null && String(kind)!=="") return String(kind).toLowerCase()==="show";
    return doc.isShow===true || String(doc.isShow).toLowerCase()==="true";
  }

  /* Once series-production.sql is installed, the normalized columns are the
     relationship authority. A failed legacy relation is intentionally backfilled
     as `project_kind = film`, but its old JSON can still contain showId/episodeNo.
     Never let those stale compatibility markers turn that recoverable film back
     into an orphan Episode in the switcher or load path. Older installations have
     no project_kind column, so their JSON-only Show/Episode behavior is preserved. */
  function normalizeProjectRow(row){
    if(!row || typeof row!=="object" || Array.isArray(row)) return row;
    var rawKind=row.project_kind!=null ? row.project_kind : row.projectKind;
    var kind=String(rawKind==null ? "" : rawKind).trim().toLowerCase();
    if(["film","show","episode"].indexOf(kind)<0) return row;

    var next=Object.assign({},row,{project_kind:kind});
    var doc=(row.doc && typeof row.doc==="object" && !Array.isArray(row.doc))
      ? Object.assign({},row.doc) : null;
    if(kind==="show"){
      next.isShow=true; next.showId=null; next.episodeNo=null;
      if(doc){ doc.isShow=true; delete doc.showId; delete doc.episodeNo; }
    }else if(kind==="episode"){
      /* Do not fall back to doc.showId here: show_id/episode_no are canonical on
         normalized rows, and falling back would re-trust the exact stale marker
         this boundary exists to reject. */
      var showId=row.show_id==null ? null : String(row.show_id);
      var episodeNo=Number(row.episode_no);
      next.isShow=false;
      next.showId=showId || null;
      next.episodeNo=Number.isInteger(episodeNo) && episodeNo>0 ? episodeNo : null;
      if(doc){
        delete doc.isShow;
        if(next.showId) doc.showId=next.showId; else delete doc.showId;
        if(next.episodeNo) doc.episodeNo=next.episodeNo; else delete doc.episodeNo;
      }
    }else{
      next.isShow=false; next.showId=null; next.episodeNo=null;
      if(doc){
        delete doc.isShow; delete doc.showId; delete doc.episodeNo;
        delete doc.seriesCreateRequestId;
      }
    }
    if(doc) next.doc=doc;
    return next;
  }

  function sharedBible(source){
    source = source || {};
    return {
      characters:Array.isArray(source.characters) ? source.characters : [],
      locations:Array.isArray(source.locations) ? source.locations : [],
      props:Array.isArray(source.props) ? source.props : [],
      lookbook:Array.isArray(source.lookbook) ? source.lookbook : [],
      lookbookNote:typeof source.lookbookNote==="string" ? source.lookbookNote : "",
      trash:sharedTrash(source.trash),
    };
  }

  function validLocationMetaMap(value){
    if(!value || typeof value!=="object" || Array.isArray(value)) return false;
    return Object.keys(value).every(function(episodeId){
      var slice=value[episodeId];
      if(!slice || typeof slice!=="object" || Array.isArray(slice)) return false;
      if(!Object.keys(slice).every(function(key){ return LOCATION_META_FIELDS.indexOf(key)>=0; })) return false;
      if(Object.prototype.hasOwnProperty.call(slice,"times")
        && (!Array.isArray(slice.times) || !slice.times.every(function(v){ return typeof v==="string"; }))) return false;
      if(Object.prototype.hasOwnProperty.call(slice,"areas")
        && (!Array.isArray(slice.areas) || !slice.areas.every(function(v){ return typeof v==="string"; }))) return false;
      if(Object.prototype.hasOwnProperty.call(slice,"intExt")
        && ["","INT","EXT","INT/EXT","INT+EXT"].indexOf(String(slice.intExt).toUpperCase())<0) return false;
      if(Object.prototype.hasOwnProperty.call(slice,"scope")
        && ["","atomic","compound"].indexOf(String(slice.scope).toLowerCase())<0) return false;
      return ["parentKey","continuityRootKey"].every(function(key){
        return !Object.prototype.hasOwnProperty.call(slice,key) || typeof slice[key]==="string";
      });
    });
  }

  function validEntityList(list){
    return Array.isArray(list) && list.every(function(item){
      if(!item || typeof item!=="object" || Array.isArray(item)
        || item.id==null || !String(item.id).trim()) return false;
      if(Object.prototype.hasOwnProperty.call(item,"scenes") && !Array.isArray(item.scenes)) return false;
      if(Object.prototype.hasOwnProperty.call(item,"episodeScenes")){
        if(!item.episodeScenes || typeof item.episodeScenes!=="object"
          || Array.isArray(item.episodeScenes)) return false;
        if(!Object.keys(item.episodeScenes).every(function(key){
          return Array.isArray(item.episodeScenes[key]);
        })) return false;
      }
      if(Object.prototype.hasOwnProperty.call(item,"episodeLocationMeta")
        && !validLocationMetaMap(item.episodeLocationMeta)) return false;
      return true;
    });
  }

  function validBibleShape(source){
    if(!source || typeof source!=="object" || Array.isArray(source)) return false;
    if(!SHARED_ENTITY_KEYS.every(function(key){ return validEntityList(source[key]); })) return false;
    if(!Array.isArray(source.lookbook) || typeof source.lookbookNote!=="string") return false;
    if(!source.trash || typeof source.trash!=="object" || Array.isArray(source.trash)) return false;
    var trashKeys=Object.keys(source.trash);
    if(trashKeys.length!==SHARED_TRASH_KEYS.length
      || !trashKeys.every(function(key){ return SHARED_TRASH_KEYS.indexOf(key)>=0; })) return false;
    return SHARED_TRASH_KEYS.every(function(key){
      if(!validEntityList(source.trash[key])) return false;
      var active=new Set(source[key].map(function(item){ return String(item.id); }));
      return !source.trash[key].some(function(item){ return active.has(String(item.id)); });
    });
  }

  function uniqueIds(ids){
    var out = [];
    (Array.isArray(ids) ? ids : []).forEach(function(id){
      if(id==null || id==="") return;
      if(!out.some(function(x){ return String(x)===String(id); })) out.push(id);
    });
    return out;
  }

  function episodeMapOf(entity){
    var source = entity && entity.episodeScenes;
    var out = {};
    if(source && typeof source==="object" && !Array.isArray(source)){
      Object.keys(source).forEach(function(key){ out[key] = uniqueIds(source[key]); });
    }
    return out;
  }

  function uniqueStrings(values){
    var out=[];
    (Array.isArray(values) ? values : []).forEach(function(value){
      if(value==null) return;
      var text=String(value).trim();
      if(!text || out.indexOf(text)>=0) return;
      out.push(text);
    });
    return out;
  }

  function normalizedIntExt(value){
    var side=String(value||"").trim().toUpperCase().replace(/\+/g,"/");
    if(side==="INT" || side==="EXT" || side==="INT/EXT") return side;
    return "";
  }

  function locationMetaSlice(source){
    source=source && typeof source==="object" && !Array.isArray(source) ? source : {};
    var scope=String(source.scope||"").trim().toLowerCase();
    return {
      times:uniqueStrings(source.times),
      areas:uniqueStrings(source.areas),
      intExt:normalizedIntExt(source.intExt),
      scope:scope==="atomic" || scope==="compound" ? scope : "",
      parentKey:String(source.parentKey||""),
      continuityRootKey:String(source.continuityRootKey||""),
    };
  }

  function locationMetaSliceHasContent(source){
    var slice=locationMetaSlice(source);
    return !!(slice.times.length || slice.areas.length || slice.intExt || slice.scope
      || slice.parentKey || slice.continuityRootKey);
  }

  function episodeLocationMetaMap(entity){
    var source=entity && entity.episodeLocationMeta;
    var out={};
    if(source && typeof source==="object" && !Array.isArray(source)){
      Object.keys(source).forEach(function(key){
        if(source[key] && typeof source[key]==="object" && !Array.isArray(source[key]))
          out[key]=locationMetaSlice(source[key]);
      });
    }
    return out;
  }

  function hasLocationMeta(entity){
    if(!entity || typeof entity!=="object" || Array.isArray(entity)) return false;
    if(entity.episodeLocationMeta && typeof entity.episodeLocationMeta==="object"
      && !Array.isArray(entity.episodeLocationMeta)) return true;
    return LOCATION_META_FIELDS.some(function(key){
      return Object.prototype.hasOwnProperty.call(entity,key);
    });
  }

  /* The persisted flat fields are a deterministic Show-wide projection for old
     clients and Show-level inspection. Arrays are true unions. INT/EXT and scope
     widen safely. Hierarchy is an invariant: a non-empty parent/root wins over an
     empty discovery, and conflicting non-empty candidates resolve by stable key
     order rather than whichever Episode happened to save last. Episode hydration
     materializes the active slice again below, so editing remains Episode-local. */
  function rebuildLocationMetaProjection(entity, suppliedMap){
    entity=entity && typeof entity==="object" && !Array.isArray(entity) ? entity : {};
    var map=suppliedMap && typeof suppliedMap==="object" && !Array.isArray(suppliedMap)
      ? episodeLocationMetaMap({episodeLocationMeta:suppliedMap}) : episodeLocationMetaMap(entity);
    var episodeIds=Object.keys(map).sort();
    if(!episodeIds.length) return Object.assign({},entity);
    var times=[],areas=[],hasInt=false,hasExt=false,scopes=[],parents=[],roots=[];
    episodeIds.forEach(function(episodeId){
      var slice=map[episodeId];
      slice.times.forEach(function(value){ if(times.indexOf(value)<0) times.push(value); });
      slice.areas.forEach(function(value){ if(areas.indexOf(value)<0) areas.push(value); });
      var side=normalizedIntExt(slice.intExt);
      if(side==="INT" || side==="INT/EXT") hasInt=true;
      if(side==="EXT" || side==="INT/EXT") hasExt=true;
      if(slice.scope && scopes.indexOf(slice.scope)<0) scopes.push(slice.scope);
      if(slice.parentKey && parents.indexOf(slice.parentKey)<0) parents.push(slice.parentKey);
      if(slice.continuityRootKey && roots.indexOf(slice.continuityRootKey)<0) roots.push(slice.continuityRootKey);
    });
    parents.sort(); roots.sort();
    var parentKey=parents[0]||"";
    var scope=parentKey ? "atomic"
      : (scopes.indexOf("compound")>=0 ? "compound" : (scopes.indexOf("atomic")>=0 ? "atomic" : String(entity.scope||"")));
    var rootKey="";
    if(parentKey && roots.indexOf(parentKey)>=0) rootKey=parentKey;
    else rootKey=roots[0] || parentKey || String(entity.continuityRootKey||entity.key||entity.id||"");
    var intExt=hasInt&&hasExt ? "INT/EXT" : (hasExt ? "EXT" : (hasInt ? "INT" : normalizedIntExt(entity.intExt)));
    return Object.assign({},entity,{
      times:times, areas:areas, intExt:intExt, scope:scope,
      parentKey:parentKey, continuityRootKey:rootKey,
      episodeLocationMeta:map,
    });
  }

  /* Apply derived location usage to one Episode without touching any sibling's
     slice. The returned flat fields deliberately remain the active Episode's
     values for the existing Location UI; prepareBibleForEpisode rebuilds the
     Show-wide projection immediately before persistence. */
  function mergeEpisodeLocationMeta(entity, nextMeta, episodeId){
    entity=entity && typeof entity==="object" && !Array.isArray(entity) ? entity : {};
    var combined=Object.assign({},entity,nextMeta||{});
    var slice=locationMetaSlice(combined);
    if(!episodeId) return Object.assign({},entity,slice);
    var map=episodeLocationMetaMap(entity);
    map[String(episodeId)]=slice;
    return Object.assign({},entity,slice,{episodeLocationMeta:map});
  }

  /* Persist scene membership by episode, not as one ambiguous flat array. Scene ids
     are deliberately local to an episode (many episodes have an `s1`), so a Show
     Bible must keep the episode id as part of the reference identity. `scenes` stays
     as a backwards-compatible union in the stored Bible; hydration below materializes
     only the open episode's slice for the existing Art Room UI. */
  function prepareBibleForEpisode(source, episodeId){
    var bible = sharedBible(source);
    if(!episodeId) return bible;
    function prepareList(list,isLocation){
      return list.map(function(entity){
          if(!entity || typeof entity!=="object") return entity;
          var next=entity;
          var map = episodeMapOf(entity);
          /* Do not manufacture empty relationship fields on canon that never had
             an Episode binding. Besides avoiding a perpetual dirty diff, this
             keeps the Show Bible byte-structurally authoritative for entities
             that are not used by any scene yet. An existing map still receives
             an explicit empty slice so removing the last binding is persisted. */
          if(Object.keys(map).length || uniqueIds(entity.scenes).length){
            map[String(episodeId)] = uniqueIds(entity.scenes);
            var union = [];
            Object.keys(map).sort().forEach(function(ep){
              map[ep].forEach(function(id){
                if(!union.some(function(x){ return String(x)===String(id); })) union.push(id);
              });
            });
            next=Object.assign({},next,{scenes:union,episodeScenes:map});
          }
          if(isLocation && hasLocationMeta(next)){
            var metaMap=episodeLocationMetaMap(next);
            /* A deleted Episode may leave an intentionally empty namespace. Do
               not manufacture a blank slice for whichever Episode opens next;
               only a real local location fact creates/updates its ownership. */
            if(Object.keys(metaMap).length || locationMetaSliceHasContent(next)){
              metaMap[String(episodeId)]=locationMetaSlice(next);
              next=rebuildLocationMetaProjection(next,metaMap);
            }
          }
          return next;
        });
    }
    SHARED_ENTITY_KEYS.forEach(function(key){ bible[key]=prepareList(bible[key],key==="locations"); });
    SHARED_TRASH_KEYS.forEach(function(key){ bible.trash[key]=prepareList(bible.trash[key],key==="locations"); });
    return bible;
  }

  function bibleForEpisode(source, episodeId, sourceEpisodeId, episodeNo){
    var bible = sharedBible(source);
    if(!episodeId) return bible;
    function scopeList(list,isLocation){
      return list.map(function(entity){
        if(!entity || typeof entity!=="object") return entity;
        var next=entity;
        var map = episodeMapOf(entity);
        var keys = Object.keys(map);
        /* A canonical entity with no relationship metadata is already correctly
           scoped. Returning it verbatim avoids adding scenes:[] and
           episodeScenes:{} merely because an Episode opened. */
        var ownKey=String(episodeId);
        var isEpisodeOne=(sourceEpisodeId && String(sourceEpisodeId)===ownKey)
          || (!sourceEpisodeId && Number(episodeNo)===1);
        if(keys.length || uniqueIds(entity.scenes).length){
          // Upgrade pre-series flat references in memory without losing them. New Shows
          // persist sourceEpisodeId; the E01 fallback keeps older Shows recoverable.
          if(!keys.length && Array.isArray(entity.scenes) && entity.scenes.length){
            var legacyKey = sourceEpisodeId ? String(sourceEpisodeId) : "__episode1__";
            map[legacyKey] = uniqueIds(entity.scenes);
          }
          /* Once the real Episode 1 id is known, retire the temporary alias. Leaving
             both keys behind duplicates one slice in the persisted Bible and lets the
             stale alias resurrect scene references that Episode 1 later deleted. */
          if(isEpisodeOne && map.__episode1__){
            if(!map[ownKey]) map[ownKey]=uniqueIds(map.__episode1__);
            delete map.__episode1__;
          }
          var own = map[ownKey];
          next=Object.assign({},next,{scenes:uniqueIds(own||[]),episodeScenes:map});
        }

        if(isLocation && hasLocationMeta(next)){
          var metaMap=episodeLocationMetaMap(next);
          var metaKeys=Object.keys(metaMap);
          if(!metaKeys.length && locationMetaSliceHasContent(next)){
            var metaLegacyKey=sourceEpisodeId ? String(sourceEpisodeId) : "__episode1__";
            metaMap[metaLegacyKey]=locationMetaSlice(next);
          }
          if(isEpisodeOne && metaMap.__episode1__){
            if(!metaMap[ownKey]) metaMap[ownKey]=locationMetaSlice(metaMap.__episode1__);
            delete metaMap.__episode1__;
          }
          var projection=rebuildLocationMetaProjection(next,metaMap);
          var ownMeta=metaMap[ownKey];
          next=ownMeta
            ? Object.assign({},projection,locationMetaSlice(ownMeta),{episodeLocationMeta:metaMap})
            /* Persisted flat fields are a Show-wide compatibility projection,
               not evidence for an Episode with no slice of its own. Blank every
               Episode-owned field here; otherwise opening Episode 2 and saving
               it can materialize Episode 1's hierarchy into Episode 2. */
            : Object.assign({},projection,{times:[],areas:[],intExt:"",scope:"",
                parentKey:"",continuityRootKey:"",episodeLocationMeta:metaMap});
        }
        return next;
      });
    }
    SHARED_ENTITY_KEYS.forEach(function(key){ bible[key]=scopeList(bible[key],key==="locations"); });
    SHARED_TRASH_KEYS.forEach(function(key){ bible.trash[key]=scopeList(bible.trash[key],key==="locations"); });
    return bible;
  }

  /* Fail closed: an episode is never hydrated against an absent/malformed Show.
     Explicitly empty Bible arrays are authoritative and replace stale episode copies. */
  function hydrateEpisode(episodeDoc, showDoc, episodeId){
    if(!episodeDoc || !episodeDoc.showId || !isShowDoc(showDoc)
      || !validBibleShape(showDoc.bible)) return null;
    var bible = episodeId
      ? bibleForEpisode(showDoc.bible || {}, episodeId, showDoc.sourceEpisodeId, episodeDoc.episodeNo)
      : sharedBible(showDoc.bible || {});
    /* Before the production migration, deleted shared cards lived on whichever
       Episode deleted them. Adopt those legacy entries only when the canonical
       active department does not contain that id; the SQL migration then moves
       them permanently into the Show Bible. */
    var recoveredTrash=mergeSharedTrash(bible.trash, episodeDoc.trash);
    SHARED_TRASH_KEYS.forEach(function(key){
      var active=new Set((bible[key]||[]).map(function(item){ return String(item&&item.id); }));
      recoveredTrash[key]=recoveredTrash[key].filter(function(item){ return !active.has(String(item&&item.id)); });
    });
    var next = Object.assign({}, episodeDoc, bible);
    next.trash=combineTrash(recoveredTrash,episodeDoc.trash);
    next.project = Object.assign({}, episodeDoc.project || {}, {
      format:String(showDoc.format || (episodeDoc.project && episodeDoc.project.format) || "series")
    });
    return next;
  }

  function normIdentity(value){
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function meaningful(value){
    if(value==null || value==="") return false;
    if(Array.isArray(value)) return value.length>0;
    if(typeof value==="object") return Object.keys(value).length>0;
    return true;
  }

  /* A New Story inside an episode may return only the cast it just discovered.
     Reconcile it into the existing Show cast instead of replacing the Bible. Existing
     canonical facts win; new fields fill gaps, and genuinely new people are appended.
     Scene drivers are remapped to the retained canonical id when names match. */
  function mergeAdaptationCast(existing, incoming, scenes, options){
    options=options||{};
    var allowNew=options.allowNew!==false;
    var out = (Array.isArray(existing) ? existing : []).map(function(c){ return Object.assign({}, c); });
    var byId = {}, byName = {}, idMap = {}, blockedNames=[];
    out.forEach(function(c){
      if(c && c.id) byId[String(c.id)] = c;
      var nk = normIdentity(c && c.name); if(nk) byName[nk] = c;
    });
    function availableId(preferred, name){
      var base=String(preferred||"").trim() || normIdentity(name) || "character";
      var next=base, suffix=2;
      while(byId[String(next)]) next=base+"-"+(suffix++);
      return next;
    }
    (Array.isArray(incoming) ? incoming : []).forEach(function(candidate){
      if(!candidate) return;
      var nameKey=normIdentity(candidate.name);
      var idFound=candidate.id && byId[String(candidate.id)];
      var nameFound=nameKey && byName[nameKey];
      var idName=normIdentity(idFound && idFound.name);
      // Names identify people more reliably than generated ids. A generated id that
      // collides with a DIFFERENT canonical name must create a new, collision-safe
      // character rather than silently merging two people into one.
      var idCollision=!!(idFound && nameKey && idName && nameKey!==idName);
      var found=nameFound || (idCollision ? null : idFound);
      if(found){
        if(candidate.id) idMap[String(candidate.id)] = found.id;
        /* A Writer may shape Episode story without owning the Show cast. In that
           mode matching names may be remapped, but the generated record must not
           quietly fill or alter canonical character fields. */
        if(allowNew) Object.keys(candidate).forEach(function(k){
          if(k==="id") return;
          if(!meaningful(found[k]) && meaningful(candidate[k])) found[k] = candidate[k];
        });
        return;
      }
      if(!allowNew){
        var fallback=out.find(function(c){ return /protagon|lead|hero/i.test(String(c&&c.role||"")); }) || out[0] || null;
        if(candidate.id) idMap[String(candidate.id)] = fallback&&fallback.id ? fallback.id : "";
        blockedNames.push(String(candidate.name||candidate.id||"New character"));
        return;
      }
      var added = Object.assign({}, candidate);
      var originalId=added.id;
      if(!added.id || byId[String(added.id)]) added.id=availableId(added.id,added.name);
      out.push(added);
      if(added.id) byId[String(added.id)] = added;
      if(originalId && String(originalId)!==String(added.id)) idMap[String(originalId)]=added.id;
      nameKey = normIdentity(added.name); if(nameKey) byName[nameKey] = added;
    });
    var canonicalIds=new Set(out.map(function(c){ return String(c&&c.id||""); }).filter(Boolean));
    var defaultId=(out.find(function(c){ return /protagon|lead|hero/i.test(String(c&&c.role||"")); })||out[0]||{}).id||"";
    var remappedScenes = (Array.isArray(scenes) ? scenes : []).map(function(scene){
      if(!scene) return scene;
      var patch = {}, changed = false;
      ["driver","reactor"].forEach(function(key){
        var raw=String(scene[key]||"");
        var mapped=Object.prototype.hasOwnProperty.call(idMap,raw) ? idMap[raw] : null;
        if(mapped!=null && mapped!==raw){ patch[key]=mapped; changed=true; }
        else if(!allowNew && raw && !canonicalIds.has(raw)){ patch[key]=defaultId; changed=true; }
      });
      ["cast","characters","characterIds"].forEach(function(key){
        if(!Array.isArray(scene[key])) return;
        var mapped=scene[key].map(function(id){
          var raw=String(id&&id.id||id||"");
          if(Object.prototype.hasOwnProperty.call(idMap,raw)) return idMap[raw]||null;
          if(!allowNew && raw && !canonicalIds.has(raw)) return null;
          return id;
        }).filter(function(id,i,all){ return id!=null && all.indexOf(id)===i; });
        if(mapped.some(function(id,i){ return id!==scene[key][i]; })){
          patch[key]=mapped; changed=true;
        }else if(mapped.length!==scene[key].length){ patch[key]=mapped; changed=true;
        }
      });
      return changed ? Object.assign({},scene,patch) : scene;
    });
    return { characters:out, scenes:remappedScenes, idMap:idMap, blockedNames:blockedNames };
  }

  /* Merge duplicate canonical cards without throwing away scene references that
     belong to sibling Episodes. Flat `scenes` is only the open Episode's working
     projection; every namespaced slice must survive the dedupe. */
  function mergeEntitySceneRefs(entities, survivor, episodeId){
    var list=Array.isArray(entities)?entities.filter(Boolean):[];
    var map={}, flat=[], hasScenes=false;
    function add(target,values){
      (Array.isArray(values)?values:[]).forEach(function(id){
        id=String(id||""); if(id&&target.indexOf(id)<0) target.push(id);
      });
    }
    list.forEach(function(entity){
      if(Object.prototype.hasOwnProperty.call(entity,"scenes")) hasScenes=true;
      var own=episodeMapOf(entity);
      Object.keys(own).forEach(function(key){
        if(!map[key]) map[key]=[];
        add(map[key],own[key]);
      });
      if(episodeId){
        var key=String(episodeId); if(!map[key]) map[key]=[];
        add(map[key],entity.scenes);
      }else add(flat,entity.scenes);
    });
    if(!episodeId) return hasScenes ? {scenes:flat} : {};
    var active=map[String(episodeId)]||[];
    return {scenes:active,episodeScenes:map};
  }

  /* Canonical entities are shared, but their scene ids come from individual episodes.
     Re-mapping the open episode replaces only that episode's slice and preserves every
     other episode's references. */
  function mergeEpisodeSceneRefs(entity, nextIds, episodeId){
    var wanted=uniqueIds(nextIds);
    // A flat legacy list cannot distinguish another episode's `s1` from this
    // episode's `s1`; treating it as foreign is what resurrected deleted refs.
    // Only the namespaced entity map is allowed to preserve other episodes.
    if(!entity || typeof entity!=="object" || Array.isArray(entity)) return wanted;
    var map=episodeMapOf(entity);
    if(episodeId) map[String(episodeId)]=wanted;
    return Object.assign({},entity,{scenes:wanted,episodeScenes:map});
  }

  function nextEpisodeNo(rows, showId, floor){
    var high = Number(floor) || 0;
    (rows || []).forEach(function(row){
      if(row && String(row.showId || "")===String(showId || ""))
        high = Math.max(high, Number(row.episodeNo) || 0);
    });
    return Math.max(1, high + 1);
  }

  function groups(rows){
    rows = (Array.isArray(rows) ? rows : []).map(normalizeProjectRow);
    var shows = rows.filter(isShowDoc);
    var showIds = new Set(shows.map(function(p){ return String(p.id); }));
    return {
      shows:shows,
      standalone:rows.filter(function(p){ return p && !isShowDoc(p) && !p.showId; }),
      unavailable:rows.filter(function(p){ return p && !isShowDoc(p) && p.showId && !showIds.has(String(p.showId)); })
    };
  }

  root.turnSeries = {
    SHARED_KEYS:SHARED_KEYS,
    SHARED_ENTITY_KEYS:SHARED_ENTITY_KEYS,
    SHARED_TRASH_KEYS:SHARED_TRASH_KEYS,
    LOCATION_META_FIELDS:LOCATION_META_FIELDS,
    isShowDoc:isShowDoc,
    normalizeProjectRow:normalizeProjectRow,
    sharedBible:sharedBible,
    validBibleShape:validBibleShape,
    sharedTrash:sharedTrash,
    episodeTrash:episodeTrash,
    mergeSharedTrash:mergeSharedTrash,
    combineTrash:combineTrash,
    prepareBibleForEpisode:prepareBibleForEpisode,
    bibleForEpisode:bibleForEpisode,
    hydrateEpisode:hydrateEpisode,
    mergeAdaptationCast:mergeAdaptationCast,
    mergeEntitySceneRefs:mergeEntitySceneRefs,
    mergeEpisodeSceneRefs:mergeEpisodeSceneRefs,
    locationMetaSlice:locationMetaSlice,
    episodeLocationMetaMap:episodeLocationMetaMap,
    rebuildLocationMetaProjection:rebuildLocationMetaProjection,
    mergeEpisodeLocationMeta:mergeEpisodeLocationMeta,
    nextEpisodeNo:nextEpisodeNo,
    groups:groups,
  };
})(typeof window!=="undefined" ? window : globalThis);
