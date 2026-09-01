#!/usr/bin/env node
// Validates quiz banks against FORMAT.md.
//
//   node tools/validate-quizzes.mjs                 every bank in portal/quizzes/
//   node tools/validate-quizzes.mjs a.json b.json   just these files, wherever
//                                                   they are (used by
//                                                   bin/genkan-quiz validate,
//                                                   so a generated bank can be
//                                                   checked before it is
//                                                   installed)
//
// Exits non-zero if any bank fails.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const quizzesDir = join(repoRoot, "portal", "quizzes");

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const paths = args.length
  ? args
  : readdirSync(quizzesDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(quizzesDir, f));

if (paths.length === 0) {
  console.error(`No quiz banks found in ${quizzesDir}`);
  process.exit(1);
}

let anyFailed = false;
const seenBankIds = new Map();

// The subjects a bank can be filed under: the eight learning areas of the New
// Zealand Curriculum, plus two shelves that are not learning areas at all.
// The same list lives in dashboard/portal-learn.mjs (SUBJECTS), which is what
// the portal groups by; change both or the Learning home drops the bank.
const SUBJECTS = new Set([
  "english", "maths", "science", "social-sciences", "technology", "arts",
  "health-pe", "languages",
  "general",          // general knowledge, chess, the road code: not a learning area
  "other-countries",  // another country's curriculum, filed by rough age
]);

for (const path of paths) {
  const file = basename(path);
  const errors = [];
  const warnings = [];
  let bank = null;
  let bankLevels = null;            // difficulty spread, when the bank has one

  try {
    bank = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    errors.push(`does not parse as JSON: ${e.message}`);
  }

  if (bank) {
    // Bank metadata
    for (const field of ["id", "title", "emoji"]) {
      if (typeof bank[field] !== "string" || bank[field].length === 0) {
        errors.push(`missing or empty string field "${field}"`);
      }
    }
    for (const field of [
      "suggested_age_min",
      "minutes_per_pass",
      "pass_mark",
      "questions_per_round",
    ]) {
      if (!Number.isInteger(bank[field]) || bank[field] <= 0) {
        errors.push(`field "${field}" must be a positive integer`);
      }
    }

    // Where the bank sits in the New Zealand curriculum: a subject and a
    // year band (Year 1 to Year 13). The portal's Learning home groups banks
    // by these. Missing is a warning rather than a failure, because a bank
    // written on the dashboard or by an older generator has none and still
    // plays; the Learning home files it under "any year". Present but wrong
    // is a failure, because a bank filed under Year 40 helps nobody.
    if (!("year_from" in bank) && !("year_to" in bank) && !("subject" in bank)) {
      warnings.push(`no subject / year_from / year_to: the Learning home lists it under "any year"`);
    } else {
      if (!SUBJECTS.has(bank.subject)) {
        errors.push(`subject "${bank.subject}" is not one of: ${[...SUBJECTS].join(", ")}`);
      }
      for (const field of ["year_from", "year_to"]) {
        if (!Number.isInteger(bank[field]) || bank[field] < 1 || bank[field] > 13) {
          errors.push(`field "${field}" must be an integer from 1 to 13 (NZ school years)`);
        }
      }
      if (Number.isInteger(bank.year_from) && Number.isInteger(bank.year_to) && bank.year_from > bank.year_to) {
        errors.push(`year_from (${bank.year_from}) is after year_to (${bank.year_to})`);
      }
      if (typeof bank.year_note !== "string" || bank.year_note.trim().length === 0) {
        errors.push(`"year_note" must say how the year band was chosen (a sentence is enough)`);
      }
    }

    if (typeof bank.id === "string" && bank.id !== basename(file, ".json")) {
      errors.push(`bank id "${bank.id}" does not match filename "${file}"`);
    }
    if (typeof bank.id === "string") {
      if (seenBankIds.has(bank.id)) {
        errors.push(
          `bank id "${bank.id}" already used by ${seenBankIds.get(bank.id)}`
        );
      } else {
        seenBankIds.set(bank.id, file);
      }
    }

    if (
      Number.isInteger(bank.pass_mark) &&
      Number.isInteger(bank.questions_per_round) &&
      bank.pass_mark > bank.questions_per_round
    ) {
      errors.push(
        `pass_mark (${bank.pass_mark}) exceeds questions_per_round (${bank.questions_per_round})`
      );
    }

    // Questions
    if (!Array.isArray(bank.questions)) {
      errors.push(`"questions" must be an array`);
    } else {
      const ids = new Set();
      const prompts = new Set();
      const levels = [0, 0, 0, 0, 0];   // how many questions at difficulty 1..5
      let labelled = 0;

      bank.questions.forEach((q, i) => {
        const label = q && typeof q.id === "string" ? q.id : `#${i}`;

        if (!q || typeof q !== "object") {
          errors.push(`question ${label} is not an object`);
          return;
        }
        if (typeof q.id !== "string" || q.id.length === 0) {
          errors.push(`question ${label} has a missing or empty id`);
        } else if (ids.has(q.id)) {
          errors.push(`duplicate question id "${q.id}"`);
        } else {
          ids.add(q.id);
        }

        if (typeof q.prompt !== "string" || q.prompt.trim().length === 0) {
          errors.push(`question ${label} has a missing or empty prompt`);
        } else {
          const norm = q.prompt.trim().toLowerCase();
          if (prompts.has(norm)) {
            errors.push(`duplicate prompt in question ${label}`);
          } else {
            prompts.add(norm);
          }
        }

        if (
          !Array.isArray(q.choices) ||
          q.choices.length !== 4 ||
          q.choices.some((c) => typeof c !== "string" || c.length === 0)
        ) {
          errors.push(
            `question ${label} must have exactly 4 non-empty string choices`
          );
        } else if (new Set(q.choices.map((c) => c.trim())).size !== 4) {
          // Trimmed but NOT lowercased. Lowercasing here made every question
          // about capital letters a false positive by construction: "We went
          // to New Zealand" and "we went to New Zealand" are the whole point
          // of the question and collapse to one string if you fold the case.
          // An accidental duplicate is nearly always an exact copy-paste, so
          // an exact comparison still catches the thing this is here to catch.
          errors.push(`question ${label} has duplicate choices`);
        }

        if (
          !Number.isInteger(q.answer_index) ||
          q.answer_index < 0 ||
          q.answer_index > 3
        ) {
          errors.push(
            `question ${label} answer_index must be an integer from 0 to 3`
          );
        }

        if ("explanation" in q && typeof q.explanation !== "string") {
          errors.push(`question ${label} explanation must be a string`);
        }

        // difficulty is optional, but when it is there it must be sane: 1
        // (warm-up) to 5 (stretch). The portal builds the round's ramp from it.
        if ("difficulty" in q) {
          if (
            !Number.isInteger(q.difficulty) ||
            q.difficulty < 1 ||
            q.difficulty > 5
          ) {
            errors.push(
              `question ${label} difficulty must be an integer from 1 to 5`
            );
          } else {
            levels[q.difficulty - 1]++;
            labelled++;
          }
        }
      });

      // Difficulty is all or nothing per bank. A half-labelled bank builds a
      // lopsided ramp and is the sort of thing nobody notices for months, so
      // it fails here rather than quietly shipping. (The portal is more
      // forgiving at runtime: it falls back to flat random sampling.)
      if (labelled > 0 && labelled < bank.questions.length) {
        errors.push(
          `${labelled} of ${bank.questions.length} questions carry "difficulty": label all of them or none`
        );
      }

      // A ramped bank has to be able to fill an easy round. A kid having a bad
      // day is given a round built mostly from levels 1 and 2, so there must be
      // enough of those to draw one without repeating.
      if (labelled > 0) bankLevels = levels;
      if (labelled > 0 && Number.isInteger(bank.questions_per_round)) {
        const easy = levels[0] + levels[1];
        if (easy < bank.questions_per_round) {
          errors.push(
            `only ${easy} questions at difficulty 1-2, need at least questions_per_round (${bank.questions_per_round}) so a struggling kid still gets a full, passable round`
          );
        }
        levels.forEach((n, i) => {
          if (n === 0) warnings.push(`no questions at difficulty ${i + 1}`);
        });
      }

      // Bank must be big enough that rounds do not repeat
      if (Number.isInteger(bank.questions_per_round)) {
        const min = bank.questions_per_round * 4;
        if (bank.questions.length < min) {
          errors.push(
            `bank has ${bank.questions.length} questions but needs at least 4x questions_per_round (${min})`
          );
        }
      }
    }
  }

  if (errors.length === 0) {
    const ramp = bankLevels
      ? `, ramped ${bankLevels.join("/")}`
      : ", no difficulty data";
    const where = Number.isInteger(bank.year_from)
      ? `, ${bank.subject} Y${bank.year_from}${bank.year_to !== bank.year_from ? `-${bank.year_to}` : ""}`
      : "";
    console.log(`PASS  ${file} (${bank.questions.length} questions${ramp}${where})`);
  } else {
    anyFailed = true;
    console.log(`FAIL  ${file}`);
    for (const err of errors) console.log(`      - ${err}`);
  }
  for (const w of warnings) console.log(`      ! ${w}`);
}

console.log(
  anyFailed
    ? "\nSome banks failed validation."
    : `\nAll ${paths.length} banks passed.`
);
process.exit(anyFailed ? 1 : 0);
