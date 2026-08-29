# Recommendations: things worth doing (some you didn't ask for)

Kids are 11, 14 and 16. That spread matters: the same filter for all three
is wrong. Below is what I'd build in, flagged by priority. Nothing here is
deployed yet; it's the design we execute once the island is cabled.

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

- Force all DNS through clawdia; block DoT (853) and DoH endpoints. [done in nft, tested]
- Segment isolation so they can't reach the main LAN. [done in nft]
- Log/alert on an unknown device joining the island, or a device using an
  IP that isn't its reservation (static-IP dodge).
- Block known VPN/proxy domains (category proxy-vpn) to stop trivial
  filter-bypass. Cat-and-mouse, but covers the easy 90%.

## 4. Controls beyond a blunt on/off

- **Per-category kill:** "kill Ben's gaming" blocks Steam/Epic/Roblox/
  Fortnite/consoles while the rest of his internet stays on. [in kidnet]
- **Dinner / family pause:** one word pauses all kids, then resume. [in kidnet]
- **Time budgets / quotas**, not just schedules: X minutes/day per kid.
- **Homework window:** education domains always allowed even during a cut.
- **Temporary grants:** "give Cleo 30 more minutes", auto-expiring.

## 5. Schedules

- School-night vs weekend bedtimes, per kid (15-min-slot granularity, the
  jonas5 model). Auto-off at bedtime, auto-on in the morning, via timers.

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
  touch the main network where clawdia and all client work live. [nft isolation]
- Guest policy = adult/malware/VPN filtering only, no schedules, no
  per-person logging. [guest tier seeded]

## 8. Reporting

- Weekly per-kid summary to you: hours online, top domains, any flagged
  categories. Keeps it a conversation, not a spy report.

## 9. Honest limits (unchanged, worth repeating)

- Network sees DOMAINS, not encrypted page content. In-app bullying
  (Snapchat/Insta/Discord DMs) is invisible here; that needs a consenting
  app tool (e.g. Bark) or platform supervision.
- Mobile data never touches this network. Google Family Link is the only
  lever for the 14/16yo's cellular. Pairs well with this, doesn't overlap.

## 10. Open-source hardening (before publishing)

- Split Tim's live values (NIC MAC, SSID, subnet) into config.env; ship
  config.env.example only. [example added]
- Keep secrets.env gitignored. [done]
- README/QUICKSTART for other parents; MIT like unrot. [licence added]

## 11. Time budgets, bonus time + captive portal (built 2026-08-27)

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

## Deploy-time wiring still to do (when the island is cabled)

- Per-IP nftables byte counters so the meter senses real activity (not just
  last_seen).
- AdGuard: when a kid is blocked/out-of-time, answer their DNS with the portal
  IP; redirect their :80 to the portal; let allowed kids' OS probes get their
  normal 204 so no false portal.
- Enable kids-meter.timer and the portal on 192.168.60.1:80.
