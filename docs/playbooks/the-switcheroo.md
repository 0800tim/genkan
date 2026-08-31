# The Switcheroo: take over the wifi without touching a single device

*A Genkan playbook. The cheekiest 20 minutes in parenting.*

Your kids have six, eight, ten devices between them. Chromebooks for school,
phones, a hand-me-down iPad, a smart watch, the friend who is basically a
fourth child now. Every one of them already knows your wifi name and password
by heart. The thought of reconnecting all of them to a new network, chasing
down passwords, arguing about why, is enough to make you give up before you
start.

So don't. Here is the trick: **you move the house, not the furniture.**

## The idea in one line

Give the new filtered network the *same name and password* as the old one.
Every device reconnects on its own, notices nothing, and is quietly now behind
your gateway. No app to install, no setting to change, no argument.

## How it works

Right now you have one wifi network, call it **Nero**, that goes straight to
the internet, unfiltered. Everyone is on it. You are going to do a swap:

1. **Rename your real network.** Your existing router's wifi (the one wired to
   the internet) gets a new name, say **Upstairs**, and a new password.
   This is now *your* network: yours, your partner's, work devices. Tell the
   kids it is the grown-ups' network and it is off limits. Nobody's device
   knows this name, so nobody drifts onto it by accident.

2. **Stand up the new Nero.** Take a spare access point (an old router, a mesh
   satellite, a cheap dedicated AP), factory reset it, and set it up as its
   own network in **Access Point mode**. Give it the old name and the old
   password: **Nero**, same key as before.

3. **Wire it to the gateway.** That new Nero plugs into your Genkan box (the
   always-on computer running this project). The gateway hands out the
   addresses, does the filtering, keeps the logs, enforces the time limits.

4. **Watch them roll in.** As phones and laptops come back into range, they see
   "Nero", the name they trust, with the password they already have, and
   reconnect themselves. Except now every one of them is on your island, behind
   your rules. You will see each device appear, ready to be named and assigned.

That is the whole trick. The kids changed nothing. Their friends changed
nothing. The network they always used just got a new engine under the bonnet.

## The honest part (read this)

Genkan's whole ethos is that this works *better* when it is not a secret. The
Switcheroo is a convenience, it saves you reconnecting a dozen devices, not a
way to spy. We strongly suggest you still tell the kids, in plain words, that
the home network is filtered and time-managed now, and why. Especially the
teenagers: the day a 16-year-old discovers a hidden filter is the day they
move to mobile data and you lose all visibility. "Same wifi, and by the way it
looks after you now" beats "gotcha" every time. The trick saves your evening;
the honesty saves the relationship.

Two things the Switcheroo does NOT do, and we will not pretend otherwise:

- It does not touch mobile data. A phone on 4G never comes near your wifi.
  That is a job for the phone itself (Family Link and friends).
- It does not read inside apps. You see the sites devices reach, never the
  messages inside Snapchat or Discord. Genkan is a gateway, not a wiretap.

## Naming your networks

- Grown-ups' unfiltered network: something clearly "not for kids". A business
  name, your name, anything they will not reflexively join.
- Kids' filtered network: the *old, familiar* name and password. Familiarity
  is the whole point.

## What you get the moment it is live

- Every device on the kids' network shows up to be labelled ("Ben's
  Chromebook") and assigned to a person.
- Friends' devices appear too. You can see them, and you can pause them, so a
  visiting mate cannot quietly stream until 2am on your wifi.
- One sentence to your assistant, "dinner", "kill gaming", "give Ben 30 more
  minutes", and it happens across the whole island.

## The friend problem, solved

When your kid's friend joins (and they will, they have your password), their
phone lands on the filtered island like everyone else. Genkan tags devices you
have not claimed as **guests**: filtered and time-limited, but controllable
separately from your own kids. Pause the guests without pausing your kids, or
your kids without pausing a guest, whichever the evening needs.

## Kin

Sibling to [unrot](https://github.com/0800tim/unrot): earn screen time by
learning. Same spirit, a rung down the stack.
