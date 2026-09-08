/** The CLI resolves launch definitions; the server admits workspace targets. */
import { dirname } from "node:path";
import { cliLaunchConfig } from "../cli-adapter.mjs";

const fail = (message, code = "E_BAD_ARGS") => { throw Object.assign(new Error(message), { code }); };

export async function launchConfigRequest(request, { workspace, cli, agents = [], instances = [], localCwd, invoke = cliLaunchConfig }) {
  if (!workspace) fail("Select a known workspace", "E_WORKSPACE_UNKNOWN");
  if (!cli?.ok || !cli.features?.includes("launch-config")) fail("Update OATS to use launch configurations", "cli-no-launch-config");
  const server = workspace.server || undefined;
  if (workspace.remote && (!server || !workspace.registrationPresent || !cli.remote?.includes("launch-config"))) {
    fail("This workspace needs a registered server with launch configuration support", "cli-no-launch-config");
  }
  const { action, selector = {} } = request;
  if (!["list", "set", "remove", "preview"].includes(action)) fail("Unknown launch configuration action");
  let context = workspace.scope, home, soul, agentsRoot;
  if (selector.home !== undefined) {
    if (selector.soul !== undefined || selector.agentsRoot !== undefined || selector.context !== undefined) fail("Select one home or soul");
    if (!["list", "preview"].includes(action)) fail("Edit launch configurations in their configuration scope");
    const matches = instances.filter(i => i.home === selector.home);
    if (matches.length !== 1) fail("Select one existing home in this workspace");
    if (server && !matches[0].savedRoute) fail("This instance has no saved server route", "E_SNAPSHOT_UNKNOWN");
    home = matches[0].home; context = undefined;
  } else if (selector.soul !== undefined) {
    if (selector.context !== undefined) fail("Select one home, soul or configuration scope");
    if (!["list", "preview"].includes(action)) fail("Edit launch configurations in their configuration scope");
    const matches = agents.filter(a => a.name === selector.soul && a.agentsRoot === selector.agentsRoot);
    if (matches.length !== 1) fail("Select one soul and agents root in this workspace");
    soul = matches[0].name; agentsRoot = matches[0].agentsRoot; context = dirname(agentsRoot);
  } else if (selector.context !== undefined) {
    if (![workspace.scope, ...agents.filter(a => a.agentsRoot).map(a => dirname(a.agentsRoot))].includes(selector.context)) fail("Select a configuration scope in this workspace");
    context = selector.context;
  }
  if (action === "preview" && !home && !soul) fail("Select a soul or existing home to preview");
  const envelope = await invoke(cli.bin, {
    action, name: request.name, definition: request.definition, keepEnv: request.keepEnv, choices: request.choices,
    context, server, home, soul, agentsRoot, localCwd: server ? localCwd : context || workspace.scope,
  });
  if (!envelope.ok) fail(envelope.error?.message || "Launch configuration operation failed", envelope.error?.code);
  return envelope.result;
}
