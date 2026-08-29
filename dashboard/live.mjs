// Hearth dashboard: the live wire.
//
// One sampler for the whole process, shared by every open page. It asks the
// gateway container for two cheap things per tick and turns the difference
// between ticks into a rate:
//
//   1. /proc/net/dev inside the container, for kids0. That is the honest
//      household total: every byte that crossed the house network, whatever
//      it was. TX on kids0 is data going TO the devices (a download), RX is
//      data coming FROM them (an upload).
//   2. `nft -j list sets inet kids`, which returns EVERY dynamic set with its
//      per-device counters in a single call (~40ms, ~7KB). That is where the
//      per-device, per-owner, per-category and per-app numbers come from.
//
// READ ONLY on everything the metering owns. This module never flushes, adds
// to or deletes gaming_dev, video_dev, tor_dev or any svc_*_dev set, and never
// touches an existing rule. kidnet-catmeter and kidnet-servicemeter own those
// counters and reset them on their own once-a-minute schedule; flushing them
// here would silently steal minutes from the family's metering. The only
// consequence of their schedule for us is that a counter can go DOWN between
// two reads, which we read as "it was reset", never as negative traffic.
//
// THE ONE THING IT DOES ADD (and why). nftables has no per-device grand total,
// only per-category and per-service counters, so "a lot of bandwidth is going
// out, who is responsible?" is unanswerable from the existing sets: a speed
// test or a game download belongs to no category. So the sampler maintains its
// own pair of counting-only sets, live_up_dev and live_down_dev, fed by a
// chain that contains nothing but two `update` statements and accepts
// everything. It cannot change a verdict, cannot drop or allow a packet, and
// runs after the filter chain so blocked traffic is never counted. It is the
// same pattern bin/kidnet-servicemeter already uses, with two differences that
// matter: the sets carry a timeout so they cannot grow without bound, and the
// chain is only ever created when it is genuinely absent, so repeated runs
// cannot stack duplicate rules. Set HEARTH_LIVE_DEVICE_TOTALS=0 to turn the
// whole thing off; everything else still works, per-device figures just fall
// back to "traffic we can name".
import { execFile } from "node:child_process";
import { demoTick } from "./live-demo.mjs";

// The public demo has no gateway container, no nftables and no docker socket to
// reach either with, so it synthesises the same tick shape from its own roster
// (dashboard/live-demo.mjs). Unset, which is every household installation, this
// flag is false and not one line below behaves differently.
const DEMO = process.env.HEARTH_DEMO === "1";

const GW = process.env.GW_CONTAINER || "hearth-gw";
const IFACE = process.env.KIDS_IFACE || "kids0";
const WANT_TOTALS = process.env.HEARTH_LIVE_DEVICE_TOTALS !== "0";
// A tick every 1.5s: fast enough that a speed test shows up while it is still
// running, slow enough that the docker exec is a rounding error on the box.
export const TICK_MS = Math.min(5000, Math.max(700, Number(process.env.LIVE_TICK_MS || 1500)));
const KEEP = 240;                 // ticks kept for replay (~6 minutes at 1.5s)
const STALE_GIVE_UP = 8;          // consecutive failures before we show zero
const PROBE = `cat /proc/net/dev; echo '@@NFT@@'; nft -j list sets inet kids`;

// Stack order, bottom first. The de-emphasis grey sits at the bottom so it is
// never adjacent to the green, and the violet sits at the top next to the
// green rather than next to the blue: that ordering is what makes the
// five-way split pass the colour-vision separation check in both themes.
//
// 'download' is content delivery, not screen time. A console pulling a 60 GB
// update is the biggest thing on the wire all evening and it is NOT gaming,
// so it gets its own band rather than being charged to a child's play time.
export const LIVE_CATS = ["other", "gaming", "video", "social", "download"];

// A game is a trickle; a game UPDATE is a flood. Anything faster than this to
// an address we know as gaming is content delivery, so it is charted as a
// download instead. Roughly 7 Mbit/s: gameplay rarely passes 1 Mbit/s, while
// an update takes everything the line will give. The same rule and the same
// figure live in bin/kidnet-catmeter, which books the minutes.
// Deliberately NOT applied to video, where 4K streaming is legitimately fast.
const DOWNLOAD_BPS = Math.max(65536, Number(process.env.HEARTH_DOWNLOAD_BPS || 873813));

const UP_SET = "live_up_dev", DOWN_SET = "live_down_dev", LIVE_CHAIN = "livemetering";
const LIVE_RULES = [
  `iifname "${IFACE}" update @${UP_SET} { ip saddr }`,
  `oifname "${IFACE}" update @${DOWN_SET} { ip daddr }`,
];
const LIVE_SPEC = `table inet kids {
  set ${UP_SET}   { type ipv4_addr; flags dynamic; size 512; timeout 10m; counter; }
  set ${DOWN_SET} { type ipv4_addr; flags dynamic; size 512; timeout 10m; counter; }
  chain ${LIVE_CHAIN} {
    type filter hook forward priority 30; policy accept;
    ${LIVE_RULES.join("\n    ")}
  }
}`;

const run = (cmd, args, timeout = 2500, input = null) => new Promise(res => {
  const child = execFile(cmd, args, { timeout, maxBuffer: 8 << 20 },
    (e, so, se) => res({ ok: !e, out: so || "", err: (se || "") + (e ? ` ${e.message}` : "") }));
  if (input != null) { child.stdin.end(input); }
});

// --- parsing ---------------------------------------------------------------

function parseIface(text, iface) {
  for (const line of String(text).split("\n")) {
    const i = line.indexOf(iface + ":");
    if (i < 0) continue;
    const f = line.slice(i + iface.length + 1).trim().split(/\s+/).map(Number);
    // /proc/net/dev: rx bytes is field 0, tx bytes is field 8.
    if (f.length >= 9 && Number.isFinite(f[0]) && Number.isFinite(f[8])) return { rx: f[0], tx: f[8] };
  }
  return null;
}

// Every dynamic set carrying per-device counters, flattened to "<set>|<ip>" ->
// bytes. Shape from nft: elem: [{ elem: { val, counter: { bytes } } }].
function parseSets(json) {
  const out = new Map();
  let doc;
  try { doc = JSON.parse(json); } catch { return out; }
  for (const blk of doc?.nftables || []) {
    const s = blk?.set;
    if (!s || s.table !== "kids" || !Array.isArray(s.elem)) continue;
    if (!/_dev$/.test(s.name)) continue;
    for (const raw of s.elem) {
      const el = raw && typeof raw === "object" && "elem" in raw ? raw.elem : raw;
      if (!el || typeof el !== "object") continue;
      const ip = el.val, b = el.counter?.bytes;
      if (typeof ip === "string" && Number.isFinite(b)) out.set(`${s.name}|${ip}`, b);
    }
  }
  return out;
}

// A counter that went down was reset between our two reads (the meter's own
// once-a-minute flush, or a set element that timed out and came back), so
// everything it now holds accrued since that reset. Never negative.
const step = (cur, prev) => (prev === undefined || cur < prev ? cur : cur - prev);

const zeroCats = () => ({ other: 0, gaming: 0, video: 0, social: 0, download: 0 });

// --- the sampler -----------------------------------------------------------

export class LiveWire {
  constructor(q, log = () => {}) {
    this.q = q;
    this.log = log;
    this.clients = new Set();
    this.history = [];
    this.timer = null;
    this.busy = false;
    this.fails = 0;
    this.prevIface = null;
    this.prevSets = new Map();
    this.prevAt = 0;
    this.first = true;
    this.last = null;             // last emitted tick, reused when a read fails
    this.devices = [];
    this.services = new Map();    // set name -> { name, label, category, emoji }
    this.metaAt = 0;
    this.rosterKey = "";
    this.totalsAt = 0;
    this.totalsOn = false;
    this.peak = 0;
    this.firewall = true;
  }

  // Device names, owners and classes change rarely; refresh them on a slow
  // clock so the fast path stays a single docker exec.
  async refreshMeta(force = false) {
    const now = Date.now();
    if (!force && now - this.metaAt < 15000) return;
    this.metaAt = now;
    try {
      const rows = await this.q(`SELECT id, label, hostname, mac, ip, device_kind, category, vendor,
               person, person_id, person_kind, unassigned,
               (last_seen > now()-interval '5 minutes') AS online
             FROM device_roster WHERE ip IS NOT NULL
             ORDER BY category, person NULLS LAST, label, hostname`);
      this.devices = rows.map(d => ({
        id: d.id, ip: d.ip, mac: d.mac || null,
        label: d.label || d.hostname || d.ip,
        person: d.person || null, personId: d.person_id || null,
        personKind: d.person_kind || null,
        kind: d.device_kind || null,
        cls: d.category || "personal",
        vendor: d.vendor || null,
        unassigned: !!d.unassigned, online: !!d.online,
      }));
      // A device only appears in device_roster once it has a reservation, but
      // it starts talking the moment it takes a DHCP lease. Without this the
      // busiest thing on the wire can show up as a bare address with no way to
      // claim it, which is the opposite of what this page is for. The roster
      // still wins wherever both know an address.
      const seen = new Set(this.devices.map(d => d.ip));
      const leases = await this.q(`SELECT host(l.ip) AS ip, l.mac::text AS mac, l.hostname,
               d.id, d.label, d.kind AS device_kind, d.category, d.vendor,
               d.child_id, c.name AS person, c.id AS person_id, c.kind AS person_kind,
               (d.last_seen > now()-interval '5 minutes') AS online
             FROM dhcp_leases l
             LEFT JOIN devices d ON d.mac = l.mac
             LEFT JOIN children c ON c.id = d.child_id
             WHERE l.active ORDER BY l.ip`);
      for (const l of leases) {
        if (!l.ip || seen.has(l.ip)) continue;
        seen.add(l.ip);
        this.devices.push({
          id: l.id || null, ip: l.ip, mac: l.mac || null,
          label: l.label || l.hostname || l.ip,
          person: l.person || null, personId: l.person_id || null,
          personKind: l.person_kind || null,
          kind: l.device_kind || null,
          cls: l.category || "personal",
          vendor: l.vendor || null,
          unassigned: !l.child_id, online: !!l.online,
        });
      }
    } catch { /* keep the previous roster rather than blanking the page */ }
    try {
      const svc = await this.q("SELECT name,label,category,emoji FROM services WHERE metered");
      this.services = new Map(svc.map(s => [`svc_${s.name}_dev`, s]));
    } catch { /* keep the previous service map */ }
    const key = this.devices.map(d => `${d.ip}:${d.label}:${d.person || ""}:${d.cls}:${d.online ? 1 : 0}`).join("|");
    if (key !== this.rosterKey) { this.rosterKey = key; this.broadcast("roster", { devices: this.roster() }); }
  }

  roster() {
    return this.devices.map(d => ({
      ip: d.ip, mac: d.mac, label: d.label, person: d.person, personId: d.personId,
      cls: d.cls, kind: d.kind, vendor: d.vendor, unassigned: d.unassigned, online: d.online,
    }));
  }

  // Make sure our own two counting sets and their chain exist, and that the
  // chain holds exactly the two rules it should. Only ever recreated when it
  // is genuinely wrong, so this can never stack duplicate rules the way an
  // unconditional `nft -f` would.
  async ensureTotals(force = false) {
    // Nothing to install and nothing to install it with.
    if (DEMO) { this.totalsOn = true; return; }
    if (!WANT_TOTALS) { this.totalsOn = false; return; }
    const now = Date.now();
    if (!force && now - this.totalsAt < 30000) return;
    this.totalsAt = now;
    const chain = await run("docker", ["exec", GW, "nft", "list", "chain", "inet", "kids", LIVE_CHAIN], 2500);
    const ok = chain.ok
      && LIVE_RULES.every(r => chain.out.includes(r))
      && chain.out.split("update @").length - 1 === LIVE_RULES.length;
    if (ok) { this.totalsOn = true; return; }
    // The chain is missing (a fresh gateway container) or malformed. Drop it
    // and lay it down once, cleanly. Nothing else in the table is touched.
    if (chain.ok) await run("docker", ["exec", GW, "nft", "delete", "chain", "inet", "kids", LIVE_CHAIN], 2500);
    const add = await run("docker", ["exec", "-i", GW, "nft", "-f", "-"], 3000, LIVE_SPEC);
    this.totalsOn = add.ok;
    this.log(add.ok
      ? `live wire: per-device byte counters installed (${LIVE_CHAIN}, counting only)`
      : `live wire: per-device totals unavailable (${add.err.trim().slice(0, 120)}); showing named traffic only`);
    if (add.ok) { this.prevSets.delete(`${UP_SET}|`); this.first = true; }
  }

  start() {
    if (this.timer) return;
    this.first = true;
    this.prevIface = null;
    this.prevSets = new Map();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
    this.tick();
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.refreshMeta();
      this.ensureTotals();
      if (DEMO) { demoTick(this); return; }
      const r = await run("docker", ["exec", GW, "sh", "-c", PROBE]);
      const at = Date.now();
      if (!r.ok || !r.out) { this.emitStale(at, r.err.trim().slice(0, 140) || "the gateway did not answer"); return; }
      const [devText, nftText = ""] = r.out.split("@@NFT@@");
      const iface = parseIface(devText, IFACE);
      const sets = parseSets(nftText);
      this.firewall = /"table": *"kids"|"name": *"kids_known"/.test(nftText) || sets.size > 0;
      if (!iface) { this.emitStale(at, `the ${IFACE} interface is not up yet`); return; }

      const dt = this.prevAt ? Math.max(0.25, (at - this.prevAt) / 1000) : TICK_MS / 1000;
      // The first tick only lays down baselines. Emitting it would report a
      // whole minute of accumulated bytes as one second of traffic.
      const warm = this.first;
      const house = warm ? { down: 0, up: 0 } : {
        down: step(iface.tx, this.prevIface?.tx) / dt,
        up: step(iface.rx, this.prevIface?.rx) / dt,
      };

      const cats = zeroCats();
      const devs = new Map();
      const dev = ip => {
        let d = devs.get(ip);
        if (!d) { d = { ip, down: 0, up: 0, named: 0, cats: zeroCats(), apps: {} }; devs.set(ip, d); }
        return d;
      };

      for (const [key, bytes] of sets) {
        const cut = key.indexOf("|");
        const setName = key.slice(0, cut), ip = key.slice(cut + 1);
        const bps = warm ? 0 : step(bytes, this.prevSets.get(key)) / dt;
        if (!(bps > 0)) continue;
        if (setName === DOWN_SET) { dev(ip).down += bps; continue; }
        if (setName === UP_SET) { dev(ip).up += bps; continue; }
        if (setName === "tor_dev") continue;   // an alert counter, not traffic worth charting
        if (setName === "gaming_dev") {
          // The rate rule, matching the meter: a flood on a gaming address is
          // an update, not a game, so it is charted as a download.
          const k = bps >= DOWNLOAD_BPS ? "download" : "gaming";
          cats[k] += bps; const d = dev(ip); d.cats[k] += bps; d.named += bps; continue;
        }
        if (setName === "video_dev") { cats.video += bps; const d = dev(ip); d.cats.video += bps; d.named += bps; continue; }
        if (setName === "download_dev") { cats.download += bps; const d = dev(ip); d.cats.download += bps; d.named += bps; continue; }
        const svc = this.services.get(setName);
        if (!svc) continue;
        const d = dev(ip);
        d.apps[svc.label] = (d.apps[svc.label] || 0) + bps;
        // Named apps are always recorded per device, but only the social ones
        // are ADDED to the category totals: gaming, video and download already
        // come from the category sets above, and counting both would double
        // them. A messaging, audio or schoolwork app is named and never
        // charged to any band, which is the whole point of not metering it.
        if (svc.category === "social") { cats.social += bps; d.cats.social += bps; d.named += bps; }
      }

      const houseTotal = house.down + house.up;
      cats.other = Math.max(0, houseTotal - (cats.gaming + cats.video + cats.social + cats.download));

      // Per device: whatever its own total counter saw, minus the part we can
      // put a name to, is that device's share of "other". If the totals chain
      // is not available the device only reports what it can name, and the UI
      // says so rather than implying the rest is zero.
      const rows = [];
      for (const d of devs.values()) {
        const total = this.totalsOn ? d.down + d.up : d.named;
        d.cats.other = Math.max(0, total - d.named);
        const bps = Math.max(total, d.named);
        if (bps < 1) continue;
        rows.push({
          ip: d.ip,
          bps: Math.round(bps),
          down: Math.round(d.down), up: Math.round(d.up),
          cats: {
            other: Math.round(d.cats.other), gaming: Math.round(d.cats.gaming),
            video: Math.round(d.cats.video), social: Math.round(d.cats.social),
            download: Math.round(d.cats.download),
          },
          app: topApp(d.apps),
        });
      }
      rows.sort((a, b) => b.bps - a.bps);

      this.prevIface = iface;
      this.prevSets = sets;
      this.prevAt = at;
      this.first = false;
      this.fails = 0;
      if (houseTotal > this.peak) this.peak = houseTotal;

      this.publish({
        t: at,
        down: Math.round(house.down), up: Math.round(house.up),
        cats: {
          other: Math.round(cats.other), gaming: Math.round(cats.gaming),
          video: Math.round(cats.video), social: Math.round(cats.social),
          download: Math.round(cats.download),
        },
        devs: rows.slice(0, 40),
        peak: Math.round(this.peak),
        totals: this.totalsOn,
        stale: false,
      });
    } catch (e) {
      this.emitStale(Date.now(), String(e?.message || e).slice(0, 140));
    } finally { this.busy = false; }
  }

  // A read failed. Hold the last known picture for a few ticks rather than
  // dropping the stream or drawing a cliff that never happened; if it keeps
  // failing, fall to zero so nobody reads a frozen number as current traffic.
  emitStale(at, why) {
    this.fails++;
    const base = this.last;
    const give = this.fails >= STALE_GIVE_UP || !base;
    this.first = true;   // whatever comes back next needs a fresh baseline
    this.publish({
      t: at,
      down: give ? 0 : base.down, up: give ? 0 : base.up,
      cats: give ? zeroCats() : base.cats,
      devs: give ? [] : base.devs,
      peak: Math.round(this.peak),
      totals: this.totalsOn,
      stale: true, why: why || "no reading",
    });
  }

  publish(tick) {
    this.last = tick;
    this.history.push(tick);
    if (this.history.length > KEEP) this.history.splice(0, this.history.length - KEEP);
    this.broadcast("tick", tick);
  }

  broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) { try { res.write(frame); } catch { this.clients.delete(res); } }
  }

  meta() {
    return {
      tickMs: TICK_MS, iface: IFACE, cats: LIVE_CATS,
      totals: this.totalsOn, firewall: this.firewall,
      devices: this.roster(),
      history: this.history.slice(-120),
      peak: Math.round(this.peak),
    };
  }

  snapshot() { return { ...this.meta(), now: this.last }; }

  // One SSE subscriber. The sampler runs only while somebody is watching.
  attach(req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`retry: 3000\n\n`);
    this.clients.add(res);
    this.start();
    Promise.all([this.refreshMeta(true), this.ensureTotals(true)]).then(() => {
      try { res.write(`event: hello\ndata: ${JSON.stringify(this.meta())}\n\n`); } catch { /* gone */ }
    });
    // A comment line every 15s keeps proxies and sleepy phones from closing an
    // idle connection. It is not an event, so the client never sees it as data.
    const beat = setInterval(() => { try { res.write(`: beat\n\n`); } catch { /* gone */ } }, 15000);
    if (beat.unref) beat.unref();
    let done = false;
    const bye = () => {
      if (done) return; done = true;
      clearInterval(beat);
      this.clients.delete(res);
      if (!this.clients.size) this.stop();
      try { res.end(); } catch { /* already gone */ }
    };
    req.on("close", bye);
    req.on("error", bye);
    res.on("error", bye);
  }
}

function topApp(apps) {
  let best = null, bv = 0;
  for (const [k, v] of Object.entries(apps || {})) if (v > bv) { bv = v; best = k; }
  return best;
}
