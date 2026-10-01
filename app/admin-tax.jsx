/* admin-tax.jsx — the platform admin's "Tax & compliance" page (account chip →
   "Tax & compliance · admin", next to "Storage · admin"). Owner decision 2026-10-01 (D1):
   "Maybe warn me (via the Admin panel) when I have to register for VAT. Keep the prices in
   dollars. I live and work in the UK; I intend to advertise to UK, EU and US users."

   - SELF-MOUNTING (the plans.jsx / admin-storage.jsx pattern): window.turnOpenAdminTax()
     mounts the modal into its own React root on demand and tears it down on close. It refuses
     unless window.turnIsAdmin; the database refuses everyone else anyway
     (turn_admin_tax_summary checks the JWT email, supabase/tax-compliance.sql).
   - ONE read: sb.rpc("turn_admin_tax_summary", { usd_to_gbp }) → the rolling-12-month view of
     the sales ledger the Stripe webhook fills for EVERY successful payment on the Stripe account
     (all products on it — they share the legal person, so they all count toward UK VAT
     turnover; each row is tagged kinolot | other). Refunds net off.
   - The THRESHOLDS come from the database (summary.thresholds, with the date they were last
     checked) — the one place they live, warning levels included (uk_watch_pct, uk_near_pct,
     us_near_pct). This page only words them: the headlines, the meter's marks and the fallback
     statuses read those levels (75% / 90% / 100% UK and 80% / 100% US when the summary has none).
   - The GBP rate is the admin's, remembered in this browser (localStorage), default 0.80 GBP
     per USD — deliberately conservative (a higher rate than the market's reads the UK total high).
   - Prices stay in US dollars. When the owner registers, the plan is Stripe Tax with
     tax-INCLUSIVE prices: the dollar price stays the same and the tax is carved out of it.
   - Not tax advice: every section says to check with an accountant.
   - Operator tool: deliberately NOT listed in APP_FEATURES (app/ai.jsx) — Frances answers every
     user, and MUSE Protocol §3 keeps admin internals out of her facts.
   - window.AdminTaxLib holds the pure helpers (scripts/test-tax-compliance-app.mjs). */
(function(){
  const RPC = "turn_admin_tax_summary";
  const RATE_KEY = "turn-admin-tax-rate";
  const CHECK_KEY = "turn-admin-tax-checklist";
  const DEFAULT_RATE = 0.80;
  const SQL_FILE = "supabase/tax-compliance.sql";

  function h(){ return React.createElement.apply(React, arguments); }
  function icon(name, s){
    const set = (typeof window !== "undefined" && window.Icon) || null;
    return set && typeof set[name] === "function" ? h(set[name], { s: s || 12 }) : null;
  }
  const num = (v)=>{ const n = Number(v); return Number.isFinite(n) ? n : 0; };

  /* ── pure helpers (window.AdminTaxLib) ─────────────────────────────── */
  /* the GBP-per-USD rate: a positive number up to 5, else the default */
  function cleanRate(v){
    const n = Number(String(v == null ? "" : v).replace(",", "."));
    return Number.isFinite(n) && n > 0 && n <= 5 ? Math.round(n * 10000) / 10000 : DEFAULT_RATE;
  }
  function loadRate(){ try{ return cleanRate(localStorage.getItem(RATE_KEY) || DEFAULT_RATE); }catch(e){ return DEFAULT_RATE; } }
  function saveRate(v){ const r = cleanRate(v); try{ localStorage.setItem(RATE_KEY, String(r)); }catch(e){} return r; }
  function loadChecks(){ try{ const o = JSON.parse(localStorage.getItem(CHECK_KEY) || "{}"); return o && typeof o === "object" ? o : {}; }catch(e){ return {}; } }
  function saveChecks(o){ try{ localStorage.setItem(CHECK_KEY, JSON.stringify(o || {})); }catch(e){} }

  function fmtMoney(sym, n){
    const v = num(n);
    return (v < 0 ? "-" : "") + sym + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  const fmtUsd = (n)=> fmtMoney("$", n);
  const fmtGbp = (n)=> fmtMoney("£", n);
  function fmtPct(p){ const v = num(p); return (v >= 10 || v === 0 ? Math.round(v) : Math.round(v * 10) / 10) + "%"; }
  function fmtCount(n, one, many){ const v = Math.round(num(n)); return v.toLocaleString("en-US") + " " + (v === 1 ? one : (many || one + "s")); }
  function fmtDate(iso){
    const d = new Date(iso);
    if(!iso || !Number.isFinite(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  /* value as a percentage of a threshold (0 when there is no threshold) */
  function pctOf(value, threshold){ const t = num(threshold); return t > 0 ? (num(value) / t) * 100 : 0; }
  const STATUSES = ["ok", "watch", "near", "over"];
  const DEFAULT_LEVELS = { ukWatch: 75, ukNear: 90, usNear: 80 };
  /* UK: watch at 75%, near at 90%, over at 100% (or the summary's levels) — the summary's own status
     wins when it sends one */
  function ukStatus(pct, server, levels){
    if(STATUSES.indexOf(server) >= 0) return server;
    const lv = levels || DEFAULT_LEVELS, p = num(pct);
    return p >= 100 ? "over" : p >= lv.ukNear ? "near" : p >= lv.ukWatch ? "watch" : "ok";
  }
  /* US: near at 80% (or the summary's level) of either the dollar or the transaction default, over at 100% */
  function usStatus(pctUsd, pctTx, server, levels){
    if(STATUSES.indexOf(server) >= 0) return server;
    const lv = levels || DEFAULT_LEVELS, p = Math.max(num(pctUsd), num(pctTx));
    return p >= 100 ? "over" : p >= lv.usNear ? "near" : "ok";
  }
  const TONE = { ok: "ok", watch: "amber", near: "amber", over: "alert" };
  const STATUS_LABEL = { ok: "OK", watch: "Watch", near: "Near", over: "Over" };

  /* a warning level from the summary: a percentage above 0 and below 100, else the default */
  const level = (v, d)=>{ const n = Number(v); return Number.isFinite(n) && n > 0 && n < 100 ? n : d; };
  function thresholdsOf(s){
    const t = (s && s.thresholds) || {};
    return { ukGbp: num(t.uk_gbp), usUsd: num(t.us_usd), usTx: num(t.us_tx), checked: t.checked || "",
      ukWatch: level(t.uk_watch_pct, DEFAULT_LEVELS.ukWatch), ukNear: level(t.uk_near_pct, DEFAULT_LEVELS.ukNear), usNear: level(t.us_near_pct, DEFAULT_LEVELS.usNear) };
  }

  /* UK VAT — registration threshold on UK taxable turnover, rolling 12 months */
  function ukView(s, rate){
    const th = thresholdsOf(s);
    const uk = (s && s.uk) || {};
    const r = cleanRate(rate);
    const usd = num(uk.usd_12m);
    const gbp = uk.gbp_12m_est != null ? num(uk.gbp_12m_est) : usd * r;
    const pct = pctOf(gbp, th.ukGbp);
    const status = ukStatus(pct, uk.status, th);
    const limit = fmtGbp(th.ukGbp);
    const head = {
      ok: "Below the UK VAT registration threshold.",
      watch: "Past " + th.ukWatch + "% of the UK VAT threshold. Talk to an accountant about registering now.",
      near: "Past " + th.ukNear + "% of the UK VAT threshold. Get ready to register: an accountant can tell you exactly when.",
      over: "Over the UK VAT threshold. You must register for VAT: tell HMRC within 30 days of the end of the month you went over. Talk to an accountant now.",
    }[status];
    const lines = [
      "You must register when your UK taxable turnover in any rolling 12 months goes over " + limit
        + ", or as soon as you expect it to go over " + limit + " in the next 30 days alone (the 30-day forward look).",
      "Income outside this Stripe account counts too: any other UK sales you make as the same person or company.",
      "Sales of digital services to customers outside the UK are generally outside the scope of UK VAT, so they aren't counted here.",
      "This assumes every product on the account is a digital service delivered automatically. Sales abroad of live or human-delivered services (calls, coaching, events) or of goods can still count toward the UK threshold: check with an accountant.",
    ];
    const other = appRows(s).filter((a)=> a.app !== "kinolot").reduce((a, r)=> a + r.usd, 0);
    if(other > 0) lines.push("Your other products sold " + fmtUsd(other) + " in the last 12 months in every country (see By product): if any of that is live services or goods sold abroad, part of it may count too.");
    if(uk.gbp_30d_est != null) lines.push("UK sales in the last 30 days: " + fmtGbp(uk.gbp_30d_est) + ". The forward look asks about the NEXT 30 days alone: if you expect more than " + limit + " in them, register at once.");
    const unk = (s && s.unknown) || {};
    if(num(unk.sales) > 0){
      // the summary's own worst case when it sends one, else the page's
      const worst = gbp + (uk.unknown_gbp_est != null ? Math.max(0, num(uk.unknown_gbp_est)) : Math.max(0, num(unk.usd) * r));
      lines.push("If the " + fmtCount(unk.sales, "payment") + " with no country were all UK sales, you'd be at "
        + fmtGbp(worst) + " (" + fmtPct(uk.pct_with_unknown != null ? uk.pct_with_unknown : pctOf(worst, th.ukGbp)) + ").");
    }
    lines.push("When you register: turn on Stripe Tax with tax-inclusive prices. The dollar price customers see stays the same and the VAT is carved out of it.");
    return { status, tone: TONE[status], usd, gbp, pct, limit, rate: r, head, lines,
      value: fmtGbp(gbp) + " of " + limit, sub: fmtUsd(usd) + " at " + r + " GBP per USD · " + fmtPct(pct) };
  }

  /* EU VAT — no threshold for a business outside the EU selling digital services to EU consumers */
  function euView(s){
    const eu = (s && s.eu) || {};
    const sales = num(eu.sales_12m);
    const rows = (Array.isArray(eu.by_country) ? eu.by_country : [])
      .map((c)=>({ country: String((c && c.country) || "?").toUpperCase(), sales: num(c && c.sales), usd: num(c && c.usd) }))
      .sort((a, b)=> b.usd - a.usd);
    // the summary says "over" once any EU sale exists (ever); without its status, any sale or a first-sale date
    const any = eu.status === "over" || (eu.status !== "watch" && (sales > 0 || rows.some((c)=> c.sales > 0) || !!eu.first_sale_at));
    const lines = [
      "A UK business selling digital services to consumers in the EU owes VAT in each customer's country from the first sale: there is no threshold for a business outside the EU.",
      "Register for the non-Union OSS scheme in ONE EU country (for example Ireland) and file one quarterly return that covers every EU country.",
      "Register before your first EU sale. If a sale comes first, the scheme can still start from that sale only if you register by the 10th day of the following month.",
      "Sales to EU businesses with a valid VAT number are reverse-charged instead (no OSS VAT on them); Stripe Tax can collect those numbers.",
      "Under OSS, keep the records of EU sales for 10 years from the end of the year of each sale, with two pieces of evidence of the customer's country that agree (for example the billing address and the card's country). Stripe Tax keeps them.",
    ];
    if(!any) return { status: "watch", tone: "amber", any, sales, usd: 0, rows,
      head: "You advertise to the EU: register for the non-Union OSS scheme in one EU country before your first EU sale.",
      value: "No EU sales yet", sub: "Action before the first one", lines };
    const usd = eu.usd_12m != null ? num(eu.usd_12m) : rows.reduce((a, c)=> a + c.usd, 0);
    const n = sales || rows.reduce((a, c)=> a + c.sales, 0);
    const since = fmtDate(eu.first_sale_at);
    return { status: "over", tone: "alert", any, sales: n, usd, rows,
      head: (n > 0 ? fmtCount(n, "EU sale") + " (" + fmtUsd(usd) + ")" + (since ? " since " + since : "") + ": EU VAT is due on them."
                   : "Your first EU sale was " + (since ? "on " + since : "made") + ": EU VAT is due on EU sales.")
        + " Register for non-Union OSS now and ask an accountant about the sales already made.",
      value: fmtCount(n, "EU sale"), sub: fmtUsd(usd) + (since ? " · first " + since : ""), lines };
  }

  /* US sales tax — economic nexus per state, against a conservative default */
  function usView(s){
    const th = thresholdsOf(s);
    const us = (s && s.us) || {};
    const rows = (Array.isArray(us.by_state) ? us.by_state : []).map((r)=>{
      const sales = num(r && r.sales), usd = num(r && r.usd);
      const pctUsd = pctOf(usd, th.usUsd), pctTx = pctOf(sales, th.usTx);
      const status = usStatus(pctUsd, pctTx, r && r.status, th);
      return { state: String((r && r.state) || "?").toUpperCase(), sales, usd, pctUsd, pctTx, status, tone: TONE[status] };
    }).sort((a, b)=> Math.max(b.pctUsd, b.pctTx) - Math.max(a.pctUsd, a.pctTx));
    const rank = (st)=> STATUSES.indexOf(st);
    const worst = rows.reduce((w, r)=> rank(r.status) > rank(w) ? r.status : w, "ok");
    const flagged = rows.filter((r)=> r.status !== "ok");
    const head = !rows.length ? "No US sales yet."
      : worst === "over" ? fmtCount(rows.filter((r)=> r.status === "over").length, "state") + " past the conservative default. Check whether each one taxes digital services and register there before collecting; ask an accountant."
      : flagged.length ? fmtCount(flagged.length, "state") + " past " + th.usNear + "% of the conservative default. Check those states' rules now."
      : "No state is near the conservative default.";
    const lines = [
      "The default here is conservative: " + fmtUsd(th.usUsd) + " or " + Math.round(th.usTx) + " sales a year in one state. Many states use "
        + fmtUsd(th.usUsd) + " only, some are higher (California and Texas: $500,000), and many don't tax digital services or software subscriptions at all.",
      "Most states measure the previous or current calendar year; this view uses a rolling 12 months as an early warning. Check the state's own rules, or ask an accountant, before registering.",
    ];
    return { status: worst, tone: TONE[worst], rows, head, lines,
      value: rows.length ? fmtCount(rows.length, "state") : "No US sales", sub: rows.length ? (flagged.length ? fmtCount(flagged.length, "state") + " to check" : "none near the default") : "" };
  }

  /* payments the ledger couldn't place in a country */
  function unknownView(s){
    const u = (s && s.unknown) || {};
    const sales = num(u.sales), usd = num(u.usd);
    if(sales <= 0) return { status: "ok", tone: "ok", sales: 0, usd: 0, head: "Every payment has a country.", value: "None", sub: "" };
    return { status: "watch", tone: "amber", sales, usd,
      head: fmtCount(sales, "payment") + " (" + fmtUsd(usd) + ") have no country, so they can't be placed above. Turn on billing-address collection (\"Collect customers' addresses\") on every payment link so each sale gets one.",
      value: fmtCount(sales, "payment"), sub: fmtUsd(usd) };
  }

  /* every other known country (not the UK, the EU or the US) */
  function restView(s){
    const r = (s && s.rest) || {};
    const rows = (Array.isArray(r.by_country) ? r.by_country : [])
      .map((c)=>({ country: String((c && c.country) || "?").toUpperCase(), sales: num(c && c.sales), usd: num(c && c.usd) }))
      .sort((a, b)=> b.usd - a.usd);
    const sales = num(r.sales_12m) || rows.reduce((a, c)=> a + c.sales, 0);
    if(sales <= 0 && !rows.length) return null;
    return { status: "watch", tone: "amber", rows, sales, usd: num(r.usd_12m),
      head: fmtCount(sales, "sale") + " (" + fmtUsd(r.usd_12m) + ") to customers in other countries.",
      lines: ["Many countries tax digital services sold to their consumers from abroad, some from the first sale (for example India, Saudi Arabia and Türkiye), others above a threshold of their own. Check a country's rules before you advertise there, or ask an accountant."] };
  }
  /* payments in a currency other than USD or GBP are left out of the totals */
  function otherCurrencyLine(s){
    const o = Array.isArray(s && s.other_currencies) ? s.other_currencies : [];
    const n = o.reduce((a, c)=> a + num(c && c.sales), 0);
    if(!o.length) return "";
    return fmtCount(n, "payment") + " in other currencies (" + o.map((c)=> String((c && c.currency) || "?").toUpperCase()).join(", ")
      + ") aren't in the totals above. Prices are in US dollars, so check those in Stripe.";
  }
  /* since when the ledger has been recording */
  function ledgerLine(s){
    const l = (s && s.ledger) || null;
    if(!l || !l.recording_since) return "";
    return "Recording since " + fmtDate(l.recording_since) + "; payments before that aren't in the ledger (Stripe's own reports have them).";
  }

  /* every product on the Stripe account */
  const APP_LABEL = { kinolot: "Kinolot", other: "Other products on this Stripe account" };
  function appRows(s){
    return (Array.isArray(s && s.by_app) ? s.by_app : []).map((a)=>({
      app: String((a && a.app) || "other"), label: APP_LABEL[String((a && a.app) || "other")] || String((a && a.app) || "Other"), usd: num(a && a.usd_12m),
    })).sort((a, b)=> b.usd - a.usd);
  }

  /* the checklist the owner ticks off (remembered in this browser) */
  const CHECKLIST = [
    { id: "legal-name", title: "Your legal name and business address on the Terms and Privacy pages",
      detail: "Replace the <legal name> and <business address> placeholders before the first real sale." },
    { id: "ico-fee", title: "Pay the ICO data protection fee",
      detail: "Most UK businesses that handle personal data must pay it every year (ico.org.uk). It's separate from tax." },
    { id: "payment-links", title: "Every payment link collects the billing address and requires accepting the Terms",
      detail: "In Stripe, on each Payment Link: collect customers' addresses, and require customers to accept your terms of service (the Terms URL is set in your public business details)." },
    { id: "eu-oss", title: "Register for the EU non-Union OSS scheme before the first EU sale",
      detail: "One registration in one EU country covers every EU country; no threshold applies to a UK business." },
    { id: "eu-withdrawal", title: "EU: an online way to cancel a purchase before the first EU sale",
      detail: "Since 19 June 2026, EU law asks for a clearly labelled \"cancel the contract here\" function, in two steps, available for the whole 14 days, with a confirmation sent to the customer. Kinolot doesn't have one yet: ask for it to be built before you sell to the EU." },
    { id: "eu-gdpr-rep", title: "EU: appoint a GDPR representative before advertising in the EU",
      detail: "A UK business offering its service to people in the EU needs a representative in the EU for data protection, named in the Privacy Policy (the <EU representative> placeholder)." },
    { id: "stripe-tax", title: "When you register for VAT: Stripe Tax with tax-inclusive prices",
      detail: "Prices stay in US dollars and the price customers see doesn't change; the tax is carved out of it." },
    { id: "records", title: "Keep your sales and tax records",
      detail: "UK records: generally six years. EU sales under OSS: ten years from the end of the year of the sale. The sales ledger here helps, but Stripe's own reports are the full record." },
  ];

  /* the page's error sentences */
  const MSG = {
    missing: "The tax summary isn't set up yet. Run " + SQL_FILE + " in the SQL Editor (after billing-v2.sql), then Refresh. Sales are recorded from the moment the Stripe webhook that fills the sales ledger is deployed.",
    admin: "This page is only for the platform admin account.",
    signIn: "Sign in again to use this page.",
    noCloud: "Cloud isn't configured in this build, so the tax summary can't be read.",
    empty: "No sales recorded yet. The ledger fills from the Stripe webhook for payments made after it was deployed; check Stripe's own reports for anything earlier.",
    advice: "A guide, not tax advice. Check with an accountant before you act on it.",
  };
  function classifyError(error){
    const code = String((error && error.code) || ""), msg = String((error && error.message) || error || "");
    if(code === "PGRST202" || code === "42883" || /could not find the function|does not exist/i.test(msg)) return { kind: "missing", message: MSG.missing };
    if(code === "42501" || /admin/i.test(msg)) return { kind: "admin", message: MSG.admin };
    if(code === "PGRST301" || code === "401" || /jwt|not authenticated|unauthori[sz]ed/i.test(msg)) return { kind: "signin", message: MSG.signIn };
    const shown = msg.replace(/^KINOLOT_[A-Z]+:\s*/, "");
    return { kind: "error", message: "Couldn't read the tax summary" + (shown ? ": " + shown : "") + ". Try Refresh." };
  }
  async function callTaxSummary(rate){
    const sb = (typeof window.sbClient === "function") ? window.sbClient() : null;
    if(!sb || typeof sb.rpc !== "function") return { ok: false, error: { kind: "nocloud", message: MSG.noCloud } };
    try{
      const { data, error } = await sb.rpc(RPC, { usd_to_gbp: cleanRate(rate) });
      if(error) return { ok: false, error: classifyError(error) };
      const row = Array.isArray(data) ? data[0] : data;
      const s = row && typeof row === "object" && row[RPC] && typeof row[RPC] === "object" ? row[RPC] : row;
      if(!s || typeof s !== "object") return { ok: false, error: { kind: "error", message: "The tax summary came back empty. Try Refresh." } };
      return { ok: true, data: s };
    }catch(e){ return { ok: false, error: classifyError(e) }; }
  }
  function ledgerEmpty(s){
    if(s && s.ledger && s.ledger.rows != null) return num(s.ledger.rows) === 0;
    const apps = appRows(s);
    return !apps.some((a)=> a.usd !== 0) && num(s && s.uk && s.uk.usd_12m) === 0 && num(s && s.eu && s.eu.sales_12m) === 0
      && !((s && s.us && s.us.by_state) || []).length && num(s && s.unknown && s.unknown.sales) === 0;
  }

  /* ── the page ─────────────────────────────── */
  function Section({ title, view, children }){
    return h("section", { className: "adm-tax-sec " + (view.tone || "ok") },
      h("div", { className: "adm-tax-sec-head" },
        h("div", { className: "adm-tax-sec-title" }, title),
        h("span", { className: "adm-chip " + (view.tone || "ok") }, STATUS_LABEL[view.status] || "OK")),
      h("div", { className: "adm-tax-headline" }, view.head),
      children,
      view.lines && view.lines.length ? h("ul", { className: "adm-tax-lines" }, view.lines.map((t, i)=> h("li", { key: i }, t))) : null);
  }
  function Table({ cols, rows, empty }){
    if(!rows.length) return empty ? h("div", { className: "adm-muted adm-tax-empty" }, empty) : null;
    const grid = { gridTemplateColumns: "minmax(80px,1.4fr)" + (cols.length > 1 ? " repeat(" + (cols.length - 1) + ",minmax(56px,1fr))" : "") };
    return h("div", { className: "adm-tax-table", role: "table" },
      h("div", { className: "adm-tax-tr adm-tax-th", role: "row", style: grid }, cols.map((c)=> h("span", { key: c.k, role: "columnheader", className: c.num ? "num" : "" }, c.t))),
      rows.map((r, i)=> h("div", { key: i, className: "adm-tax-tr", role: "row", style: grid },
        cols.map((c)=> h("span", { key: c.k, role: "cell", className: c.num ? "num" : "" }, c.f ? c.f(r) : String(r[c.k]))))));
  }

  function AdminTaxModal({ onClose }){
    const [rate, setRate] = React.useState(loadRate);
    const [rateText, setRateText] = React.useState(()=> String(loadRate()));
    const [data, setData] = React.useState(null);
    const [err, setErr] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [checks, setChecks] = React.useState(loadChecks);
    const seq = React.useRef(0);
    const closeRef = React.useRef(null);

    const load = React.useCallback(async (r)=>{
      const my = ++seq.current;
      setLoading(true); setErr(null);
      const out = await callTaxSummary(r);
      if(my !== seq.current) return;
      if(out.ok){ setData(out.data); setErr(null); } else { setErr(out.error); }
      setLoading(false);
    }, []);
    React.useEffect(()=>{ load(rate); }, [load]);   // once on open; the rate's Apply re-reads
    React.useEffect(()=>{ try{ if(closeRef.current && closeRef.current.focus) closeRef.current.focus(); }catch(e){} }, []);
    React.useEffect(()=>{
      if(typeof document === "undefined" || !document.addEventListener) return undefined;
      const onKey = (e)=>{ if(e.key === "Escape") onClose(); };
      document.addEventListener("keydown", onKey);
      return ()=> document.removeEventListener("keydown", onKey);
    }, [onClose]);
    // the session can end while the page is open: re-read window.turnIsAdmin every second
    React.useEffect(()=>{
      const t = setInterval(()=>{ if(!window.turnIsAdmin) onClose(); }, 1000);
      return ()=> clearInterval(t);
    }, [onClose]);

    const applyRate = ()=>{ const r = saveRate(rateText); setRate(r); setRateText(String(r)); load(r); };
    const toggle = (id)=> setChecks((c)=>{ const n = Object.assign({}, c, { [id]: !c[id] }); saveChecks(n); return n; });

    if(!window.turnIsAdmin) return null;
    const s = data;
    const th = s ? thresholdsOf(s) : null;
    const uk = s ? ukView(s, rate) : null;
    const eu = s ? euView(s) : null;
    const us = s ? usView(s) : null;
    const unk = s ? unknownView(s) : null;
    const rest = s ? restView(s) : null;
    const notes = s ? [ledgerLine(s), otherCurrencyLine(s)].filter(Boolean) : [];
    const apps = s ? appRows(s) : [];
    const sub = loading ? (s ? "admin · refreshing…" : "admin · reading…")
      : s && s.as_of ? "admin · as of " + fmtDate(s.as_of) : "admin";

    return h("div", { className: "bible-overlay adm-overlay", onMouseDown: (e)=>{ if(e.target === e.currentTarget) onClose(); } },
      h("div", { className: "bible-modal adm-storage adm-tax", role: "dialog", "aria-modal": "true", "aria-labelledby": "adm-tax-title" },
        h("div", { className: "bible-head adm-head" },
          h("div", { className: "bible-title" }, icon("globe", 15),
            h("span", { id: "adm-tax-title" }, "Tax & compliance"),
            h("span", { className: "bible-sub adm-sub" }, sub)),
          h("div", { className: "bible-head-acts" },
            h("button", { type: "button", className: "bible-btn", disabled: loading, onClick: ()=> load(rate) }, loading ? "Reading…" : "Refresh"),
            h("button", { type: "button", className: "bible-x", ref: closeRef, "aria-label": "Close", onClick: onClose }, icon("x", 15)))),
        h("div", { className: "adm-body" },
          h("div", { className: "adm-note adm-tax-intro" },
            "Sales on the Stripe account (every product on it), rolling 12 months, refunds netted off. Prices stay in US dollars. ", MSG.advice),
          h("div", { className: "adm-tax-rate" },
            h("label", { htmlFor: "adm-tax-rate-in" }, "GBP per USD"),
            h("input", { id: "adm-tax-rate-in", type: "number", inputMode: "decimal", min: "0.01", max: "5", step: "0.01", value: rateText,
              onChange: (e)=> setRateText(e.target.value), onKeyDown: (e)=>{ if(e.key === "Enter") applyRate(); } }),
            h("button", { type: "button", className: "adm-btn sm", disabled: loading, onClick: applyRate }, "Apply"),
            h("span", { className: "adm-muted" }, "A conservative rate reads the UK total high. Default " + DEFAULT_RATE.toFixed(2) + ".")),
          err ? h("div", { className: "adm-banner " + (err.kind === "missing" ? "amber" : "alert"), role: "alert" }, h("span", null, err.message)) : null,
          !s && loading ? h("div", { className: "adm-muted adm-loading" }, "Reading the sales ledger…") : null,
          s ? h(React.Fragment, null,
            ledgerEmpty(s) ? h("div", { className: "adm-empty" }, MSG.empty) : null,
            notes.map((t, i)=> h("div", { key: "n" + i, className: "adm-note" }, t)),
            h("div", { className: "adm-tiles" },
              [["UK VAT", uk], ["EU VAT", eu], ["US sales tax", us], ["No country", unk]].map(([t, v])=>
                h("div", { key: t, className: "adm-tile" + (v.tone === "alert" ? " alert" : v.tone === "amber" ? " amber" : "") },
                  h("div", { className: "adm-tile-lab" }, t),
                  h("div", { className: "adm-tile-val" }, v.value),
                  v.sub ? h("div", { className: "adm-tile-sub" }, v.sub) : null))),
            h(Section, { title: "United Kingdom: VAT registration", view: uk },
              h("div", { className: "adm-tax-meter", role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.min(100, Math.round(uk.pct)), "aria-label": "UK sales against the VAT threshold" },
                h("span", { className: "adm-tax-meter-fill " + uk.tone, style: { width: Math.min(100, Math.max(0, uk.pct)) + "%" } }),
                h("span", { className: "adm-tax-meter-mark", style: { left: th.ukWatch + "%" } }),
                h("span", { className: "adm-tax-meter-mark", style: { left: th.ukNear + "%" } })),
              h("div", { className: "adm-tax-figure" }, uk.value + " · " + uk.sub)),
            h(Section, { title: "European Union: VAT (non-Union OSS)", view: eu },
              eu.any ? h(Table, { rows: eu.rows, cols: [
                { k: "country", t: "Country" }, { k: "sales", t: "Sales", num: true, f: (r)=> String(r.sales) },
                { k: "usd", t: "Amount", num: true, f: (r)=> fmtUsd(r.usd) }] }) : null),
            h(Section, { title: "United States: sales tax by state", view: us },
              h(Table, { rows: us.rows, empty: "No US sales in the last 12 months.", cols: [
                { k: "state", t: "State" }, { k: "sales", t: "Sales", num: true, f: (r)=> String(r.sales) },
                { k: "usd", t: "Amount", num: true, f: (r)=> fmtUsd(r.usd) },
                { k: "pctUsd", t: "% of " + fmtUsd(th.usUsd), num: true, f: (r)=> fmtPct(r.pctUsd) },
                { k: "pctTx", t: "% of " + Math.round(th.usTx) + " sales", num: true, f: (r)=> fmtPct(r.pctTx) },
                { k: "status", t: "", f: (r)=> h("span", { className: "adm-chip " + r.tone }, STATUS_LABEL[r.status]) }] })),
            rest ? h(Section, { title: "Rest of the world", view: rest },
              h(Table, { rows: rest.rows, cols: [
                { k: "country", t: "Country" }, { k: "sales", t: "Sales", num: true, f: (r)=> String(r.sales) },
                { k: "usd", t: "Amount", num: true, f: (r)=> fmtUsd(r.usd) }] })) : null,
            h(Section, { title: "Payments with no country", view: unk }),
            h("section", { className: "adm-tax-sec ok" },
              h("div", { className: "adm-tax-sec-head" }, h("div", { className: "adm-tax-sec-title" }, "By product")),
              h(Table, { rows: apps, empty: "No sales yet.", cols: [
                { k: "label", t: "Product" }, { k: "usd", t: "Last 12 months", num: true, f: (r)=> fmtUsd(r.usd) }] }),
              h("ul", { className: "adm-tax-lines" },
                h("li", null, "Each product's UK sales count toward the UK threshold (the same legal person sells them all). The totals here include every country."))),
            h("div", { className: "adm-muted adm-tax-checked" },
              "Thresholds last checked " + (fmtDate(th.checked) || String(th.checked || "—")) + ": UK " + fmtGbp(th.ukGbp)
                + " a year; US " + fmtUsd(th.usUsd) + " or " + Math.round(th.usTx) + " sales per state. Tax rules change: check with an accountant.")) : null,
          h("section", { className: "adm-tax-sec ok adm-tax-checklist" },
            h("div", { className: "adm-tax-sec-head" }, h("div", { className: "adm-tax-sec-title" }, "Before the first real sale")),
            h("ul", { className: "adm-tax-checks" }, CHECKLIST.map((c)=> h("li", { key: c.id },
              h("label", null,
                h("input", { type: "checkbox", checked: !!checks[c.id], onChange: ()=> toggle(c.id) }),
                h("span", null, h("b", null, c.title), h("span", { className: "adm-tax-check-detail" }, c.detail))))))))));
  }

  /* SELF-MOUNTING opener: the account chip calls window.turnOpenAdminTax(). Admin only; one at a time. */
  let _el = null;
  function openAdminTax(){
    if(!window.turnIsAdmin) return false;
    if(_el) return false;
    if(typeof document === "undefined" || !window.ReactDOM) return false;
    const el = document.createElement("div");
    el.className = "adm-root adm-tax-root";
    document.body.appendChild(el);
    const root = window.ReactDOM.createRoot(el);
    _el = el;
    try{ const cl = document.body && document.body.classList; if(cl) cl.add("adm-open"); }catch(e){}
    let closed = false;
    const close = ()=>{
      if(closed) return;
      closed = true;
      try{ root.unmount(); }catch(e){}
      if(el.parentNode) el.parentNode.removeChild(el);
      if(_el === el){ _el = null; try{ const cl = document.body && document.body.classList; if(cl) cl.remove("adm-open"); }catch(e){} }
    };
    root.render(h(AdminTaxModal, { onClose: close }));
    return true;
  }
  window.turnOpenAdminTax = openAdminTax;
  window.AdminTaxModal = AdminTaxModal;
  window.AdminTaxLib = {
    DEFAULT_RATE, DEFAULT_LEVELS, RATE_KEY, CHECK_KEY, RPC, CHECKLIST, MSG,
    cleanRate, loadRate, saveRate, pctOf, ukStatus, usStatus, fmtUsd, fmtGbp, fmtPct,
    ukView, euView, usView, unknownView, restView, otherCurrencyLine, ledgerLine, appRows, ledgerEmpty, classifyError, callTaxSummary, thresholdsOf,
  };
})();
