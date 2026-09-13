---
name: Blender Mac compatibility
description: Distinguish add-on version support from whether Blender can run on a particular Mac.
---

Check the Mac's processor, macOS version, and graphics support before recommending a Blender installer. An add-on's minimum Blender version does not guarantee that newer Blender releases run on the same hardware.

**Why:** Blender 5.0 and later dropped Intel Mac support. The official requirements checked on 2026-09-13 identify 4.5 LTS as the last Intel-compatible release, with macOS 11.2 and compatible Metal graphics required. Recommending simply “Blender 4.2+” obscures this distinction.

**How to apply:** Ask for only model/year, processor or chip, macOS, and relevant graphics details—not a serial number. Check https://www.blender.org/download/requirements/ and the LTS release page for current support status before choosing the Intel or Apple Silicon download. Do not treat an installer launch error as an add-on failure.