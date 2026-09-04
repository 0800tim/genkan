// Genkan dashboard: the pages.
import { wordmarkSVG, KANJI_SVG, LOGO_CSS } from "./logo.mjs";
//
// Design brief: mobile-first (this is driven from a phone), warm and calm,
// dusk and ember. Summary before detail, state readable at a glance. It is an
// operations dashboard and a conversation aid, not a surveillance console, so
// the language is plain, the numbers are honest about what the network can and
// cannot see, and nothing is framed as an accusation.
//
// Three views, because a long scroll on a phone is not "at a glance":
//   /          Home     - the controls and the state right now
//   /trends    Trends   - the charts, per kid, over 7 or 30 days
//   /devices   Devices  - the roster and the naming queue
//
// All existing controls behave exactly as before: the same kidnet commands, the
// same /api/act, /api/assign, /api/claim calls, the same DASH_TOKEN cookie.

import { SERIES, METERED, GOAL_METRICS, fmt } from "./analytics.mjs";
import { columns, legend, ranked, sparkline, meter, goalBar, table, esc } from "./charts.mjs";
import { LIVE_CSS, LIVE_JS, livePage, liveStrip } from "./liveui.mjs";
import { MANAGE_CSS, MANAGE_JS, family } from "./manage.mjs";
import { HOUSEHOLD_CSS, HOUSEHOLD_JS, housePanel, assignOptions, roleTag, isKid,
         SWEEPS, SWEEPABLE, TIERS } from "./household.mjs";
// The System page: the health of the box itself. Its own module, like the live
// wire and the manage area, so this file stays the shared shell plus the pages
// that read the household database.
import { SYS_CSS, SYS_JS, systemPage } from "./sysview.mjs";
// Scheduled bedtimes. The panel and its API live in their own file for the
// same reason the IoT policy does: the rules about who may lift a block are
// subtle and belong next to each other, not scattered through the page code.
import { SCHEDULE_CSS, SCHEDULE_JS, schedulePanel, bedtimeLine } from "./schedule.mjs";
import { KID_CSS, KID_JS, truthLine, chartsCard, changesCard, rewardsCard, aiCard, devicesCard, servicesCard } from "./kid-insights.mjs";
import { ANALYTICS_CSS, ANALYTICS_JS } from "./analytics-page.mjs";
import { SETTINGS_CSS, SETTINGS_JS } from "./settings.mjs";

// ---------------------------------------------------------------------------
// Style. One block, no external anything.
// ---------------------------------------------------------------------------
const CSS = `
:root{
  color-scheme:light;
  --plane:#f6f1ea; --surface:#fdfbf8; --surface-2:#f1ebe2; --raise:#ffffff;
  --ink:#191320; --ink-2:#554d5e; --ink-muted:#6f6779;
  --grid:#e7ded4; --axis:#cfc4b8; --line:rgba(25,19,32,.11);
  --ember:#b1400b; --ember-soft:rgba(226,124,72,.14); --on-ember:#fff;
  --ok:#0ca30c; --warn:#fab219; --serious:#ec835a; --crit:#d03b3b;
  --s-gaming:#2a78d6; --s-video:#eb6834; --s-social:#1baf7a;
  --s-earned:#eda100; --s-other:#898781; --s-download:#7a4fd0;
}
@media (prefers-color-scheme:dark){
  :root:where(:not([data-theme=light])){
    color-scheme:dark;
    --plane:#100d18; --surface:#1d1926; --surface-2:#262032; --raise:#2c2539;
    --ink:#f7f2ea; --ink-2:#c8c0d2; --ink-muted:#9c93ab;
    --grid:#2b2437; --axis:#3b3349; --line:rgba(255,255,255,.10);
    --ember:#f0824a; --ember-soft:rgba(240,130,74,.15); --on-ember:#231522;
    --s-gaming:#3987e5; --s-video:#d95926; --s-social:#199e70;
    --s-earned:#c98500; --s-other:#898781; --s-download:#9d7bec;
  }
}
:root[data-theme=dark]{
  color-scheme:dark;
  --plane:#100d18; --surface:#1d1926; --surface-2:#262032; --raise:#2c2539;
  --ink:#f7f2ea; --ink-2:#c8c0d2; --ink-muted:#9c93ab;
  --grid:#2b2437; --axis:#3b3349; --line:rgba(255,255,255,.10);
  --ember:#f0824a; --ember-soft:rgba(240,130,74,.15); --on-ember:#231522;
  --s-gaming:#3987e5; --s-video:#d95926; --s-social:#199e70;
  --s-earned:#c98500; --s-other:#898781; --s-download:#9d7bec;
}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--plane);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.45;
  padding:14px 14px 60px;max-width:900px;margin:0 auto;-webkit-text-size-adjust:100%}
a{color:inherit}

/* ---- header + nav ---- */
.top{display:flex;align-items:center;gap:10px;margin:4px 0 12px}
.brand{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.brand b{font-size:21px;letter-spacing:-.01em}
.porch{width:9px;height:9px;border-radius:50%;background:var(--ember);
  box-shadow:0 0 0 4px var(--ember-soft);flex:none;align-self:center}
.brand span{color:var(--ink-muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tbtn{background:var(--surface);border:1px solid var(--line);color:var(--ink-2);
  border-radius:999px;padding:6px 11px;font-size:12px;cursor:pointer;flex:none}
/* The menu wraps rather than scrolls: nothing is ever cut off. The everyday
   pages sit in the row; the rest live under More, which is a details element
   so it works with no script and closes on its own when focus leaves. */
nav{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px;align-items:center}
nav a,nav .more>summary{flex:none;text-decoration:none;padding:8px 14px;border-radius:999px;font-size:13px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2);font-weight:500;cursor:pointer;list-style:none;white-space:nowrap}
nav .more>summary::-webkit-details-marker{display:none}
nav a.sel,nav .more.sel>summary{background:var(--ink);color:var(--plane);border-color:var(--ink)}
nav .more{position:relative}
nav .more>summary::after{content:" \\25BE";font-size:11px;opacity:.7}
nav .more[open]>summary::after{content:" \\25B4"}
nav .more>div{position:absolute;top:calc(100% + 6px);left:0;z-index:30;display:flex;flex-direction:column;gap:4px;min-width:180px;
  padding:6px;border-radius:14px;border:1px solid var(--line);background:var(--surface);box-shadow:0 10px 30px rgba(0,0,0,.18)}
nav .more>div a{border:0;background:transparent;border-radius:10px;padding:8px 12px}
nav .more>div a:hover{background:color-mix(in oklab,var(--ink) 8%,transparent)}
nav .more>div a.sel{background:var(--ink);color:var(--plane)}
/* The theme button shows where a click takes you: a moon in the light, a sun in the dark. */
.tbtn .sun{display:none}.tbtn .moon{display:inline}
html[data-theme=dark] .tbtn .sun{display:inline}html[data-theme=dark] .tbtn .moon{display:none}
@media (prefers-color-scheme:dark){html:not([data-theme=light]) .tbtn .sun{display:inline}html:not([data-theme=light]) .tbtn .moon{display:none}}
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
.hero .cap{color:var(--ink-2);font-size:13px;padding-bottom:6px;flex:1;min-width:230px}
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
/* The slow lane: a third state between on and off. Amber, because it is
   neither a green light nor a red one. Nothing is cut, it is just a crawl. */
.chip.slow .dot{background:var(--warn)}
.chip.slow{border-color:rgba(250,178,25,.5)}
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
.alert{font-size:13.5px;padding:7px 0;border-top:1px solid var(--line);display:flex;gap:8px;
  flex-wrap:wrap;align-items:center}
.alert .mini{margin-left:auto}
.tag.warn{color:var(--warn,#c98a2b);border-color:currentColor}

/* The two sweep tick boxes under a device. They have to survive a 430px
   phone without turning the page into a wall of check boxes, so they wrap and
   each one carries its own hit area rather than sitting in a table. */
.dfoot{display:flex;gap:4px 16px;flex-wrap:wrap;align-items:center;margin-top:3px}
.dfoot code{flex:0 1 auto}
/* Push the ticks to the right so they line up down the list. Device names and
   addresses are all different lengths, and a ragged column of check boxes is
   the thing that makes a page like this hard to scan. */
.dsweep{display:inline-flex;gap:4px 14px;flex-wrap:wrap;align-items:center;margin-left:auto}
.dtier{margin-left:0}
.tick{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:var(--ink-2);
  cursor:pointer;line-height:1.3;min-height:30px}
.tick input{width:16px;height:16px;flex:none;accent-color:var(--ember);margin:0;cursor:pointer}
.tick .dflt{color:var(--ink-muted);font-size:11.5px}
.dtier{display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:var(--ink-2)}
.dtier select{font-family:inherit;font-size:12.5px;padding:2px 4px}
.gnote{font-size:12.5px;color:var(--ink-muted);margin:0 0 8px;line-height:1.5}
/* On a phone there is no room for a right-hand column, and pushing two check
   boxes to the far edge just puts them further from the name they belong to. */
@media (max-width:520px){.dfoot{gap:2px 12px}.tick{min-height:32px}.dsweep{margin-left:0}}

/* The owner picker that folds out under a device on the Devices page. */
.chg{padding:0 0 10px;border-bottom:1px solid var(--line)}
.chg[hidden]{display:none}
.drow .mini{margin-left:10px}

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
.clues{margin-top:3px;font-size:12px;color:var(--ink-muted);line-height:1.5}
.clues b{color:var(--ink-2);font-weight:600}

/* ---- tooltip ---- */
#tip{position:fixed;z-index:40;pointer-events:none;opacity:0;transition:opacity .1s;
  background:var(--raise);color:var(--ink);border:1px solid var(--line);border-radius:12px;
  padding:10px 12px;font-size:12.5px;box-shadow:0 10px 30px rgba(0,0,0,.28);
  max-width:340px;min-width:190px}
#tip.on{opacity:1}
#tip .th{font-size:11.5px;font-weight:600;color:var(--ink);letter-spacing:.02em;
  padding-bottom:6px;margin-bottom:6px;border-bottom:1px solid var(--line)}
#tip .tr{display:grid;grid-template-columns:10px 1fr auto auto;align-items:baseline;
  gap:8px;padding:2px 0}
/* A square reads as a stacked segment; the old 2px rule read as a line series. */
#tip .tk{width:10px;height:10px;border-radius:3px;flex:none;align-self:center}
#tip .tn{color:var(--ink-2);overflow-wrap:anywhere}
#tip .tv{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
#tip .tp{color:var(--ink-muted);font-variant-numeric:tabular-nums;font-size:11.5px;
  white-space:nowrap;min-width:2.6em;text-align:right}
#tip .tt{display:flex;justify-content:space-between;gap:12px;margin-top:6px;
  padding-top:6px;border-top:1px solid var(--line);font-weight:600}
#tip .tt span:last-child{font-variant-numeric:tabular-nums}

.foot{color:var(--ink-muted);font-size:11.5px;margin-top:18px;line-height:1.6}
/* ---- goals ---- */
.goal{margin:12px 0}
.goal+.goal{border-top:1px solid var(--line);padding-top:12px}
.ghead{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.gname{font-size:13.5px;font-weight:600;display:flex;flex-direction:column;min-width:0}
.gaim{font-weight:400;font-size:11.5px;color:var(--ink-muted)}
.gval{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;flex:none}
.gtrack{position:relative;height:10px;border-radius:999px;margin-top:8px;
  background:color-mix(in oklab,var(--mc) 16%,var(--surface-2))}
.gfill{height:100%;border-radius:999px;background:var(--mc)}
.gmark{position:absolute;top:-3px;height:16px;width:2px;background:var(--ink);border-radius:1px;transform:translateX(-1px)}
.goal.over .gfill{background:var(--crit)}
.goal.near .gfill{background:var(--warn)}
.gfoot{display:flex;justify-content:space-between;gap:8px;font-size:12px;margin-top:7px;color:var(--ink-muted);flex-wrap:wrap}
.gstate{font-weight:600;color:var(--ink-2)}
.goal.ok .gstate,.goal.met .gstate{color:var(--ok)}
.goal.near .gstate,.goal.behind .gstate{color:var(--serious)}
.goal.over .gstate{color:var(--crit)}
.gform{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px}
.gform select{min-width:0;flex:1 1 120px}
.gform input[type=number]{width:78px}
.gform .lab{font-size:12px;color:var(--ink-muted)}

/* ---- buttons and the text version ---- */
.acts{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}
.btn{background:var(--surface-2);border:1px solid var(--line);color:var(--ink);border-radius:10px;
  padding:10px 14px;font-size:13.5px;cursor:pointer;font-family:inherit;text-decoration:none;
  display:inline-flex;align-items:center;gap:7px;min-height:40px}
.btn.primary{background:var(--ink);color:var(--plane);border-color:var(--ink);font-weight:600}
.textout summary{font-size:12.5px;color:var(--ink-muted);cursor:pointer;padding:6px 0}
.textout textarea{width:100%;min-height:230px;margin-top:6px;
  font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;
  background:var(--surface-2);color:var(--ink);border:1px solid var(--line);border-radius:10px;padding:10px}

/* ---- kid page ---- */
.crumb{font-size:12.5px;margin:-6px 0 12px}
.crumb a{color:var(--ink-muted)}
.kidlink{text-decoration:none;border-bottom:1px solid var(--axis)}
.kidlink:hover{border-bottom-color:var(--ember)}
.wk{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.wk a,.wk span.now{text-decoration:none;font-size:12.5px;padding:6px 12px;border-radius:999px;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2)}
.wk span.now{background:var(--ink);color:var(--plane);border-color:var(--ink);font-weight:600}
.wk .off{opacity:.4}
.said{font-size:13.5px;color:var(--ink-2);margin:0 0 10px}
.done{opacity:.72}

@media (max-width:460px){ .hero .fig{font-size:38px} body{padding:10px 10px 50px} .card,.kid{padding:13px} .brand span{display:none}
  .gform select,.gform input[type=number]{flex:1 1 100%;width:100%} .gform .btn{width:100%;justify-content:center}
  .textout textarea{min-height:180px} .acts .btn{flex:1 1 100%;justify-content:center} }
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// ---------------------------------------------------------------------------
// Polish. Kept as its own block so the original stylesheet above stays legible
// and every rule here can be read as "what the control-room pass changed".
//
// The brief was "running the matrix, but a parent has to understand it in two
// seconds". So: depth and glow are spent only where something is actually
// happening (the live figures, an online dot, a card that is currently doing
// something), numbers get tabular figures wherever they sit in a column or
// change under you, and the type gets denser without getting smaller. Both
// themes are stepped separately, never flipped.
// ---------------------------------------------------------------------------
const POLISH = `
/* The porch light: one warm wash at the top of the plane, in both themes. */
body{position:relative}
body::before{content:"";position:fixed;inset:0 0 auto;height:340px;pointer-events:none;z-index:-1;
  background:radial-gradient(120% 100% at 50% -30%,var(--ember-soft),transparent 68%)}

/* Numbers a parent reads in a column, or that change while they watch, get
   equal-width digits so nothing jitters. Hero-sized figures deliberately do
   NOT: tabular digits make a big number look loose. */
.tile .val,.tile .dlt,.row .r,.tmeta,.pill,.tag,.mgnum,.lvstate,.alert time,
.tview td.num,.tview th.num,.chart .tick,.gval{font-variant-numeric:tabular-nums}
.hero .fig,.lvfig b{font-variant-numeric:proportional-nums}

/* Header. The dot is the one thing on the page allowed to breathe. */
.top{margin-bottom:14px}
.brand b{letter-spacing:-.015em}
.porch{position:relative}
.porch::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--ember);
  animation:porchpulse 3.6s ease-out infinite}
@keyframes porchpulse{0%{transform:scale(1);opacity:.5}70%{transform:scale(3.4);opacity:0}100%{opacity:0}}
.tbtn{transition:border-color .15s,color .15s}
.tbtn:hover{border-color:var(--ember);color:var(--ember)}

/* Nav: the current view is ember-lit rather than a flat black slug. */
nav a{transition:border-color .15s,color .15s,background .15s}
nav a:hover{border-color:var(--axis);color:var(--ink)}
nav a.sel{background:var(--ember);border-color:var(--ember);color:var(--on-ember);
  box-shadow:0 2px 12px color-mix(in oklab,var(--ember) 34%,transparent)}

/* Cards: a hairline of lift, and a top edge that catches the light in dark
   mode the way a real panel would. */
.card,.kid{box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px -18px rgba(0,0,0,.35)}
.card.flat{box-shadow:none}
:root[data-theme=dark] .card:not(.flat),:root[data-theme=dark] .kid,
:root[data-theme=dark] .mgcard{background-image:linear-gradient(var(--raise),transparent 64px)}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme=light])) .card:not(.flat),
  :root:where(:not([data-theme=light])) .kid,
  :root:where(:not([data-theme=light])) .mgcard{background-image:linear-gradient(var(--raise),transparent 64px)}}

/* A device that is online right now gets the same slow pulse as the porch. */
.dot-on{position:relative;box-shadow:0 0 0 3px color-mix(in oklab,var(--ok) 20%,transparent)}
.dot-on::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--ok);
  animation:porchpulse 3.6s ease-out infinite}

/* Controls: press states and a warning glow only where something is cut off. */
.chip{transition:transform .08s,border-color .15s,background .15s}
.chip:hover{border-color:var(--axis)}
.chip.off{box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--crit) 22%,transparent)}
.chip.mode.active{box-shadow:0 0 0 1px color-mix(in oklab,var(--ember) 30%,transparent)}
.big{transition:filter .12s,transform .08s}
.big:hover{filter:brightness(1.06)}
.big:active{transform:translateY(1px)}
.btn{transition:border-color .15s,background .15s}
.btn:hover{border-color:var(--axis)}
.mini{transition:background .15s}

/* Denser, calmer type. */
h2{margin-bottom:9px}
.sub{line-height:1.5}
.pill{font-weight:500}
code{letter-spacing:-.01em}

/* One focus treatment everywhere, so keyboard use never guesses. */
a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible,
summary:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--ember);outline-offset:2px;border-radius:8px}

@media (prefers-reduced-motion:reduce){.porch::after,.dot-on::after{animation:none;display:none}}
`;

// ---------------------------------------------------------------------------
// The client script. Small on purpose: the page works without it, this only
// adds the tooltip layer, the theme toggle, and the existing control calls.
// ---------------------------------------------------------------------------
const JS = `
const DTOK=(document.cookie.match(/(?:^|; )dash=([^;]*)/)||[])[1]||'';
function H(){return DTOK?{'content-type':'application/json','x-dash-token':DTOK}:{'content-type':'application/json'};}
function say(t){var m=document.getElementById('msg');if(m)m.textContent=t;}
/* One place decides what happens after a control call. A failure must NEVER
   reload: the reload wipes the message and the parent sees a page that blinks
   and changes nothing, which is exactly how the HttpOnly cookie bug hid. */
function done(r,j,ms){
  const msg=((j&&j.out)||'').trim();
  if(!r.ok||(j&&j.ok===false)){
    say(r.status===403?'Not signed in to this dashboard. Reload the page and try again.'
                      :(msg||('That did not work (HTTP '+r.status+')')));
    return false;}
  say(msg||'done');setTimeout(()=>location.reload(),ms||600);return true;}
async function post(url,body){
  try{const r=await fetch(url,{method:'POST',headers:H(),body:JSON.stringify(body)});
      let j={};try{j=await r.json();}catch(e){}
      return {r,j};}
  catch(e){return {r:{ok:false,status:0},j:{out:'Could not reach the dashboard: '+e.message}};}}
async function act(cmd,who,arg){say('working...');
  const {r,j}=await post('/api/act',{cmd,who,arg});done(r,j,600);}
function giveBack(who){
  var m=prompt('Out of time. How many minutes to give back to '+who+'?','30');
  if(m===null)return; m=parseInt(m,10);
  if(!(m>0&&m<=1440)){say('A number of minutes, between 1 and 1440.');return;}
  act('bonus',who,String(m));}
async function assign(mac){const label=document.getElementById('lbl_'+mac).value||'device';
  const who=document.getElementById('who_'+mac).value;
  /* Never guess an owner. An empty picker used to fall through to whoever
     sorted first, which quietly gave one child somebody else's laptop. */
  if(!who){say('Pick who this device belongs to first.');return;}
  /* "Smart home device" and "Infrastructure" are not people, so they take the
     other road: file the device by class instead of handing it to somebody. */
  if(who==='__iot'||who==='__infra'||who==='__appliance'||who==='__shared')return assignClass(mac,who.slice(2));
  say('assigning...');
  const {r,j}=await post('/api/assign',{mac,who,label});done(r,j,700);}
/* Reveal the owner picker for a device that already belongs to somebody. */
function showChange(mac){var el=document.getElementById('chg_'+mac);if(!el)return;
  el.hidden=!el.hidden;
  if(!el.hidden){var sel=document.getElementById('who_'+mac);if(sel)sel.focus();}}
async function claim(id,decision){say('working...');
  const {r,j}=await post('/api/claim',{id,decision});done(r,j,600);}

async function ack(id){say('noting it...');
  const {r,j}=await post('/api/ack',{id});done(r,j,500);}
async function setGoal(cid){
  const m=document.getElementById('gm_'+cid).value;
  const d=document.getElementById('gd_'+cid).value;
  const h=parseFloat(document.getElementById('gh_'+cid).value||'0');
  if(!(h>0)){say('Put in a number of hours first.');return;}
  say('saving the goal...');
  const {r,j}=await post('/api/goal',{child_id:cid,metric:m,direction:d,target_min:Math.round(h*60)});
  done(r,j,500);}
async function delGoal(id){say('removing the goal...');
  const {r,j}=await post('/api/goal',{id:id,remove:true});done(r,j,500);}

/* copy the plain-text digest. The text is always on the page in a textarea, so
   a browser that refuses clipboard access loses nothing: it just gets opened. */
function copyText(id){
  var el=document.getElementById(id);if(!el)return;
  var t=el.value;
  function open(){var d=el.closest('details');if(d)d.open=true;}
  function fallback(){try{open();el.focus();el.select();
    var ok=document.execCommand('copy');say(ok?'Copied. Paste it wherever you like.':'Select the text below and copy it.');}
    catch(e){say('Select the text below and copy it.');}}
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(t).then(function(){say('Copied. Paste it wherever you like.');},fallback);
  } else fallback();
}

/* theme: follow the system unless the operator picks a side */
(function(){try{var t=localStorage.getItem('genkan-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();
function toggleTheme(){var d=document.documentElement;
  var cur=d.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  var next=cur==='dark'?'light':'dark';d.dataset.theme=next;
  try{localStorage.setItem('genkan-theme',next);}catch(e){}}

/* chart tooltips. Values are also on screen as direct labels and in the table
   view below every chart, so this only ever adds convenience. */
(function(){
  var tip=document.getElementById('tip');if(!tip)return;
  function show(el,x,y){
    var rows;try{rows=JSON.parse(el.getAttribute('data-tip')||'[]');}catch(e){return;}
    tip.textContent='';
    var h=document.createElement('div');h.className='th';
    var unit=el.getAttribute('data-unit')||'';
    h.textContent=(el.getAttribute('data-head')||'')+(unit?' \u00b7 '+unit:'');
    tip.appendChild(h);
    rows.forEach(function(r){
      var d=document.createElement('div');d.className='tr';
      var k=document.createElement('span');k.className='tk';
      if(r[2])k.style.background='var(--s-'+r[2]+')';else k.style.background='transparent';
      var n=document.createElement('span');n.className='tn';n.textContent=r[0];
      var v=document.createElement('span');v.className='tv';v.textContent=r[1];
      var p=document.createElement('span');p.className='tp';
      /* A share only means something when there is more than one segment. */
      p.textContent=(rows.length>1&&r[3]!==undefined&&r[3]!==null)?r[3]+'%':'';
      d.appendChild(k);d.appendChild(n);d.appendChild(v);d.appendChild(p);tip.appendChild(d);
    });
    /* The total used to live only in the browser's own tooltip, which is the
       one this replaces, so it has to be here or it is lost. */
    var tot=el.getAttribute('data-total');
    if(tot&&rows.length>1){
      var f=document.createElement('div');f.className='tt';
      var a=document.createElement('span');a.textContent='Total';
      var b=document.createElement('span');b.textContent=tot;
      f.appendChild(a);f.appendChild(b);tip.appendChild(f);
    }
    tip.classList.add('on');
    var w=tip.offsetWidth,hh=tip.offsetHeight;
    tip.style.left=Math.max(8,Math.min(innerWidth-w-8,x-w/2))+'px';
    /* Above the cursor by default, below it when there is no room, so a bar
       near the top of the window does not get its tooltip pinned over itself. */
    var above=y-hh-14;
    tip.style.top=(above<8?Math.min(innerHeight-hh-8,y+18):above)+'px';
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
export { livePage, family, systemPage };

// The public demo (demo/compose.yaml) runs this same code against a made-up
// household, so every page has to say so plainly and in the house style. With
// GENKAN_DEMO unset, which is every real installation, DEMO_BAR is the empty
// string and DEMO_CSS never reaches the page.
const DEMO = process.env.GENKAN_DEMO === "1";
const DEMO_CSS = DEMO ? `
.demobar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  background:var(--ember-soft);border:1px solid var(--line);border-left:3px solid var(--ember);
  border-radius:12px;padding:9px 13px;margin:0 0 12px;font-size:13px;color:var(--ink-2)}
.demobar b{color:var(--ink);font-weight:600;letter-spacing:-.01em}
.demobar .porch{margin-right:-2px}
.demobar span{min-width:0}
.demobar a{color:var(--ember);font-weight:500}
@media(max-width:520px){.demobar{font-size:12.5px;padding:8px 11px}}
` : "";
const DEMO_BAR = DEMO ? `<div class="demobar" role="note">
  <span class="porch" aria-hidden="true"></span>
  <span><b>Demo household, made-up data.</b> Controls here do not change anything.
  This is the real Genkan dashboard running against a fake family, so nobody's
  network is behind it. <a href="https://genkan.nz/">About Genkan</a></span>
</div>` : "";

export function shell({ tab, body, title = "Genkan" }) {
  // The everyday pages in the row; the rest under More. Wrapping means a
  // narrow screen shows two rows rather than cutting the last one off.
  const nav = [["/", "Home"], ["/live", "Right now"], ["/week", "Week"],
    ["/analytics", "Analytics and logs"], ["/earn", "Learn to earn"], ["/devices", "Devices"],
    ["/family", "Family"], ["/settings", "Settings"]];
  const more = [["/trends", "Trends"], ["/notify", "Notifications"], ["/system", "System"],
    ["/speed", "Speed", "Measures the gateway's own wire, and its connection to the internet"]];
  const link = ([h, l, t]) => `<a href="${h}"${tab === h ? ' class="sel" aria-current="page"' : ""}${t ? ` title="${esc(t)}"` : ""}>${esc(l)}</a>`;
  const moreSel = more.some(([h]) => h === tab);
  return `<!doctype html><html lang="en-NZ"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title><style>${CSS}${LOGO_CSS}${POLISH}${LIVE_CSS}${MANAGE_CSS}${HOUSEHOLD_CSS}${SYS_CSS}${SCHEDULE_CSS}${ANALYTICS_CSS}${SETTINGS_CSS}${DEMO_CSS}</style></head><body>
<div class="top"><div class="brand">${KANJI_SVG}${wordmarkSVG()}
  <span>the family router</span></div>
  <button class="tbtn" onclick="toggleTheme()" aria-label="Switch light or dark" title="Light or dark"><span class="moon" aria-hidden="true">&#9790;</span><span class="sun" aria-hidden="true">&#9788;</span></button></div>
<nav>${nav.map(link).join("")}<details class="more${moreSel ? " sel" : ""}"><summary aria-label="More pages">More</summary><div>${more.map(link).join("")}</div></details></nav>
<div class="msg" id="msg" role="status" aria-live="polite"></div>
${DEMO_BAR}${body}
<div id="tip" role="tooltip" aria-hidden="true"></div>
<script>${JS}${MANAGE_JS}${HOUSEHOLD_JS}${LIVE_JS}${SYS_JS}${SCHEDULE_JS}${ANALYTICS_JS}${SETTINGS_JS}</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------
// "Off at 9, back at 7", in the same words the kid portal uses. A child who can
// see the times is being treated fairly; one who just gets cut off is being
// punished by a machine, and a parent should be able to read the schedule off
// the same page they set it on.
function bedtimeChip(k, s) {
  const n = (s.bedtimes || {})[k.id];
  if (!n) return "";
  return `<div class="btnow">${n.in_window ? "&#127769; " : ""}${esc(bedtimeLine(n))}${
    n.extended ? " &middot; extra time tonight" : ""}${
    n.override ? ` &middot; ${esc(n.override)}` : ""}</div>`;
}

function kidState(k, cats, slow) {
  const mine = cats.filter(x => x.kid === k.name);
  const blocked = new Set(mine.map(x => x.category));
  // WHY the internet is off changes what the chip offers: a parent's off
  // toggles back on; out-of-time toggles on and is re-cut by the meter one
  // minute later (which read, fairly, as "the dashboard does not work"), so
  // that state offers minutes instead.
  const inetWhy = mine.find(x => x.category === "internet")?.set_by || "";
  const inetOff = blocked.has("internet");
  const gameOff = blocked.has("gaming");
  const mediaOff = blocked.has("video") || blocked.has("social");
  // The slow lane. A category is in exactly one of three states, and "off"
  // always wins: a blocked category cannot also be slow, because a dropped
  // packet is never policed. See config/db/schema-slow.sql.
  const sl = new Set((slow || []).filter(x => x.kid === k.name).map(x => x.category));
  const inetSlow = !inetOff && sl.has("internet");
  const gameSlow = !gameOff && sl.has("gaming");
  const mediaSlow = !mediaOff && (sl.has("video") || sl.has("social"));
  return { blocked, inetOff, inetWhy, gameOff, mediaOff, inetSlow, gameSlow, mediaSlow,
           study: gameOff && mediaOff && !inetOff };
}

// The control chips. Same commands, same endpoint, same semantics as before:
// green when the thing is allowed, red when it is blocked, tap to toggle.
// The control chips. Same endpoint and the same semantics as before, with a
// third state added rather than a fourth control: tapping cycles
// full -> slow -> off -> full.
//
// The slow lane sits between the two on purpose, because it is the step a
// parent should reach for first. A block is a confrontation; a crawl is a
// video that buffers until the child wanders off, which nobody has to argue
// about. Amber, and it says SLOW, so nothing about it is a secret.
function chips(k, st) {
  const chip = (label, off, slow, cmdOff, cmdOn, cmdSlow) => {
    const state = off ? "off" : slow ? "slow" : "on";
    const word = off ? "OFF" : slow ? "SLOW" : "ON";
    // full -> slow -> off -> full
    const next = off ? cmdOn : slow ? cmdOff : cmdSlow;
    const hint = off ? "Tap for full speed" : slow ? "Tap to switch it off" : "Tap for the slow lane";
    // kidnet's grammar is <verb> <kid> [category], so a category is the third
    // argument, never part of the verb: /api/act puts `who` straight after the
    // verb words and everything in `arg` after that.
    const call = Array.isArray(next)
      ? `act('${next[0]}','${esc(k.name)}','${next[1]}')`
      : `act('${next}','${esc(k.name)}')`;
    return `<button class="chip ${state}" title="${hint}" onclick="${call}">
       <span class="dot"></span>${label}: <b>${word}</b></button>`;
  };
  // Out of time is not a parent's off: flipping it on lasts one meter tick.
  // The honest control is minutes, so that is what the chip offers.
  const inetChip = st.inetOff && st.inetWhy === "out-of-time"
    ? `<button class="chip off" title="Out of time. Tap to give minutes back" onclick="giveBack('${esc(k.name)}')">
         <span class="dot"></span>🌐 Internet: <b>OUT OF TIME</b></button>`
    : chip("🌐 Internet", st.inetOff, st.inetSlow, "off", ["full", "internet"], ["slow", "internet"]);
  return `<div class="chips">
    ${inetChip}
    ${chip("🎮 Gaming", st.gameOff, st.gameSlow, "game off", ["full", "gaming"], ["slow", "gaming"])}
    ${chip("📺 Media", st.mediaOff, st.mediaSlow, "media off", ["full", "media"], ["slow", "media"])}
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
// Home
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

  // Adults, household or visiting, do not get a screen-time card: they have no
  // budget, nothing to earn, and no control on this page reaches them.
  const kids = s.children.filter(k => k.active !== false && isKid(k.kind || "child")).map(k => {
    const st = kidState(k, s.cats, s.slow);
    const an = kidsA.get(k.id);
    const t = (s.times || []).find(x => x.child_id === k.id) || {};
    const out = (t.remaining_min ?? 0) <= 0 && (t.used_min || 0) > 0;
    return `<div class="kid">
      <div class="kh"><h3><a class="kidlink" href="/kid/${encodeURIComponent(k.name)}">${esc(k.name)}</a> <span class="tag">${k.age} · ${esc(k.policy_tier)}</span></h3>
        ${st.study ? '<span class="pill study">Study mode</span>' : ""}
        ${out ? '<span class="pill out">Out of time</span>' : ""}
        ${st.inetOff ? '<span class="pill">Internet off</span>' : ""}</div>
      ${chips(k, st)}
      ${bedtimeChip(k, s)}
      ${timeBar(k, s.times)}
      ${catMeters(an)}
      ${an ? `<div class="tmeta"><span>Last 7 days: ${esc(fmt.min(an.totals.metered))} metered, `
      + `${esc(fmt.min(an.totals.earned))} earned</span>`
      + `<a class="mini" style="text-decoration:none" href="/kid/${encodeURIComponent(k.name)}">Open ${esc(k.name)}</a></div>` : ""}
    </div>`;
  }).join("");

  const newDev = newDevices.length ? `<div class="card"><h2>🆕 New devices to name (${newDevices.length})</h2>`
    + newDevices.slice(0, 6).map(d => deviceAssignRow(d, s.people)).join("")
    + (newDevices.length > 6 ? `<div class="row"><a href="/devices">See all ${newDevices.length}</a></div>` : "")
    + `</div>` : "";

  const alerts = alertsCard(s.alerts, s.alertsAck);

  const recent = `<div class="card"><h2>Recent actions</h2>${s.events.length
    ? s.events.map(e => `<div class="row"><span>${esc(e.target_ref)} → ${esc(e.action)}</span>`
      + `<span class="r">${esc(e.source)} · ${esc(new Date(e.ts).toLocaleString("en-NZ"))}</span></div>`).join("")
    : '<div class="empty">Nothing yet.</div>'}</div>`;

  return (urgent.length ? `<div class="card" style="border-color:var(--crit)"><h2 style="color:var(--crit)">Worth a quiet word</h2>`
    + urgent.map(x => `<div class="alert urgent"><span class="sev">urgent</span><span>${esc([x.category, x.domain, x.detail].filter(Boolean).join(" · "))}</span></div>`).join("")
    + `</div>` : "")
    + liveStrip() + hero + pause + claims + kids + housePanel(s) + newDev + alerts + recent;
}

// One row, used both for the naming queue and for changing a device that is
// already somebody's. The label box opens on the name the device already has
// and the picker opens on its current owner, so re-assigning a device is a
// one-field change instead of retyping everything.
// Phones randomise their wifi address by default now, and both iOS and
// Android will rotate it. When that happens the device arrives as a brand new
// unnamed thing, loses its owner, its reserved address, its filtering level
// and its metering, and the parent is never told why their child stopped
// being covered. It is the quietest way this whole system fails. The
// locally-administered bit in the first octet is how you spot one.
function randomMac(mac) {
  const first = parseInt(String(mac || "").slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) !== 0;
}
const RANDOM_MAC_NOTE = "This phone gives the network a made-up address that it will change from "
  + "time to time. When it does, it arrives here as a new unnamed device and stops being covered. "
  + "On the phone, open the wifi settings for this network and turn off private or randomised "
  + "address. Then name it here once and it stays named.";

// What we can say about a device nobody has named. Written as sentences a
// parent can act on, not fields: "asked for eufylife.com" identifies a
// doorbell in a way "vendor: Smart Innovation LLC" never does.
function deviceClues(c) {
  if (!c) return "";
  const bits = [];
  if (c.ago) bits.push(`on the wire <b>${esc(c.ago)}</b>`);
  else bits.push(`<span title="It holds an address but has never answered on the wire, so it may be long gone">never answered on the wire</span>`);
  if (c.first_txt) bits.push(`first seen ${esc(c.first_txt)}`);
  const n = Number(c.lookups || 0);
  if (n > 0 && c.top_domains) {
    bits.push(`asked for <b>${esc(c.top_domains)}</b>`);
  } else if (n === 0) {
    // Zero lookups is itself the clue, and the more important one: a device
    // that never asks Genkan for a name is also not being filtered by it.
    bits.push(`<span title="It resolves names somewhere else, so nothing here can identify it and the DNS filter does not apply to it">asked Genkan for nothing, so it is using its own DNS</span>`);
  }
  return bits.length ? `<div class="clues">${bits.join(" &middot; ")}</div>` : "";
}

function deviceAssignRow(d, people, opts = {}) {
  const key = esc(d.mac || "");
  const owner = d.person || "";
  const name = d.label || d.hostname || "";
  return `<div class="row"><span><b>${esc(d.hostname || d.label || "(no name)")}</b> <code>${key}</code>
      ${d.vendor ? `<code>${esc(d.vendor)}</code>` : ""} ${d.online ? '<span class="dot-on"></span>online' : ""}
      ${owner ? `<span class="tag">now ${esc(owner)}${esc(roleTag(d.person_kind))}</span>` : ""}
      ${randomMac(d.mac) ? `<span class="tag warn" title="${esc(RANDOM_MAC_NOTE)}">random address</span>` : ""}
      ${deviceClues(opts.clue)}</span>
    <span class="assign"><input id="lbl_${key}" value="${esc(name)}" placeholder="e.g. Ben phone" aria-label="Name for ${key}">
      <select id="who_${key}" aria-label="Owner for ${key}">${assignOptions(people, owner)}</select>
      <button class="approve" onclick="assign('${key}')">${opts.change ? "Change" : "Assign"}</button></span></div>`;
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------
export function devices(s, clues = {}) {
  // The order is the order a parent cares about them in: their kids' devices
  // first, then the ones the whole family shares, then the household's own kit.
  const groups = [
    ["personal", "People's devices", "Phones, tablets, laptops and consoles. Filtered and metered by their owner's tier."],
    ["shared", "Shared family devices", "The lounge TV, the iPad everybody uses. Nobody's minutes pay for these, and each one has a filter level of its own."],
    ["iot", "Smart home", "Cameras, speakers, lights. Never assigned to a kid, never metered, and never cut by a family pause."],
    ["appliance", "Unrestricted devices", "A media server, an SMS gateway. Full internet, no owner, no time limit, and no control reaches them."],
    ["infra", "Infrastructure", "The access point and the gateway itself. Not a client."],
  ];
  const unassigned = s.devices.filter(d => d.unassigned && d.category === "personal"
    && !["ap", "infra", "gateway"].includes(d.device_kind));

  // If any phone here randomises its address, say so once, plainly, at the top.
  // A tooltip is not enough for the failure that quietly uncovers a child.
  const anyRandom = s.devices.some(d => (d.category || "personal") === "personal" && randomMac(d.mac));
  const randomNote = anyRandom ? `<div class="card"><h2>Phones with a random address</h2>
    <p class="sub">${esc(RANDOM_MAC_NOTE)}</p></div>` : "";

  const naming = unassigned.length ? `<div class="card"><h2>\u{1F195} New devices to name (${unassigned.length})</h2>
    <p class="sub">Who owns what is deliberately manual. Only you know whose device is whose.</p>
    ${unassigned.map(d => deviceAssignRow(d, s.people, { clue: clues[d.mac] })).join("")}</div>` : "";

  // The two tick boxes. Shown only where they mean something: a camera, an
  // appliance and the access point are in no sweep at all, and offering a box
  // that does nothing would be a lie the parent only finds out at dinner.
  // "(default)" is shown on a shared device and nowhere else. On a shared
  // device it is the point: the parent has not answered yet, and the brief was
  // that a shared device asks. On eleven of a family's own phones it is noise
  // on every row, and noise on every row is how a page stops being read.
  const ticks = (d, showDefault) => {
    const key = esc(d.mac || "");
    return `<span class="dsweep">` + SWEEPS.map(([v, label, note]) => {
      const on = v === "dinner" ? d.in_dinner : d.in_house_off;
      const dflt = v === "dinner" ? d.dinner_default : d.house_off_default;
      return `<label class="tick" title="${esc(note)}">
        <input type="checkbox" ${on ? "checked" : ""}
               onchange="setSweep('${key}','${v}',this.checked)"
               aria-label="${esc(label)} for ${esc(d.label || d.hostname || key)}">
        <span>${esc(label)}${showDefault && dflt ? ' <span class="dflt">(default)</span>' : ""}</span></label>`;
    }).join("") + `</span>`;
  };

  // A shared device's own filter level. A personal device has no picker here,
  // because its level comes from whoever owns it and two places to set one
  // thing is how they end up disagreeing.
  const tierPicker = (d) => {
    const key = esc(d.mac || "");
    return `<label class="dtier" for="dtier_${key}">Filter
      <select id="dtier_${key}" onchange="setDeviceTier('${key}')">
        ${TIERS.map(([v, l, note]) => `<option value="${v}"${(d.device_tier || "standard") === v ? " selected" : ""}
            title="${esc(note)}">${esc(l)}</option>`).join("")}
      </select></label>`;
  };

  const list = groups.map(([cat, title, note]) => {
    const rows = s.devices.filter(d => (d.category || "personal") === cat);
    if (!rows.length) return "";
    const swept = SWEEPABLE.includes(cat);
    return `<div class="card"><h2>${esc(title)} (${rows.length})</h2><p class="sub">${esc(note)}</p>`
      + (swept
        ? `<p class="gnote">${cat === "shared"
            ? "Ticked by default, and the tick is yours to change: untick the display that plays music through dinner."
            : "Ticked means the dinner pause and the whole-house cut reach it. Untick anything that should stay online."}</p>`
        : "")
      + rows.map(d => `<div class="row drow">
          <div class="dname">${d.online ? '<span class="dot-on"></span>' : ""}<b>${esc(d.label || d.hostname || "(unnamed)")}</b>
            ${cat === "personal" ? `<span class="tag">${esc(d.person || "unassigned")}${esc(roleTag(d.person_kind))}</span>` : ""}
            ${cat === "shared" ? '<span class="tag">the household\u2019s</span>' : ""}
            ${cat === "personal" && randomMac(d.mac) ? '<span class="tag warn">random address</span>' : ""}
            ${cat === "personal" || cat === "shared" ? `<button class="mini" onclick="showChange('${esc(d.mac || "")}')">Change</button>` : ""}</div>
          <div class="dfoot"><code>${esc([d.device_kind, d.vendor, d.ip || "no reserved IP", d.mac].filter(Boolean).join(" \u00b7 "))}</code>
            ${swept ? ticks(d, cat === "shared") : ""}
            ${cat === "shared" ? tierPicker(d) : ""}</div>
        </div>`
        // Hidden until asked for, because a page full of open pickers invites
        // the mis-click this whole change exists to prevent.
        + (cat === "personal" || cat === "shared"
          ? `<div class="chg" id="chg_${esc(d.mac || "")}" hidden>${deviceAssignRow(d, s.people, { change: true })}</div>`
          : "")).join("")
      + `</div>`;
  }).join("");

  // What the one big button would do right now, said before it is pressed.
  const h = s.house || {};
  const houseCard = `<div class="card"><h2>The whole-house cut</h2>
    <p class="sub">${h.is_off
      ? `The house is off. ${esc(String(h.minutes_left || 0))} minute${h.minutes_left === 1 ? "" : "s"} left, then it comes back on by itself.`
      : `One button, on the Home page. Right now it would take ${esc(String(h.devices_caught || 0))} device${h.devices_caught === 1 ? "" : "s"} off the internet.`}</p>
    <p class="gnote">It never reaches the smart home, an appliance or the access point, and the help lines answer
      on every device through it. It lifts itself when the time is up, so nothing stays cut off if nobody is home
      to undo it. Untick a device above to leave it out.</p>
    <div class="houserow">${h.is_off
      ? `<button class="approve" type="button" onclick="houseOn()">Back on now</button>`
      : `<span class="housebtns">${[30, 60, 120].map(m => `<button class="decline" type="button" onclick="houseOff(${m})">Off for ${m < 60 ? m + " min" : (m / 60) + "h"}</button>`).join("")}</span>`}</div>
  </div>`;

  return naming + randomNote + houseCard
    + (list || '<div class="card"><div class="empty">No devices yet. They register as they join the kids network.</div></div>');
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

function kidTrends(k, win, { link = true } = {}) {
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
    ${table(["Day", "Gaming", "Video", "Social", "Downloads", "Other", "Total online"],
      k.days.map(d => [fmt.dayFull(d.day), d.gaming, d.video, d.social, d.download, d.other, d.online]))}`;

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

  const heading = link
    ? `<a class="kidlink" href="/kid/${encodeURIComponent(k.name)}">${esc(k.name)}</a>`
    : esc(k.name);
  return `<div class="kid" id="${esc(anchor)}">
    <div class="kh"><h3>${heading} <span class="tag">${k.age} · ${esc(k.policy_tier)}</span></h3>
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
    <p class="foot">Days follow the gateway's clock. Genkan logs domains, never content: it is a family conversation aid, not a surveillance console.</p>
  </div>`;
}

// ---------------------------------------------------------------------------
// Alerts, shared by Home and the kid page.
//
// Alerts used to pile up forever, which trains a parent to ignore them. An
// alert is a prompt to say something, so once it has been said it should stop
// shouting: "We talked about it" acknowledges it and moves it into the quiet
// list, where it stays readable rather than being deleted.
// ---------------------------------------------------------------------------
function agoText(ts) {
  if (!ts) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
}

function alertRow(x, { canAck = true } = {}) {
  const body = [x.category, x.domain, x.detail].filter(Boolean).join(" · ");
  const when = agoText(x.ts);
  return `<div class="alert ${esc(x.severity)}${canAck ? "" : " done"}">`
    + `<span class="sev">${esc(x.severity)}</span>`
    + `<span style="flex:1;min-width:120px">${esc(body)}</span>`
    + (when ? `<span class="r">${esc(when)}</span>` : "")
    + (canAck && x.id ? `<button class="mini" onclick="ack(${Number(x.id)})">We talked about it</button>` : "")
    + `</div>`;
}

function alertsCard(open = [], done = []) {
  const quiet = done.length
    ? `<details class="tview"><summary>Already talked about (${done.length})</summary>`
      + done.map(x => alertRow(x, { canAck: false })).join("") + `</details>`
    : "";
  return `<div class="card"><h2>Alerts</h2>`
    + (open.length
      ? open.map(x => alertRow(x)).join("")
      : `<div class="empty">Nothing waiting on you. Safety flags are a prompt for a conversation, never a verdict.</div>`)
    + quiet + `</div>`;
}

// ---------------------------------------------------------------------------
// Goals: one agreed number per kid per week.
// ---------------------------------------------------------------------------
function goalsBlock(child, goals, { unavailable = false } = {}) {
  const cid = Number(child.id);
  const opts = Object.entries(GOAL_METRICS)
    .map(([k, m]) => `<option value="${esc(k)}">${esc(m.label.toLowerCase())}</option>`).join("");
  const form = `<div class="gform">
    <span class="lab">New goal</span>
    <select id="gd_${cid}" aria-label="Goal direction for ${esc(child.name)}">
      <option value="at_most">no more than</option><option value="at_least">at least</option></select>
    <input id="gh_${cid}" type="number" min="0.25" max="60" step="0.25" placeholder="hours"
      aria-label="Hours a week for ${esc(child.name)}">
    <span class="lab">hours of</span>
    <select id="gm_${cid}" aria-label="Goal metric for ${esc(child.name)}">${opts}</select>
    <button class="btn" onclick="setGoal(${cid})">Set it</button>
  </div>`;
  if (unavailable) {
    return `<div class="empty">Goals need the goals table. Run <code>config/db/schema-goals.sql</code> against the database and it appears here.</div>`;
  }
  const body = goals.length
    ? goals.map(g => goalBar(g)
        + `<div class="acts"><button class="mini" onclick="delGoal(${Number(g.id)})">Remove this goal</button></div>`).join("")
    : `<div class="empty">No goal set yet. Pick one thing together, say "no more than 6 hours of video a week",
        and it shows up here every week with the progress against it. One goal is plenty.</div>`;
  return body + form;
}

// ---------------------------------------------------------------------------
// The weekly digest, as a page. docs/reporting.md, on a phone.
// ---------------------------------------------------------------------------
// "1 quiz", "3 quizzes". Small thing, but a digest a parent pastes into a
// message should read like a person wrote it.
// Watch-list matches that no alert already covers. Both come from the same
// lookup; only the alert can be acknowledged, so the alert is the one that
// stays and the raw match is dropped.
function unalerted(flags, alerts) {
  const covered = new Set((alerts || []).map(a => a.domain).filter(Boolean));
  return (flags || []).filter(f => !covered.has(f.domain));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const shiftDay = (iso, d) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86400000).toISOString().slice(0, 10);

// "45 min earned back" is true even when it came from the CLI rather than from
// a quiz or a chore, so the sentence only names the paths that were used.
function earnedLine(min, quizzes, chores) {
  if (!min) return "Nothing earned back yet this week.";
  const how = [];
  if (quizzes) how.push(plural(quizzes, "quiz", "quizzes"));
  if (chores) how.push(plural(chores, "approved chore", "approved chores"));
  return `${fmt.min(min)} earned back${how.length ? ` through ${how.join(" and ")}` : ""}.`;
}

export function week(s, dg) {
  const w = dg.week;
  const last = shiftDay(w.end, -1);
  const goalsMissing = dg.notes.some(n => n.startsWith("goals"));

  const nav = `<div class="wk">
    <a href="/week?week=${esc(shiftDay(w.start, -7))}">‹ Earlier</a>
    ${w.current ? `<span class="now">This week</span>` : `<a href="/week">This week</a>`}
    ${w.current ? "" : `<span class="now">Week of ${esc(fmt.dayFull(w.start))}</span>`}
    ${w.current ? `<span class="off">Later ›</span>` : `<a href="/week?week=${esc(shiftDay(w.start, 7))}">Later ›</a>`}
  </div>`;

  const anyData = dg.kids.some(k => k.totals.online || k.totals.metered || k.totals.earned);
  const hMetered = dg.kids.reduce((a, k) => a + k.totals.metered, 0);
  const hEarned = dg.kids.reduce((a, k) => a + k.totals.earned, 0);
  const hQuiz = dg.kids.reduce((a, k) => a + k.quizCount, 0);
  const hChores = dg.kids.reduce((a, k) => a + k.chores.length, 0);
  const hFlags = dg.kids.reduce((a, k) => a + k.flags.length + k.alerts.filter(x => !x.acknowledged).length, 0);

  const hero = `<div class="card">
    <div class="hero"><div class="fig">${esc(fmt.min(hMetered))}</div>
      <div class="cap">of metered time across the house, ${esc(fmt.dayFull(w.start))} to ${esc(fmt.dayFull(last))}${w.current ? " so far" : ""}.
        ${esc(earnedLine(hEarned, hQuiz, hChores))}
        ${hFlags ? `${plural(hFlags, "thing", "things")} worth a quiet word.` : "Nothing flagged."}</div></div>
    <p class="said">This is a conversation starter, not a report card. Two or three things over dinner beats a printout.</p>
    <div class="acts"><button class="btn primary" onclick="copyText('digesttext')">Copy as text</button>
      <a class="btn" href="/trends?days=30">See the 30 day trend</a></div>
  </div>`;

  // Where the whole house's week went, one column per kid. Categorical colour
  // by category, never by rank, so a kid's video slice is the same orange here
  // as it is on their own page.
  const keys = ["gaming", "video", "social", "other"];
  const cols = dg.kids.map(k => {
    const t = k.totals;
    const other = Math.max(0, t.online - t.metered);
    return {
      label: k.name, sub: k.name, summary: fmt.min(t.online),
      segs: [{ key: "gaming", value: t.gaming }, { key: "video", value: t.video },
        { key: "social", value: t.social }, { key: "other", value: other }],
    };
  });
  const anyMinutes = dg.kids.some(k => k.totals.online || k.totals.metered);
  const houseChart = anyMinutes ? `<div class="card"><h2>The week, side by side</h2>
    <p class="fsub">Minutes each child spent online this week. Gaming, video and social are the meter's figures; the rest is everything else the daily ledger counted.</p>
    <div class="figure">${columns({ cols, series: keys.map(key => ({ key })), title: "Minutes per child this week" })}</div>
    ${legend(keys)}
    ${table(["Child", "Gaming", "Video", "Social", "Downloads", "Other", "Total online"],
      dg.kids.map(k => [k.name, k.totals.gaming, k.totals.video, k.totals.social, k.totals.download,
        Math.max(0, k.totals.online - k.totals.metered), k.totals.online]))}
    </div>` : "";

  const empty = anyData ? "" : `<div class="card"><div class="empty">
    Nothing was recorded this week yet. That is normal on a fresh gateway: minutes appear once devices are named
    on the Devices tab and the metering timer has run for a day. The page fills itself in.</div></div>`;

  const kids = dg.kids.map(k => weekKid(k, dg, goalsMissing)).join("");

  const text = `<div class="card"><h2>Send it on</h2>
    <p class="sub">The same digest as plain text, ready to paste into a message to your kid or your partner.</p>
    <div class="acts"><button class="btn primary" onclick="copyText('digesttext')">Copy as text</button></div>
    <details class="textout"><summary>Show the text version</summary>
      <textarea id="digesttext" readonly rows="18" aria-label="The digest as plain text">${esc(digestText(dg))}</textarea>
    </details></div>`;

  return nav + hero + houseChart + empty + kids + text + measurementCard(dg);
}

function weekKid(k, dg, goalsMissing) {
  const t = k.totals;
  const nothing = !t.online && !t.metered && !t.earned;
  const busiest = k.busiest ? `busiest on ${fmt.dayFull(k.busiest.day)} (${fmt.min(k.busiest.online)})` : "";
  const line = nothing
    ? `Nothing recorded for ${k.name} this week. If that looks wrong, check their devices are named on the Devices tab.`
    : !t.online
      ? `No online minutes counted for ${k.name} this week${t.earned ? `, though ${fmt.min(t.earned)} was earned` : ""}.`
      : `${k.name} was online ${fmt.min(t.online)} across ${plural(k.daysActive, "day", "days")}${busiest ? ", " + busiest : ""}.`;

  const cols = k.days.map(d => ({
    label: fmt.dayFull(d.day), sub: fmt.dayShort(d.day), summary: fmt.min(d.online),
    segs: [{ key: "gaming", value: d.gaming }, { key: "video", value: d.video },
      { key: "social", value: d.social }, { key: "other", value: d.other }],
  }));
  const dayChart = (!t.online && !t.metered) ? "" : `<p class="ftitle">Day by day</p>
    <div class="figure">${columns({ cols, series: [{ key: "gaming" }, { key: "video" }, { key: "social" }, { key: "download" }, { key: "other" }], title: `${k.name}: minutes per day this week` })}</div>
    ${legend(["gaming", "video", "social", "download", "other"])}
    ${table(["Day", "Gaming", "Video", "Social", "Downloads", "Other", "Total"],
      k.days.map(d => [fmt.dayFull(d.day), d.gaming, d.video, d.social, d.download, d.other, d.online]))}`;

  const svc = k.serviceList.slice(0, 6);
  const anyMin = svc.some(x => x.minutes > 0);
  const svcRows = svc.map(x => ({
    label: x.service.label, emoji: x.service.emoji,
    key: METERED.includes(x.service.category) ? x.service.category : null,
    value: anyMin ? x.minutes || 0 : x.lookups,
    display: anyMin && x.minutes ? fmt.min(x.minutes) : `${fmt.count(x.lookups)} lookups`,
    sub: x.bytes ? fmt.bytes(x.bytes) : "",
  }));
  const svcBlock = svcRows.length ? `<p class="ftitle">What they used</p>
    <p class="fsub">${anyMin ? "Active minutes per service, from the firewall counters." : "DNS lookups per service. A proxy for activity, not minutes and not data."}</p>
    <div class="figure">${ranked(svcRows, { title: `${k.name}: services this week` })}</div>
    ${legend([], { note: "Coloured where the service falls in a metered category. Grey is never counted against a budget: music, schoolwork, messaging." })}
    ${table(["Service", "Category", "Lookups", "Minutes", "Data"],
      svc.map(x => [x.service.label, x.service.category, x.lookups, x.minutes || 0, x.bytes ? fmt.bytes(x.bytes) : "-"]))}` : "";

  const earnedBits = [];
  if (k.quizCount) earnedBits.push(`${k.quizCount} quiz${k.quizCount === 1 ? "" : "zes"} passed, +${k.quizMin} min${k.quizTopics.length ? ` (${k.quizTopics.map(x => x.topic).slice(0, 4).join(", ")})` : ""}`);
  if (k.chores.length) earnedBits.push(`${k.chores.length} chore${k.chores.length === 1 ? "" : "s"} approved, +${k.chores.reduce((a, c) => a + c.minutes, 0)} min`);
  if (k.taskCount && !k.chores.length) earnedBits.push(`${k.taskCount} task${k.taskCount === 1 ? "" : "s"} credited by a parent, +${k.taskMin} min`);
  const earned = `<div class="mhead">Earned</div>` + (earnedBits.length
    ? earnedBits.map(b => `<div class="row"><span>${esc(b)}</span></div>`).join("")
    : `<div class="empty">No quizzes or chores this week. The portal is always open, and a quiz is five minutes of work for ten minutes of time.</div>`);

  const openAlerts = k.alerts.filter(x => !x.acknowledged);
  const doneAlerts = k.alerts.filter(x => x.acknowledged);
  // An alert and a watch-list match are often the same event seen twice: the
  // alert is the one a parent can act on, so it wins and the bare lookup is
  // not repeated underneath it.
  const extraFlags = unalerted(k.flags, k.alerts);
  const chat = `<div class="mhead">Worth a chat</div>`
    + (extraFlags.length || k.alerts.length
      ? extraFlags.map(f => `<div class="alert ${esc(f.severity)}"><span class="sev">${esc(f.severity)}</span>`
          + `<span style="flex:1;min-width:120px">${esc([f.category, f.domain, f.note].filter(Boolean).join(" · "))}</span>`
          + `<span class="r">${f.n}×</span></div>`).join("")
        + openAlerts.map(x => alertRow(x)).join("")
        + (doneAlerts.length ? `<details class="tview"><summary>Already talked about (${doneAlerts.length})</summary>`
          + doneAlerts.map(x => alertRow(x, { canAck: false })).join("") + `</details>` : "")
        + `<p class="cnote">These are conversation prompts, not verdicts. Ask, do not accuse.</p>`
      : `<div class="empty">Nothing flagged for ${esc(k.name)} this week.</div>`);

  return `<div class="kid" id="${esc(k.name.toLowerCase())}">
    <div class="kh"><h3><a class="kidlink" href="/kid/${encodeURIComponent(k.name)}">${esc(k.name)}</a>
      <span class="tag">${k.age} · ${esc(k.policy_tier)}</span></h3>
      <a class="mini" style="text-decoration:none" href="/kid/${encodeURIComponent(k.name)}">Everything about ${esc(k.name)}</a></div>
    <p class="said">${esc(line)}</p>
    <div class="tiles">
      <div class="tile"><span class="lab">Time online</span><span class="val">${esc(fmt.min(t.online))}</span>
        <span class="dlt">${k.daysActive} of 7 days</span>${sparkline(k.days.map(d => d.online))}</div>
      <div class="tile"><span class="lab">Metered habits</span><span class="val">${esc(fmt.min(t.metered))}</span>
        <span class="dlt">${esc(METERED.filter(c => t[c] > 0).map(c => `${c} ${fmt.min(t[c])}`).join(" · ") || "nothing metered")}</span>
        ${sparkline(k.days.map(d => d.gaming + d.video + d.social), { key: "video" })}</div>
      <div class="tile"><span class="lab">Earned</span><span class="val">${esc(fmt.min(t.earned))}</span>
        <span class="dlt">${k.quizCount} quiz${k.quizCount === 1 ? "" : "zes"} · ${k.chores.length} chore${k.chores.length === 1 ? "" : "s"}</span></div>
      <div class="tile"><span class="lab">Filter declined</span><span class="val">${esc(fmt.count(k.blocked))}</span>
        <span class="dlt">lookups the filter turned down</span></div>
    </div>
    <div class="mhead">This week's goal</div>
    ${goalsBlock(k, k.goals, { unavailable: goalsMissing })}
    ${dayChart}${svcBlock}${earned}${chat}
  </div>`;
}

// The same digest as plain text: something a parent can paste into a message.
// Deliberately the same order and the same words as the page, so nobody has to
// reconcile two versions of the week.
export function digestText(dg) {
  const w = dg.week;
  const last = shiftDay(w.end, -1);
  const L = [];
  L.push(`GENKAN weekly digest`);
  L.push(`${fmt.dayFull(w.start)} to ${fmt.dayFull(last)} ${last.slice(0, 4)}${w.current ? " (this week so far)" : ""}`);
  L.push(`Something to talk about together, not a report card.`);
  for (const k of dg.kids) {
    const t = k.totals;
    L.push("");
    L.push(`${k.name} (${k.age})`);
    if (!t.online && !t.metered && !t.earned) {
      L.push(`  nothing recorded this week`);
      continue;
    }
    L.push(`  online: ${t.online
      ? `${fmt.min(t.online)} across ${plural(k.daysActive, "day", "days")}`
        + (k.busiest ? `, busiest ${fmt.dayFull(k.busiest.day)} (${fmt.min(k.busiest.online)})` : "")
      : "no minutes counted"}`);
    const cats = METERED.map(c => (t[c] ? `${c} ${fmt.min(t[c])}` : null)).filter(Boolean);
    L.push(`  metered: ${cats.length ? cats.join(", ") : "nothing metered"} (music and schoolwork are never metered)`);
    for (const g of k.goals) {
      L.push(`  goal: ${g.metric.label.toLowerCase()} ${g.direction === "at_least" ? "at least" : "no more than"} `
        + `${fmt.min(g.target)} a week, at ${fmt.min(g.used)}, ${g.headline.toLowerCase()}`);
    }
    const svc = k.serviceList.slice(0, 5).map(x =>
      x.minutes ? `${x.service.label} ${fmt.min(x.minutes)}` : `${x.service.label} ${fmt.count(x.lookups)} lookups`);
    if (svc.length) L.push(`  top services: ${svc.join(", ")}`);
    const earned = [];
    if (k.quizCount) earned.push(`${plural(k.quizCount, "quiz", "quizzes")} passed, +${k.quizMin} min`
      + (k.quizTopics.length ? ` on ${k.quizTopics.map(x => x.topic).slice(0, 4).join(", ")}` : ""));
    if (k.chores.length) earned.push(`${plural(k.chores.length, "chore", "chores")} approved, +${k.chores.reduce((a, c) => a + c.minutes, 0)} min`);
    if (k.taskCount && !k.chores.length) earned.push(`${plural(k.taskCount, "task", "tasks")} credited by a parent, +${k.taskMin} min`);
    L.push(`  earned: ${earned.length ? earned.join("; ") : "no quizzes or chores this week"}`);
    const chat = [
      ...k.alerts.filter(x => !x.acknowledged)
        .map(x => `${[x.category, x.domain].filter(Boolean).join(" ")}${x.detail ? ` (${x.detail})` : ""}`),
      ...unalerted(k.flags, k.alerts).map(f => `${f.category} ${f.domain} (${f.n}x${f.note ? ", " + f.note : ""})`),
    ];
    L.push(`  worth a chat: ${chat.length ? chat.join("; ") : "nothing flagged"}`);
  }
  L.push("");
  L.push(`Genkan sees domain names, never content. Minutes come from the meter, lookups are only a proxy for activity.`);
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// One kid, everything in one place. This is where a parent lands when they tap
// a name, so it leads with the controls and only then explains the week.
// ---------------------------------------------------------------------------
export function kid(s, kd, ins = null) {
  const c = kd.child;
  const st = kidState(c, s.cats, s.slow);
  const t = (s.times || []).find(x => x.child_id === c.id) || {};
  const out = (t.remaining_min ?? 0) <= 0 && (t.used_min || 0) > 0;
  const goalsMissing = kd.notes.some(n => n.startsWith("goals"));
  const wt = kd.weekTotals;

  // The controls first, unchanged: a parent who came here to switch something
  // off should not have to scroll past a chart to do it.
  const head = `<p class="crumb"><a href="/">‹ Home</a> · <a href="/family">Family</a></p>
    <div class="card"><div class="kh">
      <h3 style="font-size:22px">${esc(c.name)} <span class="tag">${c.age} · ${esc(c.policy_tier)} tier</span></h3>
      ${st.study ? '<span class="pill study">Study mode</span>' : ""}
      ${out ? '<span class="pill out">Out of time</span>' : ""}
      ${st.inetOff ? '<span class="pill">Internet off</span>' : ""}</div>
      ${chips(c, st)}
      ${bedtimeChip(c, s)}
      ${timeBar(c, s.times)}
      ${catMeters(kd.kid)}
    </div>`;

  // The week's goal, if one is set. Pace-aware, so mid-week it says "on track".
  const goalsCard = `<div class="card"><h2>This week and the goal</h2>
    <p class="sub">Week of ${esc(fmt.dayFull(kd.week.start))}${kd.week.current ? `, day ${kd.week.elapsed} of 7` : ""}:
      ${esc(fmt.min(wt.online))} online, ${esc(fmt.min(wt.metered))} metered, ${esc(fmt.min(wt.earned))} earned.
      <a href="/week">The whole family's week</a>.</p>
    ${goalsBlock(c, kd.goals, { unavailable: goalsMissing })}</div>`;

  const quizzes = kd.quizHistory.length
    ? `<div class="card"><h2>Quizzes passed</h2>${table(["When", "Topic", "Minutes"], kd.quizHistory.map(r =>
        [new Date(r.ts).toLocaleString("en-NZ", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
          r.topic, r.minutes]), { summary: `The last ${kd.quizHistory.length} quizzes passed` })}
      <p class="cnote">Quizzes credit minutes straight away, with a daily cap and a cooldown per topic, so nobody can farm the same quiz all afternoon.</p></div>`
    : "";

  const openAlerts = kd.alerts.filter(x => !x.acknowledged);
  const doneAlerts = kd.alerts.filter(x => x.acknowledged);
  const extraFlags = unalerted(kd.flags, kd.alerts);
  const flags = `<div class="card"><h2>Worth a chat</h2>`
    + (extraFlags.length || kd.alerts.length
      ? extraFlags.map(f => `<div class="alert ${esc(f.severity)}"><span class="sev">${esc(f.severity)}</span>`
          + `<span style="flex:1;min-width:120px">${esc([f.category, f.domain, f.note].filter(Boolean).join(" · "))}</span>`
          + `<span class="r">${f.n}× · ${esc(agoText(f.last_ts))}</span></div>`).join("")
        + openAlerts.map(x => alertRow(x)).join("")
        + (doneAlerts.length ? `<details class="tview"><summary>Already talked about (${doneAlerts.length})</summary>`
          + doneAlerts.map(x => alertRow(x, { canAck: false })).join("") + `</details>` : "")
        + `<p class="cnote">A flag is a prompt for a question, never a verdict, and a self-harm flag is a care signal that is never a discipline matter.</p>`
      : `<div class="empty">Nothing flagged for ${esc(c.name)}. That is the usual state of things.</div>`)
    + `</div>`;

  const actions = kd.blocks.length ? `<div class="card"><h2>Recent actions</h2>`
    + kd.blocks.map(b => `<div class="row"><span>${esc(c.name)} → ${esc(b.action)}</span>`
      + `<span class="r">${esc(b.source || "")} · ${esc(new Date(b.ts).toLocaleString("en-NZ"))}</span></div>`).join("")
    + `</div>` : "";

  // The insights are computed in the house (dashboard/kid-insights.mjs). If
  // that layer failed outright the page still has its controls, its charts
  // from the Trends data, and a line saying what is missing.
  if (!ins) {
    const charts = kd.kid ? kidTrends(kd.kid, kd.window, { link: false })
      : `<div class="card"><div class="empty">No analytics for ${esc(c.name)} yet.</div></div>`;
    const why = c.kind === "child"
      ? "The insights for this page could not be computed. The charts below come from the Trends data."
      : `${esc(c.name)} is a visitor, and a visit is not logged per person, so there are no insights, findings or rewards here. Their devices are filtered and time-controlled like anyone else's.`;
    return head + `<div class="card"><div class="empty">${why}</div></div>`
      + goalsCard + charts + quizzes + flags + actions
      + measurementCard({ measurement: kd.measurement, notes: kd.notes });
  }
  return `<style>${KID_CSS}</style>` + head
    + truthLine(ins)
    + chartsCard(ins)
    + servicesCard(kd.kid)
    + changesCard(ins)
    + goalsCard
    + rewardsCard(ins)
    + aiCard(ins)
    + devicesCard(ins, kd.devices)
    + flags + quizzes + actions
    + measurementCard({ measurement: kd.measurement, notes: [...kd.notes, ...ins.notes] })
    + `<script>${KID_JS}</script>`;
}
