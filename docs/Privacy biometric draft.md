# Privacy policy — likenesses (biometric data): DRAFT

**Status: draft for the owner's legal review — not live.** (2026-10-10, owner — Likeness review.)
`privacy.html` was not changed. The proposed section below would sit after "Where your data lives".
Notes for the reviewer (not for publication) follow it.

---

## Likenesses (photos of a real face)

On a character card you can lock a *likeness*: photos of a real person's face (a front view and,
if you like, two three-quarter views), taken with your camera or uploaded, so that character keeps
that face in the images you make. A face is biometric data, so we handle it more carefully than
the rest of your work.

- **What we keep.** The photos; whose face it is (you, or the name of the person you say it is);
  your confirmation that you have their permission and that they're 18 or over, with the wording
  you agreed to, when you agreed and from which account; whether each photo came from your camera
  or an upload; and which character of which film it is for.
- **Where it's kept.** On your device only (in your browser's storage), unless you tick
  "Sync this likeness to the cloud". A synced likeness is kept in private storage with our backend
  provider (Supabase), so you can use it on your other devices.
- **Who can see it.** Only you. On a film shared with others, a synced likeness can also be used
  to make images by the film's owner and its Art directors, and the photos themselves are shown
  only to you and the film's owner. View-only members, Co-writers and Stage editors can't see or
  use it. A likeness you don't sync stays on your device, except when it's used as described next.
- **How it's used.** Each time an image of that character is made with the likeness — by you, or,
  for a synced likeness on a shared film, by the owner or an Art director — the photos are sent
  with the request to the AI image providers that make the image, as reference pictures, so the
  face matches. Our servers make a temporary copy of each photo for the provider to read and
  delete it as soon as the image has been made or the request has failed. The images made this way
  are part of your film and keep the face until you clear them.
- **Someone else's face.** You may lock someone else's likeness only with their permission, and
  only if they are 18 or over. You confirm both every time you lock one, and before a photo of
  another person is sent to make an image. Never use a likeness of a child.
- **Revoking and deleting.** You can revoke a likeness at any time, from the character card or
  from Likenesses in the Characters tab: it is deleted from your device and from the cloud. You'll
  be offered to clear the sheets already made with it too; any sheet you keep still shows the
  face. Deleting a film deletes the photos of its likenesses. If you ask us to delete your account,
  your likenesses are deleted with it.
- **Nothing else.** We don't use likenesses to recognise or identify anyone, we don't use them to
  train our own models, and we don't share them beyond what's described here.

---

## Notes for the reviewer (not for publication)

**What the app does today (so the text can be checked against it).**

| Point | Where |
|---|---|
| Captured: up to 3 photos (front, ¾ left, ¾ right), ≤1024 px JPEG; consent `{subject: self/other, name, adult: true, textVersion: "2026-10-10", at, by}`; per-photo source webcam/upload; character name | `app/cameo.jsx`, `app/imagegen.jsx` (LIKENESS store) |
| Local by default (IndexedDB), scoped to the account and the film (a Show: the Show); a teammate's synced likeness is held in memory only on their devices | `app/imagegen.jsx` |
| Cloud: one row per person per character per film + private photos under the uploader's folder | `app/cloud.jsx`, `supabase/team-relaunch.sql` §7d |
| Read: the capturer, the film's owner, the film's linked Art directors whose access is live; photos shown in the app only to the capturer and the owner | `supabase/team-relaunch.sql` §7d, `app/cameo.jsx` CameoManager |
| A row is refused without the consent record or with photos outside the capturer's own folder | `turn__cameo_row_ok`, `turn__cameo_consent_ok` |
| Sent to image providers as reference images on every render of that character | the Art Room's generation code (`app/artroom.jsx`) and `image-proxy` |
| Temporary server copies of data-URL references deleted right after each image request | `supabase/functions/image-proxy/index.ts` (`dropStagedInputs`) |
| Revoke: local copy, cloud row and photos; optional clearing of sheets made with it | `nbRevokeCameo`, `cameoRevokeFlow` |
| Film delete removes its likeness photos (owner's one-hour cleanup grant) | `cloudDeleteProject`, `turn_film_cameo_cleanup` |
| Consent also asked before a dropped reference photo / a Motion Control face is sent | `window.cameoConsentGate` (wired by the Art Room / Stage pass) |

**Open questions and gaps.**

1. **Legal basis.** Under UK/EU GDPR a face photo is special-category *biometric* data only when
   processed to uniquely identify someone; the app doesn't identify people, but handling it as
   special category (explicit consent, Art. 9(2)(a)) seems the safer reading. For "someone else",
   the user attests consent on their behalf; we don't verify it. Confirm this is acceptable and
   whether we need a way for the depicted person to ask for removal (privacy@ route).
2. **US state laws** (Illinois BIPA, Texas CUBI, Washington): if any applies, a public retention
   and destruction schedule and a written release may be needed. The draft has no retention period
   beyond "until you revoke it / delete the film / the account".
3. **AI providers' retention** of reference images follows their terms; the draft doesn't
   describe it. Check the processors list and whether any provider keeps inputs.
4. **Video renders.** A data-URL input staged for a *video* job that the provider accepted is kept
   until the job has run (the provider reads it then) and is swept only later (the Stage upload
   sweep). Likeness photos are used for images, not sent to video directly, but a Motion Control
   face photo is. The "deleted as soon as the image has been made" line is true for images only.
5. **Account deletion.** Rows go with the account (database cascade); the 30-day deletion process
   must also remove the account's `…/cameo/` files in storage.
6. **Sheets made with a face** are ordinary generated images: they stay (and stay visible to the
   film's members) until cleared. The draft says so; confirm that's enough.
7. **Earlier likenesses** (saved on a device before 2026-10-10) carry only the old one-tick
   consent; they're never synced until the person answers the new consent question.
8. **Children.** The policy says the service isn't for under-16s; likenesses require 18+.
