/* shots.jsx — The Art Room ▸ Shot List (data layer).
   A SHOT is the convergence unit of the whole pipeline: one beat → one shot.
   Each shot pulls together everything the Art Room built —
     • the scene's Style Bible GRADE (applied here, never on the location plate),
     • the LOCATION geometry/materials/light + its depth-grid framing,
     • the CHARACTER sheets in frame (consistency anchors),
     • the PROP sheets in frame,
     • cinematographer grammar (size · angle · movement · lens · composition)
   …into one composed image prompt + a set of reference images.

   Shots are GROUPED BY SCENE and ordered by their origin beat. The written shot
   spec is what the frame is generated from (spec-before-render, like the other tabs).
   Storyboard (next tab) lays these frames out in sequence. */

/* ---- cinematographer grammar -------------------------------------------------- */
const SHOT_SIZES = [
  { id:"EWS",   label:"EWS",   name:"Extreme Wide",   desc:"vast establishing scale; figures small in the frame" },
  { id:"WS",    label:"WS",    name:"Wide",           desc:"full environment with figures head-to-toe" },
  { id:"FS",    label:"FS",    name:"Full",           desc:"a figure head-to-toe, filling the height" },
  { id:"MWS",   label:"MWS",   name:"Medium Wide",    desc:"from roughly the knees up" },
  { id:"MS",    label:"MS",    name:"Medium",         desc:"from the waist up" },
  { id:"MCU",   label:"MCU",   name:"Medium Close",   desc:"from the chest up" },
  { id:"CU",    label:"CU",    name:"Close-Up",       desc:"the face fills the frame" },
  { id:"ECU",   label:"ECU",   name:"Extreme Close",  desc:"a single detail — eyes, hands, an object" },
  { id:"INSERT",label:"INSERT",name:"Insert",         desc:"a tight detail of an object or action" },
];
const SHOT_ANGLES = [
  { id:"eye",     label:"Eye level",  desc:"camera at the subject's eye height; neutral" },
  { id:"high",    label:"High angle", desc:"camera looks down on the subject; diminishing" },
  { id:"low",     label:"Low angle",  desc:"camera looks up at the subject; empowering" },
  { id:"top",     label:"Overhead",   desc:"top-down bird's-eye on the action" },
  { id:"dutch",   label:"Dutch tilt", desc:"canted horizon; unease/tension" },
  { id:"ots",     label:"OTS",        desc:"over-the-shoulder onto the other subject" },
  { id:"pov",     label:"POV",        desc:"the subject's own point of view" },
];
const SHOT_MOVES = [
  { id:"static",  label:"Static",       desc:"locked-off, no camera movement" },
  { id:"pan",     label:"Pan",          desc:"horizontal pivot" },
  { id:"tilt",    label:"Tilt",         desc:"vertical pivot" },
  { id:"push",    label:"Push in",      desc:"slow dolly toward the subject; intensifying" },
  { id:"pull",    label:"Pull out",     desc:"slow dolly away; revealing/isolating" },
  { id:"track",   label:"Tracking",     desc:"camera travels alongside the action" },
  { id:"handheld",label:"Handheld",     desc:"loose, reactive, kinetic" },
  { id:"crane",   label:"Crane",        desc:"sweeping vertical/arcing move" },
  { id:"steadi",  label:"Steadicam",    desc:"smooth following move" },
];
const SHOT_LENSES = [
  { id:"14",  label:"14mm", desc:"ultra-wide; deep space, distortion at edges" },
  { id:"24",  label:"24mm", desc:"wide; environmental context" },
  { id:"35",  label:"35mm", desc:"natural wide-normal; documentary feel" },
  { id:"50",  label:"50mm", desc:"normal; human-eye perspective" },
  { id:"85",  label:"85mm", desc:"short telephoto; flattering portrait compression" },
  { id:"135", label:"135mm",desc:"telephoto; strong compression, isolated subject" },
  { id:"200", label:"200mm",desc:"long telephoto; extreme compression, flattened planes, subject isolated from a soft distant background" },
  { id:"imax70", label:"70mm / IMAX", desc:"large-format capture; immense clarity and resolution, deep fine detail, sweeping epic grandeur" },
  { id:"vhs", label:"VHS / CCTV", desc:"lo-fi analog capture; soft low resolution, scanlines, chroma bleed, date-stamp surveillance aesthetic" },
];
function shotCameraProfileDesc(label, family){
  const low = String(label||"").toLowerCase();
  if(family==="ARRI"){
    if(low.includes("65") || low.includes("265")) return label+"-style large-format ARRI capture: expansive scale, premium colour depth, natural skin tone and gentle highlight roll-off";
    if(low.includes("lf")) return label+"-style large-format ARRI capture: smooth skin tone, graceful dynamic range, elegant depth and restrained digital sharpness";
    return label+"-style ARRI digital cinema capture: natural colour, generous dynamic range, clean shadow separation and gentle highlight roll-off";
  }
  if(family==="Canon"){
    if(low.includes("c70") || low.includes("r5") || low.includes("c400") || low.includes("c80") || low.includes("c50")) return label+"-style compact Canon cinema capture: natural warm colour, practical mobility, clean detail and balanced highlight handling";
    if(low.includes("ff") || low.includes("c500")) return label+"-style full-frame Canon cinema capture: warm natural skin tone, practical production polish and balanced highlight roll-off";
    return label+"-style Canon cinema capture: warm colour science, gentle contrast, clean production detail and reliable skin tone";
  }
  if(family==="Panasonic"){
    if(low.includes("varicam")) return label+"-style Panasonic VariCam capture: rich colour separation, practical low-light latitude and grounded digital cinema texture";
    if(low.includes("s1h") || low.includes("bs1h") || low.includes("bgh1")) return label+"-style Panasonic compact cinema capture: grounded indie-cinema image, soft colour roll-off and practical natural-light feel";
    return label+"-style Panasonic production capture: robust broadcast/cinema clarity, controlled colour and clean motion rendering";
  }
  if(family==="RED"){
    if(low.includes("monstro") || low.includes("vv")) return label+"-style RED VistaVision capture: high-resolution digital clarity, expansive frame, crisp texture and bold colour separation";
    if(low.includes("helium") || low.includes("dragon") || low.includes("gemini") || low.includes("s35") || low.includes("komodo")) return label+"-style RED Super 35 capture: crisp fine detail, punchy contrast, textured digital sharpness and compact production energy";
    return label+"-style RED cinema capture: high-resolution digital detail, strong texture definition and bold modern contrast";
  }
  if(family==="Panavision") return label+"-style large-format Panavision capture: expansive field, premium colour depth, smooth tonal scale and epic studio-cinema polish";
  if(family==="Sony"){
    if(low.includes("venice") || low.includes("burano")) return label+"-style Sony high-end cinema capture: polished modern image, clean low-light response, rich colour separation and controlled contrast";
    if(low.includes("fx") || low.includes("fr7") || low.includes("fs") || low.includes("f5") || low.includes("f55")) return label+"-style Sony compact cinema capture: flexible production mobility, clean low-light detail and modern neutral colour";
    return label+"-style Sony production capture: clean digital image, stable colour, strong low-light response and controlled contrast";
  }
  if(family==="Blackmagic"){
    if(low.includes("12k") || low.includes("17k")) return label+"-style Blackmagic high-resolution capture: textured digital cinema detail, strong latitude and tactile indie-production finish";
    return label+"-style Blackmagic cinema capture: practical production texture, crisp detail and flexible colour latitude";
  }
  if(family==="DJI") return label+"-style DJI aerial cinema capture: stabilized spatial movement, wide environmental perspective and polished drone-camera clarity";
  return label+"-style capture";
}
function shotCameraProfile(id, label, family, desc){
  return { id, label, family, desc: desc || shotCameraProfileDesc(label, family) };
}
const SHOT_CAMERA_PROFILES = [
  { id:"auto", label:"Project default / None", family:"Auto", desc:"do not add camera-body language; let the Style Preset and shot grammar lead" },
  shotCameraProfile("arri_alexa_lf", "ARRI Alexa LF", "ARRI"),
  shotCameraProfile("arri_minilf", "ARRI Alexa Mini LF", "ARRI"),
  shotCameraProfile("arri_alexa65", "ARRI Alexa 65", "ARRI"),
  shotCameraProfile("arri_alexa35", "ARRI Alexa 35", "ARRI"),
  shotCameraProfile("arri_alexa265", "ARRI ALEXA 265", "ARRI"),
  shotCameraProfile("arri_alexa35_xtreme", "ARRI ALEXA 35 Xtreme", "ARRI"),
  shotCameraProfile("canon_c300ii", "Canon C300 Mk II", "Canon"),
  shotCameraProfile("canon_c300iii", "Canon C300 Mk III", "Canon"),
  shotCameraProfile("canon_c500ii", "Canon C500 Mk II", "Canon"),
  shotCameraProfile("canon_c500", "Canon C500", "Canon"),
  shotCameraProfile("canon_c700", "Canon C700", "Canon"),
  shotCameraProfile("canon_c700ff", "Canon C700 FF", "Canon"),
  shotCameraProfile("canon_eos_c70", "Canon EOS C70", "Canon"),
  shotCameraProfile("canon_eos_r5c", "Canon EOS R5 C", "Canon"),
  shotCameraProfile("canon_c400", "Canon EOS C400", "Canon"),
  shotCameraProfile("canon_eos_c80", "Canon EOS C80", "Canon"),
  shotCameraProfile("canon_eos_c50", "Canon EOS C50", "Canon"),
  shotCameraProfile("panasonic_varicam35", "Panasonic VariCam 35", "Panasonic"),
  shotCameraProfile("panasonic_varicam_lt", "Panasonic VariCam LT", "Panasonic"),
  shotCameraProfile("panasonic_varicam_pure", "Panasonic VariCam Pure", "Panasonic"),
  shotCameraProfile("panasonic_au_eva1", "Panasonic AU-EVA1", "Panasonic"),
  shotCameraProfile("panasonic_s1h", "Panasonic S1H", "Panasonic"),
  shotCameraProfile("panasonic_bgh1", "Panasonic BGH1", "Panasonic"),
  shotCameraProfile("panasonic_bs1h", "Panasonic BS1H", "Panasonic"),
  shotCameraProfile("panasonic_ak_uc4000", "Panasonic AK-UC4000", "Panasonic"),
  shotCameraProfile("red_dsmc2_weapon_monstro", "RED DSMC2 / WEAPON MONSTRO 8K VV", "RED"),
  shotCameraProfile("red_weapon_dragon_8k_vv", "RED WEAPON DRAGON 8K VV", "RED"),
  shotCameraProfile("red_dsmc2_weapon_helium", "RED DSMC2 / WEAPON HELIUM 8K S35", "RED"),
  shotCameraProfile("red_epicw_helium", "RED EPIC-W HELIUM 8K S35", "RED"),
  shotCameraProfile("red_weapon_dragon_6k", "RED WEAPON DRAGON 6K S35", "RED"),
  shotCameraProfile("red_epic_dragon_6k", "RED EPIC DRAGON 6K S35", "RED"),
  shotCameraProfile("red_dsmc2_epicw_gemini", "RED DSMC2 / EPIC-W GEMINI 5K S35", "RED"),
  shotCameraProfile("red_scarletw_dragon", "RED SCARLET-W DRAGON 5K S35", "RED"),
  shotCameraProfile("red_raven", "RED RAVEN 4.5K", "RED"),
  shotCameraProfile("red_ranger_monstro", "RED RANGER MONSTRO 8K VV", "RED"),
  shotCameraProfile("red_ranger_helium", "RED RANGER HELIUM 8K S35", "RED"),
  shotCameraProfile("red_ranger_gemini", "RED RANGER GEMINI 5K S35", "RED"),
  shotCameraProfile("red_dsmc2_dragonx", "RED DSMC2 DRAGON-X 6K S35", "RED"),
  shotCameraProfile("red_komodo", "RED KOMODO 6K", "RED"),
  shotCameraProfile("red_vraptor", "RED V-RAPTOR 8K VV", "RED"),
  shotCameraProfile("red_vraptor_xl", "RED V-RAPTOR XL 8K VV", "RED"),
  shotCameraProfile("red_vraptor_s35", "RED V-RAPTOR 8K S35", "RED"),
  shotCameraProfile("red_vraptor_xl_s35", "RED V-RAPTOR XL 8K S35", "RED"),
  shotCameraProfile("red_komodox", "RED KOMODO-X 6K S35", "RED"),
  shotCameraProfile("red_vraptor_x", "RED V-RAPTOR [X] 8K VV", "RED"),
  shotCameraProfile("red_vraptor_xl_x", "RED V-RAPTOR XL [X] 8K VV", "RED"),
  shotCameraProfile("red_vraptor_xe", "RED V-RAPTOR XE 8K VV", "RED"),
  shotCameraProfile("panavision_dxl2", "Panavision DXL2", "Panavision"),
  shotCameraProfile("sony_venice", "Sony Venice", "Sony"),
  shotCameraProfile("sony_venice2_6k", "Sony Venice 2 6K", "Sony"),
  shotCameraProfile("sony_venice2", "Sony Venice 2 8K", "Sony"),
  shotCameraProfile("sony_burano", "Sony Burano", "Sony"),
  shotCameraProfile("sony_fx9", "Sony FX9", "Sony"),
  shotCameraProfile("sony_f55", "Sony F55", "Sony"),
  shotCameraProfile("sony_f65", "Sony F65", "Sony"),
  shotCameraProfile("sony_fs7", "Sony FS7 / FS7 II", "Sony"),
  shotCameraProfile("sony_f5", "Sony F5", "Sony"),
  shotCameraProfile("sony_fx6", "Sony FX6", "Sony"),
  shotCameraProfile("sony_fr7", "Sony FR7", "Sony"),
  shotCameraProfile("sony_pxw_z450", "Sony PXW-Z450", "Sony"),
  shotCameraProfile("sony_pxw_z750", "Sony PXW-Z750", "Sony"),
  shotCameraProfile("sony_fx3", "Sony FX3", "Sony"),
  shotCameraProfile("sony_hdc_f5500", "Sony HDC-F5500", "Sony"),
  shotCameraProfile("blackmagic_ursa_mini_46k", "Blackmagic Design URSA Mini 4.6K", "Blackmagic"),
  shotCameraProfile("blackmagic_ursa_mini_pro_46k", "Blackmagic Design URSA Mini Pro 4.6K", "Blackmagic"),
  shotCameraProfile("blackmagic_ursa_mini_pro_g2", "Blackmagic Design URSA Mini PRO 4.6K G2", "Blackmagic"),
  shotCameraProfile("blackmagic_ursa_mini_pro_12k_olpf", "Blackmagic Design URSA Mini PRO 12K OLPF", "Blackmagic"),
  shotCameraProfile("blackmagic_ursa_cine12k", "Blackmagic Design URSA Cine 12K LF", "Blackmagic"),
  shotCameraProfile("blackmagic_ursa_cine17k", "Blackmagic Design URSA Cine 17K 65", "Blackmagic"),
  shotCameraProfile("blackmagic_pyxis_12k", "Blackmagic Design PYXIS 12K", "Blackmagic"),
  shotCameraProfile("dji_inspire3_x9", "DJI Inspire 3 Zenmuse X9-8K Air", "DJI"),
  shotCameraProfile("cinema", "Generic cinema camera", "Generic", "high-end digital cinema capture with controlled dynamic range"),
  shotCameraProfile("film35", "35mm film camera", "Generic", "photochemical 35mm motion-picture capture with organic grain"),
  shotCameraProfile("largeformat", "Large-format camera", "Generic", "large-format clarity, scale and fine detail"),
  shotCameraProfile("macro", "Macro rig", "Generic", "specialized macro capture for tiny subjects and surface detail"),
  shotCameraProfile("handheld", "Handheld doc camera", "Generic", "reactive documentary camera feel"),
  shotCameraProfile("surveillance", "Surveillance / CCTV", "Generic", "fixed security-camera capture, compressed and observational"),
  shotCameraProfile("phone", "Phone camera", "Generic", "small-sensor mobile camera capture"),
  shotCameraProfile("drone", "Drone", "Generic", "aerial camera platform with floating spatial overview"),
];
const SHOT_CAMERA_BODIES = SHOT_CAMERA_PROFILES;
const SHOT_LENS_TYPES = [
  { id:"auto", label:"Auto", desc:"use the selected basic lens naturally" },
  { id:"spherical", label:"Spherical", desc:"clean spherical cinema lens, natural geometry" },
  { id:"anamorphic", label:"Anamorphic", desc:"wide cinematic lensing, oval bokeh and horizontal flares" },
  { id:"macro", label:"Macro", desc:"close-focus macro optics, extreme surface detail" },
  { id:"telephoto", label:"Telephoto", desc:"compressed planes and isolated subject" },
  { id:"wide", label:"Wide-angle", desc:"expanded space, near objects loom larger" },
  { id:"fisheye", label:"Fisheye", desc:"strong ultra-wide barrel distortion" },
  { id:"tiltshift", label:"Tilt-shift", desc:"selective plane of focus, miniature-like control" },
];
const SHOT_FOCAL_LENGTHS = [
  { id:"auto", label:"Auto", desc:"use the shot's Lens control" },
  { id:"14", label:"14mm", desc:"ultra-wide" },
  { id:"24", label:"24mm", desc:"wide environmental" },
  { id:"35", label:"35mm", desc:"natural wide-normal" },
  { id:"50", label:"50mm", desc:"normal perspective" },
  { id:"85", label:"85mm", desc:"portrait compression" },
  { id:"100macro", label:"100mm macro", desc:"macro close-up optics" },
  { id:"135", label:"135mm", desc:"telephoto compression" },
  { id:"200", label:"200mm", desc:"long telephoto" },
];
const SHOT_APERTURES = [
  { id:"auto", label:"Auto", desc:"infer depth of field from shot size" },
  { id:"f1_4", label:"f/1.4", desc:"very shallow depth of field, dreamy bokeh" },
  { id:"f2", label:"f/2", desc:"shallow cinematic focus" },
  { id:"f2_8", label:"f/2.8", desc:"controlled shallow focus" },
  { id:"f4", label:"f/4", desc:"balanced focus separation" },
  { id:"f5_6", label:"f/5.6", desc:"moderate depth" },
  { id:"f8", label:"f/8", desc:"deep focus" },
  { id:"f11", label:"f/11", desc:"very deep focus" },
];
const SHOT_SHUTTERS = [
  { id:"auto", label:"Auto", desc:"natural motion rendering" },
  { id:"crisp", label:"Crisp action", desc:"high shutter, minimal motion blur" },
  { id:"natural", label:"Natural blur", desc:"standard 180-degree shutter motion blur" },
  { id:"smeared", label:"Smeared motion", desc:"slow shutter, expressive motion smear" },
  { id:"staccato", label:"Staccato", desc:"choppy action, urgent shutter feel" },
];
const SHOT_ISO_GRAIN = [
  { id:"auto", label:"Auto", desc:"infer from the scene style" },
  { id:"clean", label:"Clean", desc:"low-noise, polished capture" },
  { id:"nightgrain", label:"Low-light grain", desc:"night exposure texture and sensor noise" },
  { id:"pushedfilm", label:"Pushed film grain", desc:"coarse pushed-stock grain and contrast" },
  { id:"noisy", label:"Noisy / degraded", desc:"visible noise, rough capture texture" },
];
window.SHOT_SIZES = SHOT_SIZES; window.SHOT_ANGLES = SHOT_ANGLES;
window.SHOT_MOVES = SHOT_MOVES; window.SHOT_LENSES = SHOT_LENSES;
window.SHOT_CAMERA_BODIES = SHOT_CAMERA_BODIES; window.SHOT_LENS_TYPES = SHOT_LENS_TYPES;
window.SHOT_FOCAL_LENGTHS = SHOT_FOCAL_LENGTHS; window.SHOT_APERTURES = SHOT_APERTURES;
window.SHOT_SHUTTERS = SHOT_SHUTTERS; window.SHOT_ISO_GRAIN = SHOT_ISO_GRAIN;

const sizeOf  = (id)=> SHOT_SIZES.find(x=>x.id===id)  || SHOT_SIZES[4];
const angleOf = (id)=> SHOT_ANGLES.find(x=>x.id===id) || SHOT_ANGLES[0];
const moveOf  = (id)=> SHOT_MOVES.find(x=>x.id===id)  || SHOT_MOVES[0];
// a lens set to any whole mm (the Blender preview writes e.g. "37") is that lens, not the 50mm fallback (2026-10-05)
const _mmLens = (id)=> /^\d{1,3}$/.test(String(id==null?"":id)) ? { id:String(id), label:String(id)+"mm", desc:"set in the Blender preview" } : null;
const lensOf  = (id)=> SHOT_LENSES.find(x=>x.id===id) || _mmLens(id) || SHOT_LENSES[3];
window.shotSizeOf = sizeOf; window.shotAngleOf = angleOf; window.shotMoveOf = moveOf; window.shotLensOf = lensOf;

function shotCameraSettingLabel(list, id){
  const hit = list.find(x=>x.id===id);
  if(hit) return hit.label;
  if(list===SHOT_FOCAL_LENGTHS && _mmLens(id)) return _mmLens(id).label;   // any whole mm, not "Auto"
  return list[0].label;
}
function shotCameraProfileOf(id){ return SHOT_CAMERA_PROFILES.find(x=>x.id===id) || SHOT_CAMERA_PROFILES[0]; }
function shotCameraProfilePrompt(id){
  const p = shotCameraProfileOf(id);
  if(!p || p.id==="auto") return "";
  return "Camera profile: "+p.label+". Interpretation: "+p.desc+". This is a capture-style hint only; do not override the Art Room Style Preset, palette, medium, character design or location design.";
}
function shotCameraSettingOf(list, id){
  return (list||[]).find(x=>x.id===id) || (list===SHOT_FOCAL_LENGTHS && _mmLens(id)) || ((list||[])[0]);
}
function shotCameraEffectiveChoice(sh, key, list, fallbackId, fallbackLabel){
  const c = (sh && sh.cameraSettings) || {};
  const selectedId = c[key] || "auto";
  const selected = shotCameraSettingOf(list, selectedId) || { id:"auto", label:"Auto" };
  const explicit = selectedId && selectedId!=="auto";
  const effectiveId = explicit ? selectedId : fallbackId;
  const effective = shotCameraSettingOf(list, effectiveId) || { id:effectiveId, label:fallbackLabel || effectiveId || "Auto" };
  return {
    key,
    selectedId,
    selectedLabel:selected.label || selectedId,
    effectiveId:effective.id || effectiveId || selectedId,
    // an EXPLICIT choice is what applies — the inferred label (from the Lens control) is only for Auto
    // (2026-10-05: an explicit 85mm on a 35mm lens used to read "35mm")
    effectiveLabel:(explicit ? (effective.label || effectiveId) : (fallbackLabel || effective.label || effectiveId)) || selected.label || selectedId,
    auto:!explicit,
  };
}
function shotInferLensType(sh){
  const lens = String((sh && sh.lens) || "");
  const size = String((sh && sh.size) || "");
  if(size==="INSERT" || size==="ECU" || lens==="100macro") return "macro";
  if(lens==="14" || lens==="24") return "wide";
  if(lens==="85" || lens==="135" || lens==="200") return "telephoto";
  return "spherical";
}
function shotInferFocalLength(sh){
  const lens = String((sh && sh.lens) || "50");
  if(SHOT_FOCAL_LENGTHS.some(x=>x.id===lens)) return { id:lens, label:shotCameraSettingLabel(SHOT_FOCAL_LENGTHS,lens) };
  const basic = lensOf(lens);
  return { id:lens || "50", label:(basic && basic.label) || "50mm" };
}
function shotInferAperture(sh){
  const size = String((sh && sh.size) || "MS");
  if(size==="EWS" || size==="WS") return "f8";
  if(size==="FS" || size==="MWS") return "f5_6";
  if(size==="CU" || size==="ECU" || size==="INSERT") return "f2_8";
  return "f4";
}
function shotInferShutter(sh){
  const move = String((sh && sh.move) || "");
  const text = ((sh && (sh.action+" "+sh.composition)) || "").toLowerCase();
  if(/\b(run|rush|fight|slam|jerk|snap|hit|lunge|crash|explode|impact)\b/.test(text)) return "crisp";
  if(move==="handheld" || move==="track" || move==="steadi") return "natural";
  return "natural";
}
function shotInferIsoGrain(sh){
  const text = ((sh && (sh.action+" "+sh.composition+" "+sh.locationName)) || "").toLowerCase();
  if(/\b(night|dark|shadow|rain|storm|alley|tunnel|canal|neon|sodium|low[- ]light)\b/.test(text)) return "nightgrain";
  if(/\b(cctv|surveillance|vhs|degraded|dirty|security)\b/.test(text)) return "noisy";
  return "clean";
}
function shotInferCameraProfile(sh){
  const lens = String((sh && sh.lens) || "");
  const move = String((sh && sh.move) || "");
  const size = String((sh && sh.size) || "");
  const text = ((sh && (sh.action+" "+sh.composition+" "+sh.locationName)) || "").toLowerCase();
  if(lens==="vhs" || /\b(cctv|surveillance|security camera|dashcam|bodycam|webcam)\b/.test(text)) return "surveillance";
  if(/\b(phone|selfie|mobile footage|screen recording)\b/.test(text)) return "phone";
  if(/\b(drone|aerial|bird'?s-eye|flyover|overhead aerial)\b/.test(text)) return "drone";
  if(size==="INSERT" || size==="ECU" || lens==="100macro" || /\b(macro|insert|tiny detail|close detail)\b/.test(text)) return "macro";
  if(lens==="imax70" || /\b(epic scale|large format|70mm|imax)\b/.test(text)) return "arri_alexa65";
  if(/\b(night|dark|rain|storm|neon|sodium|low[- ]light)\b/.test(text)) return "sony_venice2_6k";
  if(move==="handheld" && /\b(documentary|reactive|street|improvised|run-and-gun)\b/.test(text)) return "handheld";
  if(/\b(gritty|crisp|high[- ]contrast|action|impact|kinetic)\b/.test(text)) return "red_komodo";
  return "arri_alexa35";
}
function shotEffectiveCameraSettings(sh){
  const c = (sh && sh.cameraSettings) || {};
  const cameraAuto = !(c.camera && c.camera!=="auto");
  const recommendedProfile = shotCameraProfileOf(shotInferCameraProfile(sh));
  const profile = cameraAuto ? recommendedProfile : shotCameraProfileOf(c.camera || "auto");
  const focal = shotInferFocalLength(sh);
  return {
    camera:{
      key:"camera",
      selectedId:c.camera || "auto",
      selectedLabel:cameraAuto ? "Auto" : profile.label,
      effectiveId:profile.id,
      effectiveLabel:profile.label,
      family:profile.family,
      desc:profile.desc,
      auto:cameraAuto,
    },
    lensType:shotCameraEffectiveChoice(sh, "lensType", SHOT_LENS_TYPES, shotInferLensType(sh)),
    focalLength:shotCameraEffectiveChoice(sh, "focalLength", SHOT_FOCAL_LENGTHS, focal.id, focal.label),
    aperture:shotCameraEffectiveChoice(sh, "aperture", SHOT_APERTURES, shotInferAperture(sh)),
    shutter:shotCameraEffectiveChoice(sh, "shutter", SHOT_SHUTTERS, shotInferShutter(sh)),
    iso:shotCameraEffectiveChoice(sh, "iso", SHOT_ISO_GRAIN, shotInferIsoGrain(sh)),
  };
}
function shotCameraResolvedLine(sh){
  const e = shotEffectiveCameraSettings(sh);
  const parts = [
    ["Camera profile", e.camera],
    ["Lens type", e.lensType],
    ["Focal length", e.focalLength],
    ["Aperture", e.aperture],
    ["Shutter", e.shutter],
    ["ISO / grain", e.iso],
  ];
  return "Resolved camera settings — "+parts.map(([label,x])=>label+": "+(x.auto ? ("Auto → "+x.effectiveLabel) : x.effectiveLabel)).join("; ");
}
function shotCameraMetadata(sh){
  const e = shotEffectiveCameraSettings(sh);
  const pack = (x)=>({ selectedId:x.selectedId, selectedLabel:x.selectedLabel, effectiveId:x.effectiveId, effectiveLabel:x.effectiveLabel, auto:!!x.auto });
  return {
    camera:{ ...pack(e.camera), family:e.camera.family || "", desc:e.camera.desc || "" },
    lensType:pack(e.lensType),
    focalLength:pack(e.focalLength),
    aperture:pack(e.aperture),
    shutter:pack(e.shutter),
    iso:pack(e.iso),
    promptClause:shotCameraSettingsClause(sh),
    resolvedLine:shotCameraResolvedLine(sh),
  };
}
function shotCameraSettingsClause(sh){
  const c = (sh && sh.cameraSettings) || {};
  const bits = [];
  const profile = shotCameraProfilePrompt(c.camera);
  if(profile) bits.push(profile);
  const add = (label, list, id)=>{ if(id && id!=="auto") bits.push(label+": "+shotCameraSettingLabel(list,id)); };
  add("lens type", SHOT_LENS_TYPES, c.lensType);
  add("focal length", SHOT_FOCAL_LENGTHS, c.focalLength);
  add("aperture", SHOT_APERTURES, c.aperture);
  add("shutter", SHOT_SHUTTERS, c.shutter);
  add("grain / ISO", SHOT_ISO_GRAIN, c.iso);
  return bits.length ? ("Advanced camera settings — "+bits.join(", ")) : "";
}
function shotHasCameraSettings(sh){
  const c = (sh && sh.cameraSettings) || {};
  return ["camera","lensType","focalLength","aperture","shutter","iso"].some(k=>c[k] && c[k]!=="auto");
}
window.shotCameraSettingsClause = shotCameraSettingsClause;
window.shotHasCameraSettings = shotHasCameraSettings;
window.shotEffectiveCameraSettings = shotEffectiveCameraSettings;
window.shotCameraResolvedLine = shotCameraResolvedLine;
window.shotCameraMetadata = shotCameraMetadata;
window.SHOT_CAMERA_PROFILES = SHOT_CAMERA_PROFILES;
window.shotCameraProfileOf = shotCameraProfileOf;
window.shotCameraProfilePrompt = shotCameraProfilePrompt;

/* ---- the rolling keyframe CHAIN ----------------------------------------------- */
/* The keyframe pass renders a scene's shots IN ORDER, each one seeded by the
   PREVIOUS shot's approved frame so the look AND progressive state (wetness, dirt,
   damage, wardrobe wear, a face crack introduced late) carry forward down the cut —
   on top of the locked sheets, which pin identity & set. These three helpers define
   that order, each shot's predecessor, and how hard the location plate should weigh. */

/* a scene's shots in render order — the order the chain renders and carries state */
function sceneShotsOrdered(list){
  return (list||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0));
}
window.sceneShotsOrdered = sceneShotsOrdered;

/* Beat continuity is semantic, not just storage-order adjacency.  The live beat
   card uses the first explicit beat-opening shot as its primary, even when old
   coverage rows precede that shot in the saved array; when no explicit opening
   exists, the first row remains the safe legacy fallback.  Keep this resolver
   read-only so it can be used by cards, render planning and batch callers. */
function shotBeatKey(value){
  if(value==null || String(value).trim()==="") return null;
  const n=Number(value);
  return Number.isFinite(n) && n>0 ? String(n) : null;
}
function shotBeatKeyOf(sh){
  return shotBeatKey(sh && sh.beatN);
}
function shotSameIdentity(a,b){
  return !!(a&&b) && (a===b || (a.id!=null && b.id!=null && String(a.id)===String(b.id)));
}
function shotPrimaryOf(beatShots){
  const list=Array.isArray(beatShots) ? beatShots : [];
  return list.find(sh=>sh && sh.keyframeMode==="beat-opening")
    || list.find(Boolean) || null;
}
function shotBeatPrimaryOf(sceneShots,beatN){
  const key=shotBeatKey(beatN);
  if(key==null) return null;
  return shotPrimaryOf((Array.isArray(sceneShots)?sceneShots:[])
    .filter(sh=>shotBeatKeyOf(sh)===key));
}
/* Short aliases keep the helper convenient for UI surfaces that already speak
   in terms of a beat rather than a shot list.  All aliases share the same
   implementation and therefore cannot drift from OpeningBeatCard's rule. */
window.shotPrimaryOf = shotPrimaryOf;
window.beatPrimaryOf = shotPrimaryOf;
window.shotBeatPrimaryOf = shotBeatPrimaryOf;
window.beatPrimaryShot = shotBeatPrimaryOf;

/* User-facing labels for the same semantic choice.  beatShots is the already
   lane-scoped list (the exact shape OpeningBeatCard has); passing the list keeps
   alternative numbering stable without changing or sorting saved shots. */
function shotBeatLabel(sh){
  const key=shotBeatKeyOf(sh);
  return key==null ? "Unnumbered shot" : "Beat "+key;
}
function shotBeatRoleLabel(sh,beatShots){
  const list=Array.isArray(beatShots) ? beatShots : (sh ? [sh] : []);
  const primary=shotPrimaryOf(list);
  if(!primary || shotSameIdentity(primary,sh)) return primary ? "Opening" : "";
  const alternatives=list.filter(x=>x && !shotSameIdentity(x,primary));
  const index=alternatives.findIndex(x=>shotSameIdentity(x,sh));
  return "Alternative "+(index>=0 ? index+1 : 1);
}
function shotBeatDisplayLabel(sh,beatShots){
  const beat=shotBeatLabel(sh), role=shotBeatRoleLabel(sh,beatShots);
  return role ? beat+" · "+role : beat;
}
window.shotBeatLabel = shotBeatLabel;
window.shotBeatRoleLabel = shotBeatRoleLabel;
window.shotBeatAlternativeLabel = shotBeatRoleLabel;
window.shotBeatDisplayLabel = shotBeatDisplayLabel;

/* Return a stable dependency-first view without changing the saved order.  A
   primary must precede its same-beat alternatives, and each numbered beat's
   primary must precede the next numbered beat's primary.  A stable topological
   pass moves only rows that are otherwise impossible to render in dependency
   order (notably an explicit primary stored after legacy alternatives). */
function sceneShotsDependencyOrdered(list){
  const ord=sceneShotsOrdered(Array.isArray(list)?list:[]);
  if(ord.length<2) return ord;
  const groups=[],byBeat=new Map();
  ord.forEach((sh,index)=>{
    const key=shotBeatKeyOf(sh);
    if(key==null) return;
    let group=byBeat.get(key);
    if(!group){ group={key,indices:[],primaryIndex:null}; byBeat.set(key,group); groups.push(group); }
    group.indices.push(index);
  });
  if(!groups.length) return ord;
  const edges=ord.map(()=>new Set()), indegree=ord.map(()=>0);
  const addEdge=(from,to)=>{
    if(from==null || to==null || from===to || edges[from].has(to)) return;
    edges[from].add(to); indegree[to]++;
  };
  groups.forEach(group=>{
    const shots=group.indices.map(index=>ord[index]);
    const primary=shotPrimaryOf(shots);
    group.primaryIndex=group.indices.find(index=>ord[index]===primary);
    if(group.primaryIndex==null)
      group.primaryIndex=group.indices.find(index=>shotSameIdentity(ord[index],primary));
    group.indices.forEach(index=>addEdge(group.primaryIndex,index));
  });
  for(let i=1;i<groups.length;i++)
    addEdge(groups[i-1].primaryIndex,groups[i].primaryIndex);
  const ready=[];
  indegree.forEach((n,index)=>{ if(n===0) ready.push(index); });
  const out=[];
  while(ready.length){
    ready.sort((a,b)=>a-b);
    const index=ready.shift();
    out.push(ord[index]);
    edges[index].forEach(next=>{
      indegree[next]--;
      if(indegree[next]===0) ready.push(next);
    });
  }
  /* The graph is acyclic for valid shot identities.  Should malformed imported
     data ever violate that assumption, preserving render order is safer than
     returning a partial list or inventing a promotion. */
  return out.length===ord.length ? out : ord;
}
window.sceneShotsDependencyOrdered = sceneShotsDependencyOrdered;
window.shotDependencyOrder = sceneShotsDependencyOrdered;

function shotIndexOf(sh,ord){
  let i=ord.indexOf(sh);
  if(i<0) i=ord.findIndex(x=>shotSameIdentity(x,sh));
  return i;
}
function shotImmediatePredecessorOf(sh,ord){
  const i=shotIndexOf(sh,ord);
  return i>0 ? ord[i-1] : null;
}
function shotBeatGroups(ord){
  const groups=[],byBeat=new Map();
  ord.forEach(sh=>{
    const key=shotBeatKeyOf(sh);
    if(key==null) return;
    let group=byBeat.get(key);
    if(!group){ group={key,shots:[]}; byBeat.set(key,group); groups.push(group); }
    group.shots.push(sh);
  });
  return groups;
}

/* the shot a given shot CHAINS FROM — its immediate predecessor in render order,
   whose approved frame seeds this one. null = a chain HEAD: the scene's first shot,
   or any shot explicitly flagged a fresh start (.anchor — a hard cut mid-scene).
   A head renders from the locked sheets alone, with no previous-frame seed. */
function prevShotOf(sh, sceneShots){
  if(!sh || sh.anchor) return null;               // explicit fresh start (chain break)
  const ord = sceneShotsOrdered(sceneShots);
  return shotImmediatePredecessorOf(sh,ord);       // i<=0 → first shot = head
}
window.prevShotOf = prevShotOf;
/* WHICH frame seeds a shot's generation: the beat's semantic primary is the sole
   coverage anchor for alternatives, while a beat primary carries continuity from
   the previous numbered beat's primary.  Legacy alternatives therefore never
   become hidden cross-beat tails.  An explicit fresh start (.anchor) severs only
   the requesting shot's own seed; a prior primary may still seed the next beat.
   Truly unnumbered/manual shots retain the immediate-predecessor fallback. */
function seedShotOf(sh, sceneShots){
  if(!sh || sh.anchor) return null;
  const ord = sceneShotsOrdered(sceneShots);
  const i = shotIndexOf(sh,ord);
  if(i<0) return null;
  const beatKey=shotBeatKeyOf(sh);
  if(beatKey==null) return i>0 ? shotImmediatePredecessorOf(sh,ord) : null;
  const groups=shotBeatGroups(ord);
  const groupIndex=groups.findIndex(group=>group.key===beatKey);
  const own=groupIndex>=0 ? groups[groupIndex] : null;
  const ownPrimary=own ? shotPrimaryOf(own.shots) : null;
  if(ownPrimary && !shotSameIdentity(ownPrimary,sh)) return ownPrimary;
  if(i<=0) return null;
  if(groupIndex>0){
    const priorPrimary=shotPrimaryOf(groups[groupIndex-1].shots);
    if(priorPrimary && !shotSameIdentity(priorPrimary,sh)) return priorPrimary;
  }
  return null;
}
window.seedShotOf = seedShotOf;

/* how hard the location plate weighs, by shot size: the set is the SUBJECT of a wide
   (its geography must read) but only a background/grade anchor in a tight close-up,
   where the character is the subject. Drives the prompt's location lock AND the order
   references are attached in (wides lead with the set, tights lead with the cast). */
function locWeightForSize(sizeId){
  return (["MCU","CU","ECU","INSERT"].indexOf(sizeId)>=0) ? "ambient" : "primary";
}
window.locWeightForSize = locWeightForSize;

async function shotGrabImage(id){
  if(!id) return "";
  let u = (typeof nbGetImage==="function") ? nbGetImage(id) : "";
  if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(id); }catch(e){} }
  // A freshly opened cloud project may not have hydrated the local byte cache yet.
  // For downstream references, a signed remote URL is still a better source than
  // silently falling back to a cropped master-plate quadrant.
  if(!u && typeof nbRemoteImageUrl==="function"){ try{ u = await nbRemoteImageUrl(id); }catch(e){} }
  return u || "";
}
window.shotGrabImage = shotGrabImage;

/* A required location reference is a pre-generation invariant.  Keep this
   error deliberately distinct from provider errors: callers can surface a
   useful "restore or choose another reference" message without retrying an
   image generation request. */
function shotLocationReferenceError(spec, cause){
  const id=String(spec&&spec.id||"");
  const reason=spec&&spec.unavailable
    ? "is unavailable or was deleted"
    : "has no available image";
  const e=new Error("Required location reference "+(id?"\""+id+"\" ":"")+reason+". Restore it or choose another location reference.");
  e.name="ShotLocationReferenceError";
  e.code="SHOT_LOCATION_REFERENCE_UNAVAILABLE";
  e.errorFlag="fatal-reference";
  e.fatalReference=true;
  e.isFatalReference=true;
  e.fatal=true;
  e.requiredReference=true;
  e.flag="fatal-reference";
  e.referenceId=id;
  e.referenceSpec=spec||null;
  if(cause) e.cause=cause;
  return e;
}
window.shotLocationReferenceError = shotLocationReferenceError;
window.ShotLocationReferenceError = shotLocationReferenceError;

async function shotLoadLocationSpecImage(spec, grab, opts){
  opts=opts||{};
  if(!spec) return null;
  let u="";
  let grabError=null;
  if(typeof grab==="function"){
    try{ u = await grab(spec.id); }catch(e){ grabError=e; }
  }
  if((spec.required || spec.unavailable) && !opts.allowMissing && (spec.unavailable || !u)){
    throw shotLocationReferenceError(spec,grabError);
  }
  if(grabError && !opts.allowMissing) throw grabError;
  /* An unavailable/deleted identity is never attachable merely because stale
     bytes happen to remain in a local cache. Inventory mode may inspect it,
     but must return no usable image. */
  if(spec.unavailable) return null;
  if(typeof grab!=="function") return null;
  const note = spec.note;
  const refId = spec.id;
  const assetRole = spec.assetRole || "derived_reference";
  const assetSourceQuality = spec.assetSourceQuality || "full_frame";
  const label = (typeof nbAssetRoleLabel==="function") ? nbAssetRoleLabel(assetRole) : assetRole;
  const priority = (typeof nbAssetRolePriority==="function") ? nbAssetRolePriority(assetRole) : 0;
  return u ? { url:u, note, refId, required:!!spec.required, category:spec.category,
    categories:spec.categories, locationId:spec.locationId, entityId:spec.entityId,
    stateId:spec.stateId, coverageId:spec.coverageId,
    assetRole, assetRoleLabel:label, assetRolePriority:priority, assetSourceQuality } : null;
}
window.shotLoadLocationSpecImage = shotLoadLocationSpecImage;

async function shotResolveLocationSpecImages(specs, grab, opts){
  opts=opts||{};
  const list = Array.isArray(specs) ? specs.filter(Boolean) : [];
  const seen = new Set();
  const dedupe = (items)=>items.filter(r=>{
    const k = [r.refId||"", r.assetSourceQuality||"", r.note||""].join("|");
    if(seen.has(k)) return false; seen.add(k); return true;
  });
  const direct = [];
  for(const s of list){
    const r = await shotLoadLocationSpecImage(s, grab, { ...opts, noFallback:true });
    if(r) direct.push(r);
  }
  return dedupe(direct);
}
window.shotResolveLocationSpecImages = shotResolveLocationSpecImages;

/* a one-line human label for a shot's grammar, e.g. "MS · Low angle · Push in · 50mm" */
function shotGrammarLabel(sh){
  return [sizeOf(sh.size).label, angleOf(sh.angle).label, moveOf(sh.move).label, lensOf(sh.lens).label].join(" · ");
}
window.shotGrammarLabel = shotGrammarLabel;

/* ---- CLIP SEQUENCES — the Stage hand-off unit ---------------------------------- */
/* A SEQUENCE is a contiguous run of a scene's shots that becomes ONE generated
   video clip (the Stage's video model renders up to ~15 seconds per clip). The
   grouping lives on the shots themselves — an automatic duration estimate
   (shotDur) — so the Shot List,
   the Storyboard's clip boards and the future Stage all read the SAME partition. */
const CLIP_MAX_SECONDS = 15;   // one generated clip's budget (Seedance-class video models)
window.CLIP_MAX_SECONDS = CLIP_MAX_SECONDS;
/* Seedance-class per-clip input caps, researched against the 2.0 API:
   - 3 shots/clip keeps per-shot frames + cast/location/prop refs inside the 9-image
     budget at full resolution (4-5-shot clips force dropping identity references);
   - 3 dialogue lines/clip is the hard audio-reference limit per generation.
   Both are packing DEFAULTS the Stage can override per model (Seedance 2.5's 30s
   single pass will lift them). */
const CLIP_MAX_SHOTS = 3;
const CLIP_MAX_DIALOGUE = 3;
window.CLIP_MAX_SHOTS = CLIP_MAX_SHOTS;
window.CLIP_MAX_DIALOGUE = CLIP_MAX_DIALOGUE;

/* AUTO duration estimate. A shot's real length can't be predicted — the video
   model decides its own pacing; the only duration we control is the CLIP's total.
   The one measurable anchor is dialogue: the spoken line fixes the shot's floor
   (~2.4 words/sec + a breath). Everything else gets a flat working guess. These
   are packing BUDGETS (how many beats can one 15s clip carry?), not promises. */
function shotEstDur(sh){
  const words = String((sh && sh.dialogue)||"").trim().split(/\s+/).filter(Boolean).length;
  if(words) return Math.min(CLIP_MAX_SECONDS, Math.max(3, Math.round(words/2.4 + 1.5)));
  return 5;
}
window.shotEstDur = shotEstDur;

/* a shot's budgeted screen time: a hand-pinned value, else the auto estimate */
function shotDur(sh){ const n = Number(sh && sh.dur); return (isFinite(n) && n>0) ? n : shotEstDur(sh); }
window.shotDur = shotDur;
function seqDuration(list){ return (list||[]).reduce((t,s)=>t+shotDur(s),0); }
window.seqDuration = seqDuration;

/* Partition a scene's ORDERED shots into clip sequences.
   Packing is always automatic (manual seqBreak grouping was retired).
   AUTO (the default): greedy packing — a new clip starts whenever the next shot
   would push the running clip past the DURATION budget, past the SHOT-COUNT cap
   (default 3 — keeps per-shot frames + identity refs inside Seedance's 9-image
   budget), or past the DIALOGUE cap (default 3 — Seedance's audio-reference
   limit per generation), so spoken beats naturally land in their own small clips.
   `clipMax` (optional) is the format's per-clip budget — clipMaxFor(project).
   `opts` (optional): { maxShots, maxDialogue } — 0/null lifts that cap (a future
   whole-scene model like Seedance 2.5). Returns [{ index, start, shots, dur, over, manual }]. */
function sceneSequences(sceneShots, clipMax, opts){
  const MAX = clipMax || CLIP_MAX_SECONDS;
  const capShots = (opts && "maxShots" in opts) ? (Number(opts.maxShots)>0 ? Number(opts.maxShots) : Infinity) : CLIP_MAX_SHOTS;
  const capDlg = (opts && "maxDialogue" in opts) ? (Number(opts.maxDialogue)>0 ? Number(opts.maxDialogue) : Infinity) : CLIP_MAX_DIALOGUE;
  const list = sceneShots || [];
  if(!list.length) return [];
  // WHOLE-SCENE mode: one clip = the entire scene, ignoring budgets. `over` still
  // flags when the scene runs past the per-clip budget so the console can warn
  // that pacing will compress.
  if(opts && opts.wholeScene){
    const dur = seqDuration(list);
    return [{ index:0, start:0, shots:list.slice(), dur, over: dur>MAX, manual:false }];
  }
  // PER-SHOT mode: one clip = one shot (the Stage's "Single shot" clip scope —
  // maximum control: render and judge each shot on its own).
  if(opts && opts.perShot){
    return list.map((s,index)=>{ const dur=shotDur(s);
      return { index, start:index, shots:[s], dur, over: dur>MAX, manual:false }; });
  }
  // PER-BEAT mode: one clip = one BEAT — consecutive shots sharing a beatN group
  // together regardless of the shot-count/dialogue caps (a 30s model like Seedance
  // 2.5 renders the whole beat as one sequence of shots). `over` still flags a
  // beat that outruns the model's ceiling so the console can block/warn honestly.
  if(opts && opts.perBeat){
    const groups=[]; let cur=[], curN=null;
    list.forEach(s=>{ const raw=Number(s&&s.beatN);
      // only a REAL beat number (positive, finite) can group shots — an unassigned/
      // zero/invalid beatN must NOT coalesce into a pseudo-beat (that would quietly
      // recreate the retired whole-scene clip on old projects without beat mapping),
      // so each such shot becomes its own clip
      const n=(isFinite(raw)&&raw>0)?raw:null;
      if(cur.length && (n===null || curN===null || n!==curN)){ groups.push(cur); cur=[]; }
      cur.push(s); curN=n; });
    if(cur.length) groups.push(cur);
    let bStart=0;
    return groups.map((shots,index)=>{ const dur=seqDuration(shots);
      const g={ index, start:bStart, shots, dur, over: dur>MAX, manual:false };
      bStart+=shots.length; return g; });
  }
  // clips are ALWAYS auto-packed (manual seqBreak hand-grouping was removed with
  // the Shots tab's clip bar — the Shots tab is pure coverage; clips are a Stage
  // concern). Any legacy seqBreak flags on old shots are simply ignored.
  const groups = [];
  {
    let cur=[], t=0, dlg=0;
    list.forEach(s=>{ const d=shotDur(s); const line=!!String(s.dialogue||"").trim();
      if(cur.length && (t+d>MAX || cur.length>=capShots || (line && dlg>=capDlg))){ groups.push(cur); cur=[]; t=0; dlg=0; }
      cur.push(s); t+=d; if(line) dlg++; });
    if(cur.length) groups.push(cur);
  }
  let start=0;
  return groups.map((shots,index)=>{
    const dur = seqDuration(shots);
    const g = { index, start, shots, dur, over: dur>MAX, manual:false };
    start += shots.length;
    return g;
  });
}
window.sceneSequences = sceneSequences;

/* WHOLE-SCENE video prompt — every shot's action + dialogue in chain order, plus
   the camera arc (first→last move) and the scene's grade: ONE prompt for shooting
   the entire scene. Shared by the Shots tab's "Copy video prompt" button and the
   Stage's whole-scene packing mode (the clip console auto-fills with this text). */
function sceneVideoPromptText(scene, sceneShots, opts){
  const list = (typeof sceneShotsOrdered==="function") ? sceneShotsOrdered(sceneShots||[]) : (sceneShots||[]);
  // opts.speakerOf(sh) → name: dialogue is ATTRIBUTED, never a bare trailing quote
  // (a quote right after "…while FLICKER freezes" read as Flicker's line when it
  // was Morwen's — the model needs the speaker named at the quote)
  const speakerOf = (opts && typeof opts.speakerOf==="function") ? opts.speakerOf : null;
  const lines = list.map(sh=>{
    // sh.vidText = per-shot VIDEO description override (Stage Multi-shot editor)
    const t = String(sh.vidText||sh.action||"").trim().replace(/\.+$/,"");
    const d = String(sh.dialogue||"").trim();
    let who = ""; if(d && speakerOf){ try{ who = String(speakerOf(sh)||""); }catch(e){} }
    return t ? (t + "." + (d ? (" "+(who? who.toUpperCase()+": " : "")+'"'+d+'"') : "")) : "";
  }).filter(Boolean);
  if(!lines.length) return "";
  const moves = Array.from(new Set(list.map(sh=> (typeof shotMoveOf==="function") ? shotMoveOf(sh.move).label : (sh.move||"")).filter(Boolean)));
  const loc = opts && opts.location;
  const preset = (opts && opts.project && typeof scenePreset==="function") ? scenePreset(opts.project, scene.id) : null;
  // multi-line for readability: setting, then one line per shot, then camera/grade —
  // video models take newlines fine, and humans can actually review the prompt
  return [
    loc ? ("Setting: "+loc.name+".") : "",
    lines.join("\n"),
    "Camera: "+(moves.length ? moves.join(" → ").toLowerCase() : "static")+".",
    // the whole look, as the frames get it (2026-10-05): grade, palette, lens, texture, film stock
    (()=>{ const look = (typeof turnVideoLookText==="function") ? turnVideoLookText(preset, opts && opts.project)
        : (preset ? (preset.name+" — "+String(preset.grade||"").trim()) : "");
      return look ? ("Style: "+look+".") : ""; })(),
  ].filter(Boolean).join("\n\n");
}
window.sceneVideoPromptText = sceneVideoPromptText;

/* ---- resolution helpers (scene ▸ location / subjects / props) ----------------- */
function locationForScene(locations, sceneId){
  // One subspace in the scene -> use that child workspace (Kitchen). More than one
  // subspace -> use their shared continuity root (Father's House), while per-shot
  // reference scoring selects the exact Kitchen/Living Room Slugline Unit.
  const units=((window.turnContinuity||{}).sluglineUnits)||[];
  const sceneUnits=units.filter(u=>u&&!u.orphan&&Array.isArray(u.scenes)&&u.scenes.indexOf(sceneId)>=0);
  if(sceneUnits.length){
    const subspaces=Array.from(new Set(sceneUnits.map(u=>String(u.subspaceKey||u.locationKey||"")).filter(Boolean)));
    const wanted=subspaces.length===1?subspaces[0]:String(sceneUnits[0].continuityRootKey||sceneUnits[0].locationKey||"");
    const grouped=(locations||[]).find(l=>{
      const key=String((l&&l.key)||((typeof locSlug==="function")?locSlug(l&&l.name).split("-").slice(0,4).join("-"):"")||"");
      return key===wanted;
    });
    if(grouped) return grouped;
  }
  return (locations||[]).find(l=> Array.isArray(l.scenes) && l.scenes.indexOf(sceneId)>=0) || null;
}
window.locationForScene = locationForScene;

function shotLocationText(sh){
  return [sh&&sh.action, sh&&sh.composition, sh&&sh.dialogue, sh&&sh.directives]
    .filter(Boolean).join(" ").replace(/\s+/g," ").trim();
}
function shotLocationSide(sh, loc, scene, drafts){
  const explicit = String((sh&&sh.locationSide)||"").toUpperCase();
  if(/^(INT|EXT|BOTH)$/.test(explicit)) return explicit;
  const text = shotLocationText(sh).toLowerCase();
  const intHit = /\b(inside|interior|within|booth|room|office|desk|terminal|console|counter|window|glass)\b/.test(text);
  // Weather alone does not move an INT scene outside. "Rain hammers the roof" is
  // often heard/seen from inside a car; only an explicit exterior/geography cue
  // should override the scene's slugline side.
  const extHit = /\b(outside|exterior|yard|street|facade|pavement|road|parking|approach)\b/.test(text)
    || /\b(?:whole|entire)\s+(?:cab|car|vehicle)\b/.test(text);
  if(intHit && extHit) return "BOTH";
  if(intHit) return "INT";
  if(extHit) return "EXT";
  let side = String(loc&&loc.intExt||"").toUpperCase();
  if(!/^(INT|EXT)$/.test(side) && scene&&scene.loc){
    const parsed=(typeof parseSlugline==="function")?parseSlugline(scene.loc):null;
    side=String((parsed&&parsed.intExt)||"").toUpperCase();
  }
  if(side==="INT" || side==="EXT") return side;
  return "";
}

/* Location references are resolved from the screenplay's typed beat source, not
   from a shot's stale locationId or from whichever unit happens to sort first.
   Keep these helpers local to Shots: they are also used by the manual picker,
   render plan, headless renderer and Stage bridge through
   shotLocationCoverageSpecs. */
function shotLocationClean(value){
  return String(value==null?"":value).replace(/\s+/g," ").trim();
}
function shotLocationNorm(value){
  return shotLocationClean(value).toLowerCase()
    .replace(/[’']/g,"'")
    .replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
}
function shotLocationDraftFor(scene,drafts){
  if(!scene) return null;
  if(Array.isArray(drafts) || (drafts&&Array.isArray(drafts.blocks))) return drafts;
  return drafts && (drafts[scene.id] || drafts[String(scene.id)]) || null;
}
function shotLocationDraftMap(scene,drafts){
  const direct=shotLocationDraftFor(scene,drafts);
  if(direct) return {[scene.id]:direct};
  return drafts || {};
}
function shotLocationBeatNumber(sh){
  const raw=sh && (sh.beatN!=null && sh.beatN!=="" ? sh.beatN : sh.beat);
  const n=Number(raw);
  return Number.isFinite(n) && n>0 ? n : null;
}
function shotLocationDraftBlocks(scene,drafts){
  const d=shotLocationDraftFor(scene,drafts);
  return d && Array.isArray(d.blocks) ? d.blocks : (Array.isArray(d)?d:[]);
}
function shotLocationInferBeat(scene,sh,drafts){
  if(!scene || !sh) return null;
  const text=shotLocationNorm(shotLocationText(sh));
  if(!text) return null;
  const hits=new Set();
  shotLocationDraftBlocks(scene,drafts).forEach(b=>{
    const n=Number(b&&b.beat);
    if(!Number.isFinite(n)||n<=0 || !b || String(b.type||"").toLowerCase()==="scene") return;
    const bt=shotLocationNorm(b.text);
    if(!bt) return;
    /* Manual Add Shot supplies the beat's exact screenplay text as action. A
       unique block hit lets the picker remain beat-scoped without teaching the
       UI about screenplay internals. Repeated prose is deliberately ambiguous. */
    if(text===bt || text.indexOf(bt)>=0 || bt.indexOf(text)>=0) hits.add(n);
  });
  return hits.size===1 ? Array.from(hits)[0] : null;
}
function shotLocationBeatSource(scene,sh,drafts){
  const n=shotLocationBeatNumber(sh);
  if(n==null || !scene) return null;
  const map=shotLocationDraftMap(scene,drafts);
  try{
    if(typeof shotBeatSource==="function"){
      return shotBeatSource(scene,n,{drafts:map,beatsMap:{}},[]);
    }
    if(typeof window.shotBeatScreenplay==="function"){
      return window.shotBeatScreenplay(scene,n,{drafts:map,characters:[],beatsMap:{}});
    }
  }catch(e){}
  return null;
}
function shotLocationHeadingForIndex(blocks,index,fallback){
  let heading="", actionSinceHeading=0;
  const end=Math.min(Number(index),blocks.length-1);
  for(let i=0;i<=end;i++){
    const b=blocks[i];
    if(b&&String(b.type||"").toLowerCase()==="scene"&&shotLocationClean(b.text)){
      heading=shotLocationClean(b.text);
      actionSinceHeading=0;
      continue;
    }
    if(b&&String(b.type||"").toLowerCase()==="action"){
      if(typeof screenplayInlineSpaceHeading==="function"){
        const inline=screenplayInlineSpaceHeading(b.text,heading||fallback,actionSinceHeading===0);
        if(inline) heading=shotLocationClean(inline);
      }
      actionSinceHeading++;
    }
  }
  return heading || shotLocationClean(fallback);
}
function shotLocationBeatHeadings(scene,sh,drafts,source){
  const blocks=shotLocationDraftBlocks(scene,drafts);
  const entries=(source&&Array.isArray(source.blocks)?source.blocks:[])
    .map(b=>b&&b.evidence&&Number(b.evidence.blockIndex))
    .filter(n=>Number.isFinite(n)&&n>=0);
  const headings=[];
  if(entries.length){
    entries.forEach(index=>{
      const h=shotLocationHeadingForIndex(blocks,index,source&&source.sceneHeading);
      if(h && headings.indexOf(h)<0) headings.push(h);
    });
  }else if(source&&source.sceneHeading){
    headings.push(shotLocationClean(source.sceneHeading));
  }
  if(!headings.length && source&&source.hasSource===false) return [];
  return headings;
}
function shotLocationParseHeading(value){
  const raw=shotLocationClean(value);
  if(!raw) return null;
  if(typeof parseSlugline==="function"){
    try{ const parsed=parseSlugline(raw); if(parsed) return parsed; }catch(e){}
  }
  let text=raw.replace(/^\s*\d+[\.\)]?\s+/,""), intExt="";
  const m=text.match(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?)\s*/i);
  if(m){ intExt=m[1].toUpperCase().replace(/\./g,"").replace(/I\/E/,"INT/EXT"); text=text.slice(m[0].length); }
  let time="";
  const tm=text.match(/[\u00b7\u2014,\-]\s*([A-Za-z][A-Za-z'\s]{1,22})\s*$/);
  if(tm && /\b(night|day|dawn|dusk|morning|evening|afternoon|continuous|later|moments?\s+later|sunset|sunrise)\b/i.test(tm[1])){
    time=shotLocationClean(tm[1]); text=text.slice(0,tm.index).trim();
  }
  text=text.replace(/[\u00b7\u2014,\-\s]+$/,"").trim();
  return text ? {intExt,place:text,time} : null;
}
function shotLocationTime(value){
  if(typeof normalizeTOD==="function"){
    try{ return normalizeTOD(value) || ""; }catch(e){}
  }
  const s=shotLocationNorm(value);
  if(/\b(?:night|midnight|nighttime)\b/.test(s)) return "night";
  if(/\bdawn|sunrise|daybreak\b/.test(s)) return "dawn";
  if(/\bmorning\b/.test(s)) return "morning";
  if(/\b(?:day|daytime|noon|midday)\b/.test(s)) return "day";
  if(/\bafternoon\b/.test(s)) return "afternoon";
  if(/\b(?:dusk|sunset|twilight)\b/.test(s)) return "dusk";
  if(/\bevening\b/.test(s)) return "evening";
  return "";
}
function shotLocationPlaceParts(value){
  const raw=shotLocationClean(value);
  return Array.from(new Set([raw].concat(raw.split(/\s*(?:\/|·|—|,|\s-\s)\s*/))
    .map(shotLocationNorm).filter(Boolean)));
}
function shotLocationUnitPlace(u){
  return shotLocationClean(u&& (u.name || u.place));
}
function shotLocationUnitMatchesPlace(u,parsed){
  if(!u||!parsed||!shotLocationUnitPlace(u)) return false;
  const unit=shotLocationNorm(shotLocationUnitPlace(u));
  const parts=shotLocationPlaceParts(parsed.place);
  if(parts.indexOf(unit)>=0) return true;
  /* A heading such as "FATHER'S HOUSE KITCHEN" has no separator between the
     enclosing place and its room. Accept a unique trailing room phrase, but
     never use a broad substring that could choose the wrong room. */
  const place=shotLocationNorm(parsed.place);
  return !!(place && place.endsWith(" "+unit));
}
function shotLocationUnitRoot(u){
  return String(u&& (u.continuityRootKey || u.locationKey || "") || "");
}
function shotLocationUnitSubspace(u){
  return String(u&& (u.subspaceKey || u.locationKey || "") || "");
}
function shotLocationLocationKey(loc){
  if(typeof locationKeyOf==="function"){
    try{ return String(locationKeyOf(loc)||""); }catch(e){}
  }
  return String((loc&&loc.key)||"");
}
function shotLocationEligibleUnits(loc,scene,allUnits){
  if(!loc) return [];
  const locKey=shotLocationLocationKey(loc);
  const rootKey=String(loc.parentKey||loc.continuityRootKey||locKey||"");
  const childKey=loc.parentKey ? locKey : "";
  return (allUnits||[]).filter(u=>{
    if(!u||u.orphan||!u.key) return false;
    const unitRoot=shotLocationUnitRoot(u);
    if(rootKey && unitRoot && unitRoot!==rootKey) return false;
    if(rootKey && !unitRoot && shotLocationUnitSubspace(u)!==rootKey) return false;
    if(childKey && shotLocationUnitSubspace(u)!==childKey) return false;
    if(scene&&scene.id&&Array.isArray(u.scenes)&&u.scenes.length&&u.scenes.indexOf(scene.id)<0) return false;
    return true;
  });
}
function shotLocationHeadingSide(parsed,sh,loc,scene){
  const explicit=String(sh&&sh.locationSide||"").toUpperCase();
  if(explicit==="INT" || explicit==="EXT") return explicit;
  const parsedSide=String(parsed&&parsed.intExt||"").toUpperCase();
  if(parsedSide==="INT"||parsedSide==="EXT"||parsedSide==="BOTH"||parsedSide==="INT/EXT") return parsedSide==="INT/EXT"?"BOTH":parsedSide;
  if(explicit==="BOTH") return explicit;
  return shotLocationSide(sh,loc,scene,{});
}
function shotLocationHeadingUnitCandidates(units,parsed,side){
  const targetTime=shotLocationTime(parsed&&parsed.time);
  return (units||[]).filter(u=>{
    if(!shotLocationUnitMatchesPlace(u,parsed)) return false;
    const role=String(u.intExt||"").toUpperCase();
    if(side!=="BOTH" && side && role && role!==side) return false;
    if(targetTime && shotLocationTime(u.time)!==targetTime) return false;
    return true;
  });
}
function shotLocationBuildUnitSpec(u){
  if(!u||!u.key) return null;
  if(typeof sluglineUnitImageId!=="function") return null;
  const role=String(u.intExt||"").toUpperCase();
  const unitName=shotLocationUnitPlace(u)||"location";
  const id=sluglineUnitImageId(u.key);
  return { id, unitKey:String(u.key), name:unitName, place:unitName,
    time:u.time||"", subspaceKey:String(u.subspaceKey||""),
    continuityRootKey:String(u.continuityRootKey||u.locationKey||""),
    sceneIds:Array.isArray(u.scenes)?u.scenes.slice():[],
    role, locPanelQ:null, source:"slugline-unit",
    assetRole:"derived_reference", assetSourceQuality:"slugline_unit_full_frame",
    note:unitName+" — Slugline Unit "+(role||"location")+" plate"
      +(u.time?(" at "+u.time):"")+" (full-resolution unit anchor)" };
}
const SHOT_LOCATION_CATEGORY_LABELS={
  place:"Place",
  unit:"Slugline Unit",
  coverage:"Required Space Plate",
  state:"Time-of-Day Variant",
  unknown:"Unavailable location reference",
};
const SHOT_LOCATION_CATEGORY_ORDER={place:0,unit:1,coverage:2,state:3,unknown:9};
function shotLocationCategoryLabel(category){
  return SHOT_LOCATION_CATEGORY_LABELS[String(category||"").toLowerCase()]
    || "Location reference";
}
function shotLocationCatalogSceneLinks(item){
  item=item||{};
  return {
    sceneIds:Array.isArray(item.sceneIds)?item.sceneIds.slice()
      :Array.isArray(item.scenes)?item.scenes.slice():item.sceneId?[item.sceneId]:[],
    sceneNos:Array.isArray(item.sceneNos)?item.sceneNos.slice():[],
  };
}
function shotLocationCatalogLocations(loc){
  const C=window.turnContinuity||{}, list=[], seen=new Set();
  const add=(l)=>{
    if(!l||!l.id||l.deleted||l.deletedAt||l.orphan||seen.has(String(l.id))) return;
    seen.add(String(l.id)); list.push(l);
  };
  (Array.isArray(C.locations)?C.locations:[]).forEach(add);
  add(loc);
  const initial=list.slice();
  initial.forEach(l=>{
    if(!l.parentKey) return;
    add((Array.isArray(C.locations)?C.locations:[]).find(x=>x&&
      shotLocationLocationKey(x)===String(l.parentKey)));
  });
  list.slice().forEach(l=>{
    const key=shotLocationLocationKey(l);
    (Array.isArray(C.locations)?C.locations:[]).filter(x=>x&&String(x.parentKey||"")===key).forEach(add);
  });
  return list;
}
function shotLocationCatalogParent(l,locations){
  if(!l||!l.parentKey) return null;
  return (locations||[]).find(x=>x&&shotLocationLocationKey(x)===String(l.parentKey))||null;
}
function shotLocationCatalogRoot(l,locations){
  let cur=l, guard=0;
  while(cur&&cur.parentKey&&guard++<16){
    const p=shotLocationCatalogParent(cur,locations); if(!p) break; cur=p;
  }
  return cur||l||null;
}
function shotLocationCatalogUnitOwner(u,locations){
  if(!u) return null;
  const direct=String(u.locationId||"");
  if(direct){
    const hit=(locations||[]).find(l=>l&&(String(l.id)===direct||shotLocationLocationKey(l)===direct));
    if(hit) return hit;
  }
  const sub=String(u.subspaceKey||u.locationKey||"");
  const root=String(u.continuityRootKey||"");
  if(sub){
    const candidates=(locations||[]).filter(l=>l&&shotLocationLocationKey(l)===sub);
    const exact=root
      ? (candidates.find(l=>{
          const lr=shotLocationCatalogRoot(l,locations);
          return shotLocationLocationKey(lr)===root;
        })||null)
      : (candidates[0]||null);
    if(exact) return exact;
  }
  if(root){
    const exact=(locations||[]).find(l=>l&&shotLocationLocationKey(l)===root);
    if(exact) return exact;
  }
  return null;
}
function shotLocationCatalogDisplayName(l,locations){
  if(!l) return "Location";
  const p=shotLocationCatalogParent(l,locations);
  const name=String(l.name||"Location").trim();
  return p ? (String(p.name||"").trim()+" / "+name).replace(/^\/\s*|\s*\/$/g,"") : name;
}
function shotLocationCatalogPlaceSpec(l,locations,allUnits,sheets){
  const children=(typeof locationChildrenOf==="function")?locationChildrenOf(l,locations):[];
  const side=String(l.intExt||"").toUpperCase()||(
    typeof locationEffectiveSide==="function"
      ? String(locationEffectiveSide(l,allUnits,sheets,children)||"").toUpperCase() : "");
  const compound=typeof locationScopeOf==="function"
    ? locationScopeOf(l,locations)==="compound" : (!l.parentKey&&children.length>0);
  const display=shotLocationCatalogDisplayName(l,locations);
  return {
    id:String(l.id),category:"place",categoryLabel:shotLocationCategoryLabel("place"),
    categories:["place"],label:[display,side,compound?"continuity root":"place"].filter(Boolean).join(" · "),
    description:compound
      ? display+" design reference; this continuity-root plate may be a compound multi-panel reference, not a single full-frame shot."
      : display+" place design reference; use it for binding architecture, materials and geography, not as a cropped shot frame.",
    note:compound
      ? display+" — continuity-root design reference (potentially compound multi-panel; not a full-frame shot and never a crop)"
      : display+" — place design reference (not a full-frame shot and never a crop)",
    locationId:String(l.id),entityId:String(l.id),baseId:String(l.id),
    parentLocationId:(shotLocationCatalogParent(l,locations)||{}).id||"",
    locationScope:compound?"compound":"atomic",placeName:String(l.name||""),
    source:"location-place",assetRole:"master_reference",
    assetSourceQuality:compound?"location_master_plate_compound":"location_master_plate",
  };
}
function shotLocationCatalogUnitSpec(u,owner,locations){
  if(!u||!u.key||!owner||typeof sluglineUnitImageId!=="function") return null;
  const id=sluglineUnitImageId(u.key), display=shotLocationCatalogDisplayName(owner,locations);
  const name=shotLocationUnitPlace(u)||owner.name||"location";
  const role=String(u.intExt||"").toUpperCase(), state=String(u.appearance||"").trim();
  const bits=[display,name,role,shotLocationClean(u.time),state].filter(Boolean);
  return {
    id,category:"unit",categoryLabel:shotLocationCategoryLabel("unit"),categories:["unit"],
    label:bits.join(" · "),description:display+" "+(role||"location")
      +" Slugline Unit"+(u.time?(" at "+u.time):"")
      +(state?(" with time-of-day variant "+state):"")+" — one full-frame continuity anchor.",
    note:bits.slice(0,4).join(" · ")+" — Slugline Unit full-frame reference; use the entire frame, never a crop",
    locationId:String(owner.id),entityId:String(owner.id),baseId:id,unitKey:String(u.key),
    subspaceKey:String(u.subspaceKey||u.locationKey||""),continuityRootKey:String(u.continuityRootKey||u.locationKey||""),
    stateId:"",appearanceState:state,...shotLocationCatalogSceneLinks(u),
    role,time:u.time||"",name,place:name,source:"slugline-unit",assetRole:"derived_reference",
    assetSourceQuality:"slugline_unit_full_frame",
  };
}
function shotLocationCatalogCoverageSpec(l,v,locations){
  if(!l||!v||!v.id) return null;
  const display=shotLocationCatalogDisplayName(l,locations), role=String(v.role||"").toUpperCase();
  const name=String(v.name||display||"Coverage").trim(), id=String(l.id)+"-"+String(v.id);
  return {
    id,category:"coverage",categoryLabel:shotLocationCategoryLabel("coverage"),categories:["coverage"],
    label:[display,name,role].filter(Boolean).join(" · "),
    description:display+" screenplay-derived "+(role||"location")+" Required Space Plate — one full-frame view.",
    note:name+" — Required Space Plate · "+(role||"location")+" (one full-frame reference; never a crop)",
    locationId:String(l.id),entityId:String(l.id),baseId:id,coverageId:String(v.id),
    ...shotLocationCatalogSceneLinks(v),summary:v.summary||"",scriptExcerpt:v.scriptExcerpt||"",
    triggerWords:(v.triggerWords||[]).map(w=>String(w||"").toLowerCase()).filter(Boolean),
    role,name,source:"screenplay-coverage",assetRole:"derived_reference",
    assetSourceQuality:"screenplay_coverage_full_frame",
  };
}
function shotLocationCatalogStateSpec(l,v,locations,units){
  if(!l||!v||typeof locationAppearanceStateAssetId!=="function") return null;
  const linked=v.linkedUnit||null, id=locationAppearanceStateAssetId(l,v,units);
  if(!id) return null;
  const display=shotLocationCatalogDisplayName(l,locations);
  const role=String(v.intExt||(linked&&linked.intExt)||"").toUpperCase();
  const time=v.time||(linked&&linked.time)||"";
  const state=String(v.state||v.appearance||(linked&&linked.appearance)||"").trim();
  const bits=[display,role,time,state].filter(Boolean);
  return {
    id:String(id),category:"state",categoryLabel:shotLocationCategoryLabel("state"),categories:["state"],
    label:(bits.length?bits:[display,"time-of-day variant"]).join(" · "),
    description:display+" time-of-day variant"+(state?(" — "+state):"")
      +(linked?" linked to the Slugline Unit's full-frame asset.":" (legacy state asset)."),
    note:(bits.length?bits.join(" · "):display)+" — Time-of-Day Variant reference"
      +(linked?" linked to the exact Slugline Unit; full-frame, never a crop":" (legacy full-frame state asset; never a crop)"),
    locationId:String(l.id),entityId:String(l.id),baseId:String(id),stateId:String(v.id||""),
    appearanceState:state,unitKey:String(v.unitKey||(linked&&linked.key)||""),
    ...shotLocationCatalogSceneLinks(linked||v),
    role,time,source:"appearance-state",assetRole:"derived_reference",
    assetSourceQuality:linked?"slugline_unit_full_frame":"location_state_full_frame",
  };
}
function shotLocationCatalogAdd(map,spec,index){
  if(!spec||!spec.id) return;
  const id=String(spec.id),prior=map.get(id);
  if(!prior){ spec._catalogIndex=index; map.set(id,spec); return; }
  prior.categories=Array.from(new Set([...(prior.categories||[prior.category]),...(spec.categories||[spec.category])].filter(Boolean)));
  if(spec.category==="state"){
    prior.stateId=spec.stateId||prior.stateId||"";
    prior.appearanceState=spec.appearanceState||prior.appearanceState||"";
    if(spec.appearanceState && prior.note.indexOf(spec.appearanceState)<0) prior.note+="; Time-of-Day Variant: "+spec.appearanceState;
    if(spec.appearanceState && prior.label.indexOf(spec.appearanceState)<0) prior.label+=" · "+spec.appearanceState;
  }
}
function shotLocationCatalogContext(loc,sh,scene,drafts,locations,allUnits){
  sh=sh||{}; const C=window.turnContinuity||{};
  const beatN=shotLocationBeatNumber(sh)!=null ? shotLocationBeatNumber(sh)
    : (sh.referencePickerAll ? shotLocationInferBeat(scene,sh,drafts||C.drafts||{}) : null);
  const source=beatN!=null?shotLocationBeatSource(scene,sh,drafts||C.drafts||{}):null;
  const headings=source&&source.hasSource?shotLocationBeatHeadings(scene,sh,drafts||C.drafts||{},source)
    :(beatN==null&&scene&&scene.loc?[shotLocationClean(scene.loc)]:[]);
  const scoped=shotLocationEligibleUnits(loc,scene,allUnits);
  const current=new Set(),context=new Set(),currentLocations=new Set();
  headings.forEach((heading,index)=>{
    const parsed=shotLocationParseHeading(heading); if(!parsed) return;
    const side=shotLocationHeadingSide(parsed,sh,loc,scene);
    shotLocationHeadingUnitCandidates(scoped,parsed,side).forEach(u=>{
      (index===0?current:context).add(String(u.key));
      const owner=shotLocationCatalogUnitOwner(u,locations); if(owner) currentLocations.add(String(owner.id));
    });
  });
  const root=shotLocationCatalogRoot(loc,locations);
  if(root&&root.id) currentLocations.add(String(root.id));
  if(loc&&loc.id) currentLocations.add(String(loc.id));
  return {current,context,currentLocations};
}
function shotLocationReferenceCatalog(loc,sh,scene,drafts){
  const C=window.turnContinuity||{},locations=shotLocationCatalogLocations(loc);
  const allUnits=Array.isArray(C.sluglineUnits)?C.sluglineUnits:[],map=new Map(); let index=0;
  const sheetsByLocation=new Map();
  locations.forEach(l=>{
    let sheets=Array.isArray(l.coverageSheets)?l.coverageSheets.slice():[];
    const derived=typeof deriveLocationCoverageSheets==="function"
      ? deriveLocationCoverageSheets(l,Array.isArray(C.scenes)?C.scenes:(scene?[scene]:[]),
        drafts||C.drafts||{},Array.isArray(C.locations)?C.locations:locations,allUnits) : [];
    (derived||[]).forEach(v=>{ const i=sheets.findIndex(x=>x&&x.id===v.id);
      if(i>=0) sheets[i]={...sheets[i],...v}; else sheets.push(v); });
    sheetsByLocation.set(String(l.id),sheets);
  });
  locations.forEach(l=>shotLocationCatalogAdd(map,
    shotLocationCatalogPlaceSpec(l,locations,allUnits,sheetsByLocation.get(String(l.id))||[]),index++));
  allUnits.filter(u=>u&&!u.orphan&&u.key).forEach(u=>{
    const owner=shotLocationCatalogUnitOwner(u,locations); if(owner)
      shotLocationCatalogAdd(map,shotLocationCatalogUnitSpec(u,owner,locations),index++);
  });
  locations.forEach(l=>(sheetsByLocation.get(String(l.id))||[]).filter(v=>v&&v.id).forEach(v=>
    shotLocationCatalogAdd(map,shotLocationCatalogCoverageSpec(l,v,locations),index++)));
  locations.forEach(l=>{
    if(typeof locationAppearanceStates!=="function") return;
    const ownUnits=allUnits.filter(u=>shotLocationCatalogUnitOwner(u,locations)
      && shotLocationCatalogUnitOwner(u,locations).id===l.id);
    (locationAppearanceStates(l,ownUnits)||[]).forEach(v=>
      shotLocationCatalogAdd(map,shotLocationCatalogStateSpec(l,v,locations,allUnits),index++));
  });
  const context=shotLocationCatalogContext(loc,sh,scene,drafts,locations,allUnits);
  return Array.from(map.values()).sort((a,b)=>{
    const rank=(s)=>s.category==="unit"||s.categories.indexOf("unit")>=0
      ? (context.current.has(String(s.unitKey))?0:(context.context.has(String(s.unitKey))?1:3))
      : (context.currentLocations.has(String(s.locationId))?2:3);
    return rank(a)-rank(b)
      || (SHOT_LOCATION_CATEGORY_ORDER[a.category]||9)-(SHOT_LOCATION_CATEGORY_ORDER[b.category]||9)
      || a._catalogIndex-b._catalogIndex;
  }).map(s=>{ const out={...s}; delete out._catalogIndex; return out; });
}
window.shotLocationReferenceCatalog=shotLocationReferenceCatalog;
/* Scene scoping is a picker constraint, not a rewrite of existing render intent.
   An asset's own scene links take precedence over its reusable parent place. */
function shotLocationSceneReferenceChoices(catalog,loc,scene){
  if(!scene||!scene.id) return [];
  const locations=shotLocationCatalogLocations(loc),allowedPlaces=new Set();
  const sceneMatch=spec=>{
    if(Array.isArray(spec.sceneIds)&&spec.sceneIds.length)
      return spec.sceneIds.some(id=>String(id)===String(scene.id));
    if(Array.isArray(spec.sceneNos)&&spec.sceneNos.length)
      return scene.no!=null&&spec.sceneNos.some(no=>String(no)===String(scene.no));
    return null;
  };
  const addPlace=l=>{
    let current=l;
    for(let depth=0;current&&depth<16;depth++){
      if(allowedPlaces.has(String(current.id))) break;
      allowedPlaces.add(String(current.id));
      current=shotLocationCatalogParent(current,locations);
    }
  };
  locations.forEach(l=>{
    if(sceneMatch(shotLocationCatalogSceneLinks(l))===true) addPlace(l);
  });
  if(loc&&sceneMatch(shotLocationCatalogSceneLinks(loc))!==false) addPlace(loc);
  catalog.forEach(spec=>{
    if(sceneMatch(spec)===true)
      addPlace(locations.find(l=>String(l.id)===String(spec.locationId)));
  });
  return catalog.filter(spec=>{
    if(spec.category==="place") return allowedPlaces.has(String(spec.locationId));
    const match=sceneMatch(spec);
    return match===null?allowedPlaces.has(String(spec.locationId)):match;
  });
}
function shotLocationUnknownSpec(id,loc){
  const ref=String(id||"");
  return {id:ref,category:"unknown",categoryLabel:shotLocationCategoryLabel("unknown"),categories:["unknown"],
    label:"Unavailable · "+ref,description:"The selected location reference is unavailable or was deleted.",
    note:"Unavailable required location reference "+(ref?"\""+ref+"\"":"")
      +" — the place, Slugline Unit, Required Space Plate, or Time-of-Day Variant was deleted or is unavailable; choose another reference.",
    locationId:String(loc&&loc.id||""),entityId:String(loc&&loc.id||""),baseId:ref,
    source:"manual-selection",assetRole:"derived_reference",assetSourceQuality:"unavailable",
    unavailable:true,required:true};
}
function shotLocationReferenceChoices(loc,sh,scene,drafts){
  sh=sh||{}; const catalog=shotLocationReferenceCatalog(loc,sh,scene,drafts);
  const currentScene=scene||(((window.turnContinuity||{}).scenes)||[]).find(s=>s&&s.id===sh.sceneId)
    ||(sh.sceneId?{id:sh.sceneId}:null);
  const sceneCatalog=shotLocationSceneReferenceChoices(catalog,loc,currentScene);
  if(!sh.referenceLocationsSet) return sceneCatalog.map(s=>({...s}));
  const sceneIds=new Set(sceneCatalog.map(s=>String(s.id)));
  const ids=Array.isArray(sh.referenceLocationIds)?sh.referenceLocationIds.filter(Boolean):[];
  const byId=new Map(catalog.map(s=>[String(s.id),s])),selected=[],seen=new Set();
  ids.forEach(raw=>{ const id=String(raw); if(seen.has(id)) return; seen.add(id);
    const spec=byId.get(id);
    selected.push(spec?{...spec,outOfScene:!sceneIds.has(id)}:shotLocationUnknownSpec(id,loc)); });
  return selected.concat(sceneCatalog.filter(s=>!seen.has(String(s.id))).map(s=>({...s})));
}
function shotLocationCoverageSpecs(loc, sh, scene, drafts){
  sh=sh||{};
  /* Automatic inference has no safe location scope without a current card.
     Explicit IDs are different: resolve them against the shared current-film
     catalog so a deleted scene link cannot erase director intent. */
  if(!loc && !sh.referenceLocationsSet) return [];
  const text=shotLocationText(sh).toLowerCase();
  const C=window.turnContinuity||{};
  const allUnits=Array.isArray(C.sluglineUnits)?C.sluglineUnits:[];
  const explicitSelection=!!sh.referenceLocationsSet;
  const explicitIds=new Set(Array.isArray(sh.referenceLocationIds)?sh.referenceLocationIds.filter(Boolean):[]);
  if(explicitSelection){
    if(!explicitIds.size) return [];
    const catalog=shotLocationReferenceCatalog(loc,sh,scene,drafts);
    const byId=new Map(catalog.map(s=>[String(s.id),s])),out=[],seen=new Set();
    /* The persisted order is director intent.  Resolve through the shared
       catalog rather than re-running beat/TOD matching, so a different room,
       place, context or state remains authoritative. */
    (Array.isArray(sh.referenceLocationIds)?sh.referenceLocationIds:[]).forEach(raw=>{
      const id=String(raw||"");
      if(!id||seen.has(id)) return;
      seen.add(id);
      const base=byId.get(id)||shotLocationUnknownSpec(id,loc);
      out.push({...base,required:true,unavailable:!!base.unavailable});
    });
    return out;
  }
  const inferredBeat=shotLocationBeatNumber(sh)==null && sh.referencePickerAll
    ? shotLocationInferBeat(scene,sh,drafts||C.drafts||{}) : null;
  const beatN=shotLocationBeatNumber(sh)!=null ? shotLocationBeatNumber(sh) : inferredBeat;
  const beatShot=beatN!=null ? {...sh,beatN} : sh;
  const source=!explicitSelection && beatN!=null
    ? shotLocationBeatSource(scene,beatShot,drafts||C.drafts||{}) : null;
  /* A numbered shot with no canonical typed source is not allowed to borrow the
     scene slugline: that would make a later Kitchen/Living Room entry leak into
     the target opening. */
  if(!explicitSelection && beatN!=null && (!source || !source.hasSource)) return [];
  const headings=source&&source.hasSource
    ? shotLocationBeatHeadings(scene,beatShot,drafts||C.drafts||{},source)
    : (!explicitSelection && beatN==null && scene&&scene.loc ? [shotLocationClean(scene.loc)] : []);
  /* A beat may contain a later cut/secondary slugline. The opening frame is
     anchored by its first typed slugline; the choices helper still exposes all
     compound units so a director can explicitly switch rooms. */
  const openingHeadings=headings.slice(0,1);
  const units=shotLocationEligibleUnits(loc,scene,allUnits);
  const selectedUnits=[], selectedKeys=new Set();
  const targetPlaces=[], targetSides=[];
  if(explicitSelection){
    units.forEach(u=>{
      const spec=shotLocationBuildUnitSpec(u);
      if(spec&&explicitIds.has(spec.id)){ selectedKeys.add(u.key); selectedUnits.push(u); }
    });
  }else{
    if(!openingHeadings.length) return [];
    for(const heading of openingHeadings){
      const parsed=shotLocationParseHeading(heading);
      if(!parsed) return [];
      const side=shotLocationHeadingSide(parsed,sh,loc,scene);
      const parsedPlace=shotLocationNorm(parsed.place);
      if(parsedPlace && targetPlaces.indexOf(parsedPlace)<0) targetPlaces.push(parsedPlace);
      if(side && targetSides.indexOf(side)<0) targetSides.push(side);
      const matches=shotLocationHeadingUnitCandidates(units,parsed,side);
      if(matches.length>1){
        /* Multiple same-name units (or a bare room with multiple TOD plates) is
           genuine ambiguity. Never sort-and-pick the first one. */
        return [];
      }
      if(!matches.length) continue;
      const u=matches[0];
      if(!selectedKeys.has(u.key)){ selectedKeys.add(u.key); selectedUnits.push(u); }
    }
  }
  const unitSpecs=selectedUnits.map(u=>{
    const spec=shotLocationBuildUnitSpec(u);
    if(!spec) return null;
    const owner=shotLocationCatalogUnitOwner(u,Array.isArray(C.locations)?C.locations:[loc])||loc;
    return {...spec,category:"unit",categoryLabel:shotLocationCategoryLabel("unit"),categories:["unit"],
      locationId:String(owner&&owner.id||loc.id),entityId:String(owner&&owner.id||loc.id),baseId:spec.id};
  }).filter(Boolean);
  const persistedSheets=Array.isArray(loc.coverageSheets)?loc.coverageSheets:[];
  // Always re-derive for this scene as well as reading persisted metadata. A screenplay
  // edit can introduce a Required Space Plate before the Locations tab has been reopened and
  // synced; the Add-shot picker must still discover it immediately.
  const derivedSheets=(typeof deriveLocationCoverageSheets==="function")
    ? deriveLocationCoverageSheets(loc,scene?[scene]:[],drafts||C.drafts||{},C.locations||[],C.sluglineUnits||[])
    : [];
  const sheets=[...persistedSheets];
  derivedSheets.forEach(v=>{ const i=sheets.findIndex(x=>x&&x.id===v.id); if(i>=0) sheets[i]={...sheets[i],...v}; else sheets.push(v); });
  const sameSceneNo=(a,b)=> Number.isFinite(Number(a))&&Number.isFinite(Number(b))
    ? Number(a)===Number(b)
    : String(a||"")===String(b||"");
  const sceneSheets = sheets.filter(v=>!scene || scene.no==null || !Array.isArray(v.sceneNos) || !v.sceneNos.length || v.sceneNos.some(no=>sameSceneNo(no,scene.no)));
  const selectedNames=selectedUnits.map(u=>shotLocationNorm(shotLocationUnitPlace(u))).filter(Boolean);
  const targetNames=Array.from(new Set(selectedNames.concat(targetPlaces))).filter(Boolean);
  const sheetSpecs = sceneSheets.map(v=>({ id:loc.id+"-"+v.id, category:"coverage",
    categoryLabel:shotLocationCategoryLabel("coverage"), categories:["coverage"],
    locationId:String(loc.id),entityId:String(loc.id),baseId:loc.id+"-"+v.id,
    coverageId:String(v.id), role:v.role||"", name:v.name||"",
    source:"screenplay-coverage",
    assetRole:"derived_reference", assetSourceQuality:"screenplay_coverage_full_frame",
    triggerWords:(v.triggerWords||[]).map(w=>String(w||"").toLowerCase()).filter(Boolean),
    note:(v.name||loc.name||"location")+" — screenplay-derived "+(v.role||"INT")+" Required Space Plate (one full-frame view)" }));
  const matches = sheetSpecs.filter(v=>{
    const role = String(v.role||"").toUpperCase();
    const headingsSide=selectedUnits.map(u=>String(u.intExt||"").toUpperCase()).filter(Boolean).concat(targetSides);
    if(headingsSide.length && headingsSide.every(s=>s!=="BOTH") && role && headingsSide.indexOf(role)<0) return false;
    const sheetText=shotLocationNorm([v.name,v.summary,v.scriptExcerpt].concat(v.triggerWords||[]).join(" "));
    const roomMatch=targetNames.some(name=>sheetText===name || sheetText.indexOf(name)>=0);
    const words=v.triggerWords||[];
    const textMatch=!targetNames.length && (!words.length || words.some(w=>text.indexOf(String(w||"").toLowerCase())>=0));
    return roomMatch || textMatch;
  });
  const allHigh = [...unitSpecs, ...matches].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
  // A director-selected list is authoritative, including an intentionally empty
  // selection. This lets a manually added shot use exactly the chosen location
  // anchors instead of silently re-introducing an automatic reference.
  if(sh && sh.referenceLocationsSet){
    const wanted = new Set(Array.isArray(sh.referenceLocationIds)?sh.referenceLocationIds:[]);
    return allHigh.filter(s=>wanted.has(s.id));
  }
  /* Picker and automatic renders intentionally share this already-resolved,
     beat-scoped list. A missing/cold unit remains a genuine unit id and is
     resolved asynchronously by shotResolveLocationSpecImages; it never becomes
     a master plate or a synthetic crop. */
  if(!allHigh.length) return [];
  return allHigh;
}
window.shotLocationSide = shotLocationSide;
window.shotLocationUnitCandidates = shotLocationHeadingUnitCandidates;
window.shotLocationBeatHeadings = shotLocationBeatHeadings;
window.shotLocationReferenceChoices = shotLocationReferenceChoices;
window.shotLocationCoverageSpecs = shotLocationCoverageSpecs;

/* ---- SCALE & POV --------------------------------------------------------------
   A character/creature/prop carries a SCALE CLASS that does two jobs: it sets a
   canonical height (for the scale sheet's ruler) AND, more powerfully, it
   recontextualizes how the WORLD is described from that subject's physical point of
   view — a tiny critter sees colossal architecture; a giant sees a fragile diorama.
   The class is the source of truth (A/B/C); `height` is an optional display string.
   This is a third axis, orthogonal to LOOK (Lookbook) and COVERAGE (shot designer). */
const SCALE_CLASSES = {
  A: { id:"A", label:"Human", short:"Human scale",
       ruler:["0cm","50cm","100cm","150cm","180cm","200cm"], rule:"", keywords:[] },
  B: { id:"B", label:"Small / critter", short:"Critter scale",
       ruler:["0cm","2cm","5cm","10cm","20cm","40cm"],
       rule:"GIGANTISM RULE — this subject is tiny, so render the surrounding environment as MASSIVE architecture seen from its point of view: everyday objects become colossal structures (a dewdrop is a massive water sphere, a leaf a leathery emerald canopy).",
       keywords:["towering","colossal","skyscraper-sized","monolithic","cavernous"] },
  C: { id:"C", label:"Massive / giant", short:"Giant scale",
       ruler:["0m","5m","15m","30m","60m","100m"],
       rule:"MINIATURIZATION RULE — this subject is enormous, so render the world as a fragile diorama far below: landscapes become tabletop miniatures (a pine forest is a carpet of moss, a river a silver thread).",
       keywords:["matchbox-sized","lilliputian","miniature","carpet-like","threads"] },
  D: { id:"D", label:"Microscopic / sub-insect", short:"Microscopic scale",
       ruler:["0µm","200µm","400µm","600µm","800µm","1000µm"],
       rule:"EXTREME GIGANTISM RULE — this subject is microscopic, so render the surrounding world as a COLOSSAL molecular / cellular realm seen from within: dust motes become boulders, a single water droplet a vast trembling wall held by surface tension, fibres and pollen grains become towering structures, and the very medium (air, water) becomes a tangible, visible environment.",
       keywords:["molecular","cellular","boulder-sized dust mote","surface-tension wall","fibrous canyon","particulate haze"] },
};
/* the scale class of an entity (character/prop): the explicit field wins; otherwise
   derive a best-effort class from a numeric height, else default to Human. */
function scaleClassOf(entity){
  const raw = String((entity && entity.scaleClass) || "").trim();
  const u = raw.toUpperCase();
  // an explicit "Class X" is the STRONGEST signal — it wins even over a co-occurring descriptor
  // ("Class D · Insect" is D, not B) and can't be a false article match (it requires the word CLASS)
  let m = u.match(/\bCLASS\s*([ABCD])\b/); if(m) return m[1];
  // keyword sense next — so a stray article ("a towering giant") can't be misread as a bare letter
  if(/GIANT|MASSIVE|COLOSSAL|TITAN|KAIJU|MECH|MONSTER|HUGE|TOWERING/.test(u)) return "C";
  if(/MICROSCOPIC|MICRO\b|MICRON|CELLULAR|MICROBE|BACTERIA|NANO|SUB.?INSECT|MITE|AMOEBA|PLANKTON|MOLECULAR/.test(u)) return "D";
  if(/CRITTER|TINY|SMALL|INSECT|BUG|MINIATURE|MOUSE|FAIRY|SPRITE|PIXIE/.test(u)) return "B";
  if(/HUMAN|STANDARD|NORMAL|PERSON|REGULAR/.test(u)) return "A";
  // the whole value IS a bare class letter — "B", "B (critter)", "C - giant", "A:"
  m = u.match(/^([ABCD])(\s*[(\-:].*)?$/); if(m) return m[1];
  // numeric height fallback — convert to cm understanding µm / mm / m units (default cm)
  const hs = String(entity && (entity.heightCm||entity.height) || "");
  const h = Number(hs.replace(/[^\d.]/g,""));
  if(h){ const isUm=/(µ|μ|micron|micromet|\bum\b)/i.test(hs), isMM=/mm|millimet/i.test(hs),
           isM=/(\d\s*m\b|metre|meter)/i.test(hs) && !/cm/i.test(hs) && !isMM && !isUm;
    const cm = isUm ? h*0.0001 : isMM ? h*0.1 : isM ? h*100 : h;
    if(cm < 0.1) return "D"; if(cm < 60) return "B"; if(cm > 300) return "C"; return "A"; }
  return "A";
}
function scaleInfoOf(entity){ return SCALE_CLASSES[scaleClassOf(entity)] || SCALE_CLASSES.A; }
function scaleMeasurementOf(entity){
  const raw = String(entity && (entity.height||entity.heightCm||entity.scale||"") || "").replace(/\s+/g," ").trim();
  const mm = (typeof heightMMOf==="function") ? heightMMOf(entity) : 0;
  if(mm>0){
    if(mm<1) return (Math.round((mm*1000)*10)/10)+" µm";
    if(mm>=1000) return (Math.round((mm/1000)*100)/100)+" m";
    if(mm>=100) return (Math.round((mm/10)*10)/10)+" cm";
    return (Math.round(mm*10)/10)+" mm";
  }
  return raw;
}
function canonicalScaleLabel(entity){
  const bits = [];
  if(entity && entity.name) bits.push(entity.name);
  const h = scaleMeasurementOf(entity);
  if(h) bits.push(h);
  bits.push(scaleInfoOf(entity).short);
  return bits.join(" — ");
}
function relativeHeightSentence(a,b){
  const ah = (typeof heightMMOf==="function") ? heightMMOf(a) : 0;
  const bh = (typeof heightMMOf==="function") ? heightMMOf(b) : 0;
  if(!(ah>0 && bh>0)) return "";
  const taller = ah>=bh ? a : b, shorter = ah>=bh ? b : a;
  const th = Math.max(ah,bh), sh = Math.min(ah,bh);
  const ratio = th/sh;
  const pct = Math.round((sh/th)*100);
  const rn = Math.round(ratio*10)/10;
  return (taller.name||"The taller subject")+" must read about "+rn+"× taller than "+(shorter.name||"the shorter subject")+
    "; "+(shorter.name||"the shorter subject")+" is about "+pct+"% of "+(taller.name||"the taller subject")+"'s height.";
}
function firstMeasurementText(text){
  const s = String(text||"").replace(/\s+/g," ").trim();
  const m = s.match(/(?:~|about|approx(?:imately)?\s*)?(\d+(?:\.\d+)?)\s*(µm|μm|um|microns?|micromet(?:er|re)s?|mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?)\b/i);
  if(!m) return "";
  const unit = m[2].toLowerCase();
  const pretty = /^(µm|μm|um|micron|microns|micrometer|micrometre|micrometers|micrometres)$/.test(unit) ? "µm"
    : /^mm|millimet/.test(unit) ? "mm"
    : /^cm|centimet/.test(unit) ? "cm"
    : "m";
  return m[1]+" "+pretty;
}
function propPhysicalScaleLabel(p){
  if(!p) return "";
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim().replace(/\.$/,"");
  const bits = [];
  if(p.name) bits.push(p.name);
  // the size FIELD carries the full dimension set ("~1.2 m tall × ~60 cm wide × ~45 cm
  // deep") — pass it through VERBATIM so no axis is lost; only fall back to scanning
  // prose for a first measurement when the field is empty
  const sizeField = clean(p.size || p.dimensions || "");
  const explicit = (sizeField && firstMeasurementText(sizeField))
    ? sizeField
    : firstMeasurementText([p.scale, p.form, p.material, p.detail].filter(Boolean).join(" "));
  if(explicit) bits.push("described size "+explicit);
  if(p.kind==="worn") bits.push("worn true-to-body scale"+(p.ownerName?(" on "+p.ownerName):""));
  else if(p.kind==="carried" || p.ownerName) bits.push("handheld/carried scale"+(p.ownerName?(" for "+p.ownerName):""));
  else bits.push("environment/set-dressing scale");
  // owner-relative proportions ("hangs to mid-thigh") — keeps the object its size next
  // to its owner in shots; skipped when it merely repeats the size field
  const relScale = clean(p.scale);
  if(relScale && relScale!==explicit) bits.push((p.ownerName?("against "+p.ownerName+"'s body: "):"")+relScale);
  const form = (typeof clipWords==="function") ? clipWords(clean(p.form),90) : clean(p.form).slice(0,90);
  if(form && !explicit) bits.push(form);
  return bits.join(" — ");
}
/* SHOT-LEVEL ATTACH POLICY for SET-DRESSING sheets. The location plate is the canonical
   carrier for fixtures — it shows them in context at true scale — so a dressing sheet
   only rides as a reference image when the plate can't do the job: a TIGHT shot
   (CU/MCU/ECU/INSERT) or the object being what the action is ABOUT (named in the
   action's first clause). Wides and mediums trust the plate — one canon per fixture,
   no two-designs conflict, no wasted reference slot. Worn/carried props are untouched.
   Used by buildShotPrompt (image-map labels) and collectShotRefs (real
   attachments) — both MUST apply it identically or labels mislabel files. */
function shotPropAttachable(p, sh, scene){
  if(!p) return false;
  const resolved=(typeof propStateAt==="function")
    ? propStateAt(p,(scene&&scene.id)||(sh&&sh.sceneId),sh&&sh.beatN,sh&&sh.microBeatId,sh&&sh.id,window.turnContinuity||{}) : null;
  const binding=(resolved&&resolved.bindingMode)||p.bindingMode||p.kind||"carried";
  // WORN items: the owner's character sheet is their canon in wides/mediums (they
  // ride as TEXT there). An optional per-card CLOSE-UP sheet attaches ONLY when the
  // item reads large (CU/MCU/ECU/INSERT) AND that sheet has actually been generated.
  // Existence is checked on the SYNC cache so the prompt's numbered image map and
  // the async attach paths always agree (cold cache = consistently skipped).
  if(binding==="worn"){
    if(!/^(CU|MCU|ECU|INSERT)$/i.test(String((sh&&sh.size)||""))) return false;
    try{ return !!(typeof nbGetImage==="function" && nbGetImage(p.id)); }catch(e){ return false; }
  }
  // TEXT-ONLY objects (reviewed evidence says no own image, and none exists) ride as
  // text in the prompt — never attached, never auto-generated at render time.
  if(typeof propTextOnly==="function" && propTextOnly(p)) return false;
  if(binding!=="dressing") return true;
  // TIGHT SHOTS keep the dressing sheet: at CU/MCU magnification a background object
  // reads LARGE, and the plate's small distant depiction can't hold its design — the
  // sheet's detail is needed. Wides rely on the plate (it renders dressing in place).
  if(/^(CU|MCU|ECU|INSERT)$/i.test(String((sh&&sh.size)||""))) return true;
  /* SUBJECT test — in-frame props are derived from the action text, so "named in the
     action" is true for every prop that gets here; what marks the shot as ABOUT the
     object is the object LEADING the action ("The hollow log splits open…") rather
     than a character leading it ("Flicker creeps past the hollow log…"). */
  const act = " "+String((sh&&sh.action)||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ")+" ";
  const words = String(p.name||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").split(/\s+/).filter(w=>w.length>2);
  if(!words.length) return false;
  const idxs = words.map(w=>act.indexOf(" "+w+" "));
  if(idxs.some(i=>i<0)) return false;
  const objAt = Math.min.apply(null, idxs);
  const chars = ((window.turnContinuity||{}).characters)||[];
  const before = act.slice(0, objAt);
  const charLeads = chars.some(c=>{
    const n = String((c&&c.name)||"").toLowerCase().split(/\s+/)[0];
    return n && n.length>2 && before.indexOf(" "+n)>=0;
  });
  return !charLeads;
}
window.shotPropAttachable = shotPropAttachable;

function shotObjectScaleClause(subjects, props, loc){
  const cast = (subjects||[]).filter(Boolean);
  const pr = (props||[]).filter(Boolean);
  if(!cast.length && !pr.length && !loc) return "";
  const classes = [...new Set(cast.map(scaleClassOf))];
  const cls = classes.filter(c=>c!=="A")[0] || "";
  const measured = cast.map(c=>({ c, mm:(typeof heightMMOf==="function") ? heightMMOf(c) : 0 })).filter(x=>x.mm>0).sort((a,b)=>a.mm-b.mm);
  const range = measured.length
    ? (" visible character height range "+scaleMeasurementOf(measured[0].c)+"–"+scaleMeasurementOf(measured[measured.length-1].c))
    : "";
  const bits = [];
  if(loc){
    let env = "the "+(loc.name||"location")+" plate is the canonical environment scale; its architecture, floor plane, plants, bark, droplets, furniture, set dressing and surface textures must keep their own physical proportions";
    if(cls==="B") env += " and read gigantic around critter-scale bodies"+range;
    else if(cls==="D") env += " and read as a colossal particulate/cellular world around microscopic bodies"+range;
    else if(cls==="C") env += " and read miniature beneath giant-scale bodies"+range;
    bits.push(env);
  }
  if(pr.length) bits.push("prop scales: "+pr.map(propPhysicalScaleLabel).join("; "));
  if(!bits.length) return "";
  return "OBJECT / ENVIRONMENT SCALE CONTINUITY — "+bits.join(". ")+
    ". Do NOT resize props, set dressing, plants, droplets, architecture, floor texture or environmental assets to make the composition easier; stage the camera instead so every object remains physically consistent with the characters and location.";
}
/* The dynamic scale directive for a SHOT, given the cast in frame. All-human → "" (no
   rewrite, inert). One non-human class → that class's world rewrite. MIXED classes in
   one frame → relative-scale phrasing (don't apply a single POV; show their size gap). */
function shotScaleClause(subjects, props){
  const list = (subjects||[]).filter(Boolean);
  if(!list.length) return "";
  const classes = [...new Set(list.map(scaleClassOf))];
  const nonHuman = classes.filter(c=>c!=="A");
  const measured = list.map(c=>({ c, mm:(typeof heightMMOf==="function") ? heightMMOf(c) : 0 })).filter(x=>x.mm>0).sort((a,b)=>b.mm-a.mm);
  const heightLine = measured.length
    ? " Canonical heights in this frame: "+measured.map(x=>canonicalScaleLabel(x.c)).join("; ")+"."
    : "";
  const relLine = measured.length>=2 ? (" "+relativeHeightSentence(measured[0].c, measured[measured.length-1].c)) : "";
  const propLine = (props||[]).filter(Boolean).length
    ? " Keep nearby props and set dressing at the same physical scale as the location; characters must not resize to match prop framing."
    : "";
  if(!nonHuman.length){
    if(measured.length>=2) return "SCALE CONTINUITY — preserve the cast's relative heights exactly."+heightLine+relLine+" Do NOT normalize characters to the same eye-line or same head size."+propLine;
    return "";
  }
  if(classes.length>1){
    const named = list.map(c=> (c.name||"a figure")+" ("+scaleInfoOf(c).short+")").join(", ");
    return "SCALE CONTINUITY — the subjects differ in scale ("+named+")."+heightLine+relLine+" Render their RELATIVE sizes faithfully (the larger truly dwarfing the smaller); do NOT normalize them to the same height, eye-line or head size."+propLine;
  }
  const info = SCALE_CLASSES[nonHuman[0]];
  if(measured.length>=2){
    return "SCALE CONTINUITY — all visible subjects share "+info.short+", but their individual heights still matter."+heightLine+relLine+
      " Preserve this size gap within the same shot; do NOT normalize them to the same height, eye-line or head size. "+info.rule+" Lean on words like "+info.keywords.join(", ")+". "+propLine;
  }
  return "SCALE / POV — "+heightLine+" "+info.rule+" Lean on words like "+info.keywords.join(", ")+".";
}
/* HEIGHT-AWARE measurement ruler for a scale sheet. The figure must read against the bar, so
   the markings span ~0 to a bit above the character's ACTUAL height, in the right unit
   (mm/cm/m) — a 14 mm insect gets a 0–20 mm ruler, not the coarse 0–40 cm class default.
   Falls back to the class ruler only when no height is parseable. Returns label strings. */
// normalise a character's height to MILLIMETRES (0 if not parseable). Unit is read from the
// text; with no unit it's guessed from the scale class (giant→m, critter→mm, human→cm).
function heightMMOf(entity){
  const hs = String((entity && (entity.height||entity.heightCm)) || "").trim();
  const num = parseFloat(hs.replace(/[^0-9.]/g,"")); if(!(isFinite(num) && num>0)) return 0;
  const cls = scaleClassOf(entity);
  if(/µm|μm|micron|micromet|\bum\b/i.test(hs)) return num*0.001;
  if(/mm|millimet/i.test(hs)) return num;
  if(/cm|centimet/i.test(hs)) return num*10;
  if(/\d\s*m\b|metre|meter/i.test(hs)){
    // Explicit scale class wins over a bad/over-generic height unit from drafting.
    // A Class B critter must never receive a metre ruler because its height text says
    // "2.5 m"; ignore that invalid unit and fall back to the class ruler instead.
    if(cls==="B" || cls==="D") return 0;
    return num*1000;
  }
  return cls==="C" ? num*1000 : cls==="D" ? num*0.001 : cls==="B" ? num : num*10;
}
function scaleRulerFor(entity){
  const cls = scaleClassOf(entity);
  const mm = heightMMOf(entity);
  if(mm>0){
    const niceCeil=(x)=>{ if(x<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(x))); for(const m of [1,2,2.5,5,10]){ if(p*m>=x) return p*m; } return p*10; };
    const topMM = niceCeil(mm*1.2);                          // a little headroom above the figure
    let unit, div;
    if(cls==="B"){
      if(topMM>=1){ unit = topMM>=100 ? "cm" : "mm"; div = topMM>=100 ? 10 : 1; }
      else { unit="µm"; div=0.001; }
    } else if(cls==="D"){
      unit="µm"; div=0.001;
    } else if(topMM>=1000){ unit="m"; div=1000; } else if(topMM>=100){ unit="cm"; div=10; } else if(topMM>=1){ unit="mm"; div=1; } else { unit="µm"; div=0.001; }
    const ticks=[]; for(let i=0;i<=5;i++){ let v=Math.round((topMM*i/5)/div*100)/100; ticks.push(v+unit); }
    return ticks;
  }
  return ((window.SCALE_CLASSES&&window.SCALE_CLASSES[cls])||SCALE_CLASSES.A).ruler;
}
window.heightMMOf = heightMMOf; window.scaleRulerFor = scaleRulerFor;
window.scaleMeasurementOf = scaleMeasurementOf; window.canonicalScaleLabel = canonicalScaleLabel;
window.propPhysicalScaleLabel = propPhysicalScaleLabel; window.shotObjectScaleClause = shotObjectScaleClause;
// Environment-scale directive for a LOCATION plate, keyed to its occupants' scale class.
// B → render the SPACE itself at critter scale (gigantism); C → at giant scale. A → "" (inert).
// This is the location-side counterpart to shotScaleClause (which works on in-frame subjects).
function worldScaleClause(cls){
  if(cls==="B") return "CRITTER SCALE — render this as a colossal, cavernous space exactly as a tiny insect-sized inhabitant (a couple of centimetres tall) would experience it: ordinary natural features (bark grain, a knot-hole, moss, a fallen leaf, a dewdrop) read as TOWERING architecture, landmarks and furniture at that scale; the whole space is built for and seen by something tiny.";
  if(cls==="C") return "GIANT SCALE — render this as a vast expanse seen by an enormous, building-sized inhabitant: the ordinary world reads as a fragile MINIATURE diorama far below — structures matchbox-sized, paths like threads.";
  if(cls==="D") return "MICROSCOPIC SCALE — render this as a vast molecular / cellular realm seen by a microscopic inhabitant: dust motes read as boulders, a single water droplet as a towering trembling wall held by surface tension, fibres and pollen grains as colossal structures, and the very medium (air, water) becomes a visible, tangible environment.";
  return "";
}
window.SCALE_CLASSES = SCALE_CLASSES; window.scaleClassOf = scaleClassOf;
window.scaleInfoOf = scaleInfoOf; window.shotScaleClause = shotScaleClause; window.worldScaleClause = worldScaleClause;

/* The SCALE SHEET prompt (the user's "height chart" / Option A): a full-body front view
   beside a vertical ruler whose markings come from the entity's scale class. Built from the
   character's body + texture + height; rendered FROM the master sheet so identity matches. */
function buildScaleSheetPrompt(c){
  const info = scaleInfoOf(c);
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim().replace(/\.$/,"");
  // (2026-10-12, Character fidelity) the body plus its distinguishing features — face marks drop with a likeness
  const body = clean(c && ((typeof window.charBodyWithFeatures==="function")
    ? window.charBodyWithFeatures(c, { likeness:(typeof window.charLikenessGivesFace==="function") && window.charLikenessGivesFace(c) })
    : (c.coreBody||c.look))) || "the character";
  const tex  = clean(c && c.materialTexture);
  const ht   = clean(c && c.height);
  const ruler = ((typeof scaleRulerFor==="function") ? scaleRulerFor(c) : info.ruler).join(", ");
  const cls = scaleClassOf(c);
  const unitRule = cls==="B"
    ? "CRITTER SCALE: the ruler must use millimetres or centimetres only; NEVER use metres or an 'm' unit. "
    : cls==="D"
      ? "MICROSCOPIC SCALE: the ruler must use micrometres (µm) only; NEVER use mm, cm, metres or an 'm' unit. "
      : cls==="C"
        ? "GIANT SCALE: metre markings are allowed. "
        : "";
  return "A full-body FRONT view of "+body+(tex?(", "+tex):"")+". "
    + (ht?("The figure is "+ht+" tall. "):"")
    + "They stand in a relaxed, neutral pose, head to toe fully in frame, against a solid light-grey studio background, "
    + "directly beside a VERTICAL measurement bar positioned on the LEFT edge. "
    + unitRule+"The bar strictly displays height markings for "+ruler+" in clear black text. "
    + "Soft, even studio lighting, sharp focus. No text anywhere except the ruler's numeric markings.";
}
window.buildScaleSheetPrompt = buildScaleSheetPrompt;

/* props that appear in a scene (their scene chips include this scene) */
function propsForScene(props, sceneId){
  if(typeof propStateAt==="function"){
    const C={...(window.turnContinuity||{}),props:props||[]};
    return (props||[]).filter(p=>{ const s=propStateAt(p,sceneId,null,null,null,C); return s&&s.active; });
  }
  return (props||[]).filter(p=> Array.isArray(p.scenes) && p.scenes.indexOf(sceneId)>=0);
}
window.propsForScene = propsForScene;


/* ---- depth-grid framing scoped to a shot SIZE --------------------------------- */
/* The location owns the canonical 3×3 depth grid. A shot SIZE decides how much of
   it is in frame: wides show the whole grid (walls + floor); tighter sizes pull the
   subject (midground centre) and any foreground veil. Returns a short clause that
   tells the model which depth planes to feature for THIS shot. */
function shotFramingClause(location, sizeId){
  if(!location || typeof stagingOf!=="function" || (typeof stagingHasContent==="function" && !stagingHasContent(location))) return "";
  const s = stagingOf(location);
  const wide = ["EWS","WS","FS","MWS"].indexOf(sizeId)>=0;
  const bits = [];
  if(wide){
    if(s.bg.center) bits.push("background landmark: "+s.bg.center.replace(/\.$/,""));
    if(s.mid.left)  bits.push("left frame edge: "+s.mid.left.replace(/\.$/,""));
    if(s.mid.right) bits.push("right frame edge: "+s.mid.right.replace(/\.$/,""));
    if(s.fg.left)   bits.push("foreground left: "+s.fg.left.replace(/\.$/,""));
    if(s.fg.right)  bits.push("foreground right: "+s.fg.right.replace(/\.$/,""));
    if(s.floor)     bits.push("ground plane: "+s.floor.replace(/\.$/,""));
    if(!bits.length) return "";
    return "DEPTH FRAMING (this location's staging, layered for parallax): "+bits.join("; ")+". ";
  }
  // tight sizes: subject dominant, landmarks fall to soft background
  if(s.bg.center) bits.push("the "+s.bg.center.replace(/\.$/,"")+" reads softly out of focus behind");
  if(s.fg.left||s.fg.right){ const fg = s.fg.left||s.fg.right; bits.push("a foreground element ("+fg.replace(/\.$/,"")+") veils an edge for depth"); }
  if(!bits.length) return "";
  return "DEPTH FRAMING: subject dominant in a shallow plane; "+bits.join("; ")+". ";
}
window.shotFramingClause = shotFramingClause;


/* Preserve screen direction through the rolling chain. Shot specs are drafted
   before frames exist, so their prose can contradict the approved predecessor
   (e.g. "Vanya right-of-frame" after she was established left). Read explicit
   sides from the previous shot's blocking, infer the opposite side for a
   two-person setup, and remove contradictory side clauses from this prompt. */
function shotScreenDirection(prevShot, subjects, composition){
  if(!prevShot || !(subjects||[]).length) return { composition, clause:"" };
  const prior = [prevShot.composition, prevShot.action].filter(Boolean).join(". ");
  const esc = (s)=>String(s||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const aliases = (c)=>{
    const full=String(c.name||"").trim();
    const bits=full.split(/[\s_-]+/).filter(Boolean);
    return Array.from(new Set([full, bits[0], bits.length>1?bits[bits.length-1]:""].filter(Boolean)));
  };
  const sides = {};
  (subjects||[]).forEach(c=>{
    let best=null;
    aliases(c).some(name=>{
      const re = new RegExp("\\b"+esc(name)+"\\b([^.;]{0,55})","i");
      const m = prior.match(re);
      if(!m) return false;
      const side = m[1].match(/\b(left|right)(?:[- ](?:of[- ]frame|hand|side|third))?\b/i);
      if(side){ best=side[1].toLowerCase(); return true; }
      return false;
    });
    if(best) sides[c.id]=best;
  });
  const known = Object.keys(sides);
  if((subjects||[]).length===2 && known.length===1){
    const other = subjects.find(c=>!sides[c.id]);
    if(other) sides[other.id] = sides[known[0]]==="left" ? "right" : "left";
  }
  if(!Object.keys(sides).length) return { composition, clause:"" };

  // Drop only comma/semicolon clauses that attach a conflicting side to a named
  // character. The rest of the composition (depth, lens falloff, smoke, etc.) stays.
  const chunks = String(composition||"").split(/([,;])/);
  const kept = [];
  for(let i=0;i<chunks.length;i+=2){
    const text=chunks[i]||"", sep=chunks[i+1]||"";
    const names=(subjects||[]).some(c=>aliases(c).some(n=>new RegExp("\\b"+esc(n)+"\\b","i").test(text)));
    const hasSide=/\b(left|right)(?:[- ](?:of[- ]frame|hand|side|third))?\b/i.test(text);
    if(!(names&&hasSide)){ kept.push(text); if(sep) kept.push(sep); }
  }
  let cleanComp=kept.join("").replace(/^[,;\s]+|[,;\s]+$/g,"").replace(/([,;])\s*([,;])/g,"$1").trim();
  const sideText=(subjects||[]).filter(c=>sides[c.id]).map(c=>(c.name||"Subject")+" remains on the "+sides[c.id]+" side of frame").join("; ");
  return {
    composition:cleanComp,
    clause:"SCREEN DIRECTION CONTINUITY: match the reference frame's axis and eyelines; "+sideText+". Do not flip or mirror their established positions.",
  };
}
window.shotScreenDirection = shotScreenDirection;

/* ---- the SHOT's RENDER STYLE. Shots composite the Art Room sheets, so the frame
   must speak the SAME language those sheets were rendered in — a hardcoded photoreal
   spine on top of Pixar/anime sheets makes the model fight its own references.
   Resolution: majority vote across the in-frame cast's style (explicit pick or the
   inferred default), then the location's picked style, then photoreal. Tuned shot
   phrasings for the photoreal family; every other style (incl. locked 🔒 and admin 🌐
   styles) falls back to its own registry descriptor, so a new style works here from
   one definition — same pattern as renderStyleText(). ---- */
const SHOT_RENDER_TEXT = {
  photoreal:           "Cinematic live-action photorealistic still",
  photorealNatural:    "Cinematic photorealistic natural-history still — real biological macro realism, believable creature-scale world",
  photorealCreature:   "Cinematic live-action photorealistic still — practical-effects / VFX creature-film realism",
  photorealOrnamental: "Cinematic live-action photorealistic still — ornamental couture creature-world production design",
  horror:              "Cinematic live-action photorealistic horror still — deep filmic blacks",
};
window.SHOT_RENDER_TEXT = SHOT_RENDER_TEXT;
function shotRenderStyleKey(subjects, loc){
  const keys = [];
  (subjects||[]).forEach(c=>{ if(!c) return;
    const k = (typeof inferCharacterRenderStyleKey==="function") ? inferCharacterRenderStyleKey(c) : (c.renderStyleKey||"");
    if(k) keys.push(k); });
  if(!keys.length && loc && loc.renderStyleKey && loc.renderStyleKey!=="surprise") keys.push(loc.renderStyleKey);
  if(!keys.length) return "photoreal";
  const tally = {}; let best = keys[0], n = 0;
  keys.forEach(k=>{ tally[k]=(tally[k]||0)+1; if(tally[k]>n){ n=tally[k]; best=k; } });
  return best;
}
window.shotRenderStyleKey = shotRenderStyleKey;
function shotStyleIsPhotoreal(key){ return /^(photoreal|horror)/.test(String(key||"photoreal")); }
function shotRenderStyleLine(key, subjects){
  if(SHOT_RENDER_TEXT[key]) return SHOT_RENDER_TEXT[key];
  if(key==="surprise"){
    const c = (subjects||[]).find(x=>x && x.surpriseRender && x.surpriseRender.render && x.surpriseRender.render.rendering);
    if(c) return "Cinematic still in the film's locked render style: "+String(c.surpriseRender.render.rendering).replace(/\bcharacter\b/gi,"scene");
  }
  const cs = (window.CHAR_RENDER_STYLES||{})[key];
  if(cs && cs.rendering) return "Cinematic still in the film's locked render style: "+String(cs.rendering).replace(/\bcharacter\b/gi,"scene");
  return SHOT_RENDER_TEXT.photoreal;
}
window.shotRenderStyleLine = shotRenderStyleLine;

/* The scene-level location may be a compound continuity root because the scene
   moves through several rooms. A shot must instead take its prose, depth grid and
   scale anchor from the resolved beat reference's exact child space. Otherwise a
   Kitchen plate can be paired with Living Room furniture and staging in text. */
function shotPromptLocation(baseLoc,specs,ctx){
  const C=window.turnContinuity||{};
  const locations=(ctx&&Array.isArray(ctx.locations)&&ctx.locations.length)
    ?ctx.locations:(Array.isArray(C.locations)?C.locations:[]);
  const ids=Array.from(new Set((specs||[]).filter(s=>s&&!s.unavailable&&s.locationId)
    .map(s=>String(s.locationId))));
  if(ids.length===1){
    const exact=locations.find(l=>l&&String(l.id)===ids[0]);
    if(exact) return exact;
  }
  return baseLoc||null;
}
function shotSpaceBindingClause(baseLoc,promptLoc,ctx){
  if(!promptLoc)return "";
  const C=window.turnContinuity||{};
  const locations=(ctx&&Array.isArray(ctx.locations)&&ctx.locations.length)
    ?ctx.locations:(Array.isArray(C.locations)?C.locations:[]);
  const key=String(promptLoc.key||"");
  const parentKey=String(promptLoc.parentKey||"");
  const parent=parentKey?locations.find(l=>l&&String(l.key||"")===parentKey):null;
  const exactChanged=!!(baseLoc&&String(baseLoc.id)!==String(promptLoc.id));
  if(!parent&&!exactChanged)return "";
  const siblings=parentKey?locations.filter(l=>l&&l!==promptLoc&&String(l.parentKey||"")===parentKey)
    .map(l=>String(l.name||"").trim()).filter(Boolean):[];
  const where=parent?((promptLoc.name||"this space")+" inside "+(parent.name||"the continuity root")):(promptLoc.name||"the selected space");
  return "SHOT SPACE (binding): depict only "+where+". Use the enclosing continuity root only for shared topology, scale and non-conflicting material identity"
    +(siblings.length?"; do not import furniture, fixtures or depth staging from sibling spaces such as "+siblings.join(" or "):"")
    +".";
}
function shotScopedStyleField(value,promptLoc,ctx){
  const raw=String(value||"").trim();
  if(!raw||!promptLoc||!promptLoc.parentKey)return raw;
  const C=window.turnContinuity||{};
  const locations=(ctx&&Array.isArray(ctx.locations)&&ctx.locations.length)
    ?ctx.locations:(Array.isArray(C.locations)?C.locations:[]);
  const siblings=locations.filter(l=>l&&l!==promptLoc&&String(l.parentKey||"")===String(promptLoc.parentKey));
  if(!siblings.length)return raw;
  const body=l=>[l&&l.name,l&&l.architecture,l&&l.materials,l&&l.lighting,l&&l.permanentDressing,
    l&&l.topology,l&&l.continuityAnchors,JSON.stringify(l&&l.staging||{})].filter(Boolean).join(" ").toLowerCase();
  const normToken=w=>w.length>4&&w.endsWith("s")?w.slice(0,-1):w;
  const tokensOf=text=>String(text||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").split(/\s+/).filter(Boolean).map(normToken);
  const current=new Set(tokensOf(body(promptLoc)));
  const stop=new Set(["this","that","with","from","into","inside","outside","location","interior","exterior",
    "room","space","house","frame","edge","background","foreground","center","centre","left","right",
    "wall","walls","floor","light","lighting","camera","shot","furniture","material","materials","scale"]);
  const forbidden=new Set;
  siblings.forEach(l=>tokensOf(body(l)).forEach(w=>{
    if(w.length>=4&&!stop.has(w)&&!current.has(w))forbidden.add(w);
  }));
  if(!forbidden.size)return raw;
  const clauses=raw.split(/[.;,:]+/).map(x=>x.trim()).filter(Boolean);
  const kept=clauses.filter(clause=>{
    const words=tokensOf(clause);
    return !words.some(w=>forbidden.has(w));
  });
  return kept.join(", ");
}
window.shotPromptLocation=shotPromptLocation;
window.shotSpaceBindingClause=shotSpaceBindingClause;
window.shotScopedStyleField=shotScopedStyleField;

/* ---- THE COMPOSER: a shot → one final image prompt ---------------------------- */
/* ctx = { scene, location, charById, propById, project, prevShot } */
/* SCREENPLAY SLICE — the beat's own script lines (action + dialogue), pulled from the
   scene's draft blocks (every block is beat-tagged by realignBlockBeats; both shot-
   creation paths store sh.beatN). Rides in the shot prompt as FIDELITY text — the
   exact business and wording of the beat — SUBORDINATE to the staging line, which
   still decides framing and who's in frame. Fail-safe: no beat number, no draft, or
   no blocks tagged to the beat → "" and the prompt is unchanged. */
 function shotBeatSource(scene, beatN, ctx, chars){
   if(typeof window.shotBeatScreenplay!=="function" || !scene) return null;
   ctx=ctx||{};
   /* Render contexts are authoritative.  The global continuity object is only a
      fallback for old/manual callers that have no live context at all. */
   const opts=Object.prototype.hasOwnProperty.call(ctx,"drafts")
      ? {drafts:(Array.isArray(ctx.drafts)||(ctx.drafts&&Array.isArray(ctx.drafts.blocks)))
          ? {[scene.id]:ctx.drafts} : (ctx.drafts||{}),
         characters:chars||Object.values(ctx.charById||{}),
        beatsMap:ctx.beatsMap||{}} : undefined;
   try{ return window.shotBeatScreenplay(scene,beatN,opts); }catch(e){ return null; }
 }
 function shotScreenplaySlice(scene, beatN, ctx){
   const source=shotBeatSource(scene,beatN,ctx);
   if(!source||!source.hasSource) return "";
   return String(source.text||"").replace(/\s+/g," ").trim();
 }
 window.shotBeatSource=shotBeatSource;
window.shotScreenplaySlice = shotScreenplaySlice;

function buildShotPrompt(sh, ctx){
  ctx = ctx || {};
  const scene = ctx.scene || {};
  const loc = ctx.location || null;
  const charById = ctx.charById || {};
  const propById = ctx.propById || {};
   const _sceneContext = ctx.sceneContext
     || ((typeof shotSceneContextPlan==="function") ? shotSceneContextPlan(sh,ctx) : null);
  // in-frame cast & props are DERIVED from the action text (inFrameCast/inFrameProps),
  // not the stored tags — so they're always accurate to what the frame actually shows.
   const _chars = Object.values(charById);
   const screenplaySource=shotBeatSource(scene,sh&&sh.beatN,ctx,_chars);
   const subjects = ((typeof inFrameCast==="function") ? inFrameCast(sh, scene, _chars, ctx) : (sh.subjects||[])).map(id=>charById[id]).filter(Boolean);
   const propsAll = ((typeof inFrameProps==="function") ? inFrameProps(sh, scene, charById, propById, ctx) : (sh.props||[])).map(id=>propById[id]).filter(Boolean);
  // ATTACHED prop sheets (the image-map entries): dressing sheets ride only on tight
  // shots / when the object is the action's subject — wides trust the plate. The SCALE
  // clauses below still see propsAll: an in-plate fixture stays scale-constrained.
  // WORN items ride as TEXT by default (their canon is the owner's character sheet
  // — numbering them once produced prompts naming "Image 5..13" with 4 files
  // attached). EXCEPTION: a worn item with a generated CLOSE-UP sheet on a tight
  // shot IS attached — shotPropAttachable owns that rule for prompt + attach alike.
  const wornProps = propsAll.filter(p=> {
    const rs=(typeof propStateAt==="function")?propStateAt(p,scene.id,sh.beatN,sh.microBeatId,sh.id,window.turnContinuity||{}):null;
    return ((rs&&rs.bindingMode)||p.bindingMode||p.kind)==="worn" && !shotPropAttachable(p, sh, scene);
  });
  const props    = propsAll.filter(p=> shotPropAttachable(p, sh, scene));
  // text-only objects in frame (and carried over from an earlier beat) are described
  // in words from their specification instead of an attached image
  const _textOnly = (typeof propTextOnly==="function") ? propTextOnly : (()=>false);
  const textProps = [...propsAll.filter(p=> _textOnly(p)), ...((ctx.carriedTextOnly)||[])]
    .filter((p,i,all)=> all.findIndex(x=>x.id===p.id)===i);
  const size = sizeOf(sh.size), angle = angleOf(sh.angle), move = moveOf(sh.move), lens = lensOf(sh.lens);
  const locWeight = (typeof locWeightForSize==="function") ? locWeightForSize(sh.size) : "primary";
  const _promptRefOff = (sh && Array.isArray(sh.refOff)) ? sh.refOff : [];
  const _promptLocSpecs = (typeof shotLocationCoverageSpecs==="function")
    ? shotLocationCoverageSpecs(loc,sh,scene,ctx.drafts || (window.turnContinuity||{}).drafts || {}) : [];
  const _activePromptLocSpecs = _promptLocSpecs.filter(s=>s && !s.unavailable && _promptRefOff.indexOf(s.id)<0);
  const _promptLoc = (typeof shotPromptLocation==="function")
    ? shotPromptLocation(loc,_activePromptLocSpecs,ctx) : loc;
  const _manualLocSpecs = sh && sh.referenceLocationsSet
    ? _activePromptLocSpecs : [];
  const _retainRequiredSimpleMap = !!(ctx.simpleMode && _manualLocSpecs.length
    && Array.isArray(ctx.resolvedRefs) && ctx.resolvedRefs.some(r=>r&&r.required));

  /* PROSE, not JSON. The user's structure: a constant STYLE SPINE (render mode, grade,
     60/30/10 palette, grade-lighting, lens, film stock, the locked location, format)
     pasted verbatim into every shot in the scene; then the one STAGING LINE that
     changes per shot (camera + action + cast + depth + dialogue); then the named
     REFERENCE stack (the attached sheets + the rolling seed) and the constraints.
     Same data the old JSON spec carried, re-emitted as prose. */
  const clean = (x)=>String(x||"").replace(/\s+/g," ").trim().replace(/\.$/,"");
  const preset = (typeof scenePreset==="function") ? scenePreset(ctx.project, scene.id) : null;
  const _asp = (typeof aspectFor==="function") ? aspectFor(ctx.project) : "16:9";

  // ---- THE STYLE SPINE (constant; pasted into every shot) ----
  // the opening line follows the CAST/LOCATION's picked render style — not hardcoded
  // photoreal — so frames come out in the same language as the sheets they composite
  const _styleKey = shotRenderStyleKey(subjects, _promptLoc);
  const _styleLine = shotRenderStyleLine(_styleKey, subjects);
  const spine = [];
  const _presetTexture=preset?clean(shotScopedStyleField(preset.texture,_promptLoc,ctx)):"";
  spine.push(_styleLine + (_presetTexture ? (", "+_presetTexture)
    : (shotStyleIsPhotoreal(_styleKey) ? ", subtle 35mm film grain" : "")));
  if(preset){
    const gName = clean(preset.name), gTxt = clean(shotScopedStyleField(preset.grade,_promptLoc,ctx));
    if(gName && gTxt) spine.push('"'+gName+'" grade: '+gTxt);
    else if(gTxt) spine.push(gTxt);
    else if(gName) spine.push('"'+gName+'" grade');
    const pal = preset.palette||[];
    if(pal.length>=3) spine.push("Colour follows 60/30/10 — ~60% "+clean(preset.dominantLabel||"dominant")+" "+pal[0]
      +", ~30% "+clean(preset.secondaryLabel||"secondary")+" "+pal[1]
      +", ~10% "+clean(preset.accentLabel||"accent")+" "+pal[2]+" accent");
    const scopedLighting=clean(shotScopedStyleField(preset.lighting,_promptLoc,ctx));
    const scopedLens=clean(shotScopedStyleField(preset.lens,_promptLoc,ctx));
    if(scopedLighting) spine.push(scopedLighting);
    if(scopedLens)     spine.push(scopedLens);
  }
  const _stock = (typeof filmStockClause==="function") ? clean(filmStockClause(ctx.project)) : "";
  if(_stock) spine.push(_stock);
  if(_promptLoc){
    const _intext = (_promptLoc.intExt==="EXT") ? "Exterior" : (_promptLoc.intExt==="INT" ? "Interior" : clean(_promptLoc.intExt));
    const _locBits = [clean(_promptLoc.architecture), clean(_promptLoc.materials), clean(_promptLoc.lighting)].filter(Boolean).join(", ");
    spine.push((_intext?(_intext+". "):"") + (_promptLoc.name||"the location") + (_locBits?(": "+_locBits):""));
  }
  if(_manualLocSpecs.length){
    spine.push("MANUALLY SELECTED LOCATION REFERENCES (authoritative): "
      +_manualLocSpecs.map(s=>s.label||s.note||s.id).join("; ")
      +". The selected place, room, context and Time-of-Day Variant override conflicting automatic root or current-slugline location text; use the continuity root only for non-conflicting inherited invariants.");
  }
  const _spaceBinding=(typeof shotSpaceBindingClause==="function")?shotSpaceBindingClause(loc,_promptLoc,ctx):"";
  if(_spaceBinding) spine.push(_spaceBinding);
  spine.push((_asp==="9:16"?"Vertical 9:16 (phone frame)":_asp) + ", no text, no border");
  const STYLE_SPINE = spine.filter(Boolean).join(". ").replace(/\.\s*\./g,".") + ".";

  // ---- THE STAGING LINE (the only part that changes per shot) ----
  const SIZE_PHRASE = { EWS:"Extreme wide shot", WS:"Wide shot", FS:"Full shot", MWS:"Medium-wide shot",
    MS:"Medium shot", MCU:"Medium close-up", CU:"Close-up", ECU:"Extreme close-up", INSERT:"Insert shot" };
  const camBits = [ SIZE_PHRASE[sh.size] || (size.name+" shot"), clean(angle.label).toLowerCase(), clean(lens.label) ];
  if(sh.move && sh.move!=="static") camBits.push(clean(move.label).toLowerCase());
  const cap = (s)=> s ? (s.charAt(0).toUpperCase()+s.slice(1)) : s;
  const screenDir = shotScreenDirection(ctx.prevShot, subjects, sh.composition);
  const stage = [ camBits.join(", ") ];
  const cameraSettings = (typeof shotCameraSettingsClause==="function") ? clean(shotCameraSettingsClause(sh)) : "";
  if(cameraSettings) stage.push(cameraSettings);
    // an Action written BY HAND on the card wins over the screenplay's opening (owner 2026-10-05 —
    // Shots review: the edit used to mark the frame out of date and then be ignored)
    const actionByHand = !!(sh && sh.actionByHand && clean(sh.action));
    const openingAction=(screenplaySource&&screenplaySource.hasSource && !actionByHand)
      ? String(screenplaySource.openingAction||"").replace(/\s+/g," ").trim() : clean(sh.action);
   if(openingAction)         stage.push(cap(openingAction));
  if(clean(screenDir.composition)) stage.push(cap(clean(screenDir.composition)));
  if(clean(screenDir.clause)) stage.push(clean(screenDir.clause));
  // the director's OWN words (the card's Director's-notes field): appended as their
  // own clause so they COMPOSE with the derived prompt, never replacing any part of it
  if(clean(sh.directives)) stage.push("DIRECTOR'S NOTES (binding): "+clean(sh.directives));
  const _depth = (typeof shotFramingClause==="function") ? clean(shotFramingClause(_promptLoc, sh.size)) : "";
  if(_depth) stage.push(_depth);
  // SCALE / POV — when an in-frame subject isn't human-scale, recontextualize the world
  // from its perspective (gigantism / miniaturization), or render relative scale for a
  // mixed-scale frame. All-human frames add nothing (inert).
  const _scale = (typeof shotScaleClause==="function") ? shotScaleClause(subjects, propsAll) : "";
  if(_scale) stage.push(_scale);
  const _objectScale = (typeof shotObjectScaleClause==="function") ? shotObjectScaleClause(subjects, [...propsAll, ...((ctx.carriedForward)||[]), ...((ctx.carriedTextOnly)||[])], _promptLoc) : "";
  if(_objectScale) stage.push(_objectScale);
  // SCENE LOOK-AHEAD — stage for what's COMING (user ruling 2026-07-18): this frame
  // (especially the chain HEAD that seeds every later frame) must accommodate what
  // later beats of the same continuous scene will need — fixtures a later beat uses
  // (the till), objects that change hands (the groceries), characters who enter or
  // queue. Derived from the LATER shots' own action text; guidance only — the clause
  // forbids depicting later people/actions in THIS frame.
  const later = Array.isArray(ctx.laterShots) ? ctx.laterShots : [];
  if(later.length){
    const curCast = new Set(subjects.map(c=>c.id));
    const curProps = new Set(propsAll.map(p=>p.id));
    const upProps=[], upCast=[], seenP=new Set(), seenC=new Set();
    later.forEach(ls=>{
      ((typeof inFrameProps==="function") ? inFrameProps(ls, scene, charById, propById, ctx) : (ls.props||[])).forEach(pid=>{
        if(curProps.has(pid)||seenP.has(pid)) return; seenP.add(pid);
        const pp=propById[pid]; if(pp) upProps.push(pp); });
       ((typeof inFrameCast==="function") ? inFrameCast(ls, scene, _chars, ctx) : (ls.subjects||[])).forEach(cid=>{
        if(curCast.has(cid)||seenC.has(cid)) return; seenC.add(cid);
        const cc=charById[cid]; if(cc) upCast.push(cc); });
    });
    const bits=[];
    if(upProps.length) bits.push("these objects/fixtures: "+upProps.slice(0,6).map(pp=>pp.name+(pp.kind==="dressing"?" (part of the set)":"")).join("; ")+(upProps.length>6?" (and more)":""));
    if(upCast.length) bits.push(upCast.slice(0,3).map(cc=>cc.name).join(" and ")+" entering or queuing into this space");
    if(bits.length) stage.push("SCENE CONTINUITY \u2014 STAGE FOR WHAT'S COMING: later beats of this same continuous scene will show "
      + bits.join("; and ")
      + ". Compose THIS frame so the space accommodates them \u2014 the relevant counter/fixtures visible or clearly implied, objects staged where the action will find them, open room where the later blocking happens \u2014 but depict ONLY this beat's own action and people, nothing from later beats");
  }
  // WHO IS IN FRAME — EXCLUSIVE: name the count so an attached reference face with
  // no staged action can never become an invented extra figure. Skipped when the
  // action itself stages unnamed people (a crowd, punters, customers).
  const _crowdRx = /\b(crowd|crowds|punters?|customers?|bystanders?|passers|pedestrians?|queue|onlookers?|mob|patrons?|strangers?|extras)\b/i;
  if(subjects.length && !_crowdRx.test(String(sh.action||"")+" "+String(sh.composition||""))){
    stage.push("Exactly "+subjects.length+" "+(subjects.length===1?"person":"people")+" in frame — ONLY "
      + subjects.map(c=>c.name).join(" and ")+"; no bystanders, no extras, no additional figures");
  }
  // FIRST-FRAME BIAS: this still seeds the beat's VIDEO clip, so stage its opening
  // instant, not its peak — and never freeze a mouth mid-vowel (bad start frame,
  // bad lip-sync anchor; the audio drives the mouth once the clip moves).
  stage.push("Stage the beat's OPENING instant — the action just beginning, not its peak; this frame starts the moving clip");
   let openingDialogue=clean(sh.dialogue);
   if(screenplaySource&&screenplaySource.hasSource){
     const openingIds=new Set(screenplaySource.openingCharacterIds||[]);
     const firstLine=(screenplaySource.dialogue||[]).find(d=>d&&d.delivery==="in-room"
       && (!d.speakerId || openingIds.has(d.speakerId)));
     openingDialogue=firstLine ? clean(firstLine.text) : "";
   }
   const _dlg = openingDialogue.replace(/^["“]|["”]$/g,"");
  if(_dlg) stage.push('About to speak — face engaged, lips just parting for "'+_dlg+'", not frozen mid-vowel');
  const STAGING = stage.join(". ") + ".";

  // ---- THE NUMBERED IMAGE MAP (the FIRST thing in the prompt) — tells the generator
  // which attached file is which, BY POSITION. The order MUST mirror the real attachment
  // order in collectShotRefs (shots-ui.jsx): the seed (previous
  // approved frame) leads as Image 1 when present, then the sheets by location weight
  // (wide → set first; tight → cast first), then props, then carried-forward. ----
  const imgs = [];
  if(ctx.prevFrameRole) imgs.push("the REFERENCE frame — carry its colour grade, lighting and every established physical state (wardrobe wear, wetness, dirt, damage) forward exactly, but do NOT copy its framing");
  // user-unticked reference sheets (sh.refOff) drop out of the image map ONLY — the
  // entity stays in the staging text; just its sheet isn't attached (labels must
  // mirror the real attachment list or the numbered map mislabels the files)
  const _refOff = _promptRefOff;
   const _locSpecs = _promptLocSpecs;
  const _locLabels = _locSpecs.filter(s=>_refOff.indexOf(s.id)<0).map(s=>s.note+" — "
    + (s.category==="place"
      ? "a design reference for binding place identity; if compound, preserve its multi-panel meaning and never treat it as a full-frame crop"
      : (s.category==="state"
        ? "the authoritative Time-of-Day Variant for this place; preserve its exact light, dressing and condition"
        : (locWeight==="ambient" ? "a background reference for the grade and surfaces only; the character fills this tight frame" : "reproduce its architecture, surfaces, fixtures, sightlines and signage exactly"))));
  const _castLabels = subjects.filter(c=>_refOff.indexOf(c.id)<0).map(c=> {
    const scale = (typeof canonicalScaleLabel==="function") ? canonicalScaleLabel(c) : (c.name||"character");
    // (2026-10-12, Character fidelity) the script's distinguishing features ride with the sheet (face marks drop with a likeness)
    const feats = (typeof window.charFeaturesForRender==="function") ? String(window.charFeaturesForRender(c)||"").replace(/\.$/,"") : "";
    return c.name+"'s character sheet — match the face, build, hair and wardrobe exactly"
      +(feats ? ("; keep their distinguishing features wherever that part of the body is visible: "+feats) : "")
      +"; canonical scale: "+scale+SHOT_SHEET_IDENTITY_ONLY;
  });
  // STATE-AWARE prop labels: when a prop's ACTIVE appearance state (story-order ≤ this
  // scene) has a generated variant sheet, that variant is what attaches — the label must
  // name the state so the numbered map matches the file (shotPropSheetId, sync-cache rule)
  const _storyScenes = (ctx.scenes || ((window.turnContinuity||{}).scenes) || []);
  // CUSTODY-AWARE holder: who actually holds the object in THIS scene (custodyOwnerAt —
  // same story-order rule as appearance states). A handover names the new holder and
  // orders the established design + accumulated wear preserved.
  const _custodyBit = (p, co)=>{ if(!co || !co.handover) return "";
    const hoSc = _storyScenes.find(s=>s.id===(co.handover.sceneId||co.handover.fromSceneId));
    return " — passed to "+co.name+(hoSc && hoSc.no!=null ? (" at Sc "+hoSc.no) : "")+"; keep its established design and accumulated wear"; };
  const _propLabels = props.filter(p=>_refOff.indexOf(p.id)<0).map(p=> {
    const scale = (typeof propPhysicalScaleLabel==="function") ? propPhysicalScaleLabel(p) : (p.name||"prop");
    const so = (typeof shotPropSheetId==="function") ? shotPropSheetId(p, scene, _storyScenes, sh.beatN, sh.microBeatId, sh.id, ctx) : { id:p.id, state:null };
    const co = (typeof custodyOwnerAt==="function") ? custodyOwnerAt(p, scene, _storyScenes) : { name:p.ownerName, handover:null };
    const rs=(typeof propStateAt==="function")?propStateAt(p,scene.id,sh.beatN,sh.microBeatId,sh.id,window.turnContinuity||{}):null;
    const holder=(rs&&rs.holderName)||co.name||p.ownerName;
    const binding=(rs&&rs.bindingMode)||p.bindingMode||p.kind||"carried";
    const placement=rs&&rs.placement&&rs.placement.note ? ", placed "+rs.placement.note : "";
    const condition=rs&&rs.condition&&rs.condition!=="intact" ? ", "+rs.condition : "";
    const content=rs&&rs.contentNotes ? "; visible document/screen content"+(rs.contentVersion?" ("+rs.contentVersion+")":"")+": "+rs.contentNotes : "";
    return "the "+p.name+" (prop sheet"+(so.state?(", "+so.state.label+" state"):"")+(holder?(", "+(binding==="worn"?"worn by ":"held by ")+holder):"")+placement+condition+")"+_custodyBit(p, co)+" — match it exactly as designed; physical scale: "+scale+content;
  });
  const _carriedLabels = (ctx.carriedForward||[]).filter(p=>_refOff.indexOf(p.id)<0).map(p=> {
    const scale = (typeof propPhysicalScaleLabel==="function") ? propPhysicalScaleLabel(p) : (p.name||"prop");
    const so = (typeof shotPropSheetId==="function") ? shotPropSheetId(p, scene, _storyScenes, sh.beatN, sh.microBeatId, sh.id, ctx) : { id:p.id, state:null };
    const co = (typeof custodyOwnerAt==="function") ? custodyOwnerAt(p, scene, _storyScenes) : { name:p.ownerName, handover:null };
    const rs=(typeof propStateAt==="function")?propStateAt(p,scene.id,sh.beatN,sh.microBeatId,sh.id,window.turnContinuity||{}):null;
    const holder=(rs&&rs.holderName)||co.name||p.ownerName;
    const binding=(rs&&rs.bindingMode)||p.bindingMode||p.kind||"carried";
    return "the "+p.name+" (prop sheet"+(so.state?(", "+so.state.label+" state"):"")+(holder?(", "+(binding==="worn"?"worn by ":"held by ")+holder):"")+")"+_custodyBit(p, co)+" — still in frame from an earlier beat; keep it present, matching its sheet; physical scale: "+scale;
  });
  if(locWeight==="ambient"){ _castLabels.forEach(l=>imgs.push(l)); _locLabels.forEach(l=>imgs.push(l)); }
  else { _locLabels.forEach(l=>imgs.push(l)); _castLabels.forEach(l=>imgs.push(l)); }
  _propLabels.forEach(l=>imgs.push(l));
  _carriedLabels.forEach(l=>imgs.push(l));
   /* Once refs have resolved, rebuild the map from the ACTUAL attachment list.
      A page budget is only a reservation: a short scene may render one page,
      a canvas/provider may return none, and a canonical sheet may be cold. */
   if(Array.isArray(ctx.resolvedRefs)){
     imgs.length=0;
     if(ctx.prevFrameRole)
       imgs.push("the REFERENCE frame — carry its colour grade, lighting and every established physical state (wardrobe wear, wetness, dirt, damage) forward exactly, but do NOT copy its framing");
     ctx.resolvedRefs.forEach((r,ri)=>{
       if(!r) return;
       if(r.assetRole==="screenplay_context"){
         imgs.push("ephemeral SCREENPLAY PAGE REFERENCE — full-scene screenplay text only; do not copy its style, composition, or layout");
       }else{
         imgs.push((r.note || r.assetRoleLabel || ("reference image "+(ri+1)))
           +(r.referenceKind==="character" ? SHOT_SHEET_IDENTITY_ONLY : ""));
       }
     });
   }
   /* Simple recovery renders deliberately attach no refs.  Do not leave a
      fictitious canonical/page map in a prompt whose provider input is empty. */
  if(ctx.simpleMode && !_retainRequiredSimpleMap) imgs.length=0;
  let MAP = imgs.length
    ? ("Compose a new cinematic still. " + imgs.map((m,i)=>"Image "+(i+1)+" is "+m+".").join(" "))
    : "Compose a new cinematic still.";
  // who holds it AT this moment — after a handover, not the original owner (2026-10-08, owner — Props review)
  const _holderOf = (p)=>{ try{ const rs = (typeof propStateAt==="function")
      ? propStateAt(p,(ctx.scene&&ctx.scene.id)||sh.sceneId,sh.beatN,sh.microBeatId,sh.id,window.turnContinuity||{}) : null;
    return (rs && rs.holderName) || p.ownerName || ""; }catch(e){ return p.ownerName || ""; } };
  if(wornProps.length){
    MAP += " Worn items have no separate sheets — each is part of its owner's character sheet and must match exactly as designed there: "
      + wornProps.map(p=> p.name+" (on "+(_holderOf(p)||"its owner")+")").join("; ")+".";
  }
  if(textProps.length){
    MAP += " Minor objects without reference images \u2014 render each plainly as described, at its real size: "
      + textProps.map(p=>{ const h=_holderOf(p); return p.name+[p.form,p.material].map(x=>String(x||"").trim()).filter(Boolean).map(x=>" \u2014 "+x).join("")
        +(h?(" ("+h+"'s)"):""); }).join("; ")+".";
  }
  if(_locLabels.length && (!ctx.simpleMode || _retainRequiredSimpleMap)){
    MAP += " If the framing crosses between attached location views, preserve the exact threshold/sightline relationship between them; otherwise extend the SAME set consistently from the attached view.";
  }
  // the plate gives the SET, the scene's look gives the COLOUR (2026-10-08, owner — Color review): a location
  // plate drawn in a styled render can carry its own tint
  if(_locLabels.length) MAP += " Take the set's architecture, materials, layout and light direction from the location view; its colour grade and palette come from this scene's look, not from the view.";

  // ---- ASSEMBLE: image map, then the style spine, then the staging line, then constraints ----
  let out = MAP + "\n\n" + STYLE_SPINE + "\n\n— " + STAGING;
  // the beat's own screenplay lines sharpen WHAT HAPPENS and WHAT IS SAID (the action
  // text is a compression of them) — but stay subordinate: the staging line above
  // remains the framing & cast authority.
   const _slice = (typeof shotScreenplaySlice==="function") ? shotScreenplaySlice(scene, sh.beatN, ctx) : "";
    if(_slice){
      const byHand = !!(sh && sh.actionByHand && clean(sh.action));
      const openingSourceText=byHand ? clean(sh.action) : String(screenplaySource&&screenplaySource.hasSource
        ? (screenplaySource.openingAction||"") : _slice).trim();
      if(openingSourceText) out += (byHand
          ? "\n\nOPENING ACTION (the director's own wording for this first frame — it replaces the screenplay's opening): "
          : "\n\nSCREENPLAY OPENING SOURCE (exact text; first frame only): ")
        + openingSourceText + (/[.!?]$/.test(openingSourceText)?"":".")
        + " Do not visualize later action in this beat as the opener.";
    }
   if(screenplaySource&&screenplaySource.hasSource){
     const remoteNames=(screenplaySource.remoteCharacterIds||[]).map(id=>(charById[id]||{}).name||id);
     if(remoteNames.length) out += "\nRemote screenplay evidence ("+remoteNames.join(", ")+") is voice/text/phone or an absent/name-in-prop mention only — exclude those people from the frame; the person holding or reading the device remains visible when the opening action says so.";
   }
   /* FULL SCENE CONTEXT is deliberately a separate, lower-priority section.
      It gives the model continuity and geography without allowing a later beat
      (or a remote name) to rewrite the TARGET BEAT OPENING above.  The context
      builder freezes this exact text before either the card or headless path can
      render; it is excerpted only by the prompt budget below, never rewritten. */
   /* THE PROMPT BUDGET (2026-10-14, owner — "go ahead with all of it"): the screenplay goes as its attached page
      images OR as text — with this request's pages (ctx.resolvedRefs) the scene's text becomes a pointer to them;
      and while the whole prompt is longer than its engine takes (shotPromptBudget), the scene's text is cut to an
      excerpt around the target beat, then left out. The image map, the style spine, the camera / staging line and
      the TARGET BEAT OPENING are never cut. */
   const _pagesAttached = shotScreenplayPagesSent(ctx.resolvedRefs, ctx.model, (ctx.prevFrameRole || ctx.prevShot) ? 1 : 0);
   const _constraints = "\n\nConstraints: " + shotNegativePrompt(sh, _styleKey) + ".";
   const _shotBudget = shotPromptBudget(ctx);
   let _sceneContextPrompt = "";
   if(typeof shotSceneContextPrompt==="function"){
     for(const fit of [undefined, "excerpt", "omit"]){
       _sceneContextPrompt = shotSceneContextPrompt(_sceneContext, {pagesAttached:_pagesAttached, fit});
       if(_pagesAttached || !_sceneContextPrompt || out.length+2+_sceneContextPrompt.length+_constraints.length<=_shotBudget) break;
     }
   }
   const _isolatedChildSpace=!!(_promptLoc&&_promptLoc.parentKey&&loc&&String(_promptLoc.id)!==String(loc.id));
   if(_sceneContextPrompt&&!_isolatedChildSpace) out += "\n\n"+_sceneContextPrompt;
   else if(_sceneContextPrompt&&_isolatedChildSpace) out += "\n\nCURRENT-SPACE CONTEXT: the exact beat opening above is authoritative. Full-scene screenplay background from sibling rooms is intentionally omitted so it cannot contaminate this "+(_promptLoc.name||"child-space")+" frame.";
  out += _constraints;
  return out;
}
/* how long a shot's prompt may be (2026-10-14): its engine's limit (ctx.promptMaxChars, else the engine ctx.model or
   the picked one — pricing.jsx TURN_IMAGE_PROMPT_LIMITS) less room for the canonical character identity block the Art
   Room adds after it; proxyGenerate fits whatever is still over (imagegen.jsx nbFitImagePrompt) */
const SHOT_PROMPT_IDENTITY_RESERVE = 3000;
function shotPromptBudget(ctx){
  const c = ctx || {};
  const max = Number(c.promptMaxChars)>0 ? Number(c.promptMaxChars)
    : (typeof window.nbPromptMaxChars==="function" ? window.nbPromptMaxChars(c.model||"") : 30000);
  return Math.max(0, max-SHOT_PROMPT_IDENTITY_RESERVE);
}
/* how many of this request's screenplay page images its engine really receives (2026-10-14): an engine that takes
   fewer reference images (Seedream 5 Pro: 10) gets the FIRST ones (proxyGenerate), and the pages ride last — when
   any page would fall past its cap, none count and the scene goes as text. lead = images sent before the references
   (a chained shot's seed frame, an edit's frame). */
function shotScreenplayPagesSent(refs, model, lead){
  const list = Array.isArray(refs) ? refs : [];
  const isPage = (r)=>!!(r && r.assetRole==="screenplay_context");
  const pages = list.filter(isPage).length;
  if(!pages) return 0;
  const cap = typeof window.nbModelMaxRefs==="function"
    ? window.nbModelMaxRefs(model || (typeof window.nbGetModel==="function" ? window.nbGetModel() : "")) : null;
  if(!(cap>0)) return pages;
  const room = Math.max(0, cap - Math.max(0, Number(lead)||0));
  return list.slice(0, room).filter(isPage).length===pages ? pages : 0;
}
window.shotScreenplayPagesSent = shotScreenplayPagesSent;
window.shotPromptBudget = shotPromptBudget;
window.buildShotPrompt = buildShotPrompt;

/* the negative prompt for a shot frame */
function shotNegativePrompt(sh, styleKey){
  if(sh && sh.negativePrompt) return sh.negativePrompt;
  // "not a cartoon" only guards PHOTOREAL frames — on a stylized film (Pixar, anime,
  // flat…) it would fight the very look the sheets were rendered in
  return "no text, no captions, no watermark, no logo, no split-screen, no grid, no collage, "
    + "no contact sheet, "
    + (shotStyleIsPhotoreal(styleKey||"photoreal") ? "not a cartoon, " : "")
    + "no extra fingers, no deformed anatomy, no duplicate people";
}
window.shotNegativePrompt = shotNegativePrompt;

/* master + negative → the final string fed to the image model */
function combinedShotPrompt(sh, ctx){
  // the negative (custom per-shot, else the defaults) rides INSIDE the JSON spec
  return buildShotPrompt(sh, ctx);
}
window.combinedShotPrompt = combinedShotPrompt;


/* ============================================================
   CARRIED PROPS ON DEMAND — a shot that should ATTACH a carried prop whose sheet was
   never generated builds that sheet first (mirroring the location staging auto-draft:
   cross-instance lock, fail-open), so a first-time user gets dressed frames without
   ever visiting the Props tab. Worn items are untouched — their canon is the owner's
   character sheet. The list builder is pure-ish and exported for the headless suite.
   ============================================================ */
function carriedPropsNeedingSheets(sh, scene, charById, propById, extraIds){
  const out = [];
  try{
    if(!sh || !scene) return out;
    const inPr = (typeof inFrameProps==="function") ? inFrameProps(sh, scene, charById, propById) : (sh.props||[]);
    const seen = {};
    const consider = (id, gateAttach)=>{
      if(seen[id]) return; seen[id] = true;
      const p = (propById||{})[id];
      if(!p) return;
      // in-frame props only build when this shot would actually attach their sheet;
      // continuity-carried props (extraIds) ALWAYS attach as carrySpec — no gate
      if(gateAttach && (typeof shotPropAttachable!=="function" || !shotPropAttachable(p, sh, scene))) return;
      const rs = (typeof propStateAt==="function") ? propStateAt(p, scene.id, sh.beatN, sh.microBeatId, sh.id, window.turnContinuity||{}) : null;
      if((((rs&&rs.bindingMode)||p.bindingMode||p.kind)||"carried")==="worn") return;
      if(typeof nbGetImage==="function" && nbGetImage(p.id)) return;                // sheet exists
      if(typeof propTextOnly==="function" && propTextOnly(p)) return;               // described in text instead
      if(window.__nbGenInflight && window.__nbGenInflight[p.id]) return;            // already building
      out.push(p);
    };
    for(const id of (inPr||[])) consider(id, true);
    // props the continuity ledger carries forward from earlier beats — the render plan
    // attaches these too (carrySpec), so their sheets must exist just the same
    for(const id of (extraIds||[])) consider(id, false);
  }catch(e){}
  return out;
}
window.carriedPropsNeedingSheets = carriedPropsNeedingSheets;

async function ensureCarriedPropSheets(sh, scene, charById, propById, project, extraIds){
  try{
    const need = carriedPropsNeedingSheets(sh, scene, charById, propById, extraIds);
    if(!need.length) return;
    window.__nbCarriedPhase = window.__nbCarriedPhase || {};
    for(const p of need){
      // cross-instance lock: concurrent renders needing the same prop share ONE build
      let job = window.__nbCarriedPhase[p.id];
      if(!job){
        job = (async ()=>{
          // AUTHORITATIVE existence check. The candidate list uses the SYNC cache, which
          // is deliberately cold in cloud mode right after a reload or project switch —
          // the stored sheet may exist even though nbGetImage says nothing. nbLoadImage
          // waits for the prefetch and finds it; only a truly missing sheet may spend
          // credits generating.
          try{
            if(typeof nbLoadImage==="function"){
              const existing = await nbLoadImage(p.id);
              if(existing) return;
            }
          }catch(e){}   // loader trouble → fall through and build; a broken loader must not permanently block the feature
          if(typeof window.appToast==="function") window.appToast(
            "Building the "+(p.name||"prop")+" reference before this shot renders.","info");
          let prop = p;
          const drafted = !!(String(p.form||"").trim() && String(p.material||"").trim());
          if(!drafted && typeof window.aiPropVisuals==="function"){
            try{
              // with the props' Lookbook brief, like every other prop draft (and the card records it — 2026-10-06)
              const lbBrief = (typeof window.turnLookbookBriefFor==="function") ? window.turnLookbookBriefFor("props") : undefined;
              const patch = await window.aiPropVisuals(p, Object.values(charById||{}), lbBrief!==undefined ? { ...(project||{}), _lookbookBrief:lbBrief } : project);
              if(patch){
                prop = { ...p, ...patch };
                // the prop card's spec fields live in App state — hand the draft back
                try{ window.dispatchEvent(new CustomEvent("nb-prop-drafted",{ detail:{ id:p.id, patch } })); }catch(e){}
              }
            }catch(e){}   // an undrafted spec still renders from the name — keep going
          }
          if(typeof window.generatePropSheet==="function") await window.generatePropSheet(prop, project);
        })();
        window.__nbCarriedPhase[p.id] = job;
        job.then(()=>{},()=>{}).then(()=>{ if(window.__nbCarriedPhase[p.id]===job) delete window.__nbCarriedPhase[p.id]; });
      }
      try{ await job; }catch(e){}   // fail-open: the shot renders as before (prop rides as text)
    }
  }catch(e){}   // fail-open by design — never block a render on this convenience
}
window.ensureCarriedPropSheets = ensureCarriedPropSheets;

/* THE LOOK A FRAME WAS MADE WITH (2026-10-03, owner — Shots review): the scene's colour look and the
   film stock, as a short signature stored on each new frame, so a later change in the Color tab can
   be flagged ("made with an earlier look") — never re-rendered on its own. */
function _lookHash(raw){ let h = 5381; for(let i=0;i<raw.length;i++) h = ((h<<5)+h+raw.charCodeAt(i))|0; return (h>>>0).toString(36); }
/* (2026-10-05, owner — Color review) the look's NAME and its three colour names are printed into
   the frame prompt too, so they are part of the look now ("look2-"); frames stamped before keep
   the old "look-" signature and are checked against the old formula (shotLookIsEarlier) — the
   change never flags every frame at once */
function shotLookSig(project, sceneId){
  const preset = (typeof scenePreset==="function") ? scenePreset(project, sceneId) : null;
  const stock = (project && project.styleBible && project.styleBible.filmStock) || "none";
  return "look2-"+_lookHash(JSON.stringify([preset ? [preset.id, preset.name||"", preset.palette, preset.dominantLabel||"", preset.secondaryLabel||"",
    preset.accentLabel||"", preset.grade, preset.lighting, preset.lens, preset.texture] : null, stock]));
}
function shotLookSigLegacy(project, sceneId){
  const preset = (typeof scenePreset==="function") ? scenePreset(project, sceneId) : null;
  const stock = (project && project.styleBible && project.styleBible.filmStock) || "none";
  return "look-"+_lookHash(JSON.stringify([preset ? [preset.id, preset.palette, preset.grade, preset.lighting, preset.lens, preset.texture] : null, stock]));
}
/* was a stored look signature made with an EARLIER look? Missing = unknown, never flagged. */
function shotLookIsEarlier(stored, project, sceneId){
  const s = String(stored||""); if(!s) return false;
  return s.indexOf("look2-")===0 ? s!==shotLookSig(project, sceneId) : s!==shotLookSigLegacy(project, sceneId);
}
window.shotLookIsEarlier = shotLookIsEarlier;
/* THE CHARACTER SHEETS A FRAME ATTACHED (owner 2026-10-06 — Characters review): each in-frame character's
   sheet — the scene's appearance variant or the master — as "<id>@<iso>#<version>", stored on each new
   frame, so a regenerated sheet shows as "Character sheet changed" (as a prop's change already did). */
function shotCharacterRefVersions(castSpec, refOff){
  const off = (Array.isArray(refOff) ? refOff : []).map(String);
  return (castSpec||[]).filter(s=>s && s.id && off.indexOf(String(s.baseId||s.id))<0 && off.indexOf(String(s.id))<0).map(s=>{
    const m = (typeof nbGetMeta==="function") ? nbGetMeta(s.id) : null;
    return String(s.id)+"@"+((m&&m.iso)||"")+"#"+((m&&m.version)||""); });
}
/* has an attached sheet changed since? judged only when its meta is loaded (a cold cache is never a false alarm) */
function shotCharacterRefsChanged(stored){
  if(!Array.isArray(stored) || !stored.length || typeof nbGetMeta!=="function") return false;
  return stored.some(e=>{ const s = String(e||""), at = s.lastIndexOf("@"); if(at<1) return false;
    const id = s.slice(0, at), m = nbGetMeta(id); if(!m) return false;
    return (id+"@"+(m.iso||"")+"#"+(m.version||""))!==s; });
}
window.shotCharacterRefVersions = shotCharacterRefVersions;
/* a frame's props by what it really used (props.jsx propFrameDependencies): the in-frame props, with
   the sheet each attached (the variant only when it exists, else the base — as shotRenderPlan attaches) */
function shotPropDependencies(sh, sceneShots, ctx){
  if(typeof propFrameDependencies!=="function" || !sh) return "";
  ctx = ctx || {};
  let plan = null; try{ plan = shotRenderPlan(sh, sceneShots||[], ctx); }catch(e){}
  const off = (Array.isArray(sh.refOff) ? sh.refOff : []).map(String);
  const attached = {};
  [].concat((plan&&plan.propSpec)||[], (plan&&plan.carrySpec)||[]).forEach(sp=>{ if(!sp) return;
    const base = String(sp.baseId||sp.id); if(off.indexOf(base)<0 && off.indexOf(String(sp.id))<0) attached[base] = String(sp.id); });
  let ids = []; try{ ids = (typeof inFrameProps==="function") ? (inFrameProps(sh, ctx.scene, ctx.charById, ctx.propById)||[]) : (sh.props||[]); }catch(e){ ids = sh.props||[]; }
  const C = window.turnContinuity||{};
  return propFrameDependencies(ids.concat(Object.keys(attached)), attached, C.props||Object.values(ctx.propById||{}),
    (ctx.scene&&ctx.scene.id)||sh.sceneId, sh.beatN, sh.microBeatId, sh.id, C);
}
window.shotPropDependencies = shotPropDependencies;
window.shotCharacterRefsChanged = shotCharacterRefsChanged;
/* THE LOCATION A FRAME USED (2026-10-08, owner — Locations review): each location plate it attached (room &
   time, extra space, state — "<id>@<iso>#<version>", "<id>@#" when it was missing then) and the location
   text its prompt read (name, side, architecture, materials, lighting). A regenerated, edited or newly made
   plate, or edited text, shows as "Location changed"; judged only once the plate's details have loaded. */
function shotLocationTextSig(locIds){
  const C = window.turnContinuity || {};
  const parts = Array.from(new Set((locIds||[]).filter(Boolean).map(String))).sort().map(id=>{
    const l = (C.locations||[]).find(x=>x && String(x.id)===id); if(!l) return id+"~";
    return id+"~"+[l.name,l.intExt,l.architecture,l.materials,l.lighting].map(x=>String(x||"").replace(/\s+/g," ").trim()).join("~"); });
  const str = parts.join("|"); let h = 5381; for(let i=0;i<str.length;i++) h = ((h<<5)+h+str.charCodeAt(i))|0;
  return "lt1:"+(h>>>0).toString(36)+":"+str.length;
}
function shotLocationDependencies(sh, renderPlan, ctx){
  const off = (Array.isArray(sh && sh.refOff) ? sh.refOff : []).map(String);
  const specs = ((renderPlan && renderPlan.activeLocSpec)||[]).filter(sp=> sp && sp.id && off.indexOf(String(sp.id))<0 && off.indexOf(String(sp.baseId||sp.id))<0);
  const base = (ctx && ctx.location && ctx.location.id) || (typeof locationForScene==="function" && sh ? ((locationForScene(((ctx&&ctx.locations)||(window.turnContinuity||{}).locations||[]), sh.sceneId)||{}).id) : "");
  return { refs: shotCharacterRefVersions(specs, []), text: shotLocationTextSig([base].concat(specs.map(sp=>sp.locationId))),
    ids: [base].concat(specs.map(sp=>sp.locationId)).filter(Boolean).map(String).filter((x,i,a)=>a.indexOf(x)===i) };
}
function shotLocationChanged(stored){
  if(!stored || typeof stored!=="object") return false;
  if(shotCharacterRefsChanged(stored.refs)) return true;
  return !!(stored.text && Array.isArray(stored.ids) && shotLocationTextSig(stored.ids)!==stored.text);
}
window.shotLocationDependencies = shotLocationDependencies;
/* the card's "Prop reference changed", for counts outside the card (2026-10-09, owner — Shots review): the frame
   state, the Breakdown and the Stage now note the same changes the card shows */
function shotPropChanged(sh, sceneShots, meta){
  if(!sh || !meta || meta.propDependencies==null || typeof propDependenciesChanged!=="function" || typeof shotPropDependencies!=="function") return false;
  try{
    const C = window.turnContinuity || {};
    const scene = (C.scenes||[]).find(x=>x && x.id===sh.sceneId) || { id:sh.sceneId };
    const charById = {}, propById = {};
    (C.characters||[]).forEach(c=>{ if(c && c.id) charById[c.id]=c; }); (C.props||[]).forEach(p=>{ if(p && p.id) propById[p.id]=p; });
    const loc = (typeof locationForScene==="function") ? locationForScene(C.locations||[], sh.sceneId) : null;
    const ctx = { scene, scenes:C.scenes||[], charById, propById, location:loc, locations:C.locations||[], project:window.turnProject||{}, drafts:C.drafts||{} };
    const legacy = (typeof propDependencySignature==="function") ? propDependencySignature(C.props||[], sh.sceneId, sh.beatN, sh.microBeatId, sh.id, C) : null;
    return !!propDependenciesChanged(meta.propDependencies, shotPropDependencies(sh, sceneShots||[], ctx), legacy);
  }catch(e){ return false; }
}
window.shotPropChanged = shotPropChanged;
window.shotLocationChanged = shotLocationChanged;
window.shotLocationTextSig = shotLocationTextSig;
window.shotLookSig = shotLookSig;

/* Carried props a set of shots would build before rendering, with no sheet yet (authoritative
   storage check) — so a scene or film run can ask ONCE, up front, instead of building silently. */
async function shotRunPropsNeeding(entries){
  const out = [], seen = {};
  for(const e of (entries||[])){
    let plan = null;
    try{ plan = (typeof shotRenderPlan==="function") ? shotRenderPlan(e.sh, e.sceneShots||[], e.ctx||{}) : null; }catch(err){}
    const need = carriedPropsNeedingSheets(e.sh, e.ctx && e.ctx.scene, e.ctx && e.ctx.charById, e.ctx && e.ctx.propById, (plan&&plan.carried)||[]);
    for(const p of need){ if(seen[p.id]) continue; seen[p.id] = true;
      let has = "";
      try{ if(typeof nbLoadImage==="function") has = await nbLoadImage(p.id); }catch(err){}
      if(!has) out.push(p); }
  }
  return out;
}
window.shotRunPropsNeeding = shotRunPropsNeeding;

/* WHAT A SCENE'S FRAMES NEED (2026-10-03, owner — Shots / Breakdown reviews): the reference images
   its shots attach that don't exist yet — character sheets (or the scene's appearance variant),
   location / room & time plates, prop sheets — read from the same render plan the frames use. ONE
   definition, shared by the Shots scene card ("Needs: …") and the Breakdown strip, so they agree.
   `has(id)` says whether an image exists (the caller's cache: Breakdown also checks local storage). */
function sceneReferenceNeeds(sceneShots, ctx, has){
  const out = [], seen = {};
  const exists = typeof has==="function" ? has : ((id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : true);
  const sorted = (typeof sceneShotsOrdered==="function") ? sceneShotsOrdered(sceneShots||[]) : (sceneShots||[]);
  const locIds = new Set(((ctx && ctx.locations)||[]).map(l=>l && l.id));
  const locById = {}; ((ctx && ctx.locations)||[]).forEach(l=>{ if(l && l.id) locById[l.id]=l; });
  // A ROOM'S PLATE NEEDS ITS LOCATION'S PLATE (2026-10-08, owner — Locations review): a missing room & time
  // plate whose location (or that location's parent) has no plate yet lists those first, so the price,
  // the Breakdown and "Make what this scene needs" all count them — the run used to stop at "make X's plate first"
  const prereq = (locId)=>{
    const chain = [], guard = new Set(); let l = locById[locId];
    while(l && !guard.has(l.id)){ guard.add(l.id); chain.unshift(l);
      const par = (typeof locationParentOf==="function") ? locationParentOf(l, ctx.locations||[]) : null;
      l = par && locById[par.id]; }
    chain.forEach(x=>{ if(seen[x.id] || exists(x.id)) return; seen[x.id] = true;
      out.push({ id:x.id, baseId:x.id, kind:"location", makeable:true, prereq:true, label:String(x.name||"Location").slice(0,46)+" (needed first)", name:String(x.name||"Location").slice(0,46) }); });
  };
  sorted.forEach(sh=>{
    let plan = null;
    try{ plan = (typeof shotRenderPlan==="function") ? shotRenderPlan(sh, sorted, ctx||{}) : null; }catch(e){}
    if(!plan) return;
    const add = (spec, kind)=>{
      if(!spec || !spec.id || seen[spec.id] || exists(spec.id)) return;
      if(kind==="location" && spec.locationId && String(spec.locationId)!==String(spec.id)) prereq(String(spec.locationId));
      seen[spec.id] = true;
      const makeable = kind==="character" ? true
        : kind==="prop" ? (!spec.baseId || spec.baseId===spec.id)
        : (locIds.has(spec.id) || /^locunit-/.test(String(spec.id)));
      out.push({ id:spec.id, baseId:spec.baseId||spec.id, kind, makeable,
        // a character VARIANT whose master sheet doesn't exist yet: making it makes the master first (2026-10-09)
        ...(kind==="character" && spec.baseId && String(spec.baseId)!==String(spec.id) ? { masterMissing:!exists(spec.baseId) } : {}),
        label:String(spec.label||spec.name||spec.note||spec.id).replace(/\s*\(identity only[\s\S]*$/,"").slice(0,60) });
    };
    (plan.activeLocSpec||[]).forEach(x=>add(x,"location"));
    (plan.castSpec||[]).forEach(x=>add(x,"character"));
    (plan.propSpec||[]).forEach(x=>add(x,"prop"));
    (plan.carrySpec||[]).forEach(x=>add(x,"prop"));
  });
  return out;
}
window.sceneReferenceNeeds = sceneReferenceNeeds;
/* HOW MANY IMAGES "Make what this scene needs" really makes (2026-10-09, owner — Breakdown review): a character
   VARIANT whose master sheet doesn't exist yet makes the master first — two images, not one. The Breakdown's
   chip, its summary and the run's question all count with this. */
function sceneNeedsImageCount(needs, has){
  const L = (needs||[]).filter(n=>n && n.makeable);
  const ids = new Set(L.map(n=>String(n.id)));
  const exists = typeof has==="function" ? has : ((id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : true);
  let n = 0;
  L.forEach(x=>{ n++;
    const sid = String(x.id);
    if(x.kind==="character" && sid.indexOf(":")>0){ const m = sid.split(":")[0];
      if(!ids.has(m) && (x.masterMissing!==undefined ? x.masterMissing : !exists(m))){ ids.add(m); n++; } } });
  return n;
}
window.sceneNeedsImageCount = sceneNeedsImageCount;

/* A shot frame's state, by the rules the Shots tab's ordered runs use: DONE = rendered, approved,
   and current (its shot spec / screenplay source unchanged, or overridden on purpose, and its seed
   chain intact). oldLook = made before the scene's colour look or the film stock changed. */
function shotFrameState(sh, sceneShots, drafts, project, has){
  const exists = typeof has==="function" ? has : ((id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false);
  const rendered = !!(sh && exists(sh.id));
  const meta = (id)=> (typeof nbGetMeta==="function") ? nbGetMeta(id) : null;
  const approved = !!(sh && (sh.locked || sh.approved));
  let current = rendered;
  if(rendered){
    const st = (typeof shotAssetProvenanceStatus==="function") ? shotAssetProvenanceStatus(sh, (drafts||{})[sh.sceneId], meta(sh.id)) : "current";
    const ov = (typeof shotSourceOverrideCurrent==="function") && shotSourceOverrideCurrent(sh, (drafts||{})[sh.sceneId]);
    const chainStale = (typeof shotChainStatus==="function") && shotChainStatus(sh, sceneShots||[], meta)==="stale";
    // no recorded source (made before stamps, or an upload) is unknown — never counted as out of date (2026-10-09)
    current = (st==="current" || st==="unverified" || !!ov) && !chainStale;
  }
  const m = rendered ? meta(sh.id) : null;
  const oldLook = !!(m && project && sh && shotLookIsEarlier(m.lookSig, project, sh.sceneId));
  const charChanged = !!(m && shotCharacterRefsChanged(m.characterRefVersions));   // a note, like an earlier look
  const locChanged = !!(m && shotLocationChanged(m.locationDependencies));           // a note too (2026-10-08)
  const propChanged = !!(m && shotPropChanged(sh, sceneShots, m));                    // a note too (2026-10-09)
  return { rendered, approved, current, oldLook, charChanged, locChanged, propChanged, done: rendered && approved && current };
}
window.shotFrameState = shotFrameState;

/* ============================================================
   ONE RENDER PLAN (architect review 2026-09-01): shotRenderPlan is the single
   source of truth for WHAT a shot renders from — seed shot, in-frame cast/props,
   ledger-carried props, spec notes, and the weight-ordered attachment list. The
   Shots card (shotFrameGenOpts / collectShotRefs) and the Storyboard's planned-
   prompt box consume it; neither builds its own. Synchronous on purpose — image
   resolution is the separate shotResolveRenderRefs step.
   ============================================================ */
/* A character sheet is an IDENTITY reference: every panel is a neutral studio view on a plain
   ground. Say so in the image map, as Stage already does (stage.jsx), so a frame never inherits
   the sheet's backdrop, pose, flat lighting or neutral face — the beat supplies the performance
   (owner decisions 2026-09-26: no expression row on the sheet; place-free style backdrops). */
const SHOT_SHEET_IDENTITY_ONLY = " (identity only: take the face, build, hair and wardrobe from it; never copy its background, pose, lighting or panel layout; its face is neutral by design, so the expression comes from this beat)";
window.SHOT_SHEET_IDENTITY_ONLY = SHOT_SHEET_IDENTITY_ONLY;
/* One canonical character-sheet resolver for every downstream surface.  A
   character appearance state starts at its pinned scene and remains active until
   a later state supersedes it.  Shots, Storyboards and Stage all consume the
   returned canonical asset id (characterId:stateId), so none can quietly fall
   back to the v1 master when v2+ is the scene's assigned look. */
function shotCharacterReferenceSpec(character, scene, scenes, opts){
  opts=opts||{};
  if(!character||!character.id)return null;
  let storyScenes=Array.isArray(scenes)&&scenes.length?scenes:null;
  if(!storyScenes){
    try{storyScenes=Array.isArray(window.turnContinuity&&window.turnContinuity.scenes)
      ?window.turnContinuity.scenes:[];}catch(e){storyScenes=[];}
  }
  if(typeof scenesInStoryOrder==="function"){
    try{storyScenes=scenesInStoryOrder(storyScenes);}catch(e){}
  }
  let active={version:1,state:null};
  if(typeof activeStateForScene==="function"){
    try{active=activeStateForScene(character,scene,storyScenes)||active;}catch(e){}
  }else if(scene&&storyScenes.length){
    const sceneIdx=storyScenes.findIndex(s=>s&&s.id===scene.id);
    let best=null,bestPos=-1,bestVersion=1;
    (character.states||[]).forEach((st,i)=>{
      const pos=st&&st.sceneId?storyScenes.findIndex(s=>s&&s.id===st.sceneId):-1;
      if(pos>=0&&pos<=sceneIdx&&pos>=bestPos){best=st;bestPos=pos;bestVersion=i+2;}
    });
    active={version:bestVersion,state:best};
  }
  const state=active&&active.state||null;
  const version=state?Number(active.version)||((character.states||[]).indexOf(state)+2):1;
  const stateLabel=state?(String(state.label||"").trim()||"Unnamed appearance state"):"";
  const name=String(character.name||"Character");
  return {
    id:state?(character.id+":"+state.id):character.id,
    baseId:character.id,entityId:character.id,referenceKind:"character",
    stateId:state&&state.id||"",state,version,
    label:state?(name+" · "+stateLabel+" · v"+version):name,
    note:state
      ?(name+" character sheet — Appearance: "+stateLabel+" (v"+version+")")
      :(name+" character sheet"),
    assetRole:state?"appearance_state":"master_reference",
    assetSourceQuality:"full_frame",
    required:!!state||!!opts.required
  };
}
window.shotCharacterReferenceSpec=shotCharacterReferenceSpec;

function shotRenderPlan(sh, sceneShots, ctx){
  ctx = ctx || {};
  const prevSh = (typeof seedShotOf==="function") ? seedShotOf(sh, sceneShots)
    : ((typeof prevShotOf==="function") ? prevShotOf(sh, sceneShots) : null);
  const locWeight = (typeof locWeightForSize==="function") ? locWeightForSize(sh.size) : "primary";
  // the locked-reference sheets for what's actually in THIS frame (derived from the action text)
  const _chars = Object.values(ctx.charById||{});
   const inCast = (typeof inFrameCast==="function") ? inFrameCast(sh, ctx.scene, _chars, ctx) : (sh.subjects||[]);
   const inPr   = (typeof inFrameProps==="function") ? inFrameProps(sh, ctx.scene, ctx.charById, ctx.propById, ctx) : (sh.props||[]);
  // CONTINUITY LEDGER — props an in-frame character was established holding earlier in the
  // scene that this beat's text doesn't re-name; carry them forward so they don't vanish.
  let carried = [], carriedText = [];
  try{ const ledger = sceneContinuityLedger(ctx.scene, sceneShots, ctx.charById, ctx.propById);
    carried = (ledger[sh.id]||[]).filter(pid=> inPr.indexOf(pid)<0); }catch(e){}
  // text-only objects carried forward stay in frame as TEXT, not as an attached sheet
  if(typeof propTextOnly==="function"){
    carriedText = carried.filter(id=> propTextOnly((ctx.propById||{})[id]));
    carried = carried.filter(id=> carriedText.indexOf(id)<0);
  }
  // build the sheet-reference specs, then ORDER by location weight
  const locSpec  = (ctx.location || sh.referenceLocationsSet)
    ? ((typeof shotLocationCoverageSpecs==="function")
       ? shotLocationCoverageSpecs(ctx.location, sh, ctx.scene, ctx.drafts || (window.turnContinuity||{}).drafts || {})
      : [])
    : [];
  const _storyScenes=ctx.scenes||((window.turnContinuity||{}).scenes)||[];
  const castSpec = inCast.map(id=>{ const c=(ctx.charById||{})[id];
    return c?shotCharacterReferenceSpec(c,ctx.scene,_storyScenes,{required:!!sh.referenceCharactersSet}):null;
  }).filter(Boolean);
  // same dressing gate as buildShotPrompt — labels must match files
  const _scs = (ctx.scenes || ((window.turnContinuity||{}).scenes) || []);
  const propSpec = inPr.map(id=>{ const p=(ctx.propById||{})[id];
    if(!p || !shotPropAttachable(p, sh, ctx.scene)) return null;   // worn attach only on tight shots WITH a generated close-up sheet
    // STATE-AWARE: attach the active appearance-state variant when one exists (baseId
    // keeps the user's refOff untick working against the prop's own id). CUSTODY-AWARE:
    // the note names the scene's actual holder after a handover.
    const so = (typeof shotPropSheetId==="function") ? shotPropSheetId(p, ctx.scene, _scs, sh.beatN, sh.microBeatId, sh.id, ctx) : { id:p.id, state:null };
    const rs=(typeof propStateAt==="function")?propStateAt(p,ctx.scene&&ctx.scene.id,sh.beatN,sh.microBeatId,sh.id,window.turnContinuity||{}):null;
    return { id:so.id, baseId:p.id, note:p.name+" prop sheet"+(so.state?(" \u2014 "+so.state.label):"")+(rs&&rs.holderName?(" \u2014 held by "+rs.holderName):"")+(rs&&rs.condition&&rs.condition!=="intact"?(" \u2014 "+rs.condition):"") }; }).filter(Boolean);
  const carrySpec= carried.map(id=>{ const p=(ctx.propById||{})[id]; if(!p) return null;
    const so = (typeof shotPropSheetId==="function") ? shotPropSheetId(p, ctx.scene, _scs, sh.beatN, sh.microBeatId, sh.id, ctx) : { id:p.id, state:null };
    const rs=(typeof propStateAt==="function")?propStateAt(p,ctx.scene&&ctx.scene.id,sh.beatN,sh.microBeatId,sh.id,window.turnContinuity||{}):null;
    return { id:so.id, baseId:p.id, note:p.name+" prop sheet (carried over from an earlier beat)"+(so.state?(" \u2014 "+so.state.label):"")+(rs&&rs.holderName?(" \u2014 held by "+rs.holderName):"") }; }).filter(Boolean);
  // user-unticked sheets (sh.refOff) drop out here AND in buildShotPrompt's image
  // map together — the numbered labels always match the attached files
  const _refOff = Array.isArray(sh.refOff) ? sh.refOff : [];
  const activeLocSpec = locSpec.filter(s=> _refOff.indexOf(s.baseId||s.id)<0);
  const orderedSpecs = ((locWeight==="ambient")
    ? [...castSpec, ...activeLocSpec, ...propSpec, ...carrySpec]   // tight: the cast leads, the set recedes
    : [...activeLocSpec, ...castSpec, ...propSpec, ...carrySpec])  // wide: the set leads
    .filter(s=> _refOff.indexOf(s.baseId||s.id)<0);
   /* The screenplay pages are optional, lower-priority context. Reserve every
      canonical slot before offering a page slot — even if a canonical byte is
      cold right now — so a late-loaded identity sheet can never be displaced by
      a page image. The seed is the provider's primary reference and counts too. */
   let sceneContext = (typeof shotSceneContextPlan==="function")
     ? shotSceneContextPlan(sh,ctx) : null;
   if(sceneContext){
     const budget = (typeof shotSceneContextCapacity==="function")
       ? shotSceneContextCapacity(ctx,14) : 14;
     const reserved = orderedSpecs.length + (prevSh ? 1 : 0);
     const available = Math.max(0,budget-reserved);
     sceneContext = { ...sceneContext, maxPages:available,
       pageLimitReason: available
         ? (sceneContext.pageLimitReason||"canonical references reserved first")
         : "reference capacity reserved for canonical identity/location/prop assets" };
     if(!available && !sceneContext.omissions.includes(sceneContext.pageLimitReason))
       sceneContext.omissions = (sceneContext.omissions||[]).concat(sceneContext.pageLimitReason);
   }
   return { prevSh, isHead:!prevSh, locWeight, inCast, inPr, carried, sceneContext,
     sceneContextScene:ctx.scene ? { ...ctx.scene } : null,
     sceneContextLocation:ctx.location ? { ...ctx.location } : null,
     sceneContextProject:ctx.project ? { ...ctx.project } : null,
    carriedForward: carried.map(id=>(ctx.propById||{})[id]).filter(Boolean),
    carriedTextOnly: carriedText.map(id=>(ctx.propById||{})[id]).filter(Boolean),
    activeLocSpec, castSpec, propSpec, carrySpec, orderedSpecs };
}
window.shotRenderPlan = shotRenderPlan;

/* A required active appearance sheet is a paid-render precondition.  Omitting a
   missing v2+ sheet would let the provider improvise from the seed or silently
   reuse v1, which breaks the film's continuity contract. */
function shotCharacterReferenceError(spec,cause){
  const id=String(spec&&spec.id||"");
  const label=String(spec&&spec.label||spec&&spec.note||id||"character appearance");
  const e=new Error("Required character appearance reference \""+label+"\" has no available image. Generate or import that appearance state in Art Room → Characters before rendering this shot.");
  e.name="ShotCharacterReferenceError";
  e.code="SHOT_CHARACTER_REFERENCE_UNAVAILABLE";
  e.errorFlag="fatal-reference";
  e.fatalReference=true;
  e.isFatalReference=true;
  e.fatal=true;
  e.requiredReference=true;
  e.flag="fatal-reference";
  e.referenceId=id;
  e.referenceSpec=spec||null;
  if(cause)e.cause=cause;
  return e;
}
window.shotCharacterReferenceError=shotCharacterReferenceError;
window.ShotCharacterReferenceError=shotCharacterReferenceError;

/* resolve the plan's ordered specs into the attached reference images — the shared
   resolution loop (location coverage resolves as a group and keeps its slot in the
   weight order; everything else grabs its committed sheet). */
async function shotResolveRenderRefs(plan, grab){
  const refs = [];
  const locIds = new Set(plan.activeLocSpec.map(s=>s&&s.id).filter(Boolean));
  const locResolved = (typeof shotResolveLocationSpecImages==="function") ? await shotResolveLocationSpecImages(plan.activeLocSpec, grab) : [];
  let locResolvedPushed = false;
  for(const s of plan.orderedSpecs){
    if(locIds.has(s.id)){
      if(!locResolvedPushed && locResolved.length){
        locResolved.forEach(r=>refs.push({ url:r.url, note:r.note, refId:r.refId||s.id,
          category:r.category, categories:r.categories, locationId:r.locationId, entityId:r.entityId,
          stateId:r.stateId, coverageId:r.coverageId, required:r.required,
          assetRole:r.assetRole, assetRoleLabel:r.assetRoleLabel, assetRolePriority:r.assetRolePriority,
          assetSourceQuality:r.assetSourceQuality }));
        locResolvedPushed = true;
      }
      continue;
    }
    let u="",grabError=null;
    try{u=await grab(s.id);}catch(e){grabError=e;}
    if(!u&&s.required&&s.referenceKind==="character")
      throw shotCharacterReferenceError(s,grabError);
    if(grabError)throw grabError;
    if(u){
      const role = s.assetRole || "master_reference";
      refs.push({ url:u, note:s.note, refId:s.id, baseId:s.baseId||s.id,
        entityId:s.entityId||s.baseId||s.id,stateId:s.stateId||"",required:!!s.required,
        referenceKind:s.referenceKind||"",assetRole:role,
        assetRoleLabel:(typeof nbAssetRoleLabel==="function") ? nbAssetRoleLabel(role) : role,
        assetRolePriority:(typeof nbAssetRolePriority==="function") ? nbAssetRolePriority(role) : 0,
        assetSourceQuality:s.assetSourceQuality || "full_frame" });
    }
  }
  /* Screenplay pages are a distinct, low-priority role.  They are generated
     from the frozen plan snapshot at render time (never during ShotCard
     rendering), and are appended only after canonical refs have resolved. */
  if(plan.sceneContext && typeof shotSceneContextReferences==="function"){
    const pagePack = await shotSceneContextReferences(plan.sceneContext, {
      scene:plan.sceneContextScene || null,
      location:plan.sceneContextLocation || null,
      project:plan.sceneContextProject || null
    }, { maxPages:plan.sceneContext.maxPages });
    plan.sceneContext = { ...plan.sceneContext,
      pages:pagePack.pages||0, renderedPages:pagePack.renderedPages||0,
      omittedPages:pagePack.omittedPages||0,
      omissions:Array.from(new Set([...(plan.sceneContext.omissions||[]), ...(pagePack.omissions||[])])) };
    (pagePack.refs||[]).forEach(r=>refs.push(r));
  }
  return refs;
}
window.shotResolveRenderRefs = shotResolveRenderRefs;

/* Every shot prompt is a compilation of several independently drafted sources.
   Snapshot their writing-model records together so Image Details can explain the
   whole prompt, not only the top-level shot row. */
function shotWritingSources(sh,ctx){
  if(typeof window.nbWritingSourcesFor!=="function") return [];
  ctx=ctx||{};
  const chars=Object.values(ctx.charById||{}), props=Object.values(ctx.propById||{});
   const charIds=(typeof inFrameCast==="function")?inFrameCast(sh,ctx.scene,chars,ctx):(sh.subjects||[]);
  const propIds=(typeof inFrameProps==="function")?inFrameProps(sh,ctx.scene,ctx.charById||{},ctx.propById||{}):(sh.props||[]);
  const sources=[
    {entity:sh,subject:"Shot"},
    {entity:ctx.location,subject:ctx.location&&ctx.location.name},
    {entity:ctx.project&&ctx.project.styleBible,subject:"Film style"},
    ...charIds.map(id=>({entity:(ctx.charById||{})[id],subject:((ctx.charById||{})[id]||{}).name})),
    ...propIds.map(id=>({entity:(ctx.propById||{})[id],subject:((ctx.propById||{})[id]||{}).name})),
  ];
  const out=[], seen=new Set();
  sources.forEach(({entity,subject})=>window.nbWritingSourcesFor(entity).forEach(p=>{
    const row={...p,task:(p.task||"Specification")+(subject?(" · "+subject):"")};
    const key=[row.task,row.modelId||row.model,row.at||0].join("|");
    if(!seen.has(key)){seen.add(key);out.push(row);}
  }));
  return out;
}
window.shotWritingSources=shotWritingSources;



/* ---- screenplay-grounded fallback: one opening shot per authored beat ------- */
/* This is a deterministic layout stopgap, not a story generator.  If the scene
   has no screenplay source the caller must surface that fact to the writer; beat
   summaries, drivers and reactors are not visual evidence. */
function deriveShotsHeuristic(scene, beats, locations, props, characters, drafts){
  if(!scene) return [];
  const bm = beats && beats[scene.id];
  const draftMap = drafts || ((window.turnContinuity||{}).drafts||{});
  const draft = draftMap && draftMap[scene.id];
  const draftBlocks=Array.isArray(draft) ? draft : (draft&&draft.blocks);
  if(!draft || !Array.isArray(draftBlocks) || !draftBlocks.length) return [];
  const rows = (bm && Array.isArray(bm.rows)) ? bm.rows : [];
  const authored = [], nums=[];
  rows.forEach((row,i)=>{ const n=Number(row&&row.n)||i+1; if(nums.indexOf(n)<0)nums.push(n); });
  draftBlocks.forEach(b=>{ const n=Number(b&&b.beat); if(Number.isFinite(n)&&n>0&&nums.indexOf(n)<0)nums.push(n); });
  /* A screenplay can be imported before a beat map exists.  Numbered authored
     blocks still define one production unit per beat; leading untagged text is
     beat one only, as in shotBeatScreenplay. */
  if(!nums.length) nums.push(1);
  nums.sort((a,b)=>a-b);
  nums.forEach(n=>{
    const source=(typeof window.shotBeatScreenplay==="function")
      ? window.shotBeatScreenplay(scene,n,{drafts:draftMap,characters:characters||[],beatsMap:beats||{}}) : null;
    if(source&&source.hasSource) authored.push({n,source});
  });
  if(!authored.length) return [];
  const loc = (typeof locationForScene==="function") ? locationForScene(locations||[], scene.id) : null;
  const out=[];
  authored.forEach((item,i)=>{
    const source=item.source, n=item.n;
    const sh={
      id:"shot-"+scene.id+"-"+n+"-"+Date.now().toString(36)+i,
      sceneId:scene.id, beatN:n, order:i,
      size:"MS", angle:"eye", move:"static", lens:"50", composition:"",
      subjects:Array.isArray(source.openingCharacterIds)?source.openingCharacterIds.slice():[],
      locationId:loc?loc.id:"",
      props:[],
      action:String(source.openingAction||"").trim(),
      dialogue:(source.dialogue||[]).find(d=>d&&d.delivery==="in-room"&&
        (!d.speakerId||source.openingCharacterIds.indexOf(d.speakerId)>=0))?.text||"",
      negativePrompt:"",
      keyframeMode:"beat-opening",
      sourceScreenplayRev:source.sourceRev||"",
      beatScript:source.text||"",
      remoteCharacterIds:(source.remoteCharacterIds||[]).slice(),
      sourceMetadata:{sceneHeading:source.sceneHeading||"",sourceRev:source.sourceRev||"",
        evidence:source.blocks||[]},
      covers:[], beatPlan:null, referenceCharactersSet:true,
      referenceCharacterIds:(source.openingCharacterIds||[]).slice(), specRev:1
    };
    if(typeof inFrameProps==="function")
      sh.props=inFrameProps(sh,scene,
        (characters||[]).reduce((m,c)=>(m[c.id]=c,m),{}),
        (props||[]).reduce((m,p)=>(m[p.id]=p,m),{}));
    sh.specHash=(typeof shotSpecFingerprint==="function")?shotSpecFingerprint(sh):"";
    out.push(sh);
  });
  return out;
}
window.deriveShotsHeuristic = deriveShotsHeuristic;

/* scan a shot's action/composition text for cast members actually NAMED in it.
   The action text is authoritative (it's what the frame depicts), so this is a more
   reliable subject signal than the model's separate `subjects` field, which can drift
   to background/crowd cast. Matches full name, first name or last name as whole words. */
function scanTextForChars(text, characters){
  const t = " "+String(text||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ")+" ";
  const ids = [];
  const tokensOf = (name)=> String(name||"").toLowerCase().trim()
    .split(/[^a-z0-9]+/).filter(w=> w.length>=3 && !/^[0-9]+$/.test(w));
  // a token SHARED by 2+ cast members (a family name like KARAHAN) is AMBIGUOUS —
  // "ADEM KARAHAN hauls the shutter" must never pull REECE KARAHAN into frame via
  // the surname (that attached a third face and the generator invented a third man).
  const tokCount = {};
  (characters||[]).forEach(c=> Array.from(new Set(tokensOf(c.name))).forEach(w=>{ tokCount[w]=(tokCount[w]||0)+1; }));
  (characters||[]).forEach(c=>{
    const full = (c.name||"").toLowerCase().trim();
    if(!full) return;
    // split on ANY non-alphanumeric (not just whitespace) so a hyphenated/serial name like
    // "VANYA-71" yields the human token "vanya" — otherwise the whole "vanya-71" token never
    // matches the script's "Vanya" and the character is silently dropped from the frame.
    const parts = tokensOf(full).filter(w=> tokCount[w]===1);
    const fullNorm = full.replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
    // the FULL name always matches (unambiguous even when every token is shared)
    const names = Array.from(new Set([fullNorm, ...parts])).filter(Boolean);
    if(names.some(nm=> t.indexOf(" "+nm+" ")>=0)){ if(ids.indexOf(c.id)<0) ids.push(c.id); }
  });
  return ids;
}
window.scanTextForChars = scanTextForChars;

/* WHO is in THIS frame — derived from the shot's own action/composition text (the most
   reliable per-frame signal), not from fragile manual tags. Falls back to the scene's
   DRIVER when the action names nobody (a pronoun-only beat), and to whatever was stored
   only as a last resort. This is the single source the references + prompt read, so an
   under-tagged shot can no longer drop a character's identity anchor — nor over-attach a
   character who isn't in the frame. */
function inFrameCast(sh, scene, characters, ctx){
  const valid = id=>(characters||[]).some(c=>c&&c.id===id);
  const source=(typeof shotBeatSource==="function")
    ? shotBeatSource(scene,sh&&sh.beatN,ctx,characters) : null;
  if(source&&source.hasSource){
    const physical=new Set((sh&&sh.keyframeMode==="beat-opening"
      ? source.openingCharacterIds : source.physicalCharacterIds)||[]);
    const requested=sh&&sh.referenceCharactersSet
      ? (Array.isArray(sh.referenceCharacterIds)?sh.referenceCharacterIds:[])
      : ((sh&&sh.keyframeMode==="beat-opening") ? source.openingCharacterIds
        : ((sh&&sh.subjects)||[]));
    return Array.from(new Set(requested.filter(id=>valid(id)&&physical.has(id))));
  }
  if(sh && sh.referenceCharactersSet)
    return Array.from(new Set((Array.isArray(sh.referenceCharacterIds)?sh.referenceCharacterIds:[]).filter(valid)));
  const named = scanTextForChars(((sh&&sh.action)||"")+" "+((sh&&sh.composition)||""), characters);
  if(named.length) return named;
  return ((sh&&sh.subjects)||[]).filter(valid);
}
window.inFrameCast = inFrameCast;

/* THE scene's cast roster — the single authoritative answer to "who is in this scene",
   so the bible, the prop mapping and any future consumer all read ONE definition instead
   of each re-deriving (the source of contradictory rosters). A hand-authored `scene.cast`
   (ids) WINS — it's the editable first-class edge. Otherwise it's the union of every
   reliable signal: the driver, anyone named in the scene's own script text, and everyone
   any of the scene's shots puts in frame (inFrameCast on the action). Computed, never a
   stale stored copy — but honours the override when present. */
function sceneRoster(scene, characters, drafts, shots){
  const chars = characters || [];
  const valid = (id)=> chars.some(c=>c.id===id);
  if(scene && Array.isArray(scene.cast) && scene.cast.length) return scene.cast.filter(valid);
  const ids = [];
  if(scene && scene.driver && valid(scene.driver)) ids.push(scene.driver);
  if(typeof scenesWhereCharacterAppears==="function" && scene){
    chars.forEach(c=>{ if(ids.indexOf(c.id)<0 && scenesWhereCharacterAppears(c.id, c.name, [scene], drafts).length) ids.push(c.id); });
  }
  (shots||[]).forEach(sh=>{ inFrameCast(sh, scene, chars).forEach(id=>{ if(valid(id) && ids.indexOf(id)<0) ids.push(id); }); });
  return ids;
}
window.sceneRoster = sceneRoster;

/* An appearance-state sheet is the wardrobe authority for its run of scenes. Base
   worn props are baked into the v1 character design, but must not be re-injected as
   text or a separate close-up sheet after a costume-change state replaces that
   design. Keep a wearable only when the active state's own description (or this
   shot's authored staging) explicitly names it; a director can also force it with
   referencePropIds. This prevents a base suit belt from being strapped over a v2
   sweatpants look simply because the prop still belongs to the character bible. */
function shotWornPropAppliesToAppearance(p,sh,scene,charById,ctx,resolved){
  if(!p)return false;
  const binding=(resolved&&resolved.bindingMode)||p.bindingMode||p.kind||"carried";
  if(binding!=="worn")return true;
  if(Array.isArray(sh&&sh.referencePropIds)&&sh.referencePropIds.indexOf(p.id)>=0)return true;
  const holderId=(resolved&&resolved.holderId)||p.ownerId||"";
  const holderName=String((resolved&&resolved.holderName)||p.ownerName||"").trim().toLowerCase();
  // Legacy owned props can predate ownerId while still carrying the canonical
  // ownerName. Resolve that name before giving up, or those old records bypass the
  // active wardrobe state and leak into every shot prompt.
  const c=(holderId&&charById&&charById[holderId])
    ||Object.values(charById||{}).find(x=>String(x&&x.name||"").trim().toLowerCase()===holderName);
  if(!c)return true;
  const scenes=(ctx&&ctx.scenes)||((window.turnContinuity||{}).scenes)||[];
  const spec=(typeof shotCharacterReferenceSpec==="function")
    ?shotCharacterReferenceSpec(c,scene,scenes):null;
  const state=spec&&spec.state;
  if(!state)return true;
  const stateText=[state.label,state.change,state.description,state.wardrobe,state.accessories,state.look]
    .filter(Boolean).join(" ");
  const shotText=[sh&&sh.action,sh&&sh.composition,sh&&sh.dialogue].filter(Boolean).join(" ");
  return wearableIdentityMentionedInText(p,stateText)||wearableIdentityMentionedInText(p,shotText);
}
window.shotWornPropAppliesToAppearance=shotWornPropAppliesToAppearance;

/* Wardrobe retention must identify the wearable itself, not merely two incidental
   words from its long bible name. The general prop matcher is intentionally broad
   enough for set dressing, but it made "Father's ... left wrist" match ordinary
   staging containing "father" and "left". For an active appearance state, accept
   the exact prop name, its canonical object noun (belt / glasses / watch), or an
   internal capitalized product/brand token such as Timex. */
function wearableIdentityMentionedInText(p,text){
  const clean=s=>String(s||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ").trim();
  const name=clean(p&&p.name), hay=" "+clean(text)+" ";
  if(!name||hay.trim()==="")return false;
  if(hay.indexOf(" "+name+" ")>=0)return true;
  const head=(typeof propHeadNoun==="function")?clean(propHeadNoun(p&&p.name)):"";
  if(head&&hay.indexOf(" "+head+" ")>=0)return true;
  const brands=String(p&&p.name||"").match(/\b[A-Z][A-Za-z0-9]{3,}\b/g)||[];
  return brands.slice(1).some(w=>hay.indexOf(" "+clean(w)+" ")>=0);
}
window.wearableIdentityMentionedInText=wearableIdentityMentionedInText;

/* WHICH props are in THIS frame — precise, so the model isn't handed sheets for objects
   that aren't there. Two ways in: (a) a WORN item of an in-frame character (it's on their
   body); (b) a prop NAMED in the action text. Naming requires a strong match — for a
   multi-word name, at least TWO of its significant words must appear (so "forearm latch"
   in the action picks "Forearm maintenance latch" but not "Seized door latch", which only
   shares the generic word "latch"). Candidates are tied to the scene (owner in frame, mapped
   to this scene, or UNMAPPED ownerless set dressing — a prop mapped to OTHER scenes can't
   leak in). Stored prop tags are NOT a source —
   they were the unreliable input the action text now replaces. */
function inFrameProps(sh, scene, charById, propById, ctx){
  const props = Object.values(propById||{});
  const castIds = (typeof inFrameCast==="function") ? inFrameCast(sh, scene, Object.values(charById||{}), ctx) : ((sh&&sh.subjects)||[]);
  const t = " "+(((sh&&sh.action)||"")+" "+((sh&&sh.composition)||"")).toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ")+" ";
  const out = [];
  // referencePropIds are explicit director overrides. sh.props is the older derived
  // cache written by shot drafting; treating that cache as a manual choice reintroduced
  // stale v1 wardrobe after an appearance-state costume change.
  const selected = [].concat((sh&&sh.referencePropIds)||[]).filter(Boolean);
  selected.forEach(id=>{ if(propById&&propById[id]&&out.indexOf(id)<0) out.push(id); });
  props.forEach(p=>{
    if(out.indexOf(p.id)>=0) return;
    const resolved=(typeof propStateAt==="function") ? propStateAt(p,scene&&scene.id,sh&&sh.beatN,sh&&sh.microBeatId,sh&&sh.id,window.turnContinuity||{}) : null;
    if(resolved && !resolved.active) return;
    const holderId=(resolved&&resolved.holderId)||p.ownerId||"";
    const holderIn=!!(holderId && castIds.indexOf(holderId)>=0);
    // Worn items follow the resolved holder, not the canonical owner. An active
    // character appearance state supersedes base wardrobe: only wearables explicitly
    // retained by that state or this shot survive as separate prompt/reference inputs.
    if(((resolved&&resolved.bindingMode)||(p.kind||"carried"))==="worn" && holderIn){
      if(shotWornPropAppliesToAppearance(p,sh,scene,charById,ctx,resolved))out.push(p.id);
      return;
    }
    const words = Array.from(new Set(String(p.name||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ")
      .split(/\s+/).filter(w=>w.length>=4 && !/^[0-9]+$/.test(w))));
    if(!words.length) return;
    const hits = words.filter(w=> t.indexOf(" "+w+" ")>=0).length;
    const strong = hits >= Math.min(2, words.length);   // multi-word name needs 2 hits
    if(!strong) return;
    // tied to THIS scene when: owner in frame, OR mapped to this scene, OR it's ownerless
    // set dressing with NO scene mapping at all (truly global). An ownerless prop mapped to
    // OTHER scenes is NOT global — it must not leak in here just because its name matches.
    const mappedHere = !!(scene && Array.isArray(p.scenes) && p.scenes.indexOf(scene.id)>=0);
    const globalDressing = !p.ownerId && !(Array.isArray(p.scenes) && p.scenes.length);
    const placedHere=!!(resolved&&resolved.placement&&scene&&resolved.placement.locationId
      && typeof locationForScene==="function"
      && ((locationForScene(((window.turnContinuity||{}).locations)||[],scene.id)||{}).id===resolved.placement.locationId));
    if(holderIn || mappedHere || globalDressing || placedHere) out.push(p.id);
  });
  return out;
}
window.inFrameProps = inFrameProps;

function propMentionedInText(p, text){
  const name = String(p&&p.name||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ");
  const words = name.split(/\s+/).filter(w=>w.length>=4 && !/^[0-9]+$/.test(w));
  if(!words.length) return false;
  const t = " "+String(text||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ")+" ";
  return words.filter(w=>t.indexOf(" "+w+" ")>=0).length >= Math.min(2, words.length);
}
function propLeavesFrameInText(p, text){
  if(!propMentionedInText(p, text)) return false;
  return /\b(drops?|dropped|discard(?:s|ed)?|throws?|thrown|toss(?:es|ed)?|releases?|lets go|sets down|puts down|hands? off|hands? over|gives? (?:it )?to|taken away|takes away|snatches?|stolen|breaks?|broken|shatters?|destroy(?:s|ed)?|burn(?:s|ed)?|stows?|pockets?|hides?|hidden|leaves? behind|lost)\b/i.test(String(text||""));
}

/* CONTINUITY LEDGER — the carry-forward fix. inFrameProps reads only THIS beat's text, so
   a prop established in beat 1 (Vanya's doll) silently vanishes from beat 2 if beat 2's
   action doesn't re-name it. This rolls a running "what each in-frame character was
   established holding/wearing earlier in the scene" total, beat by beat (story order), and
   returns, per shot, the prop ids to CARRY FORWARD (established earlier by someone in this
   frame, not already named here). Deterministic — no AI. Scoped to the scene so a prop set
   down in a later scene doesn't leak. Both the Shot List and Storyboard read it. */
function sceneContinuityLedger(scene, sceneShots, charById, propById){
  const ordered = (sceneShots||[]).slice().sort((a,b)=>(a.order||0)-(b.order||0) || (a.beatN||0)-(b.beatN||0));
  const chars = Object.values(charById||{});
  const held = {};   // charId -> Set(propId) established in this scene so far
  const ledger = {};
  ordered.forEach(sh=>{
    const cast = (typeof inFrameCast==="function") ? inFrameCast(sh, scene, chars) : ((sh&&sh.subjects)||[]);
    const here = (typeof inFrameProps==="function") ? inFrameProps(sh, scene, charById, propById) : ((sh&&sh.props)||[]);
    const text = [sh&&sh.action, sh&&sh.composition, sh&&sh.dialogue].filter(Boolean).join(" ");
    const cf = [];
    cast.forEach(cid=>{ const s=held[cid]; if(s) Array.from(s).forEach(pid=>{
      const p = (propById||{})[pid];
      const rs=(typeof propStateAt==="function")?propStateAt(p,scene&&scene.id,sh&&sh.beatN,sh&&sh.microBeatId,sh&&sh.id,window.turnContinuity||{}):null;
      if(rs && (!rs.active || (rs.holderId && rs.holderId!==cid))){ s.delete(pid); return; }
      if(!(p&&Array.isArray(p.continuityEvents)&&p.continuityEvents.length) && propLeavesFrameInText(p, text)){ s.delete(pid); return; }
      if(here.indexOf(pid)<0 && cf.indexOf(pid)<0) cf.push(pid);
    }); });
    ledger[sh.id] = cf;
    here.forEach(pid=>{ const p=(propById||{})[pid]; const rs=(typeof propStateAt==="function")?propStateAt(p,scene&&scene.id,sh&&sh.beatN,sh&&sh.microBeatId,sh&&sh.id,window.turnContinuity||{}):null;
      const holder=(rs&&rs.holderId)||(p&&p.ownerId); if(holder){ (held[holder]=held[holder]||new Set()).add(pid); } });
    here.forEach(pid=>{ const p=(propById||{})[pid]; const owner=p&&p.ownerId; const s=owner&&held[owner];
      if(s && !(p&&Array.isArray(p.continuityEvents)&&p.continuityEvents.length) && propLeavesFrameInText(p, text)) s.delete(pid);
    });
  });
  return ledger;
}
window.sceneContinuityLedger = sceneContinuityLedger;

/* REFERENTIAL-COMPLETENESS LINT (Part 4) — runs over a scene's BEAT MAP text and flags beats
   that aren't self-contained, BEFORE anything is generated: (a) a pronoun used while 2+
   characters are in play (the frame could mis-resolve it), and (b) a prop established
   earlier in the scene whose owner is still present but which this beat's text drops (it
   may pop out of the cut). Deterministic. `props` = [{name, owner|ownerName, type|kind}]
   (the props mapped to the scene in the Props tab). The lint reads the BEAT rows, never the screenplay
   prose (prose is meant to use pronouns). */
function beatContinuityLint(scene, beats, props, characters){
  const rows = (beats && beats.rows) || [];
  if(rows.length < 2) return [];
  const chars = characters || [];
  const propList = (props||[]).filter(p=> p && p.name && (p.type||p.kind)!=="dressing");
  const matchProp = (text, name)=>{
    const words = String(name||"").toLowerCase().replace(/[^a-z0-9 ]+/g," ").split(/\s+/).filter(w=>w.length>=4 && !/^[0-9]+$/.test(w));
    if(!words.length) return false;
    const t = " "+text.toLowerCase().replace(/[^a-z0-9 ]+/g," ").replace(/\s+/g," ")+" ";
    return words.filter(w=> t.indexOf(" "+w+" ")>=0).length >= Math.min(2, words.length);
  };
  const flags = [], lastSeen = {}, flaggedDrop = {};
  rows.forEach(r=>{
    const text = ((r.drive&&r.drive.d)||"")+" "+((r.react&&r.react.d)||"");
    const beatChars = (typeof scanTextForChars==="function") ? scanTextForChars(text, chars) : [];
    if(/\b(she|her|hers|he|him|his|they|them|it|its)\b/i.test(text) && beatChars.length>=2)
      flags.push({ beat:r.n, kind:"pronoun", msg:"Beat "+r.n+": a pronoun with "+beatChars.length+" characters in play — name who/what so the frame can't mis-resolve it." });
    propList.forEach(p=>{
      if(matchProp(text, p.name)){ lastSeen[p.name]=r.n; delete flaggedDrop[p.name]; return; }
      if(lastSeen[p.name]!=null && !flaggedDrop[p.name]){
        const owner = chars.find(c=> (c.name||"").toLowerCase() === String(p.owner||p.ownerName||"").toLowerCase());
        if(owner && beatChars.indexOf(owner.id)>=0){
          flags.push({ beat:r.n, kind:"drop", msg:"Beat "+r.n+": "+(p.owner||p.ownerName||"its owner")+" is present but “"+p.name+"” (last named beat "+lastSeen[p.name]+") isn't — it may drop out of that frame." });
          flaggedDrop[p.name]=true;
        }
      }
    });
  });
  return flags;
}
window.beatContinuityLint = beatContinuityLint;

/* normalise one AI-returned shot into our model, resolving subjects/props by id|name */
function normalizeShot(raw, scene, idx, locations, props, characters, beats, drafts){
  const sizeIds = SHOT_SIZES.map(x=>x.id), angleIds = SHOT_ANGLES.map(x=>x.id),
        moveIds = SHOT_MOVES.map(x=>x.id), lensIds = SHOT_LENSES.map(x=>x.id);
  const rawBeat = Number(raw && raw.beat);
  const beatNo = Number.isFinite(rawBeat) && rawBeat > 0 ? rawBeat : (idx+1);
  const pick = (v, ids, dflt)=>{ const u=String(v||"").toUpperCase(); const lc=String(v||"").toLowerCase();
    return ids.find(id=>id.toUpperCase()===u) || ids.find(id=>id.toLowerCase()===lc) || dflt; };
  const loc = locationForScene(locations, scene.id);
  const _drafts=Array.isArray(drafts) || (drafts && Array.isArray(drafts.blocks))
    ? {[scene.id]:drafts} : (drafts || (window.turnContinuity||{}).drafts || {});
  const _source=(typeof shotBeatSource==="function")
    ? shotBeatSource(scene,beatNo,{drafts:_drafts,characters:characters||[],beatsMap:beats||{}},characters||[]) : null;
  const _screenplayKeyframe=!!(_source&&_source.hasSource);
  const resolveChars = (arr)=>{
    const list = Array.isArray(arr)?arr:[];
    const ids = [];
    list.forEach(token=>{
      const t = String(token||"").toLowerCase().trim(); if(!t) return;
      const m = (characters||[]).find(c=> c.id.toLowerCase()===t || (c.name||"").toLowerCase()===t
        || t.includes((c.name||"").toLowerCase()) || (c.name||"").toLowerCase().includes(t));
      if(m && ids.indexOf(m.id)<0) ids.push(m.id);
    });
    return ids;
  };
  // Subjects from an authored screenplay opening are canonical.  Without source,
  // retain only explicit model/manual subjects — never invent a driver/reactor.
  const resolveSubjects = (raw, actionText)=>{
    const textIds = scanTextForChars((actionText||raw.action||"")+" "+(raw.composition||""), characters);
    if(textIds.length) return textIds;
    const aiIds = resolveChars(raw.subjects);
    return aiIds;
  };
  const resolveProps = (arr)=>{
    const list = Array.isArray(arr)?arr:[];
    const ids = [];
    list.forEach(token=>{ const t=String(token||"").toLowerCase().trim(); if(!t) return;
      const m = (props||[]).find(p=> p.id.toLowerCase()===t || (p.name||"").toLowerCase()===t
        || t.includes((p.name||"").toLowerCase()));
      if(m && ids.indexOf(m.id)<0) ids.push(m.id); });
    return ids;
  };
  // Never use a beat summary as screenplay evidence.  It remains a legacy
  // manual fallback only when this is not a screenplay-grounded keyframe.
  const beatRow = (beats && beats[scene.id] && (beats[scene.id].rows||[]).find(r=>String(r.n)===String(beatNo)));
  const beatAction = beatRow ? ((beatRow.drive&&beatRow.drive.d)||(beatRow.react&&beatRow.react.d)||"") : "";
  const specText = (v,max)=>{
    const clean = (typeof scrubBrand==="function" ? scrubBrand(String(v||"")) : String(v||"")).replace(/\s+/g," ").trim();
    return (typeof clipWords==="function") ? clipWords(clean,max) : clean.slice(0,max);
  };
  const action = _screenplayKeyframe ? String(_source.openingAction||"").trim()
    : (specText(raw.action,300) || "");
  const sourceSubjects=_screenplayKeyframe
    ? (_source.openingCharacterIds||[]).slice()
    : resolveSubjects(raw,action);
  const requestedSubjects=raw&&raw.referenceCharactersSet
    ? resolveChars(raw.referenceCharacterIds) : sourceSubjects;
  const sourceDialogue=_screenplayKeyframe
    ? ((_source.dialogue||[]).find(d=>d&&d.delivery==="in-room" &&
      (!d.speakerId||sourceSubjects.indexOf(d.speakerId)>=0))||{}).text||"" : "";
  const sideRaw = String(raw.locationSide || raw.side || "").toUpperCase();
  const out = {
    id: "shot-"+scene.id+"-"+beatNo+"-"+Date.now().toString(36)+idx,
    sceneId: scene.id, beatN: beatNo, order: idx,
    size: pick(raw.size, sizeIds, "MS"),
    angle: pick(raw.angle, angleIds, "eye"),
    move: pick(raw.move || raw.movement, moveIds, "static"),
    lens: pick(raw.lens, lensIds, "50"),
    composition: specText(raw.composition,240),
    subjects: requestedSubjects,
    locationId: loc?loc.id:"",
    props: resolveProps(raw.props),
    locationSide: /^(INT|EXT|BOTH)$/.test(sideRaw) ? sideRaw : undefined,
    referenceLocationsSet: !!raw.referenceLocationsSet,
    referenceLocationIds: Array.isArray(raw.referenceLocationIds) ? raw.referenceLocationIds.filter(Boolean) : [],
    referenceCharactersSet: !!raw.referenceCharactersSet,
    referenceCharacterIds: _screenplayKeyframe
      ? requestedSubjects.slice()
      : (Array.isArray(raw.referenceCharacterIds) ? raw.referenceCharacterIds.filter(Boolean) : []),
    action: action,
    dialogue: _screenplayKeyframe ? sourceDialogue : specText(raw.dialogue,200),
    // micro-beat mapping (pre-production layer): which of the beat's discrete
    // filmable actions this shot covers, why it exists, and whether it carries
    // the beat's protected emotional core. The per-beat plan (micro list +
    // protect line) rides denormalized on every shot of its beat.
    // Canonical contract: one screenplay micro-beat becomes one shot. Keep only
    // this shot's single moment number if legacy/model data supplies several.
    covers: _screenplayKeyframe ? [] : (Array.isArray(raw.covers) ? raw.covers.map(Number).filter(n=>Number.isFinite(n)&&n>0&&n<=20).slice(0,1) : []),
    purpose: specText(raw.purpose,160),
    priority: !!raw.priority,
    beatPlan: !_screenplayKeyframe && (raw.beatPlan && Array.isArray(raw.beatPlan.micro) && raw.beatPlan.micro.length)
      // micro-beats are story canon — stored in FULL, never length-capped with a
      // baked-in "…" (legacy 180-char clips heal at render via microHealText)
      ? { micro: raw.beatPlan.micro.map(t=> (typeof scrubBrand==="function" ? scrubBrand(String(t||"")) : String(t||"")).replace(/\s+/g," ").trim()).filter(Boolean).slice(0,10),
          protect: specText(raw.beatPlan.protect,220) }
      : undefined,
    // Creation-time text provenance. This is deliberately separate from the image
    // model recorded when the keyframe is rendered: one engine designs the shot,
    // another may render it, and Details must preserve both facts.
    writingProvenance: raw.writingProvenance && raw.writingProvenance.model
      ? { ...raw.writingProvenance } : undefined,
    // no dur: a drafted shot stays on AUTO — its length can't be predicted, only
    // budgeted (dialogue-anchored estimate via shotDur); the user pins by hand
    negativePrompt:"",
    specRev:1,
    ...(_screenplayKeyframe ? {
      keyframeMode:"beat-opening",
      openingAction:String(_source.openingAction||"").trim(),
      sourceScreenplayRev:String(_source.sourceRev||""),
      beatScript:String(_source.text||""),
      physicalCharacterIds:(_source.physicalCharacterIds||[]).slice(),
      remoteCharacterIds:(_source.remoteCharacterIds||[]).slice(),
      mentionedCharacterIds:(_source.mentionedCharacterIds||[]).slice(),
      sourceMetadata:{sceneHeading:_source.sceneHeading||"",sourceRev:String(_source.sourceRev||""),
        evidence:(_source.blocks||[]).map(b=>b&&b.evidence||b)}
    } : (raw&&raw.remoteCharacterIds ? {remoteCharacterIds:raw.remoteCharacterIds.slice()} : {}))
  };
  out.specHash = (typeof shotSpecFingerprint==="function") ? shotSpecFingerprint(out) : "";
  return out;
}
window.normalizeShot = normalizeShot;
