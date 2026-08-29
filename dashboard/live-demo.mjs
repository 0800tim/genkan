// The live wire, for the public demo only.
//
// dashboard/live.mjs samples real traffic: /proc/net/dev inside the gateway
// container, and the nftables per-device counters. A demo has neither, and no
// docker socket to reach them with, so the Right Now page would be a flat line
// saying "the gateway did not answer". That is a bad advertisement for the one
// screen that is meant to move.
//
// So the demo synthesises the same tick shape from the roster it already reads
// out of its own database. Real dashboard code, fake numbers: nothing here is
// ever loaded on a household box, because live.mjs only calls it when
// HEARTH_DEMO=1.
//
// The numbers are not random noise. They are a slow random walk per device,
// clamped, multiplied by a daily rhythm (quiet at 3am, busy after school,
// busiest at 8pm) and split across the categories that device's owner would
// plausibly be using. That is what makes the chart look like a household
// rather than a sawtooth.

const MB = 1_000_000;

// Bytes per second a device is capable of at full tilt, by what it is.
const CEILING = {
  console: 9 * MB, tv: 11 * MB, desktop: 7 * MB, laptop: 7 * MB,
  tablet: 4.5 * MB, phone: 3 * MB, speaker: 0.35 * MB, camera: 1.2 * MB,
  vacuum: 0.05 * MB, other: 2 * MB,
};

// How a device's traffic tends to split. Weights, normalised at use.
const MIX = {
  console: { gaming: 6, video: 2, social: 0.4, download: 1.5, other: 2 },
  tv:      { gaming: 0.2, video: 9, social: 0.2, download: 0.2, other: 1 },
  desktop: { gaming: 3, video: 3, social: 1.5, download: 2, other: 3 },
  laptop:  { gaming: 1, video: 3, social: 1.5, download: 1.5, other: 4 },
  tablet:  { gaming: 2, video: 4, social: 1.5, download: 0.6, other: 2 },
  phone:   { gaming: 1, video: 2.5, social: 4, download: 0.5, other: 2 },
  speaker: { gaming: 0, video: 0, social: 0, download: 0, other: 1 },
  camera:  { gaming: 0, video: 0, social: 0, download: 0, other: 1 },
  vacuum:  { gaming: 0, video: 0, social: 0, download: 0, other: 1 },
  other:   { gaming: 0.5, video: 1, social: 0.5, download: 0.3, other: 3 },
};

// The app name shown against a device, per category, so the top-talkers list
// reads like a household and not like a set of column headings.
const APPS = {
  gaming: ["Roblox", "Minecraft", "Fortnite", "Steam"],
  video:  ["YouTube", "Netflix", "Disney+", "Twitch"],
  social: ["Snapchat", "Instagram", "TikTok"],
  download: ["a Steam update", "a console update", "a system update"],
};

// Quiet overnight, a bump before school, the after-school peak, the evening
// peak, then down. Index is the hour, value is a multiplier.
const RHYTHM = [
  0.05, 0.04, 0.03, 0.03, 0.03, 0.05, 0.18, 0.35,
  0.30, 0.16, 0.14, 0.15, 0.22, 0.20, 0.35, 0.78,
  0.88, 0.72, 0.55, 0.85, 1.00, 0.74, 0.32, 0.12,
];

function rhythm(at) {
  const d = new Date(at);
  const h = d.getHours(), frac = d.getMinutes() / 60;
  const a = RHYTHM[h], b = RHYTHM[(h + 1) % 24];
  const weekend = d.getDay() === 0 || d.getDay() === 6;
  return (a + (b - a) * frac) * (weekend ? 1.25 : 1);
}

const pick = (list, seed) => list[Math.floor(seed * list.length) % list.length];

// A device's own slow walk, so its line drifts instead of jumping. Kept on the
// wire object, not in a module global, so nothing leaks between processes.
function walk(state, ip, kind) {
  let w = state.get(ip);
  if (!w) {
    w = { level: 0.15 + Math.random() * 0.4, seed: Math.random(), active: Math.random() < 0.65 };
    state.set(ip, w);
  }
  // Devices come and go: about once every four minutes one changes its mind
  // about whether it is doing anything at all.
  if (Math.random() < 0.006) w.active = !w.active;
  const pull = w.active ? 0.55 : 0.04;
  w.level += (pull - w.level) * 0.08 + (Math.random() - 0.5) * 0.09;
  w.level = Math.max(0, Math.min(1, w.level));
  if (kind === "speaker" || kind === "camera" || kind === "vacuum") w.level = Math.min(w.level, 0.25);
  return w;
}

export function demoTick(wire) {
  const at = Date.now();
  const st = (wire._demoWalk ||= new Map());
  const beat = rhythm(at);
  const cats = { other: 0, gaming: 0, video: 0, social: 0, download: 0 };
  let down = 0, up = 0;
  const rows = [];

  for (const d of wire.devices) {
    // Infrastructure is not a client, and a device nobody has seen is quiet.
    if (d.cls === "infra") continue;
    const kind = CEILING[d.kind] ? d.kind : "other";
    const w = walk(st, d.ip, kind);
    // An offline device still shows the occasional keepalive, nothing more.
    const ceiling = CEILING[kind] * (d.online ? 1 : 0.02);
    const bps = ceiling * w.level * beat;
    if (bps < 400) continue;

    const mix = MIX[kind] || MIX.other;
    const total = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
    const dc = { other: 0, gaming: 0, video: 0, social: 0, download: 0 };
    for (const [c, weight] of Object.entries(mix)) dc[c] = bps * (weight / total);
    // Smart home kit is never gaming or watching anything, whatever the mix
    // says. Belt and braces: it keeps the demo honest about what a camera does.
    if (d.cls !== "personal") { dc.gaming = dc.video = dc.social = dc.download = 0; dc.other = bps; }

    for (const c of Object.keys(cats)) cats[c] += dc[c];
    // A household downloads far more than it sends. 12:1 is about right for a
    // house of streaming and games, and it is what the real counters show.
    const devDown = bps * 0.92, devUp = bps * 0.08;
    down += devDown; up += devUp;

    let top = "other", tv = 0;
    for (const c of ["gaming", "video", "social"]) if (dc[c] > tv) { tv = dc[c]; top = c; }
    rows.push({
      ip: d.ip,
      bps: Math.round(bps),
      down: Math.round(devDown), up: Math.round(devUp),
      cats: { other: Math.round(dc.other), gaming: Math.round(dc.gaming),
              video: Math.round(dc.video), social: Math.round(dc.social) },
      app: APPS[top] && tv > 30000 ? pick(APPS[top], w.seed) : null,
    });
  }

  rows.sort((a, b) => b.bps - a.bps);
  const house = down + up;
  if (house > wire.peak) wire.peak = house;
  wire.firewall = true;
  wire.totalsOn = true;
  wire.fails = 0;
  wire.first = false;

  wire.publish({
    t: at,
    down: Math.round(down), up: Math.round(up),
    cats: { other: Math.round(cats.other), gaming: Math.round(cats.gaming),
            video: Math.round(cats.video), social: Math.round(cats.social) },
    devs: rows.slice(0, 40),
    peak: Math.round(wire.peak),
    totals: true,
    stale: false,
  });
}
