// Hearth dashboard: the pages.
//
// Design brief: mobile-first (this is driven from a phone), warm and calm,
// dusk and ember. Summary before detail, state readable at a glance. It is an
// operations dashboard and a conversation aid, not a surveillance console, so
// the language is plain, the numbers are honest about what the network can and
// cannot see, and nothing is framed as an accusation.
//
// Three views, because a long scroll on a phone is not "at a glance":
//   /          Tonight  - the controls and the state right now
//   /trends    Trends   - the charts, per kid, over 7 or 30 days
//   /devices   Devices  - the roster and the naming queue
//
// All existing controls behave exactly as before: the same kidnet commands, the
// same /api/act, /api/assign, /api/claim calls, the same DASH_TOKEN cookie.

import { SERIES, METERED, fmt } from "./analytics.mjs";
import { columns, legend, ranked, sparkline, meter, table, esc } from "./charts.mjs";

// ---------------------------------------------------------------------------
// Style. One block, no external anything.
// ---------------------------------------------------------------------------
const CSS = `
:root{
  color-scheme:light;
  --plane:#f6f1ea; --surface:#fdfbf8; --surface-2:#f1ebe2; --raise:#ffffff;
  --ink:#191320; --ink-2:#554d5e; --ink-muted:#6f6779;
  --grid:#e7ded4; --axis:#cfc4b8; --line:rgba(25,19,32,.11);
  --ember:#b1400b; --ember-soft:rgba(226,124,72,.14);
  --ok:#0ca30c; --warn:#fab219; --serious:#ec835a; --crit:#d03b3b;
  --s-gaming:#2a78d6; --s-video:#eb6834; --s-social:#1baf7a;
  --s-earned:#eda100; --s-other:#898781;
}
@media (prefers-color-scheme:dark){
  :root:where(:not([data-theme=light])){
    color-scheme:dark;
    --plane:#100d18; --surface:#1d1926; --surface-2:#262032; --raise:#2c2539;
    --ink:#f7f2ea; --ink-2:#c8c0d2; --ink-muted:#9c93ab;
    --grid:#2b2437; --axis:#3b3349; --line:rgba(255,255,255,.10);
    --ember:#f0824a; --ember-soft:rgba(240,130,74,.15);
    --s-gaming:#3987e5; --s-video:#d95926; --s-social:#199e70;
    --s-earned:#c98500; --s-other:#898781;
  }
}
:root[data-theme=dark]{
  color-scheme:dark;
  --plane:#100d18; --surface:#1d1926; --surface-2:#262032; --raise:#2c2539;
  --ink:#f7f2ea; --ink-2:#c8c0d2; --ink-muted:#9c93ab;
  --grid:#2b2437; --axis:#3b3349; --line:rgba(255,255,255,.10);
  --ember:#f0824a; --ember-soft:rgba(240,130,74,.15);
  --s-gaming:#3987e5; --s-video:#d95926; --s-social:#199e70;
  --s-earned:#c98500; --s-other:#898781;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--plane);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.45;
  padding:14px 14px 60px;max-width:900px;margin:0 auto;-webkit-text-size-adjust:100%}
a{color:inherit}

/* ---- header + nav ---- */
.top{display:flex;align-items:center;gap:10px;margin:4px 0 12px}
.brand{display:flex;align-items:baseline;gap:9px;flex:1;min-width:0}
.brand b{font-size:21px;letter-spacing:-.01em}
.porch{width:9px;height:9px;border-radius:50%;background:var(--ember);
  box-shadow:0 0 0 4px var(--ember-soft);flex:none;align-self:center}
.brand span{color:var(--ink-muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tbtn{background:var(--surface);border:1px solid var(--line);color:var(--ink-2);
  border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer;flex:none}
nav{display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;scrollbar-width:none}
nav::-webkit-scrollbar{display:none}
nav a{flex:none;text-decoration:none;padding:8px 14px;border-radius:999px;font-size:13px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2);font-weight:500}
nav a.sel{background:var(--ink);color:var(--plane);border-color:var(--ink)}
.msg{font-size:12px;color:var(--ink-muted);min-height:16px;margin:-8px 0 10px;font-variant-numeric:tabular-nums}

/* ---- cards ---- */
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;
  padding:15px;margin-bottom:12px}
.card.flat{background:transparent;border:0;padding:0}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-muted);
  margin:0 0 10px;font-weight:600}
h3{font-size:16px;margin:0 0 2px;font-weight:600}
.sub{color:var(--ink-muted);font-size:12.5px;margin:0 0 12px}

/* ---- hero + stat tiles ---- */
.hero{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap}
.hero .fig{font-size:48px;line-height:1;font-weight:600;letter-spacing:-.02em}
.hero .cap{color:var(--ink-2);font-size:13px;padding-bottom:6px;flex:1;min-width:150px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:9px}
.tile{background:var(--surface-2);border-radius:12px;padding:11px 12px}
.tile .lab{font-size:11.5px;color:var(--ink-muted);display:block;margin-bottom:2px}
.tile .val{font-size:21px;font-weight:600;letter-spacing:-.01em}
.tile .dlt{font-size:11.5px;color:var(--ink-muted);display:block;margin-top:1px}
.tile .spark{display:block;margin-top:4px}
.up{color:var(--ok)}.down{color:var(--crit)}

/* ---- kid card ---- */
.kid{background:var(--surface);border:1px solid var(--line);border-radius:16px;
  padding:15px;margin-bottom:12px}
.kh{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-bottom:10px}
.kh h3{flex:1;min-width:100px}
.tag{color:var(--ink-muted);font-size:12px;font-weight:400}
.pill{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--line);
  color:var(--ink-2);background:var(--surface-2);white-space:nowrap}
.pill.study{background:var(--ember-soft);border-color:transparent;color:var(--ember);font-weight:600}
.pill.out{background:rgba(208,59,59,.13);border-color:transparent;color:var(--crit);font-weight:600}

/* ---- chips (unchanged behaviour) ---- */
.chips{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}
.chip{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);
  border-radius:999px;padding:9px 13px;font-size:13px;cursor:pointer;
  background:var(--surface-2);color:var(--ink);font-family:inherit}
.chip:active{transform:translateY(1px)}
.chip .dot{width:9px;height:9px;border-radius:50%;flex:none}
.chip.on .dot{background:var(--ok)}
.chip.off .dot{background:var(--crit)}
.chip.off{border-color:rgba(208,59,59,.45)}
.chip.mode.active{background:var(--ember-soft);border-color:transparent;color:var(--ember);font-weight:600}

/* ---- time bar + meters ---- */
.tbar{height:8px;background:var(--surface-2);border-radius:999px;overflow:hidden;margin-top:10px}
.tbar.spent{background:rgba(208,59,59,.22)}
.tfill{height:100%;background:var(--ok);border-radius:999px}
.tfill.near{background:var(--warn)}.tfill.over{background:var(--crit)}
.tmeta{font-size:12.5px;color:var(--ink-2);margin-top:7px;display:flex;
  justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center}
.mini{background:var(--surface-2);border:0;color:var(--ink);border-radius:999px;
  padding:5px 11px;font-size:12px;cursor:pointer;margin-left:5px;font-family:inherit}
.mini:hover{background:var(--raise)}
.mrow{display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));gap:10px 14px;margin-top:12px}
.mhead{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);margin-top:13px}
.mcell .mlab{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-2);gap:8px}
.mcell .mlab b{font-weight:600;font-variant-numeric:tabular-nums}
.meter{margin-top:5px}
.mtrack{height:8px;border-radius:999px;background:color-mix(in oklab,var(--mc) 18%,var(--surface-2));overflow:hidden}
.mfill{height:100%;background:var(--mc);border-radius:999px}
.meter.near .mfill{background:var(--warn)}
.meter.over .mfill{background:var(--crit)}

/* ---- buttons ---- */
.big{width:100%;border:0;border-radius:12px;padding:14px;font-size:15px;font-weight:600;
  cursor:pointer;font-family:inherit}
.big.stop{background:var(--crit);color:#fff}
.big.go{background:var(--ok);color:#fff;margin-top:8px}
.approve{background:var(--ok);border:0;color:#fff;border-radius:8px;padding:7px 12px;
  font-size:12.5px;cursor:pointer;font-family:inherit}
.decline{background:var(--surface-2);border:1px solid var(--line);color:var(--ink-2);
  border-radius:8px;padding:7px 12px;font-size:12.5px;cursor:pointer;margin-left:5px;font-family:inherit}

/* ---- rows and lists ---- */
.row{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;padding:8px 0;
  border-top:1px solid var(--line);align-items:center;flex-wrap:wrap}
.row:first-of-type{border-top:0}
.row .r{color:var(--ink-muted);font-size:12.5px;text-align:right}
code{font-size:11.5px;color:var(--ink-muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.dot-on{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:4px}
.empty{color:var(--ink-muted);font-size:13px;padding:6px 0}
.drow{display:block}
.dname{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.dmeta{margin-top:2px}
.alert{font-size:13.5px;padding:7px 0;border-top:1px solid var(--line);display:flex;gap:8px}
.alert:first-of-type{border-top:0}
.alert .sev{flex:none;font-weight:600}
.alert.urgent .sev{color:var(--crit)}
.alert.warn .sev{color:var(--serious)}
.alert.info .sev{color:var(--ink-muted)}

/* ---- charts ---- */
.figure{margin:6px 0 2px}
.ftitle{font-size:13.5px;font-weight:600;margin:14px 0 1px}
.fsub{font-size:12px;color:var(--ink-muted);margin:0 0 8px}
.chart{display:block;overflow:visible;touch-action:pan-y}
.chart .grid{stroke:var(--grid);stroke-width:1}
.chart .axis{stroke:var(--axis);stroke-width:1}
.chart .tick{fill:var(--ink-muted);font-size:9.5px;font-variant-numeric:tabular-nums}
.chart .ticks{transform:translateX(2px)}
.chart .xlab{fill:var(--ink-muted);font-size:10px;text-anchor:middle}
.chart .dval{fill:var(--ink-2);font-size:10px;text-anchor:middle;font-weight:600}
.chart .seg{width:var(--bw);x:calc(var(--cx) - var(--bw)/2)}
.chart .hit{fill:transparent;width:var(--slot);x:calc(var(--cx) - var(--slot)/2)}
.chart .col{cursor:default}
.chart .col:hover .seg,.chart .col:focus-visible .seg{filter:brightness(1.12)}
.chart .col:focus{outline:none}
.chart .col:focus-visible .hit{fill:var(--ember-soft)}
.chart .rlab{fill:var(--ink);font-size:12.5px}
.chart .rval{fill:var(--ink-2);font-size:12px;text-anchor:end;font-variant-numeric:tabular-nums}
.chart .rtrack{fill:var(--surface-2)}
.chart .rrow:focus{outline:none}
.chart .rrow:focus-visible .rtrack{fill:var(--ember-soft)}
.legend{list-style:none;display:flex;gap:12px;flex-wrap:wrap;margin:8px 0 0;padding:0;
  font-size:12px;color:var(--ink-2)}
.legend li{display:flex;align-items:center;gap:6px}
.swatch{width:10px;height:10px;border-radius:3px;flex:none}
.cnote{font-size:11.5px;color:var(--ink-muted);margin:7px 0 0}

/* ---- table twin ---- */
.tview{margin-top:8px}
.tview summary{font-size:12px;color:var(--ink-muted);cursor:pointer;padding:3px 0}
.tscroll{overflow-x:auto;margin-top:6px}
.tview table{border-collapse:collapse;width:100%;font-size:12.5px}
.tview th,.tview td{text-align:left;padding:5px 9px 5px 0;border-bottom:1px solid var(--line);white-space:nowrap}
.tview th{color:var(--ink-muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.tview .num{text-align:right;font-variant-numeric:tabular-nums}

/* ---- filter row ---- */
.filters{display:flex;gap:7px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.filters .lab{font-size:12px;color:var(--ink-muted);margin-right:2px}
.filters a{text-decoration:none;font-size:12.5px;padding:6px 12px;border-radius:999px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2)}
.filters a.sel{background:var(--ink);color:var(--plane);border-color:var(--ink);font-weight:600}

/* ---- forms ---- */
input,select{background:var(--surface-2);color:var(--ink);border:1px solid var(--line);
  border-radius:8px;padding:7px 9px;font-size:13px;font-family:inherit;max-width:100%}
.assign{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.assign input{width:132px}

/* ---- tooltip ---- */
#tip{position:fixed;z-index:40;pointer-events:none;opacity:0;transition:opacity .1s;
  background:var(--raise);color:var(--ink);border:1px solid var(--line);border-radius:10px;
  padding:8px 10px;font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.22);max-width:230px}
#tip.on{opacity:1}
#tip .th{font-size:11px;color:var(--ink-muted);margin-bottom:4px}
#tip .tr{display:flex;align-items:center;gap:7px;justify-content:space-between}
#tip .tk{width:12px;height:2px;border-radius:2px;flex:none}
#tip .tn{color:var(--ink-2);flex:1}
#tip .tv{font-weight:600;font-variant-numeric:tabular-nums}

.foot{color:var(--ink-muted);font-size:11.5px;margin-top:18px;line-height:1.6}
@media (max-width:460px){ .hero .fig{font-size:38px} body{padding:10px 10px 50px} .card,.kid{padding:13px} .brand span{display:none} }
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// ---------------------------------------------------------------------------
// The client script. Small on purpose: the page works without it, this only
// adds the tooltip layer, the theme toggle, and the existing control calls.
// ---------------------------------------------------------------------------
const JS = `
const DTOK=(document.cookie.match(/(?:^|; )dash=([^;]*)/)||[])[1]||'';
function H(){return DTOK?{'content-type':'application/json','x-dash-token':DTOK}:{'content-type':'application/json'};}
function say(t){var m=document.getElementById('msg');if(m)m.textContent=t;}
async function act(cmd,who,arg){say('working...');
  const r=await fetch('/api/act',{method:'POST',headers:H(),body:JSON.stringify({cmd,who,arg})});
  const j=await r.json();say((j.out||'done').trim());setTimeout(()=>location.reload(),600);}
async function assign(mac){const label=document.getElementById('lbl_'+mac).value||'device';
  const who=document.getElementById('who_'+mac).value;say('assigning...');
  const r=await fetch('/api/assign',{method:'POST',headers:H(),body:JSON.stringify({mac,who,label})});
  const j=await r.json();say((j.out||'done').trim());setTimeout(()=>location.reload(),700);}
async function claim(id,decision){say('working...');
  const r=await fetch('/api/claim',{method:'POST',headers:H(),body:JSON.stringify({id,decision})});
  const j=await r.json();say((j.out||'done').trim());setTimeout(()=>location.reload(),600);}

/* theme: follow the system unless the operator picks a side */
(function(){try{var t=localStorage.getItem('hearth-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();
function toggleTheme(){var d=document.documentElement;
  var cur=d.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  var next=cur==='dark'?'light':'dark';d.dataset.theme=next;
  try{localStorage.setItem('hearth-theme',next);}catch(e){}}

/* chart tooltips. Values are also on screen as direct labels and in the table
   view below every chart, so this only ever adds convenience. */
(function(){
  var tip=document.getElementById('tip');if(!tip)return;
  function show(el,x,y){
    var rows;try{rows=JSON.parse(el.getAttribute('data-tip')||'[]');}catch(e){return;}
    tip.textContent='';
    var h=document.createElement('div');h.className='th';
    h.textContent=el.getAttribute('data-head')||'';tip.appendChild(h);
    rows.forEach(function(r){
      var d=document.createElement('div');d.className='tr';
      var k=document.createElement('span');k.className='tk';
      if(r[2])k.style.background='var(--s-'+r[2]+')';else k.style.background='transparent';
      var n=document.createElement('span');n.className='tn';n.textContent=r[0];
      var v=document.createElement('span');v.className='tv';v.textContent=r[1];
      d.appendChild(k);d.appendChild(n);d.appendChild(v);tip.appendChild(d);
    });
    tip.classList.add('on');
    var w=tip.offsetWidth,hh=tip.offsetHeight;
    tip.style.left=Math.max(8,Math.min(innerWidth-w-8,x-w/2))+'px';
    tip.style.top=Math.max(8,y-hh-14)+'px';
  }
  function hide(){tip.classList.remove('on');}
  document.addEventListener('pointermove',function(e){
    var el=e.target.closest?e.target.closest('.col'):null;
    if(el)show(el,e.clientX,e.clientY);else hide();},{passive:true});
  document.addEventListener('pointerleave',hide);
  document.addEventListener('focusin',function(e){
    var el=e.target.closest?e.target.closest('.col'):null;
    if(!el)return hide();var b=el.getBoundingClientRect();
    show(el,b.left+b.width/2,b.top+b.height*0.35);});
  document.addEventListener('focusout',hide);
  addEventListener('scroll',hide,{passive:true});
})();
`;

// ---------------------------------------------------------------------------
export function shell({ tab, body, title = "Hearth" }) {
  const nav = [["/", "Tonight"], ["/trends", "Trends"], ["/devices", "Devices"]];
  return `<!doctype html><html lang="en-NZ"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<div class="top"><div class="brand"><span class="porch"></span><b>Hearth</b>
  <span>the house with the porch light on</span></div>
  <button class="tbtn" onclick="toggleTheme()" aria-label="Switch light or dark">Theme</button></div>
<nav>${nav.map(([h, l]) => `<a href="${h}"${tab === h ? ' class="sel" aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>
<div class="msg" id="msg" role="status" aria-live="polite"></div>
${body}
<div id="tip" role="tooltip" aria-hidden="true"></div>
<script>${JS}</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------
function kidState(k, cats) {
  const blocked = new Set(cats.filter(x => x.kid === k.name).map(x => x.category));
  const inetOff = blocked.has("internet");
  const gameOff = blocked.has("gaming");
  const mediaOff = blocked.has("video") || blocked.has("social");
  return { blocked, inetOff, gameOff, mediaOff, study: gameOff && mediaOff && !inetOff };
}

// The control chips. Same commands, same endpoint, same semantics as before:
// green when the thing is allowed, red when it is blocked, tap to toggle.
function chips(k, st) {
  const chip = (label, off, cmdOff, cmdOn) =>
    `<button class="chip ${off ? "off" : "on"}" onclick="act('${off ? cmdOn : cmdOff}','${esc(k.name)}')">
       <span class="dot"></span>${label}: <b>${off ? "OFF" : "ON"}</b></button>`;
  return `<div class="chips">
    ${chip("🌐 Internet", st.inetOff, "off", "on")}
    ${chip("🎮 Gaming", st.gameOff, "game off", "game on")}
    ${chip("📺 Media", st.mediaOff, "media off", "media on")}
    <button class="chip mode ${st.study ? "active" : ""}" onclick="act('${st.study ? "study off" : "study on"}','${esc(k.name)}')">
      📚 Study mode ${st.study ? "(on)" : ""}</button>
  </div>`;
}

function timeBar(k, times) {
  const t = (times || []).find(x => x.child_id === k.id) || {};
  const total = (t.budget_min || 0) + (t.bonus_min || 0);
  const rem = t.remaining_min ?? 0;
  const unlimited = (t.budget_min || 0) >= 999;
  const outOfTime = rem <= 0 && (t.used_min || 0) > 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (rem / total) * 100)) : 100;
  const cls = outOfTime ? "over" : pct < 25 ? "near" : "";
  const buttons = `<span><button class="mini" onclick="act('bonus','${esc(k.name)}','15')">+15 min</button>`
    + `<button class="mini" onclick="act('bonus','${esc(k.name)}','30')">+30 min</button>`
    + `<button class="mini" onclick="act('earn','${esc(k.name)}','Dishes')">🧽 dishes +30</button></span>`;
  if (unlimited) return `<div class="tmeta"><span>No daily limit (teen tier). Used ${esc(fmt.min(t.used_min || 0))} today.</span>${buttons}</div>`;
  return `<div class="tbar ${outOfTime ? "spent" : ""}"><div class="tfill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
    <div class="tmeta"><span>${outOfTime ? `<b style="color:var(--crit)">Out of time</b> · ` : ""}`
    + `${rem} of ${total} min left today</span>${buttons}</div>`;
}

// Per-category meters, so "how much gaming today" is answerable without a chart.
function catMeters(a) {
  if (!a) return "";
  const cells = METERED.map(c => {
    const used = a.today ? a.today[c] : 0;
    const lim = a.budgets[c] || 0;
    if (!used && !lim) return "";
    return `<div class="mcell"><div class="mlab"><span>${esc(SERIES[c].label)}</span>`
      + `<b>${esc(fmt.min(used))}${lim ? ` / ${esc(fmt.min(lim))}` : ""}</b></div>`
      + meter(used, lim, { key: c, label: SERIES[c].label }) + `</div>`;
  }).filter(Boolean).join("");
  return cells ? `<div class="mhead">Metered today</div><div class="mrow">${cells}</div>` : "";
}

// ---------------------------------------------------------------------------
// Tonight
// ---------------------------------------------------------------------------
export function tonight(s, a) {
  const kidsA = new Map((a?.kids || []).map(k => [k.id, k]));
  const householdToday = (s.times || []).reduce((x, t) => x + (t.used_min || 0), 0);
  const anyBlocked = s.cats.length;
  const newDevices = s.devices.filter(d => d.unassigned && d.category === "personal"
    && !["ap", "infra", "gateway"].includes(d.device_kind));
  const urgent = s.alerts.filter(x => x.severity === "urgent");

  const hero = `<div class="card"><div class="hero">
    <div class="fig">${esc(fmt.min(householdToday))}</div>
    <div class="cap">of screen time counted across the house today.
      ${anyBlocked ? `${anyBlocked} block${anyBlocked > 1 ? "s" : ""} in force.` : "Nothing is blocked right now."}
      ${s.claims.length ? `${s.claims.length} chore claim${s.claims.length > 1 ? "s" : ""} waiting on you.` : ""}</div>
  </div></div>`;

  const pause = `<div class="card">
    <button class="big stop" onclick="act('dinner','')">Dinner / family pause (all kids off)</button>
    <button class="big go" onclick="act('resume','')">Resume all</button></div>`;

  const claims = s.claims.length ? `<div class="card"><h2>🧺 Waiting for your OK (${s.claims.length})</h2>`
    + s.claims.map(c => `<div class="row"><span><b>${esc(c.kid)}</b> says: ${esc(c.task)} <code>+${c.minutes} min</code></span>
      <span><button class="approve" onclick="claim(${c.id},'approve')">Approve</button>
      <button class="decline" onclick="claim(${c.id},'decline')">No</button></span></div>`).join("")
    + `</div>` : "";

  const kids = s.children.map(k => {
    const st = kidState(k, s.cats);
    const an = kidsA.get(k.id);
    const t = (s.times || []).find(x => x.child_id === k.id) || {};
    const out = (t.remaining_min ?? 0) <= 0 && (t.used_min || 0) > 0;
    return `<div class="kid">
      <div class="kh"><h3>${esc(k.name)} <span class="tag">${k.age} · ${esc(k.policy_tier)}</span></h3>
        ${st.study ? '<span class="pill study">Study mode</span>' : ""}
        ${out ? '<span class="pill out">Out of time</span>' : ""}
        ${st.inetOff ? '<span class="pill">Internet off</span>' : ""}</div>
      ${chips(k, st)}
      ${timeBar(k, s.times)}
      ${catMeters(an)}
      ${an ? `<div class="tmeta"><span>Last 7 days: ${esc(fmt.min(an.totals.metered))} metered, `
      + `${esc(fmt.min(an.totals.earned))} earned</span>`
      + `<a class="mini" style="text-decoration:none" href="/trends#${esc(k.name.toLowerCase())}">See trends</a></div>` : ""}
    </div>`;
  }).join("");

  const newDev = newDevices.length ? `<div class="card"><h2>🆕 New devices to name (${newDevices.length})</h2>`
    + newDevices.slice(0, 6).map(d => deviceAssignRow(d, s.people)).join("")
    + (newDevices.length > 6 ? `<div class="row"><a href="/devices">See all ${newDevices.length}</a></div>` : "")
    + `</div>` : "";

  const alerts = `<div class="card"><h2>Alerts</h2>${s.alerts.length
    ? s.alerts.map(x => {
        // Always show WHEN. An alert with no time reads as "happening now",
        // which is alarming when the thing already fixed itself hours ago.
        const mins = x.ts ? Math.max(0, Math.round((Date.now() - new Date(x.ts)) / 60000)) : null;
        const ago = mins === null ? ""
          : mins < 1 ? "just now"
          : mins < 60 ? `${mins} min ago`
          : mins < 1440 ? `${Math.round(mins / 60)} h ago`
          : `${Math.round(mins / 1440)} d ago`;
        return `<div class="alert ${esc(x.severity)}"><span class="sev">${esc(x.severity)}</span>`
          + `<span>${esc([x.category, x.domain, x.detail].filter(Boolean).join(" · "))}</span>`
          + (ago ? `<span class="r">${esc(ago)}</span>` : "") + `</div>`;
      }).join("")
    : '<div class="empty">Nothing flagged. Safety flags are a prompt for a conversation, never a verdict.</div>'}</div>`;

  const recent = `<div class="card"><h2>Recent actions</h2>${s.events.length
    ? s.events.map(e => `<div class="row"><span>${esc(e.target_ref)} → ${esc(e.action)}</span>`
      + `<span class="r">${esc(e.source)} · ${esc(new Date(e.ts).toLocaleString("en-NZ"))}</span></div>`).join("")
    : '<div class="empty">Nothing yet.</div>'}</div>`;

  return (urgent.length ? `<div class="card" style="border-color:var(--crit)"><h2 style="color:var(--crit)">Worth a quiet word</h2>`
    + urgent.map(x => `<div class="alert urgent"><span class="sev">urgent</span><span>${esc([x.category, x.domain, x.detail].filter(Boolean).join(" · "))}</span></div>`).join("")
    + `</div>` : "")
    + hero + pause + claims + kids + newDev + alerts + recent;
}

function deviceAssignRow(d, people) {
  const key = esc(d.mac || "");
  return `<div class="row"><span><b>${esc(d.hostname || d.label || "(no name)")}</b> <code>${key}</code>
      ${d.vendor ? `<code>${esc(d.vendor)}</code>` : ""} ${d.online ? '<span class="dot-on"></span>online' : ""}</span>
    <span class="assign"><input id="lbl_${key}" placeholder="e.g. Ben phone" aria-label="Label for ${key}">
      <select id="who_${key}" aria-label="Owner for ${key}">${people.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")}</select>
      <button class="approve" onclick="assign('${key}')">Assign</button></span></div>`;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
export function devices(s) {
  const groups = [
    ["personal", "People's devices", "Phones, tablets, laptops and consoles. These are filtered and metered by their owner's tier."],
    ["iot", "Smart home", "Cameras, speakers, lights. Never assigned to a kid, never metered, and never cut by a family pause."],
    ["infra", "Infrastructure", "The access point and the gateway itself. Not a client."],
  ];
  const unassigned = s.devices.filter(d => d.unassigned && d.category === "personal"
    && !["ap", "infra", "gateway"].includes(d.device_kind));

  const naming = unassigned.length ? `<div class="card"><h2>🆕 New devices to name (${unassigned.length})</h2>
    <p class="sub">Who owns what is deliberately manual. Only you know whose device is whose.</p>
    ${unassigned.map(d => deviceAssignRow(d, s.people)).join("")}</div>` : "";

  const list = groups.map(([cat, title, note]) => {
    const rows = s.devices.filter(d => (d.category || "personal") === cat);
    if (!rows.length) return "";
    return `<div class="card"><h2>${esc(title)} (${rows.length})</h2><p class="sub">${esc(note)}</p>`
      + rows.map(d => `<div class="row drow">
          <div class="dname">${d.online ? '<span class="dot-on"></span>' : ""}<b>${esc(d.label || d.hostname || "(unnamed)")}</b>
            ${cat === "personal" ? `<span class="tag">${esc(d.person || "unassigned")}${d.person_kind === "guest" ? " (guest)" : ""}</span>` : ""}</div>
          <div class="dmeta"><code>${esc([d.device_kind, d.vendor, d.ip || "no reserved IP", d.mac].filter(Boolean).join(" · "))}</code></div>
        </div>`).join("")
      + `</div>`;
  }).join("");

  return naming + (list || '<div class="card"><div class="empty">No devices yet. They register as they join the kids network.</div></div>');
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------
export function trends(s, a) {
  const win = a.window;
  const ranges = [7, 30];
  const filters = `<div class="filters"><span class="lab">Range</span>`
    + ranges.map(r => `<a href="/trends?days=${r}"${r === win ? ' class="sel"' : ""}>Last ${r} days</a>`).join("")
    + `</div>`;

  const hMetered = a.kids.reduce((x, k) => x + k.totals.metered, 0);
  const hEarned = a.kids.reduce((x, k) => x + k.totals.earned, 0);
  const hGaming = a.kids.reduce((x, k) => x + k.totals.gaming, 0);
  const hVideo = a.kids.reduce((x, k) => x + k.totals.video, 0);
  // The headline is the metered total, not the earned-minus-metered balance.
  // Earning caps out at a few minutes a day by design, so a raw balance would
  // always be a large negative number and would say nothing useful.
  const hero = `<div class="card"><div class="hero">
    <div class="fig">${esc(fmt.min(hMetered))}</div>
    <div class="cap">on metered habits across the house over the last ${win} days:
      ${esc(fmt.min(hGaming))} gaming, ${esc(fmt.min(hVideo))} video.
      ${esc(fmt.min(hEarned))} was earned back through quizzes and chores.</div></div></div>`;

  const kids = a.kids.map(k => kidTrends(k, win)).join("");

  return filters + hero + kids + measurementCard(a);
}

// Trend without pretending: compare the second half of the window with the
// first half. It needs no data from outside the range the parent selected, and
// it does not compare a part-finished week against a whole one.
function trendHalves(days, win) {
  if (days.length < 4) return `<span class="tag">Not enough days yet to call a trend.</span>`;
  const half = Math.floor(days.length / 2);
  const sum = (rows, k) => rows.reduce((a, d) => a + d[k], 0);
  const older = days.slice(0, half), newer = days.slice(days.length - half);
  const dm = sum(newer, "metered") - sum(older, "metered");
  const de = sum(newer, "earned") - sum(older, "earned");
  const n = `the last ${half} days against the ${half} before`;
  const bits = [];
  bits.push(Math.abs(dm) < 10 ? "metered time is level"
    : dm < 0 ? `<span class="up">metered time down ${esc(fmt.min(-dm))}</span>`
      : `<span class="down">metered time up ${esc(fmt.min(dm))}</span>`);
  bits.push(Math.abs(de) < 10 ? "earning is level"
    : de > 0 ? `<span class="up">earning up ${esc(fmt.min(de))}</span>`
      : `<span class="down">earning down ${esc(fmt.min(-de))}</span>`);
  return `${bits.join(", ")} (${esc(n)}).`;
}

// A pill that says something a parent can act on: how often a metered category
// ran past its own daily budget in this window.
function budgetPill(k, win) {
  const budgeted = METERED.filter(c => k.budgets[c] > 0);
  if (!budgeted.length) return '<span class="pill">No category budgets set</span>';
  let over = 0;
  for (const d of k.days) if (budgeted.some(c => d[c] > k.budgets[c])) over++;
  if (!over) return '<span class="pill" style="color:var(--ok)">Inside every budget</span>';
  return `<span class="pill">Over a budget on ${over} of ${k.days.length} days</span>`;
}

function kidTrends(k, win) {
  const t = k.totals;
  const anchor = k.name.toLowerCase();

  // --- Chart 1: where the time went, per day -------------------------------
  const keys = ["gaming", "video", "social", "other"];
  const cols = k.days.map(d => ({
    label: fmt.dayFull(d.day),
    sub: win <= 10 ? fmt.dayShort(d.day) : fmt.dayNum(d.day),
    summary: fmt.min(d.online || d.metered),
    segs: keys.map(key => ({ key, value: d[key] })),
  }));
  const usedSeries = keys.filter(key => k.days.some(d => d[key] > 0));
  const nothingYet = t.online === 0 && t.metered === 0 && t.earned === 0 && t.learn === 0;
  const chart1 = `<p class="ftitle">Where the time went</p>
    <p class="fsub">Minutes per day. Gaming, video and social are counted by the meter; everything else online is the rest of the daily ledger.</p>
    <div class="figure">${columns({
      cols, series: keys.map(key => ({ key })), title: `${k.name}: minutes per day`,
    })}</div>
    ${nothingYet ? '<p class="empty">Nothing recorded for this window yet. Minutes appear once the meter has run and the devices are named on the Devices tab.</p>' : ""}
    ${legend(usedSeries.length > 1 ? usedSeries : [], { note: "Music, schoolwork and messaging are never metered, so they only ever show up in ‘other online’." })}
    ${table(["Day", "Gaming", "Video", "Social", "Other", "Total online"],
      k.days.map(d => [fmt.dayFull(d.day), d.gaming, d.video, d.social, d.other, d.online]))}`;

  // --- Chart 2: losing time against gaining time ---------------------------
  // A week is the right unit for this conversation, but a 7 day window only
  // ever spans one or two calendar weeks, and the current one is part-finished.
  // So: day by day on the short window, week by week on the long one.
  const byWeek = win > 14;
  const src = byWeek ? k.weeks : k.days;
  const wcols = src.map(w => ({
    label: byWeek ? `Week of ${fmt.dayFull(w.start)}` : fmt.dayFull(w.day),
    sub: byWeek ? fmt.dayNum(w.start) + "/" + w.start.slice(5, 7) : fmt.dayShort(w.day),
    summary: `${fmt.min(w.earned)} earned, ${fmt.min(w.metered)} metered`,
    segs: [
      { key: "earned", value: w.earned },
      { key: "gaming", value: w.gaming },
      { key: "video", value: w.video },
      { key: "social", value: w.social },
    ],
  }));
  const chart2 = `<p class="ftitle">Losing time, gaining time</p>
    <p class="fsub">Above the line: minutes earned through quizzes and approved chores. Below: minutes the meter counted against the habit budgets. Parent bonuses are excluded, because a gift is not something they earned. The two sides are not meant to match: earning is capped by design.</p>
    <div class="figure">${columns({
      cols: wcols, diverging: true, upSeries: ["earned"], downSeries: ["gaming", "video", "social"],
      title: `${k.name}: earned against metered, ${byWeek ? "per week" : "per day"}`,
    })}</div>
    ${legend(["earned", "gaming", "video", "social"])}
    <p class="cnote">${trendHalves(k.days, win)}</p>
    ${byWeek
      ? table(["Week starting", "Quizzes", "Chores", "Earned", "Metered", "Balance"],
        k.weeks.map(w => [fmt.dayFull(w.start), w.quiz, w.chore, w.earned, w.metered,
          (w.balance >= 0 ? "+" : "") + w.balance]))
      : table(["Day", "Quizzes", "Chores", "Earned", "Metered", "Balance"],
        k.days.map(d => [fmt.dayFull(d.day), d.quiz, d.chore, d.earned, d.metered,
          ((d.earned - d.metered) >= 0 ? "+" : "") + (d.earned - d.metered)]))}`;

  // --- Chart 3: services ----------------------------------------------------
  const svc = k.serviceList.slice(0, 10);
  const anyBytes = svc.some(x => x.bytes > 0);
  const rows = svc.map(x => ({
    label: x.service.label,
    emoji: x.service.emoji,
    key: METERED.includes(x.service.category) ? x.service.category : null,
    value: x.lookups,
    display: `${fmt.count(x.lookups)} lookups`,
    sub: [x.bytes ? fmt.bytes(x.bytes) : null, x.minutes ? fmt.min(x.minutes) : null]
      .filter(Boolean).join(" · "),
  }));
  const chart3 = `<p class="ftitle">Which services</p>
    <p class="fsub">DNS lookups per service over the last ${win} days. A lookup means the device asked for that service by name. It is a proxy for activity, <b>not</b> data volume and <b>not</b> minutes: HTTPS hides everything else.</p>
    ${rows.length ? `<div class="figure">${ranked(rows, { title: `${k.name}: service lookups` })}</div>`
      + legend([], { note: "Bars are coloured when the service falls in a metered category (gaming, video, social). Grey means we never count it against a budget: music, schoolwork, messaging." })
      + table(anyBytes ? ["Service", "Category", "Lookups", "Bytes", "Metered minutes"] : ["Service", "Category", "Lookups", "Blocked"],
        svc.map(x => anyBytes
          ? [x.service.label, x.service.category, x.lookups, fmt.bytes(x.bytes), x.minutes]
          : [x.service.label, x.service.category, x.lookups, x.blocked]))
      : '<div class="empty">No named service showed up in the DNS log for this window.</div>'}
    ${anyBytes ? '<p class="cnote">Bytes and metered minutes come from the firewall counters on the addresses those services resolved to, so they are measured, not estimated. Lookups and bytes answer different questions: do not add them together.</p>'
      : '<p class="cnote">No byte figures yet. They appear once the island is cabled and the per-service counters have run.</p>'}`;

  const domains = k.topDomains.length
    ? table(["Domain", "Lookups"], k.topDomains.map(d => [d.domain, d.n]),
      { summary: `What ${k.name} looked up most` })
    : "";

  return `<div class="kid" id="${esc(anchor)}">
    <div class="kh"><h3>${esc(k.name)} <span class="tag">${k.age} · ${esc(k.policy_tier)}</span></h3>
      ${budgetPill(k, win)}</div>
    <div class="tiles">
      <div class="tile"><span class="lab">Online, last ${win} days</span>
        <span class="val">${esc(fmt.min(t.online))}</span>
        <span class="dlt">${esc(fmt.min(Math.round(t.online / win)))} a day on average</span>
        ${sparkline(k.days.map(d => d.online))}</div>
      <div class="tile"><span class="lab">Metered habits</span>
        <span class="val">${esc(fmt.min(t.metered))}</span>
        <span class="dlt">gaming ${esc(fmt.min(t.gaming))} · video ${esc(fmt.min(t.video))}</span>
        ${sparkline(k.days.map(d => d.metered), { key: "video" })}</div>
      <div class="tile"><span class="lab">Earned by learning</span>
        <span class="val">${esc(fmt.min(t.earned))}</span>
        <span class="dlt">${t.quiz} min quizzes · ${k.choresApproved} chore${k.choresApproved === 1 ? "" : "s"} approved</span>
        ${sparkline(k.days.map(d => d.earned), { key: "earned" })}</div>
      <div class="tile"><span class="lab">Schoolwork lookups</span>
        <span class="val">${esc(fmt.count(t.learn))}</span>
        <span class="dlt">${t.blocked ? esc(fmt.count(t.blocked)) + " blocked requests" : "nothing blocked"}</span>
        ${sparkline(k.days.map(d => d.learn), { key: "social" })}</div>
    </div>
    ${chart1}${chart2}${chart3}${domains}
  </div>`;
}

// ---------------------------------------------------------------------------
// The honesty panel. A parent should be able to see, on the screen, what these
// numbers are and where each one stops being trustworthy.
// ---------------------------------------------------------------------------
function measurementCard(a) {
  const m = a.measurement;
  const pctUnattributed = m.dnsRows ? Math.round((m.dnsUnattributed / m.dnsRows) * 100) : 0;
  const lines = [
    ["Lookups are not bytes and not minutes.",
      "The gateway is the DNS server, so it sees which names a device asked for. HTTPS hides everything after that. A lookup count is a proxy for activity, nothing more."],
    ["Minutes come from the meter, not from DNS.",
      "A minute is counted when a device moves more than a small amount of traffic to a category's addresses in that minute, so a backgrounded app does not quietly rack up time. It is about right, not perfect."],
    ["Bytes, where shown, are measured.",
      "Byte figures come from nftables counters on the addresses a service resolved to. They are never derived from lookups."],
    ["Shorts and full YouTube cannot be told apart.",
      "They share domains, so both count as video. YouTube Music counts as video too."],
    ["A VPN makes all of this blind.",
      "It hides destination addresses, so categorisation and metering both fail. That is a conversation, not a chart."],
  ];
  if (pctUnattributed > 0) {
    lines.push([`${pctUnattributed}% of DNS lookups are not attributed to anyone.`,
      "Those came from a device that is not yet assigned to a person. Name it on the Devices tab and it starts counting."]);
  }
  if (!m.hasMeter) {
    lines.push(["No metered minutes recorded yet.",
      "The per-category meter fills in once the island is cabled and the metering timer has run. Until then the daily ledger is the only minutes figure."]);
  }
  return `<div class="card"><h2>How these numbers are measured</h2>
    ${lines.map(([h, b]) => `<div class="row" style="display:block"><b>${esc(h)}</b><br><span class="r" style="text-align:left;display:block">${esc(b)}</span></div>`).join("")}
    ${a.notes.length ? `<p class="cnote">Panels unavailable: ${esc(a.notes.join("; "))}</p>` : ""}
    <p class="foot">Days follow the gateway's clock. Hearth logs domains, never content: it is a family conversation aid, not a surveillance console.</p>
  </div>`;
}
