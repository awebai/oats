"""The account of the fake CLI processes of one probe run (see make-fake-probes.py).

For each server: when it was killed and when it exited. For each fake CLI process of that server:
when the process started, when it ended, and how that stands to the kill, the server's exit and
the hook. Prints the fakes that were alive after their server's kill, with what they ran.
"""
import collections
import json
import sys

rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
servers = {}  # tools -> list of {pid, start, kill, exit}
for r in rows:
    if r["what"] == "server-start":
        servers.setdefault(r["tools"], []).append({"pid": r["pid"], "start": r["t"], "kill": None, "exit": None})
    elif r["what"] in ("server-kill", "server-exit"):
        for s in servers.get(r["tools"], []):
            if s["pid"] == r["pid"]:
                key = r["what"].split("-")[1]
                if s[key] is None:
                    s[key] = r["t"]
fakes = {}
for r in rows:
    if r["what"] == "fake-first-line":
        fakes[r["pid"]] = {"pid": r["pid"], "tools": r["tools"], "args": " ".join(r["args"]), "started": r["started"], "first": r["t"], "end": None}
    elif r["what"] == "fake-exit" and r["pid"] in fakes:
        fakes[r["pid"]]["end"] = r["t"]
hooks = [r for r in rows if r["what"] == "hook-servers-exited"]
alive_at_hook = [r for r in rows if r["what"] == "alive-at-hook"]

print(f"servers: {sum(len(v) for v in servers.values())}   fake CLI processes: {len(fakes)}   without an exit line: {sum(1 for f in fakes.values() if f['end'] is None)}")
life = sorted(f["end"] - f["started"] for f in fakes.values() if f["end"] is not None)
if life:
    print(f"a fake's life, start to exit: min {life[0]:.0f} ms, median {life[len(life)//2]:.0f} ms, max {life[-1]:.0f} ms")

late = []
for f in fakes.values():
    cands = [s for s in servers.get(f["tools"], []) if s["start"] <= f["started"] + 5]
    if not cands:
        continue
    s = max(cands, key=lambda s: s["start"])
    if s["kill"] is None:
        continue
    end = f["end"]
    if end is None or end > s["kill"]:
        late.append((f, s))
print(f"fakes still running after their server was killed: {len(late)}")
by = collections.Counter()
for f, s in late:
    after_kill = None if f["end"] is None else f["end"] - s["kill"]
    after_exit = None if (f["end"] is None or s["exit"] is None) else f["end"] - s["exit"]
    started_after_kill = f["started"] - s["kill"]
    by[f["args"]] += 1
    print(f"  pid {f['pid']} `{f['args']}`: started {started_after_kill:+.0f} ms from the kill; first line {f['first'] - s['kill']:+.0f} ms; "
          f"ended {'(no exit line)' if after_kill is None else f'{after_kill:+.0f} ms from the kill'}"
          f"{'' if after_exit is None else f', {after_exit:+.0f} ms from the server exit'}")
if late:
    print("  by command:", dict(by))
print(f"hook runs (servers exited): {len(hooks)}   fakes with no exit line checked at a hook: {len(alive_at_hook)}, alive: {sum(1 for r in alive_at_hook if r['alive'])}")
for r in alive_at_hook:
    if r["alive"]:
        print(f"  ALIVE at the hook: pid {r['pid']} `{' '.join(r['args'])}`")
# fakes that had not ended when a hook's servers had exited
n = 0
for h in hooks:
    for f in fakes.values():
        if f["started"] <= h["t"] and (f["end"] is None or f["end"] > h["t"]) and (not h.get("dir") or h.get("dir") == f["tools"]):
            n += 1
            print(f"  running when a hook had closed its servers: pid {f['pid']} `{f['args']}`, ended {'(no exit line)' if f['end'] is None else f'{f['end'] - h['t']:+.0f} ms after'}")
print(f"fakes running when a hook had closed its servers: {n}")
