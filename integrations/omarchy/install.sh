#!/bin/bash

# omarchy:summary=Install the Genkan desktop integration (status bar item and menu)
# omarchy:args=[--ssh <user@host>] [--url <dashboard-url>] [--token <dash-token>] [--kids "<names>"] [--bin-dir <dir>] [--no-bar] [--no-menu]
# omarchy:examples=./install.sh | ./install.sh --ssh you@genkan | ./install.sh --url http://genkan:8899 --token secret

# Puts a Genkan item on the Omarchy status bar and a Genkan submenu in the
# Omarchy menu. Never needs root, never touches the gateway, and never
# overwrites anything: every file it changes is backed up first, and it only
# writes when the result would actually differ.
#
# Run it again after adding a child and it refreshes the menu in place.

set -euo pipefail

readonly source_dir="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
readonly config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
readonly conf_file="$config_home/genkan/omarchy.conf"
readonly stamp="$(date +%Y%m%d%H%M%S)"

bin_dir="$HOME/.local/bin"
opt_ssh=""
opt_url=""
opt_token=""
opt_kids=""
do_bar=1
do_menu=1

fail() {
  echo "${0##*/}: $*" >&2
  exit 1
}

note() { echo "  $*"; }

usage() {
  cat <<USAGE
Usage: ./install.sh [options]

  --ssh <user@host>    the gateway is another box, reach it over ssh
  --url <url>          the dashboard's address (for http mode and for
                       the "Open dashboard" menu row)
  --token <token>      the dashboard's DASH_TOKEN, if it has one
  --kids "Ada Ben"     be exact about who the bar counts
  --bin-dir <dir>      where to link the commands (default ~/.local/bin)
  --no-bar             skip the status bar item
  --no-menu            skip the menu entries
USAGE
}

while (($# > 0)); do
  case "$1" in
    --ssh) opt_ssh="${2:?--ssh needs user@host}"; shift 2 ;;
    --url) opt_url="${2:?--url needs a url}"; shift 2 ;;
    --token) opt_token="${2:?--token needs a value}"; shift 2 ;;
    --kids) opt_kids="${2:?--kids needs a list}"; shift 2 ;;
    --bin-dir) bin_dir="${2:?--bin-dir needs a directory}"; shift 2 ;;
    --no-bar) do_bar=0; shift ;;
    --no-menu) do_menu=0; shift ;;
    -h | --help) usage; exit 0 ;;
    *) fail "unknown option: $1" ;;
  esac
done

[[ $EUID -ne 0 ]] || fail "do not run this as root; it installs into your own home"
command -v jq >/dev/null 2>&1 || fail "jq is required (it ships with Omarchy)"

# Back up a file before the first change of this run, then write. Writing
# nothing when nothing would change is what makes re-running this free.
install_file() {
  local target="$1" new="$2"
  if [[ -f $target ]] && cmp -s "$new" "$target"; then
    return 1
  fi
  [[ ! -f $target ]] || cp -p "$target" "$target.genkan-backup-$stamp"
  mkdir -p "$(dirname "$target")"
  cat "$new" >"$target"
  return 0
}

echo "Genkan for Omarchy"
echo

# ---------------------------------------------------------------- commands

mkdir -p "$bin_dir"
for cmd in genkan-kidnet genkan-bar-status genkan-action genkan-menu-jsonc genkan-jsonc-check; do
  src="$source_dir/bin/$cmd"
  [[ -x $src ]] || chmod +x "$src" 2>/dev/null || true
  dest="$bin_dir/$cmd"
  if [[ -e $dest && ! -L $dest ]]; then
    mv "$dest" "$dest.genkan-backup-$stamp"
    note "moved your existing $cmd aside"
  fi
  ln -sfn "$src" "$dest"
done
note "linked five commands into $bin_dir"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) note "note: $bin_dir is not on your PATH; the bar and menu use full paths, so this only affects you typing the commands" ;;
esac

# ------------------------------------------------------------------ config

if [[ ! -f $conf_file ]]; then
  mkdir -p "$(dirname "$conf_file")"
  cp "$source_dir/genkan.conf.example" "$conf_file"
  note "wrote $conf_file"
fi

# Set a key in the config file, uncommenting the shipped line if it is there.
set_conf() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  # The value goes through the environment rather than the command line so a
  # token full of punctuation cannot turn into a substitution pattern.
  GENKAN_SET_KEY="$key" GENKAN_SET_VALUE="$value" awk '
    BEGIN { k = ENVIRON["GENKAN_SET_KEY"]; v = ENVIRON["GENKAN_SET_VALUE"]; written = 0 }
    $0 ~ ("^#?" k "=") { if (!written) { print k "=\"" v "\""; written = 1 }; next }
    { print }
    END { if (!written) print k "=\"" v "\"" }
  ' "$conf_file" >"$tmp"
  cat "$tmp" >"$conf_file"
  rm -f "$tmp"
}

[[ -z $opt_ssh ]] || { set_conf GENKAN_SSH "$opt_ssh"; note "gateway over ssh: $opt_ssh"; }
[[ -z $opt_url ]] || { set_conf GENKAN_URL "$opt_url"; note "dashboard: $opt_url"; }
[[ -z $opt_token ]] || { set_conf GENKAN_DASH_TOKEN "$opt_token"; chmod 600 "$conf_file"; }
[[ -z $opt_kids ]] || { set_conf GENKAN_KIDS "$opt_kids"; note "kids: $opt_kids"; }

# ------------------------------------------------------------------- check

echo
if out=$("$bin_dir/genkan-kidnet" status 2>&1); then
  mode=$("$bin_dir/genkan-kidnet" --mode)
  note "gateway reachable over $mode"
  [[ -z ${out//[[:space:]]/} ]] && note "nothing is blocked right now" || note "blocked now: ${out//$'\n'/; }"
else
  note "gateway not reachable yet. That is fine: the bar will sit quiet and"
  note "pick it up when it comes back. Check $conf_file."
fi

# -------------------------------------------------------------------- menu

if ((do_menu)); then
  echo
  "$bin_dir/genkan-menu-jsonc" --install | sed 's/^/  /'
fi

# --------------------------------------------------------------------- bar

# Omarchy 4 runs a Quickshell bar configured by shell.json. Omarchy 2 and 3 ran
# Waybar. The status script speaks Waybar-format JSON either way, so all that
# differs is which config file gets the module.
install_shell_json() {
  local user_config="$config_home/omarchy/shell.json"
  local defaults="${OMARCHY_PATH:-/usr/share/omarchy}/config/omarchy/shell.json"
  local source_json new

  if [[ -s $user_config ]]; then
    source_json="$user_config"
  elif [[ -s $defaults ]]; then
    source_json="$defaults"
  else
    return 1
  fi

  new=$(mktemp)
  # Normalized the way omarchy-shell-config normalizes it, so the result is a
  # well-shaped file whatever state it started in. The module is dropped in
  # front of the tray when there is one, which is where a status item belongs.
  jq -S --arg exec "$bin_dir/genkan-bar-status" \
        --arg dash "$bin_dir/genkan-action dashboard" \
        --arg status "$bin_dir/genkan-action status" '
    def object_or_empty: if type == "object" then . else {} end;
    def array_or_empty: if type == "array" then . else [] end;
    def entry_id: if type == "object" then (.id // "" | tostring) else tostring end;

    object_or_empty
    | .version = 1
    | .bar = (.bar | object_or_empty)
    | .bar.layout = (.bar.layout | object_or_empty)
    | .bar.layout.left = (.bar.layout.left | array_or_empty)
    | .bar.layout.center = (.bar.layout.center | array_or_empty)
    | .bar.layout.right = (.bar.layout.right | array_or_empty)
    | .plugins = (.plugins | array_or_empty)

    | { id: "genkan", type: "command", exec: $exec, interval: 30,
        tooltip: "Genkan", onClick: "omarchy menu summon genkan",
        onRightClick: $dash, onMiddleClick: $status } as $module

    | .bar.layout.left   = (.bar.layout.left   | map(select(entry_id != "genkan")))
    | .bar.layout.center = (.bar.layout.center | map(select(entry_id != "genkan")))
    | .bar.layout.right  = (.bar.layout.right  | map(select(entry_id != "genkan")))

    | (.bar.layout.right | map(entry_id) | index("omarchy.tray")) as $at
    | .bar.layout.right = (
        if $at == null then [$module] + .bar.layout.right
        else .bar.layout.right[0:$at] + [$module] + .bar.layout.right[$at:] end
      )
  ' "$source_json" >"$new" || { rm -f "$new"; return 2; }

  if install_file "$user_config" "$new"; then
    note "added the Genkan module to $user_config"
    omarchy-shell -q shell reloadConfig >/dev/null 2>&1 || true
  else
    note "the Genkan module is already in $user_config"
  fi
  rm -f "$new"
  return 0
}

install_waybar() {
  local waybar_dir="$config_home/waybar"
  local style="$waybar_dir/style.css"
  local config="" candidate new
  for candidate in "$waybar_dir/config.jsonc" "$waybar_dir/config"; do
    [[ -f $candidate ]] && { config="$candidate"; break; }
  done
  [[ -n $config ]] || return 1

  # The stylesheet first: appending CSS is always safe, and the rules are
  # colourless on purpose so no theme can be broken by them.
  local begin="/* >>> genkan >>> */" end="/* <<< genkan <<< */"
  new=$(mktemp)
  if [[ -f $style ]] && grep -qF "$begin" "$style"; then
    awk -v b="$begin" -v e="$end" -v bf="$source_dir/waybar/style.css" '
      index($0, b) { print; while ((getline line < bf) > 0) print line; close(bf); skip = 1; next }
      skip && index($0, e) { print; skip = 0; next }
      skip { next }
      { print }
    ' "$style" >"$new"
  else
    { [[ -f $style ]] && cat "$style"; printf '\n%s\n' "$begin"; cat "$source_dir/waybar/style.css"; printf '%s\n' "$end"; } >"$new"
  fi
  install_file "$style" "$new" && note "added the Genkan styles to $style" ||
    note "the Genkan styles are already in $style"
  rm -f "$new"

  # Then the module. A config with comments in it cannot be rewritten by jq
  # without losing them, and Omarchy's shipped one was full of them. In that
  # case say so and print the snippet, rather than flatten someone's file.
  if grep -qE '^[[:space:]]*//' "$config"; then
    note "$config has comments in it, so it was left exactly as it is."
    note "Add \"custom/genkan\" to modules-right and paste this in:"
    sed 's/^/    /' "$source_dir/waybar/config.jsonc"
    return 0
  fi

  new=$(mktemp)
  if jq -S --arg exec "$bin_dir/genkan-bar-status" \
          --arg dash "$bin_dir/genkan-action dashboard" \
          --arg status "$bin_dir/genkan-action status" '
      ."custom/genkan" = {
        exec: $exec, "return-type": "json", interval: 30, tooltip: true,
        "on-click": "omarchy-menu summon genkan",
        "on-click-right": $dash, "on-click-middle": $status }
      | ."modules-right" = (
          ((."modules-right" // []) | map(select(. != "custom/genkan")))
          as $rest
          | if ($rest | index("tray")) == null then ["custom/genkan"] + $rest
            else $rest[0:($rest | index("tray"))] + ["custom/genkan"] + $rest[($rest | index("tray")):] end
        )
    ' "$config" >"$new" 2>/dev/null; then
    if install_file "$config" "$new"; then
      note "added custom/genkan to $config"
      pkill -SIGUSR2 waybar 2>/dev/null || true
    else
      note "custom/genkan is already in $config"
    fi
  else
    note "could not safely rewrite $config, so it was left alone."
    note "Add \"custom/genkan\" to modules-right and paste this in:"
    sed 's/^/    /' "$source_dir/waybar/config.jsonc"
  fi
  rm -f "$new"
  return 0
}

if ((do_bar)); then
  echo
  if install_shell_json; then
    :
  elif install_waybar; then
    :
  else
    note "no Omarchy shell.json and no Waybar config found, so nothing was"
    note "changed. The snippets to paste are in:"
    note "  $source_dir/shell/module.json    (Omarchy 4, Quickshell bar)"
    note "  $source_dir/waybar/config.jsonc  (Omarchy 2 and 3, Waybar)"
  fi
fi

echo
echo "Done."
echo "  Bar item     polls every 30 seconds; click it for the menu."
echo "  Menu         SUPER+SPACE, then Genkan. Or: omarchy menu summon genkan"
echo "  Settings     $conf_file"
echo "  Remove it    $source_dir/uninstall.sh"
