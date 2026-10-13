#!/usr/bin/env node
/* test-location-opening-names.mjs — which layout objects count as a window / door opening (2026-10-13). In a glassworks
   "glass" is mostly a material: "Glass crates", "glass rack", "glass furnace" are objects, not windows; an architectural
   glass surface ("glass wall", "glass partition", "glass door") is an opening.
   node scripts/test-location-opening-names.mjs */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../app/locations.jsx", import.meta.url), "utf8");
const line = src.split("\n").find((l) => l.startsWith("const LOC_OPENING_RE = "));
const RE = Function(line.replace("const LOC_OPENING_RE = ", "return ").replace(/;\s*$/, ""))();
for (const name of ["Office window", "Windows onto the canal", "Front door", "Doorway to the yard", "Glass partition", "Glass wall of the booth",
  "Plate-glass front", "Glazed screen", "Archway", "Loading hatch", "Skylight", "Glass door"]) assert.ok(RE.test(name), name + " is an opening");
for (const name of ["Glass crates", "Glass rack", "Glass furnace", "Racks of finished glass", "Glassblowing bench", "Glass shelves", "Archive boxes", "Doormat"])
  assert.ok(!RE.test(name), name + " is an object");
console.log("PASS location opening names: architectural openings only — glass as a material stays an object");
