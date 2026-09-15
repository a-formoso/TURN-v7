---
name: Stage browser fixture quirks
description: What the headless Stage browser regression can and cannot prove about UI — icon stubs, default viewport, off-screen programmatic clicks, and CSS override ordering.
---

- The Stage browser fixture stubs the whole `Icon` set as filled dots, so it can never verify a real glyph. To eyeball new icons/cards, render a tiny standalone HTML with the fixture's `react.js`/`react-dom.js`, `dist/app/icons.js` and `app/styles.css`, then screenshot it with headless Chromium (`--screenshot --force-device-scale-factor=4`).
- Its default viewport is small (~780×437) until a test sets device metrics; `.click()` on an off-screen element still fires. Any popover that measures its anchor at click time must clamp the anchor into the viewport, or the test will "open" it entirely off-screen. Scroll the anchor into view in tests before clicking, as a user would.
- `.sdbar-pop*` rules sit late in `app/styles.css`; a single-class override written earlier (e.g. under the `stage2-gen` block) loses on order. Use a descendant selector for popover placement overrides.
- The toolbar/strip menus share one `sdMenu` state and one document mousedown closer; every container that hosts a menu must be added to that closer's "inside" check or clicks inside the new menu close it.

**Why:** the "Add references" card (Sept 2026) shipped its picker as position:fixed after the first downward-only version was clipped by the scrolling centre column; the fixture's small viewport and off-screen clicks hid that until the assertions compared rects against the viewport.

**How to apply:** when moving or adding a Stage popover, assert popover *and* list rects are inside the viewport in both the default and a short (≈480px) viewport, and check focus entry/restoration explicitly.

## Fixture is a raw string; websocket flag
- The fixture page is assembled from a plain JS string, so regex escapes in stubs do not survive — match with `indexOf`. Run browser suites with `node --experimental-websocket` (WebSocket ReferenceError otherwise). Stale profiles: `rm -rf /tmp/fixture/browserfiles/chromium-profile-*`.
- To assert a "blocked until measured" state, stub the async probe (`vidMediaFacts`) with a promise the test releases explicitly; a timed delay would be flaky.

## Composer width in the fixture
- With the default headless window (after `clearDeviceMetricsOverride`) and even at 1440 wide, the Stage composer is only ~590px because both rails stay open; the full 860px composer needs a ~1760px viewport. Layout assertions that depend on "fits on one line" must set the viewport explicitly and restore it afterwards.
- `element.click()` on a pill does not flush the menu synchronously — `waitFor` the `.sdbar-pop` before measuring.
