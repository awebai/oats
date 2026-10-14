"""Read a probe-frames log: the tmux calls the worker made and the CLI children it started."""
import collections
import json
import sys

calls = collections.Counter()
children = collections.Counter()
for line in open(sys.argv[1]):
    r = json.loads(line)
    env = r.get("seen") or {}
    if r["cmd"] == "tmux":
        calls[(r["env"], "TMUX_TMPDIR=" + ("set" if env.get("TMUX_TMPDIR") else "none"), " ".join(r["args"][:4]), " < ".join(r["frames"][:3]))] += 1
    elif "oats.mjs" in " ".join(r["args"]):
        children[(r["env"], " ".join(r["args"][1:3]))] += 1
for key, n in calls.most_common(8):
    print("  tmux in worker:", n, key)
for key, n in children.most_common(8):
    print("  CLI child:", n, key)
