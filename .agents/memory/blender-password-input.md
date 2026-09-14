---
name: Blender password input limit
description: Why successful RNA assignment does not prove a long connection code can be pasted into Blender.
---

Keep pairing codes below Blender's 127-character password-editor limit without shortening the random authentication secret.

**Why:** Blender 4.4/4.5 uses a separate fixed `UI_MAX_PASSWORD_STR` buffer of 128 bytes including the terminator. A Python/RNA assignment stored hundreds of characters successfully, but real GUI pastes were cut to 127. Request byte counts revealed the truncation; the server reported a generic authentication error. Increasing `StringProperty.maxlen` does not change this editor buffer.

**How to apply:** Test the complete code against the GUI limit, not only Python property assignment or a transport mock. Compact public routing metadata rather than reducing credential entropy. Preserve decoding of already-issued tokens when changing representation. Never ask users to paste pairing codes into chat to diagnose this; byte counts and synthetic codes are sufficient.

Upstream reference: Blender `source/blender/editors/interface/interface_handlers.cc` and `UI_MAX_PASSWORD_STR` in the interface internals, in the 4.4/4.5 release sources.