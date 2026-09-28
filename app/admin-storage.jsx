/* admin-storage.jsx — the platform admin's Storage page (account chip →
   "Storage · admin"). Owner: platform admin · 2026-09-27 · UI half of the Admin
   Storage spec §8 (the server is supabase/functions/admin-storage/).

   - SELF-MOUNTING (the plans.jsx pattern): window.turnOpenAdminStorage() mounts
     the modal into its own React root on demand and tears it down on close, so
     app.jsx is not touched. It refuses unless window.turnIsAdmin; the server
     enforces the admin gate anyway. Nothing is fetched before it opens.
   - Every read and delete goes through sb.functions.invoke('admin-storage', …)
     (the pricing-watch.jsx pattern). The browser NEVER names a file: it sends
     project ids (Review) or a run id (Delete / Resume); every path comes from
     the server, which re-verifies each file right before removing it.
   - Operator tool: deliberately NOT listed in APP_FEATURES (app/ai.jsx). MUSE
     answers every user, and MUSE Protocol §3 forbids describing how TURN is
     built (owner decision, 2026-09-27).
   - Cleanup queue: drained MANUALLY with "Run cleanup now"; no schedule is
     installed (owner decision, 2026-09-27).
   - Clear old temp files (owner request, 2026-09-28): the "Cleanup" tab (it was
     "Cleanup queue") also clears image-proxy's staged media under
     {account}/stage-tmp/ that is more than 24 hours old on the DATABASE clock.
     Manual only, no schedule. The browser sends only the action
     (preview-clear-temp), then the run id (clear-temp); the server plans from
     its own query, writes the audit ahead and rechecks every file just before
     its batch. It runs through the same loop as the project delete (loopRun),
     and a partial or interrupted temp run resumes from History like a delete.
     An older server (no overview.temp) gets a "needs updating" line, not a
     crash. 2026-09-28 review: a stopped clear offers Try again on the SAME run
     (a new review is for when it is done); the confirm shows when the review
     expires; an interrupted clear must be resumed first (409 temp_interrupted);
     the Accounts tab points the temp folder at Cleanup; the tab strip never
     shrinks on phones.
   - Deleted projects keep no tombstone (owner decision, 2026-09-27): they show
     as "Deleted project · <short id>" with their uploaders' emails.
   - window.AdminStorageLib holds the pure helpers
     (scripts/test-admin-storage-ui.mjs).
   - Closes itself when the session ends while it is open (another tab signs
     out, a failed token refresh, a different user signs in): it re-reads
     window.turnIsAdmin every second and listens for sign-out (2026-09-27).
   - Trade-off recorded 2026-09-27 (review): TURN.html loads this file for every
     visitor, as the spec asked (about 16 KB gzipped in dist/, and its operator
     strings ship with it). Non-admins get no menu item, and loading it mounts,
     fetches and schedules nothing. Loading it only when the admin clicks the
     menu item would avoid the cost; that is an owner decision, not made here. */
(function(){
  const FN = "admin-storage";
  const CALL_TIMEOUT_MS = 90 * 1000;          // client timeout per call (spec §8.10)
  const MAX_REVIEW = 50;                      // project ids per review (server cap)
  const MAX_DRAIN = 500;
  const LOOP_CAP = 60;                        // delete calls per click, however it goes
  const DELETE_ACTION = "delete-deleted-project-files";      // storage_runs.action values
  const TEMP_ACTION = "clear-old-temp-files";
  const UUID_SRC = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const UUID_RE = new RegExp("^" + UUID_SRC + "$", "i");
  /* One storage folder → its id: legacy "{uuid}" (any case, as before) or readable
     "{name}--{uuid}" (2026-09-27), through app/storage-keys.js. Only the uuid is
     ever used; the name is display text. Without the parser: legacy only. */
  function folderId(seg){
    const k = (typeof window !== "undefined" && window.TurnStorageKeys) || null;
    if(k && typeof k.segmentIdLoose === "function") return k.segmentIdLoose(seg);
    return typeof seg === "string" && UUID_RE.test(seg) ? seg.toLowerCase() : null;
  }

  const MSG = {
    loading: "Reading the bucket… a few seconds.",
    empty: "No files in storage yet.",
    noDeleted: "No deleted projects are holding files.",
    queueEmpty: "The cleanup queue is empty.",
    noRuns: "No deletions yet.",
    noFiles: "No files stored for this project.",
    notFound: "No account or project with that id in storage.",
    notDeployed: "The admin-storage Edge Function isn't deployed yet (supabase/README.md → Admin Storage page).",
    noCloud: "Cloud isn't configured in this build, so the admin-storage function can't be called.",
    signIn: "Sign in again to use this page.",
    adminOnly: "This page is only for the platform admin account.",
    views: "Run supabase/admin-inventory.sql in the SQL Editor, then Refresh.",
    auditOff: "Deleting is off until supabase/admin-storage.sql is run in the SQL Editor.",
    notFullReader: "The function's database role can't see every row, so nothing is marked safe and deleting is off (check SUPABASE_DB_URL / ADMIN_STORAGE_DB_URL).",
    queueWorker: "The cleanup queue's worker functions are missing (re-run series-production.sql), so Run cleanup now is off.",
    queueMissing: "The cleanup queue isn't fully installed (series-production.sql), so it can't be drained.",
    db: "The database couldn't be reached from the function.",
    projectLive: "One of these projects exists again, so nothing was deleted. Refresh.",
    expired: "This review expired. Review again.",
    internal: "Something went wrong on the server. Nothing further was deleted; History shows what happened.",
    timeout: "The server took too long. History shows whether anything was deleted.",
    network: "Lost the connection to the server. History shows whether anything was deleted.",
    reviewBody: "Only files nothing in TURN uses any more. Each file is checked again right before it is deleted, and the Storage folders of live projects are never touched.",
    closeNote: "If you close this window, the current step finishes or stops on its own. History shows where it stopped, and Resume carries on.",
    liveReadOnly: "Not deleted from this page: the project is live (the SQL Editor's turn_admin.orphans stays the tool for live projects).",
    liveKept: "kept (live)",
    wholeProject: "Review & delete covers the whole project, including files other accounts uploaded.",
    tempAbout: "Images and videos TURN staged for AI generation. They expire after 2 hours, and no project uses them.",
    tempOff: "Clearing temp files is off until supabase/admin-storage.sql is run again in the SQL Editor.",
    tempUpdate: "The admin-storage function needs updating before temp files can be cleared.",
  };

  function h(){ return React.createElement.apply(React, arguments); }
  function icon(name, s){
    const set = (typeof window !== "undefined" && window.Icon) || null;
    return set && typeof set[name] === "function" ? h(set[name], { s: s || 12 }) : null;
  }
  function toast(msg, kind){
    try{ if(typeof window.appToast === "function") window.appToast(msg, kind || "info"); }catch(e){}
  }

  /* ── pure helpers (window.AdminStorageLib) ─────────────────────────────── */
  function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function lc(v){ return v === null || v === undefined || v === "" ? null : String(v).toLowerCase(); }
  function fmtCount(n){ return Math.round(num(n)).toLocaleString("en-US"); }
  function plural(n, one, many){ return fmtCount(n) + " " + (num(n) === 1 ? one : (many || one + "s")); }
  /* 1024-based, one decimal under 100: "5.5 GB", "812 MB", "0 B" */
  function fmtBytes(n){
    if(n === null || n === undefined || n === "") return "—";
    let v = Number(n);
    if(!Number.isFinite(v)) return "—";
    if(v < 0) v = 0;
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    let i = 0;
    while(v >= 1024 && i < units.length - 1){ v /= 1024; i++; }
    if(i === 0) return Math.round(v) + " B";
    return (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "")) + " " + units[i];
  }
  function fmtAgo(iso, nowMs){
    if(!iso) return "never";
    const t = new Date(iso).getTime();
    if(!Number.isFinite(t)) return "never";
    const s = Math.max(0, Math.round(((nowMs == null ? Date.now() : nowMs) - t) / 1000));
    if(s < 60) return "just now";
    const m = Math.floor(s / 60); if(m < 60) return m + " min ago";
    const hr = Math.floor(m / 60); if(hr < 24) return hr + " h ago";
    const d = Math.floor(hr / 24); if(d < 60) return d + " d ago";
    const mo = Math.floor(d / 30); if(mo < 24) return mo + " mo ago";
    return Math.floor(d / 365) + " y ago";
  }
  const pad2 = (n)=> String(n).padStart(2, "0");
  function fmtClock(iso, withSeconds){
    const d = new Date(iso);
    if(!iso || !Number.isFinite(d.getTime())) return "";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + (withSeconds === false ? "" : ":" + pad2(d.getSeconds()));
  }
  function fmtDate(iso){
    const d = new Date(iso);
    if(!iso || !Number.isFinite(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" });
  }
  function fmtWhen(iso){
    const d = new Date(iso);
    if(!iso || !Number.isFinite(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { month:"short", day:"numeric" }) + ", " + fmtClock(iso, false);
  }
  function fmtMs(ms){
    const n = num(ms);
    return n < 1000 ? Math.round(n) + " ms" : (n / 1000).toFixed(1) + " s";
  }
  function fmtCountdown(ms){
    const s = Math.max(0, Math.ceil(num(ms) / 1000));
    return Math.floor(s / 60) + ":" + pad2(s % 60);
  }
  function shortId(id){ return String(id || "").slice(0, 8); }
  function localPart(email){ const s = String(email || ""); const at = s.indexOf("@"); return at > 0 ? s.slice(0, at) : (s || "unknown"); }

  /* One status vocabulary for every chip on the page (spec §8.3). */
  const KNOWN_STATUS = new Set(["service", "uploading", "queued-for-cleanup", "kept-for-promotion-retry",
    "orphan: project deleted", "unreferenced"]);
  function statusChip(status, safe, live){
    const s = String(status || "");
    if(s === "service") return { text:"Service · keep", tone:"neutral",
      title:"Server-owned file (relay marker, Blender mesh or preview). Kept." };
    if(s === "uploading") return { text:"Uploading", tone:"amber",
      title:"Uploaded less than an hour ago, or an upload is still in progress." };
    if(s === "queued-for-cleanup") return { text:"Queued for cleanup", tone:"amber",
      title:"The cleanup queue removes this file." };
    if(s === "kept-for-promotion-retry") return { text:"Kept for Show retry", tone:"amber",
      title:"A Show promotion may still reuse this copy." };
    if(s === "orphan: project deleted") return { text:"Project deleted" + (safe ? " · safe to delete" : ""), tone:"alert",
      title:safe ? "Its project was deleted and nothing in TURN points at this file." : "Its project was deleted." };
    if(s === "unreferenced") return { text:"Unreferenced", tone:"alert",
      title:"Nothing in TURN points at this file." + (live === false ? "" : " " + MSG.liveReadOnly) };
    if(!s) return { text:"Unknown", tone:"neutral", title:"" };
    return { text:"In use", tone:"neutral", title:s };            // referenced: the raw kinds, e.g. "current, history"
  }
  function chip(c, key){
    return h("span", { key:key, className:"adm-chip " + (c.tone || "neutral"), title:c.title || undefined }, c.text);
  }

  function projectLabel(p){
    if(!p) return "Unknown project";
    if(!p.live) return "Deleted project · " + shortId(p.project_id || p.id);
    const kind = String(p.kind || "").toLowerCase();
    const title = p.title || "Untitled";
    if(kind === "show") return title + " (Show)";
    if(kind === "episode"){            // its own title; the Kind column already says "Ep N · Show"
      if(p.title) return p.title;
      return (p.show_title || "Untitled") + " · Episode" + (p.episode != null ? " " + p.episode : "");
    }
    return title;
  }
  function kindLabel(p){
    if(!p || !p.live) return "—";
    const kind = String(p.kind || "").toLowerCase();
    if(kind === "show") return "Show";
    if(kind === "episode") return (p.episode != null ? "Ep " + p.episode : "Episode") + (p.show_title ? " · " + p.show_title : "");
    return "Film";
  }

  /* Accepts what the Supabase dashboard lets you copy: a Storage path (with or
     without "turn-assets/"), a folder, a studio-previews path, a bare uuid or a
     bare readable folder ("pine-soot--<uuid>": resolveRef tries it as an account,
     then as a project), or a signed/public object URL. Folders may be legacy or
     readable. → { uid, pid, bare } or null. */
  function parseStorageRef(text){
    let s = String(text === null || text === undefined ? "" : text).trim();
    if(!s || s.length > 2048) return null;
    s = s.replace(/[?#].*$/, "");
    const at = s.indexOf("turn-assets/");
    if(at >= 0) s = s.slice(at + "turn-assets/".length);
    s = s.replace(/^\/+/, "");
    if(/%[0-9a-f]{2}/i.test(s)){ try{ s = decodeURIComponent(s); }catch(e){} }
    const seg = s.split("/");
    const uid = folderId(seg[0]);
    if(!uid) return null;
    const pid = seg[1] === "studio-previews" ? folderId(seg[2]) : folderId(seg[1]);
    return { uid:uid, pid:pid || null, bare:!pid && seg.slice(1).every((x)=> x === "") };
  }

  const TEMP_SERVICE = "Temporary image files (*/stage-tmp)";
  function serviceLabel(f){
    if(f.user_folder === "_internal") return "Relay security markers (_internal)";
    if(f.user_folder === "blender-studio-internal") return "Blender Studio meshes (blender-studio-internal)";
    if(f.project_folder === "stage-tmp") return TEMP_SERVICE;
    if(f.project_folder === "studio-previews") return "Blender previews of live projects";
    return "Files outside the project layout";
  }
  const COUNT_KEYS = ["orphan_deleted", "queued", "uploading", "kept_retry", "service", "unreferenced", "referenced"];
  function mergeVerdict(list){
    if(!list.length) return "in-use";
    if(list.every((v)=> v === "delete-folder")) return "delete-folder";
    return list.some((v)=> v === "delete-folder" || v === "some") ? "some" : "in-use";
  }

  /* overview response → what the tabs render. Every file sits in exactly one
     folder row (Q3), so totals come from the folders. */
  function buildModel(ov){
    const o = ov || {};
    const accountsRaw = Array.isArray(o.accounts) ? o.accounts : [];
    const projectsRaw = Array.isArray(o.projects) ? o.projects : [];
    const folders = Array.isArray(o.folders) ? o.folders : [];
    const projectsById = {}, accountsById = {};
    const blankCounts = ()=> COUNT_KEYS.reduce((a, k)=>{ a[k] = 0; return a; }, {});
    const newProject = (p)=>{
      const row = Object.assign({}, p, {
        id:lc(p.project_id), project_id:lc(p.project_id), owner_id:lc(p.owner_id), live:p.live === true,
        files:num(p.files), total_bytes:num(p.total_bytes), orphan_files:num(p.orphan_files),
        folders:[], safeFiles:0, safeBytes:0, uploaders:[], counts:blankCounts(), verdict:"in-use",
      });
      row.label = projectLabel(row);
      projectsById[row.id] = row;
      return row;
    };
    const projects = projectsRaw.filter((p)=> p && p.project_id).map(newProject);

    let files = 0, bytes = 0;
    const serviceMap = new Map();
    const byUploader = new Map();          // uid → folder rows with a project
    for(const f0 of folders){
      if(!f0) continue;
      const f = Object.assign({}, f0, { files:num(f0.files), bytes:num(f0.bytes), safe_files:num(f0.safe_files),
        safe_bytes:num(f0.safe_bytes), project_id:lc(f0.project_id),
        uploader_id:lc(f0.uploader_id) || folderId(String(f0.user_folder || "")) });
      files += f.files; bytes += f.bytes;
      let p = f.project_id ? projectsById[f.project_id] : null;
      if(f.project_id && !p){       // a folder the projects view didn't list: treat as deleted
        p = newProject({ project_id:f.project_id, live:false, files:0, total_bytes:0 });
        projects.push(p);
      }
      if(p){
        p.folders.push(f);
        p.safeFiles += f.safe_files; p.safeBytes += f.safe_bytes;
        COUNT_KEYS.forEach((k)=>{ p.counts[k] += num(f[k]); });
        if(f.uploader_id){
          if(!byUploader.has(f.uploader_id)) byUploader.set(f.uploader_id, []);
          byUploader.get(f.uploader_id).push(f);
        }
      }
      if(!p || (p.live && f.project_folder === "studio-previews")){
        const label = serviceLabel(f);
        const s = serviceMap.get(label) || { label:label, files:0, bytes:0, safe_files:0, folders:0 };
        s.files += f.files; s.bytes += f.bytes; s.safe_files += f.safe_files; s.folders += 1;
        serviceMap.set(label, s);
      }
    }
    for(const p of projects){
      const up = new Map();
      for(const f of p.folders){
        const k = f.uploader_email || (f.uploader_id ? "deleted account " + shortId(f.uploader_id) : "service");
        up.set(k, (up.get(k) || 0) + f.files);
      }
      p.uploaders = [...up].map(([email, n])=> ({ email:email, files:n })).sort((a, b)=> b.files - a.files);
      p.verdict = mergeVerdict(p.folders.map((f)=> f.verdict));
      if(!p.files && p.folders.length) p.files = p.folders.reduce((a, f)=> a + f.files, 0);
      if(!p.total_bytes && p.folders.length) p.total_bytes = p.folders.reduce((a, f)=> a + f.bytes, 0);
    }

    const accounts = accountsRaw.filter((a)=> a && a.user_id).map((a)=>{
      const row = Object.assign({}, a, { id:lc(a.user_id), user_id:lc(a.user_id), deleted_account:a.deleted_account === true,
        total_bytes:num(a.total_bytes), file_count:num(a.file_count), film_count:num(a.film_count),
        owns:[], elsewhere:[], deleted:[] });
      accountsById[row.id] = row;
      return row;
    });
    for(const a of accounts){
      a.owns = projects.filter((p)=> p.live && p.owner_id && p.owner_id === a.id)
        .sort((x, y)=> (y.total_bytes - x.total_bytes) || String(x.label).localeCompare(String(y.label)));
      const elsewhere = new Map(), deleted = new Map();
      for(const f of byUploader.get(a.id) || []){
        const p = projectsById[f.project_id];
        if(!p) continue;
        if(p.live && p.owner_id !== a.id){
          const e = elsewhere.get(p.id) || { project:p, files:0, bytes:0, last_upload:null };
          e.files += f.files; e.bytes += f.bytes;
          if(f.last_upload && (!e.last_upload || f.last_upload > e.last_upload)) e.last_upload = f.last_upload;
          elsewhere.set(p.id, e);
        } else if(!p.live){
          const d = deleted.get(p.id) || { project:p, files:0, bytes:0, safe_files:0, safe_bytes:0,
            counts:blankCounts(), last_upload:null, verdicts:[] };
          d.files += f.files; d.bytes += f.bytes; d.safe_files += f.safe_files; d.safe_bytes += f.safe_bytes;
          COUNT_KEYS.forEach((k)=>{ d.counts[k] += num(f[k]); });
          if(f.last_upload && (!d.last_upload || f.last_upload > d.last_upload)) d.last_upload = f.last_upload;
          d.verdicts.push(f.verdict);
          deleted.set(p.id, d);
        }
      }
      a.elsewhere = [...elsewhere.values()].sort((x, y)=> y.bytes - x.bytes);
      a.deleted = [...deleted.values()].map((d)=> Object.assign(d, { verdict:mergeVerdict(d.verdicts) }))
        .sort((x, y)=> y.bytes - x.bytes);
    }
    accounts.sort((x, y)=> (y.total_bytes - x.total_bytes) || String(x.email || "").localeCompare(String(y.email || "")));

    const deletedProjects = projects.filter((p)=> !p.live && p.files > 0);
    let queue = null;
    if(o.queue && typeof o.queue === "object"){
      const byReason = Array.isArray(o.queue.byReason) ? o.queue.byReason : [];
      const total = byReason.reduce((a, r)=> a + num(r.total), 0);
      const ready = byReason.reduce((a, r)=> a + num(r.ready), 0);
      queue = { total:total, ready:ready, later:Math.max(0, total - ready),
        stuck:byReason.reduce((a, r)=> a + num(r.stuck), 0), byReason:byReason,
        stuckItems:Array.isArray(o.queue.stuck) ? o.queue.stuck : [] };
    }
    return {
      totals:{
        files:files, bytes:bytes,
        accounts:accounts.filter((a)=> !a.deleted_account).length,
        deletedAccounts:accounts.filter((a)=> a.deleted_account).length,
        deletedProjects:deletedProjects.length,
        deletedBytes:deletedProjects.reduce((a, p)=> a + p.total_bytes, 0),
        deletedSafeFiles:deletedProjects.reduce((a, p)=> a + p.safeFiles, 0),
        deletedSafeBytes:deletedProjects.reduce((a, p)=> a + p.safeBytes, 0),
        queue:queue ? { ready:queue.ready, later:queue.later, stuck:queue.stuck, total:queue.total } : null,
      },
      accounts:accounts, accountsById:accountsById,
      projects:projects, projectsById:projectsById,
      service:[...serviceMap.values()].sort((x, y)=> y.bytes - x.bytes),
      queue:queue,
    };
  }

  /* The review's kept files, in plain language; only non-zero lines. */
  function keptLines(preview, projectsById){
    const kept = (preview && preview.kept) || {};
    const by = kept.byStatus && typeof kept.byStatus === "object" ? kept.byStatus : {};
    const lines = [];
    const n = (k)=> num(by[k]);
    if(n("queued-for-cleanup")) lines.push(fmtCount(n("queued-for-cleanup")) + " queued for cleanup (the cleanup queue removes these)");
    let referenced = 0, noStatus = 0;
    for(const [k, v] of Object.entries(by)){
      if(!num(v)) continue;
      if(KNOWN_STATUS.has(k) || k === "outside the TURN asset layout") continue;
      if(k === "kept") noStatus += num(v);
      else referenced += num(v);            // any referenced kind ("current, history", "history-ref", …), like statusChip
    }
    const usedBy = Array.isArray(kept.usedBy) ? kept.usedBy : [];
    if(usedBy.length){
      for(const u of usedBy){
        if(!num(u.files)) continue;
        const p = projectsById && projectsById[lc(u.projectId)];
        lines.push(fmtCount(u.files) + " still used by " + (p ? p.label : "project " + shortId(u.projectId)));
      }
    } else if(referenced){
      lines.push(fmtCount(referenced) + " still in use");
    }
    if(n("kept-for-promotion-retry")) lines.push(fmtCount(n("kept-for-promotion-retry")) + " kept for a Show-promotion retry");
    if(n("uploading")) lines.push(fmtCount(n("uploading")) + " still uploading");
    if(n("service")) lines.push(plural(n("service"), "service file") + " (Blender relay preview)");
    if(n("outside the TURN asset layout")) lines.push(fmtCount(n("outside the TURN asset layout")) + " outside the TURN asset layout (review by hand)");
    if(n("unreferenced")) lines.push(fmtCount(n("unreferenced")) + " unreferenced (not deleted from this page)");
    if(n("orphan: project deleted")) lines.push(fmtCount(n("orphan: project deleted")) + " not marked safe to delete");
    if(noStatus) lines.push(fmtCount(noStatus) + " kept");
    return lines;
  }

  /* A normalised call error → the page's copy (spec §8.10). ctx: "drain" (the
     cleanup queue), "temp" (clearing old temp files), else a project delete. */
  function errorMessage(err, ctx){
    if(!err) return "";
    const c = String(err.code || ""), s = num(err.status), extra = err.extra || {};
    if(c === "no_cloud") return MSG.noCloud;
    if(c === "timeout") return MSG.timeout;
    if(c === "not_deployed" || s === 404) return MSG.notDeployed;
    if(c === "fetch") return MSG.network;
    if(s === 401 || c === "sign_in") return MSG.signIn;
    if(s === 403 || c === "admin_only") return MSG.adminOnly;
    if(c === "views_missing" || c === "views_drift") return MSG.views;
    if(c === "audit_missing") return MSG.auditOff;
    if(c === "not_full_reader") return MSG.notFullReader;
    if(c === "queue_missing") return MSG.queueMissing;
    if(c === "temp_action_missing") return MSG.tempOff;
    if(s === 503 || c === "db_unreachable") return MSG.db;
    if(c === "project_live"){
      const r = extra.result;                 // the run's counts (server 2026-09-27)
      return r && num(r.removed) > 0
        ? "One of these projects exists again, so deleting stopped. " + plural(r.removed, "file") + " had already been deleted. Refresh."
        : MSG.projectLive;
    }
    if(c === "preview_expired") return MSG.expired;
    if(c === "temp_interrupted"){           // another temp clear stopped mid-way: resume it first (server 2026-09-28)
      const at = extra.startedAt ? fmtClock(extra.startedAt, false) : "";
      return "An earlier clear of old temp files was interrupted" + (at ? " (started " + at + ")" : "") + ". Resume it in History first.";
    }
    if(c === "run_busy"){
      if(ctx === "drain") return "A cleanup run is already in progress. It will show in History.";
      const at = extra.startedAt ? fmtClock(extra.startedAt, false) : "";
      if(ctx === "temp") return "Temp files are already being cleared" + (at ? " (started " + at + ")" : "") + ". Wait for that to finish; it will show in History.";
      return "This delete is already running" + (at ? " (started " + at + ")" : "") + ". It will show in History.";
    }
    if(c === "run_not_found") return "That run no longer exists. Refresh History.";
    // a server from before 2026-09-28 doesn't know the temp-file actions
    if(ctx === "temp" && (c === "bad_request" || s === 400) && /unknown action/i.test(String(err.message || ""))) return MSG.tempUpdate;
    if(c === "bad_request" || s === 400 || s === 413) return "The server refused the request" + (err.message ? ": " + err.message : ".");
    if(s >= 500 || c === "internal") return MSG.internal;
    return err.message || ("Something went wrong (" + (c || s || "unknown") + ").");
  }

  function runStatus(run){
    const st = String((run && run.status) || "");
    if(st === "done") return { text:"Done", tone:"ok" };
    if(st === "partial") return { text:"Partial", tone:"amber" };
    if(st === "running") return run.interrupted ? { text:"Interrupted", tone:"alert" } : { text:"Running", tone:"amber" };
    if(st === "expired" || (st === "previewed" && run.preview_expired)) return { text:"Expired", tone:"neutral" };
    if(st === "previewed") return { text:"Reviewed, not run", tone:"neutral" };
    return { text:st || "Unknown", tone:"neutral" };
  }
  /* Resume: a project delete or a temp-file clear (2026-09-28), never a queue drain */
  function canResume(run){
    if(!run || (run.action !== DELETE_ACTION && run.action !== TEMP_ACTION)) return false;
    return run.status === "partial" || (run.status === "running" && !!run.interrupted);
  }
  /* files a Resume may still delete (failed ones are retried); an upper bound */
  function resumeCount(run){
    if(!run) return 0;
    return Math.max(0, num(run.planned_files) - num(run.removed_files) - num(run.already_gone) - num(run.skipped_files));
  }
  function leftLine(left){
    const entries = Object.entries(left || {}).filter(([, n])=> num(n) > 0);
    if(!entries.length) return "Nothing left to delete in these projects.";
    const total = entries.reduce((a, [, n])=> a + num(n), 0);
    return plural(total, "file") + (total === 1 ? " remains: " : " remain: ")
      + entries.map(([st, n])=> (entries.length > 1 ? fmtCount(n) + " " : "") + statusChip(st).text.toLowerCase()).join(", ") + ".";
  }

  /* ── clear old temp files (2026-09-28) ─────────────────────────────────── */
  /* Why "Clear old temp files" is off, or "" when it can run. temp is
     overview.temp; an older server sends none (and no setup.tempEnabled). */
  function tempBlockReason(setup, temp){
    if(setup && setup.seesAll === false) return MSG.notFullReader;
    if(setup && setup.setup && setup.setup.audit === false) return MSG.auditOff;
    if(!setup || !temp || typeof temp !== "object" || setup.tempEnabled === undefined) return MSG.tempUpdate;
    if(setup.setup && setup.setup.temp_action === false) return MSG.tempOff;
    if(!setup.tempEnabled) return "Clearing temp files is off.";
    if(!num(temp.oldFiles)) return "Nothing to clear yet.";
    return "";
  }
  const tempHours = (x)=> num(x && x.cutoffHours) || 24;
  function tempStatsLine(temp){
    if(!temp || typeof temp !== "object") return "";
    const hrs = tempHours(temp);
    if(!num(temp.oldFiles)) return "No old temp files to clear.";
    return plural(temp.oldFiles, "file") + " · " + fmtBytes(temp.oldBytes) + " older than " + hrs + " hours, in "
      + plural(temp.accounts, "account") + "." + (temp.oldest ? " Oldest " + fmtWhen(temp.oldest) + "." : "");
  }
  /* the review's (or a run's) held-back files, in plain words: "2 still uploading, 1 …" */
  const TEMP_KEPT = [["held: upload in progress", "still uploading"], ["held: in the cleanup queue", "queued for cleanup"],
    ["held: changed in the last 24 hours", "changed in the last 24 hours"], ["held: in use", "in use"],
    ["held: in an interrupted clear", "waiting for an interrupted clear (resume it in History)"],
    ["outside the temp-file layout", "outside the temp-file layout"], ["no longer in storage", "already gone"]];
  function tempKeptLine(byDetail){
    const by = byDetail && typeof byDetail === "object" ? byDetail : {};
    const known = new Set(TEMP_KEPT.map(([k])=> k));
    const parts = TEMP_KEPT.filter(([k])=> num(by[k]) > 0).map(([k, t])=> fmtCount(by[k]) + " " + t);
    const other = Object.entries(by).filter(([k, n])=> !known.has(k) && num(n) > 0).reduce((a, [, n])=> a + num(n), 0);
    if(other) parts.push(fmtCount(other) + " kept for another reason");
    return parts.join(", ");
  }
  function tempConfirmText(pv){
    const n = num(pv && pv.plannedFiles), hrs = tempHours(pv);
    return "Delete " + plural(n, "temporary file") + " (" + fmtBytes(pv && pv.plannedBytes) + ")? "
      + (n === 1 ? "It was staged more than " + hrs + " hours ago, has expired, and no project uses it."
        : "They were staged more than " + hrs + " hours ago, have expired, and no project uses them.")
      + " Each file is checked again just before it's deleted. This can't be undone.";
  }
  function tempEmptyText(pv){
    const kept = num(pv && pv.keptFiles), line = tempKeptLine(pv && pv.keptByDetail);
    return "Nothing to delete right now." + (kept
      ? " " + plural(kept, "old temp file") + (kept === 1 ? " is" : " are") + " held back" + (line ? ": " + line : "") + "." : "");
  }
  /* clear-temp's answer → the result line */
  function tempResultLine(r){
    const x = r || {};
    return "Removed " + fmtCount(x.removed) + " · " + fmtBytes(num(x.removedBytes)) + " · already gone " + fmtCount(x.alreadyGone)
      + " · kept " + fmtCount(x.skipped && x.skipped.count) + " · failed " + fmtCount(x.failed && x.failed.count)
      + (x.status === "done" ? "" : ". Stopped early.");
  }
  /* a stopped clear: the same run can carry on (Try again), unless the answer
     says it can't: an expired review, another clear to resume first, a switched-off
     or older server, or a run that no longer exists */
  const TEMP_NO_RETRY = new Set(["preview_expired", "temp_interrupted", "run_not_found", "temp_action_missing",
    "audit_missing", "not_full_reader", "views_missing", "views_drift", "bad_request", "sign_in", "admin_only", "not_deployed", "no_cloud"]);
  function tempCanRetry(t){
    if(!t || t.phase !== "result" || !t.result || t.result.status === "done") return false;
    return !(t.error && TEMP_NO_RETRY.has(String(t.error.code || "")));
  }
  /* the Accounts tab's service row for the temp folder (new server: overview.temp) */
  function serviceNote(s, temp){
    if(s.label === TEMP_SERVICE && temp && typeof temp === "object"){
      const hrs = tempHours(temp);
      return num(temp.oldFiles) ? fmtCount(temp.oldFiles) + " older than " + hrs + " hours · clear them in Cleanup"
        : "none older than " + hrs + " hours";
    }
    return s.safe_files ? fmtCount(s.safe_files) + " expired · kept" : "kept";
  }

  /* Keyboard for div role=button rows: Enter / Space act only when the row
     itself has focus, never when the key belongs to a control inside it. */
  function rowKey(fn){
    return (e)=>{
      if(!e || e.target !== e.currentTarget) return;
      if(e.key !== "Enter" && e.key !== " ") return;
      if(e.preventDefault) e.preventDefault();
      fn();
    };
  }
  /* Keeps Tab inside box (the review sheet, else the page). → true if it moved focus. */
  const FOCUSABLE = "button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex='-1'])";
  function trapTab(e, box, doc){
    if(!e || e.key !== "Tab" || !box || typeof box.querySelectorAll !== "function") return false;
    const shown = (el)=> typeof el.getClientRects !== "function" || el.getClientRects().length > 0;
    const list = Array.prototype.filter.call(box.querySelectorAll(FOCUSABLE), shown);
    const go = (el)=>{ if(e.preventDefault) e.preventDefault(); try{ el.focus(); }catch(x){} return true; };
    if(!list.length) return go(box);
    const first = list[0], last = list[list.length - 1];
    const active = doc ? doc.activeElement : null;
    const inside = !!active && typeof box.contains === "function" && box.contains(active);
    if(!inside) return go(e.shiftKey ? last : first);
    if(e.shiftKey && (active === first || active === box)) return go(last);
    if(!e.shiftKey && active === last) return go(first);
    return false;
  }

  /* ── the one server call ───────────────────────────────────────────────── */
  /* A request that never got an answer means "not deployed" only until the
     function has answered once; after that it is a dropped connection. */
  let reached = false;
  async function readInvokeError(error){
    const name = String((error && error.name) || "");
    if(name === "FunctionsFetchError" || name === "FunctionsRelayError") return { status:0, code:reached ? "fetch" : "not_deployed", message:"", extra:{} };
    const ctx = error && error.context;
    const status = ctx && typeof ctx.status === "number" ? ctx.status : 0;
    let body = null;
    try{ if(ctx && typeof ctx.json === "function") body = await ctx.json(); }catch(e){}
    const e = body && body.error && typeof body.error === "object" ? body.error : {};
    if(typeof e.code === "string") reached = true;       // our function answered
    const extra = Object.assign({}, e); delete extra.code; delete extra.message;
    const code = typeof e.code === "string" ? e.code : (status === 404 ? "not_deployed" : status ? "http_" + status : "fetch");
    return { status:status, code:code, message:typeof e.message === "string" ? e.message : "", extra:extra };
  }
  async function callAdminStorage(body){
    const sb = (typeof window.sbClient === "function") ? window.sbClient() : null;
    if(!sb || !sb.functions || typeof sb.functions.invoke !== "function"){
      return { ok:false, error:{ status:0, code:"no_cloud", message:"", extra:{} } };
    }
    let timer = null;
    const timeout = new Promise((resolve)=>{ timer = setTimeout(()=> resolve({ __timeout:true }), CALL_TIMEOUT_MS); });
    try{
      const r = await Promise.race([sb.functions.invoke(FN, { body:body }), timeout]);
      if(r && r.__timeout) return { ok:false, error:{ status:0, code:"timeout", message:"", extra:{} } };
      const data = r && r.data, error = r && r.error;
      if(error) return { ok:false, error:await readInvokeError(error) };
      if(!data || data.ok !== true){
        const e = (data && data.error) || {};
        return { ok:false, error:{ status:0, code:e.code || "internal", message:e.message || "", extra:{} } };
      }
      reached = true;
      return { ok:true, data:data };
    }catch(e){
      return { ok:false, error:{ status:0, code:reached ? "fetch" : "not_deployed", message:String((e && e.message) || e), extra:{} } };
    }finally{
      if(timer) clearTimeout(timer);
    }
  }
  /* The one run loop: a project delete ("delete") and a temp-file clear
     ("clear-temp", 2026-09-28). Calls the action with the run id until the
     server says done, an error stops it, or a call makes no progress; at most
     LOOP_CAP calls. The request carries the run id only (RUN_CALL).
     → { result, error, answered } (answered: the server sent real counts) */
  const RUN_CALL = {
    delete:(runId)=> ({ action:"delete", runId:runId }),
    "clear-temp":(runId)=> ({ action:"clear-temp", runId:runId }),
  };
  async function loopRun(action, runId, planned, onProgress){
    const call = RUN_CALL[action];
    let last = null, error = null, prevRemaining = Infinity;
    for(let i = 0; call && i < LOOP_CAP; i++){
      const r = await callAdminStorage(call(runId));
      if(!r.ok){
        error = r.error;
        // a project exists again: the server sends the run's real counts (files may already be gone)
        const counts = error && error.extra && error.extra.result;
        if(counts && typeof counts === "object") last = counts;
        break;
      }
      last = r.data;
      if(onProgress) onProgress(Object.assign({}, last, { planned:num(last.planned) || planned }));
      if(last.status === "done") break;
      const rem = num(last.remaining);
      if(!(rem < prevRemaining) || rem === 0) break;      // no progress: stop and offer Retry
      prevRemaining = rem;
    }
    const result = last ? Object.assign({}, last, { planned:num(last.planned) || planned })
      : { status:"partial", removed:0, removedBytes:0, planned:planned, alreadyGone:0, skipped:{ count:0, byStatus:{} },
          failed:{ count:0, sample:[] }, remaining:planned };
    return { result:result, error:error, answered:!!last };
  }
  function copyText(text){
    try{
      if(typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(String(text)).then(()=> toast("Copied.", "success"),
          ()=> toast("Couldn't copy. Select the text instead.", "error"));
        return;
      }
    }catch(e){}
    toast("Couldn't copy. Select the text instead.", "error");
  }
  function CopyBtn({ text, label }){
    return h("button", { type:"button", className:"adm-copy", title:"Copy " + (label || "") ,
      "aria-label":"Copy " + (label || text),
      onClick:(e)=>{ if(e && e.stopPropagation) e.stopPropagation(); copyText(text); } },
      icon("copy", 11), "Copy");
  }

  /* ── pieces ────────────────────────────────────────────────────────────── */
  function SetupStrip({ setup }){
    if(!setup) return null;
    const notes = [];
    if(setup.seesAll === false) notes.push(["alert", MSG.notFullReader]);
    else if(setup.setup && setup.setup.audit === false) notes.push(["amber", MSG.auditOff]);
    if(setup.setup && setup.setup.queue && setup.deleteEnabled && !setup.drainEnabled) notes.push(["amber", MSG.queueWorker]);
    if(!notes.length) return null;
    return h("div", { className:"adm-setup", role:"status" },
      notes.map(([tone, text], i)=> h("div", { key:i, className:"adm-banner " + tone }, icon("warn", 13), h("span", null, text))));
  }

  function Tile({ label, value, sub, tone }){
    return h("div", { className:"adm-tile" + (tone ? " " + tone : "") },
      h("div", { className:"adm-tile-lab" }, label),
      h("div", { className:"adm-tile-val" }, value),
      sub ? h("div", { className:"adm-tile-sub" }, sub) : null);
  }
  /* temp: overview.temp (2026-09-28); an older server sends none, and then the
     row stays the four tiles it always was */
  function Tiles({ model, temp }){
    if(!model){
      return h("div", { className:"adm-tiles", "aria-busy":"true" },
        [0, 1, 2, 3].map((i)=> h("div", { key:i, className:"adm-tile skel" },
          h("div", { className:"adm-skel-line short" }), h("div", { className:"adm-skel-line" }))));
    }
    const t = model.totals;
    const hasTemp = !!(temp && typeof temp === "object");
    // five tiles: one row where they fit (desktop) instead of a lone fifth tile
    // on a second row; two across on a phone, as the stylesheet's phone rule
    // (inline, so styles.css and its cache key stay as they are)
    return h("div", { className:"adm-tiles", style:hasTemp ? { gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))" } : undefined },
      h(Tile, { label:"Stored", value:plural(t.files, "file"), sub:fmtBytes(t.bytes) }),
      h(Tile, { label:"Accounts", value:fmtCount(t.accounts),
        sub:t.deletedAccounts ? plural(t.deletedAccounts, "deleted account folder") : null }),
      h(Tile, { label:"Deleted projects", value:fmtCount(t.deletedProjects) + " · " + fmtBytes(t.deletedBytes),
        sub:fmtBytes(t.deletedSafeBytes) + " safe to delete", tone:t.deletedSafeBytes > 0 ? "alert" : "" }),
      h(Tile, { label:"Cleanup queue",
        value:t.queue ? fmtCount(t.queue.ready) + " ready · " + fmtCount(t.queue.later) + " later · " + fmtCount(t.queue.stuck) + " stuck" : "Not installed",
        tone:t.queue && t.queue.stuck ? "amber" : "" }),
      hasTemp ? h(Tile, { label:"Old temp files", value:fmtCount(temp.oldFiles) + " · " + fmtBytes(num(temp.oldBytes)),
        sub:num(temp.oldFiles) ? "older than " + tempHours(temp) + " hours" : "none" }) : null);
  }

  function headRow(cols){
    return h("div", { className:"adm-row adm-head-row", "aria-hidden":"true" },
      cols.map(([k, t])=> h("span", { key:k, className:"c-" + k }, t)));
  }
  function Empty({ text }){ return h("div", { className:"adm-empty" }, text); }
  function FilterChips({ value, options, onChange, label }){
    return h("div", { className:"adm-filters", role:"group", "aria-label":label },
      options.map(([k, text])=> h("button", { key:k, type:"button", className:"adm-filter" + (value === k ? " on" : ""),
        "aria-pressed":value === k, onClick:()=> onChange(k) }, text)));
  }
  function verdictChip(v){
    if(v === "delete-folder") return { text:"All safe", tone:"alert" };
    if(v === "some") return { text:"Some safe", tone:"amber" };
    return { text:"In use", tone:"neutral" };
  }
  function keptSummary(counts){
    const parts = [];
    if(counts.queued) parts.push(fmtCount(counts.queued) + " queued");
    if(counts.uploading) parts.push(fmtCount(counts.uploading) + " uploading");
    if(counts.kept_retry) parts.push(fmtCount(counts.kept_retry) + " Show retry");
    if(counts.referenced) parts.push(fmtCount(counts.referenced) + " in use");
    if(counts.unreferenced) parts.push(fmtCount(counts.unreferenced) + " unreferenced");
    return parts.join(" · ");
  }
  function deleteBlockReason(setup, safeFiles){
    if(!setup || !setup.deleteEnabled){
      if(setup && setup.seesAll === false) return MSG.notFullReader;
      if(setup && setup.setup && setup.setup.audit === false) return MSG.auditOff;
      return "Deleting is off.";
    }
    if(!safeFiles) return "Nothing here is safe to delete.";
    return "";
  }

  /* ── Accounts tab ──────────────────────────────────────────────────────── */
  function AccountCard({ a, maxBytes, open, onToggle, onOpenProject, onReview, setup }){
    const owned = a.owns;
    const titles = owned.slice(0, 3).map((p)=> p.label).join(" · ") + (owned.length > 3 ? " +" + (owned.length - 3) : "");
    const pct = maxBytes > 0 ? Math.max(a.total_bytes > 0 ? 2 : 0, Math.round(a.total_bytes / maxBytes * 100)) : 0;
    const nothing = !owned.length && !a.elsewhere.length && !a.deleted.length;
    return h("div", { className:"adm-acct" + (open ? " open" : ""), id:"adm-acct-" + a.id },
      h("button", { type:"button", className:"adm-acct-head", "aria-expanded":open, onClick:()=> onToggle(a.id) },
        h("div", { className:"adm-acct-main" },
          h("div", { className:"adm-acct-l1" }, a.deleted_account
            ? h("span", { className:"adm-chip alert" }, "Deleted account · " + shortId(a.id))
            : h("span", { className:"adm-acct-email" }, a.email || shortId(a.id))),
          h("div", { className:"adm-acct-l2" },
            !a.deleted_account && h("span", { className:"adm-chip neutral" }, a.plan || "no plan"),
            h("span", null, plural(owned.length, "project")),
            a.deleted.length ? h("span", { className:"adm-chip alert" }, plural(a.deleted.length, "deleted project")) : null),
          owned.length ? h("div", { className:"adm-acct-l3" }, titles) : null),
        h("div", { className:"adm-acct-side" },
          h("div", { className:"adm-acct-size" }, fmtBytes(a.total_bytes),         // this account's own upload folder
            h("span", { className:"adm-muted" }, " uploaded · " + plural(a.file_count, "file"))),
          h("div", { className:"adm-bar", "aria-hidden":"true" }, h("span", { style:{ width:pct + "%" } })),
          h("div", { className:"adm-acct-seen" }, a.deleted_account ? "account deleted"
            : a.last_sign_in_at ? "last sign-in " + fmtAgo(a.last_sign_in_at) : "never signed in")),
        h("span", { className:"adm-acct-chev" }, icon(open ? "chevD" : "chevR", 14))),
      open && h("div", { className:"adm-acct-body" },
        nothing ? h(Empty, { text:"No projects and no uploads." }) : null,
        owned.length ? h("div", { className:"adm-group" },
          h("div", { className:"adm-group-h" }, "Owns"),
          h("div", { className:"adm-rows adm-own" },
            headRow([["title", "Title"], ["kind", "Kind"], ["state", "Live"], ["files", "Files"], ["size", "Size"],
              ["by", "Uploaded by"], ["date", "Last upload"], ["go", ""]]),
            owned.map((p)=> h("button", { key:p.id, type:"button", className:"adm-row adm-click", onClick:()=> onOpenProject(p.id) },
              h("span", { className:"c-title" }, p.title || "Untitled"),
              h("span", { className:"c-kind" }, kindLabel(p)),
              h("span", { className:"c-state" }, chip({ text:"Live", tone:"ok" })),
              h("span", { className:"adm-br" }),
              h("span", { className:"c-files" }, p.files ? fmtCount(p.files) : "no files", h("span", { className:"adm-unit" }, p.files ? " files" : "")),
              h("span", { className:"c-size" }, p.files ? fmtBytes(p.total_bytes) : ""),
              h("span", { className:"adm-br" }),
              h("span", { className:"c-by" }, p.uploaders.map((u)=> localPart(u.email) + " " + fmtCount(u.files)).join(" · ")),
              h("span", { className:"c-date" }, p.last_upload ? fmtDate(p.last_upload) : "—"),
              h("span", { className:"c-go" }, "›"))))) : null,
        a.elsewhere.length ? h("div", { className:"adm-group" },
          h("div", { className:"adm-group-h" }, "Uploaded to other people's projects"),
          h("div", { className:"adm-rows adm-else" },
            a.elsewhere.map((e)=> h("button", { key:e.project.id, type:"button", className:"adm-row adm-click", onClick:()=> onOpenProject(e.project.id) },
              h("span", { className:"c-title" }, e.project.label,
                h("span", { className:"adm-muted" }, " · owned by " + (e.project.owner_email || "unknown"))),
              h("span", { className:"adm-br" }),
              h("span", { className:"c-files" }, plural(e.files, "file")),
              h("span", { className:"c-size" }, fmtBytes(e.bytes)),
              h("span", { className:"c-go" }, "›"))))) : null,
        a.deleted.length ? h("div", { className:"adm-group" },
          h("div", { className:"adm-group-h" }, "Deleted projects still holding files"),
          // the row counts this account's uploads; a review plans every file of the project
          a.deleted.some((d)=> d.project.files > d.files) ? h("div", { className:"adm-group-note" }, MSG.wholeProject) : null,
          h("div", { className:"adm-rows adm-del" },
            a.deleted.map((d)=>{
              const why = deleteBlockReason(setup, d.project.safeFiles);
              const shared = d.project.files > d.files;
              return h("div", { key:d.project.id, className:"adm-row adm-click", role:"button", tabIndex:0,
                onClick:()=> onOpenProject(d.project.id), onKeyDown:rowKey(()=> onOpenProject(d.project.id)) },
                h("span", { className:"c-title" }, "Deleted project · " + shortId(d.project.id)),
                h("span", { className:"c-state" }, chip(verdictChip(d.verdict))),
                h("span", { className:"adm-br" }),
                h("span", { className:"c-files" }, shared ? fmtCount(d.files) + " of " + plural(d.project.files, "file") : plural(d.files, "file")),
                h("span", { className:"c-size" }, fmtBytes(d.bytes)),
                h("span", { className:"c-safe" }, fmtCount(d.safe_files) + " safe · " + fmtBytes(d.safe_bytes)),
                h("span", { className:"adm-br" }),
                h("span", { className:"c-by" }, keptSummary(d.counts) || "nothing kept"),
                h("span", { className:"c-date" }, d.last_upload ? fmtDate(d.last_upload) : "—"),
                h("span", { className:"c-act" }, !why
                  ? h("button", { type:"button", className:"adm-btn danger sm",
                      onClick:(e)=>{ if(e && e.stopPropagation) e.stopPropagation(); onReview([d.project.id]); } },
                      shared ? "Review & delete whole project" : "Review & delete")
                  : d.project.safeFiles > 0 ? h("span", { className:"adm-muted", title:why }, "Deleting off") : null));
            }))) : null));
  }

  function AccountsTab({ model, setup, temp, filterText, filter, setFilter, expanded, onToggle, onOpenProject, onReview }){
    const q = String(filterText || "").trim().toLowerCase();
    let list = model.accounts;
    if(filter === "deleted-projects") list = list.filter((a)=> a.deleted.length);
    else if(filter === "deleted-accounts") list = list.filter((a)=> a.deleted_account);
    if(q) list = list.filter((a)=> String(a.email || "").toLowerCase().includes(q)
      || a.owns.some((p)=> String(p.title || "").toLowerCase().includes(q) || String(p.show_title || "").toLowerCase().includes(q))
      || a.id.startsWith(q));
    const maxBytes = model.accounts.reduce((m, a)=> Math.max(m, a.total_bytes), 0);
    return h("div", { className:"adm-tab-body" },
      h(FilterChips, { value:filter, onChange:setFilter, label:"Filter accounts",
        options:[["all", "All"], ["deleted-projects", "Has deleted projects"], ["deleted-accounts", "Deleted accounts"]] }),
      model.totals.files === 0 ? h(Empty, { text:MSG.empty }) : null,
      list.length ? h("div", { className:"adm-accts" },
        list.map((a)=> h(AccountCard, { key:a.id, a:a, maxBytes:maxBytes, open:expanded === a.id, onToggle:onToggle,
          onOpenProject:onOpenProject, onReview:onReview, setup:setup })))
        : h(Empty, { text:filter === "deleted-projects" ? MSG.noDeleted
            : filter === "deleted-accounts" ? "No deleted accounts are holding files."
            : q ? "No account matches “" + filterText + "”." : "No accounts yet." }),
      // 2026-09-28 review: service files are kept; the temp folder's old files
      // are cleared from Cleanup → Old temp files (serviceNote)
      model.service.length ? h("div", { className:"adm-service" },
        h("div", { className:"adm-group-h" }, "Service & temporary files"),
        model.service.map((s)=> h("div", { key:s.label, className:"adm-service-row" },
          h("span", { className:"c-title" }, s.label),
          h("span", { className:"c-size" }, plural(s.files, "file") + " · " + fmtBytes(s.bytes)),
          h("span", { className:"adm-muted" }, serviceNote(s, temp))))) : null);
  }

  /* ── Projects tab ──────────────────────────────────────────────────────── */
  function ProjectsTab({ model, setup, filterText, onOpenProject, onReview }){
    const [filter, setFilter] = React.useState("all");
    const [sort, setSort] = React.useState("size");
    const [picked, setPicked] = React.useState([]);
    const q = String(filterText || "").trim().toLowerCase();
    let list = model.projects.slice();
    if(filter === "live") list = list.filter((p)=> p.live);
    else if(filter === "deleted") list = list.filter((p)=> !p.live);
    else if(filter === "safe") list = list.filter((p)=> !p.live && p.safeFiles > 0);      // live projects are never deleted here
    if(q) list = list.filter((p)=> [p.title, p.show_title, p.owner_email, p.uploader_emails, p.id]
      .some((v)=> String(v || "").toLowerCase().includes(q)));
    if(sort === "name") list.sort((a, b)=> String(a.label).localeCompare(String(b.label)));
    else if(sort === "last") list.sort((a, b)=> String(b.last_upload || "").localeCompare(String(a.last_upload || "")));
    else list.sort((a, b)=> (b.total_bytes - a.total_bytes) || String(a.label).localeCompare(String(b.label)));
    const pickable = (p)=> !p.live && p.safeFiles > 0 && !!(setup && setup.deleteEnabled);
    const pickedRows = picked.map((id)=> model.projectsById[id]).filter((p)=> p && pickable(p));
    const toggle = (id)=> setPicked((cur)=> cur.includes(id) ? cur.filter((x)=> x !== id)
      : (cur.length >= MAX_REVIEW ? (toast("Review at most " + MAX_REVIEW + " projects at a time.", "info"), cur) : cur.concat([id])));
    const safeSum = pickedRows.reduce((a, p)=> a + p.safeBytes, 0);
    return h("div", { className:"adm-tab-body" },
      h("div", { className:"adm-toolbar" },
        h(FilterChips, { value:filter, onChange:setFilter, label:"Filter projects",
          options:[["all", "All"], ["live", "Live"], ["deleted", "Deleted"], ["safe", "Safe to delete"]] }),
        h("label", { className:"adm-sort" }, "Sort",
          h("select", { value:sort, onChange:(e)=> setSort(e.target.value), "aria-label":"Sort projects" },
            h("option", { value:"size" }, "Size"), h("option", { value:"name" }, "Name"), h("option", { value:"last" }, "Last upload")))),
      model.totals.files === 0 ? h(Empty, { text:MSG.empty }) : null,
      list.length ? h("div", { className:"adm-rows adm-proj" },
        headRow([["pick", ""], ["title", "Project"], ["owner", "Owner"], ["kind", "Kind"], ["state", "State"],
          ["files", "Files"], ["size", "Size"], ["safe", "Safe"], ["date", "Last upload"]]),
        list.map((p)=> h("div", { key:p.id, className:"adm-row adm-click" + (picked.includes(p.id) ? " picked" : ""),
            role:"button", tabIndex:0, onClick:()=> onOpenProject(p.id), onKeyDown:rowKey(()=> onOpenProject(p.id)) },
          // the whole cell is the tap target (40 px on phones), never the row behind it
          pickable(p) ? h("label", { className:"c-pick", title:"Select " + p.label,
              onClick:(e)=>{ if(e && e.stopPropagation) e.stopPropagation(); } },
              h("input", { type:"checkbox", checked:picked.includes(p.id), "aria-label":"Select " + p.label,
                onClick:(e)=>{ if(e && e.stopPropagation) e.stopPropagation(); }, onChange:()=> toggle(p.id) }))
            : h("span", { className:"c-pick" }),
          h("span", { className:"c-title" }, p.label),
          h("span", { className:"c-kind" }, kindLabel(p)),
          h("span", { className:"c-state" }, chip(p.live ? { text:"Live", tone:"ok" } : { text:"Deleted", tone:"alert" })),
          h("span", { className:"adm-br" }),
          h("span", { className:"c-files" }, fmtCount(p.files), h("span", { className:"adm-unit" }, " files")),
          h("span", { className:"c-size" }, fmtBytes(p.total_bytes)),
          p.live && p.safeFiles
            ? h("span", { className:"c-safe adm-muted", title:MSG.liveReadOnly }, fmtCount(p.safeFiles) + " unused · " + MSG.liveKept)
            : h("span", { className:"c-safe" }, p.safeFiles ? fmtCount(p.safeFiles) + " · " + fmtBytes(p.safeBytes) : "—",
                h("span", { className:"adm-unit" }, p.safeFiles ? " safe" : "")),
          h("span", { className:"adm-br" }),
          h("span", { className:"c-owner" }, p.live ? (p.owner_email || "unknown owner") : (p.uploader_emails ? "uploads: " + p.uploader_emails : "Deleted project")),
          h("span", { className:"c-date" }, p.last_upload ? fmtDate(p.last_upload) : "—"))))
        : h(Empty, { text:filter === "deleted" ? MSG.noDeleted : q ? "No project matches “" + filterText + "”." : "No projects yet." }),
      pickedRows.length ? h("div", { className:"adm-bulk" },
        h("button", { type:"button", className:"adm-btn danger", onClick:()=> onReview(pickedRows.map((p)=> p.id)) },
          "Review & delete " + plural(pickedRows.length, "project") + " · " + fmtBytes(safeSum) + " safe"),
        h("button", { type:"button", className:"adm-btn", onClick:()=> setPicked([]) }, "Clear")) : null);
  }

  /* ── Project detail (drawer; a pushed screen on phone) ─────────────────── */
  function ProjectDetail({ project, model, setup, asOf, onClose, onReview }){
    const [rows, setRows] = React.useState([]);
    const [next, setNext] = React.useState(null);
    const [total, setTotal] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [err, setErr] = React.useState(null);
    const pid = project.id;
    const load = React.useCallback(async (cursor)=>{
      setLoading(true); setErr(null);
      const r = await callAdminStorage(cursor ? { action:"project-files", projectId:pid, cursor:cursor } : { action:"project-files", projectId:pid });
      if(r.ok){
        const got = Array.isArray(r.data.rows) ? r.data.rows : [];
        setRows((cur)=> cursor ? cur.concat(got) : got);
        setNext(r.data.nextCursor || null);
        if(!cursor) setTotal(r.data.total == null ? got.length : num(r.data.total));
      } else setErr(r.error);
      setLoading(false);
    }, [pid]);
    React.useEffect(()=>{ load(null); }, [load, asOf]);      // and again after every Refresh
    const c = project.counts;
    const summary = [
      ["orphan: project deleted", c.orphan_deleted], ["queued-for-cleanup", c.queued], ["uploading", c.uploading],
      ["kept-for-promotion-retry", c.kept_retry], ["service", c.service], ["unreferenced", c.unreferenced], ["current", c.referenced],
    ].filter(([, n])=> n > 0);
    const groups = new Map();
    for(const f of rows){
      const g = f.asset_folder || (/\/studio-previews\//.test(f.path) ? "Blender previews" : "other");
      if(!groups.has(g)) groups.set(g, []);
      groups.get(g).push(f);
    }
    const why = deleteBlockReason(setup, project.safeFiles);
    const liveTitle = (id)=>{ const p = model.projectsById[lc(id)]; return p && p.live ? p.label : null; };
    return h("aside", { className:"adm-detail", role:"region", "aria-label":"Project detail" },
      h("div", { className:"adm-detail-head" },
        h("button", { type:"button", className:"adm-back", onClick:onClose, "aria-label":"Back" },
          h("span", { className:"adm-back-phone" }, icon("chevL", 14), "Back"),
          h("span", { className:"adm-back-desk" }, icon("x", 15))),
        h("div", { className:"adm-detail-title" },
          h("div", { className:"adm-detail-name" }, project.live ? (project.title || "Untitled") : "Deleted project · " + shortId(pid)),
          h("div", { className:"adm-detail-chips" },
            project.live ? h("span", { className:"adm-chip neutral" }, kindLabel(project)) : null,
            chip(project.live ? { text:"Live", tone:"ok" } : { text:"Deleted", tone:"alert" })))),
      h("div", { className:"adm-detail-body" },
        h("div", { className:"adm-kv" },
          h("div", null, h("span", { className:"adm-k" }, "Owner"),
            h("span", null, project.live ? (project.owner_email || "unknown") : "Deleted project")),
          !project.live && project.uploader_emails ? h("div", null, h("span", { className:"adm-k" }, "Uploaded by"), h("span", null, project.uploader_emails)) : null,
          h("div", null, h("span", { className:"adm-k" }, "Project id"),
            h("span", { className:"adm-mono" }, pid), h(CopyBtn, { text:pid, label:"project id" }))),
        project.folders.length ? h("div", { className:"adm-folders" },
          h("div", { className:"adm-k" }, "Storage folders:"),
          project.folders.map((f, i)=>{
            const path = f.user_folder + "/" + f.project_folder;
            return h("div", { key:path + i, className:"adm-folder" },
              h("span", { className:"adm-mono" }, path),
              h("span", { className:"adm-muted" }, (f.uploader_email || (f.uploader_id ? "deleted account" : "service")) + " · " + plural(f.files, "file")),
              h(CopyBtn, { text:path, label:"folder" }));
          })) : null,
        summary.length ? h("div", { className:"adm-summary" },
          summary.map(([st, n])=> h("span", { key:st, className:"adm-sum" }, chip(statusChip(st, st === "orphan: project deleted" && project.safeFiles > 0, project.live)), " ", fmtCount(n))),
          project.safeFiles ? h("span", { className:"adm-sum adm-muted" }, project.live
            ? fmtCount(project.safeFiles) + " unused · " + fmtBytes(project.safeBytes) + ". " + MSG.liveReadOnly
            : fmtCount(project.safeFiles) + " safe · " + fmtBytes(project.safeBytes)) : null) : null,
        err ? h("div", { className:"adm-banner alert" }, errorMessage(err),
          h("button", { type:"button", className:"adm-btn sm", onClick:()=> load(null) }, "Retry")) : null,
        !err && !loading && !rows.length ? h(Empty, { text:MSG.noFiles }) : null,
        total != null && rows.length ? h("div", { className:"adm-muted adm-count" }, "Showing " + fmtCount(rows.length) + " of " + plural(total, "file")) : null,
        [...groups].map(([g, list])=> h("div", { key:g, className:"adm-fgroup" },
          h("div", { className:"adm-group-h" }, g + " · " + fmtCount(list.length)),
          list.map((f)=>{
            const sc = statusChip(f.status, f.safe_to_delete === true, project.live);
            const usedBy = !project.live && f.safe_to_delete !== true && Array.isArray(f.referenced_by_project_ids)
              ? f.referenced_by_project_ids.map(liveTitle).filter(Boolean) : [];
            return h("div", { key:f.path, className:"adm-file" },
              h("div", { className:"adm-file-l1" },
                h("span", { className:"adm-file-name" }, f.entity_name || f.entity_id || "—",
                  f.entity_id && f.entity_name ? h("span", { className:"adm-file-id" }, " " + f.entity_id) : null),
                chip(sc),
                f.stored_elsewhere ? h("span", { className:"adm-chip neutral" }, "stored under another project's folder") : null,
                usedBy.length ? h("span", { className:"adm-chip neutral" }, "Used by " + usedBy.join(", ")) : null),
              h("div", { className:"adm-file-l2" },
                h("span", null, fmtBytes(f.bytes)),
                h("span", null, fmtDate(f.created_at)),
                h("span", null, f.uploader_email || "unknown")),
              h("div", { className:"adm-file-path" }, h("span", { className:"adm-mono" }, f.path), h(CopyBtn, { text:f.path, label:"path" })));
          }))),
        loading ? h("div", { className:"adm-muted adm-count" }, "Loading files…") : null,
        next && !loading ? h("button", { type:"button", className:"adm-btn", onClick:()=> load(next) }, "Load more") : null),
      !project.live ? h("div", { className:"adm-detail-foot" },
        h("button", { type:"button", className:"adm-btn danger", disabled:!!why, title:why || undefined,
          onClick:()=>{ if(!why) onReview([pid]); } }, "Review & delete"),
        why ? h("span", { className:"adm-muted" }, why) : null) : null);
  }

  /* ── Review sheet: plan → confirm → delete (loops through 'partial') ───── */
  function ReviewSheet({ sheet, model, boxRef, onCheck, onDelete, onRetry, onReviewAgain, onClose }){
    const [, setTick] = React.useState(0);
    const phase = sheet.phase;
    // an alertdialog takes focus when it opens and hands it back when it closes
    React.useEffect(()=>{
      const prev = typeof document !== "undefined" ? document.activeElement : null;
      try{ if(boxRef && boxRef.current && boxRef.current.focus) boxRef.current.focus(); }catch(e){}
      return ()=>{ try{ if(prev && prev.focus && (!document.contains || document.contains(prev))) prev.focus(); }catch(e){} };
    }, []);
    React.useEffect(()=>{
      if(phase !== "ready") return undefined;
      const t = setInterval(()=> setTick((x)=> x + 1), 1000);
      return ()=> clearInterval(t);
    }, [phase]);
    const pv = sheet.preview;
    const nProjects = (sheet.projectIds || []).length;
    const ctx = sheet.action === "clear-temp" ? "temp" : undefined;      // a temp run resumed from History
    let body = null, title = "";
    if(phase === "loading"){
      title = "Planning the delete…";
      body = h("div", { className:"adm-muted" }, "The server is checking every file in " + plural(nProjects, "deleted project") + ".");
    } else if(phase === "error"){
      title = "Nothing was deleted";
      body = h(React.Fragment, null,
        h("div", { className:"adm-banner alert" }, errorMessage(sheet.error, ctx)),
        h("div", { className:"adm-sheet-acts" },
          sheet.projectIds && sheet.projectIds.length ? h("button", { type:"button", className:"adm-btn", onClick:onReviewAgain }, "Review again") : null,
          h("button", { type:"button", className:"adm-btn", onClick:onClose }, "Close")));
    } else if(phase === "ready" && pv){
      const expMs = new Date(pv.previewExpiresAt).getTime() - Date.now();
      const expired = !(expMs > 0);
      const files = num(pv.total && pv.total.files), bytes = num(pv.total && pv.total.bytes);
      const lines = keptLines(pv, model ? model.projectsById : {});
      title = files ? "Delete " + plural(files, "file") + " (" + fmtBytes(bytes) + ") from " + plural(nProjects, "deleted project") + "?"
        : "Nothing is safe to delete in " + (nProjects === 1 ? "this project" : "these projects");
      body = h(React.Fragment, null,
        h("p", { className:"adm-sheet-p" }, MSG.reviewBody),
        lines.length ? h("div", { className:"adm-kept" },
          h("div", { className:"adm-k" }, "Kept (" + fmtCount(pv.kept && pv.kept.files) + ")"),
          h("ul", null, lines.map((l, i)=> h("li", { key:i }, l)))) : null,
        Array.isArray(pv.projects) && pv.projects.length > 1 ? h("details", { className:"adm-per" },
          h("summary", null, "Per project"),
          pv.projects.map((p)=> h("div", { key:p.projectId, className:"adm-per-row" },
            h("span", { className:"adm-mono" }, shortId(p.projectId)),
            h("span", null, plural(p.files, "file") + " · " + fmtBytes(p.bytes)),
            p.kept ? h("span", { className:"adm-muted" }, fmtCount(p.kept) + " kept") : null))) : null,
        files ? (expired
          ? h("div", { className:"adm-banner amber" }, MSG.expired,
              h("button", { type:"button", className:"adm-btn sm", onClick:onReviewAgain }, "Review again"))
          : h(React.Fragment, null,
              h("div", { className:"adm-expiry" }, "This review expires in " + fmtCountdown(expMs)),
              h("label", { className:"adm-check" },
                h("input", { type:"checkbox", checked:!!sheet.checked, onChange:(e)=> onCheck(!!(e && e.target && e.target.checked)) }),
                "I understand these files are deleted permanently."))) : null,
        h("div", { className:"adm-sheet-acts" },
          h("button", { type:"button", className:"adm-btn", onClick:onClose }, files ? "Cancel" : "Close"),
          files ? h("button", { type:"button", className:"adm-btn danger", disabled:!sheet.checked || expired,
            onClick:()=>{ if(sheet.checked && !expired) onDelete(); } }, "Delete " + plural(files, "file")) : null));
    } else if(phase === "running" || phase === "result"){
      const p = sheet.progress || {};
      const planned = num(p.planned != null ? p.planned : sheet.planned);
      const done = num(p.removed);
      const pct = planned > 0 ? Math.min(100, Math.round(done / planned * 100)) : 0;
      if(phase === "running"){
        title = "Deleting…";
        body = h(React.Fragment, null,
          h("div", { className:"adm-progress", role:"progressbar", "aria-valuemin":0, "aria-valuemax":planned || 0, "aria-valuenow":done },
            h("span", { style:{ width:pct + "%" } })),
          h("div", { className:"adm-progress-lab" }, "Deleting… " + fmtCount(done) + " of " + fmtCount(planned) + " · " + fmtBytes(p.removedBytes || 0) + " freed"),
          h("p", { className:"adm-muted" }, MSG.closeNote));
      } else {
        const r = sheet.result || p;
        const failed = num(r.failed && r.failed.count);
        const statusDone = r.status === "done";
        const detail = r.failed && r.failed.sample && r.failed.sample[0] && r.failed.sample[0].detail;
        const code = sheet.error ? String(sheet.error.code || "") : "";
        // a temp run resumed from History whose call got no counts back (busy,
        // timeout, dropped connection): no made-up "Deleted 0 of N" (2026-09-28 review)
        const noCounts = ctx === "temp" && sheet.answered === false;
        title = statusDone ? "Done" : sheet.error ? "Stopped" : "Partly done";
        body = h(React.Fragment, null,
          noCounts ? h("div", { className:"adm-muted" }, "History shows how far it got.")
          : h("div", { className:"adm-result " + (statusDone ? "ok" : "amber") },
            statusDone ? "Deleted " + plural(r.removed, "file") + " · " + fmtBytes(r.removedBytes) + " freed."
              : "Deleted " + fmtCount(r.removed) + " of " + fmtCount(num(r.planned) || planned) + "." + (failed
                ? " " + fmtCount(failed) + " couldn't be deleted" + (detail ? " (Storage error: " + detail + ")" : "") + "." : "")),
          sheet.error ? h("div", { className:"adm-banner alert" }, errorMessage(sheet.error, ctx)) : null,
          statusDone && r.leftInProjects ? h("div", { className:"adm-muted" }, leftLine(r.leftInProjects)) : null,
          h("div", { className:"adm-sheet-acts" },
            statusDone || code === "project_live" ? null
              : code === "preview_expired" ? (sheet.projectIds && sheet.projectIds.length
                  ? h("button", { type:"button", className:"adm-btn", onClick:onReviewAgain }, "Review again") : null)
              : failed ? h("button", { type:"button", className:"adm-btn danger", onClick:onRetry }, "Retry failed (" + fmtCount(failed) + ")")
              : num(r.remaining) ? h("button", { type:"button", className:"adm-btn danger", onClick:onRetry }, noCounts ? "Try again" : "Try again (" + fmtCount(r.remaining) + " left)")
              : null,
            h("button", { type:"button", className:"adm-btn", onClick:onClose }, "Close")));
      }
    }
    return h("div", { className:"adm-sheet-wrap" },
      h("div", { className:"adm-sheet", role:"alertdialog", "aria-modal":"true", "aria-labelledby":"adm-sheet-title",
          tabIndex:-1, ref:boxRef },
        h("div", { className:"adm-sheet-title", id:"adm-sheet-title" }, title),
        body));
  }

  /* ── Cleanup tab: the cleanup queue + old temp files (2026-09-28) ─────── */
  const REASON = { abandoned_upload:"Abandoned upload", project_deleted:"Project deleted" };
  function QueueSection({ model, setup, onRefresh, setBusy, busy }){
    const [confirming, setConfirming] = React.useState(false);
    const [running, setRunning] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const [err, setErr] = React.useState(null);
    const q = model.queue;
    const head = h("div", { className:"adm-group-h" }, "Cleanup queue");
    if(!q) return h("section", { className:"adm-tab-body", "aria-label":"Cleanup queue" }, head, h(Empty, { text:"The cleanup queue isn't installed." }));
    const ready = Math.min(MAX_DRAIN, q.ready);
    const why = !setup || !setup.drainEnabled
      ? (setup && setup.seesAll === false ? MSG.notFullReader
        : setup && setup.setup && setup.setup.audit === false ? MSG.auditOff : MSG.queueWorker)
      : !q.ready ? "Nothing in the queue is ready yet." : "";
    const run = async ()=>{
      if(busy) return;                       // a temp-file clear is running: one destructive step at a time
      setConfirming(false); setRunning(true); setErr(null); setResult(null); setBusy(true);
      const r = await callAdminStorage({ action:"drain-queue", max:ready || 1 });
      setBusy(false); setRunning(false);
      if(r.ok){
        setResult(r.data);
        toast("Cleanup: removed " + fmtCount(r.data.removed) + ", still queued " + fmtCount(r.data.stillQueued) + ".", r.data.failed ? "error" : "success");
      } else setErr(r.error);
      onRefresh();
    };
    return h("section", { className:"adm-tab-body", "aria-label":"Cleanup queue" },
      head,
      q.byReason.length ? h("div", { className:"adm-rows adm-queue" },
        headRow([["title", "Reason"], ["total", "Total"], ["ready", "Ready now"], ["next", "Next ready"],
          ["oldest", "Oldest"], ["stuck", "Stuck"]]),
        q.byReason.map((r)=> h("div", { key:r.reason, className:"adm-row" },
          h("span", { className:"c-title" }, REASON[r.reason] || r.reason),
          h("span", { className:"adm-br" }),
          h("span", { className:"c-total" }, fmtCount(r.total), h("span", { className:"adm-unit" }, " total")),
          h("span", { className:"c-ready" }, fmtCount(r.ready), h("span", { className:"adm-unit" }, " ready")),
          h("span", { className:"c-next" }, r.next_at ? h(React.Fragment, null, h("span", { className:"adm-unit" }, "next "), fmtWhen(r.next_at)) : "—"),
          h("span", { className:"c-oldest" }, r.oldest ? h(React.Fragment, null, h("span", { className:"adm-unit" }, "oldest "), fmtWhen(r.oldest)) : "—"),
          h("span", { className:"c-stuck" + (num(r.stuck) ? " adm-warn" : "") }, fmtCount(r.stuck), h("span", { className:"adm-unit" }, " stuck")))))
        : h(Empty, { text:MSG.queueEmpty }),
      h("div", { className:"adm-drain" },
        confirming
          ? h("div", { className:"adm-confirm" },
              h("p", null, "Remove up to " + fmtCount(ready) + " queued upload" + (ready === 1 ? "" : "s") + " that " + (ready === 1 ? "is" : "are") + " ready? Each is checked first: anything still in use is kept, and uploads abandoned less than 24 hours ago in live projects wait."),
              h("div", { className:"adm-sheet-acts" },
                h("button", { type:"button", className:"adm-btn", onClick:()=> setConfirming(false) }, "Cancel"),
                h("button", { type:"button", className:"adm-btn danger", disabled:busy, onClick:run }, "Run cleanup")))
          : h("div", { className:"adm-drain-row" },
              h("button", { type:"button", className:"adm-btn danger", disabled:!!why || running || busy, title:why || undefined,
                onClick:()=>{ if(!why && !running && !busy) setConfirming(true); } }, running ? "Cleaning up…" : "Run cleanup now"),
              why ? h("span", { className:"adm-muted" }, why) : null),
        err ? h("div", { className:"adm-banner alert" }, errorMessage(err, "drain")) : null,
        result ? h("div", { className:"adm-result " + (result.failed ? "amber" : "ok") },
          "Removed " + fmtCount(result.removed) + " · already gone " + fmtCount(result.alreadyGone)
          + " · kept (in use) " + fmtCount(result.keptReferenced)
          + (result.heldGrace == null ? " · waiting " + fmtCount(result.held)          // older server: one number
            : " · waiting (24 h) " + fmtCount(result.heldGrace) + (num(result.heldUpload) ? " · upload in progress " + fmtCount(result.heldUpload) : ""))
          + " · failed " + fmtCount(result.failed) + (num(result.notQueued) ? " · no longer queued " + fmtCount(result.notQueued) : "")
          + " · still queued " + fmtCount(result.stillQueued)
          + (result.status === "partial" ? ". Stopped early; run it again to continue." : "")) : null),
      q.stuckItems.length ? h("div", { className:"adm-group" },
        h("div", { className:"adm-group-h" }, "Stuck (" + fmtCount(q.stuckItems.length) + (q.stuckItems.length >= 50 ? ", oldest 50" : "") + ")"),
        q.stuckItems.map((s)=> h("div", { key:s.path, className:"adm-file" },
          h("div", { className:"adm-file-l1" },
            h("span", { className:"adm-file-name" }, REASON[s.reason] || s.reason),
            chip(s.project_live ? { text:"Project live", tone:"ok" } : { text:"Project deleted", tone:"alert" }),
            h("span", { className:"adm-muted" }, plural(s.attempts, "attempt"))),
          s.last_error ? h("div", { className:"adm-file-l2" }, h("span", null, s.last_error)) : null,
          h("div", { className:"adm-file-path" }, h("span", { className:"adm-mono" }, s.path), h(CopyBtn, { text:s.path, label:"path" }))))) : null);
  }

  /* Old temp files: review → confirm → the run loop. The modal holds tempRun
     (phase: loading | confirm | running | result | empty | error), so switching
     tabs mid-run loses nothing. The browser never names a file. A stopped run
     offers Try again on the same run id (onRun with the same review), like the
     review sheet's Retry; the confirm counts down to the review's expiry. */
  function TempSection({ setup, temp, tempRun, busy, onReview, onRun, onCancel }){
    const [, setTick] = React.useState(0);
    const t = tempRun || {};
    const phase = t.phase || "idle";
    const pv = t.preview || null;
    const why = tempBlockReason(setup, temp);
    React.useEffect(()=>{
      if(phase !== "confirm") return undefined;
      const id = setInterval(()=> setTick((x)=> x + 1), 1000);
      return ()=> clearInterval(id);
    }, [phase]);
    const retrying = tempCanRetry(t) && !!(pv && pv.runId);
    let main;
    if(phase === "confirm" && pv){
      const more = num(pv.moreRemain), kept = num(pv.keptFiles), line = tempKeptLine(pv.keptByDetail);
      const expAt = Date.parse(pv.previewExpiresAt);
      const expMs = Number.isFinite(expAt) ? expAt - Date.now() : Infinity;
      const expired = !(expMs > 0);
      main = h("div", { className:"adm-confirm", role:"group", "aria-label":"Clear old temp files" },
        h("p", null, tempConfirmText(pv)),
        more ? h("p", null, fmtCount(more) + " more will remain — run it again afterwards.") : null,
        kept ? h("p", { className:"adm-muted" }, "Not included: " + (line || plural(kept, "file")) + ".") : null,
        expired
          ? h("div", { className:"adm-banner amber" }, MSG.expired,
              h("button", { type:"button", className:"adm-btn sm", disabled:busy, onClick:()=>{ if(!busy) onReview(); } }, "Review again"))
          : Number.isFinite(expMs) ? h("div", { className:"adm-expiry" }, "This review expires in " + fmtCountdown(expMs)) : null,
        h("div", { className:"adm-sheet-acts" },
          h("button", { type:"button", className:"adm-btn", onClick:onCancel }, "Cancel"),
          h("button", { type:"button", className:"adm-btn danger", disabled:busy || expired,
            onClick:()=>{ if(!busy && !expired) onRun(pv); } }, "Delete temp files")));
    } else if(phase === "running"){
      const p = t.progress || {};
      const planned = num(p.planned), done = num(p.removed);
      const pct = planned > 0 ? Math.min(100, Math.round(done / planned * 100)) : 0;
      main = h(React.Fragment, null,
        h("div", { className:"adm-progress", role:"progressbar", "aria-label":"Clearing old temp files",
            "aria-valuemin":0, "aria-valuemax":planned, "aria-valuenow":done },
          h("span", { style:{ width:pct + "%" } })),
        h("div", { className:"adm-progress-lab" }, "Deleting… " + fmtCount(done) + " of " + fmtCount(planned)),
        h("p", { className:"adm-muted" }, MSG.closeNote));
    } else if(retrying){
      // stopped early: carry on with the SAME run; a new review is for when it is done
      const failed = num(t.result.failed && t.result.failed.count), left = num(t.result.remaining);
      main = h("div", { className:"adm-sheet-acts adm-temp-retry" },
        h("button", { type:"button", className:"adm-btn", disabled:busy, onClick:onCancel }, "Close"),
        h("button", { type:"button", className:"adm-btn danger", disabled:busy, onClick:()=>{ if(!busy) onRun(pv); } },
          !t.answered ? "Try again" : failed ? "Retry failed (" + fmtCount(failed) + ")" : "Try again (" + fmtCount(left) + " left)"));
    } else {
      const loading = phase === "loading";
      main = h("div", { className:"adm-drain-row" },
        h("button", { type:"button", className:"adm-btn danger", disabled:!!why || loading || busy, title:why || undefined,
          onClick:()=>{ if(!why && !loading && !busy) onReview(); } }, loading ? "Checking temp files…" : "Clear old temp files"),
        why ? h("span", { className:"adm-muted" }, why) : null);
    }
    const r = t.result || {};
    const clean = r.status === "done" && !num(r.failed && r.failed.count);
    return h("section", { className:"adm-tab-body", "aria-label":"Old temp files" },
      h("div", { className:"adm-group-h" }, "Old temp files"),
      h("div", { className:"adm-group-note" }, MSG.tempAbout),
      temp && typeof temp === "object" ? h("div", { className:"adm-sheet-p" }, tempStatsLine(temp)) : null,
      h("div", { className:"adm-drain" },
        retrying ? null : main,
        phase === "empty" && pv ? h("div", { className:"adm-note", role:"status" }, tempEmptyText(pv)) : null,
        phase === "result" && t.answered ? h("div", { className:"adm-result " + (clean ? "ok" : "amber") }, tempResultLine(r)) : null,
        (phase === "result" || phase === "error") && t.error ? h("div", { className:"adm-banner alert" }, errorMessage(t.error, "temp")) : null,
        retrying ? main : null));
  }

  function CleanupTab({ model, setup, temp, tempRun, busy, setBusy, onRefresh, onTempReview, onTempRun, onTempCancel }){
    return h("div", { className:"adm-tab-body" },
      h(QueueSection, { model:model, setup:setup, onRefresh:onRefresh, setBusy:setBusy, busy:busy }),
      h(TempSection, { setup:setup, temp:temp, tempRun:tempRun, busy:busy,
        onReview:onTempReview, onRun:onTempRun, onCancel:onTempCancel }));
  }

  /* ── History tab ───────────────────────────────────────────────────────── */
  function runWhat(run){
    if(run.action === "drain-cleanup-queue") return run.admin_email === "cron" ? "Cleanup queue (scheduled)" : "Cleanup queue";
    if(run.action === TEMP_ACTION){             // no project: project_ids is empty
      return run.status === "previewed" || run.status === "expired" ? "Review of old temp files (not run)" : "Cleared old temp files";
    }
    const n = Array.isArray(run.project_ids) ? run.project_ids.length : 0;
    if(run.status === "previewed" || run.status === "expired") return "Review of " + plural(n, "deleted project") + " (not run)";
    return "Deleted files of " + plural(n, "deleted project");
  }
  function runResult(run){
    if(run.status === "previewed" || run.status === "expired") return plural(run.planned_files, "file") + " planned · " + fmtBytes(run.planned_bytes);
    if(run.action === "drain-cleanup-queue") return "Removed " + fmtCount(run.removed_files) + " · " + fmtBytes(run.removed_bytes);
    return fmtCount(run.removed_files) + " of " + fmtCount(run.planned_files) + " · " + fmtBytes(run.removed_bytes);
  }
  const OUTCOME_TABS = [["failed", "Failed"], ["skipped", "Skipped"], ["kept", "Kept"], ["removed", "Removed"]];
  function RunItems({ runId }){
    const [outcome, setOutcome] = React.useState("failed");
    const [items, setItems] = React.useState([]);
    const [counts, setCounts] = React.useState(null);
    const [next, setNext] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [err, setErr] = React.useState(null);
    const load = React.useCallback(async (cursor)=>{
      setLoading(true); setErr(null);
      const body = { action:"runs", runId:runId, outcome:outcome };
      if(cursor) body.cursor = cursor;
      const r = await callAdminStorage(body);
      if(r.ok){
        const got = Array.isArray(r.data.items) ? r.data.items : [];
        setItems((cur)=> cursor ? cur.concat(got) : got);
        setNext(r.data.nextCursor || null);
        setCounts(r.data.outcomes || {});
      } else setErr(r.error);
      setLoading(false);
    }, [runId, outcome]);
    React.useEffect(()=>{ load(null); }, [load]);
    return h("div", { className:"adm-run-items" },
      h(FilterChips, { value:outcome, onChange:setOutcome, label:"Outcome",
        options:OUTCOME_TABS.map(([k, t])=> [k, t + (counts ? " (" + fmtCount(counts[k] || 0) + ")" : "")]) }),
      err ? h("div", { className:"adm-banner alert" }, errorMessage(err)) : null,
      !err && !loading && !items.length ? h(Empty, { text:"Nothing " + outcome + "." }) : null,
      items.map((it)=> h("div", { key:it.path, className:"adm-file" },
        h("div", { className:"adm-file-path" }, h("span", { className:"adm-mono" }, it.path), h(CopyBtn, { text:it.path, label:"path" })),
        h("div", { className:"adm-file-l2" },
          h("span", null, it.detail || outcome), h("span", null, fmtBytes(it.bytes)),
          it.attempts ? h("span", null, plural(it.attempts, "attempt")) : null))),
      loading ? h("div", { className:"adm-muted adm-count" }, "Loading…") : null,
      next && !loading ? h("button", { type:"button", className:"adm-btn", onClick:()=> load(next) }, "Load more") : null);
  }
  function RunRow({ run, onResume, busy }){
    const [open, setOpen] = React.useState(false);
    const [confirming, setConfirming] = React.useState(false);      // Resume deletes: it asks first
    const st = runStatus(run);
    const n = resumeCount(run);
    const nProjects = Array.isArray(run.project_ids) ? run.project_ids.length : 0;
    const temp = run.action === TEMP_ACTION;
    return h("div", { className:"adm-run" + (open ? " open" : "") },
      h("div", { className:"adm-row adm-click", role:"button", tabIndex:0, "aria-expanded":open,
          onClick:()=> setOpen((o)=> !o), onKeyDown:rowKey(()=> setOpen((o)=> !o)) },
        h("span", { className:"c-date" }, fmtWhen(run.created_at)),
        h("span", { className:"c-owner" }, run.admin_email || "—"),
        h("span", { className:"c-title" }, runWhat(run)),
        h("span", { className:"adm-br" }),
        h("span", { className:"c-result" }, runResult(run)),
        h("span", { className:"c-state" }, chip(st)),
        h("span", { className:"c-act" }, canResume(run)
          ? h("button", { type:"button", className:"adm-btn danger sm", disabled:busy || confirming,
              onClick:(e)=>{ if(e && e.stopPropagation) e.stopPropagation(); if(!busy) setConfirming(true); } }, "Resume") : null)),
      confirming ? h("div", { className:"adm-confirm adm-run-confirm", role:"group", "aria-label":"Resume this delete" },
        h("p", null, (temp ? "Resume clearing up to " + plural(n, "old temp file")
            : "Resume deleting up to " + plural(n, "file") + " from " + plural(nProjects, "deleted project"))
          + "? Each file is checked again right before it is deleted, and deleted files can't be recovered."),
        h("div", { className:"adm-sheet-acts" },
          h("button", { type:"button", className:"adm-btn", onClick:()=> setConfirming(false) }, "Cancel"),
          h("button", { type:"button", className:"adm-btn danger", disabled:busy,
            onClick:()=>{ if(busy) return; setConfirming(false); onResume(run); } }, "Resume deleting"))) : null,
      open ? h("div", { className:"adm-run-body" },
        run.last_error ? h("div", { className:"adm-banner amber" }, run.last_error) : null,
        h(RunItems, { runId:run.id })) : null);
  }
  /* Newest first, 50 a page with Load more, so no run (and no Resume) falls off.
     Reviews that were never run are hidden unless asked for. */
  function HistoryTab({ reloadKey, onResume, busy }){
    const [runs, setRuns] = React.useState(null);
    const [next, setNext] = React.useState(null);
    const [err, setErr] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [scope, setScope] = React.useState("runs");
    const load = React.useCallback(async (cursor)=>{
      setLoading(true); setErr(null);
      const body = { action:"runs", limit:50, reviews:scope === "all" };
      if(cursor) body.cursor = cursor;
      const r = await callAdminStorage(body);
      if(r.ok){
        const got = Array.isArray(r.data.runs) ? r.data.runs : [];
        setRuns((cur)=> cursor && cur ? cur.concat(got) : got);
        setNext(r.data.nextCursor || null);
      } else setErr(r.error);
      setLoading(false);
    }, [scope]);
    React.useEffect(()=>{ load(null); }, [load, reloadKey]);
    return h("div", { className:"adm-tab-body" },
      h(FilterChips, { value:scope, onChange:setScope, label:"Which runs",
        options:[["runs", "Deletes & cleanups"], ["all", "Include reviews not run"]] }),
      err ? h("div", { className:"adm-banner alert" }, errorMessage(err),
        h("button", { type:"button", className:"adm-btn sm", onClick:()=> load(null) }, "Retry")) : null,
      loading && !runs ? h("div", { className:"adm-muted adm-count" }, "Loading history…") : null,
      runs && !runs.length ? h(Empty, { text:MSG.noRuns }) : null,
      runs && runs.length ? h("div", { className:"adm-rows adm-hist" },
        headRow([["date", "When"], ["owner", "By"], ["title", "What"], ["result", "Result"], ["state", "Status"], ["act", ""]]),
        runs.map((run)=> h(RunRow, { key:run.id, run:run, onResume:onResume, busy:busy }))) : null,
      next && !loading ? h("button", { type:"button", className:"adm-btn", onClick:()=> load(next) }, "Load more") : null);
  }

  /* ── the modal ─────────────────────────────────────────────────────────── */
  function AdminStorageModal({ onClose }){
    const [ov, setOv] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [err, setErr] = React.useState(null);
    const [tab, setTab] = React.useState("accounts");
    const [query, setQuery] = React.useState("");
    const [note, setNote] = React.useState("");
    const [expanded, setExpanded] = React.useState(null);
    const [acctFilter, setAcctFilter] = React.useState("all");
    const [detailId, setDetailId] = React.useState(null);
    const [sheet, setSheet] = React.useState(null);
    const [busy, setBusy] = React.useState(false);
    const [historyKey, setHistoryKey] = React.useState(0);
    const [tempRun, setTempRun] = React.useState(null);      // the Cleanup tab's temp-file clear (2026-09-28)
    const closeRef = React.useRef(null);
    const modalRef = React.useRef(null);
    const sheetRef = React.useRef(null);
    const busyRef = React.useRef(false);
    const reviewSeq = React.useRef(0);          // a late preview never reopens a closed / newer sheet
    const tempSeq = React.useRef(0);            // …nor a cancelled temp-file review
    busyRef.current = busy;
    const stateRef = React.useRef({});
    stateRef.current = { sheet:sheet, detailId:detailId };

    const load = React.useCallback(async ()=>{
      setLoading(true); setErr(null);
      const r = await callAdminStorage({ action:"overview" });
      if(r.ok) setOv(r.data); else setErr(r.error);
      setLoading(false);
    }, []);
    React.useEffect(()=>{ load(); }, [load]);
    React.useEffect(()=>{ try{ if(closeRef.current && closeRef.current.focus) closeRef.current.focus(); }catch(e){} }, []);
    React.useEffect(()=>{
      if(typeof document === "undefined" || !document.addEventListener) return undefined;
      const onKey = (e)=>{
        if(e.key !== "Escape" || busyRef.current) return;
        const s = stateRef.current;
        if(s.sheet){ reviewSeq.current++; setSheet(null); }
        else if(s.detailId) setDetailId(null);
        else onClose();
      };
      document.addEventListener("keydown", onKey);
      return ()=> document.removeEventListener("keydown", onKey);
    }, [onClose]);
    // The session can end while the page is open (a sign-out in another tab, a
    // failed token refresh, another user signing in): every account's data must
    // leave the screen then, not on the next click. app.jsx drops
    // window.turnIsAdmin; re-read it every second and listen for sign-out.
    React.useEffect(()=>{
      const t = setInterval(()=>{ if(!window.turnIsAdmin) onClose(); }, 1000);
      let sub = null;
      try{
        const sb = typeof window.sbClient === "function" ? window.sbClient() : null;
        if(sb && sb.auth && typeof sb.auth.onAuthStateChange === "function"){
          const r = sb.auth.onAuthStateChange((event, session)=>{ if(event === "SIGNED_OUT" || !session) onClose(); });
          sub = r && r.data ? r.data.subscription : null;
        }
      }catch(e){}
      return ()=>{ clearInterval(t); try{ if(sub && sub.unsubscribe) sub.unsubscribe(); }catch(e){} };
    }, [onClose]);

    const model = React.useMemo(()=> ov ? buildModel(ov) : null, [ov]);
    const setup = ov && ov.setup ? ov.setup : null;
    const hasQueue = !!(model && model.queue);
    const hasAudit = !!(setup && setup.setup && setup.setup.audit);
    const hasCleanup = hasQueue || hasAudit;         // the queue, or the audit log that temp clearing writes to
    const curTab = (tab === "cleanup" && !hasCleanup) || (tab === "history" && !hasAudit) ? "accounts" : tab;

    React.useEffect(()=>{
      if(!expanded || typeof document === "undefined" || typeof document.getElementById !== "function") return;
      const el = document.getElementById("adm-acct-" + expanded);
      if(el && el.scrollIntoView) try{ el.scrollIntoView({ block:"nearest", behavior:"smooth" }); }catch(e){}
    }, [expanded]);

    const goAccount = (uid)=>{ setTab("accounts"); setAcctFilter("all"); setExpanded(uid); setDetailId(null); };
    const resolveRef = (ref)=>{
      if(!model) return;
      if(ref.pid){
        if(model.projectsById[ref.pid]){ setDetailId(ref.pid); setNote(""); return; }
        if(model.accountsById[ref.uid]){ goAccount(ref.uid); setNote("No project with that id in storage; showing its account."); return; }
        setNote(MSG.notFound); return;
      }
      if(model.accountsById[ref.uid]){ goAccount(ref.uid); setNote(""); return; }
      if(model.projectsById[ref.uid]){ setDetailId(ref.uid); setNote(""); return; }
      setNote(MSG.notFound);
    };
    const onSearch = (v)=>{
      setQuery(v);
      const ref = parseStorageRef(v);
      if(ref) resolveRef(ref); else setNote("");
    };
    const filterText = parseStorageRef(query) ? "" : query;

    /* review → delete */
    const openReview = async (ids)=>{
      const projectIds = [...new Set((ids || []).map(lc).filter(Boolean))].slice(0, MAX_REVIEW);
      if(!projectIds.length || busyRef.current) return;
      const seq = ++reviewSeq.current;
      setSheet({ kind:"review", projectIds:projectIds, phase:"loading" });
      const r = await callAdminStorage({ action:"preview-delete", projectIds:projectIds });
      if(seq !== reviewSeq.current) return;
      if(r.ok) setSheet({ kind:"review", projectIds:projectIds, phase:"ready", preview:r.data, checked:false });
      else setSheet({ kind:"review", projectIds:projectIds, phase:"error", error:r.error });
    };
    /* the sheet's run: a project delete, or a temp-file run resumed from
       History (base.action "clear-temp"); Retry keeps the sheet's action */
    const runDelete = async (runId, planned, base)=>{
      reviewSeq.current++;
      busyRef.current = true;
      setBusy(true);
      const action = (base && base.action) || "delete";
      setSheet((s)=> Object.assign({}, base || s, { phase:"running", action:action, runId:runId, planned:planned, error:null,
        progress:{ planned:planned, removed:0, removedBytes:0 } }));
      const out = await loopRun(action, runId, planned,
        (p)=> setSheet((s)=> s && Object.assign({}, s, { planned:p.planned, progress:p })));
      setBusy(false);
      const result = out.result, error = out.error;
      setSheet((s)=> s && Object.assign({}, s, { phase:"result", result:result, error:error, answered:out.answered }));
      if(result.status === "done") toast("Deleted " + plural(result.removed, "file") + " · " + fmtBytes(result.removedBytes) + " freed.", "success");
      else toast(error ? errorMessage(error, action === "clear-temp" ? "temp" : undefined)
        : "Deleted " + fmtCount(result.removed) + " of " + fmtCount(result.planned) + ".", "error");
      setHistoryKey((k)=> k + 1);
      load();
    };
    const startDelete = ()=>{
      if(!sheet || !sheet.preview || !sheet.checked) return;
      runDelete(sheet.preview.runId, num(sheet.preview.total && sheet.preview.total.files), sheet);
    };
    const retry = ()=>{ if(sheet && sheet.runId) runDelete(sheet.runId, num(sheet.planned), sheet); };
    const resume = (run)=>{
      if(!run || !run.id || busyRef.current) return;
      if(run.action === TEMP_ACTION) runDelete(run.id, num(run.planned_files), { kind:"run", action:"clear-temp", projectIds:[] });
      else runDelete(run.id, num(run.planned_files), { kind:"run", projectIds:(run.project_ids || []).map(lc) });
    };
    const closeSheet = ()=>{ if(!busyRef.current){ reviewSeq.current++; setSheet(null); } };

    /* clear old temp files (2026-09-28): review → confirm → the run loop */
    const openTempReview = async ()=>{
      if(busyRef.current) return;
      const seq = ++tempSeq.current;
      setTempRun({ phase:"loading" });
      const r = await callAdminStorage({ action:"preview-clear-temp" });
      if(seq !== tempSeq.current) return;
      if(!r.ok) setTempRun({ phase:"error", error:r.error });
      else setTempRun({ phase:num(r.data.plannedFiles) > 0 ? "confirm" : "empty", preview:r.data });
    };
    const cancelTemp = ()=>{ if(!busyRef.current){ tempSeq.current++; setTempRun(null); } };
    const runTempClear = async (pv)=>{
      if(!pv || !pv.runId || busyRef.current) return;
      tempSeq.current++;
      busyRef.current = true;
      setBusy(true);
      const planned = num(pv.plannedFiles);
      setTempRun({ phase:"running", preview:pv, progress:{ planned:planned, removed:0, removedBytes:0 } });
      const out = await loopRun("clear-temp", pv.runId, planned,
        (p)=> setTempRun((t)=> t && t.phase === "running" ? Object.assign({}, t, { progress:p }) : t));
      setBusy(false);
      const r = out.result;
      setTempRun({ phase:"result", preview:pv, result:r, answered:out.answered, error:out.error });
      if(r.status === "done" && !out.error) toast("Cleared " + plural(r.removed, "old temp file") + " · " + fmtBytes(num(r.removedBytes)) + " freed.", "success");
      else toast(out.error ? errorMessage(out.error, "temp") : "Removed " + fmtCount(r.removed) + " of " + plural(r.planned, "old temp file") + ".", "error");
      setHistoryKey((k)=> k + 1);
      load();
    };

    const admin = !!window.turnIsAdmin;
    React.useEffect(()=>{ if(!admin) onClose(); }, [admin, onClose]);
    if(!admin) return null;
    const detail = detailId && model ? model.projectsById[detailId] : null;
    const sub = loading ? (ov ? "admin · refreshing…" : "admin · reading…")
      : ov ? "admin · as of " + fmtClock(ov.asOf) + " · " + fmtMs(ov.elapsedMs) : "admin";
    const fatal = err && !ov;
    const tabs = [["accounts", "Accounts"], ["projects", "Projects"]]
      .concat(hasCleanup ? [["cleanup", "Cleanup"]] : [])
      .concat(hasAudit ? [["history", "History"]] : []);

    return h("div", { className:"bible-overlay adm-overlay",
        onMouseDown:(e)=>{ if(e.target === e.currentTarget && !busyRef.current) onClose(); } },
      h("div", { className:"bible-modal adm-storage" + (detail ? " has-detail" : ""), role:"dialog", "aria-modal":"true", "aria-labelledby":"adm-title",
          ref:modalRef,
          // Tab stays inside the review sheet while it is open, else inside the page
          onKeyDown:(e)=>{ trapTab(e, (stateRef.current.sheet && sheetRef.current) || modalRef.current, typeof document !== "undefined" ? document : null); } },
        h("div", { className:"bible-head adm-head" },
          h("div", { className:"bible-title" }, icon("box", 15),
            h("span", { id:"adm-title" }, "Storage"),
            h("span", { className:"bible-sub adm-sub" }, sub)),
          h("div", { className:"bible-head-acts" },
            h("button", { type:"button", className:"bible-btn", disabled:loading || busy, onClick:load }, loading ? "Reading…" : "Refresh"),
            h("button", { type:"button", className:"bible-x", ref:closeRef, "aria-label":"Close", disabled:busy,
              onClick:()=>{ if(!busyRef.current) onClose(); } }, icon("x", 15)))),
        h("div", { className:"adm-body" },
          fatal ? h("div", { className:"adm-error", role:"alert" },
            h("div", { className:"adm-error-msg" }, errorMessage(err)),
            h("button", { type:"button", className:"adm-btn", onClick:load }, (err.status === 503 || err.code === "db_unreachable") ? "Retry" : "Refresh"))
          : h(React.Fragment, null,
              err ? h("div", { className:"adm-banner alert" }, errorMessage(err)) : null,
              h(SetupStrip, { setup:setup }),
              h(Tiles, { model:model, temp:ov && ov.temp }),
              !model ? h("div", { className:"adm-muted adm-loading" }, MSG.loading) : h(React.Fragment, null,
                h("div", { className:"adm-search" }, icon("search", 13),
                  h("input", { type:"search", value:query, placeholder:"Email, title, or paste a Storage path / folder / UUID",
                    "aria-label":"Search storage", onChange:(e)=> onSearch(e.target.value),
                    onKeyDown:(e)=>{ if(e.key === "Enter"){ const ref = parseStorageRef(query); if(ref) resolveRef(ref); } } })),
                note ? h("div", { className:"adm-note", role:"status" }, note) : null,
                // flex-shrink 0 (2026-09-28 review): on phones the strip scrolls sideways
                // (overflow-x:auto → min-height 0), so a tall tab squeezed it to a sliver
                h("div", { className:"adm-tabs", role:"tablist", style:{ flexShrink:0 } },
                  tabs.map(([k, t])=> h("button", { key:k, type:"button", role:"tab", "aria-selected":curTab === k,
                    className:"adm-tab" + (curTab === k ? " on" : ""), onClick:()=> setTab(k) }, t))),
                curTab === "accounts" ? h(AccountsTab, { model:model, setup:setup, temp:ov && ov.temp, filterText:filterText, expanded:expanded,
                    filter:acctFilter, setFilter:setAcctFilter,
                    onToggle:(id)=> setExpanded((cur)=> cur === id ? null : id), onOpenProject:setDetailId, onReview:openReview })
                : curTab === "projects" ? h(ProjectsTab, { model:model, setup:setup, filterText:filterText,
                    onOpenProject:setDetailId, onReview:openReview })
                : curTab === "cleanup" ? h(CleanupTab, { model:model, setup:setup, temp:ov && ov.temp, tempRun:tempRun, busy:busy,
                    setBusy:setBusy, onRefresh:()=>{ load(); setHistoryKey((k)=> k + 1); },
                    onTempReview:openTempReview, onTempRun:runTempClear, onTempCancel:cancelTemp })
                : h(HistoryTab, { reloadKey:historyKey, onResume:resume, busy:busy })))),
        detail ? h(ProjectDetail, { key:detail.id, project:detail, model:model, setup:setup, asOf:ov && ov.asOf,
          onClose:()=> setDetailId(null), onReview:openReview }) : null,
        sheet ? h(ReviewSheet, { sheet:sheet, model:model, boxRef:sheetRef,
          onCheck:(v)=> setSheet((s)=> s && Object.assign({}, s, { checked:v })),
          onDelete:startDelete, onRetry:retry,
          onReviewAgain:()=> openReview(sheet.projectIds), onClose:closeSheet }) : null));
  }

  /* SELF-MOUNTING opener (plans.jsx pattern): the account chip calls
     window.turnOpenAdminStorage(). Admin only; one instance at a time. */
  let _root = null, _el = null;
  const bodyClass = (on)=>{      // body.adm-open hides the admin price-drift card (styles.css), which sits above this page
    try{ const cl = document.body && document.body.classList; if(cl) cl.toggle("adm-open", !!on); }catch(e){}
  };
  function openAdminStorage(){
    if(!window.turnIsAdmin) return false;
    if(_el) return false;                                   // already open
    if(typeof document === "undefined" || !window.ReactDOM) return false;
    const el = document.createElement("div");
    el.className = "adm-root";
    document.body.appendChild(el);
    const root = window.ReactDOM.createRoot(el);
    _el = el; _root = root;
    bodyClass(true);
    let closed = false;
    const close = ()=>{                                     // this instance only; safe to call twice
      if(closed) return;
      closed = true;
      try{ root.unmount(); }catch(e){}
      if(el.parentNode) el.parentNode.removeChild(el);
      if(_el === el){ _root = null; _el = null; bodyClass(false); }
    };
    root.render(h(AdminStorageModal, { onClose:close }));
    return true;
  }
  window.turnOpenAdminStorage = openAdminStorage;
  window.AdminStorageModal = AdminStorageModal;
  window.AdminStorageLib = {
    fmtBytes, fmtCount, fmtAgo, shortId, statusChip, parseStorageRef, buildModel, keptLines, errorMessage,
    runStatus, canResume, leftLine, projectLabel, kindLabel, callAdminStorage, MSG, rowKey, trapTab, resumeCount,
    loopRun, runWhat, runResult, tempBlockReason, tempStatsLine, tempKeptLine, tempConfirmText, tempEmptyText, tempResultLine,
    tempCanRetry, serviceNote,
  };
})();
