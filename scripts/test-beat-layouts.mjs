/* THE WHOLE BEAT, WITH EACH SHOT'S LAYOUT (owner 2026-11-24, the Previs look brief, step 6).
   "In the Stage's whole-beat clip, each shot of the beat is one timeline line: its seconds, its camera, what
   happens, who speaks. Each shot's clay drawing is attached as a layout reference, one per shot, in shot order,
   beside the shot's frame and the character and location references already sent. The prompt says, for each shot,
   which reference is its layout and which figure is which person."
   The words of the prompt are tested in test-stage-director-brief (the last block). Here: where the layout comes
   from, how it rides with the clip, and that nothing is saved, charged or changed by it. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const previsUi=read("app/shot-previs-ui.jsx"),stage=read("app/stage.jsx"),brief=read("app/stage-director-brief.js"),html=read("TURN.html"),ai=read("app/ai.jsx");
let pass=0,fail=0;
const test=(name,fn)=>{ try{ fn(); pass++; console.log("PASS "+name); }catch(e){ fail++; console.log("FAIL "+name+"\n    "+String(e&&e.message||e).split("\n")[0]); } };

test("1 a shot's layout: the shot as it starts, in clay, through the camera the plan holds, the room as the scene staged it", ()=>{
  const fn=previsUi.slice(previsUi.indexOf("async function shotPrevisLayout(sh, ctx, sceneShots, width){"),previsUi.indexOf("/* THE LOOK OF THE FRAME BEFORE, WITHOUT ITS LAYOUT"));
  assert.ok(fn.length>600);
  assert.ok(fn.includes("if(!sh || !sh.planned || !sh.startState || !SP || !SPv || !window.KinolotPrevis) return null;")&&fn.includes("if(!plan || !SP.exact(plan)) return null;"),"a shot with no scene plan has no layout");
  assert.ok(fn.includes("const cam = shotPrevisCamera(sh, plan);"),"the plan's camera for the shot: placed, or an angle set by hand");
  assert.ok(fn.includes('look:"clay"'),"clay: where things are, with no surface or colour of the set to copy");
  assert.ok(fn.includes("const st = shotPrevisStaged(sceneShots||[sh])[sh.id] || null;")&&fn.includes("...(st ? { startState:st.start, endState:st.end } : {})"),"the room as the whole scene staged once has it");
  assert.ok(fn.includes("url:res.start.dataUrl")&&fn.includes("legend:SPv.legend(res.people, res.things)"),"the start picture, and who each figure is");
  assert.ok(fn.includes('"stands "+shotPrevisNum(res.distance,1)+" m from what it frames", shotPrevisNum(pos[2],1)+" m high", shotPrevisNum(res.pose.lensMm)+" mm lens"'),"the camera in numbers");
  assert.ok(fn.includes('source:res.source||"", from:res.from||null'));
  // kept for the session by what it was drawn from; drawn in turn with the other drawings; nothing saved, no engine
  assert.ok(fn.includes("if(sig && SHOT_LAYOUT_KEPT.has(sig)) return SHOT_LAYOUT_KEPT.get(sig);")&&fn.includes("shotPrevisSig(sh, plan, cam, loc, ctx)")&&fn.includes("const turn = shotPrevisLine.then(run, run);"));
  assert.ok(!/nbCommit|setProject|claude\.complete|proxyGenerate|localStorage/.test(fn),"nothing is saved and no engine is called");
  assert.ok(previsUi.includes("shotPrevisForFrame, shotPrevisLayout,"),"the Stage can reach it");
});

test("2 the Stage draws a layout for each planned shot of the clip, when the clip is opened", ()=>{
  const at=stage.indexOf("const [layouts, setLayouts] = React.useState({});"), fn=stage.slice(at,stage.indexOf("const assets = React.useMemo(()=>{",at));
  assert.ok(at>0&&fn.length>500);
  assert.ok(fn.includes("const layoutShots = (d.shots||[]).filter(sh=>sh && sh.planned && sh.startState);"));
  assert.ok(fn.includes("for(const sh of layoutShots){")&&fn.includes("const L = await window.shotPrevisLayout(sh, ctx, sceneAll); if(L && L.url) got[sh.id] = L;"),"one shot after another, in shot order");
  assert.ok(fn.includes("}catch(e){}")&&fn.includes("if(!live) return;"),"a shot that cannot be drawn has no layout, and never stops the others or the clip");
  assert.ok(fn.includes('if(typeof window.shotPrevisLayout!=="function" || !layoutPlan || !layoutShots.length){ setLayouts({}); return; }'));
  // redrawn when the clip, the plan or a shot's camera changes (an angle set by hand, cameras placed again)
  assert.ok(fn.includes("[clip.id, (layoutPlan&&layoutPlan.at)||\"\", (layoutPlan&&layoutPlan.camerasAt)||\"\",")&&fn.includes("(layoutPlan.cameras||{})[window.ScenePlan.shotCameraKey(sh)]")&&fn.includes("},[layoutKey]);"));
  assert.ok(!/nbCommit|saveFilmStage|setProject|onUpdateShot/.test(fn),"nothing is saved to the film");
});

test("3 one layout a shot, in shot order, beside the frames and the other references; on where there is room", ()=>{
  const at=stage.indexOf("/* PREVIS LAYOUTS (owner 2026-11-24"), fn=stage.slice(at,stage.indexOf("// VIDEO ELEMENTS (2026-10-27)",at));
  assert.ok(at>0);
  assert.ok(fn.includes("if(_mRefs) (d.shots||[]).forEach((sh,i)=>{")&&fn.includes("const L=sh&&layouts[sh.id]; if(!L||!L.url) return;"),"the clip's shots in their order; only a model that takes references");
  assert.ok(fn.includes('key:"previs-layout:"+sh.id, kind:"image", group:"Layouts"')&&fn.includes("requiredByShots:[sh.id]"),"each belongs to its own shot");
  assert.ok(fn.includes("layoutLegend:L.legend||[], layoutCamera:L.camera||\"\", layoutLensMm:L.lensMm||0, layoutSource:L.source||\"\""));
  assert.ok(fn.includes('...(modelId!=="seedance-2.5"?{ sceneOnly:true }:{})'),"offered, switched off, on a model with fewer image places");
  assert.ok(!/\bid:/.test(fn),"it is not a saved image of the film: the drawing itself is what is sent");
  // after the shot frames and the boards, before characters, props and locations: beside the frames
  assert.ok(stage.indexOf('out.push({ key:i===0?"frame":("shotframe:"+sh.id), kind:"image",')<at&&at<stage.indexOf("// Active character/location/prop rows come exclusively from the authoritative"));
  assert.ok(stage.includes("}, [clip.id, activeShot.id, veTick, layoutSig,"),"the references are rebuilt when the layouts arrive");
  assert.ok(stage.includes(': String(a.key).indexOf("previs-layout:")===0 ? "Layouts"'),"their own group in the references");
  // the limits that were there are the limits that are there: a layout counts as one image like any other
  assert.ok(stage.includes('const imageLimit = modelId==="seedance-2.5" ? 30 : 9;')&&stage.includes("No references were omitted."));
});

test("4 what the video engine is told a layout is", ()=>{
  const at=stage.indexOf('if(k.indexOf("previs-layout:")===0){'), fn=stage.slice(at,stage.indexOf('if(k.indexOf("c:")===0) return T+',at));
  assert.ok(at>0);
  for(const t of ["is the layout of ","drawn in code from the set\\u2019s own 3D model through that shot\\u2019s camera, as the shot starts.",
    "each person is a jointed figure in one colour and each prop is a red shape of its true size: they only mark position and size.",
    "Match its camera position, height and lens framing, the screen direction, where each person stands and which way they face, and the relative size of people and things.",
    "never show the white set, the figures, the red shapes or the layout itself."]) assert.ok(fn.includes(t),t);
  // the brief: each shot's own line names its layout, its figures and its camera
  assert.ok(brief.includes('const layout=assets.find(a=>a&&a.kind==="image"&&a.key==="previs-layout:"+u.sh.id);'));
  assert.ok(brief.includes('"Layout: "+token(layout)+" is this shot as it starts."')&&brief.includes('"Camera in the set (as the layout was drawn): "+text(layout.layoutCamera)'));
  assert.ok(brief.indexOf('cameraShown?"Camera: "+cameraShown:"",')<brief.indexOf("        layoutCamera,\n        layoutLine,"),"after the shot's own camera line");
  assert.ok(!/claude|anthropic|gemini|gpt|three\.?js|\bTURN\b|\bMUSE\b|kinolot/i.test(fn+brief.slice(brief.indexOf("THE SHOT'S LAYOUT"),brief.indexOf("const timing=timedByShot.get(String(u.sh.id));\n      const window="))));
});

test("5 nothing about prices: no pricing or server file is part of this step; keys and Frances", ()=>{
  for(const f of ["app/stage.jsx","app/stage-director-brief.js","app/shot-previs-ui.jsx","app/ai.jsx"])
    assert.ok(["20261124-layout1", "20261124-beatcard1", "20261124-propmodel1", "20261124-propmodel2", "20261124-propmodel3", "20261124-framing1", "20261125-labels1", "20261125-setcard2", "20261125-setcard3", "20261125-engine1", "20261125-seat1", "20261125-seat2", "20261125-fold1", "20261125-fold2", "20261125-join1", "20261125-join2", "20261125-join3"].some(k=>html.includes(f+"?v="+k+'"')),f+" has a fresh key");
  const at=stage.indexOf("/* PREVIS LAYOUTS (owner 2026-11-24"), near=stage.slice(stage.indexOf("const [layouts, setLayouts]"),stage.indexOf("// VIDEO ELEMENTS (2026-10-27)",at));
  assert.ok(!/creditsPerSecond|usdPerSecond|turnCreditCost|stageHold|holdCredits/.test(near.slice(0,1800)),"the layouts touch no price");
  const g={APP_FEATURES:[]}; new Function("APP_FEATURES",ai.split("\n").filter(l=>l.startsWith('APP_FEATURES.push({ name:"Stage: each shot\'s layout on a clip"')).join("\n"))(g.APP_FEATURES);
  assert.equal(g.APP_FEATURES.length,1);
  const fact=g.APP_FEATURES[0].what;
  for(const t of ["a group named Layouts","draws that shot in clay, as it starts","placed, or an angle set by hand","one layout a shot, in shot order","each shot is one line of the timeline, with its seconds, its camera, what happens and who speaks",
    "says which figure is which person","a layout only marks position","never shows the white set, the figures or the red shapes","listed switched off","nothing is saved"]) assert.ok(fact.includes(t),t);
  assert.ok(!/credit|\$|claude|anthropic|fable|opus|gemini|gpt|seedance|kling|three\.?js|\bTURN\b|\bMUSE\b|kinolot/i.test(fact),"no price, no engine, no internal name");
});

console.log(pass+" passed, "+fail+" failed");
if(fail) process.exit(1);
