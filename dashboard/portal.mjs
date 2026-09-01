// Kid portal for the Genkan island. Two jobs:
import { wordmarkSVG, KANJI_SVG, LOGO_CSS } from "./logo.mjs";
//  1. Captive portal: a blocked or out-of-time device's web traffic lands
//     here (nft redirect), OS captive-probes pop this page, and it explains
//     why instead of letting pages silently fail.
//  2. Learn-to-earn hub: quizzes that credit minutes instantly (graded
//     server-side, cooldown + daily cap so they cannot be ground) and chore
//     claims that wait for a parent's approval on the dashboard.
//     What is on offer is per child, and so is what it pays: the parent sets
//     that on the dashboard's /earn screen, and both sides read the same
//     task_offer_effective view, so a kid sees exactly what was configured.
//     A job marked "no approval needed" credits the moment they say they did
//     it, once a day, which is how a five minute shower is worth setting up.
// The portal only ever WRITES THE DATABASE. The gateway reconciles the
// firewall from the database every few seconds, so an earned unblock takes
// effect without the portal touching nft at all.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";
// Badges and the house board. All the logic lives there because the parent
// dashboard shows the same rows; this file only wires it to the kid's side.
import { BADGES, awardBadges, childBadges, boardEnabled, boardData, recordStudyVisit } from "./badges.mjs";
// The Learning home (/learn), the missed-questions list on a result page and
// practice rounds. A factory, because it needs page(), esc() and the shelf
// from this file and this file needs it back.
import { createLearn, kidYear, LEARN_CSS } from "./portal-learn.mjs";

const DEMO = process.env.GENKAN_DEMO === "1";
// The ?kid= override lets a parent see what a child sees. At home it is
// view-only: earning from somebody else's device would let one kid farm
// another's minutes, which is why a POST requires a real device match.
// The public demo has no real devices at all, and a portal you cannot play
// is not a demo of anything, so there the override may earn. Its database
// is invented and reseeded nightly, so there is nothing to farm.
const BIND = process.env.BIND || "127.0.0.1";   // container: 0.0.0.0 (its netns is the island)
const PORT = Number(process.env.PORT || 8890);  // container: 80
const QUIZ_DIR = process.env.QUIZ_DIR || path.join(import.meta.dirname, "..", "portal", "quizzes");
// The three earn numbers, as they were before a parent could set them. They
// are now the LAST fallback: earn_settings_effective answers first (per child,
// then per household), and these only apply if that view is not there.
const QUIZ_COOLDOWN_MIN = Number(process.env.QUIZ_COOLDOWN_MIN || 360); // per bank
const QUIZ_DAILY_CAP = Number(process.env.QUIZ_DAILY_CAP || 30);        // minutes/day from quizzes
const MASTERY_BONUS = 5;                                                // perfect round
// IN_CONTAINER is set by compose.yaml: containers reach Postgres by its
// docker-network name, host processes via the published localhost port.
const pool = new pg.Pool({ connectionString: process.env.IN_CONTAINER ? process.env.KIDS_DB_URL_DOCKER : process.env.KIDS_DB_URL });
const q = (t, p) => pool.query(t, p).then(r => r.rows);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- quiz banks: two shelves, one list ------------------------------------
// Answers never leave the server, whichever shelf a bank came off.
//
//   files     portal/quizzes/*.json, shipped with Genkan and installed by
//             `genkan-quiz install`. SIGHUP re-reads the directory, so a new
//             one appears without dropping anyone's in-flight round.
//   database  quiz_banks / quiz_bank_questions, written by a parent on the
//             dashboard's /earn screen. They live in the database on purpose:
//             portal/quizzes is tracked in git, so a `git pull` would happily
//             delete a family's own content. Polled every half minute, so a
//             bank a parent finishes on the couch is on the kids' list without
//             anyone restarting anything.
//
// A file bank wins a clash of ids. The dashboard will not create a bank whose
// id is already on the shelf, so a clash means a file was installed over the
// top of a database bank, and installing a file is the more deliberate act.
//
// Size rule, and it differs by shelf on purpose. A file bank needs four
// rounds' worth of questions (tools/validate-quizzes.mjs enforces it, and that
// is unchanged). A database bank goes live once it holds one full round,
// because a parent who has written twelve good questions should not be told to
// write twenty-eight more before their kid sees any of them. A small bank
// repeats itself, and the dashboard says so on the bank's own card.
const banks = new Map();
const fileBanks = new Map();
let dbBanks = new Map();
function mergeBanks() {
  banks.clear();
  for (const [id, b] of fileBanks) banks.set(id, b);
  for (const [id, b] of dbBanks) {
    if (banks.has(id)) { console.error(`quiz bank ${id}: a file bank already has that id, the database copy is ignored`); continue; }
    banks.set(id, b);
  }
}
function loadFileBanks() {
  fileBanks.clear();
  for (const f of readdirSync(QUIZ_DIR).filter(f => f.endsWith(".json"))) {
    try {
      const b = JSON.parse(readFileSync(path.join(QUIZ_DIR, f), "utf8"));
      if (b.id && Array.isArray(b.questions) && b.questions.length >= 4 * (b.questions_per_round || 10)) fileBanks.set(b.id, b);
      else console.error(`quiz bank ${f}: skipped (shape/size)`);
    } catch (e) { console.error(`quiz bank ${f}: ${e.message}`); }
  }
  mergeBanks();
  console.log(`portal: ${fileBanks.size} file banks, ${dbBanks.size} of your own, ${banks.size} on the list`);
}
// Cheap signature of the database shelf, so the poll below only rebuilds when
// something actually changed.
let dbSig = "";
async function loadDbBanks(force) {
  try {
    const [sig] = await q(`SELECT count(*)::int AS banks, coalesce(max(updated_ts)::text,'') AS t,
        (SELECT count(*) FROM quiz_bank_questions)::int AS qs,
        (SELECT coalesce(max(updated_ts)::text,'') FROM quiz_bank_questions) AS qt FROM quiz_banks`);
    const now = `${sig.banks}|${sig.t}|${sig.qs}|${sig.qt}`;
    if (!force && now === dbSig) return;
    dbSig = now;
    const rows = await q(`SELECT id,title,emoji,suggested_age_min,minutes_per_pass,pass_mark,questions_per_round
        FROM quiz_bank_summary WHERE active AND questions >= questions_per_round ORDER BY id`);
    const qs = await q(`SELECT bank_id,question_id,prompt,choices,answer_index,difficulty,explanation
        FROM quiz_bank_questions ORDER BY bank_id, seq, question_id`);
    const next = new Map();
    for (const b of rows) next.set(b.id, { ...b, questions: [] });
    for (const r of qs) {
      const b = next.get(r.bank_id);
      if (!b) continue;
      b.questions.push({ id: r.question_id, prompt: r.prompt, choices: r.choices,
        answer_index: r.answer_index, difficulty: r.difficulty ?? undefined, explanation: r.explanation || "" });
    }
    // The read-first material an installed community package carries. Kept as
    // a separate query on purpose: quiz_packages may simply not exist on an
    // install that has not loaded schema-packages.sql, and a bank without a
    // read-first is exactly as playable as it was before.
    try {
      for (const r of await q(`SELECT bank_id, read_first FROM quiz_packages WHERE read_first IS NOT NULL`)) {
        const b = next.get(r.bank_id);
        if (b) b.read_first = r.read_first;
      }
    } catch { /* no packages table: nothing to add */ }
    dbBanks = next;
    mergeBanks();
    console.log(`portal: ${banks.size} quiz banks on the list (${dbBanks.size} written on the dashboard)`);
  } catch (e) {
    // The table may simply not be loaded yet on an older install. File banks
    // keep working, which is the behaviour this portal has always had.
    if (dbSig !== "unavailable") { dbSig = "unavailable"; console.error(`portal: quiz_banks not readable (${e.message}); file banks only`); }
  }
}
function loadBanks() { loadFileBanks(); loadDbBanks(true); }
loadFileBanks();
loadDbBanks(true);
setInterval(() => loadDbBanks(false), 30_000).unref();
process.on("SIGHUP", loadBanks);

// ---- the rules of earning -------------------------------------------------
// The cooldown, the daily cap and the perfect-round bonus used to be constants
// in this file. They are now per household and per child, set on the
// dashboard, resolved once by earn_settings_effective. The constants below are
// still the fallback, so a household that never opens that screen, or has not
// loaded schema-quizbanks.sql, behaves exactly as it always did.
const EARN_FALLBACK = { quiz_cooldown_min: QUIZ_COOLDOWN_MIN, quiz_daily_cap_min: QUIZ_DAILY_CAP,
                        mastery_bonus_min: MASTERY_BONUS, default_minutes_per_pass: 10 };
async function earnSettings(childId) {
  try {
    const [r] = await q(`SELECT quiz_cooldown_min, quiz_daily_cap_min, mastery_bonus_min, default_minutes_per_pass
        FROM earn_settings_effective WHERE child_id=$1`, [childId]);
    return r ? { ...EARN_FALLBACK, ...r } : EARN_FALLBACK;
  } catch { return EARN_FALLBACK; }
}

// Active rounds live in memory: token -> {childId, bankId, questions:[{qid, answer}], expires}.
// Lost on restart, which only means "start the round again". Nothing secret persists.
const rounds = new Map();
const newToken = () => randomBytes(16).toString("hex");
setInterval(() => { const now = Date.now(); for (const [t, r] of rounds) if (r.expires < now) rounds.delete(t); }, 60_000).unref();

// A device is WHO ITS IP SAYS IT IS. The ?kid= override is preview only: it is
// honoured just when the source IP maps to no child (admin on the tailnet, or
// pre-hardware testing), never to let one kid act as another. Returns the
// child plus whether this was a real device match (POSTs require that).
// Set by the dashboard when it links a parent to a child's portal view. It is
// absent from the household's own portal container, so a device on the island
// cannot use the override at all, which is the point.
const PREVIEW_TOKEN = process.env.PORTAL_PREVIEW_TOKEN || "";
let PREVIEW_OK = false;
async function whoIs(ip, override) {
  // notes rides along for the Learning home, which reads "Year 7" out of it
  // when a household has written that there (portal-learn.mjs, kidYear).
  const [byIp] = await q("SELECT c.id,c.name,c.age,c.notes FROM children c JOIN devices d ON d.child_id=c.id WHERE host(d.reserved_ip)=$1 LIMIT 1", [ip]);
  if (byIp) return { ...byIp, real: true };
  // The ?kid= override is a parent's preview, not something a device on the
  // island may use. Any unrecognised device could name any child and read
  // their minutes, tasks and history: no writes, but a sibling on a new phone
  // could see exactly how much time you had left, which is the sort of thing
  // siblings do. It now needs the preview token, which only the dashboard
  // holds, or the demo flag, where the household is invented anyway.
  if (override && (DEMO || PREVIEW_OK)) {
    const [o] = await q("SELECT id,name,age,notes FROM children WHERE lower(name)=lower($1)", [override]);
    if (o) return { ...o, real: false };
  }
  return null;
}
async function status(childId) {
  const [rem] = await q("SELECT * FROM time_remaining WHERE child_id=$1", [childId]);
  const cats = await q("SELECT category,set_by FROM category_state WHERE child_id=$1 AND blocked", [childId]);
  // The slow lane, and how slow it is, so the page can say plainly what is
  // happening. Caught rather than joined: a box that has not been given
  // schema-slow.sql yet still serves the portal, it simply never mentions it.
  const slow = await q("SELECT category,set_by FROM slow_lane_children WHERE child_id=$1", [childId]).catch(() => []);
  const slowSet = await q("SELECT rate_kbit, on_timeout FROM slow_settings").catch(() => []);
  // The jobs THIS child is offered, at what THEY are paid for them. The view
  // works the rule out once (schema-tasks.sql) so the dashboard and the portal
  // can never disagree about what is on offer.
  const tasks = await q(`SELECT task_id AS id, name, emoji, minutes, needs_approval
      FROM task_offer_effective WHERE child_id=$1 AND offered
     ORDER BY needs_approval, minutes DESC, name`, [childId]);
  const quiz = await q("SELECT bank_id, enabled, minutes FROM quiz_settings WHERE child_id=$1", [childId]);
  const claims = await q("SELECT ec.task_id, ec.status FROM earn_claims ec WHERE ec.child_id=$1 AND ec.ts::date=CURRENT_DATE", [childId]);
  const quizToday = await q(`SELECT COALESCE(SUM(minutes),0) m FROM time_events
    WHERE child_id=$1 AND kind='earn' AND reason LIKE 'quiz:%' AND ts::date=CURRENT_DATE`, [childId]);
  const lastPass = await q(`SELECT reason, max(ts) t FROM time_events
    WHERE child_id=$1 AND kind='earn' AND reason LIKE 'quiz:%' GROUP BY reason`, [childId]);
  const set = await earnSettings(childId);
  // When the internet goes off tonight and when it comes back. A child who can
  // see "off at nine, back at seven" is being treated fairly; one who just gets
  // cut off is being punished by a machine. Guarded, because a box whose
  // database has not been given schema-schedule.sql yet must still serve the
  // portal, it simply has nothing to say about bedtime.
  const [bed] = await q(`SELECT starts_at, ends_at, in_window, extended
                           FROM schedule_next WHERE child_id=$1`, [childId]).catch(() => []);
  return { rem, cats, slow, slowKbit: Number(slowSet[0]?.rate_kbit || 0), tasks, claims, set, bed, quizEarnedToday: Number(quizToday[0]?.m || 0),
           quiz: Object.fromEntries(quiz.map(r => [r.bank_id, r])),
           lastPassAt: Object.fromEntries(lastPass.map(r => [r.reason.slice(5), new Date(r.t).getTime()])) };
}
// What a pass is worth to this child: their own price if a parent set one on
// the dashboard, otherwise the bank's own. A bank switched off for them is not
// on their list at all.
const quizOn = (st, bank) => st.quiz?.[bank.id]?.enabled !== false;
const quizMinutes = (st, bank) => st.quiz?.[bank.id]?.minutes ?? (bank.minutes_per_pass || st.set?.default_minutes_per_pass || 10);
// Mirrors kidnet's ensure_day: weekend days get the weekend budget.
async function ensureDay(childId) {
  await q(`INSERT INTO time_ledger(child_id,day,budget_min)
    SELECT c.id, CURRENT_DATE, COALESCE(CASE WHEN EXTRACT(ISODOW FROM CURRENT_DATE) IN (6,7)
      THEN p.daily_budget_weekend_min ELSE p.daily_budget_school_min END, 999)
    FROM children c JOIN policies p ON p.tier=c.policy_tier WHERE c.id=$1
    ON CONFLICT DO NOTHING`, [childId]);
}
async function credit(childId, minutes, reason) {
  await ensureDay(childId);
  await q("UPDATE time_ledger SET bonus_min=bonus_min+$2 WHERE child_id=$1 AND day=CURRENT_DATE", [childId, minutes]);
  await q("INSERT INTO time_events(child_id,minutes,kind,reason,by) VALUES($1,$2,'earn',$3,'portal')", [childId, minutes, reason]);
  // Out of time and now positive again? Clear the block in the DB; the
  // gateway's reconciler reopens the firewall within seconds.
  const [r] = await q("SELECT remaining_min FROM time_remaining WHERE child_id=$1", [childId]);
  if ((r?.remaining_min ?? 0) > 0) {
    // Lifts EITHER shape of "out of time": the hard cut, or the slow lane a
    // household that chose the slope gets instead. Still only the state that
    // running out of time put there, so a bedtime cannot be bought back. The
    // fallback is for a box whose database has not been given schema-slow.sql.
    const upd = await pool.query(`UPDATE category_state SET blocked=false, speed='full', since=now(), set_by='earned-back'
      WHERE child_id=$1 AND category='internet' AND (blocked OR speed='slow')
        AND set_by IN ('out-of-time','earned-back')`, [childId])
      .catch(() => pool.query(`UPDATE category_state SET blocked=false, since=now(), set_by='earned-back'
        WHERE child_id=$1 AND category='internet' AND blocked
          AND set_by IN ('out-of-time','earned-back')`, [childId]));
    if (upd.rowCount > 0)
      await q("INSERT INTO block_events(target_type,target_ref,action,source,actor) VALUES('child',(SELECT name FROM children WHERE id=$1),'on','earn','portal')", [childId]);
  }
}

// ---- the difficulty ramp --------------------------------------------------
// The headline of a Genkan quiz is not the marking, it is the shape of the
// round. A round opens with questions this kid can definitely answer and gets
// harder as it goes, so the feeling is "I am getting somewhere", not "this is
// not for me". A kid who gives up at question one learns nothing and earns
// nothing.
//
// Two things drive it: the per-question `difficulty` (1 warm-up to 5 stretch,
// see portal/quizzes/FORMAT.md) and how this kid has actually been going
// lately (quiz_rounds / quiz_answers, see config/db/schema-quizresults.sql).
//
// Banks with no difficulty data are sampled exactly the way they always were:
// flat random. Nothing needs backfilling and nothing breaks.
const DIFFICULTY_DEFAULT = 3;                        // an unlabelled question in a labelled bank
const qLevel = qq => (Number.isInteger(qq.difficulty) && qq.difficulty >= 1 && qq.difficulty <= 5) ? qq.difficulty : null;
const lvlOf = qq => qLevel(qq) || DIFFICULTY_DEFAULT;
// Ramped only if most of the bank is labelled. A bank where someone labelled
// six questions and stopped would build a lopsided ramp, so it is treated as
// unlabelled instead. Cached on the bank object; loadBanks() re-reads the file.
function isRamped(bank) {
  if (bank._ramped === undefined) {
    const n = bank.questions.filter(qLevel).length;
    bank._ramped = n > 0 && n * 2 >= bank.questions.length;
  }
  return bank._ramped;
}
// How a round is weighted across difficulty 1..5, and the level this kid is
// already comfortable at. `comfort` is the passability floor: at least
// pass_mark questions in every round sit at or below it, so a round is always
// winnable. Stretch, never sink.
const RAMP = {
  building:  { weights: [0.35, 0.30, 0.20, 0.10, 0.05], comfort: 2 },
  steady:    { weights: [0.20, 0.25, 0.30, 0.15, 0.10], comfort: 3 },
  confident: { weights: [0.10, 0.15, 0.25, 0.30, 0.20], comfort: 4 },
};
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Which mix this kid gets. Recent rounds in THIS bank count double, because
// "good at times tables" says little about how they will go at chess. A kid
// with no history at all gets the steady mix, which still opens with warm-ups.
// Any DB trouble here falls back to steady: a reporting table must never stand
// between a kid and their quiz.
async function rampProfile(childId, bankId) {
  try {
    const rows = await q(`SELECT asked, correct, passed, (bank_id = $2) AS same_bank
      FROM quiz_rounds WHERE child_id = $1 AND ts > now() - interval '30 days'
      ORDER BY ts DESC LIMIT 8`, [childId, bankId]);
    if (!rows.length) return "steady";
    let asked = 0, right = 0;
    rows.forEach((r, i) => {
      const w = (r.same_bank ? 2 : 1) * (1 - i * 0.08);   // newer rounds count for more
      asked += w * Number(r.asked); right += w * Number(r.correct);
    });
    const acc = asked ? right / asked : 0.7;
    // A round they just failed outranks the average: today is what they feel.
    if (!rows[0].passed || acc < 0.65) return "building";
    return acc >= 0.85 ? "confident" : "steady";
  } catch { return "steady"; }
}

// Turn weights into whole questions, largest-remainder so the counts add up.
function quotas(weights, n) {
  const raw = weights.map(w => w * n);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  let left = n - out.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]]++;
  return out;
}

// Build one round: fill the quota per level, cover any shortfall from the
// EASIEST level that still has questions (never the hardest), make sure it is
// passable, then sort easy to hard so the kid meets it as a ramp.
function rampedPick(bank, profile) {
  const n = Math.min(bank.questions_per_round || 10, bank.questions.length);
  const pools = [[], [], [], [], []];
  for (const qq of bank.questions) pools[lvlOf(qq) - 1].push(qq);
  pools.forEach(shuffle);

  const quota = quotas(RAMP[profile].weights, n);
  const picked = [];
  const takeFrom = lvl => { const p = pools[lvl - 1]; if (!p.length) return false; picked.push(p.pop()); return true; };
  for (let lvl = 1; lvl <= 5; lvl++) for (let k = 0; k < quota[lvl - 1]; k++) if (!takeFrom(lvl)) break;
  while (picked.length < n) {
    let got = false;
    for (let lvl = 1; lvl <= 5 && !got; lvl++) got = takeFrom(lvl);
    if (!got) break;                                   // bank smaller than the round
  }

  // Passability guard. At least pass_mark of the round must sit at or below
  // the level this kid is comfortable with, so the ramp can never hand them a
  // round they had no way of winning. Swap the hardest picks down until it
  // holds, or until the bank runs out of easy questions.
  const { comfort } = RAMP[profile];
  const need = Math.min(bank.pass_mark || 8, n);
  let easyEnough = picked.filter(qq => lvlOf(qq) <= comfort).length;
  while (easyEnough < need) {
    let swapIn = null;
    for (let lvl = 1; lvl <= comfort && !swapIn; lvl++) if (pools[lvl - 1].length) swapIn = pools[lvl - 1].pop();
    if (!swapIn) break;
    let worst = 0;
    picked.forEach((qq, i) => { if (lvlOf(qq) > lvlOf(picked[worst])) worst = i; });
    picked[worst] = swapIn;
    easyEnough++;
  }
  return picked.sort((a, b) => lvlOf(a) - lvlOf(b));    // the ramp itself
}

// Every graded round is written down, pass or fail, so the next one can be
// built for this kid. Best effort on purpose: if schema-quizresults.sql has
// not been loaded, kids still take quizzes and still earn, they just get the
// flat round. Bookkeeping never costs a kid their minutes.
async function logRound(round, right, minutes, passed) {
  try {
    const levels = round.questions.map(x => x.difficulty).filter(Number.isInteger);
    const avg = levels.length ? (levels.reduce((a, b) => a + b, 0) / levels.length).toFixed(2) : null;
    const [r] = await q(`INSERT INTO quiz_rounds(child_id,bank_id,asked,correct,passed,minutes,profile,avg_difficulty)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [round.childId, round.bankId, round.questions.length, right, passed, minutes, round.profile, avg]);
    for (const [i, x] of round.questions.entries())
      await q("INSERT INTO quiz_answers(round_id,seq,question_id,difficulty,correct) VALUES($1,$2,$3,$4,$5)",
        [r.id, i, x.qid, Number.isInteger(x.difficulty) ? x.difficulty : null, !!x.got]);
  } catch (e) { console.error(`quiz result not logged: ${e.message}`); }
}

// ---- pages ---------------------------------------------------------------
const CSS = `body{margin:0;min-height:100vh;background:linear-gradient(160deg,#4c1d95,#1e3a8a);color:#fff;
 font-family:system-ui,sans-serif;padding:20px;display:flex;justify-content:center}
.wrap{max-width:520px;width:100%}
.card{background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:20px;margin-bottom:14px;backdrop-filter:blur(8px)}
h1{font-size:26px;margin:0 0 4px}.who{opacity:.85;font-size:14px;margin-bottom:8px}
.rem{font-size:44px;font-weight:800}.rem small{font-size:15px;font-weight:400;opacity:.8}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;margin:0 0 10px}
.qcard{display:flex;align-items:center;gap:12px;background:rgba(0,0,0,.22);border-radius:12px;padding:12px 14px;margin-bottom:8px;color:#fff;text-decoration:none}
.qcard .e{font-size:26px}.qcard b{font-size:15px}.qcard .m{margin-left:auto;font-size:13px;opacity:.85;white-space:nowrap}
.qcard.dim{opacity:.5}.small{font-size:12px;opacity:.75;line-height:1.6}
.q{background:rgba(0,0,0,.22);border-radius:12px;padding:14px;margin-bottom:10px}
.q p{margin:0 0 10px;font-size:16px}
label{display:block;background:rgba(255,255,255,.08);border-radius:9px;padding:9px 12px;margin-bottom:6px;font-size:15px;cursor:pointer}
label:has(input:checked){background:rgba(255,255,255,.28)}
input[type=radio]{margin-right:9px}
button.go{width:100%;background:#4ade80;color:#14532d;border:0;font-weight:700;font-size:16px;padding:13px;border-radius:10px;cursor:pointer}
.score{font-size:40px;font-weight:800;text-align:center}.msg{text-align:center;font-size:16px;margin:8px 0}
a.back{color:#c4b5fd}.foot{margin-top:6px;font-size:12px;opacity:.7;line-height:1.6}
.claimbtn{background:#c4b5fd;color:#312e81;border:0;border-radius:9px;padding:8px 12px;font-weight:600;cursor:pointer;font-size:13px}
.pill{font-size:12px;background:rgba(255,255,255,.2);border-radius:9px;padding:4px 10px}
.warm p{font-size:16px;line-height:1.55;margin:0 0 12px}.warm p:last-child{margin-bottom:0}
.warm .lead{font-size:17px}.warm b{color:#fde68a}
.helplines{background:rgba(0,0,0,.22);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.7}`;
// The public demo serves this page to strangers, and a screenshot of it would
// otherwise look like a real child's screen. Say what it is, at the top, every
// time. Nothing renders at home, where DEMO is unset.
const DEMO_NOTE = DEMO
  ? `<div style="max-width:520px;margin:0 auto 14px;padding:11px 15px;border-radius:14px;
       background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.28);
       font:600 14px/1.45 system-ui,sans-serif;color:#fff">
       Demo. An invented family, made-up minutes, nobody's real child.
       The quizzes work: pass a round and watch the clock change.
     </div>`
  : "";
const STUDY_CSS = `
.qrow{display:flex;align-items:stretch;gap:8px}
.qrow .qcard{flex:1}
.study-link{flex:none;display:flex;align-items:center;padding:0 13px;border-radius:14px;
  background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.20);
  color:#fff;text-decoration:none;font-weight:600;font-size:14px;white-space:nowrap}
.study-link:hover{background:rgba(255,255,255,.18)}
.more-q{margin-top:8px}
.more-q>summary{list-style:none;cursor:pointer;padding:10px 12px;border-radius:13px;
  background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.28);
  font-weight:600;text-align:center}
.more-q>summary::-webkit-details-marker{display:none}
.more-q[open]>summary{margin-bottom:8px}
.badge-teaser{display:inline-block;margin-top:10px;padding:7px 13px;border-radius:11px;
  background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.24);
  color:#fff;text-decoration:none;font-weight:600;font-size:14px}
.badges{display:flex;flex-direction:column;gap:9px;margin-top:8px}
.badge{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:13px;
  background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.16)}
.badge.todo{opacity:.55}
.badge .b-e{font-size:24px;flex:none}
.badge .b-t{display:flex;flex-direction:column}
.badge .b-t small{opacity:.8;font-size:13px;line-height:1.35}
.b-cat{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.14)}
.b-cat:last-of-type{border-bottom:0}
.b-cat-t{font-size:12.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.75}
.b-lead{font-weight:700;margin-top:3px}
.b-lead small{display:block;font-weight:400;opacity:.8;font-size:13px}
.b-rest{opacity:.7;font-size:13.5px;margin-top:4px}
.study{margin-top:6px}
.s-q{padding:13px 0;border-bottom:1px solid rgba(255,255,255,.14)}
.s-q:last-child{border-bottom:0}
.s-p{margin:0 0 6px;font-weight:600;line-height:1.45}
.s-a{margin:0;display:inline-block;background:rgba(255,255,255,.20);
  border-radius:9px;padding:4px 11px;font-weight:700}
.s-e{margin:7px 0 0;opacity:.85;line-height:1.5}
.rf{margin:0 0 14px;padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.16)}
.rf h2{font-size:18px;margin:0 0 8px}
.rf p{margin:0 0 9px;line-height:1.55}
.rf p:last-child{margin-bottom:0}
.rf .rf-l{font-size:13.5px;opacity:.9}
.rf .rf-l a{color:#c4b5fd;margin-right:12px;display:inline-block}
`;
// Every portal page opens with the lockup, so the kid's side wears the same
// face as everything else. Small and calm: this page is for reading.
const LOCKUP = `<div class="lockup-line">${KANJI_SVG}${wordmarkSVG()}</div>`;
const LOCKUP_CSS = `
.lockup-line{display:flex;align-items:center;gap:10px;padding:2px 2px 12px}
.lockup-line .lgk{width:24px;height:22px;color:#f2b95e;
  filter:drop-shadow(0 0 6px rgba(242,185,94,.35))}
.lockup-line .lgm{height:17px}
/* The portal lives in its own purple world in both OS themes, so the shared
   light and dark band ramps both disappear into it. Its own ramp: white down
   through the portal's lavenders to an amber base that echoes the kanji. */
.lockup-line .lg0{fill:#ffffff}.lockup-line .lg1{fill:#f3efff}
.lockup-line .lg2{fill:#e4dbfe}.lockup-line .lg3{fill:#d3c5fd}
.lockup-line .lg4{fill:#c4b5fd}.lockup-line .lg5{fill:#b5a3f9}
.lockup-line .lg6{fill:#a68ff5}.lockup-line .lg7{fill:#9a7df0}
.lockup-line .lg8{fill:#f2b95e}
`;
// The demo's child switcher. A visiting parent should be able to flip between
// the invented children and see each one's page, and Tim's first note on the
// live demo was that he could only ever see one child. It renders ONLY under
// the demo flag: at home the child is whoever the device belongs to, and a
// page that let a child pick a sibling would let them read that sibling's
// minutes, which is exactly what whoIs() refuses. The list is re-read every
// minute so a reseed shows up without a restart.
let demoKids = [];
async function loadDemoKids() {
  if (!DEMO) return;
  try {
    demoKids = await q(`SELECT name, age, notes FROM children
       WHERE kind='child' AND active ORDER BY age DESC, name`);
  } catch { /* an older schema without kind/active: keep whatever we had */ }
}
if (DEMO) { loadDemoKids(); setInterval(loadDemoKids, 60_000).unref(); }
const DEMO_BAR_CSS = `
.demo-bar{max-width:520px;margin:0 auto 14px;display:flex;align-items:center;gap:7px;flex-wrap:wrap;font:14px system-ui,sans-serif}
.demo-bar .lbl{opacity:.8;margin-right:2px}
.demo-bar a{display:inline-block;padding:7px 12px;border-radius:11px;color:#fff;text-decoration:none;font-weight:600;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22)}
.demo-bar a.on{background:rgba(255,255,255,.30);border-color:rgba(255,255,255,.5)}
.demo-bar a small{font-weight:400;opacity:.8;margin-left:5px}
.demo-bar a.learn{margin-left:auto;background:rgba(74,222,128,.18);border-color:rgba(74,222,128,.5)}`;
function demoBar(ctx) {
  if (!DEMO || !demoKids.length) return "";
  const path = ctx?.path === "/learn" ? "/learn" : "/";
  const cur = String(ctx?.kid?.name || "").toLowerCase();
  const pill = k => {
    const y = kidYear(k);
    return `<a class="${k.name.toLowerCase() === cur ? "on" : ""}" href="${path}?kid=${encodeURIComponent(k.name)}">${esc(k.name)}<small>${
      y ? `Year ${y.year}` : esc(k.age ? k.age + "" : "")}</small></a>`;
  };
  return `<div class="demo-bar"><span class="lbl">See it as</span>${demoKids.map(pill).join("")}${
    ctx?.kid ? `<a class="learn" href="/learn?kid=${encodeURIComponent(ctx.kid.name)}">📚 Learning by year</a>` : ""}</div>`;
}
// ctx is optional: {kid, path} for the pages that know who they are for,
// used only by the demo's switcher. Nothing at home reads it.
const page = (body, ctx) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${DEMO ? "Genkan demo" : "Genkan"}</title><style>${CSS}${STUDY_CSS}${LEARN_CSS}${LOGO_CSS}${LOCKUP_CSS}${DEMO_BAR_CSS}</style><div class="wrap">${DEMO_NOTE}${demoBar(ctx)}${LOCKUP}${body}</div>`;

const learn = createLearn({ q, page, esc, banks, quizOn, quizMinutes, demo: DEMO });
// ---------------------------------------------------------------------------
// Claiming a device
// ---------------------------------------------------------------------------
// A device nobody has claimed gets DNS, this page and the safety net, and
// nothing else (docs/DEVICE-IDENTITY.md). This is the page that lets a child
// out of that, by saying who they are.
//
// It is claiming, not proving. So the design makes lying pointless rather than
// hard: a self-claim grants the TIGHTEST tier in the house until a parent
// confirms it. Otherwise the obvious move is to claim as whichever sibling has
// the loosest limits, which in a normal household is the eldest, and a
// younger child would gain unlimited time by tapping a different name.
//
// The optional PIN buys convenience, not security: with the right one, the
// claim takes effect immediately at that child's own tier instead of waiting
// for a parent. That is the honest framing, and it means a shared PIN costs
// very little, because sharing it only skips a wait.
// What a claim actually grants. The whole security argument lives here.
//
// Without a PIN the device is bound to the named child but STAYS restricted
// until a parent confirms on the dashboard. Not "restricted to the tightest
// filter level": a time budget belongs to a child rather than a device, so a
// younger child naming the eldest would still inherit her clock, and in a
// normal household the eldest is the one with no daily limit. Unlimited time
// is exactly the prize worth lying for, so the claim must grant nothing at all
// until a parent says yes. Then there is no reward for lying, and no arms race.
//
// With the right PIN the claim takes effect immediately at that child's own
// tier. A wrong PIN is recorded and refused: a parent should be able to see
// that somebody tried.
async function doClaim(dev, ip, form) {
  const childId = Number(form.get("child"));
  const pin = String(form.get("pin") || "").trim();
  if (!Number.isInteger(childId) || childId <= 0) return claimPage(dev?.mac, ip, dev?.hostname, "Pick a name first.");
  const [child] = await q(`SELECT id, name, policy_tier, claim_pin FROM children
     WHERE id=$1 AND kind IN ('child','guest-child') AND active`, [childId]);
  if (!child) return claimPage(dev?.mac, ip, dev?.hostname, "That is not somebody Genkan knows.");

  const log = (outcome, cid) => q(`INSERT INTO device_claims(mac,ip,child_id,hostname,outcome)
      VALUES($1,$2,$3,$4,$5)`, [dev?.mac || null, ip, cid, dev?.hostname || null, outcome]).catch(() => {});

  if (child.claim_pin) {
    if (!pin) return claimPage(dev?.mac, ip, dev?.hostname, `${child.name} has a PIN. Put it in and tap your name again.`);
    if (!(await pinMatches(pin, child.claim_pin))) {
      await log("wrong-pin", child.id);
      return claimPage(dev?.mac, ip, dev?.hostname, "That PIN is not right. Try again, or ask a grown-up.");
    }
  }

  // Bind the device. `claim_pending` decides whether it runs at the child's own
  // level or at the house's tightest until a parent says yes.
  const confirmed = Boolean(child.claim_pin);
  await q(`UPDATE devices SET child_id=$2, claim_pending=$3
            WHERE host(reserved_ip)=$1`, [ip, child.id, !confirmed]);
  await log("claimed", child.id);

  return page(`<div class="card">
    <h1>Kia ora ${esc(child.name)}</h1>
    <div class="msg">${confirmed
      ? "This device is yours now, and your time is already on it."
      : "Noted, thank you. A grown-up sees this on their screen and can say yes, and then your time is on it."}</div>
    <p><a class="back" href="/">Go to my page</a></p></div>`);
}

// A PIN is a shared secret between a child and their parent, not a password,
// so this is a digest with a salt and nothing more elaborate. It stops somebody
// reading PINs out of the database; it does not pretend to resist an offline
// attack on a four-digit number, and nothing could.
async function pinMatches(given, stored) {
  const [salt, want] = String(stored).split(":");
  if (!salt || !want) return false;
  const got = createHash("sha256").update(salt + ":" + given).digest("hex");
  return got === want;
}

async function claimPage(mac, ip, hostname, msg) {
  const kids = await q(`SELECT id, name FROM children
     WHERE kind IN ('child','guest-child') AND active ORDER BY name`);
  const anyPin = (await q("SELECT count(*)::int n FROM children WHERE claim_pin IS NOT NULL"))[0]?.n > 0;
  // The device's own name is a hint worth using: it makes the common case one
  // tap. It is set by whoever holds the phone, so it is never the answer.
  const h = (hostname || "").toLowerCase().replace(/[^a-z]/g, "");
  const guess = kids.find(k => h.includes(k.name.toLowerCase())) || null;
  const btn = k => `<button class="opt" name="child" value="${k.id}">${esc(k.name)}${
    guess && guess.id === k.id ? ' <span class="hint">looks like you</span>' : ""}</button>`;
  return page(`<div class="card">
    <h1>Whose device is this?</h1>
    <div class="who">This one is new here, so it has the internet switched off until
      somebody says who it belongs to. Tap your name.</div>
    ${msg ? `<div class="msg">${esc(msg)}</div>` : ""}
    <form method="post" action="/claim-device">
      <div class="opts">${kids.map(btn).join("")}</div>
      ${anyPin ? `<label class="pin">Your PIN, if you have one
        <input name="pin" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="optional"></label>` : ""}
    </form>
    <div class="foot">${esc(hostname || "this device")} is asking. If that is not your
      device, leave it alone and tell a grown-up.</div></div>`);
}

// ---------------------------------------------------------------------------
// The study page
// ---------------------------------------------------------------------------
// Every question in every bank already carries an explanation. All 429 of
// them. Until now a child never saw one unless they got the question wrong,
// which means the material to learn from was sitting in the database being
// used only to mark homework.
//
// This turns a bank into something you can read before you answer it. It is
// not a substitute for going and reading properly, which is what the learn
// allowlist is for, but it means a child who scored three out of ten has
// somewhere to go that is not "try again and hope".
// The optional short read a community package can carry
// (config/db/schema-packages.sql, docs/CONTRIBUTING-CONTENT.md). Text and
// links only, and the links can only point at the reading list, because a
// child on the study page is usually a child who has run out of time and a
// link to anywhere else would be a dead end at the worst moment.
// Every field is escaped here exactly like a question prompt. It is a
// stranger's text: tools/validate-package.mjs refuses markup on the way in,
// and this refuses to trust that.
function readFirstBlock(bank) {
  const r = bank.read_first || (bank.package && bank.package.read_first);
  if (!r || !Array.isArray(r.body) || !r.body.length) return "";
  const links = Array.isArray(r.links) && r.links.length
    ? `<p class="rf-l">${r.links.map(l => `<a href="${esc(l.url)}" rel="noreferrer noopener">${esc(l.label)}</a>`).join("")}</p>`
    : "";
  return `<div class="rf"><h2>${esc(r.title || "Read this first")}</h2>`
    + r.body.map(t => `<p>${esc(t)}</p>`).join("") + links + `</div>`;
}

// `st` is the child's status, so the page can say what a pass is worth and
// whether the bank is ready, in the same words as the hub. Absent (an older
// caller), the page still reads fine, it just does not name a price.
function studyPage(bank, kidQS, st, ctx) {
  const items = (bank.questions || []).map((q, i) => {
    const ans = (q.choices || [])[q.answer_index];
    return `<div class="s-q">
      <p class="s-p"><b>${i + 1}.</b> ${esc(q.prompt)}</p>
      <p class="s-a">${esc(ans ?? "")}</p>
      ${q.explanation ? `<p class="s-e">${esc(q.explanation)}</p>` : ""}
    </div>`;
  }).join("");
  const on = st ? quizOn(st, bank) : true;
  const pay = st ? learn.payState(st, bank) : null;
  const meta = `<div class="meta">${esc(learn.yearsLabel(bank))}${bank.subject ? ` · ${esc(learn.subjectTitle(bank))}` : ""} · ${(bank.questions || []).length} questions, ${bank.questions_per_round || 10} a round, ${bank.pass_mark || 8} to pass${
    pay ? (on ? ` · ${esc(pay.note)}${pay.ok ? " a pass" : ""}` : " · off your list just now") : ""}</div>`;
  const start = on
    ? `<a class="go${pay && !pay.ok ? " alt" : ""}" href="/quiz/${esc(bank.id)}${kidQS}">${pay && !pay.ok ? `Have a go anyway (${esc(pay.note)}, no minutes yet)` : "I am ready, start a round"}</a>`
    : "";
  return page(`<div class="card">
    <h1>${esc(bank.emoji || "")} ${esc(bank.title)}</h1>
    ${meta}
    <div class="who">Everything this quiz can ask, with the answers and why.
      Read it, then go and have a go. The questions come up in a different order
      every time, so there is nothing to memorise the shape of.</div>
    ${readFirstBlock(bank)}
    ${start ? `<div class="actions" style="margin-bottom:6px">${start}</div>` : ""}
    <div class="study">${items}</div>
    ${start ? `<div class="actions">${start}</div>` : ""}
    <div class="crumbs" style="margin-top:12px"><a href="/learn${kidQS}">📚 Learning</a><a href="/${kidQS}">← back to Genkan</a></div></div>`, ctx);
}

// The ordinary portal pages carry no help-line footer (a parent's call,
// 2026-09-02: the page a child sees at dinner time is not the place for it).
// The help lines themselves stay reachable through every cut, from every
// device, via the safety scope of always_allow; and the "come find me" page
// below, which a Tor or drugs flag turns on, still shows them, because that
// page exists for a child who may need one.

// ---- the "come find me" page ----------------------------------------------
// A Tor/darknet/drugs flag turns the ordinary portal page into a warm one.
// Tone rules (docs/tor-and-safety.md): no shame, no alarm, name the block
// honestly, make the next step tiny, keep the help lines visible, keep the
// bug-bounty door open. The block is the start of a conversation, and the
// conversation is the actual safety mechanism.
//
// SELF-HARM IS NOT IN THIS LIST AND MUST NEVER BE ADDED TO IT. That category
// is a care signal, alert-only by policy: it never blocks a device and it
// never routes a kid to a blocking page of any kind. This is written as an
// explicit allow-list rather than a "everything except self-harm" filter so a
// flag category added later cannot quietly start putting a struggling kid in
// front of a wall.
const WARM_CATEGORIES = ["tor", "darknet", "drugs"];
const FLAG_WINDOW_MIN = Number(process.env.PORTAL_FLAG_WINDOW_MIN || 20);

// This page reads one thing: the alerts table. Only ONE road currently writes
// into it for these categories, the DNS road, where genkan-alerts matches a
// lookup against flag_domains. The IP road is not built: the firewall does
// count Tor connection attempts in the nft tor_dev set, but nothing reads those
// counters and nothing turns them into an alert, so a child who reaches a relay
// by address alone never lands here. ROADMAP.md tracks it. Nothing here touches
// the firewall.
async function flaggedReason(childId) {
  const [row] = await q(`SELECT category, domain FROM alerts
     WHERE child_id=$1 AND category = ANY($2::text[])
       AND ts > now() - ($3 || ' minutes')::interval
     ORDER BY ts DESC LIMIT 1`, [childId, WARM_CATEGORIES, String(FLAG_WINDOW_MIN)]);
  return row || null;
}

function warmPage(kid, flag, kidQS) {
  const what = flag.category === "drugs"
    ? "a darknet market directory"
    : flag.category === "darknet" ? "a hidden (\u201cdarknet\u201d) site" : "Tor";
  return page(`
    <div class="card warm">
      <h1>\u{1F9E1} This one is blocked, and it is a &ldquo;come find me&rdquo; one</h1>
      <div class="who">Hi ${esc(kid.name)}${flag.domain ? `. Blocked: ${esc(flag.domain)}` : ""}</div>
      <p class="lead">You tried to reach ${what}. That part of the internet is blocked on
        our network, not because curiosity is bad, but because some of what lives there is
        genuinely harmful, and it hides where you are going, even from you.</p>
      <p><b>You are not in trouble.</b> Wondering what is out there is completely normal.
        Come find me and tell me what you were looking for, or what you heard about, and we
        will figure it out together. If it feels awkward to say, you can literally start with
        &ldquo;this is awkward&rdquo;. That works.</p>
      <p>If something you saw online is worrying you and you would rather talk to someone who
        is not your dad first, the help lines below are always open from any device, even when
        the internet is off.</p>
      <p>And if you actually found a way AROUND this block: nice. That is a bug bounty. Show me
        how you did it and you earn time, you do not lose it.</p>
    </div>
    <div class="card"><h2>\u{1F4AC} Someone to talk to, any time</h2>
      <div class="helplines">Call or text <b>1737</b> \u00b7 free, 24/7<br>
        Youthline <b>0800 376 633</b> (or text 234)<br>
        Kidsline <b>0800 543 754</b><br>
        The Lowdown <b>thelowdown.co.nz</b><br>
        These always work, even when your internet is off.</div></div>
    <div class="card"><p style="margin:0"><a class="back" href="/hub${kidQS}">\u2190 Back to Genkan (time, quizzes, jobs)</a></p></div>`);
}

// A child's own badges, then the house board if a parent switched it on.
// Deliberately not a ranking: the board spotlights whoever leads each
// category, so different children can lead different ones, and everybody
// else's own number sits alongside without a position next to it.
function badgesPage(kid, got, board, kidQS, ctx) {
  // `got` is only the badges this child has actually earned, so the ones still
  // to get are BADGES minus those. Showing both matters: a child with two
  // badges should be able to see there are eight more waiting, all of which
  // they can get, rather than wonder whether they have finished.
  const has = new Set(got.map(b => b.id));
  const todo = BADGES.filter(b => !has.has(b.id));
  const chip = (b, earned) => `<div class="badge ${earned ? "got" : "todo"}">
      <span class="b-e">${b.emoji || "🏅"}</span>
      <span class="b-t"><b>${esc(b.title)}</b><small>${esc(b.blurb || "")}</small></span>
    </div>`;
  const cats = board?.categories || [];
  const boardHtml = !cats.length ? "" : `<div class="card"><h2>🏠 The house</h2>
    ${cats.map(c => `<div class="b-cat">
        <div class="b-cat-t">${esc(c.emoji || "")} ${esc(c.title)}</div>
        <div class="b-lead">${c.leaders.map(l => esc(l.name)).join(" and ") || "nobody yet"}
          ${c.leaders.length ? `<small>${esc(c.leaders[0].display || "")}</small>` : ""}</div>
        <div class="b-rest">${(c.everyone || []).map(o => `${esc(o.name)} ${esc(o.display || "")}`).join(" · ")}</div>
      </div>`).join("")}
    <div class="small">Different people lead different things, and it moves every
      week. There is no overall winner, on purpose.</div></div>`;
  return page(`<div class="card">
      <h1>🏅 ${esc(kid.name)}'s badges</h1>
      <div class="who">${got.length} of ${BADGES.length} so far. Every one of them is
        yours to get whenever you get there, and nobody can take one first.</div>
      <div class="badges">${got.map(b => chip(b, true)).join("")
        || '<div class="small">None yet. Pass a quiz and the first one is yours.</div>'}</div>
    </div>
    ${todo.length ? `<div class="card"><h2>Still to get</h2>
      <div class="badges">${todo.map(b => chip(b, false)).join("")}</div></div>` : ""}
    ${boardHtml}
    <div class="crumbs"><a href="/learn${kidQS}">📚 Learning</a><a href="/${kidQS}">← back</a></div>`, ctx);
}

// The time as a child reads a clock, not as a database prints one.
const clock = ts => ts ? new Date(ts).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" }) : "";

function homePage(kid, st, kidQS, ctx) {
  const rem = st.rem?.remaining_min ?? 0;
  const unlimited = (st.rem?.budget_min || 0) >= 999;
  const inet = st.cats.find(c => c.category === "internet");
  const outOfTime = inet?.set_by === "out-of-time" || (rem <= 0 && (st.rem?.used_min ?? 0) > 0);
  // Bedtime is its own reason and reads differently from running out of time:
  // there is nothing to earn your way out of, and the important half is the
  // hour it comes back.
  const bedtimeNow = inet?.set_by === "bedtime";
  const bed = st.bed;
  // THE SLOW LANE, SAID OUT LOUD. A network that is slow on purpose and says
  // nothing is just a broken network, and a child who thinks the wifi is broken
  // goes and "fixes" it: reboots the router, changes their address, asks a
  // friend for a hotspot. So the portal names it, names what is slow, and says
  // it is deliberate. Honesty here is also the whole position of the product:
  // Genkan never pretends the internet is faulty.
  const slowInet = st.slow?.find(c => c.category === "internet");
  const slowCats = (st.slow || []).filter(c => c.category !== "internet").map(c => c.category);
  const slowOutOfTime = slowInet?.set_by === "out-of-time";
  const head = slowInet && !inet
    ? `<h1>🐢 Everything is slow right now</h1>
       <div class="who">Hi ${esc(kid.name)}. Your internet is <b>not broken</b> and it is
         <b>not switched off</b>. It has been turned down on purpose${
         slowOutOfTime ? ", because today's time has run out" : ""}. Pages still load,
         messages still work, and video will keep stopping to buffer.
         ${slowOutOfTime ? "Earn some minutes below and it goes straight back to normal."
                         : "It goes back to normal when Dad says so, or you can come and ask."}</div>`
    : bedtimeNow && bed
    ? `<h1>🌙 Goodnight</h1>
       <div class="who">Hi ${esc(kid.name)}. The internet is off for the night. It comes back on
         by itself at <b>${esc(clock(bed.ends_at))}</b>, so there is nothing you need to do.</div>`
    // `|| outOfTime`: a clock at zero is time's up whether or not the
    // gateway's reconciler has written the block yet (it runs every 15s at
    // home; the demo has no gateway at all). Saying "your time, your call"
    // over a zero is the one thing this page must never do.
    : inet || (outOfTime && !unlimited)
    ? `<h1>${outOfTime ? "⏳ Time's up" : "⏸️ Internet paused"}</h1>
       <div class="who">Hi ${esc(kid.name)}. ${outOfTime ? "You've used today's time, but you can earn more below." : "Some things are switched off right now. You can still earn time for later."}</div>`
    : `<h1>👋 Kia ora ${esc(kid.name)}</h1><div class="who">Your time, your call. Earn more below whenever you like.</div>`;
  // Said whether or not anything is switched off, because knowing when tonight
  // ends is the whole point of saying it at all.
  const bedLine = bed
    ? `<div class="small" style="margin-top:8px">${bed.in_window
        ? `🌙 Off for the night. Back at <b>${esc(clock(bed.ends_at))}</b>.`
        : `🌙 Tonight: off at <b>${esc(clock(bed.starts_at))}</b>, back at <b>${esc(clock(bed.ends_at))}</b>.`}${
        bed.extended ? " You have extra time tonight." : ""}</div>`
    : "";
  // Said whenever anything is in the slow lane, including on top of the
  // headline above, because "video is slow but everything else is fine" is
  // exactly the thing a child would otherwise misread as a fault.
  const catWord = { gaming: "games", video: "video", social: "social apps" };
  const slowLine = slowCats.length
    ? `<div class="small" style="margin-top:8px">🐢 Slow on purpose right now:
        <b>${slowCats.map(c => esc(catWord[c] || c)).join(", ")}</b>. Not broken, not switched off,
        just turned down${st.slowKbit ? ` to about ${st.slowKbit} kbit/s` : ""}. Everything else is
        full speed, and help lines are never slowed.</div>`
    : slowInet
    ? `<div class="small" style="margin-top:8px">🐢 Everything is turned down${
        st.slowKbit ? ` to about ${st.slowKbit} kbit/s` : ""} on purpose. Help lines are never
        slowed, and this page is always full speed.</div>`
    : "";
  const cap = st.set.quiz_daily_cap_min, bonus = st.set.mastery_bonus_min;
  const capLeft = Math.max(0, cap - st.quizEarnedToday);
  // Order by how well each bank suits this child's age, nearest first. The
  // shelf went from nine banks to more than forty when the curriculum content
  // landed, and alphabetical order meant a seven-year-old opened their page to
  // NCEA Biology above Reading and Writing. suggested_age_min is a hint rather
  // than a lock, so nothing is hidden: a bank aimed below them sorts before one
  // aimed above, because revisiting something easy is a reasonable choice and
  // being handed something four years early is not.
  const fit = b => {
    const want = Number(b.suggested_age_min || 0), age = Number(kid?.age || 0);
    if (!want || !age) return 500;
    return want <= age ? age - want : (want - age) * 3;
  };
  const myBanks = [...banks.values()].filter(b => quizOn(st, b))
    .sort((a, b) => fit(a) - fit(b) || String(a.title).localeCompare(String(b.title)));
  const quizCard = b => {
    const last = st.lastPassAt[b.id] || 0;
    const coolUntil = last + st.set.quiz_cooldown_min * 60_000;
    const cooling = Date.now() < coolUntil;
    const note = cooling ? `ready ${new Date(coolUntil).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`
               : capLeft <= 0 ? "daily cap reached" : `+${Math.min(quizMinutes(st, b), capLeft)} min`;
    return (cooling || capLeft <= 0)
      ? `<div class="qcard dim"><span class="e">${esc(b.emoji || "🎓")}</span><b>${esc(b.title)}</b><span class="m">${note}</span></div>`
      : `<div class="qrow"><a class="qcard" href="/quiz/${esc(b.id)}${kidQS}"><span class="e">${esc(b.emoji || "🎓")}</span><b>${esc(b.title)}</b><span class="m">${note}</span></a>`
        + `<a class="study-link" href="/study/${esc(b.id)}${kidQS}" title="The answers and why, before you have a go">Read up</a></div>`;
  };
  // Forty-odd banks is a wall on a phone. The list is already sorted by how
  // well each suits this child, so show the nearest handful and fold the rest.
  // Folded, not filtered: a curious eleven-year-old can still open Chemistry
  // in one tap, and a visibly deep shelf is part of the appeal. A <details>
  // does this with no JavaScript at all.
  const SHOW_FIRST = 6;
  const rest = myBanks.slice(SHOW_FIRST);
  const quizCards = myBanks.slice(0, SHOW_FIRST).map(quizCard).join("")
    + (rest.length ? `<details class="more-q"><summary>${rest.length} more subject${
        rest.length > 1 ? "s" : ""} to try</summary>${rest.map(quizCard).join("")}</details>` : "");
  // One claim per job per day, so the answer to "I did this" is always about
  // today. A job Dad has to say yes to waits; a job he has already trusted you
  // with lands on your clock the moment you tap it.
  const decided = new Map(st.claims.map(c => [c.task_id, c.status]));
  const chores = st.tasks.map(t => {
    const done = decided.get(t.id);
    const e = esc(t.emoji || "🧺");
    const pill = done === "approved" ? `+${t.minutes} min, nice one`
               : done === "declined" ? "not this time" : "waiting for Dad";
    return done
      ? `<div class="qcard dim"><span class="e">${e}</span><b>${esc(t.name)}</b><span class="m pill">${pill}</span></div>`
      : `<form class="qcard" method="post" action="/claim${kidQS}" style="margin:0 0 8px"><span class="e">${e}</span><b>${esc(t.name)}</b>
        <span class="m"><input type=hidden name=task value="${t.id}"><button class="claimbtn">I did this · +${t.minutes}</button></span></form>`;
  }).join("");
  const anyTrusted = st.tasks.some(t => !t.needs_approval);
  return page(`
    <div class="card">${head}
      <div class="rem">${unlimited ? "∞" : Math.max(0, rem)}<small> ${unlimited ? "no daily limit" : "min left today"}</small></div>
      ${bedLine}
      ${slowLine}
      <a class="badge-teaser" href="/learn${kidQS}">📚 Learning by year</a>
      <a class="badge-teaser" href="/badges${kidQS}">🏅 My badges</a></div>
    <div class="card"><h2>🎓 Earn time: quizzes (instant)</h2>${quizCards
      || '<div class="small">No quizzes on your list right now. Ask Dad to switch one back on.</div>'}
      <div class="small">Pass a round to get minutes straight away.${bonus > 0 ? ` Perfect round = +${bonus} bonus.` : ""} Up to ${cap} min a day from quizzes; you've earned ${st.quizEarnedToday} today. The same banks sit by school year and subject on <a class="back" href="/learn${kidQS}">Learning</a>, with what you have done and what is next.</div></div>
    <div class="card"><h2>🧺 Earn time: jobs</h2>${chores || '<div class="small">No jobs set up yet.</div>'}
      <div class="small">${anyTrusted ? "Some of these land on your clock straight away. The rest wait for Dad to say yes." : "Tap one when it is done and Dad gets asked."} One go at each a day.</div></div>
    `, ctx);
}

async function quizPage(kid, bank, kidQS, perMin, bonus, ctx) {
  const ramped = isRamped(bank);
  const profile = ramped ? await rampProfile(kid.id, bank.id) : null;
  const pick = ramped
    ? rampedPick(bank, profile)                                       // easy to hard, built for this kid
    : [...bank.questions].sort(() => Math.random() - 0.5).slice(0, bank.questions_per_round || 10);
  const token = newToken();
  const round = { childId: kid.id, bankId: bank.id, profile, expires: Date.now() + 15 * 60_000, questions: [] };
  const qhtml = pick.map((qq, i) => {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);        // shuffle choices per round
    // `order` is kept so the result page can show the words a child picked
    // next to the right answer, not a slot number.
    round.questions.push({ qid: qq.id, answer: order.indexOf(qq.answer_index), difficulty: ramped ? lvlOf(qq) : null, order });
    return `<div class="q"><p><b>${i + 1}.</b> ${esc(qq.prompt)}</p>
      ${order.map((oi, j) => `<label><input type=radio name="q${i}" value="${j}" required>${esc(qq.choices[oi])}</label>`).join("")}</div>`;
  }).join("");
  rounds.set(token, round);
  return page(`<div class="card"><h1>${esc(bank.emoji || "")} ${esc(bank.title)}</h1>
    <div class="meta">${esc(learn.yearsLabel(bank))} · <a class="back" href="/study/${esc(bank.id)}${kidQS}">Read up first</a></div>
    <div class="who">${round.questions.length} questions. Get ${bank.pass_mark} right to earn ${perMin} minutes.${bonus > 0 ? ` All ${round.questions.length} right = +${bonus} bonus.` : ""}${ramped ? " They start easy and get harder as you go, so treat the first few as a warm-up." : ""} Every one you miss comes back with the answer and why.</div>
    <form method="post" action="/quiz/submit${kidQS}"><input type=hidden name=t value="${token}">${qhtml}
    <button class="go">Check my answers</button></form>
    <p><a class="back" href="/${kidQS}">← back</a></p></div>`, ctx);
}

async function gradeRound(kid, form, kidQS, ctx) {
  const round = rounds.get(form.get("t") || "");
  if (!round || round.childId !== kid.id || round.expires < Date.now())
    return page(`<div class="card"><div class="msg">That round expired. No worries, grab a fresh one.</div><p><a class="back" href="/${kidQS}">← back</a></p></div>`, ctx);
  rounds.delete(form.get("t"));                                       // one grading per round, ever
  const bank = banks.get(round.bankId);
  const byId = new Map(bank.questions.map(qq => [qq.id, qq]));
  let right = 0; const missed = [];
  round.questions.forEach((qq, i) => {
    const picked = Number(form.get(`q${i}`));
    qq.got = picked === qq.answer;
    if (qq.got) right++;
    else if (byId.has(qq.qid)) missed.push(learn.missedItem(byId.get(qq.qid), qq.order, picked));
  });
  const total = round.questions.length, passMark = bank.pass_mark || 8, passed = right >= passMark;
  // The status is read whether or not they passed: the "what you earned and
  // why" line quotes the cap and today's total either way.
  const st = await status(kid.id);
  const cap = st.set.quiz_daily_cap_min, bonus = st.set.mastery_bonus_min;
  let why = "", credited = 0;
  if (passed) {
    const coolMs = (st.lastPassAt[bank.id] || 0) + st.set.quiz_cooldown_min * 60_000 - Date.now();
    const capLeft = Math.max(0, cap - st.quizEarnedToday);
    if (!quizOn(st, bank)) why = `<b>No minutes</b> this time: this bank is off your list just now. The pass still counts, and another bank pays as usual.`;
    else if (coolMs > 0) why = `<b>No minutes</b> this time: you already passed this one at ${esc(clock(st.lastPassAt[bank.id]))}, and each bank pays once every ${Math.round(st.set.quiz_cooldown_min / 60)} hours. It is ready again at ${esc(clock(st.lastPassAt[bank.id] + st.set.quiz_cooldown_min * 60_000))}. Another bank pays now.`;
    else if (capLeft <= 0) why = `<b>No minutes</b> this time: you have hit today's ${cap} minute quiz cap. Nice work, back tomorrow.`;
    else {
      const base = Math.min(quizMinutes(st, bank), capLeft);
      const mins = base + (right === total ? bonus : 0);
      await credit(kid.id, mins, `quiz:${bank.id}`);
      credited = mins;
      why = `<b>+${mins} minutes</b>, already on your clock. ${right} of ${total} with a pass mark of ${passMark} earns ${base}${
        base < quizMinutes(st, bank) ? ` (that is what was left of today's ${cap})` : ""}${
        right === total ? `, and every one right adds the +${bonus} bonus` : bonus > 0 ? `. All ${total} right would have added +${bonus}` : ""}. Up to ${cap} a day from quizzes; ${st.quizEarnedToday + mins} so far today.`;
    }
  } else {
    why = `<b>No minutes</b> this time: ${right} of ${total}, and the pass mark is ${passMark}. The questions change every round, and the ones you missed are below with the answer and why. Reading is free.`;
  }
  await logRound(round, right, credited, passed);
  // Once per graded round, never a sweep over the whole history. Badges are
  // a nice-to-have, so a failure here must not swallow a round the child has
  // genuinely earned.
  let earned = [];
  try { earned = await awardBadges(q, kid.id, bank, right, total, passed); }
  catch (e) { console.error("badges:", e.message); }
  const won = earned.length
    ? `<div class="msg">${earned.length === 1 ? "New badge" : "New badges"}: ${
        earned.map(b => `${b.emoji || "🏅"} ${esc(b.title)}`).join(", ")}</div>`
    : "";
  // What to do next: practise the missed ones (worth nothing, on purpose),
  // and the Learning home's own pick for this child's year.
  const practiceToken = learn.startPractice(kid.id, bank.id, missed.map(m => m.qid));
  let nextHtml = "";
  try {
    const own = kidYear(kid);
    if (own) {
      const prog = await learn.progress(kid.id);
      const inYear = [...banks.values()].filter(b => learn.fits(b, own.year) && b.id !== bank.id);
      const next = learn.pickNext(inYear, prog, st);
      if (next) nextHtml = `<a class="go alt" href="/quiz/${esc(next.bank.id)}${kidQS}">Next for Year ${own.year}: ${esc(next.bank.emoji || "")} ${esc(next.bank.title)}</a>`;
    }
  } catch { /* the suggestion is a nicety */ }
  return page(`<div class="card"><div class="score">${right} / ${total}</div>${won}
    <div class="msg">${passed ? "🎉 Passed." : `Not this time. You need ${passMark}.`}</div>
    <div class="earned">${why}</div>
    ${learn.missedBlock(missed)}
    <div class="actions">
      ${practiceToken ? `<a class="go" href="/practice/${practiceToken}${kidQS}">Try the ${missed.length === 1 ? "one" : missed.length} you missed (practice, no minutes)</a>` : ""}
      ${!missed.length ? `<a class="go" href="/learn${kidQS}">Every one right. What is next?</a>` : ""}
      ${nextHtml}
      <a class="go alt" href="/learn${kidQS}">📚 Learning</a></div>
    <p style="text-align:center"><a class="back" href="/${kidQS}">← back to Genkan</a></p></div>`, ctx);
}

// ---- server --------------------------------------------------------------
const PROBES = new Set(["/generate_204", "/gen_204", "/hotspot-detect.html", "/connecttest.txt", "/ncsi.txt", "/success.txt", "/canonical.html"]);
const lastPost = new Map();   // childId -> ts, a soft brake on POST spam
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    const ip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    const kidOverride = url.searchParams.get("kid");
    const kidQS = kidOverride ? `?kid=${encodeURIComponent(kidOverride)}` : "";
    // Per request: does this caller hold the preview token? Checked here, not
    // inside whoIs, so the answer cannot be stale across concurrent requests.
    PREVIEW_OK = PREVIEW_TOKEN !== "" && url.searchParams.get("preview") === PREVIEW_TOKEN;
    const kid = await whoIs(ip, kidOverride);
    const send = html => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); };
    const ctx = { kid, path: url.pathname };
    // The demo has no devices, so a visitor with no ?kid= used to be told the
    // device was not recognised, which is true and useless. Send them to the
    // child with the least time left, which by the seed is the one who is out
    // of time: the screen the demo exists to show. A redirect rather than a
    // silent default, so the URL says who is being looked at and the switcher
    // can highlight them. Demo only: at home an unrecognised device gets the
    // claim page or the "ask Dad" page exactly as before.
    if (!kid && DEMO && !kidOverride && req.method === "GET") {
      const [pick] = await q(`SELECT c.name FROM children c
          LEFT JOIN time_remaining t ON t.child_id=c.id
          WHERE c.kind='child' AND c.active ORDER BY t.remaining_min NULLS LAST, c.name LIMIT 1`).catch(() => []);
      if (pick) {
        url.searchParams.set("kid", pick.name);
        res.writeHead(302, { location: url.pathname + "?" + url.searchParams.toString() }); return res.end();
      }
    }
    if (!kid) {
      // Claiming is only offered when the household has switched it on. With
      // it off, an unclaimed device has full internet anyway and a page asking
      // who it is would be a lie about what happens next.
      const [cs] = await q("SELECT mode FROM claim_settings");
      if (cs && cs.mode !== "off") {
        const [dev] = await q(`SELECT mac::text AS mac, hostname FROM devices
           WHERE host(reserved_ip)=$1 LIMIT 1`, [ip]);
        if (req.method === "POST" && url.pathname === "/claim-device") {
          let b = ""; req.on("data", c => { if ((b += c).length > 2000) req.destroy(); });
          await new Promise(r => req.on("end", r));
          return send(await doClaim(dev, ip, new URLSearchParams(b)));
        }
        return send(await claimPage(dev?.mac, ip, dev?.hostname));
      }
      return send(page(`<div class="card"><h1>Genkan</h1><div class="msg">This device isn't recognised on the kids network yet. Ask Dad to add it.</div></div>`));
    }
    if (req.method === "POST") {
      if (!kid.real && !DEMO && url.pathname !== "/practice/submit")
        return send(page(`<div class="card"><div class="msg">Earning only works from your own device on the network.</div></div>`));
      if ((lastPost.get(kid.id) || 0) > Date.now() - 1500) return send(page(`<div class="card"><div class="msg">Slow down a wee bit.</div></div>`));
      lastPost.set(kid.id, Date.now());
      let b = ""; req.on("data", c => { if ((b += c).length > 10_000) req.destroy(); });
      await new Promise(r => req.on("end", r));
      const form = new URLSearchParams(b);
      if (url.pathname === "/quiz/submit") return send(await gradeRound(kid, form, kidQS, ctx));
      // A practice round is graded for the child to read and credits nothing,
      // so it does not need the device match that earning does. It still
      // needs a real child, which the top of this handler guarantees.
      if (url.pathname === "/practice/submit") return send(learn.gradePractice(kid, form, kidQS, ctx));
      if (url.pathname === "/claim") {
        // Only a job that is actually on THIS child's list, at THEIR price.
        const taskId = Number(form.get("task"));
        const [task] = await q(`SELECT task_id AS id, name, minutes, needs_approval
            FROM task_offer_effective WHERE task_id=$1 AND child_id=$2 AND offered`, [taskId, kid.id]);
        if (task) {
          // One claim per job per day, whatever came of it. That is the brake
          // on a trusted job: a shower is worth five minutes once, not fifty.
          const trusted = !task.needs_approval;
          const ins = await q(`INSERT INTO earn_claims(child_id,task_id,status,decided_by,decided_ts)
            SELECT $1,$2,$3::text,$4::text,$5::timestamptz
             WHERE NOT EXISTS (SELECT 1 FROM earn_claims
                                WHERE child_id=$1 AND task_id=$2 AND ts::date=CURRENT_DATE)
            RETURNING id`,
            [kid.id, taskId, trusted ? "approved" : "pending", trusted ? "trust" : null, trusted ? new Date() : null]);
          if (ins.length && trusted) await credit(kid.id, task.minutes, `task:${task.name}`);
        }
        res.writeHead(303, { location: "/" + kidQS }); return res.end();
      }
      return send(page(`<div class="card"><div class="msg">Unknown action.</div></div>`));
    }
    // Read up before you answer. No cooldown, no cap, no round token: reading
    // is not a thing to ration.
    // The badges page: a child's own first, the house board only if a parent
    // has switched it on. Never a ranking, see docs/GAMIFICATION.md.
    if (url.pathname === "/badges") {
      const mine = await childBadges(q, kid.id);
      const on = await boardEnabled(q);
      // boardData needs the household's children: it compares them to each
      // other, so it cannot go and guess who "everybody" is.
      const kids = on ? await q(
        `SELECT id, name FROM children WHERE kind IN ('child','guest-child') AND active ORDER BY name`) : [];
      const board = on ? await boardData(q, kids) : null;
      return send(badgesPage(kid, mine, board, kidQS, ctx));
    }

    // The Learning home: the shelf laid out as a school year, subject by
    // subject, with what this child has done and what is next. ?year= shows
    // another year; the child's own comes from their record (kidYear). It
    // links to the same study and quiz routes as the hub and earns nothing
    // itself.
    if (url.pathname === "/learn") {
      const own = kidYear(kid);
      const asked = Number(url.searchParams.get("year"));
      const year = (Number.isInteger(asked) && asked >= 1 && asked <= 13) ? asked : (own?.year || 7);
      const [st, prog] = await Promise.all([status(kid.id), learn.progress(kid.id)]);
      return send(learn.learnPage({ kid, year, own, st, prog, kidQS, ctx }));
    }
    const pm = url.pathname.match(/^\/practice\/([a-f0-9]{24})$/);
    if (pm) return send(learn.practicePage(kid, pm[1], kidQS, ctx));

    const sm = url.pathname.match(/^\/study\/([a-z0-9-]+)$/);
    if (sm && banks.has(sm[1])) {
      // Noting that they read up is what makes the "read it, then passed it"
      // badge mean something. It is never used to police anybody.
      recordStudyVisit(q, kid.id, sm[1]).catch(() => {});
      return send(studyPage(banks.get(sm[1]), kidQS, await status(kid.id), ctx));
    }

    const m = url.pathname.match(/^\/quiz\/([a-z0-9-]+)$/);
    if (m && banks.has(m[1])) {
      const bank = banks.get(m[1]);
      const [p] = await q("SELECT enabled,minutes FROM quiz_settings WHERE child_id=$1 AND bank_id=$2", [kid.id, bank.id]);
      if (p && p.enabled === false)
        return send(page(`<div class="card"><div class="msg">That one is off your list just now. There are others.</div>
          <p style="text-align:center"><a class="back" href="/${kidQS}">← back to Genkan</a></p></div>`, ctx));
      const set = await earnSettings(kid.id);
      return send(await quizPage(kid, bank, kidQS, p?.minutes ?? (bank.minutes_per_pass || set.default_minutes_per_pass), set.mastery_bonus_min, ctx));
    }
    // A recent Tor/darknet/drugs flag replaces the ordinary page with the warm
    // one. Only on the fall-through GET, so an in-progress quiz and every POST
    // still behave exactly as before: earning is never taken away by a flag.
    // /hub is the way back to the ordinary hub while the flag is still warm.
    if (url.pathname !== "/hub") {
      const flag = await flaggedReason(kid.id);
      if (flag) return send(warmPage(kid, flag, kidQS));
    }
    // Everything else, including OS captive-portal probes, gets the home page.
    return send(homePage(kid, await status(kid.id), kidQS, ctx));
  } catch (e) { res.writeHead(500, { "content-type": "text/plain" }); res.end("portal error: " + e.message); }
});
server.listen(PORT, BIND, () => console.log(`kid portal on http://${BIND}:${PORT}`));
