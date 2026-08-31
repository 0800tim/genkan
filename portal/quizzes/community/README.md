# The community shelf

This directory holds **learning packages other people wrote**.

A package is one JSON file: a quiz bank, plus who wrote it, what licence it
carries, who it is for, and optionally a short piece to read first. It is the
quiz bank format Genkan already used (`../FORMAT.md`) with one optional
`package` block added, so nothing here is a new format to learn: a bank you have
already written becomes a package when you add four lines saying who wrote it.

`docs/CONTRIBUTING-CONTENT.md` is the full guide, written for somebody who is
not a programmer. Read that if you want to write one. This file is about what
this directory is and how it differs from the one above it.

## Nothing in here is live

That is the important part.

| | `portal/quizzes/*.json` | `portal/quizzes/community/*.json` |
|---|---|---|
| Loaded by the portal | yes, automatically | **no** |
| Where it lives once in use | it is already in use | the household's database |
| Survives a `git pull` | it is part of the repo | yes, it is in the database |
| How it gets to the kids | it ships with Genkan | somebody runs `genkan-pack install` |

The portal reads `*.json` at the top of `portal/quizzes` and nowhere else, so a
package sitting here is invisible to every child in the house. It is an offer,
not content.

A parent installs one deliberately:

    bin/genkan-pack list                                        what is here, and what is installed
    bin/genkan-pack validate portal/quizzes/community/<id>.json  check it first
    bin/genkan-pack install portal/quizzes/community/<id>.json   say yes to it

An installed package goes into the **database**, alongside the banks a parent
writes on the dashboard, and for the same reason: this directory is tracked in
git, and a repository update that overwrote or deleted a family's content would
be a bad day. `bin/genkan-pack remove <id>` takes it out again and leaves
nothing behind, except the minutes the children earned, which stay earned.

**Installing is a terminal command on purpose.** It is a stranger's writing
going in front of a child. That should take a deliberate act by somebody who
has read it, not a button on a web page. The dashboard's Learn to earn screen
lists what is installed and what is sitting here waiting, and tells you the
command. It does not install anything itself.

## What belongs here

Anything somebody genuinely knows how to do and can teach in forty questions.

The banks in the directory above grew around school subjects because that is
what one household needed. This shelf exists because that is the narrow half of
what is worth teaching. Model aeroplanes. Painting. Knots. Bike repair. Reading
a tide chart. Bread. Wiring a plug. First aid. Chooks. **None of that is a
lesser contribution here, and it should not be treated as one.**

School subjects are welcome too, especially for countries and languages the
repo covers badly. But if you have been wondering whether the thing you know is
"educational enough", it is.

## The one worked example

`paint-and-colour.json` is a complete package about mixing paint: forty
questions, a read-first page, an author, a licence and sources. It is here to be
copied. Open it, change the id and the title, replace the questions, keep the
shape.

It was written by the project as a model, which is worth knowing when you read
it: it is a demonstration of the format, and the person who checks your
chemistry or your carpentry will know more about it than the person who wrote
this one knew about paint. Every fact in it was checked, and if you find one
wrong, that is a genuine bug and worth an issue.

## Before you add a file here

    node tools/validate-package.mjs --strict portal/quizzes/community/<id>.json

It has to pass. The validator checks the manifest, the licence, the sizes,
every link, and every piece of text for anything that could be read as markup,
because this content ends up on a page a child reads.

It cannot check whether your answers are correct. That is your job, and it is
the one that matters most.

`test/package-test.sh` is the suite that proves the refusals actually work, and
that the portal escapes a payload even if one ever got past them.
