// A retire forgets the wake schedules of the home it retired (awebai/oats#693): through the real CLI, by name
// without --home and with an explicit --home, the retiree's definitions go, another home's stay, and no warning
// says the cleanup failed. Before the fix a retire by name handed the cleanup an instance record, not a path,
// and every wake definition made it throw.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { workspaceOf } from "../lib/core.mjs";
import { listSchedules, saveWakeForHome, scheduleScopeOf } from "../lib/schedule.mjs";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const WAKE = { cron: "*/10 * * * *", tz: "UTC", message: "ping" };

for (const byHome of [false, true]) {
  test(`a retire ${byHome ? "with --home" : "by name, without --home,"} removes the retiree's wake schedules and keeps another home's`, async (t) => {
    const fx = v2Deployment(); t.after(fx.cleanup);
    const retiree = await fx.spawn("dev", { instance: "dev-retiree" });
    const other = await fx.spawn("dev", { instance: "dev-other" });
    const ws = scheduleScopeOf(workspaceOf(fx.root));
    const wakes = () => fx.inEnv(() => listSchedules(ws).schedules.filter((s) => s.kind === "wake").map((s) => s.id).sort());
    await fx.inEnv(() => {
      saveWakeForHome(ws, { instance: "dev-retiree", home: retiree.home, wake: WAKE });
      saveWakeForHome(ws, { instance: "dev-other", home: other.home, wake: WAKE });
    });
    assert.deepEqual(await wakes(), ["wake-dev-other", "wake-dev-retiree"], "fixture premise: one wake schedule per home");

    const r = fx.cli(["retire", "dev-retiree", ...(byHome ? ["--home", retiree.home] : []), "--dir", fx.dep, "--json"]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const receipt = JSON.parse(r.stdout);
    assert.equal(receipt.retired, "dev-retiree");
    assert.equal(existsSync(retiree.home), false, "the home is retired");
    assert.deepEqual(receipt.wakeSchedulesRemoved, ["wake-dev-retiree"]);
    assert.ok(!(receipt.warnings || []).some((w) => /wake schedules not cleaned/.test(w)), JSON.stringify(receipt.warnings));
    assert.deepEqual(await wakes(), ["wake-dev-other"], "the other home's wake schedule is kept");
  });
}
