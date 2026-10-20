#!/usr/bin/env node
// The naming call's isolation proof (feature spawn-suggest-name, awebai/oats#1421 §3). The maintainer's
// condition: the call starts nothing that runs code, so no MCP server, hook, plugin, extension or project
// setting. A flag that only looks right in --help doesn't count, so this script runs each harness.
//
//   node scripts/naming-isolation-proof.mjs [claude] [pi] [codex] [--real]
//
// Per harness, a fixture configuration directory holds the following, each touching a marker file when it
// runs: user hooks, a user MCP server, an installed plugin or extension with its own hook and MCP
// server, and for pi a package. The model is a local stub API with a dummy key, so nothing leaves the
// machine. A positive control (no isolation flags) must touch every marker, or the fixture proves
// nothing. The naming call (the kernel's own argv, lib/instance-naming.mjs NAMING_CALLS) must touch
// none and send no tool. `--real` adds one naming call with this user's real configuration and native
// login (claude and pi), to show that authentication survives the flags.
//
// An operator reruns it on a host after a harness upgrade. CI does not run it: it has no real harness.
// Exit status: 0 when every harness asked is proven, 1 when one is not, 2 when a fixture did not load.
// codex has no naming call in the kernel; its candidate argv is proven here on an API key only. What
// it still needs: a logged-in run (ChatGPT login) with `apps` and plugins off, and a decision on what
// `--ignore-user-config` costs (it drops the user's provider settings). Until then it answers
// `unsupported-harness`.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NAMING_CALLS, namingEnvironment, namingPrompt } from "../lib/instance-naming.mjs";

/** The codex candidate: with `--ignore-user-config` (an empty `-c mcp_servers={}` override merges into the
 *  user's table and removes no server) and every feature that loads code or connectors off. */
export const CODEX_CANDIDATE = (model, out) => ["exec", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--sandbox", "read-only",
  "--disable", "hooks", "--disable", "plugins", "--disable", "apps", "--disable", "shell_tool", "--disable", "multi_agent", "--disable", "goals",
  "-c", 'web_search="disabled"', "-o", out, "-m", model, "-"];
const TASK = "Fix the flaky login test in the auth service and add a regression test.";
const REPLY = "stub-reply-name";

/** A stub API on 127.0.0.1: Anthropic Messages (`anthropic`) or OpenAI Responses (`responses`), one text
 *  reply to every model request, streamed when asked. Each request's tool names are kept. */
function stubApi(kind) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let j = {};
      try { j = JSON.parse(body || "{}"); } catch { /* not JSON */ }
      const isModel = req.method === "POST" && (kind === "anthropic" ? /^\/v1\/messages(\?|$)/.test(req.url) : req.url.endsWith("/responses"));
      if (!isModel) { res.writeHead(200, { "content-type": "application/json" }); return res.end(req.url.includes("count_tokens") ? '{"input_tokens":10}' : "{}"); }
      requests.push({ model: j.model, tools: (j.tools ?? []).map((t) => t.name ?? t.type) });
      if (kind === "anthropic" && !j.stream) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: j.model, content: [{ type: "text", text: REPLY }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 3 } }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
      if (kind === "anthropic") {
        ev({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 1 } } });
        ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
        ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: REPLY } });
        ev({ type: "content_block_stop", index: 0 });
        ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } });
        ev({ type: "message_stop" });
      } else {
        const item = { type: "message", id: "m1", role: "assistant", status: "completed", content: [{ type: "output_text", text: REPLY, annotations: [] }] };
        ev({ type: "response.created", response: { id: "r1", status: "in_progress" } });
        ev({ type: "response.output_item.done", output_index: 0, item });
        ev({ type: "response.completed", response: { id: "r1", status: "completed", output: [item], usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 3, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 13 } } });
      }
      res.end();
    });
  });
  return new Promise((ready) => server.listen(0, "127.0.0.1", () => ready({ port: server.address().port, requests, close: () => server.close() })));
}

/** Run `bin argv` from a fresh empty directory with `env`, the prompt on stdin → { code, stdout, ms }. */
function run(bin, argv, env, prompt, timeoutMs = 90_000) {
  const cwd = mkdtempSync(join(tmpdir(), "oats-naming-proof-cwd-"));
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn(bin, argv, { cwd, env: namingEnvironment(env), detached: true, stdio: ["pipe", "pipe", "ignore"] });
    let stdout = "";
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ } }, timeoutMs);
    child.stdout.on("data", (d) => { stdout += d; });
    child.on("error", (e) => { clearTimeout(timer); done({ code: e.code, stdout, ms: Date.now() - started }); });
    child.on("close", (code, signal) => { clearTimeout(timer); try { process.kill(-child.pid, "SIGKILL"); } catch { /* the group is gone */ } rmSync(cwd, { recursive: true, force: true }); done({ code: signal ?? code, stdout, ms: Date.now() - started }); });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}
const write = (path, text) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, text); };
const json = (v) => JSON.stringify(v, null, 2);
const touch = (m, name) => `touch ${m}/${name}`;
const mcpServer = (m, name) => ({ command: "sh", args: ["-c", `${touch(m, name)}; sleep 20`] });

/** Each harness's fixture: what it writes, the markers a control must touch, the env, and the two argvs. */
const HARNESSES = {
  async claude(p, m, api) {
    const cfg = join(p, "cfg"), mk = join(p, "mk");
    write(join(mk, ".claude-plugin", "marketplace.json"), json({ name: "fx", owner: { name: "proof" }, plugins: [{ name: "marker", source: "./marker", description: "proof" }] }));
    write(join(mk, "marker", ".claude-plugin", "plugin.json"), json({ name: "marker", version: "1.0.0", description: "proof" }));
    write(join(mk, "marker", "hooks", "hooks.json"), json({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: touch(m, "plugin-hook") }] }] } }));
    write(join(mk, "marker", ".mcp.json"), json({ mcpServers: { pmarker: mcpServer(m, "plugin-mcp") } }));
    const hook = (e) => [{ hooks: [{ type: "command", command: touch(m, `hook-${e}`) }] }];
    write(join(cfg, "settings.json"), json({ extraKnownMarketplaces: { fx: { source: { source: "directory", path: mk } } }, enabledPlugins: { "marker@fx": true }, hooks: { SessionStart: hook("SessionStart"), UserPromptSubmit: hook("UserPromptSubmit"), Stop: hook("Stop") } }));
    write(join(cfg, ".claude.json"), json({ hasCompletedOnboarding: true, mcpServers: { marker: { type: "stdio", ...mcpServer(m, "mcp-user") } } }));
    const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, ANTHROPIC_API_KEY: "sk-ant-dummy-proof", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}` };
    for (const a of [["plugin", "marketplace", "add", mk], ["plugin", "install", "marker@fx"]]) await run("claude", a, env, "");
    return { env, markers: ["hook-SessionStart", "hook-UserPromptSubmit", "hook-Stop", "mcp-user", "plugin-hook", "plugin-mcp"],
      control: ["-p", "--output-format", "text", "--model", "haiku"], naming: NAMING_CALLS.claude.argv(NAMING_CALLS.claude.model(null)) };
  },
  async pi(p, m, api) {
    const agent = join(p, "agent"), pkg = join(p, "pkg");
    write(join(agent, "models.json"), json({ providers: { stub: { baseUrl: `http://127.0.0.1:${api.port}`, api: "anthropic-messages", apiKey: "sk-dummy-proof", models: [{ id: "stub-model" }] } } }));
    write(join(agent, "extensions", "marker.ts"), `import { writeFileSync } from "node:fs";\nexport default function () { writeFileSync(${JSON.stringify(join(m, "extension-user"))}, ""); }\n`);
    write(join(pkg, "package.json"), json({ name: "marker-pkg", version: "1.0.0", pi: { extensions: ["./ext.ts"] } }));
    write(join(pkg, "ext.ts"), `import { writeFileSync } from "node:fs";\nexport default function () { writeFileSync(${JSON.stringify(join(m, "extension-package"))}, ""); }\n`);
    write(join(agent, "settings.json"), json({ packages: [pkg], quietStartup: true }));
    write(join(agent, "mcp.json"), json({ mcpServers: { marker: mcpServer(m, "mcp-user") } }));
    return { env: { ...process.env, PI_CODING_AGENT_DIR: agent }, markers: ["extension-user", "extension-package", "mcp-user"],
      control: ["-p", "--model", "stub/stub-model"], naming: NAMING_CALLS.pi.argv("stub/stub-model") };
  },
  async codex(p, m, api) {
    const home = join(p, "codex"), mk = join(p, "mk");
    const hookToml = (e) => `[[hooks.${e}]]\n[[hooks.${e}.hooks]]\ntype = "command"\ncommand = "${touch(m, `hook-${e}`)}"\n`;
    write(join(home, "config.toml"), `[mcp_servers.marker]\ncommand = "sh"\nargs = ["-c", "${touch(m, "mcp-user")}; sleep 20"]\n\n${["SessionStart", "UserPromptSubmit", "Stop"].map(hookToml).join("\n")}`);
    write(join(home, "hooks.json"), json({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: touch(m, "hooksjson-SessionStart") }] }] } }));
    const market = json({ name: "fx", owner: { name: "proof" }, plugins: [{ name: "marker", source: { source: "local", path: "./marker" }, description: "proof" }] });
    write(join(mk, ".agents", "plugins", "marketplace.json"), market);
    write(join(mk, "marker", ".codex-plugin", "plugin.json"), json({ name: "marker", version: "1.0.0", description: "proof", mcpServers: "./.mcp.json", hooks: "./hooks/hooks.json" }));
    write(join(mk, "marker", "hooks", "hooks.json"), json({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: touch(m, "plugin-hook") }] }] } }));
    write(join(mk, "marker", ".mcp.json"), json({ mcpServers: { pmarker: mcpServer(m, "plugin-mcp") } }));
    const env = { ...process.env, CODEX_HOME: home, OPENAI_API_KEY: "sk-dummy-proof" };
    for (const a of [["plugin", "marketplace", "add", mk], ["plugin", "add", "marker@fx"]]) await run("codex", a, env, "");
    // The provider is routed to the stub (routing only, in both runs); hook trust is bypassed in both, as
    // if the user had trusted those hooks.
    const route = ["-c", 'model_provider="stub"', "-c", `model_providers.stub={name="stub",base_url="http://127.0.0.1:${api.port}/v1",env_key="OPENAI_API_KEY",wire_api="responses"}`, "--dangerously-bypass-hook-trust"];
    const out = join(p, "last-message");
    const candidate = CODEX_CANDIDATE("gpt-5-mini", out);
    return { env, markers: ["hook-SessionStart", "hook-UserPromptSubmit", "hook-Stop", "hooksjson-SessionStart", "mcp-user", "plugin-hook", "plugin-mcp"],
      control: ["exec", "--skip-git-repo-check", ...route, "-o", out, "-m", "gpt-5-mini", "-"], naming: [...candidate.slice(0, -1), ...route, "-"] };
  },
};

async function prove(harness) {
  const p = mkdtempSync(join(tmpdir(), `oats-naming-proof-${harness}-`)), m = join(p, "markers");
  mkdirSync(m);
  const api = await stubApi(harness === "codex" ? "responses" : "anthropic");
  try {
    const f = await HARNESSES[harness](p, m, api);
    const observe = async (label, argv) => {
      for (const name of readdirSync(m)) rmSync(join(m, name));
      api.requests.length = 0;
      const r = await run(harness, argv, f.env, namingPrompt(TASK));
      await new Promise((settle) => setTimeout(settle, 1000));
      const touched = readdirSync(m).sort(), tools = [...new Set(api.requests.flatMap((q) => q.tools))];
      console.log(`  ${label}: exit ${r.code}, markers [${touched.join(" ")}], tools sent [${tools.join(" ")}]\n    argv: ${harness} ${argv.map((a) => (a === "" ? '""' : a)).join(" ")}`);
      return { touched, tools, requests: api.requests.length };
    };
    console.log(`${harness}:`);
    const control = await observe("control", f.control);
    const missing = f.markers.filter((x) => !control.touched.includes(x));
    if (missing.length || !control.requests) { console.log(`  FIXTURE DID NOT LOAD (missing ${missing.join(", ") || "the model request"}): the proof is void`); return 2; }
    const naming = await observe("naming", f.naming);
    const proven = naming.touched.length === 0 && naming.requests > 0 && (harness === "codex" ? !naming.tools.some((t) => t.includes("mcp")) : naming.tools.length === 0);
    console.log(`  ${proven ? "PROVEN" : "NOT PROVEN"}${harness === "codex" ? " (the candidate, on an API key; codex stays unsupported-harness)" : ""}`);
    return proven ? 0 : 1;
  } finally { api.close(); rmSync(p, { recursive: true, force: true }); }
}

async function realCall(harness) {
  if (!Object.hasOwn(NAMING_CALLS, harness)) return;
  const model = harness === "claude" ? NAMING_CALLS.claude.model(null) : process.env.OATS_PROOF_PI_MODEL || null;
  const r = await run(harness, NAMING_CALLS[harness].argv(model), process.env, namingPrompt(TASK), 30_000);
  console.log(`  real ${harness} (this user's configuration and login${model ? `, model ${model}` : ""}): exit ${r.code} in ${r.ms} ms, reply ${JSON.stringify(r.stdout.trim().split("\n")[0] ?? "")}`);
}

const asked = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const harnesses = asked.length ? asked : ["claude", "pi", "codex"];
for (const h of harnesses) if (!Object.hasOwn(HARNESSES, h)) { console.error(`unknown harness ${h} (claude, pi, codex)`); process.exit(2); }
let status = 0;
for (const h of harnesses) {
  status = Math.max(status, await prove(h));
  if (process.argv.includes("--real")) await realCall(h);
}
process.exit(status);
