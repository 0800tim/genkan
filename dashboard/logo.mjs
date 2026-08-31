// The Genkan lockup, shared by the dashboard and the kid portal.
//
// Brush and machine side by side: the refined 玄 (per-stroke widths, from
// turn 3 of the logo work) and GENKAN as banded terminal block art, nine
// gradient bands, built server-side from the glyph bitmaps so every page
// carries the finished SVG and no client JS is involved. The cascade and the
// five-second glint ride on CSS and switch off under prefers-reduced-motion.
//
// Theme contract: the host page defines light values on :root, dark values
// under both [data-theme=dark] and the un-stamped prefers-color-scheme case.
// LOGO_CSS below does exactly that with the dashboard/portal convention.

const FONT = {
  G: [".11111.", "11...11", "11.....", "11.....", "11.1111", "11...11", "11...11", "11...11", ".11111."],
  E: ["1111111", "11.....", "11.....", "111111.", "11.....", "11.....", "11.....", "11.....", "1111111"],
  N: ["11...11", "111..11", "1111.11", "11.1111", "11..111", "11...11", "11...11", "11...11", "11...11"],
  K: ["11...11", "11..11.", "11.11..", "1111...", "11.11..", "11..11.", "11...11", "11...11", "11...11"],
  A: [".11111.", "11...11", "11...11", "11...11", "1111111", "11...11", "11...11", "11...11", "11...11"],
};

export function wordmarkSVG({ animate = true } = {}) {
  const parts = [];
  let col = 0;
  for (const ch of "GENKAN") {
    const g = FONT[ch];
    for (let c = 0; c < 7; c++) for (let r = 0; r < 9; r++) {
      if (g[r][c] !== "1") continue;
      const x = col + c;
      const st = animate
        ? ` style="animation-delay:${x * 52 + r * 9}ms,${2600 + x * 30}ms"` : "";
      parts.push(`<rect class="lgb lg${r}" x="${x}" y="${r}" width="0.92" height="0.92" rx="0.1"${st}/>`);
    }
    col += 8;
  }
  return `<svg class="lgm" viewBox="0 0 47 9" role="img" aria-label="Genkan" preserveAspectRatio="xMinYMid meet">${parts.join("")}</svg>`;
}

export const KANJI_SVG =
  `<svg class="lgk" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path stroke-width="8" d="M50,9 C51.5,10.5 52,12.5 52,15 L52,24"/>` +
  `<path stroke-width="9.5" d="M9,37 Q50,32.5 92,35"/>` +
  `<path stroke-width="8" d="M56,41 C52,48 44,55 33,61.5 Q29,64.5 33.5,66 L51,70.5"/>` +
  `<path stroke-width="8" d="M69,48 C64,59 50,71 29,82 Q23,85.5 30,86 L72,81.5"/>` +
  `<path stroke-width="8.5" d="M69,64 Q80,74 86,87"/></svg>`;

export const LOGO_CSS = `
.lgk{width:26px;height:24px;flex:none;color:var(--ink,#262b3d)}
.lgm{height:19px;width:auto;display:block;overflow:visible}
:root{--lg0:#1d2233;--lg1:#262b3d;--lg2:#2f3a5e;--lg3:#3d5285;--lg4:#4a66a6;
  --lg5:#5f7dc4;--lg6:#6f8fd6;--lg7:#82a1e8;--lg8:#7c5da8}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme=light])){
  --lg0:#f6f4ec;--lg1:#d7dffa;--lg2:#aebef2;--lg3:#8aa4ec;--lg4:#82a1e8;
  --lg5:#6b83cd;--lg6:#5470ae;--lg7:#3d5285;--lg8:#7c5da8}
  :root:where(:not([data-theme=light])) .lgk{color:#d8a65a;filter:drop-shadow(0 0 6px rgba(217,138,84,.35))}}
:root[data-theme=dark]{--lg0:#f6f4ec;--lg1:#d7dffa;--lg2:#aebef2;--lg3:#8aa4ec;--lg4:#82a1e8;
  --lg5:#6b83cd;--lg6:#5470ae;--lg7:#3d5285;--lg8:#7c5da8}
:root[data-theme=dark] .lgk{color:#d8a65a;filter:drop-shadow(0 0 6px rgba(217,138,84,.35))}
.lg0{fill:var(--lg0)}.lg1{fill:var(--lg1)}.lg2{fill:var(--lg2)}.lg3{fill:var(--lg3)}
.lg4{fill:var(--lg4)}.lg5{fill:var(--lg5)}.lg6{fill:var(--lg6)}.lg7{fill:var(--lg7)}.lg8{fill:var(--lg8)}
.lgb{opacity:0;transform-box:fill-box;transform-origin:center;
  animation:lg-in .3s ease-out forwards, lg-glint 5s linear infinite}
@keyframes lg-in{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.25)}100%{opacity:1;transform:scale(1)}}
@keyframes lg-glint{0%{filter:brightness(1)}4%{filter:brightness(2.1)}9%{filter:brightness(1)}100%{filter:brightness(1)}}
@media (prefers-reduced-motion:reduce){.lgb{opacity:1;animation:none}}
`;
