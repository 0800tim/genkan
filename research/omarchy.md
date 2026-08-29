# Omarchy research for HEARTH

Researched 29 August 2026. Sources: omarchy.org, the Omarchy manual (which lives in the repo at `manual/` and is mirrored at https://learn.omacom.io/2/the-omarchy-manual), the GitHub repo https://github.com/basecamp/omarchy (inspected directly at the current `quattro` branch), and press coverage. Where a claim comes from the repo itself, the path is given.

## 1. What Omarchy is today (late August 2026)

Omarchy is "beautiful, modern and opinionated Linux by DHH", incubated at 37signals and now backed by the nonprofit Omacom Foundation. It is Arch Linux underneath, with the Hyprland Wayland compositor on top, plus a large layer of Omarchy tooling (an `omarchy` CLI with hundreds of subcommands, a menu system, themes, and an update pipeline).

Key facts:

- Base: Arch Linux, rolling release. Omarchy runs its own package repository (https://github.com/omacom-io/omarchy-pkgs) and its own Arch mirror (https://github.com/omacom-io/omarchy-mirror). The stable mirror deliberately runs about one month behind upstream Arch to catch breakage. Source: `manual/30-updates.md`.
- Ships as an ISO from https://omarchy.org (currently `omarchy-4.0.1.iso`, under 6 GB). ISOs are GPG signed. Install takes one to five minutes. Source: `manual/02-getting-started.md`, https://omarchy.org.
- Installer: its own wizard on the ISO. Full-disk LUKS encryption is the default and strongly pushed. Secure Boot and TPM must be disabled in BIOS. There is a no-encryption escape hatch (Ctrl+C at the disk formatting confirmation). There is also a fully unattended install mode using a second drive labelled `cidata` (cloud-init NoCloud style), which can carry SSH keys and even a `tailscale_authkey` so the machine joins your tailnet on first boot. Source: `manual/02-getting-started.md`, `manual/51-unattended-installs.md`.
- Desktop stack in 4.x ("Quattro", released 14 August 2026): Hyprland, with the bar, launcher, notifications and lock screen consolidated into a single Quickshell process. Terminal default is foot. Bootloader is Limine with btrfs plus snapper snapshots for rollback. Login manager is SDDM. Sources: `docs/file-layout.md`, `manual/47-system-snapshots.md`, https://botmonster.com/self-hosting/omarchy-quattro-release/.
- Release cadence: fast. Tags from the repo: v3.4.x in Feb-Mar 2026, v3.5-3.8 across Apr-Jul 2026, v4.0.0 on 14 Aug 2026, v4.0.1 on 25 Aug 2026. Expect several meaningful releases per year plus frequent point releases. Four update channels: stable, RC, edge, dev. Source: https://github.com/basecamp/omarchy/releases, `manual/30-updates.md`.
- Hardware requirements: no formal minimum spec is published. It is x86_64 UEFI machines with Secure Boot off. Intel Macs work, Apple Silicon does not (community Asahi port exists). The manual assumes a retina-class display by default but that is cosmetic. In practice anything that runs Arch plus Hyprland comfortably is fine, which means roughly a 2015 or later dual-core with 4 GB RAM as a sensible floor, and the 6 GB ISO implies a 20 GB or larger drive. Source: `manual/02-getting-started.md`, `manual/49-omarchy-on.md`.
- Licence: MIT (repo `LICENSE`). Trademarks are held by the Omacom Foundation, launched August 2026 with USD 10 million from Shopify, Stripe, Dell, Block, Cloudflare, 37signals, Brendan Iribe, DHH, Drew Houston and Peter Steinberger. Source: https://omarchy.org/news/2026/08/omacom-foundation-launches-with-8-million/.
- Notably for us: Omarchy treats AI coding agents as first-class citizens. Claude Code, Codex, OpenCode and others ship as lazy-loaded mise stubs, there is a default-agent picker, and `omarchy agent prompt "..."` launches the default agent straight into a task in its auto-approving mode. The repo itself carries `AGENTS.md`, `CLAUDE.md` and `agents/skills/` guides. This makes our "tell your AI agent to follow the instructions" setup flow feel native rather than bolted on. Source: `manual/17-ai.md`, repo root.

## 2. How post-install customisation is meant to be done

Omarchy has a clear contract between "Omarchy's files" and "your files", plus several official extension points. In order of usefulness to us:

- Dotfiles: `~/.config` is yours and survives updates. System files live in `/usr/share/omarchy` (owned by the `omarchy` pacman package) and will be overwritten on update, so never patch them. Override values in `~/.config` instead. Source: `manual/31-dotfiles.md`.
- Hooks: Omarchy fires event hooks from `~/.config/omarchy/hooks/<event>.d/`. Events include `post-boot` (right after the desktop starts), `post-update` (during `omarchy update`, after packages and migrations), `pre-refresh-pacman`, `theme-set`, `font-set` and `battery-low`. Install with `omarchy hook install post-update ~/my-hook`. A `post-update` hook is our survivability mechanism: after every Omarchy update we can re-assert our firewall rules, sysctls and service state. Source: `manual/31-dotfiles.md`.
- Menu extensions: add entries to the Omarchy menu via `~/.config/omarchy/extensions/omarchy-menu.jsonc`. We could add a "Hearth" submenu (status, pause internet, open dashboard) with a few lines of JSONC. Source: `manual/31-dotfiles.md`.
- Autostart: `~/.config/hypr/autostart.lua` for session-scoped processes. Not right for us, our services are system daemons, but good to know. Our stack should be plain systemd units, which Omarchy does nothing to restrict.
- Packages: Omarchy is package-backed. `omarchy-pkg-add <pkg>` installs Arch packages, AUR is available but not used by the base install. Third parties are expected to ship normal Arch packages or install scripts, not to fork Omarchy. Source: `manual/30-updates.md`, `manual/29-other-packages.md`.
- Migrations: Omarchy's own `migrations/*.sh` (timestamped shell scripts, run once per user by `omarchy-migrate` during `omarchy update`) are an internal mechanism for Omarchy itself, not a third-party plugin API. We should not drop files in there. Source: `docs/update-process.md`, `agents/skills/migrations.md` in the repo.
- Update discipline: `pacman -Syu` is actively guarded and aborted, pointing users to `omarchy update`, which does snapshot, packages, migrations and hooks together. Our docs and automation must say `omarchy update`, never raw pacman. Source: `manual/30-updates.md`, `docs/update-process.md`.

Recommended layering pattern for HEARTH: ship our stack as (a) one or more Arch packages or an idempotent installer script in our repo, (b) our own systemd units under `/etc/systemd/system`, (c) config under `/etc/hearth`, and (d) a `post-update` hook that re-runs our idempotent "assert desired state" script. That respects every boundary Omarchy documents and survives both updates and `omarchy reinstall configs`.

One caveat: snapshot rollback. Omarchy snapshots the root filesystem before every update and users can boot into a pre-update snapshot from Limine. A rollback would also roll back our packages and `/etc` changes (though not `/home`). Our installer must be safely re-runnable so a parent can just run it again after a rollback. Source: `manual/47-system-snapshots.md`.

## 3. Feasibility of the gateway stack

Mostly excellent. It is Arch, so everything we want is a pacman install away, and some of it is already there.

Already present in the base install (from `install/omarchy-base.packages`):

- Docker, docker-compose, docker-buildx, lazydocker
- NetworkManager (this is the network stack in Omarchy 4, the manual confirms it; earlier versions used iwd, and iwd-era issues still float around the tracker)
- ufw and ufw-docker
- postgresql-libs (client libs only)
- mise, which can supply Node per-project; system-wide Node is `pacman -S nodejs-lts`

Things that will fight us, and how much:

- The firewall. ufw is enabled by default, denies all incoming except 53317 (LocalSend), and Docker is locked down via ufw-docker. Source: `manual/48-security.md`. ufw on Arch drives the iptables-nft backend, so writing our own raw nftables tables alongside it is asking for rule-ordering pain. Two clean options: (a) express our gateway rules through ufw (open DHCP 67, DNS 53, portal 80/443 on the LAN interface only, plus NAT via `/etc/ufw/before.rules`), or (b) disable ufw on gateway boxes and own the firewall with plain nftables, then re-assert via our post-update hook. Option (b) is simpler for NAT, per-kid rules and time-window rules, and nothing in Omarchy's update path force-re-enables ufw, but we diverge from a documented Omarchy default and should say so in our docs. Decision needed.
- NetworkManager vs systemd-networkd. Both managing interfaces at once is a known source of flapping. Rather than fighting NM, mark our LAN NIC unmanaged in NM (a drop-in in `/etc/NetworkManager/conf.d/` matching the interface) and let systemd-networkd handle just that interface, or simply configure the static LAN addressing through nmcli and skip networkd entirely. Either works; pick one and document it.
- Disk encryption vs appliance behaviour. This is the biggest practical fight. Default installs need the LUKS passphrase typed at the console on every boot. A gateway must survive a power cut unattended or the kids' internet stays down until a parent finds a keyboard. Options: the documented no-encryption install (Ctrl+C at the disk confirmation, see `manual/02-getting-started.md`), which is reasonable for a box holding only filtering config and logs, or LUKS with a keyfile or TPM unlock, which Omarchy does not support out of the box (it tells you to disable TPM). Recommend the no-encryption install for the gateway and say why.
- Rolling release churn. Arch moves fast even with Omarchy's one-month-behind stable mirror. Keep gateways on the stable channel, make our stack self-healing via the post-update hook, and test against edge ourselves.
- The desktop itself does not fight us. Hyprland and Quickshell are session-level; systemd services run regardless of whether anyone is logged in. Enable sshd (Setup > Security > SSHD) or preseed keys via the unattended install, put Tailscale on it (Omarchy has first-class Tailscale support, `manual/35-networking.md`), and the box runs headless happily. Sleep settings must be checked on laptops: mask suspend targets so closing the lid does not kill the network.
- systemd timers, sysctl forwarding, dnsmasq or Kea, hostapd: all standard Arch packages, nothing Omarchy-specific in the way.

## 4. The two-NIC scenarios

### Reference: old desktop or thin client plus USB ethernet dongle

This is the happy path. Onboard NIC as WAN uplink, USB 3.0 gigabit dongle (RTL8153 or AX88179 chipset, both mainlined in the kernel for years) as LAN, feeding the kids' existing Wi-Fi router flashed to dumb AP mode or any cheap AP. Wired NICs have none of the AP-mode problems below. Routing a household's 100-300 Mbps through a USB 3.0 gigabit dongle is trivial for any dual-core from the last decade.

### Laptop as gateway, its own Wi-Fi card broadcasting the kids' SSID

Be honest here: this works sometimes, and when it works it is still usually worse than a NZD 30 second-hand AP.

- Intel (iwlwifi), which is most laptops: AP mode is effectively 2.4 GHz only. The card's LAR (Location Aware Regulatory) logic resets the regulatory domain when hostapd starts, which marks all 5 GHz channels no-IR and hostapd cannot beacon on them. Workarounds exist but involve kernel patching. See https://vincent.bernat.ch/en/blog/2014-intel-7260-access-point and https://netdex.org/2022/07/20/iwlwifi-5g-ap/. 2.4 GHz AP mode does work and is stable enough for a handful of clients, but you get 2.4 GHz speeds and congestion.
- Broadcom (common in older HP and Dell, and all Intel-era Macs): the proprietary wl driver has no usable AP mode. Basically a no.
- Realtek (cheap laptops, most USB Wi-Fi sticks): patchy. Some chipsets need out-of-tree drivers where AP mode is broken or unstable.
- The good ones: Qualcomm Atheros (ath9k, ath10k, ath11k) and MediaTek (mt76, including the mt7612u and mt7921 families) have solid mainline AP support including 5 GHz. Many older ThinkPads can take a cheap Atheros card, and an mt7612u USB adapter (about USD 30) is a known-good hostapd radio.
- Even on a good chipset: client counts beyond roughly 8 to 15 get flaky on laptop silicon, there is no proper antenna placement, NetworkManager must be told to leave the AP interface alone, and every kernel update is a chance for a regression on the one box the household's internet depends on.

Practical guidance for the docs: laptop Wi-Fi AP is a supported "get started tonight" mode on 2.4 GHz only, with a detection script (`iw list` and check for AP in supported interface modes, and no-IR flags on 5 GHz channels). The recommended steady state is always ethernet out of the gateway into a real access point: the family's old router in AP mode, or any used AP. State plainly that if `iw list` shows no AP mode, a real AP is the only sensible option, not a workaround hunt.

## 5. Draft outline for SETUP-OMARCHY.md

1. What you need: a spare PC or laptop (64-bit, made roughly 2015 or later), a USB stick (8 GB or more), a USB ethernet dongle if the machine has only one network port, and your existing router or an old one to act as the kids' Wi-Fi access point.
2. Download and flash: get the ISO from https://omarchy.org, verify the signature (add `.sig` to the ISO URL, key fingerprint 40DFB630FF42BCFFB047046CF0134EE680CAC571), flash with balenaEtcher or caligula.
3. BIOS: disable Secure Boot and TPM. Set "restore power on AC loss" so the gateway comes back after a power cut.
4. Install: boot the stick, answer the wizard. Crucially, choose the no-encryption install (Ctrl+C at the disk formatting confirmation) so the box reboots unattended, and explain the trade-off. Mention the fully unattended `cidata` install with a `tailscale_authkey` as the advanced path.
5. First boot: run `omarchy update`. Install Tailscale via Install > Service > Tailscale and join the family tailnet. Enable SSH if wanted (Setup > Security > SSHD).
6. The agentic loop: open a terminal, run your preferred agent (`claude` is preinstalled as a stub, or pick one with `omarchy default agent`), then: `git clone https://github.com/<us>/hearth && cd hearth`, and tell the agent "read SETUP.md and set this machine up as our Hearth gateway". Our repo's AGENTS.md / CLAUDE.md carries the machine-facing instructions; SETUP-OMARCHY.md stays human-readable. Note that Omarchy's Setup > Security > Passwordless Sudo (15-minute window) exists exactly for long agent-driven system work.
7. Wire it up: WAN cable to the home router, LAN cable (or dongle) to the kids' AP. Diagram.
8. Verify: the agent runs our checklist (DHCP lease appears, DNS filtered, portal loads, time budget ticks). Parent-facing smoke tests.
9. Staying current: always `omarchy update`, never `pacman -Syu` (Omarchy blocks it anyway). Our post-update hook re-asserts the gateway config. What to do after a snapshot rollback: re-run our installer.
10. When things break: boot a pre-update snapshot from Limine, the #omarchy-help Discord for Omarchy issues, our issues for Hearth issues.

Licensing and trademark notes for our docs: Omarchy's code is MIT so technical reuse is fine. The Omarchy name and trademarks are held by the Omacom Foundation (a Canadian trademark registration for OMARCHY exists, https://ised-isde.canada.ca/cipo/trademark-search/2429559), and no public trademark usage policy has been published yet. So: nominative use only ("runs great on Omarchy", "Omarchy is a trademark of the Omacom Foundation"), no Omarchy logo in our materials, nothing implying endorsement by Omarchy, 37signals or DHH, and do not name the product anything Omarchy-like. Worth emailing the foundation for a nod before we print "for Omarchy" on anything.

## 6. Cheap hardware sweet spots

- Used 1-litre tiny PCs: Lenovo ThinkCentre M710q/M910q/M720q, Dell OptiPlex Micro, HP EliteDesk Mini. Roughly NZD 100-250 used, silent, low power (10-15 W idle), one gigabit NIC plus USB 3.0 ports for the dongle. The M720q can even take a low-profile PCIe NIC. The reference target.
- The family's retired laptop: ThinkPad T450 to T490 class and similar. Free, has a built-in UPS (the battery), one NIC (or none on thin models, so possibly two dongles). Wi-Fi AP caveats from section 4 apply; treat its radio as bonus, not the plan. Check lid-close and suspend settings.
- Old desktop towers: free and fine, but 40-80 W idle costs real money at NZ power prices (roughly NZD 100-200 per year more than a tiny PC).
- New budget option: N100/N150 mini PCs, including dual-ethernet "firewall" boxes from Beelink, GMKtec and friends, roughly NZD 250-400 new. Two real Intel NICs, no dongle needed, well within Omarchy's comfort zone.
- USB gigabit dongles: RTL8153 around USD 12 and AX88179 around USD 15 from US retailers (https://www.aliexpress.com/s/wiki-ssr/article/ax88179-vs-rtl8153); in NZ expect roughly NZD 20-45 retail. Both chipsets are plug-and-play on the Arch kernel. Prefer a named brand (TP-Link UE300 class) over the cheapest generic for thermals.
- Access point for the kids' SSID: the household's previous router in AP/bridge mode (free), or a used consumer AP for NZD 20-50. Always cheaper and better than fighting laptop hostapd.

## Open questions

1. Firewall stance: express Hearth rules through ufw (stay on Omarchy defaults) or disable ufw and own nftables outright? Needs a spike on NAT plus per-kid time rules under ufw's before.rules.
2. Does anything in Omarchy's update or `omarchy reinstall` path ever re-enable ufw or rewrite `/etc/NetworkManager/conf.d/` drop-ins? Needs an empirical test across two or three releases; nothing in the current migrations suggests it, but migrations land weekly.
3. Headless robustness: has anyone run Omarchy long-term with no monitor attached? SDDM and Hyprland idling at a login screen should be harmless, but confirm nothing (idle, suspend, session logic) misbehaves headless, especially on laptops with the lid closed.
4. Encryption story: is there parent appetite for LUKS with TPM or keyfile auto-unlock even though Omarchy tells users to disable TPM, or is the no-encryption install acceptable given the box holds only filtering config and browsing logs (which are themselves sensitive)?
5. Trademark: get written guidance from the Omacom Foundation on "runs on Omarchy" wording before public launch. No usage policy is published as of late August 2026.
6. Omarchy churn risk: v4.0 replaced eight desktop components with one Quickshell process in a single release. Our integration touches none of that layer, but confirm each major release against a test gateway before recommending parents update.
7. Minimum spec claim: no official Omarchy minimum exists. Before our docs promise "2015 or later, 4 GB RAM", verify install and idle footprint on the weakest reference box we actually recommend.
8. Laptop AP detection: build and test the `iw list` capability check on a handful of common chipsets (Intel AX200/AX201, ath9k, mt7921) so SETUP-OMARCHY.md can give a definitive yes/no rather than hedging.
