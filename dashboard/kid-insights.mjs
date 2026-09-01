// Genkan dashboard: the child page's insights, computed in the house.
//
// One child, today and the last seven days against the seven before, turned
// into an honest picture: minutes from the meter, learning from the quiz and
// chore tables, lookups from the DNS log labelled as lookups, what was blocked,
// whether bedtime ran, and which device is used for what. From those numbers
// a RULE-BASED list of what changed and a short list of suggested rewards,
// each with its reason and the exact effect of the button next to it.
//
// No AI is involved in any of that. Nothing in this file makes an outbound
// request except aiWrite(), which is reached only by a parent pressing a
// button on a card that ships switched off, and which sends the compact brief
// this file builds (aiBrief) and nothing else. PRIVACY-CHARTER.md P1 names
// that request. The full reasoning is in DECISIONS.md ("The child page").
//
// HONESTY RULES, inherited from analytics.mjs and binding here too:
//   * A lookup is a lookup: a proxy for activity, never minutes, never bytes.
//   * Minutes come from the meter (category_usage) or the ledger. If the meter
//     has no rows for a day the page says "no minutes recorded", not "0".
//   * "Learning minutes" are minutes EARNED by learning (quizzes, chores). The
//     gateway cannot see how long a child spent reading, and says so.
//   * A lookup during bedtime hours is a device asking for a name. Background
//     apps do that all night on a phone by the bed, so it is a talking point,
//     not a verdict.
//   * Every write goes through the same tools the CLI uses: bonus, grant and
//     the bedtime extension. Nothing here invents a new way to change a block.
import { esc, columns, legend, ranked, table } from "./charts.mjs";
import { fmt, METERED } from "./analytics.mjs";

// ---------------------------------------------------------------------------
// Kinds. The category map in category_domains is finer than a parent wants on
// this page, so it is folded into a handful of kinds a sentence can carry.
// ---------------------------------------------------------------------------
const KIND_OF = {
  gaming: "gaming", video: "video", streaming: "video", social: "social",
  schoolwork: "learning", education: "learning", learn: "learning",
  messaging: "messaging", audio: "audio", download: "other",
  ads: "ads", tracking: "ads",
  "proxy-vpn": "risky", tor: "risky", adult: "risky", gambling: "risky", drugs: "risky", weapons: "risky",
};
const KINDS = ["learning", "gaming", "video", "social", "messaging", "audio", "risky", "ads", "other"];
const KIND_LABEL = {
  learning: "Learning", gaming: "Gaming", video: "Video", social: "Social", messaging: "Messaging",
  audio: "Music", risky: "Risky", ads: "Ads and trackers", other: "Everything else",
};
// Chart colours: the four categorical slots analytics.mjs validated, with
// learning on the "earned" slot (it is the thing being earned) and the rest in
// the de-emphasis grey. The charts that use these always ship a legend and a
// table, the same relief rule as the Trends page.
const KIND_SERIES = { learning: "earned", gaming: "gaming", video: "video", social: "social", other: "other" };
const kindOf = c => KIND_OF[c] || (c ? "other" : "other");
const num = v => (v === null || v === undefined ? 0 : Number(v));
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
const blankKinds = () => Object.fromEntries(KINDS.map(k => [k, 0]));

async function safe(q, sql, params, fallback, notes, what) {
  try { return await q(sql, params); } catch (e) { notes.push(`${what}: ${e.message}`); return fallback; }
}

// Every lookup made by one child's devices in the window. A row is the
// child's if the log stamped their device, or the client address is one of
// their reserved addresses, or a current lease for one of their MACs. Each
// row is folded to a kind by the longest matching category_domains suffix,
// with the reading list (always_allow scope='learn') counted as learning.
const DNS = `
  mine AS (
    SELECT d.id, d.reserved_ip AS ip, d.mac FROM devices d WHERE d.child_id = $1
  ),
  dns AS (
    SELECT l.ts, l.domain, l.action,
           COALESCE(m1.id, m2.id, m3.id) AS device_id,
           COALESCE(
             (SELECT 'learn' FROM always_allow aa WHERE aa.scope = 'learn'
                AND (l.domain = aa.domain OR l.domain LIKE '%.' || aa.domain) LIMIT 1),
             (SELECT cd.category FROM category_domains cd
               WHERE l.domain = cd.domain OR l.domain LIKE '%.' || cd.domain
               ORDER BY length(cd.domain) DESC LIMIT 1),
             l.category) AS category
    FROM dns_log l
    LEFT JOIN mine m1 ON m1.id = l.device_id
    LEFT JOIN mine m2 ON m2.ip = l.client_ip
    LEFT JOIN dhcp_leases dl ON dl.ip = l.client_ip AND dl.active
    LEFT JOIN mine m3 ON m3.mac = dl.mac
    WHERE l.ts >= $2::date - 13
      AND (m1.id IS NOT NULL OR m2.id IS NOT NULL OR m3.id IS NOT NULL)
  )`;

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------
export async function kidInsights(q, child, { asOf = null } = {}) {
  const notes = [];
  const cid = child.id;
  // The reference day. The page asks for today; the nightly worker asks for
  // yesterday, so a finished day's brief is built from that day's rows and
  // never from a later one.
  const [clock] = await q(`SELECT COALESCE($1::date, CURRENT_DATE)::text AS today,
                                  (COALESCE($1::date, CURRENT_DATE) = CURRENT_DATE) AS is_today,
                                  extract(hour from now())::int AS hour, to_char(now(), 'HH24:MI') AS hm`,
    [asOf ? String(asOf).slice(0, 10) : null]);
  const today = clock.today;
  const ref = today;
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(new Date(today + "T00:00:00Z").getTime() - i * 86400000).toISOString().slice(0, 10);
    days.push({
      day: d, dow: new Date(d + "T00:00:00Z").getUTCDay(),
      online: null, gaming: 0, video: 0, social: 0, metered: 0, meterRows: 0,
      quizMin: 0, choreMin: 0, grantMin: 0, penaltyMin: 0, rounds: 0, passed: 0, studyVisits: 0,
      lookups: blankKinds(), blocked: blankKinds(), lookupsTotal: 0, blockedTotal: 0,
    });
  }
  const byDay = new Map(days.map(d => [d.day, d]));
  const dayRow = d => byDay.get(String(d).slice(0, 10)) || null;

  const [
    catUsage, ledger, events, rounds, study, badges, badgeCount, eff, budgets, devices,
    perDay, perDevice, perHour, late, bedtimeLookups, topDomains, schedules, blocks, extensions,
    next, summaries, settings,
  ] = await Promise.all([
    safe(q, `SELECT day::text AS day, category, used_min FROM category_usage
             WHERE child_id=$1 AND day > $2::date - 14`, [cid, ref], [], notes, "category usage"),
    safe(q, `SELECT day::text AS day, used_min, budget_min, bonus_min FROM time_ledger
             WHERE child_id=$1 AND day > $2::date - 14`, [cid, ref], [], notes, "time ledger"),
    safe(q, `SELECT ts::date::text AS day, kind, reason, minutes FROM time_events
             WHERE child_id=$1 AND ts >= $2::date - 13`, [cid, ref], [], notes, "time events"),
    safe(q, `SELECT ts::date::text AS day, bank_id, passed, minutes, correct, asked FROM quiz_rounds
             WHERE child_id=$1 AND ts >= $2::date - 13`, [cid, ref], [], notes, "quiz rounds"),
    safe(q, `SELECT ts::date::text AS day, count(*)::int AS n FROM quiz_study_visits
             WHERE child_id=$1 AND ts >= $2::date - 13 GROUP BY 1`, [cid, ref], [], notes, "study visits"),
    safe(q, `SELECT badge_id, scope, ts, meta FROM child_badges
             WHERE child_id=$1 AND ts >= $2::date - 13 ORDER BY ts DESC`, [cid, ref], [], notes, "badges"),
    safe(q, `SELECT count(*)::int AS n FROM child_badges WHERE child_id=$1`, [cid], [{ n: 0 }], notes, "badge count"),
    safe(q, `SELECT quiz_daily_cap_min, mastery_bonus_min, default_minutes_per_pass
             FROM earn_settings_effective WHERE child_id=$1`, [cid],
      [{ quiz_daily_cap_min: 30, mastery_bonus_min: 5, default_minutes_per_pass: 10 }], notes, "earn settings"),
    safe(q, `SELECT category, daily_min FROM category_budgets WHERE child_id=$1`, [cid], [], notes, "budgets"),
    safe(q, `SELECT id, label, COALESCE(kind,'other') AS kind FROM devices WHERE child_id=$1 ORDER BY label`,
      [cid], [], notes, "devices"),

    safe(q, `WITH ${DNS}
             SELECT ts::date::text AS day, category, action, count(*)::int AS n
             FROM dns GROUP BY 1,2,3`, [cid, ref], [], notes, "lookups per day"),
    safe(q, `WITH ${DNS}
             SELECT device_id, category, count(*)::int AS n
             FROM dns WHERE ts >= $2::date - 6 AND action = 'allowed' GROUP BY 1,2`,
      [cid, ref], [], notes, "lookups per device"),
    safe(q, `WITH ${DNS}
             SELECT extract(hour from ts)::int AS h, category, count(*)::int AS n
             FROM dns WHERE ts::date = $2::date AND action = 'allowed' GROUP BY 1,2`,
      [cid, ref], [], notes, "lookups per hour"),
    // After nine at night, or before five in the morning: the late hours a
    // parent means when they say "late". Per device, because the phone by the
    // bed and the laptop on the desk tell different stories.
    safe(q, `WITH ${DNS}
             SELECT (CASE WHEN ts >= $2::date - 6 THEN 'week' ELSE 'prev' END) AS win,
                    device_id, category, count(*)::int AS n
             FROM dns WHERE action = 'allowed'
               AND (extract(hour from ts) >= 21 OR extract(hour from ts) < 5)
             GROUP BY 1,2,3`, [cid, ref], [], notes, "late lookups"),
    // Lookups inside this child's own bedtime windows, by night. A window that
    // crosses midnight belongs to the night it started on, which is what the
    // schedules table means by `days`.
    safe(q, `WITH ${DNS},
             w AS (
               SELECT d.ts, d.device_id, d.category,
                      (extract(hour from d.ts) * 60 + extract(minute from d.ts))::int AS mod
               FROM dns d WHERE d.action = 'allowed'
             )
             SELECT (CASE WHEN s.start_min > s.end_min AND w.mod < s.end_min
                          THEN (w.ts - interval '1 day')::date ELSE w.ts::date END)::text AS night,
                    w.device_id, count(*)::int AS n
             FROM w JOIN schedules s ON s.child_id = $1 AND s.enabled AND s.action = 'block'
             WHERE ((s.start_min > s.end_min AND (w.mod >= s.start_min OR w.mod < s.end_min))
                 OR (s.start_min < s.end_min AND w.mod >= s.start_min AND w.mod < s.end_min))
               AND (CASE WHEN s.start_min > s.end_min AND w.mod < s.end_min
                         THEN extract(dow from w.ts - interval '1 day') ELSE extract(dow from w.ts) END)::int = ANY (s.days)
             GROUP BY 1,2`, [cid, ref], [], notes, "bedtime lookups"),
    safe(q, `WITH ${DNS}
             SELECT category, domain, count(*)::int AS n
             FROM dns WHERE ts >= $2::date - 6 AND action = 'allowed'
             GROUP BY 1,2 ORDER BY 3 DESC LIMIT 300`, [cid, ref], [], notes, "top domains"),

    // since: a bedtime set on Tuesday cannot have "run" on Monday, so the
    // nights counted start on the day the row was last written.
    safe(q, `SELECT id, name, days, start_min, end_min, COALESCE(updated_ts, now())::date::text AS since
             FROM schedules WHERE child_id=$1 AND enabled AND action='block'`, [cid], [], notes, "schedules"),
    // The CLI writes the child's name; the bedtime worker writes name:category.
    safe(q, `SELECT ts, action, source, reason FROM block_events
             WHERE (target_ref = $1 OR target_ref LIKE $1 || ':%') AND ts >= $2::date - 13 ORDER BY ts`,
      [child.name, ref], [], notes, "block events"),
    safe(q, `SELECT until_ts, minutes FROM schedule_extensions
             WHERE child_id=$1 AND until_ts >= $2::date - 13`, [cid, ref], [], notes, "extensions"),
    safe(q, `SELECT starts_at, ends_at, in_window FROM schedule_next WHERE child_id=$1`, [cid], [], notes, "next bedtime"),
    // The stored summaries: the last seven days' worth and this and last
    // week's, newest first. Read, never re-requested, on a page view.
    safe(q, `SELECT period, day::text AS day, complete, summary, model, tokens_in, tokens_out, created, created_by, brief
             FROM kid_summaries
             WHERE child_id=$1 AND ((period='day' AND day >= $2::date - 7) OR (period='week' AND day >= $2::date - 13))
             ORDER BY day DESC, created DESC`, [cid, ref], [], notes, "summaries (run config/db/schema-summaries.sql)"),
    safe(q, `SELECT enabled, model FROM ai_summary_settings`, [], [{ enabled: false, model: DEFAULT_MODEL }],
      notes, "summary settings (run config/db/schema-summaries.sql)"),
  ]);

  // ---- fold everything by day -----------------------------------------------
  for (const r of catUsage) {
    const d = dayRow(r.day); if (!d) continue;
    d.meterRows++;
    if (r.category in d && METERED.includes(r.category)) d[r.category] = num(r.used_min);
  }
  for (const r of ledger) { const d = dayRow(r.day); if (d) d.online = num(r.used_min); }
  for (const r of events) {
    const d = dayRow(r.day); if (!d) continue;
    const reason = r.reason || "";
    if (r.kind === "earn" && reason.startsWith("quiz:")) d.quizMin += num(r.minutes);
    else if (r.kind === "earn" && reason.startsWith("task:")) d.choreMin += num(r.minutes);
    else if (r.kind === "grant") d.grantMin += num(r.minutes);
    else if (r.kind === "penalty") d.penaltyMin += -num(r.minutes);
  }
  for (const r of rounds) { const d = dayRow(r.day); if (!d) continue; d.rounds++; if (r.passed) d.passed++; }
  for (const r of study) { const d = dayRow(r.day); if (d) d.studyVisits = num(r.n); }
  for (const r of perDay) {
    const d = dayRow(r.day); if (!d) continue;
    const k = kindOf(r.category);
    if (r.action === "blocked") { d.blocked[k] += num(r.n); d.blockedTotal += num(r.n); }
    else { d.lookups[k] += num(r.n); d.lookupsTotal += num(r.n); }
  }
  for (const d of days) d.metered = d.gaming + d.video + d.social;

  const sumWin = list => {
    const s = {
      days: list.length, online: 0, onlineDays: 0, gaming: 0, video: 0, social: 0, metered: 0, meterDays: 0,
      quizMin: 0, choreMin: 0, grantMin: 0, penaltyMin: 0, rounds: 0, passed: 0, studyVisits: 0,
      lookups: blankKinds(), blocked: blankKinds(), lookupsTotal: 0, blockedTotal: 0,
    };
    for (const d of list) {
      if (d.online !== null) { s.online += d.online; s.onlineDays++; }
      if (d.meterRows) s.meterDays++;
      for (const k of ["gaming", "video", "social", "metered", "quizMin", "choreMin", "grantMin", "penaltyMin",
        "rounds", "passed", "studyVisits", "lookupsTotal", "blockedTotal"]) s[k] += d[k];
      for (const k of KINDS) { s.lookups[k] += d.lookups[k]; s.blocked[k] += d.blocked[k]; }
    }
    s.earned = s.quizMin + s.choreMin;
    return s;
  };
  const week = sumWin(days.slice(7));
  const prev = sumWin(days.slice(0, 7));
  const todayRow = days[13];
  const hasMeter = week.meterDays > 0 || prev.meterDays > 0;

  // ---- devices: what each one is used for -----------------------------------
  const devById = new Map(devices.map(d => [d.id, {
    id: d.id, label: d.label || "(unnamed)", kind: d.kind, lookups: blankKinds(), total: 0,
    late: blankKinds(), lateTotal: 0, latePrev: 0, bedtime: 0,
  }]));
  for (const r of perDevice) {
    const dv = devById.get(r.device_id); if (!dv) continue;
    dv.lookups[kindOf(r.category)] += num(r.n); dv.total += num(r.n);
  }
  let lateWeek = blankKinds(), latePrev = blankKinds(), lateWeekTotal = 0, latePrevTotal = 0;
  for (const r of late) {
    const k = kindOf(r.category), n = num(r.n);
    const dv = devById.get(r.device_id);
    if (r.win === "week") {
      lateWeek[k] += n; lateWeekTotal += n;
      if (dv) { dv.late[k] += n; dv.lateTotal += n; }
    } else { latePrev[k] += n; latePrevTotal += n; if (dv) dv.latePrev += n; }
  }
  const deviceList = [...devById.values()].map(dv => {
    const ranked = KINDS.filter(k => k !== "ads").map(k => [k, dv.lookups[k]]).sort((a, b) => b[1] - a[1]);
    const top = ranked[0] && ranked[0][1] > 0 ? ranked[0][0] : null;
    const share = top && dv.total ? Math.round((dv.lookups[top] / dv.total) * 100) : 0;
    const learningShare = dv.total ? Math.round((dv.lookups.learning / dv.total) * 100) : 0;
    return { ...dv, top, share, learningShare };
  }).sort((a, b) => b.total - a.total);

  // ---- bedtime: did it run, was it lifted, was the phone awake -------------
  // A night counts once its window has started: tonight's bedtime is not
  // "missed" at four in the afternoon.
  const nowMin = Number(String(clock.hm).slice(0, 2)) * 60 + Number(String(clock.hm).slice(3, 5));
  const nightsOf = list => list.filter(d => schedules.some(s => (s.days || []).includes(d.dow)
    && d.day >= (s.since || "") && (d.day < today || (d.day === today && clock.is_today && nowMin >= s.start_min) || (d.day === today && !clock.is_today))));
  // Which night a block event belongs to. A window that crosses midnight
  // starts on one date and lifts on the next, and the worker may assert it
  // at one in the morning after a restart: an event in the small hours
  // belongs to the night before, not to the day it lands on.
  const nightOf = ts => {
    const day = localDay(ts), mod = localMin(ts);
    for (const s of schedules) {
      if (s.start_min > s.end_min && mod < s.end_min) return prevDay(day);
    }
    return day;
  };
  const bedtimeFor = list => {
    const nights = nightsOf(list);
    let ran = 0, lifted = 0;
    for (const n of nights) {
      const evs = blocks.filter(b => nightOf(b.ts) === n.day);
      const off = evs.find(b => b.source === "schedule" && b.action === "off");
      if (off) ran++;
      if (off && evs.some(b => b.action === "on" && b.source !== "schedule" && new Date(b.ts) > new Date(off.ts))) lifted++;
    }
    return { scheduled: nights.length, ran, lifted };
  };
  const bedLookByNight = new Map();
  for (const r of bedtimeLookups) {
    bedLookByNight.set(r.night, (bedLookByNight.get(r.night) || 0) + num(r.n));
    const dv = devById.get(r.device_id);
    if (dv && byDay.has(r.night) && days.indexOf(byDay.get(r.night)) >= 7) dv.bedtime += num(r.n);
  }
  const bedLookups = list => list.reduce((a, d) => a + (bedLookByNight.get(d.day) || 0), 0);
  const bedtime = {
    hasSchedule: schedules.length > 0,
    week: { ...bedtimeFor(days.slice(7)), lookups: bedLookups(days.slice(7)) },
    prev: { ...bedtimeFor(days.slice(0, 7)), lookups: bedLookups(days.slice(0, 7)) },
    extensions: extensions.filter(e => localDay(e.until_ts) >= days[7].day).length,
    tonight: next[0] || null,
  };

  // ---- top domains per kind, and the flags a parent sees on the page -------
  const topByKind = {};
  for (const r of topDomains) {
    const k = kindOf(r.category);
    (topByKind[k] ||= []);
    if (topByKind[k].length < 5) topByKind[k].push({ domain: r.domain, n: num(r.n) });
  }

  // ---- hour by hour, today -------------------------------------------------
  const hours = Array.from({ length: 24 }, (_, h) => ({ h, ...blankKinds(), total: 0 }));
  for (const r of perHour) {
    const h = hours[num(r.h)]; if (!h) continue;
    h[kindOf(r.category)] += num(r.n); h.total += num(r.n);
  }

  const badgeList = badges.map(b => ({ id: b.badge_id, scope: b.scope, ts: b.ts, title: (b.meta && b.meta.bank_title) || null }));
  const budgetMap = Object.fromEntries(budgets.map(b => [b.category, num(b.daily_min)]));
  const earnRules = eff[0] || { quiz_daily_cap_min: 30, mastery_bonus_min: 5, default_minutes_per_pass: 10 };

  const base = {
    child: { id: child.id, name: child.name, age: child.age, tier: child.policy_tier },
    today, isToday: !!clock.is_today, hour: num(clock.hour), hm: clock.hm, days, week, prev, todayRow, hasMeter,
    devices: deviceList, late: { week: lateWeek, prev: latePrev, weekTotal: lateWeekTotal, prevTotal: latePrevTotal },
    bedtime, topByKind, hours, badges: badgeList, badgeTotal: num(badgeCount[0]?.n),
    budgets: budgetMap, earnRules, notes,
    summaries, ai: { enabled: !!settings[0]?.enabled, model: settings[0]?.model || "claude-haiku-4-5-20251001",
      hasCli: cliPresent(), stub: process.env.GENKAN_AI_STUB === "1" },
  };
  base.changes = findings(base);
  base.rewards = rewards(base);
  return base;
}

// The database clock is the household's clock (deploy.sh pins the container's
// timezone), and a timestamptz comes back as a JS Date in UTC. The day a
// bedtime event belongs to is the local one, so the comparison has to happen
// in local time, which is what toLocaleDateString gives us in the process's
// own TZ. The dashboard runs on the same box with the same TZ.
function localDay(ts) {
  const d = new Date(ts);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function prevDay(iso) {
  return new Date(new Date(iso + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
}
function localMin(ts) { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }

// ---------------------------------------------------------------------------
// What changed. Rules, not a model. Each finding says what it is measuring so
// a parent can check it against the tables under it. A change has to be both
// big enough in proportion and big enough in absolute terms to be worth a
// line: 2 lookups going to 4 is not "doubled".
// ---------------------------------------------------------------------------
function findings(b) {
  const out = [];
  const { week, prev, late, bedtime, devices } = b;
  const add = (tone, text, measure) => out.push({ tone, text, measure });
  const dir = (a, p, floor) => {
    if (a < floor && p < floor) return null;
    const c = pct(a, p);
    if (c === null) return a >= floor ? { kind: "new", c: null } : null;
    if (Math.abs(c) < 25) return { kind: "flat", c };
    return { kind: c > 0 ? "up" : "down", c };
  };

  // Learning: minutes earned, quizzes passed.
  const e = dir(week.earned, prev.earned, 10);
  if (e && e.kind === "up") add("good", `Earned ${fmt.min(week.earned)} by learning this week, up ${e.c}% on last week's ${fmt.min(prev.earned)}.`, "quiz and chore minutes, time_events");
  else if (e && e.kind === "new") add("good", `Earned ${fmt.min(week.earned)} by learning this week. Last week there was none.`, "quiz and chore minutes, time_events");
  else if (e && e.kind === "down") add("note", `Earned ${fmt.min(week.earned)} by learning this week, down from ${fmt.min(prev.earned)} last week.`, "quiz and chore minutes, time_events");
  if (week.passed >= 3 && week.passed > prev.passed) add("good", `${week.passed} quiz rounds passed this week (${prev.passed} last week)${week.rounds > week.passed ? `, ${week.rounds - week.passed} not passed` : ""}.`, "quiz_rounds");
  if (week.studyVisits >= 3) add("good", `Opened a study page ${week.studyVisits} times before quizzing. That is the reading the quizzes are meant to pay for.`, "quiz_study_visits");
  const ll = dir(week.lookups.learning, prev.lookups.learning, 20);
  if (ll && ll.kind === "up") add("good", `Learning sites: ${fmt.count(week.lookups.learning)} lookups, up ${ll.c}% on last week.`, "lookups to schoolwork and reading-list domains");
  else if (ll && ll.kind === "down") add("note", `Learning sites: ${fmt.count(week.lookups.learning)} lookups, down ${Math.abs(ll.c)}% on last week.`, "lookups to schoolwork and reading-list domains");

  // Habits: the meter where it has minutes, lookups where it does not.
  if (b.hasMeter) {
    for (const c of METERED) {
      const d = dir(week[c], prev[c], 30);
      if (!d || d.kind === "flat" || d.kind === "new") continue;
      add(d.kind === "down" ? "good" : "note",
        `${cap(c)}: ${fmt.min(week[c])} this week, ${d.kind} ${Math.abs(d.c)}% on last week's ${fmt.min(prev[c])}.`, "meter minutes, category_usage");
    }
  } else {
    for (const c of ["gaming", "video", "social"]) {
      const d = dir(week.lookups[c], prev.lookups[c], 40);
      if (!d || d.kind === "flat" || d.kind === "new") continue;
      add(d.kind === "down" ? "good" : "note",
        `${cap(c)}: ${fmt.count(week.lookups[c])} lookups this week, ${d.kind} ${Math.abs(d.c)}% on last week. Lookups, not minutes: the meter has no minutes for this child yet.`, "lookups, dns_log");
    }
  }

  // Late nights. Which kinds, and on which device.
  const lateSocialVideo = late.week.social + late.week.video;
  const allSocialVideo = week.lookups.social + week.lookups.video;
  if (allSocialVideo >= 40 && lateSocialVideo / allSocialVideo >= 0.3) {
    const phone = devices.find(d => ["phone", "tablet"].includes(d.kind) && d.lateTotal > 0);
    add("talk", `${Math.round((lateSocialVideo / allSocialVideo) * 100)}% of social and video lookups were after 9pm${phone ? `, mostly on the ${phone.kind}` : ""}.`, "lookups between 21:00 and 05:00");
  }
  const lt = dir(late.weekTotal, late.prevTotal, 40);
  if (lt && lt.kind === "down") add("good", `Late-night lookups down ${Math.abs(lt.c)}% on last week.`, "lookups between 21:00 and 05:00");

  // Bedtime.
  if (bedtime.hasSchedule && bedtime.week.scheduled) {
    const w = bedtime.week;
    if (w.ran === w.scheduled && w.lifted === 0) add("good", `Bedtime ran on all ${w.scheduled} scheduled night${w.scheduled === 1 ? "" : "s"} and was not lifted.`, "block_events, source schedule");
    else if (w.ran < w.scheduled) add("note", `Bedtime ran on ${w.ran} of ${w.scheduled} scheduled nights. If the worker missed one, docs/OPERATIONS.md says how to check it.`, "block_events, source schedule");
    if (w.lifted) add("note", `Bedtime was lifted by hand on ${w.lifted} night${w.lifted === 1 ? "" : "s"}.`, "block_events after the schedule's off");
    if (bedtime.extensions) add("note", `${bedtime.extensions} extension${bedtime.extensions === 1 ? "" : "s"} granted tonight-only this week.`, "schedule_extensions");
    const bl = dir(w.lookups, bedtime.prev.lookups, 30);
    if (w.lookups >= 30) {
      const awake = devices.filter(d => d.bedtime > 0).sort((x, y) => y.bedtime - x.bedtime)[0];
      add("talk", `${fmt.count(w.lookups)} lookups during bedtime hours${awake ? `, mostly from the ${awake.kind}` : ""}${bl && bl.kind === "down" ? `, down ${Math.abs(bl.c)}% on last week` : bl && bl.kind === "up" ? `, up ${bl.c}% on last week` : ""}. Background apps do this too, so it is a question, not a verdict.`, "lookups inside the bedtime windows");
    }
  }

  // Blocked and risky.
  if (week.blocked.risky === 0 && prev.blocked.risky > 0) add("good", `No blocked risky lookups this week (VPN, Tor, adult, gambling). Last week had ${prev.blocked.risky}.`, "blocked lookups, dns_log");
  else if (week.blocked.risky > 0) add("talk", `${week.blocked.risky} blocked risky lookup${week.blocked.risky === 1 ? "" : "s"} this week (VPN, Tor, adult, gambling). Usually curiosity; worth one question.`, "blocked lookups, dns_log");
  const bt = dir(week.blockedTotal - week.blocked.ads, prev.blockedTotal - prev.blocked.ads, 20);
  if (bt && bt.kind === "down") add("good", `Blocked lookups (not counting ads) down ${Math.abs(bt.c)}% on last week.`, "dns_log, action blocked");

  // Devices: what each is for.
  const named = devices.filter(d => d.total >= 50 && d.top);
  if (named.length >= 2) {
    const parts = named.slice(0, 3).map(d => `the ${d.kind} is mostly ${KIND_LABEL[d.top].toLowerCase()} (${d.share}%)`);
    add("info", `${cap(parts.join(", "))}.`, "share of each device's lookups, last 7 days");
  } else if (named.length === 1) {
    add("info", `The ${named[0].kind} is mostly ${KIND_LABEL[named[0].top].toLowerCase()} (${named[0].share}% of its lookups).`, "share of the device's lookups, last 7 days");
  }

  // Badges.
  if (b.badges.length) add("good", `${b.badges.length} badge${b.badges.length === 1 ? "" : "s"} earned in the last fortnight.`, "child_badges");

  if (!out.length) add("info", "Nothing moved enough this week to call a change. That is a perfectly good week.", "");
  return out;
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------------------
// Suggested rewards. Driven by the learn-to-earn economics the household has
// set (earn_settings_effective): a pass pays default_minutes_per_pass, so a
// bonus here is priced in passes, not plucked from the air. Each one carries
// the exact command and the exact effect, and the button does nothing until
// the parent has read both. Badges are not on this list on purpose: a badge
// is something a child earns against their own history, not something a
// parent hands out (docs/GAMIFICATION.md).
// ---------------------------------------------------------------------------
function rewards(b) {
  const out = [];
  const { week, prev, bedtime, child } = b;
  const perPass = num(b.earnRules.default_minutes_per_pass) || 10;
  const learningUp = week.earned >= 20 && (prev.earned === 0 || week.earned >= prev.earned * 1.25);
  const habitsDown = b.hasMeter
    ? (prev.metered >= 30 && week.metered <= prev.metered * 0.8)
    : (prev.lookups.social + prev.lookups.video + prev.lookups.gaming >= 60
      && (week.lookups.social + week.lookups.video + week.lookups.gaming) <= (prev.lookups.social + prev.lookups.video + prev.lookups.gaming) * 0.8);
  const noRisky = week.blocked.risky === 0 && (week.lookupsTotal >= 50);
  const bedtimeKept = bedtime.hasSchedule && bedtime.week.scheduled >= 3 && bedtime.week.ran === bedtime.week.scheduled && bedtime.week.lifted === 0;

  if (learningUp && habitsDown) {
    const min = 3 * perPass;
    out.push({
      id: "swap", title: `A bonus of ${min} minutes`,
      why: `Learning went up (${fmt.min(week.earned)} earned, ${fmt.min(prev.earned)} last week) while the time-wasting habits went down. That is the swap the whole system is for.`,
      kind: "bonus", minutes: min,
      command: `genkan bonus ${child.name} ${min} insights:learning-up-habits-down`,
      effect: `Adds ${min} minutes to today's allowance (three passes' worth at this house's rate of ${perPass} a pass), writes a time_events row you can see on Learn to earn, and reopens the internet only if ${child.name} was out of time. A bedtime or a block you set by hand is not touched.`,
    });
  } else if (learningUp) {
    const min = 2 * perPass;
    out.push({
      id: "learn", title: `A bonus of ${min} minutes`,
      why: `Earned ${fmt.min(week.earned)} by learning this week${prev.earned ? `, up from ${fmt.min(prev.earned)}` : ", from nothing last week"}.`,
      kind: "bonus", minutes: min,
      command: `genkan bonus ${child.name} ${min} insights:learning-up`,
      effect: `Adds ${min} minutes to today's allowance (two passes' worth at ${perPass} a pass) and reopens the internet only if ${child.name} was out of time. Nothing else changes.`,
    });
  }
  if (week.passed >= 5) {
    const cat = b.budgets.gaming ? "gaming" : b.budgets.video ? "video" : null;
    if (cat) {
      const min = 2 * perPass;
      out.push({
        id: "cat", title: `${min} more minutes of ${cat} today`,
        why: `${week.passed} quiz rounds passed this week. The daily quiz cap (${b.earnRules.quiz_daily_cap_min} min) means the passes past it paid nothing.`,
        kind: "grant", category: cat, minutes: min,
        command: `genkan grant ${child.name} ${cat} ${min}`,
        effect: `Raises today's ${cat} cap from ${fmt.min(b.budgets[cat])} to ${fmt.min(b.budgets[cat] + min)}, and clears the ${cat} block only if the meter set it for going over the cap. Tomorrow's cap is unchanged.`,
      });
    }
  }
  if (bedtimeKept && bedtime.tonight && !bedtime.tonight.in_window) {
    out.push({
      id: "later", title: "Half an hour later tonight",
      why: `Bedtime ran on all ${bedtime.week.scheduled} scheduled nights this week without being lifted.`,
      kind: "extend", minutes: 30,
      command: "tonight's bedtime extension, the same one the Family page offers",
      effect: `Tonight only: the internet stays on for 30 minutes past the scheduled bedtime, then goes off as usual. Tomorrow night is unchanged. Refused rather than clamped if it would run past the morning.`,
    });
  }
  if (noRisky && week.choreMin >= 30) {
    out.push({
      id: "chorefree", title: "A chore-free evening",
      why: `${fmt.min(week.choreMin)} earned from approved chores this week and nothing risky blocked.`,
      kind: "say", minutes: 0, command: "none: this one is said out loud",
      effect: "Genkan cannot do this one. It is a thing a parent says, which is rather the point.",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The brief: the ONLY thing that would leave the house, and only when the
// household has switched the card on. No name, no device labels, no
// addresses, no timestamps finer than a date, no raw log. The exact object
// is shown on the page before the first send and stored next to every
// summary it produced. Kept under about 1,500 tokens on purpose: the
// nightly worker reads one day at a time, so a summary never needs a big
// context, and the cost line on the page is worked out from this size.
// ---------------------------------------------------------------------------
export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const BRIEF_TOKEN_CAP = 1500;
// Roughly what the model tokeniser makes of dense JSON. Conservative: it
// over-estimates a little, so the cost line errs high, never low.
export const estimateTokens = text => Math.ceil(String(text).length / 3.4);
// Published list prices per million tokens, in US dollars, for the cost
// line. Anything not listed is quoted at the Haiku rate and says so.
const PRICES = [
  [/haiku-4-5/, 1, 5], [/sonnet-5/, 2, 10], [/sonnet-4-6/, 3, 15], [/opus-4-8|opus-4-7|opus-4-6|opus-5/, 5, 25],
];
export function costCents(model, tokensIn, tokensOut = 350) {
  const hit = PRICES.find(([re]) => re.test(String(model || "")));
  const [, inP, outP] = hit || PRICES[0];
  return { cents: ((tokensIn * inP + tokensOut * outP) / 1e6) * 100, known: !!hit };
}

export function aiBrief(ins, period) {
  const w = period === "day" ? sumOne(ins.todayRow) : ins.week;
  const p = period === "day" ? sumOne(ins.days[12]) : ins.prev;
  const kinds = o => Object.fromEntries(KINDS.filter(k => o[k] > 0).map(k => [k, o[k]]));
  const topN = n => Object.fromEntries(Object.entries(ins.topByKind)
    .filter(([k]) => k !== "ads")
    .map(([k, rows]) => [k, rows.slice(0, n).map(r => [r.domain, r.n])]));
  const win = s => ({
    minutes: ins.hasMeter ? { gaming: s.gaming, video: s.video, social: s.social, online: s.online } : "no minutes recorded by the meter",
    learning: { minutes_earned_by_quizzes: s.quizMin, minutes_earned_by_chores: s.choreMin, quiz_rounds: s.rounds,
      quiz_rounds_passed: s.passed, study_page_visits: s.studyVisits },
    lookups_by_kind: kinds(s.lookups), lookups_total: s.lookupsTotal,
    blocked_by_kind: kinds(s.blocked), blocked_total: s.blockedTotal,
  });
  const brief = {
    what_this_is: "Aggregated counts about one child's home internet use, computed on the family's own box. The child is not named. A lookup is a DNS lookup: a proxy for activity, never minutes.",
    period, ending: ins.today,
    child: { age: ins.child.age, filter_level: ins.child.tier },
    this_period: win(w),
    previous_period: win(p),
    late_lookups_after_9pm_by_kind_last_7_days: kinds(ins.late.week),
    bedtime: ins.bedtime.hasSchedule ? {
      scheduled_nights: ins.bedtime.week.scheduled, ran_as_scheduled: ins.bedtime.week.ran,
      lifted_by_parent: ins.bedtime.week.lifted, extensions_granted: ins.bedtime.extensions,
      lookups_during_bedtime_hours: ins.bedtime.week.lookups,
      note: "lookups during bedtime hours include background apps on a phone by the bed",
    } : "no bedtime scheduled",
    devices: ins.devices.map(d => ({ kind: d.kind, lookups: d.total, mostly: d.top, share_percent: d.share,
      learning_share_percent: d.learningShare, after_9pm: d.lateTotal, during_bedtime_hours: d.bedtime })),
    top_domains_by_kind_last_7_days: topN(3),
    badges_earned_last_14_days: ins.badges.length,
    findings_computed_in_the_house: ins.changes.slice(0, 8).map(c => c.text),
    rewards_suggested_by_the_house_rules: ins.rewards.map(r => `${r.title}: ${r.why}`),
  };
  // Stay under the cap by dropping the least essential parts first. The
  // findings and the counts are the substance; the domain list is colour.
  if (estimateTokens(JSON.stringify(brief)) > BRIEF_TOKEN_CAP) brief.top_domains_by_kind_last_7_days = topN(1);
  if (estimateTokens(JSON.stringify(brief)) > BRIEF_TOKEN_CAP) delete brief.top_domains_by_kind_last_7_days;
  if (estimateTokens(JSON.stringify(brief)) > BRIEF_TOKEN_CAP) brief.findings_computed_in_the_house = brief.findings_computed_in_the_house.slice(0, 4);
  return brief;
}
function sumOne(d) {
  return { ...d, earned: d.quizMin + d.choreMin, meterDays: d.meterRows ? 1 : 0, online: d.online || 0 };
}

// Whether a day had anything in it worth a sentence. The nightly worker
// skips a child with nothing, so a quiet Tuesday costs nothing.
export function hadActivity(ins) {
  const t = ins.todayRow;
  return t.lookupsTotal > 0 || t.blockedTotal > 0 || (t.online || 0) > 0 || t.metered > 0
    || t.rounds > 0 || t.quizMin + t.choreMin + t.grantMin > 0;
}

const RULES = `Rules you must keep:
- Refer to the child only as "the child". Never invent a name. Use "they".
- New Zealand English. No dashes as punctuation: use commas, full stops, colons or brackets.
- No diagnosis, no labels (never "addicted", "lazy", "obsessed"), no moralising, no advice about health or mental health. You describe what devices asked for, not what a person did.
- A lookup is a DNS lookup: a rough sign of activity, never minutes. If minutes say "no minutes recorded", say that plainly and do not estimate them.
- Lookups during bedtime hours include background apps on a phone by the bed. Treat them as a question to ask, not a fact about the child.`;

const SYSTEM_DAY = `You write a short, warm, plain-English note for a parent about one child's use of the home internet, from aggregated numbers the family's own box computed. You see counts only: no names, no logs, no content.

${RULES}
- Compare this period with the previous one where the numbers allow, and say when they are too small to mean anything.

Write under 220 words, with these three short headings and a sentence or a few bullets under each:
What went well
Worth a chat (the phone versus the computer, late nights, anything blocked: suggest what to ask, not what to conclude)
Reward? (say plainly whether the numbers earned one under the house rules you were given, and which fits: extra minutes, a later bedtime tonight, a chore-free evening, or none yet)`;

const SYSTEM_WEEK = `You write a short, warm, plain-English note for a parent about one child's week on the home internet. You are given the seven short daily notes that were already written about that week, one per day, and nothing else: no numbers beyond what those notes mention, no names, no logs.

${RULES}
- Talk about the shape of the week (which days were heavy, whether the pattern moved) rather than repeating each day.

Write under 220 words, with these three short headings and a sentence or a few bullets under each:
What went well
Worth a chat (the phone versus the computer, late nights, anything blocked: suggest what to ask, not what to conclude)
Reward? (say plainly whether the week earned one and which fits: extra minutes, a later bedtime, a chore-free evening, or none yet)`;

// The one outbound request, and it goes through the Claude CLI signed in on
// this box (the same sign-in the household's agent uses), never through an
// API key in a file: `claude -p --model <haiku> --output-format json`, the
// brief on stdin, our own system prompt in place of the CLI's. GENKAN_AI_STUB=1
// answers with a canned note and sends nothing, so the storage and the page
// can be proved without a sign-in. GENKAN_DEMO=1 refuses outright: the public
// demo must never make an outbound request on a visitor's click.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
// Is the Claude CLI where this user would have it? A presence check only; a
// sign-in cannot be checked without making a request, and the first write
// says so plainly if it is missing.
export function cliPresent() {
  const home = process.env.HOME || "";
  if (existsSync(`${home}/.local/bin/claude`)) return true;
  return (process.env.PATH || "").split(":").some(d => d && existsSync(`${d}/claude`));
}
export async function aiCall({ model, system, user, stubText }) {
  if (process.env.GENKAN_DEMO === "1") return { ok: false, out: "This is the demo, so nothing is sent anywhere. At home this sends the brief shown under \"What would leave the house\" and nothing else." };
  if (process.env.GENKAN_AI_STUB === "1") return { ok: true, text: stubText, model: "stub", tokensIn: estimateTokens(system + user), tokensOut: estimateTokens(stubText) };
  const home = process.env.HOME || "";
  const bin = process.env.GENKAN_CLAUDE_BIN || "claude";
  const args = ["-p", "--model", model, "--output-format", "json", "--system-prompt", system, "--exclude-dynamic-system-prompt-sections"];
  const env = { ...process.env, PATH: `${home}/.local/bin:${process.env.PATH || "/usr/local/bin:/usr/bin:/bin"}` };
  let out;
  try {
    out = await new Promise((resolve, reject) => {
      const child = execFile(bin, args, { env, cwd: home || "/", timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout));
      child.stdin.on("error", () => {});
      child.stdin.end(user);
    });
  } catch (e) {
    const why = e.code === "ENOENT" ? "the Claude CLI is not installed for this user" : (e.stderr || e.message || "").toString().trim().split("\n").pop();
    return { ok: false, out: `Could not run the Claude CLI: ${why}. Nothing was stored.` };
  }
  let j; try { j = JSON.parse(out); } catch { return { ok: false, out: "The CLI answered with something that was not its JSON. Nothing was stored." }; }
  if (j.is_error || j.subtype !== "success") return { ok: false, out: `The CLI reported ${j.subtype || "an error"}${j.result ? `: ${String(j.result).slice(0, 200)}` : ""}. Nothing was stored.` };
  const text = String(j.result || "").trim();
  if (!text) return { ok: false, out: "The model sent back no text. Nothing was stored." };
  const used = j.usage || {};
  const modelUsed = Object.keys(j.modelUsage || {})[0] || model;
  return { ok: true, text, model: modelUsed, tokensIn: used.input_tokens ?? null, tokensOut: used.output_tokens ?? null, costUsd: j.total_cost_usd ?? null };
}

async function store(q, { childId, period, day, complete, brief, text, model, tokensIn, tokensOut, by }) {
  await q(`INSERT INTO kid_summaries (child_id, period, day, complete, brief, summary, model, tokens_in, tokens_out, created_by)
           VALUES ($1, $2, $3::date, $4, $5::jsonb, $6, $7, $8, $9, $10)
           ON CONFLICT (child_id, period, day) DO UPDATE
             SET complete = EXCLUDED.complete, brief = EXCLUDED.brief, summary = EXCLUDED.summary,
                 model = EXCLUDED.model, tokens_in = EXCLUDED.tokens_in, tokens_out = EXCLUDED.tokens_out,
                 created = now(), created_by = EXCLUDED.created_by`,
    [childId, period, day, complete, JSON.stringify(brief), text, model, tokensIn, tokensOut, by]);
}

function stubFor(brief, period) {
  const L = brief.this_period?.learning || {};
  return `What went well\nThe child earned ${fmt.min((L.minutes_earned_by_quizzes || 0) + (L.minutes_earned_by_chores || 0))} by learning this ${period}, and ${L.quiz_rounds_passed || 0} quiz rounds were passed.\n\nWorth a chat\nThis is a stub written on the box with GENKAN_AI_STUB=1. Nothing left the house. The real note would talk about the phone against the computer and any late nights here.\n\nReward?\n${(brief.rewards_suggested_by_the_house_rules || []).length ? "The house rules suggest one: " + brief.rewards_suggested_by_the_house_rules[0] : "Not by the house rules this time, and that is fine."}`;
}

// A day's summary from that day's brief. `complete` is true when the day is
// over (the nightly worker), false for "today so far" (the button).
export async function writeDay(q, ins, { complete = false, by = "dashboard" } = {}) {
  if (!ins.ai.enabled) return { ok: false, out: "The summary card is switched off. Turn it on first." };
  const brief = aiBrief(ins, "day");
  const r = await aiCall({ model: ins.ai.model || DEFAULT_MODEL, system: SYSTEM_DAY,
    user: `Period: one day, ${ins.today}. The brief, as JSON:\n${JSON.stringify(brief)}`, stubText: stubFor(brief, "day") });
  if (!r.ok) return r;
  await store(q, { childId: ins.child.id, period: "day", day: ins.today, complete, brief, text: r.text,
    model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, by });
  return { ok: true, out: r.model === "stub" ? "Stub summary stored; nothing left the house." : `Summary written by ${r.model} and stored.`, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
}

// "This week so far", on demand, from the week's own brief. Stored against
// the Monday the week started, not complete, so the worker's Monday write
// (from the seven daily notes) replaces it.
export async function writeWeekSoFar(q, ins, { by = "dashboard" } = {}) {
  if (!ins.ai.enabled) return { ok: false, out: "The summary card is switched off. Turn it on first." };
  const brief = aiBrief(ins, "week");
  const r = await aiCall({ model: ins.ai.model || DEFAULT_MODEL, system: SYSTEM_DAY,
    user: `Period: the last seven days ending ${ins.today}. The brief, as JSON:\n${JSON.stringify(brief)}`, stubText: stubFor(brief, "week") });
  if (!r.ok) return r;
  await store(q, { childId: ins.child.id, period: "week", day: mondayOf(ins.today), complete: false, brief, text: r.text,
    model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, by });
  return { ok: true, out: r.model === "stub" ? "Stub summary stored; nothing left the house." : `Summary written by ${r.model} and stored.` };
}

// A finished week, written from its seven daily summaries and nothing else.
// The brief that leaves the house is therefore the seven notes, each of
// which already left once; no raw count is sent again. Needs at least three
// daily notes to say anything about a week.
export async function writeWeekFromDailies(q, child, weekStart, settings, { by = "worker" } = {}) {
  if (!settings.enabled) return { ok: false, out: "switched off" };
  const rows = await q(`SELECT day::text AS day, summary FROM kid_summaries
                        WHERE child_id=$1 AND period='day' AND complete AND day >= $2::date AND day < $2::date + 7
                        ORDER BY day`, [child.id, weekStart]);
  if (rows.length < 3) return { ok: false, out: `only ${rows.length} daily notes for the week of ${weekStart}; need three` };
  const brief = {
    what_this_is: "The daily notes already written about one child's week, in order. The child is not named.",
    week_starting: weekStart,
    daily_notes: rows.map(r => ({ day: r.day, note: r.summary })),
  };
  const stub = `What went well\nA stub weekly note from ${rows.length} daily notes (GENKAN_AI_STUB=1). Nothing left the house.\n\nWorth a chat\nThe shape of the week would be described here.\n\nReward?\nNot decided by a stub.`;
  const r = await aiCall({ model: settings.model || DEFAULT_MODEL, system: SYSTEM_WEEK,
    user: `The week starting ${weekStart}. The daily notes, as JSON:\n${JSON.stringify(brief)}`, stubText: stub });
  if (!r.ok) return r;
  await store(q, { childId: child.id, period: "week", day: weekStart, complete: true, brief, text: r.text,
    model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, by });
  return { ok: true, out: `week of ${weekStart} written by ${r.model} from ${rows.length} daily notes` };
}

// The Monday of the week an ISO date falls in (Monday-start weeks, the same
// definition as analytics.mjs weekBounds and bin/genkan-report).
export function mondayOf(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// POST /api/kid. Behind the same DASH_TOKEN guard as every other control.
// ---------------------------------------------------------------------------
export async function kidApi(q, body, res, runKidnet) {
  const send = (code, out, ok = false, extra = {}) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, out, ...extra }));
  };
  const op = String(body?.op || "");
  const cid = Number(body?.child_id);
  if (!Number.isInteger(cid) || cid <= 0) return send(400, "which child?");
  const [child] = await q("SELECT id, name, age, policy_tier FROM children WHERE id=$1 AND kind='child'", [cid]);
  if (!child) return send(404, "no such child");
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(child.name)) return send(400, "That name cannot be passed to the CLI.");

  if (op === "reward") {
    const kind = String(body.kind || "");
    const min = Number(body.minutes);
    if (!Number.isInteger(min) || min < 1 || min > 240) return send(400, "Between 1 and 240 minutes.");
    if (kind === "bonus") {
      const why = /^[A-Za-z0-9_:+.,\- ]{0,60}$/.test(String(body.reason || "")) ? String(body.reason || "insights") : "insights";
      const r = await runKidnet(["bonus", child.name, String(min), why]);
      return send(r.ok ? 200 : 400, r.out.trim() || (r.ok ? "done" : "that did not work"), r.ok);
    }
    if (kind === "grant") {
      const cat = String(body.category || "");
      if (!["gaming", "video"].includes(cat)) return send(400, "gaming or video only");
      const r = await runKidnet(["grant", child.name, cat, String(min)]);
      return send(r.ok ? 200 : 400, r.out.trim() || (r.ok ? "done" : "that did not work"), r.ok);
    }
    return send(400, "not a reward the page can give");
  }

  if (op === "ai-enable" || op === "ai-disable") {
    const on = op === "ai-enable";
    try {
      await q("UPDATE ai_summary_settings SET enabled=$1, updated_ts=now(), updated_by='dashboard' WHERE only_row", [on]);
    } catch (e) { return send(500, `Could not save the switch: ${e.message}`); }
    return send(200, on
      ? "Summaries by an AI are on for this household. Nothing is sent until you press Write, or until you enable the nightly timer: sudo systemctl enable --now kids-summary.timer"
      : "Switched off. Summaries already written stay on the page. The nightly timer, if you enabled it, now does nothing; disable it with: sudo systemctl disable --now kids-summary.timer", true);
  }

  if (op === "ai-model") {
    const model = String(body.model || "").trim();
    if (!/^[a-z0-9][a-z0-9.-]{2,60}$/.test(model)) return send(400, "A model name is lower-case letters, digits, dots and hyphens.");
    try {
      await q("UPDATE ai_summary_settings SET model=$1, updated_ts=now(), updated_by='dashboard' WHERE only_row", [model]);
    } catch (e) { return send(500, `Could not save the model: ${e.message}`); }
    return send(200, `Summaries will be written by ${model} from now on.`, true);
  }

  if (op === "ai-write") {
    const ins = await kidInsights(q, child);
    const r = body.period === "day" ? await writeDay(q, ins, { complete: false }) : await writeWeekSoFar(q, ins);
    return send(r.ok ? 200 : 400, r.out, r.ok);
  }
  return send(400, "unknown op");
}

// ---------------------------------------------------------------------------
// The page pieces. views.mjs's kid() composes them.
// ---------------------------------------------------------------------------
export const KID_CSS = `
.truth{font-size:19px;line-height:1.4;margin:0 0 4px;letter-spacing:-.01em}
.truth b{font-weight:600}
.truth .q{color:var(--ink-muted)}
.tsub{color:var(--ink-muted);font-size:12.5px;margin:0}
.chg{border-top:1px solid var(--line);padding:9px 0;display:flex;gap:10px;align-items:flex-start;font-size:13.5px}
.chg:first-of-type{border-top:0}
.chg .m{flex:none;width:10px;height:10px;border-radius:50%;margin-top:6px;background:var(--ink-muted)}
.chg.good .m{background:var(--ok)}.chg.talk .m{background:var(--ember)}.chg.note .m{background:var(--warn)}
.chg .t{flex:1;min-width:0}
.chg .how{display:block;color:var(--ink-muted);font-size:11.5px;margin-top:1px}
.rw{border:1px solid var(--line);border-radius:12px;padding:11px 13px;margin-top:9px;background:var(--surface-2)}
.rw h4{margin:0 0 3px;font-size:14.5px;font-weight:600}
.rw p{margin:0;font-size:13px;color:var(--ink-2)}
.rw .eff{color:var(--ink-muted);font-size:12px;margin-top:5px}
.rw .eff code{font-size:11px}
.rw .acts{margin-top:9px}
.ai{white-space:pre-wrap;font-size:14px;line-height:1.55;margin:8px 0 0}
.ai h5{font-size:13px;margin:10px 0 2px}
.aimeta{color:var(--ink-muted);font-size:11.5px;margin-top:6px}
.leave{margin-top:10px}
.leave summary{font-size:12.5px;color:var(--ink-muted);cursor:pointer}
.leave pre{font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;
  background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:10px;margin:6px 0 0;max-height:360px;overflow:auto}
.dev{border-top:1px solid var(--line);padding:9px 0}
.dev:first-of-type{border-top:0}
.dev .dn{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;font-size:13.5px}
.dev .dn b{font-weight:600}
.dev .dm{color:var(--ink-muted);font-size:12px;margin-top:2px}
.share{display:flex;height:7px;border-radius:999px;overflow:hidden;background:var(--surface-2);margin-top:6px}
.share span{display:block;height:100%}
.onoff{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;color:var(--ink-2)}
`;

export const KID_JS = `
async function kiReward(btn){
  var d=btn.dataset;
  if(!confirm(d.effect+'\\n\\nRuns: '+d.command+'\\n\\nGo ahead?'))return;
  if(d.kind==='extend'){say('extending tonight...');
    var x=await post('/api/schedule',{op:'extend',child_id:Number(d.child),minutes:Number(d.minutes)});done(x.r,x.j,700);return;}
  say('working...');
  var o=await post('/api/kid',{op:'reward',child_id:Number(d.child),kind:d.kind,category:d.category||'',minutes:Number(d.minutes),reason:d.reason||''});
  done(o.r,o.j,700);}
async function kiAi(op,child,period){
  if(op==='ai-enable'&&!confirm('Turn on summaries written by an AI for this household?\\n\\nNothing is sent until you press Write on a child\\'s page or enable the nightly timer. When one is written, the brief shown under "What would leave the house" goes to api.anthropic.com and nothing else does: no name, no log, no addresses.'))return;
  say(op==='ai-write'?'asking for the summary, this can take half a minute...':'saving...');
  var o=await post('/api/kid',{op:op,child_id:Number(child),period:period||'week'});
  done(o.r,o.j,700);}
async function kiModel(child){
  var m=(document.getElementById('kimodel')||{}).value||'';
  say('saving the model...');
  var o=await post('/api/kid',{op:'ai-model',child_id:Number(child),model:m.trim()});
  done(o.r,o.j,600);}
`;

// The one sentence of truth at the top of the page.
export function truthLine(ins) {
  const t = ins.todayRow, w = ins.week;
  const parts = [];
  if (t.online !== null && t.online > 0) parts.push(`<b>${esc(fmt.min(t.online))}</b> online`);
  else if (t.meterRows || t.online !== null) parts.push(`<b>nothing</b> on the ledger yet`);
  else parts.push(`<span class="q">no minutes recorded</span>`);
  if (t.quizMin + t.choreMin > 0) parts.push(`<b>${esc(fmt.min(t.quizMin + t.choreMin))}</b> earned by learning${t.passed ? ` (${t.passed} quiz${t.passed === 1 ? "" : "zes"} passed)` : ""}`);
  else if (t.lookups.learning >= 10) parts.push(`<b>${fmt.count(t.lookups.learning)}</b> lookups to learning sites`);
  const blocked = t.blockedTotal - t.blocked.ads;
  parts.push(blocked ? `<b>${blocked}</b> blocked lookup${blocked === 1 ? "" : "s"}` : `<b>nothing</b> blocked`);
  if (ins.bedtime.hasSchedule) {
    const n = ins.bedtime.tonight, bw = ins.bedtime.week;
    if (n && n.in_window) parts.push(`<b>bedtime</b> is on now`);
    else if (bw.scheduled > 0 && bw.ran === bw.scheduled && bw.lifted === 0) parts.push(`bedtime <b>kept</b> all week`);
    else if (n) parts.push(`bedtime at <b>${esc(new Date(n.starts_at).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" }))}</b> tonight`);
  }
  const week = `This week: ${esc(fmt.min(w.earned))} earned by learning, ${w.passed} quiz${w.passed === 1 ? "" : "zes"} passed, ${esc(fmt.count(w.lookupsTotal))} lookups, ${w.blockedTotal - w.blocked.ads} blocked.`;
  return `<div class="card"><p class="truth">Today: ${parts.join(", ")}.</p>
    <p class="tsub">${week} Minutes come from the meter${ins.hasMeter ? "" : ", which has none for this child yet"}; a lookup is a name a device asked for, not time.</p></div>`;
}

// Today hour by hour, and the fortnight day by day. Lookups, labelled so.
export function chartsCard(ins) {
  const keys = ["learning", "gaming", "video", "social", "other"];
  const segs = src => keys.map(k => ({ key: KIND_SERIES[k], value: k === "other" ? src.other + src.messaging + src.audio : src[k] }));
  const hourCols = ins.hours.map(h => ({
    label: `${String(h.h).padStart(2, "0")}:00`, sub: String(h.h),
    summary: `${fmt.count(h.total)} lookups`, segs: segs(h),
  }));
  const anyToday = ins.hours.some(h => h.total > 0);
  const dayCols = ins.days.map(d => ({
    label: fmt.dayFull(d.day), sub: fmt.dayShort(d.day).slice(0, 2),
    summary: `${fmt.count(d.lookupsTotal)} lookups`, segs: segs(d.lookups),
  }));
  const anyFortnight = ins.days.some(d => d.lookupsTotal > 0);
  const legendKeys = ["earned", "gaming", "video", "social", "other"];
  const legendNote = "Learning is shown on the earned colour: schoolwork, education and reading-list domains. Grey is everything else, messaging and music included.";
  const minuteCols = ins.days.map(d => ({
    label: fmt.dayFull(d.day), sub: fmt.dayShort(d.day).slice(0, 2), summary: fmt.min(d.metered),
    segs: METERED.map(k => ({ key: k, value: d[k] })),
  }));
  return `<div class="card"><h2>Today and the fortnight</h2>
    <p class="ftitle">Today, hour by hour</p>
    <p class="fsub">Lookups per hour${ins.isToday ? ` up to ${esc(ins.hm)}` : ` on ${esc(fmt.dayFull(ins.today))}`}, by kind. A lookup is a name a device asked for: a sign of activity, not minutes.</p>
    ${anyToday ? `<div class="figure">${columns({ cols: hourCols, series: legendKeys.map(key => ({ key })), showValues: false, tickFormat: fmt.count, title: "Today, lookups per hour" })}</div>`
      : `<p class="empty">No lookups from ${esc(ins.child.name)}'s devices yet today.</p>`}
    ${legend(legendKeys, { note: legendNote })}
    ${table(["Hour", "Learning", "Gaming", "Video", "Social", "Other", "Total"],
      ins.hours.filter(h => h.total > 0).map(h => [`${String(h.h).padStart(2, "0")}:00`, h.learning, h.gaming, h.video, h.social, h.other + h.messaging + h.audio, h.total]),
      { summary: "Show today's hours" })}
    <p class="ftitle">This week against last, day by day</p>
    <p class="fsub">Lookups per day by kind, the last seven days on the right and the seven before on the left.</p>
    ${anyFortnight ? `<div class="figure">${columns({ cols: dayCols, series: legendKeys.map(key => ({ key })), showValues: false, tickFormat: fmt.count, title: "Fortnight, lookups per day" })}</div>`
      : `<p class="empty">No lookups attributed to ${esc(ins.child.name)} in the last fortnight. Devices are named on the Devices tab.</p>`}
    ${legend(legendKeys)}
    ${table(["Day", "Learning", "Gaming", "Video", "Social", "Other", "Blocked", "Total"],
      ins.days.map(d => [fmt.dayFull(d.day), d.lookups.learning, d.lookups.gaming, d.lookups.video, d.lookups.social,
        d.lookups.other + d.lookups.messaging + d.lookups.audio, d.blockedTotal, d.lookupsTotal]), { summary: "Show the fortnight" })}
    <p class="ftitle">Minutes the meter counted</p>
    ${ins.hasMeter
      ? `<p class="fsub">Gaming, video and social minutes per day, from the meter. This is the only minutes figure on the page.</p>
         <div class="figure">${columns({ cols: minuteCols, series: METERED.map(key => ({ key })), showValues: false, title: "Fortnight, metered minutes per day" })}</div>
         ${legend(METERED)}
         ${table(["Day", "Gaming", "Video", "Social", "Online (ledger)"], ins.days.map(d => [fmt.dayFull(d.day), d.gaming, d.video, d.social, d.online === null ? "not recorded" : d.online]), { summary: "Show the minutes" })}`
      : `<p class="empty">No minutes recorded by the meter for ${esc(ins.child.name)} in the last fortnight. The meter fills in once the island is cabled and the metering timer has run; until then this page counts lookups and says so.</p>`}
  </div>`;
}

export function changesCard(ins) {
  return `<div class="card"><h2>What changed</h2>
    <p class="sub">The last seven days against the seven before, by rules that are written down, not by a model. Each line says what it measured.</p>
    ${ins.changes.map(c => `<div class="chg ${esc(c.tone)}"><span class="m"></span><span class="t">${esc(c.text)}${c.measure ? `<span class="how">measured from: ${esc(c.measure)}</span>` : ""}</span></div>`).join("")}
  </div>`;
}

export function rewardsCard(ins) {
  const c = ins.child;
  const rules = `A bonus is priced in passes: ${ins.earnRules.default_minutes_per_pass} minutes a pass at this house's rate. The rules: learning up and habits down earns three passes; learning up alone earns two; five passes in a week earns more of a capped category; a bedtime kept all week earns a later one tonight; chores plus nothing risky earns an evening off them.`;
  const body = ins.rewards.length
    ? ins.rewards.map(r => `<div class="rw"><h4>${esc(r.title)}</h4><p>${esc(r.why)}</p>
        <p class="eff">${esc(r.effect)}<br><code>${esc(r.command)}</code></p>
        ${r.kind === "say" ? "" : `<div class="acts"><button class="btn primary" onclick="kiReward(this)"
          data-child="${c.id}" data-kind="${esc(r.kind)}" data-category="${esc(r.category || "")}" data-minutes="${r.minutes}"
          data-reason="${esc((r.command.split(" ")[4] || "insights"))}" data-effect="${esc(r.effect)}" data-command="${esc(r.command)}">${esc(r.kind === "extend" ? "Give it tonight" : "Give it")}</button></div>`}
      </div>`).join("")
    : `<div class="empty">Nothing earned a reward this week by the house rules, and that is fine: most weeks are ordinary.</div>`;
  return `<div class="card"><h2>Suggested rewards</h2>
    <p class="sub">Suggested by the numbers above, given only when you press the button, and every button shows exactly what it will do first.</p>
    ${body}<p class="cnote">${esc(rules)} Badges are not on this list: a badge is earned against ${esc(c.name)}'s own history, never handed out.</p></div>`;
}

// The card that ships switched off. When on, it READS the stored summaries
// (yesterday's first, the last seven available, and the week's) and offers
// two on-demand buttons. Opening the page never sends anything.
export function aiCard(ins) {
  const c = ins.child;
  const ai = ins.ai;
  const brief = aiBrief(ins, "day");
  const briefJson = JSON.stringify(brief, null, 1);
  const tokens = estimateTokens(JSON.stringify(brief));
  const cost = costCents(ai.model, tokens + 400);
  const costLine = `A day's brief is about ${tokens.toLocaleString("en-NZ")} tokens (the cap is ${BRIEF_TOKEN_CAP.toLocaleString("en-NZ")}). With the instructions and the reply that is roughly ${cost.cents < 0.1 ? "a tenth of a cent" : cost.cents.toFixed(1) + " cents"} per child per day at ${esc(ai.model)}${cost.known ? "" : " (priced at the Haiku rate, the model name is not one this page knows)"}, about ${(cost.cents * 30).toFixed(0)} cents a month.`;
  const briefBlock = `<details class="leave"><summary>What would leave the house (the exact brief for ${esc(ins.today)}, nothing else)</summary>
    <pre>${esc(briefJson)}</pre>
    <p class="cnote">Sent through the Claude CLI signed in on this box (the same sign-in the household\u2019s agent uses; it talks to api.anthropic.com), only when a summary is written. The reply is stored in kid_summaries next to this brief and never re-sent. ${esc(c.name)}'s name is not in it; it is put back when the page renders. A weekly note is written from the seven daily notes, so no count is sent twice.</p></details>`;

  if (!ai.enabled) {
    return `<div class="card"><h2>Summary written by an AI</h2>
      <p class="sub">Off. Everything above was worked out in the house with no AI. If you turn this on, a small worker sends one day's brief of the numbers above to Claude, through the Claude CLI signed in on this box, each morning and stores the note it writes back: what went well, what to talk about, whether a reward is deserved. On Mondays it writes the week from those seven notes. It is the only thing on this dashboard that would ever leave the house.</p>
      <p class="cnote">${costLine}</p>
      <div class="acts"><button class="btn" onclick="kiAi('ai-enable',${c.id})">Turn it on for this household</button></div>
      ${briefBlock}
      <p class="cnote">Nothing has left the house. PRIVACY-CHARTER.md P1 records this card as the one opt-in exception, and says exactly what it sends.</p></div>`;
  }

  const dayRows = ins.summaries.filter(s => s.period === "day");
  const weekRows = ins.summaries.filter(s => s.period === "week");
  const first = dayRows[0] || null;
  const one = (s, open) => `<details class="rw" ${open ? "open" : ""}><summary><b>${s.period === "week" ? `Week of ${esc(fmt.dayFull(s.day))}` : esc(dayLabel(s.day, ins.today))}</b>
      <span class="tag">${s.complete ? "" : "so far · "}${esc(s.model)}${s.tokens_in ? ` · ${esc(realCost(s))}` : ""}</span></summary>
      <div class="ai">${renderSummary(s.summary, c.name)}</div>
      <p class="aimeta">Written ${esc(new Date(s.created).toLocaleString("en-NZ", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} by ${esc(s.created_by || "the dashboard")}.</p></details>`;
  const shown = (first ? one(first, true) : "")
    + dayRows.slice(1).map(s => one(s, false)).join("")
    + weekRows.map(s => one(s, false)).join("");
  const keyLine = ai.stub ? `<p class="cnote">GENKAN_AI_STUB=1 is set, so every write stores a canned note and sends nothing.</p>`
    : ai.hasCli ? "" : `<p class="cnote">On, but the Claude CLI is not installed for the user the dashboard runs as (it looks for <code>claude</code> on the path and in <code>~/.local/bin</code>). Nothing is sent until it is, and signed in.</p>`;
  return `<div class="card"><h2>Summary written by an AI</h2>
    <p class="sub">On for this household. The nightly worker writes yesterday's note at 06:30 once <code>kids-summary.timer</code> is enabled (<code>sudo systemctl enable --now kids-summary.timer</code>), and the week's note on Mondays from the seven daily ones. Opening this page never sends anything.</p>
    ${shown || `<div class="empty">No summary written for ${esc(c.name)} yet. The worker writes yesterday's each morning; the buttons below write one now.</div>`}
    <div class="acts">
      <button class="btn primary" onclick="kiAi('ai-write',${c.id},'day')">Write today so far</button>
      <button class="btn" onclick="kiAi('ai-write',${c.id},'week')">Write this week so far</button>
      <button class="btn" onclick="kiAi('ai-disable',${c.id})">Turn it off</button>
    </div>${keyLine}
    <div class="gform"><span class="lab">Model</span><input id="kimodel" value="${esc(ai.model)}" maxlength="60" style="width:230px">
      <button class="btn" onclick="kiModel(${c.id})">Save</button>
      <span class="lab">${esc(DEFAULT_MODEL)} is the cheap default.</span></div>
    <p class="cnote">${costLine}</p>
    ${briefBlock}</div>`;
}
function dayLabel(day, today) {
  const diff = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(day + "T00:00:00Z")) / 86400000);
  return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : fmt.dayFull(day);
}
function realCost(s) {
  const c = costCents(s.model, num(s.tokens_in), num(s.tokens_out));
  return c.cents < 0.05 ? "under a twentieth of a cent" : `${c.cents.toFixed(2)} cents`;
}

// The model writes "the child"; the page puts the name back. Headings the
// prompt asked for become small headings.
function renderSummary(text, name) {
  const named = String(text || "").replace(/\bThe child's\b/g, `${name}'s`).replace(/\bthe child's\b/g, `${name}'s`)
    .replace(/\bThe child\b/g, name).replace(/\bthe child\b/g, name);
  return esc(named).replace(/^(What went well|Worth a chat|Reward\?)\s*:?$/gm, "<h5>$1</h5>");
}

// Which device is used for what.
export function devicesCard(ins, roster) {
  const c = ins.child;
  const byId = new Map(ins.devices.map(d => [d.id, d]));
  const rows = (roster || []).map(r => {
    const d = byId.get(r.id) || null;
    const parts = d && d.total ? ["learning", "gaming", "video", "social", "other"].map(k => {
      const v = k === "other" ? d.lookups.other + d.lookups.messaging + d.lookups.audio : d.lookups[k];
      return [k, v, Math.round((v / d.total) * 100)];
    }).filter(x => x[1] > 0) : [];
    return `<div class="dev"><div class="dn">${r.online ? '<span class="dot-on"></span>' : ""}<b>${esc(r.label || r.hostname || "(unnamed)")}</b>
        <span class="tag">${esc(r.device_kind || "device")}</span>
        ${d && d.top ? `<span class="pill">mostly ${esc(KIND_LABEL[d.top].toLowerCase())}, ${d.share}%</span>` : ""}
        ${d && d.lateTotal ? `<span class="pill">${fmt.count(d.lateTotal)} after 9pm</span>` : ""}
        ${d && d.bedtime ? `<span class="pill">${fmt.count(d.bedtime)} in bedtime hours</span>` : ""}</div>
      ${parts.length ? `<div class="share">${parts.map(([k, , p]) => `<span style="width:${p}%;background:var(--s-${KIND_SERIES[k]})" title="${esc(KIND_LABEL[k])} ${p}%"></span>`).join("")}</div>` : ""}
      <div class="dm">${d && d.total ? `${fmt.count(d.total)} lookups in the last 7 days: ${esc(parts.map(([k, , p]) => `${KIND_LABEL[k].toLowerCase()} ${p}%`).join(", "))}` : "no lookups attributed in the last 7 days"}
        · <code>${esc([r.vendor, r.ip || "no reserved IP", r.mac].filter(Boolean).join(" · "))}</code></div></div>`;
  }).join("");
  return `<div class="card"><h2>${esc(c.name)}'s devices (${(roster || []).length})</h2>
    ${rows || `<div class="empty">No devices assigned yet. Until one is, nothing on this page can be counted. Name it on the <a href="/devices">Devices</a> tab.</div>`}
    ${legend(["earned", "gaming", "video", "social", "other"], { note: "Shares are of lookups, not time. The learning share is schoolwork, education and reading-list domains." })}
  </div>`;
}

// Services ranked by lookups, from the analytics the page already has.
export function servicesCard(kid) {
  if (!kid || !kid.serviceList || !kid.serviceList.length) return "";
  const svc = kid.serviceList.slice(0, 8);
  const rows = svc.map(x => ({
    label: x.service.label, emoji: x.service.emoji,
    key: METERED.includes(x.service.category) ? x.service.category : null,
    value: x.lookups, display: `${fmt.count(x.lookups)} lookups`,
    sub: x.minutes ? fmt.min(x.minutes) : "",
  }));
  return `<div class="card"><h2>Which services</h2>
    <p class="sub">Lookups per named service over the last ${kid.days.length} days. Coloured when the service is in a metered category; grey means it is never counted against a budget.</p>
    <div class="figure">${ranked(rows, { title: "service lookups" })}</div>
    ${table(["Service", "Category", "Lookups", "Blocked"], svc.map(x => [x.service.label, x.service.category, x.lookups, x.blocked]))}
  </div>`;
}
