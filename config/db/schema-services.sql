-- Per-SERVICE traffic accounting (YouTube, Netflix, TikTok, Roblox, ...).
--
-- Why this can work at all: we are the DNS server, so when a device resolves
-- googlevideo.com we learn which IPs belong to YouTube and can then count
-- BYTES to those IPs in the firewall, without decrypting anything. That gives
-- a real data-volume figure per service per device, not a guess.
--
-- Honest limits, which the dashboard must state:
--  * Services sharing infrastructure blur together (YouTube and other Google
--    video ride the same CDN names; YouTube Music counts as YouTube).
--  * A CDN address serving several services attributes to whichever service
--    resolved it most recently for that device.
--  * A VPN hides destinations entirely, so its traffic is uncategorised.
--  * Bytes are not minutes. Both are reported; neither is the whole story.

CREATE TABLE IF NOT EXISTS services (
  id       serial PRIMARY KEY,
  name     text NOT NULL UNIQUE,       -- youtube | netflix | tiktok | roblox ...
  label    text NOT NULL,              -- "YouTube", "Netflix"
  category text NOT NULL,              -- video | gaming | social | audio | schoolwork
  emoji    text,
  metered  boolean NOT NULL DEFAULT true
);

-- Domain suffixes that identify a service. Matched as a suffix of the
-- looked-up name, longest match wins.
CREATE TABLE IF NOT EXISTS service_domains (
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  domain     text NOT NULL,
  PRIMARY KEY (service_id, domain)
);

-- IPs learned from DNS answers, per service. TTL'd by `seen`.
CREATE TABLE IF NOT EXISTS service_ips (
  ip         inet NOT NULL,
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  seen       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, service_id)
);
CREATE INDEX IF NOT EXISTS service_ips_seen ON service_ips(seen);

-- Daily rollup per child per service: real bytes from the firewall counters,
-- plus active minutes on the same threshold rule the category meter uses.
CREATE TABLE IF NOT EXISTS service_usage (
  child_id   int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day        date NOT NULL,
  service_id int NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  bytes      bigint NOT NULL DEFAULT 0,
  used_min   int NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, day, service_id)
);

INSERT INTO services (name,label,category,emoji,metered) VALUES
 ('youtube','YouTube','video','📺',true),
 ('netflix','Netflix','video','🎬',true),
 ('disneyplus','Disney+','video','🏰',true),
 ('primevideo','Prime Video','video','📦',true),
 ('tiktok','TikTok','video','🎵',true),
 ('twitch','Twitch','video','🎮',true),
 ('instagram','Instagram','social','📸',true),
 ('snapchat','Snapchat','social','👻',true),
 ('roblox','Roblox','gaming','🧱',true),
 ('fortnite','Fortnite','gaming','🔫',true),
 ('steam','Steam','gaming','🎯',true),
 ('minecraft','Minecraft','gaming','⛏️',true),
 ('spotify','Spotify','audio','🎧',false),
 ('khanacademy','Khan Academy','schoolwork','📚',false),
 ('googleclassroom','Google Classroom','schoolwork','🎓',false),
 -- Added because they are what a family actually uses. A service is metered
 -- when we want its BYTES named on the live view; the time budget is per
 -- CATEGORY, so a metered messaging or audio service is measured and labelled
 -- without ever costing a child a minute (METERING.md).
 ('facebook','Facebook','social','👍',true),
 ('x','X','social','✖️',true),
 ('reddit','Reddit','social','👽',true),
 ('discord','Discord','social','💬',true),
 ('pinterest','Pinterest','social','📌',true),
 ('whatsapp','WhatsApp','messaging','💬',true),
 ('telegram','Telegram','messaging','✈️',true),
 ('playstation','PlayStation','gaming','🎮',true),
 ('xbox','Xbox','gaming','🟩',true),
 ('nintendo','Nintendo','gaming','🍄',true),
 ('riot','Riot Games','gaming','⚔️',true),
 ('battlenet','Battle.net','gaming','❄️',true),
 ('applemusic','Apple Music','audio','🍎',false),
 ('soundcloud','SoundCloud','audio','🔊',false),
 ('duolingo','Duolingo','schoolwork','🦉',false),
 -- Regional catch-up, streaming, sport and music services (2026-08-30).
 -- The seed was very American: no New Zealand, Australian, UK, Canadian or
 -- Irish household could meter its own catch-up TV. Every domain below was
 -- checked with `getent ahostsv4` before it went in. See docs/SERVICES.md
 -- for how a household adds the next one.
 --
 -- New Zealand
 ('tvnzplus','TVNZ+','video','📺',true),
 ('threenow','ThreeNow','video','📺',true),
 ('neon','Neon','video','🎬',true),
 ('skygonz','Sky Go (NZ)','video','🏉',true),
 ('skysportnow','Sky Sport Now','video','🏏',true),
 ('maoritv','Māori Television','video','🎬',true),
 ('rnz','RNZ','audio','📻',false),
 -- Australia
 ('abciview','ABC iview','video','📺',true),
 ('sbsondemand','SBS On Demand','video','📺',true),
 ('ninenow','9Now','video','📺',true),
 ('sevenplus','7plus','video','📺',true),
 ('tenplay','10 play','video','📺',true),
 ('stan','Stan','video','🎬',true),
 ('kayosports','Kayo Sports','video','🏉',true),
 ('binge','Binge','video','🎬',true),
 ('foxtel','Foxtel','video','📡',true),
 -- United Kingdom
 ('bbciplayer','BBC iPlayer','video','📺',true),
 ('itvx','ITVX','video','📺',true),
 ('channel4','Channel 4','video','📺',true),
 ('my5','My5','video','📺',true),
 ('nowtv','NOW','video','🎬',true),
 ('skygouk','Sky Go (UK)','video','🎬',true),
 ('tntsports','TNT Sports','video','🏉',true),
 -- Canada
 ('cbcgem','CBC Gem','video','📺',true),
 ('crave','Crave','video','🎬',true),
 ('citytv','Citytv','video','📺',true),
 ('globaltv','Global TV','video','📺',true),
 ('tsn','TSN','video','🏒',true),
 ('sportsnet','Sportsnet','video','🏒',true),
 -- Ireland
 ('rteplayer','RTÉ Player','video','📺',true),
 ('virginmediaplay','Virgin Media Play','video','📺',true),
 -- Genuinely global gaps: a gaming platform and two music services with no
 -- US-centric equivalent already in the seed.
 ('hoyoverse','HoYoverse','gaming','⚔️',true),
 ('amazonmusic','Amazon Music','audio','🎧',false),
 ('deezer','Deezer','audio','🎧',false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO service_domains (service_id, domain)
SELECT s.id, d.domain FROM (VALUES
 ('youtube','youtube.com'),('youtube','googlevideo.com'),('youtube','ytimg.com'),('youtube','youtu.be'),('youtube','youtube-nocookie.com'),
 ('netflix','netflix.com'),('netflix','nflxvideo.net'),('netflix','nflxso.net'),('netflix','nflximg.net'),
 ('disneyplus','disneyplus.com'),('disneyplus','disney-plus.net'),('disneyplus','dssott.com'),
 ('primevideo','primevideo.com'),('primevideo','aiv-cdn.net'),('primevideo','avodmp4s3ww-a.akamaihd.net'),
 ('tiktok','tiktok.com'),('tiktok','tiktokcdn.com'),('tiktok','byteoversea.com'),('tiktok','ibytedtos.com'),
 ('twitch','twitch.tv'),('twitch','ttvnw.net'),('twitch','jtvnw.net'),
 ('instagram','instagram.com'),('instagram','cdninstagram.com'),
 ('snapchat','snapchat.com'),('snapchat','sc-cdn.net'),('snapchat','snap.com'),
 ('roblox','roblox.com'),('roblox','rbxcdn.com'),('roblox','robloxlabs.com'),
 ('fortnite','fortnite.com'),('fortnite','epicgames.com'),('fortnite','unrealengine.com'),
 ('steam','steampowered.com'),('steam','steamcommunity.com'),('steam','steamstatic.com'),
 ('minecraft','minecraft.net'),('minecraft','minecraftservices.com'),
 ('spotify','spotify.com'),('spotify','scdn.co'),('spotify','spotifycdn.com'),
 ('khanacademy','khanacademy.org'),('khanacademy','kastatic.org'),
 ('googleclassroom','classroom.google.com'),
 -- The CDN names matter more than the front door: the front door is a few
 -- kilobytes of HTML, the CDN is the gigabytes. Longest suffix wins, so a
 -- download CDN sitting under a service's own domain still resolves to the
 -- download CATEGORY in category_domains while staying named as that service
 -- here.
 ('youtube','yt3.ggpht.com'),('youtube','youtubei.googleapis.com'),
 ('netflix','nflxext.com'),
 ('primevideo','aiv-delivery.net'),
 ('tiktok','tiktokv.com'),('tiktok','tiktokcdn-us.com'),('tiktok','muscdn.com'),
 ('instagram','instagram.c10r.facebook.com'),
 ('roblox','rbxinfra.com'),
 ('fortnite','epicgames.dev'),
 ('steam','steamserver.net'),('steam','steamcontent.com'),('steam','valve.net'),
 ('minecraft','mojang.com'),
 ('spotify','audio-fa.scdn.co'),
 ('facebook','facebook.com'),('facebook','fbcdn.net'),('facebook','facebook.net'),
 ('facebook','messenger.com'),('facebook','fb.com'),
 ('x','x.com'),('x','twitter.com'),('x','twimg.com'),('x','t.co'),
 ('reddit','reddit.com'),('reddit','redd.it'),('reddit','redditmedia.com'),('reddit','redditstatic.com'),
 ('discord','discord.com'),('discord','discordapp.com'),('discord','discordapp.net'),
 ('discord','discord.gg'),('discord','discord.media'),
 ('pinterest','pinterest.com'),('pinterest','pinimg.com'),
 ('whatsapp','whatsapp.com'),('whatsapp','whatsapp.net'),
 ('telegram','telegram.org'),('telegram','t.me'),('telegram','telegram.me'),
 ('playstation','playstation.com'),('playstation','playstation.net'),
 ('playstation','sonyentertainmentnetwork.com'),
 ('xbox','xbox.com'),('xbox','xboxlive.com'),('xbox','xboxservices.com'),
 ('nintendo','nintendo.com'),('nintendo','nintendo.net'),('nintendo','nintendowifi.net'),
 ('riot','riotgames.com'),('riot','leagueoflegends.com'),('riot','riotcdn.net'),
 ('battlenet','battle.net'),('battlenet','blizzard.com'),('battlenet','activision.com'),
 ('applemusic','music.apple.com'),
 ('soundcloud','soundcloud.com'),('soundcloud','sndcdn.com'),
 ('duolingo','duolingo.com'),
 -- Regional additions (2026-08-30). Where a service's own domain also
 -- carries a broadcaster's general news site, that is noted per country
 -- below rather than repeated on every line.
 --
 -- New Zealand. tvnz.co.nz and threenow.co.nz are already video domains in
 -- category_domains; this just names the service they belong to.
 ('tvnzplus','tvnz.co.nz'),
 ('threenow','threenow.co.nz'),
 -- 3now.co.nz, tv3.co.nz, choicetv.co.nz, hgtv.co.nz and amshow.co.nz are
 -- the other channel brands Warner Bros Discovery NZ streams through the
 -- same ThreeNow catalogue. newshub.co.nz is deliberately left out: it is
 -- Warner Bros Discovery NZ's news site, not video.
 ('threenow','3now.co.nz'),('threenow','tv3.co.nz'),('threenow','choicetv.co.nz'),
 ('threenow','hgtv.co.nz'),('threenow','amshow.co.nz'),
 -- Neon and Lightbox (its previous name) share the same Sky-owned backend.
 ('neon','neontv.co.nz'),('neon','api.neontv.co.nz'),('neon','lightbox.co.nz'),
 -- Sky Go (NZ) and Sky Sport Now share Sky's account domain (sky.co.nz) and
 -- an Akamai-hosted video path under skygo.co.nz; dashvod/hlsvod are the
 -- actual video bytes, sky.co.nz is mostly login and EPG.
 ('skygonz','skygo.co.nz'),('skygonz','sky.co.nz'),('skygonz','dashvod.skygo.co.nz'),
 ('skygonz','hlsvod.skygo.co.nz'),('skygonz','prod.dashlive.skygo.co.nz'),
 ('skygonz','prod-ak.ws.skygo.co.nz'),
 ('skysportnow','skysportnow.co.nz'),('skysportnow','skysport.co.nz'),
 ('maoritv','maoritelevision.com'),('maoritv','whakaatamaori.co.nz'),
 ('rnz','rnz.co.nz'),
 -- Australia. abc.net.au and sbs.com.au are each a full news broadcaster's
 -- site, not a video domain, so only the dedicated iview/on-demand hosts
 -- are named here; the bare apex is deliberately left out.
 ('abciview','iview.abc.net.au'),('abciview','streaming.c3.abc.net.au'),
 ('sbsondemand','sbsondemand.com'),
 ('ninenow','9now.com.au'),
 ('sevenplus','7plus.com.au'),
 ('tenplay','10play.com.au'),
 ('stan','stan.com.au'),('stan','api.stan.com.au'),
 ('kayosports','kayosports.com.au'),
 ('binge','binge.com.au'),
 -- streamotion.com.au is the Foxtel Group's shared login/playback backend
 -- for Kayo, Binge and Foxtel: one company's own infrastructure, not a
 -- third-party CDN, so it is named here rather than left out, but a Kayo or
 -- Binge session can show up counted as Foxtel.
 ('foxtel','foxtel.com.au'),('foxtel','streamotion.com.au'),('foxtel','auth.streamotion.com.au'),
 -- United Kingdom. bbc.co.uk and bbc.com carry BBC News, Sport and Weather
 -- as well as iPlayer; BBC Sounds uses the same domain too, so (like
 -- YouTube Music counting as YouTube) BBC Sounds listening counts as
 -- iPlayer video, not audio. itv.com and channel4.com are the same
 -- broadcaster-does-everything shape.
 ('bbciplayer','bbc.co.uk'),('bbciplayer','bbc.com'),('bbciplayer','bbci.co.uk'),
 ('bbciplayer','open.live.bbc.co.uk'),
 ('itvx','itv.com'),('itvx','itvx.com'),('itvx','hls.itvstatic.com'),
 ('channel4','channel4.com'),
 ('my5','my5.tv'),
 ('nowtv','nowtv.com'),('nowtv','nowtv.co.uk'),
 -- Sky UK is a different company from Sky NZ (they have shared a brand
 -- name since a historical licence, not a shared network); no dedicated
 -- video CDN host for Sky Go UK was confirmed, so only the account domain
 -- is named. bt.com is BT's whole broadband/mobile corporate site and is
 -- deliberately left out; tntsports.co.uk and its legacy btsport.com name
 -- are TNT Sports' own dedicated streaming domains.
 ('skygouk','sky.com'),
 ('tntsports','tntsports.co.uk'),('tntsports','btsport.com'),
 -- Canada. cbc.ca is CBC's whole news site, so only its dedicated video
 -- subdomain is named. globalnews.ca (Global's news site) is a separate
 -- domain from globaltv.com and is correctly not listed here.
 ('cbcgem','gem.cbc.ca'),
 ('crave','crave.ca'),
 ('citytv','citytv.com'),
 ('globaltv','globaltv.com'),
 ('tsn','tsn.ca'),
 ('sportsnet','sportsnet.ca'),
 -- Ireland. rte.ie is RTÉ's whole news site, so only the dedicated player
 -- domain is named.
 ('rteplayer','rteplayer.ie'),
 ('virginmediaplay','virginmediatelevision.ie'),
 -- Genuinely global gaps.
 ('hoyoverse','hoyoverse.com'),('hoyoverse','mihoyo.com'),
 ('amazonmusic','music.amazon.com'),
 ('deezer','deezer.com')
) AS d(sname,domain) JOIN services s ON s.name=d.sname
ON CONFLICT DO NOTHING;

GRANT SELECT ON services, service_domains, service_ips, service_usage TO kids_app;
