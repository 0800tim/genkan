# Recommendations: things worth doing (some you didn't ask for)

Kids are 11, 14 and 16. That spread matters: the same filter for all three
is wrong. Below is what to build in, flagged by priority.

This started as a design document and is now mostly a record of what shipped.
Each item carries its real status. Where something is still an intention, it
says so rather than reading as though it were done.

## 1. Age-tiered policy (built into the DB already)

- **11 (young):** tight. Block adult/gambling/drugs/self-harm/dating/
  weapons/violence/VPN-proxy. Force SafeSearch + YouTube-restricted.
  Earliest bedtime, smallest time budget (90 min school / 180 weekend).
- **14 (standard):** block the genuinely harmful categories, keep social
  but logged. SafeSearch on. Later bedtime, medium budget.
- **16 (teen):** light touch on purpose. Block only the seriously harmful
  (extreme adult, self-harm, drugs, VPN-bypass). No blanket time budget.
  Over-blocking a 16yo backfires and pushes them to mobile data or a mate's
  hotspot. Focus shifts to time-of-day + safety alerts, not content walls.

## 2. Be transparent with the older two (strong recommendation)

Covertly reading everything a 14/16yo does tends to destroy trust and, when
found, pushes them off-network where you have zero visibility. Tell them the
network is filtered and time-managed; keep monitoring at "flag genuinely
harmful things", not "read their DMs". Closer supervision of the 11yo is
age-appropriate. (This mirrors the unrot ethos: help them self-regulate,
don't just surveil.)

## 3. Tamper resistance (a 16yo WILL try)

- Force all DNS through the Hearth box; block DoT (853) and DoH endpoints. [done in nft, tested]
- Segment isolation so they can't reach the main LAN. [done in nft]
- Log/alert on an unknown device joining the island, or a device using an
  IP that isn't its reservation (static-IP dodge). [ENFORCEMENT DONE: the
  `kids_known` default-deny set means an address we never handed out gets no
  internet at all, proved by both test rigs. The ALERT half is not built: an
  unknown device is silently refused rather than reported.]
- Block known VPN/proxy domains (category proxy-vpn) to stop trivial
  filter-bypass. Cat-and-mouse, but covers the easy 90%.

## 4. Controls beyond a blunt on/off

- **Per-category kill:** "kill Ben's gaming" blocks Steam/Epic/Roblox/
  Fortnite/consoles while the rest of his internet stays on. [in kidnet]
- **Dinner / family pause:** one word pauses all kids, then resume. [in kidnet]
- **Time budgets / quotas**, not just schedules: X minutes/day per kid.
  [done: time_ledger + kids-meter.timer, and per-category budgets on top]
- **Homework window:** education domains always allowed even during a cut.
  [done: always_allow scope='safety' covers schoolwork as well as help lines]
- **Temporary grants:** "give Cleo 30 more minutes". [done: `kidnet bonus` for
  general minutes, `kidnet grant` for one category. Neither auto-expires: they
  are day-scoped, and the ledger resets at local midnight.]

## 5. Schedules

- School-night vs weekend bedtimes, per kid (15-min-slot granularity, the
  jonas5 model). Auto-off at bedtime, auto-on in the morning, via timers.
  [NOT BUILT. The `schedules` table exists and school-night versus weekend
  budgets are honoured, but nothing reads a bedtime and flips the switch.
  Today bedtime is `kidnet off` from a timer you write yourself, or a word to
  the agent.]

## 6. Safety net (important)

- **Youth help lines are never blocked**, even at bedtime or during a cut:
  1737, Youthline, Kidsline, The Lowdown. [ENFORCED: nft set @kids_allow, fed
  by `kidnet allow-sync`, proved by test/firewall-test.sh. Until 2026-08-29
  this was seeded in the database but nothing in the firewall read it, so the
  guarantee was not actually kept.]
- **Self-harm / suicide-related searches raise an URGENT alert** to you
  regardless of the kid's age. That's a safety signal, not a discipline one.

## 7. Guests

- Guests join the SAME isolated island, so they get internet but cannot
  touch the main network where the Hearth box and all client work live. [nft isolation]
- Guest policy = adult/malware/VPN filtering only, no schedules, no
  per-person logging. [guest tier seeded]

## 8. Reporting

- Weekly per-kid summary to you: hours online, top domains, any flagged
  categories. Keeps it a conversation, not a spy report. [BUILT:
  `bin/kidnet-report`, docs/reporting.md. Read-only, plain text, one block per
  child. It is not installed by deploy.sh and has no timer by default; the
  two units to create are in that document.]
- Live view for the parent: the dashboard's three pages (tonight's state and
  controls, per-child trends including measured bytes per service, and the
  device roster). [BUILT: dashboard/, host-side, on your private network.]

## 9. Honest limits (unchanged, worth repeating)

- Network sees DOMAINS, not encrypted page content. In-app bullying
  (Snapchat/Insta/Discord DMs) is invisible here; that needs a consenting
  app tool (e.g. Bark) or platform supervision.
- Mobile data never touches this network. Google Family Link is the only
  lever for the 14/16yo's cellular. Pairs well with this, doesn't overlap.

## 10. Open-source hardening (before publishing)

- Split the household's live values (NIC MAC, SSID, subnet) into config.env; ship
  config.env.example only. [example added]
- Keep secrets.env gitignored. [done]
- README/QUICKSTART for other parents; MIT like unrot. [licence added]

## 11. Time budgets, bonus time + captive portal (built 2026-08-27)

Everything in this section shipped and is running.

- **Daily budgets** per kid (time_ledger): 11yo 90 min school / 180 weekend,
  14yo 120/240, 16yo no network limit (teen tier). The `kidnet-meter` timer
  ticks a minute off while a device is active; at 0 the kid is moved to the
  captive portal.
- **Bonus / earn:** `kidnet bonus <kid> <min>` or the dashboard +15/+30/dishes
  buttons add time and reopen the internet. Earnable tasks live in `tasks`
  (dishes +30, homework +45, unrot study quiz +15). Every grant/earn/spend is
  logged in time_events.
- **Captive portal** (portal.mjs): when a kid is blocked or out of time, their
  device shows a friendly "Time's up, here's how to earn more, then see Dad"
  page instead of pages silently failing. Uses OS captive-portal detection so
  it pops the sign-in sheet on Android/iOS/Windows(wired PC)/Mac. Help lines
  are shown and always reachable.
- **Family Link runs alongside, not replaced.** This system governs HOME
  network time (WiFi + wired). Family Link governs the whole Android DEVICE
  including mobile data, and is where you grant device-level bonus and reach
  cellular. Use both: network layer for "at home", Family Link for "anywhere".
  There's no open Family Link API, so bonus time is granted in each
  independently (a minute here isn't auto-synced to Family Link).

## 12. Household bug bounty (BUG-BOUNTY.md)

Turns the "they'll try to get around it" reality into a teaching game: kids
earn rewards for finding + RESPONSIBLY REPORTING bypasses (DoH/DoT, static IP,
MAC spoof, VPN), each a real networking skill. Closes the hole + pays the kid.
Aligns with the unrot ethos.

## 13. Device classification (built 2026-08-29)

Every device is classed `personal`, `iot` or `infra` (`bin/kidnet-classify`,
`config/db/schema-devices.sql`). It matters for one reason worth stating
plainly: **the group commands only ever touch personal devices.** "Dinner",
"kids off" and bedtime cannot darken a security camera, a smart lock, a
thermostat or a speaker. A parental control that takes the front door offline
at 9pm is not one anybody keeps using.

Classification is a guess, in three passes: the hostname the device announces,
then the MAC's manufacturer prefix, then the locally-administered bit (a
randomised MAC with no other signal is almost always a phone). It is curated
rather than exhaustive, it will get some devices wrong, and a parent can
override it. `kidnet infra <mac>` and a one-line UPDATE are the two ways.

## What shipped, and what is still an intention

Shipped and enforced: segment isolation, DNS forcing, DoT and DoH blocking,
the `kids_known` default-deny that closes the static-IP dodge, the safety net
in the firewall, per-category kill, dinner and study modes, time budgets and
the ledger, per-category budgets and metering, per-service byte accounting,
the captive portal and quizzes, device classification, the Tor and darknet
layer, the weekly digest, and the dashboard.

Still an intention, and named as such elsewhere in this file: bedtime
schedules that fire on their own, an alert when an unknown device is refused,
and the alert pass that turns a `tor_dev` counter into a message rather than
just a refused packet.
