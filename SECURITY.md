# Security policy

Hearth sits between children and the internet, and it holds a record of the
domains their devices visit. Getting security wrong here is not an abstract
problem, so please tell us when we have.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Use GitHub's
private vulnerability reporting on this repository (Security tab, "Report a
vulnerability"), which reaches the maintainer directly.

Tell us what you found, how to reproduce it, and what an attacker gets. A
proof of concept is welcome but not required, and please do not test against
anyone's household but your own.

You can expect an acknowledgement within a few days, an honest assessment of
severity, and credit in the fix unless you would rather stay anonymous.

## What counts

Things we would very much like to hear about:

- **Escaping the island.** Any way a device on the kids' network reaches the
  main home network, the host, or a VPN range. The containment guarantee is
  the foundation everything else rests on.
- **Bypassing the filter or the time limits.** Reaching blocked categories, or
  getting internet while switched off or out of time. We know a VPN defeats
  categorisation, that is documented, but novel routes are interesting.
- **Defeating the safety net**, or any way to make the youth help lines
  unreachable. We treat that as high severity regardless of how it is done.
- **Reading another child's data**, or a child granting themselves time.
- **Anything that gets code execution** on the gateway, or escapes the
  container.

Known and documented limitations are in the README under "What it honestly
cannot do". Those are design boundaries rather than vulnerabilities, though we
are happy to discuss whether a boundary is in the right place.

## For families: the household bug bounty

If the person who found the hole is your own teenager, that is the point. See
BUG-BOUNTY.md: the house rule is that finding a bypass and showing a parent
earns a reward, and quietly using it does not. If they find something that
affects everyone, please pass it on here and we will credit them.

## Our commitments

- No telemetry, ever. Hearth does not phone home, so there is no central store
  of anyone's browsing to breach.
- Secrets stay out of the repository. Configuration with real values lives in
  gitignored files, and the shipped configuration contains placeholders only.
- Security fixes land before features.
