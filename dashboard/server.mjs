// Genkan admin dashboard. Live state chips + controls that call kidnet, plus
// the per-kid analytics the charts read out of Postgres.
// Binds to the tailnet so it is private to the operator.
//
// Nine views, all server rendered so the page works with no internet and with
// JavaScript disabled (the controls need JS, the charts and numbers do not):
//   /          Home     - state and controls, unchanged behaviour
//   /live      Right now - the live wire: SSE ticks, real-time traffic charts,
//                          filterable by person and by class of device
//   /family    Family   - add, edit and remove people; rename and reassign devices
//   /week      Week     - the weekly digest, with a plain-text version to send
//   /trends    Trends   - usage, services and the earn/spend balance per kid
//   /earn      Learn to earn - the jobs on offer per child, the quiz banks
//                          (including writing and editing your own), the rules
//                          of earning, and the earning history
//   /devices   Devices  - the roster and the naming queue
//   /notify    Notifications - the phone routes a household set up, what each
//                          one sends, and the exact words that reach a phone
//   /system    System   - the health of the box Genkan itself runs on: CPU,
//                          memory, disk, load, uptime, its containers and the
//                          throughput of its own network cards
//   /kid/:name Kid      - one child: their devices, time, goals and controls
// Plus /speed, which is not a view of ours: it proxies the speed test running
// in the gateway container, because that container is the only thing that can
// see the family wifi and a parent on the admin side cannot reach its address.
// The control API (/api/act, /api/assign, /api/claim) and its optional
// DASH_TOKEN are untouched.
import { createServer, request as httpRequest } from "node:http";
import { execFile } from "node:child_process";
import pg from "pg";
import { analytics, digest, kidDetail, GOAL_METRICS } from "./analytics.mjs";
import { shell as pageShell, tonight, trends, devices as devicesView, week as weekView, kid as kidView } from "./views.mjs";
import { systemPage } from "./views.mjs";
import { livePage, family as familyView } from "./views.mjs";
import { LiveWire } from "./live.mjs";
import { SysMonitor } from "./sysmon.mjs";
import { householdApi } from "./household.mjs";
import { notifyData, notifyPage, notifyApi } from "./notify.mjs";
import { earnData, earnPage, taskApi, quizApi, bankApi, earnSettingsApi, boardApi, decideClaim } from "./earn.mjs";
import { scheduleData, scheduleApi } from "./schedule.mjs";
import { analyticsPage, analyticsApi } from "./analytics-page.mjs";
import { settingsPage, settingsApi } from "./settings.mjs";
import { kidInsights, kidApi } from "./kid-insights.mjs";
import { dirname, join } from "node:path";
import { versionFooter } from "./version.mjs";

// Every page carries the same quiet line at the bottom: what version this
// household is running and whether it is working. Wrapping shell() rather than
// editing views.mjs keeps it to one file, and means a page that forgets to ask
// for it cannot exist. See dashboard/version.mjs for why it never blocks a
// render.
const shell = o => pageShell({ ...o, body: (o.body || "") + versionFooter() });

const BIND = process.env.BIND || "127.0.0.1";
const PORT = Number(process.env.PORT || 8899);
const KIDNET = process.env.KIDNET || "/srv/projects/internal/kids-network/bin/genkan";
// Optional shared secret for the control API. Unset = tailnet is the only
// perimeter (unchanged). Set = every /api/* call must carry it, so a stray
// device on the tailnet cannot drive controls. The page injects it from a
// same-origin cookie the server sets, so the operator never types it.
const DASH_TOKEN = process.env.DASH_TOKEN || "";
// IN_CONTAINER is set by compose.yaml: containers reach Postgres by its
// docker-network name, host processes via the published localhost port.
const pool = new pg.Pool({ connectionString: process.env.IN_CONTAINER ? process.env.KIDS_DB_URL_DOCKER : process.env.KIDS_DB_URL });
const q = (t, p) => pool.query(t, p).then(r => r.rows);
// The public demo (demo/compose.yaml) runs THIS file, unchanged, against a
// throwaway database full of a made-up family. GENKAN_DEMO=1 is the one switch
// that makes that safe: every path that would shell out goes through runKidnet
// or runTool below, and with the flag set neither of them reaches execFile at
// all. There is no firewall, no kidnet and no AdGuard behind a demo, so a
// control answers honestly instead of failing in a way nobody can read.
// Unset (the household default) this is a strict no-op: the two consts below
// are exactly what they always were.
const DEMO = process.env.GENKAN_DEMO === "1";
const DEMO_REPLY = () => ({ ok: true, out: "This is the demo, so nothing was actually changed." });
const runKidnet = DEMO ? async () => DEMO_REPLY() : args => new Promise(res => execFile("bash", [KIDNET, ...args], { timeout: 8000 },
  (e, so, se) => res({ ok: !e, out: (so || "") + (se || "") })));
// The AdGuard side of a change. These two tools already own the whole mapping
// between children, their assigned addresses and the DNS filter, so a rename,
// a new child, a removal or a reassignment calls them rather than
// reimplementing any of it. They are slower than a query (they talk to AdGuard
// over HTTP), hence the longer timeout.
const BINDIR = dirname(KIDNET);
const runTool = DEMO ? async () => DEMO_REPLY() : (name, args = []) => new Promise(res =>
  execFile("bash", [join(BINDIR, name), ...args], { timeout: 25000 },
    (e, so, se) => res({ ok: !e, out: ((so || "") + (se || "")).trim() })));
async function syncAdguard() {
  const a = await runTool("genkan-adguard-clients");
  const b = await runTool("genkan-adguard", ["apply"]);
  const lines = [a.out, b.out].filter(Boolean).join(" ");
  return { ok: a.ok && b.ok, out: lines };
}

// One sampler for the whole process; it only runs while a page is watching.
const wire = new LiveWire(q, m => console.log(m));
// The box's own health. Unlike the live wire this one runs from start-up on a
// slow clock, because its whole job is to have a few hours of history ready
// the moment somebody opens the System page. See dashboard/sysmon.mjs for why
// it is a second stream rather than more fields on the live one.
const sysmon = new SysMonitor().start();

const readJson = async req => {
  let b = "";
  req.on("data", c => { b += c; if (b.length > 64000) req.destroy(); });
  await new Promise(r => { req.on("end", r); req.on("close", r); });
  try { return JSON.parse(b || "{}"); } catch { return {}; }
};
// Exactly kidnet's own gate. A person's name reaches bin/kidnet on the command
// line, so anything it would refuse must be refused here, with a message a
// parent can act on rather than a shell error.
const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const LABEL_RE = /^[A-Za-z0-9_:+.,'’ -]{1,40}$/;
// The vocabulary the database enforces (children_kind_ck) and the filter
// levels the policies table actually holds. Read once at start so adding a
// level is a database row, not an edit here.
const KINDS = ["child", "guest-child", "guest-adult", "adult"];
let TIERS = ["young", "standard", "teen", "guest", "adult"];
q("SELECT tier FROM policies").then(r => { if (r.length) TIERS = r.map(x => x.tier); }).catch(() => {});
// The device classes /api/device will accept. 'shared' is a family device: the
// household's, not one child's, so it can never eat a child's minutes.
const CLASSES = ["personal", "shared", "iot", "appliance", "infra"];
const BUDGET_CATS = ["gaming", "video", "social"];
// "" / null / undefined mean "no limit"; anything else must be a sane count of
// minutes. Returns undefined for "leave this alone".
function minutes(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? Math.round(n) : undefined;
}

async function state() {
  // NOTE: this list must stay in the same order as the queries below. It did
  // not: `people` was third in the array but last in the destructuring, so
  // alerts held the people list, times held block_events and claims held the
  // time ledger. With almost no data in the tables nothing looked wrong; with
  // real rows every one of those panels showed the wrong thing.
  const [children, devices, people, household, alerts, alertsAck, cats, events, times, claims, house] = await Promise.all([
    // Every person, with the role flags, so a page can say "the kids" (which
    // now includes a visiting child) without a second query.
    q(`SELECT id,name,age,policy_tier,kind,active,is_kid,is_guest,is_adult,is_household_child
       FROM people ORDER BY kind,age,name`),
    // in_dinner / in_house_off are the RESOLVED answers, worked out in
    // device_sweeps: a camera reads false there whatever its columns say, so
    // the page cannot draw a ticked box next to something that is in no sweep.
    q(`SELECT id,label,hostname,mac,ip,device_kind,category,vendor,person,person_kind,unassigned,
         device_tier,in_dinner,in_house_off,dinner_default,house_off_default,
         (last_seen > now()-interval '5 minutes') AS online
       FROM device_roster ORDER BY unassigned DESC, online DESC, person NULLS LAST, label`),
    q("SELECT name,kind FROM people WHERE active ORDER BY kind,name"),
    // Everyone, every role, past guests included: the Family page and the
    // "who is in the house" panel.
    q(`SELECT id,name,age,policy_tier,role AS kind,role_label,is_kid,is_guest,is_adult,
         is_household_child,active,devices,devices_online
       FROM household_roster ORDER BY active DESC,
         CASE role WHEN 'child' THEN 1 WHEN 'guest-child' THEN 2 WHEN 'guest-adult' THEN 3 ELSE 4 END, name`),
    q("SELECT id,ts,severity,category,domain,detail FROM alerts WHERE NOT acknowledged ORDER BY ts DESC LIMIT 10"),
    // Acknowledged alerts are kept, not deleted: "we talked about it" is part
    // of the record, and a parent should be able to check what they already
    // dealt with without it shouting at them from the top of the page.
    q("SELECT id,ts,severity,category,domain,detail FROM alerts WHERE acknowledged ORDER BY ts DESC LIMIT 10"),
    q("SELECT c.name kid, cs.category, cs.set_by FROM category_state cs JOIN children c ON c.id=cs.child_id WHERE cs.blocked"),
    q("SELECT ts,target_ref,action,source FROM block_events ORDER BY ts DESC LIMIT 12"),
    q("SELECT child_id,name,budget_min,bonus_min,used_min,remaining_min FROM time_remaining"),
    q(`SELECT ec.id, c.name kid, t.name task, t.minutes, ec.ts FROM earn_claims ec
       JOIN children c ON c.id=ec.child_id JOIN tasks t ON t.id=ec.task_id
       WHERE ec.status='pending' ORDER BY ec.ts`),
    // The whole-house cut: whether it is running, how long it has left, and how
    // many devices it would take with it. One row.
    q("SELECT is_off,off_until,minutes_left,devices_caught FROM house_status"),
  ]);
  // When tonight's bedtime starts and when it lifts, per child, for the one
  // line Home and the kid page show. Caught rather than joined to the list
  // above on purpose: a box whose database has not been given
  // schema-schedule.sql yet still has a working dashboard, it simply does not
  // mention bedtimes.
  const bedtimes = {};
  for (const b of await q(`SELECT child_id, starts_at, ends_at, in_window, override, extended
                             FROM schedule_next`).catch(() => []))
    bedtimes[b.child_id] = b;
  // The slow lane, caught for the same reason as the bedtimes above: a box that
  // has not been given schema-slow.sql yet still has a working dashboard, its
  // chips simply never show the third state.
  const slow = await q(`SELECT c.name kid, s.category, s.set_by
                          FROM slow_lane_children s JOIN children c ON c.id=s.child_id`)
                 .catch(() => []);
  return { children, devices, alerts, alertsAck, cats, slow, events, times, claims, people, household, bedtimes,
           house: house[0] || { is_off: false, minutes_left: 0, devices_caught: 0 } }
}

const authed = req => !DASH_TOKEN || (req.headers["x-dash-token"] === DASH_TOKEN);

// A slim bar linking back into the dashboard, injected into the speed test's
// own page. Deliberately inline: the speed test is served from another
// container and must not depend on this one for its stylesheet.
const SPEED_NAV = `<div style="display:flex;gap:18px;align-items:center;padding:11px 20px;
  background:#14161f;border-bottom:1px solid rgba(236,228,214,.11);flex-wrap:wrap;
  font:600 14px/1 ui-sans-serif,system-ui,sans-serif">
  <a href="/" style="color:#f2a15a;text-decoration:none">&lsaquo; Genkan</a>
  <a href="/" style="color:#c3bcaf;text-decoration:none">Home</a>
  <a href="/live" style="color:#c3bcaf;text-decoration:none">Right now</a>
  <a href="/devices" style="color:#c3bcaf;text-decoration:none">Devices</a>
  <span style="color:#ece4d6">Speed</span>
  <span style="margin-left:auto;color:#8f8879;font-weight:600;font-size:12.5px">
    Measuring this device to the Genkan box over the network you are on now.
    For the family wifi, open it from a device on that network.
  </span>
</div>`;

// The speed test lives in the gateway container, on the docker bridge. In the
// demo there is no gateway at all, so the page says so rather than hanging.
// The dashboard runs on the host, outside docker, so it cannot resolve
// "genkan-gw" by name. Ask docker for the gateway's bridge address instead and
// cache it, because that address changes whenever the container is recreated.
// Re-resolved on any connection failure, which is exactly when it has moved.
const SPEED_PORT = Number(process.env.SPEEDTEST_PORT || 8877);
let speedHost = process.env.SPEEDTEST_HOST || "";
const resolveSpeedHost = () => new Promise(res => {
  if (speedHost) return res(speedHost);
  execFile("docker", ["inspect", "genkan-gw", "-f",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}"], { timeout: 5000 },
    (e, so) => { speedHost = e ? "" : String(so).trim().split(/\s+/)[0] || ""; res(speedHost); });
});
async function proxySpeed(req, res) {
  if (DEMO) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><meta charset="utf-8"><title>Speed test</title>'
      + '<body style="font:16px/1.6 system-ui;padding:40px;max-width:36em">'
      + '<h1>Speed test</h1><p>This is the demo, so there is no real network to '
      + 'measure. On a real Genkan box this page runs a test against the gateway '
      + 'itself, and a second one against the internet, so you can tell a slow '
      + 'connection apart from slow wifi.</p>');
    return;
  }
  // Streamed both ways on purpose: this endpoint moves tens of megabytes and
  // buffering it would defeat the measurement and the memory budget alike.
  const path = req.url.replace(/^\/speed/, "") || "/";
  const host = await resolveSpeedHost();
  if (!host) { res.writeHead(502, { "content-type": "text/plain" });
    res.end("The gateway is not running, so there is nothing to measure."); return; }
  const up = httpRequest({ host, port: SPEED_PORT, path, method: req.method,
                           headers: { ...req.headers, host: `${host}:${SPEED_PORT}` } },
    r => {
      // The page itself gets the dashboard's nav bolted on, so Speed reads as
      // a page of the dashboard rather than a link that threw you somewhere
      // else. The measurement endpoints are streamed through untouched: they
      // move tens of megabytes and must not be buffered to be rewritten.
      const html = (r.headers["content-type"] || "").includes("text/html");
      if (!html) { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); return; }
      let body = "";
      r.setEncoding("utf8");
      r.on("data", c => body += c);
      r.on("end", () => {
        body = body.replace(/<body([^>]*)>/i, `<body$1>${SPEED_NAV}`);
        // The speed test's own script asks for /ping, /download and friends as
        // absolute paths, which is correct when it is served at its own root
        // and wrong the moment it is proxied under /speed: those requests went
        // to the dashboard instead. Ping still appeared to work, because it
        // times a round trip and a 404 is a round trip, so the gauge showed a
        // plausible latency next to a download of exactly zero. Point them at
        // the prefix. Named explicitly rather than by pattern, so this cannot
        // quietly rewrite something else the page fetches later.
        for (const ep of ["ping", "download", "upload", "internet", "info"]) {
          body = body.split(`fetch("/${ep}`).join(`fetch("/speed/${ep}`);
        }
        const h = { ...r.headers, "content-type": "text/html; charset=utf-8" };
        delete h["content-length"];
        res.writeHead(r.statusCode || 200, h);
        res.end(body);
      });
    });
  up.on("error", e => {
    speedHost = process.env.SPEEDTEST_HOST || "";   // it moved: look it up again next time
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><meta charset="utf-8"><title>Speed test</title>'
      + '<body style="font:16px/1.6 system-ui;padding:40px;max-width:36em">'
      + '<h1>The speed test is not answering</h1><p>It runs inside the gateway '
      + 'container. Check that <code>genkan-speedtest</code> is up.</p><p><small>'
      + String(e.message || e).replace(/[<>&]/g, "") + '</small></p>');
  });
  req.pipe(up);
}

const server = createServer(async (req, res) => {
  try {
    // ---- the speed test -----------------------------------------------
    // It runs inside the gateway's network namespace, because that is the only
    // place that can see the family network. That also means it is only
    // reachable from the island, so the old nav link to 192.168.60.1:8877 was
    // dead for a parent on the tailnet, which is where a parent actually is.
    // The dashboard already sits on both sides, so it proxies. One address for
    // the whole dashboard, and the test still measures the gateway's own wire.
    if (req.url === "/speed" || req.url.startsWith("/speed/")) {
      await proxySpeed(req, res); return;
    }

    if (req.method === "POST" && ["/api/claim", "/api/act", "/api/assign", "/api/ack", "/api/goal",
      "/api/child", "/api/tier", "/api/device", "/api/household", "/api/task", "/api/quiz",
      "/api/bank", "/api/earnsettings", "/api/board", "/api/schedule", "/api/settings", "/api/kid"].includes(req.url) && !authed(req)) {
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
      // The decision, the minutes and the unblock all live in earn.mjs now,
      // because the reward can differ per child and the old path looked the
      // minutes back up by a fuzzy match on the task's name.
      const out = await decideClaim(q, runKidnet, id, decision);
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, out })); return;
    }
    // Learn to earn: the jobs on offer, and which quizzes count for whom.
    // Same guard as every other control, and nothing here touches the network.
    if (req.method === "POST" && (req.url === "/api/task" || req.url === "/api/quiz")) {
      const body = await readJson(req);
      if (req.url === "/api/task") await taskApi(q, body, res); else await quizApi(q, body, res);
      return;
    }
    // Writing a quiz bank, and the numbers that say what earning is worth.
    // Both are database only: the banks a parent writes never touch
    // portal/quizzes, which is tracked in git, and neither call goes near the
    // firewall. Same token guard as every other control.
    if (req.method === "POST" && (req.url === "/api/bank" || req.url === "/api/earnsettings" || req.url === "/api/board")) {
      const body = await readJson(req);
      try {
        if (req.url === "/api/bank") await bankApi(q, body, res);
        else if (req.url === "/api/board") await boardApi(q, body, res);
        else await earnSettingsApi(q, body, res);
      } catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, out: `That did not save: ${e.message}` }));
      }
      return;
    }
    // Scheduled bedtimes. Rows only: this writes what the times are, and
    // bin/genkan-schedule is the only thing that ever touches a block, so the
    // set_by precedence rules live in exactly one place. The nudge at the end
    // of each op runs that same worker, so a change a parent just made is in
    // force now rather than up to a minute from now.
    // The child page's rewards and its optional AI summary. Rewards go through
    // runKidnet (bonus, grant) so the CLI's gates and audit rows apply; the
    // summary is the one outbound request on the dashboard, off by default.
    // See dashboard/kid-insights.mjs.
    if (req.method === "POST" && req.url === "/api/kid") {
      const body = await readJson(req);
      try { await kidApi(q, body, res, runKidnet); }
      catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, out: e.message })); }
      return;
    }
    if (req.method === "POST" && req.url === "/api/settings") {
      const body = await readJson(req);
      try { await settingsApi(q, body, res, runKidnet); }
      catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, msg: e.message })); }
      return;
    }
    if (req.method === "GET" && req.url.startsWith("/api/analytics")) {
      try { await analyticsApi(q, new URL(req.url, "http://x"), res); }
      catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: false, msg: e.message })); }
      return;
    }
    if (req.method === "POST" && req.url === "/api/schedule") {
      const body = await readJson(req);
      try { await scheduleApi(q, body, res, runKidnet); }
      catch (e) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, out: `That did not save: ${e.message}` }));
      }
      return;
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
      // Defence in depth. kidnet gates every argument itself, but `topsites`
      // and `recent` interpolated their LIMIT ungated and both are on the
      // allowlist below, so a request could append arbitrary SQL to a query
      // that psql runs as a superuser. That is fixed in kidnet, and this stops
      // the same shape reaching a shell at all if a future verb forgets. These
      // are control arguments: names, numbers and short labels. Nothing here
      // legitimately contains a quote, a semicolon or a backslash.
      if (args.some(a => !/^[A-Za-z0-9_:.,+ -]{0,64}$/.test(a))) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end('{"ok":false,"out":"That is not something a control can be asked."}'); return; }
      // Allowlisted kidnet verbs. Read-only queries (status/time/recent/
      // topsites/devices) are safe to expose; the mutating ones are the
      // parent's own controls. Anything not listed here is refused outright.
      if (!["off","on","game","media","study","dinner","resume","bonus","earn","penalty","grant",
            "slow","full","slow-rate","slow-timeout","slow-status",
            "status","time","recent","topsites","devices","unassigned","allow-status"].includes(args[0])) {
        res.writeHead(400).end('{"out":"bad command"}'); return; }
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(await runKidnet(args))); return;
    }
    // ---- household roles: guests arriving and leaving, and filing a device
    // as smart home or infrastructure. See dashboard/household.mjs.
    // ---- notifications ----------------------------------------------------
    // Adding a phone is a parent's decision and belongs on the page. Everything
    // except "send a test" is a database write; the test shells out to
    // bin/genkan-notify so the page and the timer prove the SAME code path.
    if (req.method === "POST" && req.url === "/api/notify") {
      const r = await notifyApi(q, await readJson(req), { runTool });
      res.writeHead(r.ok ? 200 : 400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: r.ok, out: r.out })); return;
    }
    if (req.method === "POST" && req.url === "/api/household") {
      const r = await householdApi(await readJson(req), { q, runKidnet, syncAdguard });
      res.writeHead(r.code, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: r.ok, out: r.out })); return;
    }

    // ---- manage: people ----------------------------------------------------
    // Add, edit or remove a child or guest. Every path that changes a name, a
    // tier or who owns what finishes by pushing the result to AdGuard through
    // the existing tools, so the DNS filter can never drift from the database.
    if (req.method === "POST" && req.url === "/api/child") {
      const b = await readJson(req);
      const send = (code, out, ok = false) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok, out }));
      };
      if (b.op === "add") {
        const name = String(b.name || "").trim();
        const kind = String(b.kind || "child");
        const tier = String(b.tier || "standard");
        if (!NAME_RE.test(name)) return send(400, "A name can be letters, numbers, - and _ , up to 32 characters.");
        if (!KINDS.includes(kind) || !TIERS.includes(tier)) return send(400, "That is not one of the choices.");
        const [dup] = await q("SELECT id FROM children WHERE lower(name)=lower($1)", [name]);
        if (dup) return send(400, `There is already somebody called ${name}.`);
        // kidnet owns "add a person": same validation, same defaults, one place.
        const add = await runKidnet(["person", "add", name, kind, tier]);
        if (!add.ok) return send(500, add.out.trim() || "could not add them");
        const age = minutes(b.age);
        if (age !== undefined && age !== null) await q("UPDATE children SET age=$2 WHERE lower(name)=lower($1)", [name, age]);
        const ag = await syncAdguard();
        return send(200, `${name} added. ${ag.out || ""}`.trim(), true);
      }
      if (b.op === "save") {
        const id = Number(b.id);
        if (!Number.isInteger(id) || id <= 0) return send(400, "which person?");
        const [cur] = await q("SELECT id,name FROM children WHERE id=$1", [id]);
        if (!cur) return send(404, "no such person");
        const name = String(b.name || "").trim();
        const kind = String(b.kind || "child");
        const tier = String(b.tier || "standard");
        if (!NAME_RE.test(name)) return send(400, "A name can be letters, numbers, - and _ , up to 32 characters.");
        if (!KINDS.includes(kind) || !TIERS.includes(tier)) return send(400, "That is not one of the choices.");
        const age = minutes(b.age);
        if (age === undefined) return send(400, "That age does not look right.");
        const [clash] = await q("SELECT id FROM children WHERE lower(name)=lower($1) AND id<>$2", [name, id]);
        if (clash) return send(400, `There is already somebody called ${name}.`);
        await q("UPDATE children SET name=$2, age=$3, kind=$4, policy_tier=$5 WHERE id=$1",
          [id, name, age, kind, tier]);
        // Budgets: a number is a cap, an empty box means no cap, so the row goes.
        const budgets = b.budgets && typeof b.budgets === "object" ? b.budgets : {};
        for (const cat of BUDGET_CATS) {
          if (!Object.prototype.hasOwnProperty.call(budgets, cat)) continue;
          const m = minutes(budgets[cat]);
          if (m === undefined) return send(400, `That ${cat} limit does not look right.`);
          if (m === null || m === 0) await q("DELETE FROM category_budgets WHERE child_id=$1 AND category=$2", [id, cat]);
          else await q(`INSERT INTO category_budgets(child_id,category,daily_min) VALUES($1,$2,$3)
                        ON CONFLICT (child_id,category) DO UPDATE SET daily_min=EXCLUDED.daily_min`, [id, cat, m]);
        }
        const ag = await syncAdguard();
        const renamed = cur.name !== name ? ` Renamed from ${cur.name}: check AdGuard has a client called ${name}.` : "";
        return send(200, `Saved.${renamed} ${ag.out || ""}`.trim(), true);
      }
      if (b.op === "remove") {
        const id = Number(b.id);
        if (!Number.isInteger(id) || id <= 0) return send(400, "which person?");
        const [cur] = await q("SELECT id,name FROM children WHERE id=$1", [id]);
        if (!cur) return send(404, "no such person");
        // devices.child_id is ON DELETE SET NULL, so their devices survive as
        // unassigned rather than disappearing off the network. Everything else
        // that hangs off a child (time, budgets, usage, blocks) cascades.
        const [{ count } = { count: "0" }] = await q(
          "SELECT count(*)::text AS count FROM devices WHERE child_id=$1", [id]);
        await q("DELETE FROM children WHERE id=$1", [id]);
        const ag = await syncAdguard();
        return send(200, `${cur.name} removed. ${count} device(s) are now unassigned and need an owner. ${ag.out || ""}`.trim(), true);
      }
      return send(400, "bad request");
    }

    // ---- manage: what a filter level allows --------------------------------
    if (req.method === "POST" && req.url === "/api/tier") {
      const b = await readJson(req);
      const tier = String(b.tier || "");
      const school = minutes(b.school), weekend = minutes(b.weekend);
      if (!TIERS.includes(tier)) { res.writeHead(400, { "content-type": "application/json" }); res.end('{"out":"no such level"}'); return; }
      if (school === undefined || weekend === undefined) {
        res.writeHead(400, { "content-type": "application/json" }); res.end('{"out":"Those minutes do not look right."}'); return; }
      await q(`INSERT INTO policies(tier,daily_budget_school_min,daily_budget_weekend_min)
               VALUES($1,$2,$3) ON CONFLICT (tier) DO UPDATE
               SET daily_budget_school_min=EXCLUDED.daily_budget_school_min,
                   daily_budget_weekend_min=EXCLUDED.daily_budget_weekend_min`, [tier, school, weekend]);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, out: `Saved. It applies from each person's next day, not retroactively.` })); return;
    }

    // ---- manage: one device ------------------------------------------------
    if (req.method === "POST" && req.url === "/api/device") {
      const b = await readJson(req);
      const send = (code, out, ok = false) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok, out }));
      };
      const id = Number(b.id);
      if (!Number.isInteger(id) || id <= 0) return send(400, "which device?");
      const [d] = await q("SELECT id, mac::text AS mac, label, category, child_id FROM devices WHERE id=$1", [id]);
      if (!d) return send(404, "no such device");
      const label = String(b.label || "").trim();
      const cls = String(b.cls || "personal");
      const person = String(b.person || "").trim();
      if (label && !LABEL_RE.test(label)) return send(400, "A device name can be letters, numbers and simple punctuation, up to 40 characters.");
      if (!CLASSES.includes(cls)) return send(400, "That is not one of the choices.");
      if (person && !NAME_RE.test(person)) return send(400, "That owner name is not one Genkan knows.");
      // Only a person's own device can belong to a person. Smart home kit and
      // infrastructure are the household's, never a child's, so moving a device
      // into either class also takes it off whoever had it.
      if (cls !== "personal" && person) return send(400, "Only a person's own device can belong to a person. A shared family device, smart home kit and infrastructure are the household's.");
      let out = [];
      if (cls !== (d.category || "personal")) {
        // Changing class also resets the two sweep ticks to that class's
        // default, and gives a shared device a filter level of its own. A tick
        // carried over from when the device was somebody's phone is not an
        // answer about the family television.
        await q(`UPDATE devices SET category=$2, child_id=CASE WHEN $2='personal' THEN child_id ELSE NULL END,
                 policy_tier=CASE WHEN $2='shared' THEN COALESCE(policy_tier,'standard') ELSE NULL END,
                 caught_by_dinner=NULL, caught_by_house_off=NULL WHERE id=$1`, [id, cls]);
        out.push(cls === "iot" ? "Moved to smart home."
          : cls === "infra" ? "Moved to infrastructure."
            : cls === "appliance" ? "Moved to unrestricted devices."
              : cls === "shared" ? "Now a shared family device on the Standard filter level. Nobody's minutes pay for it."
                : "Moved back to people's devices.");
      }
      if (person) {
        const [p] = await q("SELECT id FROM children WHERE lower(name)=lower($1)", [person]);
        if (!p) return send(400, `Genkan does not know anybody called ${person}.`);
        // kidnet assign already updates the row, writes the audit trail and
        // pushes the new address to AdGuard, so it does all three at once.
        const r = await runKidnet(["assign", d.mac || String(id), person, label || d.label || "device"]);
        out.push(r.out.trim() || "assigned");
      } else {
        await q("UPDATE devices SET child_id=NULL, label=COALESCE(NULLIF($2,''), label) WHERE id=$1", [id, label]);
        if (d.child_id) out.push("Nobody owns it now, so it has no filter level and no time limit.");
        else if (label && label !== d.label) out.push("Renamed.");
        const ag = await syncAdguard();
        if (ag.out) out.push(ag.out);
      }
      return send(200, out.join(" ") || "Nothing to change.", true);
    }

    // ---- the live wire -----------------------------------------------------
    // Server-sent events, not a websocket: it is one-way, it survives a proxy
    // that only speaks HTTP, and the browser reconnects on its own. Handled
    // before the page code below so a stream never pays for a state() query.
    if (req.method === "GET" && req.url === "/api/stream") { wire.attach(req, res); return; }
    // ---- the box's own health ---------------------------------------------
    // Its own stream on purpose: a slower clock, a longer memory, and it must
    // keep sampling whether or not anybody is watching traffic.
    if (req.method === "GET" && req.url === "/api/system/stream") { sysmon.attach(req, res); return; }
    if (req.method === "GET" && req.url === "/api/system.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(await sysmon.pageData())); return;
    }
    // The same numbers as one JSON object, for anything that cannot hold a
    // stream open: a watch face, a script, or a quick look with curl.
    if (req.method === "GET" && req.url === "/api/live.json") {
      await wire.refreshMeta(true);
      // Two reads a real interval apart, because a rate is a difference: back
      // to back they would divide a tick's bytes by a few milliseconds and
      // report a number that never happened.
      if (!wire.last) {
        await wire.ensureTotals(true);
        await wire.tick();
        await new Promise(r => setTimeout(r, 1000));
        await wire.tick();
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      res.end(JSON.stringify(wire.snapshot())); return;
    }

    // ---- pages -------------------------------------------------------------
    const url = new URL(req.url, "http://localhost");
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
    // The page's own script reads this cookie to sign its control calls, so it
    // must NOT be HttpOnly. Writing "HttpOnly=false" does not disable the flag:
    // browsers key off the attribute name alone, so that spelling switched it ON
    // and every control silently 403'd. Omit the attribute entirely.
    if (DASH_TOKEN) headers["set-cookie"] = `dash=${DASH_TOKEN}; Path=/; SameSite=Strict`;
    // Deliberately answered before state() runs. The System page reads nothing
    // out of Postgres, and a health page that goes down with the database is a
    // health page that is missing exactly when it is wanted.
    if (url.pathname === "/system") {
      res.writeHead(200, headers);
      res.end(shell({ tab: "/system", title: "Genkan system", body: systemPage(await sysmon.pageData()) }));
      return;
    }
    const s = await state();
    let html;
    if (url.pathname === "/week") {
      // ?week=last or ?week=YYYY-MM-DD reaches any past week; anything else is
      // this week. The digest resolves the Monday itself, from the DB clock.
      const raw = url.searchParams.get("week") || "";
      const ref = raw === "last" ? "last" : (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null);
      html = shell({ tab: "/week", title: "Genkan week", body: weekView(s, await digest(q, ref)) });
    } else if (url.pathname.startsWith("/kid/")) {
      const name = decodeURIComponent(url.pathname.slice(5));
      if (!/^[A-Za-z0-9_ -]{1,32}$/.test(name)) {
        res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
      const days = url.searchParams.get("days") === "30" ? 30 : 7;
      const kd = await kidDetail(q, name, days);
      if (!kd) { res.writeHead(404, { "content-type": "text/plain" }); res.end("no such child"); return; }
      // The in-house insights (today, the fortnight, what changed, rewards).
      // Every query inside is guarded, so a null here means something worse
      // than a missing table, and the page still renders its controls.
      // A visiting child gets no insights at all: a visit is not logged per
      // person (PRIVACY-CHARTER.md P12), and the page says so.
      const ins = kd.child.kind === "child"
        ? await kidInsights(q, kd.child).catch(e => { console.log(`kid insights: ${e.message}`); return null; })
        : null;
      html = shell({ tab: "/", title: `Genkan: ${kd.child.name}`, body: kidView(s, kd, ins) });
    } else if (url.pathname === "/notify") {
      html = shell({ tab: "/notify", title: "Genkan notifications", body: notifyPage(await notifyData(q)) });
    } else if (url.pathname === "/trends") {
      const days = url.searchParams.get("days") === "30" ? 30 : 7;
      html = shell({ tab: "/trends", title: "Genkan trends", body: trends(s, await analytics(q, days)) });
    } else if (url.pathname === "/analytics") {
      html = shell({ tab: "/analytics", title: "Genkan: analytics and logs", body: await analyticsPage(q, s, url) });
    } else if (url.pathname === "/settings") {
      html = shell({ tab: "/settings", title: "Genkan settings", body: await settingsPage(q, s) });
    } else if (url.pathname === "/live") {
      html = shell({ tab: "/live", title: "Genkan: right now", body: livePage(s) });
    } else if (url.pathname === "/family") {
      // Everything the manage area needs that the shared state() does not
      // already carry: the per-child category caps, how many devices each
      // person actually has, and the per-tier daily allowances.
      const [budgets, counts, policies, schedule] = await Promise.all([
        q("SELECT child_id, category, daily_min FROM category_budgets"),
        q("SELECT child_id, count(*)::int AS n FROM devices WHERE child_id IS NOT NULL GROUP BY child_id"),
        q("SELECT tier, description, daily_budget_school_min, daily_budget_weekend_min FROM policies"),
        scheduleData(q),
      ]);
      const mg = { policies, schedule, budgets: {}, deviceCounts: {} };
      for (const b of budgets) (mg.budgets[b.child_id] ||= {})[b.category] = b.daily_min;
      for (const c of counts) mg.deviceCounts[c.child_id] = c.n;
      html = shell({ tab: "/family", title: "Genkan family", body: familyView(s, mg) });
    } else if (url.pathname === "/earn") {
      html = shell({ tab: "/earn", title: "Genkan: learn to earn", body: earnPage(await earnData(q)) });
    } else if (url.pathname === "/devices") {
      html = shell({ tab: "/devices", title: "Genkan devices", body: devicesView(s) });
    } else if (url.pathname === "/" || url.pathname === "/index.html") {
      // Home leans on a short window for the "last 7 days" lines under each
      // kid; if the analytics query fails the controls must still render.
      let a = null;
      try { a = await analytics(q, 7); } catch (e) { a = null; }
      html = shell({ tab: "/", title: "Genkan", body: tonight(s, a) });
    } else {
      res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return;
    }
    res.writeHead(200, headers);
    res.end(html);
  } catch (e) { res.writeHead(500, { "content-type": "text/plain" }); res.end("error: " + e.message); }
});
server.listen(PORT, BIND, () => console.log(`kids dashboard on http://${BIND}:${PORT}`));
