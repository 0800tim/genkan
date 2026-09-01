// Genkan dashboard: Settings.
//
// What a young child, a standard child and a teen may do; the allow lists
// (the safety net, the reading list, search); and the household switches
// that are off by default and stay off until a parent turns them on here,
// with the reason next to the switch. Every write goes through bin/genkan
// (runKidnet), never straight to the database or the firewall from this
// file: the CLI gates every argument, audits every change, and is the one
// place that knows how to push a level to AdGuard or a domain into the
// firewall's allow set. The page's job is to show the truth and to say, next
// to each control, what it does and what it cannot do.
import { existsSync } from "node:fs";
import { esc } from "./charts.mjs";
import { TIERS } from "./household.mjs";
import { storageSnapshot, diskNow } from "./sysmon.mjs";

// The vocabulary, kept identical to bin/genkan's gates so a value this page
// accepts is a value the CLI accepts. Anything else is refused here with a
// sentence rather than there with a shell error.
const TIER_RE = /^[a-z]{2,16}$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const NOTE_RE = /^[A-Za-z0-9_:+.,' -]{0,80}$/;
const SERVICE_RE = /^[a-z0-9_]{1,40}$/;
const MODES = ["off", "observe", "enforce"];
const TIER_ORDER = ["young", "standard", "teen", "guest", "adult"];
// Retention: a table name as the retention table spells it, and a day count
// inside the CHECK the table itself carries (1 to 3650). bin/genkan checks
// both again, and bin/genkan-prune a third time.
const WHAT_RE = /^[a-z_]{1,32}$/;
const DAY_PRESETS = [7, 14, 30, 60, 90, 180, 365];
const days = v => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : undefined;
};
// What each retained table is, in a parent's words. The row's own note says
// why its default is what it is; this is just the name on the row.
const WHAT_LABEL = {
  dns_log: "DNS lookups: every domain a device asked for",
  alerts: "Alerts",
  block_events: "The block log (the audit trail)",
  time_events: "Minutes earned, spent and taken away",
  quiz_rounds: "Quiz rounds, with their answers",
  category_usage: "Daily minutes per category",
  service_usage: "Daily minutes per service",
  dhcp_leases: "Which address each device had",
  device_claims: "Device claims, including the wrong PINs",
};
const human = b => {
  b = Number(b || 0);
  if (b <= 0) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const v = b / Math.pow(1024, i);
  return `${i === 0 || v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
};
// "about 67,000", never "about 67,059": the count is the planner's estimate.
const about = n => {
  n = Number(n || 0);
  if (n < 1000) return String(Math.round(n));
  const p = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return (Math.round(n / p) * p).toLocaleString("en-NZ");
};
const dateNZ = ms => new Date(ms).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
const tierLabel = t => (TIERS.find(x => x[0] === t) || [t, String(t).charAt(0).toUpperCase() + String(t).slice(1)])[1];
const tierNote = t => (TIERS.find(x => x[0] === t) || [])[2] || "";
// "" / null mean "no limit"; anything else must be a sane count of minutes.
// undefined means "that is not a number of minutes".
function minutes(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? Math.round(n) : undefined;
}
const hhmm = min => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// AdGuard's list of blockable services. Fetched from AdGuard itself, because
// the list changes with every AdGuard release and a copy here would rot.
// Cached for ten minutes so the page stays quick. When AdGuard cannot be
// reached (the demo has no AdGuard at all) the page falls back to the ids the
// levels already use, and says so.
// ---------------------------------------------------------------------------
let svcCache = { at: 0, list: null };
async function blockedServices() {
  if (process.env.GENKAN_DEMO === "1") return null;
  if (svcCache.list && Date.now() - svcCache.at < 600000) return svcCache.list;
  const base = process.env.ADGUARD_URL || "http://127.0.0.1:8853";
  const user = process.env.ADGUARD_USER || "admin";
  const pass = process.env.ADGUARD_PASS || "";
  if (!pass) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(`${base}/control/blocked_services/all`, {
      headers: { authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") },
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const list = (j.blocked_services || []).map(s => ({ id: String(s.id), name: String(s.name || s.id), group: String(s.group_id || "other") }));
    if (!list.length) return null;
    svcCache = { at: Date.now(), list };
    return list;
  } catch { return null; }
}
const GROUP_LABEL = {
  social_network: "Social", video_streaming: "Video", audio_streaming: "Music", games: "Games",
  shopping: "Shopping", messaging: "Messaging", dating: "Dating", ai: "AI assistants",
  productivity: "Productivity", cloud: "Cloud storage", other: "Other",
};
const groupLabel = g => GROUP_LABEL[g] || String(g).replace(/_/g, " ").replace(/^./, c => c.toUpperCase());

// ---------------------------------------------------------------------------
// The data. Every query is guarded: a box whose database has not been given
// schema-settings.sql yet still gets a page that renders, says which card is
// waiting on the schema, and shows everything else.
// ---------------------------------------------------------------------------
export async function settingsData(q) {
  const safe = (sql, dflt = []) => q(sql).catch(() => dflt);
  let policies = await q(`SELECT tier, description, safesearch, adguard_parental, adguard_services, adguard_private,
                                 daily_budget_school_min, daily_budget_weekend_min FROM policies`).catch(() => null);
  const dns = !!policies;
  if (!policies) policies = await safe(`SELECT tier, description, safesearch, daily_budget_school_min, daily_budget_weekend_min FROM policies`);
  policies.sort((a, b) => (TIER_ORDER.indexOf(a.tier) + 99) % 99 - (TIER_ORDER.indexOf(b.tier) + 99) % 99);
  let allow = await q(`SELECT id, domain, scope, category, note, added_by, added_ts FROM always_allow
                        WHERE scope IN ('safety','learn') ORDER BY scope, category, domain`).catch(() => null);
  const allowReady = !!allow;
  if (!allow) allow = await safe(`SELECT id, domain, scope, category, note, NULL AS added_by, NULL AS added_ts FROM always_allow
                                   WHERE scope IN ('safety','learn') ORDER BY scope, category, domain`);
  const [[claim], [iot], [board], [slow], [tz], routes] = await Promise.all([
    safe("SELECT mode FROM claim_settings", [{}]),
    safe("SELECT mode FROM iot_policy_settings WHERE id=1", [{}]),
    safe("SELECT enabled FROM board_settings", [{}]),
    safe("SELECT rate_kbit, on_timeout FROM slow_settings", [{}]),
    safe("SELECT current_setting('TIMEZONE') AS tz", [{}]),
    safe("SELECT name, quiet_start_min, quiet_end_min, quiet_urgent FROM notify_routes WHERE enabled ORDER BY name"),
  ]);
  const [storage, disk] = await Promise.all([storageSnapshot(q), diskNow()]);
  return {
    dns, policies, allow, allowReady,
    claim: claim?.mode ?? null, iot: iot?.mode ?? null, board: board?.enabled ?? null,
    slow: slow?.rate_kbit ? slow : null, tz: tz?.tz || "", routes,
    services: await blockedServices(),
    iotTimer: existsSync("/etc/systemd/system/timers.target.wants/kids-iot-policy.timer"),
    storage, disk,
    pruneTimer: existsSync("/etc/systemd/system/timers.target.wants/kids-prune.timer"),
    demo: process.env.GENKAN_DEMO === "1",
  };
}

// ---------------------------------------------------------------------------
// The API. Same guard and same shape as every other control on this dashboard.
// Every op ends in runKidnet: nothing here writes a row.
// ---------------------------------------------------------------------------
export async function settingsApi(q, body, res, runKidnet) {
  const send = (code, out, ok = false) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, out }));
  };
  const b = body || {};
  const op = String(b.op || "");
  const run = async args => {
    const r = await runKidnet(args);
    return { ok: r.ok, out: String(r.out || "").trim() };
  };

  if (op === "tier") {
    const tier = String(b.tier || "");
    if (!TIER_RE.test(tier)) return send(400, "which level?");
    const [cur] = await q(`SELECT tier, safesearch, adguard_parental, adguard_services, adguard_private,
                                  daily_budget_school_min, daily_budget_weekend_min FROM policies WHERE tier=$1`, [tier])
      .catch(() => []);
    if (!cur) return send(400, cur === undefined ? "no such level" : "The filter levels need config/db/schema-settings.sql loaded first.");
    const school = minutes(b.school), weekend = minutes(b.weekend);
    if (school === undefined || weekend === undefined) return send(400, "Those minutes do not look right.");
    const services = Array.isArray(b.services) ? b.services.map(String) : null;
    if (services && (services.length > 150 || services.some(s => !SERVICE_RE.test(s))))
      return send(400, "That is not one of AdGuard's services.");
    // Only what changed is sent, one CLI call per field, so the audit trail
    // reads "parental off" rather than "everything, again".
    const changes = [];
    const bool = v => v === true || v === "true";
    if (b.parental !== undefined && bool(b.parental) !== !!cur.adguard_parental) changes.push(["parental", String(bool(b.parental))]);
    if (b.safesearch !== undefined && bool(b.safesearch) !== !!cur.safesearch) changes.push(["safesearch", String(bool(b.safesearch))]);
    if (b.priv !== undefined && bool(b.priv) !== !!cur.adguard_private) changes.push(["private", String(bool(b.priv))]);
    if (services) {
      const want = [...new Set(services)].sort(), have = [...(cur.adguard_services || [])].sort();
      if (want.join() !== have.join()) changes.push(["services", want.length ? want.join(",") : "none"]);
    }
    if (b.school !== undefined && school !== (cur.daily_budget_school_min ?? null)) changes.push(["school", school === null ? "none" : String(school)]);
    if (b.weekend !== undefined && weekend !== (cur.daily_budget_weekend_min ?? null)) changes.push(["weekend", weekend === null ? "none" : String(weekend)]);
    if (!changes.length) return send(200, `Nothing changed on the ${tierLabel(tier)} level.`, true);
    const out = [];
    for (const [field, value] of changes) {
      const r = await run(["tier", "set", tier, field, value]);
      if (!r.ok) return send(500, r.out || `could not save ${field}`);
      out.push(r.out.split("\n")[0]);
    }
    return send(200, out.join(" "), true);
  }

  if (op === "allow-add") {
    const domain = String(b.domain || "").trim().toLowerCase();
    const kind = String(b.kind || "");
    const note = String(b.note || "").trim();
    if (!DOMAIN_RE.test(domain) || domain.length > 253)
      return send(400, "A domain is lowercase letters, digits, hyphens and dots, like example.org. No https://, no path.");
    if (!["learn", "search"].includes(kind)) return send(400, "Reading list or search?");
    if (!NOTE_RE.test(note)) return send(400, "Keep the note to plain words, up to 80 characters.");
    const r = await run(note ? ["allow", "add", domain, kind, note] : ["allow", "add", domain, kind]);
    return send(r.ok ? 200 : 400, r.out.replace(/^genkan: /gm, "") || "could not add it", r.ok);
  }

  if (op === "allow-remove") {
    const domain = String(b.domain || "").trim().toLowerCase();
    if (!DOMAIN_RE.test(domain) || domain.length > 253) return send(400, "which domain?");
    const r = await run(["allow", "remove", domain]);
    return send(r.ok ? 200 : 400, r.out.replace(/^genkan: /gm, "") || "could not remove it", r.ok);
  }

  if (op === "claim-mode") {
    const mode = String(b.mode || "");
    if (!MODES.includes(mode)) return send(400, "off, observe or enforce?");
    const r = await run(["claim-mode", mode]);
    return send(r.ok ? 200 : 500, r.out || "could not change claiming", r.ok);
  }

  if (op === "iot-mode") {
    const mode = String(b.mode || "");
    if (!MODES.includes(mode)) return send(400, "off, observe or enforce?");
    const r = await run(["iot", "mode", mode]);
    return send(r.ok ? 200 : 500, r.out || "could not change the household policy", r.ok);
  }

  if (op === "slow") {
    const [cur] = await q("SELECT rate_kbit, on_timeout FROM slow_settings").catch(() => []);
    if (!cur) return send(400, "The slow lane needs config/db/schema-slow.sql loaded first.");
    const out = [];
    if (b.rate !== undefined && b.rate !== "") {
      const rate = Number(b.rate);
      if (!Number.isInteger(rate) || rate < 32 || rate > 9999) return send(400, "A slow lane is between 32 and 9999 kbit/s.");
      if (rate !== cur.rate_kbit) {
        const r = await run(["slow-rate", String(rate)]);
        if (!r.ok) return send(500, r.out || "could not set the rate");
        out.push(r.out);
      }
    }
    if (b.timeout !== undefined) {
      const t = String(b.timeout);
      if (!["cut", "slow"].includes(t)) return send(400, "cut or slow?");
      if (t !== cur.on_timeout) {
        const r = await run(["slow-timeout", t]);
        if (!r.ok) return send(500, r.out || "could not set what running out does");
        out.push(r.out.split("\n")[0]);
      }
    }
    return send(200, out.join(" ") || "Nothing changed on the slow lane.", true);
  }

  // Storage. The page never deletes a row itself: a retention change is
  // `genkan retention set`, and every prune is bin/genkan-prune by way of
  // `genkan prune`, which is where the superuser path and the audit row live.
  if (op === "retention") {
    const what = String(b.what || "");
    const d = days(b.days);
    if (!WHAT_RE.test(what)) return send(400, "which table?");
    if (d === undefined) return send(400, "Keep it for a whole number of days, from 1 to 3650.");
    const r = await run(["retention", "set", what, String(d)]);
    return send(r.ok ? 200 : 400, r.out.replace(/^genkan: /gm, "") || "could not save it", r.ok);
  }
  if (op === "prune-preview") {
    const r = await run(["prune", "preview"]);
    return send(r.ok ? 200 : 500, r.out || "no answer from the pruner", r.ok);
  }
  if (op === "prune-run") {
    const r = await run(["prune", "now"]);
    return send(r.ok ? 200 : 500, r.out || "no answer from the pruner", r.ok);
  }
  if (op === "prune-dns") {
    const d = days(b.days);
    if (d === undefined) return send(400, "A whole number of days, from 1 to 3650.");
    const r = await run(["prune", "dns-log", String(d)]);
    return send(r.ok ? 200 : 400, r.out.replace(/^genkan: /gm, "") || "no answer from the pruner", r.ok);
  }

  return send(400, "bad request");
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export const SETTINGS_CSS = `
.stlevel{margin-bottom:12px}
.stflags{display:flex;gap:14px;flex-wrap:wrap;margin:8px 0 2px}
.stflags label{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--ink-2);cursor:pointer}
.stflags input{width:auto;margin:0}
.stwho{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0 0;font-size:12.5px;color:var(--ink-muted)}
.stsvc{margin-top:8px}
.stsvc summary{cursor:pointer;font-size:12.5px;color:var(--ink-2)}
.stsvc summary b{color:var(--ink)}
.stgrp{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-muted);margin:10px 0 3px;font-weight:600}
.stgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 10px}
.stgrid label{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-2);cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stgrid input{width:auto;margin:0;flex:none}
.stlist{margin:4px 0 0}
.stlist .row{padding:5px 0;font-size:13px;align-items:baseline}
.stlist .row code{font-size:12.5px}
.stlist .n{color:var(--ink-muted);font-size:12px;margin-left:8px}
.stadd{display:grid;gap:10px 12px;grid-template-columns:minmax(160px,1.2fr) minmax(160px,2fr) auto;align-items:end;margin-top:10px}
.stadd label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-muted);margin-bottom:3px;font-weight:600}
.stadd input{width:100%}
@media(max-width:640px){.stadd{grid-template-columns:1fr}}
.stsw{display:grid;grid-template-columns:180px minmax(0,1fr);gap:6px 16px;
  align-items:start;padding:12px 0;border-top:1px solid var(--line)}
.stsw:first-of-type{border-top:0}
.stsw h4{margin:4px 0 0;font-size:13.5px;font-weight:600}
.stsw .ctl{display:flex;gap:7px;align-items:center;flex-wrap:wrap;min-height:32px}
.stsw .ctl input[type=number]{width:6.5em}
.stsw .why{font-size:12.5px;color:var(--ink-muted);line-height:1.45;margin:4px 0 0;max-width:72ch}
.stsw .ro{font-size:13px;color:var(--ink-2)}
.stsw .ro code{font-size:12px}
@media(max-width:600px){.stsw{grid-template-columns:1fr}}
.stcannot li{margin:4px 0;font-size:13px;color:var(--ink-2);line-height:1.45}
.stwait{font-size:12.5px;color:var(--ink-2);background:color-mix(in oklab,var(--warn,#c98a2b) 10%,var(--surface));
  border:1px solid var(--line);border-radius:10px;padding:8px 11px;margin:8px 0 0}
/* Storage */
.stst{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:10px 0 4px}
.stst>div{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--surface-2)}
.stst .k{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);font-weight:600}
.stst .v{font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15;margin-top:2px;font-variant-numeric:tabular-nums}
.stst .v.off{font-size:16px;color:var(--ink-muted)}
.stst .s{font-size:11.5px;color:var(--ink-muted);margin-top:2px;line-height:1.35}
.stret{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 16px;align-items:start;padding:11px 0;border-top:1px solid var(--line)}
.stret:first-of-type{border-top:0}
.stret h4{margin:0;font-size:13.5px;font-weight:600}
.stret h4 code{font-size:12px;font-weight:400;color:var(--ink-muted);margin-left:6px}
.stret .facts{font-size:12.5px;color:var(--ink-2);margin:2px 0 0;font-variant-numeric:tabular-nums}
.stret .why{grid-column:1/-1;font-size:12.5px;color:var(--ink-muted);line-height:1.45;margin:2px 0 0;max-width:78ch}
.stret .ctl{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.stret .ctl input[type=number]{width:5.5em}
.stret .ctl .d{font-size:12.5px;color:var(--ink-muted)}
.stret .sens{color:var(--crit);border-color:color-mix(in oklab,var(--crit) 40%,var(--line))}
@media(max-width:600px){.stret{grid-template-columns:1fr}.stret .ctl{justify-content:flex-start}}
.sttop{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12.5px;color:var(--ink-2);margin:4px 0 0;font-variant-numeric:tabular-nums}
.sttop span b{font-weight:600}
.stout{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.5;
  color:var(--ink-2);background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin:10px 0 0;
  max-height:220px;overflow:auto}
`;

export const SETTINGS_JS = `
function stVal(id){var el=document.getElementById(id);return el?el.value.trim():'';}
function stOn(id){var el=document.getElementById(id);return !!(el&&el.checked);}
function stTierSave(t){
  var svc=[];document.querySelectorAll('input[data-svc="'+t+'"]:checked').forEach(function(e){svc.push(e.value);});
  var body={op:'tier',tier:t,parental:stOn('sp_'+t),safesearch:stOn('ss_'+t),priv:stOn('sq_'+t),services:svc};
  if(document.getElementById('sts_'+t)){body.school=stVal('sts_'+t);body.weekend=stVal('stw_'+t);}
  mgPost('/api/settings',body,'saving the '+t+' level\\u2026');
}
function stChildTier(id){
  var el=document.getElementById('sct_'+id);if(!el)return;
  mgPost('/api/child',{op:'save',id:id,name:el.dataset.name,kind:el.dataset.kind,age:el.dataset.age,tier:el.value},
    'moving '+el.dataset.name+'\\u2026');
}
function stAllowAdd(kind){
  var d=stVal('sta_'+kind);
  if(!d){say('Type a domain first, like example.org');return;}
  mgPost('/api/settings',{op:'allow-add',kind:kind,domain:d,note:stVal('stn_'+kind)},'adding '+d+'\\u2026');
}
function stAllowRemove(d){
  if(!confirm('Take '+d+' off the allow list?\\n\\nA child who is cut off will no longer be able to reach it. Nothing else changes.'))return;
  mgPost('/api/settings',{op:'allow-remove',domain:d},'removing '+d+'\\u2026');
}
function stClaim(){
  var m=stVal('st_claim');
  if(m==='enforce'&&!confirm('Enforce device claiming?\\n\\n'
    +'\\u2022 Every personal device nobody owns gets DNS, the portal and the safety net, and nothing else, until somebody claims it and you confirm.\\n'
    +'\\u2022 Smart home kit, appliances and the access point are never touched.\\n'
    +'\\u2022 Observe first if you have not: it tells you how many devices this would catch.'))return;
  mgPost('/api/settings',{op:'claim-mode',mode:m},'changing claiming\\u2026');
}
function stIot(){
  var m=stVal('st_iot');
  if(m==='enforce'&&!confirm('Enforce the household IoT policy?\\n\\n'
    +'\\u2022 Each camera, lock and gadget may only talk to what its policy allows. Anything the policy did not expect stops working.\\n'
    +'\\u2022 Read docs/HOUSEHOLD-SECURITY.md and leave it in observe for a day first, then look at the counters.'))return;
  mgPost('/api/settings',{op:'iot-mode',mode:m},'changing the household policy\\u2026');
}
function stBoard(on){mgPost('/api/board',{enabled:!!on},on?'turning the board on\\u2026':'turning the board off\\u2026');}
function stSlow(){mgPost('/api/settings',{op:'slow',rate:stVal('st_rate'),timeout:stVal('st_timeout')},'saving the slow lane\\u2026');}
/* Storage. The preset picker and the number box are two views of one value:
   picking a preset fills the box, typing in the box moves the picker to
   "other". Save reads the box, so whatever is typed is what is sent. */
function stRetPick(w){var s=document.getElementById('stp_'+w),n=document.getElementById('std_'+w);
  if(s&&n&&s.value!=='other')n.value=s.value;}
function stRetTyped(w){var s=document.getElementById('stp_'+w),n=document.getElementById('std_'+w);if(!s||!n)return;
  var has=false;for(var i=0;i<s.options.length;i++){if(s.options[i].value===n.value)has=true;}
  s.value=has?n.value:'other';}
function stRetSave(w){var d=stVal('std_'+w);
  if(!d){say('How many days should '+w+' be kept?');return;}
  mgPost('/api/settings',{op:'retention',what:w,days:d},'saving '+w+'\\u2026');}
function stPruneOut(t){var o=document.getElementById('st_prune');if(o){o.hidden=false;o.textContent=t;}}
async function stPrunePreview(){
  stPruneOut('asking the pruner what is past its retention\\u2026');
  var x=await post('/api/settings',{op:'prune-preview'});
  var t=((x.j&&x.j.out)||'').trim();
  if(!x.r.ok||(x.j&&x.j.ok===false)){stPruneOut(t||('That did not work (HTTP '+x.r.status+')'));return null;}
  stPruneOut(t||'Nothing is past its retention.');
  return t;}
async function stPruneNow(){
  var t=await stPrunePreview(); if(t===null)return;
  if(/demo/i.test(t)){say(t);return;}
  var lines=t.split('\\n').filter(function(l){return /would delete/.test(l);});
  if(!lines.length){say('Nothing is past its retention, so there is nothing to delete.');return;}
  if(!confirm('Delete these rows now?\\n\\n'+lines.map(function(l){return '\\u2022 '+l.trim().replace(/^would /,'');}).join('\\n')
    +'\\n\\nThis is exactly what tonight\\u2019s prune would do. Genkan keeps no copy: only a backup you made yourself can bring a row back.'))return;
  stPruneOut('deleting\\u2026');
  var y=await post('/api/settings',{op:'prune-run'});
  stPruneOut(((y.j&&y.j.out)||'').trim()||'no answer');
  done(y.r,y.j,3000);}
async function stPruneDns(){
  var d=stVal('std_dns');
  if(!d){say('How many days of lookups should stay?');return;}
  if(!confirm('Delete every DNS lookup older than '+d+' days?\\n\\n'
    +'\\u2022 They go now, not tonight.\\n'
    +'\\u2022 The retention setting for dns_log does not change.\\n'
    +'\\u2022 Genkan keeps no copy: only a backup you made yourself can bring them back.'))return;
  stPruneOut('deleting lookups older than '+d+' days\\u2026');
  var y=await post('/api/settings',{op:'prune-dns',days:d});
  stPruneOut(((y.j&&y.j.out)||'').trim()||'no answer');
  done(y.r,y.j,3000);}
`;

const chk = (id, label, on, extra = "") =>
  `<label><input type="checkbox" id="${esc(id)}"${on ? " checked" : ""}${extra}> ${esc(label)}</label>`;
const num = (id, label, val, ph = "no limit") =>
  `<div><label for="${esc(id)}">${esc(label)}</label><input id="${esc(id)}" type="number" inputmode="numeric" min="0" max="1440"`
  + ` value="${val === null || val === undefined ? "" : esc(String(val))}" placeholder="${esc(ph)}"></div>`;

function levelCard(p, s, d) {
  const kids = (s.children || []).filter(c => c.active !== false && c.policy_tier === p.tier);
  const who = kids.length
    ? `<div class="stwho">On this level: ${kids.map(c => `<span class="pill">${esc(c.name)}</span>`).join("")}</div>`
    : `<div class="stwho">Nobody is on this level right now.</div>`;
  if (p.tier === "adult") {
    return `<div class="mgcard stlevel"><div class="mh"><h3>${esc(tierLabel(p.tier))}</h3></div>
      <p class="sub" style="margin:4px 0 0">${esc(p.description || tierNote(p.tier))}</p>${who}
      <p class="mghint">A household adult has no AdGuard client of their own: they get whatever the household
        catch-all gives everyone, which is ads and malware blocked and nothing else. There is nothing to set here,
        and that is deliberate.</p></div>`;
  }
  const svcOn = new Set(p.adguard_services || []);
  const list = d.services || [...svcOn].map(id => ({ id, name: id, group: "other" }));
  const groups = new Map();
  for (const sv of list) (groups.get(sv.group) || groups.set(sv.group, []).get(sv.group)).push(sv);
  const onNames = list.filter(x => svcOn.has(x.id)).map(x => x.name);
  const svcs = `<details class="stsvc"><summary><b>${svcOn.size} service${svcOn.size === 1 ? "" : "s"} blocked</b>${
      onNames.length ? `: ${esc(onNames.slice(0, 8).join(", "))}${onNames.length > 8 ? ` and ${onNames.length - 8} more` : ""}` : ""}
      &middot; change</summary>
    ${d.services ? "" : `<p class="mghint">AdGuard could not be asked for its full list just now, so only the services already
      on this level are shown. Reload when it is back.</p>`}
    ${[...groups.entries()].sort((a, b) => groupLabel(a[0]).localeCompare(groupLabel(b[0]))).map(([g, rows]) =>
      `<div class="stgrp">${esc(groupLabel(g))}</div><div class="stgrid">${
        rows.sort((a, b) => a.name.localeCompare(b.name)).map(sv =>
          `<label title="${esc(sv.id)}"><input type="checkbox" data-svc="${esc(p.tier)}" value="${esc(sv.id)}"${
            svcOn.has(sv.id) ? " checked" : ""}> ${esc(sv.name)}</label>`).join("")}</div>`).join("")}
    <p class="mghint">A blocked service is its whole list of domains, apps included. AdGuard keeps that list current.</p>
  </details>`;
  const mins = p.tier === "guest" ? `<p class="mghint">A visitor has no time budget, so there are no minutes to set.</p>`
    : `<div class="mgsec">General screen time a day, in minutes</div>
       <div class="mg">${num(`sts_${p.tier}`, "School day", p.daily_budget_school_min)}${num(`stw_${p.tier}`, "Weekend day", p.daily_budget_weekend_min)}</div>
       <p class="mghint">Empty means no limit. The Family page edits the same two numbers. A change applies from each
         person's next day.</p>`;
  return `<div class="mgcard stlevel"><div class="mh"><h3>${esc(tierLabel(p.tier))}</h3></div>
    <p class="sub" style="margin:4px 0 0">${esc(p.description || tierNote(p.tier))}</p>${who}
    <div class="mgsec">On the DNS side, for every device on this level</div>
    <div class="stflags">
      ${chk(`sp_${p.tier}`, "Parental control (AdGuard's adult-content category)", p.adguard_parental)}
      ${chk(`ss_${p.tier}`, "SafeSearch forced on Google, Bing, DuckDuckGo and YouTube", p.safesearch)}
      ${chk(`sq_${p.tier}`, "Private: keep these devices out of the per-person query log", p.adguard_private)}
    </div>
    ${svcs}
    ${mins}
    <div class="mgacts"><button class="btn primary" type="button" onclick="stTierSave('${esc(p.tier)}')">Save the ${esc(tierLabel(p.tier))} level</button></div>
  </div>`;
}

function levelsPanel(s, d) {
  if (!d.dns) return `<div class="card"><h2>Filter levels</h2>
    <div class="stwait">This box's database does not have the filter-level columns yet. Load
      <code>config/db/schema-settings.sql</code> (or re-run <code>config/db/load.sh</code>) and this card fills in.
      Until then the levels are what <code>bin/genkan-adguard-clients</code> has always built in, unchanged.</div></div>`;
  const kids = (s.children || []).filter(c => c.active !== false && (c.kind === "child" || c.kind === "guest-child"));
  const tiers = d.policies.map(p => p.tier);
  const movers = kids.length ? `<div class="mgsec">Who is on which level</div>
    <div class="stlist">${kids.map(c => `<div class="row"><span><b>${esc(c.name)}</b>
        <span class="tag">${c.kind === "guest-child" ? "visiting child" : "child"}${c.age ? `, ${esc(String(c.age))}` : ""}</span></span>
      <span><select id="sct_${c.id}" data-name="${esc(c.name)}" data-kind="${esc(c.kind)}" data-age="${c.age ?? ""}"
          aria-label="Filter level for ${esc(c.name)}">${tiers.filter(t => t !== "adult").map(t =>
          `<option value="${esc(t)}"${t === c.policy_tier ? " selected" : ""}>${esc(tierLabel(t))}</option>`).join("")}</select>
        <button class="btn" type="button" onclick="stChildTier(${c.id})">Move</button></span></div>`).join("")}</div>
    <p class="mghint">Moving somebody rebuilds their AdGuard client from the new level straight away. Their minutes
      change from tomorrow. Everything else about them is on the <a href="/family">Family page</a>.</p>` : "";
  return `<div class="card"><h2>Filter levels</h2>
    <p class="sub">What a young child, a standard child, a teen and a visitor may reach. A level applies to
      <b>everyone on it</b>: change the Young level and every young child's devices change with it, within a
      few seconds, through their AdGuard client. The level in the database wins: a client tuned by hand in the
      AdGuard UI is put back to its level on the next change.</p>
    <p class="sub">The household blocklists (adult sites, malware, trackers) are <b>global</b> and are not part of a
      level. AdGuard applies a filter list to every device or to none, so a level cannot add or drop one.</p>
    ${movers}
    ${d.policies.map(p => levelCard(p, s, d)).join("")}
  </div>`;
}

function allowPanel(d) {
  const rows = d.allow || [];
  const safety = rows.filter(r => r.scope === "safety");
  const learn = rows.filter(r => r.scope === "learn" && r.category !== "search");
  const search = rows.filter(r => r.category === "search");
  const line = (r, removable) => `<div class="row"><span><code>${esc(r.domain)}</code>${
      r.added_by ? ` <span class="pill">added</span>` : ""}${r.note ? `<span class="n">${esc(r.note)}</span>` : ""}</span>
    <span>${removable && r.added_by ? `<button class="decline" type="button" onclick="stAllowRemove(${esc(JSON.stringify(r.domain))})">Remove</button>` : ""}</span></div>`;
  const byCat = list => {
    const cats = new Map();
    for (const r of list) (cats.get(r.category || "") || cats.set(r.category || "", []).get(r.category || "")).push(r);
    return [...cats.entries()].map(([c, rs]) => `${c ? `<div class="mgsec">${esc(c)}</div>` : ""}${rs.map(r => line(r, true)).join("")}`).join("");
  };
  const addForm = kind => `<div class="stadd">
      <div><label for="sta_${kind}">Domain</label><input id="sta_${kind}" placeholder="${kind === "search" ? "e.g. duckduckgo.com" : "e.g. example.org"}" maxlength="253"></div>
      <div><label for="stn_${kind}">Why (optional)</label><input id="stn_${kind}" placeholder="a note for future you" maxlength="80"></div>
      <div><button class="btn primary" type="button" onclick="stAllowAdd('${kind}')">Add</button></div>
    </div>`;
  const wait = d.allowReady ? "" : `<div class="stwait">Adding and removing needs <code>config/db/schema-settings.sql</code>
      loaded into this box's database. The lists below are still the truth.</div>`;
  return `<div class="card"><h2>What a cut-off child can still reach</h2>
    <p class="sub">Three lists, three promises. All three survive a total cut: internet off, dinner, bedtime, out of
      time. The firewall allows them by <b>address</b>, and addresses are shared, so whatever else lives on the
      same servers is reachable by address too; the name layer (AdGuard) only answers for the names below. A
      promise about a name needs a rule that reads the name, and that is what the search list is.</p>
    ${wait}
    <div class="mgsec">The safety net (${safety.length}): never narrowed</div>
    <p class="mghint">The youth help lines and schoolwork. Nothing removes these: not this page, not the command
      line, not the database's own superuser. A trigger refuses it. To add a help line, edit
      <code>config/db/seed.sql</code>; that is a decision for the repo, not a box.</p>
    <div class="stlist">${safety.map(r => line(r, false)).join("") || '<div class="empty">None. That is a broken install: reload the schema.</div>'}</div>

    <div class="mgsec">The reading list (${learn.length}): subdomains included</div>
    <p class="mghint">Reference sites a child out of time can still read, so learn-to-earn is not a memory test.
      Reference and reading, not discussion, not video, nothing with a feed
      (<code>docs/READING-LIST.md</code> has the five tests). <code>example.org</code> covers
      <code>www.example.org</code>. Rows shipped with Genkan cannot be removed here, because a schema reload
      would only put them back; rows you add can.</p>
    <div class="stlist">${byCat(learn) || '<div class="empty">Nothing yet.</div>'}</div>
    ${d.allowReady ? addForm("learn") : ""}

    <div class="mgsec">Search (${search.length}): exact hosts only</div>
    <p class="mghint">Each of these is one exact host and nothing under it. <code>google.com</code> is allowed
      so a child can search; <code>mail.google.com</code>, Meet, Chat and Messages are not, and
      <code>accounts.google.com</code> is deliberately absent because that is where a sign-in starts.</p>
    <div class="stlist">${search.map(r => line(r, true)).join("") || '<div class="empty">Nothing yet.</div>'}</div>
    ${d.allowReady ? addForm("search") : ""}
  </div>`;
}

function switchesPanel(d) {
  const sw = (title, ctl, why) => `<div class="stsw"><h4>${title}</h4><div><div class="ctl">${ctl}</div><p class="why">${why}</p></div></div>`;
  const ro = v => `<span class="ro">${v}</span>`;
  const modeSel = (id, cur) => `<select id="${id}" aria-label="${id}">${MODES.map(m =>
    `<option value="${m}"${m === cur ? " selected" : ""}>${m}</option>`).join("")}</select>`;

  const claim = d.claim === null
    ? ro("not loaded (<code>schema-claim.sql</code>)")
    : `${modeSel("st_claim", d.claim)}<button class="btn" type="button" onclick="stClaim()">Save</button>`;
  const iot = d.iot === null
    ? ro("not loaded (<code>schema-policies.sql</code>)")
    : `${modeSel("st_iot", d.iot)}<button class="btn" type="button" onclick="stIot()">Save</button>`;
  const board = d.board === null
    ? ro("not loaded (<code>schema-badges.sql</code>)")
    : d.board
      ? `<span class="pill" style="color:var(--ok)">on</span><button class="btn" type="button" onclick="stBoard(false)">Turn it off</button>`
      : `<span class="pill">off</span><button class="btn" type="button" onclick="stBoard(true)">Turn it on</button>`;
  const slow = d.slow
    ? `<input id="st_rate" type="number" min="32" max="9999" value="${esc(String(d.slow.rate_kbit))}" aria-label="kbit per second"> kbit/s
       <select id="st_timeout" aria-label="what running out of time does">
         <option value="cut"${d.slow.on_timeout === "cut" ? " selected" : ""}>out of time cuts the internet</option>
         <option value="slow"${d.slow.on_timeout === "slow" ? " selected" : ""}>out of time drops into the slow lane</option>
       </select><button class="btn" type="button" onclick="stSlow()">Save</button>`
    : ro("not loaded (<code>schema-slow.sql</code>)");
  const quiet = d.routes.length
    ? d.routes.map(r => `<code>${esc(r.name)}</code>: ${r.quiet_start_min === null || r.quiet_end_min === null
        ? "no quiet hours" : `quiet ${hhmm(r.quiet_start_min)} to ${hhmm(r.quiet_end_min)}${r.quiet_urgent ? ", urgent still gets through" : ", urgent waits too"}`}`).join("<br>")
    : "no phone routes set up";
  const flagWin = process.env.PORTAL_FLAG_WINDOW_MIN ? `${esc(process.env.PORTAL_FLAG_WINDOW_MIN)} minutes` : "20 minutes (the default)";

  return `<div class="card"><h2>Household switches</h2>
    <p class="sub">The things that are off until a parent turns them on, and the numbers the whole house shares.
      A default is never flipped by an update. Anything that lives in a file rather than the database is shown
      here as it is, with where it lives.</p>
    ${sw("Device claiming", claim,
      `<b>Off by default, and it stays that way.</b> A new device gets a lease and the internet, as it always has.
       <i>observe</i> restricts nothing and counts what enforcing would catch (<code>genkan unclaimed</code>).
       <i>enforce</i> gives a device nobody owns DNS, the portal and the safety net only, until a child claims it
       and you confirm. A child's claim on its own grants nothing. <code>docs/DEVICE-IDENTITY.md</code>.`)}
    ${sw("Household IoT policy", iot,
      `What each camera, lock, speaker and vacuum may talk to. It ships in <i>observe</i>, where every rule that
       would refuse traffic is a counter instead, so nothing in the house behaves differently. <i>enforce</i> makes
       the refusals real. The timer that keeps it fresh (<code>kids-iot-policy.timer</code>) is
       ${d.iotTimer ? "<b>enabled</b> on this box" : "<b>not enabled</b> on this box, so a mode change is applied once, now, and not refreshed as addresses move"}.
       <code>docs/HOUSEHOLD-SECURITY.md</code> before enforcing.`)}
    ${sw("The house board", board,
      `<b>Off by default.</b> The one place siblings are compared. It compares improvement and effort, never raw
       totals, because a raw leaderboard is a race the youngest loses every day by construction. A child's own
       badges are always theirs to see, whatever this says. <code>docs/GAMIFICATION.md</code>.`)}
    ${sw("The slow lane", slow,
      `The third state between on and off: the video still plays, it just buffers. 256 kbit/s is the shipped
       rate. Running out of time <b>cuts</b> the internet unless you choose the slope, because changing what
       happens at zero without being asked would be somebody's evening changed by an upgrade. The gateway picks
       up a change within fifteen seconds. The safety net is never slowed.`)}
    ${sw("The portal's flag window", ro(flagWin),
      `How long after a Tor, darknet or drugs lookup the portal shows the "come find me" page instead of the plain
       blocked page. Read only: it is <code>PORTAL_FLAG_WINDOW_MIN</code> in the portal container's environment
       (<code>compose.yaml</code>), which this dashboard cannot see, so this is the default unless you set it.
       Self-harm is never on that page and never blocks anything.`)}
    ${sw("Whole-house cut", ro("60 minutes when no length is given; the Family page offers 30, 60 and 120"),
      `There is no stored default and no setting to change here. It is a number you choose each time, on purpose:
       a cut that outlives the reason for it is the failure this design avoids, so every cut carries its own clock
       and lifts itself.`)}
    ${sw("Notification quiet hours", ro(quiet),
      `Per phone route, set on the <a href="/notify">Notifications page</a> or with
       <code>genkan-notify set &lt;route&gt; --quiet 21:30-07:00</code>. Read only here.`)}
    ${sw("Household timezone", ro(`<code>${esc(d.tz || "unknown")}</code>`),
      `The database's day boundary: when a budget resets and when a bedtime is. Read only: <code>deploy.sh</code>
       sets it from <code>GENKAN_TZ</code> in <code>config.env</code>. If this is UTC, every budget and bedtime
       is twelve hours out, and <code>docs/OPERATIONS.md</code> says what to run.`)}
  </div>`;
}

// A days picker: the presets, plus "other" for whatever is typed in the box
// beside it. Both carry the same value; the box is what Save reads.
function daysPicker(id, val) {
  const opts = DAY_PRESETS.map(d => `<option value="${d}"${d === val ? " selected" : ""}>${d} days</option>`).join("");
  const other = DAY_PRESETS.includes(val) ? "" : " selected";
  return `<select id="stp_${esc(id)}" aria-label="preset" onchange="stRetPick('${esc(id)}')">${opts}<option value="other"${other}>other</option></select>
    <input id="std_${esc(id)}" type="number" inputmode="numeric" min="1" max="3650" value="${esc(String(val))}"
      aria-label="days" oninput="stRetTyped('${esc(id)}')"> <span class="d">days</span>`;
}

function storagePanel(d) {
  const s = d.storage || {};
  const disk = d.disk;
  const g = s.growth;
  const stat = (k, v, sub, off = false) => `<div><div class="k">${k}</div><div class="v${off ? " off" : ""}">${v}</div><div class="s">${sub}</div></div>`;
  const stats = `<div class="stst">
    ${s.dbBytes !== null && s.dbBytes !== undefined
      ? stat("The database", esc(human(s.dbBytes)), "everything Genkan has recorded, on this box")
      : stat("The database", "could not ask", "the size query did not answer", true)}
    ${disk
      ? stat("Free on the disk", esc(human(disk.avail)), `${esc(human(disk.used))} of ${esc(human(disk.total))} used${disk.pct >= 90 ? ", which is nearly full" : ""}`)
      : stat("Free on the disk", "not readable", "the filesystem did not answer", true)}
    ${g && g.perDay > 0
      ? stat("Growing by", g.monthBytes === null ? "unknown" : `about ${esc(human(g.monthBytes))} a month`,
        `${esc(about(Math.round(g.perDay)))} lookups a day this week, at what a typical lookup row costs on disk`)
      : stat("Growing by", "nothing yet", "no lookups in the last seven days", true)}
  </div>`;

  const wait = s.retentionReady ? "" : `<div class="stwait">The retention rows are missing: load
    <code>config/db/schema-retention.sql</code> (or re-run <code>config/db/load.sh</code>) and the nightly prune has
    something to read. Until then nothing is pruned, which is the safe way for it to fail.</div>`;

  const rows = (s.tables || []).map(t => {
    const sens = t.what === "dns_log";
    return `<div class="stret">
      <div><h4>${esc(WHAT_LABEL[t.what] || t.what)}<code>${esc(t.what)}</code>${sens ? ' <span class="pill sens">the sensitive one</span>' : ""}</h4>
        <p class="facts">${esc(human(t.bytes))} &middot; about ${esc(about(t.rows))} rows${t.oldest ? ` &middot; oldest ${esc(dateNZ(t.oldest))}` : " &middot; empty"}</p></div>
      <div class="ctl">${daysPicker(t.what, t.keep_days)}<button class="btn" type="button" onclick="stRetSave('${esc(t.what)}')">Save</button></div>
      <p class="why">${esc(t.note || "")}${sens ? ` <b>Its default is the shortest for a reason:</b> a family does not need a permanent
        archive of its children's browsing, and a longer window has to justify itself on its own terms, not on the charts
        looking better (<code>PRIVACY-CHARTER.md</code>, P5).` : ""}</p>
    </div>`;
  }).join("");

  const top = (s.top || []).length
    ? `<div class="sttop">${s.top.map(t => `<span><b>${esc(t.name)}</b> ${esc(human(t.bytes))}, about ${esc(about(t.rows))} rows</span>`).join("")}</div>
       <p class="mghint">Tables without a retention row are reference data or settings (the category and vendor lists, the quiz banks,
         the Tor relay list, who lives here) and are never pruned.</p>`
    : "";

  const timer = d.demo ? "" : d.pruneTimer
    ? `<code>kids-prune.timer</code> is enabled on this box and runs at 03:20 each night.`
    : `<b><code>kids-prune.timer</code> is not enabled on this box</b>, so nothing runs nightly until <code>deploy.sh</code>
       is run again or the timer is enabled by hand; the buttons below still work.`;

  return `<div class="card" id="storage"><h2>Storage</h2>
    <p class="sub">How big the database is, what is in it, and how long each kind of record is kept. Everything
      Genkan records lives in one Postgres database on this box and never leaves the house. It does not have to stay
      forever either: a complete record of a child's adolescence sitting in a cupboard is not what anybody agreed to.</p>
    ${stats}
    ${wait}
    <div class="mgsec">What is kept, and for how long</div>
    <p class="mghint">One rule per table. The nightly prune deletes whatever is older than the rule and nothing else.
      ${timer} Pick a preset or type any number of days from 1 to 3650. A change is audited in the block log like every
      other save on this page.</p>
    ${rows || '<div class="empty">No retention rows.</div>'}
    ${top ? `<div class="mgsec">The largest tables</div>${top}` : ""}

    <div class="mgsec">Prune now, rather than tonight</div>
    <p class="mghint">The preview asks the pruner what it would delete and changes nothing. Delete runs the same
      nightly prune now, after showing you the numbers.</p>
    <div class="mgacts">
      <button class="btn" type="button" onclick="stPrunePreview()">Show what would go</button>
      <button class="decline" type="button" onclick="stPruneNow()">Delete it now</button>
    </div>
    <pre class="stout" id="st_prune" hidden></pre>

    <div class="mgsec">Delete DNS lookups older than a number of days</div>
    <p class="mghint">A one-off for the table that grows fastest. It does not change the rule above: keep 30 days as
      the rule and clear back to 7 today, if that is what you want.</p>
    <div class="mgacts">${daysPicker("dns", 30)}<button class="decline" type="button" onclick="stPruneDns()">Delete older lookups</button></div>

    <p class="mghint" style="margin-top:14px"><b>What a prune cannot undo.</b> A deleted row is gone. Genkan keeps no
      copy and makes no backup of its own; <code>docs/OPERATIONS.md</code> has the one-line <code>pg_dump</code> that
      does, and the backup is yours to keep in the house. After a delete, Postgres keeps the freed space for new rows,
      so the sizes here shrink straight away only when the rows at the end of a table have gone; the rest is reused
      rather than returned. ${d.demo ? "<b>This is the demo:</b> the figures are the demo's own database, and the buttons change nothing." : ""}</p>
  </div>`;
}

function cannotPanel() {
  return `<div class="card"><h2>What this page cannot do</h2>
    <ul class="stcannot">
      <li><b>A blocklist for one device.</b> AdGuard's filter lists (OISD, the NSFW list and the rest) apply to
        every device or to none. A level can block services and turn parental control on; it cannot pick a list.</li>
      <li><b>Show the portal on an HTTPS page.</b> A cut-off child typing an https address gets a connection reset,
        not the "time's up" page. That is every captive portal's limit, not ours: nothing can paint inside a
        secure page it does not own. Plain http addresses and the OS's own captive-portal check do reach it.</li>
      <li><b>See through a VPN or WARP.</b> A device with a VPN on is one encrypted stream to one address. Its
        names are invisible, its categories cannot be metered, and the level's DNS rules do not reach it. The
        firewall refuses known Tor relays and the DNS forcing stops the easy bypasses; a proper VPN is
        bug-bounty territory in this house, by design.</li>
      <li><b>Read messages.</b> Snapchat, Instagram and Discord DMs are end-to-end encrypted. The network sees
        that the app was used, never what was said.</li>
    </ul>
  </div>`;
}

// GET /settings
export async function settingsPage(q, s) {
  const d = await settingsData(q);
  return `<div class="card flat"><h2 style="margin-bottom:2px">Settings</h2>
    <p class="sub">What each filter level means, what a cut-off child can still reach, and the household switches.
      Every save here runs the same <code>genkan</code> command you could type, so it is gated, audited in the
      block log, and pushed to AdGuard and the firewall the same way.</p></div>
    ${levelsPanel(s, d)}
    ${allowPanel(d)}
    ${switchesPanel(d)}
    ${storagePanel(d)}
    ${cannotPanel()}`;
}
