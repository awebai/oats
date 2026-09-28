// 0.30 tag blocker (rehearsal case 10): `readiness --soul` and `inspect --soul` materialise the soul
// copy a spawn would (ensureWorkspaceSoul), so a provider's binding check always gets OATS_SOUL. Before,
// only a spawn at the current commit wrote agents/<soul>/souls/<commit12>/; for a soul not yet spawned
// there the provider got no OATS_SOUL (oats.okf answered "OKF soul declaration missing": a false
// negative on the first thing a newcomer and the Desktop soul page see).
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { git, soulFiles, v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";

// A locked package messaging provider whose binding check records the OATS_SOUL it was given (and
// whether that directory holds the soul), then answers ready.
const check = `import { appendFileSync, existsSync, readFileSync } from "node:fs";
readFileSync(0, "utf8");
const soul = process.env.OATS_SOUL;
appendFileSync(process.env.FX_SOUL_RECORD, JSON.stringify({ soul: soul ?? null, soulYaml: !!soul && existsSync(soul + "/soul.yaml") }) + "\\n");
process.stdout.write(JSON.stringify({ schemaVersion: 1, phase: "check", slot: "messaging", capability: "fx-msg", ok: true, result: { status: "ready", problems: [] } }) + "\\n");
`;

test("readiness --soul / inspect --soul materialise the soul copy: OATS_SOUL is the soul asked about, a second call reuses the copy, an earlier instance keeps its own commit's copy", (t) => {
  const pkg = packageRepo({
    manifest: { capabilities: ["capabilities/acme-tool", "capabilities/fx-msg"] },
    files: {
      "capabilities/fx-msg/oats.json": { capability: "fx-msg", version: "1.0.0", description: "stub messaging provider", compatibility: { oats: ">=0.24.0" }, layer: "messaging",
        commands: { "binding-check": "bin/check.mjs" }, binding: { version: 1, check: "binding-check" } },
      "capabilities/fx-msg/bin/check.mjs": check,
    },
  });
  t.after(pkg.cleanup);
  const fx = v2Deployment({ workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` }, defaults: { messaging: { "fx-msg": { from: "package" } } } } });
  t.after(fx.cleanup);
  const record = join(fx.base, "oats-soul.jsonl");
  const run = (...args) => { const r = fx.cli([...args, "--json"], { env: { FX_SOUL_RECORD: record } }); assert.equal(r.status, 0, r.stdout + r.stderr); const d = r.json(); assert.equal(d.ok, true, r.stdout); return d.result; };
  const seen = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const copyAt = () => join(fx.root, "dev", "souls", git(fx.member, "rev-parse", "HEAD").slice(0, 12));
  const provider = (doc) => doc.checks.providers.items.find((i) => i.subject === "fx-msg");
  run("sync");
  const copy = copyAt();
  assert.equal(existsSync(copy), false, "never spawned: no soul copy yet");

  // A copy that cannot be made is a readiness failure that says so, never a silent missing OATS_SOUL.
  mkdirSync(join(fx.root, "dev", "souls"), { recursive: true });
  chmodSync(join(fx.root, "dev", "souls"), 0o555);
  let doc;
  try { doc = run("readiness", "--soul", "dev"); } finally { chmodSync(join(fx.root, "dev", "souls"), 0o755); }
  const failed = doc.checks.installed.items.find((i) => i.producer === "soul copy");
  assert.equal(failed?.status, "fail", JSON.stringify(doc.checks.installed, null, 1));
  assert.match(failed.reason, /the soul could not be copied/);
  assert.equal(doc.summary.ready, false);
  assert.equal(existsSync(copy), false);

  // A soul never spawned at this commit: readiness materialises it and the check gets OATS_SOUL.
  doc = run("readiness", "--soul", "dev");
  assert.equal(provider(doc)?.status, "pass", JSON.stringify(provider(doc), null, 1));
  assert.deepEqual(seen().at(-1), { soul: realpathSync(copy), soulYaml: true });
  assert.equal(doc.checks.installed.items.some((i) => i.producer === "soul copy"), false);

  // inspect --soul reads the same copy; a second call reuses it (never refetched or rewritten).
  const mtime = statSync(join(copy, "soul.yaml")).mtimeMs;
  assert.equal(run("inspect", "--soul", "dev").souls[0].instructions.file, join(realpathSync(copy), "AGENTS.md"));
  run("readiness", "--soul", "dev");
  assert.deepEqual(seen().at(-1), { soul: realpathSync(copy), soulYaml: true });
  assert.equal(statSync(join(copy, "soul.yaml")).mtimeMs, mtime, "the per-commit copy is reused");

  // An instance spawned at this commit keeps its copy when the soul moves on and readiness copies the next one.
  const spawned = run("spawn", "dev", "--purpose", "early", "--no-launch");
  const pinned = JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8")).soulDir;
  assert.equal(pinned, realpathSync(copy));
  fx.commit(soulFiles("dev", { agents: "# dev, revised\n" }), "revise dev");
  const next = copyAt();
  assert.notEqual(next, copy);
  doc = run("readiness", "--soul", "dev");
  assert.equal(provider(doc)?.status, "pass");
  assert.deepEqual(seen().at(-1), { soul: realpathSync(next), soulYaml: true }, "the soul asked about: the current commit's copy");
  assert.equal(readFileSync(join(next, "AGENTS.md"), "utf8"), "# dev, revised\n");
  assert.equal(readFileSync(join(pinned, "AGENTS.md"), "utf8"), "# dev\n", "the instance's own commit copy is untouched");
  assert.equal(JSON.parse(readFileSync(join(spawned.home, "instance.json"), "utf8")).soulDir, pinned);
});
