// The real-manager files run launchctl/systemctl for real; their guard must
// keep them out of pull-request CI and developer machines (#1108 D2).
import test from "node:test";
import assert from "node:assert/strict";
import { realManagerSkip } from "./fixtures/real-manager.mjs";

test("real-manager cases run only in a dispatched run of their own workflow on their own platform", () => {
  const dispatched = { darwin: { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_WORKFLOW: "macOS tests" },
    linux: { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_WORKFLOW: "Linux tests" } };
  for (const platform of ["darwin", "linux"]) {
    assert.equal(realManagerSkip(platform, dispatched[platform], platform), null);
    const other = platform === "darwin" ? "linux" : "darwin";
    for (const [env, actual] of [
      [{ GITHUB_EVENT_NAME: "pull_request", GITHUB_WORKFLOW: "CI", CI: "true", GITHUB_ACTIONS: "true" }, platform], // pull-request CI
      [{ GITHUB_EVENT_NAME: "push", GITHUB_WORKFLOW: "CI", CI: "true", GITHUB_ACTIONS: "true" }, platform],
      [{ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_WORKFLOW: "CI" }, platform],
      [{ GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_WORKFLOW: dispatched[other].GITHUB_WORKFLOW }, platform],
      [{ CI: "true", GITHUB_ACTIONS: "true" }, platform],
      [{}, platform], // a developer machine
      [dispatched[platform], other],
    ]) assert.match(realManagerSkip(platform, env, actual), /^real (darwin|linux) manager cases (need|run only)/, JSON.stringify({ env, actual }));
  }
  assert.throws(() => realManagerSkip("win32", {}, "win32"), /no real-manager workflow/);
});
