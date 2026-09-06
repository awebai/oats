/** Workspace-scoped scheduling through the installed CLI. */
import { cliSchedule } from "../cli-adapter.mjs";

const fail = (message, code = "E_BAD_ARGS") => { throw Object.assign(new Error(message), { code }); };

export async function scheduleRequest(request, { workspace, cli, agents = [], instances = [], localCwd, invoke = cliSchedule }) {
  if (!workspace) fail("Select a known workspace", "E_WORKSPACE_UNKNOWN");
  if (!cli?.ok || cli.scheduleApi !== 1 || !cli.features?.includes("schedule")) fail("Update the installed oats CLI to use schedules", "cli-no-schedule");
  const server = workspace.server || undefined;
  if (server && (!workspace.registrationPresent || !cli.remote?.includes("schedule"))) {
    fail("This workspace needs a registered server and a CLI with remote scheduling support", "cli-no-schedule");
  }
  const { operation, id } = request;
  let spec;
  if (operation === "add" || operation === "update") {
    const value = request.spec;
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("A schedule definition is required");
    const { cron, tz, enabled } = value;
    if (typeof cron !== "string" || typeof tz !== "string" || typeof enabled !== "boolean") fail("Specify cron, time zone, and enabled state");
    spec = { cron, tz, enabled };
    if (value.kind === "spawn") {
      const matches = agents.filter(a => a.name === value.agent && a.agentsRoot === value.agentsRoot && (!value.repo || a.repo === value.repo));
      if (matches.length !== 1 || matches[0].work === "attached") fail("Select one standalone soul in this workspace");
      if (typeof value.task !== "string" || !value.task.trim()) fail("A scheduled agent needs a task");
      spec = { ...spec, kind: "spawn", agent: matches[0].name, agentsRoot: matches[0].agentsRoot, task: value.task };
      if (matches[0].repo) spec.repo = matches[0].repo;
      for (const key of ["runtime", "model", "backend"]) {
        if (value[key] !== undefined && value[key] !== "") {
          if (typeof value[key] !== "string") fail(`Invalid ${key}`);
          spec[key] = value[key];
        }
      }
      if (value.yolo !== undefined) {
        if (typeof value.yolo !== "boolean") fail("Invalid permission setting");
        spec.yolo = value.yolo;
      }
    } else if (value.kind === "wake") {
      const source = instances.find(i => i.home === value.home);
      if (!source) fail("Select an existing agent home in this workspace");
      if (typeof value.message !== "string" || !value.message.trim()) fail("Specify the message to send when waking the agent");
      spec = { ...spec, kind: "wake", home: source.home, message: value.message };
    } else if (value.kind === "harvest") {
      const source = instances.find(i => i.home === value.home);
      if (!source) fail("Select an existing agent home in this workspace");
      spec = { ...spec, kind: "command", cwd: source.home, argv: ["oats", "okf", "harvest", "--json"] };
    } else fail("Choose a new agent, an existing agent to wake, or knowledge harvest");
  }
  const envelope = await invoke(cli.bin, {
    operation, id, spec, server,
    workspaceDir: server ? localCwd : workspace.scope,
  });
  if (!envelope.ok) fail(envelope.error?.message || "Schedule operation failed", envelope.error?.code || "E_SCHEDULE_FAILED");
  return envelope.result;
}
