// The Learning home, and the pieces of the quiz flow that teach rather than
// grade: the missed-questions list with its explanations, and practice rounds.
//
// Imported by dashboard/portal.mjs and nothing else. It is a factory rather
// than a set of bare exports because everything here needs the portal's own
// page() wrapper, its esc(), its bank shelf and its two earn helpers, and the
// portal needs this file, so a plain import each way would be a circle.
//
// What it knows that the hub does not: every bank now carries a subject and a
// year band (portal/quizzes/FORMAT.md), so the shelf can be laid out as a year
// of school, subject by subject, with what this child has already done and
// what would be a good next thing. The hub stays a flat list sorted by age,
// because a child who has just run out of time wants the quickest route to
// minutes, not a syllabus. This page is for the other mood.
//
// Nothing here earns. The Learning home links to the same /study and /quiz
// routes as the hub; a practice round is graded for the child to see, never
// credited, never written to quiz_rounds, so there is nothing on this page a
// child could farm and the economics in LEARN-TO-EARN.md are untouched.

import { randomBytes } from "node:crypto";

// The eight learning areas of the New Zealand Curriculum, in the order the
// curriculum lists them, then the two shelves that are not learning areas.
// tools/validate-quizzes.mjs holds the same ids; a bank with a subject that is
// on neither list is filed under "general" rather than dropped.
export const SUBJECTS = [
  { id: "english",         emoji: "📖", title: "English" },
  { id: "maths",           emoji: "🔢", title: "Mathematics and statistics" },
  { id: "science",         emoji: "🔬", title: "Science" },
  { id: "social-sciences", emoji: "🌏", title: "Social sciences" },
  { id: "technology",      emoji: "💻", title: "Technology" },
  { id: "arts",            emoji: "🎨", title: "The arts" },
  { id: "health-pe",       emoji: "🏃", title: "Health and physical education" },
  { id: "languages",       emoji: "🗣️", title: "Learning languages" },
  { id: "general",         emoji: "🧠", title: "General interest" },
  { id: "other-countries", emoji: "✈️", title: "Other countries" },
];
const SUBJECT_BY_ID = new Map(SUBJECTS.map(s => [s.id, s]));
const CURRICULUM = new Set(SUBJECTS.slice(0, 8).map(s => s.id));   // the learning areas proper

// Year to curriculum level, from research/curriculum-nz.md. The refreshed
// curriculum's phases are named too, because that is the word a child hears
// at school now.
const YEARS = [
  [1,  "Curriculum Level 1, the Years 0 to 3 phase"],
  [2,  "Curriculum Level 1, the Years 0 to 3 phase"],
  [3,  "Curriculum Level 2, the Years 0 to 3 phase"],
  [4,  "Curriculum Level 2, the Years 4 to 6 phase"],
  [5,  "Curriculum Level 3, the Years 4 to 6 phase"],
  [6,  "Curriculum Level 3, the Years 4 to 6 phase"],
  [7,  "Curriculum Level 4, the Years 7 and 8 phase"],
  [8,  "Curriculum Level 4, the Years 7 and 8 phase"],
  [9,  "Curriculum Level 5, the Years 9 and 10 phase"],
  [10, "Curriculum Level 5, the Years 9 and 10 phase"],
  [11, "Curriculum Level 6, NCEA Level 1"],
  [12, "Curriculum Level 7, NCEA Level 2"],
  [13, "Curriculum Level 8, NCEA Level 3"],
];
export const yearBlurb = y => (YEARS.find(([n]) => n === y) || [])[1] || "";

// A child's own year. The children table has no year column, so it is read
// from two places a household already fills in: a note that says "Year 7"
// (the dashboard's Family page keeps free-text notes), or failing that the
// age. Year 1 starts at about five in New Zealand, so year is age minus four,
// which is right for most children and one out for some, and the page says
// which it used. Null when neither is known.
export function kidYear(kid) {
  const m = String(kid?.notes || "").match(/\byear\s*(\d{1,2})\b/i);
  if (m) { const y = Number(m[1]); if (y >= 1 && y <= 13) return { year: y, from: "note" }; }
  const age = Number(kid?.age || 0);
  if (age >= 5 && age <= 18) return { year: Math.max(1, Math.min(13, age - 4)), from: "age" };
  return null;
}

export const bankYears = b =>
  (Number.isInteger(b.year_from) && Number.isInteger(b.year_to)) ? { from: b.year_from, to: b.year_to } : null;
export const subjectOf = b => SUBJECT_BY_ID.has(b.subject) ? b.subject : "general";
const yearsLabel = b => {
  const y = bankYears(b);
  if (!y) return "any year";
  return y.from === y.to ? `Year ${y.from}` : `Years ${y.from} to ${y.to}`;
};

export const LEARN_CSS = `
.yearpick{display:flex;align-items:center;gap:8px;margin:12px 0 6px;flex-wrap:wrap}
.yearpick select{font:600 16px system-ui,sans-serif;padding:9px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.35);
  background:rgba(0,0,0,.28);color:#fff;min-width:120px}
.yearpick button{font:600 14px system-ui,sans-serif;padding:9px 12px;border-radius:10px;border:0;background:#c4b5fd;color:#312e81;cursor:pointer}
.ylead{font-size:13.5px;opacity:.85;line-height:1.5}
.strip{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.strip .st{background:rgba(0,0,0,.22);border-radius:11px;padding:8px 11px;font-size:13px;line-height:1.3}
.strip .st b{display:block;font-size:18px}
.lrow{display:grid;grid-template-columns:34px 1fr;gap:4px 10px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.14)}
.lrow:last-child{border-bottom:0}
.lrow .e{font-size:26px;grid-row:span 2;line-height:1.2}
.lrow .lt{font-size:15px;font-weight:700;line-height:1.3}
.lrow .lt small{font-weight:400;opacity:.75;font-size:12.5px;margin-left:6px;white-space:nowrap}
.lrow .ls{font-size:13px;opacity:.85;line-height:1.5}
.lrow .la{display:flex;gap:7px;flex-wrap:wrap;margin-top:6px;grid-column:2}
.lrow .la a,.lrow .la span{display:inline-block;padding:7px 12px;border-radius:10px;font-size:13.5px;font-weight:600;
  text-decoration:none;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22)}
.lrow .la a.go{background:#4ade80;color:#14532d;border-color:transparent}
.lrow .la span{opacity:.6}
.lrow.done .lt::before{content:"✓ ";color:#4ade80}
.lrow.off{opacity:.55}
.nextup{border:1px solid rgba(74,222,128,.55);background:rgba(74,222,128,.10)}
.nextup .why{font-size:14px;line-height:1.5;margin:4px 0 10px}
.fold{margin-top:6px}
.fold>summary{list-style:none;cursor:pointer;padding:10px 12px;border-radius:13px;
  background:rgba(255,255,255,.08);border:1px dashed rgba(255,255,255,.28);font-weight:600;margin-bottom:8px}
.fold>summary::-webkit-details-marker{display:none}
.fold .sub{font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8;margin:12px 0 2px}
.miss{margin-top:8px}
.miss .mq{background:rgba(0,0,0,.22);border-radius:12px;padding:12px 14px;margin-bottom:8px}
.miss .mq p{margin:0 0 6px;line-height:1.45}
.miss .mq .you{opacity:.8}.miss .mq .you s{opacity:.85}
.miss .mq .ans{display:inline-block;background:rgba(74,222,128,.22);border:1px solid rgba(74,222,128,.5);border-radius:9px;padding:3px 10px;font-weight:700}
.miss .mq .why{opacity:.9;font-size:14.5px;margin-top:7px}
.earned{background:rgba(0,0,0,.22);border-radius:12px;padding:12px 14px;line-height:1.55;font-size:15px;margin:10px 0}
.earned b{color:#fde68a}
.actions{display:flex;flex-direction:column;gap:8px;margin-top:10px}
a.go{display:block;text-align:center;background:#4ade80;color:#14532d;text-decoration:none;font-weight:700;font-size:16px;padding:13px;border-radius:10px}
a.go.alt{background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.28)}
.crumbs{display:flex;gap:14px;flex-wrap:wrap;margin-top:4px}
.crumbs a{color:#c4b5fd}
.meta{font-size:13px;opacity:.8;margin:4px 0 10px}
`;

const clock = ts => ts ? new Date(ts).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" }) : "";
const ago = ts => {
  if (!ts) return "";
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : "a while ago";
};

export function createLearn({ q, page, esc, banks, quizOn, quizMinutes, demo }) {

  // ---- what this child has done ------------------------------------------
  // Read straight from the round log and the study-visit log. Every query is
  // best effort: a box that has not loaded schema-quizresults.sql or
  // schema-badges.sql still gets a Learning home, it just shows nothing as
  // done, which is true as far as that box knows.
  async function progress(childId) {
    const soft = (sql, p) => q(sql, p).catch(() => []);
    const tot = await soft(`SELECT bank_id, count(*)::int AS rounds, count(*) FILTER (WHERE passed)::int AS passes,
        max(correct)::int AS best, max(asked)::int AS asked, max(ts) AS last_ts
        FROM quiz_rounds WHERE child_id=$1 GROUP BY bank_id`, [childId]);
    const last = await soft(`SELECT DISTINCT ON (bank_id) bank_id, correct, asked, passed
        FROM quiz_rounds WHERE child_id=$1 ORDER BY bank_id, ts DESC`, [childId]);
    const read = await soft(`SELECT DISTINCT bank_id FROM quiz_study_visits WHERE child_id=$1`, [childId]);
    const [bd] = await soft(`SELECT count(*)::int AS n FROM child_badges WHERE child_id=$1`, [childId]);
    const by = new Map();
    for (const r of tot) by.set(r.bank_id, { ...r, read: false });
    for (const r of last) { const b = by.get(r.bank_id); if (b) b.last = r; }
    for (const r of read) { const b = by.get(r.bank_id) || { rounds: 0, passes: 0 }; b.read = true; by.set(r.bank_id, b); }
    return { by, badges: Number(bd?.n || 0) };
  }

  // ---- the shelf, laid out as a year -------------------------------------
  const fits = (b, year) => { const y = bankYears(b); return !!y && year >= y.from && year <= y.to; };
  const subjectOrder = b => SUBJECTS.findIndex(s => s.id === subjectOf(b));
  // Within a subject, the bank written FOR this band (the narrow one) sits
  // above the general one that merely includes it: "Science, Years 7 and 8"
  // before "Science Basics, Years 6 to 9".
  const width = b => { const y = bankYears(b); return y ? y.to - y.from : 99; };
  const sortBanks = list => list.sort((a, b) => subjectOrder(a) - subjectOrder(b)
    || width(a) - width(b) || (bankYears(a)?.from || 0) - (bankYears(b)?.from || 0)
    || String(a.title).localeCompare(String(b.title)));

  // Whether a bank can pay right now, and the reason when it cannot. The same
  // three rules the hub applies, read from the same status object.
  function payState(st, b) {
    const last = st.lastPassAt[b.id] || 0;
    const coolUntil = last + st.set.quiz_cooldown_min * 60_000;
    if (Date.now() < coolUntil) return { ok: false, note: `ready ${clock(coolUntil)}` };
    const capLeft = Math.max(0, st.set.quiz_daily_cap_min - st.quizEarnedToday);
    if (capLeft <= 0) return { ok: false, note: "daily cap reached" };
    return { ok: true, note: `+${Math.min(quizMinutes(st, b), capLeft)} min`, capLeft };
  }

  // The one thing to do next, for this child, in this year. In order: a bank
  // whose last round was a fail (coming back is the badge-worthy act, and
  // it is the same rule badges.mjs uses for "bounced back"), then a
  // curriculum bank they have never opened, then the passed bank they passed
  // longest ago that is off cooldown. Never a bank a parent switched off for
  // them, and never something outside the year they are looking at.
  function pickNext(list, prog, st) {
    const on = list.filter(b => quizOn(st, b) && CURRICULUM.has(subjectOf(b)));
    const p = id => prog.by.get(id);
    const tried = on.filter(b => p(b.id)?.rounds > 0 && p(b.id)?.last && !p(b.id).last.passed)
      .sort((a, b) => new Date(p(b.id).last_ts) - new Date(p(a.id).last_ts));
    if (tried.length) return { bank: tried[0], why: `You got ${p(tried[0].id).last?.correct ?? "some"} of ${p(tried[0].id).last?.asked ?? ""} last time. Read up, then have another go: coming back after a flop is a badge.` };
    const fresh = on.filter(b => !(p(b.id)?.rounds > 0));
    if (fresh.length) {
      const b = fresh[0];
      return { bank: b, why: `${SUBJECT_BY_ID.get(subjectOf(b)).title} for this year, and you have not tried it yet.${p(b.id)?.read ? " You have already read up on it." : ""}` };
    }
    const passed = on.filter(b => payState(st, b).ok)
      .sort((a, b) => (st.lastPassAt[a.id] || 0) - (st.lastPassAt[b.id] || 0));
    if (passed.length) return { bank: passed[0], why: "You have passed everything for this year. This is the one you passed longest ago, so it is worth a fresh round." };
    return null;
  }

  function bankRow(b, prog, st, kidQS) {
    const p = prog.by.get(b.id);
    const on = quizOn(st, b);
    const pay = payState(st, b);
    let status;
    if (p?.passes > 0) status = `Passed ${p.passes === 1 ? "once" : p.passes + " times"}, best ${p.best}/${p.asked}, last ${ago(p.last_ts)}${p.read ? ". Read up ✓" : ""}`;
    else if (p?.rounds > 0) status = `Last go ${p.last?.correct}/${p.last?.asked}, not passed yet${p.read ? ". Read up ✓" : ". Reading up first helps"}`;
    else if (p?.read) status = "Read up, not tried yet";
    else status = "Not started";
    const cls = ["lrow", p?.passes > 0 ? "done" : "", on ? "" : "off"].join(" ").trim();
    const act = !on
      ? `<a href="/study/${esc(b.id)}${kidQS}">Read up</a><span>off your list just now</span>`
      : pay.ok
        ? `<a href="/study/${esc(b.id)}${kidQS}">Read up</a><a class="go" href="/quiz/${esc(b.id)}${kidQS}">Quiz, ${esc(pay.note)}</a>`
        : `<a href="/study/${esc(b.id)}${kidQS}">Read up</a><span>${esc(pay.note)}</span>`;
    return `<div class="${cls}"><span class="e">${esc(b.emoji || "🎓")}</span>
      <div class="lt">${esc(b.title)}<small>${esc(yearsLabel(b))}</small></div>
      <div class="ls">${esc(status)}</div>
      <div class="la">${act}</div></div>`;
  }

  // ---- the page ----------------------------------------------------------
  // `year` is what the page shows; `own` is what the child's record says.
  // They differ when somebody picked a different year from the chooser, and
  // the page says so rather than pretending the child moved school.
  function learnPage({ kid, year, own, st, prog, kidQS, ctx }) {
    const all = [...banks.values()];
    const inYear = sortBanks(all.filter(b => fits(b, year)));
    const curriculum = inYear.filter(b => CURRICULUM.has(subjectOf(b)));
    const general = inYear.filter(b => subjectOf(b) === "general");
    const abroad = inYear.filter(b => subjectOf(b) === "other-countries");
    const elsewhere = sortBanks(all.filter(b => !fits(b, year) && subjectOf(b) !== "other-countries"));
    const abroadOther = sortBanks(all.filter(b => !fits(b, year) && subjectOf(b) === "other-countries"));

    const passedHere = curriculum.filter(b => prog.by.get(b.id)?.passes > 0).length;
    const rounds = [...prog.by.values()].reduce((a, p) => a + (p.rounds || 0), 0);
    const next = pickNext(inYear, prog, st);

    const chooser = `<form class="yearpick" method="get" action="/learn">
      ${kidQS ? `<input type="hidden" name="kid" value="${esc(kidQS.replace(/^\?kid=/, "").replace(/%20/g, " "))}">` : ""}
      <label for="year" style="display:inline;background:none;padding:0;margin:0;font-weight:600">Show me</label>
      <select id="year" name="year" onchange="this.form.submit()">${YEARS.map(([y]) =>
        `<option value="${y}"${y === year ? " selected" : ""}>Year ${y}${own && own.year === y ? " (yours)" : ""}</option>`).join("")}</select>
      <button>Go</button></form>`;
    const yourYear = !own
      ? `We do not know your year yet, so this is Year ${year}. Pick yours above.`
      : own.year === year
        ? `Your year${own.from === "age" ? ", worked out from your age" : ""}.`
        : `You are looking at Year ${year}; your own is Year ${own.year}.`;

    const subjectCards = SUBJECTS.slice(0, 8).map(s => {
      const list = curriculum.filter(b => subjectOf(b) === s.id);
      if (!list.length) return "";
      return `<div class="card"><h2>${s.emoji} ${esc(s.title)}</h2>${list.map(b => bankRow(b, prog, st, kidQS)).join("")}</div>`;
    }).join("");
    const missing = SUBJECTS.slice(0, 8).filter(s => !curriculum.some(b => subjectOf(b) === s.id)).map(s => s.title);

    const nextCard = next
      ? `<div class="card nextup"><h2>Next up</h2>
          <div class="lt" style="font-size:17px;font-weight:700">${esc(next.bank.emoji || "🎓")} ${esc(next.bank.title)}
            <small style="font-weight:400;opacity:.75;font-size:13px">${esc(yearsLabel(next.bank))}</small></div>
          <div class="why">${esc(next.why)}</div>
          <div class="actions">
            <a class="go" href="/quiz/${esc(next.bank.id)}${kidQS}">Start a round, ${esc(payState(st, next.bank).note)}</a>
            <a class="go alt" href="/study/${esc(next.bank.id)}${kidQS}">Read up first</a></div></div>`
      : `<div class="card nextup"><h2>Next up</h2><div class="why">${curriculum.length
          ? "Nothing on this year's list can pay right now. Reading up is always open, and the general interest banks below may be ready."
          : `There is no bank written for Year ${year} yet. The nearest years are listed under More below, and every one of them is open to you.`}</div></div>`;

    const fold = (title, list) => list.length
      ? `<details class="fold"><summary>${esc(title)} (${list.length})</summary>${list.map(b => bankRow(b, prog, st, kidQS)).join("")}</details>`
      : "";

    return page(`<div class="card">
        <h1>📚 Learning</h1>
        <div class="who">Hi ${esc(kid.name)}. Every quiz bank, filed by school year and subject, with what you have done and what to do next. Reading up is free and never rationed; a pass earns minutes.</div>
        ${chooser}
        <div class="ylead"><b>Year ${year}</b>: ${esc(yearBlurb(year))}. ${esc(yourYear)}</div>
        <div class="strip">
          <div class="st"><b>${passedHere} of ${curriculum.length}</b>banks for this year passed</div>
          <div class="st"><b>${rounds}</b>rounds played</div>
          <div class="st"><b>${prog.badges}</b>badges</div>
        </div>
        <div class="crumbs" style="margin-top:12px"><a href="/badges${kidQS}">🏅 My badges</a><a href="/${kidQS}">← back to Genkan</a></div>
      </div>
      ${nextCard}
      ${subjectCards}
      ${missing.length ? `<div class="card"><div class="small">No bank for Year ${year} in ${esc(missing.join(", "))} yet. Genkan's banks are written a subject at a time, and coverage is uneven; anybody can add one (portal/quizzes/FORMAT.md).</div></div>` : ""}
      ${general.length ? `<div class="card"><h2>🧠 General interest, any subject</h2>${general.map(b => bankRow(b, prog, st, kidQS)).join("")}</div>` : ""}
      <div class="card"><h2>More</h2>
        ${fold("Other years", elsewhere)}
        ${fold("Other countries", [...abroad, ...abroadOther])}
        <div class="small" style="margin-top:8px">Nothing is locked. The year only decides what sits at the top.</div></div>
      <div class="card"><div class="small">What this is: quiz banks written alongside the New Zealand curriculum, each with an answer and an explanation for every question, so a child can read up before a round. It is not a validated curriculum and nobody has marked it against a syllabus; the year on each bank was chosen by reading it, and the bank's own note says how. Study notes and tutoring are coming, and everything stays in the house.${demo ? " This is the public demo: an invented family and made-up history, on the same code a household runs." : ""}</div></div>`, ctx);
  }

  // ---- the missed questions, with the answer and why -------------------
  // `items` is [{prompt, yours, answer, explanation}]. Rendered on the result
  // page for every question the child got wrong, so the explanation that has
  // always been in the bank is finally read at the moment it is useful.
  function missedBlock(items) {
    if (!items.length) return "";
    return `<h2 style="margin-top:14px">The ${items.length === 1 ? "one" : items.length} you missed</h2>
      <div class="miss">${items.map(m => `<div class="mq">
        <p><b>${esc(m.prompt)}</b></p>
        <p class="you">You said: <s>${esc(m.yours ?? "no answer")}</s></p>
        <p><span class="ans">${esc(m.answer)}</span></p>
        ${m.explanation ? `<p class="why">${esc(m.explanation)}</p>` : ""}
      </div>`).join("")}</div>`;
  }

  // ---- practice rounds ---------------------------------------------------
  // "Try the ones you missed": the same questions, choices reshuffled, graded
  // the same way, and worth nothing. No minutes, no cooldown, no row in
  // quiz_rounds (a practice round is not form, and it must not push the ramp
  // towards "building" because the child chose to redo the hard ones). Kept
  // in memory like live rounds; lost on restart, which only means "start
  // again from the result page".
  const practice = new Map();
  setInterval(() => { const now = Date.now(); for (const [t, r] of practice) if (r.expires < now) practice.delete(t); }, 60_000).unref();

  function startPractice(childId, bankId, qids) {
    if (!qids.length) return "";
    const token = randomBytes(12).toString("hex");
    practice.set(token, { childId, bankId, qids, expires: Date.now() + 60 * 60_000, questions: [] });
    return token;
  }

  function practicePage(kid, token, kidQS, ctx) {
    const pr = practice.get(token);
    if (!pr || pr.childId !== kid.id || pr.expires < Date.now())
      return page(`<div class="card"><div class="msg">That practice set has gone. Start a fresh round and it comes back.</div><p><a class="back" href="/learn${kidQS}">← Learning</a></p></div>`, ctx);
    const bank = banks.get(pr.bankId);
    if (!bank) return page(`<div class="card"><div class="msg">That bank is not on the shelf any more.</div></div>`, ctx);
    const byId = new Map(bank.questions.map(qq => [qq.id, qq]));
    pr.questions = [];
    const qhtml = pr.qids.map(byId.get.bind(byId)).filter(Boolean).map((qq, i) => {
      const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
      pr.questions.push({ qid: qq.id, answer: order.indexOf(qq.answer_index), order });
      return `<div class="q"><p><b>${i + 1}.</b> ${esc(qq.prompt)}</p>
        ${order.map((oi, j) => `<label><input type=radio name="q${i}" value="${j}" required>${esc(qq.choices[oi])}</label>`).join("")}</div>`;
    }).join("");
    return page(`<div class="card"><h1>🔁 Practice: ${esc(bank.emoji || "")} ${esc(bank.title)}</h1>
      <div class="who">Just the ${pr.questions.length === 1 ? "one" : pr.questions.length} you missed, choices shuffled. No minutes for this and no cooldown: it is for you, not the clock.</div>
      <form method="post" action="/practice/submit${kidQS}"><input type=hidden name=t value="${token}">${qhtml}
      <button class="go">Check my answers</button></form>
      <div class="crumbs"><a href="/study/${esc(bank.id)}${kidQS}">Read up</a><a href="/learn${kidQS}">Learning</a><a href="/${kidQS}">← back</a></div></div>`, ctx);
  }

  function gradePractice(kid, form, kidQS, ctx) {
    const token = form.get("t") || "";
    const pr = practice.get(token);
    if (!pr || pr.childId !== kid.id || pr.expires < Date.now() || !pr.questions.length)
      return page(`<div class="card"><div class="msg">That practice set has gone. No worries, nothing was riding on it.</div><p><a class="back" href="/learn${kidQS}">← Learning</a></p></div>`, ctx);
    practice.delete(token);
    const bank = banks.get(pr.bankId);
    const byId = new Map((bank?.questions || []).map(qq => [qq.id, qq]));
    let right = 0; const missed = [];
    pr.questions.forEach((x, i) => {
      const qq = byId.get(x.qid); if (!qq) return;
      const picked = Number(form.get(`q${i}`));
      if (picked === x.answer) { right++; return; }
      missed.push(missedItem(qq, x.order, picked));
    });
    const total = pr.questions.length;
    const again = startPractice(kid.id, pr.bankId, missed.map(m => m.qid));
    return page(`<div class="card"><div class="score">${right} / ${total}</div>
      <div class="msg">${right === total
        ? "All of them this time. That is the point of practice."
        : `${right === 0 ? "None yet" : right + " right"}. The ${missed.length === 1 ? "one" : missed.length} still to get ${missed.length === 1 ? "is" : "are"} below, with why.`}</div>
      <div class="earned">Practice round, so <b>no minutes</b> and no cooldown. A real round of this bank pays as usual when it is ready.</div>
      ${missedBlock(missed)}
      <div class="actions">
        ${again ? `<a class="go" href="/practice/${again}${kidQS}">Try ${missed.length === 1 ? "it" : "those"} again</a>` : ""}
        ${bank ? `<a class="go${again ? " alt" : ""}" href="/quiz/${esc(bank.id)}${kidQS}">A real round of ${esc(bank.title)}</a>` : ""}
        <a class="go alt" href="/learn${kidQS}">📚 Learning</a></div>
      <p style="text-align:center"><a class="back" href="/${kidQS}">← back to Genkan</a></p></div>`, ctx);
  }

  // One missed question, ready for missedBlock. `order` is the shuffle the
  // choices were served in and `picked` the slot the child chose, so the page
  // can show the words they picked rather than a number. A picked slot the
  // form never sent (an unanswered question on an expired form) shows as "no
  // answer".
  function missedItem(qq, order, picked) {
    const yours = Array.isArray(order) && Number.isInteger(picked) && order[picked] !== undefined
      ? qq.choices[order[picked]] : undefined;
    return { qid: qq.id, prompt: qq.prompt, yours, answer: qq.choices[qq.answer_index], explanation: qq.explanation };
  }

  const subjectTitle = b => SUBJECT_BY_ID.get(subjectOf(b)).title;

  return { progress, pickNext, payState, learnPage, missedBlock, missedItem, startPractice, practicePage, gradePractice, fits, yearsLabel, subjectTitle };
}
