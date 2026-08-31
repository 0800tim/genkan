# Genkan for Omarchy

Your kids' internet on the status bar, and in the system menu, on the parent's
own desktop. No browser, no terminal, no phone.

Everything here runs on the **parent's machine**. The gateway is not touched
and nothing here needs root.

---

## What you get

**A status bar item.** Something like ` 2/3 · Ada 45m`: three kids on the
network, two of them online, and Ada is the one closest to running out. When
somebody is out of time, or an alert has not been acknowledged, the home glyph
becomes a warning triangle and the item calls attention to itself. During
dinner it shows a pause glyph and `all paused`.

Hover it and the tooltip breaks it down per child:

    Genkan
    Ada: 45m left, online
    Ben: out of time, online, blocked: gaming, internet
    Cleo: no daily limit, offline
    2 of 3 online, 1 paused
    Click for the Genkan menu

Left click opens the menu. Right click opens the dashboard. Middle click sends
the same summary as a notification.

**A menu.** In the Omarchy menu (SUPER+SPACE) there is a **Genkan** entry with
Dinner and Resume all at the top, then one submenu per child:

    Genkan
      Dinner                     pause every kid at once
      Resume all
      Ada  >                     Internet off / Internet on
      Ben  >                     Kill gaming / Gaming back on
      Cleo >                     Study mode on / Study mode off
                                 Grant 15 minutes / Grant 30 minutes
                                 How much time is left
      What is happening now
      Open dashboard
      Refresh the kid list

Every row runs one `kidnet` command and reports back in a notification, so
"Dinner" is two keystrokes and a click.

### Screenshots

There are none in the repo, because this was built without a physical Omarchy
box to photograph. If you install it, a screenshot of the bar item and one of
the open menu would be a genuinely useful pull request.

---

## Before you start

- Omarchy on the parent's desktop. Omarchy 4 (the Quickshell bar) and the
  older Waybar-based releases are both handled; the installer works out which
  one you have.
- `jq` and `curl`, both of which Omarchy already ships.
- A Genkan gateway you can reach, one of three ways (see below).

## Install

```bash
cd integrations/omarchy

# The gateway is this same machine (kidnet on PATH)
./install.sh

# The gateway is another box and you have ssh keys to it
./install.sh --ssh you@genkan --url http://genkan:8899

# You can only reach the dashboard, not a shell
./install.sh --url http://genkan:8899 --token "$DASH_TOKEN"
```

Useful flags: `--kids "Ada Ben Cleo"` to be exact about who the bar counts,
`--bin-dir` to link the commands somewhere other than `~/.local/bin`,
`--no-bar` and `--no-menu` to install only half of it.

What the installer does, and nothing else:

1. Links five commands into `~/.local/bin`.
2. Writes `~/.config/genkan/omarchy.conf` from `genkan.conf.example` if you do
   not already have one.
3. Adds a block of entries to `~/.config/omarchy/extensions/omarchy-menu.jsonc`
   between two marker comments, leaving everything else in that file alone.
4. Adds one module to `~/.config/omarchy/shell.json` (Omarchy 4) or to
   `~/.config/waybar/` (older Omarchy).

It is safe to run again. Every file it touches is copied to
`<file>.genkan-backup-<timestamp>` first, and it only writes when the result
would actually be different, so a second run makes no backups and no changes.

Run it again after adding a child, and the menu picks them up. Or use the
**Refresh the kid list** row in the menu, which does the same thing.

### Where the gateway is

The scripts default to **local**: if `kidnet` is on your PATH, that is used.
Otherwise `GENKAN_SSH`, otherwise `GENKAN_URL`. Set `GENKAN_MODE` in the config
file to pin one.

| Mode | How | What you lose |
|---|---|---|
| `local` | the desktop is the gateway | nothing |
| `ssh` | `ssh user@host kidnet ...`, over your tailnet | nothing. The connection is multiplexed, so polling costs one handshake, not one per poll |
| `http` | `POST /api/act` on the dashboard, with `DASH_TOKEN` | the unacknowledged-alert count, because the dashboard exposes no endpoint for it. The bar simply stops mentioning alerts |

ssh mode must never prompt. Set up a key first and check
`ssh you@genkan kidnet status` works from a plain terminal.

All three go through `genkan-kidnet`, which is the only script that knows where
the gateway is. It prints `kidnet`'s own output whichever route it took, so you
can use it by hand:

```bash
genkan-kidnet status
genkan-kidnet game off Ada
genkan-kidnet --kids
genkan-kidnet --mode
```

The HTTP route can only run what the dashboard's own allowlist permits. This
integration cannot widen it.

---

## When the gateway is not there

The box gets unplugged. The laptop leaves the house. This has to be a normal
state, not an error, because the alternative is a status bar that shouts at you
every thirty seconds.

So:

- The bar item **never writes to stderr and never exits non-zero**. If it
  cannot answer, it prints a valid JSON object saying so.
- A short outage shows **the last good answer**, dimmed, for
  `GENKAN_STALE_SEC` (three minutes by default). Brief blips do not make the
  bar flap.
- After that it falls back to a **dim home glyph** with the tooltip "Genkan:
  the gateway is not reachable". Set `GENKAN_HIDE_WHEN_DOWN=1` and it shows
  nothing at all, which makes the item vanish from the bar entirely.
- Menu actions that cannot reach the gateway say so in one notification, once,
  when you click them.
- A typo in the config file is swallowed by the bar item rather than printed.

Nothing here retries in a loop, writes a log, or raises a notification on its
own. The only thing that ever appears unprompted is the bar item going quiet.

Two honest notes about the polling. Each refresh runs `kidnet devices`,
`kidnet status` and one `kidnet time` per child, so a house with five kids is
seven gateway calls every thirty seconds. Over ssh that is cheap because the
connection is multiplexed, but if you have a big roster or a slow link, raise
the module's `interval`. And `kidnet time` is not quite read only: it creates
today's ledger row for a child who has none yet, exactly as the minute meter
already does. It changes no budget and blocks nothing.

## Styling

On Omarchy 4 there is nothing to style. The bar draws the item in the active
theme's own colours, and the script's `active` class turns on the same
highlight every other widget uses, so it matches whatever theme you switch to.

On older Waybar-based Omarchy, `waybar/style.css` is added to your stylesheet
between markers. It is deliberately colourless: it changes weight and opacity
only. A hardcoded colour would be wrong on twenty-one of the twenty-two themes
Omarchy ships, and naming a colour a theme has not defined makes GTK reject the
whole stylesheet. If you know your theme defines `@urgent`, there is a
commented-out block at the bottom of that file to uncomment.

The classes the script sets: `genkan` always, then `active`, `warn`, `paused`,
`low`, `stale` or `down`.

## Uninstall

```bash
./uninstall.sh            # keeps your settings
./uninstall.sh --purge    # deletes ~/.config/genkan/omarchy.conf too
```

It removes the menu block, the bar module, the CSS block and the five command
links, and leaves every backup where it is. A command in `~/.local/bin` that is
not a link into this checkout is left alone. Nothing on the gateway is touched.

## What is in here

| Path | What it is |
|---|---|
| `bin/genkan-kidnet` | the transport: local, ssh or http. Everything else calls this |
| `bin/genkan-bar-status` | prints one line of Waybar-format JSON for the bar |
| `bin/genkan-action` | runs one action and notifies the result; also the kid picker |
| `bin/genkan-menu-jsonc` | generates the menu entries and writes them into the extension file |
| `bin/genkan-jsonc-check` | parses a file the way the Omarchy menu parses JSONC |
| `shell/module.json` | the Omarchy 4 bar module, to paste by hand if you prefer |
| `waybar/config.jsonc` | the same module for a classic Waybar bar |
| `waybar/style.css` | the Waybar styles |
| `menu/genkan-menu.jsonc` | a sample of the generated menu, for reading |
| `genkan.conf.example` | every setting, with what it does |

## Which Omarchy mechanisms this uses

Worth stating plainly, because Omarchy 4 changed the answer.

- **Omarchy 4 does not use Waybar.** The bar is a Quickshell plugin configured
  by `~/.config/omarchy/shell.json`. But its custom `"type": "command"` modules
  read **Waybar-format JSON** (`text`, `tooltip`, `class`), so one status script
  serves both generations. The module keys (`exec`, `interval`, `tooltip`,
  `onClick`, `onRightClick`, `onMiddleClick`) come from `CustomCommandModule`
  in `shell/plugins/bar/Bar.qml`.
- On Omarchy 4 the bar reads `class` for one thing only: whether it contains
  `active`. That is why the script emits `class` as an array, so Waybar users
  get styleable classes and Omarchy 4 gets its highlight, from the same output.
- **The menu** is the `omarchy.menu` Quickshell plugin, with content in
  `default/omarchy/omarchy-menu.jsonc` overlaid by
  `~/.config/omarchy/extensions/omarchy-menu.jsonc`. Entry ids are dotted and
  the tree follows from the id, so `genkan.kid-ada.off` is a row inside a
  submenu inside Genkan, with no parent field to keep in sync.
- That extension file is JSONC only in a narrow sense: the parser strips
  **whole-line** `//` comments and trailing commas, then runs `JSON.parse`. An
  inline trailing comment breaks it, and a file that fails to parse contributes
  no entries at all, which would look like Omarchy losing your menu. So the
  installer checks the result the same way before it writes anything, and backs
  out if it would not parse.
- The kid picker uses `omarchy-menu-select`, which is Omarchy's own dmenu, and
  falls back to walker, fuzzel, wofi or rofi.
- Notifications go through `omarchy-notification-send`, falling back to
  `notify-send`.
- The dashboard opens with `omarchy-launch-webapp`, falling back to `xdg-open`.
- `shell.json` is edited with the same jq normalisation `omarchy-shell-config`
  uses, then the shell is told with `omarchy-shell -q shell reloadConfig`.
