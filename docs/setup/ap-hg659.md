# The kids' wifi from a spare Huawei HG659

The HG659 is the home gateway several New Zealand ISPs handed out for years,
so there is a good chance one is in a drawer in your house right now. It makes
a fine access point and four port switch for the kids' island, which saves you
buying anything.

This guide is one model in detail. The same seven steps work on almost any old
router, and the last section says how to translate them.

Read [PROMPTS.md](PROMPTS.md) prompt 6 first if you are following the guided
setup. This page is the detail behind its step 1.

## What you are turning it into

**A switch with an aerial, not a router.** Its routing, its NAT, its firewall
and its DHCP server all get switched off or left unplugged. Genkan is the
router. The Huawei just carries packets and broadcasts the wifi.

That is why the blue WAN port stays empty forever. Anything plugged into the
blue port gets routed and NATted by the Huawei, which would put a second
router between your children and Genkan, hide every device behind a single
address, and break the whole per child picture. The uplink goes into a yellow
port instead, where the box behaves as a plain switch.

## The ports

Looking at the back, left to right:

```
   +------+   +------+------+------+------+   +-----+-----+-----+    o
   | WAN  |   | LAN1 | LAN2 | LAN3 | LAN4 |   |Phone|Phone| DSL |  Reset
   +------+   +------+------+------+------+   +-----+-----+-----+
     blue      yellow  yellow yellow yellow      grey  grey  grey

    LEAVE       one of these four is the         not used at all
    EMPTY       uplink from the Genkan box,
                the other three are spare
                wired ports for the island
```

Everything plugged into a yellow port is **on the kids' island**: filtered,
metered, and switched off by a bedtime or the whole house cut. That is usually
what you want for a games console or a family desktop. Do not put your work
laptop there.

Three spare ports is often enough. If you need more, plug a cheap unmanaged
switch into one of them and branch out. Anything behind that switch is on the
island too.

## What you need

- The HG659, its power supply, and two ethernet cables.
- Your Genkan box with its two network paths (see [README.md](README.md)).
- Ten minutes, and the label on the underside of the router.

## The seven steps

**1. Factory reset it.** Power it on, hold the recessed Reset button for about
ten seconds with a paperclip, let it reboot. This matters because the label on
the underside only tells the truth after a reset, and because an ISP router
that has been in service is carrying settings you cannot see.

**2. Connect a computer to it, on its own.** Plug your laptop into LAN1 with a
cable, or join the wifi named on the label using the WLAN Key printed there.
Nothing else should be plugged into the router yet.

**3. Sign in.** Browse to `http://192.168.1.1`, which is where these answer
after a reset. If that does not load, the address your computer calls "router"
or "default gateway" is the right one.

**The admin password is not the WLAN Key on the label, and it is usually not
`admin` either.** It depends on which ISP handed the unit out, and this is the
step that stops most people. Tested on a real unit on 2026-09-04: the WLAN Key
failed, `admin`/`admin` failed, and the ISP's own documented pair worked.

| Where it came from | Username | Password |
|---|---|---|
| Voyager | `!!Huawei` | `@HuaweiHgw` |
| Vodafone or One NZ | `Admin` | `VF-NZhg659`, or `@` and the last 8 of the serial on later builds |
| Spark | `admin` | `admin` |
| Unknown | try those three, in that order | |

**Three wrong tries locks the login for a while**, so do not guess freely. If
you run out, power cycle it or factory reset again, which clears the count.
The surest answer is your own ISP's support page: search for the ISP's name
with "HG659 default login". If none of them work, skip to "When it will not
work" at the bottom.

**4. Turn the DHCP server OFF.** Usually under Home Network, then LAN
settings, or Advanced, then DHCP. **This is the step that matters most.**
Genkan hands out the addresses on the kids' network. Two servers handing out
addresses on one wire is the single most common way this setup breaks, and
Genkan refuses to start the island when it hears one (see step 7).

**5. Give it a fixed address on the island, and change the admin password.**
On the same LAN settings page set the router's own address to
`192.168.60.2`, with mask `255.255.255.0`. That address is inside the kids'
network but outside the pool Genkan hands out, so the router stays reachable
for future admin without ever colliding with a child's device.

Then change the admin password from the label default. Do not skip this. Your
children's devices sit on the same wire as this router, so they can reach its
admin page directly, without passing through Genkan. There is nothing Genkan
can do about that, and the honest limits section explains what it does and
does not mean.

Write both down somewhere you will find them: the new address, and the new
password.

**6. Set the kids' wifi.** Under WLAN or Wireless, set the network name and
password your children will use. Keep it obviously different from the house
wifi, for example `Home-Kids`, so nobody joins the wrong one by accident. Turn
WPS off while you are there, and the guest network too if it has one: both are
doors you did not mean to leave open.

Save and let it reboot. From here on it answers at `192.168.60.2`, so the old
address will stop working. That is correct.

Two things you will notice at the new address, both normal: it serves its
admin page over **https** now, and your browser will warn about the
certificate because the router signs its own. It is your own hardware on your
own wire, so accept the warning and carry on.

**7. Cable it up, and watch Genkan check your work.** Power the Huawei off.
Plug the cable from the Genkan box's kids side interface into **any yellow
port**. Leave the blue port empty. Leave the DSL port empty. Power it back on.

On the Genkan box:

```bash
docker logs -f genkan-gw
```

You want the line that says the segment guard heard nothing and the island is
up. If instead it says the guard **tripped**, its DHCP server is still on: go
back to step 4. The guard is doing its job. Never switch it off to get past
this.

**8. Tell Genkan what the router is.** Once a device has joined the kids' wifi
and the island is serving:

```bash
genkan devices          # find the Huawei's MAC address in the list
genkan infra <its-mac>  # file it as infrastructure
genkan ap-check         # prove the whole setup from the box
```

`genkan infra` matters more than it looks. It marks the router as
infrastructure, so a bedtime, a dinner pause or the whole house cut can never
switch off your own access point and take the island down with it.

## What good looks like

- `docker logs genkan-gw` says the island is up on kids0.
- A phone joined to the kids' wifi gets a `192.168.60.x` address
  (`genkan leases` shows it) and appears in `genkan devices`.
- The internet works on that phone, an obviously adult site does not, and
  `http://192.168.60.1` shows the kid portal.
- `genkan ap-check` says everything it can check is in order.

## When it does not work

**The segment guard refuses the wire.** The router's DHCP server is still on.
Step 4. This is by far the most common one.

**A phone joins the wifi but never gets an address.** Work through it in this
order: is `kids0` actually inside the container (`genkan-health`), did AdGuard
restart after the interface was handed over (the warden does that about twenty
seconds later), is the router's DHCP really off, and is the cable in a yellow
port rather than the blue one.

**Everything works but every device shows up as one address.** The cable is in
the blue WAN port. The Huawei is routing and hiding your children behind one
address. Move it to a yellow port.

**You cannot reach the router any more.** That is expected after step 5: it
moved to `192.168.60.2`. Reach it from a device on the kids' wifi. If you have
lost the password, factory reset and start again.

## What this cannot do

Say these out loud before you rely on the setup.

- **Your children can reach the router's admin page.** Their devices are on
  the same wire as it, so that traffic never passes through Genkan and Genkan
  cannot block it. It is not a way around the filter, because there is no
  second path to the internet, but a child who signs in could change the wifi
  password or reset the box out of spite. A password that is not the one
  printed on the label is the whole defence. Put the router somewhere they do
  not administer, along with the Genkan box.
- **Physical access still beats everything.** Anyone who can move a cable can
  plug a device into the house router instead. That is true of every product
  of this kind, and it is why Genkan treats bypass attempts as a conversation
  and a bug bounty rather than an arms race. See BUG-BOUNTY.md.
- **Some ISP firmware is locked.** See below.

## When it will not work

If after a factory reset you cannot sign in, or the DHCP server setting is
missing or greyed out, the unit is carrying locked ISP firmware and is not
usable this way. Do not fight it. Either:

- use any other old router with the same seven steps, or
- buy a cheap unmanaged switch (about twenty dollars) and any access point,
  which is more reliable than a repurposed gateway anyway, or
- see [../HARDWARE.md](../HARDWARE.md) for serving the wifi from the Genkan
  box itself with a USB adapter. Honest warning: that is a one room signal.

## Any other old router

The seven steps generalise. On any spare router:

1. Factory reset.
2. Sign in on its own network.
3. **DHCP server off.** The one that matters.
4. Static LAN address inside the island, outside Genkan's pool
   (`192.168.60.2` is a good choice).
5. Admin password changed off the default.
6. SSID and password set, WPS and guest network off.
7. Uplink into a **LAN** port, never the WAN port, and nothing else plugged
   into it.

Some routers call this "access point mode" or "bridge mode" and will do most
of it for you. If yours has that mode, use it, then check DHCP is off anyway.

## Letting your agent do it

`genkan ap-check` proves the result from the box: whether anything else is
serving DHCP or DNS on the kids' wire, whether the access point answers where
it should, whether it is filed as infrastructure, and whether devices are
getting leases. Run it after any change to the access point, and give the
output to your agent if something is wrong.

The configuration itself is still yours to click through, for now. A scripted
version for this model is being built, and the groundwork is done: on
2026-09-04 a factory reset unit (hardware VER.B, firmware V100R001C222B011)
was configured end to end from a Genkan box on a dedicated cable: wifi name
and password, DHCP server off, admin password changed, and the LAN address
moved onto the island, each one verified by reading it back afterwards.

For anyone building that, what the router's own interface does:

- Login is `POST /api/system/user_login` carrying
  `sha256( username + base64(sha256(password)) + csrf_param + csrf_token )`.
  The csrf pair comes from meta tags on the served page and rotates with
  every reply. Answers are wrapped in `while(1); /*...*/` and must be
  unwrapped before parsing.
- The settings live at `/api/ntwk/lan_server` (the DHCP server, step 4),
  `/api/ntwk/lan_host` (the address and mask, step 5), `/api/ntwk/WlanBasic`
  (the wifi, step 6) and `/api/ntwk/lan_upnp`.
- **The paths are case sensitive.** `WlanBasic` answers and `wlanbasic`
  returns 404, which is a confusing way to conclude a firmware cannot do
  something.
- A factory reset unit opens on its setup wizard, and the full menu only
  appears once that is past, so a script has to expect either.
- The interface is an Ember application, and it commits the model on real
  input events. Setting a field's value programmatically leaves the right
  text on screen and saves **nothing**, with no error: the save posts the old
  values. Type into the fields instead, and blur them, or drive the API.
- Once the LAN address moves off its default, the admin page answers on
  https with a self signed certificate and an old TLS stack, and it answers a
  plain http request with a 307. A driver has to follow that to https and be
  willing to talk to a legacy server.
- Changing the admin password logs the session out, so do it last, or log in
  again afterwards.

Order matters when scripting it: the wifi and the DHCP server first, the
admin password next, and the LAN address last, because that one takes the
router off the address you are talking to it on.

Whatever drives it must fingerprint the firmware first and refuse if it does
not recognise what it is looking at. Half configuring somebody's router is
worse than not touching it.
