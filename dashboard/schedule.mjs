// Hearth dashboard: scheduled bedtimes.
//
// The times a child's internet goes off and comes back, per child, with
// different school-night and weekend times, a holiday window that suspends the
// lot, and tonight's extension. Everything here writes rows and nothing here
// decides anything: bin/kidnet-schedule reads those rows every minute and is
// the only thing that touches a block. That split is deliberate, because the
// set_by precedence rules (DECISIONS.md) have to live in exactly one place.
//
// The page's other job is to SAY the times. A child who can see "off at nine,
// back at seven" is being treated fairly. One who just gets cut off is being
// punished by a machine, and the same line appears on the kid portal for that
// reason.
import { esc } from "./charts.mjs";

// 0=Sunday. The days are the night the window STARTS on, which is why Friday
// night sits with Saturday night and not with the school week.
const SCHOOL = [0, 1, 2, 3, 4];
const WEEKEND = [5, 6];
const sameDays = (a, b) => Array.isArray(a) && a.length === b.length
  && [...a].sort().join() === [...b].sort().join();

// What a bedtime is allowed to switch off. Everything, or the noisy things
// while messaging and music keep working. Nothing wider is offered here: a
// bedtime that could switch off one arbitrary category is a rule nobody can
// hold in their head at eleven at night.
const CAT_CHOICES = [
  ["internet", "Everything", "The whole internet, except the help lines and the reading list, which always stay reachable."],
  ["gaming,video,social", "Games, video and social", "Messaging and music keep working, so a late text still gets through."],
];
const catKey = cats => (Array.isArray(cats) ? cats.slice().sort().join(",") : "");
const catValue = cats => catKey(cats) === "gaming,social,video" ? "gaming,video,social" : "internet";

const hhmm = min => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = s => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm > 0)) return null;
  return h * 60 + mm;
};
const localTime = ts => ts
  ? new Date(ts).toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" })
  : "";

// The one line the rest of the dashboard shows. Exported because Home, the kid
// page and the portal all have to say the same thing in the same words.
export function bedtimeLine(n) {
  if (!n) return "";
  return n.in_window
    ? `Bedtime now, back at ${localTime(n.ends_at)}`
    : `Off at ${localTime(n.starts_at)}, back at ${localTime(n.ends_at)}`;
}

// ---------------------------------------------------------------------------
// The data the page needs. Every query is guarded: a box whose database has not
// been given schema-schedule.sql yet must still render the rest of the family
// page rather than throwing a 500 at a parent who came to rename a laptop.
// ---------------------------------------------------------------------------
export async function scheduleData(q) {
  const safe = (sql, dflt = []) => q(sql).catch(() => dflt);
  const [rows, next, overrides, extensions] = await Promise.all([
    safe(`SELECT id, child_id, name, days, start_min, end_min, action, enabled, categories
            FROM schedules ORDER BY child_id, start_min`),
    safe(`SELECT child_id, child, starts_at, ends_at, in_window, override, extended
            FROM schedule_next`),
    // The dates come back as text on purpose: a `date` column arrives as a JS
    // Date, and printing one gives "Sat Sep 19 2026 00:00:00 GMT+1200", which
    // is not a date anybody wants to read on a page about bedtimes.
    safe(`SELECT id, child_id, name, starts::text AS starts, ends::text AS ends, mode, shift_min
            FROM schedule_overrides WHERE enabled AND ends >= CURRENT_DATE ORDER BY starts`),
    safe(`SELECT child_id, max(until_ts) AS until_ts FROM schedule_extensions
           WHERE until_ts > now() GROUP BY child_id`),
  ]);
  const byChild = {};
  for (const r of rows) (byChild[r.child_id] ||= []).push(r);
  const nextBy = {}; for (const n of next) nextBy[n.child_id] = n;
  const extBy = {}; for (const e of extensions) extBy[e.child_id] = e.until_ts;
  // A database with no schedule tables at all is a real state (an older box
  // that has not reloaded the schema), and the page has to say so rather than
  // showing an empty form that silently saves nothing.
  const ready = rows.length > 0 || next.length > 0 || overrides.length > 0
    || (await q("SELECT to_regclass('public.schedules') IS NOT NULL AS ok")
          .then(r => !!r[0]?.ok).catch(() => false));
  return { byChild, next: nextBy, overrides, ext: extBy, ready };
}

// ---------------------------------------------------------------------------
// The API. Same guard and same shape as every other control on this dashboard.
// ---------------------------------------------------------------------------
export async function scheduleApi(q, body, res, runKidnet) {
  const send = (code, out, ok = false) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok, out }));
  };
  const b = body || {};
  const op = String(b.op || "");
  // Nudge the worker so a change a parent just made is in force now rather
  // than up to a minute from now. It is the same code the timer runs, and it
  // is the ONLY thing in this file that can change a block.
  const nudge = async () => { try { await runKidnet(["schedule", "apply"]); } catch { /* the timer will */ } };

  if (op === "save") {
    const cid = Number(b.child_id);
    if (!Number.isInteger(cid) || cid <= 0) return send(400, "which child?");
    const [child] = await q("SELECT id, name FROM children WHERE id=$1", [cid]);
    if (!child) return send(404, "no such child");
    const cats = String(b.cats || "internet");
    if (!CAT_CHOICES.some(c => c[0] === cats)) return send(400, "That is not one of the choices.");
    const catArr = cats.split(",");
    const out = [];
    for (const [key, days, label] of [["school", SCHOOL, "school-night bedtime"],
                                      ["weekend", WEEKEND, "weekend bedtime"]]) {
      const part = b[key] || {};
      const on = !!part.enabled;
      // No times, or the switch off, means there is no such bedtime. Deleting
      // rather than disabling is deliberate: the worker lifts anything it was
      // holding on its next run, so an emptied form cannot strand a child.
      if (!on || !part.start || !part.end) {
        const gone = await q("DELETE FROM schedules WHERE child_id=$1 AND days=$2::int[] RETURNING id", [cid, days]);
        if (gone.length) out.push(`${label} removed.`);
        continue;
      }
      const s = toMin(part.start), e = toMin(part.end);
      if (s === null || e === null) return send(400, `Those ${key} times do not look like a time.`);
      if (s === e) return send(400, `A bedtime that starts and ends at the same minute would never lift.`);
      await q("DELETE FROM schedules WHERE child_id=$1 AND days=$2::int[]", [cid, days]);
      await q(`INSERT INTO schedules(child_id,name,days,start_min,end_min,action,enabled,categories,set_by,updated_ts)
               VALUES($1,$2,$3::int[],$4,$5,'block',true,$6::text[],'dashboard',now())`,
        [cid, label, days, s, e, catArr]);
      out.push(`${label} ${hhmm(s)} to ${hhmm(e)}.`);
    }
    await nudge();
    return send(200, out.length
      ? `${out.join(" ")} It applies from now, and lifts itself in the morning.`
      : `${child.name} has no bedtime set.`, true);
  }

  if (op === "extend") {
    const cid = Number(b.child_id), min = Number(b.minutes);
    if (!Number.isInteger(cid) || cid <= 0) return send(400, "which child?");
    if (!Number.isFinite(min) || min < 1 || min > 720) return send(400, "Between 1 and 720 minutes.");
    // Measured from the later of now and tonight's bedtime, so twenty minutes
    // granted at half past eight is twenty minutes past nine, not past eight.
    // Refused rather than clamped if it would run past the morning: that is a
    // parent asking to cancel the night, which is a different decision.
    const rows = await q(`
      WITH n AS (SELECT starts_at, ends_at FROM schedule_next WHERE child_id=$1)
      INSERT INTO schedule_extensions(child_id, until_ts, minutes, reason, granted_by)
      SELECT $1, GREATEST(now(), n.starts_at) + make_interval(mins => $2), $2, 'tonight', 'dashboard'
        FROM n WHERE GREATEST(now(), n.starts_at) + make_interval(mins => $2) < n.ends_at
      RETURNING until_ts`, [cid, Math.round(min)]);
    if (!rows.length) return send(400, "There is no bedtime tonight that long an extension would fit inside.");
    await nudge();
    return send(200, `Tonight only: back on until ${localTime(rows[0].until_ts)}. Tomorrow is unchanged.`, true);
  }

  if (op === "holiday") {
    const starts = String(b.starts || ""), ends = String(b.ends || "");
    const mode = b.mode === "late" ? "late" : "off";
    const shift = mode === "late" ? Number(b.shift_min) : 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends))
      return send(400, "Pick both dates.");
    if (ends < starts) return send(400, "The last day is before the first one.");
    if (mode === "late" && (!Number.isFinite(shift) || shift < 1 || shift > 600))
      return send(400, "How much later, between 1 and 600 minutes?");
    const name = String(b.name || "").slice(0, 40) || (mode === "late" ? "later nights" : "school holidays");
    if (!/^[A-Za-z0-9_ ,.'-]{0,40}$/.test(name)) return send(400, "Give it a plainer name.");
    await q(`INSERT INTO schedule_overrides(child_id,name,starts,ends,mode,shift_min,set_by)
             VALUES($1,$2,$3::date,$4::date,$5,$6,'dashboard')`,
      [b.child_id ? Number(b.child_id) : null, name, starts, ends, mode, Math.round(shift) || 0]);
    await nudge();
    return send(200, mode === "off"
      ? `No bedtimes from ${starts} to ${ends}. Nothing was edited, so they all come back on their own afterwards.`
      : `Bedtimes start ${Math.round(shift)} minutes later from ${starts} to ${ends}. Mornings are unchanged.`, true);
  }

  if (op === "holiday-clear") {
    const id = Number(b.id);
    if (Number.isInteger(id) && id > 0) await q("UPDATE schedule_overrides SET enabled=false WHERE id=$1", [id]);
    else await q("UPDATE schedule_overrides SET enabled=false WHERE enabled");
    await nudge();
    return send(200, "Back to the usual bedtimes.", true);
  }

  return send(400, "bad request");
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export const SCHEDULE_CSS = `
.bt{display:grid;gap:10px 12px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin:8px 0 0;align-items:end}
.bt label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;
  color:var(--ink-muted);margin-bottom:3px;font-weight:600}
.bt input,.bt select{width:100%}
.bt .chk{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--ink-2);
  text-transform:none;letter-spacing:0;font-weight:500}
.bt .chk input{width:auto}
.btrow{border-top:1px solid var(--line);padding:11px 0 3px}
.btrow:first-of-type{border-top:0}
.btnow{font-size:12.5px;color:var(--ink-2);background:var(--surface-2);border:1px solid var(--line);
  border-radius:10px;padding:8px 11px;margin:9px 0 0}
.btnow b{color:var(--ink)}
.btline{font-size:12px;color:var(--ink-muted);margin:3px 0 0}
`;

export const SCHEDULE_JS = `
function btVal(id){var el=document.getElementById(id);return el?el.value.trim():'';}
function btOn(id){var el=document.getElementById(id);return !!(el&&el.checked);}
function saveBedtime(id){
  mgPost('/api/schedule',{op:'save',child_id:id,cats:btVal('bc_'+id),
    school:{enabled:btOn('bse_'+id),start:btVal('bss_'+id),end:btVal('bsn_'+id)},
    weekend:{enabled:btOn('bwe_'+id),start:btVal('bws_'+id),end:btVal('bwn_'+id)}},
    'saving the bedtime\\u2026');
}
function extendBedtime(id){
  var m=parseInt(btVal('bx_'+id)||'0',10);
  if(!(m>0)){say('How many extra minutes?');return;}
  mgPost('/api/schedule',{op:'extend',child_id:id,minutes:m},'granting tonight\\u2026');
}
function saveHoliday(){
  var mode=btVal('hol_mode');
  mgPost('/api/schedule',{op:'holiday',starts:btVal('hol_from'),ends:btVal('hol_to'),
    name:btVal('hol_name'),mode:mode,shift_min:parseInt(btVal('hol_shift')||'0',10)},
    'saving the dates\\u2026');
}
function clearHoliday(id){mgPost('/api/schedule',{op:'holiday-clear',id:id},'ending it\\u2026');}
`;

const timeBox = (id, label, val) =>
  `<label for="${esc(id)}">${esc(label)}</label>`
  + `<input id="${esc(id)}" type="time" value="${esc(val || "")}">`;

function kidBedtime(c, rows, next, extUntil) {
  const school = rows.find(r => sameDays(r.days, SCHOOL));
  const weekend = rows.find(r => sameDays(r.days, WEEKEND));
  const cats = catValue((school || weekend || {}).categories);
  const now = next
    ? `<div class="btnow">Tonight: <b>${esc(bedtimeLine(next))}</b>${
        next.override ? ` &middot; ${esc(next.override)}` : ""}${
        next.extended ? " &middot; extended tonight" : ""}</div>`
    : `<div class="btnow">No bedtime set, so nothing switches off on its own.</div>`;
  return `<div class="mgcard">
    <div class="mh"><h3>${esc(c.name)}</h3>
      ${extUntil ? `<span class="pill">extra time until ${esc(localTime(extUntil))}</span>` : ""}</div>
    ${now}
    <div class="btrow"><div class="bt">
      <div><span class="chk"><input type="checkbox" id="bse_${c.id}"${school ? " checked" : ""}>
        <label for="bse_${c.id}" style="margin:0;text-transform:none;letter-spacing:0;font-size:13px">School nights</label></span>
        <p class="btline">Sunday to Thursday</p></div>
      <div>${timeBox(`bss_${c.id}`, "Off at", school ? hhmm(school.start_min) : "")}</div>
      <div>${timeBox(`bsn_${c.id}`, "Back at", school ? hhmm(school.end_min) : "")}</div>
    </div></div>
    <div class="btrow"><div class="bt">
      <div><span class="chk"><input type="checkbox" id="bwe_${c.id}"${weekend ? " checked" : ""}>
        <label for="bwe_${c.id}" style="margin:0;text-transform:none;letter-spacing:0;font-size:13px">Weekends</label></span>
        <p class="btline">Friday and Saturday</p></div>
      <div>${timeBox(`bws_${c.id}`, "Off at", weekend ? hhmm(weekend.start_min) : "")}</div>
      <div>${timeBox(`bwn_${c.id}`, "Back at", weekend ? hhmm(weekend.end_min) : "")}</div>
    </div></div>
    <div class="bt">
      <div class="wide"><label for="bc_${c.id}">What switches off</label>
        <select id="bc_${c.id}">${CAT_CHOICES.map(([v, l]) =>
          `<option value="${esc(v)}"${v === cats ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <p class="btline">${esc(CAT_CHOICES.find(x => x[0] === cats)?.[2] || "")}</p></div>
    </div>
    <div class="mgacts">
      <button class="btn primary" type="button" onclick="saveBedtime(${c.id})">Save ${esc(c.name)}'s bedtime</button>
      <span class="grow"></span>
      <input id="bx_${c.id}" type="number" min="1" max="720" placeholder="min" style="width:5.5em" aria-label="Extra minutes for ${esc(c.name)} tonight">
      <button class="btn" type="button" onclick="extendBedtime(${c.id})">Extra time, tonight only</button>
    </div>
  </div>`;
}

export function schedulePanel(s, sched) {
  if (!sched?.ready) return `<div class="card"><h2>Bedtimes</h2>
    <div class="empty">This box's database does not have the bedtime tables yet.
      Load <code>config/db/schema-schedule.sql</code> (or re-run <code>config/db/load.sh</code>) and this fills in.</div></div>`;
  const kids = (s.children || []).filter(c => c.active !== false && (c.is_kid || c.kind === "child" || c.kind === "guest-child"));
  const cards = kids.map(c => kidBedtime(c, sched.byChild[c.id] || [], sched.next[c.id], sched.ext[c.id])).join("");
  const holidays = (sched.overrides || []).map(o => `<div class="row">
      <span><b>${esc(o.name)}</b> ${esc(o.starts)} to ${esc(o.ends)}
        ${o.mode === "late" ? `&middot; ${o.shift_min} min later` : "&middot; no bedtimes"}
        ${o.child_id ? "" : "&middot; everybody"}</span>
      <span><button class="btn" type="button" onclick="clearHoliday(${o.id})">End it</button></span></div>`).join("");
  return `<div class="card"><h2>Bedtimes</h2>
    <p class="sub">The internet goes off and comes back on its own. A school night and a Friday night are
      set separately, and each child has their own times. The morning is the half that matters: nothing
      has to be remembered for a child to wake up online.</p>
    <p class="sub">A bedtime never overrules you. If you turn somebody back on during theirs, it stays on
      until the next night. A block you applied by hand is never lifted by the morning, and earning time
      does not buy a way past a bedtime.</p>
    ${cards || '<div class="empty">No children yet.</div>'}</div>
  <div class="card"><h2>Holidays and late nights</h2>
    <p class="sub">School holidays should not mean editing every bedtime and then editing them all back.
      Give the dates instead. Everything returns to normal on its own afterwards.</p>
    ${holidays ? holidays + `<p class="mghint">These are in force now.</p>` : ""}
    <div class="bt">
      <div><label for="hol_from">First day</label><input id="hol_from" type="date"></div>
      <div><label for="hol_to">Last day</label><input id="hol_to" type="date"></div>
      <div><label for="hol_mode">What happens</label><select id="hol_mode">
        <option value="off">No bedtimes at all</option>
        <option value="late">Bedtimes start later</option></select></div>
      <div><label for="hol_shift">How much later, in minutes</label>
        <input id="hol_shift" type="number" min="1" max="600" placeholder="e.g. 60"></div>
      <div class="wide"><label for="hol_name">What to call it</label>
        <input id="hol_name" maxlength="40" placeholder="e.g. term 3 break"></div>
    </div>
    <div class="mgacts"><button class="btn primary" type="button" onclick="saveHoliday()">Save the dates</button></div>
    <p class="mghint">"Bedtimes start later" moves the evening only. The morning stays where it is, because
      a child locked out later than you meant is the failure worth avoiding.</p>
  </div>`;
}
