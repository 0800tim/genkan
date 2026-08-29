# Hearth on an Omarchy thin client

Turn any spare PC or laptop into your family's network gateway: filtered,
time-budgeted internet for the kids, learn-to-earn quizzes, and your own AI
agent to drive it all by chat from your phone. All on your hardware, in your
house. Nobody outside your home (including us) can see anything.

Full background research: ../research/omarchy.md.

## What you need

- Any 64-bit PC with 4GB+ RAM. An old desktop, a mini PC, or a laptop.
- Two network connections: its built-in ethernet (uplink to your router)
  plus a USB gigabit ethernet dongle (about NZD 20-45) for the kids' side.
- A WiFi access point for the kids' network. Best: an old router or mesh
  unit switched to Access Point mode. A laptop's own WiFi card CAN
  broadcast the network (hostapd) but many chipsets do it badly; treat
  that as a "tonight only" mode and get a real AP. Honest detail in the
  research doc.
- A USB stick to install Omarchy.

## Step 1: install Omarchy

Download the ISO from omarchy.org, flash it to the stick, boot, install.
One gateway-specific choice: at the disk-encryption step use the
documented no-encryption install (Ctrl+C at the disk confirmation).
Reason: an encrypted gateway asks for a passphrase at every boot, so a
power cut leaves the kids' internet down until someone finds a keyboard.
This box holds filtering config and logs, not your life.

## Step 2: let your agent do the rest

Omarchy ships agent-first (Claude Code is a first-class citizen). Sign in
to your Claude plan, then:

    git clone <this repo> hearth && cd hearth
    claude

Tell the agent: "Read CLAUDE.md and set this box up as our Hearth gateway."
It will copy config.env.example and secrets.env.example, ask you for your
USB dongle's MAC address, mark the kids' NIC unmanaged in NetworkManager,
run deploy.sh, and walk you through your AP and each kid's devices.

Because Hearth's firewall lives inside its own container namespace, the
host's own Omarchy firewall (ufw) stays exactly as Omarchy ships it. Add
a post-update hook (~/.config/omarchy/hooks/post-update) that runs
`docker compose up -d` in the repo so Omarchy updates never leave the
island down.

## Step 3: your family's agent

Install Tailscale (free for families) so your phone can reach the box from
anywhere, and talk to your agent in its terminal: "turn off gaming",
"dinner", "give Ben 30 minutes". docs/AGENT.md is the agent's manual.
Set each kid up with the portal (it is just http://192.168.60.1 on their
network) and, if you like, their own tutor: docs/runbooks/ai-tutor.md.

## What this is not

- Not surveillance. It filters and time-budgets; it cannot read messages
  inside apps, and we tell you that plainly rather than pretend.
- Not a cloud service. If our project vanished tomorrow, your box keeps
  working. Nothing phones home. MIT licensed.
