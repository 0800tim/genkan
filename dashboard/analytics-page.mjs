// Genkan dashboard: Analytics and logs.
//
// A parent's view of what the network actually did: lookups over time, the
// meter's minutes per category, which sites each person asked for most, what
// was blocked and why, and a log a parent can go as deep into as they like:
// pick a child, then a site, then see every lookup of it.
//
// Reads only. Everything here follows the honesty rules in analytics.mjs:
//   * a DNS lookup means a device asked for a name. It is not a minute, not a
//     byte, and not proof a person watched anything. Apps look names up in the
//     background all day, so the counts are a proxy for activity and are
//     labelled "lookups" everywhere, never anything warmer;
//   * minutes come only from the meter (category_usage), never from DNS;
//   * "blocked" means the name was not resolved (or was answered with the
//     portal's address). It does not say what would have loaded;
//   * a lookup that cannot be attributed to a person is shown as unattributed,
//     never dropped and never spread across the children;
//   * WHY a lookup was blocked comes from AdGuard's own reason and the name of
//     the list that matched, stored per row by genkan-dnslog since 2026-09-02.
//     Rows older than that carry no reason, and the page says "not recorded"
//     for them rather than guessing;
//   * a device on a VPN, Cloudflare WARP or its own DNS-over-HTTPS is invisible
//     to all of this, and the page says so.
//
// Day and hour boundaries follow the DATABASE clock, as every other series on
// the dashboard does (analytics.mjs), so the charts here agree with Trends.
import { esc, columns, legend, ranked, table, countColumns, legendOf } from "./charts.mjs";
import { METERED, fmt } from "./analytics.mjs";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// The windows a parent can pick. "today" is per hour; the others per day.
const RANGES = [["today", "Today", 0], ["7", "Last 7 days", 6], ["30", "Last 30 days", 29]];
const PAGE_SIZES = [50, 100, 250];

// Palette slots, handed to people in order and never cycled. Six is the most
// the palette can tell apart; a seventh person and beyond share the grey with
// the unattributed rows, and the legend says so.
const SLOTS = ["gaming", "video", "social", "earned", "download"];
const UNATTR = "other";

// What a blocked row means, grouped from AdGuard's reason and the list that
// matched. Every label is in words a parent can repeat to a child. The SQL
// below assigns the key; the order here is the order the strip and the
// legend use, most worth knowing first.
// [key, label, palette slot, short label for a table column]
export const WHY = [
  ["adult", "Adult site, blocked by the adult blocklist", "earned", "Adult"],
  ["gambling", "Gambling site, blocked by the gambling blocklist", "download", "Gambling"],
  ["malware", "Malware, phishing or scam site, blocked", "video", "Malware"],
  ["bypass", "VPN, proxy or DNS-over-HTTPS bypass, blocked", "social", "Bypass"],
  ["portal", "Cut off (time up, bedtime or a block), sent to the portal", "gaming", "Portal"],
  ["service", "A service switched off for this child (TikTok, Instagram...)", "gaming", "Service off"],
  ["category", "A category switched off for this child, by Genkan's rules", "gaming", "Category off"],
  ["ads", "Advert or tracker, blocked", "other", "Ads"],
  ["safesearch", "Safe search enforced (the site still worked, in its safe version)", "other", "Safe search"],
  ["blocklist", "Blocked by a blocklist, which one was not recorded", "other", "Blocklist"],
  ["blocked", "Blocked, reason not recorded (before 2026-09-02)", "other", "Not recorded"],
  ["whitelist", "Allowed by an allow rule (the safety net or the reading list)", "social", "Allow rule"],
  ["allowed", "Allowed", "gaming", "Allowed"],
];
const WHY_BY = new Map(WHY.map(w => [w[0], w]));
const whyLabel = k => (WHY_BY.get(k) || WHY_BY.get("blocked"))[1];
const whyShort = k => (WHY_BY.get(k) || WHY_BY.get("blocked"))[3];

// The same grouping, in SQL, from a dns_log row aliased l. Kept in one string
// so the charts, the strip, the filter and the log all agree on what a word
// means. The list names are AdGuard's own (config/adguard/AdGuardHome.yaml);
// a household that renamed a list gets "blocked by a blocklist" rather than a
// wrong word, which is the direction to fail in.
const WHY_SQL = `CASE
  WHEN l.action <> 'blocked' THEN CASE WHEN l.reason = 'NotFilteredWhiteList' THEN 'whitelist' ELSE 'allowed' END
  WHEN l.reason = 'RewriteRule' THEN 'portal'
  WHEN l.reason = 'FilteredBlockedService' THEN 'service'
  WHEN l.reason = 'FilteredSafeSearch' THEN 'safesearch'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%nsfw%' THEN 'adult'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%adult%' THEN 'adult'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%porn%' THEN 'adult'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%gambl%' THEN 'gambling'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%threat%' THEN 'malware'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%malware%' THEN 'malware'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%phish%' THEN 'malware'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%vpn%' THEN 'bypass'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%proxy%' THEN 'bypass'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%doh%' THEN 'bypass'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%ads%' THEN 'ads'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list ILIKE '%track%' THEN 'ads'
  WHEN l.reason = 'FilteredBlackList' AND l.filter_list = 'Genkan rules' THEN 'category'
  WHEN l.reason = 'FilteredBlackList' THEN 'blocklist'
  WHEN l.reason IS NULL THEN 'blocked'
  ELSE 'blocked' END`;

// Attribution, the same rule analytics.mjs uses (its IPMAP is not exported,
// and the two must stay identical, so this is a copy with a pointer): a
// device's reserved address first, then the live lease for its MAC. Rows that
// match neither stay unattributed on purpose.
const IPMAP = `
  ipmap AS (
    SELECT DISTINCT ON (ip) ip, child_id FROM (
      SELECT d.reserved_ip AS ip, d.child_id, 1 AS pri
        FROM devices d WHERE d.reserved_ip IS NOT NULL AND d.child_id IS NOT NULL
      UNION ALL
      SELECT l.ip, dv.child_id, 2 AS pri
        FROM dhcp_leases l JOIN devices dv ON dv.mac = l.mac WHERE dv.child_id IS NOT NULL
    ) s ORDER BY ip, pri
  )`;

// dns_log for the window ($1 = days back from today, 0 = today only), each row
// attributed where it can be, with the reason group worked out once.
const dnsCte = (hasReason, extra = "") => `
  dns AS (
    SELECT l.id, l.ts, l.domain, l.action, l.device_id, l.client_ip,
           ${hasReason ? "l.reason, l.filter_list" : "NULL::text AS reason, NULL::text AS filter_list"},
           ${hasReason ? WHY_SQL : WHY_SQL.replace(/l\.reason/g, "NULL::text").replace(/l\.filter_list/g, "NULL::text")} AS why,
           COALESCE(dev.child_id, m.child_id) AS child_id
    FROM dns_log l
    LEFT JOIN devices dev ON dev.id = l.device_id
    LEFT JOIN ipmap m ON m.ip = l.client_ip
    WHERE l.ts >= CURRENT_DATE - make_interval(days => $1::int) ${extra}
  )`;

async function safe(q, sql, params, fallback, notes, what) {
  try { return await q(sql, params); } catch (e) { notes.push(`${what}: ${e.message}`); return fallback; }
}
const num = v => (v === null || v === undefined ? 0 : Number(v));
const isoDay = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Does this database have the reason columns yet? One cheap query, so an
// older box renders the page with "not recorded" everywhere instead of a 500.
async function reasonColumns(q) {
  try {
    const r = await q(`SELECT count(*)::int AS n FROM information_schema.columns
                       WHERE table_name = 'dns_log' AND column_name IN ('reason','filter_list')`);
    return num(r[0]?.n) === 2;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------
function readFilters(url) {
  const p = url.searchParams;
  const range = RANGES.find(r => r[0] === p.get("range")) || RANGES[1];
  const int = (k, lo, hi) => {
    const v = Number(p.get(k));
    return Number.isInteger(v) && v >= lo && v <= hi ? v : null;
  };
  const text = (k, re, max) => {
    const v = String(p.get(k) || "").trim().toLowerCase().slice(0, max);
    return v && re.test(v) ? v : "";
  };
  const child = p.get("child") === "none" ? "none" : int("child", 1, 1e9);
  return {
    range: range[0], rangeLabel: range[1], days: range[2],
    child,
    device: int("device", 1, 1e9),
    cat: text("cat", /^[a-z0-9-]{1,32}$/, 32),
    action: ["allowed", "blocked"].includes(p.get("action")) ? p.get("action") : "",
    why: WHY_BY.has(p.get("why")) ? p.get("why") : "",
    site: text("site", /^[a-z0-9._-]{1,253}$/, 253),
    domain: text("domain", /^[a-z0-9._-]{1,120}$/, 120),
    n: PAGE_SIZES.includes(Number(p.get("n"))) ? Number(p.get("n")) : 100,
    beforeTs: /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(p.get("before_ts") || "") ? p.get("before_ts") : null,
    beforeId: int("before_id", 1, 1e15),
  };
}

// Build a query string from a filter set, with overrides. Empty values are
// dropped so links stay readable.
function qs(f, over = {}) {
  const o = { range: f.range, child: f.child, device: f.device, cat: f.cat, action: f.action,
              why: f.why, site: f.site, domain: f.domain, n: f.n === 100 ? "" : f.n, ...over };
  const parts = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === "" || v === false) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

// ---------------------------------------------------------------------------
// The log query, shared by the page and the JSON endpoint
// ---------------------------------------------------------------------------
async function logRows(q, f, hasReason) {
  const params = [f.days];
  const where = [];
  const add = v => { params.push(v); return `$${params.length}`; };
  if (f.device) where.push(`l.device_id = ${add(f.device)}`);
  if (f.action) where.push(`l.action = ${add(f.action)}`);
  if (f.site) { const p = add(f.site); where.push(`(l.domain = ${p} OR l.domain LIKE '%.' || ${p})`); }
  if (f.domain) where.push(`l.domain LIKE '%' || ${add(f.domain)} || '%'`);
  if (f.beforeTs && f.beforeId) where.push(`(l.ts, l.id) < (${add(f.beforeTs)}::timestamptz, ${add(f.beforeId)}::bigint)`);
  const outer = [];
  if (f.child === "none") outer.push("d.child_id IS NULL");
  else if (f.child) outer.push(`d.child_id = ${add(f.child)}`);
  if (f.why) outer.push(`d.why = ${add(f.why)}`);
  // A category is a suffix match against category_domains. Matching the
  // distinct names in the window first keeps it to a few thousand
  // comparisons rather than a few million.
  let catCte = "";
  if (f.cat) {
    const p = add(f.cat);
    catCte = `, catdoms AS (
      SELECT DISTINCT n.domain FROM (SELECT DISTINCT domain FROM dns) n
      JOIN category_domains cd ON cd.category = ${p}
       AND (n.domain = cd.domain OR n.domain LIKE '%.' || cd.domain))`;
    outer.push("d.domain IN (SELECT domain FROM catdoms)");
  }
  const limit = add(f.n);
  const sql = `WITH ${IPMAP}, ${dnsCte(hasReason, where.length ? "AND " + where.join(" AND ") : "")}${catCte},
    picked AS (
      SELECT d.* FROM dns d ${outer.length ? "WHERE " + outer.join(" AND ") : ""}
      ORDER BY d.ts DESC, d.id DESC LIMIT ${limit}
    )
    SELECT p.id, p.ts, to_char(p.ts, 'Dy DD Mon HH24:MI:SS') AS when_txt,
           p.domain, p.action, p.reason, p.filter_list, p.why, p.child_id, p.device_id,
           host(p.client_ip) AS ip, c.name AS person,
           COALESCE(NULLIF(dv.label, ''), NULLIF(dv.hostname, ''), host(p.client_ip)) AS device,
           cat.category
    FROM picked p
    LEFT JOIN children c ON c.id = p.child_id
    LEFT JOIN devices dv ON dv.id = p.device_id
    LEFT JOIN LATERAL (
      SELECT cd.category FROM category_domains cd
      WHERE p.domain = cd.domain OR p.domain LIKE '%.' || cd.domain
      ORDER BY length(cd.domain) DESC LIMIT 1) cat ON true
    ORDER BY p.ts DESC, p.id DESC`;
  return q(sql, params);
}

// ---------------------------------------------------------------------------
// The overview data
// ---------------------------------------------------------------------------
async function overview(q, f, hasReason) {
  const notes = [];
  const byHour = f.days === 0;
  const bucket = byHour ? "extract(hour FROM d.ts)::int" : "d.ts::date::text";
  const P = [f.days];
  const [people, volume, whyOver, top, strip, alerts, flags, minutes, today] = await Promise.all([
    // The household's own children first, then visiting children, then the
    // adults: the order a parent reads the page in.
    safe(q, `SELECT id, name, kind, is_kid, age FROM people WHERE active
             ORDER BY is_household_child DESC, is_kid DESC, age NULLS LAST, name`, [], [], notes, "people"),
    safe(q, `WITH ${IPMAP}, ${dnsCte(hasReason)}
             SELECT d.child_id, ${bucket} AS b, COUNT(*) AS n,
                    COUNT(*) FILTER (WHERE d.action = 'blocked') AS blocked
             FROM dns d GROUP BY 1, 2`, P, [], notes, "lookups over time"),
    safe(q, `WITH ${IPMAP}, ${dnsCte(hasReason)}
             SELECT ${bucket} AS b, d.why, COUNT(*) AS n
             FROM dns d WHERE d.action = 'blocked' GROUP BY 1, 2`, P, [], notes, "blocked by reason"),
    safe(q, `WITH ${IPMAP}, ${dnsCte(hasReason)},
             t AS (SELECT d.child_id, d.domain, COUNT(*) AS n,
                          COUNT(*) FILTER (WHERE d.action = 'blocked') AS blocked,
                          ROW_NUMBER() OVER (PARTITION BY d.child_id ORDER BY COUNT(*) DESC, d.domain) AS rn
                   FROM dns d GROUP BY 1, 2)
             SELECT t.child_id, t.domain, t.n, t.blocked, cat.category
             FROM t
             LEFT JOIN LATERAL (
               SELECT cd.category FROM category_domains cd
               WHERE t.domain = cd.domain OR t.domain LIKE '%.' || cd.domain
               ORDER BY length(cd.domain) DESC LIMIT 1) cat ON true
             WHERE t.rn <= 10 ORDER BY t.child_id, t.n DESC`, P, [], notes, "top sites"),
    safe(q, `WITH ${IPMAP}, ${dnsCte(hasReason)}
             SELECT d.why, COUNT(*) AS n, COUNT(DISTINCT d.domain) AS domains,
                    COUNT(DISTINCT d.child_id) AS people, MAX(d.ts) AS last_ts
             FROM dns d WHERE d.action = 'blocked' GROUP BY 1`, P, [], notes, "blocked summary"),
    safe(q, `SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE NOT acknowledged) AS open,
                    COUNT(*) FILTER (WHERE severity = 'urgent') AS urgent
             FROM alerts WHERE ts >= CURRENT_DATE - make_interval(days => $1::int)
               AND category NOT IN ('dns-ingest', 'alert-check', 'gateway', 'iot-policy')`,
      P, [{ n: 0, open: 0, urgent: 0 }], notes, "alerts"),
    safe(q, `WITH ${IPMAP}, ${dnsCte(hasReason)}
             SELECT COUNT(DISTINCT d.id) AS n FROM dns d
             JOIN flag_domains fd ON d.domain ILIKE '%' || fd.pattern`, P, [{ n: 0 }], notes, "flag matches"),
    safe(q, `SELECT child_id, day::text AS day, category, used_min FROM category_usage
             WHERE day >= CURRENT_DATE - make_interval(days => $1::int)`, P, [], notes, "category usage"),
    q("SELECT CURRENT_DATE::text AS d, extract(hour FROM now())::int AS h"),
  ]);

  // Buckets: 24 hours, or every day in the window, empty ones included.
  const keys = [];
  if (byHour) for (let h = 0; h < 24; h++) keys.push(String(h));
  else {
    const base = new Date(today[0].d + "T00:00:00Z");
    for (let i = f.days; i >= 0; i--) keys.push(new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10));
  }
  const keyOf = b => (byHour ? String(num(b)) : isoDay(b));
  const bucketLabel = k => (byHour ? `${k.padStart(2, "0")}:00` : fmt.dayFull(k));
  const bucketSub = k => (byHour ? `${k}h` : (f.days <= 10 ? fmt.dayShort(k) : fmt.dayNum(k)));

  // People get palette slots in the order the household lists them: the
  // children first. Whoever is past the last slot shares the grey.
  const seriesOf = new Map();
  const legendItems = [];
  people.forEach((p, i) => {
    const key = i < SLOTS.length ? SLOTS[i] : UNATTR;
    seriesOf.set(p.id, key);
    if (i < SLOTS.length) legendItems.push({ key, label: p.name });
  });
  const overflow = people.slice(SLOTS.length).map(p => p.name);
  legendItems.push({ key: UNATTR, label: overflow.length ? `Unattributed, and ${overflow.join(", ")}` : "Unattributed" });

  const volCols = keys.map(k => ({ label: bucketLabel(k), sub: bucketSub(k), values: {}, blocked: 0, total: 0, byPerson: {} }));
  const volIdx = new Map(keys.map((k, i) => [k, i]));
  let total = 0, blocked = 0, unattributed = 0;
  const perPerson = new Map();
  for (const r of volume) {
    const c = volCols[volIdx.get(keyOf(r.b))]; if (!c) continue;
    const key = r.child_id === null ? UNATTR : (seriesOf.get(r.child_id) || UNATTR);
    c.values[key] = (c.values[key] || 0) + num(r.n);
    c.total += num(r.n); c.blocked += num(r.blocked);
    total += num(r.n); blocked += num(r.blocked);
    if (r.child_id === null) unattributed += num(r.n);
    else {
      const pp = perPerson.get(r.child_id) || { n: 0, blocked: 0 };
      pp.n += num(r.n); pp.blocked += num(r.blocked); perPerson.set(r.child_id, pp);
    }
    c.byPerson[r.child_id === null ? "none" : r.child_id] = (c.byPerson[r.child_id === null ? "none" : r.child_id] || 0) + num(r.n);
  }
  const volSeries = [...legendItems];

  // Blocked by reason over time. Only the reasons that occurred get a series.
  const whyCols = keys.map(k => ({ label: bucketLabel(k), sub: bucketSub(k), values: {} }));
  const whyTotals = new Map();
  for (const r of whyOver) {
    const c = whyCols[volIdx.get(keyOf(r.b))]; if (!c) continue;
    c.values[r.why] = (c.values[r.why] || 0) + num(r.n);
    whyTotals.set(r.why, (whyTotals.get(r.why) || 0) + num(r.n));
  }
  // Each reason keeps its palette slot from WHY, but no two shown at once may
  // share one, so the slots are handed out again in WHY order when they clash.
  const whyShown = WHY.filter(w => whyTotals.has(w[0]));
  const used = new Set();
  const whySeries = whyShown.map(w => {
    let key = w[2];
    if (used.has(key)) key = [...SLOTS, UNATTR].find(k => !used.has(k)) || UNATTR;
    used.add(key);
    return { key, label: w[1], why: w[0], n: whyTotals.get(w[0]) };
  });
  // The chart is keyed by palette slot, so re-key the columns.
  const slotOf = new Map(whySeries.map(s => [s.why, s.key]));
  for (const c of whyCols) {
    const v = {};
    for (const [why, n] of Object.entries(c.values)) v[slotOf.get(why)] = (v[slotOf.get(why)] || 0) + n;
    c.values = v;
  }

  // Top sites per person, unattributed last.
  const topBy = new Map();
  for (const r of top) {
    const k = r.child_id === null ? "none" : r.child_id;
    if (!topBy.has(k)) topBy.set(k, []);
    topBy.get(k).push({ domain: r.domain, n: num(r.n), blocked: num(r.blocked), category: r.category });
  }

  // Minutes per category per day, children only: the meter never runs for
  // an adult or a guest.
  const kids = people.filter(p => p.is_kid);
  const minBy = new Map(kids.map(k => [k.id, keys.map(d => ({ day: d, gaming: 0, video: 0, social: 0 }))]));
  const dayIdx = byHour ? new Map([[today[0].d, 0]]) : volIdx;
  const minRows = byHour ? new Map(kids.map(k => [k.id, [{ day: today[0].d, gaming: 0, video: 0, social: 0 }]])) : minBy;
  for (const r of minutes) {
    const rows = minRows.get(r.child_id); if (!rows) continue;
    const i = dayIdx.get(isoDay(r.day)); if (i === undefined) continue;
    if (r.category in rows[i]) rows[i][r.category] = num(r.used_min);
  }

  const stripBy = new Map(strip.map(r => [r.why, { n: num(r.n), domains: num(r.domains), people: num(r.people), last: r.last_ts }]));

  return {
    notes, people, kids, seriesOf, legendItems, volCols, volSeries, whyCols, whySeries,
    total, blocked, unattributed, perPerson, topBy, minRows, stripBy,
    alerts: alerts[0] || { n: 0, open: 0, urgent: 0 }, flags: num(flags[0]?.n),
    hasMeter: minutes.length > 0, byHour, keys, today: today[0].d, nowHour: num(today[0].h),
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const personName = (o, id) => (id === null || id === "none" ? "Unattributed" : (o.people.find(p => p.id === Number(id))?.name || `#${id}`));
const catKey = c => (METERED.includes(c) ? c : null);

function rangeBar(f) {
  return `<div class="filters"><span class="lab">Range</span>`
    + RANGES.map(([k, l]) => `<a href="/analytics${qs(f, { range: k })}"${k === f.range ? ' class="sel"' : ""}>${esc(l)}</a>`).join("")
    + `</div>`;
}

function heroCard(o, f) {
  const pct = o.total ? Math.round((o.unattributed / o.total) * 100) : 0;
  const per = [...o.perPerson.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6)
    .map(([id, v]) => `${esc(personName(o, id))} ${esc(fmt.count(v.n))}`).join(" · ");
  return `<div class="card"><div class="hero">
    <div class="fig">${esc(fmt.count(o.total))}</div>
    <div class="cap"><b>DNS lookups</b> ${f.range === "today" ? "so far today" : `over the ${esc(f.rangeLabel.toLowerCase())}`}:
      ${esc(fmt.count(o.blocked))} blocked, ${esc(fmt.count(o.unattributed))} (${pct}%) from devices nobody has named yet.
      ${per ? `<br>${per}` : ""}</div></div>
    <p class="cnote">A lookup is a device asking for a name. It is not a minute and not a byte, and it is not proof anyone
      looked at anything: apps ask for names in the background all day. Blocked means the name was not answered
      (or was answered with the portal's address). Nothing here can see inside HTTPS, and a device on a VPN or
      DNS-over-HTTPS is invisible to all of it.</p></div>`;
}

function worthALook(o, f) {
  const tile = (label, n, sub, link, tone = "") => `<a class="antile ${tone}" href="${esc(link)}">
      <span class="lab">${esc(label)}</span><span class="val">${esc(fmt.count(n))}</span>
      <span class="dlt">${esc(sub)}</span></a>`;
  const w = k => o.stripBy.get(k) || { n: 0, domains: 0, people: 0 };
  const log = why => `/analytics${qs(f, { why, action: "blocked" })}#log`;
  const tiles = [];
  const a = w("adult");
  tiles.push(tile("Adult sites, blocked", a.n, a.n ? `${a.domains} site${a.domains === 1 ? "" : "s"}, ${a.people} person${a.people === 1 ? "" : "s"}` : "none in this window", log("adult"), a.n ? "hot" : ""));
  const g = w("gambling");
  tiles.push(tile("Gambling sites, blocked", g.n, g.n ? `${g.domains} site${g.domains === 1 ? "" : "s"}` : "none in this window", log("gambling"), g.n ? "hot" : ""));
  const b = w("bypass");
  tiles.push(tile("VPN or proxy bypass, blocked", b.n, b.n ? `${b.domains} site${b.domains === 1 ? "" : "s"}` : "none in this window", log("bypass"), b.n ? "warm" : ""));
  const p = w("portal");
  tiles.push(tile("Sent to the portal", p.n, p.n ? "lookups while cut off" : "nobody was cut off", log("portal")));
  const bl = w("blocklist").n + w("blocked").n;
  if (bl) tiles.push(tile("Blocked, list not recorded", bl, "before the reason was kept", log("blocklist")));
  tiles.push(tile("Alerts raised", num(o.alerts.n), num(o.alerts.open) ? `${o.alerts.open} still to talk about` : "all talked about", "/#alerts", num(o.alerts.urgent) ? "hot" : ""));
  tiles.push(tile("Watch-list lookups", o.flags, "Tor, darknet, self-harm, VPN patterns", "/week"));
  return `<div class="card"><h2>Worth a look</h2>
    <p class="sub">Counts of lookups, not of people or of visits. One page can ask for an adult domain many times
      through an embedded advert; one child can ask once. Open the log before drawing a conclusion, and treat
      what you find as the start of a conversation.</p>
    <div class="antiles">${tiles.join("")}</div>
    <p class="cnote">"Adult" and "gambling" are the names of the blocklists that matched (OISD NSFW and HaGeZi Gambling,
      as AdGuard is set up). A blocklist can be wrong about a site. Rows from before 2026-09-02 have no recorded
      reason, so they can only ever show as "blocked".</p></div>`;
}

function volumeCard(o, f) {
  const chart = countColumns({
    cols: o.volCols, series: o.volSeries, unit: "lookups", xEvery: o.byHour ? 6 : null,
    title: `Lookups per ${o.byHour ? "hour" : "day"}, by person`,
  });
  const head = ["When", ...o.volSeries.map(s => s.label), "Blocked", "Total"];
  const rows = o.volCols.map(c => [c.label, ...o.volSeries.map(s => c.values[s.key] || 0), c.blocked, c.total]);
  return `<div class="card"><h2>Lookups over time</h2>
    <p class="sub">DNS lookups per ${o.byHour ? "hour today" : "day"}, stacked by the person whose device asked.
      ${o.byHour ? "Hours follow the gateway's clock; the current hour is part-finished." : ""}</p>
    <div class="figure">${chart}</div>
    ${legendOf(o.volSeries, { note: "Unattributed lookups come from devices not yet assigned to anyone. Name them on the Devices tab and they start counting for that person." })}
    ${table(head, rows)}</div>`;
}

function minutesCard(o, f) {
  if (!o.hasMeter) {
    return `<div class="card"><h2>Minutes per category</h2>
      <p class="sub">The only honest minutes on this page come from the meter (category_usage), which counts a minute
        when a device moves real traffic to a category's addresses in that minute.</p>
      <div class="empty">No metered minutes recorded for this window. They appear once the metering timer has run
        and the children's devices are named. Lookup counts above are not a substitute: a lookup is not a minute.</div></div>`;
  }
  const keys = ["gaming", "video", "social"];
  // A visiting child is never metered, so an empty chart for them says
  // nothing. Anyone with no minutes at all is left out, and the sentence
  // below the charts explains why a name can be missing.
  const shown = o.kids.filter(k => (o.minRows.get(k.id) || []).some(d => d.gaming + d.video + d.social > 0));
  const blocks = shown.map(k => {
    const rows = o.minRows.get(k.id) || [];
    const cols = rows.map(d => ({
      label: fmt.dayFull(d.day), sub: rows.length <= 10 ? fmt.dayShort(d.day) : fmt.dayNum(d.day),
      segs: keys.map(key => ({ key, value: d[key] })),
    }));
    const tot = keys.map(key => rows.reduce((a, d) => a + d[key], 0));
    return `<p class="ftitle">${esc(k.name)}</p>
      <p class="fsub">${keys.map((key, i) => `${key} ${esc(fmt.min(tot[i]))}`).join(" · ")}</p>
      <div class="figure">${columns({ cols, series: keys.map(key => ({ key })), title: `${k.name}: metered minutes per day` })}</div>
      ${table(["Day", "Gaming", "Video", "Social"], rows.map(d => [fmt.dayFull(d.day), d.gaming, d.video, d.social]))}`;
  }).join("");
  return `<div class="card"><h2>Minutes per category</h2>
    <p class="sub">Metered minutes per day for each child, from the firewall counters (METERING.md). A minute counts
      when the device moved real traffic to that category in that minute, so a backgrounded app does not rack up
      time. Music, schoolwork and messaging are never metered. ${o.byHour ? "The meter works by day, so today is one column." : ""}</p>
    ${legend(keys)}
    ${blocks}
    <p class="cnote">These are the same figures as the Trends tab. They are measured, not derived from the lookup
      counts above, and the two must not be added together. A child with no metered minutes in the window
      (a visiting child is never metered) is not listed.</p></div>`;
}

function topSitesCard(o, f) {
  const order = [...o.people.map(p => p.id), "none"].filter(k => o.topBy.has(k));
  if (!order.length) return "";
  const block = k => {
    const list = o.topBy.get(k);
    const name = personName(o, k);
    const childParam = k === "none" ? "none" : k;
    const rows = list.map(d => ({
      label: d.domain, value: d.n, display: `${fmt.count(d.n)} lookups`,
      sub: d.blocked ? `${d.blocked} blocked` : "", key: catKey(d.category),
    }));
    const links = list.map(d => `<a class="anlink" href="/analytics${qs(f, { child: childParam, site: d.domain })}#log">${esc(d.domain)}</a>`).join(" ");
    return `<div class="ansites">
      <p class="ftitle"><a class="kidlink" href="/analytics${qs(f, { child: childParam })}#log">${esc(name)}</a></p>
      <div class="figure">${ranked(rows, { title: `${name}: sites by lookups` })}</div>
      <p class="cnote">Open the log for a site: ${links}</p>
      ${table(["Site", "Category", "Lookups", "Blocked"], list.map(d => [d.domain, d.category || "", d.n, d.blocked]))}
    </div>`;
  };
  // The children and the unnamed devices are what a parent came for; the
  // adults are there too, folded, because this page is about the household
  // and not about watching one another.
  const isAdult = k => k !== "none" && !o.people.find(p => p.id === Number(k))?.is_kid;
  const open = order.filter(k => !isAdult(k)).map(block).join("");
  const adults = order.filter(isAdult);
  const folded = adults.length
    ? `<details class="tview"><summary>Adults and guests (${adults.map(k => personName(o, k)).join(", ")})</summary>${adults.map(block).join("")}</details>`
    : "";
  return `<div class="card"><h2>Top sites, by lookups</h2>
    <p class="sub">The names each person's devices asked for most. Coloured where the site is in a metered category
      (gaming, video, social); grey is everything else, including the CDNs and app back-ends that make up most of any
      device's lookups. Click a name to see every lookup of it.</p>
    ${open}${folded}</div>`;
}

function blockedCard(o, f) {
  if (!o.whySeries.length) {
    return `<div class="card"><h2>Blocked, and why</h2>
      <div class="empty">Nothing was blocked in this window.</div></div>`;
  }
  const chart = countColumns({
    cols: o.whyCols, series: o.whySeries, unit: "blocked lookups", xEvery: o.byHour ? 6 : null,
    title: `Blocked lookups per ${o.byHour ? "hour" : "day"}, by reason`,
  });
  const list = o.whySeries.map(s => `<li><span class="swatch" style="background:var(--s-${esc(s.key)})"></span>
      <a href="/analytics${qs(f, { why: s.why, action: "blocked" })}#log">${esc(s.label)}</a>
      <b>${esc(fmt.count(s.n))}</b></li>`).join("");
  const head = ["When", ...o.whySeries.map(s => whyShort(s.why)), "Total"];
  const rows = o.whyCols.map(c => {
    const vals = o.whySeries.map(s => c.values[s.key] || 0);
    return [c.label, ...vals, vals.reduce((a, b) => a + b, 0)];
  });
  return `<div class="card"><h2>Blocked, and why</h2>
    <p class="sub">Blocked lookups per ${o.byHour ? "hour" : "day"}, by the reason AdGuard gave. Adverts and trackers
      are usually most of it and mean nothing about the person; the rest is what the filter is for.</p>
    <div class="figure">${chart}</div>
    <ul class="legend anwhy">${list}</ul>
    ${table(head, rows)}
    <p class="cnote">"Sent to the portal" is a child whose internet was off (time up, bedtime, or a block): every name their
      device asked for was answered with the portal's address, so a hundred of those is one open browser, not a
      hundred attempts.</p></div>`;
}

const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(label)}</option>`;

function logCard(o, f, rows, devices, cats) {
  const people = o.people.map(p => opt(p.id, p.name, f.child)).join("") + opt("none", "Unattributed", f.child);
  const devs = devices.map(d => opt(d.id, `${d.label || d.hostname || d.ip || "device " + d.id}${d.person ? " (" + d.person + ")" : ""}`, f.device)).join("");
  const catOpts = cats.map(c => opt(c, c, f.cat)).join("");
  const whyOpts = WHY.map(w => opt(w[0], w[1], f.why)).join("");
  const active = [];
  if (f.child) active.push(`person: ${personName(o, f.child)}`);
  if (f.device) { const d = devices.find(x => x.id === f.device); active.push(`device: ${d ? (d.label || d.hostname || d.ip) : f.device}`); }
  if (f.cat) active.push(`category: ${f.cat}`);
  if (f.action) active.push(f.action);
  if (f.why) active.push(whyLabel(f.why));
  if (f.site) active.push(`site: ${f.site}`);
  if (f.domain) active.push(`contains: ${f.domain}`);

  const tr = r => `<tr>
      <td class="anwhen">${esc(r.when_txt)}</td>
      <td>${r.child_id === null ? '<span class="tag">unattributed</span>' : esc(r.person || "")}</td>
      <td class="andev">${esc(r.device || "")}</td>
      <td class="andom"><a href="/analytics${qs(f, { site: r.domain, domain: "" })}#log">${esc(r.domain)}</a></td>
      <td>${esc(r.category || "")}</td>
      <td class="anwhy-${esc(r.why)}">${esc(whyLabel(r.why))}${r.filter_list && !["portal", "category", "service"].includes(r.why) ? `<span class="tag"> ${esc(r.filter_list)}</span>` : ""}${r.why === "service" && r.filter_list ? `<span class="tag"> ${esc(r.filter_list.replace(/^service:/, ""))}</span>` : ""}</td>
    </tr>`;
  const last = rows[rows.length - 1];
  const more = rows.length >= f.n && last
    ? `<div class="mgacts"><button class="btn" type="button" id="anmore"
         data-qs="${esc(qs(f, { before_ts: new Date(last.ts).toISOString(), before_id: last.id }))}"
         onclick="anMore()">Show ${f.n} older</button><span class="grow"></span><span class="tag" id="anmsg"></span></div>`
    : `<p class="cnote">${rows.length ? "That is the end of the log for these filters." : ""}</p>`;

  return `<div class="card" id="log"><h2>The log</h2>
    <p class="sub">Every lookup in the window, newest first. Pick a person, then a site, and read every time a device asked
      for it. Genkan keeps domains only, never what was on a page, and keeps them for thirty days.</p>
    <form class="anform" method="get" action="/analytics">
      <input type="hidden" name="range" value="${esc(f.range)}">
      <div><label for="an_child">Person</label><select id="an_child" name="child">${opt("", "Anyone", f.child)}${people}</select></div>
      <div><label for="an_device">Device</label><select id="an_device" name="device">${opt("", "Any device", f.device)}${devs}</select></div>
      <div><label for="an_cat">Category</label><select id="an_cat" name="cat">${opt("", "Any category", f.cat)}${catOpts}</select></div>
      <div><label for="an_action">Allowed or blocked</label><select id="an_action" name="action">${opt("", "Both", f.action)}${opt("allowed", "Allowed", f.action)}${opt("blocked", "Blocked", f.action)}</select></div>
      <div class="wide"><label for="an_why">What happened</label><select id="an_why" name="why">${opt("", "Anything", f.why)}${whyOpts}</select></div>
      <div><label for="an_site">Site (this name and anything under it)</label><input id="an_site" name="site" value="${esc(f.site)}" placeholder="e.g. tiktok.com"></div>
      <div><label for="an_domain">Name contains</label><input id="an_domain" name="domain" value="${esc(f.domain)}" placeholder="e.g. roblox"></div>
      <div><label for="an_n">Rows at a time</label><select id="an_n" name="n">${PAGE_SIZES.map(n => opt(n, String(n), f.n)).join("")}</select></div>
      <div class="mgacts"><button class="btn primary" type="submit">Show the log</button>
        <a class="btn" href="/analytics${qs({ range: f.range, n: f.n })}#log">Clear filters</a></div>
    </form>
    ${active.length ? `<p class="cnote">Showing: ${esc(active.join(" · "))}, ${esc(f.rangeLabel.toLowerCase())}.</p>` : ""}
    <div class="tscroll"><table class="anlog"><thead><tr>
      <th>When</th><th>Person</th><th>Device</th><th>Name asked for</th><th>Category</th><th>What happened</th>
    </tr></thead><tbody id="anrows">${rows.map(tr).join("")}</tbody></table></div>
    ${rows.length ? "" : '<div class="empty">No lookups match those filters in this window.</div>'}
    ${more}
    <p class="foot">A row is one question from one device: "what is the address of this name?" It is not a page view,
      not a minute, and not proof a person did anything. Blocked means the name got no real answer. Times follow the
      gateway's clock. What this cannot see: anything inside HTTPS, anything a device sends through a VPN, Cloudflare
      WARP or its own DNS-over-HTTPS, and anything on mobile data.</p>
  </div>`;
}

function measurementCard(o, hasReason) {
  const lines = [
    ["Lookups are lookups.", "The gateway is the DNS server, so it sees which names a device asked for. It cannot see what came back, what was on the page, or how long anyone looked. Counts here are a proxy for activity and nothing more."],
    ["Minutes come from the meter.", "The only minutes on this page are the meter's, from firewall counters. They are never derived from lookups, and the two are not to be added together."],
    ["Blocked means unanswered.", "A blocked lookup is a name AdGuard refused, or answered with the portal's address for a child whose internet is off. What would have loaded is unknown."],
    ["Why is AdGuard's word.", hasReason
      ? "Each row keeps the reason AdGuard gave and the name of the list that matched. Rows from before 2026-09-02 have neither and show as \"reason not recorded\"."
      : "This box's database does not have the reason columns yet. Load config/db/schema.sql and install the current genkan-dnslog, and every new row will say why."],
    ["A blocklist can be wrong.", "Adult and gambling are the names of public blocklists. They are good and not perfect: a false positive is a blocked lookup with a scary label, and a lookup from an embedded advert is not a person typing."],
    ["A VPN makes all of this blind.", "So does Cloudflare WARP, a browser's own DNS-over-HTTPS, or mobile data. Genkan blocks the known bypass names and says so here when it does, and that is the honest extent of it."],
  ];
  return `<div class="card"><h2>How to read this page</h2>
    ${lines.map(([h, b]) => `<div class="row" style="display:block"><b>${esc(h)}</b><br><span class="r" style="text-align:left;display:block">${esc(b)}</span></div>`).join("")}
    ${o.notes.length ? `<p class="cnote">Panels unavailable: ${esc(o.notes.join("; "))}</p>` : ""}
    <p class="foot">Genkan is a family conversation aid, not a surveillance console. Domains only, thirty days, all of it in the house.</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// GET /analytics
// ---------------------------------------------------------------------------
export async function analyticsPage(q, s, url) {
  const f = readFilters(url);
  const hasReason = await reasonColumns(q);
  const notes = [];
  const [o, rows, devices, cats] = await Promise.all([
    overview(q, f, hasReason),
    logRows(q, f, hasReason).catch(e => { notes.push(`log: ${e.message}`); return []; }),
    safe(q, `SELECT id, label, hostname, ip, person FROM device_roster ORDER BY person NULLS LAST, label, hostname`, [], [], notes, "devices"),
    safe(q, `SELECT DISTINCT category FROM category_domains ORDER BY 1`, [], [], notes, "categories"),
  ]);
  o.notes.push(...notes);
  return rangeBar(f)
    + heroCard(o, f)
    + worthALook(o, f)
    + volumeCard(o, f)
    + blockedCard(o, f)
    + topSitesCard(o, f)
    + minutesCard(o, f)
    + logCard(o, f, rows, devices, cats.map(c => c.category))
    + measurementCard(o, hasReason);
}

// ---------------------------------------------------------------------------
// GET /api/analytics?op=log&...   JSON rows for "show older", same filters.
// ---------------------------------------------------------------------------
export async function analyticsApi(q, url, res) {
  const f = readFilters(url);
  const hasReason = await reasonColumns(q);
  const rows = await logRows(q, f, hasReason);
  const out = rows.map(r => ({
    id: String(r.id), ts: new Date(r.ts).toISOString(), when: r.when_txt,
    person: r.child_id === null ? null : r.person, device: r.device, domain: r.domain,
    category: r.category, action: r.action, why: r.why, why_label: whyLabel(r.why),
    list: r.filter_list,
  }));
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, rows: out, more: rows.length >= f.n, n: f.n }));
}

// ---------------------------------------------------------------------------
// Style and script
// ---------------------------------------------------------------------------
export const ANALYTICS_CSS = `
.antiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px}
.antile{display:block;background:var(--surface-2);border-radius:12px;padding:11px 12px;text-decoration:none;
  border:1px solid transparent}
.antile:hover{border-color:var(--line)}
.antile .lab{font-size:11.5px;color:var(--ink-muted);display:block;margin-bottom:2px}
.antile .val{font-size:21px;font-weight:600;letter-spacing:-.01em;display:block}
.antile .dlt{font-size:11.5px;color:var(--ink-muted);display:block;margin-top:1px}
.antile.hot .val{color:var(--crit)}
.antile.warm .val{color:var(--serious)}
.anwhy{display:block}
.anwhy li{display:flex;align-items:center;gap:7px;padding:3px 0}
.anwhy li a{flex:1;min-width:0;text-decoration:none}
.anwhy li b{font-variant-numeric:tabular-nums}
.ansites{border-top:1px solid var(--line);padding-top:4px;margin-top:8px}
.ansites:first-of-type{border-top:0;margin-top:0}
.anlink{display:inline-block;margin:0 6px 2px 0;text-decoration:none;border-bottom:1px solid var(--axis)}
.anlink:hover{border-bottom-color:var(--ember)}
.anform{display:grid;gap:10px 12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:8px 0 10px;align-items:end}
.anform label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-muted);
  margin-bottom:3px;font-weight:600}
.anform input,.anform select{width:100%}
.anform .wide{grid-column:1/-1}
.anform .mgacts{grid-column:1/-1;margin-top:2px}
.anlog{border-collapse:collapse;width:100%;font-size:12.5px}
.anlog th,.anlog td{text-align:left;padding:6px 9px 6px 0;border-bottom:1px solid var(--line);vertical-align:top}
.anlog th{color:var(--ink-muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.anlog .anwhen{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--ink-2)}
.anlog .andev{white-space:nowrap}
.anlog .andom{word-break:break-all}
.anlog .andom a{text-decoration:none;border-bottom:1px solid var(--axis)}
.anlog .andom a:hover{border-bottom-color:var(--ember)}
.anlog td[class^=anwhy-]{color:var(--ink-2)}
.anlog .anwhy-adult,.anlog .anwhy-gambling,.anlog .anwhy-malware{color:var(--crit);font-weight:600}
.anlog .anwhy-bypass{color:var(--serious);font-weight:600}
.anlog .anwhy-portal,.anlog .anwhy-service,.anlog .anwhy-category{color:var(--ember)}
.anlog .anwhy-allowed{color:var(--ink-muted)}
.anlog .tag{display:block;font-weight:400}
@media(max-width:640px){.anlog{font-size:12px}.anlog th,.anlog td{padding:5px 6px 5px 0}}
`;

// The page works with no script at all: the form is a GET and the log is
// server rendered. This only adds "show older" without a reload. Rows are
// built with createElement and textContent, never innerHTML: domain names are
// data a stranger's server chose, not something we wrote.
export const ANALYTICS_JS = `
async function anMore(){
  var b=document.getElementById('anmore');if(!b)return;
  var m=document.getElementById('anmsg');
  b.disabled=true;if(m)m.textContent='loading\\u2026';
  try{
    var r=await fetch('/api/analytics'+b.getAttribute('data-qs')+'&op=log',{headers:H()});
    var j=await r.json();
    var tb=document.getElementById('anrows');
    var base=(b.getAttribute('data-qs')||'?').replace(/&?before_ts=[^&]*/,'').replace(/&?before_id=[^&]*/,'').replace(/&?site=[^&]*/,'').replace(/&?domain=[^&]*/,'');
    if(base.charAt(0)!=='?')base='?'+base.replace(/^&/,'');
    (j.rows||[]).forEach(function(x){
      var tr=document.createElement('tr');
      function td(t,c){var d=document.createElement('td');if(c)d.className=c;if(t!=null)d.textContent=t;tr.appendChild(d);return d;}
      td(x.when,'anwhen');
      var p=td(null);if(x.person){p.textContent=x.person;}else{var s=document.createElement('span');s.className='tag';s.textContent='unattributed';p.appendChild(s);}
      td(x.device||'','andev');
      var dd=td(null,'andom');var a=document.createElement('a');a.textContent=x.domain;
      a.href='/analytics'+base+(base==='?'?'':'&')+'site='+encodeURIComponent(x.domain)+'#log';dd.appendChild(a);
      td(x.category||'');
      var w=td(x.why_label,'anwhy-'+x.why);
      if(x.list&&['portal','category'].indexOf(x.why)<0){var g=document.createElement('span');g.className='tag';
        g.textContent=' '+(x.why==='service'?x.list.replace(/^service:/,''):x.list);w.appendChild(g);}
      tb.appendChild(tr);
    });
    var last=(j.rows||[])[j.rows.length-1];
    if(j.more&&last){
      b.setAttribute('data-qs',base+(base==='?'?'':'&')+'before_ts='+encodeURIComponent(last.ts)+'&before_id='+encodeURIComponent(last.id));
      b.disabled=false;if(m)m.textContent='';
    }else{b.remove();if(m)m.textContent='That is the end of the log for these filters.';}
  }catch(e){b.disabled=false;if(m)m.textContent='Could not load more: '+e.message;}
}
`;
