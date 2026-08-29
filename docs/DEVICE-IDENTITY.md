# Who is this device, and does it matter?

A design note. The short answer: **claiming beats logging in**, and the thing
worth building is not a password.

## The problem, stated honestly

`kids_known` is the default-deny set: an address not in it gets nothing. It is
filled from two places (`gateway/entrypoint.sh`):

    SELECT host(reserved_ip) FROM devices WHERE reserved_ip IS NOT NULL AND is_active
    UNION SELECT host(ip) FROM dhcp_leases WHERE active

The second line is the problem. **Any device that gets a DHCP lease is known**,
and a device belonging to nobody is in no child's `kids_block`, has no
reservation for the meter, and is not a client AdGuard has a tier for. It gets
full, unfiltered, unmetered internet.

That is not theoretical. On the household this was written on, six of thirteen
active leases belonged to nobody, two of them ordinary personal devices.

It also makes MAC rotation a bypass. Be precise about how easy that is, because
an earlier draft of this note overstated it.

Both platforms randomise, and both are **stable per network by default**. iOS
Private Wi-Fi Address keeps one address per SSID and does not change it when
you toggle wifi. Android's randomised MAC is persistent per network unless
somebody deliberately picks the non-persistent option. So a phone reconnecting
a hundred times a week keeps the same address, which is why the devices in
this household have held theirs.

The address changes when somebody **forgets the network and rejoins**, on a
factory reset, or when a person deliberately chooses per-connection
randomisation. That is a deliberate act, not an accident, which makes it an
evasion technique rather than daily noise. Good news twice over: re-claiming
will be rare in ordinary use, and a device that keeps needing to be re-claimed
is itself a signal worth seeing.

### The hostname is a hint, never an answer

Devices announce a name over DHCP, which is why the roster shows things like
`toby-s-phone`. It is tempting to treat that as identity. It is not: the name is
set by whoever holds the phone, and renaming a device to somebody else's takes
about fifteen seconds in settings.

Use it to **pre-fill** the claim, so the common case is one tap, and never to
decide the claim.

## Why not per-child wifi passwords

The obvious answer is a username and password each, WPA2-Enterprise or
per-user PSK, so the network knows who is connecting. It is the textbook
answer and it is the wrong one here.

- **It needs hardware most homes do not have.** Per-user keys mean RADIUS and
  an access point that speaks it. A mesh unit from a supermarket does not.
- **A secret one teenager holds is a secret all of them hold.** Within a week
  the password is a shared fact, and the audit trail is a lie that looks like
  the truth. That is worse than no audit trail.
- **It authenticates a session on a network that has none.** An airport portal
  exists to bill you and satisfy a regulator. A home device reconnects silently
  a hundred times a week, forever. There is no moment to log in at.
- **It does not survive a handover.** A phone lent to a sibling is still logged
  in as its owner.

## What the problem actually is

Not authentication. **Attribution**: binding a device to a person, and
surviving the address changing underneath it.

That is a much smaller problem, and most of it is already built. There is a
captive portal. There is a device table. There is a firewall with sets.

## The proposal: an unclaimed device is restricted, not free

Today an unrecognised device gets everything. It should get almost nothing:

- **DNS**, so it can resolve at all
- **The portal**, so it can say who it is
- **The safety net**, so a help line always works, which is an iron rule
- **Nothing else**

Then the portal, which currently says "ask Dad", asks instead: *whose device is
this?* The child taps their name. The device is bound to them, inherits their
filter level and their clock, and their parent sees it on the dashboard.

This is **claiming, not authenticating**, and the honesty matters. It does not
prove identity. It makes declaring yourself the path of least resistance, and
it makes not declaring yourself useless rather than advantageous.

### What it buys

- **MAC rotation stops being a bypass.** The phone reappears as new, is
  restricted, and the child re-claims it in ten seconds. Rotation becomes a
  minor annoyance rather than an accidental exploit.
- **The incentive runs the right way.** A new device that does nothing until
  you say whose it is gets declared. No enforcement conversation needed.
- **No new hardware, no shared password, nothing to leak.**
- **A guest's phone works the way a guest expects**: connect, get a page,
  say who you are, get the guest tier.

### What it does not buy, stated plainly

- A determined child can claim a device as a sibling. That is what the
  optional PIN below is for, and even then a PIN is shareable.
- It says nothing about who is *holding* the device. Nothing can.
- Mobile data is still mobile data. It always will be.

## Optional: a per-child PIN

For a household that wants it, a child can be given a four-digit PIN, and
claiming asks for it. This is the login idea, scoped down to the one place it
earns its keep: stopping a sibling claiming your device to spend your minutes.

It stays optional because for most families it is friction with no gain, and
because a PIN a child holds is a PIN their siblings will eventually know. It
raises the effort; it does not create certainty, and the docs should not
pretend otherwise.

## Rollout

Off by default. A household running happily today should not wake up to
devices in a restricted lane. Turn it on deliberately, once the family knows
what it does, which is the same rule the IoT policy follows.

    kidnet claim-mode off      # today's behaviour: a lease is enough
    kidnet claim-mode observe  # count what WOULD be restricted, block nothing
    kidnet claim-mode enforce  # unclaimed devices get DNS, portal, safety net

`observe` exists because the first thing a parent wants to know is how many
devices this would have caught, before it catches any.
