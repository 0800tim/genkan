# Runbook: generating quiz banks for your country and your kids

This runbook is written for an AI agent (Claude Code or similar) that a
parent has asked to build learn-to-earn quiz banks for Genkan. Hand this
file to your agent along with the ages of your kids and your country,
and it should be able to produce good banks without further hand
holding. Humans are welcome to read it too.

The reference implementation in this repo is for New Zealand (see
`research/curriculum-nz.md`). Your job is to do the equivalent for your
own country, then emit banks in the exact format below.

## Step 1: research your national curriculum

Do not guess what kids learn at each age. Every country publishes this.
Spend real research time here before writing a single question: the
point of the whole system is that the quizzes line up with what the kid
is actually learning at school, pitched slightly ahead or behind as
needed.

Concrete starting points:

### United Kingdom

- The National Curriculum for England is published by the Department
  for Education, organised into Key Stages: KS1 (Years 1-2, ages 5-7),
  KS2 (Years 3-6, ages 7-11), KS3 (Years 7-9, ages 11-14), KS4 (Years
  10-11, ages 14-16). Search "national curriculum programmes of study"
  on gov.uk for subject-by-subject content.
- KS4 is dominated by GCSEs. Exam boards (AQA, Edexcel, OCR, WJEC)
  publish full specifications and past papers per subject, which are
  excellent sources for topic lists and question difficulty.
- Ages 16-18 are A-levels (or Scottish Highers; note Scotland, Wales
  and Northern Ireland each have their own curriculum, so check which
  nation you are in).

### Australia

- The Australian Curriculum is published by ACARA at
  australiancurriculum.edu.au, organised by learning area and by year
  level (Foundation to Year 10), with achievement standards per year.
- States add their own senior secondary certificates (HSC in NSW, VCE
  in Victoria, QCE in Queensland, and so on). For ages 16-18, use the
  state syllabus documents.
- NAPLAN (Years 3, 5, 7, 9) sample questions show the expected level
  for literacy and numeracy.

### United States

- There is no single national curriculum. The Common Core State
  Standards (corestandards.org) cover mathematics and English language
  arts for most states, organised by grade (K-12). The Next Generation
  Science Standards (NGSS) cover science in many states.
- States vary, and some big ones (Texas, Virginia, Florida) use their
  own standards, so check your state's department of education site.
- Released state test questions and past AP exam questions are useful
  for the upper grades.

### Canada

- Education is provincial. Each province publishes its own curriculum:
  Ontario's is at the Ministry of Education curriculum site, British
  Columbia's at curriculum.gov.bc.ca, and similarly for Alberta,
  Quebec (which has its own distinct system) and the rest.
- Grades run K-12; find the "program of studies" or "curriculum
  expectations" document for each grade and subject.

### European Union examples

- Germany: education is set by each Land (state). Search for the
  "Lehrplan" or "Bildungsplan" of your Land plus the school type
  (Grundschule, Gymnasium, Realschule). The KMK
  (Kultusministerkonferenz) publishes national Bildungsstandards for
  key subjects.
- France: a genuinely national curriculum from the Ministère de
  l'Éducation nationale, published on éduscol. Organised in cycles
  (Cycle 2, 3, 4) then lycée years leading to the Baccalauréat.
- Spain: national minimum teaching requirements (enseñanzas mínimas)
  set by royal decree, developed by each autonomous community.
  Primaria, ESO (secondary), then Bachillerato.
- Netherlands: kerndoelen (core objectives) for primary school from
  SLO, then secondary streams (vmbo, havo, vwo) with eindtermen and
  national exam syllabi at examenblad.nl.

### South America examples

- Brazil: the BNCC (Base Nacional Comum Curricular) defines what every
  student should learn each year from early childhood through ensino
  médio. Published by the Ministry of Education (MEC).
- Argentina: national learning priorities (Núcleos de Aprendizajes
  Prioritarios, NAP) from the Ministerio de Educación, with provinces
  adding detail.

### General recipe for anywhere else

1. Web search "<country> national curriculum <subject> <age or grade>"
   and prefer the ministry of education's own documents over blogs.
2. Find the age-to-grade mapping first (what grade is a 9 year old
   in?), then the subject content per grade.
3. Find the national exams (if any) and their past papers; they
   calibrate difficulty better than any syllabus prose.
4. Write your own equivalent of `research/curriculum-<country>.md`
   recording the structure, which subjects quiz well, and a phased
   plan. Future agents (and future you) will need it.

## Step 2: pick year-appropriate topics

- Start from the kid, not the syllabus: their actual school year, what
  they are studying this term, and what they care about. A bank about
  a topic the kid loves (space, cars, football) beats a worthy one
  they will not touch.
- Quiz what multiple choice is good at: facts, vocabulary, rules,
  conventions and single-step problems. Do not force essay subjects,
  practical skills or contested interpretations into four choices.
  (The honest breakdown for NZ in `research/curriculum-nz.md` section
  2 applies everywhere; adapt it.)
- Pitch each bank at one band, set `suggested_age_min` to the youngest
  age that could genuinely pass it, and prefer two focused banks over
  one sprawling one.
- Include your own country's equivalents of the local content: your
  geography, your history, your road rules, your languages. Culturally
  local examples make questions feel real ("How many players on a
  netball court?" lands differently in NZ than in Germany).

## Step 3: emit the exact JSON format

The format is specified in `portal/quizzes/FORMAT.md`. Read it in full
before writing. Summary, which must be followed exactly:

```json
{
  "id": "fractions-basics",
  "title": "Fractions Basics",
  "emoji": "🍕",
  "suggested_age_min": 9,
  "minutes_per_pass": 10,
  "pass_mark": 8,
  "questions_per_round": 10,
  "questions": [
    {
      "id": "fr-001",
      "prompt": "What is 1/2 of 10?",
      "choices": ["2", "5", "10", "20"],
      "answer_index": 1,
      "explanation": "Half of 10 is 5."
    }
  ]
}
```

Hard rules:

- `id` matches the filename (`fractions-basics` in
  `portal/quizzes/fractions-basics.json`) and never changes once
  shipped.
- Exactly 4 choices per question, all plausible, no joke options.
- `answer_index` is 0 to 3 and must be verified correct.
- Bank size at least 4x `questions_per_round` (6x is better) so
  rounds rarely repeat.
- Question ids are unique within the bank, short prefix plus number.
- An optional top level `source_note` string may record where the
  content came from and when facts were last verified. Use it.

## Step 4: validate

Run the validator from the repo root:

```
node tools/validate-quizzes.mjs
```

It checks every bank in `portal/quizzes/`: JSON parses, ids unique and
matching filenames, exactly 4 choices, `answer_index` in range, bank
size at least 4x round size, and no duplicate prompts. It prints PASS
or FAIL per file and exits non-zero on any failure. Do not ship a bank
that does not pass, and do not edit the validator to make it pass.

## Step 5: quality rules

These are what make a bank worth a kid's time. The validator cannot
check them; you must.

1. Verified answers. Fact-check every single `answer_index` against a
   reliable source at writing time. For anything rule-based (road
   rules, tax figures, sporting laws), verify against the current
   year's official source by web search, and note the verification
   date in `source_note`. When you cannot verify a fact, cut the
   question.
2. Plausible distractors. Wrong answers should be the mistakes a real
   learner makes (7 x 8 offering 54, 56, 63, 48), not obvious filler.
   No trick questions, no "all of the above" unless it is genuinely
   the answer style of the source exam.
3. Friendly one-line explanations. One sentence that teaches, shown
   after every answer, right or wrong. Teach, never scold.
4. Age-appropriate. Vocabulary, themes and difficulty match
   `suggested_age_min`. Nothing frightening, nothing that assumes
   knowledge a kid of that age would not have.
5. Culturally local. Use your country's spelling conventions,
   currency, units and examples. Respect indigenous and minority
   content: name traditions accurately, do not flatten regional
   differences, and get diacritics right (in this repo that means
   correct macrons: Taupō, Whangārei). Content teaching a language you
   do not speak fluently ships only after review by a fluent speaker.
6. Kind tone throughout. The portal frames failure as "have another go
   later"; your questions and explanations should read the same way.

## Step 6: contribute banks back

Other families benefit from your work, and you from theirs. Genkan
content is open source.

1. Fork the repo on GitHub and create a branch
   (`banks/<country>-<topic>`).
2. Add your bank file(s) under `portal/quizzes/`, and your curriculum
   research note under `research/` if you wrote one.
3. Run `node tools/validate-quizzes.mjs` and make sure everything
   passes.
4. Open a pull request. In the description: the country and age band,
   your sources, the date you verified facts, and a named reviewer for
   any specialist or language content (see CONTRIBUTING.md and the
   review notes in `research/learn-to-earn.md`).
5. Expect the reviewer to spot-check answers. You are vouching for all
   of them.

Banks about your own household (private jokes, family history) are
lovely; keep those in your local fork rather than upstream.
