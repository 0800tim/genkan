// Kid portal for the Hearth island. Two jobs:
//  1. Captive portal: a blocked or out-of-time device's web traffic lands
//     here (nft redirect), OS captive-probes pop this page, and it explains
//     why instead of letting pages silently fail.
//  2. Learn-to-earn hub: quizzes that credit minutes instantly (graded
//     server-side, cooldown + daily cap so they cannot be ground) and chore
//     claims that wait for a parent's approval on the dashboard.
// The portal only ever WRITES THE DATABASE. The gateway reconciles the
// firewall from the database every few seconds, so an earned unblock takes
// effect without the portal touching nft at all.
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";

const BIND = process.env.BIND || "127.0.0.1";   // container: 0.0.0.0 (its netns is the island)
const PORT = Number(process.env.PORT || 8890);  // container: 80
const QUIZ_DIR = process.env.QUIZ_DIR || path.join(import.meta.dirname, "..", "portal", "quizzes");
const QUIZ_COOLDOWN_MIN = Number(process.env.QUIZ_COOLDOWN_MIN || 360); // per bank
const QUIZ_DAILY_CAP = Number(process.env.QUIZ_DAILY_CAP || 30);        // minutes/day from quizzes
const MASTERY_BONUS = 5;                                                // perfect round
// IN_CONTAINER is set by compose.yaml: containers reach Postgres by its
// docker-network name, host processes via the published localhost port.
const pool = new pg.Pool({ connectionString: process.env.IN_CONTAINER ? process.env.KIDS_DB_URL_DOCKER : process.env.KIDS_DB_URL });
const q = (t, p) => pool.query(t, p).then(r => r.rows);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---- quiz banks: loaded once, validated, answers never leave the server ----
const banks = new Map();
for (const f of readdirSync(QUIZ_DIR).filter(f => f.endsWith(".json"))) {
  try {
    const b = JSON.parse(readFileSync(path.join(QUIZ_DIR, f), "utf8"));
    if (b.id && Array.isArray(b.questions) && b.questions.length >= 4 * (b.questions_per_round || 10)) banks.set(b.id, b);
    else console.error(`quiz bank ${f}: skipped (shape/size)`);
  } catch (e) { console.error(`quiz bank ${f}: ${e.message}`); }
}
console.log(`portal: ${banks.size} quiz banks loaded`);

// Active rounds live in memory: token -> {childId, bankId, questions:[{qid, answer}], expires}.
// Lost on restart, which only means "start the round again". Nothing secret persists.
const rounds = new Map();
const newToken = () => randomBytes(16).toString("hex");
setInterval(() => { const now = Date.now(); for (const [t, r] of rounds) if (r.expires < now) rounds.delete(t); }, 60_000).unref();

// A device is WHO ITS IP SAYS IT IS. The ?kid= override is preview only: it is
// honoured just when the source IP maps to no child (admin on the tailnet, or
// pre-hardware testing), never to let one kid act as another. Returns the
// child plus whether this was a real device match (POSTs require that).
async function whoIs(ip, override) {
  const [byIp] = await q("SELECT c.id,c.name,c.age FROM children c JOIN devices d ON d.child_id=c.id WHERE host(d.reserved_ip)=$1 LIMIT 1", [ip]);
  if (byIp) return { ...byIp, real: true };
  if (override) { const [o] = await q("SELECT id,name,age FROM children WHERE lower(name)=lower($1)", [override]); if (o) return { ...o, real: false }; }
  return null;
}
async function status(childId) {
  const [rem] = await q("SELECT * FROM time_remaining WHERE child_id=$1", [childId]);
  const cats = await q("SELECT category,set_by FROM category_state WHERE child_id=$1 AND blocked", [childId]);
  const tasks = await q("SELECT id,name,minutes FROM tasks WHERE active AND needs_approval ORDER BY minutes DESC");
  const claims = await q("SELECT ec.task_id, ec.status FROM earn_claims ec WHERE ec.child_id=$1 AND ec.ts::date=CURRENT_DATE", [childId]);
  const quizToday = await q(`SELECT COALESCE(SUM(minutes),0) m FROM time_events
    WHERE child_id=$1 AND kind='earn' AND reason LIKE 'quiz:%' AND ts::date=CURRENT_DATE`, [childId]);
  const lastPass = await q(`SELECT reason, max(ts) t FROM time_events
    WHERE child_id=$1 AND kind='earn' AND reason LIKE 'quiz:%' GROUP BY reason`, [childId]);
  return { rem, cats, tasks, claims, quizEarnedToday: Number(quizToday[0]?.m || 0),
           lastPassAt: Object.fromEntries(lastPass.map(r => [r.reason.slice(5), new Date(r.t).getTime()])) };
}
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
    const upd = await pool.query(`UPDATE category_state SET blocked=false, since=now(), set_by='earned-back'
      WHERE child_id=$1 AND category='internet' AND blocked AND set_by IN ('out-of-time','earned-back')`, [childId]);
    if (upd.rowCount > 0)
      await q("INSERT INTO block_events(target_type,target_ref,action,source,actor) VALUES('child',(SELECT name FROM children WHERE id=$1),'on','earn','portal')", [childId]);
  }
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
const page = body => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Hearth</title><style>${CSS}</style><div class="wrap">${body}</div>`;
const helpFoot = `<div class="foot">Need to talk to someone? Free, any time: call or text <b>1737</b>,
 or Youthline <b>0800 376 633</b>. These always work, even when your internet is off.</div>`;

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

// Both roads into this page end up in the alerts table, so the portal only has
// to read one thing: the DNS road (kidnet-alerts matches a lookup against
// flag_domains) and the IP road (the nft tor_dev counters, attributed to a
// child by the metering pass). Nothing here touches the firewall.
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
    <div class="card"><p style="margin:0"><a class="back" href="/hub${kidQS}">\u2190 Back to Hearth (time, quizzes, jobs)</a></p></div>`);
}

function homePage(kid, st, kidQS) {
  const rem = st.rem?.remaining_min ?? 0;
  const unlimited = (st.rem?.budget_min || 0) >= 999;
  const inet = st.cats.find(c => c.category === "internet");
  const outOfTime = inet?.set_by === "out-of-time" || (rem <= 0 && (st.rem?.used_min ?? 0) > 0);
  const head = inet
    ? `<h1>${outOfTime ? "⏳ Time's up" : "⏸️ Internet paused"}</h1>
       <div class="who">Hi ${esc(kid.name)}. ${outOfTime ? "You've used today's time, but you can earn more below." : "Some things are switched off right now. You can still earn time for later."}</div>`
    : `<h1>👋 Kia ora ${esc(kid.name)}</h1><div class="who">Your time, your call. Earn more below whenever you like.</div>`;
  const capLeft = Math.max(0, QUIZ_DAILY_CAP - st.quizEarnedToday);
  const quizCards = [...banks.values()].map(b => {
    const last = st.lastPassAt[b.id] || 0;
    const coolUntil = last + QUIZ_COOLDOWN_MIN * 60_000;
    const cooling = Date.now() < coolUntil;
    const note = cooling ? `ready ${new Date(coolUntil).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })}`
               : capLeft <= 0 ? "daily cap reached" : `+${Math.min(b.minutes_per_pass, capLeft)} min`;
    return (cooling || capLeft <= 0)
      ? `<div class="qcard dim"><span class="e">${esc(b.emoji || "🎓")}</span><b>${esc(b.title)}</b><span class="m">${note}</span></div>`
      : `<a class="qcard" href="/quiz/${esc(b.id)}${kidQS}"><span class="e">${esc(b.emoji || "🎓")}</span><b>${esc(b.title)}</b><span class="m">${note}</span></a>`;
  }).join("");
  const claimed = new Set(st.claims.map(c => c.task_id));
  const chores = st.tasks.map(t => claimed.has(t.id)
    ? `<div class="qcard dim"><span class="e">🧺</span><b>${esc(t.name)}</b><span class="m pill">waiting for Dad</span></div>`
    : `<form class="qcard" method="post" action="/claim${kidQS}" style="margin:0 0 8px"><span class="e">🧺</span><b>${esc(t.name)}</b>
        <span class="m"><input type=hidden name=task value="${t.id}"><button class="claimbtn">I did this · +${t.minutes}</button></span></form>`).join("");
  return page(`
    <div class="card">${head}
      <div class="rem">${unlimited ? "∞" : Math.max(0, rem)}<small> ${unlimited ? "no daily limit" : "min left today"}</small></div></div>
    <div class="card"><h2>🎓 Earn time: quizzes (instant)</h2>${quizCards}
      <div class="small">Pass a round to get minutes straight away. Perfect round = +${MASTERY_BONUS} bonus. Up to ${QUIZ_DAILY_CAP} min a day from quizzes; you've earned ${st.quizEarnedToday} today.</div></div>
    <div class="card"><h2>🧺 Earn time: jobs (Dad approves)</h2>${chores || '<div class="small">No jobs set up yet.</div>'}</div>
    <div class="card">${helpFoot}</div>`);
}

function quizPage(kid, bank, kidQS) {
  const pick = [...bank.questions].sort(() => Math.random() - 0.5).slice(0, bank.questions_per_round || 10);
  const token = newToken();
  const round = { childId: kid.id, bankId: bank.id, expires: Date.now() + 15 * 60_000, questions: [] };
  const qhtml = pick.map((qq, i) => {
    const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);        // shuffle choices per round
    round.questions.push({ qid: qq.id, answer: order.indexOf(qq.answer_index) });
    return `<div class="q"><p><b>${i + 1}.</b> ${esc(qq.prompt)}</p>
      ${order.map((oi, j) => `<label><input type=radio name="q${i}" value="${j}" required>${esc(qq.choices[oi])}</label>`).join("")}</div>`;
  }).join("");
  rounds.set(token, round);
  return page(`<div class="card"><h1>${esc(bank.emoji || "")} ${esc(bank.title)}</h1>
    <div class="who">${round.questions.length} questions. Get ${bank.pass_mark} right to earn ${bank.minutes_per_pass} minutes. All ${round.questions.length} right = +${MASTERY_BONUS} bonus.</div>
    <form method="post" action="/quiz/submit${kidQS}"><input type=hidden name=t value="${token}">${qhtml}
    <button class="go">Check my answers</button></form>
    <p><a class="back" href="/${kidQS}">← back</a></p></div>`);
}

async function gradeRound(kid, form, kidQS) {
  const round = rounds.get(form.get("t") || "");
  if (!round || round.childId !== kid.id || round.expires < Date.now())
    return page(`<div class="card"><div class="msg">That round expired. No worries, grab a fresh one.</div><p><a class="back" href="/${kidQS}">← back</a></p></div>`);
  rounds.delete(form.get("t"));                                       // one grading per round, ever
  const bank = banks.get(round.bankId);
  let right = 0;
  round.questions.forEach((qq, i) => { if (Number(form.get(`q${i}`)) === qq.answer) right++; });
  const total = round.questions.length, passed = right >= (bank.pass_mark || 8);
  let creditedMsg = "";
  if (passed) {
    const st = await status(kid.id);
    const coolMs = (st.lastPassAt[bank.id] || 0) + QUIZ_COOLDOWN_MIN * 60_000 - Date.now();
    const capLeft = Math.max(0, QUIZ_DAILY_CAP - st.quizEarnedToday);
    if (coolMs > 0) creditedMsg = "You already passed this one recently, so no minutes this time. Try another quiz.";
    else if (capLeft <= 0) creditedMsg = `You've hit today's ${QUIZ_DAILY_CAP} minute quiz cap. Nice work, back tomorrow.`;
    else {
      const mins = Math.min(bank.minutes_per_pass || 10, capLeft) + (right === total ? MASTERY_BONUS : 0);
      await credit(kid.id, mins, `quiz:${bank.id}`);
      creditedMsg = `+${mins} minutes earned${right === total ? " (perfect round bonus included)" : ""}. It's already on your clock.`;
    }
  }
  return page(`<div class="card"><div class="score">${right} / ${total}</div>
    <div class="msg">${passed ? "🎉 Passed. " + esc(creditedMsg) : `Not this time, you need ${bank.pass_mark}. Have another go, the questions change.`}</div>
    <p style="text-align:center"><a class="back" href="/${kidQS}">← back to Hearth</a></p></div>`);
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
    const kid = await whoIs(ip, kidOverride);
    const send = html => { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); };
    if (!kid) return send(page(`<div class="card"><h1>Hearth</h1><div class="msg">This device isn't recognised on the kids network yet. Ask Dad to add it.</div>${helpFoot}</div>`));
    if (req.method === "POST") {
      if (!kid.real) return send(page(`<div class="card"><div class="msg">Earning only works from your own device on the network.</div></div>`));
      if ((lastPost.get(kid.id) || 0) > Date.now() - 1500) return send(page(`<div class="card"><div class="msg">Slow down a wee bit.</div></div>`));
      lastPost.set(kid.id, Date.now());
      let b = ""; req.on("data", c => { if ((b += c).length > 10_000) req.destroy(); });
      await new Promise(r => req.on("end", r));
      const form = new URLSearchParams(b);
      if (url.pathname === "/quiz/submit") return send(await gradeRound(kid, form, kidQS));
      if (url.pathname === "/claim") {
        const taskId = Number(form.get("task"));
        const [task] = await q("SELECT id,name FROM tasks WHERE id=$1 AND active AND needs_approval", [taskId]);
        if (task) await q(`INSERT INTO earn_claims(child_id,task_id)
          SELECT $1,$2 WHERE NOT EXISTS (SELECT 1 FROM earn_claims WHERE child_id=$1 AND task_id=$2 AND status='pending')`, [kid.id, taskId]);
        res.writeHead(303, { location: "/" + kidQS }); return res.end();
      }
      return send(page(`<div class="card"><div class="msg">Unknown action.</div></div>`));
    }
    const m = url.pathname.match(/^\/quiz\/([a-z0-9-]+)$/);
    if (m && banks.has(m[1])) return send(quizPage(kid, banks.get(m[1]), kidQS));
    // A recent Tor/darknet/drugs flag replaces the ordinary page with the warm
    // one. Only on the fall-through GET, so an in-progress quiz and every POST
    // still behave exactly as before: earning is never taken away by a flag.
    // /hub is the way back to the ordinary hub while the flag is still warm.
    if (url.pathname !== "/hub") {
      const flag = await flaggedReason(kid.id);
      if (flag) return send(warmPage(kid, flag, kidQS));
    }
    // Everything else, including OS captive-portal probes, gets the home page.
    return send(homePage(kid, await status(kid.id), kidQS));
  } catch (e) { res.writeHead(500, { "content-type": "text/plain" }); res.end("portal error: " + e.message); }
});
server.listen(PORT, BIND, () => console.log(`kid portal on http://${BIND}:${PORT}`));
