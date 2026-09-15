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
