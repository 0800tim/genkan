-- Domains/patterns that should raise an ALERT when a device reaches them, over
-- and above ordinary category blocking. This is the "tell me about the genuinely
-- concerning stuff" layer: Tor/darknet signals, self-harm (a CARE alert, never a
-- punishment), and known-serious categories. The alert is a conversation
-- prompt, not a verdict.
CREATE TABLE IF NOT EXISTS flag_domains (
  id       serial PRIMARY KEY,
  pattern  text NOT NULL,          -- matched as a domain suffix (ILIKE '%'||pattern)
  category text NOT NULL,          -- tor | self-harm | drugs | extreme | ...
  severity text NOT NULL DEFAULT 'warn',   -- info | warn | urgent
  note     text
);
CREATE UNIQUE INDEX IF NOT EXISTS flag_domains_pat ON flag_domains(pattern);

INSERT INTO flag_domains(pattern, category, severity, note) VALUES
 -- Tor / darknet signals. Reaching these is worth a quiet word: it can be
 -- curiosity, or it can be an attempt to reach a darknet market. Alert, ask.
 ('torproject.org','tor','warn','downloading Tor'),
 ('bridges.torproject.org','tor','urgent','fetching Tor bridges (evading a block)'),
 ('snowflake.torproject.org','tor','urgent','Tor pluggable transport'),
 ('dist.torproject.org','tor','warn','Tor download mirror'),
 ('torrentproject','tor','info','torrent site (name collision, low signal)'),
 -- Darknet market lookups often go via clearnet directories first.
 ('dark.fail','drugs','urgent','darknet market directory'),
 ('tor.taxi','drugs','urgent','darknet market directory'),
 -- Self-harm: a CARE signal. Never disciplinary. Help lines stay reachable.
 ('sanctioned-suicide','self-harm','urgent','pro-self-harm forum'),
 -- Known VPN-to-bypass (already in the proxy-vpn category, flagged for the alert).
 ('nordvpn.com','proxy-vpn','info','VPN download'),
 ('protonvpn.com','proxy-vpn','info','VPN download')
ON CONFLICT (pattern) DO NOTHING;

-- Tor/darknet layer, second pass (config/adguard/tor-and-serious.md).
-- Separate INSERT so this file stays additive: re-running it never deletes or
-- rewrites a row, and ON CONFLICT DO NOTHING keeps a hand-tuned severity.
--
-- Suffix matching is 'domain ILIKE %'||pattern', so every pattern here must be
-- a full label or a dotted suffix. '.onion' is safe because it can only match
-- the TLD; a bare 'onion' would match funonion.com and must never be added.
INSERT INTO flag_domains(pattern, category, severity, note) VALUES
 -- Tor on-ramps not already seeded above.
 ('tor.eff.org','tor','warn','Tor mirror alias'),
 -- .onion names never resolve on the public DNS (RFC 7686), so one reaching
 -- our resolver means a device is trying a hidden service with no working
 -- tunnel. Pure signal: nothing to block, alert only.
 ('.onion','darknet','urgent','.onion query leaked to our resolver (Tor attempt)'),
 -- Onion gateways (tor2web): these serve .onion sites to an ordinary browser
 -- with no Tor install at all, which makes them the most kid-reachable path
 -- into darknet content. Operators come and go, so the list is generous;
 -- flagging a dead one costs nothing.
 ('onion.to','darknet','urgent','onion gateway (darknet via plain browser)'),
 ('onion.ws','darknet','urgent','onion gateway'),
 ('onion.pet','darknet','urgent','onion gateway'),
 ('onion.ly','darknet','urgent','onion gateway'),
 ('onion.sh','darknet','urgent','onion gateway'),
 ('onion.top','darknet','urgent','onion gateway'),
 ('onion.city','darknet','urgent','onion gateway'),
 ('onion.cab','darknet','urgent','onion gateway'),
 ('onion.direct','darknet','urgent','onion gateway'),
 ('onion.plus','darknet','urgent','onion gateway'),
 ('tor2web.org','darknet','urgent','onion gateway project site'),
 ('tor2web.io','darknet','urgent','onion gateway'),
 ('tor2web.fi','darknet','urgent','onion gateway'),
 -- Clearnet directories and market indexes: how a kid finds a market first.
 ('onion.live','darknet','urgent','darknet market directory'),
 ('darknetlive.com','darknet','urgent','darknet news and market directory'),
 ('daunt.link','darknet','urgent','darknet link directory')
ON CONFLICT (pattern) DO NOTHING;

GRANT SELECT ON flag_domains TO kids_app;
