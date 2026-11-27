/* What a searching writing reply hands back (New Story's research): its text without citation
   markup, and the pages it rests on. Plain functions, tested by scripts/test-research-grounding.mjs.

   A reply written as JSON carries its citations as raw tags, <cite index="8-11">…</cite>: "8" is
   the 8th page the searches returned, counted in order across every search of the reply (seen
   2026-11-27, the day searches became direct calls and the engine began to read the pages itself).
   The tags are markup, never the writer's text: they come out of the text, and the pages they name
   are the cited ones. */

export function stripCiteTags(text) {
  return String(text || "").replace(/<\/?cite\b[^>]*>/gi, "");
}

/* the pages (1-based, in the order they are first named) the tags point at; one tag may name
   several ("20-11,20-12"), and inside JSON its quotes arrive escaped (index=\"8-11\") */
export function citeTagPages(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/<cite\b[^>]*?\bindex\s*=\s*\\?["']([^"'\\>]*)/gi)) {
    for (const part of m[1].split(",")) {
      const n = parseInt(part.trim().split("-")[0], 10);
      if (n > 0 && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/* The pages a searching reply relied on: every page a text block CITES first (the claims rest on
   those: structured citations, then the pages the text's own tags name), then the other results
   the searches returned; one entry per URL, at most 12, http(s) only. */
export function webSearchSources(blocks, text = "") {
  const out = [];
  const seen = new Set();
  const add = (url, title, cited) => {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u) || seen.has(u) || out.length >= 12) return;
    seen.add(u); out.push({ url: u, title: String(title || "").trim().slice(0, 200), cited });
  };
  for (const b of blocks || []) for (const c of (b && b.type === "text" && Array.isArray(b.citations)) ? b.citations : []) add(c.url, c.title, true);
  // every page the searches returned, in order: a tag's number counts into this list
  const pages = [];
  for (const b of blocks || []) if (b && b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const x of b.content) pages.push(x || {});
  for (const n of citeTagPages(text)) { const p = pages[n - 1]; if (p) add(p.url, p.title, true); }
  for (const p of pages) add(p.url, p.title, false);
  return out;
}
