#!/usr/bin/env python3
# genkan:summary=Refuse a bash '#' comment, or a double quote in a SQL comment, inside a SQL string.
#
# Bash does not treat '#' as a comment inside double quotes, so a comment
# written inside a multi-line SQL string is sent to Postgres verbatim. That
# killed the whole flagged-domain alert path for a day: genkan-alerts printed
# a syntax error nobody was reading, counted zero rows, said "nothing new" and
# exited 0, so systemd recorded success every minute while nothing was checked.
#
# Run from the repo root. Exits non-zero if it finds one.
import re, glob, os, sys
# The bug: a bash '#' comment written inside a multi-line double-quoted SQL
# string. Bash does not strip it, so it is sent to Postgres verbatim.
# Detect narrowly: a call that opens a SQL string and leaves it open at the
# end of the line, then any '#'-only line before the string closes.
OPEN = re.compile(r'(?:psqll|psql|su_sql|agent_sql|sql|q|db)\s*(?:-[a-zA-Z]+\s+)*"\s*$')
bad = 0
files = []
for pat in ('bin/*','gateway/*','demo/*.sh','tools/*.sh','host/*.sh','config/db/*.sh','test/*.sh','deploy.sh'):
    files += glob.glob(pat)
for p in sorted(set(files)):
    if os.path.isdir(p): continue
    with open(p,'rb') as f:
        if f.read(2) != b'#!': continue
    lines = open(p, errors='replace').read().split('\n')
    i = 0
    while i < len(lines):
        if OPEN.search(lines[i]):
            j = i + 1
            while j < len(lines):
                stripped = re.sub(r"'[^']*'", '', lines[j])
                if re.match(r'\s*#', lines[j]):
                    print('%s:%d  %s' % (p, j+1, lines[j].strip()[:78])); bad += 1
                # The other half of the same trap: a SQL '--' comment is fine,
                # but a double quote inside it ends the bash string early, so
                # everything after it stops being SQL. genkan-devicescan ran
                # for three days printing a device count while its INSERT was
                # a stray argument to psql (2026-08-29 to 2026-09-02).
                if re.match(r'\s*--', lines[j]) and '"' in lines[j]:
                    print('%s:%d  (double quote inside a SQL comment)  %s' % (p, j+1, lines[j].strip()[:60])); bad += 1
                    break
                if '"' in stripped:
                    break
                j += 1
            i = j
        i += 1
print("--- %d comment problem(s) inside a SQL string ---" % bad)
sys.exit(1 if bad else 0)
