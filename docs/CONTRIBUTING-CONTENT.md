# Contributing a learning package

**You do not need to be a programmer to read this page.** You need something
you know how to do, and a text editor.

Hearth gives children a filtered, time-budgeted network, and a way to earn time
back by learning. The learning material is a set of quiz banks. Most of them
were written around school subjects, because that is what the first household
needed. That is not the interesting half.

The interesting half is everything else. How to mix paint so it stops going
brown. How to trim a balsa wing so a model aeroplane flies straight. How to tie
a bowline. How to read a tide chart, sharpen a chisel, keep a sourdough starter
alive, wire a plug, take a decent photograph, look after a bike. Somebody knows
each of those properly and could teach it in forty questions.

**Those are not lesser contributions here. They are the point.** A child who
earns half an hour of game time by learning how a wing generates lift has had a
better afternoon than one who earned it by reciting times tables they already
knew.

This page is how you write one, test it, and send it in.

## Contents

- [What a package is](#what-a-package-is)
- [Start by copying the example](#start-by-copying-the-example)
- [The file, field by field](#the-file-field-by-field)
- [What makes a good question](#what-makes-a-good-question)
- [What makes a good explanation](#what-makes-a-good-explanation)
- [The read-first page](#the-read-first-page)
- [Pictures, sound and video: not yet, and why](#pictures-sound-and-video-not-yet-and-why)
- [Links, and the reading list rule](#links-and-the-reading-list-rule)
- [Testing it yourself](#testing-it-yourself)
- [Sending it in](#sending-it-in)
- [What will get it turned down](#what-will-get-it-turned-down)
- [The licence question](#the-licence-question)
- [How a household installs one](#how-a-household-installs-one)

## What a package is

One file. That is the whole design, and it is deliberate: one file can be
emailed, attached to an issue, dropped in a folder, or put in a pull request by
somebody who has never used git before.

Inside it is a quiz bank: forty or more multiple choice questions, each with
four answers and a one sentence explanation. Wrapped around it is a short
manifest that says who wrote it, what licence it carries, who it is for, and
optionally a page of writing to read before having a go.

A package is an extension of the quiz bank format that Hearth already used, not
a replacement. Everything in `portal/quizzes/FORMAT.md` still applies and is
still the reference for the quiz half. A package just adds a `package` block on
top.

To put a number on how much of an extension it is: forty-one of the forty-two
banks that ship with Hearth pass every package check unchanged, manifest aside.
So if you have already written a bank, you are four lines from a package. (The
forty-second fails on an explanation of 404 characters, where the database
column stops at 400. That is a real bug in that bank rather than a difference
between the two formats.)

## Start by copying the example

    portal/quizzes/community/paint-and-colour.json

That is a complete, working package about mixing paint. Forty questions, a
read-first page, an author, a licence, sources. It is there to be copied.

Open it in any text editor. Change the id, the title, the questions. Keep the
shape.

If the JSON punctuation is unfamiliar, the two rules that catch everybody are:
every item in a list needs a comma after it except the last one, and every piece
of text goes in double quotes. If a quote mark appears inside your text, write
it as `\"`. Any online JSON checker will tell you where a missing comma is, and
so will our own validator.

## The file, field by field

### The bank half

| Field | What it is |
|---|---|
| `id` | A short name in lowercase letters, digits and hyphens: `knots`, `bike-repair`, `model-aeroplanes`. **It must match the filename**, so `knots.json` holds `"id": "knots"`. It never changes once people have it. |
| `title` | What a child sees on the card. Up to 60 characters. |
| `emoji` | One or two emoji for the card. Nothing else. |
| `suggested_age_min` | The youngest age you wrote it for. It is a hint that sorts the list, not a lock. A younger child can still open it. |
| `minutes_per_pass` | Minutes of screen time a passing round earns. Ten is normal. Do not be generous: households can change it, and a package that pays forty minutes will simply be turned off. |
| `pass_mark` | How many they have to get right. Eight is normal. |
| `questions_per_round` | How many questions in one go. Ten is normal. |
| `questions` | The questions. At least four times `questions_per_round`, so forty for a ten question round. |

Each question:

| Field | What it is |
|---|---|
| `id` | Unique inside your bank. A short prefix and a number: `knot-014`. Never reuse one. |
| `prompt` | The question. Up to 400 characters. |
| `choices` | Exactly four answers, all different, all plausible. |
| `answer_index` | Which one is right, counting from 0. So `0` is the first, `3` is the fourth. |
| `difficulty` | 1 to 5. Label **every** question or none of them. |
| `explanation` | One or two sentences, shown after they answer either way. Up to 400 characters. |

Difficulty is relative to the age you wrote for, not to an adult. Level 1 is
something anyone in that age band already knows. Level 5 is the interesting edge
of the topic. Level 5 is a harder **idea**, never a more obscure fact: three
invented names in the wrong answers is a bad question, not a hard one.

At least ten of your forty questions have to be at level 1 or 2, because a child
having a bad day is given a round built mostly from those and there has to be
enough to fill one. The validator checks it.

### The manifest

```json
"package": {
  "format": 1,
  "author": "Your name, or a handle",
  "contact": "github.com/yourname",
  "licence": "CC-BY-4.0",
  "description": "Who this is for and what they get out of it. Two or three sentences.",
  "tags": ["making", "hands-on"],
  "updated": "2026-08-30",
  "sources": ["https://en.wikipedia.org/wiki/Knot"],
  "read_first": { "title": "...", "body": ["..."], "links": [] }
}
```

`author`, `licence` and `description` are required. Everything else is optional.
`contact` can be a handle, an email or nothing at all: a public repository is a
public place, so put in as little as you are comfortable with.

`description` is what a parent reads when they are deciding. Say who it is for
and what they will actually be able to do afterwards. Do not sell it.

## What makes a good question

- **Four plausible answers.** Three obviously silly options turn a question into
  a reading test. Use the mistake somebody really makes. If you have taught this
  to anyone, you already know what they get wrong: that is your second choice.
- **One clearly right answer.** Not "the best of these". If two answers could be
  defended, the question is not ready.
- **No trick questions and no gotchas.** A child failing your quiz loses screen
  time they were trying to earn. That is a real cost to them.
- **Nothing that dates fast.** Prices, records, current champions and "the
  latest" of anything will be wrong within a year and nobody will notice.
- **Check every single answer against a real source.** Not from memory, however
  well you know it. A wrong answer marks a child down for being right, and it
  teaches them something false at the same time.

## What makes a good explanation

This is the part that matters most, and it is the part people skip.

The explanation is not a mark scheme. It is the teaching. Children read every
explanation on the **Read up** page before they take a round, and again after
each answer. A bank with no explanations is a test, and a test teaches nobody
anything.

A good explanation:

- **Is written for the child who got it wrong**, not for the one who got it
  right. "Correct: orange" tells them nothing. "Red and yellow make orange,
  which sits between them on the colour wheel" tells them why.
- **Gives the reason, not the restatement.** "Seven groups of eight make 56"
  beats "The answer is 56". If it is a plain fact with no reason behind it, give
  the hook that makes it stick.
- **Stands on its own.** It is read away from the question, so it cannot say
  "the other options" or "option B".
- **Is one or two sentences.** It appears under a question a child has just got
  wrong. A paragraph gets skipped.
- **Never scolds, and never says "obviously" or "simply".** They have just
  failed at this.

## The read-first page

A package can carry a short piece of writing that a child sees at the top of the
bank's **Read up** page, before the questions.

```json
"read_first": {
  "title": "Why your paintings keep going brown",
  "body": [
    "First paragraph.",
    "Second paragraph."
  ],
  "links": [
    { "label": "Colour, in Simple English", "url": "https://simple.wikipedia.org/wiki/Color" }
  ]
}
```

Up to twelve paragraphs and 6000 characters in total. That is roughly one page.
It is deliberately short: a child reads this on a phone, usually because they
have just run out of time and are cross about it.

Write it as though you were explaining it to one child at a kitchen table.
The example package's read-first is a fair model: it explains the one idea that
makes everything else make sense, and then gets out of the way.

This is the piece that turns a package from a test into a lesson. It is
optional, and it is the single best thing you can add.

## Pictures, sound and video: not yet, and why

**A package cannot carry an image, an audio clip or a video.** This is the real
limit of the current design and it is worth being straight about it, because a
painting module or a model aeroplane module obviously wants a picture.

Three reasons, and none of them is "we did not think of it":

1. **The portal serves text.** The kid portal builds its pages as HTML strings
   inside the island's network namespace. There is no static file directory, no
   asset pipeline and no image handling. Adding one is real work and it has not
   been done.
2. **A link to an outside image would be a broken box.** A child on the Read up
   page is usually a child who has run out of time. Their device can reach the
   portal and about forty reference sites, and nothing else. An image hosted
   anywhere else fails to load at exactly the moment it was needed.
3. **Embedding pictures in the file breaks the one-file idea.** An image encoded
   into the JSON pushes a 60 KB package to several megabytes, which is no longer
   something you can attach to an issue, and it would sit in the database.

**What it would take**, if somebody wants to build it: a small asset directory
served by the portal from inside the island, a per-package size budget, an image
type allowlist with the file contents actually checked rather than trusted, a
way to carry binary files through a pull request, and a decision about what
happens to an installed package's images when it is removed. That is a proper
piece of work, not a field in a JSON file, and pretending otherwise by adding an
`image` field that silently does nothing would be worse than the honest gap.

**What you can do today.** Write the picture in words. Point at a diagram on the
reading list with a `read_first` link. A great many practical subjects survive
this better than you would expect: the paint example teaches colour mixing with
no colour wheel on the screen at all.

If your subject genuinely cannot be taught without a picture, say so in the pull
request. That is useful evidence for building the asset support properly.

## Links, and the reading list rule

Every URL in a package, in `sources` and in `read_first.links`, must be `https`
and must point at a domain already on Hearth's reading list.

The reading list is the set of about forty reference sites that stay reachable
for a child who has been fully cut off: Wikipedia, Britannica, Te Ara, NASA, the
national libraries and museums, the curriculum bodies. `docs/READING-LIST.md`
has the list and the five tests a site has to pass.

The rule is not gatekeeping. It is that any other link is dead on arrival for
the child reading it, because their device cannot reach it. A dead link at the
moment a child is trying to learn something is worse than no link.

If a site genuinely belongs on the reading list, propose it separately, in its
own issue, against the tests in `docs/READING-LIST.md`. Read the rejections
first: several very well known school sites failed, mostly for being video
libraries wearing a library's name.

## Testing it yourself

Three commands. The first two need nothing but a copy of this repository and
Node installed. You do not need a running Hearth, a network, or any hardware.

**1. Check the quiz half:**

    node tools/validate-quizzes.mjs my-package.json

**2. Check the whole package:**

    node tools/validate-package.mjs --strict my-package.json

That is the one that matters. It checks the manifest, the licence, the sizes,
every link, and every piece of text for anything that could be read as markup.
Drop `--strict` to check a plain bank that has no manifest yet.

A pass looks like this:

    PASS  paint-and-colour.json (40 questions, The Hearth project, CC-BY-4.0, read-first (6 paragraphs))

A failure names the field and says what to do about it. Nothing it prints is a
judgement on your content. It cannot read your content.

**3. If you run Hearth, install it and take a round yourself:**

    bin/kidnet-pack install my-package.json

Then open the kid portal, press **Read up**, and read your own explanations on
the screen a child will read them on. Several things that seem fine in a text
editor read badly there.

### What the validator cannot check

It cannot tell whether your answers are **correct**, whether your explanations
**teach** anything, or whether your wrong answers are **plausible**. A package
can pass every check and still be bad content. That is what review is for, and
it is why fact-checking every answer is your job and not the tool's.

## Sending it in

Whichever of these you find easiest. None of them is more welcome than another.

**A pull request**, if you are comfortable with git:

1. Fork `github.com/0800tim/genkan`.
2. Put your file in `portal/quizzes/community/`, named `<your-id>.json`.
3. Run `node tools/validate-package.mjs --strict portal/quizzes/community/<your-id>.json`
   and make sure it passes.
4. Open the pull request. In the description, say who it is for, how you know
   the subject, and where you checked the answers. If there is anything you were
   not certain about, say that too. It is more useful than confidence.

**An issue.** Open an issue and attach the file. Somebody will run the validator
and open the pull request for you. This is a completely normal way to
contribute and it is not a lesser one.

**By hand.** If you cannot use GitHub at all, the file is just a file. Send it
however you like and say it is for Hearth.

Please do not put your package in `portal/quizzes/` itself. That directory is
the banks that ship as part of Hearth and load automatically. The community
shelf is `portal/quizzes/community/`, and the difference is explained in the
README there.

## What will get it turned down

Being clear about this up front is kinder than being vague and then declining
something somebody spent a weekend on.

- **A wrong answer.** One is enough to send it back. Not as a punishment: a
  wrong answer takes minutes off a child for being right.
- **No explanations**, or explanations that only restate the answer. The bank
  is the explanations.
- **Half-labelled difficulty.** Label every question or none.
- **Anything that would embarrass a child**, single anybody out, or make failing
  feel like a telling off.
- **Advertising.** A package that exists to point at a product, a course, a
  channel or a business. Content only.
- **Anything age-inappropriate for the age you aimed it at**, including in the
  wrong answers, which is where it usually hides.
- **Politics, religion or ideology presented as fact.** History and civics are
  welcome, and both need care. If you would not be comfortable with somebody
  else's household teaching your children this way round, do not send it.
- **Anything that is really an AI dump nobody checked.** Using an AI to draft is
  completely fine and several banks here started that way. Sending it in without
  verifying every answer yourself is not, and it shows.
- **Anything the validator refuses.** Markup in a text field, a link off the
  reading list, a missing licence. Fix it and send it again.

## The licence question

Pick one of these four, and put it in `package.licence`:

| Licence | What it means |
|---|---|
| `CC-BY-4.0` | Anyone can use and change it, as long as you are credited. **This is the recommended one.** |
| `CC0-1.0` | You give it away completely, no credit needed. |
| `CC-BY-SA-4.0` | Like CC-BY, but changed versions must carry the same licence. |
| `MIT` | The licence Hearth itself uses. Fine, though it is written for code. |

Nothing else is accepted, and the database enforces it.

Why the short list. A household has to be able to install your package, keep it,
and change it for their own children without asking anybody. A grandparent
should be able to fix a question their grandchild found confusing. A licence
that does not allow all three is not shareable content, it is a product with
conditions, and this shelf is not the place for it.

You keep the copyright either way. The licence says what other people may do,
not who owns it.

Two things to be sure of before you choose:

- **It has to be yours to give.** Do not copy questions out of a textbook, a
  past exam paper or a commercial course. Facts are free; somebody else's
  wording of them is not. Write your own.
- **Credit your sources anyway**, in `package.sources`, even when you are not
  required to. It is what lets the next person check your work.

## How a household installs one

For completeness, and so you know what happens to your file at the other end.

    bin/kidnet-pack list                    what is installed, and what is on the shelf
    bin/kidnet-pack validate <file>         check it before saying yes
    bin/kidnet-pack install <file>          install it for the kids
    bin/kidnet-pack remove <id>             take it out again

An installed package goes into the household's **database**, not into the
repository. That matters: updating Hearth cannot delete it, and removing it is
one command that leaves nothing behind. Everything the children earned from it
stays earned, because the time ledger does not depend on the bank still
existing.

Once installed it behaves like any other quiz bank. Graded on the server, so the
answers never reach the browser. Same difficulty ramp, same rest between goes,
same daily cap. A parent can switch it on or off per child and change what it
pays, on the dashboard's **Learn to earn** screen, where installed packages are
listed with your name and your licence on them.

**Nothing about this involves a server of ours.** There is no package registry,
no download, no update check and no telemetry. Hearth talks to no cloud. Your
package reaches a household because they pulled the repository or because
somebody handed them the file.

### Being told about a package that suits your child

The intention is that a parent is told when a package would suit one of their
children, based on what that child actually likes.

**That is not built.** Saying so plainly matters, because it is the sort of
feature that is easy to describe in the present tense and hard to build.

What exists today is the evidence half, and it already works without any AI at
all. `bin/kidnet-quiz-suggest <child>` prints a briefing from the household's
own database: what that child passes, what they avoid, what they keep getting
wrong, and what their devices have been looking up that nothing else explains.
`bin/kidnet-pack list` prints what is installed and what is on the shelf. Paste
both into whichever AI agent the parent already uses and it can say which
package fits, and why. `docs/runbooks/quiz-suggestions.md` is the recipe.

Whatever gets built later will work that way round: an agent the parent runs, on
their own box, reading their own database. Not a service Hearth calls. Hearth
has no telemetry and talks to no cloud, and a recommendation engine that watched
your family would be the one feature that broke that promise.
