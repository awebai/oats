import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { enableTmuxMouse, tmuxConfigPath, tmuxMouseEnabled } from "../lib/tmux-config.mjs";

/** A new home directory of the test, removed when the test has ended. */
function tempHome(t) {
  const home = mkdtempSync(join(tmpdir(), "oats-tmux-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}

test("detects active mouse settings but ignores comments and mouse off", () => {
  assert.equal(tmuxMouseEnabled("set -g mouse on\n"), true);
  assert.equal(tmuxMouseEnabled("set-option -gq mouse 1 # enabled\n"), true);
  assert.equal(tmuxMouseEnabled("# set -g mouse on\nset -g mouse off\n"), false);
});

test("uses an existing XDG config when the legacy config is absent", (t) => {
  const home = tempHome(t);
  const xdg = join(home, "xdg");
  const config = join(xdg, "tmux", "tmux.conf");
  mkdirSync(join(xdg, "tmux"), { recursive: true });
  writeFileSync(config, "");
  assert.equal(tmuxConfigPath(home, { XDG_CONFIG_HOME: xdg }), config);
});

test("appends mouse support once without replacing existing config", (t) => {
  const home = tempHome(t);
  const config = join(home, ".tmux.conf");
  writeFileSync(config, "set -g history-limit 100000\n");

  const first = enableTmuxMouse(config);
  const second = enableTmuxMouse(config);
  const text = readFileSync(config, "utf8");

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.match(text, /set -g history-limit 100000/);
  assert.equal(text.match(/set -g mouse on/g)?.length, 1);
});
