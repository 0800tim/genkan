// Genkan dashboard: the System page.
//
// The health of the box Genkan runs on, for the parent who has just been told
// "the internet is broken" and needs to know whether that is the house, the
// gateway, or the little computer in the cupboard running out of disk.
//
// It follows the same rules as every other page here: server rendered first so
// it works with JavaScript off, inline SVG with no library and nothing
// fetched, a legend wherever there are two lines, a table twin under every
// chart, and both themes stepped separately rather than flipped.
//
// What it deliberately does NOT show: the address the dashboard is reachable
// on, the name of the box, or anything about the private network the operator
// gets here through. A parent screenshots this page to ask for help, so the
// only interfaces named are the box's own wires, in plain language.
import { fmt } from "./analytics.mjs";
import { lines, table, esc, LINE_VB, LINE_TOP } from "./charts.mjs";

// How many points a chart draws at most. Three hours of ten second samples is
// over a thousand readings, which is more line than a 280px card can show and
// more path than is worth sending ten times a minute. Buckets are averaged,
// never sampled, so a spike inside a bucket still lifts the line.
const MAX_POINTS = 260;

// The windows offered above the charts. All three are slices of the same
// in-memory buffer, so switching between them costs nothing and asks the box
// for nothing.
const WINDOWS = [[10, "10 minutes"], [60, "1 hour"], [180, "3 hours"]];
const DEFAULT_WIN = 60;

// ---------------------------------------------------------------------------
// Small formatters. Bytes go through fmt.bytes so the whole dashboard rounds
// and labels sizes the same way.
// ---------------------------------------------------------------------------
const pct = v => (v === null || v === undefined ? null : `${Math.round(v)}%`);

// A capacity, as against a quantity of traffic. fmt.bytes rounds hard because
// it formats totals where a tenth of a gigabyte is noise; here the tenth is
// the point, because "19.8 GB of 29.9 GB" says something "19 GB of 30 GB"
// does not. Above a hundred units the decimal stops earning its place.
function size(b) {
  b = Number(b || 0);
  if (b <= 0) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const v = b / Math.pow(1024, i);
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

function rate(b) {
  if (b === null || b === undefined || !Number.isFinite(b)) return "no reading";
  // fmt.bytes says "0" for nothing, which reads as a broken unit next to a
  // slash. Idle is idle, and it still has a unit.
  return b <= 0 ? "0 B/s" : `${fmt.bytes(b)}/s`;
}

function duration(sec) {
  if (sec === null || sec === undefined) return null;
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d >= 1) return h ? `${d}d ${h}h` : `${d} day${d === 1 ? "" : "s"}`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m} min`;
}

function clockNZ(ms) {
  return new Date(ms).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function dateNZ(ms) {
  return new Date(ms).toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

// The same nice maximum the live wire uses for a bytes-per-second axis, so the
// two pages step their scales identically.
function niceRate(v) {
  if (!(v > 0)) return 65536;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  const s = m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 3 ? 3 : m <= 5 ? 5 : m <= 7.5 ? 7.5 : 10;
  return Math.max(65536, s * e);
}

// Average a long history down to at most MAX_POINTS buckets. Nulls are gaps
// and are carried through as gaps rather than counted as zero.
function bucket(rows, key, want = MAX_POINTS) {
  const n = rows.length;
  if (n <= want) return rows.map(r => (r[key] === null || r[key] === undefined ? null : r[key]));
  const size = n / want;
  const out = [];
  for (let i = 0; i < want; i++) {
    let sum = 0, count = 0;
    for (let j = Math.floor(i * size); j < Math.floor((i + 1) * size) && j < n; j++) {
      const v = rows[j][key];
      if (v !== null && v !== undefined) { sum += v; count++; }
    }
    out.push(count ? sum / count : null);
  }
  return out;
}

const sliceWin = (history, minutes) => {
  const cut = Date.now() - minutes * 60000;
  const rows = history.filter(r => r.t >= cut);
  return rows.length >= 2 ? rows : history.slice(-2);
};

// ---------------------------------------------------------------------------
// Icons. Sixteen pixels of stroke, drawn here rather than fetched, and marked
// aria-hidden because every one of them sits next to its own word.
// ---------------------------------------------------------------------------
const ICON = {
  cpu: `<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/>
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>`,
  mem: `<rect x="2" y="7" width="20" height="11" rx="2"/><path d="M6 18v3M10 18v3M14 18v3M18 18v3M6 11v3M18 11v3"/>`,
  disk: `<path d="M5.5 5.2 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.8A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.2z"/>
    <path d="M2 12h20M6 16h.01M10 16h.01"/>`,
  load: `<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`,
  box: `<path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
    <path d="m3.4 7 8.6 5 8.6-5M12 22V12"/>`,
  temp: `<path d="M14 4.5a2 2 0 0 0-4 0v10a4 4 0 1 0 4 0Z"/>`,
  net: `<path d="M8 3v14M8 17l-3.5-3.5M8 17l3.5-3.5M16 21V7M16 7l-3.5 3.5M16 7l3.5 3.5"/>`,
};
const icon = name => `<svg class="sticon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

// One stat tile. `value` of null means the box could not tell us, and the tile
// says so in words instead of printing a zero somebody would act on.
function tile({ id, label, value, unit = "", sub, tint, ic, missing = "Not readable on this box." }) {
  const known = value !== null && value !== undefined;
  return `<div class="stile" id="${id}w" style="--tint:var(--s-${tint})">
    <div class="sthead"><span class="stlab">${esc(label)}</span>${icon(ic)}</div>
    <div class="stval${known ? "" : " off"}" id="${id}">${known ? esc(String(value)) : "n/a"}${
    known && unit ? `<i>${esc(unit)}</i>` : ""}</div>
    <div class="stsub" id="${id}s">${esc(known ? sub : missing)}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export function systemPage(data) {
  const n = data.now || {};
  const history = data.history || [];
  const rows = sliceWin(history, DEFAULT_WIN);

  // --- the tiles -----------------------------------------------------------
  const cpuSub = n.load
    ? `load ${n.load[0].toFixed(2)}${n.cores ? ` across ${n.cores} core${n.cores === 1 ? "" : "s"}` : ""}`
    : n.cores ? `${n.cores} cores` : "the whole machine";
  const memSub = n.mem ? `${size(n.mem.used)} of ${size(n.mem.total)} in use` : "";
  const diskSub = n.disk ? `${size(n.disk.used)} of ${size(n.disk.total)} used, ${size(n.disk.avail)} free` : "";
  const loadSub = n.load ? `${n.load[1].toFixed(2)} over 5 min, ${n.load[2].toFixed(2)} over 15` : "";
  const upSub = n.uptime ? `last restart ${dateNZ(Date.now() - n.uptime * 1000)}` : "";
  const boxes = n.containers;
  const boxesUp = boxes ? boxes.filter(c => c.up).length : null;
  // A tile turns to the alarm colour when its number crosses the line a parent
  // would want to know about. The figure and the words say the same thing, so
  // colour is never the only channel.
  const tint = (bad, normal) => (bad ? "crit" : normal);
  const boxSub = boxes
    ? (boxes.length ? `${boxes.map(c => c.name.replace(/^genkan-/, "")).join(", ")}` : "none found")
    : "";

  const tiles = [
    tile({
      id: "sysCpu", label: "CPU", value: pct(n.cpu), sub: cpuSub, tint: tint(n.cpu >= 92, "cpu"), ic: "cpu",
      missing: "This kernel does not offer /proc/stat.",
    }),
    tile({
      id: "sysMem", label: "Memory", value: n.mem ? pct(n.mem.pct) : null, sub: memSub, tint: tint(n.mem && n.mem.pct >= 92, "mem"), ic: "mem",
      missing: "/proc/meminfo is not readable here.",
    }),
    tile({
      id: "sysDisk", label: "Disk", value: n.disk ? pct(n.disk.pct) : null, sub: diskSub, tint: tint(n.disk && n.disk.pct >= 90, "disk"), ic: "disk",
      missing: "The filesystem did not answer.",
    }),
    tile({
      id: "sysLoad", label: "Load", value: n.load ? n.load[0].toFixed(2) : null, sub: loadSub, tint: "load", ic: "load",
      missing: "/proc/loadavg is not readable here.",
    }),
    tile({
      id: "sysUp", label: "Uptime", value: duration(n.uptime), sub: upSub, tint: "uptime", ic: "clock",
      missing: "/proc/uptime is not readable here.",
    }),
    tile({
      id: "sysBoxes", label: "Containers", value: boxes ? `${boxesUp}/${boxes.length}` : null,
      sub: boxSub, tint: tint(boxes && boxes.length && boxesUp < boxes.length, "boxes"), ic: "box",
      missing: "Docker is not reachable from the dashboard.",
    }),
    // Plenty of boxes have no usable sensor, so the tile appears only when one
    // genuinely answered rather than sitting there showing nothing.
    n.temp !== null && n.temp !== undefined
      ? tile({
        id: "sysTemp", label: "Temperature", value: Math.round(n.temp), unit: "°C",
        sub: n.temp >= 80 ? "hot: check the airflow" : n.temp >= 70 ? "warm but within range" : "comfortable",
        tint: tint(n.temp >= 80, "temp"), ic: "temp",
      })
      : "",
  ].join("");

  // --- the charts ----------------------------------------------------------
  const cpuVals = bucket(rows, "cpu");
  const memVals = bucket(rows, "mem");
  const downVals = bucket(rows, "down");
  const upVals = bucket(rows, "up");
  const netMax = niceRate(Math.max(0, ...downVals.filter(Number.isFinite), ...upVals.filter(Number.isFinite)) * 1.15);
  const pctTicks = [{ v: 100, label: "100%" }, { v: 50, label: "50%" }, { v: 0, label: "0" }];
  const netTicks = [
    { v: netMax, label: `${fmt.bytes(netMax)}/s` },
    { v: netMax / 2, label: `${fmt.bytes(netMax / 2)}/s` },
    { v: 0, label: "0" },
  ];
  const xl = [clockNZ(rows[0]?.t || Date.now()),
    clockNZ(rows[Math.floor(rows.length / 2)]?.t || Date.now()), "now"];

  const chart = (id, series, max, ticks, title, gutter) =>
    lines({ id, series, max, ticks, xlabels: xl, height: 148, title, gutter });

  const cpuNow = n.cpu === null || n.cpu === undefined ? "no reading" : `${Math.round(n.cpu)}%`;
  const memNow = n.mem ? `${Math.round(n.mem.pct)}%` : "no reading";

  const charts = `
  <div class="filters" role="group" aria-label="How far back the charts go">
    <span class="lab">Showing</span>
    ${WINDOWS.map(([m, l]) => `<button type="button" class="fchip syswin" data-win="${m}"
      aria-pressed="${m === DEFAULT_WIN}">${esc(l)}</button>`).join("")}
  </div>
  <div class="syscharts">
    <div class="card sysfig">
      <div class="sfhead"><h2>Processor</h2><b id="sysCpuNow">${esc(cpuNow)}</b></div>
      <div class="figure">${chart("cpuc", [{ key: "cpu", label: "CPU", colour: "var(--s-cpu)", values: cpuVals }],
      100, pctTicks, "Processor use over time, as a percentage of the whole machine.")}</div>
      <p class="cnote">Every core counted together. Waiting on the disk is not counted as busy.</p>
    </div>
    <div class="card sysfig">
      <div class="sfhead"><h2>Memory</h2><b id="sysMemNow">${esc(memNow)}</b></div>
      <div class="figure">${chart("memc", [{ key: "mem", label: "Memory", colour: "var(--s-mem)", values: memVals }],
      100, pctTicks, "Memory in use over time, as a percentage of the memory fitted.")}</div>
      <p class="cnote">In use means memory a new program could not have. Cache the kernel would hand
        back on request counts as free.</p>
    </div>
    <div class="card sysfig">
      <div class="sfhead"><h2>Network</h2><b id="sysNetNow">${esc(n.net ? rate(n.net.down) : "no reading")}</b></div>
      <div class="figure">${chart("netc", [
      { key: "down", label: "Down", colour: "var(--s-netdown)", values: downVals },
      { key: "up", label: "Up", colour: "var(--s-netup)", values: upVals },
    ], netMax, netTicks, "Network throughput over time, down and up drawn separately.", 58)}</div>
      <ul class="legend">
        <li><span class="swatch" style="background:var(--s-netdown)"></span>Coming down</li>
        <li><span class="swatch" style="background:var(--s-netup)"></span>Going up</li>
      </ul>
      <p class="cnote">The box's own wires only. The family network island lives inside the gateway
        container, so its traffic is on <a href="/live">Right now</a>, not here.</p>
    </div>
  </div>`;

  // --- the two side cards --------------------------------------------------
  const boxRows = boxes === null
    ? `<p class="empty">The dashboard cannot reach docker from here, so it cannot say what is running.
       Everything else on this page is unaffected.</p>`
    : boxes.length === 0
      ? `<p class="empty">No Genkan containers found. On a deployed box there should be a gateway,
         AdGuard and the kid portal.</p>`
      : boxes.map(c => `<div class="row"><span>${c.up ? '<span class="dot-on"></span>' : ""}${esc(c.name)}</span>
        <span class="r">${c.up ? "running" : esc(c.state)}</span></div>`).join("");

  const ifRows = (n.ifaces || []).length
    ? n.ifaces.map(i => {
      const live = i.state !== "up" ? ""
        : i.down === undefined
          ? `<span class="r">no reading yet</span>`
          : `<span class="r">${esc(rate(i.down))} down &middot; ${esc(rate(i.up))} up</span>`;
      const state = i.state === "up" ? "" : ` <span class="pill">${esc(i.state === "down" ? "not connected" : i.state)}</span>`;
      // A link that has never carried a byte has nothing to report, and a row
      // of zeroes reads as a fault rather than as "unused".
      const since = i.totalDown === undefined || (!i.totalDown && !i.totalUp) ? ""
        : `<div class="dmeta"><code>${esc(size(i.totalDown))} down, ${esc(size(i.totalUp))} up since the box last started</code></div>`;
      return `<div class="row drow"><div class="dname"><b>${esc(i.label)}</b>${state}${live}</div>${since}</div>`;
    }).join("")
    : `<p class="empty">No physical network cards found, which usually means /sys is not mounted the
       way this reader expects.</p>`;

  // --- the table twin, for everything the charts draw ----------------------
  const tail = rows.slice(-12).reverse();
  const numbers = table(
    ["Time", "CPU", "Memory", "Down", "Up"],
    tail.map(r => [clockNZ(r.t),
      r.cpu === null ? "n/a" : `${r.cpu.toFixed(1)}%`,
      r.mem === null ? "n/a" : `${r.mem.toFixed(1)}%`,
      r.down === null ? "n/a" : rate(r.down),
      r.up === null ? "n/a" : rate(r.up)]),
    { summary: "Show the last few readings as numbers" });

  return `<div id="sys" data-tick="${data.tickMs || 10000}">
  <div class="card syshead">
    <div class="shl"><h2>The box Genkan runs on</h2>
      <p class="sub">Read straight out of the kernel every ${Math.round((data.tickMs || 10000) / 1000)} seconds.
      Nothing here is written down: the history is held in memory and starts again if the dashboard restarts.</p></div>
    <div class="shstate"><span class="lvled" id="sysLed"></span><span class="lvstate" id="sysState">connecting&hellip;</span></div>
  </div>

  <div class="stiles">${tiles}</div>

  ${charts}

  <div class="syscols">
    <div class="card"><h2>What is running</h2>
      <p class="sub">The containers Genkan itself is made of. Anything not running here is a piece of the
        house that is currently missing.</p>
      ${boxRows}
    </div>
    <div class="card"><h2>Network links</h2>
      <p class="sub">The box's own network cards, in plain language. The private link a parent reaches this
        page over is deliberately not listed.</p>
      ${ifRows}
    </div>
  </div>

  <div class="card">${numbers}</div>

  <div class="card flat"><p class="foot">This page only reads. It opens files under /proc and /sys, asks
    the filesystem how full it is, and asks docker what is running. It changes no setting, touches no
    firewall rule and writes nothing to the database, so it is safe to leave open.
    ${data.demo ? "In this demo the figures describe a made-up little Genkan box rather than the machine the demo happens to be hosted on." : ""}</p></div>
</div>`;
}

// ---------------------------------------------------------------------------
// Style. Its own block, so it can be read as "what the System page added".
// ---------------------------------------------------------------------------
export const SYS_CSS = `
/* Series colours for the box's own metrics. Light and dark are separately
   chosen steps of the same hues, exactly like the household series. */
:root{
  --s-cpu:#b1400b; --s-mem:#7a4fd0; --s-disk:#2a78d6; --s-load:#1baf7a;
  --s-boxes:#1baf7a; --s-temp:#c07c12; --s-netdown:#2a78d6; --s-netup:#c07c12;
  --s-uptime:#0f8f9c;
  /* The alarm step is the dashboard's existing one, so a tile in trouble here
     is the same red as a child out of time on Home. */
  --s-crit:var(--crit);
}
@media (prefers-color-scheme:dark){
  :root:where(:not([data-theme=light])){
    --s-cpu:#f0824a; --s-mem:#9d7bec; --s-disk:#3987e5; --s-load:#199e70;
    --s-boxes:#199e70; --s-temp:#e0a13a; --s-netdown:#3987e5; --s-netup:#e0a13a;
    --s-uptime:#35b8c4;
  }
}
:root[data-theme=dark]{
  --s-cpu:#f0824a; --s-mem:#9d7bec; --s-disk:#3987e5; --s-load:#199e70;
  --s-boxes:#199e70; --s-temp:#e0a13a; --s-netdown:#3987e5; --s-netup:#e0a13a;
  --s-uptime:#35b8c4;
}

/* ---- header ---- */
.syshead{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.syshead .shl{flex:1;min-width:220px}
.syshead h2{margin-bottom:6px}
.syshead .sub{margin-bottom:0}
.shstate{display:flex;align-items:center;gap:7px;flex:none;padding-top:2px}

/* ---- stat tiles ---- */
/* One wash of the tile's own colour across the top left corner, the way a
   panel catches light, then straight back to the card surface. Enough to tell
   the tiles apart at a glance, never enough to compete with the figure. */
/* Flex rather than grid, for one reason: seven tiles into four columns leaves
   a hole on the second row. Wrapping flex items that are allowed to grow fill
   the last row instead, so the block reads as a block. */
.stiles{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.stile{flex:1 1 186px}
.stile{position:relative;min-width:0;border:1px solid var(--line);border-radius:14px;padding:12px 13px 11px;
  background:linear-gradient(152deg,color-mix(in oklab,var(--tint) 15%,var(--surface)) 0%,var(--surface) 66%);
  box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px -18px rgba(0,0,0,.35);overflow:hidden}
.stile::after{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:var(--tint);opacity:.55}
.sthead{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.stlab{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);
  font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sticon{width:16px;height:16px;flex:none;color:var(--tint);opacity:.8}
.stval{font-size:27px;font-weight:600;letter-spacing:-.02em;line-height:1.1;
  font-variant-numeric:tabular-nums}
.stval i{font-style:normal;font-size:15px;font-weight:600;color:var(--ink-2);margin-left:1px}
.stval.off{color:var(--ink-muted);font-size:24px}
.stsub{font-size:11.5px;color:var(--ink-muted);margin-top:2px;line-height:1.35;
  overflow:hidden;text-overflow:ellipsis}

/* ---- the three charts ---- */
.syscharts{display:grid;grid-template-columns:repeat(auto-fit,minmax(252px,1fr));gap:12px;margin-bottom:12px}
.syscharts .card{margin-bottom:0;display:flex;flex-direction:column}
.sfhead{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.sfhead h2{margin:0;flex:1;min-width:0}
.sfhead b{font-size:17px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
.sysfig .figure{margin:4px 0 0}
.sysfig .cnote{padding-top:2px}
.lchart .lline{transition:none}
.lchart .lempty{fill:var(--ink-muted);font-size:12px}
.lchart .grid{stroke:var(--grid)}

/* ---- the two lists ---- */
.syscols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
.syscols .card{margin-bottom:12px}
.syscols .row .r{flex:none}
.syscols .dname .r{margin-left:auto}

@media (max-width:460px){
  .stiles{gap:8px}
  .stile{flex:1 1 138px}
  .stval{font-size:24px}
}
`;

// ---------------------------------------------------------------------------
// The client. It updates numbers and redraws four lines in place; it never
// rebuilds the DOM, and with JavaScript off the server-rendered page above is
// still complete and correct, just not moving.
//
// Geometry is interpolated from charts.mjs rather than copied, so the client
// and the server can never disagree about where a point goes.
// ---------------------------------------------------------------------------
export const SYS_JS = `
(function(){
var root=document.getElementById('sys'); if(!root) return;
var VB=${LINE_VB}, TOP=${LINE_TOP}, MAXP=${MAX_POINTS};
var WIN=${DEFAULT_WIN};
var hist=[], now=null, lastAt=0, es=null, timer=0;

function bytes(b){b=Number(b)||0;
  if(b<=0)return '0';
  var u=['B','KB','MB','GB','TB'],i=Math.min(4,Math.floor(Math.log(b)/Math.log(1024)));
  var v=b/Math.pow(1024,i);
  return (v>=10||i===0?Math.round(v):v.toFixed(1))+' '+u[i];}
function rate(b){return (b===null||b===undefined)?'no reading':(b<=0?'0 B/s':bytes(b)+'/s');}
/* The capacity form: one decimal below a hundred units. Matches size() above. */
function size(b){b=Number(b)||0;
  if(b<=0)return '0';
  var u=['B','KB','MB','GB','TB'],i=Math.min(4,Math.floor(Math.log(b)/Math.log(1024)));
  var v=b/Math.pow(1024,i);
  return (i===0||v>=100?Math.round(v):v.toFixed(1))+' '+u[i];}
function clock(t){var d=new Date(t);
  return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function dur(s){if(s===null||s===undefined)return null;
  var d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  if(d>=1)return h?(d+'d '+h+'h'):(d+' day'+(d===1?'':'s'));
  if(h>=1)return h+'h '+m+'m';return m+' min';}
function niceRate(v){
  if(!(v>0))return 65536;
  var e=Math.pow(10,Math.floor(Math.log(v)/Math.LN10)),m=v/e;
  var s=m<=1?1:m<=1.5?1.5:m<=2?2:m<=3?3:m<=5?5:m<=7.5?7.5:10;
  return Math.max(65536,s*e);}

function setTint(id,name){var el=document.getElementById(id+'w');
  if(el)el.style.setProperty('--tint','var(--s-'+name+')');}
function setText(id,t){var el=document.getElementById(id);if(el&&t!==null&&t!==undefined)el.textContent=t;}
/* A tile's figure keeps its unit in a child element, so the number is replaced
   without touching it. */
function setVal(id,v,unit){
  var el=document.getElementById(id); if(!el) return;
  if(v===null||v===undefined){el.textContent='n/a';el.classList.add('off');return;}
  el.classList.remove('off');
  el.textContent=v;
  if(unit){var i=document.createElement('i');i.textContent=unit;el.appendChild(i);}}

/* Same buckets as the server: average, never sample, so a spike survives. */
function bucket(rows,key){
  var n=rows.length,out=[],i,j;
  if(n<=MAXP){for(i=0;i<n;i++){var v=rows[i][key];out.push(v===null||v===undefined?null:v);}return out;}
  var size=n/MAXP;
  for(i=0;i<MAXP;i++){
    var sum=0,c=0;
    for(j=Math.floor(i*size);j<Math.floor((i+1)*size)&&j<n;j++){
      var w=rows[j][key]; if(w!==null&&w!==undefined){sum+=w;c++;}}
    out.push(c?sum/c:null);}
  return out;}

function windowRows(){
  var cut=Date.now()-WIN*60000;
  var r=hist.filter(function(x){return x.t>=cut;});
  return r.length>=2?r:hist.slice(-2);}

/* Rewrite one series in place. The polyline and the area path are the only two
   things that change; the svg, its gradient and its grid stay exactly as the
   server drew them. */
function drawSeries(id,i,vals,max,plotH){
  var line=document.getElementById(id+'-l'+i), area=document.getElementById(id+'-a'+i);
  if(!line||!area) return;
  var n=vals.length; if(n<2){line.setAttribute('points','');area.setAttribute('d','');return;}
  var step=VB/(n-1),pts=[],k;
  for(k=0;k<n;k++){
    var v=vals[k];
    if(v===null||v===undefined||!isFinite(v))continue;
    var f=max>0?Math.max(0,Math.min(1,v/max)):0;
    pts.push((k*step).toFixed(1)+','+(TOP+(1-f)*(plotH-TOP)).toFixed(1));}
  if(pts.length<2){line.setAttribute('points','');area.setAttribute('d','');return;}
  line.setAttribute('points',pts.join(' '));
  var first=pts[0].split(',')[0],last=pts[pts.length-1].split(',')[0];
  area.setAttribute('d','M'+first+','+plotH+' L'+pts.join(' L')+' L'+last+','+plotH+' Z');}

function plotH(id){
  var sv=document.getElementById(id+'-plot');
  return sv?Number(sv.getAttribute('height'))||148:148;}

function redraw(){
  var rows=windowRows(); if(rows.length<2) return;
  var cpu=bucket(rows,'cpu'),mem=bucket(rows,'mem'),dn=bucket(rows,'down'),up=bucket(rows,'up');
  drawSeries('cpuc',0,cpu,100,plotH('cpuc'));
  drawSeries('memc',0,mem,100,plotH('memc'));
  var peak=0,i;
  for(i=0;i<dn.length;i++){if(dn[i]>peak)peak=dn[i];if(up[i]>peak)peak=up[i];}
  var max=niceRate(peak*1.15);
  drawSeries('netc',0,dn,max,plotH('netc'));
  drawSeries('netc',1,up,max,plotH('netc'));
  /* The network scale moves, so its two labelled ticks move with it. */
  var t=document.getElementById('netc-ticks');
  if(t){var ts=t.querySelectorAll('text');
    if(ts[0])ts[0].textContent=bytes(max)+'/s';
    if(ts[1])ts[1].textContent=bytes(max/2)+'/s';}
  ['cpuc','memc','netc'].forEach(function(id){
    setText(id+'-x0',clock(rows[0].t));
    setText(id+'-x1',clock(rows[Math.floor(rows.length/2)].t));});}

function tiles(d){
  if(!d) return;
  now=d;
  setVal('sysCpu',d.cpu===null||d.cpu===undefined?null:Math.round(d.cpu)+'%');
  setTint('sysCpu',d.cpu>=92?'crit':'cpu');
  setText('sysCpuNow',d.cpu===null||d.cpu===undefined?'no reading':Math.round(d.cpu)+'%');
  if(d.load){
    setText('sysCpus','load '+d.load[0].toFixed(2)+(d.cores?(' across '+d.cores+' core'+(d.cores===1?'':'s')):''));
    setVal('sysLoad',d.load[0].toFixed(2));
    setText('sysLoads',d.load[1].toFixed(2)+' over 5 min, '+d.load[2].toFixed(2)+' over 15');}
  else if(d.cores) setText('sysCpus',d.cores+' core'+(d.cores===1?'':'s'));
  if(d.mem){
    setVal('sysMem',Math.round(d.mem.pct)+'%');
    setText('sysMems',size(d.mem.used)+' of '+size(d.mem.total)+' in use');
    setText('sysMemNow',Math.round(d.mem.pct)+'%');
    setTint('sysMem',d.mem.pct>=92?'crit':'mem');}
  if(d.disk){
    setVal('sysDisk',Math.round(d.disk.pct)+'%');
    setText('sysDisks',size(d.disk.used)+' of '+size(d.disk.total)+' used, '+size(d.disk.avail)+' free');
    setTint('sysDisk',d.disk.pct>=90?'crit':'disk');}
  if(d.uptime!==null&&d.uptime!==undefined) setVal('sysUp',dur(d.uptime));
  if(d.containers){
    var up=d.containers.filter(function(c){return c.up;}).length;
    setVal('sysBoxes',up+'/'+d.containers.length);
    setTint('sysBoxes',(d.containers.length&&up<d.containers.length)?'crit':'boxes');}
  if(d.temp!==null&&d.temp!==undefined){
    setVal('sysTemp',String(Math.round(d.temp)),'\\u00b0C');
    setTint('sysTemp',d.temp>=80?'crit':'temp');}
  setText('sysNetNow',d.net?rate(d.net.down):'no reading');}

/* The connection light, in the same language the live wire uses. */
function state(){
  var led=document.getElementById('sysLed'),txt=document.getElementById('sysState');
  if(!led||!txt) return;
  var age=lastAt?Date.now()-lastAt:0;
  if(!lastAt){led.className='lvled';txt.textContent='connecting\\u2026';return;}
  if(age>45000){led.className='lvled warn';txt.textContent='last reading '+Math.round(age/1000)+'s ago';return;}
  led.className='lvled on';
  txt.textContent=age<3000?'live':('updated '+Math.round(age/1000)+'s ago');}

function connect(){
  try{es=new EventSource('/api/system/stream');}catch(e){return;}
  es.addEventListener('hello',function(ev){
    var d=JSON.parse(ev.data);
    hist=d.history||[];lastAt=Date.now();tiles(d.now);redraw();state();});
  es.addEventListener('tick',function(ev){
    var d=JSON.parse(ev.data);
    if(d.s){hist.push(d.s); if(hist.length>2000) hist.splice(0,hist.length-2000);}
    lastAt=Date.now();tiles(d.now);redraw();state();});
  es.onerror=function(){state();};}

Array.prototype.forEach.call(root.querySelectorAll('.syswin'),function(b){
  b.addEventListener('click',function(){
    WIN=Number(b.dataset.win)||60;
    Array.prototype.forEach.call(root.querySelectorAll('.syswin'),function(o){
      o.setAttribute('aria-pressed',String(o===b));});
    redraw();});});

connect();
timer=setInterval(state,1000);
addEventListener('pagehide',function(){if(es)es.close();clearInterval(timer);});
})();
`;
