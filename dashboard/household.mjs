// Genkan dashboard: household roles, and the things a parent does with them.
//
// One place decides what the four roles are called, what they mean, and what
// each one is allowed to do, so the family page, the naming queue, the API
// validation and the plain-English notes on screen can never drift apart.
// The enforcement side of the same model lives in config/db/schema-roles.sql
// and bin/kidnet; this file is only ever the front of it.
//
// Why it is a separate module: dashboard/views.mjs and dashboard/server.mjs are
// long, shared and edited by other hands. Everything here is additive, and the
// two shared files touch it in about six lines between them.
import { esc } from "./charts.mjs";

// [value, label, one line a parent can read, longer note]
export const ROLES = [
  ["child", "Child", "One of ours",
    "Full time budget, their age's filter level, learn to earn, and their week in the digest. Caught by every control aimed at the kids."],
  ["guest-child", "Guest child", "A friend's kid, visiting",
    "Filtered like a child and caught by every control aimed at the kids, including bedtime. No time budget of their own, nothing to earn, and left out of the family's numbers."],
  ["guest-adult", "Guest adult", "A visiting grown-up",
    "Malware and adult content only, no time limit, and never caught by a kids' control. Turning streaming off at 11pm leaves them alone."],
  ["adult", "Adult", "A grown-up who lives here",
    "Effectively unrestricted. Only the 'everyone' control reaches them, and nothing else ever will."],
];
export const ROLE_VALUES = ROLES.map(r => r[0]);
export const ROLE_LABEL = Object.fromEntries(ROLES.map(r => [r[0], r[1]]));
export const isKid = k => k === "child" || k === "guest-child";
export const isGuest = k => k === "guest-child" || k === "guest-adult";

// Filter levels. 'adult' joins the three kid levels and the visitor level, so a
// household grown-up is not quietly filed on a teenager's filter.
export const TIERS = [
  ["young", "Young", "Tightest filter. Blocks adult, gambling, drugs, self-harm, dating, weapons, violence and VPNs."],
  ["standard", "Standard", "The middle setting. Blocks adult, gambling, drugs, self-harm, weapons and VPNs."],
  ["teen", "Teen", "Lightest kid filter. Blocks the extreme end, self-harm, drugs and VPNs. No daily time cap by default."],
  ["guest", "Guest", "For a visiting grown-up. Malware and adult content only, and their browsing is not logged against a name."],
  ["adult", "Adult", "No filtering beyond the household blocklists, no SafeSearch, no time limit."],
];
export const TIER_VALUES = TIERS.map(t => t[0]);
// What a role gets if the parent does not choose. A visiting child gets
// 'standard' rather than the tightest level: you rarely know a friend's kid's
// age, standard still blocks adult, gambling, drugs, self-harm and weapons with
// SafeSearch on, and it is one click to tighten.
export const DEFAULT_TIER = { child: "standard", "guest-child": "standard", "guest-adult": "guest", adult: "adult" };

export const CLASSES = [
  ["personal", "A person's device", "Phones, tablets, laptops, consoles. Filtered and metered by whoever owns it."],
  ["shared", "Shared family device", "The lounge TV, the iPad everybody uses. Filtered at a level you pick, and nobody's minutes pay for it. Goes off at dinner and in a whole-house cut unless you untick it."],
  ["iot", "Smart home", "Cameras, speakers, lights, locks, the vacuum. Never assigned to a person, never metered, and never cut by a family pause."],
  ["appliance", "Unrestricted device", "An SMS gateway, a server, a media box. Full internet, no time limits, never caught by a kids control, but still protected and visible."],
  ["infra", "Network equipment", "The access point, a switch, the gateway itself. Not somebody's device at all."],
];
export const CLASS_VALUES = CLASSES.map(c => c[0]);

// The scoped controls a parent can point at a group, in the order they are
// most likely to want them.
export const SCOPES = [
  ["kids", "All kids", "Everyone under our roof and every visiting child."],
  ["guests", "All guests", "Every visitor, child and grown-up."],
  ["guest-kids", "Guest kids", "Visiting children only."],
  ["all", "Everyone but the adults", "The kids, the visiting kids, and any device nobody has claimed yet."],
];

// The two sweeps a parent can point at the house, and what each one means in
// a sentence. One place, so the tick boxes, the confirm dialogs and the API
// validation can never describe them differently.
export const SWEEPS = [
  ["dinner", "Off at dinner", "\u201ckidnet dinner\u201d and the Dinner button reach this device."],
  ["house", "Off in a whole-house cut", "The one big button reaches this device."],
];
export const SWEEP_VALUES = SWEEPS.map(s => s[0]);
// Which classes can be in a sweep at all. Smart home, appliances and network
// equipment are in neither, always, and the database enforces that in
// device_sweeps rather than trusting this list. This is only what the page
// offers; the answer is not ours to give.
export const SWEEPABLE = ["personal", "shared"];

const MAC_RE = /^[0-9a-f:]{17}$/i;
const LABEL_RE = /^[A-Za-z0-9_:+.,'’ -]{1,40}$/;

// ---------------------------------------------------------------------------
// The pieces the shared views borrow
// ---------------------------------------------------------------------------
// The owner cannot currently get a smart lock out of the "assign this to a kid"
// queue, which is why his front door is sitting in a list of children. The
// queue's owner picker therefore offers the two non-person answers as well.
// `current` is the owner the device already has, so the picker opens on the
// truth rather than resetting to whoever happens to sort first. Without it a
// parent who assigned a laptop to themselves came back to a box naming the
// first child in the list, and, worse, pressing Assign without touching the
// picker handed the device to that child. The blank first option fixes it:
// nothing is ever assigned by default, the parent has to choose.
export function assignOptions(people = [], current = "") {
  const sel = v => (String(current || "").toLowerCase() === String(v).toLowerCase() ? " selected" : "");
  const grp = (role) => {
    const rows = people.filter(p => (p.kind || "child") === role);
    if (!rows.length) return "";
    return `<optgroup label="${esc(ROLE_LABEL[role] || role)}">`
      + rows.map(p => `<option value="${esc(p.name)}"${sel(p.name)}>${esc(p.name)}</option>`).join("")
      + `</optgroup>`;
  };
  return `<option value=""${current ? "" : " selected"} disabled>Choose an owner\u2026</option>`
    + ROLE_VALUES.map(grp).join("")
    + `<optgroup label="Not a person">`
    + `<option value="__shared">Shared family device</option>`
    + `<option value="__iot">Smart home device</option>`
    + `<option value="__appliance">Unrestricted device</option>`
    + `<option value="__infra">Network equipment</option>`
    + `</optgroup>`;
}

// The little "(guest child)" next to a device's owner.
export function roleTag(kind) {
  if (!kind || kind === "child") return "";
  return ` (${(ROLE_LABEL[kind] || kind).toLowerCase()})`;
}

// ---------------------------------------------------------------------------
// Who is in the house: the strip on Home, and the sections on Family
// ---------------------------------------------------------------------------
// Guests arrive and leave, so this has to be readable in one glance and one
// tap deep: who is here, what they are, and the button that sends them home.
export function housePanel(s) {
  const all = s.household || [];
  const here = all.filter(p => p.active !== false);
  const gone = all.filter(p => p.active === false);
  const guests = here.filter(p => isGuest(p.kind));

  const row = p => `<div class="row hhrow">
    <span><b>${esc(p.name)}</b>
      <span class="tag">${esc(ROLE_LABEL[p.kind] || p.kind)}</span>
      <span class="pill">${esc(p.policy_tier || "")}</span>
      <code>${p.devices || 0} device${p.devices === 1 ? "" : "s"}</code>
      ${p.devices_online ? '<span class="dot-on"></span>online' : ""}</span>
    <span>${isGuest(p.kind)
      ? `<button class="decline" type="button" onclick="guestLeave(${p.id},${esc(JSON.stringify(p.name))})">Gone home</button>`
      : ""}</span></div>`;

  const groups = ROLES.map(([role, label]) => {
    const rows = here.filter(p => p.kind === role);
    if (!rows.length) return "";
    return `<div class="mgsec">${esc(label)}</div>${rows.map(row).join("")}`;
  }).join("");

  const past = gone.length ? `<details class="hhpast"><summary>${gone.length} past guest${gone.length > 1 ? "s" : ""}</summary>`
    + gone.map(p => `<div class="row hhrow"><span>${esc(p.name)} <span class="tag">${esc(ROLE_LABEL[p.kind] || p.kind)}</span></span>
        <span><button class="approve" type="button" onclick="guestBack(${p.id})">They are back</button>
        <button class="decline" type="button" onclick="guestRemove(${p.id},${esc(JSON.stringify(p.name))})">Delete</button></span></div>`).join("")
    + `</details>` : "";

  // The scoped controls, spelled out. A parent should never have to remember
  // that "kids" quietly means something different from "everyone".
  const controls = `<div class="mgsec">Turn a whole group off</div>
    <div class="scopebar">${SCOPES.map(([v, l, note]) => `<div class="sc" title="${esc(note)}">
      <b>${esc(l)}</b>
      <button class="decline" type="button" onclick="act('off','${esc(v)}')">Off</button>
      <button class="approve" type="button" onclick="act('on','${esc(v)}')">On</button>
    </div>`).join("")}</div>
    <p class="mghint">${esc(SCOPES.map(x => `${x[1]}: ${x[2]}`).join("  "))}</p>`;

  // The whole-house cut. Deliberately not styled like the scoped controls next
  // to it: it is a different kind of thing, it names how long it lasts before
  // you press it, and it says out loud what it will not touch.
  const h = s.house || {};
  const houseCard = `<div class="mgsec">Everything off</div>
    <div class="houserow">
      ${h.is_off
        ? `<span class="housenow"><b>The house is off.</b> ${esc(String(h.minutes_left || 0))} minute${h.minutes_left === 1 ? "" : "s"} left,
             then it comes back on by itself.</span>
           <button class="approve" type="button" onclick="houseOn()">Back on now</button>`
        : `<span class="housenote">${esc(String(h.devices_caught || 0))} device${h.devices_caught === 1 ? "" : "s"} would go off.
             Never the smart home, the appliances or the access point, and never the help lines.</span>
           <span class="housebtns">
             ${[30, 60, 120].map(m => `<button class="decline" type="button" onclick="houseOff(${m})">Off for ${m < 60 ? m + " min" : (m / 60) + "h"}</button>`).join("")}
           </span>`}
    </div>
    <p class="mghint">It lifts itself when the time is up, so nothing stays cut off if nobody is home to undo it.
      Untick a device on the Devices page to leave it out.</p>`;

  return `<div class="card"><h2>Who is in the house</h2>
    <p class="sub">${guests.length
      ? `${guests.length} guest${guests.length > 1 ? "s" : ""} here right now. `
      : ""}A control aimed at the kids reaches every child under this roof and every visiting child.
      It never reaches a visiting grown-up.</p>
    ${groups || '<div class="empty">Nobody yet.</div>'}${controls}${houseCard}${past}</div>`;
}

export const HOUSEHOLD_CSS = `
.hhrow .tag{margin-left:6px}
.hhacts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.hhpast{margin-top:10px}
.hhpast summary{cursor:pointer;font-size:12.5px;color:var(--ink-muted)}
.scopebar{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.scopebar .sc{display:flex;gap:6px;align-items:center;border:1px solid var(--line);
  border-radius:12px;padding:7px 9px;background:var(--surface-2)}
.scopebar .sc b{font-size:12.5px}
.houserow{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:8px}
.housebtns{display:flex;gap:6px;flex-wrap:wrap}
.housenote,.housenow{font-size:12.5px;color:var(--ink-muted);flex:1 1 240px;line-height:1.45}
.housenow b{color:var(--crit)}
`;

export const HOUSEHOLD_JS = `
async function hhPost(body,msg){
  say(msg||'working\\u2026');
  var x=await post('/api/household',body);
  done(x.r,x.j,900);
  return x.j;
}
function guestLeave(id,name){
  if(!confirm(name+' has gone home?\\n\\n'
    +'\\u2022 Anything blocked for them is lifted first, so nothing of theirs is left cut off.\\n'
    +'\\u2022 Their devices are let go and stop counting as anybody\\u2019s.\\n'
    +'\\u2022 Their filter level stops applying.\\n'
    +'\\u2022 They are kept on a short list of past guests, so next visit is one tap.'))return;
  hhPost({op:'guest-leave',id:id},'showing them out\\u2026');
}
function guestBack(id){hhPost({op:'guest-back',id:id},'welcome back\\u2026');}
function guestRemove(id,name){
  if(!confirm('Delete '+name+' from Genkan for good? Their devices go back to the unnamed list.'))return;
  hhPost({op:'guest-remove',id:id},'removing\\u2026');
}
/* The whole-house cut. The confirm spells out what it does NOT reach, because
   the button says "everything off" and that is not literally true. */
function houseOff(min){
  if(!confirm('Turn the house off for '+min+' minutes?\\n\\n'
    +'\\u2022 Every device ticked for it loses the internet.\\n'
    +'\\u2022 The smart home, the appliances and the access point are untouched.\\n'
    +'\\u2022 The help lines still answer on every device.\\n'
    +'\\u2022 It comes back on by itself after '+min+' minutes.'))return;
  hhPost({op:'house',act:'off',minutes:min},'cutting the house\\u2026');
}
function houseOn(){hhPost({op:'house',act:'on'},'bringing it back\\u2026');}
/* One tick box. Sent as it is clicked: there is no Save button on this page and
   adding one for two check boxes would be worse. */
function setSweep(mac,sweep,on){
  hhPost({op:'device-sweep',mac:mac,sweep:sweep,on:!!on},'saving\\u2026');
}
/* A shared device's own filter level. */
function setDeviceTier(mac){
  var t=document.getElementById('dtier_'+mac);if(!t)return;
  hhPost({op:'device-tier',mac:mac,tier:t.value},'saving the filter level\\u2026');
}
/* The naming queue can now answer "it is not a person at all". */
async function assignClass(mac,cls){
  var label=document.getElementById('lbl_'+mac).value||'';
  return hhPost({op:'device-class',mac:mac,cls:cls,label:label},'filing it\\u2026');
}
`;

// ---------------------------------------------------------------------------
// The API. One endpoint, POST /api/household, so server.mjs gains three lines.
// ---------------------------------------------------------------------------
// ctx = { q, runKidnet, syncAdguard }
export async function householdApi(b, ctx) {
  const { q, runKidnet, syncAdguard } = ctx;
  const bad = out => ({ code: 400, ok: false, out });
  const op = String(b.op || "");

  if (op === "device-class") {
    const mac = String(b.mac || "");
    const cls = String(b.cls || "");
    const label = String(b.label || "").trim();
    if (!MAC_RE.test(mac)) return bad("which device?");
    if (!CLASS_VALUES.includes(cls)) return bad("That is not one of the choices.");
    if (label && !LABEL_RE.test(label)) return bad("A device name can be letters, numbers and simple punctuation, up to 40 characters.");
    const [d] = await q("SELECT id,label FROM devices WHERE mac::text=$1", [mac.toLowerCase()]);
    if (!d) return bad("Genkan has not seen that device.");
    // Smart home and infrastructure belong to the household, never to a person,
    // so filing one here also takes it off whoever had it. That is the whole
    // point: it gets the smart lock out of the queue of things to hand a child.
    // Smart home, infrastructure and a shared family device all belong to the
    // household, never to a person, so filing one here also takes it off
    // whoever had it. For the shared class that is the entire point: a family
    // iPad that stays somebody's keeps eating that child's minutes.
    //
    // A shared device also gets a filter level of its own, defaulting to
    // standard. Without one it falls through to the household catch-all, which
    // blocks ads and malware and nothing else, and an unfiltered television in
    // the lounge is a worse outcome than a wrongly billed one.
    await q(`UPDATE devices SET category=$2, label=COALESCE(NULLIF($3,''), label),
             child_id=CASE WHEN $2='personal' THEN child_id ELSE NULL END,
             policy_tier=CASE WHEN $2='shared' THEN COALESCE(policy_tier,'standard') ELSE NULL END,
             caught_by_dinner=CASE WHEN $2=$4 THEN caught_by_dinner ELSE NULL END,
             caught_by_house_off=CASE WHEN $2=$4 THEN caught_by_house_off ELSE NULL END
             WHERE id=$1`,
      [d.id, cls, label, d.category || "personal"]);
    const ag = await syncAdguard();
    const said = cls === "iot" ? "Filed as a smart home device. It is never metered, never assigned to a child, and never cut by a family pause."
      : cls === "infra" ? "Filed as infrastructure. Nothing Genkan does will ever touch it."
        : cls === "appliance" ? "Filed as an unrestricted device. No owner, no time limit, and no control reaches it."
          : cls === "shared" ? "Filed as a shared family device on the Standard filter level. Nobody's minutes pay for it. It goes off at dinner and in a whole-house cut until you untick it."
            : "Back in the list of people's devices.";
    return { code: 200, ok: true, out: `${said} ${ag.out || ""}`.trim() };
  }

  // One tick box. The database decides whether the tick means anything: a
  // camera can carry caught_by_dinner=true all day and device_sweeps will
  // still say it is in no sweep. This refuses it anyway, so a parent is told
  // rather than left thinking they changed something.
  if (op === "device-sweep") {
    const mac = String(b.mac || "");
    const sweep = String(b.sweep || "");
    if (!MAC_RE.test(mac)) return bad("which device?");
    if (!SWEEP_VALUES.includes(sweep)) return bad("That is not one of the sweeps.");
    const on = b.on === null || b.on === undefined ? null : !!b.on;
    const [d] = await q("SELECT id,label,hostname,category FROM devices WHERE mac::text=$1", [mac.toLowerCase()]);
    if (!d) return bad("Genkan has not seen that device.");
    if (!SWEEPABLE.includes(d.category || "personal")) {
      const [, label] = CLASSES.find(c => c[0] === d.category) || [null, d.category];
      return bad(`${label} is never caught by any control, so there is nothing to tick. That is deliberate: a bedtime must not darken the front door lock.`);
    }
    const col = sweep === "dinner" ? "caught_by_dinner" : "caught_by_house_off";
    await q(`UPDATE devices SET ${col}=$2 WHERE id=$1`, [d.id, on]);
    const name = d.label || d.hostname || "That device";
    const what = sweep === "dinner" ? "the dinner pause" : "a whole-house cut";
    return { code: 200, ok: true,
      out: on === null ? `${name} is back to the default for its class.`
        : on ? `${name} will go off in ${what}.`
          : `${name} will stay online through ${what}.` };
  }

  // A shared device's filter level. A personal device gets its level from its
  // owner, so this only ever applies to the shared class.
  if (op === "device-tier") {
    const mac = String(b.mac || "");
    const tier = String(b.tier || "");
    if (!MAC_RE.test(mac)) return bad("which device?");
    if (!TIER_VALUES.includes(tier)) return bad("That is not one of the filter levels.");
    const [d] = await q("SELECT id,label,hostname,category FROM devices WHERE mac::text=$1", [mac.toLowerCase()]);
    if (!d) return bad("Genkan has not seen that device.");
    if ((d.category || "personal") !== "shared")
      return bad("Only a shared family device has a filter level of its own. A person's device takes their owner's.");
    await q("UPDATE devices SET policy_tier=$2 WHERE id=$1", [d.id, tier]);
    const ag = await syncAdguard();
    return { code: 200, ok: true,
      out: `${d.label || d.hostname || "That device"} is now on the ${tier} filter level. ${ag.out || ""}`.trim() };
  }

  // The whole-house cut. kidnet owns it, because the expiry, the audit trail
  // and the firewall push all live there and there must not be a second copy.
  if (op === "house") {
    const act = String(b.act || "");
    if (!["off", "on"].includes(act)) return bad("off or on?");
    const min = Math.min(1440, Math.max(1, Math.round(Number(b.minutes) || 60)));
    const r = await runKidnet(act === "off" ? ["house", "off", String(min)] : ["house", "on"]);
    if (!r.ok) return { code: 500, ok: false, out: r.out.trim() || "could not reach the gateway" };
    return { code: 200, ok: true, out: r.out.trim() };
  }

  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return bad("which person?");
  const [p] = await q("SELECT id,name,kind,active FROM children WHERE id=$1", [id]);
  if (!p) return { code: 404, ok: false, out: "no such person" };

  if (op === "guest-leave") {
    if (!isGuest(p.kind)) return bad(`${p.name} lives here. Only a guest goes home.`);
    // kidnet owns the order this has to happen in (unblock, then let the
    // devices go, then mark them gone), so it is not reimplemented here.
    // By id, not by name: kidnet works purely from the id here, so a person
    // whose name would not survive a command line can still be shown out.
    const r = await runKidnet(["guest", "leave", String(p.id)]);
    if (!r.ok) return { code: 500, ok: false, out: r.out.trim() || "could not show them out" };
    return { code: 200, ok: true, out: r.out.trim() };
  }
  if (op === "guest-back") {
    if (!isGuest(p.kind)) return bad(`${p.name} lives here.`);
    const r = await runKidnet(["guest", "back", String(p.id)]);
    if (!r.ok) return { code: 500, ok: false, out: r.out.trim() || "could not bring them back" };
    return { code: 200, ok: true, out: r.out.trim() };
  }
  if (op === "guest-remove") {
    if (!isGuest(p.kind)) return bad(`${p.name} lives here. Use the Remove button on their card.`);
    const [{ count } = { count: "0" }] = await q(
      "SELECT count(*)::text AS count FROM devices WHERE child_id=$1", [id]);
    await q("DELETE FROM children WHERE id=$1", [id]);
    const ag = await syncAdguard();
    return { code: 200, ok: true, out: `${p.name} removed. ${count} device(s) went back to the unnamed list. ${ag.out || ""}`.trim() };
  }
  return bad("bad request");
}
