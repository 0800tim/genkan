// Hearth dashboard: the health of the box itself.
//
// Everything here is a file read. /proc and /sys already hold every number
// this page shows, so nothing shells out to top, df, free or vmstat on a
// timer: a family box can be a Raspberry Pi, and a page that costs a process
// spawn every few seconds is a page that makes the thing it is measuring
// slower. One sample is five small reads and takes about a millisecond.
//
// WHY A SECOND STREAM, and not the existing /api/stream.
// The live wire (dashboard/live.mjs) samples the FAMILY NETWORK through the
// gateway container every 1.5 seconds, and it deliberately only runs while
// somebody has the Right Now page open, because each of its ticks costs a
// docker exec. Box health is a different job on a different clock: it wants a
// slow sample (10s) that runs all the time, so that when a parent opens this
// page the charts already have hours of history behind them rather than
// starting from a blank plot. Bolting it onto the live wire would either make
// the household stream carry numbers no other page uses, or tie the box's
// history to whether anyone happened to be watching traffic. So: its own
// sampler, its own ring buffer, its own /api/system/stream. Same SSE shape,
// same reconnect behaviour, same "one sampler for the whole process" rule.
//
// READ ONLY, always. This module opens files under /proc and /sys and asks
// docker's socket what is running. It changes nothing, anywhere.
import { readFile, readdir, statfs } from "node:fs/promises";
import { request } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { demoStatic, demoSample, demoBackfill } from "./sys-demo.mjs";

// The public demo (demo/compose.yaml) runs this same file inside a container
// that has no docker socket and whose cgroup numbers describe a shared server
// in a datacentre, not a family's box. Reading them would be both meaningless
// and a small leak of somebody else's machine, so with the flag set the whole
// sampler runs off dashboard/sys-demo.mjs instead and never opens /proc at
// all. Unset, which is every household install, nothing below changes.
const DEMO = process.env.HEARTH_DEMO === "1";

export const SYS_TICK_MS = Math.min(60000, Math.max(2000, Number(process.env.HEARTH_SYS_TICK_MS || 10000)));
const KEEP = Math.ceil((3 * 3600 * 1000) / SYS_TICK_MS);   // three hours of samples
const SLOW_MS = 30000;                                     // disk, containers, interface list
const DOCKER_SOCK = process.env.DOCKER_HOST_SOCK || "/var/run/docker.sock";
// The filesystem the tile reports on: the one this repo, and therefore the
// database volume and the logs, actually sits on.
const DATA_DIR = process.env.HEARTH_DATA_DIR || dirname(dirname(fileURLToPath(import.meta.url)));

const num = v => (Number.isFinite(v) ? v : null);
const readText = p => readFile(p, "utf8").then(t => t.trim()).catch(() => null);

// ---------------------------------------------------------------------------
// The readers. Every one of them returns null rather than a zero when the
// kernel does not offer that number, because "0%" and "we cannot see it" are
// completely different things to somebody deciding whether their box is sick.
// ---------------------------------------------------------------------------

// /proc/stat line one: the whole machine, in jiffies since boot. A percentage
// is the difference between two of these, so the first sample can only ever
// produce a baseline.
async function cpuCounters() {
  const txt = await readFile("/proc/stat", "utf8").catch(() => null);
  if (!txt) return null;
  const line = txt.split("\n", 1)[0] || "";
  if (!line.startsWith("cpu ")) return null;
  const f = line.trim().split(/\s+/).slice(1).map(Number);
  if (f.length < 5 || f.some(x => !Number.isFinite(x))) return null;
  // idle + iowait: a box waiting on its disk is not a busy box.
  return { idle: f[3] + f[4], total: f.reduce((a, b) => a + b, 0) };
}

async function memory() {
  const txt = await readFile("/proc/meminfo", "utf8").catch(() => null);
  if (!txt) return null;
  const kb = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (m) kb[m[1]] = Number(m[2]) * 1024;
  }
  if (!kb.MemTotal) return null;
  // MemAvailable is the kernel's own estimate of what a new program could get
  // without swapping. It is the only honest "free" on Linux: MemFree ignores
  // the page cache, which is why `free` used to frighten people.
  const avail = kb.MemAvailable ?? kb.MemFree ?? 0;
  const used = Math.max(0, kb.MemTotal - avail);
  return {
    total: kb.MemTotal, avail, used,
    pct: (used / kb.MemTotal) * 100,
    swapTotal: kb.SwapTotal ?? 0,
    swapUsed: Math.max(0, (kb.SwapTotal ?? 0) - (kb.SwapFree ?? 0)),
  };
}

async function loadavg() {
  const txt = await readText("/proc/loadavg");
  if (!txt) return null;
  const f = txt.split(/\s+/).slice(0, 3).map(Number);
  return f.every(Number.isFinite) ? f : null;
}

async function uptimeSec() {
  const txt = await readText("/proc/uptime");
  const v = txt ? Number(txt.split(/\s+/)[0]) : NaN;
  return Number.isFinite(v) ? Math.floor(v) : null;
}

// Which interfaces are worth showing a parent. A real NIC has a device behind
// it in /sys; a bridge, a veth pair, a virtual machine tap and a VPN tunnel do
// not. That single test picks out exactly the box's own wires and, usefully,
// leaves the VPN interface out without having to name it. The family network
// island is NOT here on purpose: its NIC lives inside the gateway container's
// namespace, so the host cannot see it at all. That is the whole design.
async function physicalIfaces() {
  const names = await readdir("/sys/class/net").catch(() => null);
  if (!names) return [];
  const out = [];
  for (const name of names.sort()) {
    if (name === "lo") continue;
    const dev = await readText(`/sys/class/net/${name}/device/uevent`);
    if (dev === null) continue;                      // not a real piece of hardware
    const wireless = (await readText(`/sys/class/net/${name}/phy80211/name`)) !== null
      || (await readText(`/sys/class/net/${name}/wireless/link`)) !== null
      || /^wl/.test(name);
    const state = await readText(`/sys/class/net/${name}/operstate`);
    out.push({ name, wireless, state: state || "unknown" });
  }
  // Plain language, never the kernel's name for the card. The dashboard is
  // read by a parent, not by whoever wired the box.
  let wired = 0, wifi = 0;
  for (const i of out) {
    if (i.wireless) i.label = ++wifi === 1 ? "Wi-Fi" : `Wi-Fi ${wifi}`;
    else i.label = ++wired === 1 ? "Wired to the router" : `Second wired link`;
  }
  return out;
}

// /proc/net/dev, for the interfaces above only. rx is field 0, tx is field 8.
// On the box's own uplink, rx is what the house pulled DOWN from the internet
// and tx is what it pushed up, which is the way round a parent expects.
async function netCounters(ifaces) {
  const txt = await readFile("/proc/net/dev", "utf8").catch(() => null);
  if (!txt) return null;
  const per = {};
  for (const line of txt.split("\n")) {
    const c = line.indexOf(":");
    if (c < 0) continue;
    const name = line.slice(0, c).trim();
    if (!ifaces.some(i => i.name === name)) continue;
    const f = line.slice(c + 1).trim().split(/\s+/).map(Number);
    if (f.length < 9 || !Number.isFinite(f[0]) || !Number.isFinite(f[8])) continue;
    per[name] = { down: f[0], up: f[8] };
  }
  return Object.keys(per).length ? per : null;
}

async function disk() {
  const s = await statfs(DATA_DIR).catch(() => null);
  if (!s || !s.blocks) return null;
  const bs = Number(s.bsize) || 4096;
  const total = Number(s.blocks) * bs;
  const avail = Number(s.bavail) * bs;
  const used = (Number(s.blocks) - Number(s.bfree)) * bs;
  // The same arithmetic df does: the root reserve is nobody's to spend, so it
  // is left out of both halves rather than counted as free space.
  const pct = used + avail > 0 ? (used / (used + avail)) * 100 : 0;
  return { total, used, avail, pct };
}

// Temperature is a nice-to-have and plenty of boxes have no sensor at all, so
// the path is looked up once and the tile simply does not appear if nothing
// answers. Thermal zones first (that is where a Pi puts it), then the hwmon
// drivers an x86 box uses.
const ZONE_PREF = ["x86_pkg_temp", "cpu-thermal", "cpu_thermal", "soc_thermal", "k10temp", "coretemp"];
const HWMON_PREF = ["k10temp", "coretemp", "cpu_thermal", "zenpower", "soc_thermal"];
async function findTempPath() {
  const zones = await readdir("/sys/class/thermal").catch(() => []);
  const found = [];
  for (const z of zones) {
    if (!/^thermal_zone\d+$/.test(z)) continue;
    const type = await readText(`/sys/class/thermal/${z}/type`);
    if (type !== null) found.push({ path: `/sys/class/thermal/${z}/temp`, type });
  }
  for (const want of ZONE_PREF) {
    const hit = found.find(f => f.type === want);
    if (hit) return { path: hit.path, label: "CPU" };
  }
  if (found.length) return { path: found[0].path, label: found[0].type || "System" };

  const hw = await readdir("/sys/class/hwmon").catch(() => []);
  const names = [];
  for (const h of hw) {
    const name = await readText(`/sys/class/hwmon/${h}/name`);
    if (name !== null) names.push({ dir: `/sys/class/hwmon/${h}`, name });
  }
  for (const want of HWMON_PREF) {
    const hit = names.find(n => n.name === want);
    if (!hit) continue;
    if ((await readText(`${hit.dir}/temp1_input`)) !== null) return { path: `${hit.dir}/temp1_input`, label: "CPU" };
  }
  return null;
}
async function readTemp(path) {
  const raw = await readText(path);
  const v = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(v)) return null;
  // Millidegrees on every driver worth the name, but a few report whole degrees.
  const c = v > 200 ? v / 1000 : v;
  return c > 0 && c < 200 ? c : null;
}

// Which Hearth containers are up. Asked over docker's own socket rather than
// by running `docker ps`: no process spawn, a couple of milliseconds, and it
// is on the slow clock anyway. If there is no socket (the demo has none) or
// the dashboard's user cannot open it, this returns null and the tile says so
// instead of pretending nothing is running.
function dockerGet(path, timeout = 2500) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const req = request({ socketPath: DOCKER_SOCK, path, method: "GET", timeout }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", c => { body += c; if (body.length > 2 << 20) req.destroy(); });
      res.on("end", () => { try { finish(JSON.parse(body)); } catch { finish(null); } });
    });
    req.on("timeout", () => { req.destroy(); finish(null); });
    req.on("error", () => finish(null));
    req.end();
  });
}
async function containers() {
  const list = await dockerGet("/v1.43/containers/json?all=1");
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const c of list) {
    const name = String((c.Names || [])[0] || "").replace(/^\//, "");
    // Hearth's own containers only, and never the public demo's, which happen
    // to share the prefix on the box that hosts it.
    if (!name.startsWith("hearth-") || name.startsWith("hearth-demo")) continue;
    out.push({ name, up: c.State === "running", state: String(c.State || "unknown") });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// The sampler
// ---------------------------------------------------------------------------
export class SysMonitor {
  constructor() {
    this.clients = new Set();
    this.history = [];            // ring buffer: { t, cpu, mem, down, up }
    this.now = null;              // the full latest reading, for the tiles
    this.slow = { disk: null, containers: null, ifaces: [], cores: null, temp: null, model: null };
    this.tempPath = null;
    this.prevCpu = null;
    this.prevNet = null;
    this.prevAt = 0;
    this.slowAt = 0;
    this.timer = null;
    this.started = false;
  }

  // Runs for the life of the process, not only while a page is open: the whole
  // point of the ring buffer is that the charts have something to draw the
  // moment somebody looks. Ten seconds of file reads is far cheaper than the
  // page being useless for its first minute.
  start() {
    if (this.started) return this;
    this.started = true;
    // The demo has no past to remember, so it is given one: three hours of the
    // same invented box, so the charts open full rather than filling in over
    // the next half hour while somebody watches.
    if (DEMO && !this.history.length) this.history = demoBackfill(Date.now(), SYS_TICK_MS, KEEP - 1);
    this.tick().catch(() => {});
    this.timer = setInterval(() => this.tick().catch(() => {}), SYS_TICK_MS);
    if (this.timer.unref) this.timer.unref();
    return this;
  }

  async refreshSlow(force = false) {
    const at = Date.now();
    if (!force && at - this.slowAt < SLOW_MS) return;
    this.slowAt = at;
    if (DEMO) { this.slow = { ...this.slow, ...demoStatic() }; return; }
    if (this.tempPath === null) this.tempPath = (await findTempPath()) || false;
    const [d, c, ifaces, cpuinfo] = await Promise.all([
      disk(), containers(), physicalIfaces(),
      this.slow.cores ? null : readFile("/proc/cpuinfo", "utf8").catch(() => ""),
    ]);
    this.slow.disk = d;
    this.slow.containers = c;
    this.slow.ifaces = ifaces;
    if (cpuinfo !== null) {
      const cores = (cpuinfo.match(/^processor\s*:/gm) || []).length;
      this.slow.cores = cores || null;
    }
  }

  async tick() {
    const at = Date.now();
    await this.refreshSlow();
    if (DEMO) {
      const s = demoSample(at);
      this.now = s;
      this.push({ t: at, cpu: s.cpu, mem: s.mem ? s.mem.pct : null, down: s.net?.down ?? null, up: s.net?.up ?? null });
      return;
    }

    const [cpuNow, mem, load, up, net] = await Promise.all([
      cpuCounters(), memory(), loadavg(), uptimeSec(), netCounters(this.slow.ifaces),
    ]);
    const temp = this.tempPath ? await readTemp(this.tempPath.path) : null;

    // A percentage is a difference, so the very first tick after start (or
    // after an unreadable one) can only set the baseline.
    let cpu = null;
    if (cpuNow && this.prevCpu) {
      const dt = cpuNow.total - this.prevCpu.total;
      const di = cpuNow.idle - this.prevCpu.idle;
      if (dt > 0) cpu = Math.max(0, Math.min(100, ((dt - di) / dt) * 100));
    }
    if (cpuNow) this.prevCpu = cpuNow;

    // Per-interface rates, and the household-facing total under them.
    let per = null, down = null, upBps = null;
    if (net && this.prevNet && this.prevAt) {
      const secs = (at - this.prevAt) / 1000;
      if (secs > 0.2) {
        per = {};
        down = 0; upBps = 0;
        for (const [name, v] of Object.entries(net)) {
          const was = this.prevNet[name];
          // A counter that went backwards means the interface was reset or
          // renumbered, never negative traffic.
          const d = was && v.down >= was.down ? (v.down - was.down) / secs : 0;
          const u = was && v.up >= was.up ? (v.up - was.up) / secs : 0;
          per[name] = { down: d, up: u, totalDown: v.down, totalUp: v.up };
          down += d; upBps += u;
        }
      }
    }
    if (net) { this.prevNet = net; this.prevAt = at; }

    this.now = {
      t: at,
      cpu: num(cpu),
      mem, load, uptime: up,
      temp: num(temp),
      tempLabel: this.tempPath ? this.tempPath.label : null,
      net: per ? { down, up: upBps, per } : null,
    };
    this.push({ t: at, cpu: num(cpu), mem: mem ? mem.pct : null, down: num(down), up: num(upBps) });
  }

  push(sample) {
    // Rounded before it is stored: a chart plots pixels, and three hours of
    // full float precision is bytes spent on digits nobody can see.
    const s = {
      t: sample.t,
      cpu: sample.cpu === null ? null : Math.round(sample.cpu * 10) / 10,
      mem: sample.mem === null ? null : Math.round(sample.mem * 10) / 10,
      down: sample.down === null ? null : Math.round(sample.down),
      up: sample.up === null ? null : Math.round(sample.up),
    };
    this.history.push(s);
    if (this.history.length > KEEP) this.history.splice(0, this.history.length - KEEP);
    this.broadcast("tick", { s, now: this.tiles() });
  }

  // Everything the tiles and the side cards need, in one object. Nothing in
  // here names the box, its addresses or the network it is on.
  tiles() {
    const n = this.now || {};
    return {
      t: n.t || Date.now(),
      cpu: n.cpu ?? null,
      cores: this.slow.cores,
      mem: n.mem || null,
      load: n.load || null,
      uptime: n.uptime ?? null,
      temp: n.temp ?? null,
      tempLabel: n.tempLabel || null,
      disk: this.slow.disk,
      containers: this.slow.containers,
      net: n.net ? { down: n.net.down, up: n.net.up } : null,
      ifaces: (this.slow.ifaces || []).map(i => ({
        label: i.label, state: i.state, wireless: i.wireless,
        ...(n.net?.per?.[i.name] || {}),
      })),
    };
  }

  // What the server-rendered page is built from, and what /api/system.json
  // answers. Waits for a second sample if it has to, because a page whose CPU
  // reads "no reading yet" on the very first load is a page that looks broken.
  async pageData() {
    this.start();
    await this.refreshSlow();
    if (this.history.length < 2) {
      await this.tick();
      await new Promise(r => setTimeout(r, 400));
      await this.tick();
    }
    return { tickMs: SYS_TICK_MS, demo: DEMO, now: this.tiles(), history: this.history.slice() };
  }

  broadcast(event, data) {
    if (!this.clients.size) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) { try { res.write(frame); } catch { this.clients.delete(res); } }
  }

  // One SSE subscriber. Same shape as the live wire's, deliberately: same
  // reconnect behaviour, same heartbeat, nothing new for a proxy to learn.
  attach(req, res) {
    this.start();
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 5000\n\n`);
    this.clients.add(res);
    this.refreshSlow().then(() => {
      try {
        res.write(`event: hello\ndata: ${JSON.stringify({
          tickMs: SYS_TICK_MS, now: this.tiles(), history: this.history.slice(),
        })}\n\n`);
      } catch { /* gone */ }
    });
    const beat = setInterval(() => { try { res.write(`: beat\n\n`); } catch { /* gone */ } }, 15000);
    if (beat.unref) beat.unref();
    let done = false;
    const bye = () => {
      if (done) return; done = true;
      clearInterval(beat);
      this.clients.delete(res);
      try { res.end(); } catch { /* already gone */ }
    };
    req.on("close", bye);
    req.on("error", bye);
    res.on("error", bye);
  }
}
