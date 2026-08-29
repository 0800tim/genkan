#!/usr/bin/env node
// Validates a community learning package: a quiz bank plus a manifest.
//
//   node tools/validate-package.mjs                  every package in
//                                                    portal/quizzes/community/
//   node tools/validate-package.mjs a.json b.json    just these files
//   node tools/validate-package.mjs --strict a.json  also require the manifest
//
// Exits non-zero if any package fails.
//
// WHAT THIS IS FOR, and it is worth being blunt about it.
//
// A package comes from a stranger. Its text is rendered into a page that a
// CHILD reads, on a device inside the household's own network. A stored
// cross-site scripting hole in the kid portal, arriving through a quiz
// somebody sent in a pull request, would be the worst bug this project could
// ship. So every string in a package is treated as hostile here, and the
// portal escapes it again on the way out. Two independent defences, because
// one of them will eventually be wrong.
//
// This tool does NOT re-implement the quiz bank rules. It runs
// tools/validate-quizzes.mjs on the same file first, so there is exactly one
// place that knows what a bank is, and then adds the package rules:
//
//   * the manifest: author, licence, who it is for
//   * text safety: nothing that could be read as markup, a script, a URL
//     scheme, an invisible character or a right-to-left trick
//   * links: https only, and only to a domain already on the reading list,
//     because that is the only kind of link a child who has run out of time
//     can actually open
//   * sizes: on the file, the question count and every individual field
//
// It cannot check whether an answer is correct or whether an explanation
// teaches anything. That is what review is for, and
// docs/CONTRIBUTING-CONTENT.md says so to contributors in the same words.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const communityDir = join(repoRoot, "portal", "quizzes", "community");
const bankValidator = join(repoRoot, "tools", "validate-quizzes.mjs");

// ---------------------------------------------------------------------------
// Limits. All of them are deliberately mean. A package is a quiz, not a book.
// ---------------------------------------------------------------------------
const LIM = {
  file: 512 * 1024,        // bytes on disk
  questions: 300,
  prompt: 400,             // matches quiz_bank_questions.prompt
  choice: 240,           // the database does not cap a choice; the dashboard editor does, at 120
  explanation: 800,        // matches quiz_bank_questions.explanation
  title: 60,               // matches quiz_banks.title
  author: 80,
  contact: 120,
  description: 600,
  tags: 8,
  sources: 12,
  url: 300,
  readTitle: 80,
  readParas: 12,
  readPara: 800,
  readTotal: 6000,
  readLinks: 6,
  linkLabel: 80,
};

const LICENCES = ["CC0-1.0", "CC-BY-4.0", "CC-BY-SA-4.0", "MIT"];

// ---------------------------------------------------------------------------
// The reading list, read from the schema files rather than copied.
// ---------------------------------------------------------------------------
// A link in a package may only point at a domain a child can still reach when
// they have run out of time, because that is exactly when they are reading it.
// Anything else renders as a link that goes nowhere, at the worst moment.
// scope='learn' only: the safety scope is help lines and a couple of
// schoolwork logins, and neither belongs in a stranger's package.
function readingList() {
  const domains = new Set();
  for (const f of ["schema-learn.sql", "schema-learn-intl.sql"]) {
    const p = join(repoRoot, "config", "db", f);
    if (!existsSync(p)) continue;
    const sql = readFileSync(p, "utf8");
    for (const m of sql.matchAll(/\(\s*'([a-z0-9.-]+)'\s*,\s*'learn'/g)) domains.add(m[1]);
  }
  return domains;
}
const LEARN_DOMAINS = readingList();

// ---------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------
// The rule on the three dangerous characters, and it is ONE rule so that it
// can be explained to a person who is not a programmer:
//
//     < and > and & have to stand on their own, with a space either side.
//
// "7 < 8" is fine. "Salt & pepper" is fine. "<script>", "<img", "&amp;" and
// "&#60;" are not, and none of them is anything a quiz question needs. The
// portal escapes all three on the way out anyway; this is the second lock.
//
// One exception, earned by real content: the arrow "->" is how every chemistry
// and maths bank in this repo writes a reaction or an implication, and telling
// a science teacher to stop writing "2H2 + O2 -> 2H2O" would be the rule
// making the product worse. The arrow is taken out before the test, so its ">"
// never has to stand alone. It cannot close an HTML comment that the rule
// above will not let anybody open.
const DANGEROUS = /(?:^|[^ ])[<>&]|[<>&](?:[^ ]|$)/;
const dangerous = s => DANGEROUS.test(s.replace(/->/g, "  "));

// Invisible and direction-changing characters, by code point so that this
// source file stays plain ASCII and nothing can hide inside it either. A
// right-to-left override in a question is not a formatting choice, it is a
// trick, and a zero-width space inside a word is how somebody slips a word
// past a reader who is checking the package.
const SNEAKY = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD"
  + "\\u061C\\u180E\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E"
  + "\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB]");

// Substrings that have no business in a quiz, whatever else is around them.
const BANNED = [
  { re: /javascript\s*:/i, why: "a javascript: URL" },
  { re: /vbscript\s*:/i, why: "a vbscript: URL" },
  { re: /data\s*:[^ ]*[,;]/i, why: "a data: URL" },
  { re: /\bon(?:error|load|click|focus|mouseover|toggle|animationstart|begin)\s*=/i, why: "an HTML event handler" },
  { re: /<\s*\/?\s*(?:script|img|svg|iframe|style|link|meta|object|embed|form|input|body|math)\b/i, why: "an HTML tag" },
  { re: /&\s*(?:#x?[0-9a-f]+|[a-z]+)\s*;/i, why: "an HTML entity" },
  { re: /\\u[0-9a-fA-F]{4}/, why: "a literal backslash-u escape, which means the text was assembled rather than written" },
];

// A URL is only allowed in the fields declared to hold URLs, so anything that
// looks like one anywhere else is refused outright.
const LOOKS_LIKE_URL = /(?:[a-z][a-z0-9+.-]*:)?\/\//i;

function checkText(err, where, value, max, opts) {
  const allowUrl = opts && opts.allowUrl;
  if (typeof value !== "string") { err(`${where} must be a string`); return; }
  if (value.trim().length === 0) { err(`${where} is empty`); return; }
  if (value.length > max) { err(`${where} is ${value.length} characters, the limit is ${max}`); return; }
  if (value !== value.trim()) err(`${where} has a space at the start or the end`);
  if (/[\n\r\t]/.test(value)) err(`${where} contains a line break or a tab`);
  if (/  /.test(value)) err(`${where} contains a double space`);
  if (SNEAKY.test(value)) err(`${where} contains an invisible or direction-changing character`);
  if (dangerous(value)) {
    err(`${where} uses < > or & without a space either side. Write "7 < 8", "salt & pepper", or spell the word `
      + `out. The arrow "->" is allowed, because that is how a reaction is written`);
  }
  for (const b of BANNED) if (b.re.test(value)) err(`${where} looks like it contains ${b.why}`);
  if (!allowUrl && LOOKS_LIKE_URL.test(value)) {
    err(`${where} contains a URL. Links belong in "sources" or in read_first.links, and only to the reading list`);
  }
}

// A link a child can actually open. https, no credentials, no port, and the
// host must be a reading-list domain or one of its subdomains.
function checkUrl(err, where, value) {
  if (typeof value !== "string") { err(`${where} must be a string`); return; }
  if (value.length > LIM.url) { err(`${where} is longer than ${LIM.url} characters`); return; }
  if (SNEAKY.test(value)) { err(`${where} contains an invisible character`); return; }
  if (/[\s<>&"']/.test(value)) { err(`${where} contains a space or a character that has no place in a URL`); return; }
  let u;
  try { u = new URL(value); } catch { err(`${where} is not a URL`); return; }
  if (u.protocol !== "https:") { err(`${where} must start with https://`); return; }
  if (u.username || u.password) { err(`${where} carries a username or a password`); return; }
  if (u.port) { err(`${where} names a port, which the reading list does not allow`); return; }
  const host = u.hostname.toLowerCase();
  const ok = [...LEARN_DOMAINS].some(d => host === d || host.endsWith("." + d));
  if (!ok) {
    err(`${where} points at ${host}, which is not on the reading list. A child who has run out of time cannot `
      + `open it, and that is exactly when they would be reading this. docs/READING-LIST.md has the list, the `
      + `five tests a site has to pass, and how to propose one`);
  }
}

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------
function checkManifest(err, warn, m, strict) {
  if (m === undefined) {
    const msg = 'no "package" block: this is a plain quiz bank. A community package needs an author and a licence';
    if (strict) err(msg); else warn(msg + " (no --strict, so this is only a note)");
    return;
  }
  if (m === null || typeof m !== "object" || Array.isArray(m)) { err(`"package" must be an object`); return; }

  const known = new Set(["format", "author", "contact", "licence", "license", "description",
                         "tags", "homepage", "sources", "read_first", "updated"]);
  for (const k of Object.keys(m)) {
    if (!known.has(k)) warn(`package.${k} is not a field this version understands, and will be dropped on install`);
  }

  if (m.format !== undefined && m.format !== 1) err(`package.format must be 1 (this is format 1)`);
  checkText(err, "package.author", m.author, LIM.author);
  checkText(err, "package.description", m.description, LIM.description);
  if (m.contact !== undefined) checkText(err, "package.contact", m.contact, LIM.contact, { allowUrl: true });

  const lic = m.licence !== undefined ? m.licence : m.license;
  if (lic === undefined) err(`package.licence is missing. Pick one of: ${LICENCES.join(", ")}`);
  else if (!LICENCES.includes(lic)) err(`package.licence "${lic}" is not one of: ${LICENCES.join(", ")}`);
  if (m.licence !== undefined && m.license !== undefined) err(`use either "licence" or "license", not both`);

  if (m.updated !== undefined) {
    if (typeof m.updated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.updated) || Number.isNaN(Date.parse(m.updated)))
      err(`package.updated must be a date like 2026-08-30`);
  }
  if (m.homepage !== undefined) checkUrl(err, "package.homepage", m.homepage);

  if (m.tags !== undefined) {
    if (!Array.isArray(m.tags)) err(`package.tags must be an array of words`);
    else {
      if (m.tags.length > LIM.tags) err(`package.tags has ${m.tags.length} tags, the limit is ${LIM.tags}`);
      m.tags.forEach((t, i) => {
        if (typeof t !== "string" || !/^[a-z0-9][a-z0-9 -]{0,23}$/.test(t))
          err(`package.tags[${i}] must be lowercase: letters, digits, spaces and hyphens, up to 24 characters`);
      });
      if (new Set(m.tags).size !== m.tags.length) err(`package.tags repeats a tag`);
    }
  }

  if (m.sources !== undefined) {
    if (!Array.isArray(m.sources)) err(`package.sources must be an array of URLs`);
    else {
      if (m.sources.length > LIM.sources) err(`package.sources has ${m.sources.length} entries, the limit is ${LIM.sources}`);
      m.sources.forEach((s, i) => checkUrl(err, `package.sources[${i}]`, s));
    }
  } else warn(`no package.sources: say where you checked the facts, even if it is one link`);

  if (m.read_first !== undefined) checkReadFirst(err, warn, m.read_first);
}

// The optional short read. Text and reading-list links, nothing else. See the
// note in docs/CONTRIBUTING-CONTENT.md about pictures and video, which are
// genuinely not supported and are not being pretended into existence here.
function checkReadFirst(err, warn, r) {
  if (r === null || typeof r !== "object" || Array.isArray(r)) { err(`package.read_first must be an object`); return; }
  const known = new Set(["title", "body", "links"]);
  for (const k of Object.keys(r)) if (!known.has(k)) warn(`package.read_first.${k} is not a field this version understands`);

  checkText(err, "package.read_first.title", r.title, LIM.readTitle);

  if (!Array.isArray(r.body) || r.body.length === 0) { err(`package.read_first.body must be an array of paragraphs`); return; }
  if (r.body.length > LIM.readParas) err(`package.read_first.body has ${r.body.length} paragraphs, the limit is ${LIM.readParas}`);
  let total = 0;
  r.body.forEach((p, i) => {
    checkText(err, `package.read_first.body[${i}]`, p, LIM.readPara);
    if (typeof p === "string") total += p.length;
  });
  if (total > LIM.readTotal) {
    err(`package.read_first.body is ${total} characters in all, the limit is ${LIM.readTotal}. A child reads this on a phone`);
  }

  if (r.links !== undefined) {
    if (!Array.isArray(r.links)) { err(`package.read_first.links must be an array`); return; }
    if (r.links.length > LIM.readLinks) err(`package.read_first.links has ${r.links.length} entries, the limit is ${LIM.readLinks}`);
    r.links.forEach((l, i) => {
      if (l === null || typeof l !== "object" || Array.isArray(l)) { err(`package.read_first.links[${i}] must be {label, url}`); return; }
      for (const k of Object.keys(l)) {
        if (k !== "label" && k !== "url") err(`package.read_first.links[${i}].${k} is not a field this version understands`);
      }
      checkText(err, `package.read_first.links[${i}].label`, l.label, LIM.linkLabel);
      checkUrl(err, `package.read_first.links[${i}].url`, l.url);
    });
  }
}

// ---------------------------------------------------------------------------
// The bank half, checked field by field for safety. validate-quizzes.mjs has
// already checked the SHAPE of all of this; what is added here is hostility.
// ---------------------------------------------------------------------------
function checkBankText(err, bank) {
  checkText(err, "title", bank.title, LIM.title);

  // The emoji field is rendered straight into a card. One or two symbols, and
  // nothing that could be read as markup or as a word.
  const e = bank.emoji;
  if (typeof e !== "string" || [...e].length === 0 || [...e].length > 2 || /[<>&"'\\/\w]/.test(e) || SNEAKY.test(e))
    err(`emoji must be one or two symbols, no letters, digits or punctuation`);

  if (typeof bank.id === "string" && !/^[a-z0-9-]{1,48}$/.test(bank.id))
    err(`id must be lowercase letters, digits and hyphens, up to 48 characters`);

  const qs = Array.isArray(bank.questions) ? bank.questions : [];
  if (qs.length > LIM.questions) err(`${qs.length} questions, the limit is ${LIM.questions}`);

  qs.forEach((q, i) => {
    if (!q || typeof q !== "object") return;     // validate-quizzes.mjs said so already
    const at = typeof q.id === "string" ? q.id : `#${i}`;
    // The question id becomes half a primary key and goes into every child's
    // answer history, so it has to match what the database will accept.
    if (typeof q.id === "string" && !/^[A-Za-z0-9_-]{1,40}$/.test(q.id))
      err(`question ${at}: id must be letters, digits, underscores and hyphens, up to 40 characters`);
    checkText(err, `question ${at} prompt`, q.prompt, LIM.prompt);
    if (Array.isArray(q.choices)) q.choices.forEach((c, j) => checkText(err, `question ${at} choice ${j + 1}`, c, LIM.choice));
    if (q.explanation !== undefined) checkText(err, `question ${at} explanation`, q.explanation, LIM.explanation);
    for (const k of Object.keys(q)) {
      if (!["id", "prompt", "choices", "answer_index", "difficulty", "explanation"].includes(k))
        err(`question ${at}: unknown field "${k}"`);
    }
  });
}

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------
function checkFile(path, strict) {
  const file = basename(path);
  const errors = [];
  const warnings = [];
  const err = m => errors.push(m);
  const warn = m => warnings.push(m);

  let size = 0;
  try { size = statSync(path).size; } catch { err(`cannot be read`); return { file, errors, warnings }; }
  if (size > LIM.file) err(`the file is ${Math.round(size / 1024)} KB, the limit is ${LIM.file / 1024} KB`);

  let bank;
  try { bank = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { err(`does not parse as JSON: ${e.message}`); return { file, errors, warnings }; }
  if (!bank || typeof bank !== "object" || Array.isArray(bank)) {
    err(`the file must hold one JSON object`); return { file, errors, warnings };
  }

  // The bank rules, from the one place that knows them.
  const r = spawnSync(process.execPath, [bankValidator, path], { encoding: "utf8" });
  if (r.error) err(`could not run the bank validator: ${r.error.message}`);
  else if (r.status !== 0) {
    err(`it is not a valid quiz bank yet. tools/validate-quizzes.mjs says:`);
    for (const line of String(r.stdout || "").split("\n")) {
      const t = line.trim();
      if (t.startsWith("- ")) err(`  ${t.slice(2)}`);
    }
  }

  const known = new Set(["id", "title", "emoji", "suggested_age_min", "minutes_per_pass",
                         "pass_mark", "questions_per_round", "questions", "package", "source_note"]);
  for (const k of Object.keys(bank)) if (!known.has(k)) err(`unknown top level field "${k}"`);

  checkBankText(err, bank);
  checkManifest(err, warn, bank.package, strict);

  return { file, errors, warnings, bank };
}

// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const args = argv.filter(a => !a.startsWith("-"));
const paths = args.length
  ? args
  : (existsSync(communityDir)
      ? readdirSync(communityDir).filter(f => f.endsWith(".json")).sort().map(f => join(communityDir, f))
      : []);

if (paths.length === 0) {
  console.error(args.length ? "No packages named." : `No packages found in ${communityDir}`);
  process.exit(1);
}
if (LEARN_DOMAINS.size === 0) {
  console.error("Could not read the reading list from config/db/schema-learn*.sql, so links cannot be checked. Run this from a Hearth checkout.");
  process.exit(1);
}

let anyFailed = false;
for (const p of paths) {
  const { file, errors, warnings, bank } = checkFile(p, strict);
  if (errors.length === 0) {
    const m = bank.package;
    const who = m ? `${m.author}, ${m.licence !== undefined ? m.licence : m.license}` : "no manifest";
    const read = m && m.read_first ? `, read-first (${m.read_first.body.length} paragraphs)` : "";
    console.log(`PASS  ${file} (${bank.questions.length} questions, ${who}${read})`);
  } else {
    anyFailed = true;
    console.log(`FAIL  ${file}`);
    for (const e of errors) console.log(`      - ${e}`);
  }
  for (const w of warnings) console.log(`      ! ${w}`);
}
console.log(anyFailed
  ? "\nSome packages failed. None of it is a judgement on the content: docs/CONTRIBUTING-CONTENT.md explains every rule."
  : `\n${paths.length === 1 ? "That package passed" : `All ${paths.length} packages passed`}. A human still has to check every answer.`);
process.exit(anyFailed ? 1 : 0);
