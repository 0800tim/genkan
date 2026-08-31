#!/usr/bin/env bash
# genkan:summary=Set up a fresh Omarchy (or any Arch) box as a Genkan gateway.
#
# The one command a parent's agent runs after cloning the repo on the gateway
# box. Idempotent. Everything here is host preparation; the gateway itself
# runs in containers (see compose.yaml) and cannot touch the host network.
#
# Runbook for humans + agents: docs/runbooks/omarchy-install.md
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
log(){ printf '\033[38;5;208m[genkan]\033[0m %s\n' "$*"; }
ask(){ read -rp "  $1 " REPLY; echo "$REPLY"; }

[ "$(id -u)" = 0 ] && { echo "Run as your normal user, not root. It will sudo when needed."; exit 1; }

log "Checking the essentials..."
need=(); for c in docker git; do command -v "$c" >/dev/null || need+=("$c"); done
if [ "${#need[@]}" -gt 0 ]; then
  if command -v pacman >/dev/null; then
    log "Installing: ${need[*]} (Arch/Omarchy)"; sudo pacman -S --needed --noconfirm docker docker-compose git
  else
    echo "Please install: ${need[*]} then re-run."; exit 1
  fi
fi
sudo systemctl enable --now docker 2>/dev/null || true
groups | grep -qw docker || { log "Adding you to the docker group (log out/in after)"; sudo usermod -aG docker "$USER"; }

# config.env: the per-home values. Ask for the USB NIC if not set.
if [ ! -f "$R/config.env" ]; then
  cp "$R/config.env.example" "$R/config.env"
  log "Which network adapter is for the KIDS side? Plug in the USB dongle now."
  echo "  Interfaces seen:"; ip -o link show | awk -F': ' '{print "    "$2}' | grep -v lo
  MAC="$(ask 'Paste the kids adapter MAC (aa:bb:cc:dd:ee:ff):')"
  sed -i "s|^KIDS_NIC_MAC=.*|KIDS_NIC_MAC=$MAC|" "$R/config.env"
  chmod 600 "$R/config.env"
  log "Saved to config.env (gitignored, stays on this box)."
fi

# secrets.env: DB URLs. Generated fresh; the DB is provisioned by compose.
if [ ! -f "$R/secrets.env" ]; then
  cp "$R/secrets.env.example" "$R/secrets.env"; chmod 600 "$R/secrets.env"
  log "Created secrets.env. Set your KIDS_DB_URL / KIDS_DB_URL_DOCKER before deploy."
fi

# NetworkManager: hand the kids NIC to us, not NM, so they don't fight.
. "$R/config.env"
if command -v nmcli >/dev/null && [ -n "${KIDS_NIC_MAC:-}" ]; then
  DROP=/etc/NetworkManager/conf.d/99-genkan-kids-nic.conf
  if [ ! -f "$DROP" ]; then
    log "Telling NetworkManager to leave the kids NIC alone..."
    printf '[keyfile]\nunmanaged-devices=mac:%s\n' "$KIDS_NIC_MAC" | sudo tee "$DROP" >/dev/null
    sudo systemctl reload NetworkManager 2>/dev/null || true
  fi
fi

# Omarchy post-update hook: keep the island up across `omarchy update`.
if [ -d "$HOME/.config/omarchy" ]; then
  HOOK="$HOME/.config/omarchy/hooks/post-update"
  mkdir -p "$(dirname "$HOOK")"
  if [ ! -f "$HOOK" ] || ! grep -q genkan "$HOOK"; then
    log "Adding an Omarchy post-update hook so updates never drop the island."
    { echo '#!/usr/bin/env bash'; echo "cd '$R' && docker compose --profile island up -d"; } >> "$HOOK"
    chmod +x "$HOOK"
  fi
fi

log "Host prep done. Next: sudo ./deploy.sh   (validates, builds, starts the island)"
log "Then talk to your agent: see docs/AGENT.md"
