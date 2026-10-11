/* artroom.jsx — The Art Room (pre-production).
   Path A: Kinolot generates the prompts & specs and holds the asset slots; the user
   runs the image/video tools and drops results back in. Everything derives from
   the script so characters/locations/shots stay consistent.

   Character Sheets are pro consistency anchors: identity tokens + render texture,
   two wardrobe states (public mask / private self), accessories, scale & height,
   a colour palette (incl. a climax-state colour), a negative prompt, and a
   casting-style master reference prompt — all auto-populated when a story is
   generated. Locations / Shots / Storyboard are subsequent increments. */

const ART_TABS = [
  { id:"lookbook",   label:"Lookbook",   icon:"image" },
  // Characters BEFORE Props: a worn prop must match its owner's look, so the character is
  // generated first and the prop references THAT sheet (not the other way around).
  { id:"characters", label:"Characters", icon:"user" },
  { id:"props",      label:"Props",      icon:"box" },
  { id:"locations",  label:"Locations",  icon:"globe" },
  // "Color" (was "Styles", renamed 2026-09-26 by owner): the tab is the Colorist's grades;
  // "Styles" stays the top-bar manager for RENDER styles (photoreal, anime…)
  { id:"stylebible", label:"Color", icon:"layers" },
  { id:"shots",      label:"Shots",  icon:"film" },
  { id:"storyboard", label:"Storyboards", icon:"board" },
  // the First AD's stripboard: what every scene still needs before it can be shot
  // (owner-approved 2026-09-26). Reads the other tabs; generates nothing.
  { id:"breakdown",  label:"Breakdown",   icon:"grid" },
];
window.ART_TABS = ART_TABS;

/* pull hex colours out of a CSS gradient and seed a palette (key / shadow / climax) */
function paletteFromGradient(g){
  const hexes = (String(g||"").match(/#[0-9a-fA-F]{6}/g)) || ["#7a6cae","#2a2440"];
  return [
    { name:"Key", hex:hexes[0] },
    { name:"Shadow", hex:hexes[1]||hexes[0] },
    { name:"Climax", hex:"#b8412e" },
  ];
}
window.paletteFromGradient = paletteFromGradient;

/* deterministic visual defaults — so a sheet is never empty even before any
   model call. Generation applies these instantly; the sheet falls back to them. */
function charVisualDefaults(c){
  return {
    scaleClass: c.scaleClass || "Class A \u00b7 Human",
    height: c.height || "approx. 175 cm",
    negativePrompt: c.negativePrompt || "plastic skin, waxy texture, 3d render, cgi look, low resolution, blurry, deformed hands, extra fingers, warped face, text, watermark",
    palette: (c.palette && c.palette.length) ? c.palette : paletteFromGradient(c.color),
  };
}
window.charVisualDefaults = charVisualDefaults;

/* resolve a visual field with legacy fallback (old sheets used look/wardrobe) */
function vfield(c, key, legacy){ return (c[key] && c[key].trim()) ? c[key] : (legacy && c[legacy] ? c[legacy] : ""); }

/* Render-style presets for the character sheet — the user picks one per character from a
   dropdown; "surprise" is AI-invented per character (see aiSurpriseRenderStyle). These are
   GENERALISED (no character-specific materials) so they apply to any cast member; each owns
   its own background + the no-text rules. The character's OWN palette/materials are honoured
   via "this character's own …" phrasing rather than hard-coded props. */
const CHAR_RENDER_STYLES = {
  photoreal: {
    rendering: "hyperrealistic photography, full-frame sensor look, fine grain, no illustration or painterly quality",
    lens: "85mm portrait rendering for the hero close-up with shallow depth of field; ~50mm full-length framing for the turnaround poses, subject sharp head-to-toe",
    lighting: "soft cinematic key from upper left with gentle fill and a subtle rim to separate the figure from the background \u2014 controlled and even enough that detail reads cleanly in every view",
    surface_texture: "photoreal micro-detail true to THIS character's own skin, fabrics and materials \u2014 visible pores and fine wrinkles, fabric nap, leather grain, specular glints on metal/glass, wear and grime where the design calls for it, individual stray hairs",
    color_grade: "filmic, slightly desaturated; honour the character's own palette; warm low-contrast highlights, cool soft shadows",
    background: "seamless off-white studio sweep, even and near-shadowless, with a soft contact shadow under the feet",
    rules: ["no text, labels, watermarks, annotations, typography or captions","photorealistic, 8k, ultra-detailed","natural skin and fabric texture","clean, evenly divided panel layout"]
  },
  photorealNatural: {
    rendering: "natural photoreal biological macro photography — real animal / critter realism, no fantasy stylization, no creature-shop ornament, no costume-like design",
    lens: "true macro wildlife / specimen photography; 100mm macro close-ups with shallow natural depth of field, clean full-body turnaround views sharp enough for anatomy and texture",
    lighting: "soft naturalistic studio macro light with gentle fill; realistic catchlights and contact shadows, controlled enough that skin, fur, scales, wings or shell detail reads clearly",
    surface_texture: "biological micro-detail true to THIS character's species and materials — pores, wet skin sheen, fur clumping, scale edges, insect chitin, wing veins, tiny hairs, dust and moisture where appropriate",
    color_grade: "true-to-life natural colour, lightly filmic but minimally stylized; honour the character's own palette and biological markings",
    background: "clean off-white natural-history studio sweep, minimal shadows, specimen-reference clarity",
    rules: ["no text, labels, watermarks, annotations, typography or captions","real animal / biological macro realism","minimal stylization, no fantasy armor, no fashion ornament, no CG creature-shop polish","consistent anatomy and markings across all panels","clean, evenly divided panel layout"]
  },
  photorealCreature: {
    rendering: "cinematic photoreal film-creature realism — believable practical-effects / prosthetic / VFX maquette finish, physically plausible but designed for screen presence",
    lens: "cinematic creature reference photography; 85mm portrait close-ups, ~50mm full-body turnaround views, grounded lens compression and realistic depth of field",
    lighting: "controlled creature-shop studio lighting — soft key, gentle fill, rim separation, glossy practical-material catchlights; readable from every angle",
    surface_texture: "screen-believable tactile detail — silicone skin, prosthetic seams where appropriate, chitin, wet membranes, fur, feathers, scales, worn fabric, grime and practical material imperfections",
    color_grade: "filmic creature design grade, grounded contrast and saturation; honour the character's palette while keeping it plausible under live-action lighting",
    background: "neutral creature-shop photo sweep, soft contact shadow, practical maquette presentation",
    rules: ["no text, labels, watermarks, annotations, typography or captions","believable film creature, practical effects / prosthetic / VFX maquette realism","physically plausible screen design, not a flat illustration or toy render","consistent design and materials across all panels","clean, evenly divided panel layout"]
  },
  photorealOrnamental: {
    rendering: "photoreal ornamental creature design — physically rendered cinematic realism with couture, ceremonial, jewelry-like or armor-like surface design",
    lens: "premium fashion-creature reference photography; 85mm hero close-ups, ~50mm full-body turnaround views, crisp silhouette and material readability",
    lighting: "luxury studio creature lighting — soft sculpting key, elegant rim, controlled specular glints on iridescence, metal, wet shell, glass, crystal or beadwork",
    surface_texture: "high-end tactile ornament — iridescent chitin, polished armor plates, translucent veils, jeweled details, couture-like membranes, fine filigree and decorative wear while preserving anatomy",
    color_grade: "refined cinematic fashion grade; controlled contrast, elegant highlights, palette led by the character's own colours with metallic or pearlescent accents where the design calls for it",
    background: "clean premium studio sweep with soft contact shadow, gallery/specimen clarity without labels",
    rules: ["no text, labels, watermarks, annotations, typography or captions","photoreal ornamental / couture creature design","elegant jewelry-like, armor-like or ceremonial detail while staying physically plausible","consistent silhouette, materials and decoration across all panels","clean, evenly divided panel layout"]
  },
  render3d: {
    rendering: "high-quality stylized 3D character render, animated-feature quality; physically-based shading (PBR), soft subsurface scattering on skin, ray-traced soft shadows and global illumination, gentle ambient occlusion in seams and folds",
    engine_look: "offline render aesthetic (Arnold / RenderMan / Octane / Redshift) \u2014 clean, polished, high-sample, no noise",
    materials: "stylized PBR materials true to THIS character's own design \u2014 fabrics with soft sheen, supple creased leather, refractive glass, translucent gems, wet/crusted grime and subtle worn-edge wear where the design calls for it",
    lighting: "soft three-point studio render lighting \u2014 broad key from upper left, gentle fill, cool rim to separate the figure from the background; warm bounce, cinematic but even enough to read every panel",
    color_grade: "rich but muted; honour the character's own palette; soft filmic contrast, slight warm bias in highlights",
    background: "seamless soft neutral light-grey studio sweep with a gentle gradient and a soft grounded contact shadow under the feet",
    rules: ["no text, labels, watermarks, annotations, typography or captions","clean high-sample render, no render noise or fireflies","consistent shaders and lighting across all panels","clean, evenly divided panel layout"]
  },
  anime: {
    rendering: "high-quality color anime / cel-shaded illustration; clean confident ink line art with consistent line weight, flat color fills, two-to-three tone cel shading with crisp shadow shapes",
    linework: "clean black or dark-brown outlines, slightly heavier on outer contours, finer for interior detail; minimal hatching reserved for fabric folds and skin creases",
    shading: "hard-edged cel shadows from an upper-left light, soft ambient fill, simple specular glints \u2014 no photoreal gradients",
    color_grade: "anime palette drawn from THIS character's own colours; low saturation suited to the story's tone",
    background: "flat off-white / very light neutral panel background, even and clean; a simple soft contact shadow under the feet",
    rules: ["no text, labels, watermarks, annotations, typography or captions","high-resolution, sharp clean line art","consistent cel-shading across all panels","clean, evenly divided panel layout"]
  },
  flat: {
    rendering: "clean flat vector / graphic illustration; solid color fills, simplified geometric forms, crisp shapes, no rendered texture",
    shape_language: "bold readable silhouettes, rounded confident forms; minimal detail reduced to essential shapes",
    outline: "optional thin clean uniform outline OR outline-free overlapping flat shapes \u2014 consistent choice across all panels",
    shading: "flat \u2014 at most one darker tone per color for simple shadow shapes; no gradients, no rendered light, no texture",
    palette: "tight limited palette (6\u20138 flat colors) drawn from THIS character's own colours, with one or two saturated accents",
    background: "single flat solid color or a simple flat geometric ground (light neutral or soft warm tone); a small flat shadow shape under the feet; no studio sweep, no texture",
    rules: ["no text, labels, watermarks, annotations, typography or captions","perfectly flat color, crisp clean edges, scalable vector quality","consistent palette, shapes and outline treatment across all panels","clean, evenly divided panel layout"]
  },
  horror: {
    "rendering": "hyperrealistic cinematic photography pushed to horror; full-frame look, fine grain, deep filmic blacks, no illustration or cartoon quality",
    "lighting": "low-key chiaroscuro — a single hard cold source (moonlight or a distant practical) raking from the side, deep crushed shadows swallowing most of the figure, a thin cold rim for separation, at most one small warm accent from the character's own design; large areas of pure darkness",
    "atmosphere": "damp haze and low ground fog, faint volumetric light shafts, particulate in the air, a sense of cold wet stillness",
    "color_grade": "desaturated and cold — sickly green-teal shadows, muted midtones, crushed inky blacks; at most one lone warm accent for contrast; grim and oppressive",
    "surface_texture": "photoreal damp, grimy detail true to THIS character's own materials — clammy skin sheen, wet fabric and leather, beaded moisture on hard surfaces; texture readable only where the light catches",
    "framing": "tense cinematic horror composition — figure emerging from darkness, heavy negative space, unease in the empty dark around the figure",
    "background": "deep near-black foggy void rather than a clean studio sweep; the figure lit out of the dark; a faint cold ground haze under the feet",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","low-key cinematic horror lighting, deep atmospheric blacks","atmospheric dread, not gore or graphic injury","consistent lighting, fog and grade across all panels","evenly divided panel layout, figures readable despite the dark"]
  },
  ghibli: {
    "rendering": "soft hand-painted 2D cel animation look; delicate thin organic linework, gentle cel shading with soft painterly edges, a warm hand-drawn quality — not hard-edged graphic cel, not photoreal, not 3D",
    "linework": "fine, soft, slightly irregular hand-drawn lines; light brown or muted dark outlines rather than heavy black; line that breathes and varies gently",
    "shading": "simple soft cel shadows with feathered edges and a warm ambient fill; gentle painterly transitions, no hard graphic blocks",
    "color_grade": "warm naturalistic palette honouring THIS character's own colours, set among soft natural greens, gentle browns and warm creams; slightly desaturated, sunlit, nostalgic",
    "texture": "subtle hand-painted softness and faint paper/cel warmth; a quiet, still, pastoral mood",
    "background": "soft, simple, lightly hand-painted pale ground (warm cream or gentle sky-tone) so the figure reads cleanly; a soft contact shadow under the feet — uncluttered, but painterly rather than flat",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","soft hand-drawn warmth, gentle naturalistic detail","consistent line, palette and shading across all panels","clean, evenly divided panel layout"]
  },
  animated3d: {
    "rendering": "high-quality animated-feature 3D render; appealing stylized character, physically-based shading with soft subsurface scattering, clean polished surfaces, ray-traced soft shadows and warm global illumination",
    "engine_look": "polished animated-movie pipeline render (RenderMan / Arnold quality) — clean, high-sample, idealized, no noise",
    "lighting": "soft, warm, flattering animated-feature lighting — broad key, generous bounce fill, gentle rim, an appealing glow; the 'every frame looks beautiful' look; even enough to read every panel",
    "materials": "stylized PBR with appeal, true to THIS character's own design — soft fuzzy fabrics, supple rounded leather, cheerfully refractive glass, glowing translucent accents, simplified clean grime; gentle worn-edge wear",
    "expression_and_appeal": "lively acting and personality in face and pose; squash-stretch-friendly appealing forms; charm prioritized over grit",
    "color_grade": "warm, inviting, slightly saturated palette honouring THIS character's own colours; soft cheerful contrast",
    "background": "seamless soft warm light-cream studio sweep with a gentle gradient and a soft grounded contact shadow under the feet",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","clean high-sample render, appealing animated-feature finish, no noise","lively expression and personality, not a stiff neutral sculpt","consistent shaders and lighting across all panels","clean, evenly divided panel layout"]
  },
  pixar: {
    "rendering": "high-end Pixar-style animated-feature 3D character render — appealing stylized proportions (slightly oversized head and large expressive eyes, soft rounded forms), physically-based shading with soft subsurface scattering and fine peach-fuzz on skin, clean polished surfaces, ray-traced soft shadows and warm global illumination",
    "engine_look": "top-tier animated-movie pipeline render (RenderMan-quality) — pristine, high-sample, idealized, no noise or fireflies",
    "character_appeal": "maximum 'appeal' — warm, expressive, lively face with large emotive eyes, charming readable acting in the pose, squash-and-stretch-friendly construction; personality and warmth over gritty realism",
    "materials": "stylized-but-tactile PBR true to THIS character's design — soft fuzzy fabrics, supple rounded leather, cheerfully refractive glass, glowing translucent accents, simplified clean grime and gentle worn-edge wear",
    "lighting": "soft, warm, flattering key lighting — broad key, generous bounce fill, gentle rim, an appealing glow; the 'every frame is a painting' look; even enough to read every panel",
    "color_grade": "warm, inviting, gently saturated palette honouring the character's own colours; soft cheerful filmic contrast",
    "background": "seamless soft warm light-cream studio sweep with a gentle gradient and a soft grounded contact shadow under the feet",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","clean high-sample render, appealing Pixar-style finish, no noise","lively expression, charm and appeal — not a stiff neutral sculpt","consistent character design, shaders and lighting across all panels","clean, evenly divided panel layout"]
  },
  paintedconcept: {
    "rendering": "a richly HAND-PAINTED concept-art illustration — a soft painterly 2D painting (digital or traditional media) in the lineage of Laika and Guillermo del Toro production paintings; NOT a 3D render, NOT flat cel animation, NOT photography",
    "brushwork": "visible expressive brushwork and soft blended edges — layered glazes, gentle impasto on highlights; forms built from paint rather than hard outlines or vector fills; a tactile, hand-made surface",
    "rendering_detail": "lush volumetric rendering of form — soft form shadows, delicate rim and bounce light, fine texture (downy fuzz, worn fabric, soft translucency) suggested with the brush rather than literal micro-detail",
    "character_appeal": "storybook charm with a touch of the whimsical-gothic and uncanny — large soulful eyes, a gentle melancholy, an expressive hand-acted face; appealing but with painterly soul, never glossy or sterile",
    "color_grade": "muted, warm painterly palette honouring THIS character's own colours, with earthy umbers and a dusky warm glow; soft filmic contrast, slightly desaturated, nostalgic and tactile",
    "lighting": "soft directional storybook lighting — a gentle warm key, deep soft ambient, a soft warm bounce; painterly chiaroscuro, even enough to read every panel",
    "texture": "faint canvas/paper tooth and soft painterly grain across the image; the warmth of hand-made media, never crisp digital cleanliness",
    "background": "a soft, simple, loosely hand-painted warm-cream or muted ground with quiet painterly atmosphere so the figure reads cleanly; a soft painted contact shadow under the feet",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","richly hand-painted painterly illustration with visible brushwork and soft edges","NOT 3D CG, NOT flat cel/vector, NOT photographic","consistent painted style, palette and lighting across all panels","clean, evenly divided panel layout"]
  },
  storyboardconcept: {
    "rendering": "clean storyboard / animation concept-art illustration — expressive linework, clear cinematic staging, readable silhouettes and mood-first design; polished enough for production reference but not over-rendered",
    "linework": "thin-to-medium confident drawing lines, sketch-aware but controlled; architectural/background lines may stay lightly visible like layout art",
    "shading": "soft restrained cel shading and pale wash shadows; enough form to read volume without becoming photographic",
    "color_grade": "limited production-paint palette drawn from THIS character's own colours; airy highlights, soft shadows, restrained saturation",
    "background": "simple light production-design board ground, clean enough for a reference sheet, with subtle cinematic atmosphere and a soft contact shadow",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","storyboard / concept-board clarity","expressive but clean linework","consistent design and staging across all panels","clean, evenly divided panel layout"]
  },
  texturedcomic: {
    "rendering": "textured contemporary comic illustration — bold expressive ink line, etched hatching, limited warm palette, dramatic graphic light and painterly texture",
    "linework": "visible black/brown ink lines with textured irregular edges; confident contours, selective cross-hatching and scratched detail",
    "shading": "strong shadow shapes with grainy overlays, stipple and rough brush texture; high-contrast but still readable",
    "color_grade": "limited cinematic comic palette; warm skin/material tones, deep shadow colour, selective saturated accents from THIS character's palette",
    "background": "light neutral comic-art sheet ground with subtle paper/grain texture and a grounded contact shadow",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","bold textured comic inkwork","limited palette, dramatic contrast and etched detail","consistent line and texture across all panels","clean, evenly divided panel layout"]
  },
  // GTA loading-screen art (added 2026-09-25 by owner). The prompt describes the LOOK and
  // never names the franchise, so image models render it instead of refusing named IP.
  gtaLoadingScreen: {
    "rendering": "open-world crime-game loading-screen poster illustration — semi-realistic figures drawn with bold black ink outlines and crisp cel-shaded forms, confident attitude poses, glossy commercial-poster finish",
    "linework": "heavy clean black contour lines of varying weight around every form, sharp interior lines for folds, muscles and hair; graphic, never sketchy",
    "shading": "two-to-three-tone hard-edged cel shadows with a few smooth airbrushed gradients on skin, chrome and fabric; strong directional sunlight, crisp specular highlights",
    "color_grade": "sun-drenched saturated palette — hot sunset oranges, magentas and teals, deep blue-black shadows, bright skin tones; high contrast, clean colour blocks drawn from THIS character's palette",
    "background": "flat warm-to-cool gradient poster ground (sunset sky tones) with a crisp contact shadow; no scenery clutter behind the turnaround",
    "rules": ["no text, labels, watermarks, annotations, typography, logos or captions","bold black outlines and hard cel shading throughout","semi-realistic proportions and faces, never chibi or cartoon-exaggerated","consistent face, outfit and palette across all panels","clean, evenly divided panel layout"]
  },
  whimsicalwatercolor: {
    "rendering": "whimsical watercolor and fine-ink children's-book illustration — loose transparent washes, delicate hand-drawn line, soft charm and gentle storybook warmth",
    "linework": "thin irregular ink or pencil line with small expressive wiggles; never slick vector or heavy comic outline",
    "paint": "visible watercolor blooms, paper grain, soft pigment edges, translucent layered washes and tiny hand-painted imperfections",
    "color_grade": "soft delicate palette drawn from THIS character's colours; airy neutrals, gentle accents, warm nostalgic atmosphere",
    "background": "warm watercolor-paper ground with a faint wash and soft painted contact shadow; uncluttered enough for a reference sheet",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","watercolor wash and fine ink line","storybook warmth, delicate texture and hand-painted paper grain","consistent palette and character design across all panels","clean, evenly divided panel layout"]
  },
  stopmotion: {
    "rendering": "photograph of a real handmade stop-motion puppet on a miniature set — NOT a digital CG render, not a drawing; tactile physical materials captured by a real camera",
    "construction": "visible handmade craft — sculpted silicone skin with faint mould/replacement seams, real felted wool and fabric at true tiny scale with weave and hand-stitching, needle-felted hair, real leather and glass, an armature-posable feel",
    "imperfection": "lovingly handmade quality — faint fingerprints or tool marks, fabric fuzz, tiny irregular stitches, soft sculpt softness; charming, not flawless",
    "photography": "macro / miniature photography — shallow real depth of field, soft practical studio set lighting (gentle key, warm fill, subtle rim), a faint tilt-shift miniature feel, real catchlights and contact shadows",
    "color_grade": "warm, tactile, slightly filmic palette honouring THIS puppet's own colours; cozy handmade contrast",
    "background": "simple soft miniature-set backdrop or a clean neutral surface the puppet stands on, evenly and warmly lit; a real soft contact shadow under the feet; shallow background focus",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","real handmade puppet materials and craft texture, visible at macro scale","physical photographed look, not digital CG smoothness","consistent puppet, lighting and lens across all panels","clean, evenly divided panel layout"]
  },
  adv1960s: {
    "rendering": "1960s painted commercial illustration — smooth confident gouache/airbrush rendering, idealized stylized figure, clean optimistic finish; NOT photographic, NOT modern digital",
    "illustration_handling": "soft airbrushed gouache gradients with crisp painted highlights and confident edges; gentle outline where useful; tidy, aspirational, mid-century commercial polish",
    "print_process": "vintage offset-print look — visible halftone dot texture, slight color-registration offset, subtle ink-on-paper grain, faintly aged warm paper stock",
    "palette": "classic mid-century limited palette — mustard yellow, avocado and moss green, burnt orange, teal, warm cream, chocolate brown, soft coral; muted-but-warm, cheerful",
    "lighting": "bright, even, flattering ad-illustration light — wholesome and clean, soft idealized modeling, no harsh shadow",
    "background": "flat warm cream or soft mid-century color-block panel, lightly textured like aged print stock; a simple painted shadow grounding the feet; clean and uncluttered (no text)",
    "rules": ["no text, labels, watermarks, annotations, typography, captions or logos","authentic mid-century gouache illustration with halftone print texture","cheerful, idealized, aspirational ad-art tone","consistent palette, halftone and rendering across all panels","clean, evenly divided panel layout"]
  },
  claymation: {
    "rendering": "photograph of a real claymation / plasticine puppet on a miniature set — NOT a digital CG render, not a drawing; soft physical clay captured by a real camera",
    "construction": "modeling-clay / plasticine craft — rounded smooth-sculpted simplified forms, visible thumbprints and sculpting-tool marks, soft matte-to-glossy clay sheen, the subtle handmade wobble of re-sculpted stop-motion clay",
    "imperfection": "lovingly handmade clay quality — fingerprints, tool grooves, tiny surface irregularities, soft uneven edges; charming, never flawless or machined",
    "photography": "macro / miniature photography — shallow real depth of field, soft practical studio set lighting (gentle key, warm fill, subtle rim), real catchlights and contact shadows, a faint tilt-shift miniature feel",
    "color_grade": "warm, tactile, slightly matte palette honouring THIS character's own colours in soft clay tones; cozy handmade contrast",
    "background": "simple soft miniature-set backdrop or a clean warm surface the puppet stands on, evenly and warmly lit; a real soft contact shadow under the feet; shallow background focus",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","real plasticine clay craft — fingerprints and tool marks visible at macro scale","rounded, simplified, handmade clay forms, not digital CG smoothness","consistent clay puppet, lighting and lens across all panels","clean, evenly divided panel layout"]
  },
  // gag-anime (owner decision 2026-09-26): its backdrop was one postcard — a sunset coastal
  // city with a suspension bridge — behind EVERY character, plus a graffiti title field and no
  // no-text rule. A character sheet is an identity reference: the backdrop is now a plain warm
  // gradient (the sunset lives in the colour, not in a place) and the sheet carries no lettering.
  gaganime: {
    "rendering": "playful 1990s Japanese gag-anime cartoon illustration — flat 2D cel-shaded art with bold black outlines, not claymation, not photography, not CG",
    "construction": "clean vector-like cartoon construction — oversized rounded chibi proportions, simplified shapes, soft bulbous forms, minimal internal detail, thick confident ink outlines, flat high-saturation color fills, simple graphic shadow shapes",
    "imperfection": "handmade cartoon charm through expressive asymmetry, slightly wobbly line rhythm, exaggerated comic proportions, playful simplified wrinkles and features; clean but not sterile",
    "linework": "very thick black outer contours with thinner simple interior lines; rounded cartoon silhouettes; no fine realistic rendering",
    "shading": "flat cel shading with one or two simple shadow shapes per form; no painterly blending, no realistic texture, no photographic lighting",
    "presentation": "not photographed — a clean illustrated character sheet with a crisp, sticker-like finish; straight-on, eye-level framing in every panel so the face and chibi proportions read clearly as the identity anchor",
    "color_grade": "bright, warm, high-saturation cartoon palette taken from THIS character's own colours (their real wardrobe and skin tone), kept true to those colours; the warm sunset feel (apricot, tangerine, soft coral) lives only in the backdrop gradient and small highlight accents, with crisp cyan graphic glints; cheerful comic contrast",
    "background": "plain flat cartoon ground — a soft, low-saturation warm gradient from pale cream at the bottom to light apricot at the top, identical in every panel, with a simple flat cel-shadow shape under the feet; nothing behind the figure: no scenery, buildings, landmarks or objects; clean graphic panel dividers",
    "rules": ["no text, labels, watermarks, annotations, typography or captions","2D gag-anime cartoon character sheet","thick bold black outlines","flat high-saturation cel-shaded colors","oversized rounded chibi proportions","simple expressive face with huge oval eyes and tiny mouth","minimal detail, soft rounded shapes, sticker-like finish","plain place-free backdrop — the figure alone on the flat warm gradient","consistent same character design across all panels","clean evenly divided concept-sheet layout","no photorealism, no clay, no plasticine, no 3D render, no realistic anatomy"]
  },
  pixelart: {
    "rendering": "detailed retro pixel art; hard square pixels, NO anti-aliasing, crisp pixel edges, drawn on a clear pixel grid (16/32-bit JRPG / PC-98 fidelity, not chunky 8-bit)",
    "pixel_scale": "consistent medium-resolution pixel grid across all panels; the hero portrait may use a slightly larger sprite but the same pixel size",
    "palette": "tight limited indexed palette (a warm lo-fi set) built from THIS character's own colours, plus a couple of cool shadow tones; cohesive and nostalgic",
    "shading": "stepped flat shading within the palette, with ordered/checkerboard DITHERING for gradients and soft transitions; pixel-cluster highlights; no smooth gradients",
    "outline": "selective dark pixel outlines on outer contours and key forms; clean, consistent",
    "mood": "cozy, warm, nostalgic lo-fi atmosphere",
    "background": "simple flat or softly dithered warm-neutral pixel background so the sprites read clearly; a small pixel contact shadow under the feet; uncluttered",
    "rules": ["no text, labels, watermarks, annotations, typography, captions or UI elements","authentic hard-edged pixel art with dithering and a limited palette","consistent pixel scale, palette and dithering across all panels","clean, evenly divided panel layout"]
  }
};
Object.assign(CHAR_RENDER_STYLES, {
  modernAnime: {
    rendering: "modern cinematic anime illustration — clean sharp linework, expressive eyes, polished contemporary cel shading and dynamic animated-film appeal",
    linework: "crisp confident anime outlines with refined interior detail; expressive facial construction, clean hair and wardrobe shapes",
    shading: "sharp defined cel shadows with subtle painted gradients in highlights; cinematic light direction, no photoreal skin texture",
    color_grade: "vibrant contemporary anime palette drawn from THIS character's colours; clear highlights, saturated skies or accents where appropriate",
    background: "clean pale anime production-sheet ground with a soft contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","modern polished anime character design","consistent face, proportions and costume across all panels","clean, evenly divided panel layout"]
  },
  digitalAnime: {
    rendering: "polished digital anime illustration — smooth refined rendering, clean line art, vibrant colour and an almost painterly digital finish",
    linework: "thin clean anime linework with elegant contour control and careful eye/detail rendering",
    shading: "soft digital shading blended over cel structure; glossy controlled highlights, luminous atmosphere",
    color_grade: "bright refined anime palette with gentle gradients, fashion/editorial colour accents from THIS character's palette",
    background: "soft pastel or light neutral digital-illustration ground with subtle glow and contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","smooth polished digital anime finish","consistent line, palette and rendering across all panels","clean, evenly divided panel layout"]
  },
  roughSketchAnime: {
    rendering: "rough sketch anime concept art — bold sketchy linework, flat colour with light hatching, immediate production-design energy",
    linework: "visible loose pencil/ink strokes, confident imperfect contours, construction-line vitality without looking unfinished",
    shading: "mostly flat colour with selective hatching, cross-hatching and rough shadow marks",
    color_grade: "limited vivid anime palette with bold background accents, drawn from THIS character's own colours",
    background: "plain warm sketchbook or bold flat colour ground with subtle paper grain",
    rules: ["no text, labels, watermarks, annotations, typography or captions","rough sketch anime energy, not polished photorealism","consistent character design across all panels","clean, evenly divided panel layout"]
  },
  painterlyAnime: {
    rendering: "painterly anime illustration — delicate expressive line, soft blending, visible brush texture and dreamy animated atmosphere",
    linework: "fine gentle anime linework, slightly irregular and expressive",
    paint: "soft painterly brushstrokes, blended colour fields, subtle grain and luminous atmospheric wash",
    color_grade: "dreamy painterly palette drawn from THIS character's colours; soft greens, violets, creams or warm accents as appropriate",
    background: "light painterly ground with atmospheric wash and soft contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","anime blended with painterly brushwork","soft emotional atmosphere","consistent design and palette across all panels","clean, evenly divided panel layout"]
  },
  cartoon3d: {
    rendering: "stylized 3D cartoon character render — exaggerated animation proportions, bold readable forms, cinematic digital-paint finish",
    engine_look: "polished cartoon-feature render, clean high-sample lighting, not photoreal and not flat 2D",
    materials: "smooth stylized materials true to THIS character's costume and props; soft fabric, simple skin, rounded edges",
    lighting: "dramatic but readable animated-feature lighting with strong silhouette and soft fill",
    background: "simple neutral 3D studio sweep with a soft grounded shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","stylized 3D cartoon, bold expressive character appeal","consistent shaders and proportions across all panels","clean, evenly divided panel layout"]
  },
  textured3dCartoon: {
    rendering: "textured 3D cartoon render — simplified animated character forms with visible felt, clay, fabric or fuzzy surface texture",
    materials: "tactile stylized materials: visible fabric nap, felt fuzz, clay softness, knitted fibres or paper texture where the design calls for it",
    lighting: "soft even studio light that reveals tactile surface texture and rounded cartoon forms",
    color_grade: "friendly saturated palette drawn from THIS character's colours; soft shadows and warm highlights",
    background: "clean colour or neutral studio ground with soft contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","textured 3D cartoon surfaces, tactile and charming","consistent material texture across all panels","clean, evenly divided panel layout"]
  },
  stylizedCartoon: {
    rendering: "stylized cartoon illustration — bold flat areas of colour, distinct outlines, theatrical composition and graphic animated charm",
    linework: "clean bold outlines with simplified expressive features and readable silhouette",
    shading: "flat colour blocks with selective graphic shadows; minimal texture, strong shape design",
    color_grade: "lively cartoon palette drawn from THIS character's colours with clear accent contrasts",
    background: "simple flat or lightly painted neutral ground with a clean contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","stylized cartoon illustration, not photoreal","bold outlines and clean graphic shape language","consistent design across all panels","clean, evenly divided panel layout"]
  },
  grittyDigital: {
    rendering: "gritty digital illustration — harsh lighting, strong linework, dramatic high-contrast palette and painterly texture",
    linework: "expressive dark lines and rough detail marks; intense contemporary illustration finish",
    shading: "deep shadows, vibrant edge highlights, textured brush grain and moody atmosphere",
    color_grade: "dramatic dark palette with selective saturated highlights from THIS character's colours",
    background: "simple dark-to-neutral textured ground with atmospheric shadow and contact grounding",
    rules: ["no text, labels, watermarks, annotations, typography or captions","gritty digital illustration, high contrast and painterly texture","consistent mood and design across all panels","clean, evenly divided panel layout"]
  },
  softPainterly: {
    rendering: "soft painterly illustration — visible brushstrokes, blended colour, gentle dreamy character appeal and traditional-paint warmth",
    brushwork: "soft visible brush texture, delicate edges, layered colour and subtle canvas/paper grain",
    shading: "gentle form modelling with warm highlights and low-contrast shadows",
    color_grade: "soft blended palette drawn from THIS character's colours; gentle, dreamy and emotionally warm",
    background: "light painterly ground with faint texture and a soft painted contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","soft painterly character illustration","visible brushwork and gentle blended colour","consistent design across all panels","clean, evenly divided panel layout"]
  },
  realisticDigitalDrawing: {
    rendering: "realistic digital drawing — high realism in an illustrated digital style, detailed texture and photographic lighting logic without becoming a photo",
    linework: "mostly hidden refined drawing structure, clean edges and carefully observed anatomy",
    shading: "detailed digital painting with realistic light, softened background and sharp subject focus",
    color_grade: "naturalistic digital-art palette honouring THIS character's colours; balanced contrast and atmospheric depth",
    background: "simple softly rendered studio ground with realistic contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","realistic digital drawing, not photography","detailed textures and believable lighting","consistent identity across all panels","clean, evenly divided panel layout"]
  },
  flatDesign: {
    rendering: "flat design illustration — simplified shapes, bold flat colours, minimal shading and modern graphic clarity",
    shape_language: "large simplified geometric forms, clean silhouette, decorative but economical details",
    shading: "minimal or no shading; one simple shadow colour at most",
    palette: "limited modern flat palette drawn from THIS character's colours",
    background: "flat light ground with simple geometric shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","flat design illustration, minimal shading","clean simplified shapes and bold colour","consistent graphic treatment across all panels","clean, evenly divided panel layout"]
  },
  minimalistLine: {
    rendering: "minimalist line art — clean flowing economical lines, sparse detail, elegant negative space and little to no colour",
    linework: "thin graceful black or dark-grey lines with selective accent marks; no heavy rendering",
    shading: "none or extremely minimal; form is carried by contour and gesture",
    palette: "mostly warm paper, black line and one tiny accent colour from THIS character's palette",
    background: "warm off-white paper ground with abundant negative space",
    rules: ["no text, labels, watermarks, annotations, typography or captions","minimalist line art, sparse and elegant","no rendered texture or heavy shading","consistent silhouette across all panels","clean, evenly divided panel layout"]
  },
  vintageChildrensBook: {
    rendering: "vintage children's book illustration — bold ink outlines, limited colour palette and nostalgic hand-drawn print texture",
    linework: "loose charming ink line, slightly irregular and playful",
    print_process: "warm aged paper, simple spot colour, stipple or rough ink texture",
    palette: "very limited palette drawn from THIS character's colours plus one strong accent",
    background: "warm cream paper ground with sparse printed shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","vintage children's book illustration","limited colour and nostalgic print texture","consistent hand-drawn charm across all panels","clean, evenly divided panel layout"]
  },
  tactileMixedMedia: {
    rendering: "tactile mixed-media illustration — miniature handmade artwork combining fabric, felt, paper, paint and sculpted pieces",
    materials: "visible craft materials: wool, felt, thread, paper cutouts, painted surfaces, tiny props and handmade seams",
    photography: "photographed handmade diorama look with soft macro depth of field and gentle practical light",
    color_grade: "soft cozy handmade palette drawn from THIS character's colours",
    background: "simple miniature craft-set ground with real texture and soft contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","tactile mixed-media handmade miniature look","visible fabric/paper/felt craft texture","consistent materials across all panels","clean, evenly divided panel layout"]
  },
  texturedPaperSculpture: {
    rendering: "textured paper sculpture — three-dimensional crafted paper characters with visible folds, layers and paper fibres",
    construction: "folded, curled, layered paper planes; hand-cut edges, creases, paper thickness and tiny shadows between layers",
    photography: "photographed tabletop paper sculpture with warm practical light and shallow depth of field",
    color_grade: "warm muted paper palette drawn from THIS character's colours",
    background: "simple tabletop/studio paper ground with soft physical contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","3D paper sculpture with visible folds and layers","handcrafted tactile paper texture","consistent paper construction across all panels","clean, evenly divided panel layout"]
  },
  texturedPaperIllustration: {
    rendering: "textured paper illustration — layered paper-craft / printmaking look with flat colour blocks, stipple, grain and handmade edges",
    texture: "paper tooth, printed ink grain, cut-paper edges, subtle collage layering and tactile surface",
    shading: "flat colour patches with stippled detail and simple handmade shadow shapes",
    palette: "muted print/paper palette drawn from THIS character's colours",
    background: "warm paper ground with subtle collage texture",
    rules: ["no text, labels, watermarks, annotations, typography or captions","textured paper illustration, collage/printmaking feel","flat colour blocks and stippled handmade texture","consistent paper treatment across all panels","clean, evenly divided panel layout"]
  },
  tropicalArtNouveau: {
    rendering: "tropical Art Nouveau illustration — decorative organic lines, lush botanical motifs, elegant stylized beauty and flat ornamental colour",
    linework: "flowing ornamental contour lines, plant-like curves and decorative framing shapes",
    shading: "mostly flat colour with elegant contour accents; refined decorative simplification",
    palette: "lush tropical palette drawn from THIS character's colours: botanical greens, warm florals, cream, gold or coral accents",
    background: "clean decorative botanical ground, restrained enough for a character reference sheet",
    rules: ["no text, labels, watermarks, annotations, typography or captions","tropical Art Nouveau decorative illustration","organic ornamental line and botanical motifs","consistent elegant design across all panels","clean, evenly divided panel layout"]
  },
  graphicNovelNoir: {
    rendering: "high-contrast black-and-white graphic-novel illustration — bold chiaroscuro ink, heavy spot blacks, screentone and hatching for midtones, hard-boiled noir atmosphere",
    linework: "confident brush-and-ink contours, thick expressive outer lines, dry-brush and cross-hatching for texture — tone comes from ink density and screentone, never grey gradients",
    shading: "a single hard key light carving faces and forms out of shadow; hard-edged graphic shadow shapes, deep pooled blacks",
    color_grade: "strictly black and white; at most ONE restrained accent colour when THIS character's design demands it, otherwise pure monochrome",
    background: "flat white or light paper-tone panel background with a hard-edged cast shadow — no studio sweep",
    rules: ["no text, labels, watermarks, annotations, typography or captions","strictly monochrome ink unless a single named accent colour","consistent ink weight and screentone across all panels","clean, evenly divided panel layout"]
  },
  ukiyoe: {
    rendering: "traditional Japanese ukiyo-e woodblock print — flat mineral-pigment colour fields, elegant calligraphic keyblock outlines, visible washi paper texture and subtle bokashi colour gradation",
    linework: "sumi keyblock lines — flowing, tapered, confident; finer interior detail for fabric patterns, hair and ornament",
    shading: "no Western light-and-shadow modelling — form reads through line, overlapping flat planes and bokashi gradation",
    color_grade: "muted Edo-period palette drawn from THIS character's own colours — indigo, ochre, vermilion, pine green, charcoal on aged-paper warmth",
    background: "plain warm washi paper tone, at most a single flat cloud or wave motif band — no rendered depth, no studio sweep",
    rules: ["no text, no labels, no calligraphy, no seals or stamps, no captions","authentic woodblock feel — slight ink registration texture, no digital gradients","consistent palette and line across all panels","clean, evenly divided panel layout"]
  },
  paperCutout: {
    rendering: "layered paper cut-out collage — flat coloured paper shapes with crisp scissor-cut edges, stacked in shallow physical layers with real drop shadows between them",
    materials: "textured construction paper, card and tissue — visible paper grain, fibre flecks and slight edge burr; folded or scored details for dimension",
    lighting: "soft overhead craft-table light casting small true shadows between the paper layers — the depth is physical, not painted",
    color_grade: "bold flat paper palette drawn from THIS character's own colours; warm, tactile, storybook-friendly",
    background: "a plain paper backdrop in a soft neutral tone that clearly reads as another paper layer; soft layered contact shadow",
    rules: ["no text, labels, watermarks, annotations, typography or captions","every shape reads as physically cut paper — no painted gradients or digital rendering","consistent layer depth and shadow treatment across all panels","clean, evenly divided panel layout"]
  }
});
window.CHAR_RENDER_STYLES = CHAR_RENDER_STYLES;
/* FUTURE-PROOF render-style registry. CHAR_RENDER_STYLES (above) is the single source of
   truth for WHICH styles exist: the dropdown list across Characters, Props and Locations is
   DERIVED from its keys, so a newly added style auto-appears everywhere with no extra edits.
   To add a style: add ONE entry to CHAR_RENDER_STYLES; optionally give it a pretty label here
   (the key is humanized if absent) and tuned per-tab text in LOC_RENDER_TEXT / PROP_RENDER_TEXT
   (optional \u2014 renderStyleText() falls back to the char descriptor so it still renders in-style). */
const RENDER_STYLE_LABELS = {
  photoreal:"Photoreal - Human cinematic", photorealNatural:"Photoreal - Natural History Macro",
  photorealCreature:"Photoreal - Cinematic creature", photorealOrnamental:"Photoreal - Ornamental creature",
  render3d:"Stylized 3D render", anime:"Anime / manga", modernAnime:"Modern Anime",
  digitalAnime:"Digital Anime Illustration", roughSketchAnime:"Rough Sketch Anime", painterlyAnime:"Painterly Anime",
  flat:"Flat Vector Illustration", flatDesign:"Flat Design Illustration", minimalistLine:"Minimalist Line Art", vintageChildrensBook:"Vintage Children’s Book Illustration",
  horror:"Cinematic horror", ghibli:"Studio Ghibli Anime",
  animated3d:"Animated feature 3D", pixar:"Pixar-style 3D", cartoon3d:"3D Cartoon", textured3dCartoon:"Textured 3D Cartoon", stylizedCartoon:"Stylized Cartoon Illustration", paintedconcept:"Hand-painted concept art",
  storyboardconcept:"Storyboard concept", texturedcomic:"Textured Comic Illustration", gtaLoadingScreen:"GTA Loading-Screen Art", whimsicalwatercolor:"Whimsical Watercolor",
  graphicNovelNoir:"Graphic novel — Noir B&W", ukiyoe:"Ukiyo-e woodblock", paperCutout:"Paper cut-out",
  grittyDigital:"Gritty Digital Illustration", softPainterly:"Soft Painterly Illustration", realisticDigitalDrawing:"Realistic Digital Drawing",
  stopmotion:"Stop-motion / Tactile Miniature",
  claymation:"Claymation", tactileMixedMedia:"Tactile Mixed Media Illustration", texturedPaperSculpture:"Textured Paper Sculpture", texturedPaperIllustration:"Textured Paper Illustration",
  tropicalArtNouveau:"Tropical Art Nouveau Illustration",
  adv1960s:"1960s advertising", gaganime:"90s gag-anime", pixelart:"Retro pixel-art",
};
window.RENDER_STYLE_LABELS = RENDER_STYLE_LABELS;
const RENDER_STYLE_DESCRIPTIONS = {
  // (2026-07-03) every built-in key now has a description — the picker shows it as
  // the option's hover/desc text, so no style reads as an unexplained label
  render3d:"For polished stylized 3D renders: PBR materials, soft subsurface skin, offline-render quality without the cartoon exaggeration.",
  anime:"For classic cel anime: clean confident ink lines, flat colour fills and hard-edged two-to-three tone shading.",
  flat:"For flat vector/graphic illustration: solid fills, simplified geometric shapes, no gradients or rendered texture.",
  horror:"For photoreal cinematic horror: deep filmic blacks, dread-forward lighting and unsettling realism.",
  ghibli:"For hand-painted animated warmth: soft watercolour backgrounds, gentle linework and lived-in natural detail.",
  animated3d:"For mainstream animated-feature 3D: appealing proportions, rich lighting and polished family-film finish.",
  pixar:"For Pixar-style 3D: big expressive eyes, soft rounded forms, subsurface skin and warm global illumination.",
  paintedconcept:"For hand-painted concept art: visible brushwork, confident shapes and production-design energy.",
  stopmotion:"For stop-motion puppetry: handmade armature look, fabric and clay textures, miniature-set charm.",
  adv1960s:"For 1960s advertising illustration: mid-century palettes, printed grain and period graphic styling.",
  claymation:"For claymation: sculpted plasticine forms, thumbprint texture and handmade animated appeal.",
  gaganime:"For 90s gag-anime: thick bold outlines, flat cel colour, chibi proportions, exaggerated comic expressions and a warm sunset palette.",
  pixelart:"For retro pixel-art: 16/32-bit sprites, dithered shading, crisp pixels and no anti-aliasing.",
  graphicNovelNoir:"For hard-boiled monochrome: chiaroscuro ink, heavy spot blacks, screentone midtones — optionally one accent colour.",
  ukiyoe:"For Japanese woodblock prints: flat mineral pigments, calligraphic keyblock lines, washi texture and bokashi gradation.",
  paperCutout:"For handmade collage: scissor-cut paper shapes in shallow physical layers with real shadows and visible paper grain.",
  photoreal:"For human-scale characters: live-action cinematic portrait realism, believable skin, wardrobe, materials and film lighting.",
  photorealNatural:"For real-world biological realism: macro photography, believable anatomy, skin, fur, scales, wings, moisture, specimen-level detail. Minimal stylization.",
  photorealCreature:"For believable film creatures: practical effects, prosthetic, VFX maquette, creature-shop realism.",
  photorealOrnamental:"For elegant creature designs with iridescence, ornament, armor, jewelry-like forms, couture materials, or heightened beauty while staying physically rendered.",
  storyboardconcept:"For production boards and previsualization: clean linework, clear staging, mood and composition over final polish.",
  texturedcomic:"For bold contemporary comic art: expressive ink, etched texture, limited palette and dramatic graphic lighting.",
  gtaLoadingScreen:"For the GTA loading-screen / cover-art look: semi-realistic figures, bold black outlines, hard cel shading and saturated colour on a glossy poster finish.",
  whimsicalwatercolor:"For gentle storybook imagery: fine ink, soft watercolor washes, paper grain and delicate hand-painted charm.",
  modernAnime:"For polished contemporary anime: sharp linework, cinematic cel shadows, expressive eyes and dynamic character appeal.",
  digitalAnime:"For smooth refined anime illustration with luminous digital colour and a painterly-polished finish.",
  roughSketchAnime:"For loose production-sketch anime: visible pencil/ink energy, flat colour and immediate concept-art feel.",
  painterlyAnime:"For dreamy anime blended with soft brushwork, delicate line and atmospheric colour washes.",
  cartoon3d:"For bold stylized 3D cartoon characters with exaggerated appeal and clean animated-feature lighting.",
  textured3dCartoon:"For tactile 3D cartoon looks using felt, clay, fabric, fuzzy or knitted surface texture.",
  stylizedCartoon:"For bold 2D cartoon illustration: distinct outlines, flat colour areas and theatrical shape design.",
  grittyDigital:"For intense moody digital illustration with harsh light, expressive linework and textured contrast.",
  softPainterly:"For gentle painterly character art with visible brushwork, blended colour and dreamy warmth.",
  realisticDigitalDrawing:"For believable realistic digital drawing: detailed texture and lighting without becoming photographic.",
  flatDesign:"For modern flat-design illustration with simplified shapes, bold colour and minimal shading.",
  minimalistLine:"For elegant sparse line art, negative space and one small accent rather than full rendering.",
  vintageChildrensBook:"For nostalgic children’s-book art: ink outlines, limited colour and aged print texture.",
  tactileMixedMedia:"For handmade mixed-media miniature looks using fabric, felt, paper, paint and sculpted elements.",
  texturedPaperSculpture:"For photographed 3D paper sculptures with folds, layers, fibres and hand-cut edges.",
  texturedPaperIllustration:"For layered paper-craft / printmaking illustration with grain, stipple and collage texture.",
  tropicalArtNouveau:"For lush decorative Art Nouveau: organic lines, botanical motifs, flat ornamental elegance.",
};
/* The name a style goes by INSIDE generation prompts (style_name), where it differs from its
   menu label: a prompt never names a franchise, whatever the menu calls the look. */
const RENDER_STYLE_PROMPT_NAMES = { gtaLoadingScreen:"open-world crime-game loading-screen art" };
function renderStylePromptName(key){ return RENDER_STYLE_PROMPT_NAMES[key] || (window.RENDER_STYLE_LABELS||{})[key] || ""; }
window.renderStylePromptName = renderStylePromptName;
window.RENDER_STYLE_DESCRIPTIONS = RENDER_STYLE_DESCRIPTIONS;
const _humanizeStyle = (k)=> String(k||"").replace(/[-_]+/g," ").replace(/([a-z])([0-9])/g,"$1 $2").replace(/\b\w/g,m=>m.toUpperCase());
const RENDER_STYLE_GROUPS = [
  { id:"Photoreal", keys:["photoreal","photorealNatural","photorealCreature","photorealOrnamental"] },
  { id:"Anime / Animation", keys:["ghibli","modernAnime","digitalAnime","roughSketchAnime","painterlyAnime","anime","gaganime"] },
  { id:"Cartoon / 3D", keys:["pixar","render3d","cartoon3d","textured3dCartoon","stylizedCartoon","animated3d"] },
  { id:"Illustration / Concept Art", keys:["paintedconcept","storyboardconcept","texturedcomic","gtaLoadingScreen","grittyDigital","softPainterly","realisticDigitalDrawing","horror","graphicNovelNoir"] },
  { id:"Graphic / Minimal", keys:["flat","flatDesign","minimalistLine","vintageChildrensBook","pixelart","adv1960s"] },
  { id:"Handmade / Tactile", keys:["stopmotion","claymation","tactileMixedMedia","texturedPaperSculpture","texturedPaperIllustration","whimsicalwatercolor","paperCutout"] },
  { id:"Decorative / Design-led", keys:["tropicalArtNouveau","ukiyoe"] },
];
const RENDER_STYLE_GROUP_BY_KEY = {};
RENDER_STYLE_GROUPS.forEach(g=> (g.keys||[]).forEach(k=>{ RENDER_STYLE_GROUP_BY_KEY[k]=g.id; }));
window.RENDER_STYLE_GROUPS = RENDER_STYLE_GROUPS;
function _renderStyleGroupFor(k){ return RENDER_STYLE_GROUP_BY_KEY[k] || "Other styles"; }
function _styleOptionForKey(k){
  return { key:k, label: RENDER_STYLE_LABELS[k] || _humanizeStyle(k),
    desc: RENDER_STYLE_DESCRIPTIONS[k]||"", group:_renderStyleGroupFor(k) };
}
function _styleScaleClassKey(e){
  const s = String((e&&e.scaleClass)||"").toLowerCase();
  if(/\b(class\s*)?d\b|microscopic|microbe|cellular|molecular/.test(s)) return "D";
  if(/\b(class\s*)?c\b|giant|colossal|vast|monumental/.test(s)) return "C";
  if(/\b(class\s*)?b\b|critter|insect|bug|frog|fish|lizard|moth|beetle|small animal|miniature/.test(s)) return "B";
  return "A";
}
function inferCharacterRenderStyleKey(c){
  if(c && c.renderStyleKey) return c.renderStyleKey;
  const cls = _styleScaleClassKey(c);
  if(cls!=="B") return "photoreal"; // Class A/human defaults to Photoreal - Human cinematic
  const text = [c&&c.name,c&&c.role,c&&c.archetype,c&&c.identity,c&&c.physique,c&&c.wardrobe,c&&c.accessories,c&&c.look]
    .filter(Boolean).join(" ").toLowerCase();
  if(/\b(protagonist|lead|hero|main character|antagonist|villain|deuteragonist|mentor|love interest|driver)\b/.test(text)) return "photorealCreature";
  if(/\b(ornamental|ceremonial|mythic|fashion|couture|jewel|jewelled|jeweled|jewelry|jewellery|iridescent|pearlescent|filigree|armor-like|armour-like)\b/.test(text)) return "photorealOrnamental";
  if(/\b(supporting|background|extra|cameo|real animal|natural animal|wildlife|specimen)\b/.test(text)) return "photorealNatural";
  return "photorealCreature";
}
window.inferCharacterRenderStyleKey = inferCharacterRenderStyleKey;
const CHAR_RENDER_STYLE_OPTIONS = [
  ...Object.keys(CHAR_RENDER_STYLES).map(k=>_styleOptionForKey(k)),
  { key:"surprise", label:"Surprise me \u2728 (one writing call)", group:"Custom" },   // the one synthetic option (invents a bespoke style)
];
window.CHAR_RENDER_STYLE_OPTIONS = CHAR_RENDER_STYLE_OPTIONS;

/* Resolve the render-style TEXT for a Location ('loc') or Prop ('prop') by key. A tuned per-tab
   line wins; otherwise it falls back to the style's OWN character descriptor (so a new style
   renders in-style even before per-tab text is written), then to photoreal \u2014 never silently the
   wrong style. This is what lets a newly added style work across every tab from one definition. */
window.renderStyleText = function(kind, key){
  key = key || (window.turnDefaultRenderStyleKey ? window.turnDefaultRenderStyleKey() : "photoreal");
  const map = (kind==="loc") ? (window.LOC_RENDER_TEXT||{}) : (window.PROP_RENDER_TEXT||{});
  if(map[key]) return map[key];
  const cs = (window.CHAR_RENDER_STYLES||{})[key];
  if(cs && cs.rendering) return cs.rendering.replace(/\bcharacter\b/gi, kind==="loc" ? "environment" : "object");
  return map.photoreal || "";
};

/* the resolved render block for a character: the picked preset, or an AI-invented bespoke
   block for "surprise" (stored on c.surpriseRender), falling back to photoreal. */
function charRenderBlock(c){
  const key = (typeof inferCharacterRenderStyleKey==="function") ? inferCharacterRenderStyleKey(c)
    : ((c && c.renderStyleKey) || (window.turnDefaultRenderStyleKey ? window.turnDefaultRenderStyleKey() : "photoreal"));
  if(key==="surprise" && c && c.surpriseRender && c.surpriseRender.render) return c.surpriseRender.render;
  return CHAR_RENDER_STYLES[key] || CHAR_RENDER_STYLES.photoreal;
}
window.charRenderBlock = charRenderBlock;
function renderStyleLabelForEntity(e){
  const key = (e && e.renderStyleKey) || ((typeof inferCharacterRenderStyleKey==="function") ? inferCharacterRenderStyleKey(e) : "");
  if(key==="surprise" && e && e.surpriseRender && e.surpriseRender.label) return e.surpriseRender.label;
  const opts = window.CHAR_RENDER_STYLE_OPTIONS || [];
  const clean = (lab)=> String(lab||"").replace(/^[🔒🌐]\s*/,"");
  const found = opts.find(o=>o && o.key===key);
  if(found && found.label) return clean(found.label);
  if(key && (window.RENDER_STYLE_LABELS||{})[key]) return clean(window.RENDER_STYLE_LABELS[key]);
  return "";
}
window.renderStyleLabelForEntity = renderStyleLabelForEntity;
function renderStyleLabelFromMeta(meta){
  meta = meta || {};
  const clean = (lab)=> String(lab||"").replace(/^[🔒🌐]\s*/,"");
  if(meta.renderStyleLabel) return clean(meta.renderStyleLabel);
  if(meta.renderStyleKey && (window.RENDER_STYLE_LABELS||{})[meta.renderStyleKey]) return clean(window.RENDER_STYLE_LABELS[meta.renderStyleKey]);
  // Back-compat: older generations didn't save renderStyleKey, but the prompt stores the
  // JSON render block. Match that against the built-in registry when possible.
  const prompt = String(meta.prompt||"");
  const start = prompt.indexOf("{");
  if(start>=0){
    try{
      const spec = JSON.parse(prompt.slice(start));
      if(spec && spec.style_name){ const back = Object.keys(RENDER_STYLE_PROMPT_NAMES).find(k=>RENDER_STYLE_PROMPT_NAMES[k]===spec.style_name);
        return clean(back ? ((window.RENDER_STYLE_LABELS||{})[back]||spec.style_name) : spec.style_name); }
      const rendering = spec && spec.render && spec.render.rendering;
      if(rendering){
        const styles = window.CHAR_RENDER_STYLES || {};
        const key = Object.keys(styles).find(k=> styles[k] && styles[k].rendering===rendering);
        if(key) return clean((window.RENDER_STYLE_LABELS||{})[key] || _humanizeStyle(key));
      }
    }catch(e){}
  }
  return "";
}
window.renderStyleLabelFromMeta = renderStyleLabelFromMeta;

/* ============================================================================
   LOCKED RENDER STYLES — two tiers (see supabase/styles.sql):
     • PERSONAL (lk_*)  — a signed-in user keeps a "Surprise me" style they like;
       PRIVATE to them, SYNCED CROSS-DEVICE via Supabase (turn_user_styles), with
       localStorage as an offline cache for instant paint / signed-out local mode.
     • GLOBAL (gl_*)    — admin-curated HOUSE styles (turn_global_styles) every
       signed-in user sees; only the admin account can publish/delete them.
   Both are injected into the SAME CHAR_RENDER_STYLES object the dropdown +
   charRenderBlock + renderStyleText read, so they "just work" like presets.
   ========================================================================== */
const LOCKED_KEY_PREFIX = "lk_";   // personal
const GLOBAL_KEY_PREFIX = "gl_";   // admin global
const BASE_RENDER_STYLE_KEYS = Object.keys(CHAR_RENDER_STYLES); // seed global presets bundled with the app
const MAX_PERSONAL_STYLES = 10;    // max PERSONAL locked styles per user
// raised 40 → 100 (2026-09-25 by owner): the 41 built-ins had filled the old 40 cap, leaving
// no admin slots; the grouped, collapsible picker keeps a list this long easy to browse
const MAX_GLOBAL_STYLES = 100;     // max TOTAL shared/global styles (seed presets + admin-published combined)
const MAX_TOTAL_STYLES = 110;      // global cap + personal cap (100 + 10)
window.turnPersonalStyleCap = MAX_PERSONAL_STYLES;
window.turnGlobalStyleCap = MAX_GLOBAL_STYLES;
window.turnTotalStyleCap = MAX_TOTAL_STYLES;
window.turnUserStyleCap = MAX_PERSONAL_STYLES;   // back-compat alias for the personal tier
let _userStyles = [];              // [{key,label,render}] personal
let _globalStyles = [];            // [{key,label,render,order}] admin-published global
let _hiddenGlobalKeys = new Set();  // admin-hidden seed globals, persisted as {__hidden:true} rows
let _baseGlobalMeta = {};           // built-in seed metadata from turn_global_styles: { [key]:{hidden,order} }
let _globalOrder = BASE_RENDER_STYLE_KEYS.slice(); // curated platform order: built-ins + admin-published globals
const _slug = (s)=> String(s||"style").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,32) || "style";
// signed-in cloud user? (Supabase configured + a session email). Independent of nbBackend.
function _cloudOn(){ return !!(window.turnUserEmail) && (typeof window.cloudConfigured==="function") && window.cloudConfigured(); }
// localStorage offline cache for the PERSONAL tier, keyed by the user's email
function _cacheStore(){ const e=(window.turnUserEmail||"").toLowerCase(); return e?("turn.lockedStyles."+e):""; }
function _readCache(){ try{ const k=_cacheStore(); if(!k) return []; const a=JSON.parse(localStorage.getItem(k)||"[]"); return Array.isArray(a)?a.filter(x=>x&&x.key&&x.render):[]; }catch(e){ return []; } }
function _writeCache(arr){ try{ const k=_cacheStore(); if(k) localStorage.setItem(k, JSON.stringify(arr||[])); }catch(e){} }
function _freshKey(prefix, label){
  let base = prefix+_slug(label), key = base, n = 2;
  const taken = new Set([...Object.keys(CHAR_RENDER_STYLES), ..._userStyles.map(s=>s.key), ..._globalStyles.map(s=>s.key)]);
  while(taken.has(key)){ key = base+"-"+(n++); }
  return key;
}
function _styleMeta(render){
  render = render || {};
  const n = Number(render.__order);
  return { hidden:!!render.__hidden, order:Number.isFinite(n) ? n : null };
}
function _stripStyleMeta(render){
  if(!render || typeof render!=="object") return render;
  const out = {};
  Object.keys(render).forEach(k=>{ if(k.indexOf("__")!==0) out[k]=render[k]; });
  return out;
}
function _renderWithMeta(render, meta){
  return { ...(_stripStyleMeta(render)||{}), ...(meta||{}) };
}
function _baseLabel(key){
  return (RENDER_STYLE_LABELS && RENDER_STYLE_LABELS[key]) || _humanizeStyle(key);
}
function _globalItemByKey(key){
  if(BASE_RENDER_STYLE_KEYS.includes(key)){
    const hidden = _hiddenGlobalKeys.has(key);
    return { key, label:_baseLabel(key), render:CHAR_RENDER_STYLES[key], builtIn:true, hidden, order:_globalOrder.indexOf(key) };
  }
  const s = _globalStyles.find(x=>x.key===key);
  return s ? { ...s, builtIn:false, hidden:false, order:_globalOrder.indexOf(key) } : null;
}
function _syncGlobalOrder(){
  const allKeys = [...BASE_RENDER_STYLE_KEYS, ..._globalStyles.map(s=>s.key)];
  const seen = new Set();
  const explicit = [];
  BASE_RENDER_STYLE_KEYS.forEach((key,i)=>{
    const m = _baseGlobalMeta[key] || {};
    explicit.push({ key, order:Number.isFinite(Number(m.order)) ? Number(m.order) : i });
  });
  _globalStyles.forEach((s,i)=>{
    explicit.push({ key:s.key, order:Number.isFinite(Number(s.order)) ? Number(s.order) : (BASE_RENDER_STYLE_KEYS.length+i) });
  });
  explicit.sort((a,b)=>a.order-b.order).forEach(x=>{ if(allKeys.includes(x.key) && !seen.has(x.key)){ seen.add(x.key); } });
  _globalOrder = [...seen];
  allKeys.forEach(k=>{ if(!_globalOrder.includes(k)) _globalOrder.push(k); });
}
function _visibleGlobalItems(){
  _syncGlobalOrder();
  return _globalOrder.map(_globalItemByKey).filter(x=>x && !x.hidden);
}
function _hiddenBuiltInItems(){
  _syncGlobalOrder();
  return BASE_RENDER_STYLE_KEYS.filter(k=>_hiddenGlobalKeys.has(k)).map(_globalItemByKey).filter(Boolean);
}
async function _persistGlobalOrder(){
  if(!window.cloudSaveGlobalStyle) return true;
  const visible = _visibleGlobalItems();
  let ok = true;
  for(let i=0;i<visible.length;i++){
    const item = visible[i];
    if(item.builtIn){
      const hidden = _hiddenGlobalKeys.has(item.key);
      const render = { __preset:true, __hidden:hidden, __order:i };
      try{ ok = (await window.cloudSaveGlobalStyle(item.key, item.label, render)) && ok; }catch(e){ ok=false; }
    }else{
      const render = _renderWithMeta(item.render, { __order:i });
      try{ ok = (await window.cloudSaveGlobalStyle(item.key, item.label, render)) && ok; }catch(e){ ok=false; }
    }
  }
  return ok;
}
/* rebuild the shared dropdown options: built-in presets → admin-curated globals → personal → Surprise.
   Built-ins and admin-curated globals are visually identical in the dropdown (no tier marker) —
   they're "one and the same thing" to users. The 🌐 marker only appears in the admin Styles manager. */
function rebuildStyleOptions(){
  const isSaved = (k)=> k.indexOf(LOCKED_KEY_PREFIX)===0 || k.indexOf(GLOBAL_KEY_PREFIX)===0;
  window.CHAR_RENDER_STYLE_OPTIONS = [
    ..._visibleGlobalItems().map(item=> item.builtIn
      ? _styleOptionForKey(item.key)
      : ({ key:item.key, label:item.label||"Style", group:item.group||"Admin global styles" })),   // no 🌐 marker — same look as built-ins
    ..._userStyles.map(s=>({ key:s.key, label:s.label||"Locked style", group:"Personal styles" })),   // personal — picker shows trash icon
    { key:"surprise", label:"Surprise me ✨ (one writing call)", group:"Custom" },
  ];
}
function _defaultRenderStyleKey(){
  const opt = (window.CHAR_RENDER_STYLE_OPTIONS||[]).find(o=>o && o.key && o.key!=="surprise");
  return (opt && opt.key) || "photoreal";
}
window.turnDefaultRenderStyleKey = _defaultRenderStyleKey;
function _injectStyle(s, marker){ if(!s||!s.key||!s.render) return; CHAR_RENDER_STYLES[s.key]=s.render; RENDER_STYLE_LABELS[s.key]=marker+" "+(s.label||"Style"); }
// re-apply the in-memory tiers to the live registry + dropdown, then notify listeners
function _applyAll(){
  Object.keys(CHAR_RENDER_STYLES).forEach(k=>{ if(k.indexOf(LOCKED_KEY_PREFIX)===0 || k.indexOf(GLOBAL_KEY_PREFIX)===0){ delete CHAR_RENDER_STYLES[k]; delete RENDER_STYLE_LABELS[k]; } });
  _globalStyles.forEach(s=>_injectStyle(s,"🌐"));
  _userStyles.forEach(s=>_injectStyle(s,"🔒"));
  rebuildStyleOptions();
  try{ window.dispatchEvent(new CustomEvent("turn-styles-changed")); }catch(e){}
}
/* (re)load both tiers — called on sign-in (email change). Paints instantly from the
   localStorage cache, then reconciles from Supabase when signed in. */
window.turnRefreshLockedStyles = async function(){
  _userStyles = _readCache();          // instant paint (no flash)
  _applyAll();
  if(_cloudOn()){
    try{
      const [u,g] = await Promise.all([
        window.cloudListUserStyles ? window.cloudListUserStyles() : [],
        window.cloudListGlobalStyles ? window.cloudListGlobalStyles() : [],
      ]);
      _userStyles   = Array.isArray(u) ? u.filter(x=>x&&x.key&&x.render) : [];
      const globals = Array.isArray(g) ? g.filter(x=>x&&x.key&&x.render) : [];
      _baseGlobalMeta = {};
      globals.filter(x=>BASE_RENDER_STYLE_KEYS.includes(x.key)).forEach(x=>{
        const meta = _styleMeta(x.render);
        _baseGlobalMeta[x.key] = { hidden:meta.hidden, order:meta.order };
      });
      _hiddenGlobalKeys = new Set(Object.keys(_baseGlobalMeta).filter(k=>_baseGlobalMeta[k] && _baseGlobalMeta[k].hidden));
      _globalStyles = globals
        .filter(x=>!BASE_RENDER_STYLE_KEYS.includes(x.key) && !(x.render && x.render.__hidden))
        .map(x=>{ const meta=_styleMeta(x.render); return { key:x.key, label:x.label, render:_stripStyleMeta(x.render), order:meta.order }; });
      _syncGlobalOrder();
      _writeCache(_userStyles);         // refresh the offline cache
      _applyAll();
    }catch(e){}
  } else {
    _globalStyles = [];                 // global tier only exists when signed in
    _hiddenGlobalKeys = new Set();       // signed-out mode uses the bundled seed globals
    _baseGlobalMeta = {};
    _globalOrder = BASE_RENDER_STYLE_KEYS.slice();
    _applyAll();
  }
};
/* lock a surprise style → PERSONAL. Returns a Promise of its key ("" if not signed in).
   render is a full block ({rendering, rules, …}); prop/location surprises (a STRING)
   pass {rendering:<style>, rules:[…]}. Persists to cloud + cache. */
window.turnLockRenderStyle = async function(label, render){
  if(!window.turnUserEmail || !render) return "";
  const same = _userStyles.find(s=> JSON.stringify(s.render)===JSON.stringify(render));   // de-dupe by block (doesn't count against the cap)
  if(same){ _applyAll(); return same.key; }
  if(_userStyles.length >= MAX_PERSONAL_STYLES){   // personal cap reached
    if(window.appToast) window.appToast(window.turnIsAdmin
      ? "You've saved the maximum of "+MAX_PERSONAL_STYLES+" personal styles. Open “Styles” in the top bar and delete one to make room."
      : "You've saved the maximum of "+MAX_PERSONAL_STYLES+" personal styles. Select a saved style on any card and tap “unlock” to make room.");
    return "";
  }
  const key = _freshKey(LOCKED_KEY_PREFIX, label);
  const entryLabel = (typeof clipWords==="function") ? clipWords(String(label||"Locked style"),48) : String(label||"Locked style").slice(0,48);
  const entry = { key, label:entryLabel, render };
  _userStyles.push(entry); _writeCache(_userStyles); _applyAll();
  if(_cloudOn() && window.cloudSaveUserStyle){ try{ await window.cloudSaveUserStyle(key, entry.label, render); }catch(e){} }
  return key;
};
/* remove one of the user's OWN personal styles (cloud + cache) */
window.turnUnlockRenderStyle = async function(key){
  if(!key) return;
  _userStyles = _userStyles.filter(s=>s.key!==key); _writeCache(_userStyles); _applyAll();
  if(_cloudOn() && window.cloudDeleteUserStyle){ try{ await window.cloudDeleteUserStyle(key); }catch(e){} }
};
/* ADMIN: publish a style to the GLOBAL tier (everyone sees it). Returns the key, or
   "" if the cloud write was rejected (RLS blocks non-admins → local rollback). */
window.turnPublishGlobalStyle = async function(label, render){
  if(!render) return "";
  render = _stripStyleMeta(render);
  const same = _globalStyles.find(s=> JSON.stringify(s.render)===JSON.stringify(render));
  if(!same && window.turnAllGlobalStyleCount() >= MAX_GLOBAL_STYLES){   // total shared/global pool is full
    const room = MAX_GLOBAL_STYLES - window.turnBuiltInStyleCount();
    if(window.appToast) window.appToast("The global render-style set is full ("+MAX_GLOBAL_STYLES+" total, "+room+" admin-published slots). Delete a global style first.");
    return "";
  }
  const key = same ? same.key : _freshKey(GLOBAL_KEY_PREFIX, label);
  const lab = (typeof clipWords==="function") ? clipWords(String(label||"House style"),48) : String(label||"House style").slice(0,48);
  const order = same ? same.order : _visibleGlobalItems().length;
  if(!same){ _globalStyles.push({ key, label:lab, render, order }); _globalOrder.push(key); }
  _applyAll();
  if(window.cloudSaveGlobalStyle){
    try{ const ok = await window.cloudSaveGlobalStyle(key, lab, _renderWithMeta(render,{__order:order}));
      if(!ok && !same){ _globalStyles = _globalStyles.filter(s=>s.key!==key); _applyAll(); return ""; }   // RLS rejected → roll back
    }catch(e){ if(!same){ _globalStyles = _globalStyles.filter(s=>s.key!==key); _applyAll(); } return ""; }
  }
  return key;
};
/* ADMIN: delete a global style (everyone loses it) */
window.turnDeleteGlobalStyle = async function(key){
  if(!key) return;
  if(BASE_RENDER_STYLE_KEYS.includes(key)){
    const prev = new Set(_hiddenGlobalKeys);
    const prevMeta = { ..._baseGlobalMeta };
    const order = _globalOrder.indexOf(key);
    _hiddenGlobalKeys.add(key);
    _baseGlobalMeta[key] = { ...(_baseGlobalMeta[key]||{}), hidden:true, order:order>=0?order:null };
    _applyAll();
    if(window.cloudSaveGlobalStyle){
      try{
        const ok = await window.cloudSaveGlobalStyle(key, RENDER_STYLE_LABELS[key]||_humanizeStyle(key), { __preset:true, __hidden:true, __order:order>=0?order:null });
        if(!ok){ _hiddenGlobalKeys=prev; _baseGlobalMeta=prevMeta; _applyAll(); }
      }catch(e){ _hiddenGlobalKeys=prev; _baseGlobalMeta=prevMeta; _applyAll(); }
    }
    return;
  }
  const prev = _globalStyles;
  _globalStyles = _globalStyles.filter(s=>s.key!==key); _applyAll();
  if(window.cloudDeleteGlobalStyle){ try{ const ok=await window.cloudDeleteGlobalStyle(key); if(!ok){ _globalStyles=prev; _applyAll(); } }catch(e){ _globalStyles=prev; _applyAll(); } }
};
window.turnRestoreGlobalStyle = async function(key){
  if(!key || !BASE_RENDER_STYLE_KEYS.includes(key)) return false;
  if(!_hiddenGlobalKeys.has(key)) return true;
  if(window.turnAllGlobalStyleCount() >= MAX_GLOBAL_STYLES){
    if(window.appToast) window.appToast("The global render-style set is full ("+MAX_GLOBAL_STYLES+"). Delete another global style before restoring this one.");
    return false;
  }
  const prev = new Set(_hiddenGlobalKeys), prevMeta = { ..._baseGlobalMeta };
  const order = _globalOrder.indexOf(key);
  _hiddenGlobalKeys.delete(key);
  _baseGlobalMeta[key] = { ...(_baseGlobalMeta[key]||{}), hidden:false, order:order>=0?order:null };
  _applyAll();
  if(window.cloudSaveGlobalStyle){
    try{
      const ok = await window.cloudSaveGlobalStyle(key, RENDER_STYLE_LABELS[key]||_humanizeStyle(key), { __preset:true, __hidden:false, __order:order>=0?order:null });
      if(!ok){ _hiddenGlobalKeys=prev; _baseGlobalMeta=prevMeta; _applyAll(); return false; }
    }catch(e){ _hiddenGlobalKeys=prev; _baseGlobalMeta=prevMeta; _applyAll(); return false; }
  }
  return true;
};
window.turnMoveGlobalStyle = async function(key, dir){
  key = String(key||""); dir = dir<0 ? -1 : 1;
  const visible = _visibleGlobalItems();
  const idx = visible.findIndex(x=>x.key===key);
  const next = idx + dir;
  if(idx<0 || next<0 || next>=visible.length) return false;
  const reordered = visible.slice();
  const tmp = reordered[idx]; reordered[idx]=reordered[next]; reordered[next]=tmp;
  const hidden = _globalOrder.map(_globalItemByKey).filter(x=>x && x.hidden).map(x=>x.key);
  _globalOrder = [...reordered.map(x=>x.key), ...hidden.filter(k=>!reordered.some(x=>x.key===k))];
  _globalOrder.forEach((k,i)=>{
    if(BASE_RENDER_STYLE_KEYS.includes(k)) _baseGlobalMeta[k] = { ...(_baseGlobalMeta[k]||{}), order:i };
    else { const s=_globalStyles.find(x=>x.key===k); if(s) s.order=i; }
  });
  _applyAll();
  const ok = await _persistGlobalOrder();
  if(!ok && window.appToast) window.appToast("Saved locally, but couldn't persist the new render-style order yet.");
  return ok;
};
/* snapshot for the admin manager UI */
window.turnListGlobalStyles = function(){ return { visible:_visibleGlobalItems(), hidden:_hiddenBuiltInItems() }; };
window.turnListStyles = function(){ return { user:_userStyles.slice(), global:_globalStyles.slice(), globalVisible:_visibleGlobalItems(), globalHidden:_hiddenBuiltInItems() }; };
window.turnIsLockedStyle = function(key){ return !!key && (String(key).indexOf(LOCKED_KEY_PREFIX)===0 || String(key).indexOf(GLOBAL_KEY_PREFIX)===0); };
window.turnIsUserStyle   = function(key){ return !!key && String(key).indexOf(LOCKED_KEY_PREFIX)===0; };   // user can unlock these from a card
window.turnIsGlobalStyle = function(key){
  key = String(key||"");
  return !!key && (key.indexOf(GLOBAL_KEY_PREFIX)===0 || (BASE_RENDER_STYLE_KEYS.includes(key) && !_hiddenGlobalKeys.has(key)));
};
window.turnCanLockStyles = function(){ return !!window.turnUserEmail; };
window.turnUserStyleCount = function(){ return _userStyles.length; };
window.turnGlobalStyleCount = function(){ return _globalStyles.length; };   // admin-published only
// built-in presets = hardcoded non-saved CHAR_RENDER_STYLES keys
window.turnBuiltInStyleCount = function(){
  return BASE_RENDER_STYLE_KEYS.filter(k=>!_hiddenGlobalKeys.has(k)).length;
};
// total global styles visible to all users = built-ins + admin-curated (the "one and the same thing")
window.turnAllGlobalStyleCount = function(){ return window.turnBuiltInStyleCount() + _globalStyles.length; };
window.turnStyleBudgetUsed = function(){ return _userStyles.length + _globalStyles.length; };
window.turnIsStyleAdmin  = function(){ return !!window.turnIsAdmin; };
/* a tiny hook so the Sheets lists / manager re-render when styles change */
window.useRenderStyleVersion = function(){
  const [v,setV] = React.useState(0);
  React.useEffect(()=>{ const f=()=>setV(x=>x+1); window.addEventListener("turn-styles-changed",f); return ()=>window.removeEventListener("turn-styles-changed",f); },[]);
  return v;
};
// load immediately in case the email is already known by the time this module loads
window.turnRefreshLockedStyles();

/* RENDER-STYLE PICKER — a custom dropdown (native <select> can't hold buttons) so the user's
   own PERSONAL styles get an inline trash icon both inside the menu list and as a dynamic
   button that appears next to the trigger whenever a deletable style is selected.
   Admin can also remove/hide global styles (including built-in presets) the same way.
   The menu is rendered through a PORTAL with position:fixed.
   The trigger is a FIXED width so the row never reflows when the selected style name changes. */
/* per-tab display names for built-in styles (context = "prop" | "location") */
const RENDER_STYLE_CONTEXT_LABELS = {
  prop:     { photoreal:"Photoreal - Cinematic" },
  location: { photoreal:"Photoreal - Cinematic" },
};
window.RENDER_STYLE_CONTEXT_LABELS = RENDER_STYLE_CONTEXT_LABELS;
function RenderStylePicker({ value, onPick, disabled, placeholderLabel, context }){
  if(window.useRenderStyleVersion) window.useRenderStyleVersion();   // re-render when styles change
  const [open, setOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState({});
  const [pos, setPos] = React.useState(null);
  const triggerRef = React.useRef(null), menuRef = React.useRef(null);
  const place = ()=>{ const t=triggerRef.current; if(!t) return; const r=t.getBoundingClientRect(); setPos({ top:r.bottom+4, left:r.left, width:r.width }); };
  React.useEffect(()=>{
    if(!open) return;
    const onDoc=(e)=>{ if((menuRef.current&&menuRef.current.contains(e.target))||(triggerRef.current&&triggerRef.current.contains(e.target))) return; setOpen(false); };
    const onKey=(e)=>{ if(e.key==="Escape") setOpen(false); };
    const reflow=(e)=>{
      // The menu itself scrolls. Don't treat that as page movement or the dropdown closes
      // the moment a user tries to scroll through a long render-style list.
      if(menuRef.current && e && e.target && menuRef.current.contains(e.target)) return;
      place();
    };
    document.addEventListener("mousedown",onDoc); document.addEventListener("keydown",onKey);
    window.addEventListener("scroll",reflow,true); window.addEventListener("resize",reflow);
    return ()=>{ document.removeEventListener("mousedown",onDoc); document.removeEventListener("keydown",onKey); window.removeEventListener("scroll",reflow,true); window.removeEventListener("resize",reflow); };
  },[open]);
  const opts = window.CHAR_RENDER_STYLE_OPTIONS||[];
  const clean = (lab)=> String(lab||"").replace(/^[🔒🌐]\s*/,"");
  // a style's name can read differently on props and locations ("Human cinematic" is a
  // character-sheet name); the style itself is the same
  const labelOf = (o)=> ((RENDER_STYLE_CONTEXT_LABELS[context]||{})[o && o.key]) || (o && o.label);
  const isPlaceholder = (value==="" || value==null) && !!placeholderLabel;
  const cur = isPlaceholder
    ? { key:"", label:placeholderLabel, desc:"Choose one render style to apply to all items.", group:"" }
    : (opts.find(o=>o.key===value) || opts[0] || { key:"photoreal", label:"Photoreal - Human cinematic", desc:(window.RENDER_STYLE_DESCRIPTIONS||{}).photoreal||"" });
  React.useEffect(()=>{
    if(!open) return;
    const g = cur.group || "Other styles";
    setExpanded(prev=> Object.keys(prev).length ? { ...prev, [g]:true } : { [g]:true });
  },[open, cur.group]);
  const toggle = ()=>{ if(disabled) return; if(open){ setOpen(false); } else { place(); setOpen(true); } };
  const pick = (key)=>{ setOpen(false); if(onPick) onPick(key); };
  const del = async (e, key, isGlobal)=>{ e.stopPropagation();
    const lab = clean(labelOf(opts.find(o=>o.key===key)||{}));
    const fallback = (opts.find(o=>o.key!==key && o.key!=="surprise") || opts.find(o=>o.key!==key) || { key:"photoreal" }).key;
    if(window.appConfirm && !(await window.appConfirm({ title: isGlobal?"Delete this global style?":"Delete your saved style?",
      body: isGlobal?("Every signed-in user loses \""+lab+"\"."):("Removes \""+lab+"\" from your saved styles.") }))) return;
    if(isGlobal){ if(window.turnDeleteGlobalStyle) await window.turnDeleteGlobalStyle(key); }
    else { if(window.turnUnlockRenderStyle) await window.turnUnlockRenderStyle(key); }
    if(key===value && onPick) onPick(fallback);
  };
  // which styles can the current user delete from the inline button?
  const selIsUser   = !!(window.turnIsUserStyle   && window.turnIsUserStyle(value));
  const selIsGlAdm  = !!(window.turnIsGlobalStyle && window.turnIsGlobalStyle(value) && window.turnIsStyleAdmin && window.turnIsStyleAdmin());
  const canDelSelected = selIsUser || selIsGlAdm;
  const groups = [];
  const byGroup = {};
  opts.forEach(o=>{
    const g = o.group || "Other styles";
    if(!byGroup[g]){ byGroup[g]=[]; groups.push(g); }
    byGroup[g].push(o);
  });
  // ACCORDION: opening a group closes the others — keeps the menu's height modest
  // and near-constant instead of ballooning as groups stack open
  const toggleGroup = (e,g)=>{ e.stopPropagation(); setExpanded(prev=> prev[g] ? {} : { [g]:true }); };
  const menu = (open && pos && window.ReactDOM && window.ReactDOM.createPortal) ? window.ReactDOM.createPortal(
    React.createElement("div",{className:"rs-menu",ref:menuRef,style:{ position:"fixed", top:pos.top+"px", left:pos.left+"px", minWidth:pos.width+"px" }},
      groups.map(g=>{
        const list = byGroup[g] || [];
        const isOpen = !!expanded[g];
        const selectedInGroup = list.some(o=>o.key===value);
        return React.createElement("div",{key:g,className:"rs-group"+(isOpen?" open":"")+(selectedInGroup?" has-sel":"")},
          React.createElement("button",{type:"button",className:"rs-group-head",onClick:(e)=>toggleGroup(e,g),title:(isOpen?"Collapse ":"Expand ")+g},
            React.createElement("span",{className:"rs-group-caret"},isOpen?"▾":"▸"),
            React.createElement("span",{className:"rs-group-lab"},g),
            React.createElement("span",{className:"rs-group-count"},list.length)),
          isOpen && React.createElement("div",{className:"rs-group-body"},
            list.map(o=>{
              const isUser = window.turnIsUserStyle && window.turnIsUserStyle(o.key);
              const isGlobalAdmin = window.turnIsGlobalStyle && window.turnIsGlobalStyle(o.key) && window.turnIsStyleAdmin && window.turnIsStyleAdmin();
              const canDel = isUser || isGlobalAdmin;
              return React.createElement("div",{ key:o.key, className:"rs-opt"+(o.key===value?" sel":""), title:o.desc||clean(labelOf(o)), onClick:()=>pick(o.key) },
                React.createElement("span",{className:"rs-opt-lab"}, clean(labelOf(o))),
                canDel && React.createElement("button",{ type:"button", className:"rs-opt-del",
                  title: isGlobalAdmin?"Delete this global style (admin)":"Delete this saved style",
                  onClick:(e)=>del(e,o.key,isGlobalAdmin) },
                  React.createElement((Icon.trash||Icon.x),{s:12})));
            })));
      })), document.body) : null;
  return React.createElement("div",{className:"rs-picker"+(open?" open":"")},
    React.createElement("button",{ type:"button", className:"rs-trigger", ref:triggerRef, disabled:!!disabled, onClick:toggle },
      React.createElement("span",{className:"rs-trigger-lab"}, clean(labelOf(cur))),
      React.createElement("span",{className:"rs-caret"}, "▾")),
    // (the inline trash beside the trigger was removed by user decision 2026-07-06 —
    // deleting a style still works from the dropdown's per-option delete and the
    // Styles manager in the top bar; the card-level icon read as clutter)
    menu);
}
window.RenderStylePicker = RenderStylePicker;

/* JSON character spec (the director's concept-art template as a key:value spec).
   LAYOUT: a casting-reference sheet — one large hero face portrait on the left, then
   three full-body views (front, three-quarter front, back) in vertical panels.
   Clean studio sweep, NO text baked in. Render style, worn props, height/scale and the
   16:9 aspect are all wired in below so the sheet stays consistent with the rest of the app. The
   `physique` object and `wardrobe` block are the continuity database fields the rest
   of the pipeline matches on (shot prompts, prop worn_by links). Inherited from the
   Story: role + conscious desire, the script-drafted physique, bodyRationale, wardrobe
   + accessories (continuity canon), height/scale, genre/period tone. NOTE
   "true-to-design anatomy", not "real human proportions" \u2014 the cast includes
   non-humans, and humanizing them is exactly the drift to avoid. */
/* signature of the worn-prop text baked into a character sheet (name/form/material/
   detail/relation per worn card). Stored in the sheet's image meta at generation; the
   card compares it against the CURRENT cards afterwards — a difference means the sheet
   was generated before a worn-prop edit and its baked accessories are stale. */
function wornPropsSig(props, charId){
  return (props||[]).filter(p=>p && p.ownerId===charId && p.kind!=="carried")
    .map(p=>[p.name,p.form,p.material,p.detail,p.relation].map(x=>String(x||"").trim()).join("|"))
    .sort().join(";;");
}
window.wornPropsSig = wornPropsSig;
function wornReferenceExclusionSet(character){
  return new Set(Array.isArray(character && character.wornReferenceExclusions)
    ? character.wornReferenceExclusions.filter(Boolean) : []);
}
function wornReferenceVersionStamp(meta){
  if(!meta) return "";
  return [meta.version||0, meta.iso||"", meta.pixelW||0, meta.pixelH||0].join("|");
}
/* A character sheet records the exact worn-prop asset versions it saw. This is a
   dependency contract, not just a reference count: when a prop is regenerated the
   character can explain which design changed and offer an identity-preserving update. */
async function loadWornReferenceSnapshot(character, wornProps, usedIds){
  const excluded = wornReferenceExclusionSet(character);
  const actuallyUsed = usedIds instanceof Set ? usedIds : null;
  const rows = [];
  for(const p of (wornProps||[])){
    let url = (typeof nbGetImage==="function") ? nbGetImage(p.id) : "";
    if(!url && typeof nbLoadImage==="function"){
      try{ url = await nbLoadImage(p.id); }catch(e){}
    }
    const available = !!url;
    const visual = available && !excluded.has(p.id) && (!actuallyUsed || actuallyUsed.has(p.id));
    let meta = null;
    if(available && typeof nbLoadDetailsAsset==="function"){
      try{ const d = await nbLoadDetailsAsset(p.id, url); meta = d && d.meta; }catch(e){}
    }
    rows.push({
      refId:p.id,
      name:p.name||"Worn prop",
      mode:visual?"visual":"text",
      excluded:excluded.has(p.id),
      available,
      version:meta && meta.version || null,
      generated:meta && meta.iso || "",
      versionStamp:wornReferenceVersionStamp(meta),
    });
  }
  return rows;
}
function compareWornReferenceSnapshots(baked, current){
  const oldMap = new Map((baked||[]).filter(Boolean).map(r=>[r.refId,r]));
  const reasons = [];
  (current||[]).forEach(row=>{
    const old = oldMap.get(row.refId);
    if(row.mode==="visual"){
      if(!old || old.mode!=="visual") reasons.push((row.name||"A worn prop")+" is ready to lock");
      else if((old.versionStamp||"") !== (row.versionStamp||"")) reasons.push((row.name||"A worn prop")+" has a newer design");
    } else if(old && old.mode==="visual"){
      reasons.push((row.name||"A worn prop")+(row.excluded?" was switched to text-only":" no longer has a usable sheet"));
    }
    oldMap.delete(row.refId);
  });
  oldMap.forEach(row=> reasons.push((row.name||"A worn prop")+" is no longer linked"));
  return reasons;
}
window.loadWornReferenceSnapshot = loadWornReferenceSnapshot;
window.compareWornReferenceSnapshots = compareWornReferenceSnapshots;
function buildCharRefPrompt(c, project, props, o){
  const P = project || {};
  const v = charVisualDefaults(c);
  const clean = (x)=>String(x||"").replace(/\.$/,"").trim();
  /* o.likeness (2026-10-10, owner — Likeness review): a locked likeness gives the FACE from its photos, so the
     text spec leaves out every face field (age, ethnicity, skin, eyes, hair, face) — a written face could
     contradict the real one. Body build, height, wardrobe and accessories stay. */
  const _lk = !!(o && o.likeness);
  const body = _lk ? turnLikenessStripFace(vfield(c,"coreBody","look")) : vfield(c,"coreBody","look");
  const texture = c.materialTexture || "natural skin pore texture, subsurface scattering, high detail";
  const mask = vfield(c,"wardrobeMask","wardrobe");
  const acc = (c.accessories && !/^none$/i.test(c.accessories.trim())) ? clean(c.accessories) : "";
  // WORN PROPS baked into the TEXT: fold every worn prop this character owns (with its
  // form & material from the prop card) into the accessories, so the sheet renders the
  // character WEARING them from the first generation — no separate prop image needed.
  const _norm = (s)=> String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
  const worn = (props||[]).filter(p=> p && p.ownerId===c.id && p.kind!=="carried" && clean(p.name));
  const propDesc = (p)=>{ const tail=[clean(p.form), clean(p.material)].filter(Boolean).join(", ");
    const rel = clean(p.relation);   // how the owner relates to it — wear with a meaning
    return clean(p.name) + (tail ? (" ("+tail+(rel?("; "+rel):"")+")") : (rel ? (" ("+rel+")") : "")); };
  const wornDescs = worn.map(propDesc).filter(Boolean);
  const wornKeys = new Set(worn.map(p=>_norm(p.name)));
  // CARRIED prop names never render on the neutral sheet (hands stay empty; they attach
  // at the SHOT level) — even when one was typed into the Accessories text by mistake
  const carriedKeys = new Set((props||[]).filter(p=>p && p.ownerId===c.id && p.kind==="carried").map(p=>_norm(p.name)));
  // any accessories-text items NOT already covered by a worn-prop card (so nothing is lost)
  const accExtra = (typeof splitListItems==="function" ? splitListItems(acc) : (acc?[acc]:[]))
    .filter(it=> it && !wornKeys.has(_norm(it)) && !carriedKeys.has(_norm(it)));
  const accAll = [...wornDescs, ...accExtra];
  const period = P.setting && P.setting.period ? P.setting.period.split(/[\u2014,]/)[0].trim() : "";
  const tone = [P.genre, period].filter(Boolean).join(", ");
  const F = c.physique || {};
  const phys = {
    apparent_age: (!_lk && clean(F.age))||undefined, ethnicity: (!_lk && clean(F.ethnicity))||undefined,
    skin: (!_lk && clean(F.skin))||undefined, eyes: (!_lk && clean(F.eyes))||undefined, hair: (!_lk && clean(F.hair))||undefined,
    face: (!_lk && clean(F.face))||undefined, build: clean(F.build)||undefined,
    // explicit limbs keep image models from defaulting underspecified legs to high
    // heels and underspecified hands to generic-human
    arms_hands: clean(F.arms)||undefined,
    legs_feet_footwear: clean(F.legs)||undefined,
  };
  const hasPhys = Object.values(phys).some(Boolean);
  // ONE constraints list: fold the character's exclusions INTO the render rules, so there's no
  // separate negative prompt (rules and the old negative were doing the same job).
  const _rb = charRenderBlock(c);
  const _noTextRule = "no text, labels, rulers, measurement marks, numbers, captions, watermarks, logos, annotations, UI elements or typography anywhere on the sheet";
  // the stronger sheet rule replaces a style's own no-text rule — keeping any extra marks that
  // style is prone to (ukiyo-e prints carry calligraphy cartouches and seals)
  const _rulesBase = (_rb.rules||[]).map(r=> /no text/i.test(r)
    ? _noTextRule+(/calligraph|seal|stamp/i.test(r) ? "; no calligraphy, seals or stamps either" : "") : r);
  const _negItems = String(c.negativePrompt || v.negativePrompt || "").split(/,\s*/).map(x=>x.replace(/\.$/,"").trim()).filter(Boolean);
  const _rules = _negItems.length ? [ ..._rulesBase, "strictly avoid: "+_negItems.join(", ") ] : _rulesBase;
  // HELD MOBILITY / SIGNATURE SUPPORT ITEM (cane-class): if the spec's own text
  // describes one, it must be IN HAND on the sheet — the hardcoded "both hands
  // empty" used to contradict it and the generator obeyed the explicit hands
  // field (the Winston Palmer no-cane QA case). Detection reads only what the
  // spec already says, so nothing is ever invented.
  const _HELD_RX = /\b(cane|walking stick|walking-stick|crutch(?:es)?|staff|walker|zimmer frame|walking frame)\b/i;
  const _heldSrc = [accAll.join("; "), clean(mask), clean(body), clean(F.build), clean(F.arms)].filter(Boolean).join(" · ");
  const _heldM = _heldSrc.match(_HELD_RX);
  let _heldItem = "";
  if(_heldM){
    const kw = _heldM[0].toLowerCase();
    const fromList = accAll.find(it=> String(it).toLowerCase().indexOf(kw)>=0);
    _heldItem = fromList ? String(fromList).split("(")[0].trim() : _heldM[0];
  }
  const spec = {
    task: "character casting reference sheet",
    character: {
      name: c.name||"Character",
      role: c.role||undefined,
      wants: clean(c.conscious)||undefined,
      physique: hasPhys ? phys : undefined,
      description: (!hasPhys && body) ? clean(body) : undefined,
      face_and_hair: _lk ? "from the attached likeness photos (see LIKENESS below) — not described in text" : undefined,
      why_this_look: clean(c.bodyRationale)||undefined,
      height: v.height, scale: v.scaleClass,
      skin_surface_texture: clean(texture),
      tone: tone||undefined,
    },
    wardrobe: {
      wearing: clean(mask)||undefined,
      accessories: accAll.length ? accAll.join("; ") : undefined,
      hands: _heldItem
        ? ("one hand closed around the "+_heldItem+" with weight settled naturally onto it — in EVERY full-body view; the other hand empty and relaxed at side")
        : "both hands empty and relaxed at sides",
    },
    // NO EXPRESSION ROW, BY DESIGN (owner decision 2026-09-26): the sheet rides on EVERY shot
    // of the character, and image/video models copy what they see — expressive or extra faces
    // leak into frames and can split identity (d79a9ce). One neutral hero face is the anchor.
    // Signature expressions (c.expressions) reach the models as TEXT instead: the Shot
    // Designer's performance register in aiDraftOpeningKeyframes (ai.jsx).
    layout: {
      format: "a 4-panel casting reference sheet in 16:9 landscape: four tall vertical panels divided by thin clean vertical lines; panel 1 is a large hero face portrait and panels 2-4 are full-body turnaround views; the SAME character throughout",
      panels_left_to_right: [
        "PANEL 1 — large close-up hero FACE PORTRAIT, front-facing, neutral controlled expression, shoulders/chest crop, face fills most of the panel, exact identity anchor",
        "PANEL 2 — full-body FRONT view, head-to-toe, facing camera, neutral expression matching the portrait identity, "+(_heldItem?("one hand on the "+_heldItem+", the other relaxed at side"):"arms relaxed at sides")+", clean silhouette, feet on the same baseline as panels 3 and 4",
        "PANEL 3 — full-body THREE-QUARTER FRONT view, head-to-toe, body turned about 35-45 degrees, same face, same build, same wardrobe, same figure height and baseline as panels 2 and 4",
        "PANEL 4 — full-body BACK view, head-to-toe, facing away (back of head visible, no face), same wardrobe, same proportions, same figure height and baseline as panels 2 and 3"
      ],
      face_consistency_rule: "the face in panel 2 and panel 3 must match the hero portrait exactly; do not invent a second identity, age shift, hairstyle, facial hair change or different person",
      scale_rule: "the full-body figures in panels 2, 3 and 4 are the SAME height and scale, vertically aligned across panels with the same headroom and feet on the same line",
      no_extra_views: "do not add expression rows, inset detail shots, rulers, captions, labels, title text, measurement text, or ANY info box / character-data panel (no name, height, age or traits printed on the image — that metadata travels in the prompt, never baked into pixels)",
      background: "solid warm off-white or light-grey studio sweep, even and clean across all four panels"
    },
    continuity: {
      identity_rule: "the SAME identical face, build and identity in every view",
      anatomy: "true-to-design anatomy and proportions \u2014 never humanize a non-human design",
    },
    render: { ..._rb, rules: _rules, aspect: "16:9" },
    style_name: ((c.renderStyleKey==="surprise" && c.surpriseRender && c.surpriseRender.label)
      ? c.surpriseRender.label
      : (renderStylePromptName(typeof inferCharacterRenderStyleKey==="function"?inferCharacterRenderStyleKey(c):(c.renderStyleKey||"photoreal")) || undefined)),
  };
  return "Render this character casting reference sheet EXACTLY as specified by this JSON spec (continuity fields are binding):\n"+JSON.stringify(spec, null, 1);
}
window.buildCharRefPrompt = buildCharRefPrompt;

/* has this character's descriptive (model-drafted) visual layer been filled? */
function charVisualsDrafted(c){
  return !!((vfield(c,"coreBody","look")||"").trim() && (vfield(c,"wardrobeMask","wardrobe")||"").trim());
}
window.charVisualsDrafted = charVisualsDrafted;

/* prompt for image-to-image generation from a dropped reference photo.
   Unlike the master text prompt this one explicitly instructs the model to
   reproduce the face/build it sees in the reference image faithfully. */
function buildRefFromPhotoPrompt(c, project){
  const P = project || {};
  const v = charVisualDefaults(c);
  const mask = ((c.wardrobeMask||c.wardrobe)||"").replace(/\.$/,"").trim();
  const acc = (c.accessories && !/^none$/i.test(c.accessories.trim()))
    ? (", accessories: "+c.accessories.replace(/\.$/,"")) : "";
  // ONE render-style control (2026-10-03): the card's picker drives this sheet too (it used to read
  // the old free-text Look dev field, so a Ghibli character still rendered photoreal from a photo).
  // A free-text style saved on older cards is kept as extra notes.
  const _rb = (typeof charRenderBlock==="function") ? (charRenderBlock(c)||{}) : {};
  const _rbName = ((c.renderStyleKey==="surprise" && c.surpriseRender && c.surpriseRender.label) ? c.surpriseRender.label
    : renderStylePromptName(typeof inferCharacterRenderStyleKey==="function" ? inferCharacterRenderStyleKey(c) : (c.renderStyleKey||"photoreal")));
  const _rbText = [_rbName, _rb.rendering, _rb.lighting, _rb.color_grade].map(x=>String(x||"").replace(/\.$/,"").trim()).filter(Boolean).join("; ");
  const _legacy = String(c.renderStyle||"").replace(/\.$/,"").trim();
  const style = [_rbText || "photoreal cinematic, 35mm, natural film grain, shallow depth of field", _legacy].filter(Boolean).join("; ");
  const period = P.setting && P.setting.period ? P.setting.period.split(/[\u2014,]/)[0].trim() : "";
  const tone = [P.genre, period].filter(Boolean).join(", ");
  let s = "Master character design reference sheet \u2014 "+(c.name||"Character")+". ";
  s += "BASE APPEARANCE: match EXACTLY the face, hair colour & style, skin tone, and physical build ";
  s += "as shown in the reference photo. Do not alter or idealise the subject's appearance. ";
  if(c.role) s += "Role: "+c.role+". ";
  s += mask ? ("Wearing "+mask.replace(/\.$/,"")+acc+". ") : "";
  if(tone) s += tone+" tone. ";
  s += "Character is "+v.height+" tall ("+v.scaleClass+"). ";
  s += "RENDER STYLE: "+style.replace(/\.$/,"")+". ";
  s += "LAYOUT: a clean 4-panel casting reference sheet in 16:9 landscape with four tall vertical panels divided by thin clean vertical lines. Panel 1: large close-up hero FACE PORTRAIT, front-facing, neutral controlled expression, shoulders/chest crop, face fills most of the panel. Panel 2: full-body FRONT view, head-to-toe, facing camera, neutral expression matching the portrait. Panel 3: full-body THREE-QUARTER FRONT view, head-to-toe, body turned about 35-45 degrees, same face/build/wardrobe. Panel 4: full-body BACK view, head-to-toe, facing away. Full-body panels use the same figure height, headroom, foot baseline and scale. No text, captions or info boxes anywhere on the image. ";
  s += "Do NOT add expression rows, inset detail shots, rulers, captions, labels, title text, measurement text, annotations or watermarks. Solid warm off-white or light-grey studio background, soft even studio lighting, the SAME identical face/build/wardrobe in every applicable panel, sharp focus.";
  return s;
}
window.buildRefFromPhotoPrompt = buildRefFromPhotoPrompt;

/* ============================================================
   LIKENESS (internal name: cameo) — ONE RULE for every character-sheet path
   (2026-10-10, owner — Likeness review): the card's Generate / Apply, the post-capture
   "Generate sheet", appearance-state variants, the simplified retry, and the Casting Director's
   master and variants (so Scene needs and Wear props too) and the prop owner's pre-generation
   (app.jsx). When a likeness is locked for the character:
     · the FRONT angle is image 1, the other angles next, then the master sheet (a variant, or an
       update of the current sheet), then the worn-item sheets, then a dropped reference photo;
     · the prompt carries a NUMBERED image map and asks to match the face from the angles;
     · the text spec leaves the face out (buildCharRefPrompt o.likeness);
     · the sheet records meta.cameo, meta.cameoAt (the likeness's capture time) and its mode; the
       angles are counted as private references and never stored as the sheet's references.
   Editing or remastering a likeness sheet re-attaches the FRONT angle only (owner decision E).
   A likeness that exists but can't be used here (a shared film — nbCameoInfo().available false)
   is said before anything is spent, never silently dropped.
   ============================================================ */
/* the face sentences of a free-text body description ("Apparent age: 40. Hair: grey. Build: lean.") */
function turnLikenessStripFace(text){
  const s = String(text||"").trim();
  if(!s) return "";
  const FACE = /^(?:apparent\s+age|age|ethnicity|skin(?:\s+tone)?|eyes?(?:\s+colou?r)?|eye\s+colou?r|hair(?:\s+colou?r)?|face(?:\s+shape)?|facial\s+features?)\s*[:—-]/i;
  const parts = s.split(/\.\s+/).map(p=>p.trim().replace(/\.$/,"")).filter(p=> p && !FACE.test(p));
  return parts.length ? parts.join(". ")+"." : "";
}
window.turnLikenessStripFace = turnLikenessStripFace;
/* what the store says about a character's likeness on the open film. nbCameoInfo (the store's) when
   this build has it, else today's registry (an older build: every locked likeness is usable). */
function turnLikenessInfo(charId){
  if(!charId) return null;
  if(typeof window.nbCameoInfo==="function"){
    let i = null; try{ i = window.nbCameoInfo(charId); }catch(e){ i = null; }
    // no likeness → locked:false (the store also says available:false then); one this person can't use here →
    // locked:true, available:false, why
    if(!i || i.locked===false) return null;
    return i;
  }
  const m = (typeof nbCameoMeta==="function") ? nbCameoMeta(charId) : null;
  if(!m) return null;
  return { locked:true, synced:!!m.sync, angleCount:Number(m.angleCount)||1, capturedAt:m.iso||"",
    consent:{ subject:m.subject||"" }, mine:true, available:true, why:"" };
}
window.turnLikenessInfo = turnLikenessInfo;
/* a likeness exists for this character on this film but can't be used by this person here */
function turnLikenessUnavailable(charId){
  const i = turnLikenessInfo(charId);
  if(!i || i.available!==false) return null;
  return { why: String(i.why||"").trim() || "This character's likeness belongs to someone else on this film and can't be used from your account." };
}
window.turnLikenessUnavailable = turnLikenessUnavailable;
/* the sentence a price confirm / preview shows for an unavailable likeness */
function turnLikenessUnavailableText(charId, name){
  const u = turnLikenessUnavailable(charId);
  if(!u) return "";
  return u.why.replace(/([^.!?])$/,"$1.")+" Renders made here won't include "+(name ? name+"'s" : "the")+" real face — they follow the text spec.";
}
window.turnLikenessUnavailableText = turnLikenessUnavailableText;
/* how many likeness photos a render of this character sends (for prices) — 0 when there's none or it can't be used */
function turnLikenessRefCount(charId){
  const i = turnLikenessInfo(charId);
  if(!i || i.available===false) return 0;
  if(i.angleCount) return Math.max(1, Number(i.angleCount)||1);
  try{ const a = (typeof nbGetCameoAngles==="function") ? (nbGetCameoAngles(charId)||[]) : []; if(a.length) return a.length; }catch(e){}
  return 1;
}
window.turnLikenessRefCount = turnLikenessRefCount;
/* load the angles, FRONT first: { usable, unavailable, why, angles:[{label,url}], urls, capturedAt } */
async function turnLoadLikeness(charId){
  const none = { usable:false, unavailable:false, why:"", angles:[], urls:[], capturedAt:"" };
  if(!charId) return none;
  const hasInfo = typeof window.nbCameoInfo==="function";
  const info = turnLikenessInfo(charId);
  if(info && info.available===false) return { ...none, unavailable:true, why:(turnLikenessUnavailable(charId)||{}).why||"", info };
  if(hasInfo && !info) return none;   // the store says there's none — no needless read
  let angles = [], rec = null;
  if(typeof nbLoadCameoFull==="function"){
    try{ rec = await nbLoadCameoFull(charId); }catch(e){ rec = null; }
    if(rec) angles = ((rec.angles&&rec.angles.length) ? rec.angles : (rec.url ? [{ label:"Front", url:rec.url }] : []))
      .filter(a=>a && a.url).map(a=>({ label:String(a.label||""), key:String(a.key||""), url:a.url }));
  }
  if(!angles.length){
    let urls = [];
    if(typeof nbGetCameoAngles==="function"){ try{ urls = nbGetCameoAngles(charId)||[]; }catch(e){} }
    if(!urls.length && typeof nbLoadCameoAngles==="function"){ try{ urls = (await nbLoadCameoAngles(charId))||[]; }catch(e){} }
    if(!urls.length && typeof nbGetCameo==="function"){ try{ const u = nbGetCameo(charId); if(u) urls = [u]; }catch(e){} }
    if(!urls.length && typeof nbLoadCameo==="function"){ try{ const u = await nbLoadCameo(charId); if(u) urls = [u]; }catch(e){} }
    const L = ["Front","¾ Left","¾ Right"], K = ["front","left","right"];
    angles = urls.filter(Boolean).map((u,i)=>({ label:L[i]||("Angle "+(i+1)), key:K[i]||"", url:u }));
  }
  // FRONT first (the primary reference), then the other angles in their captured order
  const fi = angles.findIndex(a=>a.key==="front" || /front/i.test(a.label));
  if(fi>0) angles = [angles[fi], ...angles.filter((_,i)=>i!==fi)];
  if(!angles.length) return { ...none, info };
  const capturedAt = String((info && info.capturedAt) || (rec && (rec.capturedAt || rec.iso)) || "");
  return { usable:true, unavailable:false, why:"", angles, urls:angles.map(a=>a.url), capturedAt, info };
}
window.turnLoadLikeness = turnLoadLikeness;
/* photoreal styles match the face exactly; a stylized style keeps the person recognisable in that style (decision G) */
function turnLikenessStyle(c){
  const key = (typeof inferCharacterRenderStyleKey==="function") ? inferCharacterRenderStyleKey(c||{}) : ((c&&c.renderStyleKey)||"photoreal");
  const rb = (typeof charRenderBlock==="function") ? (charRenderBlock(c||{})||{}) : {};
  const builtIn = Object.prototype.hasOwnProperty.call(CHAR_RENDER_STYLES, key);
  const name = (key==="surprise" && c && c.surpriseRender && c.surpriseRender.label) ? c.surpriseRender.label
    : (renderStylePromptName(key) || String(rb.rendering||"").split(/[;,—]/)[0].trim() || "chosen");
  let photoreal;
  if(builtIn && key!=="surprise") photoreal = RENDER_STYLE_GROUP_BY_KEY[key]==="Photoreal" || key==="horror";
  else{ const r = String(rb.rendering||"");
    photoreal = /photo|live-action|photograph/i.test(r) && !/illustrat|anime|cartoon|painted|drawn|sketch|clay|paper|pixel/i.test(r); }
  return { key, photoreal:!!photoreal, name };
}
window.turnLikenessStyle = turnLikenessStyle;
const _lkImg = (a,b)=> a===b ? ("Image "+a) : ("Images "+a+"–"+b);
const _lkImgLow = (a,b)=> a===b ? ("image "+a) : ("images "+a+"–"+b);
const _lkNote = (n)=> String(n||"").replace(/\s*\((?:worn|carried)\)\s*$/i,"").trim();
/* THE ORDER AND THE NUMBERED MAP. parts:
     likeness  the turnLoadLikeness result (usable)       frontOnly  edits: the front angle only
     edit      { url } the sheet being edited (image 1)    master     { url, label } the master / current sheet
     worn      [{ url, note }] worn-item sheets            photo      { url, label } a dropped reference photo
     others    [{ url, note }] anything else, last (an edit's attached inputs)
     character the character (its render style)
   → { primary, extras, images, map, rule, faceImages, masterImage, count } */
function turnLikenessPlan(parts){
  const P = parts || {};
  const L = P.likeness && P.likeness.usable ? P.likeness : null;
  const angles = L ? (P.frontOnly ? L.angles.slice(0,1) : L.angles.slice()) : [];
  const order = [], lines = [];
  let n = 0;
  if(P.edit && P.edit.url){ n++; order.push(P.edit.url); lines.push(_lkImg(n,n)+" = the sheet being edited."); }
  const faceFrom = n+1;
  if(angles.length){
    n++; order.push(angles[0].url);
    lines.push(_lkImg(n,n)+" = the person's face, front"+(P.frontOnly ? " — keep it." : "."));
    const rest = angles.slice(1);
    if(rest.length){
      const a = n+1; rest.forEach(x=>{ n++; order.push(x.url); });
      // say which way the head is turned in the person's own terms, not "¾ left" (whose left? — 2026-10-10)
      const sideOf = (x)=>{ const k = String(x.key||"").toLowerCase(), l = String(x.label||"").toLowerCase();
        return k==="left" || (!k && /left/.test(l)) ? "left" : k==="right" || (!k && /right/.test(l)) ? "right" : ""; };
      const sides = rest.map(sideOf);
      const sideText = sides.every(Boolean)
        ? (sides.length>1 ? "with the head turned to the person's own "+sides.slice(0,-1).join(", ")+" and to their own "+sides[sides.length-1]+" (three-quarter views)"
          : "with the head turned to the person's own "+sides[0]+" (a three-quarter view)")
        : "from "+((labs)=> labs.length>1 ? labs.slice(0,-1).join(", ")+" and "+labs[labs.length-1] : labs[0])(rest.map(x=> String(x.label||"another angle").trim().toLowerCase()));
      lines.push(_lkImg(a,n)+" = the same face "+sideText+".");
    }
  }
  const faceTo = n;
  let masterImage = 0;
  if(P.master && P.master.url){ n++; order.push(P.master.url); masterImage = n;
    lines.push(_lkImg(n,n)+" = "+(P.master.label||"this character's master sheet")+"."); }
  const worn = (P.worn||[]).filter(w=>w && w.url);
  if(worn.length){ const a = n+1; worn.forEach(w=>{ n++; order.push(w.url); });
    lines.push(_lkImg(a,n)+" = worn item"+(worn.length>1?"s":"")+": "+worn.map(w=>_lkNote(w.note)||"worn item").join(", ")
      +" — lock "+(worn.length>1?"each":"it")+" onto the character exactly (shape, material, colour, wear and scale); worn items without an image follow the text."); }
  let photoImage = 0;
  if(P.photo && P.photo.url){ n++; order.push(P.photo.url); photoImage = n;
    lines.push(_lkImg(n,n)+" = a reference photo for "+(String(P.photo.label||"").trim()||"look")+" — use it for that only, never for the face."); }
  (P.others||[]).filter(o=>o && o.url).forEach(o=>{ n++; order.push(o.url); lines.push(_lkImg(n,n)+" = "+(_lkNote(o.note)||"an attached reference")+"."); });
  const st = turnLikenessStyle(P.character);
  const faceImages = angles.length ? _lkImgLow(faceFrom, faceTo) : "";
  let rule = "";
  if(angles.length){
    rule = P.frontOnly
      ? (st.photoreal
          ? "LIKENESS (binding): keep the face exactly as in "+faceImages+" — the real person this character is played by; don't idealise or change it."
          : "LIKENESS (binding): keep the person in "+faceImages+" recognisable — their face shape, features and proportions — drawn in the "+st.name+" style.")
      : (st.photoreal
          ? "LIKENESS (binding): this character is played by the real person in "+faceImages+". Match that face exactly — face shape, features, skin tone, eye colour, hair and apparent age — in the portrait and every view that shows the face; don't idealise, age or change it. The face comes from these photos, never from the text. Body build, height, wardrobe and accessories follow the specification."
          : "LIKENESS (binding): this character is played by the real person in "+faceImages+". Keep the person recognisable — their face shape, features and proportions — drawn in the "+st.name+" style, in the portrait and every view that shows the face. Body build, height, wardrobe and accessories follow the specification.");
  }
  const map = lines.length ? ("REFERENCE IMAGES, in the order attached: "+lines.join(" ")) : "";
  return { primary:order[0]||"", extras:order.slice(1), images:order, map, rule, faceImages, faceCount:angles.length,
    masterImage, photoImage, count:order.length, photoreal:st.photoreal, styleName:st.name };
}
window.turnLikenessPlan = turnLikenessPlan;
/* the master-sheet prompt in likeness mode: the face-free spec (+ canonical identity, as combinedImagePrompt adds) */
function charSheetPrompt(c, project, props, o){
  const base = String(buildCharRefPrompt(c, project, props, o)||"").trim();
  const identity = (typeof window.turnIdentityPrompt==="function") ? String(window.turnIdentityPrompt([c])||"").trim() : "";
  return identity ? (base+(base?"\n\n":"")+"CANONICAL CHARACTER IDENTITY (binding): "+identity) : base;
}
window.charSheetPrompt = charSheetPrompt;
/* the two roles a sheet can play after the angles (one wording for the card, the variants and the Casting Director) */
const LIKENESS_MASTER_LABEL = "this character's master sheet — keep its layout, panels, framing, render style and wardrobe";
const LIKENESS_CURRENT_LABEL = "this character's current master sheet — the sheet to update (keep its layout, panels, framing and render style)";
/* ctx for the prompt builders: which images hold the face, which one is the master */
function turnLikenessCtx(L, o){
  const n = (L && L.angles && L.angles.length) || 0;
  const edit = !!(o && o.edit);
  const f = edit ? 1 : n;
  const first = edit ? 2 : 1;
  return { likeness:true, faceCount:f,
    faceImages: f>1 ? ("images "+first+"–"+(first+f-1)) : ("image "+first),
    masterImage: (o && o.master) ? (f+1) : 0, deriveFromCurrent: !!(o && o.deriveFromCurrent) };
}
window.turnLikenessCtx = turnLikenessCtx;
/* a master sheet with a likeness: the face-free spec; updating the current master names it (image N) */
function turnLikenessMasterPrompt(c, project, props, ctx){
  const spec = charSheetPrompt(c, project, props, { likeness:true });
  if(!(ctx && ctx.masterImage)) return spec;
  return "Update this existing master character sheet for "+((c&&c.name)||"the character")+" (image "+ctx.masterImage+"). "
    +"Preserve its build, body proportions, panel layout, framing and render style; the face comes from "+ctx.faceImages+" (the likeness). "
    +"Apply the current production specification and worn-reference designs below without re-casting or re-imagining the character. "+spec;
}
window.turnLikenessMasterPrompt = turnLikenessMasterPrompt;
/* an appearance-state variant with a likeness: from the master (only the change differs), or — no master yet —
   a complete sheet FROM the face in the changed state (it used to get "edit this design sheet… keep its layout"
   while the only reference was a face photo) */
function turnLikenessVariantPrompt(c, st, project, props, ctx){
  const change = String((st&&st.change)||"").replace(/\.$/,"").trim();
  const label = (st&&st.label)||"variant";
  if(ctx && ctx.masterImage){
    const s = "Make the “"+label+"” appearance variant of "+((c&&c.name)||"the character")+"'s character design sheet. "
      +"Image "+ctx.masterImage+" is the master sheet: keep its layout, panel arrangement, framing, render style, build and wardrobe, "
      +"and apply only this appearance change: "+(change||"(no specific change given)")+". "
      +"The face comes from "+ctx.faceImages+" (the likeness) — the same person in every view. Do not re-imagine the character.";
    const identity = (typeof window.turnIdentityPrompt==="function") ? String(window.turnIdentityPrompt([c])||"").trim() : "";
    return identity ? (s+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identity) : s;
  }
  return charSheetPrompt(c, project, props, { likeness:true })+" APPEARANCE STATE — "+label+": "+change
    +". There is no master sheet yet: make this a complete character sheet in THIS changed state, consistent across every panel.";
}
window.turnLikenessVariantPrompt = turnLikenessVariantPrompt;
/* THE SHARED REQUEST for the sheet paths that call the image engine directly (app.jsx: the Casting Director's
   master and variants — so Scene needs and Wear props — and the prop owner's pre-generation). Same order, map,
   prompt wording and provenance as the card (nbRunSheetGeneration). o: { character, likeness?, state?, master?
   (url), deriveFromCurrent?, worn:[{url,note}], project, props }.
   → { usable:false, unavailable, why } | { usable:true, prompt, referenceImage, extraImages, plan, meta } */
async function turnLikenessSheetRequest(o){
  const c = (o && o.character) || {};
  const L = (o && o.likeness) || await turnLoadLikeness(c.id);
  if(!L || !L.usable) return { usable:false, unavailable:!!(L && L.unavailable), why:(L && L.why) || "" };
  const ctx = turnLikenessCtx(L, { master:!!o.master, deriveFromCurrent:!!o.deriveFromCurrent });
  let prompt = o.state ? turnLikenessVariantPrompt(c, o.state, o.project, o.props, ctx) : turnLikenessMasterPrompt(c, o.project, o.props, ctx);
  const plan = turnLikenessPlan({ likeness:L, character:c, worn:o.worn||[],
    master: o.master ? { url:o.master, label: o.deriveFromCurrent ? LIKENESS_CURRENT_LABEL : LIKENESS_MASTER_LABEL } : null });
  const tail = [plan.map, plan.rule].filter(Boolean).join(" ");
  if(tail) prompt += "\n\n"+tail;
  return { usable:true, prompt, referenceImage:plan.primary, extraImages:plan.extras, plan, likeness:L,
    meta:{ cameo:true, cameoAt:L.capturedAt||undefined, mode:o.master ? "base" : "cameo",
      likenessRefs:plan.faceCount, privateRefs:plan.faceCount } };
}
window.turnLikenessSheetRequest = turnLikenessSheetRequest;
/* the simplified retry, face-free when a likeness is locked (the likeness sentence and the map are added by the caller) */
function buildSimpleCharPromptFor(c, o){
  if(!(o && o.likeness)) return (typeof buildSimpleCharPrompt==="function") ? buildSimpleCharPrompt(c) : ("Character reference — "+((c&&c.name)||"character"));
  const F = (c && c.physique) || {};
  const v = charVisualDefaults(c||{});
  const body = [String(F.build||"").replace(/\.$/,"").trim(), v.height ? (v.height+" tall") : ""].filter(Boolean).join(", ")
    || turnLikenessStripFace((c&&(c.coreBody||c.look))||"").replace(/\.$/,"");
  const wardrobe = String((c&&(c.wardrobeMask||c.wardrobe))||"").replace(/\.$/,"").trim();
  const styleLine = String((charRenderBlock(c||{})||{}).rendering||"").split(/[;,]/)[0].trim();
  const parts = [
    "Character reference — "+((c&&c.name)||"character"),
    body || "",
    wardrobe ? ("wearing "+wardrobe) : "",
    "4-panel casting reference sheet: large close-up face portrait, full-body front view, full-body three-quarter front view, full-body back view",
    "plain grey background, studio lighting, "+(styleLine||"photoreal")+", sharp focus, no text or labels"
  ].filter(Boolean);
  const identity = (typeof window.turnIdentityPrompt==="function") ? String(window.turnIdentityPrompt([c])||"").trim() : "";
  const s = parts.join(". ")+".";
  return identity ? (s+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identity) : s;
}
window.buildSimpleCharPromptFor = buildSimpleCharPromptFor;
/* CONSENT before a person's photo is first used (a dropped reference photo, an uploaded face): the store's
   dialog ("Me" / "Someone else" + permission + 18 or over) when this build has it, else a confirm with the
   same wording. A refusal sends nothing. Remembered per photo for this session. */
const _lkConsented = new Set();
function _lkPhotoKey(u){ const s = String(u||""); return s.length+":"+s.slice(0,64)+":"+s.slice(-64); }
async function turnLikenessConsent(purpose, photoUrl){
  const key = photoUrl ? _lkPhotoKey(photoUrl) : "";
  if(key && _lkConsented.has(key)) return true;
  let ok;
  if(typeof window.cameoConsentGate==="function"){
    try{ ok = !!(await window.cameoConsentGate({ purpose:purpose||"reference" })); }catch(e){ ok = false; }
  } else if(typeof window.appConfirm==="function"){
    try{ ok = !!(await window.appConfirm({ title:"Use a photo of a real person?",
      body:"Is this you, or someone else? Only use a photo of yourself, or of someone who has given you permission to use their likeness — and they must be 18 or over.",
      confirmLabel:"I have permission — they're 18 or over", cancelLabel:"Cancel" })); }catch(e){ ok = false; }
  } else ok = true;   // an older build with neither: today's behaviour
  if(ok && key) _lkConsented.add(key);
  return ok;
}
window.turnLikenessConsent = turnLikenessConsent;
/* a likeness this person can't use here (a shared film): asked BEFORE the render is spent — the why, that the
   render won't include the face, and the price. true = go ahead (or there's nothing to say). */
async function turnLikenessUnavailableGate(c, refs){
  const t = turnLikenessUnavailableText(c && c.id, c && c.name);
  if(!t || typeof window.appConfirm!=="function") return true;
  const price = (typeof window.nbImageCostText==="function") ? window.nbImageCostText(1, refs!=null ? { refs } : undefined) : "";
  return !!(await window.appConfirm({
    title:"Generate without "+((c && c.name) || "this character")+"'s likeness?",
    body:t+(price ? " About "+price+" credit"+(price==="1"?"":"s")+"." : ""),
    confirmLabel:"Generate without the face", cancelLabel:"Cancel" }));
}
window.turnLikenessUnavailableGate = turnLikenessUnavailableGate;
/* a batch's price when its renders send different numbers of images (likeness photos, worn-item sheets): the
   sum of each image's own price, re-read when the engine / settings / price table change (like nbCostChip) */
function LikenessBatchCost({ refs }){
  const [, force] = React.useState(0);
  React.useEffect(()=>{
    const h = ()=>force(x=>x+1);
    ["nb-model-changed","nb-settings-changed","turn-pricing-changed"].forEach(t=>window.addEventListener(t, h));
    return ()=>["nb-model-changed","nb-settings-changed","turn-pricing-changed"].forEach(t=>window.removeEventListener(t, h));
  },[]);
  if(typeof window.nbImageCostText!=="function") return null;
  const list = (refs||[]).map(r=>Number(r)||0);
  let total = 0;
  for(const r of list){ const t = Number(window.nbImageCostText(1, { refs:r })); if(!(t>0)) return null; total += t; }
  if(!total) return null;
  const n = list.length;
  return React.createElement("span",{className:"nb-cost",
    title:"\u2248 "+total+" generation credit"+(total===1?"":"s")+" for "+n+" image"+(n===1?"":"s")
      +" \u2014 counting each one's likeness photos and worn-item sheets"}, String(total));
}
window.LikenessBatchCost = LikenessBatchCost;
/* saved labels from before the rename ("Cameo likeness") are shown under today's name; stored data is never rewritten */
function likenessDisplayLabel(s){
  const t = String(s==null?"":s);
  return t.replace(/\bFrom cameo likeness\b/gi,"From the likeness").replace(/\bcameo likeness\b/gi,"Likeness")
    .replace(/\bCameos\b/g,"Likenesses").replace(/\bcameos\b/g,"likenesses").replace(/\bCameo\b/g,"Likeness").replace(/\bcameo\b/g,"likeness");
}
window.likenessDisplayLabel = likenessDisplayLabel;
/* is this sheet made with an OLDER likeness than the one locked now? (decision: "made with an earlier likeness") */
function turnLikenessStale(meta, charId){
  if(!(meta && meta.cameo)) return false;
  const i = turnLikenessInfo(charId);
  const now = i && i.capturedAt ? String(i.capturedAt) : "";
  if(!now) return false;
  const made = String(meta.cameoAt || "");
  // a sheet from before cameoAt was recorded: compare with when the sheet itself was made
  return made ? made < now : !!(meta.iso && String(meta.iso) < now);
}
window.turnLikenessStale = turnLikenessStale;

/* Detect resolution tier + aspect from an uploaded image's real pixels — for sheets
   the user generated OUTSIDE the app (e.g. in ChatGPT) and imported, so
   we know neither up front. Quality (low/med/high) is a generation-time encoder
   setting and CANNOT be recovered from a finished image, so it's left unknown. */
function nbResLabel(w,h){ const lng=Math.max(w||0,h||0); if(!lng) return "—";
  const tier = lng<=1280 ? "1K" : (lng<=2600 ? "2K" : "4K"); return tier+" · "+w+"×"+h; }
function nbImageDimensions(src){
  if(!src) return Promise.resolve(null);
  return new Promise((resolve)=>{ const im=new Image();
    im.onload=()=>resolve(im.naturalWidth&&im.naturalHeight ? { w:im.naturalWidth, h:im.naturalHeight } : null);
    im.onerror=()=>resolve(null); im.src=src; });
}
function nbAspectLabel(w,h){ if(!w||!h) return "—"; const r=w/h;
  const known=[["21:9",21/9],["16:9",16/9],["3:2",3/2],["4:3",4/3],["1:1",1],["4:5",4/5],["3:4",3/4],["2:3",2/3],["9:16",9/16]];
  let best=known[0],bd=1e9; for(const k of known){ const d=Math.abs(k[1]-r); if(d<bd){ bd=d; best=k; } }
  if(bd/best[1] < 0.06) return best[0];
  const g=(a,b)=>b?g(b,a%b):a; const d=g(w,h)||1; return (w/d)+":"+(h/d); }

/* Cancel an in-flight generation by entity id. Aborts the network request (where the
   transport supports it — the direct Google fetch does; the Supabase proxy may still
   finish server-side), flags the run as cancelled so its result is DISCARDED rather than
   committed, clears the inflight marker, and fires "nb-gen-cancel" so the owning card
   drops its spinner immediately. The matching useImageGen checks __nbGenCancel before it
   commits, so a late-resolving request never overwrites the frame. */
if(typeof window.nbCancelGen!=="function"){
  window.nbCancelGen = function(gid){
    if(!gid) return;
    window.__nbGenCancel = window.__nbGenCancel || {};
    window.__nbGenCancel[gid] = true;
    if(window.__nbGenAbort && window.__nbGenAbort[gid]){ try{ window.__nbGenAbort[gid].abort(); }catch(e){} }
    if(window.__nbGenInflight) window.__nbGenInflight[gid] = false;
    if(typeof window.nbDiscardSheetSave==="function") window.nbDiscardSheetSave(gid);
    try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id:gid } })); }catch(e){}
  };
}

/* ============================================================
   nbRunSheetGeneration — the generation LIFECYCLE engine behind
   useImageGen. A plain async function (no React): it claims the
   per-id registry with a run token, runs the optional pre-generate
   gate (fail-closed), assembles references and the prompt, spends
   the request, and persists — re-checking cancellation, supersession
   and film scope (epoch) after every await. All UI state flows
   through env.ui callbacks, making the hook a thin adapter and this
   whole lifecycle headlessly testable against the dist build
   (scripts/test-artroom-genrun.mjs).
   env: { id, slotId, opts, allModels, genUrl, genMeta, slotHasRef,
          ui:{ setGenErr, setGening, setRetrying, setGenUrl,
               setGenTier, setGenMeta, closeEdit } }
   ============================================================ */
/* PRIVACY DISCLOSURE text for Image Details: when personal images (a dropped
   reference photo, the cameo likeness, device uploads in the edit panel) guided
   a cloud render, they are deliberately NOT stored with the project — but Details
   must still tell the truth about what shaped the image. Pure + window-exported
   so the headless lifecycle suite can assert the disclosure exists. */
function nbPrivateRefsNote(meta){
  const n = (meta && meta.privateRefs) || 0;
  if(!n) return "";
  // (2026-10-10, owner — Likeness review) a likeness's photos may be synced to its owner's cloud copy — they're
  // never saved with this image or the project, which is what this says
  const lk = Number(meta && meta.likenessRefs) || 0;
  if(lk && lk>=n) return (n===1 ? "1 private reference image" : n+" private reference images")
    +" — the likeness's photos — guided this render. They were not saved with this image or to the project.";
  return n===1
    ? "1 private reference image guided this render \u2014 it stayed on this device and was not saved to the project."
    : n+" private reference images guided this render \u2014 they stayed on this device and were not saved to the project.";
}
window.nbPrivateRefsNote = nbPrivateRefsNote;

// Unsaved renders stay in this browser session, scoped to their originating film.
// Retrying persistence must never make another paid generation request.
const _nbPendingSaves = new Map();
function nbPendingSheetSave(id){
  const p = _nbPendingSaves.get(id);
  return p && (typeof nbEpoch!=="function" || p.epoch===nbEpoch()) ? p : null;
}
function nbDiscardSheetSave(id){ _nbPendingSaves.delete(id); }
function nbRememberSheetSave(id, pending){
  _nbPendingSaves.set(id, pending);
  try{ window.dispatchEvent(new CustomEvent("nb-save-pending",{detail:{id}})); }catch(e){}
}
async function nbRetrySheetSave(id){
  const p = nbPendingSheetSave(id);
  if(!p || (window.__nbGenInflight&&window.__nbGenInflight[id])) return false;
  const token = window.__nbGenRunSeq = (window.__nbGenRunSeq||0)+1;
  window.__nbGenInflight = window.__nbGenInflight||{};
  window.__nbGenCancel = window.__nbGenCancel||{};
  window.__nbGenInflight[id]=token; window.__nbGenCancel[id]=false;
  const cancelled = ()=>window.__nbGenInflight[id]!==token || window.__nbGenCancel[id]
    || (typeof nbEpoch==="function" && nbEpoch()!==p.epoch);
  const announce = (type,extra)=>{ try{ window.dispatchEvent(new CustomEvent(type,{detail:{id,...extra}})); }catch(e){} };
  announce("nb-gen-start"); announce("nb-gen-saving");
  let saved=false;
  try{
    // Never overwrite a version produced/reverted/uploaded since this render failed.
    const d = typeof nbLoadDetailsAsset==="function" ? await nbLoadDetailsAsset(id) : {meta:typeof nbGetMeta==="function"?nbGetMeta(id):null};
    if(cancelled()) return false;
    if(d&&d.meta&&d.meta.iso===p.meta.iso&&d.url){
      if(typeof window.nbAdoptVerifiedAsset==="function"&&!window.nbAdoptVerifiedAsset(id,p.epoch,d))return false;
      nbDiscardSheetSave(id);saved=true;announce("nb-gen-done",{url:d.url,meta:d.meta});return true;
    }
    if(String((d&&d.meta&&d.meta.iso)||"")!==p.previousIso)
      throw new Error("This asset has changed since the save failed. Download the unsaved image or discard it; it cannot replace the newer version.");
    const r=await nbCommit(id,p.url,p.meta,p.refs,p.kind,p.epoch,cancelled);
    if(r&&r.tier==="cancellation-error"){
      if(typeof nbEpoch!=="function"||nbEpoch()===p.epoch)nbReportCancelFailure(r);
      return false;
    }
    if(cancelled() || (r&&(r.tier==="cancelled"||r.tier==="stale"))) return false;
    if(!r || r.tier==="error") throw new Error((r&&r.error)||"Saving still failed. Check your connection and retry; no image generation was charged.");
    nbDiscardSheetSave(id); saved=true;
    nbReportCleanup(r);
    announce("nb-gen-done",{url:r.url||p.url,meta:p.meta});
    return true;
  }catch(e){
    if(!cancelled()){ p.error=(e&&e.message)||"Save failed."; announce("nb-save-pending",{error:p.error}); }
    return false;
  }finally{
    if(window.__nbGenInflight[id]===token){
      delete window.__nbGenInflight[id]; delete window.__nbGenCancel[id];
      if(!saved) announce("nb-gen-cancel");
    }
  }
}
window.nbPendingSheetSave=nbPendingSheetSave;
window.nbRetrySheetSave=nbRetrySheetSave;
window.nbDiscardSheetSave=nbDiscardSheetSave;
function nbReportCleanup(result){
  if(result&&result.cleanupWarning&&typeof window.appToast==="function")
    window.appToast("The change was saved. Some deleted files still need storage cleanup; cleanup remains queued for retry.","info");
}
function nbReportCancelFailure(result){
  if(typeof window.appToast==="function")
    window.appToast("Cancellation could not be confirmed. The image may still be saved; check its Details before retrying. "+((result&&result.error)||""),"error");
}

/* Text provenance is independent of image provenance. A specification may be
   written by Fable/Gemini/etc., compiled into a render prompt by Kinolot's prompt
   compiler, and then rendered by an entirely different image model. Keep each
   source as a durable creation-time record in the image version's metadata. */
/* The render-prompt compiler label shown in Image details. New images store
   PROMPT_COMPILER_LABEL; older ones saved the internal codename ("TURN prompt
   compiler") or the old product name. Stored metadata is never rewritten — the
   old label is mapped to the product name at display time. */
const PROMPT_COMPILER_LABEL = "Kinolot prompt compiler";
function promptCompilerLabel(v){
  const s = String(v==null?"":v).trim();
  if(!s) return "";
  return s.replace(/\bTURN\b/g,"Kinolot").replace(/\bCinema ?Machine\b/gi,"Kinolot");
}
window.PROMPT_COMPILER_LABEL = PROMPT_COMPILER_LABEL;
window.promptCompilerLabel = promptCompilerLabel;
function nbWritingSourcesFor(entity){
  if(!entity || typeof entity!=="object") return [];
  const candidates = [
    entity.writingProvenance,
    entity.staging && entity.staging.writingProvenance,
    entity.appearanceState && entity.appearanceState.writingProvenance,
  ];
  const out=[], seen=new Set();
  candidates.forEach(p=>{
    if(!p || !p.model) return;
    const row={ task:String(p.task||"Specification"), model:String(p.model), modelId:String(p.modelId||""), at:Number(p.at)||undefined };
    const key=[row.task,row.modelId||row.model,row.at||0].join("|");
    if(seen.has(key)) return; seen.add(key); out.push(row);
  });
  return out;
}
window.nbWritingSourcesFor = nbWritingSourcesFor;

async function nbRunSheetGeneration(env, gopts){
  const { id, slotId, opts, allModels, genUrl, genMeta, slotHasRef, ui } = env;
  const { setGenErr, setGening, setRetrying, setGenUrl, setGenTier, setGenMeta } = ui;
  if(!window.__nbGenInflight) window.__nbGenInflight = {};
    gopts = gopts || {};
    /* Capture the request's model and quality before any guard, modal, reference
       lookup, or other await.  The controls are shared app-wide, so reading these
       values after a long render would make Details describe a later click rather
       than the request that actually spent the credit.  A caller-supplied quality
       is intentional (batch/surface defaults); otherwise the model-family setting
       is the source of truth. */
    // a retired engine's id in an option (Nano Banana 2 Lite, Nano Banana 2, Nano Banana Pro, GPT Image 2) runs — and
    // is recorded — as its successor
    const _requestedModel = (typeof nbCanonicalModelId==="function" ? nbCanonicalModelId : (x=>x))(gopts.model
      || (opts && opts.model)
      || (typeof nbGetModel==="function" ? nbGetModel() : ""));
    const _requestedIsGpt = typeof isGptImageModel==="function"
      ? isGptImageModel(_requestedModel) : /^gpt-image/i.test(String(_requestedModel||""));
    const _hasRequestedQuality = Object.prototype.hasOwnProperty.call(gopts,"quality");
    const _requestedQuality = _requestedIsGpt
      ? (_hasRequestedQuality ? gopts.quality
        : (opts && opts.quality!=null ? opts.quality
          : (typeof nbGetOaiQuality==="function" ? nbGetOaiQuality(_requestedModel) : "medium")))
      : undefined;
    /* Reject a contradiction before opening a confirmation modal or starting
       any reference preparation.  Provider wrappers repeat this check at the
       final paid boundary; this early check keeps batch/edit UI fail-closed. */
    if(typeof window.nbAssertMediaIdentity==="function"){
      try{ window.nbAssertMediaIdentity(opts, "image-run-start"); }
      catch(e){ setGenErr((e&&e.message)||"Character identity needs review before rendering."); return false; }
    }
    // belt-and-braces: the module registry is the cross-instance truth. A remounted
    // card whose local state missed the in-flight generation must never start a
    // SECOND one for the same id (two versions + double credit spend from one click).
    if(window.__nbGenInflight && window.__nbGenInflight[id]) return;
    if(nbPendingSheetSave(id)) return nbRetrySheetSave(id);
    // asset scope at generation start — nbCommit refuses the write if the user opened
    // another film while this rendered (entity ids repeat across films, so committing
    // late would overwrite the OTHER film's sheet under the same id)
    const _genEpoch = (typeof nbEpoch==="function") ? nbEpoch() : null;
    if(typeof nbHasKeyForCurrent==="function" && !nbHasKeyForCurrent()){
      setGenErr("Image generation runs on the studio's servers. Sign in to generate images.");
      return;
    }
    /* Mark this entity busy UP FRONT — before the optional pre-generate gate — and in
       the module-level inflight registry, not just local state. This makes a
       multi-step pre-step (e.g. generating linked props first, which can take a while)
       survive the card unmounting/remounting on an Art Room tab switch: a remounted
       card reads __nbGenInflight and shows the spinner throughout, and adopts the
       result via the "nb-gen-done" event. */
    setGenErr(""); setGening(true); setRetrying(false);
    /* per-run ownership token: registries are shared per id, so a run that was stopped
       (and superseded by a newer run for the same id) must be able to tell that the
       registry entries no longer belong to it — otherwise its late completion would
       erase the new run's markers and fire a bogus "done". Truthy, so every existing
       `if(__nbGenInflight[id])` check still works. */
    window.__nbGenRunSeq = (window.__nbGenRunSeq||0)+1;
    const _genRun = window.__nbGenRunSeq;
    window.__nbGenInflight[id] = _genRun;
    /* live discard predicate for THIS run: a Stop/Clear flagged the id cancelled, or a
       newer run took over the registry. Checked at every gate below AND passed into
       nbCommit, so a cancel that lands mid-persistence stops the write itself. */
    const _cancelledNow = ()=> !!(window.__nbGenCancel && window.__nbGenCancel[id])
      || !(window.__nbGenInflight && window.__nbGenInflight[id]===_genRun)
      || (typeof nbEpoch==="function" && nbEpoch()!==_genEpoch);
    // announce the start: a card that mounted BEFORE this run registered (e.g. it
    // remounted during a pre-generate phase like the staging draft or the prop's
    // owner prerequisite, when nothing was in the registry yet) flips its spinner on
    // and — crucially for batches — gets the gening true→false transition its
    // advance detection needs. Without this, such a card waits on the watchdog.
    try{ window.dispatchEvent(new CustomEvent("nb-gen-start",{ detail:{ id } })); }catch(e){}
    // cancellation: clear any stale flag, and register an AbortController so a Stop can
    // both kill the request (where supported) and have us DISCARD a late result.
    window.__nbGenCancel = window.__nbGenCancel || {};
    window.__nbGenCancel[id] = false;
    const abortCtl = (typeof AbortController!=="undefined") ? new AbortController() : null;
    if(abortCtl){ window.__nbGenAbort = window.__nbGenAbort || {}; window.__nbGenAbort[id] = abortCtl; }
    /* Capability validation is deliberately before beforeGenerate: that callback
       may generate linked prop sheets and therefore may spend credits itself. */
    if(_requestedIsGpt && typeof window.nbRequireImageQuality==="function"){
      let qualityError = null;
      try{ await window.nbRequireImageQuality(_requestedModel, _requestedQuality); }
      catch(e){ qualityError = e; }
      /* The capability OPTIONS request can outlive a film switch or Stop.  Do
         not enter beforeGenerate (which may spend on linked props) in that
         window.  Cancellation normally clears the inflight marker itself; the
         abort/cancel identity checks below let this run clean up its own stale
         entries without touching a newer run for the same id. */
      const _ownsAfterQuality = !!(window.__nbGenInflight && window.__nbGenInflight[id]===_genRun);
      const _abortIsOursAfterQuality = !!(window.__nbGenAbort && window.__nbGenAbort[id]===abortCtl);
      const _cancelledDuringQuality = _cancelledNow();
      if(!_ownsAfterQuality || _cancelledDuringQuality){
        const _qualityRunEntriesOurs = _ownsAfterQuality || _abortIsOursAfterQuality;
        const _alreadyAnnouncedCancel = !!(window.__nbGenCancel && window.__nbGenCancel[id]);
        if(_qualityRunEntriesOurs){
          if(_ownsAfterQuality) delete window.__nbGenInflight[id];
          if(_abortIsOursAfterQuality) delete window.__nbGenAbort[id];
          if(window.__nbGenCancel && (_ownsAfterQuality || _abortIsOursAfterQuality))
            delete window.__nbGenCancel[id];
          setGening(false);
          if(!_alreadyAnnouncedCancel)
            try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id } })); }catch(e){}
        }
        return false;
      }
      if(qualityError){
        setGenErr((qualityError&&qualityError.message)
          || "The selected image quality is not available yet. Refresh and try again.");
        setGening(false);
        delete window.__nbGenInflight[id];
        if(window.__nbGenAbort && window.__nbGenAbort[id]===abortCtl) delete window.__nbGenAbort[id];
        if(window.__nbGenCancel) delete window.__nbGenCancel[id];
        try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id } })); }catch(e){}
        return false;
      }
    }
    /* optional pre-generate gate (e.g. warn + optionally generate linked props first).
       Skipped for batch runs, in-place edits, and the simplified retry — those
       shouldn't pop a modal (a batch would pop one per card). */
    if(typeof opts.beforeGenerate==="function" && !(gopts.batch||gopts.editInstruction||gopts.simple)){
      let proceed=true;
      /* FAIL CLOSED: if the pre-generate check itself broke, don't silently render
         without the safeguards the director asked for — stop and say so instead. */
      try{ proceed = await opts.beforeGenerate(gopts); }
      catch(e){ proceed = false;
        setGenErr("The pre-generation check couldn't complete — nothing was rendered. Try again."); }
      /* re-check ownership after the await: a Stop (which clears our inflight marker)
         or a newer run for this id started while the gate modal was open. This run must
         simply vanish — touching the registries or firing events here would erase the
         NEW run's cancellation flag or spinner, and proceeding would spend credits on a
         result that can only be discarded. (Our own spinner was already dropped by the
         nb-gen-cancel event nbCancelGen fired.) */
      if(!(window.__nbGenInflight && window.__nbGenInflight[id]===_genRun)) return;
      if(proceed===false){
        setGening(false);
        // full rollback of everything this run installed (ownership verified above) —
        // leaving the abort controller or cancel flag behind would leak into the NEXT
        // run for this id
        delete window.__nbGenInflight[id];
        if(window.__nbGenAbort && window.__nbGenAbort[id]===abortCtl) delete window.__nbGenAbort[id];
        if(window.__nbGenCancel) delete window.__nbGenCancel[id];
        // a card that remounted during the gate seeded its spinner from the registry —
        // announce the cancellation so it doesn't wedge
        try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id } })); }catch(e){}
        return;
      }
    }
    // Immutable source facts that must describe what THIS request started from
    // (rather than whatever state exists when a long remote render finishes).
    let committedUrl = "";
    let discardedRun = false;
    try{
    let startMeta = null;
    if(typeof opts.metaStart==="function"){
      try{ startMeta = await opts.metaStart({ gopts });
        if(!startMeta || typeof startMeta!=="object") startMeta=null; }catch(e){ startMeta=null; }
    if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-after-meta");
    }
    const overrideModel = (gopts.model && typeof nbCanonicalModelId==="function") ? nbCanonicalModelId(gopts.model) : (gopts.model || null);
    const usedModel = overrideModel || _requestedModel;
    /* a model chosen via a fallback button ("Try <model>" / "Switch to <model>"
       after a failed generation) becomes the ACTIVE selection, so the model picker
       highlight, mobile summary, and key bar all reflect the switch. */
    if(overrideModel && typeof nbSetModel==="function"
       && (typeof nbGetModel!=="function" || nbGetModel()!==overrideModel)){
      nbSetModel(overrideModel);
      try{ window.dispatchEvent(new CustomEvent("nb-model-changed")); }catch(_){}
    }
    const isEditMode = !!(gopts.editInstruction && genUrl);
    const useSimple = !!gopts.simple;

    /* reference image: existing sheet (edit) or dropped reference art.
       LIKENESS (2026-10-10, owner — Likeness review): a locked likeness no longer waits at the end of the
       chain. With one, every sheet path follows the ONE RULE (turnLikenessPlan): the front angle is image 1,
       the other angles next, then the master (a variant / an update of the current sheet), the worn-item
       sheets and a dropped photo — which is ADDED as a style / wardrobe reference, never replacing the
       face. An edit or remaster of a likeness sheet re-attaches the front angle only (decision E). */
    let refImage = null;
    let mode = "final";
    let likeness = null;          // turnLoadLikeness's result, when it can be used here
    let likenessBlocked = null;   // a likeness that exists but this person can't use here (a shared film)
    if(opts.cameoId){
      let L = null;
      try{ L = await turnLoadLikeness(opts.cameoId); }catch(e){ L = null; }
      if(L && L.usable) likeness = L;
      else if(L && L.unavailable) likenessBlocked = L;
    }
    const editKeepsFace = !!(isEditMode && genMeta && genMeta.cameo);   // the sheet being edited shows the likeness
    let droppedPhoto = "";   // a dropped reference photo that rides beside the likeness
    let masterRef = "";      // the master / current sheet a likeness render builds on (after the angles)
    if(isEditMode){ refImage = gopts.editBaseUrl || genUrl; mode = "edit"; }
    else if(useSimple){ mode = "simple"; }
    else if(gopts.deriveFromCurrent && genUrl){ refImage = genUrl; mode = "base"; }
    else if(slotHasRef && typeof nbGetSlotImage==="function"){
      const ph = nbGetSlotImage(slotId);
      if(likeness && ph){ droppedPhoto = ph; mode = "cameo"; } else { refImage = ph; mode = "photo"; } }
    else if(opts.referenceFallback){ const b = await opts.referenceFallback(gopts); if(b){ refImage = b; mode = "base"; } else if(likeness) mode = "cameo"; }
    else if(likeness){ mode = "cameo"; }
    if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-after-references");
    const likenessOn = !!likeness && (mode==="cameo" || mode==="base" || mode==="simple" || (mode==="edit" && editKeepsFace));
    if(likenessOn && mode==="base"){ masterRef = refImage; refImage = null; }
    /* CONSENT before a person's photo is first used (a dropped reference photo, a device upload in the
       edit panel) on a character sheet. A refusal sends nothing. */
    const _isCharSlot = (typeof slotAssetKind==="function") ? slotAssetKind(slotId)==="character" : !!opts.cameoId;
    if(_isCharSlot){
      const personal = [droppedPhoto || (mode==="photo" ? refImage : "")]
        .concat(isEditMode && Array.isArray(gopts.editRefMeta) ? gopts.editRefMeta.filter(r=>r && r.url && !r.refId).map(r=>r.url) : [])
        .filter(Boolean);
      for(const u of personal){
        const ok = await turnLikenessConsent(isEditMode ? "edit" : "reference-photo", u);
        if(_cancelledNow()) throw { __cancelled:true };
        if(!ok) throw { __cancelled:true };
      }
    }
    const lkCtx = likenessOn ? turnLikenessCtx(likeness, { edit:mode==="edit", master:!!masterRef, deriveFromCurrent:!!gopts.deriveFromCurrent }) : null;

    /* prompt: edit | simplified fallback | from-photo | likeness | from-base | master */
    let genPrompt;
    if(mode==="edit") genPrompt = opts.buildEdit ? opts.buildEdit(gopts.editInstruction) : gopts.editInstruction;
    else if(mode==="simple") genPrompt = opts.buildSimple ? opts.buildSimple(lkCtx||undefined) : opts.buildFinal();
    else if(mode==="photo") genPrompt = opts.buildFromPhoto ? opts.buildFromPhoto() : opts.buildFinal();
    else if(likenessOn && typeof opts.buildLikeness==="function") genPrompt = opts.buildLikeness(lkCtx);
    else if(mode==="cameo") genPrompt = opts.buildFinal();   // a caller without buildLikeness: its spec (the map and the likeness rule follow)
    else if(mode==="base") genPrompt = opts.buildFromBase ? opts.buildFromBase() : opts.buildFinal();
    else genPrompt = opts.buildFinal();
    /* Character identity is appended here, rather than only in a particular
       builder, so buildFinal/buildFromBase/buildSimple/buildEdit all carry the
       same canonical wording. */
    const inferredIdentityIds = (typeof window.nbIdentityContext==="function")
      ? window.nbIdentityContext(opts).characterIds : [];
    const liveIdentityCast = Array.isArray(window.turnCast)
      ? window.turnCast.filter(c=>c&&inferredIdentityIds.indexOf(c.id)>=0) : [];
    const identityCast = opts.identityCast || (opts.identityCharacter ? [opts.identityCharacter] : liveIdentityCast);
    const identityPrompt = (identityCast.length && typeof window.turnIdentityPrompt==="function")
      ? String(window.turnIdentityPrompt(identityCast)||"").trim() : "";
     const genOpts = {
       metaOut:{},
       /* Keep the exact user intent on the internal options object.  The proxy
          owns the final provider-envelope normalization, so even
          `quality:"default"` must stay present here: nbGenerate must not fall
          back to a live getter after the director changes the picker. */
       requestedModel: _requestedModel,
       requestedQuality: _requestedQuality,
       quality: _requestedQuality
     };
    genOpts.identityCharacter = opts.identityCharacter || undefined;
    genOpts.identityCharacterIds = inferredIdentityIds;
    genOpts.identityCast = identityCast;
    genOpts.identityContext = opts.identityContext;
    const withIdentity = (text)=>{
      const s=String(text||"");
      return identityPrompt && s && s.indexOf(identityPrompt)<0
        ? s+"\n\nCANONICAL CHARACTER IDENTITY (binding): "+identityPrompt : s;
    };
    genPrompt = withIdentity(genPrompt);

    /* grounding (Nano Banana 2.1 only — nbModelGrounds, 2026-10-11; image-search grounding was Nano Banana 2's
       and went with it) */
    const groundEnabled = typeof nbGetGroundSearch==="function" && nbGetGroundSearch();
    const groundsWeb = typeof nbModelGrounds==="function" ? nbModelGrounds(usedModel) : false;
    if(abortCtl) genOpts.signal = abortCtl.signal;
    genOpts.assetId = slotId || id;   // the item this sheet is saved as (recorded with its credit hold)
     /* Pin the provider request to the model selected when this run started.
        Without this, a model switch during reference assembly would make
        metadata and the paid request disagree. */
     if(_requestedModel) genOpts.model = _requestedModel;
    if(gopts.aspectRatio) genOpts.aspectRatio = gopts.aspectRatio;   // caller can force aspect…
    if(gopts.imageSize)   genOpts.imageSize   = gopts.imageSize;     // …and resolution (e.g. storyboard: 16:9 / 2K)
     /* quality is already pinned above, including "default".  The server's final
        fal/OpenAI payload is the only layer that omits the provider field. */
    if(gopts.referenceMaxDim) genOpts.referenceMaxDim = gopts.referenceMaxDim;
    else if(opts.referenceMaxDim) genOpts.referenceMaxDim = opts.referenceMaxDim;
    if(refImage) genOpts.referenceImage = refImage;
    // an EDIT re-renders FROM this very frame — send the base at full working
    // fidelity (identity sheets keep the smaller cap); 640px bases were visibly
    // softening edited frames
    if(isEditMode) genOpts.baseMaxDim = 1536;
    // web grounding is a GEMINI-only feature — GPT Image has no such mode, so never
    // request it there (the proxy used to echo grounded:true off the bare request
    // flag, mis-badging GPT Image renders "Grounded" when nothing had grounded)
    // (2026-10-09, owner — Art Room review) only on the engine where the toggle shows — a toggle left on was once
    // sent with another engine too, charging the grounding surcharge with no visible control. (2026-10-11) That
    // engine is Nano Banana 2.1 alone; web search only (image-search grounding went with Nano Banana 2)
    if(groundEnabled && groundsWeb){ genOpts.groundSearch = true; }

    /* attachments: extra reference images (e.g. generated prop sheets the character
       carries) so the model SEES the object, not just its name. Resolved async. */
    let attachCount = 0;
    let attachList = [];
    if(opts.attachments && (mode!=="simple" || opts.attachmentsInSimple || opts.attachmentsRequired)){
      let attach = [];
      try{ attach = (await opts.attachments(gopts, mode)) || []; }
      catch(e){
        // Explicitly selected references are a render requirement, not optional
        // decoration. Never turn their load failure into a paid text-only render.
        if(opts.attachmentsRequired || (e&&e.requiredReference)) throw e;
        attach = [];
      }
      attach = attach.filter(a=>a && a.url);
      if(opts.attachmentsRequired && !attach.length)
        throw new Error("The selected reference images are unavailable. Restore or change the selection before generating.");
      if(typeof opts.rebuildPromptAfterAttachments==="function"){
        const rebuilt = opts.rebuildPromptAfterAttachments(attach, mode, gopts);
        if(rebuilt) genPrompt = rebuilt;
      }
      if(attach.length){
        attachList = attach;
        attachCount = attach.length;
        if(!likenessOn){   // with a likeness, the numbered map below orders and names them
          genOpts.extraImages = attach.map(a=>a.url);
          genOpts.extraImageMaxDims = attach.map(a=>
            a && a.assetRole==="screenplay_context" ? 1536 : (genOpts.referenceMaxDim||1024));
          const notes = attach.map(a=>a.note).filter(Boolean).join(", ");
          if(typeof opts.attachmentsText==="function"){
            const extra = opts.attachmentsText(attach);   // caller supplies the reference sentence
            if(extra) genPrompt += " "+extra;
          } else {
          genPrompt += " The additional reference image"+(attach.length>1?"s":"")+" provided show"
            +(attach.length>1?"":"s")+" item"+(attach.length>1?"s":"")+" this character carries or wears"
            +(notes?(": "+notes):"")+". Render the character WITH "+(attach.length>1?"these exact items":"this exact item")
            +", matching the reference design"+(attach.length>1?"s":"")+" faithfully.";
          }
        }
      }
    }

    /* targeted edit references (e.g. "Update prop" chips): specific sheets attached
       to THIS edit only — the instruction text names what to match. */
    if(!likenessOn && isEditMode && Array.isArray(gopts.editRefImages) && gopts.editRefImages.length){
      genOpts.extraImages = (genOpts.extraImages||[]).concat(gopts.editRefImages);
      genOpts.extraImageMaxDims = (genOpts.extraImageMaxDims||[]).concat(
        gopts.editRefImages.map(()=>genOpts.referenceMaxDim||1024));
    }

    /* LIKENESS — the ONE RULE's order and NUMBERED map (turnLikenessPlan): face first (for an edit the
       front angle only, after the sheet being edited), then the master, worn items, a dropped photo and an
       edit's attached inputs. The map + the likeness sentence close the prompt; the simplified retry
       re-sends the same images with the same map (likenessTail). */
    let likenessPlan = null, likenessTail = "";
    if(likenessOn){
      const editMeta = (isEditMode && Array.isArray(gopts.editRefMeta)) ? gopts.editRefMeta : [];
      const editIns = (isEditMode && Array.isArray(gopts.editRefImages)) ? gopts.editRefImages.filter(Boolean)
        .map(u=>({ url:u, note:((editMeta.find(r=>r && r.url===u)||{}).note)||"an attached edit input" })) : [];
      likenessPlan = turnLikenessPlan({ likeness, frontOnly: mode==="edit",
        edit: mode==="edit" ? { url:refImage } : null,
        master: masterRef ? { url:masterRef, label: gopts.deriveFromCurrent ? LIKENESS_CURRENT_LABEL : LIKENESS_MASTER_LABEL } : null,
        worn: attachList.map(a=>({ url:a.url, note:a.note })),
        photo: droppedPhoto ? { url:droppedPhoto, label:(typeof opts.photoLabel==="function" ? opts.photoLabel() : opts.photoLabel) || "look" } : null,
        others: editIns,
        character: opts.entity || opts.identityCharacter || null });
      genOpts.referenceImage = likenessPlan.primary;
      genOpts.extraImages = likenessPlan.extras.slice();
      genOpts.extraImageMaxDims = likenessPlan.extras.map(()=>genOpts.referenceMaxDim||1024);
      genOpts.referencesNumbered = true;   // proxyGenerate: an unreadable image stops the request (the numbers would shift)
      likenessTail = [likenessPlan.map, likenessPlan.rule].filter(Boolean).join(" ");
      if(likenessTail) genPrompt += "\n\n"+likenessTail;
    }

    /* collect the reference images actually used, for the details view.
       PRIVACY: personal source images stay on this device in cloud mode. The cameo
       face is biometric — and a dropped reference photo or a device upload in the
       edit panel is just as likely to be a real person's photo. None of them may
       ride into cloud-persisted refs (cloudCommit uploads every ref URL into shared
       project storage, where it's retained in history and visible to collaborators).
       meta.mode / meta.cameo / meta.privateRefs keep Details honest about what was
       used. GENERATED assets (prop sheets, base sheets, previous frames) are project
       material and persist as before. In local mode everything stays on-device
       anyway, so the originals are kept for Details. */
    const isCloud = (typeof nbBackend==="function" && nbBackend()==="cloud");
    let privateRefs = 0;   // personal images used for THIS render but kept off the project
    const refLabel = mode==="edit" ? "Previous sheet (edited)" : mode==="photo" ? "Reference photo"
      : mode==="base" ? "Base sheet" : null;
    // the LIKENESS photos are never stored as this sheet's references (in either mode): counted, not kept
    if(likenessPlan) privateRefs += likenessPlan.faceCount;
    const refVersion = (refId,fallbackMeta)=>{
      let m=fallbackMeta||null;
      if(refId && typeof nbGetMeta==="function"){ try{ m=nbGetMeta(refId)||m; }catch(e){} }
      return m ? { refVersion:m.version||null, refGenerated:m.iso||"" } : {};
    };
    const refsUsed = [];
    // a likeness render's master / current sheet moved after the angles — it's still this render's base sheet
    const _baseRefImage = refImage || masterRef;
    if(_baseRefImage && refLabel){
      if(isCloud && mode==="photo") privateRefs++;
      else{
        const baseRefId=mode==="base" && opts.referenceFallbackId
          ? (typeof opts.referenceFallbackId==="function" ? opts.referenceFallbackId(gopts) : opts.referenceFallbackId)
          : undefined;
        refsUsed.push({ kind:mode, label:refLabel, url:_baseRefImage,refId:baseRefId,
          ...refVersion(baseRefId,(mode==="edit"||gopts.deriveFromCurrent)?genMeta:null) });
      }
    }
    attachList.forEach(a=>{
      /* Screenplay-page refs are generated canvas pages, not project assets.
         Keep their role/count visible in Details but never carry their data
         URL into cloud/local reference persistence. */
      if(a && a.ephemeral && a.persist===false){
        refsUsed.push({ kind:a.kind||"screenplay_context", label:a.note||"Screenplay context page",
          url:"", refId:a.refId, ephemeral:true });
        return;
      }
      refsUsed.push({ kind:a.kind||"prop", label:a.note||"Reference image", url:a.url, refId:a.refId,
        refVersion:a.refVersion||refVersion(a.refId).refVersion||null,
        refGenerated:a.refGenerated||refVersion(a.refId).refGenerated||"" });
    });
    // user-attached edit inputs (the "+" menu: uploads and prop sheets, incl. carried)
    // — recorded so Details › "Reference images used" tells the whole story of an edit
    if(isEditMode && Array.isArray(gopts.editRefMeta)){
      gopts.editRefMeta.forEach(r=>{ if(r && r.url && !refsUsed.some(x=>x.url===r.url)){
        // entries without a refId are device uploads — same personal-photo rule as above
        if(isCloud && !r.refId) privateRefs++;
        else refsUsed.push({ kind:"edit-input", label:r.note||"Edit input image", url:r.url, refId:r.refId,
          refVersion:r.refVersion||refVersion(r.refId).refVersion||null,
          refGenerated:r.refGenerated||refVersion(r.refId).refGenerated||"" });
      }});
    }
    // a dropped photo beside the likeness follows the personal-photo rule
    if(droppedPhoto){
      if(isCloud) privateRefs++;
      else refsUsed.push({ kind:"photo", label:"Reference photo", url:droppedPhoto });
    }

    let actualModel = usedModel;     // may change if we fall back to another provider below
    let policyFellBack = "";
    let sentPrompt = genPrompt;      // the prompt the image that's kept was made from (a retry changes it)
    let simplifiedRetry = false;
      // last gate before the paid request: prompt/attachment assembly above awaited —
      // if a Stop or a newer run for this id landed in that window, don't spend at all
      if(_cancelledNow()) throw { __cancelled:true };
      let url;
      try{
        url = await nbGenerate(genPrompt, genOpts);
        if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-after-provider");
      }catch(e){
        if(_cancelledNow()) throw { __cancelled:true };
        const emsg = (e && e.message) || "";
        /* Use the same narrow content-filter classifier as the proxy error layer.
           A proxy/model-availability response such as `Image model "…" is not
           allowed on the fal proxy` contains the words "not allowed", but it is
           an infrastructure/configuration error — not a safety refusal.  The old
           broad regex silently spent a second request on Nano Banana and then
           showed the misleading policy-fallback toast seen by the director. */
        const isPolicy = typeof window.turnIsContentBlock==="function"
          ? window.turnIsContentBlock(emsg)
          : /rejected by the safety system|safety system|content polic|content_policy|moderation_blocked|flagged as potentially violating|image generation.*not allowed|violat(?:es|ing).*(?:policy|guidelines)/i.test(emsg);
        if(!useSimple && !isEditMode && /no image/i.test(emsg) && opts.buildSimple){
          setRetrying(true);
           if(typeof opts.assertFreshBeforeFallback==="function")
             await opts.assertFreshBeforeFallback({mode,prompt:genPrompt});
          if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-simple-retry");
          // the retry re-sends the same images: with a likeness it keeps the likeness sentence and the
          // numbered map, and Details records the prompt actually sent (2026-10-10, owner — Likeness review)
          const retryPrompt = withIdentity(opts.buildSimple(lkCtx||undefined)) + (likenessTail ? "\n\n"+likenessTail : "");
          url = await nbGenerate(retryPrompt, genOpts);
          sentPrompt = retryPrompt; simplifiedRetry = true;
          if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-after-simple-retry");
        } else if(isPolicy && typeof isGptImageModel==="function" && isGptImageModel(usedModel)){
          // GPT Image refused on CONTENT POLICY — fall back to Nano Banana 2.1 (2026-10-11: the one Nano Banana
          // engine), which is far more permissive for cinematic content (action, blood, intensity).
          // One-off: the user's SELECTED engine is left unchanged, only this frame switches.
          const gModel = allModels.find(m=>m.id==="gemini-nano-banana-2.1")
            || allModels.find(m=> !(typeof isGptImageModel==="function" && isGptImageModel(m.id)));
          if(!gModel) throw e;
          /* NO SILENT FALLBACK WITH A FACE (2026-10-10, owner — Likeness review): when the references include a
             likeness or a person's photo (a dropped photo, a device upload), the same photos would go to another
             engine — that is asked first, with the price, and nothing is sent without a yes. */
          const _personal = !!likenessPlan || mode==="photo" || !!droppedPhoto
            || (isEditMode && Array.isArray(gopts.editRefMeta) && gopts.editRefMeta.some(r=>r && r.url && !r.refId));
          if(_personal){
            const gLabel = gModel.label || "Nano Banana";
            const uLabel = ((allModels.find(m=>m.id===usedModel)||{}).label) || "GPT Image";
            const price = (typeof window.nbImageCostText==="function") ? window.nbImageCostText(1, { model:gModel.id, quality:null }) : "";
            let ok = false;
            if(typeof window.appConfirm==="function"){
              try{ ok = !!(await window.appConfirm({
                title: uLabel+" refused this. Try "+gLabel+" with the same photos?"+(price ? " \u00b7 about "+price+" credit"+(price==="1"?"":"s") : ""),
                body: uLabel+" declined it for its content policy. "+gLabel+" gets the same prompt and the same reference photos \u2014 including the real person's face. Nothing more is sent unless you say so.",
                confirmLabel:"Try "+gLabel, cancelLabel:"Cancel" })); }catch(_e){ ok = false; }
            }
            if(_cancelledNow()) throw { __cancelled:true };
            if(!ok) throw new Error(uLabel+" refused this image for its content policy. Nothing else was sent \u2014 you can try another engine below.");
          }
          setRetrying(true);
          policyFellBack = gModel.label || "Nano Banana";
          actualModel = gModel.id;
           if(typeof opts.assertFreshBeforeFallback==="function")
             await opts.assertFreshBeforeFallback({mode,prompt:genPrompt,model:gModel.id});
           if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-policy-fallback");
          url = await nbGenerate(genPrompt, { ...genOpts, model:gModel.id });
           if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-after-policy-fallback");
        } else { throw e; }
      }
      // cancelled mid-flight (Stop) or superseded by a newer run for this id:
      // discard the result — don't commit over the frame.
      if(_cancelledNow()) throw { __cancelled:true };
      if(typeof opts.assertPostGenerate==="function") await opts.assertPostGenerate({mode,url,prompt:genPrompt});
      // Record the actual returned pixels as well as the requested resolution tier.
      // Providers can return dimensions that differ slightly from the nominal tier.
      const outputDims = await nbImageDimensions(url);
      if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-after-dimensions");
      /* version number from existing history (nbCommit rolls history internally) */
      let priorCount = 0;
      try{
        const histLen = (typeof nbGetHistory==="function") ? (await nbGetHistory(id)).length : 0;
        if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-after-history");
        priorCount = genUrl ? Math.min(histLen+1, 12) : histLen;
      }catch(e){}
      const mEntry = allModels.find(m=>m.id===actualModel) || allModels[0] || {};
      const now = new Date();
      const sourceEntity = opts.entity || null;
      const renderStyleKey = (sourceEntity && sourceEntity.renderStyleKey) || "";
      const renderStyleLabel = (sourceEntity && typeof renderStyleLabelForEntity==="function") ? renderStyleLabelForEntity(sourceEntity) : "";
      const writingSources = nbWritingSourcesFor(sourceEntity);
      const meta = {
        modelLabel: mEntry.label || "Nano Banana",
        modelId: actualModel,
        policyFallback: !!policyFellBack,
        renderStyleKey,
        renderStyleLabel,
        aspect: genOpts.aspectRatio || ((typeof nbGetAspect==="function") ? nbGetAspect() : "16:9"),
        // the size really rendered (Seedream 5 Pro renders a 4K pick at 2K — proxyGenerate's metaOut.imageSize)
        size: (genOpts.metaOut && genOpts.metaOut.imageSize) || genOpts.imageSize || ((typeof nbGetRes==="function") ? nbGetRes() : "2K"),
        pixelW: outputDims && outputDims.w,
        pixelH: outputDims && outputDims.h,
         // Preserve the exact quality selected when THIS run began.  In
         // particular, "default" must not be inferred back to provider "high"
         // after the request, and a mid-run settings change must not rewrite it.
         quality: _requestedQuality,
         qualityModel: _requestedModel,
         requestedModel: _requestedModel,
        date: now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
        time: now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
        iso: now.toISOString(),
        // model-aware provenance: only a Gemini model can have grounded. Gated on
        // actualModel so the GPT-Image→Nano-Banana policy fallback still records
        // correctly (actualModel flips to the Gemini model in that path).
        grounded: !!(groundEnabled && !(typeof isGptImageModel==="function" && isGptImageModel(actualModel)) && genOpts.metaOut && genOpts.metaOut.grounded),
        // image-search grounding went with Nano Banana 2 (2026-10-11): a new render never has it (old metas keep theirs)
        groundImages: false,
        // LIKENESS: made with it (or an edit of a sheet that was — the face is still that person's), when it
        // was captured (a newer capture makes the sheet "made with an earlier likeness"), how many photos rode
        cameo: !!(likenessPlan || editKeepsFace),
        cameoAt: likenessPlan ? (likeness.capturedAt || undefined) : (editKeepsFace ? (genMeta.cameoAt || undefined) : undefined),
        likenessRefs: likenessPlan ? likenessPlan.faceCount : undefined,
        // a likeness exists but couldn't be used by this person here — the sheet follows the text spec
        likenessSkipped: (likenessBlocked && !likenessPlan) ? true : undefined,
        simplifiedRetry: simplifiedRetry || undefined,
        propRefs: attachCount,
        refCount: refsUsed.length,
        // personal images (reference photo / cameo / device uploads) that guided this
        // render but were deliberately NOT stored with the project (cloud mode privacy)
        privateRefs: privateRefs || undefined,
        prompt: sentPrompt,
        specPrompt: opts.buildFinal ? opts.buildFinal() : genPrompt,
        writingSources,
        // The final render prompt is assembled deterministically from the stored
        // specification and current controls; it is not a second hidden AI draft.
        promptCompiler:"Kinolot prompt compiler",
        mode: mode,
        editInstruction: isEditMode ? (gopts.editInstruction||"") : "",
        version: priorCount + 1
      };
      if(opts.identityCharacter || (opts.identityCast&&opts.identityCast.length) || identityCast.length){
        const primary = opts.identityCharacter || identityCast[0];
        const snap = (typeof window.nbIdentitySnapshot==="function")
          ? window.nbIdentitySnapshot(primary) : null;
        if(snap){
          meta.identitySnapshot = snap;
          meta.canonicalIdentity = snap;
          meta.canonicalPronouns = snap.pronouns || "";
          meta.identityVerified = snap.verified !== false;
          if(identityCast.length>1)
            meta.identitySnapshots = identityCast.map(c=>window.nbIdentitySnapshot(c)).filter(Boolean);
        }
      }
      if(isEditMode && typeof propReferenceSnapshot==="function"){
        // (2026-10-08) a RECORD of the prop sheets an edit used (Details) — its own field, so it never
        // collides with a frame's propDependencies signature (that one is compared; this one isn't)
        const prior=(genMeta&&Array.isArray(genMeta.propReferencesUsed))?genMeta.propReferencesUsed
          :(genMeta&&Array.isArray(genMeta.propDependencies))?genMeta.propDependencies:[];
        const depIds=[...prior.map(r=>r&&r.propId),
          ...(Array.isArray(gopts.propDependencyIds)?gopts.propDependencyIds:[]),
          ...(Array.isArray(gopts.editRefMeta)?gopts.editRefMeta.map(r=>r&&r.refId):[])].filter(Boolean);
        if(depIds.length) meta.propReferencesUsed=propReferenceSnapshot(depIds,window.turnContinuity||{});
      }
      if(startMeta) Object.assign(meta, startMeta);
      /* A surface-specific start stamp may add provenance fields, but quality is
         owned by this runner's immutable request snapshot.  Re-assert it after
         the merge so no late callback can replace "default"/"auto" with a live
         picker value. */
      meta.quality = _requestedQuality;
      meta.qualityModel = _requestedModel;
      meta.requestedModel = _requestedModel;
      // caller-supplied extra meta (e.g. a prop's owner-sheet anchor version, a
      // character sheet's baked worn-prop signature) — powers the staleness badges
      if(typeof opts.metaExtra==="function"){
        try{ const extra = await opts.metaExtra({ mode, refsUsed, prompt: sentPrompt });
          if(extra && typeof extra==="object") Object.assign(meta, extra); }
        catch(e){ if(e && e.sceneContextStale) throw e; }
      }
      if(typeof opts.assertPostGenerate==="function") await opts.assertPostGenerate({mode,url,prompt:genPrompt});
      if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts, "image-before-commit");
      // re-check cancel/ownership after the async meta work — a cancelled or
      // superseded generate must never commit
      if(_cancelledNow()) throw { __cancelled:true };
      const assetKind = (typeof slotAssetKind==="function") ? slotAssetKind(slotId) : "character";
      if(typeof nbWithAssetProvenance==="function") Object.assign(meta, nbWithAssetProvenance(id, meta, assetKind));
      // the live predicate rides into persistence: a Stop/Clear during the save stops
      // the write at the next internal checkpoint instead of storing a discarded frame
       try{ window.dispatchEvent(new CustomEvent("nb-gen-saving",{detail:{id}})); }catch(e){}
       let saveResult;
       try{ saveResult = await nbCommit(id, url, meta, refsUsed, assetKind, _genEpoch, _cancelledNow); }
       catch(e){ saveResult={tier:"error",error:(e&&e.message)||"Save failed."}; }
       if(saveResult&&saveResult.tier==="cancellation-error"){
         if(typeof nbEpoch!=="function"||nbEpoch()===_genEpoch)nbReportCancelFailure(saveResult);
         throw {__cancelled:true};
       }
      /* the film scope moved while this rendered (stale: nbCommit refused the write), or
         the user stopped/cleared during the save (cancelled). Treat both exactly like a
         cancellation — installing the pixels or firing "done" here would paint an image
         the user discarded (or the OLD film's image, same entity ids) into the card and
         advance a batch on a result that must not be shown. */
      if(saveResult && (saveResult.tier==="stale" || saveResult.tier==="cancelled")) throw { __cancelled:true };
      // the save itself awaited: never adopt/announce if a Stop landed during it
      if(_cancelledNow()) throw { __cancelled:true };
      /* the render finished but PERSISTENCE failed — this is a FAILURE, not a success.
         Adopting the pixels here would show the director a sheet that evaporates on
         reload (downstream tabs would consume it too). Keep the previous image and
         version history untouched and say what happened; retry stays explicit. */
       if(!saveResult || saveResult.tier==="error"){
         nbRememberSheetSave(id,{url,meta,refs:refsUsed,kind:assetKind,epoch:_genEpoch,
           previousIso:String((genMeta&&genMeta.iso)||""),error:saveResult&&saveResult.error});
         throw new Error("The image rendered, but saving it to your project failed. Retry save without generating again. Keep this tab open or download the unsaved image.");
       }
       nbDiscardSheetSave(id);
       nbReportCleanup(saveResult);
      committedUrl = (saveResult && saveResult.url) || url;
      setGenUrl(committedUrl);
      setGenTier((saveResult && saveResult.tier) || "local");
      setGenMeta(meta);
      if(isEditMode && typeof ui.closeEdit==="function") ui.closeEdit();
      // tell the user why this frame looks like the other engine
      if(policyFellBack && typeof window.appToast==="function")
        window.appToast("The first image engine declined that for its content policy — rendered with another engine instead.", "info");
    }catch(e){ if(e && (e.__cancelled || e.name==="AbortError")) discardedRun = true;
      else setGenErr((e && e.message) || "Generation failed."); }
    /* OWNERSHIP-SAFE teardown: only the run that still owns the registry entries may
       delete them or reset shared UI state — a stopped run whose id was reused by a
       newer run must not erase the newer run's markers, and must never report "done". */
    const own = !!(window.__nbGenInflight && window.__nbGenInflight[id]===_genRun);
    const wasCancelled = discardedRun || !own || !!(window.__nbGenCancel && window.__nbGenCancel[id]);
    if(own){
      setGening(false); setRetrying(false);
      delete window.__nbGenInflight[id];
      if(window.__nbGenAbort) delete window.__nbGenAbort[id];
      if(window.__nbGenCancel) delete window.__nbGenCancel[id];
    }
    // notify any (re)mounted card for this id so it adopts the result even if the
    // card that started the generation has since unmounted (tab switch mid-generate).
    // Skip when cancelled/discarded — there's no result to adopt — but a discarded run
    // that still owned the registry announces a cancel, so a remounted card that seeded
    // its spinner from the registry doesn't wedge.
    if(!wasCancelled){ try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, url: committedUrl } })); }catch(e){} }
    else if(own){ try{ window.dispatchEvent(new CustomEvent("nb-gen-cancel",{ detail:{ id } })); }catch(e){} }
    return !!committedUrl && !wasCancelled;
}
window.nbRunSheetGeneration = nbRunSheetGeneration;

/* ============================================================
   useImageGen — shared Nano Banana generation engine for any
   "sheet" entity (characters, props, …). Owns image state, the
   reference-photo slot watcher, edit mode, auto-retry, grounding,
   and tiered persistence. Parameterized by prompt builders so the
   same machinery drives every kind of reference sheet.
   ============================================================ */
function useImageGen(opts){
  const { id, slotId } = opts;
  // module-level registry of in-flight generations, so a generation survives the
  // owning card unmounting (e.g. switching Art Room tabs mid-generate). A remounted
  // card reads this to restore the spinner, and a global "nb-gen-done" event lets it
  // adopt the committed result even though the original card instance is gone.
  if(!window.__nbGenInflight) window.__nbGenInflight = {};
  const allModels = window.NB_MODELS || [];
  const [genUrl, setGenUrl] = React.useState(()=> (typeof nbGetImage==="function") ? nbGetImage(id) : "");
  const [genMeta, setGenMeta] = React.useState(()=> (typeof nbGetMeta==="function") ? nbGetMeta(id) : null);
  const [genTier, setGenTier] = React.useState("local");
  const [gening, setGening] = React.useState(()=> !!(window.__nbGenInflight && window.__nbGenInflight[id]));
  const [genErr, setGenErr] = React.useState("");
  const [retrying, setRetrying] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [pendingSave, setPendingSave] = React.useState(()=>nbPendingSheetSave(id));
  const [slotHasRef, setSlotHasRef] = React.useState(false);
  const [editMode, setEditMode] = React.useState(false);
  const [editText, setEditText] = React.useState("");
  const [layers, setLayers] = React.useState(0);   // count of prior versions (edit layers) you can revert to

  const genUrlRef = React.useRef(genUrl); genUrlRef.current = genUrl;

  const refreshLayers = React.useCallback(async ()=>{
    if(typeof nbGetHistory!=="function"){ return; }
    try{ const h = await nbGetHistory(id); setLayers((h&&h.length)||0); }catch(e){ setLayers(0); }
  },[id]);
  React.useEffect(()=>{ refreshLayers(); },[refreshLayers, genUrl]);

  /* hydrate from IndexedDB / cloud on mount (large sheets live there, not localStorage) */
  React.useEffect(()=>{
    let alive = true;
    if(!genUrl && typeof nbLoadImage==="function"){
      nbLoadImage(id).then(u=>{ if(alive && u){ setGenUrl(u); if(typeof nbGetMeta==="function") setGenMeta(nbGetMeta(id)); setGenTier("idb"); } });
    }
    // a background prefetch may warm this id's url AFTER we mounted empty — adopt it
    const onPrefetched = (e)=>{
      if(!alive || genUrlRef.current || !e.detail || !e.detail.ids || e.detail.ids.indexOf(id)<0) return;
      const u = (typeof nbGetImage==="function") ? nbGetImage(id) : "";
      if(u){ setGenUrl(u); if(e.detail.meta)setGenMeta(e.detail.meta); else if(typeof nbGetMeta==="function") setGenMeta(nbGetMeta(id)); setGenTier("idb"); }
    };
    window.addEventListener("nb-prefetched", onPrefetched);
    // if a generation for THIS id is in flight (started before this mount, e.g. a tab
    // switch), reflect the spinner; and listen for its completion to adopt the result.
    if(window.__nbGenInflight && window.__nbGenInflight[id]) setGening(true);
    const onDone = (e)=>{
      if(!alive || !e.detail || e.detail.id!==id) return;
      setGening(false); setRetrying(false); setSaving(false); setPendingSave(nbPendingSheetSave(id));
      const u = e.detail.url;
      if(u){ setGenUrl(u); if(e.detail.meta)setGenMeta(e.detail.meta); else if(typeof nbGetMeta==="function") setGenMeta(nbGetMeta(id)); setGenTier("idb"); }
      else if(typeof nbLoadImage==="function"){ nbLoadImage(id).then(x=>{ if(alive){ setGenUrl(x||""); if(typeof nbGetMeta==="function")setGenMeta(nbGetMeta(id)); setGenTier("idb"); } }); }
    };
    window.addEventListener("nb-gen-done", onDone);
    // user cancelled this id's generation elsewhere (chain Stop / per-card Stop): drop the
    // spinner now; the in-flight generate() sees __nbGenCancel and won't commit its result.
    const onCancel = (e)=>{ if(!alive || !e.detail || e.detail.id!==id) return; setGening(false); setRetrying(false); setSaving(false); };
    window.addEventListener("nb-gen-cancel", onCancel);
    // a run for THIS id started elsewhere (another instance of this card, possibly
    // already unmounted, finished its pre-generate phase and fired): show the spinner
    // so this instance also observes the true→false completion transition.
    const onStart = (e)=>{ if(!alive || !e.detail || e.detail.id!==id) return; setGening(true); setGenErr(""); };
    window.addEventListener("nb-gen-start", onStart);
    const onSaving=e=>{ if(alive&&e.detail&&e.detail.id===id)setSaving(true); };
    const onPending=e=>{ if(alive&&e.detail&&e.detail.id===id){setPendingSave({...nbPendingSheetSave(id)}); if(e.detail.error)setGenErr(e.detail.error);} };
    const onApproval=e=>{ if(alive&&e.detail&&e.detail.id===id&&typeof nbGetMeta==="function")setGenMeta(nbGetMeta(id)); };
    window.addEventListener("nb-gen-saving",onSaving);
    window.addEventListener("nb-save-pending",onPending);
    window.addEventListener("nb-approval-changed",onApproval);
    return ()=>{ alive=false; window.removeEventListener("nb-gen-done", onDone); window.removeEventListener("nb-prefetched", onPrefetched); window.removeEventListener("nb-gen-cancel", onCancel); window.removeEventListener("nb-gen-start", onStart);
      window.removeEventListener("nb-gen-saving",onSaving);window.removeEventListener("nb-save-pending",onPending);window.removeEventListener("nb-approval-changed",onApproval); };
  },[id]);

  /* the character's LIKENESS as the store reports it (locked / usable here / when captured), kept current
     by the store's "turn-cameo-changed" event (lock, sync, revoke, load) — 2026-10-10, owner — Likeness review */
  const cameoId = opts.cameoId || "";
  const [likeness, setLikeness] = React.useState(()=> cameoId ? (window.turnLikenessInfo||(()=>null))(cameoId) : null);
  React.useEffect(()=>{
    if(!cameoId){ setLikeness(null); return; }
    const refresh = ()=> setLikeness((window.turnLikenessInfo||(()=>null))(cameoId));
    refresh();
    const on = (e)=>{ const d = e && e.detail; if(!d || !d.charId || d.charId===cameoId) refresh(); };
    window.addEventListener("turn-cameo-changed", on);
    return ()=> window.removeEventListener("turn-cameo-changed", on);
  },[cameoId]);

  /* watch the reference-photo slot for drops */
  React.useEffect(()=>{
    const check = ()=>{ const url=typeof nbGetSlotImage==="function"?nbGetSlotImage(slotId):null; setSlotHasRef(!!url); };
    check();
    const el = document.getElementById(slotId);
    if(!el) return;
    const mo = new MutationObserver(check);
    mo.observe(el,{attributes:true,attributeFilter:["data-filled"]});
    return ()=>mo.disconnect();
  },[slotId]);

  const generate = async (gopts)=>{
    if(gening) return;   // local spinner state — every cross-instance guard lives in the runner
    if(typeof window.nbAssertMediaIdentity==="function"){
      try{ window.nbAssertMediaIdentity(opts, "image-generate"); }
      catch(e){ setGenErr((e&&e.message)||"Character identity needs review before rendering."); throw e; }
    }
    return await nbRunSheetGeneration({
      id, slotId, opts, allModels, genUrl, genMeta, slotHasRef,
      ui: { setGenErr, setGening, setRetrying, setGenUrl, setGenTier, setGenMeta,
        closeEdit: ()=>{ setEditMode(false); setEditText(""); } },
    }, gopts);
  };
  const cancelGen = ()=>{ if(gening && typeof window.nbCancelGen==="function") window.nbCancelGen(id); };
  const clearGen = async ()=>{
    try{
    /* a render still in flight would commit moments after this clear and silently
       resurrect the sheet the director just deleted — cancel it FIRST (flags the run
       cancelled + aborts the request + drops the spinner), so Clear means CLEARED.
       nbClearAsset then queues behind any commit already mid-save (per-id
       serialization), removing whatever that save managed to write. */
    if(typeof window.nbCancelGen==="function" && (gening || (window.__nbGenInflight && window.__nbGenInflight[id]))) window.nbCancelGen(id);
    nbDiscardSheetSave(id); setPendingSave(null);
    if(typeof nbClearAsset==="function") nbReportCleanup(await nbClearAsset(id));
    // cascade: also clear this entity's variant sub-sheets (a character's appearance
    // states, a location's time-of-day plates) so they aren't orphaned. Cameo, linked
    // props, and the written spec are deliberately left intact.
    if(typeof opts.relatedClearIds==="function" && typeof nbClearAsset==="function"){
      let extra=[]; try{ extra=opts.relatedClearIds()||[]; }catch(e){}
      for(const xid of extra){ if(xid && xid!==id){
        // same rule for each sub-sheet: stop its in-flight run before deleting it
        if(typeof window.nbCancelGen==="function" && window.__nbGenInflight && window.__nbGenInflight[xid]) window.nbCancelGen(xid);
        nbReportCleanup(await nbClearAsset(xid)); } }
    }
    setGenUrl(""); setGenErr(""); setGenTier("local"); setGenMeta(null);
    return true;
    }catch(e){setGenErr("Clear could not finish: "+((e&&e.message)||"storage unavailable")+". Retry Clear to finish cleanup.");return false;}
  };
  /* Import a FINISHED sheet the user generated outside the app (full resolution, no
     downscale — unlike the reference-photo slot) and commit it AS this entity's sheet,
     so it gets every normal affordance (zoom, ⋯ menu, clear, used as a reference
     downstream). Resolution + aspect are detected from the pixels; quality is unknown. */
  const importSheet = async (file)=>{
    if(gening || !file) return;
    if(!/^image\/(png|jpeg|jpg|webp|avif)$/i.test(file.type||"")){ setGenErr("Choose a PNG, JPEG, WebP or AVIF image."); return; }
    if(typeof window.nbAssertMediaIdentity==="function"){
      try{ window.nbAssertMediaIdentity(opts,"image-import-start"); }
      catch(e){ setGenErr((e&&e.message)||"Character identity needs review before importing this sheet."); return; }
    }
    // film scope at import start — reading + decoding the file awaits, and entity ids
    // repeat across films: without this, switching films mid-import would store the
    // image under the SAME id in the newly opened film
    const _importEpoch = (typeof nbEpoch==="function") ? nbEpoch() : null;
    setGenErr(""); setGening(true);
    try{
      const dataUrl = await new Promise((res,rej)=>{ const fr=new FileReader();
        fr.onload=()=>res(fr.result); fr.onerror=()=>rej(new Error("Couldn't read that file.")); fr.readAsDataURL(file); });
      const dims = await new Promise((res)=>{ const im=new Image();
        im.onload=()=>res({ w:im.naturalWidth, h:im.naturalHeight }); im.onerror=()=>res(null); im.src=dataUrl; });
      const now = new Date();
      const meta = {
        modelLabel:"Uploaded", modelId:"uploaded", uploaded:true, mode:"upload",
        aspect: dims ? nbAspectLabel(dims.w,dims.h) : "—",
        size:   dims ? nbResLabel(dims.w,dims.h)   : "—",
        pixelW: dims&&dims.w, pixelH: dims&&dims.h,
        date: now.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}),
        time: now.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}),
        iso: now.toISOString(), version: 1,
      };
      if(typeof window.nbIdentitySnapshot==="function"){
        const snap=window.nbIdentitySnapshot(opts.identityCharacter||opts.entity);
        if(snap){ meta.identitySnapshot=snap; meta.canonicalIdentity=snap;
          meta.canonicalPronouns=snap.pronouns||""; meta.identityVerified=snap.verified!==false; }
      }
      // the card's own record of what an upload stands for (Storyboards: the page's shots) — 2026-10-09
      if(typeof opts.importMeta==="function"){ try{ Object.assign(meta, opts.importMeta()||{}); }catch(e){} }
      if(typeof window.nbAssertMediaIdentity==="function") window.nbAssertMediaIdentity(opts,"image-import-before-commit");
      const assetKind = (typeof slotAssetKind==="function") ? slotAssetKind(slotId) : "character";
      if(typeof nbWithAssetProvenance==="function") Object.assign(meta, nbWithAssetProvenance(id, meta, assetKind));
      const saveResult = await nbCommit(id, dataUrl, meta, [], assetKind, _importEpoch);
      // same honesty rule as generation: an import that failed to save is a failure,
      // and a film switch mid-import must not paint into the other film's card
      if(!saveResult || saveResult.tier==="error")
        throw new Error("The image was read, but saving it to your project failed — nothing was imported. Check your connection and try again.");
      if(saveResult.tier!=="stale"){
        const url = saveResult.url || dataUrl;
        setGenUrl(url); setGenTier(saveResult.tier || "local"); setGenMeta(meta);
        setSlotHasRef(false);
        try{ window.dispatchEvent(new CustomEvent("nb-gen-done",{ detail:{ id, url } })); }catch(e){}
        if(typeof opts.onImported==="function"){ try{ opts.onImported(meta); }catch(e){} }   // the card's own follow-up (Shots: approval)
      }
    }catch(e){ setGenErr((e && e.message) || "Couldn't import the image."); }
    setGening(false);
  };
  /* how many variant sub-sheets a Clear would also remove (for the confirm message) */
  const relatedClearCount = (typeof opts.relatedClearIds==="function")
    ? (()=>{ try{ return (opts.relatedClearIds()||[]).length; }catch(e){ return 0; } })() : 0;
  /* details + version control for the info panel */
  const loadDetails = async ()=>{
    if(typeof nbLoadDetailsAsset==="function") return await nbLoadDetailsAsset(id, genUrl);
    return { id, url:genUrl, meta:genMeta, refs:[], history:[] };
  };
  const revertTo = async (index)=>{
    if(typeof nbRevertAsset!=="function") return;
    const r = await nbRevertAsset(id, index);
    if(r){ setGenUrl(r.url); setGenMeta(r.meta||null); if(typeof opts.onReverted==="function"){ try{ opts.onReverted(r); }catch(e){} } }
    refreshLayers();
  };
  const deleteCurrentAndPromote = async ()=>{
    if(typeof nbDeleteCurrentAndPromoteAsset!=="function") return null;
    const r = await nbDeleteCurrentAndPromoteAsset(id);
    nbReportCleanup(r);
    // the promoted version is a RESTORE too — the card's onReverted holds it (Storyboards: off the automatic
    // redraws, which used to bring the deleted sheet's replacement straight back — 2026-10-09, owner — Storyboards review)
    if(r){ setGenUrl(r.url); setGenMeta(r.meta||null); if(typeof opts.onReverted==="function"){ try{ opts.onReverted(r); }catch(e){} } }
    refreshLayers();
    return r;
  };
  /* one-tap "undo last edit": restore the most recent prior version (layer 0) */
  const revertPrevious = async ()=>{ await revertTo(0); };
  /* delete a single version from history */
  const deleteVersion = async (index)=>{
    if(typeof nbDeleteHistoryEntry!=="function") return;
    const r=await nbDeleteHistoryEntry(id, index);
    nbReportCleanup(r);
    refreshLayers();
  };

  // a usable likeness: how many photos a fresh sheet sends; an edit of a likeness sheet re-attaches the front one
  const likenessUsable = !!(likeness && likeness.available!==false);
  const likenessRefs = likenessUsable ? Math.max(1, Number(likeness.angleCount)||1) : 0;
  return { id, genUrl, genMeta, genTier, gening, genErr, retrying, saving, pendingSave, slotHasRef,
    likeness, likenessUsable, likenessRefs,
    likenessEditRefs: (likenessUsable && genMeta && genMeta.cameo) ? 1 : 0,
    likenessStale: !!(cameoId && genMeta && (window.turnLikenessStale||(()=>false))(genMeta, cameoId)),
    // the caller's reference counts for prices: { generate, attach } (the character card)
    refCounts: (typeof opts.refCounts==="function") ? opts.refCounts : null,
    retrySave:()=>nbRetrySheetSave(id),
    discardSave:()=>{nbDiscardSheetSave(id);setPendingSave(null);setGenErr("");},
    setApproval:async (approved,reviewKey)=>{
      if(typeof window.nbSetAssetApproval!=="function" || !genMeta || !genMeta.iso)throw new Error("This version cannot be approved.");
      const r=await window.nbSetAssetApproval(id,genMeta.iso,approved,reviewKey);
      if(!r||!r.ok)throw new Error((r&&r.error)||"Approval could not be saved.");
      setGenMeta(r.meta); return r;
    },
    editMode, setEditMode, editText, setEditText, generate, cancelGen, clearGen, importSheet, relatedClearCount,
    relatedClearIdsOf:(typeof opts.relatedClearIds==="function") ? opts.relatedClearIds : null, relatedClearLabel:opts.relatedClearLabel||"",
    loadDetails, revertTo, revertPrevious, deleteCurrentAndPromote, deleteVersion, layers, allModels,
    // the card's CURRENT spec prompt — lets QA judge uploaded/imported images
    // (which carry no generation prompt) against the written spec instead
    buildFinal: opts.buildFinal };
}
window.useImageGen = useImageGen;

/* ---- shared BATCH GENERATION engine (Props / Characters / Locations) ----------
   One queue at a time. Setting `activeId` to a card id makes THAT card auto-generate
   (each SheetFrame card watches activeId and fires gen.generate when it's its turn),
   then calls advance() to move to the next. begin() first partitions the ids into
   those that already have a sheet vs. not, and surfaces a choice (generate missing /
   regenerate all) when some already exist. Drives both the per-scene batch and the
   tab-wide "Generate all". */
function useBatchGen(){
  const [queue, setQueue] = React.useState([]);
  const [activeId, setActiveId] = React.useState(null);
  const [total, setTotal] = React.useState(0);
  const [msg, setMsg] = React.useState("");
  const [prompt, setPrompt] = React.useState(null);   // {missing:[ids], existing:[ids]}
  const [preparing, setPreparing] = React.useState(false);   // the async "already have a sheet?" scan
  /* BUSY spans a whole batch (partition scan \u2192 queue drained) and is a REF so it reads
     correctly SYNCHRONOUSLY. `activeId` is state, so during the scan it is still null and
     the trigger buttons (disabled only on batchActiveId) stayed live: two quick clicks ran
     two partition loops, and the second one's run() reset the queue to item 0 \u2014 re-rendering
     an already-finished sheet and double-spending image credits. */
  const busyRef = React.useRef(false);
  /* bumped by begin() and cancel(). An in-flight scan whose token has changed abandons, so
     a batch the user cancelled can't resurrect itself when its awaits finally resolve. */
  const tokenRef = React.useRef(0);
  const advance = React.useCallback((doneId)=>{
    setQueue(q=>{
      const rest = q.filter(id=>id!==doneId);
      if(rest.length){ setActiveId(rest[0]); setMsg("Generating "+(total-rest.length+1)+" of "+total+"\u2026"); }
      else { setActiveId(null); setMsg(""); setTotal(0); }
      return rest;
    });
  },[total]);
  // the batch is over (or never started) \u2192 release the tab for a new one
  React.useEffect(()=>{ if(!activeId && !prompt && !preparing) busyRef.current = false; },[activeId, prompt, preparing]);
  /* QUEUE ADVANCEMENT no longer depends on the active CARD staying mounted. It used to
     advance only from that card's effect, so if the card unmounted mid-generation (tab
     change, filter change, a reorder that changed its React key) nothing ever called
     advance: the queue froze at "Generating k of N\u2026" with every generate button disabled,
     and only Cancel got you out. Listen for the global commit event instead, plus a
     watchdog for a generation that dies WITHOUT ever committing (a hard failure fires no
     event at all). The card's own callback still fires too \u2014 advance is idempotent. */
  React.useEffect(()=>{
    if(!activeId) return;
    const onDone = (e)=>{ if(e && e.detail && e.detail.id===activeId) advance(activeId); };
    window.addEventListener("nb-gen-done", onDone);
    // 7 min is beyond the client's own 390s hard cap, so this only fires on a dead slot
    const wd = setTimeout(()=>{
      setMsg("That sheet didn't finish \u2014 skipping it and carrying on.");
      // retire the stuck run before moving on: without this the zombie request could
      // keep spending credits and commit/announce late, overlapping the next item
      try{ if(typeof window.nbCancelGen==="function") window.nbCancelGen(activeId); }catch(e){}
      advance(activeId);
    }, 420000);
    return ()=>{ window.removeEventListener("nb-gen-done", onDone); clearTimeout(wd); };
  },[activeId, advance]);
  // a transient notice ("Cancelled.", "nothing to generate") used to pin the bar on screen
  // for the rest of the session \u2014 retire it once nothing is actually running
  React.useEffect(()=>{
    if(!msg || activeId || prompt || preparing) return;
    const t = setTimeout(()=>setMsg(""), 9000);
    return ()=>clearTimeout(t);
  },[msg, activeId, prompt, preparing]);
  const run = (ids, skipped)=>{
    if(!ids.length) return;
    busyRef.current = true;              // the prompt's buttons call run() directly
    setPrompt(null); setPreparing(false);
    setTotal(ids.length); setQueue(ids); setActiveId(ids[0]);
    setMsg("Generating 1 of "+ids.length+(skipped?(" \u00b7 skipped "+skipped+" already done"):"")+"\u2026");
  };
  // opts.alwaysAsk (2026-10-08, Props): even when nothing has a sheet yet, show the choice bar with
  // the price instead of starting at once
  const begin = async (ids, undraftedSkipped, opts)=>{
    if(busyRef.current || activeId) return;   // ref, not state \u2014 correct during the scan
    busyRef.current = true;
    const token = ++tokenRef.current;
    const mine = ()=> tokenRef.current===token;
    const stop = (m)=>{ setMsg(m); setPreparing(false); busyRef.current = false; };
    if(typeof nbHasKeyForCurrent==="function" && !nbHasKeyForCurrent()) return stop("The chosen image model isn't available right now \u2014 pick another one in the Images dock on the right edge.");
    if(!ids.length) return stop(undraftedSkipped ? "Draft the cards first \u2014 nothing is ready to generate yet." : "Nothing to generate yet.");
    setPrompt(null); setPreparing(true);
    setMsg("Checking which already have a sheet\u2026");
    const missing=[], existing=[];
    for(const id of ids){
      if(!mine()) return;                     // cancelled or restarted mid-scan
      let has = (typeof nbGetImage==="function") ? nbGetImage(id) : "";
      if(!has && typeof nbLoadImage==="function"){ try{ has = await nbLoadImage(id); }catch(e){} }
      (has?existing:missing).push(id);
    }
    if(!mine()) return;
    setPreparing(false);
    if(!existing.length && !(opts && opts.alwaysAsk)){ setMsg(""); run(missing, 0); return; }
    // opts.note: what else the run spends (e.g. Locations' writing calls) — shown on the choice bar
    const note = (opts && typeof opts.note==="function") ? opts.note(missing, existing) : ((opts && opts.note) || "");
    // opts.refsOf (2026-10-10, likeness): each item's reference-image count, so the choice bar's price counts them
    const refsOf = (opts && typeof opts.refsOf==="function") ? opts.refsOf : null;
    if(!missing.length){ setMsg(""); setPrompt({ missing:[], existing:ids, note, refsOf }); return; }
    setMsg(""); setPrompt({ missing, existing, note, refsOf });
  };
  const cancel = ()=>{
    tokenRef.current++;                  // abandon any in-flight partition scan
    busyRef.current = false;
    setQueue([]); setActiveId(null); setTotal(0); setPreparing(false); setPrompt(null);
    setMsg("Cancelled.");
  };
  return { activeId, msg, prompt, preparing, setPrompt, setMsg, advance, run, begin, cancel, total };
}
window.useBatchGen = useBatchGen;

/* ---- shared 9-up PAGINATION for the sheet grids (Props / Characters / Locations).
   `suspend` (e.g. while a batch is running) shows EVERYTHING — the batch queue
   advances by watching mounted cards, so paging mustn't unmount its targets. */
const SHEETS_PER_PAGE = 9;
function usePager(total, suspend){
  const [page, setPage] = React.useState(0);
  const pages = Math.max(1, Math.ceil(total/SHEETS_PER_PAGE));
  React.useEffect(()=>{ if(page > pages-1) setPage(Math.max(0, pages-1)); },[pages, page]);
  const slice = (arr)=> (suspend || total<=SHEETS_PER_PAGE) ? arr
    : arr.slice(page*SHEETS_PER_PAGE, (page+1)*SHEETS_PER_PAGE);
  return { page, setPage, pages, slice, active: !suspend && total>SHEETS_PER_PAGE, total };
}
function PagerBar({ pager, noun }){
  if(!pager || !pager.active) return null;
  const { page, setPage, pages, total } = pager;
  const go = (p)=> setPage(Math.max(0, Math.min(pages-1, p)));
  const nums = [];
  for(let i=0;i<pages;i++) nums.push(i);
  return React.createElement("div",{className:"pager"},
    React.createElement("button",{className:"pager-btn",disabled:page===0,onClick:()=>go(page-1),"aria-label":"Previous page"},
      React.createElement(Icon.chevL,{s:14})),
    pages<=9
      ? nums.map(i=>React.createElement("button",{key:i,className:"pager-num"+(i===page?" on":""),onClick:()=>go(i)}, i+1))
      : React.createElement("span",{className:"pager-count"},(page+1)+" / "+pages),
    React.createElement("button",{className:"pager-btn",disabled:page===pages-1,onClick:()=>go(page+1),"aria-label":"Next page"},
      React.createElement(Icon.chevR,{s:14})),
    React.createElement("span",{className:"pager-note"}, total+" "+(noun||"card")+(total!==1?"s":"")));
}
window.usePager = usePager; window.PagerBar = PagerBar;

/* shared batch status / choice strip — render just under a tab's toolbar. `noun`
   is the singular card noun ("prop" / "character" / "location"). */
/* Shared ART-ROOM PROGRESS CARD — spinner + bold title + reassuring subtitle, matching
   the shots re-design note, so every tab-level "AI is working" state reads the same. */
function ArtProgress({ title, detail, onCancel }){
  return React.createElement("div",{className:"art-progress-card"},
    React.createElement("span",{className:"ns-spin"}),
    React.createElement("div",{className:"apc-txt"},
      React.createElement("div",{className:"apc-t"},title),
      detail && React.createElement("div",{className:"apc-d"},detail)),
    onCancel && React.createElement("button",{className:"art-draftall ghost apc-cancel",onClick:onCancel},"Cancel"));
}
window.ArtProgress = ArtProgress;

function BatchBar({ batch, noun }){
  const { activeId, msg, prompt, preparing, run, cancel, setPrompt, setMsg } = batch;
  // the bar lives at the TOP of the tab, but its triggers (e.g. a card's generate
  // button) can sit far down the page — scroll the bar into view when it has a
  // question or status, or the click looks like it did nothing.
  const barRef = React.useRef(null);
  React.useEffect(()=>{
    const el = barRef.current;
    if(!(prompt || msg) || !el) return;
    // scroll the actual overflow ancestor (.art-scroll) so the bar is visible even
    // when the trigger button sits far below it — scrollIntoView({block:nearest})
    // was unreliable inside that nested scroller. Then flash it so the answer to a
    // low click ("regenerate all?", "draft first") is impossible to miss.
    let sc = el.parentElement;
    while(sc && !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    if(sc){ const top = el.offsetTop - sc.offsetTop - 12;
      try{ sc.scrollTo({ top: Math.max(0, top), behavior:"smooth" }); }catch(e){ sc.scrollTop = Math.max(0, top); } }
    else if(el.scrollIntoView) el.scrollIntoView({ block:"center", behavior:"smooth" });
    el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
    // deps deliberately EXCLUDE the per-card progress message: it changes once per card,
    // so scrolling on it yanked the viewport back to the top for every sheet in the batch
  },[!!prompt, activeId ? "" : msg]);
  if(!activeId && !prompt && !msg && !preparing) return null;
  const N = noun || "card";
  return React.createElement("div",{className:"art-batchbar",ref:barRef},
    prompt && React.createElement("div",{className:"batch-choice"},
      React.createElement("span",{className:"batch-choice-q"},
        (prompt.missing.length>0 && !prompt.existing.length)
          ? ("Generate "+prompt.missing.length+" "+N+" sheet"+(prompt.missing.length!==1?"s":"")+"? Each one spends image credits.")
          : prompt.missing.length>0
          ? (prompt.existing.length+" of these "+N+"s already have a sheet. What would you like to do?")
          : ("All "+prompt.existing.length+" "+N+"s already have a sheet. Regenerate them?"),
        prompt.note ? " "+prompt.note : ""),
      prompt.missing.length>0 && React.createElement("button",{className:"art-draftall",
        onClick:()=>run(prompt.missing, prompt.existing.length),
        title:"Generate only the "+N+"s that don't have a sheet yet"},
        React.createElement(Icon.sparkles,{s:14}),"Generate "+prompt.missing.length+" missing",
        prompt.refsOf ? React.createElement(window.LikenessBatchCost,{ refs:prompt.missing.map(prompt.refsOf) })
          : (typeof window.nbCostChip==="function" && window.nbCostChip(prompt.missing.length))),
      prompt.existing.length>0 && React.createElement("button",{className:"art-draftall"+(prompt.missing.length?" ghost":""),
        onClick:()=>run([...prompt.missing, ...prompt.existing], 0),
        title:"Generate every "+N+", regenerating ones that already have a sheet"},
        React.createElement(Icon.sparkles,{s:14}),"Regenerate all "+(prompt.missing.length+prompt.existing.length),
        prompt.refsOf ? React.createElement(window.LikenessBatchCost,{ refs:[...prompt.missing, ...prompt.existing].map(prompt.refsOf) })
          : (typeof window.nbCostChip==="function" && window.nbCostChip(prompt.missing.length+prompt.existing.length))),
      React.createElement("button",{className:"art-draftall ghost",onClick:cancel},"Cancel")),
    // ACTIVELY GENERATING → the shared progress card (spinner + status + reassurance),
    // matching the shots re-design note; a bare info/error msg stays a plain line.
    (!activeId && preparing)
      ? React.createElement(ArtProgress,{
          title:"Checking which "+N+"s already have a sheet\u2026",
          detail:"Reading each card's current image so you can choose to fill only the gaps or regenerate everything.",
          onCancel: cancel })
      : activeId
      ? React.createElement(ArtProgress,{
          title: msg || ("Generating "+N+" sheets…"),
          detail: "Rendering coverage in order — each frame takes a moment; the sheets already finished stay even if you cancel.",
          onCancel: cancel })
      : (msg && React.createElement("span",{className:"prop-scenebar-msg"},msg)));
}
window.BatchBar = BatchBar;

/* SheetDetails — a modal exposing everything about a generated sheet: id, model,
   resolution, aspect, timestamp, grounding, the exact prompt sent, the reference
   images used, and the full version history (preview + restore any prior version). */
function SheetDetails({ gen, name, noun, onClose, onView, extraMeta }){
  const [data, setData] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [copiedKey, setCopiedKey] = React.useState(null);
  const [preview, setPreview] = React.useState(null);   // hero zoom overlay (full-screen)
  const [selVer, setSelVer] = React.useState(null);     // {url, meta} of a history version being inspected IN PLACE (null = current)
  const scrollRef = React.useRef(null);                 // dt-scroll container
  const promptRef = React.useRef(null);                 // the "Prompt sent to the model" section
  const reload = React.useCallback(async ()=>{ const d = await gen.loadDetails(); setData(d); },[gen]);
  React.useEffect(()=>{ reload(); setSelVer(null); },[reload, gen.genUrl]);

  const curMeta = (data && data.meta) || gen.genMeta || {};
  // when inspecting an earlier version, the whole form (hero, metadata, prompt) reflects IT
  const meta = selVer ? (selVer.meta || {}) : curMeta;
  const heroUrl = selVer ? selVer.url : gen.genUrl;
  const [measuredDims, setMeasuredDims] = React.useState(null);
  React.useEffect(()=>{
    if(meta.pixelW && meta.pixelH){ setMeasuredDims({ w:Number(meta.pixelW), h:Number(meta.pixelH) }); return; }
    let alive=true; setMeasuredDims(null);
    nbImageDimensions(heroUrl).then(d=>{ if(alive) setMeasuredDims(d); });
    return ()=>{ alive=false; };
  },[heroUrl, meta.pixelW, meta.pixelH]);
  const pixelW = Number(meta.pixelW) || (measuredDims && measuredDims.w);
  const pixelH = Number(meta.pixelH) || (measuredDims && measuredDims.h);
  const resolutionDetail = (()=>{
    const stored = String(meta.size||"").trim();
    if(stored.includes("×")) return stored;
    if(pixelW && pixelH){
      const measured = nbResLabel(pixelW,pixelH);
      const tier = stored && stored!=="—" ? stored : measured.split(" · ")[0];
      return tier+" · "+pixelW+"×"+pixelH;
    }
    return stored;
  })();
  const aspectDetail = meta.aspect || ((pixelW && pixelH) ? nbAspectLabel(pixelW,pixelH) : "");
  const modelDetail = meta.modelLabel
    || (typeof nbModelLabel==="function" ? nbModelLabel(meta.modelId) : ((window.NB_MODELS||[]).find(m=>m.id===meta.modelId)||{}).label)
    || meta.modelId;
  const generatedDetail = (()=>{
    let date=meta.date||"", time=meta.time||"";
    if((!date || !time) && meta.iso){
      const d=new Date(meta.iso);
      if(!Number.isNaN(d.getTime())){
        if(!date) date=d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
        if(!time) time=d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
      }
    }
    return [date,time].filter(Boolean).join(" · ");
  })();
  const writingSources = Array.isArray(meta.writingSources)
    ? meta.writingSources.filter(p=>p&&p.model) : [];
  const writingDate = (at)=>{
    if(!at) return "";
    const d=new Date(Number(at));
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
  };
  const refs = (data && data.refs) || [];
  const history = (data && data.history) || [];
  /* Reference-image resolution tied to the ANCHORED version (selected or current).
     For an EDIT, the reference IS the prior sheet — which exists in the version
     chain with a working URL — so we resolve it there instead of the (often
     broken / unsigned) stored ref blob. For an original/photo generation we fall
     back to the stored refs (current only; history entries don't carry refs). */
  const versions = [{ url: gen.genUrl, meta: curMeta,refs }].concat(
    history.map(h=>({ url: h.url, meta: h.meta||{},refs:h.refs||[] })));
  const anchorPos = selVer ? (selVer.idx + 1) : 0;
  const anchorMeta = (versions[anchorPos] || versions[0] || {}).meta || {};
  const annotateRefs=(list)=>{
    const wornRows=Array.isArray(anchorMeta.wornReferences)?anchorMeta.wornReferences:[];
    return (list||[]).map(r=>{ const worn=wornRows.find(w=>w&&w.refId&&w.refId===r.refId);
      return {url:r.url,label:r.label,refId:r.refId,recovered:r.recovered,
        refVersion:r.refVersion||(worn&&worn.version)||null,
        resolvedVersion:r.resolvedVersion||r.refVersion||(worn&&worn.version)||null}; });
  };
  let displayRefs = [];
  if(anchorMeta.mode === "edit"){
    const src = versions[anchorPos + 1];
    const anchored=annotateRefs((versions[anchorPos]&&versions[anchorPos].refs)||[]);
    const sourceRows=anchored.filter(r=>String(r.label||"").toLowerCase().includes("previous sheet"));
    const extras=anchored.filter(r=>!String(r.label||"").toLowerCase().includes("previous sheet"));
    if(sourceRows.length){
      displayRefs=sourceRows.map(r=> r.url ? r : {
        ...r,url:src&&src.url,refVersion:r.refVersion||(src&&src.meta&&src.meta.version)||null
      }).concat(extras);
    } else if(src && src.url){
      const sv = (src.meta && src.meta.version) || (versions.length - anchorPos - 1);
      displayRefs = [{ url:src.url,label:"Edited from sheet",refVersion:sv },...extras];
    } else {
      displayRefs=extras;
    }
  } else {
    const anchoredRefs=(versions[anchorPos]&&versions[anchorPos].refs)||[];
    displayRefs=annotateRefs(anchoredRefs);
  }
  /* PRIVACY DISCLOSURE — the anchored version may have been guided by personal
     images deliberately kept off the project (cloud mode). Details must say so
     instead of claiming "generated from the prompt alone". */
  const privNote = (typeof nbPrivateRefsNote==="function") ? nbPrivateRefsNote(anchorMeta) : "";
  /* clipboard copy with a fallback for sandboxed iframes where the async
     Clipboard API is blocked (same fix as CopyBox). key tracks which button copied. */
  const copyText = async (text, key)=>{
    let ok=false;
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text||""); ok=true; } }catch(e){ ok=false; }
    if(!ok){
      try{
        const ta=document.createElement("textarea"); ta.value=text||""; ta.setAttribute("readonly","");
        ta.style.cssText="position:fixed;top:0;left:0;opacity:0;pointer-events:none";
        document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0,(text||"").length);
        ok=document.execCommand("copy"); document.body.removeChild(ta);
      }catch(e){ ok=false; }
    }
    setCopiedKey(key); setTimeout(()=>setCopiedKey(null),1400);
  };
  const restore = async (i)=>{ setBusy(true); try{ await gen.revertTo(i); await reload(); }catch(e){} setBusy(false); };
  // asks first — a deleted version can't be brought back (2026-10-09)
  const delVersion = async (i)=>{
    if(typeof window.appConfirm==="function"){
      const ok = await window.appConfirm({ title:"Delete this earlier version?", body:"It's removed from the version history for good. The current image isn't touched.",
        confirmLabel:"Delete version", cancelLabel:"Cancel", danger:true });
      if(!ok) return;
    }
    setBusy(true); try{ await gen.deleteVersion(i); await reload(); }catch(e){} setBusy(false); };
  const deleteCurrent = async ()=>{
    if(!history.length || !gen.deleteCurrentAndPromote) return;
    const prev = history[0] && history[0].meta;
    const prevLabel = prev && prev.version ? ("v"+prev.version) : "the previous version";
    const ok = await window.appConfirm({
      title:"Delete current image?",
      body:"This deletes the current "+(noun||"image")+" and restores "+prevLabel+" as the current image. The deleted current image will not be kept in Earlier versions.",
      note:"Use Restore on an earlier version instead if you want to keep the current image in history.",
      confirmLabel:"Delete current", cancelLabel:"Cancel", danger:true,
    });
    if(!ok) return;
    setBusy(true);
    try{
      await gen.deleteCurrentAndPromote();
      setSelVer(null);
      await reload();
    }catch(e){}
    setBusy(false);
  };
  /* select a history version IN PLACE — clicking a row shows that version's image
     and ALL its properties (model, resolution, aspect, generated, version, image
     id, prompt, reference images). Click again on the banner's "Back to current". */
  const selectVersion = (h, i)=>{ setSelVer({ url:h.url, meta:h.meta||{}, idx:i, mode:"preview" }); };

  const field = (label,val)=> val ? React.createElement("div",{className:"dt-field"},
    React.createElement("div",{className:"dt-flab"},label),
    React.createElement("div",{className:"dt-fval"},val)) : null;
  const cam = meta && meta.advancedCamera;
  const camField = (label,x)=> x ? React.createElement("div",{className:"dt-camera-row",key:label},
    React.createElement("span",{className:"dt-camera-k"},label),
    React.createElement("span",{className:"dt-camera-v"},
      x.auto ? ("Auto -> "+(x.effectiveLabel||"Auto")) : (x.effectiveLabel||x.selectedLabel||"Custom"))) : null;
  const wornReferenceSection = Array.isArray(meta.wornReferences) && meta.wornReferences.length
    ? React.createElement("div",{className:"dt-section"},
        React.createElement("div",{className:"dt-sec-lab"},"Worn-reference contract"),
        React.createElement("div",{className:"dt-continuity-list"},
          meta.wornReferences.map((r,i)=>React.createElement("div",{
            key:r.refId||i,
            className:"dt-continuity-row",
          },
            React.createElement("span",{className:"dt-continuity-name"},r.name||"Worn prop"),
            React.createElement("span",{className:"dt-continuity-mode "+(r.mode||"text")},
              r.mode==="visual"
                ? ("Visual lock"+(r.version?(" · v"+r.version):""))
                : (r.excluded?"Text-only · excluded":"Text-only"))))))
    : null;
  const writingRows = writingSources.map((p,i)=>React.createElement("div",{
    key:[p.task,p.modelId,p.at,i].join("-"),className:"dt-continuity-row",
    title:[p.modelId,writingDate(p.at)].filter(Boolean).join(" · ")
  },
    React.createElement("span",{className:"dt-continuity-name"},p.task||"Specification"),
    React.createElement("span",{className:"dt-continuity-mode dt-writing-model"},p.model)));
  if(meta.promptCompiler) writingRows.push(React.createElement("div",{key:"prompt-compiler",className:"dt-continuity-row"},
    React.createElement("span",{className:"dt-continuity-name"},"Render prompt"),
    React.createElement("span",{className:"dt-continuity-mode dt-writing-model"},promptCompilerLabel(meta.promptCompiler))));
  const writingSection = writingRows.length
    ? React.createElement("div",{className:"dt-section"},
        React.createElement("div",{className:"dt-sec-lab"},"Writing & prompt provenance"),
        React.createElement("div",{className:"dt-continuity-list"},writingRows))
    : null;

  return React.createElement("div",{className:"lb-overlay dt-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"dt-panel"},
      React.createElement("div",{className:"dt-head"},
        React.createElement("div",null,
          React.createElement("div",{className:"dt-title"},name),
          React.createElement("div",{className:"dt-sub"},"Image details")),
        React.createElement("button",{className:"ag-x",onClick:onClose},React.createElement(Icon.x,{s:18}))),
      React.createElement("div",{className:"dt-scroll",ref:scrollRef},
        /* image preview — current OR the earlier version being inspected. If the
           file is gone from storage (dangling path → empty/failed URL), fall back
           to a placeholder instead of a broken image. */
        heroUrl && React.createElement("img",{className:"dt-hero",src:heroUrl,alt:name,
          onClick:()=>setPreview(heroUrl),
          onError:(e)=>{ e.target.style.display="none"; const ph=document.querySelector(".dt-scroll .dt-hero-missing"); if(ph) ph.style.display="flex"; }}),
        React.createElement("div",{className:"dt-hero-missing",style:{display:heroUrl?"none":"flex"}},
          React.createElement(Icon.image,{s:20}),
          React.createElement("span",null,selVer?"This version's image is no longer available in storage.":"Image unavailable.")),
        /* banner shown while inspecting an earlier version in place */
        selVer && React.createElement("div",{className:"dt-viewing"},
          React.createElement(Icon.history,{s:14}),
          React.createElement("span",{className:"dt-viewing-t"},"Viewing an earlier version"
            +(meta.version?(" \u00b7 v"+meta.version):"")+" \u2014 not the current image"),
          React.createElement("button",{className:"dt-viewing-back",onClick:()=>setSelVer(null)},"Back to current")),
        (!selVer && history.length>0) && React.createElement("div",{className:"dt-current-actions"},
          React.createElement("button",{className:"dt-current-delete",disabled:busy,onClick:deleteCurrent,
            title:"Delete the current image and restore the newest earlier version"},
            React.createElement(Icon.trash,{s:12}),"Delete current image \u2192 restore previous")),
        /* metadata grid */
        React.createElement("div",{className:"dt-grid"},
          field("Model", modelDetail),
          field("Render style", (typeof renderStyleLabelFromMeta==="function" ? renderStyleLabelFromMeta(meta) : "") || null),
          field("Resolution", resolutionDetail),
          field("Aspect ratio", aspectDetail),
          field("Quality", meta.quality ? String(meta.quality).replace(/^./,c=>c.toUpperCase()) : null),
          field("Generated", generatedDetail),
          field("Worn continuity", meta.wornRefSummary && meta.wornRefSummary.total
            ? (meta.wornRefSummary.visual+" visual lock"+(meta.wornRefSummary.visual===1?"":"s")
              +" · "+meta.wornRefSummary.text+" text-only") : null),
          ...((extraMeta||[]).filter(m=>m&&m.v).map((m,i)=>React.createElement("div",{key:"em"+i,className:"dt-field"},
            React.createElement("div",{className:"dt-flab"},m.k),
            React.createElement("div",{className:"dt-fval"},m.v)))),
          field("Version", meta.version ? ("v"+meta.version) : null),
          field("Approval", typeof window.nbAssetApproval==="function"&&window.nbAssetApproval(meta)
            ? "Approved for this version · current inputs may still need review" : null),
          // same model-aware gate as the card chip — GPT Image never grounds,
          // even on legacy meta stored before the fix
          field("Grounding", (meta.grounded && !(typeof isGptImageModel==="function" && isGptImageModel(meta.modelId))) ? (meta.groundImages?"Web search (web + images)":"Web search") : null),
          field("Prop references", meta.propRefs ? (meta.propRefs+" prop sheet"+(meta.propRefs>1?"s":"")) : null),
          // LIKENESS (2026-10-10, owner — Likeness review): whether the face came from the locked likeness
          field("Likeness", meta.cameo
            ? ((meta.mode==="cameo" ? "From the likeness" : meta.mode==="edit" ? "Edited from a likeness sheet" : "Face from the likeness")
              +(meta.likenessRefs ? (" \u00b7 "+meta.likenessRefs+" photo"+(meta.likenessRefs>1?"s":"")+", not saved with this image") : ""))
            : (meta.likenessSkipped ? "Not used \u2014 the likeness couldn't be used from this account; made from the text spec" : null)),
          field("Image ID", data && data.id)),
        cam && React.createElement("div",{className:"dt-section dt-camera-section"},
          React.createElement("div",{className:"dt-sec-lab"},"Advanced cinematography"),
          React.createElement("div",{className:"dt-camera-box"},
            camField("Camera profile", cam.camera),
            camField("Lens type", cam.lensType),
            camField("Focal length", cam.focalLength),
            camField("Aperture", cam.aperture),
            camField("Shutter", cam.shutter),
            camField("ISO / grain", cam.iso),
            cam.promptClause && React.createElement("div",{className:"dt-camera-note"},cam.promptClause))),
        writingSection,
        wornReferenceSection,
        /* prompt */
        meta.prompt && React.createElement("div",{className:"dt-section",ref:promptRef},
          React.createElement("div",{className:"dt-sec-head"},
            React.createElement("span",{className:"dt-sec-lab"},selVer?"Prompt sent to the model \u00b7 viewing earlier version":"Prompt sent to the model"),
            React.createElement("button",{className:"dt-copy",onClick:()=>copyText(meta.prompt||"","main")},
              React.createElement(Icon[copiedKey==="main"?"check":"copy"],{s:12}), copiedKey==="main"?"Copied":"Copy")),
          React.createElement("div",{className:"dt-prompt"},meta.prompt)),
        /* reference images used */
        (displayRefs.length>0 || selVer || privNote) && React.createElement("div",{className:"dt-section"},
          React.createElement("div",{className:"dt-sec-lab"},"Reference images used"+(displayRefs.length?(" ("+displayRefs.length+")"):"")),
          displayRefs.length>0
            ? React.createElement("div",{className:"dt-thumbs"},
                displayRefs.map((r,i)=>React.createElement("div",{key:i,className:"dt-thumb",onClick:()=>r.url&&setPreview(r.url)},
                  r.url ? React.createElement("img",{src:r.url,alt:r.label,
                    onError:(e)=>{ e.target.style.display="none"; const ph=e.target.parentNode.querySelector(".dt-thumb-ph"); if(ph) ph.style.display="grid"; }}) : null,
                  React.createElement("div",{className:"dt-thumb-ph",style:{display:r.url?"none":"grid"}},
                    React.createElement(Icon.image,{s:18})),
                  React.createElement("span",{className:"dt-thumb-lab"},(()=>{
                    // LIVE name: refs store the entity id, so a renamed prop/character/
                    // location shows its CURRENT name here, not the name at render time
                    if(r.refId){ const C=window.turnContinuity||{};
                      const hit=[...(C.props||[]),...(C.characters||[]),...(C.locations||[])].find(x=>x&&x.id===r.refId);
                      const versionLabel=r.recovered==="current-project-asset"&&r.refVersion&&r.resolvedVersion&&String(r.refVersion)!==String(r.resolvedVersion)
                        ? (" · used v"+r.refVersion+" · showing current v"+r.resolvedVersion)
                        : ((r.refVersion||r.resolvedVersion)?(" · v"+(r.refVersion||r.resolvedVersion)):"");
                      if(hit&&hit.name) return hit.name+(hit.kind?(" ("+hit.kind+")"):"")
                        +versionLabel
                        +(r.recovered==="current-project-asset"?" · current asset":""); }
                    const versionLabel=r.recovered==="current-project-asset"&&r.refVersion&&r.resolvedVersion&&String(r.refVersion)!==String(r.resolvedVersion)
                      ? (" · used v"+r.refVersion+" · showing current v"+r.resolvedVersion)
                      : ((r.refVersion||r.resolvedVersion)?(" · v"+(r.refVersion||r.resolvedVersion)):"");
                    return (window.likenessDisplayLabel||(x=>x))(r.label)+versionLabel
                      +(r.recovered==="current-project-asset"?" · current asset":""); })()))))
            : React.createElement("div",{className:"dt-noref"},
                privNote || "No reference images for this version \u2014 generated from the prompt alone."),
          (privNote && displayRefs.length>0)
            ? React.createElement("div",{className:"dt-noref"},privNote) : null),
        /* version history — each prior version is an edit "layer" you can preview or restore */
        history.length>0 && React.createElement("div",{className:"dt-section"},
          React.createElement("div",{className:"dt-sec-lab"},
            React.createElement(Icon.history,{s:12}),"Earlier versions ("+history.length+")"),
          React.createElement("div",{className:"dt-hist"},
            history.map((h,i)=>{
              const hm = h.meta||{};
              const isEdit = hm.mode==="edit";
              const styleLabel = (typeof renderStyleLabelFromMeta==="function") ? renderStyleLabelFromMeta(hm) : "";
              const layerLabel = isEdit
                ? ("Edit: "+(hm.editInstruction||"adjustment"))
                : (hm.mode==="photo" ? "From reference photo" : hm.mode==="cameo" ? "From the likeness" : styleLabel || "Original generation");
              const modelName = hm.modelId || hm.modelLabel || "unknown model";
              const active = selVer && selVer.idx===i;
              return React.createElement("div",{key:i,className:"dt-hist-item"+(active?" active":"")},
                React.createElement("div",{className:"dt-hist-row"},
                  /* the whole row (thumb + info) is the click target: select this
                     version to view its image + all its properties in place. */
                  React.createElement("button",{className:"dt-hist-main",type:"button",
                    onClick:()=>selectVersion(h,i),title:active?"Viewing this version":"View this version"},
                    React.createElement("div",{className:"dt-hist-thumb-wrap"},
                      h.url ? React.createElement("img",{className:"dt-hist-thumb",src:h.url,alt:"version",
                        onError:(e)=>{ e.target.style.display="none"; const ph=e.target.parentNode.querySelector(".dt-hist-thumb-ph"); if(ph) ph.style.display="grid"; }}) : null,
                      React.createElement("div",{className:"dt-hist-thumb-ph",style:{display:h.url?"none":"grid"},
                        title:"Image no longer in storage"},React.createElement(Icon.image,{s:16}))),
                    React.createElement("div",{className:"dt-hist-info"},
                      React.createElement("div",{className:"dt-hist-layer"+(isEdit?" edit":" base")},
                        React.createElement(Icon[isEdit?"wand":"image"]||Icon.sparkles,{s:12}),
                        React.createElement("span",{className:"dt-hist-layer-t"},layerLabel)),
                      React.createElement("div",{className:"dt-hist-meta"},
                        modelName,
                        (hm.date)?(" \u00b7 "+hm.date):"",
                        (hm.time)?(" "+hm.time):""))),
                  React.createElement("div",{className:"dt-hist-acts"},
                    React.createElement("button",{className:"dt-hist-btn restore",disabled:busy,onClick:()=>restore(i)},"Restore"),
                    React.createElement("button",{className:"dt-hist-btn del",disabled:busy,title:"Delete this version","aria-label":"Delete this earlier version",
                      onClick:()=>delVersion(i)},React.createElement(Icon.trash,{s:12})))));
            })))) ),
    preview && React.createElement("div",{className:"dt-preview",onMouseDown:(e)=>{ if(e.target===e.currentTarget) setPreview(null); }},
      React.createElement("img",{className:"dt-preview-img",src:preview,alt:"version preview"}),
      React.createElement("button",{className:"dt-preview-x",title:"Close preview",onClick:()=>setPreview(null)},React.createElement(Icon.x,{s:18}))));
}

/* SheetFrame — the visual half of any reference-sheet card: generated image (with
   options menu + inline AI edit), or the reference-photo drop slot, then the
   Generate button, error recovery, and the metadata caption. Driven by useImageGen. */
/* ---- per-card QA report — the QA Inspector's single-image verdict, opened from
   the card's "QA" button. Advisory: the report shows deviations, inventions and a
   recommendation, and only acts (edit / regenerate) when the user clicks. */
function _qaWhereChips(where){
  // "leftmost, second-left, middle-right" → one chip per panel — but only when
  // every segment stands alone; "panels 2, 3, 4" keeps one chip ("3" alone is noise)
  const parts = String(where||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(parts.length>1 && parts.every(p=>p.length>2 && !/^\d+$/.test(p))) return parts;
  return [parts.join(", ")].filter(Boolean);
}

/* Compact, read-only provenance strip used by Character and Prop master cards.
   A rendered sheet shows inputs recorded on that exact version; before the first
   render it previews only references currently ready to attach. */
/* one-line horizontal scroller for reference-thumb strips: arrows appear on
   pointer devices only when the row actually overflows; on touch screens the
   arrows are hidden (CSS) and the row swipes natively. */
function RefStripScroller({ className, children }){
  const rowRef = React.useRef(null);
  const [can, setCan] = React.useState({ l:false, r:false });
  const update = React.useCallback(()=>{
    const el = rowRef.current; if(!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const l = el.scrollLeft > 2, r = el.scrollLeft < max - 2;
    setCan(p => (p.l===l && p.r===r) ? p : { l, r });
  },[]);
  React.useEffect(()=>{
    const el = rowRef.current; if(!el) return;
    update();
    el.addEventListener("scroll", update, { passive:true });
    let ro = null;
    if(typeof ResizeObserver === "function"){ ro = new ResizeObserver(update); ro.observe(el); }
    window.addEventListener("resize", update);
    return ()=>{ el.removeEventListener("scroll", update); if(ro) ro.disconnect(); window.removeEventListener("resize", update); };
  },[update]);
  // thumbs mount/unmount (async ref loads) without resizing the container itself
  React.useEffect(()=>{ update(); });
  const nudge = (dir)=>{
    const el = rowRef.current; if(!el) return;
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.7, 120), behavior:"smooth" });
  };
  return React.createElement("div",{className:"refstrip"+(can.l?" can-left":"")+(can.r?" can-right":"")},
    React.createElement("button",{type:"button",className:"refstrip-arrow left","aria-label":"Scroll reference images left",
      onClick:()=>nudge(-1)},"\u2039"),
    React.createElement("div",{ref:rowRef,className:className},children),
    React.createElement("button",{type:"button",className:"refstrip-arrow right","aria-label":"Scroll reference images right",
      onClick:()=>nudge(1)},"\u203a"));
}
window.RefStripScroller = RefStripScroller;

function SheetReferenceStrip({ gen, loadRefs, onView, refreshKey }){
  const [refs, setRefs] = React.useState([]);
  const loadRef = React.useRef(loadRefs);
  loadRef.current = loadRefs;
  const refresh = React.useCallback(async ()=>{
    let next=[];
    try{
      if(gen && gen.genUrl && typeof gen.loadDetails==="function"){
        const d=await gen.loadDetails();
        next=((d&&d.refs)||[]).filter(r=>r&&r.url).map(r=>({
          url:r.url, note:r.label||r.note||"Reference image", refId:r.refId, kind:r.kind
        }));
      } else if(loadRef.current){
        next=((await loadRef.current())||[]).filter(r=>r&&r.url);
      }
    }catch(e){ next=[]; }
    setRefs(next);
  },[gen && gen.genUrl, refreshKey]);
  React.useEffect(()=>{
    let live=true;
    const run=()=>{ if(live) refresh(); };
    run();
    window.addEventListener("nb-gen-done",run);
    window.addEventListener("nb-prefetched",run);
    return ()=>{ live=false; window.removeEventListener("nb-gen-done",run); window.removeEventListener("nb-prefetched",run); };
  },[refresh]);
  if(!refs.length) return null;
  const kindClass=(r)=>{
    const k=String(r.kind||"").toLowerCase();
    if(k.includes("character")||k.includes("cameo")) return "character";
    if(k.includes("location")||k.includes("coverage")||k.includes("unit")) return "location";
    return "prop";
  };
  return React.createElement("div",{className:"coverage-refs sheet-used-refs"},
    React.createElement("div",{className:"shot-refs-lab"},
      React.createElement(Icon.layers,{s:12}),gen&&gen.genUrl?"Reference images used":"Reference images"),
    React.createElement(RefStripScroller,{className:"shot-refs-row coverage-refs-row"},
      refs.map((r,i)=>React.createElement("div",{key:(r.refId||r.url||i),role:"button",tabIndex:0,
          className:"shot-ref-thumb "+kindClass(r),title:r.note||r.label||"Reference image",
          onClick:()=>onView&&onView(r.url,{name:r.note||r.label||"Reference image"}),
          onKeyDown:(e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); onView&&onView(r.url,{name:r.note||r.label||"Reference image"}); } }},
        React.createElement("img",{src:r.url,alt:r.note||r.label||"Reference",loading:"lazy"}),
        React.createElement("span",{className:"shot-ref-tick on sheet-ref-used",title:"Used in this generated image"},"\u2713")))));
}
window.SheetReferenceStrip = SheetReferenceStrip;

/* build a targeted edit instruction from the QA findings when the model didn't
   supply one — so "edit the current image" is ALWAYS on offer, not only when the
   verdict itself recommends an edit. */
function _qaDerivedEditInstruction(r){
  const parts = [
    ...(Array.isArray(r.deviations)?r.deviations.map(d=>d&&d.what).filter(Boolean):[]),
    ...(Array.isArray(r.inventions)?r.inventions.map(x=>x?("remove: "+x):"").filter(Boolean):[]) ];
  if(!parts.length) return "";
  return "Targeted correction \u2014 change NOTHING else about the image (framing, faces, lighting and style stay exactly as they are): "
    + parts.slice(0,6).join("; ") + ".";
}
function QaReport({ name, noun, report, gening, onClose, onRunEdit, onRegen, specFields, onApplySpec, editCost, regenCost }){
  const r = report;
  const [applying, setApplying] = React.useState(false);
  // "Apply to spec": fold the prompt advice into the card's own drafted fields —
  // one writing-model call, previewed via confirm; regenerating stays manual.
  const applyAdvice = async ()=>{
    if(applying || !r.promptFix || typeof window.aiApplyQaAdvice!=="function" || !specFields || !onApplySpec) return;
    setApplying(true);
    let patch = null;
    try{ patch = await window.aiApplyQaAdvice(noun, specFields(), r.promptFix); }catch(e){}
    setApplying(false);
    if(!patch){ if(typeof window.appToast==="function") window.appToast("Nothing to change — the spec already covers the advice (or the writing model is unavailable).","info"); return; }
    const summary = Object.keys(patch).map(k=>{
      const text = (typeof clipWords==="function") ? clipWords(patch[k],90) : (patch[k].slice(0,90)+(patch[k].length>90?"…":""));
      return k.toUpperCase()+" → "+text;
    }).join("\n");
    let ok = true;
    if(typeof window.appConfirm==="function")
      ok = await window.appConfirm({ title:"Apply the advice and regenerate?",
        body:"These field(s) update, then the "+(noun||"sheet")+" REGENERATES immediately from the new spec (1 image generation) — so the sheet on the card always matches its spec. The current image stays in version history; restoring it later also restores its own prompt on the card.\n\n"+summary,
        confirmLabel:"Apply & regenerate", cancelLabel:"Cancel" });
    if(!ok) return;
    onApplySpec(patch);
    if(typeof window.appToast==="function") window.appToast("Spec updated — regenerating the "+(noun||"sheet")+" now; the previous version stays in history.","success");
    onClose();
  };
  const sev = r.verdict==="pass" ? "pass" : r.verdict==="major" ? "major" : "minor";
  const clean = r.deviations.length===0 && r.inventions.length===0;
  // "Edit current image" — a targeted one-generation edit of the EXISTING frame,
  // built from the findings (or the model's own instruction). Sits to the RIGHT of
  // "Apply to spec & regenerate" (user ruling 2026-07-21); on edit verdicts the
  // primary Run-suggested-edit in the footer carries it instead.
  const _editBtn = (r.action!=="edit" && !!(r.editInstruction || _qaDerivedEditInstruction(r)))
    ? React.createElement("button",{className:"ns-btn ghost qa-apply-btn",disabled:gening,
        title:"Make a TARGETED EDIT to the current image that fixes the findings above — one generation; this exact framing is kept and the current version stays in history. (Apply to spec & regenerate is the deeper fix when the drift is systemic.)",
        onClick:()=>{ onRunEdit(r.editInstruction || _qaDerivedEditInstruction(r)); onClose(); }},
        React.createElement(Icon.wand,{s:12}),"Edit current image", typeof window.nbCostChip==="function" && window.nbCostChip(1, editCost))
    : null;
  const finding = (d,i,invented)=> React.createElement("div",{key:i,className:"qa-item"},
    React.createElement("span",{className:"qa-dot "+(invented?"invent":(d.severity==="major"?"major":"minor")),
      title: invented?"Invented — not in the prompt":(d.severity==="major"?"Major deviation":"Minor deviation")}),
    React.createElement("div",{className:"qa-item-body"},
      (!invented && d.where && d.where!=="overall") && React.createElement("div",{className:"qa-chips"},
        _qaWhereChips(d.where).map((w,j)=>React.createElement("span",{key:j,className:"qa-where"},w))),
      React.createElement("div",{className:"qa-what"}, invented? d : d.what)));
  return React.createElement("div",{className:"ns-overlay",onMouseDown:e=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"qa-modal"},
      React.createElement("div",{className:"qa-head"},
        React.createElement("span",{className:"qa-orb "+sev}, React.createElement(Icon.eye,{s:16})),
        React.createElement("div",{className:"qa-head-txt"},
          React.createElement("div",{className:"qa-title"}, name||"Untitled"),
          React.createElement("div",{className:"qa-sub"}, (noun||"sheet")+(r.judgedSpec
            ? " · uploaded image — judged against the card's CURRENT spec (it has no generation prompt)"
            : " · judged against the exact prompt that generated it"))),
        React.createElement("span",{className:"qa-badge "+sev}, sev==="pass"?"Faithful":sev==="minor"?"Minor drift":"Major drift"),
        React.createElement("button",{className:"ag-x",onClick:onClose},React.createElement(Icon.x,{s:16}))),
      clean
        ? React.createElement("div",{className:"qa-clean"},
            React.createElement(Icon.check,{s:14}),"Faithful to its prompt — nothing to fix.")
        : React.createElement(React.Fragment,null,
            r.deviations.length>0 && React.createElement("div",{className:"qa-sec"},
              React.createElement("div",{className:"qa-sec-lab"},"Deviations from the prompt"),
              r.deviations.map((d,i)=>finding(d,i,false))),
            r.inventions.length>0 && React.createElement("div",{className:"qa-sec"},
              React.createElement("div",{className:"qa-sec-lab"},"Invented — not in the prompt"),
              r.inventions.map((x,i)=>finding(x,"inv"+i,true)))),
      // the verdict, spelled out — what to do with this image
      React.createElement("div",{className:"qa-rec "+r.action},
        React.createElement("span",{className:"qa-rec-lab"},"Recommendation"),
        React.createElement("span",{className:"qa-rec-verb"},
          r.action==="edit" ? "Edit — a targeted fix repairs it"
          : r.action==="regenerate" ? "Regenerate — the drift is systemic, an edit can't save it"
          : "Keep — minor nits at most")),
      (r.action==="edit" && r.editInstruction) && React.createElement("div",{className:"qa-sec"},
        React.createElement("div",{className:"qa-sec-lab"},"Suggested edit — for this card's Edit box (or Run it below)"),
        React.createElement("div",{className:"qa-quote edit"},r.editInstruction)),
      r.promptFix && React.createElement("div",{className:"qa-sec"},
        React.createElement("div",{className:"qa-sec-lab",
          title:"This amends the WRITTEN SPEC, not the image: Apply to spec folds it into the card's drafted fields for you, then Regenerate the sheet. It is not an Edit instruction — for a quick image fix, use Run suggested edit instead."},
          "Prompt advice — amends the card's spec (not an Edit instruction)"),
        React.createElement("div",{className:"qa-quote"},r.promptFix),
        React.createElement("div",{className:"qa-apply-row"},
          (specFields && onApplySpec) && React.createElement("button",{className:"ns-btn qa-apply-btn "+(r.action==="regenerate"?"primary":"ghost"),disabled:applying||gening,
            title:"Fold this advice into the card's drafted spec fields (one writing-model call, previewed first), then REGENERATE immediately so the sheet always matches its spec — the current image stays in version history",
            onClick:applyAdvice},
            applying ? React.createElement("span",{className:"ns-spin"}) : React.createElement(Icon.sparkles,{s:12}),
            applying ? "Folding into the spec…" : "Apply to spec & regenerate", !applying && typeof window.nbCostChip==="function" && window.nbCostChip(1, regenCost)),
          _editBtn)),
      React.createElement("div",{className:"qa-foot"},
        React.createElement("span",{className:"qa-foot-note"},"1 vision read · no image credits spent"),
        React.createElement("button",{className:"ns-btn ghost",onClick:onClose},"Close"),
        (r.action==="edit" && r.editInstruction) && React.createElement("button",{className:"ns-btn primary",disabled:gening,
          title:"Apply the suggested edit to this image now — one generation; the current version stays in history",
          onClick:()=>{ onRunEdit(r.editInstruction); onClose(); }},
          React.createElement(Icon.wand,{s:14}),"Run suggested edit", typeof window.nbCostChip==="function" && window.nbCostChip(1, editCost)),
        // ("Regenerate now" removed, user ruling 2026-07-21: it duplicated the card's
        // own Regenerate button and re-rolled the SAME spec the report just faulted —
        // the modal offers only the two INFORMED repairs: amend the spec, or edit.)
        (!r.promptFix) && _editBtn)));
}

/* ---- QA button — lives in the card controls and in the shot head row.
   Self-contained: busy state, the vision
   read, and the report modal. Hidden until the card has a generated image. */
function QaCheckButton({ gen, name, noun, className, specFields, onApplySpec, showWhenEmpty }){
  const [busy, setBusy] = React.useState(false);
  const [report, setReport] = React.useState(null);
  // Apply-to-spec REGENERATES immediately (user ruling 2026-07-18: the current sheet
  // must always match the spec). The regen fires from an EFFECT one render later, so
  // gen.generate() closes over the UPDATED entity — calling it synchronously would
  // rebuild the prompt from the stale pre-patch spec and regenerate the old look.
  const [pendingRegen, setPendingRegen] = React.useState(false);
  React.useEffect(()=>{
    if(!pendingRegen) return;
    setPendingRegen(false);
    gen.generate();
  },[pendingRegen]);
  if(!gen) return null;
  // no image yet: normally the button just isn't there (nothing to judge). Surfaces
  // whose grids MIX rendered and unrendered cards (the Lookbook) pass showWhenEmpty
  // so the control reads as locked-with-a-reason instead of randomly missing.
  if(!gen.genUrl){
    if(!showWhenEmpty) return null;
    return React.createElement("button",{className:(className||"char-draft-btn ghost")+" qa-empty",disabled:true,
      title:"QA check unlocks once this card has a generated image — it reads the "+(noun||"sheet")+" against the prompt that made it. Generate the "+(noun||"image")+" first."},
      React.createElement(Icon.eye,{s:12}),"QA check");
  }
  const run = async ()=>{
    if(busy || gen.gening) return;
    // the contract: the version's stored generation prompt — or, for UPLOADED /
    // imported images (no generation prompt), the card's CURRENT spec prompt
    let contract = (gen.genMeta && gen.genMeta.prompt) || "", judgedSpec = false;
    if(!contract && typeof gen.buildFinal==="function"){
      try{ contract = String(gen.buildFinal()||""); }catch(e){}
      judgedSpec = !!contract;
    }
    if(!contract){ if(window.appToast) window.appToast("Nothing to judge against yet — generate or design this card first, so it has a written spec."); return; }
    if(typeof window.aiImageQA!=="function"){
      if(window.appToast) window.appToast("QA check is unavailable in this build — reload the app and try again.","info");
      return;
    }
    setBusy(true);
    let rep = null;
    try{
      rep = await window.aiImageQA({ kind:noun||"sheet", name, url:gen.genUrl, prompt:contract });
    }catch(e){
      const msg = (window.turnSafeError||((x)=>x))((e&&e.message)||"The QA read failed.");
      if(window.appToast) window.appToast(msg||"The QA read failed — try again.","info");
      return;
    }finally{
      setBusy(false);
    }
    if(!rep){ if(window.appToast) window.appToast("The QA read failed — try again.","info"); return; }
    if(rep.unsupported){ if(window.appToast) window.appToast("The frame check isn't available right now \u2014 the writing engine couldn't look at the image. Try again later; nothing was charged for an image.","info"); return; }
    setReport({ ...rep, judgedSpec });
  };
  return React.createElement(React.Fragment,null,
    React.createElement("button",{className:(className||"char-draft-btn ghost")+(busy?" busy":""),disabled:busy||gen.gening,
      title:"QA check — re-reads this "+(noun||"sheet")+" against the exact prompt that generated it: deviations, invented content, per-panel faults, and whether to edit or regenerate. One vision read (writing-model credits, no image spend).",
      onClick:run},
      busy ? React.createElement("span",{className:"ns-spin"}) : React.createElement(Icon.eye,{s:12}),
      busy ? "QA…" : "QA check"),
    report && ReactDOM.createPortal(React.createElement(QaReport,{ name, noun, report, gening:gen.gening,
      specFields,
      onApplySpec: onApplySpec ? (patch)=>{ onApplySpec(patch); setPendingRegen(true); } : undefined,
      onClose:()=>setReport(null),
      // a likeness sheet's renders send its photos: these prices count every image (2026-10-10, owner — Likeness review)
      editCost: gen.likenessEditRefs ? { refs: 1 + gen.likenessEditRefs + ((gen.refCounts && gen.refCounts().attach) || 0) } : undefined,
      regenCost: (gen.likenessRefs && gen.refCounts) ? { refs: gen.refCounts().generate } : undefined,
      onRunEdit:(instr)=>gen.generate({ editInstruction:instr }),
      onRegen:()=>gen.generate() }), document.body));
}
window.QaCheckButton = QaCheckButton;

function RegionEditModal({ url, name, noun, entity, editPropRefs, onClose, onApply, costOptsFor }){
  const [rect, setRect] = React.useState({ x:24, y:24, w:44, h:36 });
  const [drag, setDrag] = React.useState(null);
  const [text, setText] = React.useState("");
  const [refs, setRefs] = React.useState([]);
  const [referenceOptions, setReferenceOptions] = React.useState([]);
  const imgRef = React.useRef(null);
  const boxRef = React.useRef(null);
  const fileRef = React.useRef(null);
  const sideRef = React.useRef(null);
  const sideDragRef = React.useRef(null);
  const [sidePos, setSidePos] = React.useState(null);

  React.useEffect(()=>{
    let alive = true;
    (async ()=>{
      const C = window.turnContinuity || {};
      const byId = {};
      const add = (item, kind, attached)=>{
        if(!item || !item.id || item.id===(entity&&entity.id)) return;
        byId[item.id] = {
          id:item.id,
          name:item.name || (kind==="character"?"Character":kind==="location"?"Location":"Prop"),
          kind,
          attached:!!attached || !!(byId[item.id]&&byId[item.id].attached)
        };
      };
      // Durable references attached to this prop come first. This is how a photo,
      // ID card or poster can inherit a cast member's exact likeness.
      (entity&&Array.isArray(entity.referenceImages)?entity.referenceImages:[]).forEach(r=>{
        if(!r || !r.sourceEntityId) return;
        const all = [...(C.characters||[]),...(C.props||[]),...(C.locations||[])];
        const item = all.find(x=>x&&(x.id||x.key)===r.sourceEntityId);
        if(item) add({...item,id:item.id||item.key},r.sourceKind||"reference",true);
      });
      (C.characters||[]).forEach(c=>add(c,"character",false));
      (editPropRefs||[]).forEach(p=>add(p,"prop",false));
      (C.props||[]).forEach(p=>add(p,"prop",false));
      (C.locations||[]).forEach(l=>add({...l,id:l.id||l.key},"location",false));
      const out = [];
      for(const p of Object.values(byId)){
        let u = "";
        try{ u = (typeof nbGetImage==="function") ? nbGetImage(p.id) : ""; }catch(e){}
        if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(p.id); }catch(e){} }
        if(u) out.push({ ...p, url:u,
          note:p.kind==="character"
            ? p.name+" character sheet \u2014 preserve this person's facial likeness"
            : p.name+" "+p.kind+" sheet" });
      }
      if(alive) setReferenceOptions(out.sort((a,b)=>Number(b.attached)-Number(a.attached)));
    })();
    return ()=>{ alive=false; };
  },[editPropRefs,entity&&entity.id,entity&&Array.isArray(entity.referenceImages)?entity.referenceImages.map(r=>r.sourceEntityId||r.id).join(","):""]);

  const clamp = (n,min,max)=> Math.max(min, Math.min(max, n));
  const beginSideDrag = (e)=>{
    if(e.button != null && e.button !== 0) return;
    const r = sideRef.current && sideRef.current.getBoundingClientRect();
    if(!r) return;
    e.preventDefault();
    e.stopPropagation();
    sideDragRef.current = { dx:e.clientX-r.left, dy:e.clientY-r.top };
    setSidePos({ left:r.left, top:r.top });
  };
  React.useEffect(()=>{
    const move = (e)=>{
      const d = sideDragRef.current;
      if(!d) return;
      e.preventDefault();
      const el = sideRef.current;
      const w = el ? el.offsetWidth : 330;
      const h = el ? Math.min(el.offsetHeight, window.innerHeight-16) : 360;
      setSidePos({
        left: clamp(e.clientX-d.dx, 8, Math.max(8, window.innerWidth-w-8)),
        top: clamp(e.clientY-d.dy, 8, Math.max(8, window.innerHeight-h-8))
      });
    };
    const end = ()=>{ sideDragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return ()=>{
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  },[]);
  const point = (e)=>{
    const r = boxRef.current && boxRef.current.getBoundingClientRect();
    if(!r) return null;
    return {
      x: clamp(((e.clientX-r.left)/r.width)*100, 0, 100),
      y: clamp(((e.clientY-r.top)/r.height)*100, 0, 100)
    };
  };
  const start = (e)=>{ e.preventDefault(); const p=point(e); if(!p) return; setDrag(p); setRect({ x:p.x, y:p.y, w:0, h:0 }); };
  React.useEffect(()=>{
    if(!drag) return;
    const move = (e)=>{ e.preventDefault(); const p=point(e); if(!p) return;
      const x=Math.min(drag.x,p.x), y=Math.min(drag.y,p.y);
      setRect({ x, y, w:Math.abs(p.x-drag.x), h:Math.abs(p.y-drag.y) }); };
    const end = ()=>{ setDrag(null); setRect(r=> r.w<3||r.h<3 ? { x:24, y:24, w:44, h:36 } : r); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return ()=>{ window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  },[drag]);

  const addRef = (r)=> setRefs(rs=> rs.some(x=>x.url===r.url) ? rs : rs.concat([r]));
  const addFiles = (files)=>{ [...(files||[])].forEach(f=>{
    if(!/^image\//.test(f.type||"")) return;
    const rd = new FileReader();
    rd.onload = ()=>{
      const raw = String(rd.result||"");
      const push = (u)=> addRef({ url:u||raw, note:f.name||"uploaded reference" });
      if(typeof turnDownscaleDataUrl==="function") turnDownscaleDataUrl(raw, 1280).then(push).catch(()=>push(raw));
      else push(raw);
    };
    rd.readAsDataURL(f);
  }); };
  const pct = (n)=> String(Math.round(n));
  const apply = ()=>{
    if(!text.trim()) return;
    const r = { x:Math.round(rect.x), y:Math.round(rect.y), w:Math.round(rect.w), h:Math.round(rect.h),
      x2:Math.round(rect.x+rect.w), y2:Math.round(rect.y+rect.h) };
    const refLine = refs.length
      ? " Match the attached reference image"+(refs.length>1?"s":"")+" for design, material, silhouette and colour where relevant."
      : "";
    onApply && onApply({
      instruction: "LOCALIZED REGION EDIT. Apply the requested change ONLY inside the selected rectangle: "
        +"left "+r.x+"%, top "+r.y+"%, width "+r.w+"%, height "+r.h+"% (right "+r.x2+"%, bottom "+r.y2+"%). "
        +"Requested change: "+text.trim()+". "+refLine
        +" Preserve everything outside that rectangle exactly: framing, identity, lighting, background, panel layout and all other objects must remain unchanged. Blend the edited area naturally into the existing image.",
      refs
    });
    onClose && onClose();
  };

  const portalTarget = (typeof document!=="undefined" && (document.body || document.documentElement)) || null;
  const sideStyle = sidePos ? { left:sidePos.left, top:sidePos.top, right:"auto", bottom:"auto" } : null;
  const modal = React.createElement("div",{className:"region-edit-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"region-edit-panel"},
      React.createElement("div",{className:"region-edit-head"},
        React.createElement("div",null,
          React.createElement("div",{className:"region-edit-title"},"Select area & edit"),
          React.createElement("div",{className:"region-edit-sub"},name||noun||"Image")),
        React.createElement("button",{className:"ag-x",onClick:onClose},React.createElement(Icon.x,{s:18}))),
      React.createElement("div",{className:"region-edit-body"},
        React.createElement("div",{className:"region-edit-canvas"},
          React.createElement("div",{className:"region-edit-imagebox",ref:boxRef,onPointerDown:start},
            React.createElement("img",{ref:imgRef,src:url,alt:name||"selected image",draggable:false}),
            React.createElement("div",{className:"region-edit-rect",style:{
              left:pct(rect.x)+"%", top:pct(rect.y)+"%", width:pct(rect.w)+"%", height:pct(rect.h)+"%" }})),
          React.createElement("div",{className:"region-edit-hint"},"Drag on the image to choose the edit area")),
        React.createElement("div",{className:"region-edit-side",ref:sideRef,style:sideStyle},
          React.createElement("div",{className:"region-edit-dragbar",onPointerDown:beginSideDrag,title:"Move prompt card"},
            React.createElement(Icon.grip,{s:14}),
            React.createElement("span",null,"Prompt")),
          React.createElement("label",{className:"region-edit-field region-edit-prompt-field"},
            React.createElement("textarea",{value:text,onChange:e=>setText(e.target.value),
              placeholder:"Describe exactly what changes inside the selected area..." })),
          React.createElement("div",{className:"region-edit-coords"},
            "Region: left "+pct(rect.x)+"%, top "+pct(rect.y)+"%, width "+pct(rect.w)+"%, height "+pct(rect.h)+"%"),
          React.createElement("div",{className:"region-edit-refs-head"},"Reference image"),
          React.createElement("div",{className:"region-edit-ref-actions"},
            React.createElement("button",{className:"sheet-tools-item region-action",onClick:()=>fileRef.current&&fileRef.current.click()},
              React.createElement(Icon.image,{s:14}),"Upload reference"),
            React.createElement("input",{ref:fileRef,type:"file",accept:"image/*",multiple:true,style:{display:"none"},
              onChange:e=>{ addFiles(e.target.files); e.target.value=""; }})),
          referenceOptions.length>0 && React.createElement("div",{className:"region-props"},
            referenceOptions.slice(0,18).map(p=>React.createElement("button",{key:p.id,className:"region-prop"+(refs.some(r=>r.id===p.id)?" on":""),
              title:"Attach "+p.name+" as an edit reference",onClick:()=>addRef(p)},
              React.createElement("img",{src:p.url,alt:p.name}),
              React.createElement("span",null,p.name),
              React.createElement("em",null,p.attached?"Attached":p.kind)))),
          refs.length>0 && React.createElement("div",{className:"sheet-edit-refs region-ref-list"},
            refs.map((r,i)=>React.createElement("span",{key:i,className:"sheet-edit-refthumb",title:r.note||"Reference image"},
              React.createElement("img",{src:r.url,alt:r.note||"Reference"}),
              React.createElement("button",{className:"sheet-edit-refx",title:"Remove",
                onClick:()=>setRefs(rs=>rs.filter((_,j)=>j!==i))},"\u00d7")))),
          React.createElement("div",{className:"region-edit-note"},
            "Soft-mask edit: the selected coordinates and references are sent to the model; the current image stays as the anchor."),
          React.createElement("div",{className:"region-edit-acts"},
            React.createElement("button",{className:"sheet-edit-cancel",onClick:onClose},"Cancel"),
            React.createElement("button",{className:"sheet-edit-apply",disabled:!text.trim(),onClick:apply},
              React.createElement(Icon.wand,{s:12}),"Apply region edit",
              // a likeness sheet's edit re-attaches the face: the price counts every image it sends (2026-10-10)
              typeof window.nbCostChip==="function" && window.nbCostChip(1, costOptsFor ? costOptsFor(refs.filter(x=>x && x.url).length) : undefined)))))),
    );
  return portalTarget ? ReactDOM.createPortal(modal, portalTarget) : modal;
}

function cropRegionAsDataUrl(url, rect, maxDim){
  maxDim = maxDim || 1024;
  return new Promise(resolve=>{
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = ()=>{
      try{
        const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
        const sx = Math.max(0, Math.round((rect.x/100)*nw));
        const sy = Math.max(0, Math.round((rect.y/100)*nh));
        const sw = Math.max(1, Math.min(nw-sx, Math.round((rect.w/100)*nw)));
        const sh = Math.max(1, Math.min(nh-sy, Math.round((rect.h/100)*nh)));
        const sc = Math.min(1, maxDim/Math.max(sw, sh));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(sw*sc));
        c.height = Math.max(1, Math.round(sh*sc));
        const ctx = c.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", .88));
      }catch(e){ resolve(""); }
    };
    img.onerror = ()=>resolve("");
    img.src = url;
  });
}

function PropReferenceModal({ url, name, noun, entity, onClose }){
  const propList = ((window.turnContinuity||{}).props||[]).filter(p=>p&&p.id);
  const [rect, setRect] = React.useState({ x:24, y:24, w:28, h:32 });
  const [drag, setDrag] = React.useState(null);
  const [targetId, setTargetId] = React.useState(()=> (propList[0]&&propList[0].id)||"__new");
  const [newName, setNewName] = React.useState("");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const boxRef = React.useRef(null);
  React.useEffect(()=>{
    if(targetId || !propList.length) return;
    setTargetId(propList[0].id);
  },[propList.length, targetId]);
  const clamp = (n,min,max)=> Math.max(min, Math.min(max, n));
  const point = (e)=>{
    const r = boxRef.current && boxRef.current.getBoundingClientRect();
    if(!r) return null;
    return {
      x: clamp(((e.clientX-r.left)/r.width)*100, 0, 100),
      y: clamp(((e.clientY-r.top)/r.height)*100, 0, 100)
    };
  };
  const start = (e)=>{ e.preventDefault(); const p=point(e); if(!p) return; setDrag(p); setRect({ x:p.x, y:p.y, w:0, h:0 }); };
  React.useEffect(()=>{
    if(!drag) return;
    const move = (e)=>{ e.preventDefault(); const p=point(e); if(!p) return;
      setRect({ x:Math.min(drag.x,p.x), y:Math.min(drag.y,p.y), w:Math.abs(p.x-drag.x), h:Math.abs(p.y-drag.y) }); };
    const end = ()=>{ setDrag(null); setRect(r=> r.w<3||r.h<3 ? { x:24, y:24, w:28, h:32 } : r); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return ()=>{ window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  },[drag]);
  const pct = (n)=> String(Math.round(n));
  const target = propList.find(p=>p.id===targetId);
  const attach = async ()=>{
    if((!targetId || (targetId==="__new" && !newName.trim())) || saving) return;
    setSaving(true);
    const cropped = await cropRegionAsDataUrl(url, rect, 1024);
    const ref = {
      id:"pref-"+Date.now().toString(36),
      url:cropped || url,
      sourceUrl:url,
      sourceEntityId:entity&&entity.id,
      sourceName:name||((entity&&entity.name)||noun)||"Art Room sheet",
      sourceKind:noun||"sheet",
      note:note.trim() || ("Selected item from "+(name||noun||"Art Room sheet")),
      cropped:!!cropped,
      region:{ x:Math.round(rect.x), y:Math.round(rect.y), w:Math.round(rect.w), h:Math.round(rect.h) }
    };
    let ok = false, label = (target&&target.name)||"prop";
    if(targetId==="__new"){
      const card = typeof window.turnCreatePropFromReference==="function"
        ? window.turnCreatePropFromReference(ref, { name:newName.trim() }) : null;
      ok = !!card; label = (card&&card.name)||newName.trim();
    } else {
      ok = typeof window.turnAttachPropReference==="function" && window.turnAttachPropReference(targetId, ref);
    }
    setSaving(false);
    if(ok && typeof window.appToast==="function") window.appToast((targetId==="__new"?"Created ":"Attached selected item to ")+label+" as a consistency reference.","success");
    if(ok) onClose && onClose();
  };
  const portalTarget = typeof document!=="undefined" && (document.body || document.documentElement);
  const modal = React.createElement("div",{className:"region-edit-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"region-edit-panel"},
      React.createElement("div",{className:"region-edit-head"},
        React.createElement("div",null,
          React.createElement("div",{className:"region-edit-title"},"Attach item to prop"),
          React.createElement("div",{className:"region-edit-sub"},name||noun||"Image")),
        React.createElement("button",{className:"ag-x",onClick:onClose},React.createElement(Icon.x,{s:18}))),
      React.createElement("div",{className:"region-edit-body"},
        React.createElement("div",{className:"region-edit-canvas"},
          React.createElement("div",{className:"region-edit-imagebox",ref:boxRef,onPointerDown:start},
            React.createElement("img",{src:url,alt:name||"selected image",draggable:false}),
            React.createElement("div",{className:"region-edit-rect",style:{
              left:pct(rect.x)+"%", top:pct(rect.y)+"%", width:pct(rect.w)+"%", height:pct(rect.h)+"%" }})),
          React.createElement("div",{className:"region-edit-hint"},"Drag around the item you want the prop to inherit")),
        React.createElement("div",{className:"region-edit-side"},
          React.createElement("label",{className:"region-edit-field"},
            React.createElement("span",null,"Target prop"),
            React.createElement("select",{className:"prop-select region-prop-select",value:targetId,onChange:e=>setTargetId(e.target.value)},
              React.createElement("option",{value:"__new"},"+ Create new prop from selection"),
              propList.map(p=>React.createElement("option",{key:p.id,value:p.id},(p.name||"Unnamed prop")+(p.ownerName?(" \u00b7 "+p.ownerName):""))))),
          targetId==="__new" && React.createElement("label",{className:"region-edit-field"},
            React.createElement("span",null,"New prop name"),
            React.createElement("input",{className:"prop-select region-text-input",value:newName,onChange:e=>setNewName(e.target.value),
              placeholder:"e.g. phone on counter, worn locket, framed photograph..." })),
          React.createElement("label",{className:"region-edit-field"},
            React.createElement("span",null,"Reference note"),
            React.createElement("textarea",{value:note,onChange:e=>setNote(e.target.value),
              placeholder:"What should this prop borrow from the selected item? e.g. patina, material, scale, handmade construction..." })),
          React.createElement("div",{className:"region-edit-coords"},
            "Region: left "+pct(rect.x)+"%, top "+pct(rect.y)+"%, width "+pct(rect.w)+"%, height "+pct(rect.h)+"%"),
          React.createElement("div",{className:"region-edit-note"},
            "The selected crop is saved on the target prop and rides as a reference on future prop generations/edits, helping the prop belong to this character or location world."),
          React.createElement("div",{className:"region-edit-acts"},
            React.createElement("button",{className:"sheet-edit-cancel",onClick:onClose},"Cancel"),
            React.createElement("button",{className:"sheet-edit-apply",disabled:!targetId||(targetId==="__new"&&!newName.trim())||saving,onClick:attach},
              React.createElement(Icon.target,{s:12}), saving?"Attaching\u2026":(targetId==="__new"?"Create prop":"Attach to prop"))))),
    ));
  return portalTarget ? ReactDOM.createPortal(modal, portalTarget) : modal;
}

function PropSheetReferenceModal({ prop, onClose }){
  const graph = window.turnContinuity || {};
  const currentPropId = prop && prop.id;
  const attachedRefs = Array.isArray(prop && prop.referenceImages) ? prop.referenceImages.filter(Boolean) : [];
  const candidates = [
    ...((graph.characters||[]).filter(Boolean).map(c=>({ id:c.id, name:c.name||"Unnamed character", kind:"character",
      note:(c.name||"Character")+" character sheet — use this character's facial likeness when the prop depicts them; do not copy unrelated wardrobe or background" }))),
    ...((graph.props||[]).filter(p=>p&&p.id&&p.id!==currentPropId).map(p=>({ id:p.id, name:p.name||"Unnamed prop", kind:"prop", note:(p.name||"Prop")+" prop sheet" }))),
    ...((graph.locations||[]).filter(Boolean).map(l=>({ id:l.id||l.key, name:l.name||"Unnamed location", kind:"location", note:(l.name||"Location")+" location plate" })))
  ].filter(x=>x&&x.id);
  const [rows, setRows] = React.useState([]);
  const [selected, setSelected] = React.useState("");
  const [note, setNote] = React.useState("");
  React.useEffect(()=>{
    let alive = true;
    (async ()=>{
      const out = [];
      for(const c of candidates){
        let url = "";
        try{ url = (typeof nbGetImage==="function") ? nbGetImage(c.id) : ""; }catch(e){}
        if(!url && typeof nbLoadImage==="function"){ try{ url = await nbLoadImage(c.id); }catch(e){} }
        if(url) out.push({ ...c, url });
      }
      if(alive){
        setRows(out);
        setSelected(s=> s || (out[0] && out[0].id) || "");
      }
    })();
    return ()=>{ alive = false; };
  },[currentPropId, candidates.length]);
  const picked = rows.find(r=>r.id===selected);
  const pickedAttachment = picked && attachedRefs.find(ref=>ref && (
    ref.sourceEntityId===picked.id || ref.url===picked.url || ref.sourceUrl===picked.url
  ));
  const attach = ()=>{
    if(!picked || !prop || !prop.id) return;
    const ref = {
      id:"pref-"+Date.now().toString(36),
      url:picked.url,
      sourceUrl:picked.url,
      sourceEntityId:picked.id,
      sourceName:picked.name,
      sourceKind:picked.kind,
      note:note.trim() || picked.note,
      cropped:false
    };
    const ok = typeof window.turnAttachPropReference==="function" && window.turnAttachPropReference(prop.id, ref);
    if(ok && typeof window.appToast==="function") window.appToast("Attached "+picked.name+" to "+(prop.name||"this prop")+" as a consistency reference.","success");
    if(ok) onClose && onClose();
  };
  const detach = ()=>{
    if(!pickedAttachment || !prop || !prop.id) return;
    const refKey = pickedAttachment.id || pickedAttachment.sourceEntityId || pickedAttachment.url;
    const ok = typeof window.turnRemovePropReference==="function" && window.turnRemovePropReference(prop.id, refKey);
    if(ok && typeof window.appToast==="function") window.appToast("Detached "+picked.name+" from "+(prop.name||"this prop")+".","success");
    if(ok) onClose && onClose();
  };
  return ReactDOM.createPortal(React.createElement("div",{className:"region-edit-overlay",onMouseDown:e=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"region-edit-panel prop-sheet-ref-panel"},
      React.createElement("div",{className:"region-edit-head"},
        React.createElement("div",null,
          React.createElement("div",{className:"region-edit-title"},"Attach reference to prop"),
          React.createElement("div",{className:"region-edit-sub"},prop && prop.name ? prop.name : "Prop")),
        React.createElement("button",{className:"ag-x",onClick:onClose},React.createElement(Icon.x,{s:18}))),
      React.createElement("div",{className:"region-edit-body"},
        React.createElement("div",{className:"region-edit-canvas prop-ref-list-canvas"},
          rows.length
            ? React.createElement("div",{className:"prop-ref-picker"},
                rows.map(r=>React.createElement("button",{key:r.kind+":"+r.id,
                  className:"prop-ref-pick"+(selected===r.id?" on":"")+(attachedRefs.some(ref=>ref&&(ref.sourceEntityId===r.id||ref.url===r.url||ref.sourceUrl===r.url))?" attached":""),
                  onClick:()=>{ setSelected(r.id); setNote(r.note); }},
                  React.createElement("img",{src:r.url,alt:r.name}),
                  React.createElement("span",null,
                    React.createElement("b",null,r.name),
                    React.createElement("em",null,r.kind+(attachedRefs.some(ref=>ref&&(ref.sourceEntityId===r.id||ref.url===r.url||ref.sourceUrl===r.url))?" \u00b7 attached":""))))))
            : React.createElement("div",{className:"region-edit-empty"},
                React.createElement(Icon.image,{s:28}),
                React.createElement("p",null,"No generated character, prop or location sheets found yet."))),
        React.createElement("div",{className:"region-edit-side"},
          React.createElement("label",{className:"region-edit-field"},
            React.createElement("span",null,"Reference note"),
            React.createElement("textarea",{value:note,onChange:e=>setNote(e.target.value),
              placeholder:"What should this prop inherit? e.g. likeness, owner taste, material patina, set-dressing world..." })),
          picked && React.createElement("div",{className:"region-edit-coords"},
            "Source: "+picked.kind+" sheet · "+picked.name),
          React.createElement("div",{className:"region-edit-note"},
            "Use this for whole-sheet influence: a character likeness for a photo prop, an owner's taste and wear patterns, a location's materials, or another prop's construction language."),
          React.createElement("div",{className:"region-edit-acts"},
            React.createElement("button",{className:"sheet-edit-cancel",onClick:onClose},"Cancel"),
            React.createElement("button",{className:"sheet-edit-apply"+(pickedAttachment?" danger":""),disabled:!picked,onClick:pickedAttachment?detach:attach},
              pickedAttachment?React.createElement(Icon.x,{s:12}):React.createElement(Icon.layers,{s:12}),
              pickedAttachment?"Detach reference":"Attach reference"))))),
    ), document.body);
}

/* (the sheet-review helpers and their context were never used — removed 2026-10-06) */
function SheetFrame({ gen, slotId, name, avatarColor, initials, drafted, drafting, onDraft, entity, onView, slotPlaceholder, noun, onDelete, deleteLabel, specGate, extraMeta, menuExtra, dropToImport, hideUploadButton, onStop, generateDisabled, generateDisabledLabel, generateDisabledTitle, generateTitle, onResolveGenerationBlock, referenceControls, editPropRefs, editSuggestions, generateRefs, attachRefs }){
  const { genUrl, genMeta, genTier, gening, genErr, retrying, slotHasRef,
    editMode, setEditMode, editText, setEditText, generate, cancelGen, clearGen, importSheet, relatedClearCount, relatedClearIdsOf, relatedClearLabel, revertPrevious, layers, allModels } = gen;
  // Resolution ALWAYS shows on the caption. Prefer the stored size; if it's missing
  // (legacy meta, or any path that didn't record it) measure the actual image's pixels
  // so a real resolution still appears — for generations AND uploads alike.
  const [measRes, setMeasRes] = React.useState("");
  React.useEffect(()=>{
    if(!genUrl || (genMeta && genMeta.size)){ setMeasRes(""); return; }
    let alive=true; const im=new Image();
    im.onload=()=>{ if(alive && im.naturalWidth) setMeasRes(nbResLabel(im.naturalWidth, im.naturalHeight)); };
    im.onerror=()=>{ if(alive) setMeasRes(""); };
    im.src=genUrl;
    return ()=>{ alive=false; };
  },[genUrl, genMeta && genMeta.size]);
  const resLabel = (genMeta && genMeta.size) || measRes || "—";
  // EDIT ATTACHMENTS — image inputs the user pins to the NEXT "Apply edit": uploaded
  // photos/designs and/or this entity's prop sheets (incl. CARRIED props). They ride
  // as editRefImages on the edit generation; cleared on apply, cancel or close.
  const [editRefs, setEditRefs] = React.useState([]);   // [{url, note}]
  const [editDependencyIds, setEditDependencyIds] = React.useState([]);
  /* an edit / remaster of a LIKENESS sheet re-attaches the front angle (decision E), and GPT Image charges every
     image it's sent — so that price counts them all: the sheet, the face, the worn items, the attached inputs */
  const editCostOpts = (extra)=> (gen.likenessEditRefs>0)
    ? { refs: 1 + gen.likenessEditRefs + (Number(attachRefs)||0) + (Number(extra)||0) } : undefined;
  const [editAddOpen, setEditAddOpen] = React.useState(false);   // the "+" input-source menu
  const [editAddPos, setEditAddPos] = React.useState(null);      // anchor: above the Describe-changes input, centered on it
  const editFileRef = React.useRef(null);
  const editAddRef = React.useRef(null);
  const addEditFiles = (files)=>{ [...(files||[])].forEach(f=>{
    if(!/^image\//.test(f.type||"")) return;
    const rd = new FileReader();
    rd.onload = ()=>{ const raw = String(rd.result||"");
      const push = (u)=>setEditRefs(rs=>[...rs, { url:u, note:f.name||"image" }]);
      if(typeof turnDownscaleDataUrl==="function"){ turnDownscaleDataUrl(raw, 1280).then(u=>push(u||raw)).catch(()=>push(raw)); }
      else push(raw); };
    rd.readAsDataURL(f);
  }); };
  // bridge for the fullscreen viewer: lets the filmstrip's "Remaster this version"
  // reuse THIS card's generation pipeline (refs, meta, history) for the open entity
  React.useEffect(()=>{
    const bid = (entity && entity.id) || slotId;
    window.__sheetGen = window.__sheetGen || {};
    window.__sheetGen[bid] = { generate, gening, noun };
    return ()=>{ delete window.__sheetGen[bid]; };
  });
  const runEdit = ()=>{ if(!editText.trim() || gening) return;
    const opts = { editInstruction: editText.trim() };
    if(editRefs.length){
      opts.editRefImages = editRefs.map(r=>r.url);
      opts.editRefMeta = editRefs.slice();   // {url, note} — recorded in Details › Reference images used
    }
    if(editDependencyIds.length) opts.propDependencyIds=editDependencyIds.slice();
    generate(opts); setEditRefs([]); setEditDependencyIds([]); };
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [detailsHistoryAvailable,setDetailsHistoryAvailable] = React.useState(()=>!!(layers>0));
  const [regionEditOpen, setRegionEditOpen] = React.useState(false);
  const [propRefOpen, setPropRefOpen] = React.useState(false);
  const [sheetRefOpen, setSheetRefOpen] = React.useState(false);
  const menuRef = React.useRef(null);
  const uploadRef = React.useRef(null);
  const pickUpload = ()=>{ if(uploadRef.current) uploadRef.current.click(); };
  const onUploadPicked = (e)=>{ const f=e.target.files&&e.target.files[0]; if(f&&importSheet) importSheet(f); e.target.value=""; };
  const editNounLabel = /delete character/i.test(deleteLabel||"") ? "character sheet" : (noun||"sheet");
  const menuItemsBeforeEdit = (menuExtra||[]).filter(m=>m&&m.placement==="beforeEdit");
  const menuItemsDefault = (menuExtra||[]).filter(m=>m&&m.placement!=="beforeEdit");
  const isPropCardMenu = /delete prop/i.test(deleteLabel||"") || (noun==="prop sheet");
  const forceRemaster = /delete (character|prop)/i.test(deleteLabel||"");
  // Exact purge can intentionally leave the current URL empty while retaining
  // prior versions. Keep Details reachable from that tombstone; opening it is
  // read-only until the director explicitly chooses Restore.
  const purgeTombstone = !!(genMeta && (genMeta.cleanupPurge || genMeta.cleanupPurgeTarget || genMeta.cleanupTombstone));
  const detailsLoaderRef=React.useRef(gen.loadDetails);
  detailsLoaderRef.current=gen.loadDetails;
  React.useEffect(()=>{
    let alive=true;
    if(layers>0 || purgeTombstone){ setDetailsHistoryAvailable(true); return ()=>{alive=false;}; }
    if(genUrl || detailsHistoryAvailable || typeof detailsLoaderRef.current!=="function") return ()=>{alive=false;};
    // The metadata tombstone is the cheap path. For a legacy retained-history
    // row without that stamp, loadDetailsAsset is the read-only fallback; it
    // never restores, promotes, or generates anything.
    Promise.resolve().then(()=>detailsLoaderRef.current()).then(d=>{
      if(alive && d && Array.isArray(d.history) && d.history.length) setDetailsHistoryAvailable(true);
    }).catch(()=>{});
    return ()=>{alive=false;};
  },[genUrl,layers,purgeTombstone,detailsHistoryAvailable]);
  const canOpenDetails = !!genUrl || detailsHistoryAvailable || layers>0 || purgeTombstone;
  // dropToImport: the empty slot itself imports a FINISHED frame at full resolution (drop or
  // click-to-browse) — same job as the old "Upload a finished" button, so it can replace it.
  const [dropOver, setDropOver] = React.useState(false);
  const onZoneDragOver = (e)=>{ if(!importSheet || gening) return; e.preventDefault(); e.stopPropagation(); if(e.dataTransfer) e.dataTransfer.dropEffect="copy"; if(!dropOver) setDropOver(true); };
  const onZoneDragLeave = (e)=>{ e.preventDefault(); setDropOver(false); };
  const onZoneDrop = (e)=>{ e.preventDefault(); e.stopPropagation(); setDropOver(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(f && importSheet && !gening) importSheet(f); };
  const [pendingGenerate, setPendingGenerate] = React.useState(false);
  const sawDraftingRef = React.useRef(false);
  noun = noun || "sheet";

  React.useEffect(()=>{
    if(!menuOpen) return;
    const handler = e=>{ if(menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return ()=>document.removeEventListener("mousedown", handler);
  },[menuOpen]);

  /* draft-then-generate: when generating an undrafted card, run Draft first then auto-generate */
  React.useEffect(()=>{
    if(!pendingGenerate) return;
    if(drafting){ sawDraftingRef.current = true; return; }
    if(sawDraftingRef.current){ sawDraftingRef.current = false; setPendingGenerate(false); generate(); }
  },[pendingGenerate, drafting]);

  const handleGenerateClick = ()=>{
    if(gening) return;
    // Resolving a prerequisite is navigation only, never an implicit generation.
    if(generateDisabled){if(onResolveGenerationBlock)onResolveGenerationBlock();return;}
    if(gen.pendingSave){gen.retrySave&&gen.retrySave();return;}
    if(specGate && !specGate.ready && !genUrl && !slotHasRef) return; // gated: draft the spec first
    if(!drafted && !genUrl && !slotHasRef){ setPendingGenerate(true); onDraft(); return; }
    generate();
  };
  // spec-first gate (opt-in via specGate; Props/Characters pass nothing → ungated):
  // block plate generation until the written design spec exists, so it's reviewed first
  const specBlocked = !!(specGate && !specGate.ready && !genUrl && !slotHasRef);

  return React.createElement("div",{className:"sheet-frame"},
    React.createElement("div",{className:"sheet-media",style:{position:"relative"}},
    genUrl
      ? React.createElement("div",{className:"sheet-genwrap"},
          React.createElement("img",{className:"sheet-genimg",src:genUrl,alt:name+" "+noun,
            decoding:"async",loading:"lazy",
            onClick:()=>onView&&onView(genUrl, entity)}))
      : dropToImport
        // the drop zone IS the upload: drop a finished frame or click to browse \u2014 imported at
        // full resolution and committed as this frame, so it previews exactly like a generated one.
        ? React.createElement("div",{className:"sheet-dropzone"+(dropOver?" over":"")+(gening?" busy":""),
            role:"button",tabIndex:gening?-1:0,"aria-disabled":!!gening,onClick:()=>{ if(!gening) pickUpload(); },
            onKeyDown:e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();if(!gening)pickUpload();}},
            onDragEnter:onZoneDragOver,onDragOver:onZoneDragOver,onDragLeave:onZoneDragLeave,onDrop:onZoneDrop,
            title:"Drop a finished "+noun+" here, or click to browse \u2014 it's imported at full resolution and becomes this "+noun},
            React.createElement(Icon.image,{s:26}),
            React.createElement("div",{className:"sheet-dropzone-cap"}, slotPlaceholder||("Drop a "+noun)),
            React.createElement("div",{className:"sheet-dropzone-sub"}, "or click to browse files"))
        : React.createElement(React.Fragment,null,
            React.createElement("image-slot",{id:slotId,className:"sheet-slot",
              shape:"rounded",radius:"10",placeholder:slotPlaceholder||"Drop reference art"}),
            slotHasRef && React.createElement("div",{className:"sheet-ref-pill"},
              React.createElement(Icon.bolt,{s:10,sw:2}),"Reference art active \u00b7 guides generation")),
    (genUrl || onDelete || importSheet || canOpenDetails) && React.createElement("div",{className:"sheet-gen-tools",style:{top:8,right:8}},
      React.createElement("div",{className:"sheet-tools-menu",ref:menuRef},
        React.createElement("button",{className:"sheet-gen-tool",onClick:()=>setMenuOpen(m=>!m),title:"Options"},
          React.createElement(Icon.moreV,{s:14})),
        menuOpen && React.createElement("div",{className:"sheet-tools-dropdown"},
          canOpenDetails && React.createElement("button",{className:"sheet-tools-item",onClick:()=>{ setDetailsOpen(true); setMenuOpen(false); }},
            React.createElement(Icon.info,{s:14}),"Details"),
          (genUrl && (forceRemaster || remasterEligible(genMeta))) && React.createElement("button",{className:"sheet-tools-item",disabled:gening,
            title:"Re-render the CURRENT image as a fresh, clean, full-quality version \u2014 same design, artifacts and noise removed (stacked edits degrade like a photocopy of a photocopy). Lands as a new version; the old one stays in history.",
            onClick:()=>{ setMenuOpen(false); generate({ editInstruction: (typeof remasterInstruction==="function")?remasterInstruction(noun):"Reproduce this image exactly, clean and artifact-free." }); }},
            React.createElement(Icon.sparkles,{s:14}),"Remaster \u2014 clean re-render",
            typeof window.nbCostChip==="function" && window.nbCostChip(1, editCostOpts(0))),
          ...(menuItemsBeforeEdit||[]).map((m,i)=>
            React.createElement("button",{key:"mb"+i,className:"sheet-tools-item",disabled:gening||m.disabled,title:m.title,
              onClick:()=>{ setMenuOpen(false); m.onClick&&m.onClick(); }},
              React.createElement(m.icon||Icon.sparkles,{s:14}), m.label)),
          genUrl && React.createElement("button",{className:"sheet-tools-item "+(editMode?"on":""),
            onClick:()=>{ setEditMode(m=>!m); setEditText(""); setEditRefs([]); setEditDependencyIds([]); setMenuOpen(false); }},
            React.createElement(Icon.wand,{s:14}),editMode?"Close edit":"Edit "+editNounLabel),
          genUrl && React.createElement("button",{className:"sheet-tools-item",disabled:gening,
            title:"Draw a rectangle on the image, write a localized edit prompt, and optionally attach a prop sheet or uploaded reference image.",
            onClick:()=>{ setRegionEditOpen(true); setMenuOpen(false); }},
            React.createElement(Icon.target,{s:14}),"Select area & edit"),
          genUrl && !isPropCardMenu && (((window.turnContinuity||{}).props||[]).length>0) && React.createElement("button",{className:"sheet-tools-item",disabled:gening,
            title:"Select an item in this image and attach that crop to an existing prop as a consistency reference.",
            onClick:()=>{ setPropRefOpen(true); setMenuOpen(false); }},
            React.createElement(Icon.box,{s:14}),"Attach item to prop\u2026"),
          genUrl && isPropCardMenu && React.createElement("button",{className:"sheet-tools-item",disabled:gening,
            title:"Attach an existing character, prop or location sheet as a consistency reference for future prop generations and edits.",
            onClick:()=>{ setSheetRefOpen(true); setMenuOpen(false); }},
            React.createElement(Icon.layers,{s:14}),"Attach reference to prop\u2026"),
          // import a finished sheet generated outside the app (e.g. in ChatGPT)
          importSheet && React.createElement("button",{className:"sheet-tools-item",disabled:gening,
            title:"Import a finished image you generated elsewhere, at full resolution — it becomes this "+noun,
            onClick:()=>{ setMenuOpen(false); pickUpload(); }},
            React.createElement(Icon.image,{s:14}), genUrl?"Replace with upload":"Upload a sheet"),
          // caller-specific menu items (e.g. Shots: "Generate fresh sample")
          ...(menuItemsDefault||[]).map((m,i)=>
            React.createElement("button",{key:"mx"+i,className:"sheet-tools-item",disabled:gening||m.disabled,title:m.title,
              onClick:()=>{ setMenuOpen(false); m.onClick&&m.onClick(); }},
              React.createElement(m.icon||Icon.sparkles,{s:14}), m.label)),
          genUrl && React.createElement("div",{className:"sheet-tools-divider"}),
          genUrl && React.createElement("button",{className:"sheet-tools-item danger",onClick:async ()=>{
              setMenuOpen(false);
              // count only the related images that EXIST (2026-10-08 — it counted ids, so "plus 3 variant
              // sheets" showed when there were none), and name them by kind
              let vN = 0;
              try{ const ids = relatedClearIdsOf ? (relatedClearIdsOf()||[]) : [];
                for(const rid of ids){ let u = (typeof nbGetImage==="function") ? nbGetImage(rid) : "";
                  if(!u && typeof nbLoadImage==="function"){ try{ u = await nbLoadImage(rid); }catch(e){} }
                  if(u) vN++; } }catch(e){ vN = relatedClearCount||0; }
              const kind = relatedClearLabel || "variant sheet";
              const extra = vN>0 ? (", plus "+vN+" "+kind+(vN>1?"s":"")+",") : "";
              const opts = {
                title: "Clear "+(name||"this")+"’s "+(noun||"sheet")+"?",
                body: "This permanently deletes the generated image and ALL earlier versions"+extra+" from cloud storage. The "+(noun||"sheet")+" can be regenerated — the written spec is kept.",
                note: (vN>0 && !relatedClearLabel) ? "The likeness and linked props are kept. This can’t be undone."
                           : "This can’t be undone.",
                confirmLabel: "Clear", cancelLabel: "Cancel", danger: true,
              };
              const ok = window.appConfirm ? await window.appConfirm(opts)
                : window.confirm ? window.confirm(opts.title+"\n\n"+opts.body) : false;
              if(ok) clearGen();
            }},
            React.createElement(Icon.x,{s:14}),"Clear"),
          onDelete && React.createElement("button",{className:"sheet-tools-item danger",onClick:async ()=>{
              setMenuOpen(false);
              if(/location/i.test(deleteLabel||"")){
                const ok = !window.appConfirm || await window.appConfirm({
                  title:"Delete "+(name||"this location")+"?",
                  body:"This removes the location card from the Art Room and moves it to Recently Deleted. Its generated plate can be restored from there until you delete it forever.",
                  confirmLabel:"Delete location", cancelLabel:"Cancel", danger:true
                });
                if(!ok) return;
              }
              else if(/prop/i.test(deleteLabel||"")){
                const ok = !window.appConfirm || await window.appConfirm({
                  title:"Delete "+(name||"this prop")+"?",
                  body:"This removes the prop card and moves it to Recently Deleted. Its image can be restored from there until you delete it forever.",
                  confirmLabel:"Delete prop", cancelLabel:"Cancel", danger:true
                });
                if(!ok) return;
              }
              else if(/character/i.test(deleteLabel||"")){
                const ok = !window.appConfirm || await window.appConfirm({
                  title:"Delete "+(name||"this character")+"?",
                  body:"This removes the character card and moves it to Recently Deleted. Its sheet and appearance variants can be restored from there until you delete it forever.",
                  confirmLabel:"Delete character", cancelLabel:"Cancel", danger:true
                });
                if(!ok) return;
              }
              onDelete();
            }},
            React.createElement(Icon.trash,{s:14}),deleteLabel||"Delete"))))),
    editMode && React.createElement("div",{className:"sheet-edit-panel"},
      React.createElement("input",{className:"sheet-edit-input",type:"text",autoFocus:true,
        placeholder:"Describe changes\u2026  e.g. "+(noun==="prop sheet"?"make the metal brushed steel":"change jacket to black, add glasses"),
        value:editText,onChange:e=>setEditText(e.target.value),
        onKeyDown:e=>{ if(e.key==="Enter"&&editText.trim()) runEdit();
                       if(e.key==="Escape"){ setEditMode(false); setEditText(""); setEditRefs([]); setEditDependencyIds([]); } }}),
      // caller-supplied one-click instructions (e.g. a location's set-dressing
      // fixtures). Two modes per chip: the label inserts the ready instruction
      // (prompt-only), the clip ALSO attaches the fixture's generated sheet as a
      // reference image for this edit \u2014 locking the exact design when a sheet exists.
      (editSuggestions && editSuggestions.length>0) && React.createElement("div",{className:"sheet-edit-suggests"},
        React.createElement("span",{className:"sheet-edit-suggests-lab"},"Set dressing"),
        editSuggestions.map((s,i)=>{
          const insert = (extra)=>{ if(s.refId) setEditDependencyIds(ids=>ids.includes(s.refId)?ids:[...ids,s.refId]);
            setEditText(t=>{ const base = t.trim() ? (t.trim().replace(/\.\s*$/,"")+". "+s.text) : s.text;
              return extra ? (base.replace(/\.\s*$/,"")+". "+extra) : base; }); };
          return React.createElement("span",{key:i,className:"sheet-edit-suggest-group"},
            React.createElement("button",{className:"sheet-edit-suggest",title:s.title,onClick:()=>insert("")},
              s.raw ? s.label : ("+ "+s.label)),
            s.getRef && React.createElement("button",{className:"sheet-edit-suggest refclip",
              title:"Insert the instruction AND attach "+s.label+"'s generated sheet as a reference image for this edit \u2014 the fixture lands exactly as designed. Needs the prop's sheet to exist (generate it on the Props tab).",
              onClick:async ()=>{
                let url=""; try{ url = await s.getRef(); }catch(e){}
                if(!url){ insert(""); if(window.appToast) window.appToast("No sheet for "+s.label+" yet \u2014 generate it on the Props tab to attach it. The text instruction still works."); return; }
                insert("Match the attached reference image of \""+s.label+"\" EXACTLY \u2014 its design (shape, materials, construction), never its studio lighting or background.");
                setEditRefs(rs=> rs.some(r=>r.url===url) ? rs : [...rs, { url, note:(s.label||"fixture")+" \u2014 prop sheet", refId:s.refId }]);
              }},
              React.createElement(Icon.image,{s:12})));
        })),
      // attached IMAGE INPUTS \u2014 removable thumbs riding on the next Apply edit
      editRefs.length>0 && React.createElement("div",{className:"sheet-edit-refs"},
        editRefs.map((r,i)=>React.createElement("span",{key:i,className:"sheet-edit-refthumb",title:r.note+" \u2014 click to preview"},
          React.createElement("img",{src:r.url,alt:r.note,style:{cursor:"zoom-in"},
            onClick:()=>onView && onView(r.url,{ name:r.note })}),
          React.createElement("button",{className:"sheet-edit-refx",title:"Remove this image input",
            onClick:()=>setEditRefs(rs=>rs.filter((_,j)=>j!==i))},"\u00d7")))),
      React.createElement("div",{className:"sheet-edit-acts"},
        React.createElement("button",{className:"sheet-edit-apply",
          onClick:runEdit,disabled:!editText.trim()||gening,
          title: editRefs.length ? ("Runs the edit with "+editRefs.length+" attached image"+(editRefs.length>1?"s":"")+" as reference"+(editRefs.length>1?"s":"")) : "Runs the edit from the instruction"},
          React.createElement(Icon.wand,{s:12}),"Apply edit",
          typeof window.nbCostChip==="function" && window.nbCostChip(1, editCostOpts(editRefs.length))),
        // Undo only when the CURRENT image is the product of an edit — a fresh
        // generation or an upload has no "before my last edit" to restore, even
        // when older versions exist in history (those live in Details / the viewer)
        (layers>0 && gen.genMeta && gen.genMeta.mode==="edit") && React.createElement("button",{className:"sheet-edit-undo",disabled:gening,
          title:"Restore the version before your last edit",onClick:()=>revertPrevious&&revertPrevious()},
          React.createElement(Icon.undo,{s:12}),"Undo"),
        // "+" \u2014 one square entry point for image inputs: upload from device, or attach
        // one of this entity's generated prop sheets (worn AND carried)
        React.createElement("span",{className:"sheet-edit-addwrap",ref:editAddRef},
          React.createElement("button",{className:"sheet-edit-addref"+(editAddOpen?" on":""),disabled:gening,
            title:"Add image input(s) to this edit \u2014 upload a reference photo/design, or attach one of this character's generated prop sheets.",
            onClick:(e)=>{
              const panel = e.currentTarget.closest(".sheet-edit-panel");
              const inp = panel && panel.querySelector(".sheet-edit-input");
              const r = (inp||e.currentTarget).getBoundingClientRect();
              setEditAddPos({ cx: Math.max(150, Math.min(r.left + r.width/2, window.innerWidth-150)),
                bottom: window.innerHeight - r.top + 8 });
              setEditAddOpen(o=>!o); }},"+"),
          editAddOpen && editAddPos && ReactDOM.createPortal(React.createElement("div",{className:"sheet-edit-addoverlay",
            onMouseDown:(e)=>{ if(e.target===e.currentTarget) setEditAddOpen(false); }},
            React.createElement("div",{className:"sheet-edit-addmenu",
              style:{ position:"fixed", left:editAddPos.cx+"px", bottom:editAddPos.bottom+"px", transform:"translateX(-50%)" }},
              React.createElement("div",{className:"sheet-edit-addtitle"},"Add image input"),
            React.createElement("button",{className:"sheet-tools-item",
              onClick:()=>{ setEditAddOpen(false); editFileRef.current && editFileRef.current.click(); }},
              React.createElement(Icon.image,{s:14}),"Upload from device\u2026"),
            (editPropRefs||[]).map(p=>React.createElement("button",{key:p.id,className:"sheet-tools-item",
              title:"Attach "+p.name+"'s locked sheet as an input. If the instruction box is empty, an 'update it to match this sheet exactly' instruction is written for you \u2014 edit it freely, then Apply.",
              onClick:async ()=>{
                setEditAddOpen(false);
                let url=(typeof nbGetImage==="function")?nbGetImage(p.id):"";
                if(!url && typeof nbLoadImage==="function"){ try{ url=await nbLoadImage(p.id); }catch(e){} }
                if(!url){ if(typeof window.appToast==="function") window.appToast("That prop has no generated sheet yet \u2014 generate it first"); return; }
                setEditRefs(rs=> rs.some(r=>r.url===url) ? rs : [...rs, { url, note:p.name, refId:p.id }]);
                if(!editText.trim()){
                  const verb = p.kind==="worn" ? "wears" : "carries";
                  setEditText("Update the "+p.name+" this character "+verb+" so it matches the attached prop reference sheet EXACTLY \u2014 same shape, materials, colours and construction. If the item isn't visible yet, add it where it naturally belongs. Keep EVERYTHING else identical: the face, body, pose, panel layout, rendering style, lighting and background.");
                }
              }},
              React.createElement(Icon.box,{s:14}), p.name.length>34 ? (p.name.slice(0,33)+"\u2026") : p.name)),
            !(editPropRefs||[]).length && React.createElement("div",{className:"sheet-edit-addnote"},
              "No generated prop sheets yet \u2014 carried props appear here once their sheets exist."))), document.body),
          React.createElement("input",{ref:editFileRef,type:"file",accept:"image/*",multiple:true,style:{display:"none"},
            onChange:e=>{ addEditFiles(e.target.files); e.target.value=""; }})),
        React.createElement("button",{className:"sheet-edit-cancel",
          onClick:()=>{ setEditMode(false); setEditText(""); setEditRefs([]); setEditDependencyIds([]); setEditAddOpen(false); }},"Cancel")),
      layers>0 && React.createElement("div",{className:"sheet-edit-layers"},
        React.createElement(Icon.history,{s:10}),
        layers+" earlier version"+(layers!==1?"s":"")+" \u00b7 see all in the \u2026 menu \u203a Details")),
    referenceControls,
    // generate + (while running) stop sit on ONE row — full-width when idle, 50/50 while generating
    React.createElement("div",{className:"sheet-gen-row"},
    React.createElement("button",{className:"sheet-gen-btn"+(generateDisabled&&!gening?(onResolveGenerationBlock?" needs-review":" waiting"):""),onClick:handleGenerateClick,
      disabled:gening||(drafting&&pendingGenerate)||(generateDisabled?!onResolveGenerationBlock:specBlocked),
      title:generateDisabled
        ? (generateDisabledTitle||"Wait for the current generation to finish first.")
        : (!drafted && !genUrl && !slotHasRef)
        ? "Fills the text spec from the script first (writing credits), then generates the sheet in one step (image credits)"
        : (generateTitle || (genUrl ? "Generate a fresh sheet from the current spec" : "Generate the sheet from the current spec"))},
      generateDisabled && !gening
        ? React.createElement(React.Fragment,null,React.createElement(onResolveGenerationBlock?Icon.chevR:Icon.clock,{s:14}),
            generateDisabledLabel||"Wait for current generation")
        : (gening || (drafting && pendingGenerate))
        ? React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin dark"}),
            gen.saving ? "Saving\u2026" : pendingGenerate ? "Drafting\u2026" :
            retrying ? "Retrying simplified\u2026" : "Generating\u2026")
        : React.createElement(React.Fragment,null,React.createElement(Icon.sparkles,{s:14}),
            gen.pendingSave ? "Retry save" : specBlocked ? "Draft specification first" :
            genUrl ? "Generate new image" :
            (slotHasRef ? "Generate from photo" :
            (!drafted ? "Draft & generate image" : "Generate image")),
            !specBlocked && !gen.pendingSave && typeof window.nbCostChip==="function"
              && window.nbCostChip(1, generateRefs!=null ? { refs:Number(generateRefs)||0 } : undefined))),
    // Stop an in-flight generation — discards the result so it won't commit over the frame.
    gening && React.createElement("button",{className:"sheet-gen-stop",onClick:()=> onStop ? onStop() : (cancelGen && cancelGen()),
      title:"Stop this generation — nothing will be saved over the current frame"},
      React.createElement(Icon.x,{s:14}),"Stop")),
    // import a finished, full-res sheet generated outside the app (ChatGPT, etc.)
    React.createElement("input",{ref:uploadRef,type:"file",accept:"image/png,image/jpeg,image/webp,image/avif",
      style:{display:"none"},onChange:onUploadPicked}),
    // when the empty slot already imports on drop/click (dropToImport), this button is redundant
    !genUrl && importSheet && !dropToImport && !hideUploadButton && noun!=="location plate" && React.createElement("button",{className:"sheet-upload-btn",onClick:pickUpload,disabled:gening,
      title:"Generated this elsewhere (e.g. in ChatGPT)? Upload it at full resolution — it becomes this "+noun+", with zoom, the … menu and clear, just like a generated one."},
      React.createElement(Icon.image,{s:12}),"Upload a finished "+noun),
    gen.pendingSave&&React.createElement("div",{className:"sheet-retry-save",role:"status"},
      React.createElement("span",null,"Unsaved image kept in this tab. Retry save makes no generation request."),
      (gen.pendingSave.error||genErr)&&React.createElement("span",{role:"alert"},gen.pendingSave.error||genErr),
      React.createElement("a",{href:gen.pendingSave.url,download:(name||"image")+"-unsaved.png"},"Download unsaved image"),
      React.createElement("button",{className:"sheet-approval-btn",disabled:gening,onClick:gen.discardSave},"Discard unsaved image")),
    genErr && !gen.pendingSave && (()=>{
      const keyGate = /API key/i.test(genErr||"");
      // CORS / browser-unreachable (GPT Image): the ONLY real fix is switching
      // to the in-browser model, so make that the primary action and drop the
      // useless "simplified prompt" retry.
      const browserGate = /can't be generated directly in the browser|cross-origin/i.test(genErr||"");
      const cur = (typeof nbGetModel==="function") ? nbGetModel() : "";
      const other = allModels.find(m=>m.id!==cur);
      return React.createElement("div",{className:"sheet-gen-err"},
      React.createElement("div",{className:"sheet-gen-err-msg"},genErr),
      React.createElement("div",{className:"sheet-gen-err-acts"},
        /* missing/rejected key: jump straight to the key bar (it's at the top of
           the tab — on mobile that's a long scroll up, so do it for them) and
           focus the input. The simplified-prompt retry can't help without a key. */
        keyGate
          ? React.createElement("button",{className:"sheet-gen-err-btn primary",onClick:(e)=>{
              const sc = (e.target.closest && e.target.closest(".art-scroll")) || document.querySelector(".art-scroll");
              if(sc) sc.scrollTop = 0;
              const inp = document.querySelector(".nb-keybar .nb-key-input");
              if(inp){ try{ inp.focus({preventScroll:true}); }catch(_){ inp.focus(); } }
            }},"Set API key")
          : (browserGate
              ? (other && React.createElement("button",{className:"sheet-gen-err-btn primary",onClick:()=>generate({model:other.id})},"Switch to "+other.label))
              : React.createElement("button",{className:"sheet-gen-err-btn",onClick:()=>generate({simple:true})},"Try simplified prompt")),
        !browserGate && other && React.createElement("button",{className:"sheet-gen-err-btn",onClick:()=>generate({model:other.id})},"Try "+other.label))); })(),
    // caption row only exists when it has something real to say — an EMPTY slot used to
    // render a dangling "REFERENCE FRAME" label under the buttons with nothing above it.
    (genUrl || slotHasRef || genTier==="session" || genTier==="memory") &&
    React.createElement("div",{className:"sheet-frame-cap"},
      slotHasRef && React.createElement("span",{className:"sheet-ref-chip"},
        React.createElement(Icon.bolt,{s:10,sw:2.2}),"Ref"),
      (genTier==="session"||genTier==="memory") && React.createElement("span",{
        className:"sheet-tier-warn",
        title:"Image is too large to save permanently — download it before closing or refreshing this tab"},
        React.createElement(Icon.warn,{s:10,sw:2}),"Session only \u00b7 download to keep"),
      // model-aware badge: older GPT Image renders were mis-badged "Grounded" from
      // a bare request flag — the chip only makes sense on models that CAN ground,
      // so it also hides on already-stored (legacy) meta
      genUrl && genMeta && genMeta.grounded && !(typeof isGptImageModel==="function" && isGptImageModel(genMeta.modelId)) && React.createElement("span",{
        className:"sheet-ground-chip",
        title:genMeta.groundImages ? "Generated with web grounding and image references" : "Generated with web grounding"},
        React.createElement(Icon.globe,{s:10,sw:2}),"Grounded"),
      // (2026-10-10, owner — Likeness review) the button and the chip say the same word: "Likeness"
      genUrl && genMeta && genMeta.cameo && React.createElement("span",{
        className:"sheet-cameo-chip"+(gen.likenessStale?" stale":""),
        title: gen.likenessStale ? "Made with an earlier likeness \u2014 regenerate to update it"
          : "The face comes from this character's locked likeness"},
        React.createElement(Icon.userScan,{s:10,sw:1.8}),"Likeness"),
      genUrl && genMeta
        ? React.createElement("span",{className:"sheet-frame-meta"},
            React.createElement("span",{className:"sheet-meta-item sheet-meta-model",title:"Model: "+((genMeta.modelLabel||"")+(genMeta.modelId?(" ("+genMeta.modelId+")"):""))},
              React.createElement(Icon.sparkles,{s:10,sw:1.8}),
              /* show the commercial name (e.g. "Nano Banana 2.1"), not the raw model id.
                 prefer the stored label, else look it up by id, else fall back to id. */
              React.createElement("span",{className:"sheet-meta-model-name"},
                genMeta.modelLabel || (typeof nbModelLabel==="function" ? nbModelLabel(genMeta.modelId) : ((window.NB_MODELS||[]).find(m=>m.id===genMeta.modelId)||{}).label) || genMeta.modelId)),
            React.createElement("span",{className:"sheet-meta-item",title:"Aspect ratio"},
              React.createElement(Icon.image,{s:10,sw:1.8}),genMeta.aspect),
            React.createElement("span",{className:"sheet-meta-item",title:"Resolution"},
              React.createElement(Icon.monitor,{s:10,sw:1.8}),
              (genMeta.uploaded || genMeta.modelId==="uploaded") ? String(resLabel).split(" · ")[0] : resLabel))
        // Dates, times and encoder quality remain in Details, not on compact cards.
        // This is display-only: stored metadata and version history are unchanged.
        : (genUrl || slotHasRef) && React.createElement("span",{className:"sheet-frame-cap-label"},genUrl?"Generated":"Reference frame")),
    /* Portal to <body>: the card has content-visibility:auto (paint/layout
       containment), which would otherwise make this card the containing block for
       the modal's position:fixed — trapping the overlay inside the card instead of
       covering the viewport (broken/clipped on small screens). */
     detailsOpen && ReactDOM.createPortal(React.createElement(SheetDetails,{ gen, name, noun, extraMeta,
       onClose:()=>setDetailsOpen(false), onView:(url)=>onView&&onView(url, entity) }), document.body),
    regionEditOpen && genUrl && React.createElement(RegionEditModal,{url:genUrl,name,noun,entity,editPropRefs,costOptsFor:editCostOpts,
      onClose:()=>setRegionEditOpen(false),
      onApply:({ instruction, refs })=> generate({
        editInstruction:instruction,
        editRefImages:(refs||[]).map(r=>r.url).filter(Boolean),
        editRefMeta:(refs||[]).filter(r=>r.url).map(r=>({ url:r.url, note:r.note||r.name||"Region edit reference", refId:r.id }))
      })}),
    propRefOpen && genUrl && React.createElement(PropReferenceModal,{url:genUrl,name,noun,entity,
      onClose:()=>setPropRefOpen(false)}),
    sheetRefOpen && genUrl && entity && React.createElement(PropSheetReferenceModal,{prop:entity,
      onClose:()=>setSheetRefOpen(false)}));
}
window.SheetFrame = SheetFrame;
window.SheetDetails = SheetDetails;

/* ---- continuity surfacing: which appearance version of each character applies in a
   given scene. A state applies from its pinned scene onward (story order) until a
   later state supersedes it; before any pinned state a character is at base (v1). ---- */
function activeStateForScene(character, scene, scenes){
  const states = character.states || [];
  if(!states.length || !scene) return { version:1, state:null };
  const idxOf = (id)=> scenes.findIndex(s=>s.id===id);
  const sceneIdx = idxOf(scene.id);
  if(sceneIdx<0) return { version:1, state:null };
  let best=null, bestPos=-1, bestVersion=1;
  states.forEach((st,i)=>{
    if(!st.sceneId) return;
    const pos = idxOf(st.sceneId);
    if(pos>=0 && pos<=sceneIdx && pos>=bestPos){ best=st; bestPos=pos; bestVersion=i+2; }
  });
  return { version:bestVersion, state:best };
}
window.activeStateForScene = activeStateForScene;

/* SceneContinuity — a compact per-scene panel: the appearance version of every character
   that has states, with a flag when the applicable state has no generated sheet yet. */
function SceneContinuity({ scene, scenes, characters }){
  const tracked = (characters||[]).filter(c=>(c.states||[]).length);
  const [sheets, setSheets] = React.useState({});   // stateGlobalId -> bool
  React.useEffect(()=>{
    let alive = true;
    const probe = async ()=>{
      const out = {};
      for(const c of tracked){
        const { state } = activeStateForScene(c, scene, scenes);
        if(state){
          const gid = c.id+":"+state.id;
          let has = (typeof nbGetImage==="function" && !!nbGetImage(gid));
          if(!has && typeof nbLoadImage==="function"){ try{ has = !!(await nbLoadImage(gid)); }catch(e){} }
          out[gid] = has;
        }
      }
      if(alive) setSheets(out);
    };
    probe();
    return ()=>{ alive=false; };
  },[scene && scene.id, tracked.map(c=>c.id+":"+(c.states||[]).map(s=>s.id+s.sceneId).join()).join("|")]);

  if(!tracked.length) return null;
  return React.createElement("div",{className:"insp-block"},
    React.createElement("div",{className:"insp-block-head"},
      React.createElement("span",{className:"eyebrow"},React.createElement(Icon.user,{s:12}),"Continuity \u00b7 appearance")),
    React.createElement("div",{className:"cont-list"},
      tracked.map(c=>{
        const { version, state } = activeStateForScene(c, scene, scenes);
        const gid = state ? (c.id+":"+state.id) : null;
        const missing = state && sheets[gid]===false;
        return React.createElement("div",{key:c.id,className:"cont-row"},
          React.createElement("span",{className:"cont-av",style:{background:c.color}},
            c.name.split(" ").map(w=>w[0]).slice(0,2).join("")),
          React.createElement("div",{className:"cont-info"},
            React.createElement("div",{className:"cont-name"},c.name),
            React.createElement("div",{className:"cont-state"},
              state ? state.label : "Base look")),
          React.createElement("span",{className:"cont-vtag"+(state?"":" base")},"v"+version),
          missing && React.createElement("span",{className:"cont-warn",title:"This appearance state has no generated sheet yet"},
            React.createElement(Icon.warn,{s:12,sw:2})));
      })));
}
window.SceneContinuity = SceneContinuity;

/* ALWAYS SHOW PROMPTS (owner 2026-10-05): the cards' generation prompts sit behind each card's ⋯ menu;
   this switch (the Art Room's ⋮ menu) opens them on every card. A PERSONAL setting on this device, not
   the film's: collaborators share a film, and a view-only role can still choose how it reads. */
const ART_ALWAYS_PROMPTS_KEY = "turn_art_always_prompts";
function turnArtAlwaysPrompts(){ try{ return localStorage.getItem(ART_ALWAYS_PROMPTS_KEY)==="1"; }catch(e){ return false; } }
function turnSetArtAlwaysPrompts(on){
  try{ localStorage.setItem(ART_ALWAYS_PROMPTS_KEY, on ? "1" : "0"); }catch(e){}
  try{ window.dispatchEvent(new CustomEvent("turn-art-prompts",{ detail:{ on:!!on } })); }catch(e){}
}
function useArtAlwaysPrompts(){
  const [on, setOn] = React.useState(turnArtAlwaysPrompts);
  React.useEffect(()=>{
    const h = ()=>setOn(turnArtAlwaysPrompts());
    window.addEventListener("turn-art-prompts", h); window.addEventListener("storage", h);
    return ()=>{ window.removeEventListener("turn-art-prompts", h); window.removeEventListener("storage", h); };
  },[]);
  return on;
}
window.turnArtAlwaysPrompts = turnArtAlwaysPrompts; window.turnSetArtAlwaysPrompts = turnSetArtAlwaysPrompts;
window.useArtAlwaysPrompts = useArtAlwaysPrompts;

function CopyBox({ label, text }){
  const [copied, setCopied] = React.useState(false);
  const copy = async ()=>{
    let ok = false;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text); ok = true;
      }
    }catch(e){ ok = false; }
    if(!ok){
      // fallback for sandboxed iframes / non-secure contexts where the async
      // Clipboard API is blocked: select a hidden textarea and execCommand('copy')
      try{
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly","");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
        document.body.appendChild(ta);
        ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      }catch(e){ ok = false; }
    }
    setCopied(true); setTimeout(()=>setCopied(false), 1400);
  };
  const [open, setOpen] = React.useState(false);
  React.useEffect(()=>{
    if(!open) return;
    const h=(e)=>{ if(e.key==="Escape") setOpen(false); };
    document.addEventListener("keydown",h);
    return ()=>document.removeEventListener("keydown",h);
  },[open]);
  const chars = String(text||"").length;
  return React.createElement("div",{className:"copybox"},
    React.createElement("div",{className:"copybox-head"},
      React.createElement("span",{className:"copybox-lab"},label),
      React.createElement("div",{className:"copybox-actions"},
        React.createElement("button",{className:"copybox-btn",onClick:()=>setOpen(true),
          title:"Preview the full prompt in a larger window"},
          React.createElement(Icon.maximize||Icon.eye,{s:12}), "Preview"),
        React.createElement("button",{className:"copybox-btn",onClick:copy},
          React.createElement(Icon[copied?"check":"copy"]||Icon.check,{s:12}), copied?"Copied":"Copy"))),
    React.createElement("div",{className:"copybox-text",onClick:()=>setOpen(true),
      title:"Click to preview the full prompt"},text),
    open && ReactDOM.createPortal(
      React.createElement("div",{className:"bible-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) setOpen(false); }},
        React.createElement("div",{className:"copybox-modal"},
          React.createElement("div",{className:"copybox-modal-head"},
            React.createElement("span",{className:"copybox-modal-lab"},label),
            React.createElement("span",{className:"copybox-modal-count"}, chars.toLocaleString()+" characters"),
            React.createElement("button",{className:"copybox-btn",onClick:copy},
              React.createElement(Icon[copied?"check":"copy"]||Icon.check,{s:14}), copied?"Copied":"Copy prompt"),
            React.createElement("button",{className:"copybox-modal-x",onClick:()=>setOpen(false),title:"Close (Esc)"},
              React.createElement(Icon.x,{s:16}))),
          React.createElement("div",{className:"copybox-modal-body"},text))),
      document.body)
  );
}

/* drop a dangling, mid-word fragment left by an older hard-truncation (e.g.
   "...broken things. N") back to the last complete sentence. Display-only and
   safe: text that already ends cleanly is returned unchanged. */
function tidyTruncated(s){
  s = String(s||"").trim();
  if(!s || /[.!?\u2026"')\]]$/.test(s)) return s;   // already ends cleanly
  const m = s.match(/^[\s\S]*[.!?\u2026]/);          // cut back to the last sentence end
  return m ? m[0].trim() : s;
}

function SheetField({ label, value, placeholder, multiline, list, onCommit, onItemRemoved, onItemRenamed, ownerName }){
  return React.createElement("div",{className:"sheet-field"},
    React.createElement("div",{className:"obj-lab"},label),
    list
      ? React.createElement(EditableItemList,{value,placeholder,onCommit,onItemRemoved,onItemRenamed,ownerName})
      : React.createElement(EditText,{value,placeholder,multiline,onCommit}));
}

function PaletteRow({ palette }){
  return React.createElement("div",{className:"pal-row"},
    palette.map((p,i)=>React.createElement("div",{key:i,className:"pal-chip",title:p.name+" "+p.hex},
      React.createElement("span",{className:"pal-sw",style:{background:p.hex}}),
      React.createElement("span",{className:"pal-name"},p.name))));
}

function CardFold({ label, count, defaultOpen, children, foldId }){
  const [open, setOpen] = React.useState(!!defaultOpen);
  const ref = React.useRef(null);
  // Tap-to-jump: attention strips elsewhere on the card dispatch nb-open-fold with
  // this fold's id — the fold opens itself, scrolls into view and flashes, so the
  // banner takes the user to the exact section instead of just naming it.
  React.useEffect(()=>{ if(!foldId) return;
    const h=(e)=>{ if(!e || e.detail!==foldId) return;
      setOpen(true);
      setTimeout(()=>{ const el=ref.current; if(!el) return;
        try{ el.scrollIntoView({behavior:"smooth",block:"start"}); }catch(err){}
        el.classList.remove("fold-flash"); void el.offsetWidth; el.classList.add("fold-flash");
        setTimeout(()=>{ if(ref.current) ref.current.classList.remove("fold-flash"); },2000);
      },60); };
    window.addEventListener("nb-open-fold",h);
    return ()=>window.removeEventListener("nb-open-fold",h); },[foldId]);
  return React.createElement("div",{className:"sheet-fold "+(open?"open":""),ref:ref},
    React.createElement("button",{className:"sheet-fold-head",onClick:()=>setOpen(o=>!o)},
      React.createElement("span",{className:"sheet-fold-ic"},React.createElement(open?Icon.chevD:Icon.chevR,{s:12})),
      React.createElement("span",{className:"sheet-sec",style:{margin:0,border:0,padding:0}},label),
      count!=null && React.createElement("span",{className:"sheet-fold-count"},count)),
    open && React.createElement("div",{className:"sheet-fold-body"},children));
}

/* RecentlyDeleted — the per-tab restore bin. Lists soft-deleted characters / props /
   locations / shots (each kept with its scenes, full spec and generated sheet) with Restore and
   Delete-forever. Collapsed by default; renders nothing when the bin is empty. Shared by
   Art Room tabs via window.RecentlyDeleted. */
function RecentlyDeleted({ items, kind, onRestore, onPurge, compact }){
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  const itemCount = (items||[]).length;
  React.useEffect(()=>{
    if(!compact || !open || !itemCount) return;
    const dismiss = (e)=>{
      if(e.type==="keydown" && e.key!=="Escape") return;
      if(e.type==="pointerdown" && rootRef.current && rootRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown",dismiss);
    document.addEventListener("keydown",dismiss);
    return ()=>{
      document.removeEventListener("pointerdown",dismiss);
      document.removeEventListener("keydown",dismiss);
    };
  },[compact,open,itemCount]);
  if(!itemCount) return null;
  const noun = kind==="character" ? "character" : kind==="location" ? "location" : kind==="shot" ? "shot"
    : kind==="reference" ? "reference" : "prop";
  const labelFor = (it)=>{
    if(!it) return "Untitled "+noun;
    if(it.name || it.title) return it.name || it.title;
    if(kind==="shot"){
      const letter = String.fromCharCode(64 + Math.max(1, Number(it.order)||1));
      const beat = Number(it.beatN)||1;
      const action = String(it.action || it.vidText || it.text || "").trim();
      return "Beat "+beat+letter+(action ? " — "+action : "");
    }
    return "Untitled "+noun;
  };
  const rel = (iso)=>{ if(!iso) return ""; const ms=Date.now()-new Date(iso).getTime();
    const m=Math.round(ms/60000); if(m<1) return "just now"; if(m<60) return m+"m ago";
    const h=Math.round(m/60); if(h<24) return h+"h ago"; return Math.round(h/24)+"d ago"; };
  const rows = React.createElement("div",{className:"rd-list"},
    items.map(it=>React.createElement("div",{key:it.id,className:"rd-row"},
      React.createElement("span",{className:"rd-name",title:labelFor(it)}, labelFor(it)),
      it._deletedAt && React.createElement("span",{className:"rd-when"}, rel(it._deletedAt)),
      onRestore && React.createElement("button",{className:"rd-restore",onClick:()=>onRestore(it.id),"aria-label":"Restore "+labelFor(it),
        title: kind==="reference" ? "Restore this reference with its mood frame" : "Restore this "+noun+" with its scenes & spec"},
        React.createElement(Icon.undo,{s:12}),"Restore"),
      onPurge && React.createElement("button",{className:"rd-purge",title:"Delete forever","aria-label":"Delete "+labelFor(it)+" forever",
        onClick:async ()=>{ const ok=await window.appConfirm({ title:"Delete “"+labelFor(it)+"” forever?",
          // EVERYTHING THAT GOES, NAMED (2026-10-09, owner — Art Room review): a character also loses its variant and
          // scale sheets, the likeness photos you uploaded and its voice; a prop its state sheets
          body:"This permanently removes it and its "+(kind==="reference" ? "mood frame"
            : kind==="shot" ? "frame and its earlier versions"
            : kind==="location" ? "plates (its time-of-day and camera-view plates, and its own rooms & times plates)"
            : kind==="character" ? "master sheet, appearance-variant sheets and scale sheet, the likeness photos you uploaded (on this device and in the cloud) and its voice"
            : kind==="prop" ? "reference sheet and its state sheets"
            : "reference sheet")+" from the project. This can't be undone.",
          confirmLabel:"Delete forever", danger:true });
          if(ok && onPurge) onPurge(it.id); }},
        React.createElement(Icon.x,{s:12})))));
  if(compact) return React.createElement("div",{ref:rootRef,className:"recently-deleted rd-compact"+(open?" open":"")},
    React.createElement("button",{className:"rd-trigger",onClick:()=>setOpen(o=>!o),
      title:"Recently deleted "+noun+"s", "aria-label":"Recently deleted "+noun+"s", "aria-expanded":open},
      React.createElement(Icon.trash,{s:14}),
      React.createElement("span",{className:"rd-count"},itemCount)),
    open && React.createElement("div",{className:"rd-popover",role:"dialog","aria-label":"Recently deleted "+noun+"s"},
      React.createElement("div",{className:"rd-popover-head"},
        React.createElement("span",null,"Recently deleted"),
        React.createElement("span",{className:"rd-count"},itemCount)),
      rows));
  return React.createElement("div",{ref:rootRef,className:"recently-deleted"+(open?" open":"")},
    React.createElement("button",{className:"rd-head",onClick:()=>setOpen(o=>!o),"aria-expanded":open?"true":"false"},
      React.createElement(Icon.trash,{s:12}),
      React.createElement("span",null,"Recently deleted"),
      React.createElement("span",{className:"rd-count"},itemCount),
      React.createElement("span",{className:"rd-chev"}, React.createElement(open?Icon.chevD:Icon.chevR,{s:12}))),
    open && rows);
}
window.RecentlyDeleted = RecentlyDeleted;

/* StateRow — one appearance state (continuity variant) as its own v2+ sheet, generated
   as an identity-locked edit of the base character sheet so the variant is provably the
   same character. Falls back to a text spec when no base image exists yet. */
function StateRow({ c, st, index, project, scenes, props, drafts, baseGenUrl, onView, onChange, onDelete }){
  const vtag = "v"+(index+2);
  const stateId = c.id+":"+st.id;
  const baseFinal = (typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : buildCharRefPrompt(c, project, props);
  const changeText = ()=> (st.change||"").replace(/\.$/,"").trim();

  const buildFromBase = ()=>
    "Edit this character design sheet for "+(c.name||"the character")+". "
    +"Apply this appearance change: "+(changeText()||"(no specific change given)")+". "
    +"Keep the EXACT same face, hair colour and style, skin tone, body proportions and identity in every view \u2014 "
    +"only the described change should differ from the reference. "
    +"Maintain the reference sheet's EXISTING layout, panel arrangement, render style and framing. Do not re-imagine the character.";
  const buildFinal = ()=> baseFinal + " APPEARANCE STATE \u2014 "+(st.label||"variant")+": "
    + (changeText()||"") + ". Render the character in THIS changed state consistently across every panel.";
  const buildSimple = (o)=> buildSimpleCharPromptFor(c, o) + " " + (changeText()||"");
  const buildLikenessVariant = (ctx)=> turnLikenessVariantPrompt(c, st, project, props, ctx);

  const gen = useImageGen({
    id: stateId, slotId: "charref-"+stateId,
    entity: { ...c, appearanceState:st },
    identityCharacter: c, identityCharacterIds:[c.id], identityCast:[c],
    identityContext:{ characterIds:[c.id], scenes, drafts, cast:[c] },
    cameoId: c.id,
    buildFinal: buildFinal,
    buildFromBase: baseGenUrl ? buildFromBase : null,
    referenceFallback: baseGenUrl ? (()=>baseGenUrl) : null,
    referenceFallbackId: baseGenUrl ? c.id : null,
    // a dropped photo with no master: a sheet FROM the photo in this state (it used to say "edit this design
    // sheet… keep its existing layout" with a photo that is no sheet)
    buildFromPhoto: ()=> baseGenUrl ? buildFromBase()
      : buildRefFromPhotoPrompt(c, project)+" APPEARANCE STATE \u2014 "+(st.label||"variant")+": "+(changeText()||"")+". Render the character in THIS changed state consistently across every panel.",
    /* LIKENESS (2026-10-10, owner — Likeness review): from the master (image after the angles) the variant
       changes only what the state says; with no master yet it is a proper sheet FROM the face and the
       face-free spec. The runner adds the numbered map and the likeness sentence. */
    buildLikeness: buildLikenessVariant,
    // which master this variant was made from — a regenerated master flags it (2026-10-06)
    metaExtra: async ({ mode })=> mode==="base" ? { baseMasterIso: (((typeof nbGetMeta==="function") && nbGetMeta(c.id))||{}).iso||"" } : {},
    buildSimple: buildSimple,
    beforeGenerate: ()=> (window.turnLikenessUnavailableGate||(async()=>true))(c, (window.turnLikenessRefCount||(()=>0))(c.id) + (baseGenUrl?1:0)),
    buildEdit: (instr)=>
      "Edit this character design sheet for "+(c.name||"the character")+" ("+(st.label||"variant")+" state). "
      +"Apply ONLY this change: "+instr+". Preserve the same face, identity and the "+(st.label||"variant")
      +" appearance otherwise, in every view. Keep the sheet's existing layout. Do not re-imagine the character.",
  });
  const viewEntity = { ...c, name: c.name+" \u2014 "+(st.label||"variant") };

  return React.createElement("div",{className:"state-row"},
    React.createElement("div",{className:"state-row-head"},
      React.createElement("span",{className:"state-vtag"},vtag),
      React.createElement("div",{className:"state-label"},
        React.createElement(EditText,{value:st.label,placeholder:"State name\u2026",onCommit:val=>onChange({label:val})})),
      st.suggested && React.createElement("span",{className:"state-ai-chip",title:"Suggested from the script"},"AI"),
      React.createElement("button",{className:"state-del",title:"Remove state",onClick:onDelete},React.createElement(Icon.x,{s:14}))),
    React.createElement(SheetFrame,{ gen, slotId:"charref-"+stateId, name:viewEntity.name,
      avatarColor:c.color, initials:vtag, drafted:true, drafting:false, onDraft:()=>{}, entity:viewEntity,
      onView, slotPlaceholder:"Generate this appearance state", noun:vtag+" sheet", dropToImport:true,
      // with a likeness, the price counts its photos (+ the master): GPT Image charges every image sent
      generateRefs: gen.likenessRefs ? (gen.likenessRefs + (baseGenUrl?1:0)) : undefined }),
    gen.genUrl && React.createElement("div",{className:"card-qa-row"},
      React.createElement(QaCheckButton,{ gen, name:(viewEntity.name||"")+" \u00b7 "+(st.label||vtag), noun:vtag+" sheet",
        specFields:()=>({ what_changed:(st.change||"") }),
        onApplySpec:(patch)=>{ if(patch.what_changed!=null) onChange({ change:patch.what_changed, suggested:false }); } })),
    !baseGenUrl && React.createElement("div",{className:"state-hint"},
      React.createElement(Icon.alert,{s:12}),
      gen.likenessUsable
        ? "No master sheet yet \u2014 this variant is made from the locked likeness and the text spec. Generate the base sheet above to keep the wardrobe and layout identical."
        : "Generate the base sheet above for identity-locked results \u2014 until then this uses the text spec."),
    gen.genUrl && gen.likenessStale && React.createElement("div",{className:"state-hint stale"},
      React.createElement(Icon.alert,{s:12}), "Made with an earlier likeness \u2014 regenerate this variant to update it."),
    (gen.likeness && gen.likeness.available===false) && React.createElement("div",{className:"state-hint"},
      React.createElement(Icon.alert,{s:12}), (window.turnLikenessUnavailableText||(()=>""))(c.id, c.name)),
    (()=>{ const m = gen.genMeta, masterIso = ((typeof nbGetMeta==="function" && nbGetMeta(c.id))||{}).iso||"";
      return gen.genUrl && m && m.baseMasterIso && masterIso && m.baseMasterIso!==masterIso && React.createElement("div",{className:"state-hint stale"},
        React.createElement(Icon.alert,{s:12}), "Made from an older master sheet \u2014 regenerate this variant so it matches the current one."); })(),
    !st.sceneId && React.createElement("div",{className:"state-hint"},
      React.createElement(Icon.info||Icon.alert,{s:12}),
      "Not pinned \u2014 no shot uses this state until you pick the scene it first appears in (below)."),
    React.createElement(SheetField,{label:"What changed",value:st.change,multiline:true,
      placeholder:"The visible difference from the base look \u2014 torn shirt, cut brow, dried blood\u2026",
      onCommit:val=>onChange({change:val,suggested:false})}),
    React.createElement("div",{className:"sheet-field"},
      React.createElement("div",{className:"obj-lab"},"First appears in"),
      React.createElement("select",{className:"prop-select",value:st.sceneId||"",onChange:e=>onChange({sceneId:e.target.value})},
        React.createElement("option",{value:""},"Not pinned"),
        scenes.map(s=>React.createElement("option",{key:s.id,value:s.id},"Sc "+s.no+" \u00b7 "+s.title)))));
}

function CharacterSheet({ c, readOnly=false, wardrobeStale=false, project, scenes, props, drafts, cast, speaks, voiceOpen, onOpenVoice, onCloseVoice, onUpdate, onDraft, drafting, onView, onSuggestStates, suggestingStates, onBuildWornProps, onRemoveOwnedItem, onRenameOwnedItem, onDraftProp, onCreateOwnedProp, batchActiveId, onBatchDone, onDelete }){
  const drivenScenes = scenes.filter(s=>s.driver===c.id);
  const driven = drivenScenes.length;
  // ALL scenes this character appears in (drives OR is named in the script/summary), not
  // just the ones they drive — driven scenes are marked so both reads at a glance.
  const drivenIds = new Set(drivenScenes.map(s=>s.id));
    const appearsScenes = React.useMemo(()=>{
    const ids = (typeof scenesWhereCharacterAppears==="function")
      ? scenesWhereCharacterAppears(c.id, c.name, scenes, drafts)
      : drivenScenes.map(s=>s.id);
    const set = new Set(ids);
    return scenesInStoryOrder((scenes||[]).filter(s=>set.has(s.id)));
  },[c.id, c.name, scenes, drafts]);
  // role packs FUNCTION · ARCHETYPE — IDENTITY in one string; show & edit each
  // part as its own labelled line, re-composed back into c.role on every edit.
  const roleParts = parseRole(c.role);
  const setRolePart = (patch)=> onUpdate(c.id, { role: composeRole({ ...roleParts, ...patch }) });
  // Narrative role fields are rendered inside the physical Identity fold so the
  // header stays compact and the character definition lives in one place.
  const v = charVisualDefaults(c);
  const promptText = buildCharRefPrompt(c, project, props);
  const finalPrompt = (typeof combinedImagePrompt==="function") ? combinedImagePrompt(c, project, props) : promptText;
  const drafted = charVisualsDrafted(c);
  const initials = c.name.split(" ").map(w=>w[0]).slice(0,2).join("");
  const palette = (c.palette && c.palette.length) ? c.palette : v.palette;

  /* props this character owns (carried/worn) — their generated sheets become extra
     visual references when generating this character's sheet */
  const ownedProps = (props||[]).filter(p=>p.ownerId===c.id);
  /* CUSTODY handovers TO this character (canonical owner is someone else) — informational
     chips only; the prop's card, sheets and style anchor stay with its owner. */
  const handoversTo = (p)=> (typeof propHandoverEvents==="function" ? propHandoverEvents(p, scenes) : [])
    .filter(e=> e.holderId===c.id);
  const custodyProps = (props||[]).filter(p=> p && p.ownerId && p.ownerId!==c.id && handoversTo(p).length);
  // Only WORN props become part of the character SHEET (glasses, coat, watch — the
  // permanent look). CARRIED props (phone, gun, pills) are situational, so they're
  // attached at the SHOT level instead, never baked into the neutral turnaround.
  const wornProps = ownedProps.filter(p=> p.kind!=="carried");
  const wornExclusionIds = Array.isArray(c.wornReferenceExclusions) ? c.wornReferenceExclusions : [];
  const wornExclusionKey = wornExclusionIds.slice().sort().join(",");
  const wornExclusions = React.useMemo(()=>new Set(wornExclusionIds),[wornExclusionKey]);
  const includedWornProps = wornProps.filter(p=>!wornExclusions.has(p.id));
  const setWornReferenceIncluded = (propId, included)=>{
    const next = new Set(wornExclusionIds);
    if(included) next.delete(propId); else next.add(propId);
    onUpdate(c.id,{ wornReferenceExclusions:Array.from(next) });
  };
  /* "orphans" = prop cards that were DERIVED from the cast (fromCast) but whose name
     no longer matches any worn/carried bullet above — i.e. leftovers from an old bad
     text-split like "Aud" or "Possessive)". Curated / hand-added props (fromCast not
     set) are never flagged, since they're allowed to exist without a matching bullet. */
  // "And a silver ring" and "a silver ring" are the same item — strip the conjunction too
  const normName = s=> String(s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").replace(/^(?:and-|then-)/,"").slice(0,40);
  /* Resolve each WORN/CARRIED bullet to its prop card. Exact normalised-name match
     first; when that fails (a re-draft re-worded the item, or the card was drafted
     from older text) fall back to the OBJECT — same head noun, then strong word
     overlap — so the link survives re-phrasings. Each card matches at most once. */
  const linkInfo = React.useMemo(()=>{
    const split = (typeof splitListItems==="function") ? splitListItems : (v=>String(v||"").split(","));
    const byNorm = {};
    ownedProps.forEach(p=>{ const n=normName(p.name); if(!(n in byNorm)) byNorm[n]=p; });
    const claimed = new Set();
    /* descriptor words shared by MANY different objects — never evidence two
       names mean the same thing (the object words have to do that) */
    const STOP = new Set(["worn","carried","with","without","around","behind","over","under","left","right",
      "thin","small","large","heavy","wide","long","short","black","white","grey","gray","dark","pale",
      "vintage","simple","plain","portable","battered","tarnished","brushed","polished","unpolished",
      "subtle","filled","wrapped","showing","holding","their","there","that","this","into","onto"]);
    const wordsOf = (s)=> (String(s||"").toLowerCase().match(/[a-z]{4,}/g) || []).filter(w=>!STOP.has(w));
    /* score every unclaimed card and take the best: shared object-words count
       double, the card's head noun appearing in the bullet adds one. A score
       under 3 (i.e. less than 2 shared words, or 1 word + the object noun) is
       not evidence — better an honest "no sheet yet" than a wrong link. */
    const fuzzyProp = (item)=>{
      const toks = new Set(wordsOf(item));
      const low = " "+String(item).toLowerCase()+" ";
      let best=null, bestScore=0;
      ownedProps.forEach(p=>{ if(claimed.has(p.id)) return;
        const shared = wordsOf(p.name).filter(t=>toks.has(t)).length;
        const candHead = (typeof propHeadNoun==="function") ? propHeadNoun(p.name) : "";
        const headHit = candHead && low.indexOf(" "+candHead)>=0 ? 1 : 0;
        const score = shared*2 + headHit;
        if(score>=3 && score>bestScore){ best=p; bestScore=score; } });
      return best;
    };
    /* two passes: every EXACT match claims its card first, then re-phrasings
       fall back to the object — so a fuzzy match can never steal a card whose
       exact bullet appears later in the list */
    // "none" / "n/a" are the drafter's placeholders for EMPTY, never items — without
    // this they render as phantom "none · NO SHEET YET" linked-prop rows
    const bullets = [...split(c.accessories).map(t=>({ t, src:"worn" })), ...split(c.props).map(t=>({ t, src:"carried" }))]
      .filter(b=>{ const n=normName(b.t); return n && !/^(none|n-?a|nothing|no-items?)$/.test(n); });
    const match = bullets.map(b=>{
      const exact = byNorm[normName(b.t)];
      if(exact && !claimed.has(exact.id)){ claimed.add(exact.id); return exact; }
      return null;
    });
    bullets.forEach((b,i)=>{ if(match[i]) return;
      const m = fuzzyProp(b.t); if(m){ claimed.add(m.id); match[i]=m; } });
    const rows = bullets.map((b,i)=>(
      { key:"b-"+normName(b.t)+"-"+i, name: match[i]?match[i].name:b.t, prop: match[i]||null, orphan:false, src:b.src }));
    /* orphans = cast-derived cards no bullet claimed (even fuzzily) — true leftovers */
    const orphans = ownedProps.filter(p=> p.fromCast && !claimed.has(p.id));
    orphans.forEach(p=> rows.push({ key:"o-"+p.id, name:p.name, prop:p, orphan:true }));
    return { rows, orphans };
  },[c.accessories, c.props, ownedProps.map(p=>p.id).join(",")]);
  const linkedRows = linkInfo.rows;
  const orphanProps = linkInfo.orphans;
  const collectAttachments = async ()=>{
    const out = [];
    for(const p of includedWornProps){
      let url = (typeof nbGetImage==="function") ? nbGetImage(p.id) : "";
      if(!url && typeof nbLoadImage==="function"){ try{ url = await nbLoadImage(p.id); }catch(e){} }
      if(url) out.push({ url, note: p.name+(p.kind?(" ("+p.kind+")"):""), refId:p.id });
    }
    return out;
  };
  /* which owned props currently have a generated sheet (for the linked-props indicator) */
  const [ownedSheetMap, setOwnedSheetMap] = React.useState({});
  // every image a fresh master sends (GPT Image charges each): the likeness photos + the worn-item sheets
  const wornSheetCount = includedWornProps.filter(p=>ownedSheetMap[p.id]).length;
  const cardGenerateRefs = ()=> (window.turnLikenessRefCount||(()=>0))(c.id) + wornSheetCount;
  // worn items with no sheet of their own yet (no card, or a card without a sheet)
  const missingWorn = linkedRows.filter(r=> !r.orphan && r.src==="worn" && !(r.prop && ownedSheetMap[r.prop.id])).length;
  const wornBuilding = !!(c.wornPropBootstrap && c.wornPropBootstrap.status==="running"
    && c.wornPropBootstrap.startedAt && Date.now()-new Date(c.wornPropBootstrap.startedAt).getTime()<30*60*1000);
  const [sheetTick, setSheetTick] = React.useState(0);   // bump to re-check sheet presence
  // inline per-row prop generation (user ruling 2026-07-18: generate a linked prop's
  // sheet right from the character card — no Props-tab hop). kind: "draft"|"gen".
  const [propBusy, setPropBusy] = React.useState(null);   // {id, kind}
  React.useEffect(()=>{
    let alive=true;
    (async()=>{
      const m={};
      for(const p of ownedProps){
        let url=(typeof nbGetImage==="function")?nbGetImage(p.id):"";
        if(!url && typeof nbLoadImage==="function"){ try{ url=await nbLoadImage(p.id);}catch(e){} }
        m[p.id]=url||"";
      }
      if(alive) setOwnedSheetMap(m);
    })();
    return ()=>{alive=false;};
  },[ownedProps.map(p=>p.id).join(","), ownedProps.length, sheetTick]);
  /* refresh prop-readiness when one of THIS character's props finishes generating
     (e.g. the inline "generate props first" flow completing after a tab switch). */
  React.useEffect(()=>{
    const ids = new Set(ownedProps.map(p=>p.id));
    const onDone = (e)=>{ const did = e && e.detail && e.detail.id; if(did && ids.has(did)) setSheetTick(t=>t+1); };
    window.addEventListener("nb-gen-done", onDone);
    return ()=>window.removeEventListener("nb-gen-done", onDone);
  },[ownedProps.map(p=>p.id).join(",")]);

  /* appearance states (continuity variants) */
  const states = c.states || [];
  const updateStates = (next)=> onUpdate(c.id, { states: next });

  const [showPrompt, setShowPrompt] = React.useState(false);   // the ⋯ menu's "Show the sheet prompt"
  const alwaysPrompts = useArtAlwaysPrompts();   // the ⋮ menu's "Always show prompts" opens it on every card
  /* cameo (locked likeness) — Increment A */
  const [cameoOpen, setCameoOpen] = React.useState(false);
  const [cameoMeta, setCameoMeta] = React.useState(()=> (typeof nbCameoMeta==="function") ? nbCameoMeta(c.id) : null);
  /* voice (locked timbre) — lives on the card now, parallel to Cameo */
  const voiceLocked = !!(c.voiceLock && c.voiceLock.voiceId);
  // render-style picker: which visual language the sheet is drawn in (per character). For
  // "surprise" we invent a bespoke style from the bible (once) and cache it on the card.
  const [styling, setStyling] = React.useState(false);
  // the "saved · unlock" chip is a TRANSIENT confirmation — show ~4s after the card lands on one
  // of the user's own locked styles, then auto-hide (unlock later via the Styles manager).
  const [unlockVisible, setUnlockVisible] = React.useState(false);
  React.useEffect(()=>{
    if(window.turnIsUserStyle && window.turnIsUserStyle(c.renderStyleKey)){
      setUnlockVisible(true); const t=setTimeout(()=>setUnlockVisible(false),4000); return ()=>clearTimeout(t);
    }
    setUnlockVisible(false);
  },[c.renderStyleKey]);
  const pickRenderStyle = async (key)=>{
    if(key!=="surprise"){ onUpdate(c.id, { renderStyleKey:key }); return; }
    onUpdate(c.id, { renderStyleKey:"surprise" });
    if(c.surpriseRender && c.surpriseRender.render) return;   // already invented — keep it
    if(typeof aiSurpriseRenderStyle!=="function" || !(typeof aiAvailable==="function" && aiAvailable())) return;
    setStyling(true);
    try{ const r = await aiSurpriseRenderStyle(c, project); if(r) onUpdate(c.id, { surpriseRender:r }); }
    catch(e){} finally{ setStyling(false); }
  };
  const reSurprise = async ()=>{
    if(typeof aiSurpriseRenderStyle!=="function" || styling) return;
    setStyling(true);
    try{ const r = await aiSurpriseRenderStyle(c, project); if(r) onUpdate(c.id, { surpriseRender:r }); }
    catch(e){} finally{ setStyling(false); }
  };
  // LOCK a surprise style the user likes → a reusable named style (Characters/Props/Locations)
  const lockSurprise = async ()=>{
    if(!(c.surpriseRender && c.surpriseRender.render) || typeof window.turnLockRenderStyle!=="function") return;
    const key = await window.turnLockRenderStyle(c.surpriseRender.label, c.surpriseRender.render);
    if(key){ onUpdate(c.id, { renderStyleKey:key });
      if(typeof window.appToast==="function") window.appToast("Style locked — now reusable across Characters, Props & Locations"); }
  };
  const unlockCurrent = async ()=>{
    if(!(window.turnIsUserStyle && window.turnIsUserStyle(c.renderStyleKey))) return;
    const ok = window.appConfirm ? await window.appConfirm({ title:"Unlock this saved style?",
      body:"It's removed from your saved styles. Cards still using it fall back to their scale-aware default render style." }) : true;
    if(!ok) return; const k=c.renderStyleKey; window.turnUnlockRenderStyle(k); onUpdate(c.id,{ renderStyleKey:"" });
  };
  const refreshCameo = ()=>{ if(typeof nbCameoMeta==="function") setCameoMeta(nbCameoMeta(c.id)); };
  // (2026-10-10, owner — Likeness review) removing a likeness revokes it where it lives (this device, the cloud
  // copy and its photos) and offers to clear the sheets made with the face (cameo.jsx cameoRevokeFlow)
  const removeCameo = async ()=>{
    if(typeof window.cameoRevokeFlow==="function"){
      const stateLabel = (sheetId)=>{ const sid = String(sheetId||"").split(":")[1]; const st = (c.states||[]).find(x=>x && x.id===sid); return st ? st.label : ""; };
      await window.cameoRevokeFlow(c.id, { name:c.name, stateLabel });
      refreshCameo(); return;
    }
    const ok = await window.appConfirm({
      title: "Remove "+c.name+"'s likeness?",
      body: "New sheets won't use this face. Sheets already made keep it until you regenerate them.",
      confirmLabel: "Remove", danger: true,
    });
    if(!ok) return;
    if(typeof nbClearCameo==="function"){
      const r = await nbClearCameo(c.id);
      if(r && r.ok===false && typeof window.appToast==="function") window.appToast(r.message || "Couldn't remove the likeness.","error");
    }
    refreshCameo();
  };
  // id carries a random suffix: two Adds in the same millisecond must not share one
  // asset slot (both variants would overwrite/clear each other's image)
  const addState = ()=> updateStates([...states, { id:"st-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6), label:"New state", change:"", sceneId:"" }]);
  const updateState = (id,patch)=> updateStates(states.map(s=>s.id===id?{...s,...patch}:s));
  const deleteState = async (id)=>{
    const vid = c.id+":"+id;
    // (2026-10-06) it asks first: the variant image is removed for good, and the later states' labels move up
    const st0 = states.find(s=>s.id===id);
    if(typeof window.appConfirm==="function"){
      const has = (typeof nbGetImage==="function") && !!nbGetImage(vid);
      const ok = await window.appConfirm({ title:"Remove the appearance state \u201c"+((st0&&st0.label)||"variant")+"\u201d?",
        body:(has ? "Its variant sheet is removed for good. " : "")+"Shots that used it will use "+(c.name||"the character")+"'s earlier look instead, and the later states' version numbers move up.",
        confirmLabel:"Remove state", cancelLabel:"Cancel", danger:true });
      if(!ok) return;
    }
    // stop any in-flight variant generation first (a late commit would recreate the
    // asset we're about to clear), and AWAIT the clear so it can't land after a
    // later re-creation of the same slot
    try{ if(typeof window.nbCancelGen==="function") window.nbCancelGen(vid); }catch(e){}
    if(typeof nbClearAsset==="function"){ try{ await nbClearAsset(vid); }catch(e){} }
    updateStates(states.filter(s=>s.id!==id));
  };
  const gen = useImageGen({
    id: c.id, slotId: "charref-"+c.id,
    entity: c,
    identityCharacter: c, identityCharacterIds:[c.id], identityCast:[c],
    identityContext:{ characterIds:[c.id], scenes, drafts, cast:[c] },
    cameoId: c.id,
    /* Clear cascades to this character's appearance-state variant sheets so they
       aren't orphaned (cameo + linked props are preserved). */
    relatedClearIds: ()=> (c.states||[]).map(s=> c.id+":"+s.id),
    buildFinal: ()=> finalPrompt,
    buildFromPhoto: ()=> buildRefFromPhotoPrompt(c, project),
    buildFromBase: ()=> "Update this existing master character sheet for "+(c.name||"the character")+". "
      +"Preserve the EXACT same face, hair, skin tone, age, build, body proportions, identity, panel layout, framing and render style from the base sheet. "
      +"Apply the current production specification and worn-reference designs below without re-casting or re-imagining the character. "
      +finalPrompt,
    /* LIKENESS (2026-10-10, owner — Likeness review): the face-free spec — the runner adds the numbered
       image map and the likeness sentence (turnLikenessPlan) */
    buildLikeness: (ctx)=> turnLikenessMasterPrompt(c, project, props, ctx),
    buildSimple: (o)=> buildSimpleCharPromptFor(c, o),
    // a likeness this person can't use here is said before anything is spent (a shared film)
    beforeGenerate: ()=> (window.turnLikenessUnavailableGate||(async()=>true))(c, cardGenerateRefs()),
    refCounts: ()=>({ generate:cardGenerateRefs(), attach:wornSheetCount }),
    attachments: wornProps.length ? collectAttachments : null,
    attachmentsText: (attach)=> "The additional reference image"+(attach.length>1?"s are":" is")
      +" APPROVED worn-prop design"+(attach.length>1?"s":"")+". Lock "
      +attach.map(a=>a.note||"the item").join(", ")+" onto the character exactly, preserving each object's shape, material, colour, wear and scale. "
      +"Worn items without an attached image remain governed by the textual specification.",
    // record WHICH worn-prop text was baked into this sheet — the card's stale badge
    // compares it against the current cards (edits after generation desync the canon)
    metaExtra: async ({refsUsed})=>{
      const usedIds = new Set((refsUsed||[]).map(r=>r&&r.refId).filter(Boolean));
      const wornReferences = await loadWornReferenceSnapshot(c, wornProps, usedIds);
      const visual = wornReferences.filter(r=>r.mode==="visual").length;
      return {
        specPrompt:finalPrompt,
        wornSig:(typeof wornPropsSig==="function") ? wornPropsSig(wornProps, c.id) : "",
        wornReferences,
        wornRefSummary:{ total:wornReferences.length, visual, text:wornReferences.length-visual },
      };
    },
    buildEdit: (instr)=>
      "Edit this character design sheet for "+(c.name||"the character")+". "
      +"Apply ONLY this change: "+instr+". "
      +"Preserve everything else without alteration \u2014 the exact same face, hair colour and style, "
      +"skin tone, body proportions, and physical identity in every view. "
      +"Keep the sheet's existing layout and panel arrangement. "
      +"Do not replace or re-imagine the character.",
  });

  // SCALE SHEET — the height-chart asset (its own slot). Rendered FROM the master sheet so
  // identity matches, on a PORTRAIT canvas, with the ruler markings for this character's
  // scale class. The generate button forces 9:16 regardless of the engine-dock aspect.
  const scaleSheetGen = useImageGen({
    id: "charscale-"+c.id, slotId: "charscale-"+c.id,
    entity: c,
    identityCharacter: c, identityCharacterIds:[c.id], identityCast:[c],
    identityContext:{ characterIds:[c.id], scenes, drafts, cast:[c] },
    buildFinal:    ()=> (typeof buildScaleSheetPrompt==="function") ? buildScaleSheetPrompt(c) : "",
    buildSimple:   ()=> (typeof buildScaleSheetPrompt==="function") ? buildScaleSheetPrompt(c) : "",
    buildFromBase: ()=> (typeof buildScaleSheetPrompt==="function") ? buildScaleSheetPrompt(c) : "",
    referenceFallback: async ()=>{ let u=(typeof nbGetImage==="function")?nbGetImage(c.id):"";
      if(!u && typeof nbLoadImage==="function"){ try{ u=await nbLoadImage(c.id); }catch(e){} } return u||null; },
    referenceMaxDim: 768,
    buildEdit: (instr)=> "Edit this height/scale chart. Apply ONLY this change: "+instr+". Keep the figure, the vertical ruler and its markings otherwise identical.",
  });
  const scaleGenWrapped = Object.assign({}, scaleSheetGen, { generate:(o)=>scaleSheetGen.generate({ aspectRatio:"9:16", ...(o||{}) }) });
  // the likeness as the store reports it NOW (re-read on every render: cameoMeta / the store's event re-render the card)
  const lkInfo = (window.turnLikenessInfo||(()=>null))(c.id) || (gen.likeness || null);
  // batch generation: when this card is the active queue member, fire one generate
  // and report back when it settles (mirrors the Props/Locations cards).
  // REMOUNT-SAFE: a card can remount WHILE it is the active member and its generation
  // is already in flight (each commit re-renders the cast). A fresh instance's
  // batchStarted ref would start false, skip the fire-branch during gening, then wrongly
  // fire a SECOND generate on completion — two versions from one click. So seed the ref
  // from the module in-flight registry: if a generation is already running for this
  // slot, this instance treats itself as already-started and only reports completion.
  // registry is keyed by the GEN id (c.id — what useImageGen registers), NOT the
  // "charref-" reference-slot key; the slot key made this guard dead code (double
  // generation after a mid-batch remount)
  const _cgen = c.id;
  const batchStarted = React.useRef(!!(window.__nbGenInflight && window.__nbGenInflight[_cgen]));
  const wasGening = React.useRef(false);
  React.useEffect(()=>{
    const mine = batchActiveId===c.id;
    const inflight = !!(window.__nbGenInflight && window.__nbGenInflight[_cgen]);
    if(!mine){ batchStarted.current = inflight; wasGening.current=gen.gening; return; }
    if(!batchStarted.current && !gen.gening && !inflight){ batchStarted.current=true; wasGening.current=false; gen.generate({ batch:true }); return; }
    if(batchStarted.current && wasGening.current && !gen.gening){ batchStarted.current=false; onBatchDone && onBatchDone(c.id); }
    wasGening.current = gen.gening;
  },[batchActiveId, gen.gening, c.id]);

  return React.createElement("div",{className:"sheet-card"+(batchActiveId===c.id?" batch-on":"")+(voiceOpen?" voice-open":""),"data-char-card":c.id},
    React.createElement(SheetFrame,{ gen, slotId:"charref-"+c.id, name:c.name, avatarColor:c.color,
      initials, drafted, drafting, onDraft:()=>onDraft(c), entity:c, onView,
      slotPlaceholder:"Drop reference art", noun:"sheet",
      // The empty slot is also the finished-image importer (full resolution, like the Locations
      // plate), so the separate "Upload a finished sheet" button is intentionally omitted.
      dropToImport:true,
      // "Update a prop" chips in the sheet-edit panel: THIS character's own props
      // (worn or carried) that already have a locked prop sheet
      editPropRefs: ownedProps.filter(p=>ownedSheetMap[p.id]).map(p=>({id:p.id, name:p.name, kind:p.kind})),
      // with a likeness, the prices count every image the render sends (its photos, the worn-item sheets)
      generateRefs: gen.likenessRefs ? cardGenerateRefs() : undefined, attachRefs: wornSheetCount,
      generateTitle: gen.likenessUsable ? ((gen.genUrl ? "Generate a fresh sheet" : "Generate the sheet")+" from the current spec, with the locked likeness's face") : undefined,
      referenceControls: React.createElement(SheetReferenceStrip,{ gen, loadRefs:collectAttachments, onView,
        refreshKey:[c.id,wornProps.map(p=>p.id).join(","),wornExclusionKey,sheetTick].join("|") }),
      menuExtra:alwaysPrompts ? [] : [{ label:showPrompt ? "Hide the sheet prompt" : "Show the sheet prompt", icon:Icon.eye,
        onClick:()=>setShowPrompt(v=>!v) }],
      onDelete:onDelete?(()=>onDelete(c.id)):null, deleteLabel:"Delete character" }),
    React.createElement("div",{className:"sheet-body"},
      React.createElement("div",{className:"sheet-head"},
        React.createElement("div",{className:"sheet-head-top"},
          React.createElement("div",{className:"sheet-name",title:c.name||""},c.name),
          React.createElement("div",{className:"sheet-head-acts"},
            React.createElement("button",{className:"char-cameo-btn"+(lkInfo?" on":""),disabled:drafting,
              onClick:()=>setCameoOpen(true),
              title:lkInfo?"Likeness locked \u2014 recapture it with the webcam or photos":"Lock a real face as this character's likeness (webcam or photos)"},
              React.createElement(Icon.userScan,{s:12}), "Likeness"),
            React.createElement("button",{className:"char-voice-btn"+(voiceLocked?" on":"")+(voiceOpen?" open":""),type:"button",
              onClick:()=>onOpenVoice&&onOpenVoice(c.id),
              "aria-expanded":voiceOpen?"true":"false","aria-controls":"voice-popup-"+String(c.id||"character").replace(/[^A-Za-z0-9_-]/g,"-"),
              "data-testid":"voice-popup-trigger","data-character-id":c.id,
              title:voiceOpen?"Voice design is open on this character card":(voiceLocked?("Voice locked: "+((c.voiceLock&&c.voiceLock.voiceName)||"voice")+" \u2014 test or relock"):"Cast a voice \u2014 lock how this character sounds")},
              React.createElement(Icon.mic,{s:12}), "Voice"),
            React.createElement(QaCheckButton,{ gen, name:c.name, noun:"character sheet",
              specFields:()=>({ body:(c.coreBody||""), wardrobe:(c.wardrobeMask||c.wardrobe||""), accessories:(c.accessories||"") }),
              onApplySpec:(patch)=>{ const up={};
                if(patch.body!=null) up.coreBody=patch.body;
                if(patch.wardrobe!=null){ if((c.wardrobeMask||"").trim()) up.wardrobeMask=patch.wardrobe; else up.wardrobe=patch.wardrobe; }
                if(patch.accessories!=null) up.accessories=patch.accessories;
                onUpdate(c.id, up); } })))),
      // FACE AND VOICE, EACH ITS OWN (2026-10-11, owner — real voices): which face and which voice this character has —
      // "Face: Sam (likeness) · Voice: Sam (real voice)" / "Voice: designed" / "Voice: from the library"
      (()=>{ const line = (typeof window.vcFaceVoiceLine==="function") ? window.vcFaceVoiceLine(lkInfo, c.voiceLock) : "";
        return line ? React.createElement("div",{className:"char-cast-line","data-testid":"char-face-voice"},
          React.createElement(Icon.mic,{s:11}), React.createElement("span",null,line)) : null; })(),
      // UPDATE SHEET WITH NEW WARDROBE (owner 2026-10-06 — Characters review): the app pointed here from six
      // places, but the button didn't exist. The master doesn't wear its newly built worn-item sheets yet.
      wardrobeStale && gen.genUrl && !readOnly && React.createElement("div",{className:"sheet-cameo-status char-wardrobe-update"},
        React.createElement(Icon.layers||Icon.sparkles,{s:14}),
        React.createElement("span",{className:"scs-t"},"New wardrobe ready"),
        React.createElement("span",{className:"scs-meta"},"this sheet doesn't wear its new worn-item sheets yet"),
        React.createElement("button",{className:"scs-act",disabled:gen.gening,onClick:()=>gen.generate(),
          title:"Regenerate the master sheet wearing its worn items (one image)"},
          gen.gening?"Updating\u2026":"Update sheet with new wardrobe", !gen.gening && typeof window.nbCostChip==="function"
            && window.nbCostChip(1, gen.likenessRefs ? { refs:cardGenerateRefs() } : undefined))),
      // a likeness on this film this person can't use (a shared film): said on the card, before anything is spent
      (lkInfo && lkInfo.available===false) && React.createElement("div",{className:"sheet-cameo-status unavailable",role:"note"},
        React.createElement(Icon.userScan,{s:14}),
        React.createElement("span",{className:"scs-t"},"Likeness not available here"),
        React.createElement("span",{className:"scs-meta"}, (window.turnLikenessUnavailableText||(()=>""))(c.id, c.name))),
      (lkInfo && lkInfo.available!==false) && React.createElement("div",{className:"sheet-cameo-status"},
        React.createElement(Icon.userScan,{s:14}),
        React.createElement("span",{className:"scs-t"},"Likeness locked"),
        React.createElement("span",{className:"scs-meta"},
          ((lkInfo.angleCount||1)+" angle"+((lkInfo.angleCount||1)!==1?"s":""))+" \u00b7 "
          +(lkInfo.synced?"Synced":"On this device")+" \u00b7 "
          // (2026-10-06) says whether the sheet on display was made with it; (2026-10-10, owner — Likeness review)
          // a sheet made with an OLDER likeness says so (meta.cameoAt before the current capture)
          +((gen.genMeta && gen.genMeta.cameo)
            ? (gen.likenessStale ? "made with an earlier likeness \u2014 regenerate to update" : "applied to the sheet")
            : "regenerate to apply it to the sheet")),
        // locking stores the face-lock; it does NOT overwrite the sheet \u2014 this regenerates
        // the sheet WITH the locked face so the design matches the real person.
        React.createElement("button",{className:"scs-act",disabled:gen.gening,onClick:()=>gen.generate(),
          title:"Regenerate the character sheet with this face (one image)"}, gen.gening?"Applying\u2026":"Apply to sheet",
          !gen.gening && typeof window.nbCostChip==="function" && window.nbCostChip(1, { refs:cardGenerateRefs() })),
        lkInfo.mine!==false && React.createElement("button",{className:"scs-act",onClick:()=>setCameoOpen(true)},"Recapture"),
        lkInfo.mine!==false && React.createElement("button",{className:"scs-act danger",onClick:removeCameo},"Remove")),

      // render-style picker — the visual language the sheet is drawn in (always visible)
      React.createElement("div",{className:"char-style-row"},
        React.createElement("span",{className:"char-style-lab"},React.createElement(Icon.sparkles,{s:12}),"Render style"),
        React.createElement("div",{className:"char-style-pick"},
          React.createElement(window.RenderStylePicker,{value:(typeof inferCharacterRenderStyleKey==="function"?inferCharacterRenderStyleKey(c):(c.renderStyleKey||(window.turnDefaultRenderStyleKey?window.turnDefaultRenderStyleKey():"photoreal"))),disabled:styling,onPick:pickRenderStyle}),
          (window.turnCanLockStyles && window.turnCanLockStyles()) && React.createElement("span",{className:"char-style-count"+(((window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)>=(window.turnGlobalStyleCap||40))?" full":""),title:"Global render styles ("+(window.turnGlobalStyleCap||40)+" max, admin-managed). You can save up to "+(window.turnPersonalStyleCap||10)+" personal render styles. Manage via Styles in the top bar."}, (window.turnAllGlobalStyleCount?window.turnAllGlobalStyleCount():0)+"/"+(window.turnGlobalStyleCap||40))),
        styling && React.createElement("span",{className:"char-style-busy"},React.createElement("span",{className:"ns-spin"}),"Inventing…"),
        (!styling && c.renderStyleKey==="surprise" && c.surpriseRender && c.surpriseRender.label) &&
          React.createElement("span",{className:"char-style-name",title:"Re-roll a new surprise style",onClick:reSurprise},
            c.surpriseRender.label," ↻"),
        (!styling && c.renderStyleKey==="surprise" && c.surpriseRender && c.surpriseRender.render && window.turnCanLockStyles && window.turnCanLockStyles()) &&
          React.createElement("button",{className:"char-style-lock",title:"Lock this style — keep it and reuse it across Characters, Props & Locations",onClick:lockSurprise},"🔒 Lock this style"),
        (!styling && unlockVisible && window.turnIsUserStyle && window.turnIsUserStyle(c.renderStyleKey)) &&
          React.createElement("span",{className:"char-style-name char-style-locked",title:"Your saved style — reusable everywhere. Click to unlock.",onClick:unlockCurrent},"🔒 saved · unlock")),

      React.createElement("div",{className:"sheet-scenes character-scenes"},
        React.createElement("span",{className:"sheet-scenes-lab",title:"Every scene this character appears in (drives or is named in). Filled chips = scenes they drive."},"Scenes"),
        React.createElement(SceneChipPager,{ none:"none yet",
          items: appearsScenes.map(s=>({ key:s.id, label:String(s.no).padStart(2,"0"),
            className:"sheet-scene-chip"+(drivenIds.has(s.id)?" driven":""),
            title:(s.title||("Scene "+s.no))+(drivenIds.has(s.id)?" \u00b7 drives this scene":" \u00b7 appears") })) })),

      React.createElement(CardFold,{label:"Identity",defaultOpen:false},
        React.createElement("div",{className:"role-fields identity-role-fields"},
          React.createElement("div",{className:"role-line"},
            React.createElement("span",{className:"role-lab"},"Role"),
            React.createElement("div",{className:"sheet-role"},
              React.createElement(EditText,{value:roleParts.role,placeholder:"Function\u2014e.g. Antagonist",
                onCommit:val=>setRolePart({role:val})}))),
          React.createElement("div",{className:"role-line"},
            React.createElement("span",{className:"role-lab"},"Archetype"),
            React.createElement("div",{className:"sheet-role-desc"},
              React.createElement(EditText,{value:roleParts.archetype,multiline:true,
                placeholder:"What they embody \u2014 e.g. ideology, the system\u2026",onCommit:val=>setRolePart({archetype:val})}))),
          React.createElement("div",{className:"role-line"},
            React.createElement("span",{className:"role-lab"},"Narrative identity"),
            React.createElement("div",{className:"sheet-role-desc"},
              React.createElement(EditText,{value:capFirst(roleParts.identity),multiline:true,
                placeholder:"Who they are \u2014 e.g. A Somali-British trauma nurse\u2026",onCommit:val=>setRolePart({identity:val})}))),
          React.createElement("div",{className:"role-line"},
            React.createElement("span",{className:"role-lab"},"Pronouns"),
            React.createElement("select",{className:"char-pronoun-sel",
              value:(typeof window.turnIdentityReport==="function"
                ? (window.turnIdentityReport(c,{scenes,drafts,cast:cast||[c]}).pronouns||"")
                : ((c.pronouns==="he/him"||c.pronouns==="she/her"||c.pronouns==="they/them") ? c.pronouns : "")),
              onChange:e=>onUpdate(c.id,{pronouns:e.target.value,pronounProvenance:"user",
                identityProvenance:{ ...(c.identityProvenance||{}), pronouns:"user" }})},
              [["","set pronouns\u2026"],["he/him","he/him"],["she/her","she/her"],["they/them","they/them"]].map(function(o){return React.createElement("option",{key:o[0]||"unset",value:o[0],disabled:!o[0]},o[1]);})))),
          typeof window.CharacterIdentityNotice==="function" && React.createElement(window.CharacterIdentityNotice,{
             character:c, scenes, drafts, cast:cast||[c], readOnly:!!readOnly,
            onUpdate:(id,patch)=>onUpdate(id, { ...(patch||{}), pronounProvenance:"user",
              identityProvenance:{ ...(c.identityProvenance||{}), pronouns:"user" } })
          }),
        // physical identity as a clean LABELLED LIST (each field editable), instead of one
        // run-on paragraph. Edits update the structured `physique` (the source the prompt
        // reads) AND recompose `coreBody` so downstream/legacy readers stay in sync.
        (()=>{
          const F = c.physique || {};
          const KEYS=["age","ethnicity","skin","eyes","hair","face","build","legs","arms"];
          const hasPhys = KEYS.some(k=>String(F[k]||"").trim());
          const recompose=(nf)=>{ const t=[nf.age&&("Apparent age: "+nf.age),nf.ethnicity&&("Ethnicity: "+nf.ethnicity),
            nf.skin&&("Skin tone: "+nf.skin),nf.eyes&&("Eye colour: "+nf.eyes),nf.hair&&("Hair: "+nf.hair),
            nf.face&&("Face shape: "+nf.face),nf.build&&("Body type: "+nf.build),
            nf.arms&&("Arms & hands: "+nf.arms),
            nf.legs&&("Legs & feet: "+nf.legs)].filter(Boolean).join(". "); return t?(t+"."):""; };
          const setPhys=(k,val)=>{ const nf={...F,[k]:val}; onUpdate(c.id,{physique:nf, coreBody:recompose(nf)}); };
          // long descriptive fields render as auto-growing textareas (ml=true) so the
          // full sentence is always visible; short tokens stay single-line.
          const Row=(lab,val,onC,ml)=> React.createElement("div",{className:"phys-row",key:lab},
            React.createElement("span",{className:"phys-lab"},lab),
            React.createElement(EditText,{value:val||"",placeholder:"\u2014",multiline:!!ml,onCommit:onC}));
          if(!hasPhys) return React.createElement(SheetField,{label:"Body \u2014 fixed physical tokens",value:vfield(c,"coreBody","look"),multiline:true,
            placeholder:"Apparent age, ethnicity, skin tone & condition, eye colour, hair, face shape, body type, defining features\u2026",onCommit:val=>onUpdate(c.id,{coreBody:val})});
          return React.createElement("div",{className:"char-phys"},
            Row("Apparent age",F.age,v2=>setPhys("age",v2),true),
            Row("Ethnicity",F.ethnicity,v2=>setPhys("ethnicity",v2),true),
            Row("Height",c.height||v.height,v2=>onUpdate(c.id,{height:v2})),
            Row("Build",F.build,v2=>setPhys("build",v2),true),
            Row("Hair",F.hair,v2=>setPhys("hair",v2),true),
            Row("Eyes",F.eyes,v2=>setPhys("eyes",v2),true),
            Row("Skin",F.skin,v2=>setPhys("skin",v2),true),
            Row("Facial features",F.face,v2=>setPhys("face",v2),true),
            Row("Arms & hands",F.arms,v2=>setPhys("arms",v2),true),
            Row("Legs & feet",F.legs,v2=>setPhys("legs",v2),true),
            // SCALE CLASS — drives the height sheet's ruler AND the per-shot world-POV rewrite
            // (gigantism / miniaturization / microscopic). A/B/C/D; resolves any legacy free-text value.
            React.createElement("div",{className:"phys-row",key:"Scale"},
              React.createElement("span",{className:"phys-lab"},"Scale"),
              React.createElement("select",{className:"prop-select char-style-select",
                value:(typeof scaleClassOf==="function"?scaleClassOf(c):"A"),
                title:"Scale class — sets the character's height range and how the world is rendered from their POV in shots",
                onChange:e=>onUpdate(c.id,{scaleClass:e.target.value})},
                React.createElement("option",{value:"A"},"Human scale (Class A)"),
                React.createElement("option",{value:"B"},"Critter scale (Class B)"),
                React.createElement("option",{value:"C"},"Giant scale (Class C)"),
                React.createElement("option",{value:"D"},"Microscopic scale (Class D)"))));
        })(),
        c.bodyRationale && React.createElement("div",{className:"sheet-rationale"},
          React.createElement(Icon.sparkles,{s:12}),"Why this look: "+tidyTruncated(c.bodyRationale)),
        React.createElement(SheetField,{label:"Texture \u2014 skin & material detail",value:c.materialTexture,multiline:true,
          placeholder:"Pore texture, subsurface scattering, blemishes, lighting\u2026",onCommit:val=>onUpdate(c.id,{materialTexture:val})})),

      React.createElement(CardFold,{label:"Wardrobe",defaultOpen:false},
        React.createElement(SheetField,{label:"Public \u2014 the mask",value:vfield(c,"wardrobeMask","wardrobe"),multiline:true,
          placeholder:"Armour / public clothes \u2014 the social persona\u2026",onCommit:val=>onUpdate(c.id,{wardrobeMask:val})}),
        React.createElement(SheetField,{label:"Private \u2014 the true self",value:c.wardrobeInner,multiline:true,
          placeholder:"Softer, personal clothing \u2014 who they really are\u2026",onCommit:val=>onUpdate(c.id,{wardrobeInner:val})})),

      React.createElement(CardFold,{label:"Props & accessories",defaultOpen:false,foldId:"props-"+c.id},
        React.createElement("div",{className:"sheet-props-note"},
          React.createElement(Icon.sparkles,{s:12}),
          "Continuity objects \u2014 worn or carried items that recur across scenes."),
        wornProps.length>0 && React.createElement("div",{className:"worn-lock-summary"},
          React.createElement(Icon.layers,{s:12}),
          React.createElement("span",null,
            React.createElement("b",null,wornProps.filter(p=>ownedSheetMap[p.id]&&!wornExclusions.has(p.id)).length+" of "+wornProps.length),
            " worn design"+(wornProps.length===1?"":"s")+" visually locked"),
          React.createElement("span",{className:"worn-lock-fallback"},
            wornProps.filter(p=>!ownedSheetMap[p.id]||wornExclusions.has(p.id)).length+" text-only")),
        React.createElement("div",{className:"sheet-2col"},
          React.createElement(SheetField,{label:"Accessories \u2014 worn",value:c.accessories,list:true,ownerName:c.name,
            onItemRemoved: onRemoveOwnedItem ? (txt=>onRemoveOwnedItem(c.id,txt)) : null,
            onItemRenamed: onRenameOwnedItem ? ((oldTxt,newTxt)=>onRenameOwnedItem(c.id,oldTxt,newTxt)) : null,
            placeholder:"Fixed worn items \u2014 watch, glasses, jewellery\u2026",onCommit:val=>onUpdate(c.id,{accessories:val})}),
          React.createElement(SheetField,{label:"Props \u2014 carried",value:c.props,list:true,ownerName:c.name,
            onItemRemoved: onRemoveOwnedItem ? (txt=>onRemoveOwnedItem(c.id,txt)) : null,
            onItemRenamed: onRenameOwnedItem ? ((oldTxt,newTxt)=>onRenameOwnedItem(c.id,oldTxt,newTxt)) : null,
            placeholder:"Recurring objects \u2014 phone, weapon, talisman\u2026",onCommit:val=>onUpdate(c.id,{props:val})})),
        custodyProps.length>0 && React.createElement("div",{className:"linked-prop-list"},
          custodyProps.map(p=>{
            const e = handoversTo(p).slice(-1)[0];
            const sc = (scenes||[]).find(s=>s.id===(e&&e.sceneId));
            return React.createElement("div",{key:"cu-"+p.id,className:"linked-prop shot",
              title:"Custody handover \u2014 "+(p.name||"the object")+" passes from "+(p.ownerName||"its owner")+" to "+(c.name||"this character")+(sc&&sc.no!=null?(" at Sc "+sc.no):"")+". Its card and sheets stay anchored to "+(p.ownerName||"the owner")+" in the Props tab."},
              React.createElement(Icon.box,{s:12}),
              React.createElement("span",{className:"linked-prop-name"},p.name),
              React.createElement("span",{className:"linked-prop-orphan-tag"},"from "+(p.ownerName||"owner")+(sc&&sc.no!=null?(" \u00b7 Sc "+sc.no):"")));
          })),
        linkedRows.length>0 && React.createElement("div",{className:"linked-props"},
          React.createElement("div",{className:"linked-props-head"},
            React.createElement("div",{className:"obj-lab",style:{margin:0}},
              "Linked prop sheets \u2014 worn items attach to this sheet; carried attach at the shot"),
            // ON DEMAND (2026-10-03, owner): worn-item sheets are made only from here — they used to
            // build on their own (with a master re-bake) the moment this sheet first landed
            (onBuildWornProps && missingWorn>0 && gen.genUrl) && React.createElement("button",{className:"linked-props-make",
              disabled:wornBuilding||gen.gening,onClick:()=>onBuildWornProps(c),
              title:"Make the reference sheet for each worn item that doesn't have one (drafting its design first if needed), using this character's sheet as the reference. Then use \u201cUpdate sheet with new wardrobe\u201d if you want "+(c.name||"them")+" to wear them."},
              React.createElement(Icon.sparkles,{s:12}),
              wornBuilding ? "Making worn-item sheets\u2026" : ("Make "+missingWorn+" worn-item sheet"+(missingWorn!==1?"s":"")),
              (!wornBuilding && typeof window.nbCostChip==="function") && window.nbCostChip(missingWorn)),
            orphanProps.length>0 && onRemoveOwnedItem && React.createElement("button",{className:"linked-props-clean",
              title:"Remove the prop cards below that aren't in the worn/carried lists above",
              onClick:async ()=>{
                const ok = await window.appConfirm({
                  title: "Remove "+orphanProps.length+" orphaned prop"+(orphanProps.length>1?"s":"")+"?",
                  body: "These aren't listed in this character's worn/carried items \u2014 likely leftovers from an old text split.",
                  items: orphanProps.map(p=>p.name),
                  note: "Their prop cards move to the Props tab's Recently Deleted (with their reference sheets), where they can be restored.",
                  confirmLabel: "Remove", danger: true,
                });
                if(ok) orphanProps.forEach(p=>onRemoveOwnedItem(c.id, p.name));
              }},
              React.createElement(Icon.x,{s:12}),"Remove "+orphanProps.length+" orphaned")),
          React.createElement("div",{className:"linked-prop-list"},
            linkedRows.map(row=>{
              // carried props don't attach to the character SHEET \u2014 they ride in at
              // the shot level, so show them as deferred rather than "missing".
              // Card-less rows have no row.prop, so fall back to which LIST the item
              // came from (row.src) \u2014 otherwise an uncarded carried prop wrongly gets
              // the red "needs a sheet" treatment meant for worn items.
              const carried = row.prop ? row.prop.kind==="carried" : row.src==="carried";
              const ready = row.prop ? !!ownedSheetMap[row.prop.id] : false;
              const included = !!(row.prop && !carried && ready && !wornExclusions.has(row.prop.id));
              // carried props stay neutral (they bind at the shot, not here) but still
              // show whether their sheet has been generated \u2014 a green tick when ready,
              // so a generated and an ungenerated carried prop don't look identical.
              const cls = "linked-prop "+(carried?("shot"+(ready?" genned":"")):(included?"ready":(ready?"available":"missing")))+(row.orphan?" orphan":"");
              // ONE status grammar everywhere: [where it shows up] · [reference state] —
              // so every chip answers the same two questions the same way.
              const status = carried
                ? ("at the shot \u00b7 "+(ready ? "sheet ready \u2713" : "no sheet yet"))
                : (included ? "locked in master \u2713" : ("text-only \u00b7 "+(ready ? "sheet ready" : "no sheet yet")));
              return React.createElement("div",{key:row.key,className:cls,
                title: carried
                  ? (ready ? "Reference sheet generated \u2014 it attaches at the shot, not on this character sheet."
                           : "No reference sheet generated yet \u2014 it will attach at the shot once you generate it in the Props tab.")
                  : (ready ? (included
                                ? "Reference sheet generated and included as a visual lock in the next character master."
                                : "Reference sheet is ready, but this item is currently text-only in the character master.")
                           : "No reference sheet generated yet \u2014 generate it in the Props tab.")},
                React.createElement("div",{className:"linked-prop-title"},
                  React.createElement("span",{className:"linked-prop-name"},row.name),
                  // worn/carried at a glance — no scrolling back up to the lists to check.
                  // Same card-less src fallback as `carried` above.
                  (()=>{ const kw = !carried;
                    return React.createElement("span",{className:"linked-prop-kind "+(kw?"worn":"carried"),
                      title: kw ? "Worn \u2014 bakes into this character's master sheet"
                                : "Carried \u2014 attaches at the shot, not on this sheet"},
                      kw?"worn":"carried"); })(),
                  row.orphan && React.createElement("span",{className:"linked-prop-orphan-tag",
                    title:"Not in the worn/carried lists above \u2014 likely a leftover. Use \u201cRemove orphaned\u201d to clean up."},"not listed")),
                React.createElement("div",{className:"linked-prop-controls"},
                (ready && row.prop)
                  ? React.createElement("button",{className:"linked-prop-thumb",type:"button",
                      title:"Preview "+(row.name||"prop")+" reference sheet",
                      onClick:(e)=>{ e.stopPropagation(); onView&&onView(ownedSheetMap[row.prop.id],row.prop); }},
                      React.createElement("img",{src:ownedSheetMap[row.prop.id],alt:""}))
                  : React.createElement(Icon.box,{s:12}),
                // NO CARD YET (e.g. a character added after "Design all props" ran):
                // one free press derives the prop card in place — then this same row
                // offers Draft details / Generate.
                (!row.prop && !row.orphan && onCreateOwnedProp) && React.createElement("button",{
                  className:"linked-prop-gen",
                  title:"Create this item's prop card (owner + worn/carried derived automatically) — free, no generation. Then draft its specification and generate an image.",
                  onClick:(e)=>{ e.stopPropagation();
                    const made = onCreateOwnedProp(c.id, row.name, row.src);
                    if(made && typeof window.appToast==="function") window.appToast("\u201c"+made.name+"\u201d card created ("+(made.kind==="dressing"?"set dressing":made.kind)+") \u2014 now draft its specification, then generate an image.","success"); }},
                  React.createElement(Icon.plus,{s:12}),"Create card"),
                // INLINE generation — the sheet is built against THIS character's own
                // sheet (the owner reference), so it must exist first. Undrafted props
                // draft first (separate press: the fresh fields must land in state
                // before the image prompt is built from them).
                (row.prop && !row.orphan) && (()=>{
                  const pr = row.prop;
                  const busy = propBusy && propBusy.id===pr.id;
                  const pDrafted = (typeof propVisualsDrafted==="function") ? propVisualsDrafted(pr) : true;
                  const lab = busy ? (propBusy.kind==="draft"?"Drafting\u2026":"Generating\u2026")
                    : (!pDrafted ? "Draft specification" : (ready ? "Generate new image" : "Generate image"));
                  return React.createElement("button",{className:"linked-prop-gen"+(busy?" busy":""),
                    disabled: !!propBusy,
                    title: !pDrafted
                      ? "Write this prop's design spec (object, form & material) from the script \u2014 then Generate its sheet. Writing-model credits only."
                      : (!gen.genUrl
                        ? "Generate "+(c.name||"the character")+"'s sheet first \u2014 this prop references it so the design matches their look."
                        : (carried
                          ? "Generate this prop's reference sheet against "+(c.name||"the owner")+"'s sheet \u2014 it then attaches automatically at the shot level."
                          : "Generate an optional CLOSE-UP macro sheet against "+(c.name||"the owner")+"'s sheet \u2014 used only on CU/MCU/ECU/INSERT shots; wides keep rendering it from the character sheet.")),
                    onClick: async (e)=>{
                      e.stopPropagation();
                      if(propBusy) return;
                      if(!pDrafted){
                        if(!onDraftProp){ if(typeof window.appToast==="function") window.appToast("Draft this prop in the Props tab first.","info"); return; }
                        setPropBusy({id:pr.id, kind:"draft"});
                        try{ await onDraftProp(pr); }catch(err){}
                        setPropBusy(null);
                        return;   // fields land in state \u2014 the button now reads "Generate"
                      }
                      if(!gen.genUrl){ if(typeof window.appToast==="function") window.appToast("Generate "+(c.name||"the character")+"'s sheet first \u2014 the prop references it to match their look.","info"); return; }
                      setPropBusy({id:pr.id, kind:"gen"});
                      try{
                        await window.generatePropSheet(pr, project);
                        if(typeof window.appToast==="function") window.appToast("\u201c"+(pr.name||"Prop")+"\u201d sheet generated \u2014 "+(carried?"it now attaches at the shot level.":"tight shots can now lock its design."),"success");
                      }catch(err){ if(typeof window.appToast==="function") window.appToast(String((err&&err.message)||"Prop generation failed."),"error"); }
                      setPropBusy(null);
                      setSheetTick(t=>t+1);
                    }},
                    busy ? React.createElement("span",{className:"ns-spin"}) : React.createElement(Icon.sparkles,{s:12}),
                    lab,
                    (pDrafted && !busy && typeof window.nbCostChip==="function") ? window.nbCostChip(1) : null);
                })(),
                (row.prop && !carried && ready && !row.orphan) && React.createElement("label",{
                  className:"worn-lock-toggle",title:included?"Included as an exact visual reference in the next character master":"Keep this prop text-only in the character master"},
                  React.createElement("input",{type:"checkbox",checked:included,
                    onChange:(e)=>setWornReferenceIncluded(row.prop.id,e.target.checked)}),
                  React.createElement("span",null,"Visual lock")),
                React.createElement("span",{className:"linked-prop-status"},status)));
            })))),

      React.createElement(CardFold,{label:"Continuity \u00b7 appearance states",count:states.length||null,defaultOpen:false},
        React.createElement("div",{className:"sheet-props-note"},
          React.createElement(Icon.sparkles,{s:12}),
          "Moments where this character's look changes \u2014 wounds, costume shifts, time jumps. Each can become its own v2 sheet."),
        React.createElement("div",{className:"state-actions"},
          React.createElement("button",{className:"state-suggest-btn",disabled:suggestingStates,onClick:()=>onSuggestStates&&onSuggestStates(c)},
            suggestingStates
              ? React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin"}),"Scanning script\u2026")
              : React.createElement(React.Fragment,null,React.createElement(Icon.sparkles,{s:12}),"Suggest from script")),
          React.createElement("button",{className:"state-add-btn",onClick:addState},
            React.createElement(Icon.plus,{s:12}),"Add state")),
        states.length
          ? React.createElement("div",{className:"state-list"},
              React.createElement("div",{className:"state-row state-base"},
                React.createElement("span",{className:"state-vtag base"},"v1"),
                React.createElement("span",{className:"state-base-lab"},"Base look \u2014 the canonical sheet above")),
              states.map((st,i)=>React.createElement(StateRow,{key:st.id,c,st,index:i,project,scenes,props,drafts,
                baseGenUrl:gen.genUrl,onView,
                onChange:(patch)=>updateState(st.id,patch),onDelete:()=>deleteState(st.id)})))
          : React.createElement("div",{className:"state-empty"},
              "No appearance states yet \u2014 the base sheet covers the whole film. ",
              "Use \u201cSuggest from script\u201d to find where the look changes, or add one by hand.")),

      React.createElement(CardFold,{label:"Look dev",defaultOpen:false},
        React.createElement("div",{className:"sheet-field"},
          React.createElement("div",{className:"obj-lab"},"Colour palette \u00b7 base \u2192 climax"),
          React.createElement(PaletteRow,{palette})),
        // an editable setting that changes the sheet, so it lives on the card, not behind the prompt (2026-10-05)
        React.createElement(SheetField,{label:"Leave out \u2014 what the sheet must not show (negative prompt)",value:c.negativePrompt||v.negativePrompt,multiline:true,
          onCommit:val=>onUpdate(c.id,{negativePrompt:val})})),

      React.createElement(CardFold,{label:"Scale sheet",defaultOpen:false},
        React.createElement("div",{className:"char-scalesheet-hint"},
          React.createElement(Icon.sparkles,{s:12}),
          "A full-body height chart on the "+((typeof scaleInfoOf==="function")?scaleInfoOf(c).label:"Human")+" ruler \u2014 rendered from the master sheet, for you to check heights. Shots use the heights and scale class written on the card (Identity \u25b8 Scale), not this image."),
        React.createElement(SheetFrame,{ gen:scaleGenWrapped, slotId:"charscale-"+c.id, name:(c.name||"")+" \u00b7 scale", avatarColor:c.color,
          initials:"H", drafted:true, drafting:false, onDraft:()=>{}, entity:c, onView,
          slotPlaceholder:"Generate the height chart", noun:"scale sheet", dropToImport:true }),
        scaleGenWrapped.genUrl && React.createElement("div",{className:"card-qa-row"},
          React.createElement(QaCheckButton,{ gen:scaleGenWrapped, name:(c.name||"")+" \u00b7 scale", noun:"scale sheet" }))),

      // the sheet's prompt is a power-user tool: behind the card's ⋯ menu (2026-10-03), or open on every
      // card with "Always show prompts"; it's read-only (the "Leave out" field is under Look dev)
      (showPrompt || alwaysPrompts) && React.createElement(CardFold,{label:"Master reference prompt",defaultOpen:true},
        React.createElement(CopyBox,{label:"Reference-Guided Textual Character Sheet",text:promptText}),
        // The hybrid box always holds the prompt that generated the CURRENT sheet
        // (stored per version, so restoring an older version restores its prompt
        // here too); before any sheet exists it previews the next generation.
        React.createElement(CopyBox,{label:"Reference-Guided Hybrid Character Sheet (Text + Images)",
          text:(gen.genUrl && gen.genMeta && gen.genMeta.prompt) || finalPrompt})),

      cameoOpen && React.createElement(CameoModal,{ character:c,
        onClose:()=>setCameoOpen(false),
        // locking stores the face-lock reference; turning it INTO the character sheet
        // means regenerating the 4-panel design locked to that face — offer it right
        // away so the likeness doesn't sit unapplied until a manual "Apply to sheet".
        onSaved: async (saved)=>{
          refreshCameo();
          // the price, counted like the render: every captured angle + the worn-item sheets (GPT Image charges each)
          const nAngles = (saved && Array.isArray(saved.angles) && saved.angles.length) || (window.turnLikenessRefCount||(()=>0))(c.id) || 1;
          const price = (typeof window.nbImageCostText==="function") ? window.nbImageCostText(1, { refs:nAngles+wornSheetCount }) : "";
          const ok = !window.appConfirm || await window.appConfirm({
            title:"Turn the likeness into "+(c.name||"this character")+"'s sheet?",
            body:"Regenerates the 4-panel character sheet with the captured face — the portrait and full-body views will match the real person"
              +(price ? " (one image, about "+price+" credit"+(price==="1"?"":"s")+")" : "")+". You can also do this later with “Apply to sheet”.",
            confirmLabel:"Generate sheet"+(price ? " \u00b7 "+price+" credit"+(price==="1"?"":"s") : "") });
          if(ok && !gen.gening) gen.generate();
        } })),
    voiceOpen && window.VoiceModal && React.createElement(window.VoiceModal,{character:c,project,speaks,onUpdate,readOnly:!!readOnly,cast:cast||[c],
      onClose:()=>onCloseVoice&&onCloseVoice(c.id)}));
}

function NbKeyBar(){
  // key-status bar retired (user ruling 2026-07-19): server-side keys are the norm,
  // the banner was noise on every tab. Component kept for compatibility (the old body was removed 2026-10-06).
  return null;
}

function NbControls(){
  const [model, setModel] = React.useState(()=> (typeof nbGetModel==="function") ? nbGetModel() : "");
  const [aspect, setAspect] = React.useState(()=> (typeof nbGetAspect==="function") ? nbGetAspect() : "16:9");
  const [resv, setResv] = React.useState(()=> (typeof nbGetRes==="function") ? nbGetRes() : "2K");
  const [ground, setGround] = React.useState(()=> (typeof nbGetGroundSearch==="function") ? nbGetGroundSearch() : false);
  const [groundTip, setGroundTip] = React.useState(false);
  const [groundTipPos, setGroundTipPos] = React.useState(null);   // fixed coords — the tip portals to <body> (the drawer clipped it)
  const tipMenuRef = React.useRef(null);
  const [mOpen, setMOpen] = React.useState(false);   // mobile dropdown open
  const tipRef = React.useRef(null);
  const wrapRef = React.useRef(null);
  const models = window.NB_MODELS || [];
  const aspects = window.NB_ASPECTS || ["16:9","21:9"];
  // the grounding toolkit shows for the engine that grounds (Nano Banana 2.1 — nbModelGrounds)
  const isFlash = typeof nbModelGrounds==="function" ? nbModelGrounds(model) : false;
  // the resolutions this engine renders (Seedream 5 Pro: 1K and 2K — a saved 4K renders at 2K there, and says so)
  const maxRes = typeof nbModelMaxRes==="function" ? nbModelMaxRes(model) : "4K";
  const allRes = window.NB_RESOLUTIONS || ["1K","2K","4K"];
  const resChoices = allRes.slice(0, Math.max(1, allRes.indexOf(maxRes)+1));
  const shownRes = typeof nbModelRes==="function" ? nbModelRes(model, resv) : resv;
  const isGpt = (typeof isGptImageModel==="function") ? isGptImageModel(model) : /^gpt-image/.test(model||"");
  const [oaiQ, setOaiQ] = React.useState(()=> (typeof nbGetOaiQuality==="function") ? nbGetOaiQuality(model) : "medium");
  /* Quality choices are provider metadata, not UI constants.  GPT Image 2.5
     exposes all seven choices, while legacy GPT Image keeps its three familiar
     choices.  The server capability response gates only the newly introduced
     2.5 values until the remote route has been verified. */
  const qualityChoices = (typeof nbOaiQualityChoices==="function")
    ? (nbOaiQualityChoices(model)||[]) : [];
  const qualityIsExpanded = isGpt && qualityChoices.indexOf("default")>=0;
  const qualitySupport = (typeof nbImageQualitySupport==="function")
    ? (nbImageQualitySupport(model)||{}) : { loading:false, qualities:qualityChoices, expanded:!qualityIsExpanded };
  const [,forceQuality] = React.useState(0);
  const modelLabel = (models.find(m=>m.id===model)||{}).label || model || "Model";
  const qualityLabel = (q)=> typeof nbOaiQualityLabel==="function" ? nbOaiQualityLabel(q) : q;
  const qualityCanUse = (q)=>{
    if(typeof nbCanUseImageQuality==="function") return !!nbCanUseImageQuality(model,q);
    return !qualityIsExpanded || (qualitySupport.qualities||[]).indexOf(q)>=0;
  };
  const refreshQuality = (force)=>{
    if(!qualityIsExpanded || typeof nbRefreshImageQualityCapabilities!=="function") return;
    Promise.resolve(nbRefreshImageQualityCapabilities({force:!!force}))
      .catch(()=>{})
      .then(()=>forceQuality(x=>x+1));
  };
  const qualityNotReady = qualityIsExpanded && (!qualitySupport.expanded || qualitySupport.loading);
  const qualityMessage = qualityNotReady
    ? (qualitySupport.message || (qualitySupport.loading
      ? "Checking GPT Image 2.5 quality availability…"
      : "Extended quality choices are not verified yet."))
    : "";

  /* close tooltip on outside click */
  React.useEffect(()=>{
    if(!groundTip) return;
    const h = e=>{ if(tipRef.current && !tipRef.current.contains(e.target)
      && !(tipMenuRef.current && tipMenuRef.current.contains(e.target))) setGroundTip(false); };
    document.addEventListener("mousedown", h);
    return ()=>document.removeEventListener("mousedown", h);
  },[groundTip]);
  /* close the mobile settings dropdown on outside click */
  React.useEffect(()=>{
    if(!mOpen) return;
    const h = e=>{ if(wrapRef.current && !wrapRef.current.contains(e.target)) setMOpen(false); };
    document.addEventListener("mousedown", h);
    return ()=>document.removeEventListener("mousedown", h);
  },[mOpen]);
  /* reflect external model switches (e.g. a "Try <model>" fallback after a failed
     generation) in the picker highlight + mobile summary. */
  React.useEffect(()=>{
    const h = ()=>{
      const next = typeof nbGetModel==="function" ? nbGetModel() : model;
      setModel(next);
      if(typeof nbGetOaiQuality==="function") setOaiQ(nbGetOaiQuality(next));
    };
    window.addEventListener("nb-model-changed", h);
    const qh = ()=>{
      if(typeof nbGetOaiQuality==="function") setOaiQ(nbGetOaiQuality(model));
    };
    window.addEventListener("nb-settings-changed", qh);
    return ()=>{ window.removeEventListener("nb-model-changed", h); window.removeEventListener("nb-settings-changed", qh); };
  },[model]);
  /* A model switch changes quality families (legacy vs 2.5), so read the
     selected value for the NEW model instead of carrying the old family's q. */
  React.useEffect(()=>{
    if(typeof nbGetOaiQuality==="function") setOaiQ(nbGetOaiQuality(model));
    refreshQuality(false);
  },[model,qualityIsExpanded]);
  /* Capability events are intentionally independent of model/q values: a
     remote OPTIONS response can arrive while the same selection is visible. */
  React.useEffect(()=>{
    const h = ()=>forceQuality(x=>x+1);
    window.addEventListener("nb-quality-capabilities",h);
    return ()=>window.removeEventListener("nb-quality-capabilities",h);
  },[]);

  return React.createElement("div",{className:"nb-controls"+(mOpen?" mopen":""),ref:wrapRef},
    /* mobile-only: collapse all three controls into a dropdown */
    React.createElement("button",{className:"nb-ctl-mtoggle",onClick:()=>setMOpen(o=>!o)},
      React.createElement(Icon.layers,{s:14}),
      React.createElement("span",{className:"nb-ctl-msum"}, modelLabel+" \u00b7 "+aspect+" \u00b7 "+shownRes),
      React.createElement(Icon[mOpen?"chevU":"chevD"],{s:12})),
    React.createElement("div",{className:"nb-ctl-body"},
    React.createElement("div",{className:"nb-ctl"},
      React.createElement("span",{className:"nb-ctl-lab"},"Model"),
      React.createElement("div",{className:"nb-ctl-row"},
        React.createElement("div",{className:"nb-seg"},
          models.map(m=>React.createElement("button",{key:m.id,className:"nb-seg-btn "+((model===m.id)?"on":""),"aria-pressed":(model===m.id)?"true":"false",
             title:m.note,onClick:()=>{ setModel(m.id); setOaiQ(typeof nbGetOaiQuality==="function" ? nbGetOaiQuality(m.id) : "medium"); nbSetModel(m.id); window.dispatchEvent(new CustomEvent("nb-model-changed")); }},m.label))),
        /* grounding toolkit — only when Nano Banana 2.1 is selected */
        isFlash && React.createElement("div",{className:"nb-ground-wrap",ref:tipRef},
          React.createElement("button",{
            className:"nb-ground-btn "+(ground?"on":"")+(groundTip?" open":""),
            onMouseEnter:(e)=>{ const r=e.currentTarget.getBoundingClientRect();
              setGroundTipPos({ top:r.bottom+8, left:Math.max(8, Math.min(r.left, window.innerWidth-276)) });
              setGroundTip(true); },
            // NO mouseleave-close: the tip is a PORTALED popover with buttons — closing
            // when the pointer travels toward it made the Off/On choice unclickable.
            // It closes on outside click (handler checks the portal) or the toggle.
            onClick:(e)=>{ const r=e.currentTarget.getBoundingClientRect();
              setGroundTipPos({ top:r.bottom+8, left:Math.max(8, Math.min(r.left, window.innerWidth-276)) });
              setGroundTip(t=>!t); },
            title:"Grounding"},
            React.createElement(Icon.bolt,{s:12,sw:2.2}),ground?"On":""),
          groundTip && groundTipPos && ReactDOM.createPortal(React.createElement("div",{className:"nb-ground-tip",
            ref:tipMenuRef, onMouseEnter:()=>setGroundTip(true),
            style:{ position:"fixed", top:groundTipPos.top+"px", left:groundTipPos.left+"px", zIndex:1300 }},
            React.createElement("div",{className:"nb-ground-tip-head"},
              React.createElement(Icon.bolt,{s:12,sw:2.2}),
              "Grounding",
              React.createElement("span",{className:"nb-ground-tip-badge"},modelLabel),
              React.createElement("span",{className:"nb-ground-tip-sub"},"web references")),
            React.createElement("div",{className:"nb-ground-tip-body"},
              "When on, the model searches the web to anchor generation to real-world ",
              "references \u2014 period costumes, locations, props."),
            React.createElement("div",{className:"nb-seg nb-ground-seg"},
              React.createElement("button",{className:"nb-seg-btn "+((!ground)?"on":""),"aria-pressed":(!ground)?"true":"false",
                onClick:()=>{ setGround(false); nbSetGroundSearch&&nbSetGroundSearch(false); }},
                "Off"),
              React.createElement("button",{className:"nb-seg-btn "+((ground)?"on":""),"aria-pressed":(ground)?"true":"false",
                onClick:()=>{ setGround(true); nbSetGroundSearch&&nbSetGroundSearch(true); }},
                "Web"))), document.body)))),
     /* GPT Image quality — its own labelled control.  2.5's Default is a
        separate provider-default choice (not Auto); the client keeps that
        snapshot through the proxy and the server omits the provider field. */
    isGpt && React.createElement("div",{className:"nb-ctl"},
      React.createElement("span",{className:"nb-ctl-lab"},"Quality"),
      React.createElement("div",{className:"nb-ctl-row"},
        React.createElement("div",{className:"nb-seg"},
           qualityChoices.map(q=>{
             const usable = qualityCanUse(q);
             return React.createElement("button",{key:q,
               className:"nb-seg-btn "+(oaiQ===q?"on":"")+(usable?"":" disabled"),"aria-pressed":oaiQ===q?"true":"false",
               disabled:!usable,
               "aria-disabled":usable?"false":"true",
               title: usable ? qualityLabel(q) : ((qualitySupport.message||"Quality is not available yet.")+" Try refreshing."),
               onClick:()=>{ if(!usable)return; setOaiQ(q); if(typeof nbSetOaiQuality==="function") nbSetOaiQuality(q,model); window.dispatchEvent(new CustomEvent("nb-settings-changed")); }},
               qualityLabel(q));
           }),
         ),
         qualityMessage && React.createElement("div",{className:"nb-quality-message"},
           React.createElement("span",null,qualityMessage),
           !qualitySupport.loading && React.createElement("button",{type:"button",className:"nb-quality-retry",
             onClick:()=>refreshQuality(true)},"Retry"))
        )),
    React.createElement("div",{className:"nb-ctl"},
      React.createElement("span",{className:"nb-ctl-lab"},"Aspect"),
      React.createElement("div",{className:"nb-seg-rows"},
        React.createElement("div",{className:"nb-seg"},
          aspects.slice(0,3).map(a=>React.createElement("button",{key:a,className:"nb-seg-btn nb-aspect-btn "+(aspect===a?"on":""),"aria-pressed":aspect===a?"true":"false",
            onClick:()=>{ setAspect(a); nbSetAspect(a); }},
            React.createElement("span",{className:"sdbar-ratio-ico ratio-"+String(a).replace(":","x")}),
            React.createElement("span",null,a)))),
        aspects.length>3 && React.createElement("div",{className:"nb-seg"},
          aspects.slice(3).map(a=>React.createElement("button",{key:a,className:"nb-seg-btn nb-aspect-btn "+(aspect===a?"on":""),"aria-pressed":aspect===a?"true":"false",
            onClick:()=>{ setAspect(a); nbSetAspect(a); }},
            React.createElement("span",{className:"sdbar-ratio-ico ratio-"+String(a).replace(":","x")}),
            React.createElement("span",null,a)))))),
    React.createElement("div",{className:"nb-ctl"},
      React.createElement("span",{className:"nb-ctl-lab"},"Resolution"),
      React.createElement("div",{className:"nb-ctl-row"},
        React.createElement("div",{className:"nb-seg"},
          resChoices.map(r=>React.createElement("button",{key:r,className:"nb-seg-btn "+((shownRes===r)?"on":""),"aria-pressed":(shownRes===r)?"true":"false",
            onClick:()=>{ setResv(r); nbSetRes(r); window.dispatchEvent(new CustomEvent("nb-settings-changed")); }},r))),
        shownRes!==resv && React.createElement("div",{className:"nb-quality-message"},
          React.createElement("span",null,modelLabel+" renders up to "+maxRes+" \u2014 your "+resv+" setting renders at "+shownRes+" here."))))));
}

/* ENGINE DOCK — a compact floating widget in the help bubble's (Frances; code name MUSE) 54px right-edge
   column, vertically centered, floating ABOVE the layout (no content clearance).
   Collapsed: three stacked chips summarising Model / Aspect / Resolution.
   Click: a flyout panel (opens leftward) with the full NbControls. */
function NbDock(){
  const [open, setOpen] = React.useState(false);
  const [, force] = React.useState(0);
  const ref = React.useRef(null);
  React.useEffect(()=>{
    const h = ()=> force(x=>x+1);
    window.addEventListener("nb-model-changed", h);
    return ()=>window.removeEventListener("nb-model-changed", h);
  },[]);
  React.useEffect(()=>{
    if(!open) return;
    // the Grounding popover is PORTALED to <body> (drawer clipping) — a click inside
    // it is NOT "outside the drawer"; without this check, choosing On/Off closed the
    // whole toolkit before the selection could land
    const h = e=>{ if(ref.current && !ref.current.contains(e.target)
      && !(e.target && e.target.closest && e.target.closest(".nb-ground-tip"))) setOpen(false); };
    document.addEventListener("mousedown", h);
    return ()=>document.removeEventListener("mousedown", h);
  },[open]);
  const model  = (typeof nbGetModel==="function") ? nbGetModel() : "";
  const aspect = (typeof nbGetAspect==="function") ? nbGetAspect() : "16:9";
  const resv   = (typeof nbGetRes==="function") ? nbGetRes() : "2K";
  // (2026-10-09) each engine has its own chip (a different price) and GPT Image shows its quality — what the price
  // follows. The engines (2026-10-11): Nano Banana 2.1, GPT Image 2.5 Flare / Sunburst, Seedream 5 Pro
  const short  = model==="gpt-image-2.5-flare" ? "GPT F"
    : model==="gpt-image-2.5-sunburst" ? "GPT S"
    : model==="seedream-5-pro" ? "SD5"
    : model==="gemini-nano-banana-2.1" ? "NB2.1"
    : /gpt/i.test(model) ? "GPT" : "NB2.1";
  const isGpt = typeof isGptImageModel==="function" && isGptImageModel(model);
  const qual = isGpt && typeof nbGetOaiQuality==="function" && typeof nbOaiQualityLabel==="function" ? nbOaiQualityLabel(nbGetOaiQuality(model)) : "";
  // Escape closes the open dock (2026-10-09)
  React.useEffect(()=>{ if(!open) return undefined; const k=(e)=>{ if(e.key==="Escape") setOpen(false); };
    window.addEventListener("keydown", k); return ()=>window.removeEventListener("keydown", k); },[open]);
  // NOTE: the TEXT (writing) engine is shown by the separate WritingDock (rendered in
  // both rooms) — this dock is the IMAGE engine only, so the two aren't redundant.
  return React.createElement("div",{className:"nb-dock"+(open?" open":""),ref:ref,role:"region","aria-label":"Image engine settings"},
    React.createElement("button",{className:"nb-dock-toggle","aria-expanded":open?"true":"false","aria-controls":"nb-dock-panel",
      title:"Image engine — model, aspect & resolution",onClick:()=>setOpen(o=>!o)},
      React.createElement("span",{className:"nb-dock-label"},"Images"),
      React.createElement("span",{className:"nb-dock-chip model"},short),
      React.createElement("span",{className:"nb-dock-chip"},aspect),
      React.createElement("span",{className:"nb-dock-chip"},isGpt && qual ? qual : (typeof nbModelRes==="function" ? nbModelRes(model, resv) : resv))),
    open && React.createElement("div",{className:"nb-dock-panel",id:"nb-dock-panel",onClick:()=>force(x=>x+1)},
      React.createElement(NbControls,null)));
}

/* ONE-LINE scene-chip pager — 4 chips per page, ‹ › arrows, a "12–16 (10)" counter
   (the visible chips' scene-number range + the total count, so it always agrees
   with the chips on screen). Shared by Characters, Props and Locations so every
   card's scenes row behaves identically. items: [{key,label,title,className,onClick?}]. */
function SceneChipPager({ items, none }){
  const PAGE = 4;
  const [ofs, setOfs] = React.useState(0);
  if(!(items&&items.length)) return React.createElement("span",{className:"prop-scenes-none"}, none||"none yet");
  const o = Math.min(ofs, Math.max(0, items.length-PAGE));
  const shown = items.slice(o, o+PAGE);
  return React.createElement(React.Fragment,null,
    items.length>PAGE && React.createElement("button",{className:"sheet-scenes-nav",disabled:o<=0,
      title:"Earlier scenes",onClick:()=>setOfs(Math.max(0, o-PAGE))},"\u2039"),
    shown.map(it=> it.onClick
      ? React.createElement("button",{key:it.key,className:it.className,title:it.title,onClick:it.onClick},it.label)
      : React.createElement("span",{key:it.key,className:it.className,title:it.title},it.label)),
    items.length>PAGE && React.createElement("button",{className:"sheet-scenes-nav",disabled:o+PAGE>=items.length,
      title:"Later scenes",onClick:()=>setOfs(o+PAGE)},"\u203a"),
    items.length>PAGE && React.createElement("span",{className:"sheet-scenes-count",
      title:items.length+" scenes in total"},
      (shown.length>1 ? shown[0].label+"\u2013"+shown[shown.length-1].label : shown[0].label)+" ("+items.length+")"));
}
window.SceneChipPager = SceneChipPager;

/* REMASTER — the clean-plate pass. Stacked edits accumulate generation loss
   (photocopy-of-a-photocopy noise); this re-renders an APPROVED version as a fresh
   full-quality image without redesigning it. Image-anchored, not prompt-replay:
   the liked version IS the primary reference. */
/* Remaster is only OFFERED on a version produced by an Apply-edit — that's the pass
   that accumulates generation loss. Clean originals (and remaster passes themselves,
   which run through the edit pipeline with a "REMASTER…" instruction) have nothing
   to clean, so the buttons stay hidden for them. */
function remasterEligible(meta){
  return !!(meta && meta.mode==="edit" && !/^REMASTER\b/i.test(String(meta.editInstruction||"")));
}
window.remasterEligible = remasterEligible;

function remasterInstruction(noun){
  return "REMASTER this "+(noun||"sheet")+": the base image IS the approved final design. "
    +"Reproduce it EXACTLY \u2014 the same identity, faces, wardrobe, objects, panel layout, composition, "
    +"rendering style, colours and lighting in every panel \u2014 as a clean, sharp, artifact-free, "
    +"full-quality render. Remove compression noise, smudging, banding and detail loss. "
    +"Do NOT redesign, reinterpret, add or remove ANYTHING.";
}
window.remasterInstruction = remasterInstruction;

function ImageLightbox({ url, character, onClose, siblings, startIndex }){
  // SIBLING SET — when the opener passes `siblings` ({url, character} in display
  // order, e.g. Locations: master plate + screenplay coverage sheets), swiping
  // L/R (touch) or the ←/→ keys move BETWEEN those images without leaving
  // fullscreen. Without siblings the swipe walks the version strip instead.
  const sibs = (Array.isArray(siblings) && siblings.length>1) ? siblings : null;
  const [sIdx, setSIdx] = React.useState(()=> Math.max(0, Number(startIndex)||0));
  React.useEffect(()=>{ setSIdx(Math.max(0, Number(startIndex)||0)); },[startIndex, url]);
  const eUrl = sibs ? ((sibs[Math.min(sIdx, sibs.length-1)]||{}).url || url) : url;
  const eChar = sibs ? ((sibs[Math.min(sIdx, sibs.length-1)]||{}).character || character) : character;
  const [res, setRes] = React.useState(()=> (typeof nbGetRes==="function") ? nbGetRes() : "2K");
  // the VIEWED version's real size — the picker must follow the image, not the
  // global generation setting (a 4K sheet was opening on "2K" and silently
  // downloading downscaled). Stored meta wins; older sheets/uploads without a
  // stored size get measured off the pixels.
  const [nativeRes, setNativeRes] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // VERSION STRIP — when the viewed entity has earlier sheet versions, a filmstrip
  // under the image navigates them (click a thumb, ‹ › buttons, or arrow keys).
  // Works for every tab that opens this viewer (cast / props / locations / shots /
  // storyboards); plain refs without an entity id just show the single image.
  const [cur, setCur] = React.useState(url);
  const [versions, setVersions] = React.useState([]);
  // url → generation meta, for every known version (current + history) — drives the
  // Remaster button, which is only offered on versions produced by an Apply-edit
  const [metaByUrl, setMetaByUrl] = React.useState({});
  React.useEffect(()=>{ setCur(eUrl); },[eUrl]);
  React.useEffect(()=>{
    const label = (px)=> px>=3000 ? "4K" : px>=1600 ? "2K" : "1K";
    const m = metaByUrl[cur];
    if(m && m.size && (window.NB_RESOLUTIONS||["1K","2K","4K"]).indexOf(m.size)>=0){
      setNativeRes(m.size); setRes(m.size); return;
    }
    let alive = true;
    const img = new Image();
    img.onload = ()=>{ if(!alive) return;
      const l = label(Math.max(img.naturalWidth||0, img.naturalHeight||0));
      setNativeRes(l); setRes(l); };
    img.src = cur;
    return ()=>{ alive = false; };
  },[cur, metaByUrl]);
  React.useEffect(()=>{
    let alive = true;
    (async()=>{
      const id = eChar && eChar.id;
      if(!id || typeof window.nbGetHistory!=="function"){ if(alive){ setVersions([]); setMetaByUrl({}); } return; }
      let hist = []; try{ hist = (await window.nbGetHistory(id))||[]; }catch(e){}
      const curUrl = (typeof nbGetImage==="function") ? nbGetImage(id) : "";
      const items = [];
      if(curUrl) items.push({ url:curUrl, label:"Current" });
      hist.forEach((h,i)=>{ if(h && h.url && !items.some(x=>x.url===h.url)) items.push({ url:h.url, label:"Version −"+(i+1) }); });
      if(eUrl && !items.some(x=>x.url===eUrl)) items.unshift({ url:eUrl, label:"Viewing" });
      if(!alive) return;
      const metas = {};
      if(curUrl && typeof nbGetMeta==="function"){ try{ metas[curUrl] = nbGetMeta(id); }catch(e){} }
      hist.forEach(h=>{ if(h && h.url && h.meta && !metas[h.url]) metas[h.url] = h.meta; });
      setMetaByUrl(metas);
      // fast thumbs: decode each version ONCE into a ~128px data URL, cached for the
      // whole session (window.__lbThumbCache) — so the strip paints tiny images instead
      // of decoding a dozen full-resolution sheets, and reopening is instant.
      const cache = window.__lbThumbCache || (window.__lbThumbCache = new Map());
      items.forEach(it=>{ if(cache.has(it.url)) it.thumb = cache.get(it.url); });
      setVersions(items.length>1 ? items : []);
      if(items.length>1 && typeof turnDownscaleDataUrl==="function"){
        (async()=>{
          for(const it of items){
            if(!alive) return;
            if(cache.has(it.url)) continue;
            let t = ""; try{ t = await turnDownscaleDataUrl(it.url, 128); }catch(e){}
            if(!t) continue;
            cache.set(it.url, t);
            if(alive) setVersions(vs=> vs.map(v=> v.url===it.url ? { ...v, thumb:t } : v));
          }
        })();
      }
    })();
    return ()=>{ alive=false; };
  },[eChar && eChar.id, eUrl]);
  const idx = versions.findIndex(v=>v.url===cur);
  const step = (d)=>{ if(!versions.length) return; const j=(idx<0?0:idx)+d; if(j<0||j>=versions.length) return; setCur(versions[j].url); };
  // step BETWEEN sibling images (master plate ↔ coverage sheets); returns false at the ends
  const sibStep = (d)=>{ if(!sibs) return false; const j=sIdx+d; if(j<0||j>=sibs.length) return false; setSIdx(j); return true; };
  React.useEffect(()=>{
    // keys: with a version strip open the arrows keep walking versions (unchanged);
    // otherwise they move between sibling images
    const onKey = (e)=>{ if(e.key==="ArrowLeft"){ if(versions.length>1) step(-1); else sibStep(-1); }
      else if(e.key==="ArrowRight"){ if(versions.length>1) step(1); else sibStep(1); }
      else if(e.key==="Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return ()=>window.removeEventListener("keydown", onKey);
  });
  // TOUCH SWIPE — a mostly-horizontal flick moves between siblings (or, without
  // siblings, walks the version strip). Vertical drags stay free for scrolling.
  const touchRef = React.useRef(null);
  const onTouchStart = (e)=>{ const t = e.touches && e.touches[0]; touchRef.current = t ? { x:t.clientX, y:t.clientY } : null; };
  const onTouchEnd = (e)=>{
    const s = touchRef.current; touchRef.current = null; if(!s) return;
    const t = e.changedTouches && e.changedTouches[0]; if(!t) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if(Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)*1.5) return;
    const d = dx < 0 ? 1 : -1;   // swipe left = next
    if(!sibStep(d)) step(d);
  };
  const resolutions = window.NB_RESOLUTIONS || ["1K","2K","4K"];
  const download = async ()=>{
    if(busy) return; setBusy(true);
    const fn = (eChar && eChar.name ? eChar.name.replace(/[^\w]+/g,"_") : "character")+"_sheet_"+res+".png";
    try{ await nbDownload(cur, res, fn); }catch(e){}
    setBusy(false);
  };
  return React.createElement("div",{className:"lb-overlay",onMouseDown:(e)=>{ if(e.target===e.currentTarget) onClose(); }},
    React.createElement("div",{className:"lb-panel"+(versions.length>1?" has-strip":""),
      onTouchStart, onTouchEnd},
      React.createElement("div",{className:"lb-head"},
        React.createElement("span",{className:"lb-title"},(eChar?eChar.name:"Character sheet")
          +(sibs?(" · "+(Math.min(sIdx, sibs.length-1)+1)+"/"+sibs.length):"")
          +((idx>=0 && versions.length>1)?(" · "+versions[idx].label):"")),
        React.createElement("button",{className:"ag-x",onClick:onClose},React.createElement(Icon.x,{s:18}))),
      React.createElement("div",{className:"lb-imgwrap"},
        React.createElement("img",{className:"lb-img",src:cur,alt:"full view"})),
      // centered filmstrip between the image and the download row — no arrow buttons
      // (thumb clicks and the ←/→ keys navigate)
      versions.length>1 && React.createElement("div",{className:"lb-strip"},
        React.createElement("div",{className:"lb-strip-row"},
          versions.map((v,i)=>React.createElement("button",{key:i,className:"lb-thumb"+(v.url===cur?" on":""),
            title:v.label+" — click to view",onClick:()=>setCur(v.url)},
            React.createElement("img",{src:v.thumb||v.url,alt:v.label,loading:"lazy",decoding:"async"}))))),
      React.createElement("div",{className:"lb-foot"},
        // REMASTER the version on screen — re-renders it clean via the open card's
        // generation pipeline. Only offered while that card is mounted in this tab
        // AND the viewed version was produced by an Apply-edit (clean originals and
        // remaster passes have nothing to clean).
        (eChar && eChar.id && window.__sheetGen && window.__sheetGen[eChar.id]
          && remasterEligible(metaByUrl[cur])) &&
          React.createElement("button",{className:"lb-dl lb-remaster",
            disabled: !!window.__sheetGen[eChar.id].gening,
            title:"Re-render THIS version as a fresh, clean, full-quality image — same design, noise and artifacts removed. It becomes the new current version; everything else stays in history.",
            onClick:()=>{ const g=window.__sheetGen[eChar.id]; if(!g || g.gening) return;
              g.generate({ editInstruction: (typeof remasterInstruction==="function")?remasterInstruction(g.noun):"Reproduce this image exactly, clean and artifact-free.",
                editBaseUrl: cur });
              if(typeof window.appToast==="function") window.appToast("Remastering this version — it will land as the new current");
              onClose(); }},
            React.createElement(Icon.sparkles,{s:14}),"Remaster this version"),
        React.createElement("span",{className:"lb-foot-lab"},"Download"),
        React.createElement("div",{className:"nb-seg"},
          resolutions.map(r=>{
            const ord = { "1K":1, "2K":2, "4K":3 };
            const over = !!(nativeRes && ord[r] > ord[nativeRes]);
            return React.createElement("button",{key:r,className:"nb-seg-btn "+((res===r)?"on":""),"aria-pressed":(res===r)?"true":"false",
              disabled:over,
              title: over ? ("This image is "+nativeRes+" — downloads never upscale") : ("Download at "+r),
              onClick:()=>setRes(r)},r);
          })),
        React.createElement("button",{className:"lb-dl",onClick:download,disabled:busy},
          busy?React.createElement(React.Fragment,null,React.createElement("span",{className:"ns-spin dark"}),"Preparing\u2026")
              :React.createElement(React.Fragment,null,React.createElement(Icon.download,{s:14}),"Download "+res)))));
}

/* LOOKBOOK FIRST (2026-09-27, owner-approved — docs/Story Pipeline.md step 9): drafting the cast after
   the Lookbook has a look gives every character the film's look, so while the Lookbook is EMPTY and
   some character still has no spec the Characters tab says so quietly — with Draft all still one tap
   away. (Since 2026-10-03 nothing drafts silently; the user drafts when ready.) Hidden while a Draft
   all is already running (each card shows its own "Drafting from script…"). */
function charLookbookFirstHint(lookbook, lookbookNote, characters, draftingAll){
  if(draftingAll) return false;
  if(typeof window.lookbookHasLook!=="function" || window.lookbookHasLook(lookbook, lookbookNote)) return false;
  const drafted = (typeof window.charVisualsDrafted==="function") ? window.charVisualsDrafted : (()=>true);
  return (characters||[]).some(c=> !!c && !drafted(c));
}
window.charLookbookFirstHint = charLookbookFirstHint;

/* OPEN A TAB ON A SCENE (2026-10-03, owner — Breakdown review): the Breakdown's missing items and
   one-scene actions hand the next tab a scene to focus (and, for Shots, an optional action). Read at
   mount (peek), cleared once used; a hand-off older than 15 s is ignored. */
// a hand-off belongs to the film it was made in — scene ids repeat across films (2026-10-09)
window.turnFocusArtScene = (tab, sceneId, action)=>{ window.turnArtFocus = { tab, sceneId, action:action||"", at:Date.now(), film:window.turnOpenFilmId||null }; };
window.turnPeekArtFocus = (tab)=>{ const f = window.turnArtFocus; return (f && f.tab===tab && Date.now()-f.at<15000 && (f.film||null)===(window.turnOpenFilmId||null)) ? f : null; };
window.turnClearArtFocus = (tab)=>{ const f = window.turnArtFocus; if(f && f.tab===tab) window.turnArtFocus = null; };
function CharacterSheets({ readOnly=false, wardrobeIds=[], project, characters, scenes, props, drafts, shots, beatsMap, onUpdate, onDraft, onDraftAll, draftingId, draftingAll, draftingIds, onSuggestStates, suggestingStatesId, onBuildWornProps, onRemoveOwnedItem, onRenameOwnedItem, onDraftProp, onCreateOwnedProp, onDelete, onCast, trashItems, onRestore, onPurge, lookbookStale, onApplyLookbook, onApplyLookbookDraftOnly, lookbook, lookbookNote, onOpenLookbook }){
  const [view, setView] = React.useState(null);   // {url, character}
  // Keep one open flag per character so several card-contained Voice cards can
  // remain open independently without sharing UI state.
  const [openVoiceIds, setOpenVoiceIds] = React.useState([]);
  const openVoice = (id)=>{
    if(!id) return;
    setOpenVoiceIds(prev=>prev.indexOf(id)>=0 ? prev : [...prev,id]);
  };
  const closeVoice = (id)=>setOpenVoiceIds(prev=>prev.filter(x=>x!==id));
  const characterIdsKey = (characters||[]).map(c=>c.id).join("|");
  React.useEffect(()=>{
    const valid = new Set((characters||[]).map(c=>c.id));
    setOpenVoiceIds(prev=>{
      const next=prev.filter(id=>valid.has(id));
      return next.length===prev.length?prev:next;
    });
  },[characterIdsKey]);
  if(window.useRenderStyleVersion) window.useRenderStyleVersion();   // re-render dropdowns when a style is locked/unlocked
  // which characters actually speak (have dialogue) — used to flag the per-card Voice control
  const speakingSet = React.useMemo(()=> (typeof speakingCharIds==="function") ? speakingCharIds(characters, scenes, shots) : new Set(), [characters, scenes, shots]);
  const [mgrOpen, setMgrOpen] = React.useState(false);
  const [sceneFilter, setSceneFilter] = React.useState(()=>{ const f = window.turnPeekArtFocus && window.turnPeekArtFocus("characters"); return (f && f.sceneId) || ""; });   // "" = all scenes
  React.useEffect(()=>{ if(window.turnClearArtFocus) window.turnClearArtFocus("characters"); },[]);
  const [query, setQuery] = React.useState("");               // free-text name search
  const [searchOpen, setSearchOpen] = React.useState(false);  // collapsible search: icon-only until clicked
  const searchRef = React.useRef(null);
  // film-wide render style: apply one visual language to the WHOLE cast at once. Shows the
  // shared key, or blank ("Mixed") when characters differ. "surprise" invents a bespoke
  // style per character (each unique), so it confirms the per-character AI cost first.
  const [allStyling, setAllStyling] = React.useState(null);   // null | {i,total}
  const cast = characters || [];
  const defaultStyleKey = window.turnDefaultRenderStyleKey ? window.turnDefaultRenderStyleKey() : "photoreal";
  const allStyleKey = (cast.length && cast.every(c=>(c.renderStyleKey||defaultStyleKey)===(cast[0].renderStyleKey||defaultStyleKey)))
    ? (cast[0].renderStyleKey||defaultStyleKey) : "";
  const applyStyleAll = async (key)=>{
    if(!key || allStyling) return;
    cast.forEach(c=> onUpdate(c.id, { renderStyleKey:key }));
    if(key!=="surprise") return;
    if(!(typeof aiSurpriseRenderStyle==="function" && typeof aiAvailable==="function" && aiAvailable())) return;
    const need = cast.filter(c=>!(c.surpriseRender && c.surpriseRender.render));
    if(!need.length) return;
    let ok = true;
    if(typeof window.appConfirm==="function") ok = await window.appConfirm({
      title:"Invent a surprise style for "+need.length+" character"+(need.length!==1?"s":"")+"?",
      body:"Each character gets its OWN bespoke fused style invented from its bible — that's "+need.length+" AI call"+(need.length!==1?"s":"")+".",
      confirmLabel:"Invent styles" });
    if(!ok) return;
    setAllStyling({ i:0, total:need.length });
    for(let i=0;i<need.length;i++){ setAllStyling({ i:i+1, total:need.length });
      try{ const r = await aiSurpriseRenderStyle(need[i], project); if(r) onUpdate(need[i].id, { surpriseRender:r }); }catch(e){} }
    setAllStyling(null);
  };
  const batch = useBatchGen();
  const batchActiveId = batch.activeId;
  const list = characters || [];
  const q = query.trim().toLowerCase();
  const matchesQuery = (c)=> (typeof searchWordMatch==="function") ? searchWordMatch((c.name||"")+" "+(c.role||""), q) : (!q || (c.name||"").toLowerCase().indexOf(q)>=0);
  const sceneList = scenesInStoryOrder(scenes);
  // which characters appear in each scene — DERIVED (characters have no `scenes` field):
  // the scene's driver + everyone in its shots' subjects + the beats' reactor (by name) + every
  // scene whose script / summary names them (the card's own "Appears in" rule, 2026-10-03 — a
  // scene with no shots yet used to list only its driver).
  const charsInSceneMap = React.useMemo(()=>{
    const shotsBy = {}; (shots||[]).forEach(s=>{ (shotsBy[s.sceneId]=shotsBy[s.sceneId]||[]).push(s); });
    const m = {};
    (scenes||[]).forEach(s=>{
      const ids = new Set();
      if(s.driver) ids.add(s.driver);
      (shotsBy[s.id]||[]).forEach(sh=> (sh.subjects||[]).forEach(id=>ids.add(id)));
      const b = (beatsMap||{})[s.id];
      if(b && b.reactorLabel){ const rl=String(b.reactorLabel).toLowerCase();
        const mm = list.find(c=> (c.name||"").toLowerCase()===rl || rl.includes((c.name||"").toLowerCase())); if(mm) ids.add(mm.id); }
      m[s.id] = ids;
    });
    if(typeof scenesWhereCharacterAppears==="function") list.forEach(c=>{
      let sids = [];
      try{ sids = scenesWhereCharacterAppears(c.id, c.name, scenes, drafts) || []; }catch(e){}
      sids.forEach(sid=>{ if(m[sid]) m[sid].add(c.id); });
    });
    return m;
  }, [scenes, shots, beatsMap, list, drafts]);
  const inScene = (c, sid)=> !!(charsInSceneMap[sid] && charsInSceneMap[sid].has(c.id));
  const shown = (sceneFilter ? list.filter(c=>inScene(c, sceneFilter)) : list).filter(matchesQuery);
  const sceneCast = sceneFilter ? list.filter(c=>inScene(c, sceneFilter)) : [];   // the scene's cast, search ignored
  // 9-up pagination; suspended while a batch runs so the queue can reach every card
  const charPager = usePager(shown.length, !!batchActiveId);
  const sceneNoOf = (sid)=>{ const s=(scenes||[]).find(x=>x.id===sid); return s?s.no:sid; };
  const draftedIds = (subset)=> subset.filter(c=>charVisualsDrafted(c)).map(c=>c.id);
  // eligible = drafted characters only (so a card with no look/wardrobe never makes a generic sheet)
  const eligibleAll = list.filter(c=>charVisualsDrafted(c)).length;
  // some cast still has no spec — only THEN does the "Draft" button show (the stage's primary);
  // otherwise it's noise. Nothing drafts on its own any more (2026-10-03, owner: no silent
  // spending) — the user drafts when ready, after the Lookbook (see charLookbookFirstHint).
  const someUndrafted = eligibleAll < list.length;
  const lookbookFirst = charLookbookFirstHint(lookbook, lookbookNote, list, draftingAll);
  // STAGED HEADER (design-clarity ruling 2026-07-14): exactly ONE primary action
  // per pipeline stage — draft (specs missing) → generate (specs done, sheets
  // missing) → done. The other actions stay reachable but demoted to ghosts,
  // and nothing renders as disabled orange noise.
  // the header counts follow each finished generation (a sheet lands → "N missing" drops)
  const [, setSheetTick] = React.useState(0);
  React.useEffect(()=>{
    const h = ()=> setSheetTick(t=>t+1);
    window.addEventListener("nb-gen-done", h);
    return ()=> window.removeEventListener("nb-gen-done", h);
  },[]);
  const hasSheet = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  const sheetedAll = list.filter(c=> hasSheet(c.id)).length;
  const castStage = someUndrafted ? "draft" : (sheetedAll < list.length ? "generate" : "done");
  // MISSING SHEETS FIRST (2026-10-03): the header button renders only the drafted characters
  // with no sheet yet, and its chip prices exactly those. Redoing existing sheets is the ghost
  // "Regenerate…" once nothing is missing (the batch still asks before it redoes any).
  const missingIds = (subset)=> draftedIds(subset).filter(id=> !hasSheet(id));
  const missingAll = missingIds(list);
  const sceneMissing = missingIds(sceneCast);
  const sceneDrafted = draftedIds(sceneCast).length;
  const startAllBatch = (onlyMissing)=>{
    if(batchActiveId) return;
    const eligible = onlyMissing ? missingAll : draftedIds(list);
    if(!eligible.length){ batch.setMsg(onlyMissing ? "Every drafted character already has a sheet." : "Draft the characters first \u2014 nothing is ready to generate yet."); return; }
    // clear the SEARCH too, not just the scene/kind filters: the queue advances only
    // when the target CARD is mounted, so a batch whose first target was filtered out
    // by a search box never generated anything and hung until Cancel
    if(sceneFilter) setSceneFilter("");
    if(query) setQuery("");
    batch.begin(eligible, onlyMissing ? 0 : list.length - eligible.length, likenessBatchOpts(eligible));
  };
  // a batch with a likeness asks first: its price counts the photos, and a likeness that can't be used here is said
  function likenessBatchOpts(ids){
    const note = batchLikenessNote(ids);
    const any = (ids||[]).some(id=> (window.turnLikenessRefCount||(()=>0))(id)>0);
    if(!note && !any) return undefined;
    return { alwaysAsk:true, note, refsOf:(id)=> likenessBatchRefs([id])[0] };
  }
  // generate just the cast in the focused scene (mirrors Props / Locations)
  const startSceneBatch = (onlyMissing)=>{
    if(!sceneFilter || batchActiveId) return;
    const eligible = onlyMissing ? sceneMissing : draftedIds(sceneCast);
    if(!eligible.length){ batch.setMsg(onlyMissing ? "Everyone drafted in this scene already has a sheet." : "Draft the characters in this scene first \u2014 nothing here is ready to generate."); return; }
    if(query) setQuery("");   // the queue advances on mounted cards — a search must not hide one
    batch.begin(eligible, onlyMissing ? 0 : sceneCast.length - eligible.length, likenessBatchOpts(eligible));
  };
  // when a character is added BY HAND, smooth-scroll it into view (parity with Props)
  const prevIdsRef = React.useRef(null);
  React.useEffect(()=>{
    const ids = list.map(c=>c.id);
    const prev = prevIdsRef.current;
    prevIdsRef.current = ids;
    if(!prev) return;
    const added = list.find(c=>prev.indexOf(c.id)<0);
    if(!added || !added.manual) return;
    let tries = 0;
    const tick = ()=>{
      const el = document.querySelector('[data-char-card="'+added.id+'"]');
      const scroller = el && el.closest('.artroom');
      if(el && scroller){
        const target = Math.max(0, scroller.scrollTop + (el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - 16);
        const start = scroller.scrollTop, dist = target - start, t0 = performance.now(), dur = 420;
        const ease = x => 1 - Math.pow(1 - x, 3);
        const step = (now)=>{ const k = Math.min(1, (now - t0) / dur); scroller.scrollTop = start + dist * ease(k); if(k < 1) requestAnimationFrame(step); };
        requestAnimationFrame(step);
        return;
      }
      if(tries++ < 10) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },[list]);
  const [cameoCount, setCameoCount] = React.useState(()=> (typeof nbListCameos==="function") ? nbListCameos().length : 0);
  const refreshCount = ()=>{ if(typeof nbListCameos==="function") setCameoCount(nbListCameos().length); };
  // the count follows every lock / sync / revoke / load (the store's event — 2026-10-10, owner — Likeness review)
  React.useEffect(()=>{
    const h = ()=> refreshCount();
    window.addEventListener("turn-cameo-changed", h);
    return ()=> window.removeEventListener("turn-cameo-changed", h);
  },[]);
  /* PRICES THAT COUNT THE LIKENESS (GPT Image charges every image a render sends): each character's likeness
     photos + its worn-item sheets. Used only when someone in the batch has a likeness. */
  const likenessBatchRefs = (ids)=> (ids||[]).map(id=>{
    const ch = (characters||[]).find(x=>x && x.id===id) || {};
    const ex = new Set(Array.isArray(ch.wornReferenceExclusions) ? ch.wornReferenceExclusions : []);
    const worn = (props||[]).filter(p=>p && p.ownerId===id && p.kind!=="carried" && !ex.has(p.id)
      && typeof nbGetImage==="function" && nbGetImage(p.id)).length;
    return (window.turnLikenessRefCount||(()=>0))(id) + worn; });
  const batchChip = (ids)=>{
    if(typeof window.nbCostChip!=="function") return null;
    const anyLikeness = (ids||[]).some(id=> (window.turnLikenessRefCount||(()=>0))(id)>0);
    return anyLikeness ? React.createElement(window.LikenessBatchCost,{ refs:likenessBatchRefs(ids) }) : window.nbCostChip((ids||[]).length);
  };
  // a likeness someone in the batch can't use here is said in the batch's question, before it starts
  const batchLikenessNote = (ids)=> (ids||[]).map(id=>{ const ch=(characters||[]).find(x=>x&&x.id===id); return (window.turnLikenessUnavailableText||(()=>""))(id, ch&&ch.name); })
    .filter(Boolean).join(" ");
  const nameOf = (id)=>{ const c=(characters||[]).find(x=>x.id===id); return c?c.name:id; };
  /* THE VOICES WINDOW (2026-10-11, owner — real voices): the account's own voices (real and designed), beside
     Likenesses. Shown once this account has one (the last list the server gave) or a character here uses one. */
  const [voicesMgrOpen, setVoicesMgrOpen] = React.useState(false);
  const [, setVoicesTick] = React.useState(0);
  React.useEffect(()=>{
    const h = ()=> setVoicesTick(t=>t+1);
    window.addEventListener("vg-voices-changed", h);
    return ()=> window.removeEventListener("vg-voices-changed", h);
  },[]);
  const realSeen = (typeof window.vgRealVoicesSeen==="function") ? window.vgRealVoicesSeen() : null;
  const realHere = (characters||[]).some(c=>c && c.voiceLock && (c.voiceLock.source==="cloned" || c.voiceLock.source==="designed"));
  const voicesBtn = !!window.VoicesManager && (typeof window.voiceProxyReady==="function" && window.voiceProxyReady())
    && ((realSeen && realSeen.used>0) || realHere);
  return React.createElement("div",{className:"art-scroll"},
    view && React.createElement(ImageLightbox,{url:view.url,character:view.character,onClose:()=>setView(null)}),
    mgrOpen && React.createElement(CameoManager,{nameOf,characters,onClose:()=>setMgrOpen(false),onChanged:refreshCount}),
    voicesMgrOpen && window.VoicesManager && React.createElement(window.VoicesManager,{characters,onUpdate,onClose:()=>setVoicesMgrOpen(false)}),
    React.createElement(NbKeyBar,null),
    React.createElement(NbControls,null),
    window.LookbookStaleNotice && React.createElement(window.LookbookStaleNotice,{stale:lookbookStale,onApply:onApplyLookbook,onDraftOnly:onApplyLookbookDraftOnly,label:"these characters",dept:"characters"}),
    React.createElement("div",{className:"art-intro"},
      React.createElement("div",{className:"art-intro-row"},
        React.createElement("div",{style:{flex:1}},
          React.createElement("div",{className:"art-intro-t",style:{display:"flex",alignItems:"center",gap:9}},
            ((typeof roomCopy==="function" && roomCopy(project,"characters").title) || "Casting Director"),
            React.createElement(window.InfoTip,{label:"About Character Sheets",
              text:((typeof roomCopy==="function" && roomCopy(project,"characters").tip) ||
                "A canonical visual reference for every character \u2014 the consistency anchor you feed into each shot so they look identical in every frame. 'Design the cast' runs the Casting Director agent: it shows what it will make and the price first (the characters without a sheet, every character, or one scene's cast), then drafts each look, finds their appearance changes (wounds, dirt, costume shifts), generates the master sheet (pulling in their prop sheets + any likeness) and the appearance variants. 'Draft all' + 'Generate missing sheets' stay as the manual paths. Nothing is drafted or generated until you press a button.\n\nTHE CAST DERIVES FROM THE STORY \u2014 characters enter through story creation and screenplay development, then appear here ready to design. Neither room offers manual character creation.")}))),
        React.createElement("div",{className:"art-intro-actions"},
          window.RecentlyDeleted && React.createElement(window.RecentlyDeleted,{
            items:trashItems,kind:"character",onRestore,onPurge,compact:true}),
          cameoCount>0 && React.createElement("button",{className:"art-cameo-mgr",onClick:()=>setMgrOpen(true),
            title:"Likeness manager \u2014 review and manage the locked likenesses"},
            React.createElement(Icon.userScan,{s:14}),"Likenesses \u00b7 "+cameoCount),
          voicesBtn && React.createElement("button",{className:"art-cameo-mgr art-voices-mgr",onClick:()=>setVoicesMgrOpen(true),"data-testid":"voices-manager-btn",
            title:"Voices \u2014 your own voices (real and designed): who, which characters use them, delete to free room"},
            React.createElement(Icon.mic,{s:14}),"Voices"+(realSeen && realSeen.used>0 ? " \u00b7 "+realSeen.used : "")),
          // NO hand-adding: the cast derives from story creation and screenplay
          // development; the Art Room designs only what the story establishes.
          // ONE primary per stage: "Design the cast" leads while specs are missing,
          // "Generate all" leads once everything is drafted; the rest are ghosts.
          onCast && React.createElement("button",{className:"art-draftall ghost",disabled:!characters.length,onClick:()=>onCast({}),
            title:"Casting Director — drafts each character's look, finds their appearance changes, and generates the master sheet + every state variant, on its own"},
            React.createElement(Icon.robot,{s:14}),"Design the cast"),
          someUndrafted && React.createElement("button",{className:"art-draftall",disabled:draftingAll,onClick:onDraftAll,
            title:"Draft the spec for any character that doesn't have one yet \u2014 identity, wardrobe, props & accessories, continuity and look dev (the master reference prompt builds from these). Specs only \u2014 no images; the manual alternative to Design the cast."},
            React.createElement(Icon.sparkles,{s:14}), draftingAll?"Designing\u2026":(eligibleAll>0?"Draft remaining":"Draft all (specs only)")),
          missingAll.length>0 && React.createElement("button",{className:"art-draftall"+(castStage==="draft"?" ghost":""),disabled:!!batchActiveId,onClick:()=>startAllBatch(true),
            title:"Generate the reference sheet for every drafted character that doesn't have one yet \u2014 existing sheets are left as they are"},
            React.createElement(Icon.sparkles,{s:14}),
            batchActiveId?"Generating\u2026":("Generate "+missingAll.length+" missing sheet"+(missingAll.length!==1?"s":"")),
            batchChip(missingAll)),
          (castStage!=="draft" && !missingAll.length && eligibleAll>0) && React.createElement("button",{className:"art-draftall ghost",disabled:!!batchActiveId,onClick:()=>startAllBatch(false),
            title:"Regenerate the reference sheets of the drafted cast \u2014 you'll be asked before anything is redone, with the price"},
            React.createElement(Icon.sparkles,{s:14}), batchActiveId?"Generating\u2026":"Regenerate sheets\u2026"))),
      lookbookFirst && React.createElement("div",{className:"char-lookbook-hint",role:"note"},
        React.createElement(Icon.image,{s:12}),
        React.createElement("span",null,
          onOpenLookbook
            ? React.createElement("button",{type:"button",className:"char-lookbook-hint-link",onClick:onOpenLookbook,
                title:"Open the Lookbook tab"},"Build the Lookbook first")
            : "Build the Lookbook first",
          " \u2014 drafting the cast after it gives every character the film's look. Or ",
          React.createElement("button",{type:"button",className:"char-lookbook-hint-link",onClick:onDraftAll,
            title:"Draft the spec for every character that doesn't have one yet (specs only, no images)"},"draft now"),
          "."))),
    list.length>0 && React.createElement("div",{className:"prop-toolbar"},
      React.createElement("div",{className:"prop-searchbar collapsible"+((searchOpen||q)?" open":""),
        title:(searchOpen||q)?"":"Search characters",
        onClick:()=>{ if(!searchOpen && !q){ setSearchOpen(true); setTimeout(()=>{ if(searchRef.current) searchRef.current.focus(); },0); } }},
        React.createElement(Icon.search,{s:14}),
        React.createElement("input",{className:"prop-search-input",type:"text",value:query,ref:searchRef,
          placeholder:"Search characters by name or role…",tabIndex:(searchOpen||q)?0:-1,
          onChange:e=>setQuery(e.target.value),
          onBlur:()=>{ if(!query) setSearchOpen(false); },
          onKeyDown:e=>{ if(e.key==="Escape"){ setQuery(""); setSearchOpen(false); if(searchRef.current) searchRef.current.blur(); } }}),
        q && React.createElement("span",{className:"prop-search-count"}, shown.length+" of "+list.length),
        q && React.createElement("button",{className:"prop-search-clear",title:"Clear search",onClick:(e)=>{ e.stopPropagation(); setQuery(""); setSearchOpen(false); }},React.createElement(Icon.x,{s:14}))),
      characters.length>0 && React.createElement("div",{className:"char-style-all",
        title:"Apply one render style to the whole cast at once. Each character can still be overridden on its own card."},
        React.createElement("span",{className:"char-style-all-lab"},
          allStyling ? ("Inventing… "+allStyling.i+"/"+allStyling.total) : "Style · all cast"),
        React.createElement(window.RenderStylePicker,{value:allStyleKey,disabled:!!allStyling,
          placeholderLabel:"Mixed — per character",onPick:applyStyleAll})),
      sceneList.length>0 && React.createElement("div",{className:"prop-scenebar"},
        React.createElement("span",{className:"prop-scenebar-lab"},React.createElement(Icon.layers,{s:14}),"Focus a scene"),
        React.createElement("select",{className:"prop-select prop-scenebar-select",value:sceneFilter,onChange:e=>setSceneFilter(e.target.value)},
          React.createElement("option",{value:""},"All scenes — show every character"),
          sceneList.map(s=>{ const n=(charsInSceneMap[s.id]?charsInSceneMap[s.id].size:0);
            return React.createElement("option",{key:s.id,value:s.id},
              "Scene "+String(s.no).padStart(2,"0")+" · "+(s.title||"")+"  ("+n+" character"+(n!==1?"s":"")+")"); })),
        // staged like the header: sheets render FROM drafted specs, so the scene
        // batch button only appears once someone in the scene is drafted — before
        // that it was a full-orange no-op (the hint line explains what to do first)
        (sceneFilter && sceneMissing.length>0) && React.createElement("button",{className:"art-draftall",disabled:!!batchActiveId,onClick:()=>startSceneBatch(true),
          title:"Generate the reference sheets of the drafted characters in this scene that don't have one yet"},
          React.createElement(Icon.sparkles,{s:14}),
          batchActiveId?"Generating…":("Generate "+sceneMissing.length+" missing in Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")),
          batchChip(sceneMissing)),
        (sceneFilter && !sceneMissing.length && sceneDrafted>0) && React.createElement("button",{className:"art-draftall ghost",disabled:!!batchActiveId,onClick:()=>startSceneBatch(false),
          title:"Regenerate the reference sheets of the characters in this scene \u2014 you'll be asked before anything is redone, with the price"},
          React.createElement(Icon.sparkles,{s:14}),
          batchActiveId?"Generating…":("Regenerate Scene "+String(sceneNoOf(sceneFilter)).padStart(2,"0")+"\u2026")),
        (sceneFilter && onCast && !batchActiveId) && React.createElement("button",{className:"art-draftall ghost",
          onClick:()=>onCast({ sceneId:sceneFilter, sceneNo:sceneNoOf(sceneFilter), sceneIds:sceneCast.map(c=>c.id) }),
          title:"Casting Director for this scene only \u2014 drafts, generates and adds appearance variants for the characters in it. Shows what it will make and the price before it starts."},
          React.createElement(Icon.robot,{s:14}),"Design this scene's cast"))),
    // B13 (2026-10-09, owner decision B — Breakdown review): the focused scene counted the Breakdown's way — the variant its
    // frames use counts — each item a chip that says which card to open (the button above makes the missing master sheets)
    (sceneFilter && window.BdSceneNeedsLine) && React.createElement(window.BdSceneNeedsLine,{sceneId:sceneFilter,sceneNo:sceneNoOf(sceneFilter),kind:"characters",
      film:{ scenes, characters, props, drafts, shots, project }, list, onFind:(n)=>{ setQuery(n||""); setSearchOpen(true); }}),
    BatchBar && React.createElement(BatchBar,{batch,noun:"character"}),
    React.createElement("div",{className:"sheet-grid"},
      charPager.slice(shown).map(c=>React.createElement(CharacterSheet,{key:c.id,c,readOnly,wardrobeStale:(wardrobeIds||[]).indexOf(c.id)>=0,project,scenes,props,drafts,cast:characters,speaks:speakingSet.has(c.id),onUpdate,onDraft,
        voiceOpen:openVoiceIds.indexOf(c.id)>=0,onOpenVoice:openVoice,onCloseVoice:closeVoice,
        drafting:draftingId===c.id||(draftingIds||[]).indexOf(c.id)>=0,onView:(url,ch)=>setView({url,character:ch}),
        batchActiveId,onBatchDone:batch.advance,onDelete:onDelete,
        onSuggestStates,suggestingStates:suggestingStatesId===c.id,onBuildWornProps,onRemoveOwnedItem,onRenameOwnedItem,onDraftProp,onCreateOwnedProp}))),
    React.createElement(PagerBar,{pager:charPager,noun:"character"}));
}

/* ---- pre-production readiness — ONE shared status model, used by the overview
   strip (#1) and the Coordinator's cost preview (#2). Counts what's GENERATED
   (nbGetImage, warmed by the Art Room's prefetch) against what the pipeline covers.
   Style is a per-scene GRADE assignment, not an image, so it carries noGen. ---- */
function preProdStatus({ project, characters, props, locations, shots, scenes }){
  const img = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  const C=characters||[], P=props||[], L=locations||[], S=shots||[], SC=scenes||[];
  const graded = (typeof scenePreset==="function") ? SC.filter(s=>scenePreset(project, s.id)).length : 0;
  const boarded = SC.filter(s=> img("sbsheet-sbpage-"+s.id+"-2x2-0") || img("sbsheet-sbpage-"+s.id+"-0")).length;
  // Voices: locked among SPEAKING characters (a lock, not an image, so noGen).
  const speaking = (typeof speakingCharIds==="function") ? speakingCharIds(C, SC, S) : new Set();
  const speakers = C.filter(c=>speaking.has(c.id));
  const voiced = speakers.filter(c=>c.voiceLock && c.voiceLock.voiceId).length;
  return [
    { id:"characters", label:"Cast",        unit:"sheet", done:C.filter(c=>img(c.id)).length, total:C.length },
    { id:"props",      label:"Props",       unit:"sheet", done:P.filter(p=>img(p.id)).length, total:P.length },
    { id:"voices",     label:"Voices",      unit:"voice", noGen:true, done:voiced, total:speakers.length, navTo:"characters" },
    { id:"locations",  label:"Locations",   unit:"plate", done:L.filter(l=>img(l.id)).length, total:L.length },
    { id:"stylebible", label:"Style",       unit:"grade", noGen:true, done:graded, total:SC.length },
    { id:"shots",      label:"Shots",       unit:"frame", done:S.filter(s=>img(s.id)).length, total:S.length },
    { id:"storyboard", label:"Storyboards", unit:"sheet", done:boarded, total:SC.length },
  ];
}
window.preProdStatus = preProdStatus;

/* ---- shared SCENE PAGER — one scene at a time with ← / → (and arrow keys),
   used by the Stage, Shots and Storyboards instead of one long scroll. ---- */
function useScenePager(total, locked){
  const [idx, setIdx] = React.useState(0);
  React.useEffect(()=>{ setIdx(i=> Math.min(i, Math.max(0, total-1))); },[total]);
  React.useEffect(()=>{
    // (2026-10-09) not inside a menu or a chip group, not while editing text, and not behind an open viewer/dialog
    const onKey=(e)=>{ if(locked) return; const t=e.target; if(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||"")) return;
      if(t && (t.isContentEditable || (t.closest && t.closest('[role="group"],[role="menu"],.scene-pager-menu,.sheet-tools-dropdown')))) return;
      if(typeof document!=="undefined" && document.querySelector && document.querySelector('[role="dialog"],[aria-modal="true"],.lb-overlay')) return;
      if(e.key==="ArrowLeft") setIdx(i=>Math.max(0,i-1));
      else if(e.key==="ArrowRight") setIdx(i=>Math.min(Math.max(0,total-1),i+1)); };
    window.addEventListener("keydown",onKey); return ()=>window.removeEventListener("keydown",onKey);
  },[total,locked]);
  return [ Math.min(idx, Math.max(0,total-1)), setIdx ];
}
window.useScenePager = useScenePager;
function ScenePager({ idx, total, title, sub, onPrev, onNext, scenes, onJump, disabled }){
  const [open, setOpen] = React.useState(false);
  const canJump = !disabled && !!(onJump && scenes && scenes.length>1);
  React.useEffect(()=>{ if(!open) return;
    const close=(e)=>{ if(!e.target.closest || !e.target.closest(".scene-pager-mid")) setOpen(false); };
    document.addEventListener("mousedown", close); return ()=>document.removeEventListener("mousedown", close); },[open]);
  return React.createElement("div",{className:"scene-pager"},
    React.createElement("button",{className:"scene-pager-arrow",onClick:onPrev,disabled:!!disabled||idx<=0,
      title:"Previous scene (←)","aria-label":"Previous scene"}, React.createElement(Icon.chevL,{s:18})),
    React.createElement("div",{className:"scene-pager-mid"+(canJump?" jump":""),
        onClick: canJump?()=>setOpen(o=>!o):undefined, title: canJump?"Jump to a scene":undefined,
        role: canJump?"button":undefined, tabIndex: canJump?0:undefined},
      React.createElement("span",{className:"scene-pager-no"},
        "Scene "+(idx+1)+" of "+total,
        canJump ? React.createElement(Icon.chevD,{s:10}) : null),
      React.createElement("span",{className:"scene-pager-title"}, title||"Untitled scene"),
      sub ? React.createElement("span",{className:"scene-pager-sub"}, sub) : null,
      (canJump && open) && React.createElement("div",{className:"scene-pager-menu",onClick:(e)=>e.stopPropagation()},
        scenes.map((s,i)=>React.createElement("button",{key:s.id||i,className:"scene-pager-menu-item"+(i===idx?" on":""),
          onClick:()=>{ onJump(i); setOpen(false); }},
          React.createElement("span",{className:"scene-pager-menu-no"}, String(s.no||(i+1)).padStart(2,"0")),
          React.createElement("span",{className:"scene-pager-menu-t"}, s.title||"Untitled scene"),
          i===idx && React.createElement(Icon.check,{s:14}))))),
    React.createElement("button",{className:"scene-pager-arrow",onClick:onNext,disabled:!!disabled||idx>=total-1,
      title:"Next scene (→)","aria-label":"Next scene"}, React.createElement(Icon.chevR,{s:18})));
}
window.ScenePager = ScenePager;


/* #2 — cost/scope preview before the Coordinator runs the whole pipeline (it
   generates a lot, end to end, with no per-step gate). Shows roughly how many
   images it will produce so a paid user isn't surprised. */
/* the two run previews (Run pre-production, Design the cast) are dialogs: Escape cancels, focus moves in */
function usePreviewDialog(onCancel){
  React.useEffect(()=>{ const back = document.activeElement;
    const h = (e)=>{ if(e.key==="Escape" && !document.querySelector(".appconfirm")){ e.stopPropagation(); onCancel && onCancel(); } };
    window.addEventListener("keydown", h, true);
    return ()=>{ window.removeEventListener("keydown", h, true); try{ back && back.focus && back.focus(); }catch(e){} }; },[]);
}
function _previewFocus(el){ if(el && !el.__focused){ el.__focused = true; try{ el.focus(); }catch(e){} } }
function CoordConfirm({ project, characters, props, locations, shots, scenes, drafts, wardrobeCount, onCancel, onConfirm }){
  // HONEST ESTIMATE (fixed 2026-09-26): only the images Run pre-production really renders —
  // cast sheets and their appearance variants, prop sheets (not text-only objects, which
  // shots describe instead), wardrobe re-renders and location plates. It used to count shot
  // frames and storyboard sheets the run never makes, and missed the wardrobe re-renders.
  const img = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  const C=characters||[], P=props||[], L=locations||[];
  const tierOf = (p)=>{ try{ return (window.PropScreenplay && window.PropScreenplay.sheetTier) ? window.PropScreenplay.sheetTier(p, drafts||{}).tier : "own"; }catch(e){ return "own"; } };
  const lines = [
    { id:"cast",     label:"Cast sheets",         unit:"sheet",   n:C.filter(c=>c && !img(c.id)).length },
    { id:"variants", label:"Appearance variants", unit:"variant", n:C.reduce((a,c)=> a + ((c&&c.states)||[]).filter(st=>st && st.sceneId && !img(c.id+":"+st.id)).length, 0) },
    // the props the run really makes (2026-10-09): a worn item gets no sheet of its own (it shows on its owner's),
    // and a carried prop with no owner isn't made either
    { id:"props",    label:"Prop sheets",         unit:"sheet",   n:P.filter(p=>p && !img(p.id) && p.kind!=="worn" && !((p.kind||"carried")==="carried" && !p.ownerId) && tierOf(p)!=="text").length },
    { id:"wardrobe", label:"Wardrobe updates",    unit:"re-rendered sheet", n:Math.max(0, Number(wardrobeCount)||0) },
    { id:"plates",   label:"Location plates",     unit:"plate",   n:L.filter(l=>l && !img(l.id)).length },
  ];
  const pending = lines.filter(l=>l.n>0);
  const totalGen = pending.reduce((a,l)=>a+l.n,0);
  // the writing model the run will use (Art Room work = "specs"); follows the Writing dock
  const [mid, setMid] = React.useState(()=> (typeof window.getWritingModelId==="function") ? window.getWritingModelId("specs") : "");
  React.useEffect(()=>{
    const h = ()=>{ if(typeof window.getWritingModelId==="function") setMid(window.getWritingModelId("specs")); };
    window.addEventListener("turn-writing-model-changed", h);
    return ()=> window.removeEventListener("turn-writing-model-changed", h);
  },[]);
  const midLabel = ((window.WRITING_MODELS||[]).find(m=>m.id===mid)||{}).label || mid || "the default model";
  const midRec = !!mid && typeof window.recommendedWritingModelId==="function" && window.recommendedWritingModelId("specs")===mid;
  const hasWork = totalGen>0;
  const note = (icon, text, cls)=> React.createElement("div",{className:"cc-note"+(cls?" "+cls:"")},
    React.createElement(Icon[icon]||Icon.alert,{s:12}), React.createElement("span",null,text));
  // a real dialog: Escape cancels, focus moves in, and the scene pager behind it keeps still (2026-10-09)
  usePreviewDialog(onCancel);
  return React.createElement("div",{className:"ns-overlay",role:"dialog","aria-modal":"true",tabIndex:-1,ref:_previewFocus,
      onMouseDown:e=>{ if(e.target===e.currentTarget) onCancel(); }},
    React.createElement("div",{className:"cc-modal"},
      React.createElement("div",{className:"cc-head"},
        React.createElement("span",{className:"cc-orb"}, React.createElement(Icon.robot,{s:18})),
        React.createElement("div",null,
          React.createElement("div",{className:"cc-title"},"Run pre-production"),
          React.createElement("div",{className:"cc-sub"},"Runs the pre-production chain in one pass — Lookbook → Cast → Props → Wardrobe → Locations → Colour → Shot coverage."))),
      hasWork
        ? React.createElement(React.Fragment,null,
            // the price, not only a count (2026-10-09 — Design the cast shows one); "at least": the run can find more
            React.createElement("div",{className:"cc-est"},
              React.createElement("span",{className:"cc-est-n"}, "at least "+totalGen),
              React.createElement("span",{className:"cc-est-l"}, "image"+(totalGen===1?"":"s")+" to generate"),
              typeof window.nbCostChip==="function" && window.nbCostChip(totalGen)),
            React.createElement("ul",{className:"cc-list"},
              pending.map(l=>React.createElement("li",{key:l.id},
                React.createElement("span",{className:"cc-list-lab"}, l.label),
                React.createElement("span",{className:"cc-list-n"}, l.n+" "+l.unit+(l.n===1?"":"s"))))),
            note("alert","It can make more than this: missing time-of-day variants for the locations, places and appearance changes it finds in the script, and a wardrobe update for anyone whose worn prop is made in this run. Each image uses credits; what it made shows when it finishes."))
        : note("check","Every sheet and plate already exists — running again refreshes the lookbook, colour and shot coverage (writing credits only) and fills any gaps.","ok"),
      note("info","It also researches the Lookbook, sets the colour grade and designs shot coverage where it's missing or weak (writing credits). Scenes whose shots you approved or locked keep them. The Lookbook's render style fills every card that has no style yet \u2014 a style already set on a card stays.","info"),
      note("info","Not included: shot frames and storyboards. Render the frames from the Shots tab, then compose the boards in Storyboards.","info"),
      React.createElement("div",{className:"cc-model"},
        React.createElement(Icon.sparkles,{s:12}),
        React.createElement("span",null,"Writes with ",React.createElement("b",null,midLabel+(midRec?" · recommended":"")),
          " — switch it in the Writing dock on the right edge before you run. The run starts as soon as you press Run.")),
      React.createElement("div",{className:"cc-foot"},
        React.createElement("button",{className:"ns-btn ghost",onClick:onCancel},"Cancel"),
        React.createElement("button",{className:"ns-btn primary",onClick:onConfirm},
          React.createElement(Icon.robot,{s:16}), "Run pre-production"))));
}
window.CoordConfirm = CoordConfirm;

/* DESIGN THE CAST — what the Casting Director will make, and its price, BEFORE it runs
   (2026-10-03, owner). It used to start the moment the button was pressed and work through the
   whole cast. Scope: the characters with no sheet yet (default), every character, or one scene's
   cast (from "Design this scene's cast"); appearance variants can be left out. It only fills
   what's missing either way — nothing that exists is regenerated. */
function castDesignPlan(characters, scope, sceneIds, withVariants){
  const img = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  const drafted = (typeof charVisualsDrafted==="function") ? charVisualsDrafted : (()=>true);
  const C = (characters||[]).filter(Boolean);
  const inScene = new Set(sceneIds||[]);
  const list = scope==="scene" ? C.filter(c=>inScene.has(c.id))
    : scope==="missing" ? C.filter(c=>!img(c.id)) : C;
  const specs = list.filter(c=>!drafted(c)).length;
  const sheets = list.filter(c=>!img(c.id)).length;
  const variants = withVariants ? list.reduce((a,c)=> a + ((c.states)||[]).filter(st=>st && st.sceneId && !img(c.id+":"+st.id)).length, 0) : 0;   // pinned only, as the Casting Director makes
  const noStates = withVariants ? list.filter(c=>!((c.states)||[]).length).length : 0;
  return { ids:list.map(c=>c.id), n:list.length, specs, sheets, variants, noStates, images:sheets+variants };
}
window.castDesignPlan = castDesignPlan;
/* A CHARACTER'S IDENTITY BEFORE ITS SHEETS (2026-10-10, owner): every character image is refused until the character's
   pronouns are set (character-identity.js turnAssertCharacterIdentity — the house rule is explicit pronouns only).
   Design the cast ran anyway, drafted and paid for writing, then failed every sheet and reported "Cast designed".
   null = fine; { kind:"unset"|"conflict", suggest:"he/him"|"", message } otherwise. suggest is the one set of pronouns
   the screenplay itself uses for them, when it's unambiguous. */
function turnIdentityBlock(c, cast){
  if(!c || typeof window.turnAssertCharacterIdentity!=="function") return null;
  try{ window.turnAssertCharacterIdentity(c, cast ? { cast } : {}); return null; }
  catch(e){
    const r = (e && e.identityReport) || (typeof window.turnIdentityReport==="function" ? window.turnIdentityReport(c, cast ? { cast } : {}) : null) || {};
    const kind = r.status==="conflict" ? "conflict" : "unset";
    return { kind, suggest:kind==="unset" ? String(r.scriptPronouns||"") : "", message:String((e && e.message) || "") };
  }
}
window.turnIdentityBlock = turnIdentityBlock;
function CastConfirm({ characters, props, sceneId, sceneNo, sceneIds, onCancel, onConfirm, onSetPronouns }){
  const C = characters||[];
  const [scope, setScope] = React.useState(sceneId ? "scene" : "missing");
  const [withVariants, setWithVariants] = React.useState(true);
  const plan = castDesignPlan(C, scope, sceneIds, withVariants);
  /* LIKENESS (2026-10-10, owner — Likeness review): a character with a likeness sends its photos with each of its
     sheets (+ the worn-item sheets on a master, + the master on a variant) — GPT Image charges each, so the price
     counts them; and a likeness this person can't use here is said before the run starts */
  const _img = (id)=> (typeof nbGetImage==="function") ? !!nbGetImage(id) : false;
  const planChars = C.filter(c=>c && plan.ids.indexOf(c.id)>=0);
  const lkAny = planChars.some(c=> (window.turnLikenessRefCount||(()=>0))(c.id)>0);
  const lkRefs = [];
  if(lkAny) planChars.forEach(c=>{
    const lk = (window.turnLikenessRefCount||(()=>0))(c.id);
    const ex = new Set(Array.isArray(c.wornReferenceExclusions) ? c.wornReferenceExclusions : []);
    const worn = (props||[]).filter(p=>p && p.ownerId===c.id && p.kind!=="carried" && !ex.has(p.id) && _img(p.id)).length;
    if(!_img(c.id)) lkRefs.push(lk + worn);
    if(withVariants) ((c.states)||[]).filter(st=>st && st.sceneId && !_img(c.id+":"+st.id)).forEach(()=> lkRefs.push(lk + 1));
  });
  const lkUnavailable = planChars.map(c=> (window.turnLikenessUnavailableText||(()=>""))(c.id, c.name)).filter(Boolean);
  // characters whose sheets would be refused: they're named here with a one-click fix, and left out of the run
  const blocked = planChars.map(c=>({ c, b:turnIdentityBlock(c, C) })).filter(x=>x.b);
  const blockedIds = new Set(blocked.map(x=>x.c.id));
  const suggestable = blocked.filter(x=>x.b.suggest && typeof onSetPronouns==="function");
  const runIds = plan.ids.filter(id=>!blockedIds.has(id));
  const count = (sc)=> castDesignPlan(C, sc, sceneIds, false).n;
  const scNo = String(sceneNo!=null ? sceneNo : "").padStart(2,"0");
  const scopes = [
    sceneId ? { id:"scene", label:"Scene "+scNo+"'s cast", n:count("scene") } : null,
    { id:"missing", label:"Characters without a sheet", n:count("missing") },
    { id:"all", label:"Every character", n:count("all"), hint:"also adds missing appearance variants to finished characters" },
  ].filter(Boolean);
  const note = (icon, text, cls)=> React.createElement("div",{className:"cc-note"+(cls?" "+cls:"")},
    React.createElement(Icon[icon]||Icon.alert,{s:12}), React.createElement("span",null,text));
  const lines = [
    { id:"specs", label:"Looks to draft", unit:"spec", n:plan.specs, writing:true },
    { id:"sheets", label:"Master sheets", unit:"sheet", n:plan.sheets },
    { id:"variants", label:"Appearance variants", unit:"variant", n:plan.variants },
  ].filter(l=>l.n>0);
  const nothing = !plan.n || (!plan.specs && !plan.images && !plan.noStates);
  // a real dialog: Escape cancels, focus moves in, and the scene pager behind it keeps still (2026-10-09)
  usePreviewDialog(onCancel);
  return React.createElement("div",{className:"ns-overlay",role:"dialog","aria-modal":"true",tabIndex:-1,ref:_previewFocus,
      onMouseDown:e=>{ if(e.target===e.currentTarget) onCancel(); }},
    React.createElement("div",{className:"cc-modal","data-testid":"cast-confirm"},
      React.createElement("div",{className:"cc-head"},
        React.createElement("span",{className:"cc-orb"}, React.createElement(Icon.robot,{s:18})),
        React.createElement("div",null,
          React.createElement("div",{className:"cc-title"},"Design the cast"),
          React.createElement("div",{className:"cc-sub"},"The Casting Director drafts each look, finds appearance changes, then makes the master sheet and its variants. It only fills what's missing \u2014 nothing that exists is redone."))),
      React.createElement("div",{className:"cc-scope",role:"radiogroup","aria-label":"Which characters"},
        scopes.map(o=>React.createElement("label",{key:o.id,className:"cc-scope-opt"+(scope===o.id?" on":"")},
          React.createElement("input",{type:"radio",name:"cast-scope",checked:scope===o.id,onChange:()=>setScope(o.id)}),
          React.createElement("span",{className:"cc-scope-lab"}, o.label,
            o.hint && React.createElement("span",{className:"cc-scope-hint"}, o.hint)),
          React.createElement("span",{className:"cc-list-n"}, o.n+" character"+(o.n!==1?"s":""))))),
      React.createElement("label",{className:"cc-check"},
        React.createElement("input",{type:"checkbox",checked:withVariants,onChange:e=>setWithVariants(e.target.checked)}),
        React.createElement("span",null,"Also make appearance variants (wounds, dirt, costume changes)")),
      nothing
        ? note("check", plan.n ? "Everything in this choice already exists \u2014 there's nothing to make." : "No characters in this choice.", "ok")
        : React.createElement(React.Fragment,null,
            React.createElement("div",{className:"cc-est"},
              React.createElement("span",{className:"cc-est-n"}, String(plan.images)),
              React.createElement("span",{className:"cc-est-l"}, "image"+(plan.images===1?"":"s")+" to generate"),
              plan.images>0 && (lkAny && lkRefs.length===plan.images
                ? React.createElement(window.LikenessBatchCost,{ refs:lkRefs })
                : (typeof window.nbCostChip==="function" && window.nbCostChip(plan.images)))),
            lines.length>0 && React.createElement("ul",{className:"cc-list"},
              lines.map(l=>React.createElement("li",{key:l.id},
                React.createElement("span",{className:"cc-list-lab"}, l.label),
                React.createElement("span",{className:"cc-list-n"}, l.n+" "+l.unit+(l.n===1?"":"s")+(l.writing?" \u00b7 writing credits":""))))),
            plan.noStates>0 && note("alert", plan.noStates+" character"+(plan.noStates!==1?"s have":" has")+" no appearance changes listed yet \u2014 each one it finds adds one image."),
            lkAny && note("info","The price counts each likeness's photos \u2014 they go with every sheet of that character.","info"),
            ...lkUnavailable.map((t,i)=> React.createElement("div",{key:"lku"+i,className:"cc-note"},
              React.createElement(Icon.alert,{s:12}), React.createElement("span",null,t))),
            note("info","Each image uses credits at the engine and resolution set in the Images dock on the right edge.","info")),
      blocked.length>0 && React.createElement("div",{className:"cc-pronouns",role:"group","aria-label":"Pronouns needed"},
        React.createElement("div",{className:"cc-note"},
          React.createElement(Icon.alert,{s:12}),
          React.createElement("span",null, blocked.length+" character"+(blocked.length!==1?"s need":" needs")+" pronouns before their sheets can be made "
            +"— "+(blocked.length!==1?"they're":"it's")+" left out of this run until then.")),
        suggestable.length>1 && React.createElement("button",{type:"button",className:"ns-btn ghost cc-pron-all",
          onClick:()=>suggestable.forEach(x=>onSetPronouns(x.c.id, x.b.suggest))},"Use the screenplay's pronouns for all "+suggestable.length),
        React.createElement("ul",{className:"cc-list"},
          blocked.map(({c,b})=>React.createElement("li",{key:c.id},
            React.createElement("span",{className:"cc-list-lab"}, c.name||"Character"),
            b.kind==="conflict"
              ? React.createElement("span",{className:"cc-list-n"},"the screenplay and the card disagree — check it on the card")
              : (typeof onSetPronouns==="function"
                ? React.createElement("span",{className:"cc-pron-pick"},
                    b.suggest && React.createElement("button",{type:"button",className:"ns-btn ghost",
                      title:"The screenplay refers to "+(c.name||"them")+" as "+b.suggest,
                      onClick:()=>onSetPronouns(c.id, b.suggest)},"Use "+b.suggest+" (from the screenplay)"),
                    React.createElement("select",{className:"char-pronoun-sel","aria-label":"Pronouns for "+(c.name||"this character"),value:"",
                      onChange:e=>{ if(e.target.value) onSetPronouns(c.id, e.target.value); }},
                      [["", b.suggest ? "or choose…" : "choose…"],["he/him","he/him"],["she/her","she/her"],["they/them","they/them"]]
                        .map(o=>React.createElement("option",{key:o[0]||"x",value:o[0],disabled:!o[0]},o[1]))))
                : React.createElement("span",{className:"cc-list-n"},"set them on the card")))))),
      React.createElement("div",{className:"cc-foot"},
        React.createElement("button",{className:"ns-btn ghost",onClick:onCancel},"Cancel"),
        React.createElement("button",{className:"ns-btn primary",disabled:nothing || !runIds.length,
          title:!runIds.length && blocked.length ? "Set the pronouns above first" : undefined,
          onClick:()=>onConfirm({ only: (scope==="all" && !blocked.length) ? null : runIds, variants:withVariants })},
          React.createElement(Icon.robot,{s:16}), "Design "+runIds.length+" character"+(runIds.length!==1?"s":"")))));
}
window.CastConfirm = CastConfirm;

/* shown only when a tab's component hasn't loaded (every tab is built — this used to
   promise a coming-soon increment for tabs that already exist) */
function ArtComingSoon({ tab }){
  const t = (ART_TABS.find(x=>x.id===tab)||{});
  return React.createElement("div",{className:"art-soon"},
    React.createElement("div",{className:"art-soon-ic"},React.createElement(Icon[t.icon]||Icon.sparkles,{s:30})),
    React.createElement("div",{className:"art-soon-t"},t.label||"This tab"),
    React.createElement("div",{className:"art-soon-d"},"This tab is still loading. If it doesn't appear in a moment, reload the page."),
    React.createElement("button",{type:"button",className:"art-draftall ghost",style:{marginTop:14},onClick:()=>{ try{ window.location.reload(); }catch(e){} }},
      React.createElement(Icon.undo,{s:14}),"Reload"));
}

/* TAB LOCKS (2026-09-27, owner-approved — docs/Story Pipeline.md step 9, "The tabs unlock in that
   order"). A locked tab stays visible in the tab bar; opening it shows THIS card in the content area:
   what the tab is waiting for and one primary button to the step that unlocks it, plus the build
   order with each step's state. Tabs are named as the tab bar labels them, with the format's own
   department name in brackets where it differs ("Props (Artifacts & Archive)", "Characters
   (Subjects)"). When the step before this tab is locked too, the card names it and its button goes to
   the first OPEN step of the chain — never to another lock card. `locks` is App's turnArtTabLocks
   result (app/art-tab-locks.js). The card is rendered OUTSIDE the view-only `inert` boundary: it
   changes nothing (the button only switches tab), so a View-only or Writer collaborator can read it
   with a screen reader and use its button. */
function ArtTabLock({ tab, locks, onGo }){
  const lock = (locks && locks[tab]) || {};
  const order = window.TURN_ART_TAB_ORDER || ["lookbook","characters","props","locations","stylebible","shots","storyboard"];
  const headId = "art-lock-t-"+tab;
  const t = ART_TABS.find(x=>x.id===tab) || {};
  const TabIc = Icon[t.icon] || Icon.sparkles;
  const prog = lock.progress;
  return React.createElement("section",{className:"art-lock","aria-labelledby":headId},
    React.createElement("div",{className:"art-lock-ic","aria-hidden":"true"},
      React.createElement(TabIc,{s:26}),
      React.createElement("span",{className:"art-lock-badge"},React.createElement(Icon.padlock||Icon.alert,{s:14}))),
    React.createElement("h2",{className:"art-lock-t",id:headId},(lock.display||lock.name||t.label||"This tab")+" is locked"),
    React.createElement("p",{className:"art-lock-d"},lock.waitingFor||""),
    (prog && prog.total>0) && React.createElement("div",{className:"art-lock-meter",role:"progressbar",
        "aria-label":"Written specs","aria-valuemin":0,"aria-valuemax":prog.total,"aria-valuenow":prog.done},
      React.createElement("span",{style:{width:Math.round(100*prog.done/prog.total)+"%"}})),
    lock.unlockTab && React.createElement("button",{type:"button",className:"art-draftall art-lock-go",
        onClick:()=>{
          if(onGo) onGo(lock.unlockTab);
          // this button unmounts with the card — hand keyboard focus to the tab it opened
          setTimeout(()=>{ try{ const b = typeof document!=="undefined" && document.querySelector('.viewnav .seg[aria-current="page"]'); if(b && b.focus) b.focus(); }catch(e){} }, 0);
        }},
      "Go to "+lock.unlockLabel, React.createElement(Icon.arrowR,{s:14})),
    React.createElement("ol",{className:"art-lock-order","aria-label":"The Art Room builds in this order"},
      order.map(id=>{
        const e = (locks && locks[id]) || {};
        const state = id===tab ? "current" : (e.locked ? "locked" : "open");
        return React.createElement("li",{key:id,className:"art-lock-step is-"+state,"aria-current":id===tab?"step":undefined},
          e.locked && React.createElement(Icon.padlock||Icon.alert,{s:10}),
          React.createElement("span",null,e.label||((ART_TABS.find(x=>x.id===id)||{}).label)||id),
          e.locked && React.createElement("span",{className:"sr-only"}," (locked)"));
      })));
}
window.ArtTabLock = ArtTabLock;

function ArtRoom({ artView, setArtView, project, characters, scenes, props, drafts, trash, tabLocks, noPropsConfirmed, onSetNoProps, onRestoreChar, onPurgeChar, onRestoreProp, onPurgeProp, onRestoreLoc, onPurgeLoc, onRestoreShot, onPurgeShot, onEnsureOwner, onUpdateChar, onDraftVisuals, onDraftAllVisuals, draftingVisualId, draftingAllVisuals, draftingVisualIds, onCreateOwnedProp,
  onSuggestStates, suggestingStatesId, onBuildWornProps, onRemoveOwnedItem, onRenameOwnedItem, onDeleteCharacter,
  onUpdateProp, onDraftProp, onDraftAllProps, onAddProp, onImportProps, onDeleteProp, draftingPropIds, draftingPropId, draftingAllProps, onMergeProps, castHasProps,
  locations, onUpdateLocation, onDraftLocation, onDraftAllLocs, onDeleteLocation, draftingLocIds, draftingAllLocs, scriptHasLocs, onSetFilmStock, onUpdatePreset, onDeletePreset, onSetStyleRefs, onSetScenePreset, onAddStyleRefImages, onRemoveStyleRefImage, onDraftStaging, draftingStageId, sluglineUnits, onUpdateUnit, onRemoveUnit,
  shots, beatsMap, onMakeSceneNeeds, onOpenStage, wardrobeIds, colorRefsOwned, onUseLookbookColorRefs, onKeepColorRefs, onUpdateShot, onAddShot, onDeleteShot, onDeleteShotReference, onSplitBeat, splittingBeat, onRefineBeat, refiningBeat, onRemoveMicroBeatShots, onDraftSceneShots, draftingSceneShots, onDraftAllShots, draftingAllShots, onColorist, onCast,
  lookbook, lookbookNote, onUpdateLookbook, onAddLookbook, onDeleteLookbook, onSetLookbookNote, onResearch,
  onResearchFresh, onRestoreLookbook, onPurgeLookbook, onSuggestLookbookNote, suggestingLookbookId,
  staleTabs, onApplyLookbook, onSourceClick, canReview=false, onReviewLookbook, readOnly=false, projectLoading=false }){
  const _stale = staleTabs || {};
  const PropSheets = window.PropSheets;
  const LocationSheets = window.LocationSheets;
  const LookbookView = window.LookbookView;

  // Pre-warm EVERY asset URL in the project in ONE batched round-trip the moment the Art Room
  // opens, so any tab (Characters, Props, Locations, Shot List) paints with no per-card DB +
  // signed-URL call. Then preload the BYTES of whichever tab is on screen so it's instant;
  // other tabs still load bytes on click, but with no round-trip first.
  const projId = project && project.id;
  React.useEffect(()=>{ if(typeof nbPrefetchAll==="function") nbPrefetchAll(); },[projId]);
  // the ⋮ menu's "Export art department bible" — from any Art Room tab
  React.useEffect(()=>{
    window.turnExportArtBible = ()=> window.exportArtBible && window.exportArtBible({ project, characters, props, locations, scenes, drafts, shots });
    return ()=>{ if(window.turnExportArtBible) delete window.turnExportArtBible; };
  });
  // a LOCKED tab shows only its lock card (see ArtTabLock) — nothing behind it mounts or preloads
  const lockedView = !!(tabLocks && tabLocks[artView] && tabLocks[artView].locked);
  const tabPreloadIds = ()=>{
    if(lockedView) return [];
    if(artView==="lookbook") return (lookbook||[]).map(c=>c&&c.id).filter(Boolean);
    if(artView==="characters") return (characters||[]).flatMap(c=> (c&&c.id) ? [c.id, ...(c.states||[]).map(s=>c.id+":"+s.id)] : []);
    if(artView==="props") return (props||[]).map(p=>p&&p.id).filter(Boolean);
    if(artView==="locations") return [
      ...(locations||[]).flatMap(l=> (l&&l.id) ? [
        l.id,
        ...(l.variants||[]).map(v=> typeof locationAppearanceStateAssetId==="function"
          ? locationAppearanceStateAssetId(l,v,sluglineUnits||[]) : l.id+"-"+v.id),
        ...(l.coverageSheets||[]).map(v=>l.id+"-"+v.id)
      ] : []),
      ...((typeof sluglineUnitImageId==="function")
        ? (sluglineUnits||[]).filter(u=>u&&!u.orphan).map(u=>sluglineUnitImageId(u.key)) : [])
    ];
    if(artView==="shots") return (shots||[]).map(s=>s&&s.id).filter(Boolean);
    return [];
  };
  React.useEffect(()=>{
    if(typeof nbPreloadFor!=="function") return;
    const ids = tabPreloadIds();
    if(!ids.length) return;
    if(typeof nbPrefetchAll==="function") nbPrefetchAll().then(()=>nbPreloadFor(ids)); else nbPreloadFor(ids);
  },[artView, projId, lockedView, (characters||[]).length, (props||[]).length, (locations||[]).length, (shots||[]).length, (lookbook||[]).length]);

  /* VIEW-ONLY ROLES SEE THE STORYBOARDS (2026-10-09, owner — Storyboards review): a read-only role and a Stage
     editor page, view and export the board. On the Storyboards tab the boundary moves onto the tools wrapper (as
     on a locked tab) and StoryboardView disables or hides every changing control itself (its readOnly prop),
     keeping only its engine settings inert; every other tab stays inside the boundary.
     ...AND USE THE BREAKDOWN (2026-10-09, owner — Breakdown review): filter it, open "+N more", read its tip, open
     other tabs from its chips and export both documents; BreakdownView hides Make and Render for them (readOnly). */
  const viewableTab = !lockedView && ((artView==="storyboard" && !!window.StoryboardView) || (artView==="breakdown" && !!window.BreakdownView));
  const rootInert = readOnly && !lockedView && !viewableTab;
  return React.createElement("div",{
    className:"artroom"+(readOnly?" is-readonly":"")+(lockedView?" is-locked":""),
    "aria-disabled":rootInert?"true":undefined,
    /* Art cards own several direct image-generation/edit controls rather than
       routing every mutation through App callbacks. `inert` is therefore the
       single fail-closed boundary for a view-only role (and while another
       project is hydrating): it blocks paid model launches as well as fields,
       menus and destructive controls, while normal page scrolling still works.
       On a LOCKED tab the boundary moves onto the tools wrapper below, so the
       lock card (read-only by nature: its one button switches tab) stays usable. */
    inert:rootInert?"":undefined
  },
    React.createElement("div",{className:"artroom-tools",inert:(readOnly && (lockedView || viewableTab))?"":undefined},
      // fixed engine dock — Model / Aspect / Resolution, always reachable while
      // scrolling at every viewport
      React.createElement(NbDock,null),
      // Blender Studio is always open (it reads the locations, not a visual step): never behind a lock
      window.BlenderStudioHost&&React.createElement(window.BlenderStudioHost,{key:"studio-"+projId,
        locations,characters,props,scenes,drafts,sluglineUnits,readOnly})),
    // (pre-production readiness strip removed — user ruling 2026-07-19)
    lockedView
      ? React.createElement(ArtTabLock,{tab:artView,locks:tabLocks,onGo:setArtView})
    : artView==="lookbook" && LookbookView
      ? React.createElement(LookbookView,{project,lookbook,note:lookbookNote,
          onUpdate:onUpdateLookbook,onAdd:onAddLookbook,onDelete:onDeleteLookbook,onSetNote:onSetLookbookNote,onResearch,
          onResearchFresh,onRestore:onRestoreLookbook,onPurge:onPurgeLookbook,onSuggestNote:onSuggestLookbookNote,suggestingId:suggestingLookbookId})
    : artView==="characters"
      ? React.createElement(CharacterSheets,{readOnly,wardrobeIds:wardrobeIds||[],project,characters,scenes,props,drafts,shots,beatsMap,onUpdate:onUpdateChar,
          onDraftProp,onCreateOwnedProp,
          onDraft:onDraftVisuals,onDraftAll:onDraftAllVisuals,draftingId:draftingVisualId,draftingAll:draftingAllVisuals,draftingIds:draftingVisualIds,
          trashItems:(trash&&trash.characters)||[],onRestore:onRestoreChar,onPurge:onPurgeChar,
          onSuggestStates,suggestingStatesId,onBuildWornProps,onRemoveOwnedItem,onRenameOwnedItem,onDelete:onDeleteCharacter,onCast,
          lookbookStale:!!_stale.characters,onApplyLookbook:()=>onApplyLookbook&&onApplyLookbook("characters"),
          onApplyLookbookDraftOnly:()=>onApplyLookbook&&onApplyLookbook("characters","draft"),
          lookbook,lookbookNote,onOpenLookbook:setArtView?()=>setArtView("lookbook"):null})
    : artView==="props" && PropSheets
      ? React.createElement(PropSheets,{project,props,characters,scenes,drafts,onSourceClick,onUpdate:onUpdateProp,onDraft:onDraftProp,
          onDraftAll:onDraftAllProps,onAdd:onAddProp,onImportProps,onDelete:onDeleteProp,draftingId:draftingPropId,draftingIds:draftingPropIds,draftingAll:draftingAllProps,
          trashItems:(trash&&trash.props)||[],onRestore:onRestoreProp,onPurge:onPurgeProp,onEnsureOwner,
          castHasProps,onMergeProps,noPropsConfirmed,onSetNoProps,
          lookbookStale:!!_stale.props,onApplyLookbook:()=>onApplyLookbook&&onApplyLookbook("props"),
          onApplyLookbookDraftOnly:()=>onApplyLookbook&&onApplyLookbook("props","draft")})
    : artView==="locations" && LocationSheets
      ? React.createElement(LocationSheets,{project,locations,scenes,drafts,onUpdate:onUpdateLocation,onDraft:onDraftLocation,sluglineUnits,onUpdateUnit,onRemoveUnit,readOnly,
          onDraftAll:onDraftAllLocs,onDelete:onDeleteLocation,draftingIds:draftingLocIds,draftingAll:draftingAllLocs,
          trashItems:(trash&&trash.locations)||[],onRestore:onRestoreLoc,onPurge:onPurgeLoc,
          scriptHasLocs,onDraftStaging,draftingStageId,
          lookbookStale:!!_stale.locations,onApplyLookbook:()=>onApplyLookbook&&onApplyLookbook("locations"),
          onApplyLookbookDraftOnly:()=>onApplyLookbook&&onApplyLookbook("locations","draft")})
      : artView==="stylebible" && window.StyleBibleView
      ? React.createElement(window.StyleBibleView,{project,scenes,onSetRefs:readOnly?null:onSetStyleRefs,onSetScenePreset:readOnly?null:onSetScenePreset,
          onAddRefImages:readOnly?null:onAddStyleRefImages,onRemoveRefImage:readOnly?null:onRemoveStyleRefImage,onColorist:readOnly?null:onColorist,
          onSetFilmStock:readOnly?null:onSetFilmStock,onUpdatePreset:readOnly?null:onUpdatePreset,onDeletePreset:readOnly?null:onDeletePreset,
          lookbookStale:!!_stale.stylebible,onApplyLookbook:()=>onApplyLookbook&&onApplyLookbook("colorist"),
          refsOwned:!!colorRefsOwned,onUseLookbookRefs:readOnly?null:onUseLookbookColorRefs,onKeepRefs:readOnly?null:onKeepColorRefs})
    : artView==="shots" && window.ShotList
       ? React.createElement(window.ShotList,{project,scenes,characters,props,locations,shots,beatsMap,
           onUpdateShot,onAddShot,onDeleteShot,onDeleteShotReference:readOnly?null:onDeleteShotReference,onSplitBeat,splittingBeat,onRefineBeat,refiningBeat,
          onRemoveMicroBeatShots:readOnly?null:onRemoveMicroBeatShots,onMakeSceneNeeds:readOnly?null:onMakeSceneNeeds,readOnly,
          onDraftSceneShots,draftingSceneShots,onDraftAllShots,draftingAllShots,
          trashItems:(trash&&trash.shots)||[],onRestore:readOnly?null:onRestoreShot,onPurge:readOnly?null:onPurgeShot,
          lookbookStale:!!_stale.shots,
          onReviewLookbook:canReview?()=>onReviewLookbook&&onReviewLookbook("shots"):null})
      : artView==="storyboard" && window.StoryboardView
      ? React.createElement(window.StoryboardView,{project,scenes,shots,characters,props,locations,beatsMap,setArtView,onUpdateShot,readOnly})
      : artView==="breakdown" && window.BreakdownView
      ? React.createElement(window.BreakdownView,{loading:!!projectLoading,project,scenes,characters,props,locations,shots,drafts,setArtView,onMakeSceneNeeds:readOnly?null:onMakeSceneNeeds,onOpenStage,readOnly})
      : React.createElement(ArtComingSoon,{tab:artView}));
}
window.ArtRoom = ArtRoom;
