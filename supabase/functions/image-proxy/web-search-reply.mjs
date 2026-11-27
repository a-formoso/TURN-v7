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
   the searches returned; one entry per URL, at most 12, http(s) only.

   The other results are taken a page from EACH SEARCH IN TURN (2026-11-27). A research asks about
   several things (the place, then each principal's work), and the list the writer sees is short:
   in the order found it was eight pages from the first search, with none behind the facts about
   the second character. In turn, every search's subject is on the list.

   ONE PAGE, ONCE (2026-11-27). The same page comes back from two searches under two addresses (a
   review page with and without its "www", its closing slash or its page anchor; a listing under two
   ids), and the short list showed it twice. A page is on the list already when its address is the
   same once those are set aside, or when the same site already gave a page with the same title. */
function sourceHost(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch (_e) { return ""; }
}
function sourceAddressKey(u) {
  try { const x = new URL(u); return sourceHost(u) + x.pathname.replace(/\/+$/, "") + x.search; } catch (_e) { return String(u); }
}
export function webSearchSources(blocks, text = "") {
  const out = [];
  const seen = new Set();
  const add = (url, title, cited) => {
    const u = String(url || "").trim();
    if (!/^https?:\/\//i.test(u) || out.length >= 12) return;
    const t = String(title || "").trim().slice(0, 200);
    const byAddress = "a:" + sourceAddressKey(u);
    const byTitle = t ? "t:" + sourceHost(u) + "|" + t.toLowerCase().replace(/\s+/g, " ") : "";
    if (seen.has(byAddress) || (byTitle && seen.has(byTitle))) return;
    seen.add(byAddress); if (byTitle) seen.add(byTitle);
    out.push({ url: u, title: t, cited });
  };
  for (const b of blocks || []) for (const c of (b && b.type === "text" && Array.isArray(b.citations)) ? b.citations : []) add(c.url, c.title, true);
  // every page the searches returned, in order: a tag's number counts into this list
  const pages = [];
  const searches = [];   // each search's own pages, in order (a failed search has none)
  for (const b of blocks || []) if (b && b.type === "web_search_tool_result" && Array.isArray(b.content)) {
    const list = b.content.map((x) => x || {});
    searches.push(list); pages.push(...list);
  }
  for (const n of citeTagPages(text)) { const p = pages[n - 1]; if (p) add(p.url, p.title, true); }
  // the rest: one page from each search in turn (its next page not on the list yet)
  const at = searches.map(() => 0);
  let moved = true;
  while (moved && out.length < 12) {
    moved = false;
    for (let i = 0; i < searches.length && out.length < 12; i++) {
      while (at[i] < searches[i].length) {
        const p = searches[i][at[i]++], before = out.length;
        add(p.url, p.title, false); moved = true;
        if (out.length > before) break;
      }
    }
  }
  return out;
}
