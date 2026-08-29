// Hearth dashboard: the analytics data layer.
//
// Everything here is READ ONLY. It never writes, never calls kidnet, and never
// touches the firewall. It turns the tables the gateway already fills
// (time_ledger, time_events, category_usage, service_usage, dns_log) into the
// shapes the charts want.
//
// HONESTY RULES baked into this file, because the numbers on a parent's phone
// have to be defensible:
//   * DNS lookups are LOOKUPS. They are a proxy for activity, never for data
//     volume and never for minutes. They are labelled that way everywhere.
//   * Bytes only ever come from service_usage / category_usage, which are fed
//     by real nftables counters (see METERING.md). We never derive a byte
//     figure from a lookup count.
//   * Minutes come from the meter (category_usage, service_usage.used_min) or
//     from the ledger (time_ledger.used_min). Never from DNS.
//   * Anything we cannot attribute to a child stays visible as "unattributed"
//     rather than being quietly dropped or spread around.
//
// Day boundaries follow the DATABASE clock, because that is what kidnet uses
// when it writes time_ledger.day and category_usage.day. Every series in here
// uses the same definition, so the charts always agree with each other.

// ---------------------------------------------------------------------------
// Palette. Four categorical slots, assigned in fixed order and never cycled.
// Validated with the dataviz validator against the two Hearth chart surfaces
// (light #fdfbf8, dark #1d1926): lightness band, chroma floor, adjacent CVD
// separation and normal-vision separation all pass in both modes. Two light
// slots sit under 3:1 against the light surface, so every chart that uses them
// also ships a legend, direct labels and a table view (the relief rule).
// ---------------------------------------------------------------------------
export const SERIES = {
  gaming: { key: "gaming", label: "Gaming", light: "#2a78d6", dark: "#3987e5" },
  video: { key: "video", label: "Video", light: "#eb6834", dark: "#d95926" },
  social: { key: "social", label: "Social", light: "#1baf7a", dark: "#199e70" },
  earned: { key: "earned", label: "Earned", light: "#eda100", dark: "#c98500" },
  // Not a categorical slot: the de-emphasis grey for "online, but not metered".
  other: { key: "other", label: "Other online", light: "#898781", dark: "#898781" },
};

// The categories the meter actually counts against a budget. Audio, schoolwork,
// chess and messaging are deliberately never metered (METERING.md).
export const METERED = ["gaming", "video", "social"];

// Fallback service map, used only if the services tables are missing (an older
// database). Keyed on domain suffix, longest match wins, exactly like the
// service_domains table it stands in for.
const FALLBACK_SERVICES = [
  ["youtube", "YouTube", "video", "📺", true, ["youtube.com", "googlevideo.com", "ytimg.com", "youtu.be"]],
  ["netflix", "Netflix", "video", "🎬", true, ["netflix.com", "nflxvideo.net", "nflxso.net"]],
  ["disneyplus", "Disney+", "video", "🏰", true, ["disneyplus.com", "disney-plus.net", "dssott.com"]],
  ["primevideo", "Prime Video", "video", "📦", true, ["primevideo.com", "aiv-cdn.net"]],
  ["tiktok", "TikTok", "video", "🎵", true, ["tiktok.com", "tiktokcdn.com", "byteoversea.com"]],
  ["twitch", "Twitch", "video", "🟣", true, ["twitch.tv", "ttvnw.net", "jtvnw.net"]],
  ["instagram", "Instagram", "social", "📸", true, ["instagram.com", "cdninstagram.com"]],
  ["snapchat", "Snapchat", "social", "👻", true, ["snapchat.com", "sc-cdn.net", "snap.com"]],
  ["roblox", "Roblox", "gaming", "🧱", true, ["roblox.com", "rbxcdn.com"]],
  ["fortnite", "Fortnite", "gaming", "🎯", true, ["fortnite.com", "epicgames.com"]],
  ["steam", "Steam", "gaming", "🕹️", true, ["steampowered.com", "steamcommunity.com"]],
  ["minecraft", "Minecraft", "gaming", "⛏️", true, ["minecraft.net", "minecraftservices.com"]],
  ["spotify", "Spotify", "audio", "🎧", false, ["spotify.com", "scdn.co", "spotifycdn.com"]],
  ["khanacademy", "Khan Academy", "schoolwork", "📚", false, ["khanacademy.org", "kastatic.org"]],
  ["googleclassroom", "Google Classroom", "schoolwork", "🎓", false, ["classroom.google.com"]],
];

// A device is attributed to a child by its reserved IP first (that is what
// kidnet-dnslog uses when it stamps device_id), then by the current DHCP lease
// for its MAC. Rows that match neither stay unattributed on purpose.
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

// dns_log for the window, with each row attributed to a child where we can.
const DNS = `
  dns AS (
    SELECT l.id, l.ts, l.ts::date AS day, l.domain, l.action,
           COALESCE(dev.child_id, m.child_id) AS child_id
    FROM dns_log l
    LEFT JOIN devices dev ON dev.id = l.device_id
    LEFT JOIN ipmap m ON m.ip = l.client_ip
    WHERE l.ts >= now() - make_interval(days => $1::int)
  )`;

// The same thing for an explicit date RANGE ($1 inclusive, $2 exclusive), which
// is what a Monday-to-Sunday week needs. Kept separate from DNS above rather
// than generalised, so the parameter positions of the existing queries never
// move.
const WDNS = `
  wdns AS (
    SELECT l.id, l.ts, l.ts::date AS day, l.domain, l.action,
           COALESCE(dev.child_id, m.child_id) AS child_id
    FROM dns_log l
    LEFT JOIN devices dev ON dev.id = l.device_id
    LEFT JOIN ipmap m ON m.ip = l.client_ip
    WHERE l.ts >= $1::date AND l.ts < $2::date
  )`;

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

// Run a query, and on failure return a fallback plus a note. A missing table or
// a missing GRANT must degrade one panel, never take the dashboard down: the
// controls matter more than the charts.
async function safe(q, sql, params, fallback, notes, what) {
  try {
    return await q(sql, params);
  } catch (e) {
    notes.push(`${what}: ${e.message}`);
    return fallback;
  }
}

const num = v => (v === null || v === undefined ? 0 : Number(v));
const isoDay = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// The window's day keys, oldest first, including days with no data at all so
// the charts show real gaps instead of silently compressing them.
function dayKeys(days, today) {
  const out = [];
  const base = new Date(today + "T00:00:00Z");
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86400000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Bucket a per-child domain tally into services using the built-in map, for the
// case where the services tables are missing. Longest suffix wins, exactly as
// the SQL does with service_domains.
function fallbackServiceRows(topDomains) {
  const suffixes = [];
  FALLBACK_SERVICES.forEach((row, i) => { for (const d of row[5]) suffixes.push([d, -(i + 1)]); });
  suffixes.sort((a, b) => b[0].length - a[0].length);
  const bucket = new Map();
  for (const r of topDomains || []) {
    const hit = suffixes.find(([d]) => r.domain === d || r.domain.endsWith("." + d));
    if (!hit) continue;
    const k = `${r.child_id}|${hit[1]}`;
    bucket.set(k, (bucket.get(k) || 0) + num(r.n));
  }
  const out = [];
  for (const [k, n] of bucket) {
    const [cid, sid] = k.split("|");
    out.push({ child_id: cid === "null" ? null : Number(cid), service_id: Number(sid), day: null, lookups: n, blocked: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The one call the dashboard makes
// ---------------------------------------------------------------------------
export async function analytics(q, days = 7) {
  const notes = [];
  const win = Math.max(1, Math.min(90, Number(days) || 7));

  const [today] = await q("SELECT CURRENT_DATE::text AS d");
  const dayList = dayKeys(win, today.d);

  const [
    children, ledger, catUsage, catBudgets, earn, spend, claims,
    svcMeta, svcLookups, svcBytes, learn, blocked, topDomains, unattributed,
  ] = await Promise.all([
    q("SELECT id,name,age,policy_tier,kind FROM children WHERE kind='child' ORDER BY age"),

    // Total minutes online per child per day, as the ledger recorded them.
    safe(q, `SELECT child_id, day::text AS day, used_min, budget_min, bonus_min
             FROM time_ledger WHERE day > CURRENT_DATE - $1::int ORDER BY day`,
      [win], [], notes, "time ledger"),

    // Metered minutes per child per day per category, straight from the meter.
    safe(q, `SELECT child_id, day::text AS day, category, used_min
             FROM category_usage WHERE day > CURRENT_DATE - $1::int`,
      [win], [], notes, "category usage (needs SELECT on category_usage)"),

    safe(q, "SELECT child_id, category, daily_min FROM category_budgets",
      [], [], notes, "category budgets"),

    // Minutes gained. quiz:% comes from the portal's graded quizzes, task:%
    // from a chore a parent approved. 'grant' (a parent bonus) is counted
    // separately: a gift is not something the kid earned.
    safe(q, `SELECT child_id, ts::date::text AS day,
               COALESCE(SUM(minutes) FILTER (WHERE kind='earn' AND reason LIKE 'quiz:%'),0) AS quiz_min,
               COALESCE(SUM(minutes) FILTER (WHERE kind='earn' AND reason LIKE 'task:%'),0) AS chore_min,
               COALESCE(SUM(minutes) FILTER (WHERE kind='earn'),0) AS earn_min,
               COALESCE(SUM(minutes) FILTER (WHERE kind='grant'),0) AS grant_min
             FROM time_events
             WHERE ts >= now() - make_interval(days => $1::int) AND kind IN ('earn','grant')
             GROUP BY 1,2`,
      [win], [], notes, "time events"),

    safe(q, `SELECT child_id, ts::date::text AS day,
               COALESCE(SUM(-minutes) FILTER (WHERE kind='penalty'),0) AS penalty_min
             FROM time_events
             WHERE ts >= now() - make_interval(days => $1::int) AND kind='penalty'
             GROUP BY 1,2`,
      [win], [], notes, "penalties"),

    safe(q, `SELECT child_id,
               COUNT(*) FILTER (WHERE status='approved') AS approved,
               COUNT(*) FILTER (WHERE status='pending') AS pending
             FROM earn_claims WHERE ts >= now() - make_interval(days => $1::int)
             GROUP BY 1`,
      [win], [], notes, "chore claims"),

    safe(q, "SELECT id,name,label,category,emoji,metered FROM services ORDER BY id",
      [], null, notes, "services table"),

    // Per-service DNS LOOKUPS. This is an activity proxy, not data volume and
    // not minutes. Longest matching domain suffix wins, so googlevideo.com
    // lands on YouTube rather than on a shorter generic match.
    safe(q, `WITH ${IPMAP}, ${DNS},
             hit AS (
               SELECT DISTINCT ON (d.id) d.id, d.child_id, d.day, d.action, sd.service_id
               FROM dns d
               JOIN service_domains sd ON d.domain = sd.domain OR d.domain LIKE '%.' || sd.domain
               ORDER BY d.id, length(sd.domain) DESC
             )
             SELECT child_id, service_id, day,
                    COUNT(*) AS lookups,
                    COUNT(*) FILTER (WHERE action='blocked') AS blocked
             FROM hit GROUP BY 1,2,3`,
      [win], [], notes, "service lookups"),

    // Real bytes and real active minutes, from the nftables per-service
    // counters (bin/kidnet-servicemeter). Empty until the island is cabled.
    safe(q, `SELECT child_id, service_id, day::text AS day, bytes, used_min
             FROM service_usage WHERE day > CURRENT_DATE - $1::int`,
      [win], [], notes, "service usage"),

    // Learning-domain lookups: the schoolwork category's domains.
    safe(q, `WITH ${IPMAP}, ${DNS}
             SELECT child_id, day::text AS day, COUNT(*) AS visits
             FROM dns d
             WHERE d.action='allowed' AND EXISTS (
               SELECT 1 FROM category_domains cd
               WHERE cd.category IN ('schoolwork','education')
                 AND (d.domain = cd.domain OR d.domain LIKE '%.' || cd.domain))
             GROUP BY 1,2`,
      [win], [], notes, "learning visits"),

    safe(q, `WITH ${IPMAP}, ${DNS}
             SELECT child_id, day::text AS day, COUNT(*) AS n
             FROM dns WHERE action='blocked' GROUP BY 1,2`,
      [win], [], notes, "blocked lookups"),

    safe(q, `WITH ${IPMAP}, ${DNS}
             SELECT child_id, domain, COUNT(*) AS n, MAX(ts) AS last_ts
             FROM dns WHERE action='allowed'
             GROUP BY 1,2 ORDER BY 3 DESC LIMIT 400`,
      [win], [], notes, "top domains"),

    safe(q, `WITH ${IPMAP}, ${DNS}
             SELECT COUNT(*) FILTER (WHERE child_id IS NULL) AS unowned,
                    COUNT(*) AS total FROM dns`,
      [win], [{ unowned: 0, total: 0 }], notes, "attribution"),
  ]);

  // Services: prefer the database, fall back to the built-in map so the panel
  // still says something sensible on an older schema.
  let services = svcMeta;
  let usingFallbackServices = false;
  if (!services || !services.length) {
    usingFallbackServices = true;
    services = FALLBACK_SERVICES.map(([name, label, category, emoji, metered], i) =>
      ({ id: -(i + 1), name, label, category, emoji, metered }));
    notes.push("service table unavailable, using the built-in domain map");
  }
  const svcById = new Map(services.map(s => [Number(s.id), s]));

  // If we fell back, match the lookups in JS against the same suffix rule.
  const lookups = usingFallbackServices ? fallbackServiceRows(topDomains) : svcLookups;

  // ---- index everything by child -------------------------------------------
  const byChild = new Map();
  const blank = () => ({
    days: dayList.map(d => ({
      day: d, online: 0, budget: 0, bonus: 0,
      gaming: 0, video: 0, social: 0, metered: 0, other: 0,
      quiz: 0, chore: 0, earned: 0, granted: 0, penalty: 0,
      learn: 0, blocked: 0,
    })),
    dayIndex: new Map(dayList.map((d, i) => [d, i])),
    services: new Map(),
    topDomains: [],
    budgets: {},
    choresApproved: 0, choresPending: 0,
  });
  for (const c of children) byChild.set(c.id, blank());
  const bucketFor = id => byChild.get(id) || null;
  const dayRow = (id, day) => {
    const b = bucketFor(id); if (!b) return null;
    const i = b.dayIndex.get(isoDay(day)); return i === undefined ? null : b.days[i];
  };

  for (const r of ledger) {
    const d = dayRow(r.child_id, r.day); if (!d) continue;
    d.online = num(r.used_min); d.budget = num(r.budget_min); d.bonus = num(r.bonus_min);
  }
  for (const r of catUsage) {
    const d = dayRow(r.child_id, r.day); if (!d) continue;
    if (r.category in d) d[r.category] = num(r.used_min);
  }
  for (const r of earn) {
    const d = dayRow(r.child_id, r.day); if (!d) continue;
    d.quiz = num(r.quiz_min); d.chore = num(r.chore_min);
    d.earned = num(r.earn_min); d.granted = num(r.grant_min);
  }
  for (const r of spend) {
    const d = dayRow(r.child_id, r.day); if (!d) continue;
    d.penalty = num(r.penalty_min);
  }
  for (const r of learn) { const d = dayRow(r.child_id, r.day); if (d) d.learn = num(r.visits); }
  for (const r of blocked) { const d = dayRow(r.child_id, r.day); if (d) d.blocked = num(r.n); }
  for (const r of catBudgets) { const b = bucketFor(r.child_id); if (b) b.budgets[r.category] = num(r.daily_min); }
  for (const r of claims) {
    const b = bucketFor(r.child_id); if (!b) continue;
    b.choresApproved = num(r.approved); b.choresPending = num(r.pending);
  }

  for (const r of lookups) {
    const b = bucketFor(r.child_id); if (!b) continue;
    const s = svcById.get(Number(r.service_id)); if (!s) continue;
    const cur = b.services.get(s.name) || { service: s, lookups: 0, blocked: 0, bytes: 0, minutes: 0 };
    cur.lookups += num(r.lookups); cur.blocked += num(r.blocked);
    b.services.set(s.name, cur);
  }
  for (const r of svcBytes) {
    const b = bucketFor(r.child_id); if (!b) continue;
    const s = svcById.get(Number(r.service_id)); if (!s) continue;
    const cur = b.services.get(s.name) || { service: s, lookups: 0, blocked: 0, bytes: 0, minutes: 0 };
    cur.bytes += num(r.bytes); cur.minutes += num(r.used_min);
    b.services.set(s.name, cur);
  }
  for (const r of topDomains) {
    const b = bucketFor(r.child_id); if (!b) continue;
    if (b.topDomains.length < 12) b.topDomains.push({ domain: r.domain, n: num(r.n) });
  }

  // ---- derived per-child figures -------------------------------------------
  const kids = children.map(c => {
    const b = byChild.get(c.id);
    for (const d of b.days) {
      d.metered = d.gaming + d.video + d.social;
      // "Other online" is whatever the ledger counted that the meter did not
      // attribute to a metered category. Never negative: the two counters are
      // independent, so on a thin day the meter can read higher than the ledger.
      d.other = Math.max(0, d.online - d.metered);
    }
    const sum = k => b.days.reduce((a, d) => a + d[k], 0);
    const lost = sum("metered");
    const gained = sum("earned");
    const svc = [...b.services.values()].sort((x, y) => (y.lookups - x.lookups) || (y.bytes - x.bytes));
    return {
      ...c, ...b,
      totals: {
        online: sum("online"), metered: lost, gaming: sum("gaming"), video: sum("video"),
        social: sum("social"), other: sum("other"), quiz: sum("quiz"), chore: sum("chore"),
        earned: gained, granted: sum("granted"), penalty: sum("penalty"),
        learn: sum("learn"), blocked: sum("blocked"),
        balance: gained - lost,
      },
      serviceList: svc,
      weeks: weekly(b.days),
      today: b.days[b.days.length - 1],
    };
  });

  const att = unattributed[0] || { unowned: 0, total: 0 };
  return {
    window: win,
    dayList,
    kids,
    notes,
    measurement: {
      dnsRows: num(att.total),
      dnsUnattributed: num(att.unowned),
      hasMeter: catUsage.length > 0,
      hasServiceBytes: svcBytes.length > 0,
      usingFallbackServices,
    },
  };
}

// Group the daily rows into calendar weeks (Monday start), oldest first. Used
// for the losing/gaining balance, which is a weekly conversation, not a daily
// one: one bad afternoon is not a trend.
function weekly(days) {
  const out = [];
  let cur = null;
  for (const d of days) {
    const dt = new Date(d.day + "T00:00:00Z");
    const dow = (dt.getUTCDay() + 6) % 7;                 // 0 = Monday
    const start = new Date(dt.getTime() - dow * 86400000).toISOString().slice(0, 10);
    if (!cur || cur.start !== start) {
      cur = { start, gaming: 0, video: 0, social: 0, metered: 0, quiz: 0, chore: 0, earned: 0, learn: 0, days: 0 };
      out.push(cur);
    }
    for (const k of ["gaming", "video", "social", "metered", "quiz", "chore", "earned", "learn"]) cur[k] += d[k];
    cur.days++;
  }
  for (const w of out) w.balance = w.earned - w.metered;
  return out;
}

export const fmt = {
  min(m) {
    m = Math.round(m || 0);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  },
  bytes(b) {
    b = Number(b || 0);
    if (b <= 0) return "0";
    const u = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / Math.pow(1024, i);
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
  },
  count(n) {
    n = Number(n || 0);
    return n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString("en-NZ");
  },
  dayShort(iso) {
    const d = new Date(iso + "T00:00:00Z");
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  },
  dayNum(iso) { return String(Number(iso.slice(8, 10))); },
  dayFull(iso) {
    const d = new Date(iso + "T00:00:00Z");
    const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
    return `${fmt.dayShort(iso)} ${Number(iso.slice(8, 10))} ${mon}`;
  },
};

// ---------------------------------------------------------------------------
// Weeks
//
// A week here is Monday to Sunday, resolved by the DATABASE clock, exactly as
// bin/kidnet-report resolves it. That matters: the /week page and the CLI
// digest must never disagree about which days they are talking about.
// ---------------------------------------------------------------------------

// ref: null | "last" | "YYYY-MM-DD". Anything else is treated as "this week".
export async function weekBounds(q, ref) {
  const shift = ref === "last" ? 7 : 0;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(ref || "")) ? String(ref) : null;
  const [r] = await q(
    `WITH ref AS (SELECT COALESCE($1::date, CURRENT_DATE) - make_interval(days => $2::int) AS d)
     SELECT (date_trunc('week', ref.d))::date::text AS w0,
            (date_trunc('week', ref.d) + interval '7 days')::date::text AS w1,
            (date_trunc('week', CURRENT_DATE))::date::text AS cur,
            CURRENT_DATE::text AS today
     FROM ref`,
    [day, shift]);
  const current = r.w0 === r.cur;
  // Days of the week that have actually happened, so "on track" can mean
  // something on a Wednesday instead of pretending the week is over.
  const elapsed = current
    ? Math.min(7, Math.round((Date.parse(r.today + "T00:00:00Z") - Date.parse(r.w0 + "T00:00:00Z")) / 86400000) + 1)
    : 7;
  return { start: r.w0, end: r.w1, current, elapsed, today: r.today };
}

// The eight goal metrics, in minutes, over one week. Every one of these is a
// figure the dashboard already shows somewhere else.
export const GOAL_METRICS = {
  online: { label: "Time online", key: "other", unit: "min", about: "everything the daily ledger counted" },
  metered: { label: "Metered habits", key: "video", unit: "min", about: "gaming, video and social together" },
  gaming: { label: "Gaming", key: "gaming", unit: "min", about: "the meter's gaming minutes" },
  video: { label: "Video", key: "video", unit: "min", about: "the meter's video minutes" },
  social: { label: "Social", key: "social", unit: "min", about: "the meter's social minutes" },
  earned: { label: "Earned by learning", key: "earned", unit: "min", about: "quizzes plus approved chores" },
  quiz: { label: "Quiz minutes", key: "earned", unit: "min", about: "minutes from quizzes on the portal" },
  chore: { label: "Chore minutes", key: "earned", unit: "min", about: "minutes from chores a parent approved" },
};

// Per-child totals for one week, on exactly the eight goal metrics.
export async function weekTotals(q, w0, w1, notes = []) {
  const [ledger, cats, earn] = await Promise.all([
    safe(q, `SELECT child_id, COALESCE(SUM(used_min),0) AS online
             FROM time_ledger WHERE day >= $1::date AND day < $2::date GROUP BY 1`,
      [w0, w1], [], notes, "week ledger"),
    safe(q, `SELECT child_id, category, COALESCE(SUM(used_min),0) AS m
             FROM category_usage WHERE day >= $1::date AND day < $2::date GROUP BY 1,2`,
      [w0, w1], [], notes, "week category usage"),
    safe(q, `SELECT child_id,
               COALESCE(SUM(minutes) FILTER (WHERE reason LIKE 'quiz:%'),0) AS quiz,
               COALESCE(SUM(minutes) FILTER (WHERE reason LIKE 'task:%'),0) AS chore,
               COALESCE(SUM(minutes),0) AS earned
             FROM time_events
             WHERE kind='earn' AND ts >= $1::date AND ts < $2::date GROUP BY 1`,
      [w0, w1], [], notes, "week earn events"),
  ]);
  const out = new Map();
  const row = id => {
    if (!out.has(id)) out.set(id, { online: 0, metered: 0, gaming: 0, video: 0, social: 0, earned: 0, quiz: 0, chore: 0 });
    return out.get(id);
  };
  for (const r of ledger) row(r.child_id).online = num(r.online);
  for (const r of cats) {
    const t = row(r.child_id);
    if (r.category in t) t[r.category] = num(r.m);
    if (METERED.includes(r.category)) t.metered += num(r.m);
  }
  for (const r of earn) {
    const t = row(r.child_id);
    t.quiz = num(r.quiz); t.chore = num(r.chore); t.earned = num(r.earned);
  }
  return out;
}

// Where a child stands against one goal. Pace-aware, so mid-week it says "on
// track" rather than "behind" for a target nobody could have reached yet.
export function goalProgress(goal, totals, elapsed = 7) {
  const metric = GOAL_METRICS[goal.metric] || { label: goal.metric, key: "other" };
  const used = num(totals?.[goal.metric]);
  const target = num(goal.target_min);
  const pace = target * (Math.max(1, Math.min(7, elapsed)) / 7);
  const pct = target > 0 ? (used / target) * 100 : 0;
  let state, headline;
  if (goal.direction === "at_least") {
    if (used >= target) { state = "met"; headline = "Reached it"; }
    else if (used >= pace) { state = "ok"; headline = "On track"; }
    else { state = "behind"; headline = `${fmt.min(target - used)} to go`; }
  } else {
    if (used > target) { state = "over"; headline = `${fmt.min(used - target)} over`; }
    else if (used >= pace && elapsed < 7) { state = "near"; headline = "Ahead of pace"; }
    else if (pct >= 80) { state = "near"; headline = `${fmt.min(target - used)} left`; }
    else { state = "ok"; headline = `${fmt.min(target - used)} left`; }
  }
  return { ...goal, metric, used, target, pct, state, headline, elapsed };
}

// ---------------------------------------------------------------------------
// The weekly digest: docs/reporting.md, rendered as a page.
//
// Same week boundaries and the same source tables as bin/kidnet-report, so the
// page and the CLI never tell a parent two different stories.
// ---------------------------------------------------------------------------
export async function digest(q, ref = null) {
  const notes = [];
  const w = await weekBounds(q, ref);
  const P = [w.start, w.end];

  const [
    children, ledger, catUsage, earnAgg, quizTopics, chores, alerts, flagged,
    svcMeta, svcLookups, svcBytes, topDomains, blocked, unattributed, goalRows, totals,
  ] = await Promise.all([
    q("SELECT id,name,age,policy_tier FROM children WHERE kind='child' ORDER BY age"),

    safe(q, `SELECT child_id, day::text AS day, used_min, budget_min, bonus_min
             FROM time_ledger WHERE day >= $1::date AND day < $2::date ORDER BY day`,
      P, [], notes, "time ledger"),

    safe(q, `SELECT child_id, day::text AS day, category, used_min
             FROM category_usage WHERE day >= $1::date AND day < $2::date`,
      P, [], notes, "category usage"),

    safe(q, `SELECT child_id,
               COUNT(*) FILTER (WHERE reason LIKE 'quiz:%') AS quiz_n,
               COALESCE(SUM(minutes) FILTER (WHERE reason LIKE 'quiz:%'),0) AS quiz_min,
               COUNT(*) FILTER (WHERE reason LIKE 'task:%') AS task_n,
               COALESCE(SUM(minutes) FILTER (WHERE reason LIKE 'task:%'),0) AS task_min,
               COALESCE(SUM(minutes),0) AS earn_min
             FROM time_events WHERE kind='earn' AND ts >= $1::date AND ts < $2::date
             GROUP BY 1`,
      P, [], notes, "earn events"),

    safe(q, `SELECT child_id, substr(reason,6) AS topic, COUNT(*) AS n,
                    COALESCE(SUM(minutes),0) AS minutes, MAX(ts) AS last_ts
             FROM time_events
             WHERE kind='earn' AND reason LIKE 'quiz:%' AND ts >= $1::date AND ts < $2::date
             GROUP BY 1,2 ORDER BY 3 DESC`,
      P, [], notes, "quiz topics"),

    safe(q, `SELECT ec.child_id, t.name AS task, t.minutes, ec.decided_ts
             FROM earn_claims ec JOIN tasks t ON t.id = ec.task_id
             WHERE ec.status='approved' AND ec.decided_ts >= $1::date AND ec.decided_ts < $2::date
             ORDER BY ec.decided_ts`,
      P, [], notes, "approved chores"),

    safe(q, `SELECT id, ts, child_id, severity, category, domain, detail, acknowledged
             FROM alerts WHERE ts >= $1::date AND ts < $2::date ORDER BY ts DESC`,
      P, [], notes, "alerts"),

    // The watch list, matched against the week's lookups. Same rule as the CLI
    // digest: a suffix match, reported as a conversation prompt.
    safe(q, `WITH ${IPMAP}, ${WDNS},
             hit AS (
               SELECT DISTINCT ON (d.id) d.id, d.child_id, d.ts, d.domain,
                      f.category, f.severity, f.note
               FROM wdns d JOIN flag_domains f ON d.domain ILIKE '%' || f.pattern
               ORDER BY d.id, length(f.pattern) DESC
             )
             SELECT child_id, category, severity, note, domain,
                    COUNT(*) AS n, MAX(ts) AS last_ts
             FROM hit GROUP BY 1,2,3,4,5 ORDER BY 6 DESC LIMIT 40`,
      P, [], notes, "flag matches"),

    safe(q, "SELECT id,name,label,category,emoji,metered FROM services ORDER BY id",
      [], null, notes, "services table"),

    safe(q, `WITH ${IPMAP}, ${WDNS},
             hit AS (
               SELECT DISTINCT ON (d.id) d.id, d.child_id, sd.service_id
               FROM wdns d
               JOIN service_domains sd ON d.domain = sd.domain OR d.domain LIKE '%.' || sd.domain
               ORDER BY d.id, length(sd.domain) DESC
             )
             SELECT child_id, service_id, COUNT(*) AS lookups FROM hit GROUP BY 1,2`,
      P, [], notes, "service lookups"),

    safe(q, `SELECT child_id, service_id, COALESCE(SUM(bytes),0) AS bytes,
                    COALESCE(SUM(used_min),0) AS used_min
             FROM service_usage WHERE day >= $1::date AND day < $2::date GROUP BY 1,2`,
      P, [], notes, "service usage"),

    safe(q, `WITH ${IPMAP}, ${WDNS}
             SELECT child_id, domain, COUNT(*) AS n FROM wdns
             WHERE action='allowed' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 400`,
      P, [], notes, "top domains"),

    safe(q, `WITH ${IPMAP}, ${WDNS}
             SELECT child_id, COUNT(*) AS n FROM wdns WHERE action='blocked' GROUP BY 1`,
      P, [], notes, "blocked lookups"),

    safe(q, `WITH ${IPMAP}, ${WDNS}
             SELECT COUNT(*) FILTER (WHERE child_id IS NULL) AS unowned, COUNT(*) AS total FROM wdns`,
      P, [{ unowned: 0, total: 0 }], notes, "attribution"),

    safe(q, "SELECT id, child_id, metric, direction, target_min, note FROM goals WHERE active ORDER BY id",
      [], [], notes, "goals (run config/db/schema-goals.sql)"),

    weekTotals(q, w.start, w.end, notes),
  ]);

  let services = svcMeta;
  let usingFallbackServices = false;
  if (!services || !services.length) {
    usingFallbackServices = true;
    services = FALLBACK_SERVICES.map(([name, label, category, emoji, metered], i) =>
      ({ id: -(i + 1), name, label, category, emoji, metered }));
    notes.push("service table unavailable, using the built-in domain map");
  }
  const svcById = new Map(services.map(s => [Number(s.id), s]));
  const lookups = usingFallbackServices ? fallbackServiceRows(topDomains) : svcLookups;

  const dayList = [];
  for (let i = 0; i < 7; i++) {
    dayList.push(new Date(Date.parse(w.start + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));
  }

  const byChild = new Map(children.map(c => [c.id, {
    days: dayList.map(d => ({ day: d, online: 0, gaming: 0, video: 0, social: 0, metered: 0, other: 0 })),
    dayIndex: new Map(dayList.map((d, i) => [d, i])),
    services: new Map(), topDomains: [], quizTopics: [], chores: [], alerts: [], flags: [], goals: [],
  }]));
  const dayRow = (id, day) => {
    const b = byChild.get(id); if (!b) return null;
    const i = b.dayIndex.get(isoDay(day)); return i === undefined ? null : b.days[i];
  };
  for (const r of ledger) { const d = dayRow(r.child_id, r.day); if (d) d.online = num(r.used_min); }
  for (const r of catUsage) { const d = dayRow(r.child_id, r.day); if (d && r.category in d) d[r.category] = num(r.used_min); }
  for (const r of quizTopics) { const b = byChild.get(r.child_id); if (b) b.quizTopics.push({ topic: r.topic, n: num(r.n), minutes: num(r.minutes) }); }
  for (const r of chores) { const b = byChild.get(r.child_id); if (b) b.chores.push({ task: r.task, minutes: num(r.minutes), ts: r.decided_ts }); }
  for (const r of alerts) { const b = byChild.get(r.child_id); if (b) b.alerts.push(r); }
  for (const r of flagged) { const b = byChild.get(r.child_id); if (b) b.flags.push({ ...r, n: num(r.n) }); }
  for (const r of topDomains) { const b = byChild.get(r.child_id); if (b && b.topDomains.length < 10) b.topDomains.push({ domain: r.domain, n: num(r.n) }); }
  for (const r of lookups) {
    const b = byChild.get(r.child_id); if (!b) continue;
    const s = svcById.get(Number(r.service_id)); if (!s) continue;
    const cur = b.services.get(s.name) || { service: s, lookups: 0, bytes: 0, minutes: 0 };
    cur.lookups += num(r.lookups); b.services.set(s.name, cur);
  }
  for (const r of svcBytes) {
    const b = byChild.get(r.child_id); if (!b) continue;
    const s = svcById.get(Number(r.service_id)); if (!s) continue;
    const cur = b.services.get(s.name) || { service: s, lookups: 0, bytes: 0, minutes: 0 };
    cur.bytes += num(r.bytes); cur.minutes += num(r.used_min); b.services.set(s.name, cur);
  }
  for (const g of goalRows) { const b = byChild.get(g.child_id); if (b) b.goals.push(g); }

  const blockedBy = new Map(blocked.map(r => [r.child_id, num(r.n)]));
  const earnBy = new Map(earnAgg.map(r => [r.child_id, r]));

  const kids = children.map(c => {
    const b = byChild.get(c.id);
    for (const d of b.days) {
      d.metered = d.gaming + d.video + d.social;
      d.other = Math.max(0, d.online - d.metered);
    }
    const t = totals.get(c.id) || { online: 0, metered: 0, gaming: 0, video: 0, social: 0, earned: 0, quiz: 0, chore: 0 };
    const e = earnBy.get(c.id) || {};
    const active = b.days.filter(d => d.online > 0).length;
    const busiest = b.days.reduce((a, d) => (d.online > (a?.online || 0) ? d : a), null);
    return {
      ...c,
      days: b.days,
      totals: t,
      daysActive: active,
      busiest: busiest && busiest.online > 0 ? busiest : null,
      quizCount: num(e.quiz_n), quizMin: num(e.quiz_min),
      taskCount: num(e.task_n), taskMin: num(e.task_min),
      quizTopics: b.quizTopics,
      chores: b.chores,
      alerts: b.alerts,
      flags: b.flags,
      blocked: blockedBy.get(c.id) || 0,
      topDomains: b.topDomains,
      serviceList: [...b.services.values()].sort((x, y) => (y.minutes - x.minutes) || (y.lookups - x.lookups) || (y.bytes - x.bytes)),
      goals: b.goals.map(g => goalProgress(g, t, w.elapsed)),
    };
  });

  const att = unattributed[0] || { unowned: 0, total: 0 };
  return {
    week: w, dayList, kids, notes,
    measurement: {
      dnsRows: num(att.total), dnsUnattributed: num(att.unowned),
      hasMeter: catUsage.length > 0, hasServiceBytes: svcBytes.length > 0,
      usingFallbackServices,
    },
  };
}

// ---------------------------------------------------------------------------
// One child, everything in one place. Built on top of analytics() so the kid
// page and the trends page can never drift apart, plus the pieces that only
// make sense for a single child.
// ---------------------------------------------------------------------------
export async function kidDetail(q, name, days = 7) {
  const [child] = await q("SELECT id,name,age,policy_tier,kind FROM children WHERE lower(name)=lower($1)", [String(name)]);
  if (!child) return null;
  const notes = [];
  const a = await analytics(q, days);
  const kid = a.kids.find(k => k.id === child.id) || null;
  const w = await weekBounds(q, null);

  const [devices, quizHistory, flags, recentAlerts, goalRows, blocks, totals] = await Promise.all([
    safe(q, `SELECT label, hostname, mac, ip, device_kind, category, vendor,
                    (last_seen > now()-interval '5 minutes') AS online, last_seen
             FROM device_roster WHERE person_id = $1 ORDER BY label`,
      [child.id], [], notes, "devices"),

    safe(q, `SELECT ts, minutes, substr(reason,6) AS topic
             FROM time_events
             WHERE child_id=$1 AND kind='earn' AND reason LIKE 'quiz:%'
             ORDER BY ts DESC LIMIT 25`,
      [child.id], [], notes, "quiz history"),

    safe(q, `WITH ${IPMAP}, ${DNS},
             hit AS (
               SELECT DISTINCT ON (d.id) d.id, d.ts, d.domain, f.category, f.severity, f.note
               FROM dns d JOIN flag_domains f ON d.domain ILIKE '%' || f.pattern
               WHERE d.child_id = $2
               ORDER BY d.id, length(f.pattern) DESC
             )
             SELECT category, severity, note, domain, COUNT(*) AS n, MAX(ts) AS last_ts
             FROM hit GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 20`,
      [Math.max(1, Math.min(90, Number(days) || 7)), child.id], [], notes, "flag matches"),

    safe(q, `SELECT id, ts, severity, category, domain, detail, acknowledged
             FROM alerts WHERE child_id=$1 ORDER BY ts DESC LIMIT 20`,
      [child.id], [], notes, "alerts"),

    safe(q, "SELECT id, child_id, metric, direction, target_min, note FROM goals WHERE child_id=$1 AND active ORDER BY id",
      [child.id], [], notes, "goals (run config/db/schema-goals.sql)"),

    safe(q, `SELECT ts, action, source, actor FROM block_events
             WHERE target_ref = $1 ORDER BY ts DESC LIMIT 8`,
      [child.name], [], notes, "recent actions"),

    weekTotals(q, w.start, w.end, notes),
  ]);

  const wt = totals.get(child.id) || { online: 0, metered: 0, gaming: 0, video: 0, social: 0, earned: 0, quiz: 0, chore: 0 };
  return {
    child, kid, window: a.window, week: w, weekTotals: wt,
    devices, quizHistory, flags, alerts: recentAlerts, blocks,
    goals: goalRows.map(g => goalProgress(g, wt, w.elapsed)),
    notes: [...a.notes, ...notes],
    measurement: a.measurement,
  };
}
