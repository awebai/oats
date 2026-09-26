/** Triggers and schedules (feature `automations`, automationsApi 1; kernel 2b): the
 * kernel's `oats trigger|schedule list --json` and its verbs, for one LOCAL workspace.
 * The rows are the kernel's (origin, owner, runsOn, runsHere + reason, enabledHere, soul,
 * task verbatim, …); the renderer's automation-rows adapter reads them and never
 * re-derives placement. Domain results resolve (never reject) with stable codes; a
 * kernel refusal (E_AUTOMATION_WORKSPACE, E_AUTOMATION_NOT_HERE, …) keeps its own code
 * and a bounded message. */
import { cliAutomation, AUTOMATION_VERBS, AUTOMATION_ID } from "../cli-adapter.mjs";

export const AUTOMATIONS_VIEW_API = 1;
const KERNEL_CODE = /^E_[A-Z0-9_]{1,63}$/;
const MESSAGES = {
  E_AUTOMATIONS_UNAVAILABLE: "The installed OATS CLI does not report workspace triggers and schedules. Update OATS to 0.29 or later.",
  E_WORKSPACE_UNKNOWN: "Select a known workspace.",
  E_UNSUPPORTED_REMOTE: "Triggers and schedules of a remote workspace are read on that machine.",
  E_BAD_ARGS: "Invalid automation request.",
  E_CLI_FAILED: "The OATS CLI could not answer.",
  E_CLI_PROTOCOL: "The OATS CLI answered in an unexpected shape.",
};
const printable = v => typeof v === "string" && v.length > 0 && v.length <= 2048 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(v);
export const automationsSupported = cli => !!cli?.ok && Array.isArray(cli.features) && cli.features.includes("automations") && cli.automationsApi === 1;
export function automationsFailure(code, kind = null, action = null, kernelMessage) {
  const kernel = KERNEL_CODE.test(code ?? "") && printable(kernelMessage);
  if (!kernel && !Object.hasOwn(MESSAGES, code)) code = "E_CLI_FAILED";
  return { automationsViewApi: AUTOMATIONS_VIEW_API, status: "unavailable", kind, action, result: null,
    reason: { code, message: kernel ? kernelMessage.replace(/\n/g, " ") : MESSAGES[code] } };
}
const record = v => !!v && typeof v === "object" && !Array.isArray(v);
/** The kernel's own document for this verb, checked only for its shape (the renderer projects the rows). */
function kernelResult(kind, action, v) {
  if (!record(v)) return false;
  if (action === "list") return kind === "trigger" ? Array.isArray(v.triggers) : v.scheduleApi === 2 && Array.isArray(v.schedules);
  return true;
}
export async function automationsRequest(request, { workspace, cli, invoke = cliAutomation }) {
  const kind = request?.kind, action = request?.action;
  if (!record(request) || Object.keys(request).some(k => !["kind", "action", "id"].includes(k))
    || !Object.hasOwn(AUTOMATION_VERBS, kind) || !AUTOMATION_VERBS[kind].includes(action)
    || (action === "list" ? Object.hasOwn(request, "id") : typeof request.id !== "string" || !AUTOMATION_ID.test(request.id))) return automationsFailure("E_BAD_ARGS");
  if (!automationsSupported(cli)) return automationsFailure("E_AUTOMATIONS_UNAVAILABLE", kind, action);
  if (!workspace) return automationsFailure("E_WORKSPACE_UNKNOWN", kind, action);
  if (workspace.remote || workspace.server) return automationsFailure("E_UNSUPPORTED_REMOTE", kind, action);
  const envelope = await invoke(cli.bin, { kind, action, ...(action === "list" ? {} : { id: request.id }), workspaceDir: workspace.scope });
  if (envelope?.ok === false) return automationsFailure(envelope.error?.code, kind, action, envelope.error?.message);
  if (envelope?.ok !== true || !kernelResult(kind, action, envelope.result)) return automationsFailure("E_CLI_PROTOCOL", kind, action);
  return { automationsViewApi: AUTOMATIONS_VIEW_API, status: "ok", kind, action, result: envelope.result, reason: null };
}
