-- Live per-child category blocks, e.g. gaming, social, streaming, all.
-- "kill Ben's gaming" = upsert (Ben,'gaming',true). Cleared when off.
CREATE TABLE IF NOT EXISTS category_state (
  child_id  int REFERENCES children(id) ON DELETE CASCADE,
  category  text NOT NULL,          -- gaming | social | streaming | adult | all | ...
  blocked   boolean NOT NULL DEFAULT false,
  since     timestamptz DEFAULT now(),
  until_ts  timestamptz,            -- optional auto-expiry (e.g. "for 2 hours")
  set_by    text,
  PRIMARY KEY (child_id, category)
);
-- Reference: which domains/keywords define each blockable category.
CREATE TABLE IF NOT EXISTS category_domains (
  category text NOT NULL,
  domain   text NOT NULL,
  PRIMARY KEY (category, domain)
);

-- ---------------------------------------------------------------------------
-- The domain -> category map. This is the whole basis of per-category
-- metering: we are the resolver, so a lookup here tells us which addresses a
-- device is about to talk to, and the firewall counts bytes to those
-- addresses. An empty or thin map means the meter has nothing to count and
-- every byte falls through to "other", which is exactly what happened on the
-- first box (the map was typed in by hand and never made it into the repo).
--
-- What matters far more than the front door is the CDN name the bytes
-- actually come from: nobody streams from netflix.com, they stream from
-- nflxvideo.net. Both are listed, and the longest suffix always wins.
--
-- Categories:
--   gaming     playing. Metered.
--   video      watching. Metered.
--   social     scrolling. Metered (counted through the per-service sets).
--   download   content delivery: a game update, an OS update, an app install.
--              Bandwidth, not screen time, so it is charted and reported but
--              NEVER charged to a child's budget. See METERING.md.
--   audio      listening. Never metered.
--   messaging  talking to people. Never metered.
--   schoolwork Never metered.
--
-- download suffixes are deliberately longer than the gaming suffix they sit
-- under (cs.steampowered.com beats steampowered.com), so a Steam download is
-- classified as a download while the game itself stays gaming.
INSERT INTO category_domains (category, domain) VALUES
 -- ---- video ----
 ('video','youtube.com'),('video','youtu.be'),('video','youtube-nocookie.com'),
 ('video','googlevideo.com'),('video','ytimg.com'),('video','ggpht.com'),
 ('video','netflix.com'),('video','nflxvideo.net'),('video','nflxso.net'),
 ('video','nflximg.net'),('video','nflxext.com'),
 ('video','disneyplus.com'),('video','disney-plus.net'),('video','dssott.com'),
 ('video','bamgrid.com'),('video','disneystreaming.com'),
 ('video','primevideo.com'),('video','aiv-cdn.net'),('video','aiv-delivery.net'),
 ('video','tiktok.com'),('video','tiktokcdn.com'),('video','tiktokcdn-us.com'),
 ('video','tiktokv.com'),('video','byteoversea.com'),('video','ibytedtos.com'),
 ('video','muscdn.com'),('video','ttwstatic.com'),
 ('video','twitch.tv'),('video','ttvnw.net'),('video','jtvnw.net'),
 ('video','vimeo.com'),('video','vimeocdn.com'),
 ('video','hulu.com'),('video','hulustream.com'),
 ('video','crunchyroll.com'),('video','vrv.co'),
 ('video','tvnz.co.nz'),('video','threenow.co.nz'),
 ('video','dailymotion.com'),('video','dmcdn.net'),
 -- ---- video: New Zealand, Australia, UK, Canada, Ireland (2026-08-30) ----
 -- Added because a New Zealand household's children watch these and none of
 -- them were in the seed; the same gap holds for AU/UK/CA/IE. Every domain
 -- here was checked with `getent ahostsv4` first. Where a broadcaster's main
 -- domain also carries its general news site (bbc.co.uk, itv.com,
 -- channel4.com), it stays in because there is no separate video-only
 -- domain to use instead; a short news read is a burst, not the sustained
 -- throughput the active-minute threshold looks for, same protection RNZ
 -- and TVNZ already rely on above. Where the news site is a genuinely
 -- separate domain (ABC, SBS, CBC, RTÉ), the news domain is left out and
 -- only the dedicated video domain is listed. See docs/SERVICES.md.
 ('video','3now.co.nz'),('video','tv3.co.nz'),('video','choicetv.co.nz'),
 ('video','hgtv.co.nz'),('video','amshow.co.nz'),
 ('video','neontv.co.nz'),('video','api.neontv.co.nz'),('video','lightbox.co.nz'),
 ('video','skygo.co.nz'),('video','sky.co.nz'),
 ('video','dashvod.skygo.co.nz'),('video','hlsvod.skygo.co.nz'),
 ('video','prod.dashlive.skygo.co.nz'),('video','prod-ak.ws.skygo.co.nz'),
 ('video','skysportnow.co.nz'),('video','skysport.co.nz'),
 ('video','maoritelevision.com'),('video','whakaatamaori.co.nz'),
 ('video','iview.abc.net.au'),('video','streaming.c3.abc.net.au'),
 ('video','sbsondemand.com'),
 ('video','9now.com.au'),('video','7plus.com.au'),('video','10play.com.au'),
 ('video','stan.com.au'),('video','api.stan.com.au'),
 ('video','kayosports.com.au'),('video','binge.com.au'),
 ('video','foxtel.com.au'),('video','streamotion.com.au'),('video','auth.streamotion.com.au'),
 ('video','bbc.co.uk'),('video','bbc.com'),('video','bbci.co.uk'),('video','open.live.bbc.co.uk'),
 ('video','itv.com'),('video','itvx.com'),('video','hls.itvstatic.com'),
 ('video','channel4.com'),
 ('video','my5.tv'),
 ('video','nowtv.com'),('video','nowtv.co.uk'),
 ('video','sky.com'),
 ('video','tntsports.co.uk'),('video','btsport.com'),
 ('video','gem.cbc.ca'),('video','crave.ca'),('video','citytv.com'),
 ('video','globaltv.com'),('video','tsn.ca'),('video','sportsnet.ca'),
 ('video','rteplayer.ie'),('video','virginmediatelevision.ie'),
 -- ---- social ----
 ('social','instagram.com'),('social','cdninstagram.com'),
 ('social','facebook.com'),('social','fbcdn.net'),('social','facebook.net'),('social','fb.com'),
 ('social','snapchat.com'),('social','sc-cdn.net'),('social','snap.com'),('social','snapkit.com'),
 ('social','x.com'),('social','twitter.com'),('social','twimg.com'),('social','t.co'),
 ('social','reddit.com'),('social','redd.it'),('social','redditmedia.com'),('social','redditstatic.com'),
 ('social','discord.com'),('social','discordapp.com'),('social','discordapp.net'),
 ('social','discord.gg'),('social','discord.media'),
 ('social','pinterest.com'),('social','pinimg.com'),
 ('social','tumblr.com'),('social','threads.net'),
 -- ---- gaming (playing, not downloading) ----
 ('gaming','roblox.com'),('gaming','rbxcdn.com'),('gaming','robloxlabs.com'),('gaming','rbxinfra.com'),
 ('gaming','minecraft.net'),('gaming','minecraftservices.com'),('gaming','mojang.com'),
 ('gaming','epicgames.com'),('gaming','fortnite.com'),('gaming','unrealengine.com'),('gaming','epicgames.dev'),
 ('gaming','steampowered.com'),('gaming','steamcommunity.com'),('gaming','steamstatic.com'),
 ('gaming','steamserver.net'),('gaming','valve.net'),
 ('gaming','playstation.com'),('gaming','playstation.net'),('gaming','sonyentertainmentnetwork.com'),
 ('gaming','xbox.com'),('gaming','xboxlive.com'),('gaming','xboxservices.com'),
 ('gaming','nintendo.com'),('gaming','nintendo.net'),('gaming','nintendowifi.net'),
 ('gaming','battle.net'),('gaming','blizzard.com'),('gaming','activision.com'),
 ('gaming','ea.com'),('gaming','easports.com'),('gaming','origin.com'),
 ('gaming','riotgames.com'),('gaming','leagueoflegends.com'),('gaming','riotcdn.net'),
 ('gaming','ubisoft.com'),('gaming','ubi.com'),
 ('gaming','supercell.com'),('gaming','supercellgames.com'),
 ('gaming','miniclip.com'),('gaming','poki.com'),('gaming','coolmathgames.com'),('gaming','crazygames.com'),
 ('gaming','hoyoverse.com'),('gaming','mihoyo.com'),
 -- ---- download: bandwidth, never screen time ----
 ('download','steamcontent.com'),('download','cs.steampowered.com'),
 ('download','steamcdn-a.akamaihd.net'),('download','client-download.steamstatic.com'),
 ('download','download.epicgames.com'),('download','epicgames-download1.akamaized.net'),
 ('download','fastly-download.epicgames.com'),('download','epicgamescdn.com'),
 ('download','dl.playstation.net'),('download','gst.prod.dl.playstation.net'),
 ('download','zeus.dl.playstation.net'),
 ('download','dlassets.xboxlive.com'),('download','dlassets-ssl.xboxlive.com'),
 ('download','assets1.xboxlive.com'),('download','assets2.xboxlive.com'),
 ('download','xvcf1.xboxlive.com'),('download','xvcf2.xboxlive.com'),
 ('download','d4c.nintendo.net'),('download','ccs.cdn.wup.nintendo.net'),('download','ccs.cdn.nintendo.net'),
 ('download','setup.rbxcdn.com'),
 ('download','launcher.mojang.com'),('download','piston-data.mojang.com'),
 ('download','blzddist1-a.akamaihd.net'),('download','level3.blizzard.com'),
 ('download','swcdn.apple.com'),('download','updates.cdn-apple.com'),('download','appldnld.apple.com'),
 ('download','iosapps.itunes.apple.com'),
 ('download','download.windowsupdate.com'),('download','dl.delivery.mp.microsoft.com'),
 ('download','tlu.dl.delivery.mp.microsoft.com'),
 ('download','dl.google.com'),('download','gvt1.com'),('download','redirector.gvt1.com'),
 -- ---- audio: never metered ----
 ('audio','spotify.com'),('audio','scdn.co'),('audio','spotifycdn.com'),
 ('audio','music.apple.com'),('audio','audible.com'),('audio','audible.co.nz'),
 ('audio','soundcloud.com'),('audio','sndcdn.com'),
 ('audio','music.amazon.com'),('audio','deezer.com'),
 -- RNZ's site mixes text news with the radio stream; a news page load is a
 -- burst, not the sustained bytes the active-minute threshold looks for, so
 -- it is listed on the same basis as the video-side broadcaster sites above.
 ('audio','rnz.co.nz'),
 -- ---- messaging: never metered ----
 ('messaging','whatsapp.com'),('messaging','whatsapp.net'),('messaging','messenger.com'),
 ('messaging','signal.org'),('messaging','telegram.org'),('messaging','t.me'),('messaging','telegram.me'),
 -- ---- schoolwork: never metered ----
 ('schoolwork','khanacademy.org'),('schoolwork','kastatic.org'),('schoolwork','kasandbox.org'),
 ('schoolwork','classroom.google.com'),('schoolwork','docs.google.com'),('schoolwork','drive.google.com'),
 ('schoolwork','wikipedia.org'),('schoolwork','wikimedia.org'),
 ('schoolwork','education.govt.nz'),('schoolwork','duolingo.com'),
 ('schoolwork','scratch.mit.edu'),('schoolwork','code.org'),('schoolwork','quizlet.com'),
 ('schoolwork','seesaw.me'),('schoolwork','mathletics.com')
ON CONFLICT (category, domain) DO NOTHING;

-- Per-category metering (METERING.md). These three were created by hand on the
-- first box; they belong here so a fresh deploy builds them too.
--
-- category_ips: "these addresses are gaming/video", learned from DNS answers
-- and TTL'd by `seen`. kidnet-catmeter loads them into the nftables sets.
CREATE TABLE IF NOT EXISTS category_ips (
  ip       inet NOT NULL,
  category text NOT NULL,
  seen     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, category)
);

-- Active minutes counted per child per day per category. One row per minute
-- in which the device moved more than the threshold to that category's
-- addresses, so idle keepalive never registers.
CREATE TABLE IF NOT EXISTS category_usage (
  child_id int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  day      date NOT NULL,
  category text NOT NULL,
  used_min int NOT NULL DEFAULT 0,
  PRIMARY KEY (child_id, day, category)
);

-- The daily cap per category, e.g. 2h gaming, 1h video. Audio, schoolwork and
-- messaging are never given a budget, because they are never metered.
CREATE TABLE IF NOT EXISTS category_budgets (
  child_id  int NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  category  text NOT NULL,
  daily_min int NOT NULL,
  PRIMARY KEY (child_id, category)
);

-- The portal and dashboard connect as the limited kids_app role. Usage and the
-- learned addresses stay read-only: the meter (kidnet-catmeter) and kidnet own
-- every write to those. Budgets are the exception, because a per-category
-- budget is a parent's decision and the dashboard's manage-children area has
-- to be able to set one; changing a budget cannot corrupt any measurement.
GRANT SELECT ON category_usage, category_budgets, category_ips TO kids_app;
GRANT INSERT, UPDATE, DELETE ON category_budgets TO kids_app;
