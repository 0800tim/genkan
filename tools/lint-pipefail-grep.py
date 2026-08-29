#!/usr/bin/env python3
# hearth:summary=Refuse `printf | grep -q` in a script that sets pipefail.
#
# grep -q exits the instant it matches. If the producer is still writing it
# dies of SIGPIPE with status 141, and `set -o pipefail` promotes that to the
# pipeline's status. So a SUCCESSFUL match reports failure, but only once the
# data is bigger than the pipe buffer, which makes it look like an unrelated
# change broke something far away.
#
# That is what happened here. kidnet-health checked its firewall with
# `printf '%s' "$rules" | grep -q "set kids_block {"`. Adding 7299 Tor relay
# addresses pushed the ruleset past 64KB, and every set check began failing
# while every chain check kept passing, because nft prints the sets first and
# the chains last. The household was told its firewall was incomplete and sent
# to restart a gateway that was working.
#
# Use bash's own matching instead, which cannot be raced and is faster:
#     case "$haystack" in *"needle"*) ;; *) missing=1;; esac
#
# Run from the repo root. Exits non-zero if it finds one.
import re, glob, os, sys

PIPE = re.compile(r'\|\s*grep\s+(-[a-zA-Z]*q[a-zA-Z]*)\b')
PRODUCER = re.compile(r'^\s*(?:if\s+!?\s*)?(?:printf|echo|cat)\b')
bad = 0
files = []
for pat in ('bin/*','gateway/*','demo/*.sh','tools/*.sh','host/*.sh','config/db/*.sh','deploy.sh'):
    files += glob.glob(pat)
for p in sorted(set(files)):
    if os.path.isdir(p): continue
    with open(p,'rb') as f:
        if f.read(2) != b'#!': continue
    text = open(p, errors='replace').read()
    if 'pipefail' not in text: continue
    for i, line in enumerate(text.split('\n'), 1):
        if PIPE.search(line) and PRODUCER.search(line):
            print('%s:%d  %s' % (p, i, line.strip()[:78])); bad += 1
print("--- %d early-exit pipe(s) under pipefail ---" % bad)
sys.exit(1 if bad else 0)
