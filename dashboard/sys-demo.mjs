// The System page, for the public demo only.
//
// dashboard/sysmon.mjs reads the real box out of /proc and /sys. The demo runs
// inside a container on a shared server, so those numbers would describe
// somebody else's machine: sixteen cores, a terabyte of disk and whatever the
// neighbours are doing. That is both a poor advertisement for a family box and
// a small leak of a machine that has nothing to do with Genkan.
//
// So the demo describes a plausible little Genkan box instead: four cores,
// 8 GB of memory, a 128 GB disk, up for a week and a half, sitting at a few
// per cent with the evening's video pulling a couple of megabytes a second.
// Real dashboard code, invented numbers. sysmon.mjs only calls this when
// HEARTH_DEMO=1, so not one line of it ever runs in a household.

const GB = 1024 ** 3;
const MB = 1000 * 1000;

// Quiet overnight, a bump before school, the after-school rise, the evening
// peak. The same shape as the live wire's demo, so the two pages agree about
// what kind of evening the house is having.
const RHYTHM = [
  0.06, 0.05, 0.04, 0.04, 0.04, 0.06, 0.20, 0.38,
  0.32, 0.18, 0.16, 0.17, 0.24, 0.22, 0.38, 0.80,
  0.90, 0.74, 0.58, 0.88, 1.00, 0.76, 0.34, 0.14,
];

function rhythm(at) {
  const d = new Date(at);
  const h = d.getHours(), m = d.getMinutes();
  const a = RHYTHM[h], b = RHYTHM[(h + 1) % 24];
  return a + (b - a) * (m / 60);
}

// A deterministic wobble, so two browsers looking at the demo at the same
// moment see the same box rather than two different ones.
// Periods are minutes, not seconds. The sampler only looks every ten seconds,
// so a component that turns over faster than that would alias into a comb of
// spikes rather than a household's evening.
function wobble(at, salt) {
  const s = at / 1000;
  return Math.sin(s / 290 + salt) * 0.5
    + Math.sin(s / 77 + salt * 2.7) * 0.3
    + Math.sin(s / 23 + salt * 5.1) * 0.2;      // roughly -1 .. 1
}

const DEMO_BOOT_MS = 9.4 * 24 * 3600 * 1000;    // up a week and a half
const MEM_TOTAL = 8 * GB;
const DISK_TOTAL = 128 * GB;

export function demoStatic() {
  return {
    cores: 4,
    disk: { total: DISK_TOTAL, used: DISK_TOTAL * 0.41, avail: DISK_TOTAL * 0.59, pct: 41 },
    containers: [
      { name: "hearth-adguard", up: true, state: "running" },
      { name: "hearth-gw", up: true, state: "running" },
      { name: "hearth-portal", up: true, state: "running" },
    ],
    ifaces: [
      { name: "demo-wired", label: "Wired to the router", wireless: false, state: "up" },
      { name: "demo-wifi", label: "Wi-Fi", wireless: true, state: "down" },
    ],
  };
}

// One invented reading, in exactly the shape sysmon.mjs builds for a real box.
export function demoSample(at) {
  const r = rhythm(at);
  const cpu = Math.max(1.2, Math.min(88, 4 + r * 22 + wobble(at, 1.1) * 6 + (r > 0.8 ? 8 : 0)));
  const memPct = Math.max(28, Math.min(72, 41 + r * 9 + wobble(at, 2.3) * 4));
  const used = MEM_TOTAL * (memPct / 100);
  const down = Math.max(2000, r * 3.4 * MB * (1 + wobble(at, 3.7) * 0.55));
  const up = Math.max(700, down * (0.09 + 0.05 * (wobble(at, 4.9) + 1) / 2));
  const l1 = (cpu / 100) * 4 * 0.85;
  return {
    t: at,
    cpu,
    mem: {
      total: MEM_TOTAL, avail: MEM_TOTAL - used, used, pct: memPct,
      swapTotal: 2 * GB, swapUsed: 0.06 * GB,
    },
    load: [l1, l1 * 0.92 + 0.05, l1 * 0.86 + 0.08].map(v => Math.round(v * 100) / 100),
    uptime: Math.floor((DEMO_BOOT_MS + (at % 1000)) / 1000),
    temp: Math.round((42 + r * 9 + wobble(at, 6.1) * 1.6) * 10) / 10,
    tempLabel: "CPU",
    net: {
      down, up,
      per: {
        "demo-wired": { down, up, totalDown: 412 * 1024 * MB, totalUp: 63 * 1024 * MB },
        "demo-wifi": { down: 0, up: 0, totalDown: 0, totalUp: 0 },
      },
    },
  };
}

// Enough invented history that the charts have something to draw the moment
// the page opens, exactly as a real box's ring buffer would after an hour.
export function demoBackfill(now, tickMs, count) {
  const out = [];
  for (let i = count; i > 0; i--) {
    const at = now - i * tickMs;
    const s = demoSample(at);
    out.push({
      t: at,
      cpu: Math.round(s.cpu * 10) / 10,
      mem: Math.round(s.mem.pct * 10) / 10,
      down: Math.round(s.net.down),
      up: Math.round(s.net.up),
    });
  }
  return out;
}
