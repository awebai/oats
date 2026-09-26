// `--flag=value` is `--flag value` (0.27.3): before it, every `--x=v` token was
// silently dropped (`--harness=claude` spawned the default harness). The kernel
// reads the inline form exactly as the spaced one, with the same validation; an
// empty `--flag=` and a switch given a value (`--yolo=false` must never mean
// yolo) are E_BAD_ARGS. A capability command's argv is the provider's to parse:
// it is forwarded as typed, and only the kernel's own dispatch flag is read inline.
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { v2Deployment } from "./helpers/v2-deployment.mjs";

const ok = (r) => { const j = r.json(); assert.equal(j.ok, true, r.stdout + r.stderr); return j.result; };
const fail = (r) => { const j = r.json(); assert.equal(j.ok, false, r.stdout); assert.notEqual(r.status, 0); return j.error; };

test("spawn reads --harness=, --runtime= (the alias), --name= and --purpose= as their spaced forms", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  assert.equal(ok(fx.cli(["spawn", "dev", "--preview", "--harness=codex", "--json"])).harness, "codex");
  const alias = fx.cli(["spawn", "dev", "--preview", "--runtime=claude", "--json"]);
  assert.equal(ok(alias).harness, "claude", "--runtime= is --harness=");
  assert.equal(alias.json().warnings?.[0]?.code, "deprecated-runtime-name");
  const named = ok(fx.cli(["spawn", "dev", "--preview", "--name=exact-one", "--json"]));
  assert.equal(named.instance, "exact-one"); assert.equal(named.decision.instance, "exact-one");
  assert.equal(ok(fx.cli(["spawn", "dev", "--preview", "--purpose=probe", "--json"])).instance, "dev-probe");
  // Same validation as the spaced form, on the inline value.
  for (const [inline, spaced] of [["--harness=gemini", ["--harness", "gemini"]], ["--name=Not_A_Slug", ["--name", "Not_A_Slug"]]]) {
    const a = fail(fx.cli(["spawn", "dev", "--preview", inline, "--json"])), b = fail(fx.cli(["spawn", "dev", "--preview", ...spaced, "--json"]));
    assert.deepEqual(a, b, inline);
  }
  assert.equal(fail(fx.cli(["spawn", "dev", "--preview", "--name=Not_A_Slug", "--json"])).code, "E_INSTANCE_NAME_INVALID");
  assert.equal(fail(fx.cli(["spawn", "dev", "--preview", "--name=a", "--purpose", "b", "--json"])).code, "E_BAD_ARGS", "--name= and --purpose stay exclusive");
  assert.equal(fail(fx.cli(["spawn", "dev", "--preview", "--harness=pi", "--runtime=claude", "--json"])).code, "E_BAD_ARGS", "disagreeing inline forms are refused too");
});

test("an empty --flag= and a switch given a value are E_BAD_ARGS, in JSON and text mode", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const empty = fail(fx.cli(["spawn", "dev", "--preview", "--name=", "--json"]));
  assert.equal(empty.code, "E_BAD_ARGS"); assert.equal(empty.message, "--name= needs a value");
  const sw = fail(fx.cli(["spawn", "dev", "--preview", "--yolo=false", "--json"]));
  assert.equal(sw.code, "E_BAD_ARGS"); assert.equal(sw.message, "--yolo takes no value (got --yolo=false)");
  assert.equal(fail(fx.cli(["status", "--dir=", "--json"])).message, "--dir= needs a value");
  // A nameless `--=x` is left whole: it never becomes a `--` that would hide the flags after it.
  assert.equal(fail(fx.cli(["status", "--=x", "--deployment", "d", "--json"])).code, "E_UNSUPPORTED_MODE");
  const text = fx.cli(["spawn", "dev", "--preview", "--harness="]);
  assert.notEqual(text.status, 0); assert.match(text.stderr, /^oats: --harness= needs a value$/m);
});

test("--server= routes like --server, and --dir= is --dir", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  // Unrouted, `status` answers locally; routed to an unregistered id it is refused before any ssh.
  assert.equal(fail(fx.cli(["status", "--server=nope", "--json"])).code, "E_SERVER_UNKNOWN");
  // A routed capability command is the kernel's to parse: its inline values are checked before routing.
  assert.equal(fail(fx.cli(["okf", "harvest", "--server=nope", "--instance=", "--json"])).message, "--instance= needs a value");
  assert.equal(fail(fx.cli(["spawn", "dev", "--server=nope", "--dir", fx.dep, "--json"])).message, "--dir cannot be combined with --server: the remote workspace comes from the server registration");
  // --dir= names the deployment from anywhere.
  const r = fx.cli(["spawn", "dev", "--preview", `--dir=${fx.dep}`, "--json"], { cwd: "/" });
  assert.equal(ok(r).instance, "dev-1");
});

test("a capability command reads --soul= for dispatch and forwards its argv to the provider as typed", (t) => {
  const echo = "console.log(JSON.stringify({schemaVersion:1,ok:true,result:process.argv.slice(2)}))\n";
  const fx = v2Deployment({
    souls: { dev: { soul: { capabilities: { "acme.echo": { from: "here" } } } } },
    capabilities: { "acme.echo": { manifest: { command: "echoprobe", commands: { show: "show.mjs" } }, files: { "show.mjs": echo } } },
  });
  t.after(fx.cleanup);
  const r = fx.cli(["echoprobe", "show", "--soul=dev", "--mode=x", "--empty=", "--json"], { env: { OATS_INSTANCE_HOME: "", PI_AGENT_HOME: "", OATS_HOME: "" } });
  assert.deepEqual(ok(r), ["--soul=dev", "--mode=x", "--empty=", "--json"], "the provider's flags are its own: nothing split, nothing refused");
});

test("the record's commands parse their own argv: the kernel refuses nothing there", (t) => {
  const fx = v2Deployment(); t.after(fx.cleanup);
  const r = fx.cli(["recall", "--kind=", "anything"], { env: { TURN_RECORD_ROOT: join(fx.base, "turn-record") } });
  assert.match(r.stderr, /^no matches$/m, "recall ran and answered");
  assert.doesNotMatch(r.stdout + r.stderr, /needs a value/);
});
