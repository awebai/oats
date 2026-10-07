// Feature soul-composed-instructions: `oats inspect --soul <soul> --instructions` reports the AGENTS.md
// a spawn of that soul here (no flags) would write, with where each part of it is
// (lib/soul-composition.mjs composeSoulInstructions, lib/instance-inspect.mjs withComposedInstructions).
//
// What is pinned here, over real deployments (test/helpers/v2-deployment.mjs) and real spawns:
// - `text` is byte-equal to the spawned home's AGENTS.md once its capability markers are made
//   home-relative (`src=<home>/` → `src=`); kernel markers keep absolute paths in both. Across
//   work modes, a package soul, a soul with no capability inject, non-ASCII bodies and bodies with
//   no / several trailing newlines.
// - the ranges tile the text (body, then every source in order, the last ending at text.length),
//   each source slice is exactly its marked block, and `file` is home-relative or null.
// - `resolution` is the revision a spawn at the same resolution records in instance.json.
// - the scratch home lives in the process's TMPDIR and is gone afterwards (success and failure);
//   without the flag nothing is composed (no key, no scratch home).
// - a soul that resolves but cannot be composed: null + one problem, still one ok envelope.
// - the cap, and doctor --soul's home-relative capability blocks.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";
import { packageRepo } from "./helpers/package-repo.mjs";
import { composeSoulInstructions } from "../lib/soul-composition.mjs";
import { inspectDocument, withComposedInstructions } from "../lib/instance-inspect.mjs";

const SCRATCH = "oats-compose-home-";
const ops = { "acme.ops": { manifest: { inject: "inject.md" }, files: { "inject.md": "## Ops instructions\n\nRun the ops.\n" } } };
const withOps = (soul = {}) => ({ capabilities: { "acme.ops": { from: "here" } }, ...soul });

/** A private TMPDIR for one child process (inside the fixture base, outside the deployment):
 *  the only place a scratch home of that process can land. */
function privateTmp(fx, name) {
  const dir = join(fx.base, `tmp-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
const scratchHomes = (dir) => readdirSync(dir).filter((n) => n.startsWith(SCRATCH));

/** Run an in-process kernel call with TMPDIR at `tmp`. os.tmpdir() reads the process's real
 *  environment, so TMPDIR is set on the real process.env (fx.inEnv swaps in a plain copy, whose
 *  writes os.tmpdir() never sees), and restored afterwards. */
async function withTmpdir(fx, tmp, fn) {
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try { return await fx.inEnv(fn); }
  finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
}

function okResult(r, what) {
  assert.equal(r.status, 0, `${what}: ${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `${what}: one envelope, nothing else on stdout: ${r.stdout}`);
  const j = JSON.parse(lines[0]);
  assert.equal(j.ok, true, `${what}: ${r.stdout}`);
  return j.result;
}

/** `inspect --soul <soul> --instructions --json` in a private TMPDIR → { result, ci }; asserts the
 *  scratch home it composed in is gone. */
function inspectComposed(fx, soul, { tmp = privateTmp(fx, "inspect"), extra = [] } = {}) {
  const result = okResult(fx.cli(["inspect", "--soul", soul, "--instructions", ...extra, "--json"], { env: { TMPDIR: tmp } }), `inspect --soul ${soul} --instructions`);
  assert.deepEqual(scratchHomes(tmp), [], "the scratch home is removed before the command returns");
  assert.equal(result.souls.length, 1);
  assert.ok(Object.hasOwn(result.souls[0], "composedInstructions"), "the key is present when asked for");
  return { result, ci: result.souls[0].composedInstructions };
}

/** `oats spawn <soul> --no-launch` → { home, text (src=<home>/ made home-relative), raw, meta }. */
function spawned(fx, soul, purpose) {
  const r = okResult(fx.cli(["spawn", soul, "--purpose", purpose, "--no-launch", "--json"]), `spawn ${soul}`);
  const raw = readFileSync(join(r.home, "AGENTS.md"), "utf8");
  return { home: r.home, raw, text: raw.split(`src=${r.home}/`).join("src="), meta: JSON.parse(readFileSync(join(r.home, "instance.json"), "utf8")) };
}

/** The contract's range rules, checked against the text the ranges index. */
function assertTiling(ci, { bodyFile } = {}) {
  assert.deepEqual(Object.keys(ci).sort(), ["body", "file", "resolution", "sources", "text", "truncated"]);
  assert.equal(ci.file, null);
  assert.equal(ci.truncated, false);
  assert.equal(typeof ci.resolution, "string");
  const { text, body, sources } = ci;
  assert.deepEqual(Object.keys(body).sort(), ["end", "start", "truncated"]);
  assert.equal(body.start, 0);
  assert.equal(body.truncated, false);
  if (!sources.length) assert.equal(body.end, text.length);
  else assert.equal(sources[0].start, body.end);
  sources.forEach((s, i) => {
    assert.deepEqual(Object.keys(s).sort(), ["end", "file", "source", "start", "truncated"]);
    assert.equal(s.truncated, false);
    assert.ok(s.start < s.end, `${s.source}: a non-empty part`);
    if (i + 1 < sources.length) assert.equal(sources[i + 1].start, s.end, `${s.source} ends where the next part starts`);
    else assert.equal(s.end, text.length, "the last part ends at text.length");
    const slice = text.slice(s.start, s.end);
    assert.ok(slice.startsWith(`<!-- oats:${s.source} `), `${s.source}: starts at its opening marker: ${JSON.stringify(slice.slice(0, 80))}`);
    assert.ok(slice.trimEnd().endsWith(`<!-- /oats:${s.source} -->`), `${s.source}: ends with its closing marker`);
    if (i + 1 < sources.length) assert.ok(slice.endsWith("-->\n\n"), `${s.source}: a blank separator line before the next part`);
    else assert.ok(slice.endsWith("-->\n"));
    if (s.source.startsWith("capability:")) {
      assert.equal(typeof s.file, "string");
      assert.ok(!isAbsolute(s.file), `${s.source}: never an absolute file (${s.file})`);
      assert.ok(s.file.startsWith(`.oats/modules/${s.source.slice("capability:".length)}/`), s.file);
      assert.ok(slice.startsWith(`<!-- oats:${s.source} src=${s.file} -->\n`), `${s.source}: the marker names the same home-relative file`);
    } else {
      assert.match(s.source, /^(kernel|work-mode):/);
      assert.equal(s.file, null, `${s.source}: no file reported`);
      const src = slice.match(/^<!-- oats:\S+ src=(\S+) -->/)?.[1];
      assert.ok(src && isAbsolute(src), `${s.source}: a kernel marker keeps its absolute path (${src})`);
    }
  });
  if (bodyFile !== undefined) {
    const normalized = bodyFile.replace(/\n*$/, "\n");
    assert.equal(text.slice(body.start, body.end), sources.length ? `${normalized}\n` : normalized, "the body part is the soul's AGENTS.md, trailing newlines normalized, plus the separator");
  }
}

test("inspect --soul --instructions is what spawn writes (member soul, directory mode, a capability inject, a non-ASCII body): ranges tile it, resolution is the spawn's, the scratch home is removed; without the flag nothing is composed", (t) => {
  const body = "# dev\n\nCafé — 日本語 🎉 naïve ✓\n\nThe soul's own words.\n";
  const fx = v2Deployment({ souls: { dev: { soul: withOps(), agents: body } }, capabilities: ops });
  t.after(fx.cleanup);

  // Without --instructions: no key, and nothing composed (no scratch home ever made in this process's TMPDIR).
  const plainTmp = privateTmp(fx, "plain");
  const plain = okResult(fx.cli(["inspect", "--soul", "dev", "--json"], { env: { TMPDIR: plainTmp } }), "inspect --soul");
  assert.equal(Object.hasOwn(plain.souls[0], "composedInstructions"), false, "the key is absent unless asked for");
  assert.deepEqual(readdirSync(plainTmp), [], "no scratch home was created without the flag");

  const { result, ci } = inspectComposed(fx, "dev");
  assertTiling(ci, { bodyFile: body });
  assert.deepEqual(ci.sources.map((s) => [s.source, s.file]), [
    ["kernel:instance-boundary", null], ["work-mode:directory", null], ["capability:acme.ops", ".oats/modules/acme.ops/inject.md"]]);
  assert.ok(ci.text.includes("Café — 日本語 🎉 naïve ✓"));
  const opsPart = ci.sources[2];
  assert.equal(ci.text.slice(opsPart.start, opsPart.end), "<!-- oats:capability:acme.ops src=.oats/modules/acme.ops/inject.md -->\n## Ops instructions\n\nRun the ops.\n<!-- /oats:capability:acme.ops -->\n");
  // The rest of the soul row is what plain inspect reports.
  const { composedInstructions: _, ...row } = result.souls[0];
  assert.deepEqual(row, plain.souls[0]);
  assert.equal(result.problems.some((p) => String(p.message).startsWith("composedInstructions:")), false);

  // A spawn at the same resolution writes the same document and records the same revision.
  const s = spawned(fx, "dev", "eq");
  assert.equal(ci.text, s.text, "text is what the spawn wrote, capability markers home-relative");
  assert.ok(s.raw.includes(`src=${s.home}/.oats/modules/acme.ops/inject.md`), "the spawned file names the inject inside its home");
  assert.equal(ci.resolution, s.meta.workspace.resolution);

  // Text mode: the report, then the composed document.
  const tmp = privateTmp(fx, "text");
  const r = fx.cli(["inspect", "--soul", "dev", "--instructions"], { env: { TMPDIR: tmp } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const at = r.stdout.indexOf(`\nComposed AGENTS.md (a spawn here, resolution ${ci.resolution}):\n\n`);
  assert.ok(at > 0, `text mode appends the composed AGENTS.md after the report: ${r.stdout}`);
  assert.ok(r.stdout.slice(at).includes(ci.text.trimEnd()));
  assert.deepEqual(scratchHomes(tmp), []);
  assert.doesNotMatch(fx.cli(["inspect", "--soul", "dev"]).stdout, /Composed AGENTS\.md/);
});

test("every work mode composes its own work-mode block, as its spawn does", (t) => {
  const modes = ["directory", "checkout", "worktree", "workspace"];
  const fx = v2Deployment({
    souls: Object.fromEntries(modes.map((m) => [`s-${m}`, { soul: withOps({ work: m }), agents: `# s-${m}\n` }])),
    capabilities: ops,
  });
  t.after(fx.cleanup);
  for (const mode of modes) {
    const { ci } = inspectComposed(fx, `s-${mode}`);
    assertTiling(ci, { bodyFile: `# s-${mode}\n` });
    assert.deepEqual(ci.sources.map((s) => s.source), ["kernel:instance-boundary", `work-mode:${mode}`, "capability:acme.ops"]);
    const s = spawned(fx, `s-${mode}`, "eq");
    assert.equal(s.meta.work, mode);
    assert.equal(ci.text, s.text, `work: ${mode}`);
    assert.equal(ci.resolution, s.meta.workspace.resolution);
  }
});

test("a soul with no capability inject has only kernel blocks; a body with no trailing newline or several is normalized as spawn normalizes it", (t) => {
  const bodies = { bare: "# bare\n\nno trailing newline", many: "# many\n\nseveral trailing newlines\n\n\n\n", plain: "# plain\n" };
  const fx = v2Deployment({ souls: Object.fromEntries(Object.entries(bodies).map(([n, agents]) => [n, { agents }])) });
  t.after(fx.cleanup);
  for (const [name, body] of Object.entries(bodies)) {
    const { ci } = inspectComposed(fx, name);
    assertTiling(ci, { bodyFile: body });
    assert.deepEqual(ci.sources.map((s) => [s.source, s.file]), [["kernel:instance-boundary", null], ["work-mode:directory", null]]);
    assert.equal(ci.text.slice(0, ci.body.end), `${body.replace(/\n*$/, "")}\n\n`);
    assert.equal(ci.text, spawned(fx, name, "eq").text, name);
  }
});

test("a package soul (<package>/<soul>) composes as its spawn does, its capability inject home-relative", (t) => {
  const pkg = packageRepo({
    souls: { keeper: { soul: { capabilities: { "acme-tool": { from: "here" }, "pkg-ops": { from: "here" } } }, agents: "# keeper (package)\n\nKeeps — 保管.\n" } },
    manifest: { capabilities: ["capabilities/acme-tool", "capabilities/pkg-ops"] },
    files: {
      "capabilities/pkg-ops/oats.json": { capability: "pkg-ops", version: "1.0.0", description: "package ops", compatibility: { oats: ">=0.24.0" }, inject: "docs/inject.md" },
      "capabilities/pkg-ops/docs/inject.md": "## Package ops\n",
    },
  });
  t.after(pkg.cleanup);
  const fx = v2Deployment({ name: "acme", workspace: { packages: { "acme.pkg": `${pkg.ref}@v1.0.0` } } });
  t.after(fx.cleanup);
  okResult(fx.cli(["sync", "--json"]), "sync");
  const { result, ci } = inspectComposed(fx, "acme.pkg/keeper");
  assert.equal(result.souls[0].name, "keeper");
  assertTiling(ci, { bodyFile: "# keeper (package)\n\nKeeps — 保管.\n" });
  assert.deepEqual(ci.sources.map((s) => [s.source, s.file]), [
    ["kernel:instance-boundary", null], ["work-mode:directory", null], ["capability:pkg-ops", ".oats/modules/pkg-ops/docs/inject.md"]]);
  const s = spawned(fx, "acme.pkg/keeper", "eq");
  assert.equal(ci.text, s.text);
  assert.equal(ci.resolution, s.meta.workspace.resolution);
});

test("--instructions is a soul flag: with --home it is E_BAD_ARGS (one envelope); inspect --home has no composedInstructions key", (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: withOps() } }, capabilities: ops });
  t.after(fx.cleanup);
  const { home } = spawned(fx, "dev", "h");
  const tmp = privateTmp(fx, "home");
  const r = fx.cli(["inspect", "--home", home, "--instructions", "--json"], { env: { TMPDIR: tmp } });
  assert.notEqual(r.status, 0);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1, `one envelope: ${r.stdout}`);
  const j = JSON.parse(lines[0]);
  assert.equal(j.ok, false);
  assert.equal(j.error.code, "E_BAD_ARGS");
  assert.match(j.error.message, /--instructions/);
  assert.match(j.error.message, /--home/);
  assert.deepEqual(readdirSync(tmp), []);
  const doc = okResult(fx.cli(["inspect", "--home", home, "--json"]), "inspect --home");
  assert.equal(Object.hasOwn(doc.souls[0], "composedInstructions"), false);
  assert.equal(typeof doc.instance.instructions.text, "string", "a home's composed AGENTS.md is instance.instructions");
});

test("a soul that resolves but cannot be composed here: composedInstructions null, one ok envelope, one problem naming it; the scratch home is removed", (t) => {
  const fx = v2Deployment({
    souls: { dev: { soul: withOps() } },
    // The manifest's inject names a file the capability does not carry: materialize refuses it.
    capabilities: { "acme.ops": { manifest: { inject: "missing.md" }, files: { "README.md": "no inject here\n" } } },
  });
  t.after(fx.cleanup);
  const plain = okResult(fx.cli(["inspect", "--soul", "dev", "--json"]), "inspect --soul (no flag)");
  const tmp = privateTmp(fx, "fail");
  const { result, ci } = inspectComposed(fx, "dev", { tmp });
  assert.equal(ci, null);
  const added = result.problems.filter((p) => !plain.problems.some((q) => JSON.stringify(q) === JSON.stringify(p)));
  assert.equal(added.length, 1, JSON.stringify(result.problems));
  assert.deepEqual(Object.keys(added[0]).sort(), ["code", "message"]);
  assert.match(added[0].code, /^E_/);
  assert.equal(added[0].code, "E_MATERIALIZE_RESOLUTION");
  assert.ok(added[0].message.startsWith("composedInstructions: "), added[0].message);
  assert.match(added[0].message, /missing\.md/);
  // Text mode says it is unavailable.
  const r = fx.cli(["inspect", "--soul", "dev", "--instructions"], { env: { TMPDIR: tmp } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Composed AGENTS\.md: unavailable \(see the problems above\)/);
  assert.match(r.stdout, /! E_MATERIALIZE_RESOLUTION: composedInstructions: /);
  assert.deepEqual(scratchHomes(tmp), []);
});

test("no scratch home can be made (an unwritable TMPDIR): composedInstructions null with an E_MATERIALIZE_HOME problem, still one ok envelope", (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: withOps() } }, capabilities: ops });
  t.after(fx.cleanup);
  const tmp = privateTmp(fx, "unwritable");
  chmodSync(tmp, 0o500);
  let composed;
  try { composed = inspectComposed(fx, "dev", { tmp }); } finally { chmodSync(tmp, 0o700); }
  const { result, ci } = composed;
  assert.equal(ci, null);
  const problem = result.problems.find((p) => String(p.message).startsWith("composedInstructions:"));
  assert.deepEqual(Object.keys(problem).sort(), ["code", "message"]);
  assert.equal(problem.code, "E_MATERIALIZE_HOME");
});

test("composeSoulInstructions caps the text and clamps every range: a cut part ends at the cap, later parts are listed empty at it, a cut body too", async (t) => {
  const body = "# dev\n\nÉté — 夏 🌞\n";
  const fx = v2Deployment({ souls: { dev: { soul: withOps(), agents: body } }, capabilities: ops });
  t.after(fx.cleanup);
  const tmp = privateTmp(fx, "cap");
  const compose = (cap) => withTmpdir(fx, tmp, async () => {
    const { prepared } = await fx.prepare("dev");
    const { ensureWorkspaceSoul, materializePrepared } = await import("../lib/instance-resolution.mjs");
    const soulDir = await ensureWorkspaceSoul(prepared, fx.root);
    // The real materialize, observed: where the scratch home was.
    const materialize = (p, home) => { homes.push(home); return materializePrepared(p, home); };
    return composeSoulInstructions({ deployment: fx.dep, prepared, soulDir, materialize, ...(cap === undefined ? {} : { cap }) });
  });
  const homes = [];
  const full = await compose();
  assert.equal(homes.length, 1);
  assert.ok(homes[0].startsWith(`${tmp}/${SCRATCH}`), `the scratch home is in TMPDIR, outside the deployment: ${homes[0]}`);
  assert.deepEqual(scratchHomes(tmp), []);
  const ci = full.composedInstructions;
  assertTiling(ci, { bodyFile: body });
  assert.equal(full.text, ci.text, "under the cap the reported text is the whole document");
  assert.equal(full.blocks.length, 3);
  assert.deepEqual(full.blocks.filter((b) => b.materialized).map((b) => [b.source, b.file]), [["capability:acme.ops", ".oats/modules/acme.ops/inject.md"]]);
  const [boundary, mode, cap] = ci.sources;

  // (a)+(b): the cap falls inside the work-mode block: it is cut, the capability block is wholly past.
  const cut = mode.start + 10;
  const capped = (await compose(cut)).composedInstructions;
  assert.equal(capped.text, ci.text.slice(0, cut));
  assert.equal(capped.text.length, cut);
  assert.equal(capped.truncated, true);
  assert.equal(capped.resolution, ci.resolution);
  assert.deepEqual(capped.body, { ...ci.body, truncated: false });
  assert.deepEqual(capped.sources, [
    { ...boundary, truncated: false },
    { source: mode.source, file: null, start: mode.start, end: cut, truncated: true },
    { source: cap.source, file: cap.file, start: cut, end: cut, truncated: true },
  ]);
  // A cap exactly at a part's end does not cut that part.
  const atEnd = (await compose(boundary.end)).composedInstructions;
  assert.deepEqual(atEnd.sources.map((s) => [s.start, s.end, s.truncated]), [[boundary.start, boundary.end, false], [boundary.end, boundary.end, true], [boundary.end, boundary.end, true]]);
  assert.deepEqual(atEnd.body, { start: 0, end: ci.body.end, truncated: false });

  // A cap inside the (non-ASCII) body: the body is cut, every source is listed empty at the cap.
  const small = body.indexOf("🌞");
  const tiny = (await compose(small)).composedInstructions;
  assert.equal(tiny.text, body.slice(0, small));
  assert.equal(tiny.truncated, true);
  assert.deepEqual(tiny.body, { start: 0, end: small, truncated: true });
  assert.deepEqual(tiny.sources.map((s) => [s.source, s.start, s.end, s.truncated]), ci.sources.map((s) => [s.source, small, small, true]));
  assert.deepEqual(scratchHomes(tmp), [], "every scratch home removed");
});

test("composeSoulInstructions refuses a materialize that wrote something other than the composition (E_COMPOSITION_INCOMPLETE), removing the scratch home", async (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: withOps() } }, capabilities: ops });
  t.after(fx.cleanup);
  const tmp = privateTmp(fx, "guard");
  const run = (materialize) => withTmpdir(fx, tmp, async () => {
    const { prepared } = await fx.prepare("dev");
    const { ensureWorkspaceSoul } = await import("../lib/instance-resolution.mjs");
    const soulDir = await ensureWorkspaceSoul(prepared, fx.root);
    return composeSoulInstructions({ deployment: fx.dep, prepared, soulDir, materialize });
  });
  let seenHome = null;
  await assert.rejects(run(async (p, home) => { seenHome = home; writeFileSync(join(home, "AGENTS.md"), `${p.soulAgentsMd}extra\n`); return { blocks: [] }; }), (e) => e.code === "E_COMPOSITION_INCOMPLETE");
  assert.ok(seenHome && seenHome.startsWith(tmp) && !seenHome.startsWith(fx.dep), `the scratch home is in TMPDIR, outside the deployment: ${seenHome}`);
  // A capability block reported outside the scratch home.
  await assert.rejects(run(async (p, home) => {
    const block = { source: "capability:acme.ops", file: join(fx.base, "elsewhere.md"), content: "x" };
    const { renderInstructionText } = await import("../lib/instruction-composition.mjs");
    const kernel = p.soulAgentsMd;
    writeFileSync(join(home, "AGENTS.md"), renderInstructionText(kernel, [block]));
    return { blocks: [block] };
  }), (e) => e.code === "E_COMPOSITION_INCOMPLETE");
  // materialize's own refusal passes through unchanged.
  await assert.rejects(run(async () => { throw Object.assign(new Error("boom"), { code: "E_MATERIALIZE_SOURCE" }); }), (e) => e.code === "E_MATERIALIZE_SOURCE");
  assert.deepEqual(scratchHomes(tmp), []);
});

test("withComposedInstructions: a coded refusal is null plus a {code, message} problem; a soul copy error is null with no added problem; other targets and errors untouched", async () => {
  const soulTarget = (soul = {}) => ({ kind: "soul", deployment: "/d", prepared: { resolution: { revision: "r" } }, soul: { name: "dev", soulDir: "/d/agents/dev/souls/x", problems: [], ...soul } });
  const value = { file: null, text: "x\n", truncated: false, resolution: "r", body: { start: 0, end: 2, truncated: false }, sources: [] };
  let called = 0;
  const good = await withComposedInstructions(soulTarget(), { compose: async (args) => { called++; assert.deepEqual(args, { deployment: "/d", prepared: { resolution: { revision: "r" } }, soulDir: "/d/agents/dev/souls/x" }); return { composedInstructions: value }; } });
  assert.equal(good.composedInstructions, value);
  assert.equal(good.composedInstructionsProblem, undefined);

  const refused = await withComposedInstructions(soulTarget(), { compose: async () => { throw Object.assign(new Error("inject x is missing"), { code: "E_MATERIALIZE_RESOLUTION", details: { path: "x" } }); } });
  assert.equal(refused.composedInstructions, null);
  assert.deepEqual(refused.composedInstructionsProblem, { code: "E_MATERIALIZE_RESOLUTION", message: "composedInstructions: inject x is missing" });

  const copyError = { code: "E_SOUL_COPY_FAILED", message: "cannot copy" };
  const noCopy = await withComposedInstructions(soulTarget({ copyError, soulDir: null }), { compose: async () => { called++; throw new Error("never composed"); } });
  assert.equal(noCopy.composedInstructions, null);
  assert.equal(noCopy.composedInstructionsProblem, undefined);
  assert.equal(called, 1, "nothing is composed for a soul whose copy failed");

  await assert.rejects(withComposedInstructions(soulTarget(), { compose: async () => { throw new TypeError("a bug"); } }), TypeError);
  const home = { kind: "instance", soul: { name: "dev" } };
  assert.equal(await withComposedInstructions(home, { compose: async () => { throw new Error("never"); } }), home);

  // In the document: the key on the soul row and the problem after the soul's own (copyError first).
  const t = { ...soulTarget({ copyError }), composedInstructions: null, home: null, meta: null, modules: [], slots: {}, payloads: {}, turnedOff: [], workspace: null, subject: { kind: "soul", soul: "dev" } };
  const doc = inspectDocument({ ...t, composedInstructionsProblem: { code: "E_X", message: "composedInstructions: y" } }, { kernel: "0.0.0" });
  assert.equal(doc.souls[0].composedInstructions, null);
  assert.deepEqual(doc.problems, [copyError, { code: "E_X", message: "composedInstructions: y" }]);
  const without = inspectDocument({ ...t, composedInstructions: undefined, soul: { ...t.soul, copyError: undefined } }, { kernel: "0.0.0" });
  assert.equal(Object.hasOwn(without.souls[0], "composedInstructions"), false);
});

test("doctor --soul reports capability blocks home-relative (materialized) and kernel blocks absolute, from the same composition inspect reports", (t) => {
  const fx = v2Deployment({ souls: { dev: { soul: withOps(), agents: "# dev — ドクター\n" } }, capabilities: ops });
  t.after(fx.cleanup);
  const tmp = privateTmp(fx, "doctor");
  const r = fx.cli(["doctor", "--soul", "dev", "--json"], { env: { TMPDIR: tmp } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doctor = JSON.parse(r.stdout);
  assert.deepEqual(scratchHomes(tmp), []);
  assert.match(doctor.composedInstructions, /<!-- oats:capability:acme\.ops src=\.oats\/modules\/acme\.ops\/inject\.md -->/);
  for (const m of doctor.composedInstructions.matchAll(/<!-- oats:(\S+) src=(\S+) -->/g)) {
    if (m[1].startsWith("capability:")) assert.ok(m[2].startsWith(".oats/modules/"), `${m[1]}: ${m[2]}`);
    else assert.ok(isAbsolute(m[2]), `${m[1]} keeps its absolute path: ${m[2]}`);
  }
  const capBlocks = doctor.instructionBlocks.filter((b) => b.source.startsWith("capability:"));
  assert.deepEqual(capBlocks.map((b) => [b.source, b.file, b.materialized]), [["capability:acme.ops", ".oats/modules/acme.ops/inject.md", true]]);
  for (const b of doctor.instructionBlocks.filter((x) => !x.source.startsWith("capability:"))) {
    assert.ok(isAbsolute(b.file), `${b.source}: ${b.file}`);
    assert.notEqual(b.materialized, true);
  }
  const { ci } = inspectComposed(fx, "dev");
  assert.equal(doctor.composedInstructions, ci.text, "doctor and inspect answer one composition");
  assert.equal(doctor.composedInstructions, spawned(fx, "dev", "doc").text);
});
