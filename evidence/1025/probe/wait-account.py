"""The account of one probe run of a file in its WAITING form (make-wait-probes.py).

Prints: how many servers and fake CLI processes; for each server whose process group was not empty
when the server had exited, what was in it and how long the hook waited for it; and whether any
fake CLI was running, or ended, after the hook had the group empty (there must be none).
"""
import json
import sys

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
t0 = rows[0]["t"]
servers = [r for r in rows if r["what"] == "server-start"]
exits = {}
for r in rows:
    if r["what"] == "server-exit":
        exits.setdefault(r["pid"], r["t"])
fakes = {}
for r in rows:
    if r["what"] == "fake-first-line":
        fakes[r["pid"]] = {"args": " ".join(r["args"]), "started": r["started"], "first": r["t"], "end": None, "tools": r["tools"]}
    elif r["what"] == "fake-exit" and r["pid"] in fakes:
        fakes[r["pid"]]["end"] = r["t"]
print(f"servers: {len(servers)}   fake CLI processes: {len(fakes)}   without an exit line: {sum(1 for f in fakes.values() if f['end'] is None)}")

empty = {r["pid"]: r["t"] for r in rows if r["what"] == "group-empty"}
after = [r for r in rows if r["what"] == "group-after-exit"]
waits = sorted(empty[p] - exits[p] for p in empty if p in exits)
if waits:
    print(f"groups waited for: {len(waits)}; from the server's exit to an empty group: min {waits[0]:.0f} ms, median {waits[len(waits)//2]:.0f} ms, max {waits[-1]:.0f} ms")
print(f"groups not empty when the server had exited: {len(after)}")
for r in after:
    w = empty.get(r["pid"])
    print(f"  server {r['pid']}: waited {'?' if w is None else f'{w - exits[r['pid']]:.0f} ms'} for:")
    for m in r["members"]:
        print(f"     {m[:230]}")
later = [r for r in rows if r["what"] == "group-later"]
seen = set()
for r in later:
    for m in r["members"]:
        key = (r["pid"], m.split()[0])
        if key not in seen:
            seen.add(key)
            print(f"  still there 500 ms or more after server {r['pid']} exited: {m[:230]}")

hooks = [r for r in rows if r["what"] == "hook-servers-exited"]
n = 0
for h in hooks:
    for pid, f in fakes.items():
        if f["started"] <= h["t"] and (f["end"] is None or f["end"] > h["t"]):
            # a fake with no exit line was killed: the hook itself checked whether it was alive
            alive = [r for r in rows if r["what"] == "alive-at-hook" and r["pid"] == pid and r["t"] >= h["t"]]
            if f["end"] is None and alive and not any(r["alive"] for r in alive):
                continue
            n += 1
            print(f"  RUNNING when the hook had the group empty: pid {pid} `{f['args']}` ended {'(no exit line)' if f['end'] is None else f'{f['end'] - h['t']:+.0f} ms'}")
print(f"hooks: {len(hooks)}   fakes running when a hook had its groups empty: {n}")
late = [f for f in fakes.values() for h in hooks if f["started"] <= h["t"] < f["first"]]
print(f"fakes started before a hook had its groups empty that ran their first line after it: {len(late)}")
