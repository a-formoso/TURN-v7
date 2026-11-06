# Blender Studio

Blender Studio adds reusable location/place sets and shot-specific staging to the
original one-shot preview bridge. It is an optional companion to Locations,
Characters and Shots, not a replacement for their approved artwork.

## Start with a location

The image-derived workflow ships in add-on **1.0.3** and needs the matching
`blender-bridge` deployment. Install the updated ZIP for desktop generation.
Existing artwork and workspace IDs are preserved; no automatic generation runs.

1. Open a saved cloud film and its Locations tab.
2. On a parent location card, choose **Whole location** or a room in the space
   selector. Generate that space's image, then choose **Build in Blender** inside
   **Spatial Layout & Staging**. The **Blender Studio** toolbar button opens the
   same dedicated workspace through an image-gated location chooser. Shots have
   a compact **Open this shot in Blender** handoff. There are no large Studio
   sections repeated across location, character or prop cards.
3. Download the updated Kinolot add-on using the panel's download control.
   Install the ZIP in Blender Preferences → Add-ons → Install from Disk.
   On an Intel Mac, use a compatible Intel Blender release such as 4.5 LTS.
4. In **Connect Blender**, choose **Create pairing code**. Use the separate
   **Copy** buttons beside Function URL and Pair code, matching the Shots preview
   layout. Paste each value into the matching
   fields in Blender's Kinolot sidebar (press **N** in the 3D view).
   Approve the project and click **Connect** in Blender. The web panel confirms
   **Paired** automatically and folds completed setup away. This is pairing
   registration, not desktop liveness: check for **Status: Connected** in Blender
   before using desktop tools. Expired codes
   have a clear replacement action; blocked clipboard access offers manual copy.
   The Project ID identifies the film, not an individual shot.
5. Open the location workspace. The desktop Studio tools can load the selected
   location and, when selected in Shots, the shot's camera and timeline.

The website uses four numbered steps: **Install → Connect → Choose what to make
→ Review and apply**. Revision, counters, manual save/reload, request history and
model diagnostics are under **Workspace details**. Applying in the browser saves
the set; use **Open current workspace** initially, then **Refresh** in Blender to
load saved changes. Pairing and installation do not start paid generation.

### Blender still displays Connecting

The add-on must redraw its sidebar after a background response. Version 1.0.2
accepts the versioned location production package, fixes stale connection/status display and can restore a stopped update timer on
an explicit Connect or Open Studio action. The website's **Paired** label alone
does not prove that Blender is currently responding.

For an older installation, moving the pointer over Blender's sidebar may refresh
the display. To update, disconnect in the website first, save your Blender file,
install the new ZIP from step 1, and restart Blender. Create a fresh pairing code
and connect again. Desktop tokens are memory-only, so restarting requires pairing
again. This fix does not change the relay, start generation or spend credits.

Each canonical location/place has one reusable workspace within the film. Its
parent/root IDs preserve the existing location hierarchy; they are not inferred
from names. Separate places do not automatically become a measured floor plan.

The Locations grid groups established rooms inside their parent card. The room
selector changes which existing space you edit or open in Blender; it does not
merge their geometry, asset history or workspace IDs. **Screenplay Evidence**
shows source passages, and the parent's **Slugline Units** links to each room/time
unit. Each unit has one plate and a **Lighting & environment** editor. There is no
separate Time-of-Day Variants section duplicating Night/Dawn units. Legacy linked
state notes are shown in that editor and edits keep the existing records in sync;
the plate and version history stay the same. Genuinely independent authored looks
remain under **Additional environment states** inside Slugline Units. Additional
space plates are also nested there. **Spatial Layout & Staging**
contains the reusable camera views and depth grids, plus **Scene dressing &
blocking** for occurrence-specific preparation. **Generation Prompt** shows the
current specification; the request used for the existing plate is kept separately.

## Location production package

Opening a location workspace sends the same versioned `cm-location-plan-v1`
package that the Locations UI exposes. Its layers have deliberately separate
jobs:

- **The Space** is the stable reusable set: architecture, materials, permanent
  lighting interfaces, baseline dressing, topology and binding continuity
  anchors.
- **Narrative Significance** is soft dramatic guidance: what the place means,
  how it functions in the story, its mood and theme, and the characters'
  relationship to it. It never overrides The Space's topology or locked anchors.
- **Slugline Units** record every authored heading or derived room cue, its
  provenance and each screenplay occurrence. A derived living-room cue remains
  screenplay evidence even when the writer did not type another formal slugline.
- **Environmental states** (`appearanceStates` in the production package) contain
  only persistent changes such as dawn, weather, practicals, damage or wear.
  Scripted changes are edited on their Slugline Unit, not in a duplicate UI card;
  independent authored looks retain their own asset. `INT` versus `EXT` is
  geography, not an appearance change. The handoff schema and asset IDs are unchanged.
- **Required Space Plates** are additional empty-set visual references the page
  needs, such as a threshold or opposite side. They preserve existing generated
  media IDs and version history.
- **Coverage Views**, inside **Spatial Layout & Staging**, are reusable camera
  bookmarks grounded in screenplay evidence and the relevant Slugline Units,
  with purpose, position, target, visible anchors, lens and a composition grid.
  The grid opens as a visual camera-relative map: Far, Middle and Near rows,
  left/centre/right positions, and a camera marker with a schematic viewing cone.
  Select a zone or the Floor strip to edit its full saved description; empty zones
  remain open space. Camera & framing details contains the text settings and scale.
  Draft layout invokes the existing script-based staging draft for the primary
  view only. The map is not a measured floor plan and selecting a zone does not
  generate anything or move Blender objects.
  Descriptive values guide
  Scene Builder; they are not silently treated as measured Blender transforms.
  A single view describes only what is in front of its camera, not the wall
  behind it. Describe the complete architecture in **The Space**, and add a
  reverse Coverage View when the opposite direction needs its own composition.
- **Scene Setups**, under **Scene dressing & blocking** in the same section,
  are scoped to one screenplay occurrence and carry temporary dressing,
  blocking/action path, handled props and starting object states.

The card's **Render style** picker sets the rendering treatment. There is no
separate **Look dev** fold for locations: its saved free-text style instructions
remain editable under **Generation Prompt → Render style details**. Choosing a
new preset replaces those instructions. Scene grading remains in **Styles**.

### Shared physical layout before rendering

**Spatial Layout & Staging → Shared set layout** stores one parent-owned room-space
plan, shared live by its subspaces. It does not replace the restored 3×3 camera
composition grid. The plan has a named orientation frame, stable anchor IDs,
room/object names, fixed relational placements, observed/script/design evidence,
supporting panels, doorway sightlines and unresolved geometry. Camera grids are
projections of this plan and cannot move its furniture.

The image card's **Review shared layout** button opens and scrolls directly to
this section. A layout that needs review expands automatically when Spatial Layout
& Staging opens. The workflow is **Review → Confirm → Generate**: compare the
placements against the reference panels, then use **Confirm floor plan** at
the top (also repeated after the fields). Confirmation uses no credits and does
not generate an image. **Back to image** returns to the generation control;
other prerequisites, such as a missing parent plate, still apply. Incomplete
plans show what must be filled in before confirmation, and view-only users cannot
confirm or edit. Closed object rows show their fixed placements for quick review;
open them to edit placements and evidence. The camera composition grid is unchanged.

**Draft specification** writes the location description; it does not fill the
shared placement fields. The floor-plan progress strip reads **Draft**,
**Measurements**, **Cameras**. The empty-state heading is **Draft the floor plan**;
a populated draft says **Review the floor plan**. An empty layout says **No layout yet** and puts
**Draft floor plan** at the top, with its writing-credit disclosure and a
manual-entry alternative. Partly filled layouts say **Placements incomplete**.
Once drafted, the populated fields say **Draft to review** and the top action
becomes **Confirm floor plan**. For existing layouts, optional redrafting
remains under **Need help? Draft with AI**. Enter corrections in the review
fields, then use **Draft floor plan** to propose a new plan.
This is an explicit writing-model call: with a parent plate it reads all panels together,
including partial views through doors; without an image it proposes a design
from written specifications. The draft is a local proposal until **Confirm shared
layout**. Manual authoring is also supported. Confirmation is human review, not
an automatic geometry certification. Missing/unreviewed layouts block location
renders (including simple, edit and headless paths) before image spending. A new
parent image invalidates the review; inspect its consistency and confirm again.
Existing images and saved specifications are never regenerated or migrated.

Image prompts and the Blender production package carry the same `sharedSetLayout`
contract. Compaction retains it ahead of verbose scene context. The reviewed
source plate remains a required visual reference when it exists. Object placement
is expressed in room-space relationships, not screen coordinates; dimensions and
occluded walls remain explicitly unknown until measured or designed. Blender
construction still needs a reviewed proposal and Apply. Generated images are not
guaranteed geometrically exact, and the plan is not photogrammetry.

Subspaces share their parent's render style live by default. A deliberate style
pick or edit on a room creates an independent override; **Use [parent]'s render
style** in Render style details restores inheritance. Saved room settings and
existing images are not deleted or regenerated when inheritance changes.
Child plate generation requires the current parent plate as a locked visual
reference, including simplified retries and background generation. Environment
states also require their own room plate. Missing references stop generation
before an image call. Batch rendering and specification drafting visit parents
before children, and child drafting receives the parent's actual design rules.
Match the exact room when visible in the parent plate; otherwise extend shared
finishes, construction details and scale without copying sibling-room furniture.
These constraints guide generation; they are not a guarantee of pixel-perfect
reconstruction. Existing plates need an explicit regeneration or edit to change.

This separation lets Scene Builder establish invariant geometry once, select an
appropriate Time-of-Day Variant and camera bookmark, then layer only the setup for
the scene being blocked. It does not change the story-building pipeline or turn
screenplay prose into an inferred building survey.

## Scene builder

The desktop sidebar opens a Blender-native Studio dialog with task tabs, prompt,
model selection, reference controls, history and explicit generation controls.
Its layout follows the supplied chat reference, but uses native Blender widgets,
not a pixel-identical browser overlay.

The assistant proposes bounded changes to managed objects, materials, cameras and
blocking tracks. Review the proposal before **Apply**, then save the workspace.
Generated Python, arbitrary scripts and shell commands are never executed.

The location production package is context for those proposals. Opening Studio
does not automatically create cameras, move actors or replace set geometry.

Studio requires the selected location's saved generated image, including for a
child room. Uploaded images and text alone do not unlock it. Scene Builder uses
that location image; asset and animation tools can select saved generated
character and prop images too. Source versions are validated and pixels are
loaded by the relay before paid work. Text refines the source; it cannot replace
it. There is no prompt-only or temporary-upload generation path. The browser
requires the relay's `generated-project-image-v1` capability and stops safely
with an update message when connected to an older relay.
An image-based layout is an interpretation, not a measurement or guaranteed
reconstruction of unseen space.

Model choices come from the server. A configured model is not proof of live
account access: unverified access is labelled, and a provider refusal is shown
without silently changing model or retrying.

## 3D models and character animation

The 3D Model controls use Meshy v7 image-to-3D from a generated project reference.
Rigging and animation in the desktop model tools are explicit
options; generated GLB assets appear in the workspace library for deliberate
import into Blender. Imports preserve supported native rigs/actions.

The Character animation assistant creates editable shot blocking/root-motion
tracks. It does not claim that a stand-in has become a reconstructed performer.
For rigged character animation, request a rigged/animated 3D asset in the model
controls and import it. Existing generated actions can be played and edited
locally in Blender.

Paid model requests require explicit acknowledgement. Opening a workspace,
editing locally, playback and local rendering do not invoke a paid provider.
Generation may remain unavailable until account, provider and credit-authority
checks pass. Cancelling does not promise to reverse provider work already done.

### Credit deductions and recovery

Studio uses a separate server-only credit function installed by
`supabase/studio-credit-settlement-migration.sql`. It checks the full cost and
records the deduction in one transaction. Retried completion messages use the
same private event ID, so they cannot deduct credits twice. Existing image/video
billing is not changed by this migration.

Only a non-spending readiness check runs when Studio checks whether billing is
available. Starting generation still requires the existing account's credits;
Studio does not grant starter credits or bypass balances for administrators.

If generation completes but its credit deduction cannot finish, Studio retains
the result privately and shows **Credit settlement pending**. Use **Retry credit
settlement** to finish the same task. This does not start another generation or
require a new paid-processing acknowledgement. A proposal or asset becomes
available only after the deduction succeeds.

## Reuse the set for shots

Open Studio from a shot to select its canonical location workspace. A new shot
adds its own camera, stand-ins and timeline; an existing shot retains saved edits.
The environment is shared rather than rebuilt for every shot.

Managed transforms, cameras, tracks and asset references can be saved back to the
workspace. Revision conflicts are explicit: local changes are retained for
review, not silently overwritten. Use Blender's own Save/Save As for the complete
local `.blend`, including detailed mesh edits and other Blender-only data.
The bridge does not upload or synchronize an entire `.blend` file.

Render and publish an auxiliary preview to return a separate still to the
location/shot workspace. Approved location art, character sheets and finished
shot frames are not replaced.

## Boards for the Stage

Add-on **1.1.0** adds **Publish board** to the shot row of the Studio dialog (owner
2026-10-26). Open the shot from Kinolot (**Open this shot in Blender**), choose
**Board frames** (1-4, default 3) and press **Publish board**: Blender renders quick
flat-colour Workbench stills through the shot's camera, evenly spaced from its
first frame to its last, at the scene's aspect ratio (long side 1280 px), then puts
the engine, resolution, shading and current frame back. One
`studio.board.publish` call stores them as ordinary previews named
`preview-board_<requestId>_<n>of<N>_f<frame>` with one revision bump, so the
workspace schema (and every add-on that validates it) is unchanged.

When the Stage opens that shot's clip, it reads the newest complete board,
lays it out as one page (`app/blender-board.js`: frames lettered A, B, C... left to
right, a caption under each, a key naming each coloured stand-in) and saves it as
the film image `blender-board-<shotId>`. The page joins the clip's references as
**Blender board**, on by default: its role tells the video model to take the
camera position and moves, screen direction, relative sizes and blocking from it
and every look from the other references, and never to show the stand-ins or
labels. A newer board replaces the page the next time the Stage opens the clip.
Publishing and composing cost nothing; a read-only viewer never writes a page.

## Boundaries

- The original version-1 preview/pairing protocol remains supported.
- Generated assets and preview bytes are retrieved through authenticated relay
  actions; API keys and provider polling URLs are not sent to the desktop.
- GLB imports are size/hash checked and reject external resources or executable
  content. Imports affect managed data, not arbitrary objects in the user's file.
- Camera and character animation remain editable in Blender. Boards carry stills to
  the Stage; exporting a motion-reference clip into Seedance is a later integration.
- No character-orbit generation, authority-receipt cleanup, database-policy
  changes or Story Pipeline edits are part of this feature.

## Verification

```sh
node scripts/test-blender-studio-relay.mjs
node scripts/test-blender-boards.mjs
node scripts/test-blender-studio-billing.mjs
node scripts/test-blender-studio-ui.mjs
blender --background --factory-startup --python scripts/test-blender-studio-native.py
node scripts/test-blender-studio-interop.mjs
```

The interoperability test packages the actual Python add-on, connects it to the
actual JavaScript relay with fake auth/storage/provider boundaries, and runs
native Blender rendering/import. It does not spend provider credits or establish
that a particular live provider account can generate successfully.

Missing object measurements name only the missing **Floor plan position** or
**Object dimensions (width, depth, height)**. **Vertical position** is the centre
(or recorded base) above the floor, not the object's physical height. The repair
action opens the named object and focuses the missing field; it does not invent
values or edit saved measurements.

Floor-plan drafting includes an explicit checklist for object position and size,
room outlines and levels, opening dimensions and types, and all four cameras.
Estimates remain proposed design values; unresolved fields are named. Missing
build measurements are displayed while reviewing the draft, before confirmation.
