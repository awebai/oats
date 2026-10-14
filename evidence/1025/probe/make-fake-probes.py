"""Make probe copies of the two test files that start Desktop servers with a fake CLI.

The copies change no assertion. They log, with wall-clock times in ms, into FAKE_PROBE_LOG:
  server-start / server-kill / server-exit   (the test's servers, with the directory of their fake CLI)
  fake-first-line / fake-exit                (each fake CLI process: pid, when the process started)
  hook-start / hook-servers-exited           (the hook that removes the directories)
  alive-at-hook                              (a fake still running once the servers have exited)
The hook of a copy removes nothing: the timeline is measured without interference.

usage: make-fake-probes.py <tree>
"""
import sys

tree = sys.argv[1]
LOG = 'process.env.FAKE_PROBE_LOG'

COMMON = r'''
import { appendFileSync as __append, readFileSync as __read } from "node:fs";
import { performance as __perf } from "node:perf_hooks";
const __now = () => __perf.timeOrigin + __perf.now();
const __mark = (what, extra = {}) => __append(process.env.FAKE_PROBE_LOG, JSON.stringify({ t: __now(), what, ...extra }) + "\n");
const __watch = (proc, tools) => {
  __mark("server-start", { pid: proc.pid, tools });
  const kill = proc.kill.bind(proc);
  proc.kill = (...a) => { __mark("server-kill", { pid: proc.pid, tools }); return kill(...a); };
  proc.on("exit", () => __mark("server-exit", { pid: proc.pid, tools }));
};
const __aliveAtHook = () => {
  const rows = __read(process.env.FAKE_PROBE_LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ended = new Set(rows.filter((r) => r.what === "fake-exit").map((r) => r.pid));
  for (const r of rows.filter((r) => r.what === "fake-first-line" && !ended.has(r.pid))) {
    let alive = true; try { process.kill(r.pid, 0); } catch { alive = false; }
    __mark("alive-at-hook", { pid: r.pid, tools: r.tools, args: r.args, alive });
  }
};
'''


def must(s, old, new, n=1):
    assert s.count(old) == n, (old[:80], s.count(old))
    return s.replace(old, new)


# ---- test/desktop-server.test.mjs: the fake is test/helpers/desktop-fake-oats.mjs, started by a wrapper per server
s = open(f"{tree}/test/desktop-server.test.mjs").read()
s = must(s, 'const FAKE = join(ROOT, "test", "helpers", "desktop-fake-oats.mjs");',
         'const FAKE_TARGET = join(ROOT, "test", "helpers", "desktop-fake-oats.mjs");\nconst FAKE = "/var/tmp/okd-fi/probe/fake-probe.mjs";' + COMMON)
# the wrapper names the directory to the fake, and the target
s = must(s, 'writeFileSync(bin, `#!/bin/sh\\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\\n`);',
         'writeFileSync(bin, `#!/bin/sh\\nFAKE_PROBE_TOOLS=${JSON.stringify(tools)} FAKE_PROBE_TARGET=${JSON.stringify(FAKE_TARGET)} FAKE_PROBE_LOG=${JSON.stringify(process.env.FAKE_PROBE_LOG)} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\\n`);', 2)
s = must(s, "  servers.push(proc);\n", "  servers.push(proc); __watch(proc, tools);\n", 2)
a = s.index("test.after(async () => {")
b = s.index("\n});\n", a) + 5
s = s[:a] + '''test.after(async () => {
  __mark("hook-start");
  for (const proc of servers.splice(0)) {
    proc.kill();
    if (proc.exitCode === null && proc.signalCode === null) await new Promise((r) => proc.once("exit", r));
  }
  __mark("hook-servers-exited");
  __aliveAtHook();
});
''' + s[b:]
open(f"{tree}/test/zz-probe-desktop-server.test.mjs", "w").write(s)

# ---- test/desktop-cli-integration.test.mjs: the fake is a script the test writes into the directory
s = open(f"{tree}/test/desktop-cli-integration.test.mjs").read()
s = must(s, 'const SRV = join(ROOT, "packages", "desktop", "server", "oats-web.mjs");',
         'const SRV = join(ROOT, "packages", "desktop", "server", "oats-web.mjs");' + COMMON)
s = must(s, 'writeFileSync(js, `const { appendFileSync, readFileSync } = require("node:fs");',
         'writeFileSync(js, `const __p = require("node:perf_hooks").performance, __n = () => __p.timeOrigin + __p.now();\n'
         'const __r = (what) => { try { require("node:fs").appendFileSync(${JSON.stringify(process.env.FAKE_PROBE_LOG)}, JSON.stringify({ t: __n(), what, pid: process.pid, started: __n() - process.uptime() * 1000, tools: ${JSON.stringify(dir)}, args: process.argv.slice(2, 5) }) + "\\\\n"); } catch {} };\n'
         '__r("fake-first-line"); process.on("exit", () => __r("fake-exit"));\n'
         'const { appendFileSync, readFileSync } = require("node:fs");')
s = must(s, '''    { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...env } });
  servers.push(proc);
''', '''    { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...env } });
  servers.push(proc); __watch(proc, dirname(env.OATS_DESKTOP_OATS_BIN));
''')
s = must(s, '''  servers.push(proc);
  try {
    let pd;''', '''  servers.push(proc); __watch(proc, dirname(bin));
  try {
    let pd;''')
a = s.index("  t.after(async () => {")
b = s.index("\n  });\n", a) + 7
s = s[:a] + '''  t.after(async () => {
    __mark("hook-start", { dir });
    for (const proc of servers.splice(0)) {
      proc.kill();
      if (proc.exitCode === null && proc.signalCode === null) await new Promise((r) => proc.once("exit", r));
    }
    __mark("hook-servers-exited", { dir });
    __aliveAtHook();
  });
''' + s[b:]
open(f"{tree}/test/zz-probe-desktop-cli-integration.test.mjs", "w").write(s)
print("made")
