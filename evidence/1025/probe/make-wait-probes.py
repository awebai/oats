"""Make probe copies of the two test files that start Desktop servers with a fake CLI, in their
form that WAITS for the server's process group (test/helpers/process-group.mjs).

The copies change no assertion and keep the file's own hook, removal included. They log, with
wall-clock times in ms, into FAKE_PROBE_LOG:
  server-start / server-kill / server-exit   (the test's servers, with the directory of their fake CLI)
  fake-first-line / fake-exit                (each fake CLI process: pid, when the process started)
  hook-start / hook-servers-exited           (the hook: before it closes the servers, and once
                                              closeGroup has returned for each, before the removal)
  alive-at-hook                              (a fake still running at that moment)

usage: make-wait-probes.py <tree>
"""
import sys

tree = sys.argv[1]

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
// What is left of a server's process group once the server has exited, and each 500 ms after that.
const __group = async (proc) => {
  const { execFileSync } = await import("node:child_process");
  const members = () => execFileSync("ps", ["-axww", "-o", "pid=,pgid=,etimes=,command="], { encoding: "utf8" }).split("\n")
    .filter((line) => line.trim().split(/\s+/)[1] === String(proc.pid)).map((line) => line.trim().slice(0, 400));
  proc.kill();
  if (proc.exitCode === null && proc.signalCode === null) await new Promise((r) => proc.once("exit", r));
  const first = members();
  if (first.length) __mark("group-after-exit", { pid: proc.pid, members: first });
  const timer = setInterval(() => { const m = members(); if (m.length) __mark("group-later", { pid: proc.pid, members: m }); }, 500);
  try { await closeGroup(proc); } finally { clearInterval(timer); }
  __mark("group-empty", { pid: proc.pid });
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


# ---- test/desktop-server.test.mjs
s = open(f"{tree}/test/desktop-server.test.mjs").read()
s = must(s, 'const FAKE = join(ROOT, "test", "helpers", "desktop-fake-oats.mjs");',
         'const FAKE_TARGET = join(ROOT, "test", "helpers", "desktop-fake-oats.mjs");\nconst FAKE = "/var/tmp/okd-fi/probe/fake-probe.mjs";' + COMMON)
s = must(s, 'writeFileSync(bin, `#!/bin/sh\\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\\n`);',
         'writeFileSync(bin, `#!/bin/sh\\nFAKE_PROBE_TOOLS=${JSON.stringify(tools)} FAKE_PROBE_TARGET=${JSON.stringify(FAKE_TARGET)} FAKE_PROBE_LOG=${JSON.stringify(process.env.FAKE_PROBE_LOG)} exec ${JSON.stringify(process.execPath)} ${JSON.stringify(FAKE)} "$@"\\n`);', 2)
s = must(s, "  servers.push(proc);\n", "  servers.push(proc); __watch(proc, tools);\n", 2)
s = must(s, '''test.after(async () => {
  for (const proc of servers.splice(0)) await closeGroup(proc);
''', '''test.after(async () => {
  __mark("hook-start");
  for (const proc of servers.splice(0)) await __group(proc);
  __mark("hook-servers-exited");
  __aliveAtHook();
''')
open(f"{tree}/test/zz-probe-desktop-server.test.mjs", "w").write(s)

# ---- test/desktop-cli-integration.test.mjs
s = open(f"{tree}/test/desktop-cli-integration.test.mjs").read()
s = must(s, 'const SRV = join(ROOT, "packages", "desktop", "server", "oats-web.mjs");',
         'const SRV = join(ROOT, "packages", "desktop", "server", "oats-web.mjs");' + COMMON)
s = must(s, 'writeFileSync(js, `const { appendFileSync, readFileSync } = require("node:fs");',
         'writeFileSync(js, `const __p = require("node:perf_hooks").performance, __n = () => __p.timeOrigin + __p.now();\n'
         'const __r = (what) => { try { require("node:fs").appendFileSync(${JSON.stringify(process.env.FAKE_PROBE_LOG)}, JSON.stringify({ t: __n(), what, pid: process.pid, started: __n() - process.uptime() * 1000, tools: ${JSON.stringify(dir)}, args: process.argv.slice(2, 5) }) + "\\\\n"); } catch {} };\n'
         '__r("fake-first-line"); process.on("exit", () => __r("fake-exit"));\n'
         'const { appendFileSync, readFileSync } = require("node:fs");')
s = must(s, '''  servers.push(proc);
  let stderr = "";''', '''  servers.push(proc); __watch(proc, dirname(env.OATS_DESKTOP_OATS_BIN));
  let stderr = "";''')
s = must(s, '''  servers.push(proc);
  try {
    let pd;''', '''  servers.push(proc); __watch(proc, dirname(bin));
  try {
    let pd;''')
s = must(s, '''  t.after(async () => {
    for (const proc of servers.splice(0)) await closeGroup(proc);
''', '''  t.after(async () => {
    __mark("hook-start", { dir });
    for (const proc of servers.splice(0)) await __group(proc);
    __mark("hook-servers-exited", { dir });
    __aliveAtHook();
''')
open(f"{tree}/test/zz-probe-desktop-cli-integration.test.mjs", "w").write(s)
print("made")
