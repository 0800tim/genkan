# Hearth

**Your kids' internet, run from a box in your own house.**

Not a monitoring tool. A **regulator and a teacher**: it helps your family
agree how much is enough, makes that boundary hold without an argument every
night, and lets kids earn their time back by learning something rather than by
pleading.

Filtering you control, and absolutely nothing sent to anyone else. Not to a
cloud service, not to us.

## See it running

Both halves are live, with a made-up family in them. No sign-up, nothing to
install, and nobody's real child:

- **[The parent's dashboard](https://hearth-demo.appspurt.dev)** at
  `hearth-demo.appspurt.dev`. Tonight's state and the controls, live traffic,
  the week, trends per child, the device roster, and the health of the box.
- **[The kid's portal](https://hearth-portal.appspurt.dev)** at
  `hearth-portal.appspurt.dev`. The page a child meets when their time has run
  out, and the quizzes that earn it back. One demo child is deliberately out of
  minutes: pass a round of times tables and watch the clock change.

Both run the real code from this repo, mounted read only against a throwaway
database, so what you are looking at is the actual software rather than a
mockup. Anything you change goes back overnight. The demos hold nothing real:
no household, no device, no firewall (`demo/README.md` explains exactly what
stops them touching anything).

---

## The problem

The screens are winning. Not dramatically, just the ordinary grind: the endless
scroll, one more round, the argument at dinner every night.

So you go looking for help, and the options are grim. The polished parental
control services want a monthly fee and, in exchange, a complete record of
everywhere your children go on the internet. Your router's app is clumsy and
treats an eleven year old and a sixteen year old exactly the same. And nearly
all of it is built around watching your kids rather than helping them.

Meanwhile the actual problem is not really "block bad websites". It is that a
kid can lose four hours to a feed without noticing, and that the tools give you
one blunt lever: internet on, or internet off.

## The idea

Put a small computer next to your router. Any old laptop or mini PC will do.
Everything the kids' devices do goes through it, and it belongs to you.

Because it is yours:

- **Nothing leaves your house.** Their browsing is never uploaded anywhere,
  which means nobody can leak it, sell it, or subpoena it. Not even us. That is
  not a promise you have to trust, it is a consequence of where the software
  runs.
- **You can be surgical.** Turn off Fortnite while homework and Spotify keep
  working. "Dinner" pauses the whole house with one word, then resumes it.
- **Kids earn time instead of begging for it.** Run out of minutes and they get
  a friendly page, not a dead connection: pass a quiz on times tables, world
  flags, the road code or science, and the minutes land immediately.
- **Each kid gets their own rules.** An eleven year old and a sixteen year old
  should not have the same internet. Over-block a teenager and they will simply
  move to mobile data, where you have no visibility at all.

You talk to it in plain sentences from your phone, through whichever AI
assistant you already pay for: *"turn off Ben's gaming"*, *"dinner"*,
*"give Ada thirty more minutes, she did the dishes"*.

## The bit people find surprising

Your teenager will try to get around it. Of course they will.

So there is a **household bug bounty** written into the project. If they beat
the filter and come and show you how, they get paid in screen time and you fix
the hole together. Every level teaches something real: DNS, encrypted DNS, IP
addresses, MAC spoofing, VPNs. It turns the arms race into the most useful
computing lesson they will get all year.

See BUG-BOUNTY.md. It is written to be handed straight to a kid.

## What it honestly cannot do

Every parental control product should have this section and almost none do.

- **It sees domains, not content.** HTTPS means we know a device talked to
  `youtube.com`, never what was watched or typed. Reading inside would require
  installing a certificate on every device and breaking app security. We will
  not do that.
- **It cannot see inside Snapchat, Instagram or Discord messages.** Those are
  end to end encrypted. If bullying is your worry, this is not the tool.
- **It cannot touch mobile data.** A phone on 4G never comes near your network.
  That needs something on the device itself, like Family Link.
- **A determined kid with a VPN can hide their destinations.** We block the
  easy routes and alert you, and the bug bounty turns the attempt into a
  conversation. There is no product on earth that truly stops a motivated
  sixteen year old, and any that claims otherwise is selling something.

## Getting started

You need a computer with two network connections (built-in ethernet plus a USB
ethernet adapter is the usual answer, about NZD 30), and a WiFi access point,
which can be your old router in bridge mode.

Then, roughly:

```bash
git clone https://github.com/0800tim/hearth && cd hearth
./install/omarchy-setup.sh     # host prep, asks which adapter is the kids' side
# then: a Postgres container and the schema, per docs/setup/README.md
sudo ./deploy.sh               # validates, builds, starts the island
```

One step in there is not automated yet: Hearth needs a Postgres container and
its schema loaded, and `deploy.sh` assumes you already have one. The setup
guides walk through it, and it is about four commands.

The honest version: this is a genuinely fiddly networking setup, and that is
exactly why it is built agent-first. Clone the repo, point Claude Code (or
Codex, or Gemini, or whatever you use) at `CLAUDE.md`, and say *"read this and
set up my Hearth gateway"*. It will ask you what it needs. The entire control
surface is one CLI plus plain-markdown runbooks, precisely so an agent can
drive it.

Platform guides live in `docs/setup/`: Omarchy, Debian/Ubuntu, Raspberry Pi
(a Pi 4 or 5 makes a fine gateway) and generic Linux.

**The Switcheroo.** Migrating a houseful of devices sounds miserable, so there
is a trick that avoids it entirely: give the new filtered network the same name
and password as your old one, and every device reconnects to it on its own,
noticing nothing. `docs/playbooks/the-switcheroo.md`.

---

# For the technically minded

Everything below is the detail. If you are evaluating whether this is sound
rather than whether it is useful, start here.

## Architecture

The gateway runs in a Docker container with **its own network namespace**,
holding exactly two interfaces: an ordinary bridge uplink, and the physical
second NIC handed in by a small host-side warden. The firewall, DHCP, DNS and
the kids' portal all live in that namespace with `NET_ADMIN` and `NET_RAW`
only, never privileged, never host networking.

That structure is the safety argument. A mistake in the firewall rules can take
the kids' network down. It cannot touch the host's firewall, your main LAN or
your VPN, because **those interfaces do not exist inside the container**. That
is a stronger guarantee than careful rule review, and there is a packet-level
test suite that proves it rather than asserting it.

Postgres holds the desired state. The firewall is a projection of it,
reconciled every fifteen seconds, so a container restart or a USB replug cannot
silently forget that a child is switched off.

```
internet
   |
your router                     (untouched, your own devices stay here)
   |
Hearth box  eth0 --------------- uplink
            kids0 -------------- the kids' island, 192.168.60.0/24
                                   |
                            access point (bridge mode)
                                   |
                            phones, tablets, consoles
```

## How the per-category control actually works

This is the part people ask about, because blocking "gaming" without blocking
homework sounds impossible when everything is encrypted.

The gateway is the DNS server. So when a device resolves `googlevideo.com`, we
learn that those addresses are video, for that device, right now. The firewall
then counts and controls traffic **by destination address**, without decrypting
anything. That is how Fortnite can stop while Spotify and Google Docs keep
working, and how the dashboard can report real bytes per service rather than a
guess.

Honest caveats, also stated in the UI: services sharing a CDN blur together,
YouTube Music counts as YouTube, Shorts cannot be separated from YouTube, and a
VPN defeats the categorisation entirely.

## More than a kid monitor: the household layer

The same box is a household gateway, and the smart home is the other half of
the job. Every device is classed as personal, smart home or infrastructure, and
each smart device gets a policy written in terms of **who may start the
conversation**.

The case that shapes it: a security camera must keep pushing video out to its
manufacturer's cloud, because that is what makes a stolen camera still have
footage of the thief. So the camera may start a conversation with its vendor
and with nothing else. Nothing on the internet may start one with the camera.
The camera may not start one with your laptop, your phone or the robot vacuum.
And your own phone may still start one with the camera, because a security
control that breaks the camera app is a security control a household turns off.

Locks and vacuums get the same shape. Speakers get the ordinary internet,
because pinning an Echo to a domain list produces a broken speaker. Every
default is a database row a parent can override for one device.

It ships in observe mode, where every rule that would refuse traffic is a
counter instead, so you can see exactly what enforcing would break before you
commit. `docs/HOUSEHOLD-SECURITY.md` has the model, how to switch it on, and
the limits: a vendor on a big shared CDN cannot be pinned tightly, a
compromised device that only talks to its vendor is still compromised, and two
devices on the same access point can talk without the gateway ever seeing it
unless client isolation is on.

## The stack

| Layer | What |
|---|---|
| Firewall, NAT, isolation | nftables, inside the container namespace |
| DHCP, DNS, filtering | AdGuard Home, per-child clients by age tier |
| State, logs, ledger | Postgres |
| Control surface | `bin/kidnet`, a single CLI any agent can drive |
| Parent dashboard | Node, on your private network, charts in inline SVG |
| Kids' portal | Node, the captive portal and quiz engine |

## Safety properties worth knowing

- **Segment guard.** Before serving anything, the gateway listens on the wire.
  If another DHCP server is already there, it refuses to start and tells you,
  rather than fighting your real router. It fails closed.
- **The safety net.** NZ youth help lines (1737, Youthline, Kidsline) and
  schoolwork stay reachable *even when a child is fully cut off*, at bedtime,
  and when they are out of time. Enforced in the firewall, not just intended.
- **Smart home is separate.** Cameras, locks and speakers are classified apart
  from personal devices and are never cut when you pause the kids. Nobody's
  front door lock goes offline at bedtime.
- **A camera can push out, and nothing can reach in.** The household policy
  layer pins a camera, lock or vacuum to its own vendor's cloud, so remote
  recording and the theft backup keep working, while the internet cannot start
  a conversation with it and it cannot roam your network. Off by default, with
  an observe mode so you can see what it would do first.
- **Self-harm is a care signal, never a punishment.** It alerts you and never
  routes to a blocking page.

## Tests

Seven suites, a hundred and seventy checks, all packet-level or database-level,
no mocks:

```bash
sudo test/firewall-test.sh      # 31  the ruleset, in throwaway namespaces
sudo test/container-test.sh     # 26  the real image, containment proven
sudo test/iot-policy-test.sh    # 39  the household IoT policy, real packets
sudo test/meter-test.sh         #  8  time budgets and category enforcement
sudo test/service-meter-test.sh #  5  per-service byte accounting
sudo test/roles-test.sh         # 51  who each scoped control reaches, and who it does not
ADGUARD_PASS=... test/adguard-test.sh   # 10  the DNS layer, against a live AdGuard
```

The container suite asserts, among other things, that a static IP outside its
reservation gets no internet, that the island cannot reach the main LAN or the
VPN range, that hardcoding 8.8.8.8 still lands on our resolver, and that the
help lines survive a cut.

## Documentation map

| Read this | For |
|---|---|
| `CLAUDE.md` | what to point your AI agent at first |
| `docs/setup/` | platform guides: Omarchy, Debian, Raspberry Pi, generic |
| `docs/AGENT.md` | the plain-sentence command surface |
| `docs/CLI.md` | every command, its arguments and what it really does |
| `docs/OPERATIONS.md` | health checks, timers, logs, troubleshooting, backups |
| `DECISIONS.md` | every design decision and why, including the mistakes |
| `PLAN.md` | topology and the limits of network monitoring |
| `METERING.md` | how per-category time measurement works |
| `docs/DATABASE.md` | the schema, the load order, the two connection strings |
| `docs/reporting.md` | the weekly family digest, and how to schedule it |
| `docs/tor-and-safety.md` | the Tor and darknet layer, and its honest limits |
| `docs/HOUSEHOLD-SECURITY.md` | what each camera, lock and gadget may talk to, and why |
| `docs/HOUSEHOLD-ROLES.md` | children, adults and guests: who each control reaches, and who it never does |
| `BUG-BOUNTY.md` | the household bug bounty, written for kids |
| `docs/playbooks/` | the Switcheroo and other practical guides |
| `integrations/omarchy/` | the Omarchy desktop integration: a status bar item and a menu |
| `demo/README.md` | the two public demos, and what makes them inert |
| `RECOMMENDATIONS.md` | age-tiered policy and what to do beyond on/off |
| `ROADMAP.md` | what is built, what is half built, and where to help |
| `CONTRIBUTING.md` | what a change must not weaken |
| `SECURITY.md` | reporting a bypass or a vulnerability |
| `CONTRIBUTING.md`, `SECURITY.md` | how to help, and how to report a hole |

## Who made this, and why

I am Tim Thomas, and I have three kids, aged 11, 14 and 16.

This started the way most of these things start. The screens were winning. Not
in a dramatic way, just the ordinary grind: the endless scroll, one more round,
the argument at dinner. I went looking for something to help and did not like
what I found. The good parental-control services want a subscription and, in
return, a copy of everywhere your children go on the internet. The router apps
are clumsy and treat every child the same. Almost all of it is built to watch
kids rather than to help them.

So I built the thing I actually wanted: a box by the router that belongs to me,
where the filtering is mine, the logs never leave the house, and my kids can
earn their screen time by learning something rather than begging for it. It
runs on my own family first. Every decision in here was made under the pressure
of three real children who are smarter than the software and quite willing to
prove it, which is why there is a bug bounty in the repo rather than a pretence
that they cannot beat it.

There is nothing to buy, and no company behind it looking for a return. It is
MIT licensed because a tool that shapes how children use the internet should
not depend on anyone's subscription staying current, and because the only
honest answer to "how do I know you are not monetising my kids' browsing" is:
read the code, it runs on your hardware, and it never sends anything anywhere.

### Help me build it

I would genuinely like company on this. It is a family problem dressed up as a
networking problem, and it will get better fastest with people who know things
I do not.

Particularly welcome:

- **Parents who self-host.** You already run things at home. Try it, tell me
  where it is annoying, tell me what your kids did to get around it.
- **Linux and distro people.** It is Docker and standard tooling underneath, so
  it should run anywhere. Packaging, hardening and making the setup less fiddly
  are all wide open.
- **Teachers and tutors.** The quiz banks that kids earn time from are plain
  JSON files, and each question can carry a difficulty from 1 to 5 so a round
  opens with warm-ups and gets harder as the kid goes. Your own agent can write
  one on any topic in a few minutes (docs/runbooks/quiz-on-demand.md). If you
  know how to teach a subject well, a good bank is worth more than any feature
  I could write.
- **Anyone who can break it.** Especially the filter bypasses. Found one? Open
  an issue. That is the whole spirit of the household bug bounty, scaled up.

Start with CONTRIBUTING.md, or just open an issue and say hello.

Sibling project: [unrot](https://github.com/0800tim/unrot), earn screen time by
learning.
