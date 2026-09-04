#!/usr/bin/env python3
# genkan:summary=Refuse the old brand name in any page we serve, including when markup splits it.
#
# The rename of 2026-08-31 replaced every occurrence of the string. It missed
# one, and no search found it for four days, because the speed test's heading
# was written HEA<span class="o">R</span>TH so that one letter could be gold.
# "hearth" as a contiguous string was simply not in the file, and the page
# said HEARTH to every visitor.
#
# So this strips the markup first and looks at what a person would READ. It
# also collapses the gaps that letter-spacing and entities leave behind.
import re, sys, pathlib

OLD = "hearth"
# Only the code that RENDERS PAGES. Documents mention the old name on
# purpose (the rename is history worth keeping) and are not scanned.
ROOTS = ["dashboard", "speedtest", "portal"]
SKIP_DIRS = {"node_modules", ".git", "research"}
# Where the old name is deliberately kept: the old public hostnames redirect
# forever, and DECISIONS.md records the history on purpose.
ALLOW = re.compile(r"hearth[-a-z]*\.appspurt\.dev|hearth-snapshot|refs/hearth")

bad = 0
for root in ROOTS:
    for p in pathlib.Path(root).rglob("*"):
        if not p.is_file() or any(d in p.parts for d in SKIP_DIRS):
            continue
        if p.suffix not in {".mjs", ".js", ".html", ".css"}:
            continue
        try:
            t = p.read_text(errors="replace")
        except Exception:
            continue
        # What a reader sees: tags gone, entities and separators closed up.
        vis = re.sub(r"<[^>]{0,200}>", "", t)
        vis = re.sub(r"&[a-z]{2,10};|&#\d{2,6};", "", vis)
        squashed = re.sub(r"[^A-Za-z]", "", vis).lower()
        hit = None
        for m in re.finditer(OLD, t, re.I):
            seg = t[max(0, m.start() - 40):m.start() + 40]
            if ALLOW.search(seg):
                continue
            hit = "in the source: ..." + seg.replace("\n", " ")[:70] + "..."
            break
        if hit is None and OLD in squashed:
            hit = "in the RENDERED text only, so markup is splitting it (a styled letter in a heading does this)"
        if hit:
            print("  %s\n      %s" % (p, hit))
            bad += 1
print("--- %d served page(s) still saying the old name ---" % bad)
sys.exit(1 if bad else 0)
