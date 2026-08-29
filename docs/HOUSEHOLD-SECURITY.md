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

## Turning it on

It ships **off in all but name**. Installing the schema changes nothing. The
policy starts in `observe` mode, where every rule that would refuse traffic is
replaced by a counter. Nothing in your house behaves differently, and you can
see exactly what enforcement would have stopped before you commit to it.

The safe sequence:

```sh
# 1. Check what Hearth thinks your devices are, and fix anything it got wrong.
kidnet devices
kidnet iot status

# 2. Learn where each vendor's cloud lives. Do this a few times over a day or
#    two, so the lists have seen the addresses your devices actually use.
kidnet iot learn

# 3. Watch. Leave it in observe mode for a day, then look at the counters.
kidnet iot status

# 4. When the counters only show traffic you are happy to lose, switch on.
kidnet iot mode enforce
```

Step 1 matters more than it looks. A device Hearth has classed as a `camera`
gets camera rules, and the vendor it guessed from the MAC address decides which
cloud it is pinned to. If either guess is wrong you will lock down the wrong
thing, or lock down nothing. Fix a wrong guess with:

```sh
kidnet iot show "Front door camera"
kidnet iot set "Front door camera" vendor Reolink
kidnet iot set "Front door camera" internet_out vendor
```

To go back at any moment:

```sh
kidnet iot mode observe     # stop enforcing, keep watching
kidnet iot mode off         # remove the policy from the firewall entirely
```

`off` genuinely removes it. The firewall goes back to exactly the rules it had
before, in one atomic step.

## Overriding a rule

Everything is a database row, and every row can be overridden for one device
without disturbing the rest.

```sh
# Close a camera off from every phone in the house...
kidnet iot set "Front door camera" reachable_from_personal no
# ...then let exactly one phone back in.
kidnet iot allow "Mum's phone" "Front door camera" "camera app"

# Let a device off its vendor leash completely.
kidnet iot set "Living room speaker" internet_out full

# Take a device off the internet entirely.
kidnet iot set "Printer" internet_out none
```

Changes are recorded, and nothing takes effect until `kidnet iot apply` (which
`mode` runs for you).

## What happens when something goes wrong

The design assumption is that Hearth itself will occasionally have a bad day,
and that a bad day must never mean a household locked out of its own front
door. So:

- **If the database is unreachable, nothing changes.** The rules already loaded
  stay loaded. Hearth says so and does nothing.
- **If a vendor's addresses have not been learned yet, that device is not
  restricted.** An empty allowlist means "we do not know yet", never "block
  everything". Hearth reports the gap so you can fix it.
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
| The generator and the CLI | `bin/kidnet-iot-policy` (also `kidnet iot ...`) |
| The proof, with real packets | `test/iot-policy-test.sh` |
| The island firewall it sits on | `config/nftables/kids.nft` |

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
