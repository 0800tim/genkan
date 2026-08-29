# Naming research

Working title: HEARTH. This document brainstorms alternatives, checks collisions, scores the shortlist and makes a recommendation. Research date: 29 August 2026. Collision checks are best effort via web search, the npm registry API and DNS lookups. Nothing has been registered.

What the name has to carry: a self-hosted parental-control gateway that parents run on their own hardware. Kids get filtered, time-budgeted internet and earn screen time through learning. The ethos is warmth, transparency and trust, not surveillance. The name must work as a CLI command and an npm package, and it must say "kids flourish here", never "kids are watched here".

## 1. Brainstorm

### Home and warmth

1. **Hearth** (working title). The fire at the centre of the home.
2. **Ember**. A warm glow that lasts.
3. **Kindling**. Small fuel that starts a bigger fire. Nice double meaning: kindling curiosity.
4. **Fireside**. Where the family gathers.
5. **Hearthside**. Same idea, keeps continuity with the working title.
6. **Inglenook**. The cosy nook built beside a hearth. Very warm, very distinctive.
7. **Snug**. The small cosy room in a pub or house.
8. **Homefire**. Keep the home fires burning.
9. **Hearthlight**. The glow a fire throws across a room.

### Growth and care

10. **Sprout**. New growth. Sits nicely beside the sibling project "unrot".
11. **Sapling**. A young tree, still being shaped.
12. **Fledge / Fledgeling**. A young bird learning to fly. The whole point of the project: raising kids toward independence, not keeping them caged.
13. **Tend**. What you do to a garden and a fire.
14. **Trellis**. The frame a plant climbs. Structure as support, not restriction.
15. **Greenhouse**. A protected space where things grow fast.
16. **Burrow**. A safe, warm home under the ground.

### Earning and learning

17. **Earnie**. Playful mascot-style name for earn-your-turn.
18. **Tokentime**. Literal: time as earned tokens.
19. **Brightside**. Learning as the way to the good stuff.

### Guardianship without creepiness

20. **Porchlight**. The light parents leave on so kids can find their way home. Welcome, not watchtower.
21. **Nightlight**. Comfort in the dark.
22. **Lantern**. Carried light. (Heavy collision: Lantern is a well-known censorship-circumvention tool.)
23. **Treehouse**. A kids' space with house rules. (Heavy collision: Treehouse the learning platform.)
24. **Homeroom**. School meets home.

### Māori words (see section 2 before considering any of these)

25. **Tiaki**. To care for, to guard, to protect.
26. **Manaaki**. To care for, to show hospitality and generosity.
27. **Poutama**. The stepped tukutuku pattern symbolising levels of learning and attainment.
28. **Kete**. Basket, as in the three baskets of knowledge.
29. **Kāinga**. Home, village.

## 2. On using Māori words

This is a NZ project, so te reo Māori names are tempting and the meanings fit beautifully: tiaki is exactly "guardianship without creepiness", and poutama is exactly "climb through learning". But the guidance is consistent and clear.

- Karaitiana Taiuru's brand guidelines for Māori culture, and IPONZ practice, both say that using Māori words or designs in branding without consultation risks cultural appropriation and offence. IPONZ refers any trade mark containing Māori cultural elements to the Māori Trade Marks Advisory Committee, and this review was tightened again in 2026.
- Adopting a Māori name carries obligations: the project would be expected to live up to the values the word carries (tikanga), not just borrow the sound of it.
- Some of these words are already strongly associated with other things. Tiaki is the national Tiaki Promise tourism campaign. Poutama is a taonga pattern with deep whakapapa and is also the name of a Māori business trust.

Recommendation: do not use a Māori name unless the project has Māori collaborators and has consulted properly (iwi or a Māori cultural advisor, and the IPONZ advisory committee route if ever trademarked). Flagged as "needs consultation", not recommended for launch. If the project later grows genuine Māori involvement, revisiting tiaki or poutama with guidance would be a lovely path, done right.

## 3. Collision checks (top 10)

npm status is from the registry API (404 means the name is free). Domain notes are best-effort signals from DNS and search, not a registrar check.

### 1. Hearth (working title)

- **Hearth Display** (hearthdisplay.com): a well-funded family-organisation touchscreen, "operating system for families", built for exactly our audience of parents and kids. This is the worst kind of collision: same space, same buyers.
- **Hearth** (hearth.com): fintech platform for home improvement pros.
- **Hearth** recipe app, Hearth Companion app on both app stores.
- **Hearthstone** (Blizzard): enormous brand one letter cluster away, will pollute every search.
- npm `hearth`: taken (old test-data generator).
- Verdict: high collision risk. Charming word, crowded neighbourhood.

### 2. Ember

- **Ember.js**: one of the best-known JavaScript frameworks. npm `ember` taken. As an npm package and CLI name this is dead on arrival.
- Verdict: unusable.

### 3. Kindling

- Amazon Kindle trademark adjacency: Amazon polices Kindle-alike names, and "kindling" reads as a Kindle tool. Two active GitHub projects named Kindling (a Kindle toolkit in Rust, and an Ignition utility). npm `kindling` taken.
- Verdict: high risk, mostly because of Amazon.

### 4. Fireside

- **Fireside.fm**: established podcast hosting company with apps. npm `fireside` taken.
- Verdict: medium-high risk.

### 5. Porchlight

- Trademarks: **Porchlight Book Company** (books, Milwaukee) and several **PorchLight** real estate brokerages. All in unrelated classes to consumer software for families.
- GitHub: an archived CFPB project, two small academic Python tools (spectral preprocessing, function management). Nothing active in consumer software.
- npm `porchlight`: **free** (404).
- Domains: porchlight.com and porchlight.org registered (unrelated owners); **porchlight.nz appears unregistered** (NXDOMAIN); porchlight.dev and porchlight.co.nz have DNS, so assume taken.
- Verdict: low collision risk for open-source family software. Best availability profile of the warm names.

### 6. Sprout

- **Sprout Social**: registered trademark in the computer software category. Sprouts everywhere in consumer software (baby apps, finance apps). npm `sprout` taken.
- Verdict: high risk despite the lovely fit with "unrot".

### 7. Fledgeling (and Fledge)

- **FLEDGE** was Google's Privacy Sandbox ad API, renamed Protected Audience in 2023 and now deprecated, so the collision is fading. npm `fledge` taken (small scaffolding tool), npm `fledgling` taken, but npm `fledgeling` (the British and NZ spelling) is **free** (404).
- fledgeling.nz appears unregistered (NXDOMAIN).
- Verdict: low-medium risk. The spelling ambiguity (fledgeling vs fledgling) is the real cost: people will mistype it.

### 8. Trellis

- **Roots Trellis**: well-known WordPress server and deployment tool in the same broad dev-tools world. npm `trellis` taken. Trello adjacency muddies search.
- Verdict: medium-high risk.

### 9. Inglenook

- GitHub: Project-Inglenook (dormant home-automation project), inglenook-sidings (model railway puzzle solvers). Inglenook wineries hold trademarks in wine. npm `inglenook`: taken but an empty 2017 placeholder.
- Verdict: medium risk, low activity. Distinctive but harder to spell and say, and the npm name is squatted.

### 10. Nightlight

- npm `nightlight` taken (favicon tool). "Night light" is a built-in feature name in Windows and Android, and the app stores are full of nightlight apps. Also **nightlight.gg** in gaming.
- Verdict: medium-high risk, and generic.

Variants checked for availability while researching: npm `hearthside`, `hearthkit`, `hearthlight`, `homefire`, `emberwick` and `earnie` are all free. hearthside.nz appears unregistered; hearthside.org is registered and serving. Note **Hearthside Food Solutions** is a large US food manufacturer (different industry, different trademark class).

## 4. Scores

Each criterion scored 1-5. Collision safety: 5 means clear, 1 means blocked. Flourish: how well it says "kids flourish here" rather than "kids are watched here".

| Name | Distinctiveness | Warmth | CLI-friendly | Collision safety | Flourish | Total |
|---|---|---|---|---|---|---|
| Porchlight | 4 | 5 | 4 | 4 | 4 | 21 |
| Fledgeling | 4 | 4 | 4 | 4 | 5 | 21 |
| Inglenook | 5 | 5 | 3 | 3 | 3 | 19 |
| Hearthside | 3 | 5 | 4 | 3 | 3 | 18 |
| Kindling | 3 | 4 | 4 | 2 | 4 | 17 |
| Hearth | 2 | 5 | 5 | 1 | 4 | 17 |
| Sprout | 2 | 4 | 5 | 2 | 5 | 18 |
| Trellis | 3 | 3 | 5 | 2 | 4 | 17 |
| Fireside | 2 | 5 | 4 | 2 | 3 | 16 |
| Nightlight | 2 | 4 | 3 | 2 | 2 | 13 |

Notes on the criteria. CLI-friendly rewards short, lowercase, easy to type, no spelling traps. Flourish penalises anything that hints at watching (Nightlight scores low here: it is literally a light for checking on children in the dark). Hearth scores 5 on warmth and CLI but its collision profile, especially Hearth Display sitting in the identical family-tech niche, sinks it.

## 5. Top 3

### 1. Porchlight

The porch light is the light parents leave on so their kids can find their own way home. That is precisely this project's ethos: the parents provide the light and the welcome, the kids do the exploring and the coming home. It is guardianship with zero surveillance flavour, warm without being twee, and instantly explainable in one sentence on a README. Practically it is the strongest candidate: `porchlight` is free on npm, porchlight.nz appears unregistered, the trademark collisions (books, real estate) are in unrelated classes, and the GitHub namesakes are archived or niche academic tools. It types cleanly as a CLI command, and `porch` makes a friendly short alias. Searchability is good: "porchlight github" will find this project quickly.

### 2. Fledgeling

A fledgeling is a young bird that is learning to fly, still fed and sheltered but expected to leave the nest strong. No other candidate captures "the point of this software is that your kids grow out of it" as well. It ties directly to earning independence through learning, sits happily beside "unrot", and the NZ spelling with the extra e is both on-brand and the reason the npm name is free (`fledgeling` is available, `fledgling` is taken). The Google FLEDGE ad API is deprecated and fading from memory. The cost is the spelling trap: people will type fledgling, so the fledgling npm name and domain being in other hands is a small but permanent annoyance.

### 3. Hearthside

If continuity with the working title matters, Hearthside keeps the fire without inheriting Hearth's crowded namespace. It means the place where the family actually sits together, which is gentler and more human than the hearth itself. `hearthside` and `hearthkit` are free on npm, hearthside.nz appears unregistered, and the notable trademark (Hearthside Food Solutions) is a food manufacturer in a different class. The weaknesses: Hearthstone still pollutes search, Hearth Display still lives one word away in the same family-tech aisle, and hearthside.org is already registered. It is the safe renovation of the current name rather than a fresh start.

## 6. Final recommendation

**Porchlight.** It scores at the top, it is the only warm name whose story is specifically about trust between parents and kids rather than just cosiness, and it has the cleanest availability: npm free, .nz apparently unregistered, no software trademark in the way. Suggested moves if adopted: claim the `porchlight` npm name and GitHub org early, register porchlight.nz, and consider `porch` as the short CLI alias. Keep Fledgeling in reserve as the name that best tells the growth story, and revisit a te reo Māori name only with proper consultation as set out in section 2.
