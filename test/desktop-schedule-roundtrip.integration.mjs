// Cross-package integration needs both root and Desktop dependencies. Keep it
// outside Desktop's standalone suite, which must run with only its own install.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addSchedule, describe, updateSchedule, readDefinitions } from "../lib/schedule.mjs";
import { scheduleRequest } from "../packages/desktop/server/schedules.mjs";
import { tick, cli, spec, setup, posts } from "../packages/desktop/test/helpers/schedules-view.mjs";

test("a kernel schedule row survives a Desktop cron edit with its exact optional description", async () => {
  const base = mkdtempSync(join(tmpdir(), "oats-desktop-description-"));
  const previousHome = process.env.OATS_HOME_DIR;
  process.env.OATS_HOME_DIR = join(base, "host");
  const scope = join(base, "deployment"), targetHome = join(scope, "agents", "dev", "instances", "dev-seat");
  mkdirSync(targetHome, { recursive: true });
  writeFileSync(join(targetHome, "instance.json"), JSON.stringify({ instance: "dev-seat", home: targetHome, agent: "dev" }));
  writeFileSync(join(scope, "oats-local.yaml"), "schemaVersion: 2\nworkspace: example.invalid/acme/workspace\n");
  try {
    for (const description of ["  Review <work> — 🙂  ", undefined]) {
      const id = description === undefined ? "older" : "described";
      addSchedule(scope, { ...spec, id, home: targetHome, ...(description === undefined ? {} : { description }) });
      const initialRow = describe(scope, id);
      assert.equal(initialRow.description, description ?? null);
      const instances = [{ home: targetHome, instance: "dev-seat" }];
      const s = setup({ instances, read: async () => ({ schedules: [describe(scope, id)], scheduler: null }),
        mutate: (path, body) => scheduleRequest(body, { workspace: { id: scope, scope }, cli, instances,
          invoke: async (bin, args) => ({ ok: true, result: { schedule: updateSchedule(scope, args.id, args.spec) } }) }) });
      try {
        await tick(); s.rowAction(id, "edit").click(); await tick();
        const form = s.el.querySelector("form");
        assert.equal(form.elements.id.value, id, "kernel row opens an editable draft");
        form.elements.cron.value = "0 4 * * *";
        form.dispatchEvent(new s.dom.window.Event("submit", { cancelable: true })); await tick();
        const stored = readDefinitions(scope).jobs[id];
        assert.equal(stored.cron, "0 4 * * *", s.el.querySelector(".schedule-form-error").textContent);
        assert.equal(stored.description, description, "cron-only editing preserves exact description bytes");
        assert.equal(Object.hasOwn(stored, "description"), description !== undefined, "a null read projection is never stored");
        const submitted = JSON.parse(posts(s, "/api/schedules")[0].opts.body).spec;
        assert.equal(Object.hasOwn(submitted, "description"), description !== undefined);
      } finally { s.cleanup(); }
    }
  } finally {
    if (previousHome === undefined) delete process.env.OATS_HOME_DIR; else process.env.OATS_HOME_DIR = previousHome;
    rmSync(base, { recursive: true, force: true });
  }
});
