# Household security: the rules your smart devices live by

Hearth started as a way to give children a healthier internet. This part of it
is for the rest of the house: the cameras, the doorbell, the front door lock,
the vacuum, the speakers, the lights. It is the difference between a kid
monitor and a household gateway.

The short version. Your camera keeps doing everything you bought it to do,
including backing up to its maker's cloud so a thief cannot take the evidence
with them. It just stops being able to do anything else.

## The one idea

Every rule here is about **who is allowed to start the conversation**, not
about who is allowed to talk.

That distinction is what makes the whole thing work. A security camera has to
be able to ring its manufacturer's cloud and push video up there. That is how
you watch it from the bus, and it is why a stolen camera still has footage of
the person who stole it. So the camera must be able to start a conversation
with its own vendor.

Nothing needs to be able to start a conversation with the camera from the
internet, though. And the camera has no business starting a conversation with
your laptop, your phone, or the robot vacuum.

Once a conversation has been permitted, the replies come back automatically.
Hearth never re-judges a reply. So "the camera may push out to its cloud"
means the cloud can answer, and "my phone may reach the camera" means the video
comes back. Only the very first packet of a conversation is judged.

## What each kind of device gets by default

| Device | Out to the internet | In from the internet | To your phones | To other gadgets | From your phones |
|---|---|---|---|---|---|
| Camera, doorbell | its vendor's cloud only | never | no | no | **yes** |
| Smart lock | its vendor's cloud only | never | no | no | **yes** |
| Robot vacuum | its vendor's cloud only | never | no | no | yes |
| Smart speaker | the ordinary internet | never | no | no | yes |
| Lights, plugs, thermostat, appliances | vendor cloud only | never | no | no | yes |
| Printer | nothing at all | never | no | no | yes |
| Camera recorder (NVR) | vendor cloud only | never | no | **yes** | yes |

Read the last column carefully, because it is the part people get wrong. Your
own phone can still reach your own camera. If it could not, you would open the
camera app on the sofa, get a spinning circle, and turn the whole system off
within a week. A security control that a household switches off protects
nothing.

Two classes are deliberately looser than the rest:

- **Speakers get the ordinary internet.** An Echo or a Sonos talks to music
  services, voice services and a dozen content networks that change weekly.
  Pinning it to a domain list produces a broken speaker and an unhappy house.
  It is also the device with the least to lose: there is no video of your front
  door on it. It still cannot reach your phones or the other gadgets.
- **A camera recorder is allowed to talk to other gadgets**, because pulling
  the camera streams is the entire job.

## Why the camera can still back up to the cloud

Plenty of good advice on the internet says "put your cameras on a VLAN with no
internet access". That advice quietly throws away the best feature a cheap
camera has: if someone walks off with it, the footage is already elsewhere.

So Hearth does not cut the camera off. It gives the camera an **allowlist**:
the addresses that belong to its manufacturer, and nothing else. Cloud
recording keeps working. Remote viewing keeps working. Firmware updates keep
working. What stops working is the camera talking to a machine in another
country that has nothing to do with its maker, which is what a compromised
camera does.

The allowlist is built the same way the rest of Hearth learns things: Hearth is
your DNS server, so it resolves the vendor's domains itself and also watches
which addresses your own devices are given when they look those names up.

### It was not working until 2026-08-29

Said plainly, because it is the kind of thing a project is tempted to bury.
`genkan iot learn` resolved every vendor address correctly and then failed to
store any of them. Several of a vendor's domains resolve to the same address,
Postgres refuses an `ON CONFLICT DO UPDATE` that touches one row twice in a
single command, and the error was being sent to `/dev/null`. So the tool
reported "resolved 28 addresses" while writing none.

The consequence is the one that matters: **every vendor-restricted device had an
empty allowlist, and an empty allowlist means no restriction at all.** The
camera lockdown described above had never actually been in force on any box.
Nothing was blocked that should have been allowed, so nothing looked broken,
which is exactly why it survived. A control that fails open and stays quiet is
the worst failure mode a security feature has.

Fixed, and the write no longer hides its own errors: a storage failure now logs
the Postgres message and raises an urgent alert. `learn` now reports both how
many addresses it resolved and how many are stored, so the two numbers can be
compared. If you have been running with the IoT layer enforcing, run
`genkan iot learn` again and check the stored count:

```sh
genkan iot learn
docker exec -i postgres psql -U postgres -d kids_network -c \
  "SELECT vc.vendor, count(*) FROM vendor_ips vi
     JOIN vendor_clouds vc ON vc.id = vi.vendor_id GROUP BY 1 ORDER BY 1"
```

A vendor with zero rows is a vendor whose devices are not restricted.

## Turning it on

It ships **off in all but name**. Installing the schema changes nothing. The
policy starts in `observe` mode, where every rule that would refuse traffic is
replaced by a counter. Nothing in your house behaves differently, and you can
see exactly what enforcement would have stopped before you commit to it.

The safe sequence:

```sh
# 1. Check what Hearth thinks your devices are, and fix anything it got wrong.
genkan devices
genkan iot status

# 2. Learn where each vendor's cloud lives. Do this a few times over a day or
#    two, so the lists have seen the addresses your devices actually use.
genkan iot learn

# 3. Watch. Leave it in observe mode for a day, then look at the counters.
genkan iot status

# 4. When the counters only show traffic you are happy to lose, switch on.
genkan iot mode enforce
```

Step 1 matters more than it looks. A device Hearth has classed as a `camera`
gets camera rules, and the vendor it guessed from the MAC address decides which
cloud it is pinned to. If either guess is wrong you will lock down the wrong
thing, or lock down nothing. Fix a wrong guess with:

```sh
genkan iot show "Front door camera"
genkan iot set "Front door camera" vendor Reolink
genkan iot set "Front door camera" internet_out vendor
```

To go back at any moment:

```sh
genkan iot mode observe     # stop enforcing, keep watching
genkan iot mode off         # remove the policy from the firewall entirely
```

`off` genuinely removes it. The firewall goes back to exactly the rules it had
before, in one atomic step.

## Overriding a rule

Everything is a database row, and every row can be overridden for one device
without disturbing the rest.

```sh
# Close a camera off from every phone in the house...
genkan iot set "Front door camera" reachable_from_personal no
# ...then let exactly one phone back in.
genkan iot allow "Mum's phone" "Front door camera" "camera app"

# Let a device off its vendor leash completely.
genkan iot set "Living room speaker" internet_out full

# Take a device off the internet entirely.
genkan iot set "Printer" internet_out none
```

Changes are recorded, and nothing takes effect until `genkan iot apply` (which
`mode` runs for you).

## What happens when something goes wrong

The design assumption is that Hearth itself will occasionally have a bad day,
and that a bad day must never mean a household locked out of its own front
door. So:

- **If the database is unreachable, nothing changes.** The rules already loaded
  stay loaded. Hearth says so and does nothing.
- **If a vendor's addresses have not been learned yet, that device is not
  restricted.** An empty allowlist means "we do not know yet", never "block
  everything". That direction is deliberate and stays: a household must never be
  locked out of its own front door because a name did not resolve. But it means
  "not restricted" is a real state your house can be in, so Hearth now says so
  where you will see it rather than only in a terminal.
- **If a device is set to vendor-only and Hearth cannot tell what brand it is,
  it is not restricted at all**, and a warning appears on the dashboard naming
  that device and printing the command that fixes it:

      genkan iot set "Front door camera" vendor Reolink

  Until you answer it, that device has the ordinary internet. This used to be a
  line of terminal output nobody read. Note that the alert's own wording says
  `cloud <brand>`; the field is called `vendor`, and the alert text is wrong.
  Known, and not fixed in a documentation pass.
- **Alerts clear themselves.** A successful run retires the IoT alerts before
  it, so a validation failure that has since been fixed stops sitting on the
  dashboard claiming to be current. A red banner that is no longer true teaches
  a household to ignore the red ones.
- **If the generated rules do not validate, nothing is applied** and you get an
  alert. There is no state where half a policy is loaded.
- **If the gateway restarts**, the policy is gone until the next run, and being
  gone means your devices work normally. The failure direction is always
  towards a working house.

## The honest limits

This section is the point of the document. Everything above reduces the blast
radius of a bad device. None of it makes anything invulnerable.

**A vendor on a big content network is hard to pin down.** Allowing
`ring.com` means allowing the addresses those names resolve to, and if a vendor
sits behind a large shared network, some of that network's other tenants come
along for the ride. It still stops the camera talking to an arbitrary machine
in another country, which is the thing that actually matters, but it is a fence
rather than a vault.

**A compromised device that only talks to its vendor is still compromised.** If
someone owns your camera through the manufacturer's own cloud, everything here
is satisfied and the camera does exactly what the attacker asks. What this
prevents is the next step: the camera scanning your laptop, joining a botnet,
or shipping video to a third party. Blast radius, not immunity.

**Two devices on the same wifi can talk without asking us.** This is the
biggest limit and it is worth understanding. If your camera and your laptop are
on the same access point on the same network, the access point delivers frames
between them directly. Those packets never reach the Hearth box, so no rule on
the Hearth box can judge them. Everything in the "to your phones" and "to other
gadgets" columns above is enforced **only for traffic that comes to us**.

To make those columns real, stop the access point switching that traffic
locally:

- turn on **client isolation** (sometimes called AP isolation or guest mode) on
  the access point serving the island, or
- put the gadgets on their own SSID.

Then every packet between two devices comes through Hearth and every rule
applies, including the exception that keeps your camera app working. That is
the configuration the test suite models, and it is the recommended setup.
Without it, the lateral movement rules are a second line of defence for the
routed cases only, not a guarantee.

**We see addresses, not content.** Same as everywhere else in Hearth. We know
your camera talked to its vendor. We do not know what it said.

**"Enforcing" is not the same as "restricted".** Every device with an empty
allowlist is wide open regardless of the mode, so `genkan iot status` telling
you the mode is `enforce` is not on its own evidence that anything is being
enforced. Check the stored address counts, and check the dashboard for the
unknown-brand warning. That gap is what hid the bug above for as long as it hid.

**A device can lie about its address.** The same static-address defence the kid
side uses applies here: a device using an address we never reserved is not
recognised and gets nothing. That is a real defence, but a device that steals
another device's address while that device is off is a harder problem, and we
do not solve it.

**Bluetooth, Zigbee, Z-Wave and Matter over Thread do not come near us.** A
gadget that talks to a hub over its own radio is invisible to a network
gateway. What we can police is the hub's traffic, not the radio behind it.

## Where this lives

| Piece | File |
|---|---|
| The policy model | `config/db/schema-policies.sql` |
| The generator and the CLI | `bin/kidnet-iot-policy` (also `genkan iot ...`) |
| The proof, with real packets | `test/iot-policy-test.sh` (39 checks) |
| The island firewall it sits on | `config/nftables/kids.nft` |

Six of those 39 checks were themselves passing without testing anything until
2026-08-29: they probed with netcat, and a negative assertion whose probe never
runs reports PASS. The probes now use bash's own `/dev/tcp`, so there is no
external binary left to be missing. DECISIONS.md has the detail. If you are
relying on this layer, run the suite yourself rather than taking the number on
trust.

Nothing here edits `kids.nft`. The policy is generated from database rows into
a chain of its own, exactly the way per-service metering is, so adding a device
or changing a rule is a row, not a firewall edit.

The one place it does reach into the shipped ruleset is a short, marked list of
exceptions at the top of the island's forward chain, and only when enforcement
is on. They exist because `kids.nft` blocks the island from all private address
space, and the island's own addresses are inside that space, so without them
"view my own camera from my own phone" would be collateral damage. Every one of
those exceptions can only ever permit traffic between two addresses on the
island itself, so the isolation that matters, the island being unable to reach
the main house network or the tailnet, is untouched. They carry the comment
`hearth-iot-allow`, they are replaced as a set on every run, and `mode off`
removes them.
