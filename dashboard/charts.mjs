// Hearth dashboard: charts.
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
        tickAt(y, fmt.min(v));
      }
    }
    grid += `<line class="axis" x1="0" x2="100%" y1="${zeroY}" y2="${zeroY}"/>`;
    tickAt(zeroY, "0");
  } else {
    for (const t of ticks(scaleMax)) {
      const y = zeroY - px(t);
      grid += `<line class="grid" x1="0" x2="100%" y1="${y}" y2="${y}"/>`;
      tickAt(y, t === 0 ? "0" : fmt.min(t));
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
      .map(s => [SERIES[s.key]?.label || s.key, fmt.min(s.value), s.key]);
    if (!rows.length) rows.push(["Nothing recorded", "", null]);
    const marks = diverging
      ? stack(c, upSeries, 1) + stack(c, downSeries, -1)
      : stack(c, (series || []).map(s => s.key), 1);

    body += `<g class="col" style="--cx:${cx.toFixed(3)}%" tabindex="0"`
      + ` data-head="${esc(c.label)}" data-tip="${tip(rows)}">`
      + `<title>${esc(c.label)}: ${esc(c.summary || fmt.min(total(c)))}</title>`
      + marks
      + `<rect class="hit" x="${(i * slotPct).toFixed(3)}%" width="${slotPct.toFixed(3)}%" y="0" height="${TOP + height}"/>`
      + `</g>`;

    // Direct labels on the short view, so no value depends on hovering.
    if (direct) {
      if (diverging) {
        const u = upTotal(c), d = downTotal(c);
        if (u > 0) labels += `<text class="dval" x="${cx}%" y="${zeroY - px(u) - 5}">${esc(String(Math.round(u)))}</text>`;
        if (d > 0) labels += `<text class="dval" x="${cx}%" y="${zeroY + px(d) + 12}">${esc(String(Math.round(d)))}</text>`;
      } else {
        const t = total(c);
        if (t > 0) labels += `<text class="dval" x="${cx}%" y="${zeroY - px(t) - 5}">${esc(String(Math.round(t)))}</text>`;
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
