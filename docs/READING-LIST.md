# The reading list

What a child can still reach when they have run out of screen time: the
`scope='learn'` rows in `always_allow`, seeded by `config/db/schema-learn.sql`
and `config/db/schema-learn-intl.sql`. This document is the research behind
the international file: what is on it, why the rule is what it is, what was
rejected and why, and how your own household adds to it.

## The rule

A child who is blocked can still reach the portal, the quizzes, and this
list. That makes learn-to-earn a real trade: effort for time, not a memory
test where a child can only answer what they already knew. The list exists so
a child who wants to earn time by learning has somewhere to go and actually
learn something new.

It stays deliberately short and deliberately dull. Every candidate had to
pass five tests before it earned a place:

- No social feed, comments, direct messaging, or any way for one user to
  reach another.
- Not video-first. A site can have a video here and there and still pass; a
  site whose real content is its video library does not, no matter how good
  the videos are. This is the test people get wrong, because a video site
  dressed up as a school resource is still a way round the block.
- Not heavily advertising-funded, and not aggressively monetised at children
  specifically (upsells to a subscription, a shop the site steers a child
  towards, adverts built to be clicked by a nine year old).
- No account needed to read anything useful. An account to save a favourite
  or a personal results page is fine; an account to read the actual content
  is not.
- No way to reach general web content through it. That rules out search
  engines, proxies, link aggregators, and anything with an open embedded
  browser, even when it is built on top of a genuine library's holdings.

A short list that actually meets those tests is worth more than a long one
that quietly fails a couple of them. Every rejection below is a real one: a
site that looked like an obvious yes until it was checked.

## What is on the list

### The core fifteen (schema-learn.sql)

Wikipedia, Wikimedia, Wiktionary, Simple English Wikipedia, Britannica, the
National Library of New Zealand, Te Ara, the Department of Conservation,
NASA, the European Space Agency, the Natural History Museum, the Science
Learning Hub, Maths Is Fun, and the NZTA road code sites. That file has its
own reasoning at the top; this document does not repeat it.

Khan Academy is not in either file. It already sits in `always_allow` with
`scope='safety'` (see `config/db/seed.sql`), because it was put there before
the learn/safety split existed and moving it would narrow, not widen, its
promise. It survives every cut exactly as it always has.

### New Zealand

| Domain | Why |
|---|---|
| `www2.nzqa.govt.nz` | NZQA's subject and assessment pages: what a student preparing for NCEA actually reads. Login is only needed for the personal results portal, not for a subject page. |
| `tahurangi.education.govt.nz` | The Ministry of Education's curriculum resource platform. It is replacing Te Kete Ipurangi (`tki.org.nz`), which is being wound down onto this site, so this is the one worth adding now. |
| `nzhistory.govt.nz` | NZ History, from the Ministry for Culture and Heritage: a day-by-day calendar of events and a dictionary of biography, in plain text. |
| `aotearoahistories.education.govt.nz` | Aotearoa New Zealand's Histories, the curriculum topic every school has taught since 2023, and the natural first search result for it. |
| `tepapa.govt.nz` and `collections.tepapa.govt.nz` | Te Papa's learning pages and its object database. Both are needed: they are on different addresses, and without the second the collection pages load with the objects missing. |

### Australia

| Domain | Why |
|---|---|
| `australiancurriculum.edu.au` | The Australian Curriculum itself, published by ACARA. The national syllabus every Australian school works from. |
| `educationstandards.nsw.edu.au` | NESA, the NSW curriculum and HSC syllabus authority. Added as the one representative state body, since NSW is the largest. Victoria (VCAA) and Queensland (QCAA) run their own; add one if your household needs it. |
| `csiro.au` | CSIRO, Australia's national science agency. |
| `ga.gov.au` | Geoscience Australia: earthquakes, geology and maps, from the source. |
| `bom.gov.au` | The Bureau of Meteorology, for weather and climate. |
| `library.gov.au` | The National Library of Australia, which now serves its site from this address rather than the older `nla.gov.au`. |
| `australian.museum` | The Australian Museum's fact sheets on fossils, animals and minerals, written for students and teachers. |
| `naa.gov.au` | The National Archives of Australia, for primary sources and historical records. |

### United Kingdom

| Domain | Why |
|---|---|
| `nationalarchives.gov.uk` | The National Archives: primary sources and historical records, the UK equivalent of `naa.gov.au` and `archives.gov`. |
| `bl.uk` | The British Library. |
| `rmg.co.uk` | Royal Museums Greenwich, home of the Royal Observatory: astronomy and navigation, well explained. |
| `nrich.maths.org` | The University of Cambridge's free maths problem sets. No account needed, and a genuinely different style of explanation to Maths Is Fun, so the two complement each other. |
| `nationalgallery.org.uk` | The National Gallery's collection pages. Its shop lives on a separate subdomain (`shop.nationalgallery.org.uk`), which is deliberately not included. |
| `stem.org.uk` | STEM Learning UK's open-access resource library, aligned to the English National Curriculum. An account is only needed to save favourites, not to read a resource. |

### United States

| Domain | Why |
|---|---|
| `loc.gov` | The Library of Congress, including research guides written specifically for middle and high school students. |
| `learninglab.si.edu` | The Smithsonian Learning Lab: a million museum objects and specimens, free to browse with no account needed. An account is only required to save a collection. |
| `noaa.gov` | NOAA, for weather, ocean and atmosphere questions. |
| `www.usgs.gov` | The US Geological Survey, for geology, earthquakes and water. Note the `www.`: the bare `usgs.gov` does not resolve. |
| `archives.gov` | The US National Archives, for primary sources and historical records. |
| `merriam-webster.com` | The standard American dictionary. Its free tier carries ordinary banner ads, not the aggressive, child-targeted kind, and no account is needed to look up a word. |

The United States has no single national curriculum body the way NZ, AU and
the UK do; curriculum is set state by state. That is why the American entries
above are science and reference agencies rather than a curriculum authority.
`ed.gov`, the federal Department of Education, was considered and rejected
for exactly that reason: see below.

## Notable rejections

These looked like obvious inclusions and failed on inspection. Recording them
here is as useful as the list itself, so nobody re-adds them later without
re-doing the checking.

- **BBC Bitesize** (`bbc.co.uk/bitesize`). The single most obvious UK
  candidate, and the clearest failure of the video-first test. The BBC's own
  description of it is "you can learn concepts through videos", it runs a
  dedicated YouTube series, and its 2026 expansion leans further into
  short-form video. A genuinely good resource for a family that has decided
  video is fine; not a fit for a list that exists specifically because video
  is not.
- **ABC Education** (`abc.net.au/education`), Australia's equivalent. Its own
  description: "thousands of free videos... video lessons... animated
  series". Same failure, same reason.
- **PBS LearningMedia** (`pbslearningmedia.org`), the US equivalent again.
  Described by PBS itself as a library of videos, games and lesson plans.
  Rejected for the same reason a third time, which says something about how
  public broadcasters build "education" sites in general: video first,
  reading material as a supplement.
- **National Museum of Australia** (`nma.gov.au`). Its digital classroom
  content is built around videos with supporting activities. The Australian
  Museum, on `australian.museum`, does the same job in fact-sheet form and is
  on the list instead.
- **Trove** (`trove.nla.gov.au`). Built by the National Library of Australia,
  and a genuinely excellent tool, but it is a search engine over the open
  web and a huge range of collections, not a reference site with a fixed
  edge. That is exactly the shape the rule excludes: a search engine wearing
  a library's name is still a way to reach anything.
- **`gov.uk`**. Tempting, because it is where the UK's National Curriculum is
  published. But the domain is the whole of UK government: tax, visas,
  courts, benefits, passports, everything. Allowing the domain does not
  allow a curriculum page, it allows the entire site, which is not a
  reading list by any reasonable definition of the word.
- **`ed.gov`**, the US Department of Education. Overwhelmingly a policy and
  administration site: laws, funding, data. What direct student content it
  has is a small corner of a much larger site built for a different
  audience. Rejected as not being schoolwork reading material in practice,
  not on any of the five tests above.
- **`dictionary.com`**. Considered alongside Merriam-Webster as the other
  major American dictionary. Its advertising and affiliate content is
  heavier and more product-driven. Merriam-Webster made the list instead.
- **National Geographic Kids** (`natgeokids.com`). Free with no sign-up, but
  by its own advertising material it exists to sell magazine subscriptions
  and books, its content is dominated by games and short videos, and a fair
  amount of the actual content sits behind a paid tier. Fails the
  advertising test and the video-first test at once.

## A limit worth knowing: shared addresses

`genkan allow-sync` resolves each domain in `always_allow` with `getent
ahostsv4` and allows the exact addresses that come back. It does not resolve
subdomains and it does not do anything clever with wildcards: whatever
hostname is stored is the hostname it looks up.

That cuts both ways. Wikipedia is stored as the bare `wikipedia.org`, but
the address a browser actually asks for is `en.wikipedia.org`. It only works
because the Wikimedia Foundation happens to serve both from the same shared
front-end addresses. If a site's real content lives on a different address to
its bare domain, and the two are not on the same infrastructure, the bare
domain will resolve to something else entirely and the child will get a
broken page. Te Papa is the clear example in this file: `tepapa.govt.nz` and
`collections.tepapa.govt.nz` are genuinely different addresses, so both had
to be added.

The other direction is the one to watch for. Many of these sites, especially
the museums and libraries, sit behind a shared content delivery network
(Cloudflare, Fastly, AWS CloudFront and similar). Allowing a domain on shared
infrastructure allows whatever address that domain currently resolves to,
and that address can be shared with unrelated sites on the same CDN. It is
usually harmless, because CDN edge addresses serve content keyed to the
request's hostname, not the IP alone, and a browser still asks for the exact
domain that was typed. But it means the safety of this list rests partly on
how the wider internet is built that day, not only on which domains are
typed into this file. Re-check a domain if it starts behaving strangely
after a change on the site's end; a resolve failure or a sudden change in
address is worth noticing.

## Adding your own

The list belongs to your household, not to this repository. To add a site:

```sql
INSERT INTO always_allow (domain, scope, category, note)
VALUES ('example.org', 'learn', 'reference', 'Why this one earns its place.')
ON CONFLICT (domain) DO UPDATE SET scope = EXCLUDED.scope,
                                   category = EXCLUDED.category,
                                   note = EXCLUDED.note;
```

Then run:

    genkan allow-sync

which resolves every `always_allow` row with `scope` of `safety` or `learn`
and loads the addresses into the firewall's `kids_allow` set. The gateway
also does this on its own at start and once an hour, so a manual run is only
needed if you want the change to take effect immediately.

Before adding a domain, check it actually resolves:

    getent ahostsv4 example.org

and run it past the five tests above. If the domain you want is a subdomain
(the real content lives at `study.example.org`, not `example.org`), add that
exact subdomain rather than the bare domain: `genkan allow-sync` looks up
literally what is stored, nothing more clever than that.

## Allowed by address, filtered by name

The firewall lets a cut-off child reach these sites by address, and
addresses are shared: a site behind Cloudflare sits on two addresses that
thousands of other sites use, and Google's search page runs on the same
machines as YouTube and Gmail. So while a child is cut, the DNS layer answers
every name with the portal's address except the names on this list, which
resolve normally (`bin/genkan-adguard`). A browser cannot reach a neighbour
it cannot resolve. The remaining door is a hosts-file entry, which is
bug-bounty territory, not an accident. Rows with `category='search'` are
matched as exact hosts, so `google.com` on the list does not bring
`mail.google.com` with it; every other row covers its subdomains.
