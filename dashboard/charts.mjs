// Genkan dashboard: charts.
//
// Every chart here is self-contained inline SVG. No library, no CDN, no web
// font, nothing fetched: the dashboard has to work on the tailnet with the
// house internet off, which is exactly when a parent is most likely to open it.
//
// Responsiveness without a viewBox: the SVG is width:100% with a fixed pixel
// height, x positions are ordinary SVG percentages, and mark widths are a CSS
// custom property (`--bw`) that caps the bar in pixels. Text therefore never
// scales with the container, so a 360px phone gets the same legible 10px
// labels as a desktop, and a bar never grows into a slab on a wide screen.
// Every mark also carries plain percentage x/width attributes, so a renderer
// that ignores CSS geometry properties still draws the right chart, just
// without the pixel cap.
//
// Accessibility, applied consistently:
//   * a legend whenever there are two or more series, and direct labels on the
//     short (7 day) view, so identity is never colour alone;
//   * every chart is paired with a real table of the same numbers;
//   * each column is focusable and shows the same readout on focus as on hover;
//   * light and dark are separately chosen steps of the same hues, not a flip.

import { SERIES, fmt } from "./analytics.mjs";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const BAR_CAP = 24;       // house style: a bar is never thicker than this
const BAR_FILL = 0.58;    // the rest of the slot is deliberately air
const GUTTER = 40;        // left gutter in px, so the y ticks never sit under a bar

// Round a maximum up to something a human reads without effort.
function niceMax(v) {
  if (!(v > 0)) return 10;
  const steps = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480, 600, 720, 960, 1200, 1440];
  for (const s of steps) if (v <= s) return s;
  return Math.ceil(v / 240) * 240;
}

// Tick values a person reads without doing arithmetic: pick the number of
// bands whose step lands on a round number of minutes, and always label zero.
const NICE_STEPS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 300, 360];
function ticks(max) {
  const n = [4, 3, 2].find(k => max % k === 0 && NICE_STEPS.includes(max / k)) || 2;
  return Array.from({ length: n + 1 }, (_, i) => Math.round(max * (n - i) / n));
}

// Direct labels have to fit inside one column on a 360px phone, so they use a
// compact form of the same unit the axis uses: 45, 1h, 1h30. Never a bare
// minute count in the hundreds, which reads as a quantity with no unit.
function compactMin(v) {
  const m = Math.round(v || 0);
  if (m < 60) return String(m);
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

// A tooltip payload: [[label, value, colourVar|null], ...]. Read with
// textContent on the client, never innerHTML, because domain and service names
// are data we did not write.
const tip = rows => esc(JSON.stringify(rows));

// ---------------------------------------------------------------------------
// Stacked / diverging column chart
// ---------------------------------------------------------------------------
//
// cols:   [{ key, label, sub, segs:[{key,value}], up:[...], down:[...], note }]
// series: [{ key, label }]  keys index SERIES for colour
//
export function columns({
  cols, series, height = 132, showValues = null,
  diverging = false, upSeries = [], downSeries = [], title = "",
  // Added for the child page's lookup charts: the y ticks default to
  // minutes, which is what every chart here showed until then. A chart of
  // counts passes its own formatter (fmt.count) so "15 lookups" is never
  // labelled "15 min".
  tickFormat = fmt.min,
}) {
  const n = Math.max(1, cols.length);
  const slotPct = 100 / n;
  const barPct = slotPct * BAR_FILL;
  const TOP = 18, AXIS = 22;
  const H = TOP + height + AXIS;
  const direct = showValues === null ? n <= 10 : showValues;

  const val = (c, k) => Number((c.segs || []).find(s => s.key === k)?.value || 0);
  const upTotal = c => upSeries.reduce((a, k) => a + val(c, k), 0);
  const downTotal = c => downSeries.reduce((a, k) => a + val(c, k), 0);
  const total = c => (c.segs || []).reduce((a, s) => a + Number(s.value || 0), 0);

  let maxUp = 0, maxDown = 0;
  for (const c of cols) {
    if (diverging) { maxUp = Math.max(maxUp, upTotal(c)); maxDown = Math.max(maxDown, downTotal(c)); }
    else maxUp = Math.max(maxUp, total(c));
  }
  const scaleMax = niceMax(Math.max(maxUp, maxDown));
  // Diverging: the zero line sits in the middle so up and down share one scale.
  const zeroY = diverging ? TOP + height / 2 : TOP + height;
  const armH = diverging ? height / 2 : height;
  const px = v => (scaleMax > 0 ? (v / scaleMax) * armH : 0);

  // --- chrome ---------------------------------------------------------------
  // Ticks live in a fixed left gutter on the OUTER svg; the plot is a nested
  // svg inset by that gutter, so a value label can never end up underneath a
  // bar. Percentages inside the nested svg resolve against the nested viewport,
  // which is exactly the plot width.
  let grid = "", axis = "";
  const tickAt = (y, text) => { axis += `<text class="tick" x="0" y="${y - 3}">${esc(text)}</text>`; };
  if (diverging) {
    for (const f of [0.5, 1]) {
      const v = Math.round(scaleMax * f);
      for (const dir of [-1, 1]) {
        const y = zeroY - dir * px(v);
        grid += `<line class="grid" x1="0" x2="100%" y1="${y}" y2="${y}"/>`;
        tickAt(y, tickFormat(v));
      }
    }
    grid += `<line class="axis" x1="0" x2="100%" y1="${zeroY}" y2="${zeroY}"/>`;
    tickAt(zeroY, "0");
  } else {
    for (const t of ticks(scaleMax)) {
      const y = zeroY - px(t);
      grid += `<line class="grid" x1="0" x2="100%" y1="${y}" y2="${y}"/>`;
      tickAt(y, t === 0 ? "0" : tickFormat(t));
    }
    grid += `<line class="axis" x1="0" x2="100%" y1="${zeroY}" y2="${zeroY}"/>`;
  }

  // --- one column -----------------------------------------------------------
  const stack = (c, keys, dir) => {
    // dir 1 = up from the zero line, -1 = down. Draw the outer (data) end first
    // so the 4px rounding lands there and the baseline stays square.
    const drawn = keys.map(k => ({ k, v: val(c, k) })).filter(s => s.v > 0);
    if (!drawn.length) return "";
    let out = "", cum = 0;
    drawn.forEach((s, i) => {
      const isEnd = i === drawn.length - 1;      // the outermost segment
      const h0 = px(s.v);
      const gap = i === 0 ? 0 : 2;               // 2px of surface between fills
      const h = Math.max(1, h0 - gap);
      const y = dir > 0 ? zeroY - cum - h0 : zeroY + cum + gap;
      cum += h0;
      const fill = `var(--s-${s.k})`;
      if (isEnd && h > 5) {
        // Rounded data-end, squared off again by a second rect of the same
        // colour: rx alone would round the baseline corners too.
        out += `<rect class="seg" y="${y}" height="${h}" rx="4" fill="${fill}"${geo(c.i)}/>`;
        out += `<rect class="seg" y="${dir > 0 ? y + 4 : y}" height="${Math.max(0, h - 4)}" fill="${fill}"${geo(c.i)}/>`;
      } else {
        out += `<rect class="seg" y="${y}" height="${h}" fill="${fill}"${geo(c.i)}/>`;
      }
    });
    return out;
  };
  // Attribute fallback: plain SVG percentages, which every renderer understands.
  // The stylesheet then narrows the bar to the pixel cap on a wide screen.
  const geo = i => ` x="${((i + 0.5) * slotPct - barPct / 2).toFixed(3)}%" width="${barPct.toFixed(3)}%"`;

  let body = "", labels = "";
  cols.forEach((c, i) => {
    c.i = i;
    const cx = (i + 0.5) * slotPct;
    const rows = (c.segs || []).filter(s => Number(s.value) > 0)
      .map(s => [SERIES[s.key]?.label || s.key, tickFormat(s.value), s.key]);
    if (!rows.length) rows.push(["Nothing recorded", "", null]);
    const marks = diverging
      ? stack(c, upSeries, 1) + stack(c, downSeries, -1)
      : stack(c, (series || []).map(s => s.key), 1);

    body += `<g class="col" style="--cx:${cx.toFixed(3)}%" tabindex="0"`
      + ` data-head="${esc(c.label)}" data-tip="${tip(rows)}">`
      + `<title>${esc(c.label)}: ${esc(c.summary || tickFormat(total(c)))}</title>`
      + marks
      + `<rect class="hit" x="${(i * slotPct).toFixed(3)}%" width="${slotPct.toFixed(3)}%" y="0" height="${TOP + height}"/>`
      + `</g>`;

    // Direct labels on the short view, so no value depends on hovering.
    if (direct) {
      if (diverging) {
        const u = upTotal(c), d = downTotal(c);
        if (u > 0) labels += `<text class="dval" x="${cx}%" y="${zeroY - px(u) - 5}">${esc(compactMin(u))}</text>`;
        if (d > 0) labels += `<text class="dval" x="${cx}%" y="${zeroY + px(d) + 12}">${esc(compactMin(d))}</text>`;
      } else {
        const t = total(c);
        if (t > 0) labels += `<text class="dval" x="${cx}%" y="${zeroY - px(t) - 5}">${esc(compactMin(t))}</text>`;
      }
    }
    // X axis: every column when there are few, every fifth when there are many.
    const showTick = n <= 10 || i === n - 1 || i % 5 === 0;
    if (showTick) {
      labels += `<text class="xlab" x="${cx}%" y="${TOP + height + 15}">${esc(c.sub || c.label)}</text>`;
    }
  });

  return `<svg class="chart" width="100%" height="${H}" role="img"`
    + ` aria-label="${esc(title || "chart")}">`
    + `<g class="ticks">${axis}</g>`
    + `<svg class="plot" x="${GUTTER}" y="0" width="90%" height="${H}" overflow="visible"`
    + ` style="width:calc(100% - ${GUTTER}px);--bw:min(${BAR_CAP}px,${barPct.toFixed(3)}%);--slot:${slotPct.toFixed(3)}%">`
    + grid + body + labels + `</svg></svg>`;
}

// ---------------------------------------------------------------------------
// Legend. Always present for two or more series.
// ---------------------------------------------------------------------------
export function legend(keys, { note = "" } = {}) {
  if (!keys || keys.length < 2) return note ? `<p class="cnote">${esc(note)}</p>` : "";
  return `<ul class="legend">` + keys.map(k => {
    const s = SERIES[k] || { label: k };
    return `<li><span class="swatch" style="background:var(--s-${k})"></span>${esc(s.label)}</li>`;
  }).join("") + `</ul>` + (note ? `<p class="cnote">${esc(note)}</p>` : "");
}

// ---------------------------------------------------------------------------
// Horizontal ranked bars: the per-service breakdown.
// ---------------------------------------------------------------------------
// rows: [{ label, emoji, value, display, sub, key }]  key indexes SERIES, or
// null for "we do not meter this", which draws in the de-emphasis grey.
export function ranked(rows, { max = null, height = 34, title = "" } = {}) {
  if (!rows.length) return "";
  const top = max || Math.max(...rows.map(r => Number(r.value) || 0), 1);
  const H = rows.length * height + 4;
  let out = "";
  rows.forEach((r, i) => {
    const y = i * height;
    const f = Math.max(0, Math.min(1, (Number(r.value) || 0) / top));
    // The track stops short of the right edge so the value column always has
    // room: full width minus 96px. calc() is only valid in CSS, so the plain
    // percentage stays on the attribute as the fallback.
    const fill = r.key ? `var(--s-${r.key})` : "var(--ink-muted)";
    out += `<g class="rrow" tabindex="0"><title>${esc(r.label)}: ${esc(r.display)}${r.sub ? " · " + esc(r.sub) : ""}</title>`
      + `<text class="rlab" x="0" y="${y + 12}">${esc((r.emoji ? r.emoji + " " : "") + r.label)}</text>`
      + `<text class="rval" x="100%" y="${y + 12}">${esc(r.display)}</text>`
      + `<rect class="rtrack" x="0" y="${y + 18}" height="8" rx="4" width="86%"`
      + ` style="width:calc(100% - 96px)"/>`
      + `<rect class="rbar" x="0" y="${y + 18}" height="8" rx="4" width="${(f * 86).toFixed(2)}%"`
      + ` style="width:calc((100% - 96px) * ${f.toFixed(4)})" fill="${fill}"/>`
      + `</g>`;
  });
  return `<svg class="chart ranked" width="100%" height="${H}" role="img" aria-label="${esc(title)}">${out}</svg>`;
}

// ---------------------------------------------------------------------------
// Sparkline for a stat tile. Small and fixed, so a viewBox is safe here: there
// is no text inside it to distort.
// ---------------------------------------------------------------------------
export function sparkline(values, { w = 108, h = 26, key = null } = {}) {
  const v = (values || []).map(x => Number(x) || 0);
  if (v.length < 2) return "";
  // A flat line along the floor is not information, it is decoration. An empty
  // series draws nothing and lets the tile's own empty wording do the talking.
  if (!v.some(x => x > 0)) return "";
  const max = Math.max(...v, 1);
  const step = w / (v.length - 1);
  const y = x => h - 3 - (x / max) * (h - 6);
  const pts = v.map((x, i) => `${(i * step).toFixed(1)},${y(x).toFixed(1)}`).join(" ");
  const last = v[v.length - 1];
  const stroke = key ? `var(--s-${key})` : "var(--ink-muted)";
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".55"/>`
    + `<circle cx="${(w).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.5" fill="${stroke}" stroke="var(--surface)" stroke-width="2"/>`
    + `</svg>`;
}

// ---------------------------------------------------------------------------
// Meter: one ratio against a limit. Track is a lighter step of the fill's own
// ramp, so the state reads across the whole bar rather than only the filled part.
// ---------------------------------------------------------------------------
export function meter(used, limit, { key = "gaming", label = "" } = {}) {
  const lim = Number(limit) || 0;
  const u = Math.max(0, Number(used) || 0);
  const pct = lim > 0 ? Math.min(100, (u / lim) * 100) : 0;
  const over = lim > 0 && u >= lim;
  const near = lim > 0 && !over && u / lim >= 0.8;
  const state = over ? "over" : near ? "near" : "ok";
  return `<div class="meter ${state}" role="img" aria-label="${esc(label)}: ${esc(fmt.min(u))} of ${esc(lim ? fmt.min(lim) : "no limit")}">`
    + `<div class="mtrack" style="--mc:var(--s-${key})"><div class="mfill" style="width:${pct.toFixed(1)}%"></div></div></div>`;
}

// ---------------------------------------------------------------------------
// The table twin. Every chart ships with one, so no value is gated behind a
// hover and colour is never the only channel.
// ---------------------------------------------------------------------------
export function table(head, rows, { summary = "Show the numbers" } = {}) {
  return `<details class="tview"><summary>${esc(summary)}</summary>`
    + `<div class="tscroll"><table><thead><tr>`
    + head.map((h, i) => `<th${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")
    + `</tr></thead><tbody>`
    + rows.map(r => `<tr>` + r.map((c, i) => `<td${i ? ' class="num"' : ""}>${esc(c)}</td>`).join("") + `</tr>`).join("")
    + `</tbody></table></div></details>`;
}

export { esc };

// ---------------------------------------------------------------------------
// Goal bar: one week's progress against one agreed target.
//
// Not a gauge and not a scoreboard. The track is scaled to whichever is larger
// of "where they are" and "where they said they would be", so the target tick
// is always on screen and the gap is always readable. State is carried by a
// word and a glyph as well as by colour, because a red bar on its own is just
// a red bar.
//
// g is a goalProgress() result: { metric, direction, used, target, state,
// headline, elapsed }.
// ---------------------------------------------------------------------------
export function goalBar(g) {
  const scale = Math.max(g.used, g.target, 1);
  const fillPct = Math.min(100, (g.used / scale) * 100);
  const markPct = Math.min(100, (g.target / scale) * 100);
  const glyph = { met: "✓", ok: "✓", near: "!", over: "!", behind: "→" }[g.state] || "·";
  const aim = g.direction === "at_least"
    ? `at least ${fmt.min(g.target)} a week`
    : `no more than ${fmt.min(g.target)} a week`;
  return `<div class="goal ${esc(g.state)}">
    <div class="ghead"><span class="gname">${esc(g.metric.label)}<span class="gaim">${esc(aim)}</span></span>
      <b class="gval">${esc(fmt.min(g.used))}</b></div>
    <div class="gtrack" style="--mc:var(--s-${esc(g.metric.key)})" role="img"
         aria-label="${esc(g.metric.label)}: ${esc(fmt.min(g.used))} of a ${esc(aim)} goal. ${esc(g.headline)}.">
      <div class="gfill" style="width:${fillPct.toFixed(1)}%"></div>
      <div class="gmark" style="left:${markPct.toFixed(1)}%"></div></div>
    <div class="gfoot"><span class="gstate"><span aria-hidden="true">${glyph}</span> ${esc(g.headline)}</span>
      <span class="gaim">${g.elapsed < 7 ? `day ${g.elapsed} of 7` : "full week"}</span></div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Line and area chart, for a value sampled over time.
//
// The column chart above answers "how much, per day". This one answers "what
// has it been doing for the last half hour", which is a different shape: many
// more points than columns, no gaps between them, and a line that has to stay
// readable when two of them are drawn on the same plot.
//
// Geometry, the same problem columns() solves and the same answer, with one
// addition. Text must never scale with the container, so every label lives in
// the outer svg (or in a nested svg with no viewBox), where an SVG percentage
// resolves against real pixels. The marks, though, need a coordinate system:
// polyline points cannot be percentages. So the plot is a nested svg with
// viewBox "0 0 1000 <height>" and preserveAspectRatio="none": the y scale is
// exactly 1 because the viewBox height matches the pixel height, and only x
// stretches. Non-uniform scaling would smear the stroke, so every stroked mark
// carries vector-effect="non-scaling-stroke" and comes out the same weight on
// a phone and on a desktop.
//
// Everything is given a stable id, because the System page redraws these in
// place from its event stream: the client rewrites points, d and the tick
// labels, and never rebuilds the DOM.
// ---------------------------------------------------------------------------
export const LINE_VB = 1000;      // plot width in user units
const LINE_GUTTER = 46;           // default px reserved on the left for the y ticks
export const LINE_TOP = 9;        // px of headroom above the scale maximum
const LINE_XBAND = 19;            // px reserved below the plot for time labels

// Map a value to a y in plot user units. Exported so the client that updates
// the chart uses exactly the same arithmetic as the server that drew it.
export function lineY(v, max, plotH) {
  const f = max > 0 ? Math.max(0, Math.min(1, v / max)) : 0;
  return LINE_TOP + (1 - f) * (plotH - LINE_TOP);
}

// series: [{ key, label, colour, values }]  values may contain nulls, which
//         are gaps in the reading and are simply not drawn.
// ticks:  [{ v, label }] from the top down. xlabels: [string] left to right.
export function lines({
  series = [], max = 100, ticks = [], xlabels = [],
  height = 152, id = "ln", title = "", empty = "No readings yet.",
  gutter = LINE_GUTTER,
}) {
  const plotH = height;
  const H = plotH + LINE_XBAND;
  const any = series.some(s => (s.values || []).some(v => v !== null && v !== undefined));

  let grid = "", yticks = "";
  for (const t of ticks) {
    const y = lineY(t.v, max, plotH);
    grid += `<line class="grid" x1="0" x2="${LINE_VB}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" vector-effect="non-scaling-stroke"/>`;
    // The anchor is inline rather than an attribute on purpose: the shared
    // chart stylesheet sets text-anchor on .xlab, and a CSS property always
    // beats a presentation attribute. Inline style is the one thing that wins.
    yticks += `<text class="tick" x="${gutter - 7}" y="${(y + 3.2).toFixed(1)}" style="text-anchor:end">${esc(t.label)}</text>`;
  }

  let defs = "", marks = "";
  series.forEach((s, i) => {
    const gid = `${id}-g${i}`;
    defs += `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0" stop-color="${s.colour}" stop-opacity=".30"/>`
      + `<stop offset="1" stop-color="${s.colour}" stop-opacity="0"/></linearGradient>`;
    const { pts, area } = linePath(s.values || [], max, plotH);
    marks += `<path class="larea" id="${id}-a${i}" d="${area}" fill="url(#${gid})"/>`
      + `<polyline class="lline" id="${id}-l${i}" points="${pts}" fill="none" stroke="${s.colour}"`
      + ` stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  });

  const xs = xlabels.length ? xlabels : ["", "", ""];
  const anchor = i => (i === 0 ? "start" : i === xs.length - 1 ? "end" : "middle");
  const atPct = i => (xs.length < 2 ? 0 : (i / (xs.length - 1)) * 100);
  const xband = xs.map((l, i) =>
    `<text class="xlab" id="${id}-x${i}" x="${atPct(i).toFixed(2)}%" y="13"`
    + ` style="text-anchor:${anchor(i)}">${esc(l)}</text>`).join("");

  const plotStyle = `width:calc(100% - ${gutter}px)`;
  return `<svg class="chart lchart" width="100%" height="${H}" role="img" aria-label="${esc(title || "chart")}"`
    + ` data-max="${max}" data-ploth="${plotH}">`
    + `<defs>${defs}</defs>`
    + `<g class="ticks" id="${id}-ticks">${yticks}</g>`
    + `<svg class="plot" id="${id}-plot" x="${gutter}" y="0" width="90%" height="${plotH}"`
    + ` viewBox="0 0 ${LINE_VB} ${plotH}" preserveAspectRatio="none" style="${plotStyle}">`
    + grid + (any ? marks : "") + `</svg>`
    + `<svg class="xband" x="${gutter}" y="${plotH}" width="90%" height="${LINE_XBAND}" style="${plotStyle}">`
    + xband + `</svg>`
    + (any ? "" : `<text class="lempty" x="50%" y="${(plotH / 2).toFixed(0)}" text-anchor="middle">${esc(empty)}</text>`)
    + `</svg>`;
}

// The two strings a line needs: the polyline points, and the closed path that
// fills the area under it. Nulls break neither, they are just left out.
export function linePath(values, max, plotH) {
  const n = values.length;
  if (n < 2) return { pts: "", area: "" };
  const step = LINE_VB / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    out.push([i * step, lineY(v, max, plotH)]);
  }
  if (out.length < 2) return { pts: "", area: "" };
  const pts = out.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = out[0], last = out[out.length - 1];
  const area = `M${first[0].toFixed(1)},${plotH} L` + pts.split(" ").join(" L")
    + ` L${last[0].toFixed(1)},${plotH} Z`;
  return { pts, area };
}

// ---------------------------------------------------------------------------
// Stacked column chart for COUNTS: lookups per hour or per day, stacked by
// person or by reason. The columns() chart above is for minutes and says so on
// every tick and in every tooltip, which is exactly why it must not be reused
// for a lookup count (analytics.mjs, HONESTY RULES: lookups are never labelled
// as minutes). Same geometry, same gutter, same hit targets and tooltip
// contract, different unit.
//
// cols:   [{ label, sub, values: { key: n } }]
// series: [{ key, label }]  key names a palette slot (--s-<key>), label is
//         whatever the slot stands for here (a person, a reason).
// unit:   the word after the number in tooltips and titles.
// ---------------------------------------------------------------------------
function niceCount(v) {
  if (!(v > 0)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
function countTicks(max) {
  const n = max % 4 === 0 && max >= 20 ? 4 : 2;
  return Array.from({ length: n + 1 }, (_, i) => Math.round(max * (n - i) / n));
}

export function countColumns({ cols, series, height = 132, title = "", unit = "lookups", xEvery = null, showValues = null }) {
  const n = Math.max(1, cols.length);
  const slotPct = 100 / n;
  const barPct = slotPct * BAR_FILL;
  const TOP = 18, AXIS = 22;
  const H = TOP + height + AXIS;
  const direct = showValues === null ? n <= 10 : showValues;
  const every = xEvery || (n <= 10 ? 1 : 5);
  const val = (c, k) => Number((c.values || {})[k] || 0);
  const total = c => series.reduce((a, s) => a + val(c, s.key), 0);
  const scaleMax = niceCount(Math.max(0, ...cols.map(total)));
  const zeroY = TOP + height;
  const px = v => (scaleMax > 0 ? (v / scaleMax) * height : 0);

  let grid = "", axis = "";
  for (const t of countTicks(scaleMax)) {
    const y = zeroY - px(t);
    grid += `<line class="grid" x1="0" x2="100%" y1="${y}" y2="${y}"/>`;
    axis += `<text class="tick" x="0" y="${y - 3}">${esc(t === 0 ? "0" : fmt.count(t))}</text>`;
  }
  grid += `<line class="axis" x1="0" x2="100%" y1="${zeroY}" y2="${zeroY}"/>`;

  const geo = i => ` x="${((i + 0.5) * slotPct - barPct / 2).toFixed(3)}%" width="${barPct.toFixed(3)}%"`;
  let body = "", labels = "";
  cols.forEach((c, i) => {
    const cx = (i + 0.5) * slotPct;
    const drawn = series.map(s => ({ k: s.key, v: val(c, s.key) })).filter(s => s.v > 0);
    let marks = "", cum = 0;
    drawn.forEach((s, j) => {
      const isEnd = j === drawn.length - 1;
      const h0 = px(s.v);
      const gap = j === 0 ? 0 : 2;
      const h = Math.max(1, h0 - gap);
      const y = zeroY - cum - h0;
      cum += h0;
      const fill = `var(--s-${s.k})`;
      if (isEnd && h > 5) {
        marks += `<rect class="seg" y="${y}" height="${h}" rx="4" fill="${fill}"${geo(i)}/>`;
        marks += `<rect class="seg" y="${y + 4}" height="${Math.max(0, h - 4)}" fill="${fill}"${geo(i)}/>`;
      } else {
        marks += `<rect class="seg" y="${y}" height="${h}" fill="${fill}"${geo(i)}/>`;
      }
    });
    const rows = series.filter(s => val(c, s.key) > 0)
      .map(s => [s.label, `${fmt.count(val(c, s.key))} ${unit}`, s.key]);
    if (!rows.length) rows.push(["Nothing recorded", "", null]);
    const t = total(c);
    body += `<g class="col" style="--cx:${cx.toFixed(3)}%" tabindex="0"`
      + ` data-head="${esc(c.label)}" data-tip="${tip(rows)}">`
      + `<title>${esc(c.label)}: ${esc(fmt.count(t))} ${esc(unit)}</title>`
      + marks
      + `<rect class="hit" x="${(i * slotPct).toFixed(3)}%" width="${slotPct.toFixed(3)}%" y="0" height="${TOP + height}"/>`
      + `</g>`;
    if (direct && t > 0) labels += `<text class="dval" x="${cx}%" y="${zeroY - px(t) - 5}">${esc(fmt.count(t))}</text>`;
    if (i % every === 0 || i === n - 1) {
      labels += `<text class="xlab" x="${cx}%" y="${TOP + height + 15}">${esc(c.sub || c.label)}</text>`;
    }
  });

  return `<svg class="chart" width="100%" height="${H}" role="img" aria-label="${esc(title || "chart")}">`
    + `<g class="ticks">${axis}</g>`
    + `<svg class="plot" x="${GUTTER}" y="0" width="90%" height="${H}" overflow="visible"`
    + ` style="width:calc(100% - ${GUTTER}px);--bw:min(${BAR_CAP}px,${barPct.toFixed(3)}%);--slot:${slotPct.toFixed(3)}%">`
    + grid + body + labels + `</svg></svg>`;
}

// A legend whose labels are not the palette's own. legend() above reads the
// label off SERIES, which is right for gaming/video/social and wrong when the
// blue bar is a person. items: [{ key, label }].
export function legendOf(items, { note = "" } = {}) {
  const li = (items || []).map(s =>
    `<li><span class="swatch" style="background:var(--s-${esc(s.key)})"></span>${esc(s.label)}</li>`).join("");
  return (li ? `<ul class="legend">${li}</ul>` : "") + (note ? `<p class="cnote">${esc(note)}</p>` : "");
}
