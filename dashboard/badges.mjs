// Gamification: badges and the household board.
//
// Shared by the kid portal (dashboard/portal.mjs, which awards badges as
// quizzes are graded and shows a child their own board) and the parent
// dashboard (dashboard/earn.mjs, which shows who earned what and the switch
// to turn the household board on). One file, so the two sides can never
// disagree about what a badge is or how the board is worked out. Both
// processes mount this same file read-only (compose.yaml and
// demo/compose.yaml both bind-mount ../dashboard into the container that
// runs portal.mjs), so nothing extra needs installing for either side to see
// it.
//
// The reasoning behind every choice here, including what was tried and
// rejected, lives in docs/GAMIFICATION.md. In one line: a badge is a personal
// milestone a child earns against their own history, never against a
// sibling, and the one place siblings ARE compared (boardData, below) sticks
// to things that do not simply reward whoever is oldest.
//
// Every read here is best effort: if config/db/schema-badges.sql has not
// been loaded yet, badges and the board quietly do not appear. Quizzes still
// grade, still pay out minutes, exactly as they did before this file existed.

// ---------------------------------------------------------------------------
// The badges themselves.
// ---------------------------------------------------------------------------
// `scope` here is 'once' (a child can only ever hold one row for it) or
// 'bank' (a child can hold one row per quiz bank: mastering the road code
// bank and the times-tables bank are two different badges). This is a
// description of the SHAPE of a badge, not the check for it; the actual
// check lives in awardBadges below, next to the query it needs.
export const BADGES = [
  { id: "first_pass", scope: "once", emoji: "🌱", title: "First win",
    blurb: "Passed a quiz round for the first time." },
  { id: "first_perfect", scope: "once", emoji: "✨", title: "Perfect!",
    blurb: "Got every question right in a round, first time it happened." },
  { id: "ten_passes", scope: "once", emoji: "🔟", title: "Getting good at this",
    blurb: "Passed ten quiz rounds." },
  { id: "fifty_passes", scope: "once", emoji: "🏅", title: "Old hand",
    blurb: "Passed fifty quiz rounds. That is a lot of learning." },
  { id: "five_banks", scope: "once", emoji: "🗺️", title: "Jack of all trades",
    blurb: "Passed a round in five different quiz banks." },
  { id: "explorer", scope: "bank", emoji: "🔎", title: "Tried something new",
    blurb: "Had a go at a quiz bank for the first time." },
  { id: "bank_mastered", scope: "bank", emoji: "🎯", title: "Bank mastered",
    blurb: "Got every question in a bank right at least once, across all your rounds." },
  { id: "read_then_pass", scope: "bank", emoji: "📖", title: "Read up, then nailed it",
    blurb: "Read every answer on a bank's study page, then passed a round of it." },
  { id: "comeback", scope: "once", emoji: "🔁", title: "Bounced back",
    blurb: "Failed a round, then came back and passed the same bank." },
  { id: "earn_hour_week", scope: "once", emoji: "⏱️", title: "Put in the hours",
    blurb: "Earned an hour or more in a single week." },
];
const BY_ID = new Map(BADGES.map(b => [b.id, b]));

// ---------------------------------------------------------------------------
// Awarding. Called once, right after a graded round is logged
// (dashboard/portal.mjs: logRound), never on a timer, never sweeping the
// whole table. Every check below is a handful of rows keyed on this one
// child, so the cost of a quiz stays the cost of a quiz.
// ---------------------------------------------------------------------------
const award = (q, childId, badgeId, scope, meta) =>
  q(`INSERT INTO child_badges(child_id,badge_id,scope,meta) VALUES($1,$2,$3,$4)
     ON CONFLICT (child_id,badge_id,scope) DO NOTHING RETURNING badge_id,scope,meta`,
    [childId, badgeId, scope, JSON.stringify(meta || {})]).catch(e => {
      console.error(`badge ${badgeId} not awarded: ${e.message}`); return [];
    });

// Records a visit to a bank's "read up" page. Append-only: the same child
// reading the same bank twice is two rows, not one, because the board's
// "keenest reader" count wants a real tally of visits, not just whether they
// have ever once looked.
export async function recordStudyVisit(q, childId, bankId) {
  try { await q("INSERT INTO quiz_study_visits(child_id,bank_id) VALUES($1,$2)", [childId, bankId]); }
  catch (e) { console.error(`study visit not logged: ${e.message}`); }
}

// bank is the in-memory bank object portal.mjs already has (id, title,
// questions[]); round is the just-graded round (already written to
// quiz_rounds by logRound, so every query below already includes it).
// Returns the badges newly earned this round, so the grading page can say so.
export async function awardBadges(q, childId, bank, right, total, passed) {
  const won = [];
  const take = async (id, scope, meta) => {
    const rows = await award(q, childId, id, scope, meta);
    if (rows.length) won.push({ ...BY_ID.get(id), meta: rows[0].meta });
  };
  try {
    if (passed) {
      const [{ passes }] = await q(
        "SELECT count(*)::int AS passes FROM quiz_rounds WHERE child_id=$1 AND passed", [childId]);
      // >= 1, not === 1. Every household that was already using Genkan before
      // badges existed has children with passes behind them, and an exact
      // match would mean none of them could ever earn the first badge: a child
      // with ten passes would see "First win: still to get", which reads as
      // broken. take() is idempotent for a once-scope badge, so awarding it
      // late is awarding it once.
      if (passes >= 1) await take("first_pass", "");
      if (passes >= 10) await take("ten_passes", "");
      if (passes >= 50) await take("fifty_passes", "");

      if (right === total) {
        const [{ perfects }] = await q(
          "SELECT count(*)::int AS perfects FROM quiz_rounds WHERE child_id=$1 AND passed AND correct=asked",
          [childId]);
        if (perfects >= 1) await take("first_perfect", "");
      }

      const [{ banks }] = await q(
        "SELECT count(DISTINCT bank_id)::int AS banks FROM quiz_rounds WHERE child_id=$1 AND passed", [childId]);
      if (banks >= 5) await take("five_banks", "");

      // Bounced back: the round immediately before this one, IN THIS BANK,
      // was a fail. Comparing to the round right before rather than "ever
      // failed this bank" is deliberate: it rewards the act of trying again
      // straight after a flop, not the mere fact of having once struggled.
      const [prev] = await q(
        `SELECT passed FROM quiz_rounds WHERE child_id=$1 AND bank_id=$2
          ORDER BY ts DESC OFFSET 1 LIMIT 1`, [childId, bank.id]);
      if (prev && !prev.passed) await take("comeback", "");

      // Read the study page for THIS bank before this round started. logRound
      // has already written this round, so "before" means before its own ts;
      // in practice that is always true for a visit that happened earlier in
      // the same request cycle, but the ts comparison keeps it honest anyway.
      const [visit] = await q(
        `SELECT 1 FROM quiz_study_visits WHERE child_id=$1 AND bank_id=$2
          AND ts < (SELECT ts FROM quiz_rounds WHERE child_id=$1 AND bank_id=$2 ORDER BY ts DESC LIMIT 1)
          LIMIT 1`, [childId, bank.id]);
      if (visit) await take("read_then_pass", bank.id, { bank_title: bank.title });

      // Mastered: every question this bank currently carries has been
      // answered correctly at least once, ever, by this child. A bank with
      // forty questions and ten-question rounds takes real breadth to clear,
      // which is the point: it pays for covering the material, not for
      // grinding the same round.
      const total_qs = (bank.questions || []).length;
      if (total_qs > 0) {
        const [{ covered }] = await q(
          `SELECT count(DISTINCT a.question_id)::int AS covered
             FROM quiz_answers a JOIN quiz_rounds r ON r.id = a.round_id
            WHERE r.child_id=$1 AND r.bank_id=$2 AND a.correct`, [childId, bank.id]);
        if (covered >= total_qs) await take("bank_mastered", bank.id, { bank_title: bank.title });
      }
    }

    // Tried something new: this is the first round this child has EVER
    // played of this bank, pass or fail. Effort is the badge, not the score,
    // which is why this check runs whether or not they passed.
    const [{ attempts }] = await q(
      "SELECT count(*)::int AS attempts FROM quiz_rounds WHERE child_id=$1 AND bank_id=$2", [childId, bank.id]);
    if (attempts >= 1) await take("explorer", bank.id, { bank_title: bank.title });

    const [{ week }] = await q(
      `SELECT COALESCE(SUM(minutes),0)::int AS week FROM time_events
        WHERE child_id=$1 AND kind='earn' AND ts > now() - interval '7 days'`, [childId]);
    if (week >= 60) await take("earn_hour_week", "");
  } catch (e) {
    console.error(`badge check failed for child ${childId}: ${e.message}`);
  }
  return won;
}

// ---------------------------------------------------------------------------
// Reading, for the kid's own board and the parent's screen.
// ---------------------------------------------------------------------------
// Every badge a child holds, newest first, with the shared definition
// merged in so a caller never has to know BADGES exists.
export async function childBadges(q, childId) {
  const rows = await q(
    "SELECT badge_id,scope,ts,meta FROM child_badges WHERE child_id=$1 ORDER BY ts DESC", [childId])
    .catch(() => []);
  return rows.map(r => ({ ...BY_ID.get(r.badge_id), scope: r.scope, ts: r.ts, meta: r.meta }))
    .filter(b => b.id);
}

export async function boardEnabled(q) {
  const [r] = await q("SELECT enabled FROM board_settings").catch(() => [{ enabled: false }]);
  return !!r?.enabled;
}

export async function setBoardEnabled(q, enabled, by) {
  await q(`UPDATE board_settings SET enabled=$1, updated_ts=now(), updated_by=$2 WHERE only_row`,
    [!!enabled, by || "dashboard"]);
}

// The household board. Every category is worked out fresh from the same
// history badges are checked against; nothing is pre-aggregated, because a
// household is small and this runs at most once per portal or dashboard
// load, not per quiz.
//
// Categories are picked, on purpose, so that being oldest or having the most
// spare time is not an advantage:
//   improved   biggest rise in pass rate between the last 14 days and the
//              14 days before that. A child already passing everything has
//              little room to "improve"; a child finding their feet has a
//              lot, which is exactly backwards from a raw score board.
//   explorer   distinct quiz banks tried in the last 30 days. Trying five
//              different banks costs a seven year old exactly the same
//              effort as a fifteen year old.
//   comeback   rounds in the last 30 days that followed a fail on the same
//              bank with a pass. A child who is finding things hard has MORE
//              chances at this one, not fewer.
//   reader     study-page visits in the last 30 days. Reading up costs
//              nothing to do and nothing to be good at.
// See docs/GAMIFICATION.md for the categories that were tried and dropped.
export async function boardData(q, kids) {
  if (!kids.length) return { categories: [] };
  const ids = kids.map(k => k.id);
  const name = new Map(kids.map(k => [k.id, k.name]));

  const [improvedRows, explorerRows, comebackRows, readerRows] = await Promise.all([
    q(`WITH w AS (
         SELECT child_id,
                count(*) FILTER (WHERE ts > now() - interval '14 days')                                   AS n_new,
                count(*) FILTER (WHERE ts > now() - interval '14 days' AND passed)                        AS p_new,
                count(*) FILTER (WHERE ts <= now() - interval '14 days' AND ts > now() - interval '28 days') AS n_old,
                count(*) FILTER (WHERE ts <= now() - interval '14 days' AND ts > now() - interval '28 days' AND passed) AS p_old
           FROM quiz_rounds WHERE child_id = ANY($1) GROUP BY child_id)
       SELECT child_id, (p_new::numeric / NULLIF(n_new,0)) - (p_old::numeric / NULLIF(n_old,0)) AS delta
         FROM w WHERE n_new >= 2 AND n_old >= 2`, [ids]).catch(() => []),
    q(`SELECT child_id, count(DISTINCT bank_id)::int AS n FROM quiz_rounds
        WHERE child_id = ANY($1) AND passed AND ts > now() - interval '30 days' GROUP BY child_id`,
      [ids]).catch(() => []),
    q(`WITH r AS (
         SELECT child_id, bank_id, passed, ts,
                lag(passed) OVER (PARTITION BY child_id, bank_id ORDER BY ts) AS prev_passed
           FROM quiz_rounds WHERE child_id = ANY($1) AND ts > now() - interval '30 days')
       SELECT child_id, count(*)::int AS n FROM r WHERE passed AND prev_passed = false GROUP BY child_id`,
      [ids]).catch(() => []),
    q(`SELECT child_id, count(*)::int AS n FROM quiz_study_visits
        WHERE child_id = ANY($1) AND ts > now() - interval '30 days' GROUP BY child_id`,
      [ids]).catch(() => []),
  ]);

  // Turn a list of {child_id, n} into a spotlight: whoever has the highest
  // n, ties included, everyone else's own number alongside with no ranking
  // language at all. A category with nobody past the threshold says so
  // plainly rather than crowning a winner on a technicality.
  const spotlight = (rows, valueKey, fmtValue) => {
    const withVal = rows.map(r => ({ id: r.child_id, name: name.get(r.child_id), v: Number(r[valueKey]) }))
      .filter(r => r.name && r.v > 0);
    if (!withVal.length) return { leaders: [], everyone: [] };
    const max = Math.max(...withVal.map(r => r.v));
    return {
      leaders: withVal.filter(r => r.v === max).map(r => ({ name: r.name, display: fmtValue(r.v) })),
      everyone: withVal.map(r => ({ name: r.name, display: fmtValue(r.v) })),
    };
  };

  const categories = [
    { id: "improved", title: "Most improved, last two weeks", emoji: "📈",
      ...spotlight(improvedRows.map(r => ({ child_id: r.child_id, n: r.delta })), "n",
        v => `${v >= 0 ? "+" : ""}${Math.round(v * 100)} pts`) },
    { id: "explorer", title: "Widest range of subjects, last month", emoji: "🗺️",
      ...spotlight(explorerRows, "n", v => `${v} bank${v === 1 ? "" : "s"}`) },
    { id: "comeback", title: "Best comebacks, last month", emoji: "🔁",
      ...spotlight(comebackRows, "n", v => `${v} comeback${v === 1 ? "" : "s"}`) },
    { id: "reader", title: "Keenest reader, last month", emoji: "📖",
      ...spotlight(readerRows, "n", v => `${v} read-up${v === 1 ? "" : "s"}`) },
  ].filter(c => c.leaders.length);   // a category with no data yet is left out, not shown empty

  return { categories };
}

// For the parent's screen: who has earned what, across every child, one
// query. earn.mjs turns this into a per-child list next to the badge's own
// title and emoji.
export async function allBadges(q, childIds) {
  if (!childIds.length) return [];
  const rows = await q(
    "SELECT child_id,badge_id,scope,ts,meta FROM child_badges WHERE child_id = ANY($1) ORDER BY ts DESC",
    [childIds]).catch(() => []);
  return rows.map(r => ({ ...BY_ID.get(r.badge_id), child_id: r.child_id, scope: r.scope, ts: r.ts, meta: r.meta }))
    .filter(b => b.id);
}

export { esc } from "./charts.mjs";
