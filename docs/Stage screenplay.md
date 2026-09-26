# Scene screenplay references on Stage

Each beat's video composer includes actual PNG screenplay page cards alongside
the other reference images, with the selected beat highlighted. Click a page to
open its full-size preview. There is no separate expandable **Scene screenplay**
section. The complete source text still reaches the generator, and the video
prompt remains editable and is derived from that beat's screenplay and shot design.

Beat-based grouping is the default. The prompt bar has no **Fit beat** dropdown;
**Render settings → Model → Advanced → Clip grouping** retains Fit beat,
Single shot and Previous packing. These choose which saved shots belong to a
render, not the camera cuts within its prompt. Existing grouping preferences and
historical takes are preserved.

## Default director's brief

Automatic Seedance direction uses a structured brief:

1. **Beat contract** — selected scene, beat/part and actual render duration.
2. **Active references** — included files with their actual tags, roles and shot assignments.
3. **Scene and opening state** — canonical setting, first-frame state and physical presence.
4. **Action and camera plan** — selected screenplay action in order, existing authored coverage and the render plan's exact time window for every saved shot. Later cuts restate carry-over positions, screen direction, gaze, scale and prop state; a final timing hold sustains the achieved state instead of inventing filler action.
5. **Performance** — screenplay reactions and exact delivery parentheticals, where provided. Direction describes visible behavior in pursuit of the authored objective rather than asking for a generic emotion.
6. **Lighting and physical continuity** — approved project look, event-driven changes and physical weight/contact/follow-through for bodies, cloth and props.
7. **Dialogue and sound** — exact, ordered utterances, recorded audio bindings, remote voices and messages.
8. **Ending and continuity locks** — end after the selected coverage, retaining its resulting positions and prop states.

Unknown facts are not filled in: no invented emotions, geography, optics, lighting
measurements or prop ownership. Shot-start/aggregate prop inventory is not asserted
to be the end state after an authored transfer. Dialogue markers retain distinct
occurrences even when the same words repeat. Message text is not spoken.

One saved shot, including a beat-opening shot, stays continuous. Numbered cuts
describe existing multiple-shot coverage only; the brief never creates Art Room
shots, keyframes or extra generation jobs. Named prompt styles bypass this default
while retaining the selected-coverage and continuous-shot constraints.

Changing duration or authored look/camera settings refreshes an untouched brief.
Manual edits survive, with review required when their source changes. Mandatory
screenplay inputs and render/recovery limits apply to every style as before.

The automatic brief declares each included reference role once. Stage does not
append a second copy of the same scope or reference block at submission; manually
edited and older named-style prompts still receive the hard boundary guards. The
primary prompt remains editable up to 12,000 characters, so touching a long
screenplay-backed brief cannot silently cut it down to the old 1,999-character UI
limit.

## What reaches the video generator

Checked screenplay pages are attached as actual image references, not just shown
in the composer. These PNGs are rendered locally from the current canonical
screenplay, not invented by an image model. Each checked page counts toward the
selected model's image and total input limits. Page chips can be unchecked and
checked again; canonical screenplay text remains binding even when no page image
is attached.

The complete scene is also appended to the submitted prompt as labeled source
text. Pages and text are reading context—not a composition reference or a
request to photograph the page, reproduce captions, or add every character
mentioned in the scene. Boundary instructions restrict performance to the
selected beat/shot/part, keep later action and dialogue out of the clip, and
preserve remote/offscreen delivery.

Normal renders, explicit prompt styles, manually edited prompts, batch
variations and extensions include the page images. Full screenplay and exact
image provenance accompany the take and its pending-job recovery record.
The **Render package** section and **Exact queued render** summary have been
removed; their underlying timing, source and reference checks still run.

No excerpt or partial page set replaces an overlong screenplay. If the pages
and other references exceed the model's limits, exclude optional images or
choose a higher-capacity model. Text-only rendering, single-start-frame models
such as the current Sora/Kling paths, and first/last-frame transition endpoints
cannot carry the required document references separately and are blocked.
A screenplay image is never substituted for the shot's opening frame.
The app does not choose another model, drop references, or start a replacement
job automatically.

Stage also checks available browser recovery storage before submitting page
references. A page set too large to retain safely stops before a paid request.
The exact PNG is retained once; input-position metadata describes what was sent
to the proxy, not the temporary signed URL the proxy later gives the provider.

Page previews stay local until you render. Rendering uses the existing video
proxy's private temporary-upload storage, which does not yet have automatic
cleanup. Signed-link expiry does not delete those stored input files.

## Changes and missing source

All beats track a scene-wide screenplay revision. Changes to any part of that
scene refresh its page images, text reference and an untouched derived prompt. Manual edits remain
intact; Stage asks you to review them against changed source before rendering.
**Reset to script** deliberately discards manual direction and restores the
current derivation.

Missing source or failed page rendering blocks generation rather than using stale shot text as the
scene's screenplay. A source or selected-beat change during preparation also
stops submission. The reference is readable with view-only access.

Existing spending, cancellation, media privacy, cast-reference validation,
selected-model behavior and completed-job settlement remain in force.
