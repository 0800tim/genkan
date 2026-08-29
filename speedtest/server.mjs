// Hearth speed test server.
//
// Binds ONLY to the Tailscale IP so every measured byte travels the
// device -> access point -> the Hearth box, with nothing in between. Zero
// dependencies; serves its own single-page Ookla-style UI.
//
//   GET  /          the test page
//   GET  /ping      204, timing beacon
//   GET  /download  endless incompressible stream; client aborts when done
//   POST /upload    discards body, returns { bytes }
//   GET  /info      { serverHost, serverIp, clientIp, direct }
//
// Runs as the hearth-speedtest container, on the island (see compose.yaml).
// Hearth speed test. Runs ON THE ISLAND, so any device can use it: a kid's
// tablet, a guest's phone, something with no VPN and no account.
//
// It measures BOTH legs separately, which is the whole point:
//   local     your device to the Hearth box (your wifi and the access point)
//   internet  the Hearth box out to the world (your actual connection)
// A parent can then tell "my wifi is the limit" from "my internet is the
// limit" from "the gateway is costing me something", instead of guessing.
//
// Adapted from the author's own network speed test tool.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";

const BIND = process.env.BIND || "0.0.0.0";   // island-facing in the container
const PORT = Number(process.env.PORT || 8877);
// Where the gateway downloads from when measuring the internet leg.
const UPSTREAM = process.env.UPSTREAM_TEST_URL || "https://speed.cloudflare.com/__down?bytes=25000000";
const CHUNK = randomBytes(4 * 1024 * 1024); // incompressible 4 MB

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hearth Speed Test</title>
<style>
  :root { --bg:#0b1020; --card:#141a2d; --line:rgba(255,255,255,.08);
    --text:#f3f4f8; --dim:#a0a8c0; --blue:#3fc1f0; }
  * { box-sizing:border-box; margin:0 }
  body { background:var(--bg); color:var(--text); padding:16px 0;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; min-height:100vh }
  .wrap { max-width:900px; margin:0 auto; padding:0; box-sizing:border-box }
  .controls { display:flex; gap:14px; justify-content:flex-end; align-items:center;
    margin-bottom:10px; color:var(--dim); font-size:12px; letter-spacing:.08em }
  select { background:var(--card); color:var(--text); border:1px solid var(--line);
    border-radius:8px; padding:6px 10px; font-size:13px }
  .stcard { border-radius:10px; overflow:hidden; margin-bottom:14px;
    background:linear-gradient(150deg,#3f4a2c 0%,#5c6b38 45%,#7d8b46 100%);
    padding:26px 30px 18px; color:#fff }
  /* Stacked, not side by side: on a phone the two halves fought for the row
     and the sublabel wrapped awkwardly next to the wordmark. */
  .sthead { display:block; margin-bottom:10px }
  .sthead .stlabel { margin-top:4px; opacity:.85; font-size:13px; letter-spacing:.16em }
  .wordmark { font-weight:800; font-size:20px; letter-spacing:.45em }
  .wordmark .o { color:#d9c27a }
  .stlabel { font-weight:700; font-size:15px; letter-spacing:.12em; opacity:.95 }
  .main { display:flex; gap:26px; align-items:center; justify-content:center; flex-wrap:wrap }
  .gaugebox { position:relative; width:min(380px,86vw) }
  svg { width:100%; height:auto; display:block }
  #gofab { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
    width:130px; height:130px; border-radius:50%; border:4px solid #2ca4dd;
    background:#fdfaf2; color:#4a5a2b; font-size:26px; font-weight:800;
    letter-spacing:.18em; cursor:pointer; transition:all .25s;
    box-shadow:0 6px 30px rgba(0,30,60,.25) }
  #gofab:hover { transform:translate(-50%,-50%) scale(1.05) }
  #gofab.hidden { opacity:0; pointer-events:none; transform:translate(-50%,-50%) scale(.5) }
  .tiles { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; width:100% }
  .wrap, .card, .tiles { box-sizing:border-box; max-width:100% }
  @media (max-width: 430px){
    /* Fixed tile widths overflowed a phone and clipped the labels. Let them
       share the row instead, and let the gauge shrink with the viewport. */
    /* Edge to edge on a phone: the navy gutters wasted real estate that the
       gauge and the tiles could use. */
    .wrap { padding:0 }
    body { padding:10px 0 }
    .st { border-radius:0 }
    .tiles { grid-template-columns:repeat(2, minmax(0,1fr)); gap:8px }
    svg { max-width:100%; height:auto }
  }
  .tile { background:rgba(255,255,255,.20); border-radius:6px; padding:14px 16px;
    backdrop-filter:blur(2px); transition:background .3s }
  .tile.active { background:rgba(255,255,255,.34) }
  .tile .k { font-size:12px; letter-spacing:.1em; display:flex; gap:6px; align-items:center; opacity:.95 }
  .tile .v { font-size:34px; font-weight:600; font-variant-numeric:tabular-nums; line-height:1.15 }
  .tile .u { font-size:13px; opacity:.85 }
  .stfoot { display:flex; justify-content:space-between; align-items:flex-end; margin-top:16px; font-size:13px }
  .stfoot .who b { font-size:16px; display:block }
  .compare b { font-size:14px }
  .compare p { margin:6px 0 0; font-size:13px; color:#a0a8c0; line-height:1.5 }
  .compare .tiny { font-size:11.5px; opacity:.75 }
  .cmp { display:flex; gap:8px; flex-wrap:wrap; margin:10px 0 4px }
  .cmp a { flex:1 1 auto; text-align:center; text-decoration:none; font-size:13px;
    font-weight:600; padding:9px 12px; border-radius:8px; color:var(--text);
    background:rgba(255,255,255,.07); border:1px solid var(--line) }
  .cmp a:hover { border-color:#7d8b46; background:rgba(125,139,70,.16) }
  /* History. Most people read this on a phone, where the default table cells
     ran together and the figures wrapped mid-number. */
  #results { width:100%; border-collapse:collapse; font-size:13px }
  #results td { padding:7px 10px; border-top:1px solid var(--line); vertical-align:top }
  #results td:first-child { color:#8b93a7; white-space:nowrap; width:1%; font-variant-numeric:tabular-nums }
  #results td:last-child { text-align:right; font-variant-numeric:tabular-nums }
  @media (max-width: 430px){
    #results { font-size:12px }
    #results td { padding:6px 8px }
  }
  .stfoot .loc { text-align:right; font-size:15px; font-weight:600 }
  .stfoot .loc small { display:block; font-weight:400; opacity:.85 }
  .pbar { height:3px; background:rgba(255,255,255,.25); border-radius:2px; margin-top:12px }
  .pbar div { height:100%; width:0%; background:#fff; border-radius:2px; transition:width .3s }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:16px; margin-bottom:14px }
  canvas { width:100%; height:150px; display:block }
  table { width:100%; border-collapse:collapse; font-size:13px }
  td { padding:6px 8px; border-top:1px solid var(--line); color:var(--dim) }
  td.v { color:var(--text); text-align:right; font-variant-numeric:tabular-nums }
</style></head><body><div class="wrap">
<div class="controls">
  DURATION <select id="dur"><option value="10">10 s</option><option value="20" selected>20 s</option><option value="40">40 s</option></select>
  STREAMS <select id="streams"><option>1</option><option selected>4</option><option>8</option></select>
</div>
<div class="stcard">
  <div class="sthead"><div class="wordmark">HEA<span class="o">R</span>TH</div>
    <div class="stlabel">&#9889; YOUR HOME NETWORK</div></div>
  <div class="main">
    <div class="gaugebox"><svg id="gauge" viewBox="0 0 400 400"></svg><button id="gofab">GO</button></div>
    <div class="tiles">
      <div class="tile" id="Tping"><div class="k">&#10227; PING</div><div class="v" id="tping">&ndash;</div><div class="u">ms</div></div>
      <div class="tile" id="Tdl"><div class="k">&#8595; DOWNLOAD</div><div class="v" id="tdl">&ndash;</div><div class="u">Mbps</div></div>
      <div class="tile" id="Tjit"><div class="k">&#8767; JITTER</div><div class="v" id="tjit">&ndash;</div><div class="u">ms</div></div>
      <div class="tile" id="Tul"><div class="k">&#8593; UPLOAD</div><div class="v" id="tul">&ndash;</div><div class="u">Mbps</div></div>
    </div>
  </div>
  <div class="stfoot">
    <div class="who"><b id="legname">Hearth direct</b><span id="path">measuring&hellip;</span></div>
    <div class="loc">Hearth<small id="netname">home network</small></div>
  </div>
  <div class="pbar"><div id="prog"></div></div>
</div>
<div class="card"><canvas id="chart" width="1600" height="300"></canvas></div>
<div class="card"><table id="results"><tr><td colspan="2">No runs yet.</td></tr></table></div>
<div class="card compare">
  <b>Comparing against the internet</b>
  <p>The test above measures <em>this device to the Hearth box</em>, so it is
     your wifi and your access point. To measure the connection itself, run a
     public test and compare. If the public number is higher than the one
     above, your wifi is the limit rather than your internet.</p>
  <div class="cmp">
    <a href="https://www.speedtest.net" target="_blank" rel="noopener noreferrer">Speedtest.net</a>
    <a href="https://fast.com" target="_blank" rel="noopener noreferrer">Fast.com</a>
    <a href="https://speed.cloudflare.com" target="_blank" rel="noopener noreferrer">Cloudflare</a>
  </div>
  <p class="tiny">These are outside services, so they see your household's public
     address, as any website does. Hearth sends them nothing.</p>
</div>
</div><script>
"use strict";
const $ = function(id){ return document.getElementById(id); };
const fmt = function(n){ return n >= 1000 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2); };

// ---- Chorus-style gauge ---------------------------------------------
const TICKS = [0, 10, 50, 100, 200, 500, 750, 1000, 2000];
const LABELS = ["0","10","50","100","200","500","750","1g","2g"];
const A0 = -135, A1 = 135, CX = 200, CY = 200;
const DISC_R = 150, RING_R = 170;
function pt(deg, r){ const a = deg*Math.PI/180;
  return [CX + r*Math.sin(a), CY - r*Math.cos(a)]; }
function valToAngle(v){
  v = Math.max(0, Math.min(v, TICKS[TICKS.length-1]));
  let i = 0; while (i < TICKS.length-2 && v > TICKS[i+1]) i++;
  const f = (v - TICKS[i]) / (TICKS[i+1] - TICKS[i] || 1);
  return A0 + (A1 - A0) * ((i + f) / (TICKS.length - 1));
}
function arcPath(a0, a1, r){
  const p0 = pt(a0, r), p1 = pt(a1, r), large = (a1 - a0) > 180 ? 1 : 0;
  return "M " + p0[0].toFixed(1) + " " + p0[1].toFixed(1) +
    " A " + r + " " + r + " 0 " + large + " 1 " + p1[0].toFixed(1) + " " + p1[1].toFixed(1);
}
function buildGauge(){
  let h = '<defs><linearGradient id="ng" x1="0" y1="1" x2="0" y2="0">' +
    '<stop offset="0" stop-color="#20242e"/><stop offset="1" stop-color="#9aa2ae"/></linearGradient>' +
    '<filter id="ds" x="-30%" y="-30%" width="160%" height="160%">' +
    '<feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#00203a" flood-opacity="0.35"/></filter></defs>';
  h += '<path d="' + arcPath(A0, A1, RING_R) + '" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="26"/>';
  h += '<path id="garc" d="" fill="none" stroke="#3fc1f0" stroke-width="26"/>';
  h += '<circle cx="200" cy="200" r="' + DISC_R + '" fill="#ffffff" filter="url(#ds)"/>';
  for (let i = 0; i < LABELS.length; i++){
    const a = A0 + (A1 - A0) * i / (LABELS.length - 1);
    const l = pt(a, DISC_R - 34);
    const big = i > 0 && i < LABELS.length - 1;
    h += '<text x="' + l[0].toFixed(1) + '" y="' + (l[1] + 6).toFixed(1) + '" text-anchor="middle" font-size="' +
      (big ? 19 : 16) + '" font-weight="600" fill="' + (i >= LABELS.length - 2 ? "#b8bcc6" : "#3c4152") + '">' + LABELS[i] + '</text>';
  }
  h += '<g id="needle" transform="rotate(' + A0 + ' 200 200)">' +
       '<polygon points="193,202 207,202 202,96 198,96" fill="url(#ng)"/></g>';
  h += '<circle cx="200" cy="200" r="7" fill="#2b2f3a"/>';
  h += '<text id="gval" x="200" y="262" text-anchor="middle" font-size="54" font-weight="700" fill="#2b2b36">0</text>';
  h += '<text x="200" y="290" text-anchor="middle" font-size="16" fill="#8a8f9d">Mbps</text>';
  h += '<text id="gphase" x="200" y="318" text-anchor="middle" font-size="12" letter-spacing="3" fill="#9aa0ad"></text>';
  $("gauge").innerHTML = h;
}
buildGauge();
let target = 0, shown = 0, needleA = A0;
function setGauge(v, phaseLabel){
  target = v;
  if (phaseLabel !== undefined) $("gphase").textContent = phaseLabel;
}
(function raf(){
  shown += (target - shown) * 0.12;
  needleA += (valToAngle(shown) - needleA) * 0.14;
  $("needle").setAttribute("transform", "rotate(" + needleA.toFixed(2) + " 200 200)");
  $("garc").setAttribute("d", arcPath(A0, Math.max(A0 + 0.4, Math.min(needleA, A1)), RING_R));
  $("gval").textContent = shown < 0.5 && target === 0 ? "0" : fmt(shown);
  requestAnimationFrame(raf);
})();
function activeTile(id){
  ["Tping","Tjit","Tdl","Tul"].forEach(function(t){ $(t).classList.toggle("active", t === id); });
}
function setProg(p){ $("prog").style.width = Math.min(100, p*100).toFixed(1) + "%"; }

// ---- Chart -----------------------------------------------------------
let samples = [];
function draw(){
  const c = $("chart"), g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  // Rolling mean over a short window. Upload bytes arrive in whole 8 MB POSTs,
  // so the raw series is a sawtooth that describes the sampling rather than the
  // network. Smooth per phase so the two halves stay independent.
  const SM = 5;
  const smoothed = samples.map(function(s, i){
    var sum = 0, n = 0;
    for (var j = Math.max(0, i - SM + 1); j <= i; j++){
      if (samples[j].p !== s.p) continue;
      sum += samples[j].v; n++;
    }
    return { p: s.p, v: n ? sum / n : s.v, x: s.x };
  });
  const max = Math.max(1, ...smoothed.map(function(s){ return s.v; })) * 1.15;
  g.strokeStyle = "rgba(255,255,255,.06)"; g.lineWidth = 1;
  for (let i = 1; i <= 3; i++){ const y = c.height * i / 4;
    g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  g.strokeStyle = "rgba(255,255,255,.12)";
  g.beginPath(); g.moveTo(c.width/2, 0); g.lineTo(c.width/2, c.height); g.stroke();
  const halves = [["dl", "#fbbf24"], ["ul", "#4ade80"]];
  for (let hI = 0; hI < 2; hI++){
    const key = halves[hI][0], col = halves[hI][1];
    const pts = samples.filter(function(s){ return s.p === key; });
    if (!pts.length) continue;
    const grad = g.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, col + "55"); grad.addColorStop(1, col + "05");
    g.beginPath();
    pts.forEach(function(s, i){ const x = s.x * c.width, y = c.height - 6 - (s.v/max) * (c.height - 20);
      i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.lineWidth = 3; g.strokeStyle = col; g.stroke();
    const first = pts[0], last = pts[pts.length-1];
    g.lineTo(last.x * c.width, c.height); g.lineTo(first.x * c.width, c.height);
    g.closePath(); g.fillStyle = grad; g.fill();
  }
  // The canvas is 1600 wide and gets scaled down hard on a phone, so labels
  // set in absolute pixels came out cramped and hard to read. Size them
  // relative to the canvas and give them a little air.
  const LBL = Math.round(c.height * 0.105);
  g.font = "600 " + LBL + "px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,.55)";
  g.fillText(fmt(max) + " Mbps", 16, LBL + 10);
  g.fillStyle = "#fbbf24"; g.fillText("download", 16, c.height - 14);
  g.fillStyle = "#4ade80"; g.fillText("upload", c.width/2 + 16, c.height - 14);
}

// ---- Test engine -----------------------------------------------------
async function pingTest(n){
  n = n || 15; const times = [];
  for (let i = 0; i < n; i++){ const t = performance.now();
    await fetch("/ping?x=" + i, { cache: "no-store" }); times.push(performance.now() - t); }
  times.sort(function(a,b){ return a-b; });
  const med = times[Math.floor(n/2)];
  let jit = 0; for (let i = 0; i < n-1; i++) jit += Math.abs(times[i+1] - times[i]);
  return { med: med, jitter: jit / (n-1) };
}
async function throughput(phase, seconds, streams, onRate){
  const ctl = new AbortController();
  let bytes = 0; const t0 = performance.now(); const jobs = [];
  if (phase === "dl"){
    for (let s = 0; s < streams; s++) jobs.push((async function(){
      const r = await fetch("/download?s=" + s + "&t=" + Date.now(), { signal: ctl.signal, cache: "no-store" });
      const rd = r.body.getReader();
      for (;;){ const c = await rd.read(); if (c.done) break; bytes += c.value.length; }
    })().catch(function(){}));
  } else {
    const mb4 = new Uint8Array(4*1024*1024);
    for (let o = 0; o < mb4.length; o += 65536) crypto.getRandomValues(mb4.subarray(o, o + 65536));
    const blob = new Blob([mb4, mb4]); // 8 MB
    // Count bytes on POST completion (server-confirmed); progress events
    // only report socket-buffer fill on fast links. Streams finish their
    // in-flight post after time is up so the average counts every byte.
    for (let s = 0; s < streams; s++) jobs.push((async function(){
      while (!ctl.signal.aborted){
        await fetch("/upload", { method: "POST", body: blob, cache: "no-store" });
        bytes += blob.size;
      }
    })().catch(function(){}));
  }
  let last = { t: t0, b: 0 }, ema = 0;
  const tick = setInterval(function(){
    const now = performance.now(), db = bytes - last.b, dt = (now - last.t)/1000;
    const elapsed = (now - t0)/1000;
    if (dt > 0){
      if (phase === "ul"){
        // Upload bytes only arrive when a whole 8 MB POST finishes, so an
        // instantaneous rate swings between nothing and a spike. Show the
        // cumulative average instead: smooth by construction, and it settles
        // on exactly the number the test reports at the end.
        if (elapsed > 0.4 && bytes > 0) onRate(bytes*8/elapsed/1e6, elapsed/seconds);
        else onRate(0, elapsed/seconds);
      } else {
        const r = db*8/dt/1e6;
        ema = ema ? ema*0.7 + r*0.3 : r;   // steadier than 0.55/0.45
        onRate(ema, elapsed/seconds);
      }
    }
    last = { t: now, b: bytes };
    if (now - t0 >= seconds*1000) ctl.abort();
  }, 250);
  await new Promise(function(res){ ctl.signal.addEventListener("abort", res);
    setTimeout(res, seconds*1000 + 4000); });
  clearInterval(tick);
  await Promise.allSettled(jobs);
  const elapsed = phase === "ul"
    ? (performance.now() - t0)/1000
    : Math.min((performance.now() - t0)/1000, seconds);
  return bytes*8/elapsed/1e6;
}

// ---- Orchestration ---------------------------------------------------
async function internetLeg(){
  // Ask the Hearth box what IT gets to the internet, so the page can say
  // which leg is actually the limit rather than leaving a parent guessing.
  try {
    const r = await fetch("/internet", { cache: "no-store" });
    const d = await r.json();
    return (d && typeof d.mbps === "number") ? d.mbps : null;
  } catch (e) { return null; }
}

function verdict(localMbps, netMbps){
  if (netMbps == null) return "Could not reach the internet from the Hearth box to compare.";
  const gap = localMbps / netMbps;
  if (localMbps < netMbps * 0.75)
    return "Your wifi to the box is the limit here (" + fmt(localMbps) + " vs " + fmt(netMbps) + " Mbps available). Moving closer to the access point, or a better one, would help.";
  if (gap > 0.9)
    return "You are getting nearly all of your connection (" + fmt(netMbps) + " Mbps). Hearth is not costing you speed.";
  return "Close to your connection speed (" + fmt(netMbps) + " Mbps available). Nothing obviously wrong.";
}

async function run(){
  $("gofab").classList.add("hidden");
  samples = []; draw(); setProg(0);
  const dur = +$("dur").value, streams = +$("streams").value;
  try {
    setGauge(0, "PING"); activeTile("Tping");
    const p = await pingTest();
    $("tping").textContent = fmt(p.med); $("tjit").textContent = fmt(p.jitter);
    setProg(0.1);
    setGauge(0, "DOWNLOAD"); activeTile("Tdl");
    const dl = await throughput("dl", dur, streams, function(v, x){
      setGauge(v); $("tdl").textContent = fmt(v);
      setProg(0.1 + 0.45*Math.min(1,x));
      samples.push({ p: "dl", v: v, x: x/2 }); draw(); });
    $("tdl").textContent = fmt(dl);
    setGauge(0, "UPLOAD"); activeTile("Tul");
    const ul = await throughput("ul", dur, streams, function(v, x){
      setGauge(v); $("tul").textContent = fmt(v);
      setProg(0.55 + 0.45*Math.min(1,x));
      samples.push({ p: "ul", v: v, x: 0.5 + x/2 }); draw(); });
    $("tul").textContent = fmt(ul);
    setGauge(0, "DONE"); activeTile(""); setProg(1);
    const row = document.createElement("tr");
    row.innerHTML = "<td>" + new Date().toLocaleTimeString() + " · " + dur + "s × " + streams + "</td>" +
      "<td class=v>ping " + fmt(p.med) + " ms · ↓ " + fmt(dl) + " · ↑ " + fmt(ul) + " Mbps</td>";
    const tbl = $("results");
    if (tbl.rows[0] && tbl.rows[0].cells.length === 1) tbl.deleteRow(0);
    tbl.insertBefore(row, tbl.rows[0] || null);
  } catch(e){ setGauge(0, "FAILED"); activeTile(""); }
  const b = $("gofab"); b.textContent = "AGAIN"; b.style.fontSize = "20px"; b.classList.remove("hidden");
}
$("gofab").onclick = run;
fetch("/info").then(function(r){ return r.json(); }).then(function(i){
  $("path").innerHTML = "you " + i.clientIp + " → " + i.serverHost + " (" + i.serverIp + ") " +
    "this device to the Hearth box, nothing in between";
});
</script></body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(PAGE);
  }
  if (url.pathname === "/ping") {
    res.writeHead(204, { "cache-control": "no-store" });
    return res.end();
  }
  if (url.pathname === "/info") {
    const clientIp = req.socket.remoteAddress?.replace(/^::ffff:/, "") || "?";
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify({
      serverHost: hostname(), serverIp: BIND, clientIp,
      direct: clientIp.startsWith("100.") || clientIp.startsWith("fd7a:"),
    }));
  }
  // The gateway measures its own throughput to the internet and reports it.
  // This is the second leg: it tells a parent whether the limit is their
  // connection rather than their wifi or this box.
  if (url.pathname === "/internet") {
    const started = Date.now();
    let bytes = 0;
    const finish = (err) => {
      const secs = (Date.now() - started) / 1000;
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({
        mbps: secs > 0.2 && bytes > 0 ? +(bytes * 8 / secs / 1e6).toFixed(1) : null,
        bytes, seconds: +secs.toFixed(2),
        error: err ? String(err.message || err) : null,
      }));
    };
    import("node:https").then(({ default: https }) => {
      const rq = https.get(UPSTREAM, { timeout: 20000 }, (up) => {
        up.on("data", (c) => { bytes += c.length; });
        up.on("end", () => finish(null));
        up.on("error", finish);
      });
      rq.on("timeout", () => { rq.destroy(); finish(null); });
      rq.on("error", finish);
    }).catch(finish);
    return;
  }

  if (req.method === "GET" && url.pathname === "/download") {
    res.writeHead(200, { "content-type": "application/octet-stream", "cache-control": "no-store" });
    const pump = () => { let ok = true; while (ok && !res.destroyed) ok = res.write(CHUNK); };
    res.on("drain", pump);
    req.on("close", () => res.destroy());
    return pump();
  }
  if (req.method === "POST" && url.pathname === "/upload") {
    let bytes = 0;
    req.on("data", (c) => { bytes += c.length; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ bytes }));
    });
    req.on("error", () => res.destroy());
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, BIND, () => console.log(`speedtest on http://${BIND}:${PORT}`));
