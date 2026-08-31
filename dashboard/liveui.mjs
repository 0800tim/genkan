// Genkan dashboard: the live view.
//
// The chart is a canvas, not SVG, because it redraws sixty times a second and
// scrolls continuously: a few hundred DOM nodes a second is the one thing SVG
// is bad at. Everything is inline and self-contained, exactly like the SVG
// charts: no library, no CDN, no web font, nothing fetched. The dashboard has
// to work with the house internet off, which is when a parent is most likely
// to open it.
//
// Form and colour follow the same rules as the rest of the dashboard:
//   * a stacked area over time, because the job is "how much, and what kind",
//     with the five series in a fixed order (grey, blue, orange, green,
//     violet) that keeps the de-emphasis grey away from the green and the
//     violet away from the blue. That ordering is what makes the five-way
//     split pass colour-vision separation in both themes;
//   * a 2px surface-coloured gap between the bands, never a border;
//   * one direct label, on the live end of the line, never a number per point;
//   * a legend, always, because there is more than one series;
//   * a table twin under every chart, and a top-talkers list that is ordinary
//     text, so no number is only reachable by hovering;
//   * light and dark are separately chosen steps, read from the same CSS
//     custom properties the SVG charts use, so a theme switch repaints both.
//
// Accessibility of a chart that never stops moving: the canvas carries a
// role="img" label that is rewritten in plain language a few times a minute
// (not on every tick, which would make a screen reader unusable), the numbers
// are all present as text in the readouts, the talkers list and the table, and
// the crosshair is reachable with the arrow keys.
import { esc } from "./charts.mjs";

export const LIVE_CSS = `
/* ---- the live wire ---- */
.lvhero{position:relative;overflow:hidden}
.lvhero::before{content:"";position:absolute;inset:-40% -10% auto;height:180px;pointer-events:none;
  background:radial-gradient(60% 100% at 50% 0,var(--ember-soft),transparent 70%);opacity:.9}
.lvtop{display:flex;align-items:center;gap:9px;margin-bottom:6px;position:relative}
.lvscope{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--ink-muted);font-weight:600;flex:1;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lvstate{font-size:11.5px;color:var(--ink-muted);font-variant-numeric:tabular-nums;flex:none}
.lvled{width:9px;height:9px;border-radius:50%;background:var(--ink-muted);flex:none;position:relative}
.lvled.on{background:var(--ok);box-shadow:0 0 0 3px color-mix(in oklab,var(--ok) 22%,transparent)}
.lvled.on::after{content:"";position:absolute;inset:0;border-radius:50%;background:var(--ok);
  animation:lvpulse 2.4s ease-out infinite}
.lvled.warn{background:var(--warn);box-shadow:0 0 0 3px color-mix(in oklab,var(--warn) 25%,transparent)}
@keyframes lvpulse{0%{transform:scale(1);opacity:.55}70%{transform:scale(3);opacity:0}100%{opacity:0}}
.lvfig{display:flex;align-items:baseline;gap:7px;position:relative}
.lvfig b{font-size:52px;line-height:1.02;font-weight:600;letter-spacing:-.025em}
.lvfig i{font-style:normal;font-size:15px;color:var(--ink-2);font-weight:600}
.lvfig.hot b{color:var(--ember)}
.lvcap{color:var(--ink-2);font-size:12.5px;margin:3px 0 10px;position:relative}
.lvcap b{font-variant-numeric:tabular-nums;font-weight:600;color:var(--ink)}
.lvchart{display:block;width:100%;height:184px;position:relative;border-radius:10px;outline:none;touch-action:pan-y}
.lvchart:focus-visible{box-shadow:0 0 0 2px var(--ember)}
.lvspark{display:block;width:100%;height:30px}
.lvhero.stale .lvchart,.lvhero.stale .lvfig{opacity:.45;transition:opacity .3s}
.lvnote{font-size:11.5px;color:var(--ink-muted);margin:8px 0 0;position:relative}

/* ---- filter row ---- */
.lvfilters{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:9px}
.lvfilters .lab{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);
  margin-right:2px;flex:none}
.fchip{flex:none;font-size:12.5px;padding:6px 12px;border-radius:999px;cursor:pointer;font-family:inherit;
  border:1px solid var(--line);background:var(--surface);color:var(--ink-2)}
.fchip[aria-pressed=true]{background:var(--ink);color:var(--plane);border-color:var(--ink);font-weight:600}
.fchip .fdot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ok);margin-right:5px;vertical-align:1px}

/* ---- top talkers ---- */
.tk{display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:4px 12px;align-items:center;
  padding:9px 0;border-top:1px solid var(--line)}
.tk:first-child{border-top:0}
.tk.idle{opacity:.55}
.tkname{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;min-width:0}
.tkname b{font-size:14px;font-weight:600}
.tkval{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.tkval b{font-size:17px;font-weight:600}
.tkval i{font-style:normal;font-size:11px;color:var(--ink-muted);display:block;margin-top:-2px}
.tkspark{grid-column:1/-1;height:30px}
.tkwho{font-size:11.5px;color:var(--ink-muted)}
.tkcls{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;padding:1px 7px;border-radius:999px;
  background:var(--surface-2);color:var(--ink-muted);border:1px solid var(--line)}
.tkcls.unassigned{color:var(--ember);border-color:color-mix(in oklab,var(--ember) 45%,transparent);
  background:var(--ember-soft);font-weight:600}
.tkapp{font-size:11.5px;color:var(--ink-2)}
.tkassign{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:2px}
.tkassign input{width:140px}
.lvempty{color:var(--ink-muted);font-size:13px;padding:10px 0}

/* ---- the strip on Home ---- */
.lvstrip{display:flex;align-items:center;gap:14px;text-decoration:none;color:inherit}
.lvstrip .lvsfig{flex:none;min-width:118px}
.lvstrip .lvsfig b{font-size:27px;font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.lvstrip .lvsfig i{font-style:normal;font-size:12px;color:var(--ink-2);margin-left:3px}
.lvstrip .lvsfig span{display:block;font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.08em}
.lvstrip .lvschart{flex:1;min-width:0}
.lvstrip .lvsgo{flex:none;font-size:12px;color:var(--ink-muted)}

/* ---- live tooltip ---- */
#lvtip{position:fixed;z-index:41;pointer-events:none;opacity:0;transition:opacity .09s;
  background:var(--raise);color:var(--ink);border:1px solid var(--line);border-radius:10px;
  padding:8px 10px;font-size:12.5px;box-shadow:0 10px 30px rgba(0,0,0,.28);min-width:150px}
#lvtip.on{opacity:1}
#lvtip .th{font-size:11px;color:var(--ink-muted);margin-bottom:5px}
#lvtip .tr{display:flex;align-items:center;gap:8px;justify-content:space-between}
#lvtip .tk2{width:12px;height:2px;border-radius:2px;flex:none}
#lvtip .tn{color:var(--ink-2);flex:1}
#lvtip .tv{font-weight:600;font-variant-numeric:tabular-nums}

.flash{animation:lvflash .5s ease-out}
@keyframes lvflash{0%{color:var(--ember)}100%{color:inherit}}
@media (prefers-reduced-motion:reduce){
  .lvled.on::after{animation:none;display:none}
  .flash{animation:none}
}
@media (max-width:460px){ .lvfig b{font-size:40px} .lvchart{height:150px} }
`;

// ---------------------------------------------------------------------------
// The client. One IIFE, no globals beyond the two the page already calls.
// ---------------------------------------------------------------------------
export const LIVE_JS = `
(function(){
var root=document.getElementById('lv'); if(!root) return;
var isStrip=root.dataset.mode==='strip';
var CATS=['other','gaming','video','social','download'];
var LABELS={other:'Other online',gaming:'Gaming',video:'Video',social:'Social',
            download:'Downloads'};
var CLS={personal:'person',shared:'shared',iot:'smart home',appliance:'appliance',infra:'infrastructure'};
var people=[]; try{people=JSON.parse(root.dataset.people||'[]');}catch(e){}

var hist=[], roster=new Map(), tickMs=1500, lastAt=0, connected=false, stale=false, totalsOn=false;
var who='all', cls='all', peakSeen=0;
var cols={}, scaleCur=0, hoverIdx=-1, focusIdx=-1, raf=0;
var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
var WINDOW=110;                       /* ticks drawn, about 2.5 minutes */
/* How long a device stays on the "who is using it right now" list after its
   last byte. A device that pauses for a single tick (a video buffering, a
   game between rounds, a phone with the screen off for a moment) used to drop
   out of the list and reappear a second later, which made the whole card
   flicker. Five minutes matches the roster's own "online" window, so a device
   leaves the list at about the same moment it stops counting as online. The
   rate shown stays live and honest: a resting row reads 0 B/s and says how
   long it has been quiet, it does not keep showing a stale number. */
var ACTIVE_WINDOW_MS=300000;
var lastActive=new Map();             /* ip -> ms of the last tick it moved bytes */

/* ---- helpers ---------------------------------------------------------- */
function rate(b){b=Number(b)||0;
  if(b<1000)return[String(Math.round(b)),'B/s'];
  if(b<1024*1000)return[(b/1024).toFixed(b<10240?1:0),'kB/s'];
  if(b<1048576*1000)return[(b/1048576).toFixed(b<10485760?2:1),'MB/s'];
  return[(b/1073741824).toFixed(2),'GB/s'];}
function rateStr(b){var r=rate(b);return r[0]+' '+r[1];}
function quietStr(ms){var s=Math.round(ms/1000);
  return s<60?(s+'s'):(Math.round(s/60)+' min');}
function readCols(){
  var cs=getComputedStyle(document.documentElement);
  cols={};CATS.forEach(function(c){cols[c]=cs.getPropertyValue('--s-'+c).trim()||'#888';});
  cols.surface=cs.getPropertyValue('--surface').trim()||'#fff';
  cols.grid=cs.getPropertyValue('--grid').trim()||'#ddd';
  cols.ink=cs.getPropertyValue('--ink').trim()||'#000';
  cols.muted=cs.getPropertyValue('--ink-muted').trim()||'#888';
  cols.ember=cs.getPropertyValue('--ember').trim()||'#c60';
}
readCols();
new MutationObserver(readCols).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
try{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',readCols);}catch(e){}

function dev(ip){return roster.get(ip)||null;}
function matches(ip){
  var r=dev(ip);
  if(cls!=='all'){ if(!r||(r.cls||'personal')!==cls) return false; }
  if(who==='all') return true;
  if(who==='none') return !r||r.unassigned;
  return !!r&&String(r.personId)===who.slice(2);
}
var filtered=function(){return who!=='all'||cls!=='all';};

/* One tick, reduced to the four series the current filter asks for. With no
   filter that is the kids0 interface total (every byte, named or not); with a
   filter it is the sum of the matching devices' own counters. */
function slice(tk){
  if(!filtered()) return {v:tk.cats||{},total:(tk.down||0)+(tk.up||0),down:tk.down||0,up:tk.up||0};
  var v={other:0,gaming:0,video:0,social:0,download:0},t=0,dn=0,up=0;
  (tk.devs||[]).forEach(function(d){ if(!matches(d.ip))return;
    CATS.forEach(function(c){v[c]+=(d.cats&&d.cats[c])||0;});
    t+=d.bps||0; dn+=d.down||0; up+=d.up||0;});
  return {v:v,total:t,down:dn,up:up};
}
function niceMax(v){
  if(!(v>0))return 65536;
  var e=Math.pow(10,Math.floor(Math.log(v)/Math.LN10)), m=v/e;
  var s=m<=1?1:m<=1.5?1.5:m<=2?2:m<=3?3:m<=5?5:m<=7.5?7.5:10;
  return Math.max(65536,s*e);
}

/* ---- painting --------------------------------------------------------- */
/* points: [{v:{cat:bytesPerSecond}}] oldest first. opts.compact = a sparkline
   inside a talker row: no axis, no labels, one colour. */
function paint(cv,points,opts){
  opts=opts||{};
  var bare=opts.compact||opts.bare;
  var dpr=Math.min(2,window.devicePixelRatio||1);
  var w=cv.clientWidth,h=cv.clientHeight;
  if(!w||!h)return;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(h*dpr)){cv.width=Math.round(w*dpr);cv.height=Math.round(h*dpr);}
  var g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,w,h);
  var L=bare?0:58,R=bare?0:8,T=bare?4:16,B=bare?3:17;
  var pw=Math.max(10,w-L-R), ph=Math.max(10,h-T-B);
  var n=Math.max(2,WINDOW), stepX=pw/(n-1);
  var pts=points.slice(-n);
  var tot=pts.map(function(p){var s=0;CATS.forEach(function(c){s+=p.v[c]||0;});return s;});
  var target=niceMax(Math.max.apply(null,tot.concat([0])) * 1.12);
  if(bare) target=Math.max(target,opts.floor||0);
  /* Ease the y scale so a spike grows into frame instead of snapping the
     whole chart to a new ruler on one tick. */
  var key=opts.key||'main';
  paint.scale=paint.scale||{};
  var cur=paint.scale[key]||target;
  cur=reduce?target:cur+(target-cur)*(target>cur?0.5:0.06);
  paint.scale[key]=cur;
  var max=cur;
  /* Sub-tick scroll: at frac 0 the newest point sits on the right edge, at
     frac 1 it has slid one step left and the next point takes its place. */
  var frac=reduce?0:Math.max(0,Math.min(1,(Date.now()-lastAt)/tickMs));
  var base=pts.length-1;
  var X=function(i){return L+pw-(base-i)*stepX-frac*stepX;};
  var Y=function(v){return T+ph-Math.max(0,Math.min(1,v/max))*ph;};

  if(!bare){
    g.lineWidth=1;g.strokeStyle=cols.grid;g.fillStyle=cols.muted;
    g.font='10px system-ui,sans-serif';g.textAlign='right';g.textBaseline='middle';
    for(var b=0;b<=2;b++){
      var val=max*b/2, y=Math.round(Y(val))+0.5;
      g.beginPath();g.moveTo(L,y);g.lineTo(L+pw,y);g.stroke();
      g.fillText(b===0?'0':rateStr(val),L-7,y);
    }
  }
  g.save();g.beginPath();g.rect(L,0,pw,h);g.clip();
  /* Stacked bands, bottom first, each closed against the one below it. */
  var cum=new Array(pts.length);for(var i=0;i<pts.length;i++)cum[i]=0;
  var lower=cum.slice();
  CATS.forEach(function(c){
    var upper=[],any=false;
    for(var i=0;i<pts.length;i++){var v=pts[i].v[c]||0;if(v>0)any=true;upper.push(lower[i]+v);}
    if(any){
      g.beginPath();
      g.moveTo(X(0),Y(lower[0]));
      for(var i=0;i<pts.length;i++)g.lineTo(X(i),Y(lower[i]));
      for(var i=pts.length-1;i>=0;i--)g.lineTo(X(i),Y(upper[i]));
      g.closePath();
      g.fillStyle=opts.compact&&opts.hue?opts.hue:cols[c];
      g.globalAlpha=opts.compact?0.30:0.38;g.fill();g.globalAlpha=1;
      /* The 2px surface gap that separates touching fills: drawn, never a
         border around the mark. */
      if(!bare){
        g.beginPath();g.moveTo(X(0),Y(upper[0]));
        for(var i=1;i<pts.length;i++)g.lineTo(X(i),Y(upper[i]));
        g.lineWidth=2;g.strokeStyle=cols.surface;g.stroke();
      }
    }
    lower=upper;
  });
  /* The live edge: the household total, 2px, with one soft glow. */
  g.beginPath();g.moveTo(X(0),Y(lower[0]));
  for(var i=1;i<pts.length;i++)g.lineTo(X(i),Y(lower[i]));
  g.lineWidth=bare?1.5:2;g.lineJoin='round';g.lineCap='round';
  g.strokeStyle=opts.compact&&opts.hue?opts.hue:cols.ember;
  if(!bare&&lower[lower.length-1]>0){g.shadowColor=cols.ember;g.shadowBlur=9;}
  g.stroke();g.shadowBlur=0;
  g.restore();

  if(!bare){
    var lastV=lower[lower.length-1]||0, lx=X(base), ly=Y(lastV);
    /* End marker: >=8px, with the 2px surface ring so it stays legible where
       it crosses the line. */
    g.beginPath();g.arc(lx,ly,4.5,0,6.2832);g.fillStyle=cols.ember;g.fill();
    g.lineWidth=2;g.strokeStyle=cols.surface;g.stroke();
    /* Exactly one direct label, on the live end. It flips below the marker
       rather than being clipped when the line is riding the top of the plot. */
    if(lastV>0){
      var txt=rateStr(lastV);
      g.font='600 11px system-ui,sans-serif';g.textAlign='right';g.textBaseline='alphabetic';
      var tw=g.measureText(txt).width;
      var above=ly-21>=T;
      var boxY=above?ly-21:Math.min(T+ph-15,ly+8);
      g.fillStyle=cols.surface;g.globalAlpha=.85;
      g.fillRect(lx-tw-11,boxY,tw+8,15);g.globalAlpha=1;
      g.fillStyle=cols.ink;g.fillText(txt,lx-7,boxY+11);
    }
    var ci=hoverIdx>=0?hoverIdx:focusIdx;
    if(ci>=0&&ci<pts.length){
      var cx=X(ci);
      g.beginPath();g.moveTo(cx,T);g.lineTo(cx,T+ph);
      g.lineWidth=1;g.strokeStyle=cols.muted;g.globalAlpha=.6;g.stroke();g.globalAlpha=1;
      g.beginPath();g.arc(cx,Y(lower[ci]),4,0,6.2832);
      g.fillStyle=cols.ember;g.fill();g.lineWidth=2;g.strokeStyle=cols.surface;g.stroke();
    }
  }
  return {L:L,pw:pw,stepX:stepX,base:base,pts:pts};
}

/* ---- the page --------------------------------------------------------- */
var cv=document.getElementById('lvcanvas');
var elDown=document.getElementById('lvdown'),elUnit=document.getElementById('lvunit');
var elUp=document.getElementById('lvup'),elPeak=document.getElementById('lvpeak');
var elLed=document.getElementById('lvled'),elState=document.getElementById('lvstate');
var elScope=document.getElementById('lvscope'),elHero=document.getElementById('lvhero');
var elTalk=document.getElementById('lvtalkers'),elTable=document.getElementById('lvtable');
var elNote=document.getElementById('lvnote'),elFig=document.getElementById('lvfig');
var elCap=document.getElementById('lvcap');
var tip=document.getElementById('lvtip');
var sparks=new Map();
var geo=null, lastLabelAt=0, lastTableAt=0;

function series(){return hist.map(slice).map(function(s){return {v:s.v};});}

function frame(){
  raf=0;
  if(cv) geo=paint(cv,series(),{key:'main',bare:isStrip});
  sparks.forEach(function(rec,ip){
    var pts=hist.map(function(tk){
      var d=(tk.devs||[]).filter(function(x){return x.ip===ip;})[0];
      return {v:d?d.cats:{other:0,gaming:0,video:0,social:0,download:0}};});
    paint(rec.cv,pts,{compact:true,key:'d'+ip,hue:rec.hue,floor:rec.floor||0});
  });
  if(!reduce&&connected) raf=requestAnimationFrame(frame);
}
function kick(){ if(!raf) raf=requestAnimationFrame(frame); }

function scopeName(){
  var w='the whole house';
  if(who==='none')w='unassigned devices';
  else if(who!=='all'){var p=people.filter(function(x){return String(x.id)===who.slice(2);})[0];w=p?p.name+"'s devices":'one person';}
  var c=cls==='all'?'':(', '+(CLS[cls]||cls)+' only');
  return w+c;
}

function render(tk){
  if(!tk)return;
  var s=slice(tk);
  if(elDown){
    var r=rate(s.total);
    if(elDown.textContent!==r[0]){elDown.textContent=r[0];
      if(!reduce){elDown.classList.remove('flash');void elDown.offsetWidth;elDown.classList.add('flash');}}
    if(elUnit)elUnit.textContent=r[1];
  }
  if(elFig)elFig.classList.toggle('hot',s.total>2*1048576);
  if(s.total>peakSeen)peakSeen=s.total;
  if(elUp)elUp.textContent=rateStr(s.down)+' in, '+rateStr(s.up)+' out';
  if(elPeak)elPeak.textContent=rateStr(peakSeen);
  if(elScope)elScope.textContent=scopeName();
  if(elHero)elHero.classList.toggle('stale',!!tk.stale);
  if(elState)elState.textContent=tk.stale?(tk.why||'holding last reading'):'live · '+new Date(tk.t).toLocaleTimeString('en-NZ');
  if(elLed){elLed.className='lvled '+(tk.stale?'warn':connected?'on':'');}
  if(elCap)elCap.firstChild&&(elCap.firstChild.nodeValue=filtered()?'across '+scopeName()+' right now. ':'across the whole house right now. ');
  talkers(tk);
  var now=Date.now();
  if(elTable&&now-lastTableAt>1400){lastTableAt=now;table();}
  /* A screen reader must not be told a new number twice a second. */
  if(cv&&now-lastLabelAt>6000){lastLabelAt=now;
    var top=(tk.devs||[]).filter(function(d){return matches(d.ip);})[0];
    var t=dev(top&&top.ip);
    cv.setAttribute('aria-label','Live network traffic for '+scopeName()+'. '+rateStr(s.total)+' in total, '
      +rateStr(s.down)+' coming in and '+rateStr(s.up)+' going out. '
      +(top?('Busiest device: '+((t&&t.label)||top.ip)+' at '+rateStr(top.bps)+'.'):'No device traffic to attribute.')
      +' The numbers are also listed below the chart.');}
  kick();
}

function clsLabel(r){
  if(!r) return 'not on the roster';
  if(r.unassigned&&r.cls==='personal') return 'unassigned';
  return CLS[r.cls]||r.cls;
}
function talkers(tk){
  if(!elTalk)return;
  var now=Date.now();
  /* Anything moving bytes right now refreshes its stamp. */
  var live=new Map();
  (tk.devs||[]).forEach(function(d){
    if(!matches(d.ip))return;
    live.set(d.ip,d);
    if(d.bps>0) lastActive.set(d.ip,now);
  });
  /* Anything seen inside the window stays listed, so a one-tick pause cannot
     make a row vanish and pop back. Busiest first, then most recently active. */
  lastActive.forEach(function(at,ip){ if(now-at>ACTIVE_WINDOW_MS) lastActive.delete(ip); });
  var rows=[];
  lastActive.forEach(function(at,ip){
    if(!matches(ip))return;
    var d=live.get(ip)||{ip:ip,bps:0,cats:{},app:null};
    rows.push({ip:ip,bps:d.bps||0,cats:d.cats||{},app:d.app||null,quiet:now-at});
  });
  rows.sort(function(a,b){return (b.bps-a.bps)||(a.quiet-b.quiet);});
  rows=rows.slice(0,10);
  /* Devices with no traffic at all still deserve a line when the filter is
     narrow, so "nothing is happening" is visible rather than a blank card. */
  if(!rows.length){
    var idle=[];
    roster.forEach(function(r){if(matches(r.ip)&&r.online&&idle.length<6)idle.push({ip:r.ip,bps:0,cats:{},idle:true,quiet:-1});});
    rows=idle;
  }
  var want=rows.map(function(d){return d.ip;}).slice().sort().join(',');
  if(elTalk.dataset.key!==want){
    elTalk.dataset.key=want; elTalk.textContent=''; sparks.clear();
    if(!rows.length){var e=document.createElement('div');e.className='lvempty';
      e.textContent='Nothing on the wire for this filter right now.';elTalk.appendChild(e);return;}
    rows.forEach(function(d){
      var r=dev(d.ip);
      var row=document.createElement('div');row.className='tk';row.dataset.ip=d.ip;
      var name=document.createElement('div');name.className='tkname';
      var b=document.createElement('b');b.textContent=(r&&r.label)||d.ip;name.appendChild(b);
      var badge=document.createElement('span');badge.className='tkcls'+(r&&r.unassigned&&r.cls==='personal'?' unassigned':'');
      badge.textContent=clsLabel(r);name.appendChild(badge);
      var whoEl=document.createElement('span');whoEl.className='tkwho';
      whoEl.textContent=(r&&r.person)?r.person:(r&&r.cls!=='personal'?'household':'nobody yet');name.appendChild(whoEl);
      var app=document.createElement('span');app.className='tkapp';name.appendChild(app);
      row.appendChild(name);
      var val=document.createElement('div');val.className='tkval';
      var vb=document.createElement('b');var vi=document.createElement('i');
      val.appendChild(vb);val.appendChild(vi);row.appendChild(val);
      var sc=document.createElement('canvas');sc.className='lvspark';sc.setAttribute('aria-hidden','true');
      var wrap=document.createElement('div');wrap.className='tkspark';wrap.appendChild(sc);row.appendChild(wrap);
      if(r&&r.unassigned&&r.cls==='personal'&&r.mac&&people.length){
        var af=document.createElement('div');af.className='tkassign';
        var lab=document.createElement('input');lab.id='lbl_'+r.mac;lab.placeholder='Name this device';
        lab.setAttribute('aria-label','Name for '+r.mac);
        var sel=document.createElement('select');sel.id='who_'+r.mac;
        sel.setAttribute('aria-label','Owner for '+r.mac);
        people.forEach(function(p){var o=document.createElement('option');o.value=p.name;o.textContent=p.name;sel.appendChild(o);});
        var btn=document.createElement('button');btn.className='approve';btn.type='button';btn.textContent='Assign';
        btn.addEventListener('click',function(){assign(r.mac);});
        var hint=document.createElement('span');hint.className='tkwho';
        hint.textContent='Until this is assigned its traffic cannot be attributed to anyone.';
        af.appendChild(lab);af.appendChild(sel);af.appendChild(btn);af.appendChild(hint);row.appendChild(af);
      }
      elTalk.appendChild(row);
      var hue=cols.other;var best=0;
      CATS.forEach(function(c){if(c!=='other'&&(d.cats&&d.cats[c]||0)>best){best=d.cats[c];hue=cols[c];}});
      sparks.set(d.ip,{cv:sc,hue:hue,row:row,vb:vb,vi:vi,app:app});
    });
  }
  rows.forEach(function(d){
    var rec=sparks.get(d.ip); if(!rec)return;
    var r=rate(d.bps||0); rec.vb.textContent=r[0]; rec.vi.textContent=r[1];
    var resting=!(d.bps>0)&&d.quiet>0;
    rec.app.textContent=resting?('quiet for '+quietStr(d.quiet))
                               :(d.app?('mostly '+d.app):'');
    rec.row.classList.toggle('idle',!(d.bps>0));
    /* Fade rather than disappear: the row dims steadily across the window so
       a parent can see a device winding down instead of it blinking away. */
    rec.row.style.opacity=resting
      ? String(Math.max(0.4,1-0.6*(d.quiet/ACTIVE_WINDOW_MS)).toFixed(2))
      : '';
  });
  /* Busiest first, still, but by MOVING the existing rows rather than
     rebuilding them. Re-creating the card every time two devices swapped
     places was the other half of the flicker. */
  var order=rows.map(function(d){var r=sparks.get(d.ip);return r&&r.row;}).filter(Boolean);
  var same=order.length===elTalk.children.length
    &&order.every(function(n,i){return elTalk.children[i]===n;});
  if(!same) order.forEach(function(n){elTalk.appendChild(n);});
}

function table(){
  if(!elTable)return;
  var rows=hist.map(slice);
  var now=rows[rows.length-1]||{v:{},total:0};
  var body=document.createElement('tbody');
  CATS.slice().reverse().forEach(function(c){
    var vals=rows.map(function(r){return r.v[c]||0;});
    var pk=Math.max.apply(null,vals.concat([0]));
    var av=vals.length?vals.reduce(function(a,b){return a+b;},0)/vals.length:0;
    var tr=document.createElement('tr');
    [LABELS[c],rateStr(now.v[c]||0),rateStr(av),rateStr(pk)].forEach(function(t,i){
      var td=document.createElement('td');if(i)td.className='num';td.textContent=t;tr.appendChild(td);});
    body.appendChild(tr);
  });
  var totals=rows.map(function(r){return r.total;});
  var tr=document.createElement('tr');
  [['Everything',1],[rateStr(now.total),0],
   [rateStr(totals.reduce(function(a,b){return a+b;},0)/(totals.length||1)),0],
   [rateStr(Math.max.apply(null,totals.concat([0]))),0]].forEach(function(p,i){
    var td=document.createElement('td');if(i)td.className='num';
    var b=document.createElement('b');b.textContent=p[0];td.appendChild(b);tr.appendChild(td);});
  body.appendChild(tr);
  var old=elTable.tBodies[0]; if(old)elTable.replaceChild(body,old); else elTable.appendChild(body);
}

/* ---- crosshair -------------------------------------------------------- */
function idxAt(clientX){
  if(!geo||!cv)return -1;
  var b=cv.getBoundingClientRect();
  var x=clientX-b.left;
  var i=Math.round(geo.base-(geo.L+geo.pw-x)/geo.stepX);
  return Math.max(0,Math.min(geo.pts.length-1,i));
}
function showTip(i,cx,cy){
  if(!tip||!geo||i<0||i>=geo.pts.length)return;
  var p=geo.pts[i], off=(geo.pts.length-1-i);
  tip.textContent='';
  var h=document.createElement('div');h.className='th';
  h.textContent=off===0?'now':(Math.round(off*tickMs/1000)+'s ago');
  tip.appendChild(h);
  var total=0;
  CATS.slice().reverse().forEach(function(c){
    var v=p.v[c]||0; total+=v; if(!(v>0))return;
    var d=document.createElement('div');d.className='tr';
    var k=document.createElement('span');k.className='tk2';k.style.background=cols[c];
    var n=document.createElement('span');n.className='tn';n.textContent=LABELS[c];
    var val=document.createElement('span');val.className='tv';val.textContent=rateStr(v);
    d.appendChild(k);d.appendChild(n);d.appendChild(val);tip.appendChild(d);});
  var d2=document.createElement('div');d2.className='tr';
  var k2=document.createElement('span');k2.className='tk2';k2.style.background='transparent';
  var n2=document.createElement('span');n2.className='tn';n2.textContent=total>0?'Everything':'Nothing on the wire';
  var v2=document.createElement('span');v2.className='tv';v2.textContent=total>0?rateStr(total):'';
  d2.appendChild(k2);d2.appendChild(n2);d2.appendChild(v2);tip.appendChild(d2);
  tip.classList.add('on');
  var w=tip.offsetWidth,hh=tip.offsetHeight;
  tip.style.left=Math.max(8,Math.min(innerWidth-w-8,cx-w/2))+'px';
  tip.style.top=Math.max(8,cy-hh-16)+'px';
}
function hideTip(){if(tip)tip.classList.remove('on');}
if(cv){
  cv.addEventListener('pointermove',function(e){hoverIdx=idxAt(e.clientX);showTip(hoverIdx,e.clientX,e.clientY);kick();},{passive:true});
  cv.addEventListener('pointerleave',function(){hoverIdx=-1;hideTip();kick();},{passive:true});
  cv.addEventListener('keydown',function(e){
    if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
    e.preventDefault();
    var n=geo?geo.pts.length:0; if(!n)return;
    if(focusIdx<0)focusIdx=n-1;
    focusIdx=Math.max(0,Math.min(n-1,focusIdx+(e.key==='ArrowRight'?1:-1)));
    var b=cv.getBoundingClientRect();
    showTip(focusIdx,b.left+b.width*((focusIdx+0.5)/n),b.top+b.height*0.3);kick();});
  cv.addEventListener('blur',function(){focusIdx=-1;hideTip();kick();});
  addEventListener('scroll',hideTip,{passive:true});
  addEventListener('resize',kick,{passive:true});
}

/* ---- filters ---------------------------------------------------------- */
root.querySelectorAll('.fchip').forEach(function(btn){
  btn.addEventListener('click',function(){
    var g=btn.dataset.group;
    root.querySelectorAll('.fchip[data-group="'+g+'"]').forEach(function(o){o.setAttribute('aria-pressed',String(o===btn));});
    if(g==='who')who=btn.dataset.val; else cls=btn.dataset.val;
    if(elTalk)elTalk.dataset.key='';
    peakSeen=0; paint.scale={};
    render(hist[hist.length-1]); table();
  });
});

/* ---- the stream ------------------------------------------------------- */
function note(){
  if(!elNote)return;
  var bits=[];
  bits.push(filtered()
    ? 'Filtered figures are added up from each device\\u2019s own byte counters in the firewall.'
    : 'The household figure is every byte that crossed the '+(root.dataset.iface||'kids')+' interface, named or not.');
  if(!totalsOn) bits.push('Per-device totals are off, so a device only reports traffic Genkan can put a name to.');
  bits.push('Downloads (a game or system update) are shown as bandwidth and never charged as screen time.');
  bits.push('Reading only: Genkan never resets these counters, so the daily metering is unaffected.');
  elNote.textContent=bits.join(' ');
}
function connect(){
  var es=new EventSource('/api/stream');
  es.addEventListener('hello',function(e){
    var m=JSON.parse(e.data);
    tickMs=m.tickMs||1500; totalsOn=!!m.totals;
    roster=new Map((m.devices||[]).map(function(d){return [d.ip,d];}));
    hist=m.history||[]; lastAt=Date.now(); connected=true;
    if(elTalk)elTalk.dataset.key='';
    note(); render(hist[hist.length-1]); table(); kick();
  });
  es.addEventListener('roster',function(e){
    var m=JSON.parse(e.data);
    roster=new Map((m.devices||[]).map(function(d){return [d.ip,d];}));
    if(elTalk)elTalk.dataset.key='';
  });
  es.addEventListener('tick',function(e){
    var tk=JSON.parse(e.data);
    totalsOn=!!tk.totals;
    hist.push(tk); if(hist.length>240)hist.splice(0,hist.length-240);
    lastAt=Date.now(); connected=true; render(tk);
  });
  es.onerror=function(){
    connected=false;
    if(elLed)elLed.className='lvled warn';
    if(elState)elState.textContent='reconnecting\\u2026';
    kick();
  };
  es.onopen=function(){connected=true;kick();};
}
connect();
kick();
})();
`;

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------
// Bottom of the stack first, so reversing this gives the legend the same
// top-to-bottom order the bands are drawn in.
const CAT_LEGEND = [
  ["other", "Other online"], ["gaming", "Gaming"], ["video", "Video"],
  ["social", "Social"], ["download", "Downloads"],
];

function filterRow(label, group, opts) {
  return `<div class="lvfilters" role="group" aria-label="${esc(label)}">`
    + `<span class="lab">${esc(label)}</span>`
    + opts.map(o => `<button type="button" class="fchip" data-group="${esc(group)}" data-val="${esc(o.val)}"`
      + ` aria-pressed="${o.on ? "true" : "false"}">${esc(o.label)}</button>`).join("")
    + `</div>`;
}

// The live page. "What is my house doing on the network right now", with the
// per-person view as one lens on it rather than the only frame.
export function livePage(s) {
  const people = (s.children || []).map(c => ({ id: c.id, name: c.name }));
  const whoOpts = [{ val: "all", label: "Everyone", on: true }]
    .concat(people.map(p => ({ val: `p:${p.id}`, label: p.name })))
    .concat([{ val: "none", label: "Unassigned" }]);
  const clsOpts = [
    { val: "all", label: "All devices", on: true },
    { val: "personal", label: "People" },
    { val: "shared", label: "Shared" },
    { val: "iot", label: "Smart home" },
    { val: "infra", label: "Infrastructure" },
  ];
  const unassigned = (s.devices || []).filter(d => d.unassigned && d.category === "personal"
    && !["ap", "infra", "gateway"].includes(d.device_kind)).length;

  return `<div id="lv" data-mode="page" data-iface="kids0"
      data-people='${esc(JSON.stringify(people.map(p => ({ id: p.id, name: p.name }))))}'>
  ${filterRow("Who", "who", whoOpts)}
  ${filterRow("What", "cls", clsOpts)}

  <div class="card lvhero" id="lvhero">
    <div class="lvtop"><span class="lvled" id="lvled"></span>
      <span class="lvscope" id="lvscope">The whole house</span>
      <span class="lvstate" id="lvstate">connecting&hellip;</span></div>
    <div class="lvfig" id="lvfig"><b id="lvdown">0</b><i id="lvunit">B/s</i></div>
    <p class="lvcap" id="lvcap">across the whole house right now. <b id="lvup">&nbsp;</b> &middot; busiest so far <b id="lvpeak">&nbsp;</b></p>
    <canvas id="lvcanvas" class="lvchart" tabindex="0" role="img"
      aria-label="Live network traffic. The same numbers are listed below the chart."></canvas>
    <ul class="legend">${CAT_LEGEND.slice().reverse().map(([k, l]) =>
    `<li><span class="swatch" style="background:var(--s-${k})"></span>${esc(l)}</li>`).join("")}</ul>
    <p class="lvnote" id="lvnote"></p>
    <details class="tview"><summary>Show the numbers</summary><div class="tscroll">
      <table id="lvtable"><thead><tr><th>Kind of traffic</th><th class="num">Now</th>
        <th class="num">Average</th><th class="num">Busiest</th></tr></thead></table>
    </div></details>
  </div>

  <div class="card">
    <h2>Who is using it right now</h2>
    <p class="sub">Sorted by how much each device is moving this second. Anything that has moved a
      byte in the last five minutes stays on the list and fades rather than dropping out, so a
      device that pauses does not blink in and out. A device has to have an
      owner before its traffic can be counted towards anybody, so anything still unassigned can be
      claimed right here.${unassigned ? ` <b>${unassigned} device${unassigned > 1 ? "s are" : " is"} still unassigned.</b>` : ""}</p>
    <div id="lvtalkers"><div class="lvempty">Waiting for the first reading&hellip;</div></div>
  </div>

  <div class="card flat"><p class="foot">Smart home kit and the gear that runs the network are part of this
    picture on purpose: a camera uploading all evening is as worth seeing as a console downloading a game.
    Use the filters above to narrow it to one person or one class of device.</p></div>
  <div id="lvtip" role="tooltip" aria-hidden="true"></div>
</div>`;
}

// The compact strip that makes the Home page feel awake. Same stream, same
// drawing code, no filters: a number, a moving line, and a way in.
export function liveStrip() {
  return `<a class="card" href="/live" id="lv" data-mode="strip" data-iface="kids0" data-people="[]"
      style="text-decoration:none;display:block">
    <div class="lvstrip">
      <div class="lvsfig"><span>On the wire now</span>
        <b id="lvdown">0</b><i id="lvunit">B/s</i>
        <span id="lvstate" style="text-transform:none;letter-spacing:0">connecting&hellip;</span></div>
      <div class="lvschart"><canvas id="lvcanvas" class="lvchart" style="height:56px"
        role="img" aria-label="Live household network traffic. Open the Right now page for the numbers."></canvas></div>
      <span class="lvsgo" aria-hidden="true">&rsaquo;</span>
    </div>
    <span class="lvled" id="lvled" hidden></span>
    <span id="lvup" hidden></span><span id="lvpeak" hidden></span>
    <div id="lvtip" role="tooltip" aria-hidden="true"></div>
  </a>`;
}
