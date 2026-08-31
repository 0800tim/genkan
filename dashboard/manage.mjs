// Genkan dashboard: the manage area.
//
// Everything a parent needs to change about WHO is on the network and WHAT
// belongs to them, in one place. Until this existed the only way to add a
// child or rename a device was the command line, which is not a thing you can
// hand to the other parent.
//
// Two rules shape it:
//   1. Where a change has to reach the DNS filter, we call the tools that
//      already know how (bin/kidnet assign, bin/genkan-adguard-clients,
//      bin/genkan-adguard). None of that logic is reimplemented here, so there
//      is exactly one place where the AdGuard client mapping is decided.
//   2. Nothing destructive happens without saying, in plain words, what will
//      happen to the devices attached to it.
import { esc } from "./charts.mjs";
// Who is in the house right now, grouped by role, with the group controls and
// the one button a departing guest needs. See dashboard/household.mjs.
// The device classes come from household.mjs rather than being written out
// again here. There were two copies of that list and they were already drifting:
// this page never offered "shared family device" at all, so the one page a
// parent goes to to sort their devices out could not do the thing the class
// exists for.
import { housePanel, CLASSES } from "./household.mjs";
// Bedtimes. The times a child goes off and comes back are a "who is on the
// network" decision, so they belong on this page next to the daily limits.
import { schedulePanel } from "./schedule.mjs";

// Filter levels come from the policies table so this page cannot drift from
// whatever the household actually has; these are only the plain-language names
// and the fallback note for a level nobody has described yet.
const TIER_LABEL = {
  young: "Young", standard: "Standard", teen: "Teen", guest: "Guest", adult: "Adult",
};
const TIER_NOTE = {
  young: "Tightest filter. Blocks adult, gambling, drugs, self-harm, dating, weapons, violence and VPNs.",
  standard: "The middle setting. Blocks adult, gambling, drugs, self-harm, weapons and VPNs.",
  teen: "Lightest of the kid levels. Blocks the extreme end, self-harm, drugs and VPNs.",
  guest: "For a visitor. Malware and adult content only, and their browsing is not logged individually.",
  adult: "No filtering beyond the household blocklists, and no time limit.",
};
const tierName = t => TIER_LABEL[t] || (String(t).charAt(0).toUpperCase() + String(t).slice(1));
// The four household roles, in the same vocabulary the database enforces.
const KINDS = [
  ["child", "Child who lives here"],
  ["guest-child", "Visiting child"],
  ["guest-adult", "Visiting adult"],
  ["adult", "Adult who lives here"],
];
// Only the categories that are actually metered can carry a budget. Audio,
// schoolwork and messaging are never counted, so offering a box for them would
// promise enforcement that does not exist (see METERING.md).
const BUDGET_CATS = [["gaming", "Gaming"], ["video", "Video"], ["social", "Social"]];

export const MANAGE_CSS = `
.mg{display:grid;gap:10px 12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:10px 0 0}
.mg label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;
  color:var(--ink-muted);margin-bottom:3px;font-weight:600}
.mg input,.mg select{width:100%}
.mg .wide{grid-column:1/-1}
.mgcard{border:1px solid var(--line);border-radius:14px;padding:13px;margin-bottom:10px;background:var(--surface-2)}
.mgcard>.mh{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
.mgcard>.mh h3{flex:1;min-width:110px}
.mgacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center}
.mgacts .grow{flex:1}
.danger{background:transparent;border:1px solid color-mix(in oklab,var(--crit) 45%,transparent);
  color:var(--crit);border-radius:10px;padding:9px 13px;font-size:13px;cursor:pointer;font-family:inherit}
.danger:hover{background:color-mix(in oklab,var(--crit) 12%,transparent)}
.mgwarn{font-size:12.5px;color:var(--ink-2);background:color-mix(in oklab,var(--crit) 9%,var(--surface));
  border:1px solid color-mix(in oklab,var(--crit) 30%,transparent);border-radius:10px;padding:10px 12px;margin-top:10px}
.mgwarn b{color:var(--crit)}
.mgwarn ul{margin:6px 0 0;padding-left:18px}
.mghint{font-size:11.5px;color:var(--ink-muted);margin:6px 0 0}
.mgnum{font-variant-numeric:tabular-nums}
.mgsec{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-muted);
  font-weight:600;margin:14px 0 6px}
`;

export const MANAGE_JS = `
function mgVal(id){var el=document.getElementById(id);return el?el.value.trim():'';}
function mgBudgets(id){
  var out={};
  ${JSON.stringify(BUDGET_CATS.map(c => c[0]))}.forEach(function(c){
    var el=document.getElementById('bg_'+c+'_'+id); if(!el)return;
    var v=el.value.trim(); out[c]=v===''?null:Number(v);});
  return out;
}
async function mgPost(url,body,msg){
  say(msg||'saving\\u2026');
  var x=await post(url,body);
  done(x.r,x.j,900);
  return x.j;
}
function saveChild(id){
  mgPost('/api/child',{op:'save',id:id,name:mgVal('cn_'+id),age:mgVal('ca_'+id),
    kind:mgVal('ck_'+id),tier:mgVal('ct_'+id),budgets:mgBudgets(id)},'saving\\u2026');
}
function addChild(){
  var n=mgVal('newname');
  if(!n){say('Give them a name first.');return;}
  mgPost('/api/child',{op:'add',name:n,age:mgVal('newage'),kind:mgVal('newkind'),tier:mgVal('newtier')},'adding\\u2026');
}
function removeChild(id,name,devices){
  var lines=['Remove '+name+' from Genkan?','',
    'What happens:',
    '\\u2022 '+devices+' device(s) assigned to them go back to the unnamed list. They keep working, but with no filtering tier and no time limits until you assign them to somebody.',
    '\\u2022 Their time ledger, category budgets and recorded usage are deleted.',
    '\\u2022 Their AdGuard client is emptied so the tier stops applying to old addresses.',
    '\\u2022 Nothing is blocked or unblocked for anybody else.','',
    'This cannot be undone.'];
  if(!confirm(lines.join('\\n')))return;
  mgPost('/api/child',{op:'remove',id:id},'removing\\u2026');
}
function saveTier(tier){
  mgPost('/api/tier',{tier:tier,school:mgVal('ts_'+tier),weekend:mgVal('tw_'+tier)},'saving the tier\\u2026');
}
function saveDevice(id){
  mgPost('/api/device',{id:id,label:mgVal('dl_'+id),person:mgVal('dp_'+id),cls:mgVal('dc_'+id)},'saving the device\\u2026');
}
`;

const sel = (id, opts, cur, label) =>
  `<label for="${esc(id)}">${esc(label)}</label><select id="${esc(id)}">`
  + opts.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")
  + `</select>`;

const num = (id, label, val, { min = 0, max = 1440, ph = "" } = {}) =>
  `<label for="${esc(id)}">${esc(label)}</label><input id="${esc(id)}" type="number" inputmode="numeric"`
  + ` min="${min}" max="${max}" value="${val === null || val === undefined ? "" : esc(String(val))}"`
  + ` placeholder="${esc(ph)}">`;

// ---------------------------------------------------------------------------
// The page. mg = { budgets, deviceCounts, policies }
// ---------------------------------------------------------------------------
export function family(s, mg) {
  const pols = (mg.policies || []).slice().sort((a, b) =>
    ["young", "standard", "teen", "guest", "adult"].indexOf(a.tier)
    - ["young", "standard", "teen", "guest", "adult"].indexOf(b.tier));
  const tierOpts = pols.map(p => [p.tier, tierName(p.tier)]);
  const counts = mg.deviceCounts || {};
  const budgets = mg.budgets || {};
  const times = new Map((s.times || []).map(t => [t.child_id, t]));

  const kids = (s.children || []).map(c => {
    const b = budgets[c.id] || {};
    const n = counts[c.id] || 0;
    const t = times.get(c.id);
    return `<div class="mgcard">
      <div class="mh"><h3>${esc(c.name)}</h3>
        ${c.active === false ? '<span class="pill">not here right now</span>' : ""}
        <span class="tag mgnum">${n} device${n === 1 ? "" : "s"}${t ? ` &middot; ${t.used_min || 0} min used today` : ""}</span></div>
      <div class="mg">
        <div><label for="cn_${c.id}">Name</label><input id="cn_${c.id}" value="${esc(c.name)}" maxlength="32"></div>
        <div>${num(`ca_${c.id}`, "Age", c.age, { min: 0, max: 25, ph: "not set" })}</div>
        <div>${sel(`ck_${c.id}`, KINDS, c.kind || "child", "They are a")}</div>
        <div>${sel(`ct_${c.id}`, tierOpts, c.policy_tier, "Filter level")}</div>
      </div>
      <div class="mgsec">Daily limit per kind of thing, in minutes</div>
      <div class="mg">
        ${BUDGET_CATS.map(([k, l]) => `<div>${num(`bg_${k}_${c.id}`, l, b[k] ?? null, { min: 0, max: 1440, ph: "no limit" })}</div>`).join("")}
      </div>
      <p class="mghint">Leave a box empty for no limit. Music, schoolwork and messaging are never counted,
        so they never run out. When a limit is reached that one thing is blocked for the rest of the day;
        the rest of the internet keeps working.</p>
      <div class="mgacts">
        <button class="btn primary" type="button" onclick="saveChild(${c.id})">Save ${esc(c.name)}</button>
        <span class="grow"></span>
        <button class="danger" type="button" onclick="removeChild(${c.id},${esc(JSON.stringify(c.name))},${n})">Remove</button>
      </div>
    </div>`;
  }).join("");

  const add = `<div class="card"><h2>Add someone</h2>
    <p class="sub">A new person needs a matching client in AdGuard for their filter level to apply.
      Genkan will tell you straight after saving whether it found one.</p>
    <div class="mg">
      <div><label for="newname">Name</label><input id="newname" maxlength="32" placeholder="e.g. Sam"></div>
      <div>${num("newage", "Age", null, { min: 0, max: 25, ph: "e.g. 9" })}</div>
      <div>${sel("newkind", KINDS, "child", "They are a")}</div>
      <div>${sel("newtier", tierOpts, "standard", "Filter level")}</div>
    </div>
    <div class="mgacts"><button class="btn primary" type="button" onclick="addChild()">Add them</button></div>
  </div>`;

  const tiers = `<div class="card"><h2>What each filter level means</h2>
    <p class="sub">These settings apply to <b>everyone</b> on that level, not to one person. The daily
      minutes are the general screen-time allowance a school day or a weekend day starts with.
      Leave them empty for no limit.</p>
    ${pols.map(p => `<div class="mgcard"><div class="mh"><h3>${esc(tierName(p.tier))}</h3>
      <span class="tag mgnum">${(s.children || []).filter(c => c.policy_tier === p.tier).length} on this level</span></div>
      <p class="sub" style="margin:4px 0 0">${esc(p.description || TIER_NOTE[p.tier] || "")}</p>
      <div class="mg">
        <div>${num(`ts_${p.tier}`, "School day minutes", p.daily_budget_school_min, { min: 0, max: 1440, ph: "no limit" })}</div>
        <div>${num(`tw_${p.tier}`, "Weekend minutes", p.daily_budget_weekend_min, { min: 0, max: 1440, ph: "no limit" })}</div>
      </div>
      <div class="mgacts"><button class="btn" type="button" onclick="saveTier('${esc(p.tier)}')">Save ${esc(tierName(p.tier))}</button></div>
    </div>`).join("")}</div>`;

  const people = [{ v: "", l: "Nobody yet" }].concat((s.people || []).map(p => ({ v: p.name, l: p.name })));
  const devs = CLASSES.map(([cls, title, note]) => {
    const rows = (s.devices || []).filter(d => (d.category || "personal") === cls);
    if (!rows.length) return "";
    return `<div class="card"><h2>${esc(title)} (${rows.length})</h2><p class="sub">${esc(note)}</p>
      ${rows.map(d => `<div class="mgcard">
        <div class="mh"><h3>${esc(d.label || d.hostname || "(unnamed)")}</h3>
          ${d.online ? '<span class="pill" style="color:var(--ok)">online now</span>' : '<span class="pill">not seen lately</span>'}</div>
        <p class="sub" style="margin:4px 0 0"><code>${esc([d.device_kind, d.vendor, d.ip || "no reserved address", d.mac].filter(Boolean).join(" &middot; "))}</code></p>
        <div class="mg">
          <div class="wide"><label for="dl_${d.id}">What to call it</label>
            <input id="dl_${d.id}" value="${esc(d.label || d.hostname || "")}" maxlength="40" placeholder="e.g. Sam's laptop"></div>
          <div>${sel(`dp_${d.id}`, people.map(p => [p.v, p.l]), d.person || "", "Whose is it")}</div>
          <div>${sel(`dc_${d.id}`, CLASSES.map(c => [c[0], c[1]]), d.category || "personal", "What kind of thing")}</div>
        </div>
        <div class="mgacts"><button class="btn" type="button" onclick="saveDevice(${d.id})">Save</button></div>
      </div>`).join("")}</div>`;
  }).join("");

  const unnamed = (s.devices || []).filter(d => d.unassigned && d.category === "personal"
    && !["ap", "infra", "gateway"].includes(d.device_kind));
  const queue = unnamed.length ? `<div class="mgwarn"><b>${unnamed.length} device${unnamed.length > 1 ? "s have" : " has"} no owner.</b>
    Until a device is assigned, nothing it does can be counted towards anybody, which is why a child's
    numbers can read zero while their tablet is clearly busy. They are in the list below marked
    &ldquo;Nobody yet&rdquo;.</div>` : "";

  return `${housePanel(s)}
    <div class="card"><h2>Who is on the network</h2>
      <p class="sub">Add a child or a guest, change what they can reach, and set how long each kind of
        thing lasts them in a day. Changes reach the filter straight away.</p>
      ${queue}${kids || '<div class="empty">Nobody yet. Add your first person below.</div>'}</div>
    ${add}
    ${schedulePanel(s, mg.schedule)}
    ${tiers}
    <div class="card flat"><h2 style="margin-bottom:2px">Devices</h2>
      <p class="sub">Rename anything, hand it to someone else, or take it out of one child's hands entirely.
        A <b>shared family device</b> is the lounge TV or the iPad everybody uses: nobody's minutes pay for it,
        it has a filter level of its own, and you choose on the
        <a href="/devices">Devices page</a> whether it goes off at dinner and in a whole-house cut.
        Smart home kit, appliances and network equipment are never assigned to a child, never metered,
        and never cut by any control at all.</p></div>
    ${devs || '<div class="card"><div class="empty">No devices yet. They appear here as they join the network.</div></div>'}`;
}

export { KINDS, CLASSES, BUDGET_CATS };
