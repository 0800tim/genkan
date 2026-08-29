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
//
// It is kept in its own file, and the view builds its own small style and
// script block, so it stays out of the way of the shared pages.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { esc } from "./charts.mjs";
import { fmt } from "./analytics.mjs";

const QUIZ_DIR = process.env.QUIZ_DIR || path.join(import.meta.dirname, "..", "portal", "quizzes");
const MIN_MAX = 480;          // eight hours is already an absurd reward for one job
const QUIZ_MIN_MAX = 120;
const NAME_MAX = 60;

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
      next.push({
        id: String(b.id), title: String(b.title || b.id), emoji: b.emoji || "\u{1F393}",
        questions: b.questions.length,
        per_round: Number(b.questions_per_round || 10),
        pass_mark: Number(b.pass_mark || 8),
        minutes: Number(b.minutes_per_pass || 10),
        age_min: b.suggested_age_min || null,
      });
    } catch (e) { console.error(`earn: quiz bank ${f}: ${e.message}`); }
  }
  next.sort((a, b) => (a.age_min || 0) - (b.age_min || 0) || a.title.localeCompare(b.title));
  banks = next;
  bankTitles.clear();
  for (const b of banks) bankTitles.set(b.id, b.title);
  return banks;
}
refreshBanks();

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
export async function earnData(q) {
  refreshBanks();
  const [children, tasks, eff, quizPrefs, quizStats, claims, recent, totals] = await Promise.all([
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
  ]);
  return { children, tasks, eff, quizPrefs, quizStats, claims, recent, totals, banks };
}

// ---------------------------------------------------------------------------
// Writing. Every one of these is reached through a POST that sits behind the
// same DASH_TOKEN guard as /api/act.
// ---------------------------------------------------------------------------
const cleanName = v => [...String(v ?? "")].filter(c => c.codePointAt(0) >= 32).join("").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
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
  if (!/^[a-z0-9-]{1,48}$/.test(bankId) || !bankTitles.has(bankId)) return bad(res, "bad quiz");
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
  const quizRow = b => `<details class="job">
    <summary><span class="e">${esc(b.emoji)}</span><span class="nm">${esc(b.title)}</span>
      <span class="pill">+${b.minutes} min a pass</span>
      <span class="tag">${b.questions} questions · ${b.per_round} a round · pass ${b.pass_mark}</span></summary>
    <div class="jbody">
      ${kids.map(k => {
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
      }).join("")}
      <p class="hint">Leave the minutes box empty for the bank's own ${b.minutes}.
        ${b.age_min ? `Written for about ${b.age_min} and up, though anyone can have a go.` : ""}</p>
    </div></details>`;

  const quizzes = `<div class="card"><h2>🎓 Quizzes they can pass</h2>
    <p class="sub">Graded on the server, one round at a time, with a cooldown per bank and a daily cap,
      so they cannot be ground for minutes. Passing is the only way through: that is the point.</p>
    ${d.banks.length ? d.banks.map(quizRow).join("")
      : '<div class="empty">No quiz banks loaded. They live in portal/quizzes as one JSON file each.</div>'}
    <p class="hint">${quizOnCount} of ${kids.length * d.banks.length} bank and child pairs are switched on.
      A bank added to portal/quizzes shows up here on its own.</p></div>`;

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

  return `<style>${STYLE}</style>${hero}${claims}${jobs}${quizzes}${history}<script>${SCRIPT}</script>`;
}
