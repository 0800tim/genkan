# Copy-and-paste prompts: the whole build, one prompt at a time

Genkan has no installer, and this file is the honest answer to that. There is
no `curl | sh` that turns a spare PC into a family gateway, because the job is
genuinely a network build: two interfaces, a container namespace, a firewall, a
DHCP scope, a database. What there is instead is a repo written for a machine to
read, and an agent that can do the work while you supervise.

So the trade is stated plainly. **An evening of your attention instead of a
subscription, and the hard part is your agent's job.** Below are twelve
prompts, in order, from a blank USB stick to a working island and a first week
that actually settles, plus two more to keep for afterwards: one for when
something breaks, and one that audits your agent's own work.

## How to use this file

- Work top to bottom. Each prompt assumes the one before it finished.
- **Each prompt is self-contained.** Paste it into a fresh agent session and it
  will still work: every one names the files the agent must read first.
- Anything in `<angle brackets>` is yours to fill in before pasting.
- Every prompt ends with a stop condition. That is deliberate. An agent that
  stops and asks is doing the right thing on a box that becomes your family's
  only route to the internet.
- After each prompt there is **What you should see** and **If it looks wrong**.
  Read those before you decide whether it worked.

## Which agent

Any agent that can run shell commands and read files. Claude Code is what
Genkan is developed with, so it is the smoothest path; Codex, Gemini CLI and a
local model all work, because the whole control surface is a plain CLI plus
plain Markdown. Bring the subscription you already pay for.
[../AGENT.md](../AGENT.md) covers talking to it once the box is running.

## What you cannot hand to an agent

Two things, and it is fair to know them up front.

1. **Physical work.** Plugging the USB adapter in, cabling the access point,
   flashing the USB stick. Prompt 1 runs on your everyday computer, not the
   gateway.
2. **Root, on most boxes.** `deploy.sh` and the test suites need `sudo`. If sudo
   asks for a password, the agent cannot run them unattended and will stop and
   ask you to run the command or type the password. That is correct behaviour,
   not a failure.

---

## Prompt 0: decide the hardware, before you buy or dig anything out

Run this one on **your everyday computer**, in any chat AI, or in an agent
opened on a clone of the repo. It costs nothing and saves the most common
wasted evening.

```
I want to build a Genkan gateway (github.com/0800tim/genkan): a self-hosted
family internet gateway on a spare Linux box.

Here is what I have available:
  <list every candidate machine: model, CPU, RAM, how many ethernet ports,
   whether it has wifi, and whether it is currently doing anything else>
My internet is <e.g. 300/100 fibre> and there are <N> people in the house
with roughly <M> devices between them.

Read docs/HARDWARE.md in the Genkan repo (or fetch it from
https://github.com/0800tim/genkan/blob/main/docs/HARDWARE.md) and tell me:
1. Which of my machines is the best gateway, and why.
2. Whether it needs a USB ethernet adapter, and exactly which chipset to buy.
3. Which of my choices are combinations the project has actually tested and
   which are inference. Say which is which. Do not smooth over the difference.
4. What I am missing from the shopping list.
Then stop. Do not tell me how to install anything yet.
```

**What you should see.** A named machine, a yes or no on the adapter, and a
clear split between "this has been run" and "this should work". If the answer
recommends the Pi 3 for a gigabit household, or a machine with one ethernet
port and no plan for a second interface, push back.

**If it looks wrong.** The most common bad answer is an agent that does not
mention the second network interface at all. Ask it directly: *"what is the
second network interface in this plan, and has that exact combination been
tested?"*

---

## Prompt 1: flash the operating system

Run this on **your everyday computer**, with the USB stick plugged in. The
gateway box does not exist yet.

```
I am building a Genkan gateway on <describe the box: e.g. a 2016 ThinkCentre
M710q, or a Raspberry Pi 5 with 8GB>. I need to install Linux on it from this
computer, which runs <macOS / Windows / Linux>.

Walk me through, one step at a time, waiting for me after each:
1. Which distribution to use for this box, given that Genkan needs Docker,
   systemd and 64-bit. Raspberry Pi OS Lite 64-bit for a Pi; Debian 12+ or
   Ubuntu Server 22.04+ for a PC; Omarchy if I want the agent-first setup.
2. Where to download the image and how to check I got the right one.
3. How to write it to the USB stick or SD card safely, and how to be sure I
   am writing to the stick and not to my own hard drive. Show me the exact
   command or tool, and make me confirm the device before anything is written.
4. What to set during the installer or the imager's customisation: hostname
   (use "genkan"), a user account, SSH enabled with my key if I have one, and
   on a Pi the wifi COUNTRY setting even if I am not using wifi.
5. Do NOT join the box to my house wifi. Its uplink is an ethernet cable.

Stop before first boot and tell me exactly what to plug in where.
```

**What you should see.** A named image file, a checksum check, one write
command with the target device spelled out, and a pause before it runs. The
step that matters most is step 3: the agent should make you confirm the target
device before writing.

**If it looks wrong.** If it offers to run `dd` without naming the device and
waiting, stop and say *"do not run that yet, list my disks and tell me which
one is the USB stick"*. If it suggests a desktop distribution, ask for the
server or Lite variant instead: this box is an appliance, not a computer you
will sit at.

---

## Prompt 2: first boot, and the base packages

SSH into the box. Run your agent **on the box**, not on your laptop.

```
This machine is going to become a Genkan gateway (a self-hosted family
internet gateway). Right now it is a fresh <distro> install and nothing has
been done to it.

Prepare the host, and only the host. Do not clone anything yet.
1. Tell me what this box is: distro and version, kernel, architecture, CPU,
   RAM, disk, and every network interface with its MAC, driver and whether it
   has a carrier. Show me that list before you change anything.
2. Bring the system up to date.
3. Install: git, curl, openssl, nftables, and Docker Engine with the compose
   plugin. Use Docker's official installation for this distro, not a snap.
   The Docker snap breaks the network namespace handover Genkan relies on.
4. Enable Docker at boot, and add me to the docker group.
5. Set net.ipv4.ip_forward=1 persistently in /etc/sysctl.d/99-genkan.conf.
6. On a Raspberry Pi only: enable the memory cgroup by appending
   "cgroup_enable=cpuset cgroup_enable=memory cgroup_memory=1" to the single
   line in /boot/firmware/cmdline.txt, and tell me it needs a reboot.
7. If this is a laptop, make it ignore the lid and never suspend.

Show me every sudo command before you run it. When you are done, print
"docker version", "docker compose version" and the interface list again, then
stop.
```

**What you should see.** `docker version` reporting both a client and a server,
`docker compose version` reporting v2 or later, and an interface list that
names your uplink. `nftables` on the host is only there so `deploy.sh` can
validate the ruleset before building; the live firewall runs inside the
container and never touches the host's.

**If it looks wrong.** If `docker version` shows a client but no server, Docker
is not running: `sudo systemctl enable --now docker`. If group membership has
not taken effect, log out and back in. If the agent installed the Docker snap
on Ubuntu, have it remove the snap and install from get.docker.com instead.

---

## Prompt 3: clone the repo, and work out the two interfaces

This is the step everybody gets wrong, so it gets its own prompt.

```
Clone https://github.com/0800tim/genkan.git into ~/genkan and read, in this
order: CLAUDE.md, docs/setup/README.md, and the platform guide that matches
this box (docs/setup/raspberry-pi.md, docs/setup/debian-ubuntu.md,
docs/setup/generic-linux.md or docs/SETUP-OMARCHY.md). Also read
docs/HARDWARE.md.

Then do the interface work and nothing else:
1. List every network interface with its MAC, driver, speed and carrier
   state. Tell me which one is the uplink to my house router (the one with
   the default route) and which one you propose as the kids' side.
2. If there is no second wired interface, say so plainly and stop. Do not
   invent one and do not silently fall back to the wifi topology: tell me
   what I have to plug in or which topology I have to choose deliberately.
3. Copy config.env.example to config.env and set KIDS_NIC_MAC to the kids'
   interface MAC and UPLINK_IFACE to the uplink's interface name. Set
   GENKAN_TZ to <your IANA timezone, e.g. Pacific/Auckland> and KIDS_SSID to
   <the name you will give the kids' wifi>. chmod 600 config.env.
4. Make this host's network manager leave the kids' interface alone: a
   NetworkManager drop-in matching that MAC, or a systemd-networkd
   Unmanaged=yes file, whichever this box actually uses. Reload it and prove
   it worked (nmcli device should say "unmanaged", or networkctl should show
   it unmanaged).
5. Copy secrets.env.example to secrets.env, chmod 600, and leave the DB URLs
   for the next step.

Do not run deploy.sh. Do not touch the uplink. Show me config.env when you
are done, and stop.
```

**What you should see.** Two interfaces named, the kids' one reported as
`unmanaged`, and a `config.env` with a real MAC in it. On a box with an ASIX
or Realtek USB adapter you should see the driver named (`ax88179_178a` or
`r8152`).

**If it looks wrong.** If the agent cannot decide which interface is which,
unplug the USB adapter, run `ip -o link show`, plug it back in, run it again,
and give the agent both outputs. The one that appeared is the kids' side. If
`nmcli device` still shows the interface as `connected` rather than
`unmanaged`, the MAC in the drop-in is wrong (it must be lower case) or
NetworkManager was not reloaded.

**The thing to guard against.** An agent under pressure to finish will
sometimes pick the uplink as the kids' side. If it does, your house loses the
internet the moment the warden hands that NIC to the container. Read step 1's
answer properly before you say yes.

---

## Prompt 4: the database

This is the one step no script in the repo does for you, and the guides say so.
It is worth its own session because getting the load order wrong is annoying to
unpick.

```
Read docs/DATABASE.md and the "The database" section of docs/setup/README.md
in ~/genkan, and read config/db/load.sh, before you touch anything.

Provision Genkan's database on this box:
1. Check whether a Docker container named "postgres" on a Docker network
   named "postgres" already exists. If it does, use it and tell me what it is
   already being used for. If it does not, create the network and a
   postgres:16 container per the setup guide, with a persistent volume and a
   password you generate.
2. Create the kids_app role with LOGIN and a long password you generate, THEN
   create the kids_network database. The role must exist before the schema
   files run, because several of them end with GRANT statements that fail
   otherwise.
3. Load the schema by running config/db/load.sh, not by loading files by
   hand. That script is the authoritative order: the table in docs/DATABASE.md
   drifted out of date once already and a fresh install failed on the first
   two files. Run it, show me its output, and stop if any file reports FAILED.
4. Set KIDS_DB_URL and KIDS_DB_URL_DOCKER in ~/genkan/secrets.env. The first
   is how the host sees Postgres, the second is how a container on the
   postgres network sees it.
5. Prove it: list the tables, and show me the rows in the "policies" table
   and the "children" table.

Stop and show me the output of steps 3 and 5.
```

**What you should see.** `load.sh` printing `loaded` for every file and a final
count, then three policy tiers (`young`, `standard`, `teen`) and three
placeholder children named `child-11`, `child-14` and `child-16`. Those
placeholders are meant to be there. You replace them in prompt 8.

**If it looks wrong.** Load into an **empty** database. The individual files are
idempotent but the set is not: running the whole set twice over an existing
database can leave a view narrower than the last file expected, and you will see
an error about dropping columns from a view. If a single file reports FAILED,
read the error rather than re-running: it usually names a missing earlier file.

**Why this prompt insists on the script.** The comment at the top of
`config/db/load.sh` says it plainly: a documented list drifts, a script does
not, because the script is the thing that runs. If an agent offers to load the
files from the doc's table instead, decline.

---

## Prompt 5: deploy, and prove it before you believe it

```
Read ~/genkan/deploy.sh in full, and docs/setup/README.md's "Deploy and prove"
section, before running anything.

1. Tell me, in your own words, everything deploy.sh is about to do to this
   host: what it installs, which systemd units it enables, and what it leaves
   installed but disabled. I want to know the host-side footprint before I
   agree to it.
2. Confirm config.env has KIDS_NIC_MAC and secrets.env has both DB URLs, and
   that the postgres container is running. deploy.sh needs all of that.
3. Run: sudo ./deploy.sh
   If sudo needs a password, stop and tell me, and I will run it.
4. Then verify, and show me the output of each:
     docker ps
     docker logs genkan-gw | tail -30
     systemctl status kids-nic-warden
     genkan status
     genkan allow-status
5. Then run the proof: sudo test/container-test.sh
   Every check must pass. If any check fails, stop, show me the failure, and
   do not attempt a workaround. A failing check here is a real finding.

Do not weaken anything in config/nftables/kids.nft to make a test pass. If a
test fails, that is information, not an obstacle.
```

**What you should see.** Containers `genkan-gw`, `genkan-adguard` and
`genkan-portal` up; the gateway log reporting the segment guard verdict and the
firewall loading; the NIC warden active with a handover in its journal; and
`genkan allow-status` listing addresses rather than nothing. `container-test.sh`
prints its own pass count at the end, and all of them have to pass.

`deploy.sh` also generates your AdGuard admin password on first run and writes
it into `secrets.env`. That file is gitignored and stays on this box.

**If it looks wrong.**

- **"segment guard" refusing to start the island.** This is the guard doing its
  job, not a bug. Something else is talking on the kids' wire: nearly always an
  access point still bridged to your house LAN or still running its own DHCP.
  Fix the access point (prompt 6), do not disable the guard.
- **The warden never hands the NIC over.** The MAC in `config.env` does not
  match. `journalctl -u kids-nic-warden` prints what it is looking for.
- **`genkan` says "permission denied" against the database.** The
  `config/db/grants.sql` step warned rather than failed. `docs/DATABASE.md` has
  the fix, and re-running `deploy.sh` repairs it.
- **`allow-status` is empty.** The safety net is not loaded, and that is the one
  thing that must never be broken: those are the youth help lines. Do not put
  a child on this network until it is populated.

---

## Prompt 6: the access point, and the first device on the island

Physical step, then a check. The access point is the second thing everybody
gets wrong.

If you are using a spare Huawei HG659 (the gateway several New Zealand ISPs
handed out for years, so there is often one in a drawer), there is a step by
step guide for that exact model, including which port is which:
[ap-hg659.md](ap-hg659.md). It ends with `genkan ap-check`, which proves the
result from the box. The seven steps in it work on almost any old router.

```
The island is deployed. Now the wifi.

Talk me through, one step at a time:
1. What I have to do to my access point before I plug it in: factory reset,
   Access Point or bridge mode, its own DHCP server OFF, and no connection to
   my main LAN of any kind. Explain why each one matters, briefly.
2. Which cable goes where: my router to the uplink, and the kids' interface
   to the access point.
3. After I plug it in, watch "docker logs -f genkan-gw" with me and tell me
   what the segment guard says. If it refuses the wire, tell me exactly what
   it heard and what that means about my access point.

Then, once it serves:
4. I will join a phone to the kids' wifi. Confirm from the box that it got a
   lease (genkan leases), that it appears as a device (genkan devices), and
   tell me its address.
5. On the phone I will check: the internet works, the portal loads at
   http://192.168.60.1, and an obviously adult domain is blocked. Tell me
   what to type and what a working answer looks like.

Do not change any firewall rule to make step 5 pass.
```

**What you should see.** A `192.168.60.x` lease, working internet on the phone,
the kid portal on the gateway address, and a blocked domain landing on the
portal rather than timing out.

**If it looks wrong.** A phone that joins the wifi but never gets an address is
the classic symptom, and the chain to walk is in your platform guide's
troubleshooting section. In order: is `kids0` inside the container, did AdGuard
restart after the handover (the warden does that about twenty seconds later), is
the access point secretly still serving DHCP, and on a host-side bridge topology
is `ufw` eating the DHCP broadcasts.

---

## Prompt 7: the admin dashboard on your own private network

Worth knowing before you start: **the dashboard's systemd unit is deliberately
not installed by `deploy.sh`.** Where it binds is household-specific, and
getting that wrong publishes a panel that can switch a child's internet off.
There is an example unit in the repo and you adapt it.

```
Read docs/OPERATIONS.md, the section on the admin dashboard, and
config/systemd-user/genkan-dashboard.service.

I want the parents' dashboard reachable from our phones and nowhere else.
1. Explain my options for that, and be honest about the trade-offs. I am
   considering Tailscale.
2. Set up whichever I choose, then copy the example user unit to
   ~/.config/systemd/user/, fix the paths, and set BIND to the private
   address only. It must NOT bind 0.0.0.0.
3. Enable lingering so it survives a logout, start it, and prove what it is
   bound to with "ss -ltnp".
4. Tell me the URL, and tell me plainly what would happen if I got the bind
   address wrong.
```

**What you should see.** `ss -ltnp` showing the dashboard bound to one private
address on port 8899, not `0.0.0.0` and not your LAN address.

**If it looks wrong.** If it is bound to `0.0.0.0`, stop and fix it before you
do anything else. The dashboard can turn a child's internet on and off.

---

## Prompt 8: name the people and the devices

The placeholder children from the seed are still in the database. This replaces
them with your family.

```
Read docs/CLI.md, the "Who you can name", "Devices and people" and
"Household devices" sections, and docs/HOUSEHOLD-ROLES.md.

Our household:
  <name>, age <n>
  <name>, age <n>
  <name>, age <n>
  Adults: <names>

1. Explain the three policy tiers (young, standard, teen) from the seeded
   policies table and recommend one per child based on their age. Tell me
   what each tier actually blocks and what daily budget it carries, so I am
   choosing rather than accepting a default.
2. Add each real person with "genkan person add <name> <role> [tier]".
3. The seed left placeholder children called child-11, child-14 and child-16.
   Tell me how to remove them. Note that genkan has no delete: removing a
   person is done on the dashboard's Family page, and it deletes their time
   ledger and usage with them.
4. Run "genkan devices" and "genkan unassigned" and show me the list. For
   each unassigned device, tell me its vendor and hostname so I can work out
   whose it is, then assign it with "genkan assign <mac> <person> <label>".
5. Anything that is not a person's device: mark infrastructure (the access
   point, the switch) with "genkan infra", and tell me which devices you
   think are smart home kit rather than personal, and why.
6. Then show me "genkan status" and "genkan time" for the whole house.

Never guess whose device something is. Bring me the vendor, the hostname and
the address, and let me say.
```

**What you should see.** Every device with an owner or a deliberate
classification, and `genkan time` printing one line per child.

**If it looks wrong.** Devices classified `personal` are the only ones that
group controls reach, so a camera wrongly marked personal will go dark at
dinner. A personal device wrongly marked IoT will never be time limited. Check
the classifications before you rely on them.

**A note worth taking seriously.** Naming a device is the parent's call, and it
is meant to be. The agent should never confirm a child's own device claim on
its own initiative.

---

## Prompt 9: the Switcheroo

This is the twenty minutes that saves you an argument with every device in the
house. Read [../playbooks/the-switcheroo.md](../playbooks/the-switcheroo.md)
first, including its honest section.

```
Read docs/playbooks/the-switcheroo.md in full, including "The honest part".

My current house wifi is called "<old SSID>". I want to do the Switcheroo:
1. Explain the swap back to me in your own words, and tell me the two things
   it does NOT do, so I am not fooling myself about what I have built.
2. Give me the order of operations for tonight: what I rename first, what I
   set the new access point to, and what I should expect to happen to each
   category of device.
3. Draft a short, plain message I can actually say to my kids about this. Not
   a policy document. Something a 14-year-old will hear as respect rather
   than as a gotcha. It should say the network is filtered and time managed,
   why, what it can see (domains) and what it cannot (inside their messages),
   and that there is a bug bounty for finding holes in it.
4. Then watch with me: "genkan leases" and "genkan unassigned" as devices
   roll in, and help me name each one.

Do not suggest keeping this secret from them. The playbook explains why.
```

**What you should see.** Devices reconnecting themselves over the following
hour, appearing in `genkan unassigned` as they arrive.

**If it looks wrong.** Devices that never reconnect are usually holding the old
router's network in range. The rename has to be a real rename, and the new
access point has to carry the old name and the old password exactly.

---

## Prompt 10: the first week

Do not tune anything on night one. Watch for a week, then tune with evidence.

```
Read docs/reporting.md, LEARN-TO-EARN.md and METERING.md.

Genkan has been running for a week. Help me review it, and be honest rather
than encouraging:
1. Run "bin/genkan-report all last" and walk me through it, one child at a
   time. Tell me what is actually notable and what is just noise.
2. Show me "genkan topsites" and anything in the alerts table. For any
   self-harm category flag, tell me plainly that it is a care conversation
   and not a discipline one, and do not bury it in a list.
3. Tell me where the time budgets are wrong: who is hitting the wall every
   day and who never gets near it. Recommend changes and tell me the command,
   but do not make the change until I say so.
4. Show me "bin/genkan-quiz stats" per child: what they have passed, what
   they are failing, and where a bank is too easy or too hard.
5. Tell me one thing that is not working the way the docs claim it should.

Do not recommend narrowing the safety net or the reading list. Those are
deliberately reachable when a child is out of time, and a child still being
online because of them is the design, not a bug.
```

**What you should see.** A week of real usage, a couple of budget numbers that
are obviously wrong, and at least one thing you had assumed that turns out not
to be true.

**If it looks wrong.** If the report is empty, the timers are not running:
`systemctl list-timers 'kids-*'` should show the meter, metering, services,
devicescan, dnslog and schedule timers all with a recent last-run. The one
timer `deploy.sh` installs but deliberately leaves off is `kids-iot-policy`:
the household IoT layer is switched on by a parent who has read
docs/HOUSEHOLD-SECURITY.md first, not by a deploy.

---

## Prompt 11: quiz banks for your kids specifically

Optional, and the most rewarding part once the network side is boring.

```
Read docs/runbooks/quiz-suggestions.md, docs/runbooks/quiz-on-demand.md and
portal/quizzes/FORMAT.md.

Run "bin/genkan-quiz-suggest <kid>" and use the briefing to write one new
quiz bank aimed at them: <subject or interest>, for age <n>.

Rules, from CONTRIBUTING.md's section on what makes a good bank:
- Every question needs an explanation written for the child who got it
  WRONG. Give the reason, not a restatement. One or two sentences. Never
  scold, never say "obviously" or "simply".
- Wrong answers must be plausible: use the mistake a child actually makes.
- Label every question with a difficulty 1 to 5, relative to the target age.
- Forty or more questions so a round is not the whole bank.
- NZ English, correct macrons on any te reo Maori.

Validate with "node tools/validate-quizzes.mjs", then install with
"bin/genkan-quiz install <file>".

Then print every question and answer for me to check. I have to fact check
every answer myself before my kids are paid screen time for it.
```

**What you should see.** A bank that validates, installs, and appears in
`bin/genkan-quiz list` with a difficulty spread rather than `flat`.

**If it looks wrong.** `install` refuses anything that does not validate, and
re-validates the whole directory afterwards, pulling the file back out if the
set no longer passes. That is working as intended. And check the answers
yourself: a wrong answer in a bank takes minutes off a child for being right.

---

## When something breaks later

Keep this one. It is the prompt you will use most after the first week.

```
Something is wrong with our Genkan gateway.

What I am seeing: <describe it in plain words, including which device, which
person, and when it started>

Read docs/OPERATIONS.md and work the list top to bottom. Tell me what you are
checking and what you find at each step before moving on. Do not change
anything until you have told me what you think is wrong and I have agreed.

If the fix involves weakening segment isolation, DNS forcing, the segment
guard, or the safety net, stop and tell me instead. Those four are never the
fix.
```

---

## And one to keep your agent honest

Run this a few days in, ideally with a **different** agent from the one that
did the build.

```
This box was set up as a Genkan gateway by an AI agent. I want a second
opinion on its work.

Read CLAUDE.md, docs/setup/README.md and PRIVACY-CHARTER.md in ~/genkan.
Then audit what is actually running, and be adversarial about it:
1. Is anything on this box sending data outside my house? Check the running
   containers, the systemd timers, and any outbound connection you can see.
   Name anything you are unsure about.
2. Is the admin dashboard bound to a private address only?
3. Does the safety net actually resolve? Run "genkan allow-status".
4. Run "sudo test/container-test.sh" and "sudo test/firewall-test.sh" and
   report every failure verbatim.
5. Has anything in config/nftables/kids.nft, gateway/ or bin/genkan been
   modified from what the repo ships? "git status" and "git diff" will tell
   you. If something was changed to make a test pass, say so plainly.
6. Tell me the three most likely ways this setup fails in the next year.

Report. Change nothing.
```

**What you should see.** A clean `git status` on the tracked tree, both suites
passing, and a dashboard on a private address. Anything else is worth
understanding before you rely on this box.

---

## The honest summary

There is no installer. What there is: a repo an agent can read, a CLI it can
drive, guides written for machines as much as for people, and a test suite that
proves the safety properties with real packets on the box in front of you.

That is a real trade and not a free lunch. You spend an evening and a bit of
attention. You do not spend a subscription, you do not hand your children's
browsing to a company, and nobody can switch it off or put the price up.

Related reading: [HARDWARE.md](../HARDWARE.md) for what actually works,
[README.md](README.md) for the universal shape, your platform guide for the
manual path, [../AGENT.md](../AGENT.md) for running it day to day, and
[../../PRIVACY-CHARTER.md](../../PRIVACY-CHARTER.md) for the promises this
project will not quietly break.
