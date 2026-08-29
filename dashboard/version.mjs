// The quiet line at the bottom of every dashboard page: what version this
// household is running, and whether it is working.
//
// WHY IT IS HERE AND NOT ON A PAGE OF ITS OWN
// A parent should not have to go looking to find out that something broke, and
// they should never have to wonder what version they are on when they report a
// problem. One line, on every page, under everything else. It is not a
// feature, it is a label on the tin.
//
// It NEVER blocks a page. bin/kidnet-health takes a couple of seconds because
// it puts real questions on the wire, so this keeps the last answer in memory
// and refreshes in the background. A page render reads a variable and nothing
// else. A dashboard that hangs because its health widget is thinking is worse
// than no health widget.
import { readFileSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HEARTH_ROOT || join(HERE, "..");
const HEALTH_BIN = join(ROOT, "bin", "kidnet-health");
const CACHE_FILE = process.env.HEARTH_HEALTH_FILE || "/var/lib/hearth/health.json";
// How stale an answer may get before a fresh one is started. Five minutes is a
// compromise: often enough that "checked four minutes ago" is still useful,
// rare enough that opening ten pages does not run ten health checks.
const MAX_AGE_MS = 5 * 60 * 1000;
const DEMO = process.env.HEARTH_DEMO === "1";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The version is read once. It only changes when the code changes, and when
// the code changes this process is restarted by deploy.sh anyway.
let VERSION = process.env.HEARTH_VERSION || "";
if (!VERSION) { try { VERSION = readFileSync(join(ROOT, "VERSION"), "utf8").trim(); } catch { VERSION = ""; } }

let cache = { at: 0, data: null, running: false };

function readCacheFile() {
  // bin/kidnet-health leaves its last answer here when it can write to
  // /var/lib/hearth, which is the normal case on a deployed box: the upgrade
  // tooling runs it as root. Preferring it means the dashboard usually has an
  // answer the moment it starts, with nothing to run.
  try {
    const age = Date.now() - statSync(CACHE_FILE).mtimeMs;
    if (age > MAX_AGE_MS) return null;
    return { at: Date.now() - age, data: JSON.parse(readFileSync(CACHE_FILE, "utf8")) };
  } catch { return null; }
}

function refresh() {
  if (DEMO || cache.running) return;
  if (Date.now() - cache.at < MAX_AGE_MS) return;
  const fromFile = readCacheFile();
  if (fromFile) { cache = { ...fromFile, running: false }; return; }
  cache.running = true;
  // --json --quiet is read-only: see the header of bin/kidnet-health. A
  // non-zero exit is the answer, not an error, so stdout is parsed either way.
  execFile("bash", [HEALTH_BIN, "--json"], { timeout: 45000, maxBuffer: 1 << 20 }, (err, so) => {
    cache.running = false;
    try { cache = { at: Date.now(), data: JSON.parse(so), running: false }; }
    catch { cache = { at: Date.now(), data: null, running: false }; }
  });
}
// One at start so the first page a parent opens already has an answer.
refresh();

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.round(h / 24)} day(s) ago`;
}

export function healthState() { refresh(); return cache; }

// The footer itself. Deliberately plain: version, a dot, a sentence. When
// something is broken it says which thing and what to run, because the person
// reading it is the person who has to fix it and they are not a sysadmin.
export function versionFooter() {
  const c = healthState();
  const d = c.data;
  const v = VERSION ? `Hearth ${esc(d?.version || VERSION)}` : "Hearth";
  let dot = "unknown", words = "checking...", title = "";
  if (DEMO) { dot = "demo"; words = "this is the public demo, so there is nothing to check"; }
  else if (d) {
    const bad = (d.checks || []).filter(x => x.status === "fail");
    const warn = (d.checks || []).filter(x => x.status === "warn");
    if (d.healthy && !warn.length) { dot = "ok"; words = "everything healthy"; }
    else if (d.healthy) { dot = "warn"; words = `working, ${warn.length} thing${warn.length === 1 ? "" : "s"} worth a look`; title = warn.map(x => x.headline).join(" | "); }
    else { dot = "bad"; words = bad.length === 1 ? bad[0].headline : `${bad.length} things are broken`; title = bad.map(x => x.headline).join(" | "); }
    words += `, checked ${ago(c.at)}`;
  }
  const detail = dot === "bad"
    ? `<div class="vfix">Run <code>kidnet-health</code> in a terminal for what to do. If this started after an update: <code>sudo kidnet-rollback to previous</code>.</div>` : "";
  return `<style>
.vfoot{margin:26px auto 6px;max-width:100%;padding:10px 2px 0;font-size:13px;
  display:flex;flex-wrap:wrap;gap:10px;align-items:center;opacity:.72;border-top:1px solid var(--line,#8883)}
.vfoot b{font-weight:600}
.vdot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 auto}
.vdot.ok{background:#3fae66}.vdot.warn{background:#d59a2a}.vdot.bad{background:#d3453f}
.vdot.unknown,.vdot.demo{background:#8888}
.vfoot.is-bad{opacity:1;color:var(--crit,#d3453f)}
.vfix{flex:1 1 100%;font-size:12px;opacity:.85}
.vfix code{font-size:12px}
</style>
<footer class="vfoot ${dot === "bad" ? "is-bad" : ""}"${title ? ` title="${esc(title)}"` : ""}>
  <b>${v}</b><span class="vdot ${dot}"></span><span>${esc(words)}</span>${detail}
</footer>`;
}
