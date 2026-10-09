// The suites that drive a real tmux (test/tui-terminal.test.mjs and the others that skip without
// one) skip on a host that has none, so that a contributor without tmux still gets a run. In CI
// that skip would be silent: the suite would be green with the terminal untested. Here CI fails
// instead, and says why (docs/implementation.md names tmux as a prerequisite of the suite).
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { systemExecutable } from "./helpers/host-fixture.mjs";

test("tmux is on PATH wherever CI runs the suite: with CI set and no tmux this fails, so the tests that need a real tmux cannot skip there unnoticed", (t) => {
  let tmux = null;
  try { tmux = systemExecutable("tmux"); } catch { /* not installed */ }
  if (tmux) {
    const version = execFileSync(tmux, ["-V"], { encoding: "utf8", timeout: 10000 }).trim();
    t.diagnostic(`${tmux}: ${version}`);
    assert.match(version, /^tmux /);
    return;
  }
  if (process.env.CI) assert.fail(`CI is set (CI=${JSON.stringify(process.env.CI)}) and tmux is not on PATH: every test that drives a real tmux (test/tui-terminal.test.mjs among them) would skip here, and the run would pass without them. Install tmux on this runner.`);
  t.skip("tmux is not on PATH: outside CI the tests that drive a real tmux skip, and so does this one (with CI set it fails)");
});
