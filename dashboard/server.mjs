// Hearth admin dashboard. Live state chips + controls that call kidnet, plus
// the per-kid analytics the charts read out of Postgres.
// Binds to the tailnet so it is private to the operator.
//
// Five views, all server rendered so the page works with no internet and with
// JavaScript disabled (the controls need JS, the charts and numbers do not):
//   /          Tonight  - state and controls, unchanged behaviour
//   /week      Week     - the weekly digest, with a plain-text version to send
//   /trends    Trends   - usage, services and the earn/spend balance per kid
//   /devices   Devices  - the roster and the naming queue
//   /kid/:name Kid      - one child: their devices, time, goals and controls
// The control API (/api/act, /api/assign, /api/claim) and its optional
// DASH_TOKEN are untouched.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import pg from "pg";
import { analytics, digest, kidDetail, GOAL_METRICS } from "./analytics.mjs";
import { shell, tonight, trends, devices as devicesView, week as weekView, kid as kidView } from "./views.mjs";

const BIND = process.env.BIND || "127.0.0.1";
const PORT = Number(process.env.PORT || 8899);
const KIDNET = process.env.KIDNET || "/srv/projects/internal/kids-network/bin/kidnet";
// Optional shared secret for the control API. Unset = tailnet is the only
// perimeter (unchanged). Set = every /api/* call must carry it, so a stray
// device on the tailnet cannot drive controls. The page injects it from a
// same-origin cookie the server sets, so the operator never types it.
const DASH_TOKEN = process.env.DASH_TOKEN || "";
// IN_CONTAINER is set by compose.yaml: containers reach Postgres by its
// docker-network name, host processes via the published localhost port.
const pool = new pg.Pool({ connectionString: process.env.IN_CONTAINER ? process.env.KIDS_DB_URL_DOCKER : process.env.KIDS_DB_URL });
const q = (t, p) => pool.query(t, p).then(r => r.rows);
const runKidnet = args => new Promise(res => execFile("bash", [KIDNET, ...args], { timeout: 8000 },
  (e, so, se) => res({ ok: !e, out: (so || "") + (se || "") })));

async function state() {
  // NOTE: this list must stay in the same order as the queries below. It did
  // not: `people` was third in the array but last in the destructuring, so
  // alerts held the people list, times held block_events and claims held the
  // time ledger. With almost no data in the tables nothing looked wrong; with
  // real rows every one of those panels showed the wrong thing.
  const [children, devices, people, alerts, alertsAck, cats, events, times, claims] = await Promise.all([
    q("SELECT id,name,age,policy_tier FROM children ORDER BY age"),
    q(`SELECT id,label,hostname,mac,ip,device_kind,category,vendor,person,person_kind,unassigned,
         (last_seen > now()-interval '5 minutes') AS online
       FROM device_roster ORDER BY unassigned DESC, online DESC, person NULLS LAST, label`),
    q("SELECT name,kind FROM children ORDER BY kind,name"),
    q("SELECT id,ts,severity,category,domain,detail FROM alerts WHERE NOT acknowledged ORDER BY ts DESC LIMIT 10"),
    // Acknowledged alerts are kept, not deleted: "we talked about it" is part
    // of the record, and a parent should be able to check what they already
    // dealt with without it shouting at them from the top of the page.
    q("SELECT id,ts,severity,category,domain,detail FROM alerts WHERE acknowledged ORDER BY ts DESC LIMIT 10"),
    q("SELECT c.name kid, cs.category FROM category_state cs JOIN children c ON c.id=cs.child_id WHERE cs.blocked"),
    q("SELECT ts,target_ref,action,source FROM block_events ORDER BY ts DESC LIMIT 12"),
    q("SELECT child_id,name,budget_min,bonus_min,used_min,remaining_min FROM time_remaining"),
    q(`SELECT ec.id, c.name kid, t.name task, t.minutes, ec.ts FROM earn_claims ec
       JOIN children c ON c.id=ec.child_id JOIN tasks t ON t.id=ec.task_id
       WHERE ec.status='pending' ORDER BY ec.ts`),
  ]);
  return { children, devices, alerts, alertsAck, cats, events, times, claims, people };
}

const authed = req => !DASH_TOKEN || (req.headers["x-dash-token"] === DASH_TOKEN);

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && ["/api/claim", "/api/act", "/api/assign", "/api/ack", "/api/goal"].includes(req.url) && !authed(req)) {
      res.writeHead(403, { "content-type": "application/json" }); res.end('{"out":"forbidden"}'); return; }
    if (req.method === "POST" && req.url === "/api/assign") {
      let b = ""; req.on("data", c => b += c); await new Promise(r => req.on("end", r));
      const { mac, who, label } = JSON.parse(b || "{}");
      if (!/^[0-9a-f:]{17}$/i.test(mac||"") || !/^[A-Za-z0-9_-]{1,32}$/.test(who||"")) { res.writeHead(400).end('{"out":"bad input"}'); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(await runKidnet(["assign", mac, who, String(label||"device").slice(0,40)]))); return;
    }
    if (req.method === "POST" && req.url === "/api/claim") {
      let b = ""; req.on("data", c => b += c); await new Promise(r => req.on("end", r));
      const { id, decision } = JSON.parse(b || "{}");
      if (!Number.isInteger(id) || !["approve", "decline"].includes(decision)) { res.writeHead(400).end('{"out":"bad claim"}'); return; }
      const [cl] = await q(`UPDATE earn_claims SET status=$2, decided_by='dashboard', decided_ts=now()
        WHERE id=$1 AND status='pending' RETURNING child_id, task_id`, [id, decision === "approve" ? "approved" : "declined"]);
      let out = "declined";
      if (cl && decision === "approve") {
        const [info] = await q("SELECT c.name kid, t.name task FROM children c, tasks t WHERE c.id=$1 AND t.id=$2", [cl.child_id, cl.task_id]);
        out = (await runKidnet(["earn", info.kid, info.task])).out;
      }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, out })); return;
    }
    if (req.method === "POST" && req.url === "/api/ack") {
      // Mark an alert as talked about. The only thing it changes is whether the
      // alert keeps asking for attention: nothing is deleted, and nothing about
      // the network changes.
      let b = ""; req.on("data", c => b += c); await new Promise(r => req.on("end", r));
      const { id } = JSON.parse(b || "{}");
      if (!Number.isInteger(id) || id <= 0) { res.writeHead(400).end('{"out":"bad alert"}'); return; }
      const rows = await q("UPDATE alerts SET acknowledged=true WHERE id=$1 AND NOT acknowledged RETURNING id", [id]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, out: rows.length ? "noted, moved to the quiet list" : "already noted" })); return;
    }
    if (req.method === "POST" && req.url === "/api/goal") {
      // Set, replace or remove one weekly goal. Goals never enforce anything:
      // the worst a bad value can do is put a silly number on a progress bar.
      let b = ""; req.on("data", c => b += c); await new Promise(r => req.on("end", r));
      const g = JSON.parse(b || "{}");
      if (g.remove) {
        if (!Number.isInteger(g.id) || g.id <= 0) { res.writeHead(400).end('{"out":"bad goal"}'); return; }
        await q("DELETE FROM goals WHERE id=$1", [g.id]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, out: "goal removed" })); return;
      }
      const cid = Number(g.child_id);
      const target = Number(g.target_min);
      if (!Number.isInteger(cid) || cid <= 0
        || !Object.prototype.hasOwnProperty.call(GOAL_METRICS, String(g.metric))
        || !["at_most", "at_least"].includes(String(g.direction))
        || !Number.isFinite(target) || target < 1 || target > 10080) {
        res.writeHead(400).end('{"out":"bad goal"}'); return; }
      await q(`INSERT INTO goals(child_id,metric,direction,target_min,set_by)
               VALUES($1,$2,$3,$4,'dashboard')
               ON CONFLICT (child_id,metric) DO UPDATE
                 SET direction=EXCLUDED.direction, target_min=EXCLUDED.target_min,
                     active=true, updated_ts=now()`,
        [cid, String(g.metric), String(g.direction), Math.round(target)]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, out: "goal saved" })); return;
    }
    if (req.method === "POST" && req.url === "/api/act") {
      let b = ""; req.on("data", c => b += c); await new Promise(r => req.on("end", r));
      const { cmd, who, arg } = JSON.parse(b || "{}");
      // cmd may be one or two words ("off", "game off"). kidnet's grammar is
      // <verb> [subverb] <kid> [arg], so the kid goes AFTER any subverb.
      const base = String(cmd).split(" ").filter(Boolean);
      // `arg` may be a single value or several (kidnet grant <kid> <cat> <min>).
      // Accept an array or a space-separated string, and cap the count.
      const extra = Array.isArray(arg) ? arg.map(String)
                  : (arg === undefined || arg === null || arg === "") ? []
                  : String(arg).split(/\s+/).filter(Boolean);
      const args = who ? [...base, who, ...extra.slice(0, 3)] : [...base, ...extra.slice(0, 3)];
      // Allowlisted kidnet verbs. Read-only queries (status/time/recent/
      // topsites/devices) are safe to expose; the mutating ones are the
      // parent's own controls. Anything not listed here is refused outright.
      if (!["off","on","game","media","study","dinner","resume","bonus","earn","penalty","grant",
            "status","time","recent","topsites","devices","unassigned","allow-status"].includes(args[0])) {
        res.writeHead(400).end('{"out":"bad command"}'); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(await runKidnet(args))); return;
    }
    // ---- pages -------------------------------------------------------------
    const url = new URL(req.url, "http://localhost");
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
    if (DASH_TOKEN) headers["set-cookie"] = `dash=${DASH_TOKEN}; Path=/; SameSite=Strict; HttpOnly=false`;
    const s = await state();
    let html;
    if (url.pathname === "/week") {
      // ?week=last or ?week=YYYY-MM-DD reaches any past week; anything else is
      // this week. The digest resolves the Monday itself, from the DB clock.
      const raw = url.searchParams.get("week") || "";
      const ref = raw === "last" ? "last" : (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);
      html = shell({ tab: "/week", title: "Hearth week", body: weekView(s, await digest(q, ref)) });
    } else if (url.pathname.startsWith("/kid/")) {
      const name = decodeURIComponent(url.pathname.slice(5));
      if (!/^[A-Za-z0-9_ -]{1,32}$/.test(name)) {
        res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
      const days = url.searchParams.get("days") === "30" ? 30 : 7;
      const kd = await kidDetail(q, name, days);
      if (!kd) { res.writeHead(404, { "content-type": "text/plain" }); res.end("no such child"); return; }
      html = shell({ tab: "/", title: `Hearth: ${kd.child.name}`, body: kidView(s, kd) });
    } else if (url.pathname === "/trends") {
      const days = url.searchParams.get("days") === "30" ? 30 : 7;
      html = shell({ tab: "/trends", title: "Hearth trends", body: trends(s, await analytics(q, days)) });
    } else if (url.pathname === "/devices") {
      html = shell({ tab: "/devices", title: "Hearth devices", body: devicesView(s) });
    } else if (url.pathname === "/" || url.pathname === "/index.html") {
      // Tonight leans on a short window for the "last 7 days" lines under each
      // kid; if the analytics query fails the controls must still render.
      let a = null;
      try { a = await analytics(q, 7); } catch (e) { a = null; }
      html = shell({ tab: "/", title: "Hearth", body: tonight(s, a) });
    } else {
      res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return;
    }
    res.writeHead(200, headers);
    res.end(html);
  } catch (e) { res.writeHead(500, { "content-type": "text/plain" }); res.end("error: " + e.message); }
});
server.listen(PORT, BIND, () => console.log(`kids dashboard on http://${BIND}:${PORT}`));
