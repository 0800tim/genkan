#!/usr/bin/env node
// Validates every quiz bank in portal/quizzes/*.json against FORMAT.md.
// Usage: node tools/validate-quizzes.mjs
// Exits non-zero if any bank fails.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const quizzesDir = join(repoRoot, "portal", "quizzes");

const files = readdirSync(quizzesDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.error(`No quiz banks found in ${quizzesDir}`);
  process.exit(1);
}

let anyFailed = false;
const seenBankIds = new Map();

for (const file of files) {
  const path = join(quizzesDir, file);
  const errors = [];
  let bank = null;

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
        } else if (new Set(q.choices.map((c) => c.trim().toLowerCase())).size !== 4) {
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
      });

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
    console.log(`PASS  ${file} (${bank.questions.length} questions)`);
  } else {
    anyFailed = true;
    console.log(`FAIL  ${file}`);
    for (const err of errors) console.log(`      - ${err}`);
  }
}

console.log(
  anyFailed
    ? "\nSome banks failed validation."
    : `\nAll ${files.length} banks passed.`
);
process.exit(anyFailed ? 1 : 0);
