# Blender Studio

Blender Studio adds reusable location/place sets and shot-specific staging to the
original one-shot preview bridge. It is an optional companion to Locations,
Characters and Shots, not a replacement for their approved artwork.

## Start with a location

1. Open a saved cloud film and its Locations tab.
2. Expand **Blender Studio · reusable set** on the location or contained-place
   card, below **Staging & composition** inside the card's details, matching the
   Shots tab's section layout. **About Blender Studio** explains the tools without starting a request;
   choose **Open Studio** when you are ready.
3. Download the updated Cinema Machine add-on using the panel's download control.
   Install the ZIP in Blender Preferences → Add-ons → Install from Disk.
   On an Intel Mac, use a compatible Intel Blender release such as 4.5 LTS.
4. In **Connect Blender**, choose **Create pairing code**. Use the separate
   **Copy** buttons beside Function URL and Pair code, matching the Shots preview
   layout. Paste each value into the matching
   fields in Blender's CinemaMachine sidebar (press **N** in the 3D view).
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

The add-on must redraw its sidebar after a background response. Version 1.0.1
fixes stale connection/status display and can restore a stopped update timer on
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

## Scene builder

The desktop sidebar opens a Blender-native Studio dialog with task tabs, prompt,
model selection, reference controls, history and explicit generation controls.
Its layout follows the supplied chat reference, but uses native Blender widgets,
not a pixel-identical browser overlay.

The assistant proposes bounded changes to managed objects, materials, cameras and
blocking tracks. Review the proposal before **Apply**, then save the workspace.
Generated Python, arbitrary scripts and shell commands are never executed.

Select an attached project reference or explicitly attach a temporary PNG/JPEG
when asking for image-guided work. Source images from the device are temporary
provider inputs, not copies retained in shared project reference history.
An image-based layout is an interpretation, not a measurement or guaranteed
reconstruction of unseen space.

Model choices come from the server. A configured model is not proof of live
account access: unverified access is labelled, and a provider refusal is shown
without silently changing model or retrying.

## 3D models and character animation

The 3D Model controls use separate Meshy v7 text-to-3D and image-to-3D endpoints.
Choose the endpoint matching the input. Rigging and animation are explicit
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

## Boundaries

- The original version-1 preview/pairing protocol remains supported.
- Generated assets and preview bytes are retrieved through authenticated relay
  actions; API keys and provider polling URLs are not sent to the desktop.
- GLB imports are size/hash checked and reject external resources or executable
  content. Imports affect managed data, not arbitrary objects in the user's file.
- Camera and character animation remain editable in Blender. Automatic export of
  a motion-reference clip into Seedance is a later integration, not this feature.
- No character-orbit generation, authority-receipt cleanup, database-policy
  changes or Story Pipeline edits are part of this feature.

## Verification

```sh
node scripts/test-blender-studio-relay.mjs
node scripts/test-blender-studio-billing.mjs
node scripts/test-blender-studio-ui.mjs
blender --background --factory-startup --python scripts/test-blender-studio-native.py
node scripts/test-blender-studio-interop.mjs
```

The interoperability test packages the actual Python add-on, connects it to the
actual JavaScript relay with fake auth/storage/provider boundaries, and runs
native Blender rendering/import. It does not spend provider credits or establish
that a particular live provider account can generate successfully.