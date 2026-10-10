Face landmark model for the Likeness capture's on-device pose check (app/face-pose.js)
=====================================================================================

Package:  @mediapipe/tasks-vision 1.1.0 (npm, published 2026-10-06), Apache-2.0
          tarball https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.1.0.tgz
          integrity sha512-ZJqh0wMKOINorfSffvDAxzyO1//c+FiG3IkzOdNDnLqvBB3DbMfj0bB/tys2SNf9S914sgoIbIpF4HTOi336cg==
          (checked against `npm view @mediapipe/tasks-vision@1.1.0 dist.integrity` on 2026-10-10)
Model:    https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
          (md5 sOcnSQehZEQE/vZrKN1thQ==, the same file as float16/latest on 2026-10-10)
Vendored: 2026-10-10. Copyright The MediaPipe Authors, Apache-2.0 (full text in LICENSE; the
          tarball ships none).

Files (byte-identical copies; scripts/test-likeness-pose.mjs checks the sizes and hashes):

  vision_bundle.js            156,161 B  sha256 022cbbfcdb74bae18e4bbc722e429e046d5fdd35f6183f1359c56b652b8b87f7
                              (package/vision_bundle.js — a classic script that creates `var Vision`)
  vision_wasm_internal.js     335,393 B  sha256 7c652617b5bef832f42878ce8c5f752b0724bca6054e4bc1013a37d4b1949723
                              (package/wasm/vision_wasm_internal.js)
  vision_wasm_internal.wasm 12,997,248 B sha256 782eda3ec1f414fdb4f1d66a8b59093eb4d5ab437e06117796abf05962d68eef
                              (package/wasm/vision_wasm_internal.wasm — the SIMD build)
  face_landmarker.task      3,758,596 B  sha256 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff

Not shipped: the no-SIMD and module wasm builds (a browser without wasm SIMD gets the manual path).

Privacy: everything runs on the device. The library's usage-metrics request
(https://odml.pa.googleapis.com/v1/log) is blocked by the fetch guard in app/face-pose.js
(installNetGuard) — it is answered locally with an empty 204, which makes the logger stop.

Loading: app/face-pose.js reads vision_wasm_internal.wasm and face_landmarker.task itself, with
progress (a download times out only when it stalls), and hands them to the library from memory (a
local blob URL for the engine, modelAssetBuffer for the model) — each file is downloaded once.

The folder name carries the version: serve.js caches app/vendor/** for a year (immutable). A new
version goes in a new folder (and app/face-pose.js's VENDOR_DIR).
