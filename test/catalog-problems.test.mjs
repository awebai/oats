// Exercise the real CLI and Git discovery with disposable deployments and remotes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, v2Deployment } from "./helpers/v2-deployment.mjs";
import * as remoteModule from "../lib/remote.mjs";
import { terminalText } from "../lib/refused-text.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";

function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  const doc = result.json();
  assert.equal(doc.ok, true);
  return doc.result;
}

function compare(fx, kind) {
  const json = success(fx.cli([kind, "--json"]));
  const text = fx.cli([kind]);
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.equal(text.stderr, "");
  assert.deepEqual(text.stdout.split("\n").filter((line) => line.startsWith("! ")),
    json.problems.map((p) => {
      const context = p.repoKey ? `${p.repoKey}: ${p.path}` : p.package ? `${p.package}: ${p.path}` : p.source ? `${remoteModule.redactUrl(p.source, null, { reference: true })}: ${p.path}` : null;
      return `! ${p.code}: ${p.message}${context === null ? "" : ` [${terminalText(context)}]`}`;
    }));
  for (const item of json[kind]) {
    assert.ok(text.stdout.includes(item.name), item.name);
    assert.ok(text.stdout.includes(item.origin), item.origin);
  }
  if (json.problems.length) {
    const firstProblem = text.stdout.indexOf("\n! ");
    for (const item of json[kind]) assert.ok(text.stdout.indexOf(item.origin) < firstProblem, "problems follow the table");
  }
  return { json, text };
}

for (const kind of ["souls", "capabilities"]) {
  test(`${kind}: every locked-package read problem appears in JSON order, with existing unmatched rows`, (t) => {
    const pkg = packageRepo({ souls: { keeper: {}, writer: {} } });
    t.after(pkg.cleanup);
    git(pkg.bare, "config", "uploadpack.allowFilter", "true");
    git(pkg.bare, "config", "uploadpack.allowAnySHA1InWant", "true");
    const fx = v2Deployment({ t, capabilities: { house: {} },
      workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } },
      local: { souls: { launch: { "absent/zulu": { harness: "codex" }, "absent/alpha": { harness: "codex" } } } },
    });
    success(fx.cli(["sync", "--json"]));
    // A real locked package becomes unreadable; remove only the fixture cache so
    // previously fetched blobs cannot hide the failure. No remote layer is mocked.
    renameSync(pkg.bare, `${pkg.bare}.blocked`);
    rmSync(fx.env.OATS_REMOTE_CACHE, { recursive: true, force: true });
    const json = success(fx.cli([kind, "--json"]));
    const reads = json.problems.filter((p) => p.code === "E_REMOTE_UNREADABLE");
    assert.equal(reads.length, 2);
    assert.deepEqual(reads.map((p) => p.package), ["acme.pkg", "acme.pkg"]);
    assert.deepEqual(reads.map((p) => p.path), ["keeper", "writer"].map((s) => `package:acme.pkg:oats-package/souls/${s}/soul.yaml`));
    assert.deepEqual(json.problems.slice(2).map((p) => [p.code, p.key]), kind === "souls"
      ? [["E_LAUNCH_PREFERENCE_UNMATCHED", "absent/alpha"], ["E_LAUNCH_PREFERENCE_UNMATCHED", "absent/zulu"]] : []);
    const result = compare(fx, kind);
    assert.ok(result.text.stdout.includes(`! E_REMOTE_UNREADABLE: ${reads[0].message} [acme.pkg: package:acme.pkg:oats-package/souls/keeper/soul.yaml]`), "package owner and soul path are printed together");
    assert.deepEqual(result.json.problems, json.problems, "the same failed state produces the same ordered problems");
    assert.ok(result.json[kind].some((item) => item.name === (kind === "souls" ? "dev" : "house")));
    if (kind === "souls") assert.ok(!result.json.souls.some((s) => s.kind === "package"));
    else assert.ok(result.json.capabilities.some((c) => c.package === "acme.pkg"), "locked capabilities remain listed despite soul read failures");
  });

  test(`${kind}: healthy and empty catalogs have no diagnostic lines; fatal refusal remains nonzero`, (t) => {
    const fx = v2Deployment({ t, capabilities: { house: {} } });
    assert.deepEqual(compare(fx, kind).json.problems, []);
    fx.commit({ "souls/dev/soul.yaml": null, "capabilities/house/oats.json": null });
    const empty = compare(fx, kind);
    assert.deepEqual(empty.json[kind], []);
    assert.deepEqual(empty.json.problems, []);
    assert.match(empty.text.stdout, /\n  \(none\)\n/);
    writeFileSync(join(fx.dep, "oats-local.yaml"), `schemaVersion: 2\nworkspace: file://${fx.repo}.missing\n`);
    const json = fx.cli([kind, "--json"]), text = fx.cli([kind]);
    assert.equal(json.status, 1);
    assert.equal(json.json().ok, false);
    assert.equal(json.json().error.code, "E_REMOTE_UNREADABLE");
    assert.equal(text.status, 1);
    assert.equal(text.stdout, "");
    assert.match(text.stderr, /^oats: /);
  });
}

for (const kind of ["souls", "capabilities"]) {
  test(`${kind}: member diagnostics retain listed items and escape existing path context`, (t) => {
    const fx = v2Deployment({ t, capabilities: { house: {} }, souls: {
      dev: { soul: { name: "renamed" } },
      broken: { soul: { capabilities: { "bad\u202ename": { from: "here" } } } },
    } });
    const json = success(fx.cli([kind, "--json"]));
    assert.ok(json.problems.some((p) => p.repoKey === fx.key && p.path.includes("bad\u202ename")), JSON.stringify(json.problems));
    assert.ok(json.problems.some((p) => p.path === "souls/dev/soul.yaml#/name"));
    if (kind === "souls") assert.ok(json.souls.some((s) => s.name === "renamed"), "a name mismatch does not omit the item");
    const { text } = compare(fx, kind);
    assert.ok(text.stdout.includes(` [${fx.key}: souls/broken/soul.yaml#/capabilities/bad\\u{202e}name]`), text.stdout);
  });
}

for (const kind of ["souls", "capabilities"]) {
  test(`${kind}: source-owned diagnostics show their display source and existing path`, (t) => {
    const pkg = packageRepo();
    t.after(pkg.cleanup);
    git(pkg.bare, "config", "uploadpack.allowFilter", "true");
    git(pkg.bare, "config", "uploadpack.allowAnySHA1InWant", "true");
    const source = `${pkg.ref.slice(4)}@${pkg.commit1}`;
    const workspace = { external: [{ source, soul: "missing" }] };
    const fx = v2Deployment({ t, workspace });
    const { json, text } = compare(fx, kind);
    assert.equal(json.problems.length, 1);
    assert.equal(json.problems[0].source, source);
    assert.equal(json.problems[0].path, "external/0:missing/soul.yaml");
    const expected = ` [${terminalText(source)}: external/0:missing/soul.yaml]`;
    assert.ok(text.stdout.split("\n").find(line => line.startsWith("! ")).endsWith(expected));
    assert.equal(workspace.external[0].source, source);
  });
}


test("catalog bracket constructs or withholds diagnostic source and escapes its known location", () => {
  const source = readFileSync(new URL("../bin/oats.mjs", import.meta.url), "utf8");
  const definition = source.match(/function catalogProblemLine\(p\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(definition);
  const line = new Function("remoteModule", "terminalText", `${definition}; return catalogProblemLine;`)(remoteModule, terminalText);
  for (const [raw, display] of [
    ["https://CATALOG_MARKER@host.invalid/org/repo", "https://host.invalid/org/repo"],
    ["https://CATALOG_MARKER@host.invalid/org/repo,https://other.invalid/a/b", "[repository reference withheld]"],
    ["[repository reference withheld]", "[repository reference withheld]"],
  ]) {
    const problem = { code: "E_WORKSPACE_SCHEMA", message: "invalid soul", source: raw, path: "external/0:souls/x/soul.yaml#/capabilities/bad\u202ename/from" };
    const before = structuredClone(problem);
    assert.equal(line(problem), `! E_WORKSPACE_SCHEMA: invalid soul [${display}: ${terminalText(problem.path)}]`);
    assert.ok(!line(problem).includes("CATALOG_MARKER"));
    assert.deepEqual(problem, before, "listing is a display projection only");
  }
});
