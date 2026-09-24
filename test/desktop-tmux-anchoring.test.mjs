// Live tmux anchoring checks for the Desktop server's exact-target helpers.
// NATIVE: these create and kill private tmux sessions. They are kept apart from
// the inert server tests so a hermetic run can never load them by accident.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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
  const session = `oatswebtgt${process.pid}`;
  try {
    execFileSync("tmux", ["new-session", "-d", "-s", session, "-n", "reviewer-15abc"], { timeout: 4000 });
  } catch { t.skip("tmux unavailable"); return; }
  try {
    const anchored = tmuxTarget({ tmux: { session, window: "reviewer-1" } });
    const unanchored = `${session}:reviewer-1`;
    // sanity: the hazard is real — unanchored prefix-match hits the live window
    const hit = execFileSync("tmux", ["display-message", "-p", "-t", unanchored, "#{window_name}"],
      { encoding: "utf8", timeout: 4000 }).trim();
    assert.equal(hit, "reviewer-15abc", "unanchored target prefix-matches the wrong live window");
    // read path fails closed
    assert.throws(() => execFileSync("tmux", ["capture-pane", "-p", "-t", anchored], { stdio: "pipe", timeout: 4000 }),
      "anchored capture-pane errors instead of exposing the wrong pane");
    assert.throws(() => execFileSync("tmux", ["list-panes", "-t", anchored, "-F", "#{pane_width}"], { stdio: "pipe", timeout: 4000 }),
      "anchored list-panes (paneInfo path) errors");
    // NOTE display-message -p -t <missing> silently falls back to a default
    // context instead of erroring — that's why paneInfo uses list-panes.
    // write path fails closed
    assert.throws(() => execFileSync("tmux", ["send-keys", "-t", anchored, "-H", "78"], { stdio: "pipe", timeout: 4000 }),
      "anchored send-keys errors instead of typing into the wrong window");
    assert.throws(() => execFileSync("tmux", ["send-keys", "-t", anchored, "C-c"], { stdio: "pipe", timeout: 4000 }),
      "anchored interrupt errors");
    // the exact-name window still works end to end
    const ok = tmuxTarget({ tmux: { session, window: "reviewer-15abc" } });
    execFileSync("tmux", ["send-keys", "-t", ok, "-H", "23"], { timeout: 4000 }); // harmless '#'
    assert.ok(execFileSync("tmux", ["capture-pane", "-p", "-t", ok], { encoding: "utf8", timeout: 4000 }) !== undefined);
  } finally {
    try { execFileSync("tmux", ["kill-session", "-t", `=${session}`], { timeout: 4000 }); } catch { /* already gone */ }
  }
});

test("desktop server: paneInfo: geometry comes from the ACTIVE pane, same pane capture/send target", (t) => {
  // Drive the REAL paneInfo (extracted marker block, with the real
  // tmuxTarget in scope) against a two-pane fixture where the active pane
  // is index 1 with a distinct width — reverting the -f '#{pane_active}'
  // filter makes this fail (row 0's width would be reported).
  const tgtSrc = extractBlock(SRV, "TMUXTGT");
  const piSrc = extractBlock(SRV, "PANEINFO");
  const paneInfo = new Function("execFileSync", `${tgtSrc}${piSrc}; return paneInfo;`)(execFileSync);
  const session = `oatswebpane${process.pid}`;
  try {
    execFileSync("tmux", ["new-session", "-d", "-s", session, "-n", "w1", "-x", "101", "-y", "30"], { timeout: 4000 });
  } catch { t.skip("tmux unavailable"); return; }
  try {
    const target = `=${session}:=w1`;
    execFileSync("tmux", ["split-window", "-h", "-t", target], { timeout: 4000 });
    execFileSync("tmux", ["resize-pane", "-t", `${target}.1`, "-x", "30"], { timeout: 4000 });
    execFileSync("tmux", ["select-pane", "-t", `${target}.1`], { timeout: 4000 });
    // print some output into pane 1 so its history/cursor differ from pane 0
    execFileSync("tmux", ["send-keys", "-t", `${target}.1`, "printf 'a\\nb\\nc\\n'", "Enter"], { timeout: 4000 });
    const paneW = (idx) => Number(execFileSync("tmux", ["display-message", "-p", "-t", `${target}.${idx}`, "#{pane_width}"],
      { encoding: "utf8", timeout: 4000 }).trim());
    const w0 = paneW(0), w1 = paneW(1);
    assert.notEqual(w0, w1, "fixture: the two panes have distinct widths");
    const info = paneInfo({ tmux: { session, window: "w1" } });
    assert.equal(info.size.cols, w1, "paneInfo reports the ACTIVE pane's width (pane 1), not row 0's");
    // same pane capture-pane operates on: the window target's active pane
    const capW = Number(execFileSync("tmux", ["display-message", "-p", "-t", `${target}.1`, "#{pane_width}"],
      { encoding: "utf8", timeout: 4000 }).trim());
    assert.equal(info.size.cols, capW, "geometry matches the pane capture/send target");
    // fail-closed path of the real function: missing window falls back to defaults
    const missing = paneInfo({ tmux: { session, window: "nope" } });
    assert.equal(missing.size.cols, 80, "missing window returns the safe default, never another pane");
  } finally {
    try { execFileSync("tmux", ["kill-session", "-t", `=${session}`], { timeout: 4000 }); } catch { /* gone */ }
  }
});
