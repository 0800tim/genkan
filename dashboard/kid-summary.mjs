// Genkan: the nightly AI summary worker, the node half.
//
// bin/genkan-kid-summary (the bash half, which the systemd timer runs) gates
// on the household's switch and the key, then runs this. For every household
// child it builds YESTERDAY's brief with the same code the child page uses
// (dashboard/kid-insights.mjs: kidInsights then aiBrief), sends that one
// day's brief and nothing else, and stores the note. On a Monday it also
// writes last week's note from the seven daily notes, never from raw data.
//
// Idempotent per child per day: a complete row already there is left alone
// unless --force. A child whose day had nothing in it is skipped, so a quiet
// day costs nothing. --dry-run prints each brief and its size and sends
// nothing at all.
//
//   node dashboard/kid-summary.mjs [--date YYYY-MM-DD] [--weekly] [--force] [--dry-run]
//
// GENKAN_AI_STUB=1 stores a canned note without a request, for tests.
import pg from "pg";
import { kidInsights, aiBrief, hadActivity, writeDay, writeWeekFromDailies, mondayOf, estimateTokens, DEFAULT_MODEL } from "./kid-insights.mjs";

const args = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = flag("--dry-run"), FORCE = flag("--force"), WEEKLY = flag("--weekly");
const log = m => console.log(`genkan-kid-summary: ${m}`);

const url = process.env.KIDS_DB_URL;
if (!url) { console.error("genkan-kid-summary: KIDS_DB_URL is not set (secrets.env)"); process.exit(1); }
const pool = new pg.Pool({ connectionString: url });
const q = (t, p) => pool.query(t, p).then(r => r.rows);

try {
  const [settings] = await q("SELECT enabled, model FROM ai_summary_settings").catch(() => [null]);
  if (!settings) { log("the summaries table is not loaded (config/db/schema-summaries.sql); nothing to do"); process.exit(0); }
  if (!settings.enabled) { log("switched off on the dashboard; nothing sent, nothing written"); process.exit(0); }
  if (!process.env.GENKAN_AI_SUMMARY_KEY && process.env.GENKAN_AI_STUB !== "1" && !DRY) {
    log("on, but GENKAN_AI_SUMMARY_KEY is not set in secrets.env; nothing sent"); process.exit(0);
  }
  settings.model = settings.model || DEFAULT_MODEL;

  // Yesterday by the database clock, which is the household's clock.
  const wanted = opt("--date");
  if (wanted && !/^\d{4}-\d{2}-\d{2}$/.test(wanted)) { console.error("genkan-kid-summary: --date wants YYYY-MM-DD"); process.exit(1); }
  const [{ day, dow }] = await q(`SELECT COALESCE($1::date, CURRENT_DATE - 1)::text AS day,
                                        extract(dow from CURRENT_DATE)::int AS dow`, [wanted]);
  const children = await q("SELECT id, name, age, policy_tier FROM children WHERE kind='child' AND active ORDER BY age");
  let wrote = 0, skipped = 0, failed = 0;
  for (const child of children) {
    const tag = `child ${child.id}`;   // never the name: this line lands in the journal
    const [have] = await q("SELECT complete FROM kid_summaries WHERE child_id=$1 AND period='day' AND day=$2::date", [child.id, day]);
    if (have?.complete && !FORCE) { log(`${tag}: ${day} already written, skipping`); skipped++; continue; }
    const ins = await kidInsights(q, child, { asOf: day });
    if (!hadActivity(ins)) { log(`${tag}: nothing recorded on ${day}, skipping`); skipped++; continue; }
    const brief = aiBrief(ins, "day");
    const tokens = estimateTokens(JSON.stringify(brief));
    if (DRY) { log(`${tag}: ${day}, brief about ${tokens} tokens, would send:`); console.log(JSON.stringify(brief, null, 1)); continue; }
    const r = await writeDay(q, ins, { complete: true, by: "worker" });
    if (r.ok) { log(`${tag}: ${day} written (${tokens} tokens in the brief${r.tokensIn ? `, ${r.tokensIn} in and ${r.tokensOut} out reported` : ""})`); wrote++; }
    else { log(`${tag}: ${day} NOT written: ${r.out}`); failed++; }
  }

  // Mondays: last week, from its daily notes. --weekly forces it any day.
  if (WEEKLY || dow === 1) {
    // On a Monday morning `day` is Sunday, so this is last week's Monday.
    const weekStart = mondayOf(day);
    for (const child of children) {
      const tag = `child ${child.id}`;
      const [have] = await q("SELECT complete FROM kid_summaries WHERE child_id=$1 AND period='week' AND day=$2::date", [child.id, weekStart]);
      if (have?.complete && !FORCE) { log(`${tag}: week of ${weekStart} already written, skipping`); continue; }
      if (DRY) { log(`${tag}: would write the week of ${weekStart} from its daily notes`); continue; }
      const r = await writeWeekFromDailies(q, child, weekStart, settings);
      log(`${tag}: ${r.ok ? r.out : "week NOT written: " + r.out}`);
      if (r.ok) wrote++; else failed++;
    }
  }
  log(`done: ${wrote} written, ${skipped} skipped, ${failed} failed`);
  process.exit(failed ? 1 : 0);
} finally {
  await pool.end();
}
