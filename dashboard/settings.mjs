// Genkan dashboard: Settings.
//
// What a young child, a standard child and a teen may do; the allow lists
// (the safety net, the reading list, search); and the household switches
// that are off by default and stay off until a parent turns them on here,
// with the reason next to the switch. Every write goes through the same
// tools the CLI uses, never straight to the firewall.
import { esc } from "./charts.mjs";

export const SETTINGS_CSS = ``;
export const SETTINGS_JS = ``;

// GET /settings
export async function settingsPage(q, s) {
  return `<div class="card"><h2>Settings</h2>
    <p class="muted">Being built. This page will hold the filter tiers (young, standard, teen), the
    allow lists, and the household switches.</p></div>`;
}

// POST /api/settings  {op:..., ...}
export async function settingsApi(q, body, res, runKidnet) {
  res.writeHead(400, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, msg: "not built yet" }));
}
