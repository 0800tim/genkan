// Hearth dashboard: household roles, and the things a parent does with them.
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

  return `<div class="card"><h2>Who is in the house</h2>
    <p class="sub">${guests.length
      ? `${guests.length} guest${guests.length > 1 ? "s" : ""} here right now. `
      : ""}A control aimed at the kids reaches every child under this roof and every visiting child.
      It never reaches a visiting grown-up.</p>
    ${groups || '<div class="empty">Nobody yet.</div>'}${controls}${past}</div>`;
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
  if(!confirm('Delete '+name+' from Hearth for good? Their devices go back to the unnamed list.'))return;
  hhPost({op:'guest-remove',id:id},'removing\\u2026');
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
    if (!d) return bad("Hearth has not seen that device.");
    // Smart home and infrastructure belong to the household, never to a person,
    // so filing one here also takes it off whoever had it. That is the whole
    // point: it gets the smart lock out of the queue of things to hand a child.
    await q(`UPDATE devices SET category=$2, label=COALESCE(NULLIF($3,''), label),
             child_id=CASE WHEN $2='personal' THEN child_id ELSE NULL END WHERE id=$1`,
      [d.id, cls, label]);
    const ag = await syncAdguard();
    const said = cls === "iot" ? "Filed as a smart home device. It is never metered, never assigned to a child, and never cut by a family pause."
      : cls === "infra" ? "Filed as infrastructure. Nothing Hearth does will ever touch it."
        : "Back in the list of people's devices.";
    return { code: 200, ok: true, out: `${said} ${ag.out || ""}`.trim() };
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
