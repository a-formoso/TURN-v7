/* floor-plan-drag-ui.jsx — THE FLOOR PLAN, CHANGED BY HAND: what is on the page (owner 2026-11-25, step 1: "yes, start
   with the first step": a piece of furniture, a door or a window is dragged on the location card's floor plan).
   The rules are in floor-plan-drag.js (KinolotPlanDrag); this file holds the edit while it is made, draws what can be
   dragged over the plan, and saves it.

   - usePlanEdit(place, onUpdate, readOnly): the edit. Nothing is saved until Save. Save confirms the plan exactly as
     Floor plan's own Confirm does (the same checks, the same record), so a plan that was confirmed stays confirmed;
     a plan that cannot be confirmed with the change is not saved, and says why. Undo steps back one drag; Cancel
     drops everything.
   - PlanEditLayer: inside the plan's own picture. Each object is its outline with a handle, each door and window a
     bar on its wall. A finger, a mouse, or the arrow keys (5 cm a press).
   - PlanEditBar: the buttons and the one line of help, under the plan.
   - PlanWhere: in The place, where every door, window and object stands NOW, written from the plan's numbers, so the
     description follows the floor plan the moment it is saved ("ensure The Place description updates also
     dynamically, as a consequence of the floor changes"). */
const FPD_E = React.createElement;

function usePlanEdit(place, onUpdate, readOnly){
  const D = window.KinolotPlanDrag;
  const [edit, setEdit] = React.useState(null);            // {plan, base, undo:[plans], sel}
  const [error, setError] = React.useState(""), [note, setNote] = React.useState("");
  const placeId = place && place.id;
  React.useEffect(()=>{ setEdit(null); setError(""); setNote(""); },[placeId]);
  let st = null; try{ st = typeof locationSpatialPlanState==="function" ? locationSpatialPlanState(place) : null; }catch(_){ st = null; }
  const writable = ()=> !readOnly && typeof onUpdate==="function" && (typeof window.turnArtRoomWritable!=="function" || window.turnArtRoomWritable());
  const able = !!D && !!st && !!st.ready && writable();
  const change = fn=>setEdit(e=>{ if(!e) return e; const next = fn(e.plan); return next===e.plan ? e : { ...e, plan:next }; });
  const save = ()=>{
    if(!edit) return;
    try{
      if(!writable()) throw new Error("This film is read-only. Nothing was saved.");
      // the change as a confirmed plan, checked as Floor plan's own Confirm checks it (floor-plan-drag.js commit)
      const c = D.commit(place, edit.base, edit.plan, ((window.turnContinuity||{}).locations)||[]);
      if(!c.ok) throw new Error(c.error);
      if(c.same){ setEdit(null); setError(""); return; }
      onUpdate(c.ownerId, { spatialPlan:c.plan }, { kind:"floor-plan-edit" });
      // a scene's marks that stand beside what moved follow it (free; the scene plan's own cameras are checked when drawn)
      let followed = 0;
      try{ if(typeof window.turnFloorPlanMoved==="function") followed = Number(window.turnFloorPlanMoved(c.spaces, c.moved)) || 0; }catch(_){ followed = 0; }
      setEdit(null); setError("");
      setNote("Saved. The set, its four views and every shot\u2019s drawing follow the new floor plan."
        +(followed ? " "+followed+(followed===1 ? " mark of a planned scene moved with it." : " marks of planned scenes moved with it.") : "")
        +" The location image was made before this change: make it again when the set looks right.");
    }catch(e){ setError((e && e.message) || "The floor plan could not be saved. Nothing was changed."); }
  };
  if(!edit) return { able, on:false, note, error:"", start:()=>{ if(!able) return; setError(""); setNote(""); setEdit({ plan:st.plan, base:st.plan, undo:[], sel:"" }); } };
  return { able:true, on:true, plan:edit.plan, sel:edit.sel, error, note:"",
    changed:D.moves(edit.base, edit.plan).length, canUndo:edit.undo.length>0,
    select:id=>setEdit(e=>e ? { ...e, sel:id } : e),
    // a drag begins (one Undo step) and ends (a step that moved nothing is dropped)
    begin:()=>setEdit(e=>e ? { ...e, undo:e.undo.concat([e.plan]).slice(-40) } : e),
    end:()=>setEdit(e=>e && e.undo.length && e.undo[e.undo.length-1]===e.plan ? { ...e, undo:e.undo.slice(0,-1) } : e),
    moveObject:(id, xy)=>change(p=>D.moveObject(p, id, xy)),
    moveOpening:(spaceId, id, xy)=>change(p=>D.moveOpening(p, spaceId, id, xy)),
    undo:()=>setEdit(e=>e && e.undo.length ? { ...e, plan:e.undo[e.undo.length-1], undo:e.undo.slice(0,-1) } : e),
    cancel:()=>{ setEdit(null); setError(""); },
    save };
}

/* WHAT CAN BE DRAGGED, OVER THE PLAN. model = the plan's picture (KinolotSetCard.planModel), metres(event) = where the
   pointer is on the floor plan. Drawn inside the plan's own svg. */
const DRAG_START = 5;
function PlanEditLayer({ model, edit, metres }){
  const D = window.KinolotPlanDrag, K = window.KinolotSetCard, drag = React.useRef(null);
  if(!D || !K || !edit || !edit.on || !model) return null;
  const px = p=>K.planPx(model, p);
  const seen = [];
  const doors = D.openings(edit.plan).filter(o=>{ const twin = seen.some(c=>Math.hypot(c[0]-o.centre[0], c[1]-o.centre[1])<0.2); seen.push(o.centre); return !twin; });
  // (the biggest first, so a small thing that stands on a big one is on top and is the one a press takes)
  const things = D.objects(edit.plan).filter(o=>!o.door).sort((a,b)=>b.size[0]*b.size[1]-a.size[0]*a.size[1]);
  const inPic = q=>q[0]>=-20 && q[0]<=model.W+20 && q[1]>=-20 && q[1]<=model.H+20;
  const outline = o=>{ const t = -o.facing*Math.PI/180, c = Math.cos(t), s = Math.sin(t), w = o.size[0]/2, d = o.size[1]/2;
    return [[-w,-d],[w,-d],[w,d],[-w,d]].map(q=>px([o.xy[0]+q[0]*c-q[1]*s, o.xy[1]+q[0]*s+q[1]*c])); };
  const pts = a=>a.map(q=>q[0]+","+q[1]).join(" ");
  const to = (g, m)=>[m[0]+g.off[0], m[1]+g.off[1]];
  const go = (g, at)=>{ if(g.kind==="object") edit.moveObject(g.id, at); else edit.moveOpening(g.spaceId, g.id, at); };
  const handlers = (kind, item, at)=>({
    onPointerDown:e=>{ const m = metres(e); if(!m) return; edit.begin(); edit.select(item.id);
      drag.current = { kind, id:item.id, spaceId:item.spaceId, off:[at[0]-m[0], at[1]-m[1]], down:[e.clientX, e.clientY], live:false };
      try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){} e.preventDefault(); e.stopPropagation(); },
    /* A PRESS IS NOT A DRAG: nothing moves until the pointer has travelled DRAG_START px from where it went down
       (found on the first real save, 2026-11-25: a plain click with a shaky hand moved a shelf by one step). */
    onPointerMove:e=>{ const g = drag.current; if(!g || g.id!==item.id) return;
      if(!g.live){ if(Math.hypot(e.clientX-g.down[0], e.clientY-g.down[1])<DRAG_START) return; g.live = true; }
      const m = metres(e); if(m) go(g, to(g, m)); },
    onPointerUp:()=>{ if(drag.current && drag.current.id===item.id){ drag.current = null; edit.end(); } },
    onPointerCancel:()=>{ if(drag.current && drag.current.id===item.id){ drag.current = null; edit.end(); } },
    onKeyDown:e=>{ const d = { ArrowLeft:[-D.SNAP,0], ArrowRight:[D.SNAP,0], ArrowUp:[0,D.SNAP], ArrowDown:[0,-D.SNAP] }[e.key]; if(!d) return;
      e.preventDefault(); edit.begin(); edit.select(item.id); go({ kind, id:item.id, spaceId:item.spaceId }, [at[0]+d[0], at[1]+d[1]]); edit.end(); } });
  const label = (name, q)=>FPD_E("text",{ className:"lsc-edit-name", x:Math.max(46, Math.min(model.W-46, q[0])), y:Math.max(12, q[1]-13), textAnchor:"middle" }, name.length>26 ? name.slice(0,25)+"…" : name);
  return FPD_E("g",{ className:"lsc-edit", "data-testid":"plan-edit-layer" },
    doors.map(o=>{ const L = Math.hypot(o.run.b[0]-o.run.a[0], o.run.b[1]-o.run.a[1]) || 1, u = [(o.run.b[0]-o.run.a[0])/L, (o.run.b[1]-o.run.a[1])/L];
      const a = px([o.centre[0]-u[0]*o.width/2, o.centre[1]-u[1]*o.width/2]), b = px([o.centre[0]+u[0]*o.width/2, o.centre[1]+u[1]*o.width/2]), c = px(o.centre), on = edit.sel===o.id;
      if(!inPic(c)) return null;
      return FPD_E("g",{ key:"o"+o.spaceId+o.id, className:"lsc-edit-open"+(on?" on":""), tabIndex:0, role:"slider", "data-edit":o.id,
          "aria-label":o.name+". Drag it along its wall, or use the arrow keys to move it 5 centimetres.", ...handlers("opening", o, o.centre) },
        FPD_E("title",null,o.name),
        FPD_E("line",{ x1:a[0], y1:a[1], x2:b[0], y2:b[1], className:"lsc-edit-open-bar" }),
        FPD_E("circle",{ cx:c[0], cy:c[1], r:13, className:"lsc-edit-hit" }),
        FPD_E("circle",{ cx:c[0], cy:c[1], r:4.5, className:"lsc-edit-dot" }),
        on && label(o.name, c)); }),
    things.map(o=>{ const c = px(o.xy), on = edit.sel===o.id; if(!inPic(c)) return null;
      return FPD_E("g",{ key:"t"+o.id, className:"lsc-edit-obj"+(on?" on":""), tabIndex:0, role:"slider", "data-edit":o.id,
          "aria-label":o.name+". Drag it, or use the arrow keys to move it 5 centimetres.", ...handlers("object", o, o.xy) },
        FPD_E("title",null,o.name),
        FPD_E("polygon",{ points:pts(outline(o)), className:"lsc-edit-shape" }),
        FPD_E("circle",{ cx:c[0], cy:c[1], r:13, className:"lsc-edit-hit" }),
        FPD_E("circle",{ cx:c[0], cy:c[1], r:3.5, className:"lsc-edit-dot" }),
        on && label(o.name, c)); }));
}

/* THE BUTTONS, UNDER THE PLAN. Not editing: "Move things on the plan" (only on a confirmed plan the user may change)
   and what the last save did. Editing: one line of help, then Undo, Cancel, Save. */
function PlanEditBar({ edit }){
  if(!edit || (!edit.able && !edit.note)) return null;
  if(!edit.on) return FPD_E("div",{ className:"lsc-edit-bar", "data-testid":"plan-edit-bar" },
    edit.able && FPD_E("button",{ type:"button", className:"lsc-ghost", "data-testid":"plan-edit-start", onClick:edit.start,
      title:"Drag a piece of furniture, a door or a window to where it should be. Nothing is saved until you press Save." },"Move things on the plan"),
    edit.note && FPD_E("p",{ className:"lsc-mono dim", role:"status", "data-testid":"plan-edit-note" }, edit.note));
  const D = window.KinolotPlanDrag, sel = edit.sel ? D.where(edit.plan).find(x=>x.id===edit.sel) : null;
  return FPD_E("div",{ className:"lsc-edit-bar on", "data-testid":"plan-edit-bar" },
    FPD_E("p",{ className:"lsc-mono", "data-testid":"plan-edit-help" },
      sel ? sel.name+": "+sel.text.charAt(0).toLowerCase()+sel.text.slice(1)
        : "Drag a piece of furniture anywhere in its room, or a door or window along its wall. Nothing is saved until you press Save."),
    edit.error && FPD_E("p",{ className:"loc-spatial-error", role:"alert", "data-testid":"plan-edit-error" }, edit.error),
    FPD_E("div",{ className:"lsc-row" },
      FPD_E("button",{ type:"button", className:"lsc-ghost", disabled:!edit.canUndo, "data-testid":"plan-edit-undo", onClick:edit.undo, title:"Take back the last move" },"Undo"),
      FPD_E("button",{ type:"button", className:"lsc-ghost", "data-testid":"plan-edit-cancel", onClick:edit.cancel, title:"Leave the floor plan as it was" },"Cancel"),
      FPD_E("button",{ type:"button", className:"lsc-primary lsc-edit-save", disabled:!edit.changed, "data-testid":"plan-edit-save", onClick:edit.save,
        title:"Save the floor plan with these moves. The set is drawn again from it; the location image is not changed." },
        "Save")));
}

/* WHERE THINGS STAND NOW, IN THE PLACE (the card's description follows the floor plan): every door, window and
   object of this card's space, each with a sentence written from the plan's numbers. A room's card lists its own. */
function PlanWhere({ l }){
  const D = window.KinolotPlanDrag; if(!D || !l) return null;
  let st = null; try{ st = typeof locationSpatialPlanState==="function" ? locationSpatialPlanState(l) : null; }catch(_){ st = null; }
  if(!st || !st.plan || !st.plan.coordinates) return null;
  const mine = st.owner && l.id!==st.owner.id, spaces = (st.plan.coordinates.spaces||[]), own = spaces.find(s=>s.id===l.id);
  const all = D.where(st.plan), names = D.objects(st.plan), doors = D.openings(st.plan);
  const list = !mine ? all : all.filter(x=>x.kind==="object" ? (names.find(o=>o.id===x.id)||{}).spaceId===l.id : doors.some(o=>o.id===x.id && o.spaceId===l.id));
  if(!list.length) return null;
  const hand = list.filter(x=>x.byHand).length;
  return FPD_E("details",{ className:"loc-nested-section loc-where", "data-testid":"loc-where", open:hand>0 ? true : undefined },
    FPD_E("summary",null,"Where things stand · from the floor plan"+(hand ? " · "+hand+" placed by hand" : "")),
    hand>0 && FPD_E("p",{ className:"loc-layer-note", "data-testid":"loc-where-hand" },
      (hand===1 ? "One thing was" : hand+" things were")+" placed by hand on the floor plan. The set, the cameras and every shot’s drawing follow the floor plan: where the description below says otherwise, this list is right."),
    FPD_E("ul",{ className:"loc-where-list" }, list.map(x=>FPD_E("li",{ key:x.kind+x.id, className:x.byHand ? "hand" : undefined },
      FPD_E("b",null,x.name), FPD_E("span",null," "+x.text.charAt(0).toLowerCase()+x.text.slice(1))))));
}

Object.assign(window, { usePlanEdit, PlanEditLayer, PlanEditBar, PlanWhere });
