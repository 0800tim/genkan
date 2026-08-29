# Going public: what was required, and what is still outstanding

**The repo is now public at github.com/0800tim/hearth.** This file is no longer
a gate; it is the record of what had to be true first, and of the one blocking
item that a public repo makes urgent rather than optional.

A public repo exposes its whole history, not just the current files. That is
why the item below still matters after publication.

## Status (last audited 2026-08-29)

Published. Note that the working copy on the reference box still has no git
remote configured, so pushes from that box are a deliberate act rather than an
accident.

Repo separation, verified:
  kids-network       the intended PUBLIC repo. No commercial content.
  hearth-commercial  PRIVATE. Revenue thinking, session transcripts.
  hearth-site        the marketing site. Separate repo, own decision to make.

Working tree is now genericised: no household MAC, no tailnet address, no main
LAN address, no real children's names. Every name in the repo is invented: most
documents use Ada, Ben and Cleo, `docs/HOUSEHOLD-ROLES.md` uses Robin, Toby and
Elsie, and the public demo's household is Piper, Rangi and Nova. The real names
live only in the database on the family's own box.

`tools/publish.sh` is the scanner that checks this before a push. It was
quietened on 2026-08-29 (it had been failing on the author's name in `LICENSE`,
the `guest-adult` and `guest-kid` role labels, and the MAC-shaped test
fixtures), and with those out of the way it immediately found real example
parent names in the voice documentation. The author's name is now pinned in the
script rather than read from git's `user.name`, allowed only in `LICENSE` and
`DECISIONS.md`, and a hard failure anywhere else.

There is also public surface beyond the repo now: `hearth-demo.appspurt.dev`
and `hearth-portal.appspurt.dev`. Both run the repo's code against an invented
household on its own database, with no docker socket and no `bin/` mounted.
`demo/README.md` lists what stops them reaching anything real.

## Must do (blocking)

- [ ] **Scrub git history of secrets.** STILL OUTSTANDING, and now urgent
      rather than blocking, because the history is public. Current files are
      clean, but history is not. A security review cracked a committed bcrypt hash in under a
      second. Known items in history:
      - The AdGuard dev password `<the dev password>` (commit that added the seed
        config with a real hash). Local-only, but must not ship.
      - The seed placeholder that hashed to `change-me-on-deploy`.
      - The adapter MAC and, earlier, a tailnet IP (noted in DECISIONS).
      Fix: `git filter-repo` to strip the values, or start a fresh public
      repo from a squashed clean tree. Rotate the live AdGuard password on
      the running box afterwards (deploy.sh already generates a fresh one for
      new installs).
- [ ] **Confirm no household values in tracked files.** Run:
      `git grep -nEi 'YOUR_REAL_MAC|100\.101\.|192\.168\.50\.' ` and the
      genericise check. config.env and secrets.env must stay gitignored.
- [ ] **Rotate the live AdGuard admin password** away from the dev value.

## Should do

- [x] Add a SECURITY.md with the responsible-disclosure route (mirrors the
      household bug bounty, but for the open-source project). Done: it points
      at GitHub's private vulnerability reporting.
- [x] Optional dashboard API token (DASH_TOKEN). Done 2026-08-29: unset keeps
      today's tailnet-only behaviour; set makes every /api/* call require the
      secret (injected via a same-origin cookie, never typed). Set it in the
      dashboard unit's Environment= for defence beyond the tailnet perimeter.
- [ ] Tighten the gateway container's input chain so in-namespace services
      (:53, :80, AdGuard :3000) are reachable only from kids0, not the docker
      uplink (defence in depth; isolation from the house already holds).
- [ ] Load a deny-all ruleset before the interface comes up in the entrypoint,
      to close the sub-second window between address assignment and firewall
      load.
- [x] Decide the LLM-agnostic story in docs so "bring your own AI" is real,
      not just Claude. Done: docs/AGENT.md and docs/VISION.md both state the
      contract, which is that any agent able to run shell commands can drive
      the whole surface.
- [ ] Ship a systemd unit for the admin dashboard. It exists only on the
      reference box, so a new family has no supported way to run it. A minimal
      unit to copy is in docs/OPERATIONS.md.
- [ ] Seed the `tasks` table, or a fresh install has no earnable chores at
      all. The INSERT is in docs/DATABASE.md.
- [ ] Add python3 to the gateway image. The entrypoint uses it to read the
      current nft sets, so without it the "has anything changed" comparison
      never matches and both sets are rewritten every fifteen seconds.

## Verified solid (security review, 2026-08-29), with one caveat

**Read the caveat first.** Much of what follows is "covered by tests", and on
2026-08-29 eleven of those isolation assertions were found to be passing without
running: they probed with netcat, a missing netcat exits 127, and a negative
assertion whose probe fails reports PASS. The probes have been moved to bash's
own `/dev/tcp` and the suites re-run (firewall 31/31, container 26/26,
iot-policy 39/39), so the guarantees below are now genuinely tested rather than
merely reported. The claims are the same; the evidence for them is younger than
the review. DECISIONS.md has the detail.


Namespace isolation is genuine (cap_drop ALL, no privileged, no host net,
only eth0 + kids0). The house network, main LAN, tailnet and Postgres are all
unreachable from the island. DNS forcing, DoH/DoT blocks, the static-IP-dodge
fix (kids_known default-deny), the safety net through a cut, and the segment
guard fail-closed are all covered by tests. Portal SQL is parameterised;
quiz grading is server-side and single-shot; earned unblock cannot override a
parent block. Full report: research/security-review-2026-08-29.md.
