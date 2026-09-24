// Instance homes carry no `soul` link (human decision, 2026-09-24): the composed
// AGENTS.md holds the soul's instructions, and the soul directory an instance
// incarnates is RECORDED in instance.json (`soulDir`). Every hook receives it as
// OATS_SOUL — including the hooks whose caller does not name a soul (launch,
// retire), which read the record.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instanceSoulDir, runLifecycleHooks } from "../lib/core.mjs";

function home(meta) {
  const base = mkdtempSync(join(tmpdir(), "oats-soul-dir-"));
  const h = join(base, "agents", "dev", "instances", "dev-a");
  mkdirSync(h, { recursive: true });
  if (meta) writeFileSync(join(h, "instance.json"), JSON.stringify(meta, null, 2) + "\n");
  return { base, h };
}

test("instanceSoulDir: the recorded absolute soulDir, else undefined (never a home link)", () => {
  const soul = join(tmpdir(), "some", "souls", "0123456789ab");
  const a = home({ agent: "dev", instance: "dev-a", soulDir: soul });
  const b = home({ agent: "dev", instance: "dev-a", soulDir: "relative/soul" });
  const c = home(null);
  try {
    assert.equal(instanceSoulDir(a.h), soul);
    assert.equal(instanceSoulDir(a.h, { soulDir: "/given/meta" }), "/given/meta", "a caller's parsed record wins over re-reading the file");
    assert.equal(instanceSoulDir(b.h), undefined, "a relative record is not a soul directory");
    assert.equal(instanceSoulDir(c.h), undefined, "no instance.json → no soul directory");
  } finally { for (const x of [a, b, c]) rmSync(x.base, { recursive: true, force: true }); }
});

test("runLifecycleHooks: a hook whose caller names no soul gets the home's recorded soulDir as OATS_SOUL; an explicit soulDir wins", () => {
  const soul = join(tmpdir(), "recorded", "souls", "0123456789ab");
  const { base, h } = home({ agent: "dev", instance: "dev-a", soulDir: soul });
  try {
    const out = join(base, "env.json");
    const hook = `node -e ${JSON.stringify(`require("node:fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify({ soul: process.env.OATS_SOUL }))`)}`;
    const resolved = { capabilities: [{ id: "probe", hooks: { retire: hook, launch: hook } }] };
    for (const event of ["retire", "launch"]) {
      const r = runLifecycleHooks(event, { home: h, instance: "dev-a", agentName: "dev", contextDir: base, resolved });
      assert.deepEqual(r.failures, []);
      assert.equal(JSON.parse(readFileSync(out, "utf8")).soul, soul, `${event}: OATS_SOUL is the recorded soul directory`);
    }
    runLifecycleHooks("retire", { home: h, instance: "dev-a", agentName: "dev", soulDir: "/explicit/soul", contextDir: base, resolved });
    assert.equal(JSON.parse(readFileSync(out, "utf8")).soul, "/explicit/soul");
  } finally { rmSync(base, { recursive: true, force: true }); }
});
