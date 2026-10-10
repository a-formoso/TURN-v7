# Likeness pose-check fixtures

Stills for `scripts/test-likeness-pose-browser.mjs`. Each is a 640 px wide copy of the Wikimedia Commons
960 px thumbnail of the file below, re-encoded as JPEG. They are all in the **public domain**: we checked
each Commons page's licence on 2026-10-10 (LicenseShortName "Public domain").

| File | Source (Wikimedia Commons) | Author, date | Licence | Used for |
|---|---|---|---|---|
| `lincoln.jpg` | [File:Abraham Lincoln O-77 matte collodion print.jpg](https://commons.wikimedia.org/wiki/File:Abraham_Lincoln_O-77_matte_collodion_print.jpg) | Alexander Gardner, 8 November 1863 | Public domain | a front view; rotated 20° for a tilted head |
| `pearl.jpg` | [File:1665 Girl with a Pearl Earring.jpg](https://commons.wikimedia.org/wiki/File:1665_Girl_with_a_Pearl_Earring.jpg) | Johannes Vermeer, 1665 | Public domain (PD-Art) | turned to her own right (about −30°); mirrored, to her own left |
| `mona.jpg` | [File:Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg](https://commons.wikimedia.org/wiki/File:Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg) | Leonardo da Vinci, 1503–1506 | Public domain (PD-Art) | only a little turned (about −19°) |

Poses measured on the vendored face model (headless Chrome, 2026-10-10; yaw > 0 = turned to the
person's own left): Lincoln +0.5° (pitch 9.5°), Pearl −29.5° (roll −8.8°), Pearl mirrored +30.3°,
Mona −18.8°.
