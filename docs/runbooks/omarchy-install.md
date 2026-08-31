# Runbook: set up Hearth on an Omarchy box

For a parent's AI agent to follow, or a person to read. Omarchy-first, but
every step works on any Arch box, and the shape works on any distro with
Docker (swap the pacman line).

## What the parent does with hardware (5 minutes)

1. Pick the gateway machine: any PC or laptop with wired ethernet, 4GB+ RAM.
2. Plug a USB gigabit ethernet dongle into it. That dongle is the KIDS side.
   The built-in ethernet is the UPLINK to the home router.
3. Cable: home router -> built-in ethernet. USB dongle -> a switch or
   straight to the access point. Access point in bridge/AP mode broadcasts
   the kids' WiFi. (An old router in AP mode is ideal. A laptop's own WiFi
   can do it via hostapd, but treat that as a stopgap, see research/omarchy.md.)

## What the agent does (the "tell your agent to do it all" path)

Run these in order. Stop and ask the parent only where noted.

    # 1. Get the code onto the gateway box
    git clone <genkan repo> ~/genkan && cd ~/genkan

    # 2. Prepare the host (installs docker, unmanages the kids NIC, adds the
    #    Omarchy post-update hook). Asks the parent for the USB dongle's MAC.
    ./install/omarchy-setup.sh

    # 3. Provision the database (Postgres in a container) and load the schema.
    #    See docs/DATABASE.md for the compose service and the schema order.

    # 4. Bring it up. Validates the firewall, builds the image, starts the
    #    island stack, generates the AdGuard admin password.
    sudo ./deploy.sh

    # 5. Prove it before trusting it.
    sudo ./test/container-test.sh
    kidnet allow-status        # safety net populated?

## The Omarchy-specific choices, and why

- **No disk encryption on the gateway.** Omarchy defaults to LUKS, which
  prompts for a passphrase at every boot. A gateway must come back after a
  power cut without a keyboard. Use the documented no-encryption install
  (Ctrl+C at the disk step). This box holds filtering config and logs, not
  your life.
- **We do not touch ufw.** Omarchy ships ufw enabled. Hearth's firewall lives
  inside a container namespace and never registers a host rule, so ufw stays
  exactly as Omarchy set it. Nothing to configure, nothing to fight.
- **The kids NIC is unmanaged by NetworkManager.** The setup script writes a
  NM drop-in so NM and our container do not both grab the dongle.
- **Survives `omarchy update`.** The setup script adds a post-update hook that
  runs `docker compose up -d`, so an OS update never leaves the kids offline.

## Bring your own AI

Hearth does not ship an LLM. The parent points their existing agent (Claude
Code, Codex, Gemini CLI, a local model) at this repo. The control surface is
`kidnet` plus these runbooks, so any agent that runs shell commands works.
Add your API key or CLI login once. See docs/AGENT.md.

## Trademark note

Omarchy is DHH's project (MIT, trademarks held by the Omacom Foundation). We
say "runs great on Omarchy" nominatively, use no Omarchy logo, and imply no
endorsement. See research/omarchy.md.
