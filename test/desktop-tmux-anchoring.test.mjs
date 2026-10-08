// Live tmux anchoring checks for the Desktop server's exact-target helpers.
// NATIVE: these create and kill tmux sessions on the fixture's private server
// (isolateSessionEnvironment), never the operator's. They are kept apart from
// the inert server tests so a hermetic run can never load them by accident.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isolateSessionEnvironment, isolatedTmuxTmpdir } from "./helpers/host-fixture.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRV = join(ROOT, "packages", "desktop", "server", "oats-web.mjs");
function extractBlock(file, marker) {
  const src = readFileSync(file, "utf8");
  const re = new RegExp(`\\/\\* OATSWEB_${marker}_BEGIN[^*]*\\*\\/([\\s\\S]*?)\\/\\* OATSWEB_${marker}_END \\*\\/`);
  const m = src.match(re);
  assert.ok(m, marker + " block markers present");
  return m[1];
}

// ---- tmux target anchoring: prefix-match hazard (reviewer-death bug class) ----

test("desktop server: tmux targets: exact-match anchoring fails closed for reads AND writes", (t) => {
  const src = extractBlock(SRV, "TMUXTGT");
  const tmuxTarget = new Function(`${src}; return tmuxTarget;`)();
  // component validation: separator/anchor injection rejected
  assert.equal(tmuxTarget({ tmux: { session: "s1", window: "reviewer-1" } }), "=s1:=reviewer-1");
  for (const bad of ["a:b", "a=b", "", "a b"]) {
    assert.throws(() => tmuxTarget({ tmux: { session: bad, window: "w" } }), `session "${bad}" rejected`);
    assert.throws(() => tmuxTarget({ tmux: { session: "s", window: bad } }), `window "${bad}" rejected`);
  }
  // live half: reviewer-1 ABSENT, reviewer-15abc PRESENT — the unanchored
  // target would prefix-match the live window; the anchored one must error.
  const probe = spawnSync("tmux", ["-V"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) { t.skip("tmux unavailable"); return; }
  // The fixture's private server only: its wrapper is the only tmux on PATH and refuses any call
  // that names no fixture server, so a call that would reach the default server fails the test.
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oats-anchor-")));
  const restore = isolateSessionEnvironment(base);
  t.after(() => { restore(); rmSync(base, { recursive: true, force: true }); });
  assert.ok(isolatedTmuxTmpdir(), "the fixture's tmux isolation is installed");
  assert.match(spawnSync("tmux", ["list-sessions"], { encoding: "utf8" }).stderr, /test tmux refused a non-fixture socket/,
    "a call naming no fixture server is refused, not sent to the default server");
  const tmux = (args, options) => execFileSync("tmux", ["-L", "oats", ...args], options);
  const session = `oatswebtgt${process.pid}`;
  tmux(["new-session", "-d", "-s", session, "-n", "reviewer-15abc"], { timeout: 4000 });
  try {
    const anchored = tmuxTarget({ tmux: { session, window: "reviewer-1" } });
    const unanchored = `${session}:reviewer-1`;
    // sanity: the hazard is real — unanchored prefix-match hits the live window
    const hit = tmux(["display-message", "-p", "-t", unanchored, "#{window_name}"],
      { encoding: "utf8", timeout: 4000 }).trim();
    assert.equal(hit, "reviewer-15abc", "unanchored target prefix-matches the wrong live window");
    // read path fails closed
    assert.throws(() => tmux(["capture-pane", "-p", "-t", anchored], { stdio: "pipe", timeout: 4000 }),
      "anchored capture-pane errors instead of exposing the wrong pane");
    assert.throws(() => tmux(["list-panes", "-t", anchored, "-F", "#{pane_width}"], { stdio: "pipe", timeout: 4000 }),
      "anchored list-panes errors");
    // NOTE display-message -p -t <missing> silently falls back to a default
    // context instead of erroring — a read that must fail closed uses list-panes.
    // write path fails closed
    assert.throws(() => tmux(["send-keys", "-t", anchored, "-H", "78"], { stdio: "pipe", timeout: 4000 }),
      "anchored send-keys errors instead of typing into the wrong window");
    assert.throws(() => tmux(["send-keys", "-t", anchored, "C-c"], { stdio: "pipe", timeout: 4000 }),
      "anchored interrupt errors");
    // the exact-name window still works end to end
    const ok = tmuxTarget({ tmux: { session, window: "reviewer-15abc" } });
    tmux(["send-keys", "-t", ok, "-H", "23"], { timeout: 4000 }); // harmless '#'
    assert.ok(tmux(["capture-pane", "-p", "-t", ok], { encoding: "utf8", timeout: 4000 }) !== undefined);
  } finally {
    try { tmux(["kill-session", "-t", `=${session}`], { timeout: 4000 }); } catch { /* already gone */ }
  }
});
