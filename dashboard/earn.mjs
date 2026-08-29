// Hearth dashboard: learn to earn.
//
// The half of the system the parent could not see. The database has carried
// the whole loop for a while (tasks, earn_claims, time_events, the quiz banks
// on disk) but there was no screen to set any of it up, so the jobs a child is
// offered were whatever the seed file happened to say. This is that screen.
//
// The shape of the thing, in one paragraph. A kid runs out of minutes, tries
// to load a page, and the captive portal catches them and says: here is what
// you can do about it. Quizzes credit instantly, graded server side, with a
// cooldown per bank and a daily cap so they cannot be ground. Jobs are a
// claim: "I did the dishes", which lands on the parent's dashboard for a yes
// or a no. Everything a child earns, from either road, lands in time_events,
// so the ledger is one honest list.
//
// What this module adds on top of that:
//   * jobs are editable, and can be offered to one child rather than all of
//     them, at a reward that can differ per child (schema-tasks.sql)
//   * quiz banks can be switched on or off per child, and repriced per child
//   * a job can be marked "no approval needed", which makes it credit the
//     moment the child says they did it. Once a day, per job, per child, the
//     same brake the portal already had on claims.
//   * the earning history, per kid, so a parent can see the loop working
//   * a bank editor: write a quiz bank, add and edit its questions and their
//     explanations, and see how each question is actually going, without
//     touching a file. Banks a parent writes live in the DATABASE
//     (config/db/schema-quizbanks.sql), never in portal/quizzes, because that
//     directory is tracked in git and a pull would delete a family's content.
//     The portal merges the two shelves when it loads.
//   * the rules of earning: the cooldown, the daily cap, the perfect-round
//     bonus and the fallback price of a pass, per household and per child.
//     They used to be constants in portal.mjs.
//
// It is kept in its own file, and the view builds its own small style and
// script block, so it stays out of the way of the shared pages.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { esc } from "./charts.mjs";
import { fmt } from "./analytics.mjs";
import { BADGES, allBadges, boardEnabled, setBoardEnabled } from "./badges.mjs";

const QUIZ_DIR = process.env.QUIZ_DIR || path.join(import.meta.dirname, "..", "portal", "quizzes");
const MIN_MAX = 480;          // eight hours is already an absurd reward for one job
const QUIZ_MIN_MAX = 120;
const NAME_MAX = 60;
const PROMPT_MAX = 400;         // one question, not an essay
const CHOICE_MAX = 120;
const EXPLAIN_MAX = 400;
// A question has to have been asked a few times before "they always get this
// wrong" means anything. Four is low, but a household is not a school and
// waiting for thirty attempts means the panel is empty for a term.
const PERF_MIN_ASKED = 4;
const HARD_AT = 0.4;            // at or under this, the question is probably mislabelled or unfair
const EASY_AT = 0.9;            // at or over this, it is a warm-up whatever it says on the tin
// The numbers Hearth has always used, repeated here only so the form can show
// them as the placeholder. earn_settings_effective is the authority.
const EARN_DEFAULTS = { quiz_cooldown_min: 360, quiz_daily_cap_min: 30,
                        mastery_bonus_min: 5, default_minutes_per_pass: 10 };

// ---------------------------------------------------------------------------
// Quiz banks. Metadata only: this file never needs the answers, and never
// sends anything from a bank to a browser except its title and its numbers.
//
// Re-read when the directory changes, because `kidnet-quiz install` can drop a
// new bank in while everything is running and the portal reloads on a HUP. If
// the dashboard held a stale list, a parent could not switch on a bank their
// kids can already see, which is exactly the gap this screen exists to close.
// ---------------------------------------------------------------------------
export let banks = [];
const bankTitles = new Map();
// question id -> prompt, per file bank. The prompt is not the answer, and a
// parent cannot act on "question mad-018 is always wrong" without it. Choices
// and answer_index still never leave the server.
const filePrompts = new Map();
let bankSig = "";
export function refreshBanks() {
  let files = [], sig = "";
  try {
    files = readdirSync(QUIZ_DIR).filter(f => f.endsWith(".json")).sort();
    sig = files.map(f => `${f}:${statSync(path.join(QUIZ_DIR, f)).mtimeMs}`).join("|");
  } catch (e) {
    if (!banks.length) console.error(`earn: no quiz banks (${e.message})`);
    return banks;
  }
  if (sig === bankSig) return banks;
  bankSig = sig;
  const next = [];
  for (const f of files) {
    try {
      const b = JSON.parse(readFileSync(path.join(QUIZ_DIR, f), "utf8"));
      if (!b.id || !Array.isArray(b.questions)) continue;
      filePrompts.set(String(b.id), new Map(b.questions
        .filter(qq => qq && typeof qq.id === "string")
        .map(qq => [qq.id, { prompt: String(qq.prompt || ""), difficulty: qq.difficulty ?? null }])));
      next.push({
        id: String(b.id), title: String(b.title || b.id), emoji: b.emoji || "\u{1F393}",
        questions: b.questions.length,
        per_round: Number(b.questions_per_round || 10),
        pass_mark: Number(b.pass_mark || 8),
        minutes: Number(b.minutes_per_pass || 10),
        age_min: b.suggested_age_min || null,
        source: "file",
      });
    } catch (e) { console.error(`earn: quiz bank ${f}: ${e.message}`); }
  }
  next.sort((a, b) => (a.age_min || 0) - (b.age_min || 0) || a.title.localeCompare(b.title));
  banks = next;
  for (const b of banks) bankTitles.set(b.id, b.title);
  return banks;
}
refreshBanks();

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
// A query that must not take the page down with it. The bank editor and the
// earn settings need config/db/schema-quizbanks.sql, which an older install
// may not have loaded yet; without this the whole /earn page would 500 and a
// parent would lose the jobs screen they already had.
const soft = (q, sql, fallback = []) => q(sql).catch(e => {
  console.error(`earn: ${e.message}`);
  return fallback;
});

export async function earnData(q) {
  refreshBanks();
  const [children, tasks, eff, quizPrefs, quizStats, claims, recent, totals,
         dbBanks, dbQuestions, bankPerf, questionPerf, settings] = await Promise.all([
    // The household's own kids. A guest is not given a chore list, and a
    // person who has left the house keeps their history but leaves the screen.
    q("SELECT id,name,age FROM children WHERE kind='child' AND active ORDER BY age"),
    q(`SELECT id,name,minutes,needs_approval,active,everyone,emoji
         FROM tasks ORDER BY active DESC, lower(name), id`),
    q(`SELECT task_id,child_id,minutes,custom_minutes,offered,has_row
         FROM task_offer_effective`),
    q("SELECT child_id,bank_id,enabled,minutes FROM quiz_settings"),
    q(`SELECT child_id, substring(reason from 6) AS bank, count(*)::int AS passes,
              SUM(minutes)::int AS mins, max(ts) AS last
         FROM time_events WHERE kind='earn' AND reason LIKE 'quiz:%'
         GROUP BY 1,2`),
    q(`SELECT ec.id, ec.child_id, c.name AS kid, t.name AS task, ec.ts,
              COALESCE(o.minutes, t.minutes) AS minutes
         FROM earn_claims ec
         JOIN children c ON c.id = ec.child_id
         JOIN tasks t ON t.id = ec.task_id
         LEFT JOIN task_offers o ON o.task_id = t.id AND o.child_id = ec.child_id
        WHERE ec.status = 'pending' ORDER BY ec.ts`),
    q(`SELECT te.id, te.ts, te.child_id, te.minutes, te.kind, te.reason, te.by
         FROM time_events te
        WHERE te.kind IN ('earn','grant') AND te.ts > now() - interval '21 days'
        ORDER BY te.ts DESC LIMIT 120`),
    // The last seven days, split the way a parent thinks about it: what they
    // learned their way to, what they worked for, and what they were given.
    q(`SELECT child_id,
              COALESCE(SUM(minutes) FILTER (WHERE kind='earn' AND reason LIKE 'quiz:%'),0)::int AS quiz,
              COALESCE(SUM(minutes) FILTER (WHERE kind='earn' AND reason LIKE 'task:%'),0)::int AS chore,
              COALESCE(SUM(minutes) FILTER (WHERE kind='earn'),0)::int  AS earned,
              COALESCE(SUM(minutes) FILTER (WHERE kind='grant'),0)::int AS granted
         FROM time_events WHERE ts > now() - interval '7 days' GROUP BY child_id`),
    // The banks this household wrote for itself. They live in the database on
    // purpose: portal/quizzes is tracked in git.
    soft(q, `SELECT id,title,emoji,suggested_age_min,minutes_per_pass,pass_mark,questions_per_round,
                    source_note,active,questions,labelled
               FROM quiz_bank_summary ORDER BY lower(title)`),
    soft(q, `SELECT bank_id,question_id,seq,prompt,choices,answer_index,difficulty,explanation
               FROM quiz_bank_questions ORDER BY bank_id, seq, question_id`),
    // How each bank is actually going. quiz_rounds holds every graded round,
    // pass or fail, which is the only place a bank that is too hard shows up:
    // a bank nobody passes writes no time_events row at all.
    soft(q, `SELECT bank_id, count(*)::int AS rounds, count(*) FILTER (WHERE passed)::int AS passes,
                    sum(asked)::int AS asked, sum(correct)::int AS correct, max(ts) AS last
               FROM quiz_rounds WHERE ts > now() - interval '90 days' GROUP BY bank_id`),
    // And per question, so "they always get this one wrong" is a fact rather
    // than a feeling.
    soft(q, `SELECT r.bank_id, a.question_id, count(*)::int AS asked,
                    count(*) FILTER (WHERE a.correct)::int AS correct
               FROM quiz_answers a JOIN quiz_rounds r ON r.id = a.round_id
              WHERE r.ts > now() - interval '90 days'
              GROUP BY 1,2 HAVING count(*) >= ${PERF_MIN_ASKED}`),
    soft(q, `SELECT child_id, quiz_cooldown_min, quiz_daily_cap_min, mastery_bonus_min,
                    default_minutes_per_pass FROM earn_settings`),
  ]);
  // One shelf out of two. A file bank and a database bank cannot share an id
  // (the create API refuses it), and if one ever did, the portal keeps the
  // file, so the dashboard shows the same thing.
  const fileIds = new Set(banks.map(b => b.id));
  const mine = dbBanks.filter(b => !fileIds.has(b.id)).map(b => ({
    id: b.id, title: b.title, emoji: b.emoji || "\u{1F393}",
    questions: Number(b.questions), labelled: Number(b.labelled),
    per_round: Number(b.questions_per_round), pass_mark: Number(b.pass_mark),
    minutes: Number(b.minutes_per_pass), age_min: b.suggested_age_min,
    source_note: b.source_note, active: b.active,
    // A database bank goes live once it can fill one round. See the note at
    // the top of config/db/schema-quizbanks.sql: a file bank still needs four
    // rounds' worth, and that rule is untouched.
    live: b.active && Number(b.questions) >= Number(b.questions_per_round),
    source: "db",
  }));
  const allBanks = [...mine, ...banks];
  bankTitles.clear();
  for (const b of allBanks) bankTitles.set(b.id, b.title);
  // Gamification: who has earned what, and whether the house board (the one
  // place siblings are compared) is switched on. See dashboard/badges.mjs and
  // docs/GAMIFICATION.md. Best effort: an older install without
  // schema-badges.sql loaded just shows nobody has any badges yet, rather
  // than losing the rest of this screen.
  const [badges, boardOn] = await Promise.all([
    allBadges(q, children.map(c => c.id)),
    boardEnabled(q),
  ]);
  return { children, tasks, eff, quizPrefs, quizStats, claims, recent, totals,
           banks: allBanks, dbQuestions, bankPerf, questionPerf, settings, badges, boardOn };
}

// ---------------------------------------------------------------------------
// Writing. Every one of these is reached through a POST that sits behind the
// same DASH_TOKEN guard as /api/act.
// ---------------------------------------------------------------------------
const cleanText = (v, max) => [...String(v ?? "")].filter(c => c.codePointAt(0) >= 32).join("").replace(/\s+/g, " ").trim().slice(0, max);
const cleanName = v => cleanText(v, NAME_MAX);
const cleanEmoji = v => {
  const s = String(v ?? "").trim();
  // One or two characters of symbol, nothing that could be read as markup.
  return s && [...s].length <= 2 && !/[<>&"'\\\/\w]/.test(s) ? s : null;
};
const wholeMin = (v, max) => {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 && n <= max ? Math.round(n) : undefined;   // undefined = rejected
};
const bad = (res, msg) => { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, out: msg })); };
const okJson = (res, out) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, out })); };

// /api/task: create, edit, delete a job, and say who it is offered to.
export async function taskApi(q, body, res) {
  const action = String(body.action || "");
  const id = Number(body.id);
  const childId = Number(body.child_id);

  if (action === "create") {
    const name = cleanName(body.name);
    const mins = wholeMin(body.minutes, MIN_MAX);
    if (!name) return bad(res, "Give the job a name first.");
    if (mins === undefined || mins === null) return bad(res, `Minutes has to be a number between 1 and ${MIN_MAX}.`);
    const kids = Array.isArray(body.child_ids) ? body.child_ids.map(Number).filter(Number.isInteger) : [];
    const everyone = !kids.length;
    const [t] = await q(`INSERT INTO tasks(name,minutes,needs_approval,active,everyone,emoji,set_by)
        VALUES($1,$2,$3,true,$4,$5,'dashboard') RETURNING id`,
      [name, mins, body.needs_approval !== false, everyone, cleanEmoji(body.emoji)]);
    for (const cid of kids)
      await q(`INSERT INTO task_offers(task_id,child_id,active,set_by) VALUES($1,$2,true,'dashboard')
               ON CONFLICT (task_id,child_id) DO UPDATE SET active=true, updated_ts=now()`, [t.id, cid]);
    return okJson(res, `"${name}" is on the list, worth ${mins} minutes.`);
  }

  if (!Number.isInteger(id) || id <= 0) return bad(res, "bad job");

  if (action === "update") {
    const name = cleanName(body.name);
    const mins = wholeMin(body.minutes, MIN_MAX);
    if (!name) return bad(res, "Give the job a name first.");
    if (mins === undefined || mins === null) return bad(res, `Minutes has to be a number between 1 and ${MIN_MAX}.`);
    const rows = await q(`UPDATE tasks SET name=$2, minutes=$3, needs_approval=$4, active=$5, emoji=$6
        WHERE id=$1 RETURNING id`,
      [id, name, mins, body.needs_approval !== false, body.active !== false, cleanEmoji(body.emoji)]);
    if (!rows.length) return bad(res, "That job is not there any more.");
    return okJson(res, `Saved. "${name}" is worth ${mins} minutes${body.active === false ? ", and off the list for now" : ""}.`);
  }

  if (action === "delete") {
    // A job a child has already claimed stays in the history: deleting it
    // would quietly rewrite what they earned. Switch it off instead, which is
    // what the parent wanted anyway, and say so plainly.
    const [t] = await q("SELECT name FROM tasks WHERE id=$1", [id]);
    if (!t) return okJson(res, "Already gone.");
    const [{ n }] = await q("SELECT count(*)::int AS n FROM earn_claims WHERE task_id=$1", [id]);
    if (n > 0) {
      await q("UPDATE tasks SET active=false WHERE id=$1", [id]);
      return okJson(res, `"${t.name}" has been claimed before, so it stays in the history. Switched off instead.`);
    }
    await q("DELETE FROM tasks WHERE id=$1", [id]);
    return okJson(res, `"${t.name}" removed.`);
  }

  if (!Number.isInteger(childId) || childId <= 0) return bad(res, "bad child");

  if (action === "offer") {
    const on = body.offer === true;
    await q(`INSERT INTO task_offers(task_id,child_id,active,set_by) VALUES($1,$2,$3,'dashboard')
             ON CONFLICT (task_id,child_id) DO UPDATE SET active=EXCLUDED.active, updated_ts=now()`,
      [id, childId, on]);
    const [r] = await q(`SELECT child, name FROM task_offer_effective WHERE task_id=$1 AND child_id=$2`, [id, childId]);
    return okJson(res, on ? `"${r?.name}" is on ${r?.child}'s list.` : `"${r?.name}" is off ${r?.child}'s list.`);
  }

  if (action === "reward") {
    const mins = wholeMin(body.minutes, MIN_MAX);
    if (mins === undefined) return bad(res, `Minutes has to be a number between 1 and ${MIN_MAX}, or empty for the usual.`);
    if (mins === null) {
      await q("UPDATE task_offers SET minutes=NULL, updated_ts=now() WHERE task_id=$1 AND child_id=$2", [id, childId]);
    } else {
      await q(`INSERT INTO task_offers(task_id,child_id,active,minutes,set_by)
               VALUES($1,$2,COALESCE((SELECT active FROM task_offers WHERE task_id=$1 AND child_id=$2),
                                     (SELECT everyone FROM tasks WHERE id=$1)),$3,'dashboard')
               ON CONFLICT (task_id,child_id) DO UPDATE SET minutes=EXCLUDED.minutes, updated_ts=now()`,
        [id, childId, mins]);
    }
    const [r] = await q(`SELECT child, name, minutes FROM task_offer_effective WHERE task_id=$1 AND child_id=$2`, [id, childId]);
    return okJson(res, `"${r?.name}" is worth ${r?.minutes} minutes to ${r?.child}.`);
  }
  return bad(res, "bad action");
}

// /api/quiz: switch a bank on or off for one child, and reprice a pass.
export async function quizApi(q, body, res) {
  const bankId = String(body.bank_id || "");
  const childId = Number(body.child_id);
  if (!/^[a-z0-9-]{1,48}$/.test(bankId)) return bad(res, "bad quiz");
  // The title cache is filled by the page. A bank written on the dashboard
  // can be toggled before the page has been rendered since a restart, so fall
  // back to the database rather than telling the parent their own bank is bad.
  if (!bankTitles.has(bankId)) {
    const [b] = await q("SELECT title FROM quiz_banks WHERE id=$1", [bankId]).catch(() => []);
    if (!b) return bad(res, "bad quiz");
    bankTitles.set(bankId, b.title);
  }
  if (!Number.isInteger(childId) || childId <= 0) return bad(res, "bad child");
  const [c] = await q("SELECT name FROM children WHERE id=$1", [childId]);
  if (!c) return bad(res, "bad child");
  const title = bankTitles.get(bankId);

  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    const on = body.enabled === true;
    await q(`INSERT INTO quiz_settings(child_id,bank_id,enabled,set_by) VALUES($1,$2,$3,'dashboard')
             ON CONFLICT (child_id,bank_id) DO UPDATE SET enabled=EXCLUDED.enabled, updated_ts=now()`,
      [childId, bankId, on]);
    return okJson(res, on ? `${title} is on ${c.name}'s list.` : `${title} is off ${c.name}'s list.`);
  }
  const mins = wholeMin(body.minutes, QUIZ_MIN_MAX);
  if (mins === undefined) return bad(res, `Minutes has to be a number between 1 and ${QUIZ_MIN_MAX}, or empty for the usual.`);
  if (mins === null) {
    await q("UPDATE quiz_settings SET minutes=NULL, updated_ts=now() WHERE child_id=$1 AND bank_id=$2", [childId, bankId]);
    return okJson(res, `${title} is back to the usual for ${c.name}.`);
  }
  await q(`INSERT INTO quiz_settings(child_id,bank_id,minutes,set_by) VALUES($1,$2,$3,'dashboard')
           ON CONFLICT (child_id,bank_id) DO UPDATE SET minutes=EXCLUDED.minutes, updated_ts=now()`,
    [childId, bankId, mins]);
  return okJson(res, `A ${title} pass is worth ${mins} minutes to ${c.name}.`);
}

// ---------------------------------------------------------------------------
// /api/bank: writing a quiz bank, and its questions, from the dashboard.
//
// The rules here are portal/quizzes/FORMAT.md, enforced a second time in the
// database (config/db/schema-quizbanks.sql), because a bank with a wrong
// answer in it teaches a child something false and takes minutes off them for
// being right. The one thing this cannot check is whether the answer is
// actually true. That is still the parent's job, and the runbook says so.
// ---------------------------------------------------------------------------
const slugify = t => String(t ?? "").toLowerCase().normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
// tt-014 style: the initials of the bank's name, then a number. Short enough
// to read in a log line, stable once written.
const qidPrefix = slug => (slug.split("-").map(w => w[0]).filter(Boolean).join("").slice(0, 4) || "q");
const wholeIn = (v, lo, hi) => {
  // Empty is not zero. Number("") is 0, which quietly turned "no answer
  // ticked" into "the first choice is right", so blank is rejected here and
  // orNull below is the only thing allowed to read it as "no opinion".
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : undefined;
};
const orNull = (v, lo, hi) => (v === "" || v === null || v === undefined) ? null : wholeIn(v, lo, hi);

function readQuestion(body) {
  const prompt = cleanText(body.prompt, PROMPT_MAX);
  if (!prompt) return { err: "Write the question first." };
  const choices = (Array.isArray(body.choices) ? body.choices : []).map(c => cleanText(c, CHOICE_MAX));
  if (choices.length !== 4 || choices.some(c => !c))
    return { err: "All four choices have to be filled in. A wrong answer should be a mistake somebody would really make." };
  if (new Set(choices.map(c => c.toLowerCase())).size !== 4)
    return { err: "Two of the choices are the same." };
  const answer_index = wholeIn(body.answer_index, 0, 3);
  if (answer_index === undefined) return { err: "Say which of the four is the right answer." };
  const difficulty = orNull(body.difficulty, 1, 5);
  if (difficulty === undefined) return { err: "Difficulty is 1 (warm-up) to 5 (stretch), or leave it blank." };
  const explanation = cleanText(body.explanation, EXPLAIN_MAX) || null;
  return { prompt, choices, answer_index, difficulty, explanation };
}

function readBankMeta(body) {
  const title = cleanText(body.title, NAME_MAX);
  if (!title) return { err: "Give the bank a title. That is what the child sees on the card." };
  const per_round = wholeIn(body.per_round, 3, 50);
  if (per_round === undefined) return { err: "Questions per round has to be between 3 and 50. Ten is the usual." };
  const pass_mark = wholeIn(body.pass_mark, 1, per_round);
  if (pass_mark === undefined) return { err: `The pass mark has to be between 1 and ${per_round}. Eight out of ten is the usual.` };
  const minutes = wholeIn(body.minutes, 1, QUIZ_MIN_MAX);
  if (minutes === undefined) return { err: `Minutes a pass has to be between 1 and ${QUIZ_MIN_MAX}. Ten is the usual.` };
  const age_min = orNull(body.age_min, 3, 19);
  if (age_min === undefined) return { err: "Suggested age has to be between 3 and 19, or leave it blank." };
  const source_note = cleanText(body.source_note, 300) || null;
  return { title, emoji: cleanEmoji(body.emoji), per_round, pass_mark, minutes, age_min, source_note };
}

export async function bankApi(q, body, res) {
  const action = String(body.action || "");
  const bankId = String(body.bank_id || body.id || "");

  if (action === "create") {
    const m = readBankMeta(body);
    if (m.err) return bad(res, m.err);
    let base = slugify(m.title) || "quiz";
    // A file bank owns its id for good: the portal keeps the file on a clash,
    // so handing a parent that id would quietly do nothing.
    const taken = new Set(banks.map(b => b.id));
    for (const r of await q("SELECT id FROM quiz_banks")) taken.add(r.id);
    let id = base, n = 2;
    while (taken.has(id)) id = `${base.slice(0, 36)}-${n++}`;
    await q(`INSERT INTO quiz_banks(id,title,emoji,suggested_age_min,minutes_per_pass,pass_mark,
                                    questions_per_round,source_note,active,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'dashboard')`,
      [id, m.title, m.emoji, m.age_min, m.minutes, m.pass_mark, m.per_round, m.source_note]);
    return okJson(res, `"${m.title}" started. Add ${m.per_round} questions and it goes live to the kids.`);
  }

  if (!/^[a-z0-9-]{1,48}$/.test(bankId)) return bad(res, "bad bank");
  const [bank] = await q("SELECT * FROM quiz_bank_summary WHERE id=$1", [bankId]);
  if (!bank) return bad(res, "That bank is not one of yours. The banks in portal/quizzes are files: edit them with kidnet-quiz.");

  if (action === "update") {
    const m = readBankMeta(body);
    if (m.err) return bad(res, m.err);
    await q(`UPDATE quiz_banks SET title=$2, emoji=$3, suggested_age_min=$4, minutes_per_pass=$5,
                    pass_mark=$6, questions_per_round=$7, source_note=$8, active=$9, updated_ts=now()
              WHERE id=$1`,
      [bankId, m.title, m.emoji, m.age_min, m.minutes, m.pass_mark, m.per_round, m.source_note, body.active !== false]);
    const short = Number(bank.questions) < m.per_round;
    return okJson(res, body.active === false ? `"${m.title}" is off the kids' list while you work on it.`
      : short ? `Saved. ${m.per_round - Number(bank.questions)} more question${m.per_round - Number(bank.questions) === 1 ? "" : "s"} and it goes live.`
        : `Saved. "${m.title}" is live, worth ${m.minutes} minutes a pass.`);
  }

  if (action === "delete") {
    // Same rule as a job. A bank a child has already earned from stays, so the
    // history keeps meaning what it said; it just comes off the list.
    const [{ n }] = await q("SELECT count(*)::int AS n FROM quiz_rounds WHERE bank_id=$1", [bankId]);
    if (n > 0) {
      await q("UPDATE quiz_banks SET active=false, updated_ts=now() WHERE id=$1", [bankId]);
      return okJson(res, `"${bank.title}" has been taken ${n} time${n === 1 ? "" : "s"}, so it stays in the history. Switched off instead.`);
    }
    await q("DELETE FROM quiz_banks WHERE id=$1", [bankId]);
    return okJson(res, `"${bank.title}" removed.`);
  }

  if (action === "qadd") {
    const qq = readQuestion(body);
    if (qq.err) return bad(res, qq.err);
    const [{ seq }] = await q("SELECT COALESCE(max(seq),0)+1 AS seq FROM quiz_bank_questions WHERE bank_id=$1", [bankId]);
    // The number comes off a counter on the bank, not off max(question_id).
    // Deleting the last question and adding another must not hand the new one
    // the old one's id: quiz_answers keeps that id for good, and the two
    // questions' results would silently merge.
    const [{ n: qnum }] = await q(`UPDATE quiz_banks SET next_qid = GREATEST(next_qid,
             (SELECT COALESCE(max(substring(question_id from '[0-9]+$')::int),0)+1
                FROM quiz_bank_questions WHERE bank_id=$1)) + 1
           WHERE id=$1 RETURNING next_qid - 1 AS n`, [bankId]);
    const qid = `${qidPrefix(bankId)}-${String(qnum).padStart(3, "0")}`;
    await q(`INSERT INTO quiz_bank_questions(bank_id,question_id,seq,prompt,choices,answer_index,difficulty,explanation)
             VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
      [bankId, qid, seq, qq.prompt, JSON.stringify(qq.choices), qq.answer_index, qq.difficulty, qq.explanation]);
    const have = Number(bank.questions) + 1, want = Number(bank.questions_per_round);
    return okJson(res, have < want
      ? `Added. ${have} of the ${want} it needs before the kids see it.`
      : `Added. ${have} questions, and it is live.`);
  }

  const qid = String(body.question_id || "");
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(qid)) return bad(res, "bad question");

  if (action === "qsave") {
    const qq = readQuestion(body);
    if (qq.err) return bad(res, qq.err);
    const rows = await q(`UPDATE quiz_bank_questions SET prompt=$3, choices=$4::jsonb, answer_index=$5,
                                 difficulty=$6, explanation=$7, updated_ts=now()
                           WHERE bank_id=$1 AND question_id=$2 RETURNING question_id`,
      [bankId, qid, qq.prompt, JSON.stringify(qq.choices), qq.answer_index, qq.difficulty, qq.explanation]);
    if (!rows.length) return bad(res, "That question is not there any more.");
    return okJson(res, "Saved.");
  }

  if (action === "qdel") {
    // The question's past results stay in quiz_answers. They are keyed by id
    // and nothing joins back to this row, so a child's history is untouched.
    const rows = await q("DELETE FROM quiz_bank_questions WHERE bank_id=$1 AND question_id=$2 RETURNING question_id", [bankId, qid]);
    await q("UPDATE quiz_banks SET updated_ts=now() WHERE id=$1", [bankId]);
    return okJson(res, rows.length ? "Question removed." : "Already gone.");
  }
  return bad(res, "bad action");
}

// ---------------------------------------------------------------------------
// /api/earnsettings: the rules of earning, for the household or for one child.
//
// Every field is optional. Blank means "no opinion here, use the level below",
// so a per-child row can say one thing and inherit the rest. A child row with
// nothing in it at all is deleted rather than kept as a row of nulls.
// ---------------------------------------------------------------------------
export async function earnSettingsApi(q, body, res) {
  const scope = body.child_id === null || body.child_id === undefined || body.child_id === "" ? null : Number(body.child_id);
  if (scope !== null && (!Number.isInteger(scope) || scope <= 0)) return bad(res, "bad child");
  let who = "the whole house";
  if (scope !== null) {
    const [c] = await q("SELECT name FROM children WHERE id=$1", [scope]);
    if (!c) return bad(res, "bad child");
    who = c.name;
  }
  const cool = orNull(body.quiz_cooldown_min, 0, 1440);
  if (cool === undefined) return bad(res, "The rest between goes is 0 to 1440 minutes (a day), or blank for the usual six hours.");
  const cap = orNull(body.quiz_daily_cap_min, 0, 600);
  if (cap === undefined) return bad(res, "The daily cap is 0 to 600 minutes, or blank for the usual thirty.");
  const bonus = orNull(body.mastery_bonus_min, 0, 60);
  if (bonus === undefined) return bad(res, "The perfect round bonus is 0 to 60 minutes, or blank for the usual five.");
  const pay = orNull(body.default_minutes_per_pass, 1, QUIZ_MIN_MAX);
  if (pay === undefined) return bad(res, `What a pass pays by default is 1 to ${QUIZ_MIN_MAX} minutes, or blank for the usual ten.`);

  if (scope !== null && cool === null && cap === null && bonus === null && pay === null) {
    await q("DELETE FROM earn_settings WHERE child_id=$1", [scope]);
    return okJson(res, `${who} follows the house rules again.`);
  }
  const upd = await q(`UPDATE earn_settings SET quiz_cooldown_min=$2, quiz_daily_cap_min=$3,
                              mastery_bonus_min=$4, default_minutes_per_pass=$5,
                              set_by='dashboard', updated_ts=now()
                        WHERE child_id IS NOT DISTINCT FROM $1 RETURNING 1 AS ok`,
    [scope, cool, cap, bonus, pay]);
  if (!upd.length)
    await q(`INSERT INTO earn_settings(child_id,quiz_cooldown_min,quiz_daily_cap_min,
                                       mastery_bonus_min,default_minutes_per_pass,set_by)
             VALUES($1,$2,$3,$4,$5,'dashboard')`, [scope, cool, cap, bonus, pay]);
  const [eff] = scope === null
    ? [{ quiz_daily_cap_min: cap ?? EARN_DEFAULTS.quiz_daily_cap_min }]
    : await q("SELECT quiz_daily_cap_min FROM earn_settings_effective WHERE child_id=$1", [scope]);
  return okJson(res, `Saved. ${who}: up to ${eff.quiz_daily_cap_min} minutes a day from quizzes.`);
}

// /api/board: the one switch for the household comparison board. A child's
// own badges are never gated by this; only the sibling comparison is.
export async function boardApi(q, body, res) {
  const enabled = body.enabled === true || body.enabled === "true";
  await setBoardEnabled(q, enabled, "dashboard");
  return okJson(res, enabled
    ? "The house board is on. It compares improvement and effort, never raw totals, and it will say so on the portal."
    : "The house board is off. Kids still see their own badges, just no comparison with each other.");
}

// ---------------------------------------------------------------------------
// Deciding a claim.
// ---------------------------------------------------------------------------
// Approving used to hand the task's NAME to `kidnet earn`, which looked the
// minutes back up by a fuzzy name match. That cannot survive per-child
// rewards (or two jobs with the same name, which this family already has), so
// the minutes are resolved here from the same view the portal reads, and the
// credit is written the way the portal writes a quiz pass: ledger, then the
// audit row, then the unblock. kidnet is still the one thing that touches the
// firewall.
async function ensureDay(q, childId) {
  await q(`INSERT INTO time_ledger(child_id,day,budget_min)
    SELECT c.id, CURRENT_DATE, COALESCE(CASE WHEN EXTRACT(ISODOW FROM CURRENT_DATE) IN (6,7)
      THEN p.daily_budget_weekend_min ELSE p.daily_budget_school_min END, 999)
    FROM children c JOIN policies p ON p.tier=c.policy_tier WHERE c.id=$1
    ON CONFLICT DO NOTHING`, [childId]);
}

export async function decideClaim(q, runKidnet, id, decision) {
  const [cl] = await q(`UPDATE earn_claims SET status=$2, decided_by='dashboard', decided_ts=now()
      WHERE id=$1 AND status='pending' RETURNING child_id, task_id`,
    [id, decision === "approve" ? "approved" : "declined"]);
  if (!cl) return "already decided";
  if (decision !== "approve") return "declined";
  const [e] = await q(`SELECT child, name, minutes FROM task_offer_effective
                        WHERE task_id=$1 AND child_id=$2`, [cl.task_id, cl.child_id]);
  if (!e) return "approved (the job has since been removed, so nothing was credited)";
  await ensureDay(q, cl.child_id);
  await q("UPDATE time_ledger SET bonus_min=bonus_min+$2 WHERE child_id=$1 AND day=CURRENT_DATE", [cl.child_id, e.minutes]);
  await q(`INSERT INTO time_events(child_id,minutes,kind,reason,by)
           VALUES($1,$2,'earn',$3,'dashboard')`, [cl.child_id, e.minutes, `task:${e.name}`]);
  const [r] = await q("SELECT remaining_min FROM time_remaining WHERE child_id=$1", [cl.child_id]);
  const left = r?.remaining_min ?? 0;
  // Same tail as `kidnet earn`: back online the moment they are in credit.
  if (left > 0) await runKidnet(["on", e.child]);
  return `${e.child} earned +${e.minutes} min for ${e.name} (now ${left} left)`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
const ago = ts => {
  const d = new Date(ts);
  return d.toLocaleString("en-NZ", { weekday: "short", hour: "2-digit", minute: "2-digit" });
};
function earnLabel(ev) {
  const r = ev.reason || "";
  if (r.startsWith("quiz:")) return `${bankTitles.get(r.slice(5)) || r.slice(5)} quiz`;
  if (r.startsWith("task:")) { const n = r.slice(5); return /^\d+$/.test(n) ? "Job approved" : n; }
  if (r.startsWith("cat:")) return `${r.slice(4)} time from you`;
  return r || (ev.kind === "grant" ? "Bonus from you" : "Earned");
}

const STYLE = `
.job{border-top:1px solid var(--line);padding:2px 0}
.job:first-of-type{border-top:0}
.job>summary{cursor:pointer;padding:9px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;
  font-size:14px;list-style:none}
.job>summary::-webkit-details-marker{display:none}
.job>summary::before{content:"›";color:var(--ink-muted);font-size:16px;line-height:1;
  transition:transform .12s;flex:none}
.job[open]>summary::before{transform:rotate(90deg)}
.job .e{font-size:17px;flex:none}
.job .nm{font-weight:600;flex:1 1 40%;min-width:0}
.job.off .nm{color:var(--ink-muted);text-decoration:line-through}
.jbody{padding:4px 0 14px 16px}
.jform{display:flex;gap:7px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.jform input[type=text]{flex:1 1 160px}
.jform input.num{width:78px}
.jform input.emo{width:52px;text-align:center}
.jform label{font-size:12.5px;color:var(--ink-2);display:inline-flex;gap:5px;align-items:center}
.crow{display:flex;gap:7px;align-items:center;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--line);font-size:13px}
.crow .who{flex:1 1 84px;min-width:0}
.crow input.num{width:66px}
.tog{border:1px solid var(--line);background:var(--surface-2);color:var(--ink-2);border-radius:999px;
  padding:5px 11px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.tog.yes{background:var(--ember-soft);border-color:transparent;color:var(--ember);font-weight:600}
.stat{color:var(--ink-muted);font-size:12px;flex:1 1 100%}
.hint{color:var(--ink-muted);font-size:12.5px;margin:8px 0 0;line-height:1.55}
.sugs{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0 2px}
.hrow{display:flex;gap:8px;font-size:13px;padding:6px 0;border-top:1px solid var(--line);align-items:baseline}
.hrow:first-of-type{border-top:0}
.hrow .m{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums;flex:none}
.hrow .w{color:var(--ink-muted);font-size:12px;flex:none}
.w{color:var(--ink-muted);font-size:12px}
.kearn{border-top:1px solid var(--line);padding:12px 0 2px}
.kearn:first-of-type{border-top:0;padding-top:2px}
.kearn h3{margin-bottom:6px}
.badge{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:999px;
  border:1px solid var(--line);color:var(--ink-muted);white-space:nowrap}
.badge.mine{background:var(--ember-soft);border-color:transparent;color:var(--ember);font-weight:700}
.badge.draft{background:var(--surface-2)}
.perf{display:flex;gap:14px;flex-wrap:wrap;background:var(--surface-2);border-radius:12px;
  padding:9px 12px;margin:2px 0 10px;font-size:12.5px;color:var(--ink-2)}
.perf b{color:var(--ink);font-variant-numeric:tabular-nums}
.perf .verdict{flex:1 1 100%;color:var(--ink-muted);font-size:12px;margin-top:2px}
.perf .hrow .m.hard{color:var(--ember)}
.perf .hrow span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qlist{margin:10px 0 4px}
.qq{border-top:1px solid var(--line)}
.qq>summary{cursor:pointer;padding:7px 0;display:flex;gap:8px;align-items:baseline;font-size:13px;list-style:none}
.qq>summary::-webkit-details-marker{display:none}
.qq .lvl{flex:none;width:19px;height:19px;border-radius:6px;background:var(--surface-2);
  color:var(--ink-muted);font-size:11px;text-align:center;line-height:19px;font-variant-numeric:tabular-nums}
.qq .nm{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qq .qs{flex:none;color:var(--ink-muted);font-size:11.5px;font-variant-numeric:tabular-nums}
.qq .qs.hard{color:var(--ember);font-weight:600}
.qbody{padding:2px 0 12px 14px}
.qbody input[type=text]{width:100%;margin-bottom:6px}
.ans{display:flex;gap:7px;align-items:center;margin-bottom:5px}
.ans input[type=radio]{flex:none}
.ans input[type=text]{margin:0}
.qmeta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px}
.qmeta select{width:auto}
.newq{background:var(--surface-2);border-radius:12px;padding:11px 12px;margin-top:10px}
.newq input[type=text]{width:100%;margin-bottom:6px}
.newq .ans input[type=text]{margin:0}
.jform input.emo{flex:0 0 52px}
.jform input.wide{flex:1 1 100%}
.rules{display:flex;gap:9px;flex-wrap:wrap;align-items:flex-end;padding:9px 0;border-top:1px solid var(--line)}
.rules:first-of-type{border-top:0}
.rules .who{flex:1 1 100%;font-weight:600;font-size:13px}
.rules .fld{display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--ink-muted)}
.rules .fld input{width:92px}
.helptab{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:10px}
.helptab td{padding:5px 8px 5px 0;vertical-align:top;border-top:1px solid var(--line);color:var(--ink-2)}
.helptab td:first-child{white-space:nowrap;color:var(--ink);font-weight:600}
@media (max-width:460px){ .jbody{padding-left:6px} .jform input[type=text]{flex:1 1 100%} }
`;

const SCRIPT = `
function ePost(url,body,ok){
  say('working...');
  post(url,body).then(function(x){
    if(done(x.r,x.j,700)&&ok&&!((x.j&&x.j.out)||'').trim())say(ok);});
}
function v(id){var e=document.getElementById(id);return e?e.value:'';}
function ck(id){var e=document.getElementById(id);return e?e.checked:false;}
function taskSave(id){ePost('/api/task',{action:'update',id:id,name:v('tn_'+id),minutes:v('tm_'+id),
  emoji:v('te_'+id),needs_approval:ck('tp_'+id),active:ck('ta_'+id)});}
function taskDel(id,name){if(!confirm('Remove "'+name+'" from the list?'))return;
  ePost('/api/task',{action:'delete',id:id});}
function taskOffer(id,cid,on){ePost('/api/task',{action:'offer',id:id,child_id:cid,offer:on});}
function taskReward(id,cid){ePost('/api/task',{action:'reward',id:id,child_id:cid,minutes:v('rw_'+id+'_'+cid)});}
function quizOn(bank,cid,on){ePost('/api/quiz',{bank_id:bank,child_id:cid,enabled:on});}
function quizMin(bank,cid){ePost('/api/quiz',{bank_id:bank,child_id:cid,minutes:v('qm_'+bank+'_'+cid)});}
function taskAdd(){
  var kids=[];
  document.querySelectorAll('.newkid:checked').forEach(function(e){kids.push(Number(e.value));});
  ePost('/api/task',{action:'create',name:v('new_name'),minutes:v('new_min'),emoji:v('new_emoji'),
    needs_approval:!ck('new_instant'),child_ids:kids});
}
function fill(emoji,name,min){document.getElementById('new_emoji').value=emoji;
  document.getElementById('new_name').value=name;document.getElementById('new_min').value=min;
  document.getElementById('new_name').focus();}
/* ---- the bank editor ------------------------------------------------- */
function bankVals(id){return {bank_id:id,title:v('bt_'+id),emoji:v('be_'+id),age_min:v('ba_'+id),
  minutes:v('bm_'+id),pass_mark:v('bp_'+id),per_round:v('br_'+id),source_note:v('bs_'+id),active:ck('bx_'+id)};}
function bankSave(id){var o=bankVals(id);o.action='update';ePost('/api/bank',o);}
function bankDel(id,t){if(!confirm('Remove "'+t+'"? Anything they already earned from it stays.'))return;
  ePost('/api/bank',{action:'delete',bank_id:id});}
function bankAdd(){ePost('/api/bank',{action:'create',title:v('nb_title'),emoji:v('nb_emoji'),
  age_min:v('nb_age'),minutes:v('nb_min'),pass_mark:v('nb_pass'),per_round:v('nb_round'),
  source_note:v('nb_note')});}
function qvals(bank,qid){
  var pre='_'+bank+'_'+qid,ch=[],i;
  for(i=0;i<4;i++)ch.push(v('qc'+pre+'_'+i));
  var ans='',rs=document.getElementsByName('ans'+pre);
  for(i=0;i<rs.length;i++)if(rs[i].checked)ans=rs[i].value;
  return {bank_id:bank,question_id:qid,prompt:v('qp'+pre),choices:ch,answer_index:ans,
    difficulty:v('qd'+pre),explanation:v('qe'+pre)};}
function qSave(bank,qid){var o=qvals(bank,qid);o.action='qsave';ePost('/api/bank',o);}
function qDel(bank,qid){if(!confirm('Remove this question?'))return;
  ePost('/api/bank',{action:'qdel',bank_id:bank,question_id:qid});}
function qAdd(bank){var o=qvals(bank,'new');o.action='qadd';ePost('/api/bank',o);}
/* ---- the rules of earning -------------------------------------------- */
function setRules(cid){var p=cid===null?'house':('k'+cid);
  ePost('/api/earnsettings',{child_id:cid,quiz_cooldown_min:v('sc_'+p),quiz_daily_cap_min:v('sd_'+p),
    mastery_bonus_min:v('sb_'+p),default_minutes_per_pass:v('sp_'+p)});}
/* ---- badges and the house board --------------------------------------- */
function boardToggle(on){ePost('/api/board',{enabled:on});}
`;

// The three the owner used to describe the idea. They set the range on
// purpose: a shower is worth five minutes, an hour of weeding is worth an
// hour back.
const SUGGESTIONS = [
  ["🚿", "Have a shower", 5],
  ["🧺", "Dishes done", 30],
  ["🌿", "Weeding, half an hour outside", 60],
];

export function earnPage(d) {
  const kids = d.children;
  const eff = new Map();                                  // "taskId:childId" -> row
  for (const r of d.eff) eff.set(`${r.task_id}:${r.child_id}`, r);
  const prefs = new Map();                                // "bankId:childId" -> row
  for (const r of d.quizPrefs) prefs.set(`${r.bank_id}:${r.child_id}`, r);
  const qstat = new Map();                                // "bankId:childId" -> row
  for (const r of d.quizStats) qstat.set(`${r.bank}:${r.child_id}`, r);
  const perf = new Map(d.bankPerf.map(r => [r.bank_id, r]));       // bankId -> rounds/passes/score
  const qperf = new Map();                                // bankId -> [{question_id,asked,correct}]
  for (const r of d.questionPerf) {
    if (!qperf.has(r.bank_id)) qperf.set(r.bank_id, []);
    qperf.get(r.bank_id).push(r);
  }
  const dbQ = new Map();                                  // bankId -> the questions a parent wrote
  for (const r of d.dbQuestions) {
    if (!dbQ.has(r.bank_id)) dbQ.set(r.bank_id, []);
    dbQ.get(r.bank_id).push(r);
  }
  const rules = new Map(d.settings.map(r => [r.child_id, r]));     // null key = the household row
  const tot = new Map(d.totals.map(t => [t.child_id, t]));
  const kidName = new Map(kids.map(k => [k.id, k.name]));

  const liveTasks = d.tasks.filter(t => t.active);
  const instant = liveTasks.filter(t => !t.needs_approval);
  const weekEarned = d.totals.reduce((n, t) => n + (t.earned || 0), 0);
  const quizOnCount = kids.length * d.banks.length
    - d.quizPrefs.filter(p => !p.enabled && d.banks.some(b => b.id === p.bank_id)).length;

  const hero = `<div class="card"><div class="hero">
    <div class="fig">${esc(fmt.min(weekEarned))}</div>
    <div class="cap">earned by the kids in the last seven days, through quizzes and jobs.
      ${liveTasks.length ? `${liveTasks.length} job${liveTasks.length > 1 ? "s" : ""} on offer` : "No jobs on offer yet"},
      ${d.banks.length} quiz bank${d.banks.length === 1 ? "" : "s"} on the shelf.
      ${d.claims.length ? `<b>${d.claims.length} waiting for your OK.</b>` : ""}</div>
  </div></div>`;

  const claims = d.claims.length ? `<div class="card"><h2>🧺 Waiting for your OK (${d.claims.length})</h2>`
    + d.claims.map(c => `<div class="row"><span><b>${esc(c.kid)}</b> says: ${esc(c.task)} <code>+${c.minutes} min</code>
        <span class="w">${esc(ago(c.ts))}</span></span>
      <span><button class="approve" onclick="claim(${c.id},'approve')">Approve</button>
        <button class="decline" onclick="claim(${c.id},'decline')">No</button></span></div>`).join("")
    + `</div>` : "";

  // ---- jobs ---------------------------------------------------------------
  const jobRow = t => {
    const mine = kids.map(k => eff.get(`${t.id}:${k.id}`)).filter(Boolean);
    const on = mine.filter(r => r.offered);
    const who = !kids.length ? "no children yet"
      : on.length === kids.length ? "Everyone"
        : on.length ? on.map(r => kidName.get(r.child_id)).join(", ")
          : "nobody yet";
    const spread = [...new Set(mine.map(r => r.minutes))];
    const worth = spread.length === 1 ? `+${spread[0]} min` : `+${Math.min(...spread)} to ${Math.max(...spread)} min`;
    return `<details class="job${t.active ? "" : " off"}">
      <summary><span class="e">${esc(t.emoji || "🧺")}</span><span class="nm">${esc(t.name)}</span>
        <span class="pill">${esc(worth)}</span>
        <span class="tag">${esc(who)}${t.needs_approval ? "" : " · instant"}${t.active ? "" : " · off the list"}</span></summary>
      <div class="jbody">
        <div class="jform">
          <input type="text" id="tn_${t.id}" value="${esc(t.name)}" aria-label="Name of this job" maxlength="60">
          <input type="text" class="emo" id="te_${t.id}" value="${esc(t.emoji || "")}" aria-label="Emoji" maxlength="2">
          <input type="number" class="num" id="tm_${t.id}" value="${t.minutes}" min="1" max="${MIN_MAX}" aria-label="Minutes earned">
          <label><input type="checkbox" id="ta_${t.id}"${t.active ? " checked" : ""}> On the list</label>
          <label><input type="checkbox" id="tp_${t.id}"${t.needs_approval ? " checked" : ""}> Ask me first</label>
          <button class="btn primary" onclick="taskSave(${t.id})">Save</button>
          <button class="mini" onclick="taskDel(${t.id},${esc(JSON.stringify(t.name))})">Remove</button>
        </div>
        ${kids.map(k => {
          const r = eff.get(`${t.id}:${k.id}`) || {};
          return `<div class="crow"><span class="who">${esc(k.name)}</span>
            <button class="tog${r.offered ? " yes" : ""}" onclick="taskOffer(${t.id},${k.id},${r.offered ? "false" : "true"})">${r.offered ? "On their list" : "Not offered"}</button>
            <input type="number" class="num" id="rw_${t.id}_${k.id}" min="1" max="${MIN_MAX}"
              value="${r.custom_minutes ? r.minutes : ""}" placeholder="${t.minutes}" aria-label="Minutes for ${esc(k.name)}">
            <button class="mini" onclick="taskReward(${t.id},${k.id})">Set</button></div>`;
        }).join("")}
        <p class="hint">Leave the minutes box empty and they get the usual ${t.minutes}.
          ${t.needs_approval ? "This one waits for your yes." : "This one credits the moment they say they did it, once a day."}</p>
      </div></details>`;
  };

  const emptyJobs = `<div class="empty">Nothing on the list yet. Start with something small and something big,
    so there is always a way back in.</div>`;

  const jobs = `<div class="card"><h2>🧺 Jobs they can do</h2>
    <p class="sub">What a child sees on the portal when they run out of minutes. Small things count:
      a shower is worth five minutes, an hour of weeding is worth an hour back.</p>
    ${instant.length ? `<p class="hint"><b>${instant.length} of these credit straight away</b> without asking you:
      ${esc(instant.map(t => t.name).join(", "))}. Tick "Ask me first" on a job if you would rather see it.</p>` : ""}
    ${d.tasks.length ? d.tasks.map(jobRow).join("") : emptyJobs}
    <h2 style="margin-top:18px">Add a job</h2>
    <div class="sugs">${SUGGESTIONS.map(([e, n, m]) =>
      `<button class="tog" onclick="fill(${esc(JSON.stringify(e))},${esc(JSON.stringify(n))},${m})">${esc(e)} ${esc(n)} · ${m} min</button>`).join("")}</div>
    <div class="jform">
      <input type="text" class="emo" id="new_emoji" value="🧺" aria-label="Emoji" maxlength="2">
      <input type="text" id="new_name" placeholder="e.g. Feed the chooks" aria-label="Name of the job" maxlength="60">
      <input type="number" class="num" id="new_min" placeholder="min" min="1" max="${MIN_MAX}" aria-label="Minutes earned">
      <label><input type="checkbox" id="new_instant"> Credit it straight away</label>
      <button class="btn primary" onclick="taskAdd()">Add</button>
    </div>
    <div class="jform">
      <span class="tag">Who for:</span>
      ${kids.map(k => `<label><input type="checkbox" class="newkid" value="${k.id}"> ${esc(k.name)}</label>`).join("")}
      <span class="tag">Tick nobody for everyone.</span>
    </div></div>`;

  // ---- quizzes ------------------------------------------------------------
  // Two shelves in one list: the banks that shipped with Hearth, as files, and
  // the banks this household wrote, which live in the database. The second
  // kind can be edited here, question by question. The first kind cannot, on
  // purpose: it is a file in git, and kidnet-quiz owns it.
  const prompts = (b, qid) => b.source === "db"
    ? (dbQ.get(b.id) || []).find(x => x.question_id === qid)?.prompt || qid
    : filePrompts.get(b.id)?.get(qid)?.prompt || qid;

  const perfBlock = b => {
    const p = perf.get(b.id);
    const rows = (qperf.get(b.id) || []).map(r => ({ ...r, acc: r.correct / r.asked }));
    const hard = rows.filter(r => r.acc <= HARD_AT).sort((x, y) => x.acc - y.acc).slice(0, 4);
    const easy = rows.filter(r => r.acc >= EASY_AT).sort((x, y) => y.acc - x.acc).slice(0, 4);
    if (!p) return `<div class="perf">Nobody has taken this one yet, so there is nothing to judge it on.</div>`;
    const passRate = p.rounds ? p.passes / p.rounds : 0;
    const avg = p.asked ? p.correct / p.asked : 0;
    const verdict = p.rounds < 3 ? "Too few rounds to read much into yet."
      : passRate >= 0.9 && avg >= 0.9 ? "They are finding this easy. Worth writing a few harder questions, or lifting the pass mark."
        : passRate <= 0.3 ? "This one is hard going. Check the questions marked below, or add some warm-ups."
          : "About right: they have to work for it and they get there.";
    const list = (title, items, cls) => items.length
      ? `<div class="perf-list" style="flex:1 1 100%"><div class="w">${title}</div>${items.map(r =>
          `<div class="hrow"><span>${esc(prompts(b, r.question_id))}</span>
             <span class="m ${cls}">${r.correct}/${r.asked}</span></div>`).join("")}</div>`
      : "";
    return `<div class="perf">
      <span><b>${p.rounds}</b> round${p.rounds === 1 ? "" : "s"}</span>
      <span><b>${p.passes}</b> passed <span class="w">(${Math.round(passRate * 100)}%)</span></span>
      <span>average <b>${avg ? (avg * b.per_round).toFixed(1) : 0}</b> out of ${b.per_round}</span>
      <span class="verdict">${esc(verdict)}</span>
      ${list("Nearly always wrong, after " + PERF_MIN_ASKED + "+ goes", hard, "hard")}
      ${list("Nearly always right", easy, "")}
    </div>`;
  };

  const kidRows = b => kids.map(k => {
    const p = prefs.get(`${b.id}:${k.id}`) || {};
    const on = p.enabled !== false;
    const st = qstat.get(`${b.id}:${k.id}`);
    return `<div class="crow"><span class="who">${esc(k.name)}</span>
      <button class="tog${on ? " yes" : ""}" onclick="quizOn(${esc(JSON.stringify(b.id))},${k.id},${on ? "false" : "true"})">${on ? "On their list" : "Switched off"}</button>
      <input type="number" class="num" id="qm_${esc(b.id)}_${k.id}" min="1" max="${QUIZ_MIN_MAX}"
        value="${p.minutes ?? ""}" placeholder="${b.minutes}" aria-label="Minutes for ${esc(k.name)}">
      <button class="mini" onclick="quizMin(${esc(JSON.stringify(b.id))},${k.id})">Set</button>
      <span class="stat">${st ? `${st.passes} pass${st.passes === 1 ? "" : "es"} · ${esc(fmt.min(st.mins))} earned · last ${esc(ago(st.last))}`
        : "no passes yet"}</span></div>`;
  }).join("");

  // One question, open to edit. The explanation gets its own line and its own
  // label, because it is the part a child actually reads and learns from.
  const questionRow = (b, qq) => {
    const key = `_${b.id}_${qq.question_id}`;
    const r = (qperf.get(b.id) || []).find(x => x.question_id === qq.question_id);
    const acc = r ? r.correct / r.asked : null;
    const choices = Array.isArray(qq.choices) ? qq.choices : [];
    return `<details class="qq">
      <summary><span class="lvl">${qq.difficulty ?? "·"}</span>
        <span class="nm">${esc(qq.prompt)}</span>
        <span class="qs${acc !== null && acc <= HARD_AT ? " hard" : ""}">${r ? `${r.correct}/${r.asked}` : ""}</span></summary>
      <div class="qbody">
        <input type="text" id="qp${key}" value="${esc(qq.prompt)}" maxlength="${PROMPT_MAX}" aria-label="The question">
        ${[0, 1, 2, 3].map(i => `<div class="ans">
          <input type="radio" name="ans${key}" value="${i}"${qq.answer_index === i ? " checked" : ""} aria-label="Choice ${i + 1} is the right answer">
          <input type="text" id="qc${key}_${i}" value="${esc(choices[i] ?? "")}" maxlength="${CHOICE_MAX}" aria-label="Choice ${i + 1}">
        </div>`).join("")}
        <input type="text" id="qe${key}" value="${esc(qq.explanation || "")}" maxlength="${EXPLAIN_MAX}"
          placeholder="What they read afterwards, right or wrong. One friendly sentence that teaches." aria-label="Explanation">
        <div class="qmeta">
          <label>Difficulty
            <select id="qd${key}">${["", 1, 2, 3, 4, 5].map(lv =>
              `<option value="${lv}"${String(qq.difficulty ?? "") === String(lv) ? " selected" : ""}>${lv === "" ? "not set" : lv}</option>`).join("")}</select></label>
          <button class="btn primary" onclick="qSave(${esc(JSON.stringify(b.id))},${esc(JSON.stringify(qq.question_id))})">Save</button>
          <button class="mini" onclick="qDel(${esc(JSON.stringify(b.id))},${esc(JSON.stringify(qq.question_id))})">Remove</button>
          <span class="tag">${esc(qq.question_id)}</span>
        </div>
      </div></details>`;
  };

  const newQuestion = b => {
    const key = `_${b.id}_new`;
    return `<div class="newq">
      <div class="w" style="margin-bottom:6px">Add a question</div>
      <input type="text" id="qp${key}" maxlength="${PROMPT_MAX}" placeholder="The question, e.g. 7 × 8 = ?" aria-label="The question">
      ${[0, 1, 2, 3].map(i => `<div class="ans">
        <input type="radio" name="ans${key}" value="${i}" aria-label="Choice ${i + 1} is the right answer">
        <input type="text" id="qc${key}_${i}" maxlength="${CHOICE_MAX}" placeholder="Choice ${i + 1}${i === 0 ? ", tick the circle beside the right one" : ""}" aria-label="Choice ${i + 1}">
      </div>`).join("")}
      <input type="text" id="qe${key}" maxlength="${EXPLAIN_MAX}"
        placeholder="Explanation: one friendly sentence, shown whether they got it right or wrong" aria-label="Explanation">
      <div class="qmeta">
        <label>Difficulty
          <select id="qd${key}"><option value="">not set</option>${[1, 2, 3, 4, 5].map(lv =>
            `<option value="${lv}">${lv}</option>`).join("")}</select></label>
        <button class="btn primary" onclick="qAdd(${esc(JSON.stringify(b.id))})">Add question</button>
      </div></div>`;
  };

  const metaEditor = b => `<div class="jform">
    <input type="text" class="emo" id="be_${esc(b.id)}" value="${esc(b.emoji || "")}" maxlength="2" aria-label="Emoji">
    <input type="text" id="bt_${esc(b.id)}" value="${esc(b.title)}" maxlength="${NAME_MAX}" aria-label="Title of the bank">
    <label>Age <input type="number" class="num" id="ba_${esc(b.id)}" value="${b.age_min ?? ""}" min="3" max="19" placeholder="any" aria-label="Suggested age"></label>
    <label>Min a pass <input type="number" class="num" id="bm_${esc(b.id)}" value="${b.minutes}" min="1" max="${QUIZ_MIN_MAX}" aria-label="Minutes a pass"></label>
    <label>Pass mark <input type="number" class="num" id="bp_${esc(b.id)}" value="${b.pass_mark}" min="1" max="50" aria-label="Pass mark"></label>
    <label>Per round <input type="number" class="num" id="br_${esc(b.id)}" value="${b.per_round}" min="3" max="50" aria-label="Questions per round"></label>
    <label><input type="checkbox" id="bx_${esc(b.id)}"${b.active ? " checked" : ""}> On the shelf</label>
    <input type="text" class="wide" id="bs_${esc(b.id)}" value="${esc(b.source_note || "")}" maxlength="300"
      placeholder="Where the facts came from, and when you checked them" aria-label="Source note">
    <button class="btn primary" onclick="bankSave(${esc(JSON.stringify(b.id))})">Save bank</button>
    <button class="mini" onclick="bankDel(${esc(JSON.stringify(b.id))},${esc(JSON.stringify(b.title))})">Remove</button>
  </div>`;

  const quizRow = b => {
    const own = b.source === "db";
    const qs = own ? (dbQ.get(b.id) || []) : [];
    const short = own && b.questions < b.per_round;
    const small = own && !short && b.questions < b.per_round * 4;
    const badge = !own ? `<span class="badge">shipped</span>`
      : !b.active ? `<span class="badge draft">off the shelf</span>`
        : short ? `<span class="badge draft">draft</span>`
          : `<span class="badge mine">yours</span>`;
    return `<details class="job${own && !b.live ? " off" : ""}">
      <summary><span class="e">${esc(b.emoji)}</span><span class="nm">${esc(b.title)}</span>
        ${badge}<span class="pill">+${b.minutes} min a pass</span>
        <span class="tag">${b.questions} question${b.questions === 1 ? "" : "s"} · ${b.per_round} a round · pass ${b.pass_mark}</span></summary>
      <div class="jbody">
        ${short ? `<p class="hint"><b>Not on the kids' list yet.</b> It needs ${b.per_round - b.questions} more question${b.per_round - b.questions === 1 ? "" : "s"} to fill one round.</p>` : ""}
        ${small ? `<p class="hint">Live, but small. ${b.questions} questions for a ${b.per_round} question round means the same ones come round often. Aim for ${b.per_round * 4}.</p>` : ""}
        ${perfBlock(b)}
        ${kidRows(b)}
        <p class="hint">Leave the minutes box empty for the bank's own ${b.minutes}.
          ${b.age_min ? `Written for about ${b.age_min} and up, though anyone can have a go.` : ""}</p>
        ${own ? `<h2 style="margin-top:16px">The bank itself</h2>${metaEditor(b)}
          <div class="qlist">${qs.length ? qs.map(qq => questionRow(b, qq)).join("")
            : '<div class="empty">No questions yet. The first one goes below.</div>'}</div>
          ${newQuestion(b)}`
          : `<p class="hint">This one shipped with Hearth as a file in <code>portal/quizzes</code>. Change it with
             <code>kidnet-quiz</code>, or write your own version below and switch this one off per child.</p>`}
      </div></details>`;
  };

  const mineCount = d.banks.filter(b => b.source === "db").length;
  const quizzes = `<div class="card"><h2>🎓 Quizzes they can pass</h2>
    <p class="sub">Graded on the server, one round at a time, with a rest between goes and a daily cap,
      so they cannot be ground for minutes. Passing is the only way through: that is the point.
      The numbers behind that are yours to set, in <b>The rules of earning</b> below.</p>
    ${d.banks.length ? d.banks.map(quizRow).join("")
      : '<div class="empty">No quiz banks yet. Write one below, or drop a JSON file into portal/quizzes.</div>'}
    <h2 style="margin-top:18px">Write a new bank</h2>
    <p class="sub">It is saved in the database, not in the repo, so updating Hearth can never delete it.
      Add ten questions and it appears on the kids' portal by itself.</p>
    <div class="jform">
      <input type="text" class="emo" id="nb_emoji" value="🎓" maxlength="2" aria-label="Emoji">
      <input type="text" id="nb_title" placeholder="e.g. Spelling, week 4" maxlength="${NAME_MAX}" aria-label="Title of the bank">
      <label>Age <input type="number" class="num" id="nb_age" min="3" max="19" placeholder="any" aria-label="Suggested age"></label>
      <label>Min a pass <input type="number" class="num" id="nb_min" value="10" min="1" max="${QUIZ_MIN_MAX}" aria-label="Minutes a pass"></label>
      <label>Pass mark <input type="number" class="num" id="nb_pass" value="8" min="1" max="50" aria-label="Pass mark"></label>
      <label>Per round <input type="number" class="num" id="nb_round" value="10" min="3" max="50" aria-label="Questions per round"></label>
      <button class="btn primary" onclick="bankAdd()">Start the bank</button>
    </div>
    <div class="jform">
      <input type="text" class="wide" id="nb_note" maxlength="300" placeholder="Where the facts came from, and when you checked them (optional)" aria-label="Source note">
    </div>
    <p class="hint">${quizOnCount} of ${kids.length * d.banks.length} bank and child pairs are switched on.
      ${mineCount ? `${mineCount} bank${mineCount === 1 ? " is" : "s are"} yours; the rest shipped with Hearth.` : ""}
      Want a whole bank written for you? <code>docs/runbooks/quiz-suggestions.md</code> tells your own AI agent how,
      and <code>bin/kidnet-quiz-suggest &lt;child&gt;</code> gathers what it needs to know.</p></div>`;

  // ---- the rules of earning ----------------------------------------------
  // The four numbers that used to be constants in portal.mjs. The household
  // row is the one most people will ever touch; the per child rows exist
  // because a nine year old and a sixteen year old are not the same problem.
  const ruleFields = (key, row) => `
    <label class="fld">Rest between goes
      <input type="number" class="num" id="sc_${key}" value="${row?.quiz_cooldown_min ?? ""}" min="0" max="1440"
        placeholder="${key === "house" ? EARN_DEFAULTS.quiz_cooldown_min : "house"}" aria-label="Rest between goes, minutes"></label>
    <label class="fld">Most a day
      <input type="number" class="num" id="sd_${key}" value="${row?.quiz_daily_cap_min ?? ""}" min="0" max="600"
        placeholder="${key === "house" ? EARN_DEFAULTS.quiz_daily_cap_min : "house"}" aria-label="Most minutes a day from quizzes"></label>
    <label class="fld">Perfect round bonus
      <input type="number" class="num" id="sb_${key}" value="${row?.mastery_bonus_min ?? ""}" min="0" max="60"
        placeholder="${key === "house" ? EARN_DEFAULTS.mastery_bonus_min : "house"}" aria-label="Perfect round bonus, minutes"></label>
    <label class="fld">A pass pays
      <input type="number" class="num" id="sp_${key}" value="${row?.default_minutes_per_pass ?? ""}" min="1" max="${QUIZ_MIN_MAX}"
        placeholder="${key === "house" ? EARN_DEFAULTS.default_minutes_per_pass : "house"}" aria-label="What a pass pays by default, minutes"></label>`;

  const rulesCard = `<div class="card"><h2>⚖️ The rules of earning</h2>
    <p class="sub">What a quiz is worth, and how often. Set it once for the house, then change it for one
      child if you need to. Leave a box empty and it follows the line above it.</p>
    <div class="rules"><span class="who">Everyone</span>${ruleFields("house", rules.get(null))}
      <button class="btn primary" onclick="setRules(null)">Save</button></div>
    ${kids.map(k => `<div class="rules"><span class="who">${esc(k.name)}
        ${rules.has(k.id) ? '<span class="badge mine">own rules</span>' : '<span class="tag">follows the house</span>'}</span>
      ${ruleFields("k" + k.id, rules.get(k.id))}
      <button class="btn primary" onclick="setRules(${k.id})">Save</button></div>`).join("")}
    <table class="helptab">
      <tr><td>Rest between goes</td><td>How long a bank sits quiet after a child has had a round of it, pass or fail.
        Six hours by default. It is what stops a kid taking the same quiz twenty times until the answers fall out.
        Set it to 0 and there is no rest at all.</td></tr>
      <tr><td>Most a day</td><td>The most minutes a child can earn from quizzes in one day, across every bank.
        Thirty by default. Hitting it is framed on the portal as "maxed out for today, nice work", never as a telling off.
        Set it to 0 to switch quiz earning off for them.</td></tr>
      <tr><td>Perfect round bonus</td><td>Extra minutes for getting every question right. Five by default.
        It counts towards the daily cap. Set it to 0 to turn it off.</td></tr>
      <tr><td>A pass pays</td><td>What a pass is worth when nothing more specific says otherwise.
        A bank's own figure wins, and a price you set for one child on a bank wins over both.</td></tr>
    </table>
    <p class="hint">These take effect on the kids' portal within a minute. Nothing here touches the network,
      and nothing here can take away minutes a child has already earned.</p></div>`;

  // ---- history ------------------------------------------------------------
  const perKid = kids.map(k => {
    const t = tot.get(k.id) || { quiz: 0, chore: 0, earned: 0, granted: 0 };
    const mine = d.recent.filter(e => e.child_id === k.id).slice(0, 6);
    return `<div class="kearn"><h3>${esc(k.name)}</h3>
      <div class="sub">Last 7 days: ${esc(fmt.min(t.quiz))} from quizzes, ${esc(fmt.min(t.chore))} from jobs${
        t.granted ? `, ${esc(fmt.min(t.granted))} given by you` : ""}.</div>
      ${mine.length ? mine.map(e => `<div class="hrow"><span>${esc(earnLabel(e))}</span>
          <span class="w">${esc(ago(e.ts))}</span><span class="m">+${e.minutes}</span></div>`).join("")
        : '<div class="empty">Nothing yet. The first pass or the first job will show up here.</div>'}</div>`;
  }).join("");

  const history = `<div class="card"><h2>📜 How they have been earning</h2>
    <p class="sub">Quiz passes, jobs you approved and time you gave, newest first.</p>
    ${kids.length ? perKid : '<div class="empty">No children on the network yet.</div>'}</div>`;

  // ---- badges and the house board -----------------------------------------
  // Badges are earned against a child's OWN history, so this card is really
  // just "what has each of them found so far", never a ranking. The board
  // (dashboard/badges.mjs: boardData) is the one place siblings are actually
  // compared, and it is off until a parent turns it on: docs/GAMIFICATION.md
  // has the reasoning, including what a raw leaderboard would do to the
  // youngest child in the house.
  const badgesByChild = new Map();
  for (const b of d.badges) { if (!badgesByChild.has(b.child_id)) badgesByChild.set(b.child_id, []); badgesByChild.get(b.child_id).push(b); }
  const badgeRows = kids.map(k => {
    const mine = badgesByChild.get(k.id) || [];
    const byId = new Map();
    for (const b of mine) { if (!byId.has(b.id)) byId.set(b.id, []); byId.get(b.id).push(b); }
    const chips = [...byId.values()].map(rows => {
      const [def] = rows;
      return `<span class="pill" title="${esc(def.blurb)}">${def.emoji} ${esc(def.title)}${rows.length > 1 ? ` ×${rows.length}` : ""}</span>`;
    }).join(" ");
    return `<div class="kearn"><h3>${esc(k.name)}</h3>
      <div class="sub">${byId.size} of ${BADGES.length} badges started.</div>
      ${chips || '<div class="empty">Nothing yet. Their first pass unlocks the first one.</div>'}</div>`;
  }).join("");

  const badgesCard = `<div class="card"><h2>🏅 Badges &amp; the house board</h2>
    <p class="sub">Every badge below is earned against a child's own history, never a sibling's, so the
      youngest in the house can hold just as many as the oldest. ${d.boardOn
        ? "The house board is <b>on</b>: siblings can see it on their own portal."
        : "The house board is <b>off</b>. Kids still see their own badges; nobody sees a comparison."}</p>
    <div class="jform">
      <button class="tog${d.boardOn ? " yes" : ""}" onclick="boardToggle(${d.boardOn ? "false" : "true"})">${
        d.boardOn ? "House board: ON, tap to turn off" : "House board: OFF, tap to turn on"}</button>
    </div>
    ${kids.length ? badgeRows : '<div class="empty">No children on the network yet.</div>'}
    <p class="hint">The board never ranks anybody by total minutes or total passes. It spotlights whoever
      improved most lately, tried the widest range of subjects, bounced back best after a flop, or read up
      the most, and it changes often, so it is not the same child every week. See <code>docs/GAMIFICATION.md</code>
      for the full reasoning, including the leaderboard designs that were tried and rejected.</p></div>`;

  return `<style>${STYLE}</style>${hero}${claims}${jobs}${quizzes}${rulesCard}${badgesCard}${history}<script>${SCRIPT}</script>`;
}
