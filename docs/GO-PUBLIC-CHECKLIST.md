# Before this repo goes public

Hearth is not pushed anywhere yet. Tim decides when. These MUST be done first,
because a public repo exposes its whole history, not just the current files.

## Status (last audited 2026-08-29)

Nothing has ever been pushed. None of the three repos has a git remote
configured, so a push is not merely disallowed, it is not currently possible
without deliberately adding one. 41 local commits are waiting.

Repo separation, verified:
  kids-network       the intended PUBLIC repo. No commercial content.
  hearth-commercial  PRIVATE. Revenue thinking, session transcripts.
  hearth-site        the marketing site. Separate repo, own decision to make.

Working tree is now genericised: no household MAC, no tailnet address, no main
LAN address, no real children's names (the docs use Ada, Ben and Cleo as
examples; the real names live only in the database on the family's own box).

## Must do (blocking)

- [ ] **Scrub git history of secrets.** Current files are clean, but history
      is not. A security review cracked a committed bcrypt hash in under a
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

- [ ] Add a SECURITY.md with the responsible-disclosure address (mirrors the
      household bug bounty, but for the open-source project).
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
- [ ] Decide the LLM-agnostic story in docs before launch so "bring your own
      AI" is real on day one, not just Claude.

## Verified solid (security review, 2026-08-29)

Namespace isolation is genuine (cap_drop ALL, no privileged, no host net,
only eth0 + kids0). The house network, main LAN, tailnet and Postgres are all
unreachable from the island. DNS forcing, DoH/DoT blocks, the static-IP-dodge
fix (kids_known default-deny), the safety net through a cut, and the segment
guard fail-closed are all covered by tests. Portal SQL is parameterised;
quiz grading is server-side and single-shot; earned unblock cannot override a
parent block. Full report: research/security-review-2026-08-29.md.
