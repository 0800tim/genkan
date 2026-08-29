// Hearth dashboard: notifications to a parent's phone.
//
// The page that turns "Hearth knows" into "a parent knows". Everything Hearth
// raises already sits in the alerts table; bin/kidnet-notify sends the ones a
// household asked for, and this is where a household asks.
//
// THE PROMISE THE PAGE HAS TO KEEP SAYING OUT LOUD: Hearth has no telemetry and
// talks to no cloud. A route is the household's own box POSTing to an address
// the household typed in. With no routes, nothing is sent to anybody, and that
// is the shipped default. The page says this in plain words at the top, because
// a parental controls product that starts pushing to phones is exactly the
// moment somebody wonders who else is reading it.
//
// Why a separate module: dashboard/views.mjs and dashboard/server.mjs are long,
// shared and edited by other hands. Everything here is additive, and the two
// shared files touch it in about eight lines between them.
import { esc } from "./charts.mjs";

// The two kinds that are built and tested, and the two that are documented
// extension points. The page offers only the built ones, and says plainly that
// the others are not done, rather than offering a control that fails later.
export const KINDS = [
  ["ntfy", "ntfy", "A topic on ntfy.sh, or better, on your own ntfy server. No accounts, works on iOS and Android, and the topic name is the password, so make it long and random."],
  ["webhook", "Webhook", "POST a small JSON body to any URL you control: Home Assistant, Node-RED, a Matrix bridge, a script of your own."],
];
export const KIND_VALUES = KINDS.map(k => k[0]);
export const NOT_BUILT = [
  ["Email", "Needs your household's own SMTP server. Not built: see docs/NOTIFICATIONS.md."],
  ["Home Assistant, directly", "Works today behind a webhook. A first-class route is not built: see docs/NOTIFICATIONS.md."],
];

export const SEVERITIES = [
  ["urgent", "Only the urgent", "The safety signals and a gateway that has stopped working. Nothing else will ever buzz."],
  ["warn", "Urgent and worth knowing", "The default. Safety signals, filter bypass attempts, a household device that is not as restricted as it should be. No routine housekeeping."],
  ["info", "Everything", "Adds the routine: a device nobody has claimed, a child out of time, a job waiting for your yes. These collapse into one summary message."],
];
export const SEVERITY_VALUES = SEVERITIES.map(s => s[0]);

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const CATS_RE = /^[a-z0-9@_-]+(,[a-z0-9@_-]+)*$/;
const QUIET_RE = /^([0-9]{1,2}):([0-9]{2})-([0-9]{1,2}):([0-9]{2})$/;

// A target is a URL and nothing else. Same gate as bin/kidnet-notify's
// ck_target, because the two surfaces must not disagree about what is allowed.
function badTarget(t) {
  if (typeof t !== "string" || !/^https?:\/\//.test(t)) return "A target must be an http:// or https:// URL.";
  if (t.length < 8 || t.length > 400) return "That URL is the wrong length.";
  if (!/^[A-Za-z0-9:/?#@!$&*+,;=._~%-]+$/.test(t)) return "That URL has characters a URL cannot have.";
  return null;
}
// "21:30-07:00" into two minute counts, or null for no quiet hours.
function parseQuiet(v) {
  if (!v) return { start: null, end: null };
  const m = QUIET_RE.exec(String(v).trim());
  if (!m) return { bad: true };
  const [h1, m1, h2, m2] = [+m[1], +m[2], +m[3], +m[4]];
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return { bad: true };
  return { start: h1 * 60 + m1, end: h2 * 60 + m2 };
}
const hhmm = min => min === null || min === undefined ? ""
  : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
// Every query is wrapped, because this page must open on a database that has
// not loaded config/db/schema-notify.sql yet and say so, rather than 500.
export async function notifyData(q) {
  const safe = async (sql, fallback) => { try { return await q(sql); } catch { return fallback; } };
  const routes = await safe(`
    SELECT id, name, kind, min_severity, categories, quiet_start_min, quiet_end_min,
           quiet_urgent, include_detail, max_per_hour, enabled, in_quiet,
           sent_last_hour, last_sent_at, last_ok_at, last_error, last_error_at,
           -- The target is a secret (an ntfy topic name IS the password), so the
           -- page shows only enough to tell two routes apart, never the whole URL.
           substring(target from '^https?://[^/]+') AS host
      FROM notify_route_state ORDER BY name`, null);
  if (routes === null) return { missing: true };
  const [pending, log, wording] = await Promise.all([
    safe(`SELECT route, severity, category, count(*)::int AS n, min(ts) AS oldest
            FROM notify_pending GROUP BY 1,2,3 ORDER BY 1,2 DESC, 4 DESC`, []),
    safe(`SELECT ts, route_name, kind, ok, http_status, n_alerts, is_test, title, detail
            FROM notify_log ORDER BY ts DESC LIMIT 25`, []),
    safe(`SELECT category, title, body_one, name_ok, detail_ok
            FROM notify_wording WHERE category NOT LIKE '@%' ORDER BY priority DESC, category`, []),
  ]);
  return { missing: false, routes, pending, log, wording };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------
export async function notifyApi(q, body, { runTool }) {
  const bad = out => ({ ok: false, out });
  const action = String(body.action || "");
  const name = String(body.name || "").trim();

  if (action === "add" || action === "save") {
    if (!NAME_RE.test(name)) return bad("A route name is letters, numbers, - and _ , up to 32 characters.");
    const sev = String(body.severity || "warn");
    if (!SEVERITY_VALUES.includes(sev)) return bad("That is not one of the choices.");
    const cats = String(body.categories || "").trim().replace(/\s+/g, "");
    if (cats && !CATS_RE.test(cats)) return bad("Categories are lower-case names separated by commas.");
    const quiet = parseQuiet(String(body.quiet || "").trim());
    if (quiet.bad) return bad("Quiet hours look like 21:30-07:00, or leave it empty for none.");
    const catArr = cats ? cats.split(",") : [];
    const detail = body.detail === true || body.detail === "true";
    const quietUrgent = !(body.quietUrgent === false || body.quietUrgent === "false");
    // An empty token means "leave whatever is there alone" on a save, and "no
    // token" on an add. A parent editing quiet hours must not silently wipe the
    // bearer token they pasted in last week.
    const token = typeof body.token === "string" && body.token.length ? body.token : null;

    if (action === "add") {
      const kind = String(body.kind || "");
      if (!KIND_VALUES.includes(kind))
        return bad("Only ntfy and webhook routes are built. Email and Home Assistant are documented extension points.");
      const target = String(body.target || "").trim();
      const t = badTarget(target); if (t) return bad(t);
      const [dup] = await q("SELECT 1 FROM notify_routes WHERE name=$1", [name]);
      if (dup) return bad(`There is already a route called ${name}.`);
      await q(`INSERT INTO notify_routes(name, kind, target, token, min_severity, categories,
                                         quiet_start_min, quiet_end_min, quiet_urgent, include_detail)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [name, kind, target, token, sev, catArr, quiet.start, quiet.end, quietUrgent, detail]);
      return { ok: true, out: `Route "${name}" added. Nothing is proven until you send it a test.` };
    }

    const [cur] = await q("SELECT id FROM notify_routes WHERE name=$1", [name]);
    if (!cur) return bad("No route by that name.");
    const target = String(body.target || "").trim();
    if (target) { const t = badTarget(target); if (t) return bad(t); }
    await q(`UPDATE notify_routes SET min_severity=$2, categories=$3, quiet_start_min=$4,
               quiet_end_min=$5, quiet_urgent=$6, include_detail=$7,
               target = COALESCE(NULLIF($8,''), target),
               token  = CASE WHEN $9::text IS NULL THEN token ELSE $9 END
             WHERE id=$1`,
      [cur.id, sev, catArr, quiet.start, quiet.end, quietUrgent, detail, target, token]);
    return { ok: true, out: `Saved "${name}".` };
  }

  if (action === "toggle") {
    if (!NAME_RE.test(name)) return bad("which route?");
    const on = body.enabled === true || body.enabled === "true";
    const rows = await q("UPDATE notify_routes SET enabled=$2 WHERE name=$1 RETURNING 1", [name, on]);
    if (!rows.length) return bad("No route by that name.");
    return { ok: true, out: on ? `"${name}" is on.` : `"${name}" is off. Nothing will be sent to it.` };
  }

  if (action === "remove") {
    if (!NAME_RE.test(name)) return bad("which route?");
    const rows = await q("DELETE FROM notify_routes WHERE name=$1 RETURNING 1", [name]);
    if (!rows.length) return bad("No route by that name.");
    return { ok: true, out: `Removed "${name}", and everything Hearth remembered about sending to it.` };
  }

  // The one action that shells out. A notification setup nobody has tested is a
  // notification setup that does not work, so this sends a real message down the
  // real route, right now, ignoring quiet hours and the rate limit. It carries
  // no alert, so there is nothing to deduplicate and nothing is marked as sent.
  if (action === "test") {
    if (!NAME_RE.test(name)) return bad("which route?");
    const [r] = await q("SELECT 1 FROM notify_routes WHERE name=$1", [name]);
    if (!r) return bad("No route by that name.");
    const out = await runTool("kidnet-notify", ["test", name]);
    return { ok: out.ok, out: (out.out || "").trim() || (out.ok ? "Test sent." : "The test did not send.") };
  }

  return bad("bad request");
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
const CSS = `
.nfy .lead{max-width:62ch}
.nfy .promise{border-left:3px solid var(--ok,#2e7d32);padding:.5rem 0 .5rem .8rem;margin:.6rem 0 1rem}
.nfy table{width:100%;border-collapse:collapse;font-size:.92rem}
.nfy th{text-align:left;font-weight:600;opacity:.7;padding:.35rem .5rem .35rem 0}
.nfy td{padding:.45rem .5rem .45rem 0;border-top:1px solid var(--line,#8883);vertical-align:top}
.nfy .pill{display:inline-block;padding:.05rem .45rem;border-radius:999px;font-size:.78rem;border:1px solid var(--line,#8883)}
.nfy .pill.off{opacity:.55}
.nfy .pill.bad{border-color:#c62828;color:#c62828}
.nfy .pill.quiet{opacity:.75}
.nfy .acts{display:flex;gap:.35rem;flex-wrap:wrap;margin-top:.35rem}
.nfy .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:.6rem 1rem;margin:.6rem 0}
.nfy label{display:block;font-size:.85rem;opacity:.8;margin-bottom:.15rem}
.nfy input,.nfy select{width:100%;padding:.35rem .4rem}
.nfy .hint{font-size:.82rem;opacity:.75;margin-top:.15rem}
.nfy .words td:first-child{white-space:nowrap;opacity:.75}
`;

const JS = `
function nfyVal(id){var e=document.getElementById(id);return e?e.value.trim():'';}
function nfyChk(id){var e=document.getElementById(id);return !!(e&&e.checked);}
async function nfyAdd(){
  say('adding...');
  const {r,j}=await post('/api/notify',{action:'add',kind:nfyVal('nfy_kind'),name:nfyVal('nfy_name'),
    target:nfyVal('nfy_target'),token:nfyVal('nfy_token'),severity:nfyVal('nfy_sev'),
    quiet:nfyVal('nfy_quiet'),categories:nfyVal('nfy_cats'),detail:nfyChk('nfy_detail'),
    quietUrgent:nfyChk('nfy_qurgent')});
  done(r,j,900);}
async function nfySave(name){
  say('saving...');
  const {r,j}=await post('/api/notify',{action:'save',name:name,severity:nfyVal('e_sev_'+name),
    quiet:nfyVal('e_quiet_'+name),categories:nfyVal('e_cats_'+name),detail:nfyChk('e_detail_'+name),
    quietUrgent:nfyChk('e_qurgent_'+name),target:nfyVal('e_target_'+name),token:nfyVal('e_token_'+name)});
  done(r,j,900);}
async function nfyTest(name){
  say('sending a test to '+name+'...');
  const {r,j}=await post('/api/notify',{action:'test',name:name});done(r,j,1600);}
async function nfyToggle(name,on){
  const {r,j}=await post('/api/notify',{action:'toggle',name:name,enabled:on});done(r,j,700);}
async function nfyRemove(name){
  if(!confirm('Remove the route "'+name+'"? Hearth will stop sending to it, and will forget what it already sent.'))return;
  const {r,j}=await post('/api/notify',{action:'remove',name:name});done(r,j,900);}
function nfyEdit(name){var e=document.getElementById('edit_'+name);if(e)e.hidden=!e.hidden;}
`;

const when = ts => ts ? new Date(ts).toLocaleString("en-NZ", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";

function routeRow(r) {
  const failing = r.last_error && (!r.last_ok_at || new Date(r.last_error_at) > new Date(r.last_ok_at));
  const state = !r.enabled ? `<span class="pill off">off</span>`
    : failing ? `<span class="pill bad">failing</span>`
    : r.in_quiet ? `<span class="pill quiet">quiet hours</span>`
    : `<span class="pill">on</span>`;
  const last = failing ? `<span class="pill bad">last try failed</span> ${esc(String(r.last_error).slice(0, 90))}`
    : r.last_ok_at ? `last sent ${esc(when(r.last_ok_at))}`
    : "never sent anything yet";
  const quiet = r.quiet_start_min === null ? "no quiet hours"
    : `${hhmm(r.quiet_start_min)}-${hhmm(r.quiet_end_min)}${r.quiet_urgent ? "" : ", urgent waits too"}`;
  const sevLabel = (SEVERITIES.find(s => s[0] === r.min_severity) || [, r.min_severity])[1];
  const n = esc(r.name);
  const cats = (r.categories || []).join(",");
  return `<tr>
    <td><b>${n}</b><div class="hint">${esc(r.kind)} to ${esc(r.host || "")}</div></td>
    <td>${esc(sevLabel)}${cats ? `<div class="hint">only ${esc(cats)}</div>` : ""}</td>
    <td>${esc(quiet)}</td>
    <td>${state}<div class="hint">${last}</div>
      <div class="acts">
        <button class="mini" onclick="nfyTest('${n}')">Send a test</button>
        <button class="mini" onclick="nfyEdit('${n}')">Edit</button>
        <button class="mini" onclick="nfyToggle('${n}',${r.enabled ? "false" : "true"})">${r.enabled ? "Turn off" : "Turn on"}</button>
        <button class="mini" onclick="nfyRemove('${n}')">Remove</button>
      </div>
      <div id="edit_${n}" hidden>
        <div class="grid">
          <div><label for="e_sev_${n}">Send</label>
            <select id="e_sev_${n}">${SEVERITIES.map(([v, l]) =>
              `<option value="${v}"${v === r.min_severity ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
          <div><label for="e_quiet_${n}">Quiet hours</label>
            <input id="e_quiet_${n}" value="${r.quiet_start_min === null ? "" : `${hhmm(r.quiet_start_min)}-${hhmm(r.quiet_end_min)}`}" placeholder="21:30-07:00"></div>
          <div><label for="e_cats_${n}">Only these categories</label>
            <input id="e_cats_${n}" value="${esc(cats)}" placeholder="leave empty for all"></div>
          <div><label for="e_target_${n}">New address</label>
            <input id="e_target_${n}" placeholder="leave empty to keep the one it has"></div>
          <div><label for="e_token_${n}">New token</label>
            <input id="e_token_${n}" type="password" placeholder="leave empty to keep the one it has"></div>
        </div>
        <label><input type="checkbox" id="e_qurgent_${n}"${r.quiet_urgent ? " checked" : ""}> Urgent still goes through during quiet hours</label>
        <label><input type="checkbox" id="e_detail_${n}"${r.include_detail ? " checked" : ""}> Include the alert's own words where that is safe</label>
        <div class="acts"><button class="btn" onclick="nfySave('${n}')">Save</button></div>
      </div>
    </td></tr>`;
}

export function notifyPage(d) {
  if (d.missing) {
    return `<div class="card nfy"><h2>Notifications</h2>
      <div class="empty">The notification tables are not in this database yet. Load
      <code>config/db/schema-notify.sql</code> (or run <code>config/db/load.sh</code>) and this page appears.</div></div>`;
  }
  const routes = d.routes.length
    ? `<table><thead><tr><th>Route</th><th>Sends</th><th>Quiet hours</th><th>State</th></tr></thead>
       <tbody>${d.routes.map(routeRow).join("")}</tbody></table>`
    : `<div class="empty">No routes. Hearth is sending nothing to anybody, which is what a fresh
        install does and what a household that wants none should leave it doing.</div>`;

  const addForm = `<div class="card nfy"><h2>Add a route</h2>
    <div class="grid">
      <div><label for="nfy_kind">Kind</label>
        <select id="nfy_kind">${KINDS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select>
        <div class="hint">${esc(KINDS[0][2])}</div></div>
      <div><label for="nfy_name">A name for it</label>
        <input id="nfy_name" placeholder="dad-phone" maxlength="32">
        <div class="hint">Just for you. Letters, numbers, - and _ .</div></div>
      <div><label for="nfy_target">Address</label>
        <input id="nfy_target" placeholder="https://ntfy.sh/a-long-random-topic-name">
        <div class="hint">For ntfy this is the topic URL, and the topic name is the password: make it long and random.</div></div>
      <div><label for="nfy_token">Token, if it needs one</label>
        <input id="nfy_token" type="password" placeholder="optional">
        <div class="hint">Sent as a bearer token. Stored in the database, never in a file and never in a log line.</div></div>
      <div><label for="nfy_sev">Send</label>
        <select id="nfy_sev">${SEVERITIES.map(([v, l]) =>
          `<option value="${v}"${v === "warn" ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
      <div><label for="nfy_quiet">Quiet hours</label>
        <input id="nfy_quiet" placeholder="21:30-07:00">
        <div class="hint">Leave empty for none. Urgent still goes through unless you untick it below.</div></div>
      <div><label for="nfy_cats">Only these categories</label>
        <input id="nfy_cats" placeholder="leave empty for all">
        <div class="hint">Comma separated, for example <code>self-harm,tor,gateway</code>.</div></div>
    </div>
    <label><input type="checkbox" id="nfy_qurgent" checked> Urgent still goes through during quiet hours</label>
    <label><input type="checkbox" id="nfy_detail"> Include the alert's own words where that is safe</label>
    <div class="hint">Off by default, and it can never widen past what the wording below allows. The
      private categories stay private however this is set.</div>
    <div class="acts"><button class="btn" onclick="nfyAdd()">Add it</button></div>
    <div class="hint" style="margin-top:.7rem">Not built yet, deliberately, rather than half built:
      ${NOT_BUILT.map(([l, why]) => `<b>${esc(l)}</b> ${esc(why)}`).join(" ")}</div>
  </div>`;

  const words = d.wording.length ? `<div class="card nfy"><h2>What actually lands on a phone</h2>
    <p class="lead">A notification is read out of context, possibly in front of other people, and
      possibly by somebody reading over a shoulder. So the safety ones say that something needs your
      eyes and where to look, and nothing else. The detail stays here, on the home network. These
      words live in the database, so you can change them.</p>
    <table class="words"><thead><tr><th>When</th><th>It says</th><th>Names a child?</th></tr></thead><tbody>
    ${d.wording.map(w => `<tr><td>${esc(w.category)}</td>
      <td><b>${esc(w.title)}</b><div class="hint">${esc(w.body_one)}</div></td>
      <td>${w.name_ok ? "yes" : "no"}${w.detail_ok ? "" : `<div class="hint">no details either</div>`}</td></tr>`).join("")}
    </tbody></table></div>` : "";

  const waiting = d.pending.length ? `<div class="card nfy"><h2>Waiting to go</h2>
    <table><tbody>${d.pending.map(p => `<tr><td>${esc(p.route)}</td><td>${esc(p.severity)}</td>
      <td>${esc(p.category)}</td><td>${p.n} waiting, oldest ${esc(when(p.oldest))}</td></tr>`).join("")}
    </tbody></table>
    <div class="hint">These go on the next tick, unless quiet hours or a rate limit are holding them.
      Nothing here can be lost: an alert stays on this list until a route actually accepts it.</div>
    </div>` : "";

  const log = d.log.length ? `<div class="card nfy"><h2>The last few attempts</h2>
    <table><tbody>${d.log.map(l => `<tr><td>${esc(when(l.ts))}</td><td>${esc(l.route_name || "")}</td>
      <td>${l.ok ? "sent" : `<span class="pill bad">failed</span>`}${l.is_test ? " (test)" : ""}</td>
      <td>${esc(l.title || "")}<div class="hint">${esc(l.detail || "")}</div></td></tr>`).join("")}
    </tbody></table>
    <div class="hint">No addresses and no tokens are ever written here, so this log is safe to paste
      into a bug report.</div></div>` : "";

  return `<style>${CSS}</style><div class="card nfy"><h2>Notifications</h2>
    <p class="lead">Hearth already knows when a device nobody has claimed joins the network, when a
      household camera is not as restricted as it should be, and when a genuinely concerning signal
      turns up. This is how it tells you, instead of waiting for you to open a dashboard.</p>
    <div class="promise"><b>Nothing leaves this house that you did not set up.</b> Hearth has no
      telemetry and talks to no cloud. A route below is this box POSTing a short message to an
      address you typed in, and you can read every word it would send further down the page. With no
      routes, nothing is sent to anybody.</div>
    ${routes}</div>
    ${addForm}${waiting}${words}${log}
    <script>${JS}</script>`;
}
