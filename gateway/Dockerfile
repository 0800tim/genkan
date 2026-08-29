# The Hearth gateway container. Owns the kids' island and NOTHING else.
#
# Isolation model: this container runs with its own network namespace holding
# exactly two interfaces: eth0 (an ordinary Docker bridge uplink) and kids0
# (the physical USB NIC, handed in by host/kids-nic-warden.sh after start).
# All firewall rules load INSIDE this namespace, so a bad rule here cannot
# touch the host's firewall, the main LAN or the tailnet: those interfaces do
# not exist in this container's world. Capabilities: NET_ADMIN + NET_RAW only,
# never privileged, never host networking.
#
# Build context is the repo root (see compose.yaml) so the one canonical
# ruleset config/nftables/kids.nft is the one baked in.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      nftables iproute2 iputils-ping tcpdump postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY config/nftables/kids.nft /etc/kids.nft
COPY gateway/entrypoint.sh /entrypoint.sh
# No nft -c here: even a check needs netlink, which unprivileged build steps
# lack. deploy.sh and the test rig both validate the ruleset before this image
# ever runs.
RUN chmod 0755 /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
