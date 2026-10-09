/** Triggers and schedules (feature `automations`, automationsApi 1; kernel 2b): the
 * kernel's `oats trigger|schedule list --json` and its verbs, for one LOCAL workspace;
 * `describe` (feature `automation-descriptions`, kernel 0.43) sets or clears a local
 * item's one-line summary via `<kind> update <key> --description=<text>`. The rows are the kernel's (origin, owner, runsOn, runsHere + reason, enabledHere, soul,
 * task verbatim, …); the renderer's automation-rows adapter reads them and never
 * re-derives placement. Domain results resolve (never reject) with stable codes; a
 * kernel refusal (E_AUTOMATION_WORKSPACE, E_AUTOMATION_NOT_HERE, …) keeps its own code
 * and a bounded message. */
import { cliAutomation, AUTOMATION_VERBS, automationIdValid, automationKeyLocal, automationDescriptionValid, automationRunSourceValid, TRIGGER_SOURCES_FEATURE } from "../cli-adapter.mjs";

export const AUTOMATIONS_VIEW_API = 1;
const KERNEL_CODE = /^E_[A-Z0-9_]{1,63}$/;
const MESSAGES = {
  E_AUTOMATIONS_UNAVAILABLE: "The installed OATS CLI does not report workspace triggers and schedules. Update OATS to 0.29 or later.",
  E_DESCRIPTIONS_UNAVAILABLE: "The installed OATS CLI cannot set automation summaries. Update OATS to 0.43 or later.",
  E_WORKSPACE_UNKNOWN: "Select a known workspace.",
  E_UNSUPPORTED_REMOTE: "Triggers and schedules of a remote workspace are read on that machine.",
  E_BAD_ARGS: "Invalid automation request.",
  E_CLI_FAILED: "The OATS CLI could not answer.",
  E_CLI_PROTOCOL: "The OATS CLI answered in an unexpected shape.",
};
const printable = v => typeof v === "string" && v.length > 0 && v.length <= 2048 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(v);
export const automationsSupported = cli => !!cli?.ok && Array.isArray(cli.features) && cli.features.includes("automations") && cli.automationsApi === 1;
export const automationDescriptionsSupported = cli => automationsSupported(cli) && cli.features.includes("automation-descriptions");
export const triggerSourcesSupported = cli => automationsSupported(cli) && cli.features.includes(TRIGGER_SOURCES_FEATURE);
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
  if (action === "status") return Array.isArray(v.triggers);
  if (action === "describe") return record(v[kind]); // { schedule: <row> } | { trigger: <row> }
  return true;
}
export async function automationsRequest(request, { workspace, cli, invoke = cliAutomation }) {
  const kind = request?.kind, action = request?.action;
  // `key` is the row's qualified id (local/<id>, <member>/<id>) or a bare local id; `description` is describe's alone.
  const keyed = Object.hasOwn(request ?? {}, "key"), describe = action === "describe";
  // `runSource` (feature trigger-sources) is a trigger test's alone: the operator's confirmed press that lets the
  // kernel run a capability source's command. Only the strict boolean `true`, only for a CLI that declares the
  // feature; anything else is refused here, before any CLI runs. The flag itself is composed in cliAutomation,
  // which is told the probe's features and refuses the key again without the feature.
  const runs = Object.hasOwn(request ?? {}, "runSource");
  const keys = describe ? ["kind", "action", "key", "description"] : kind === "trigger" && action === "test" ? ["kind", "action", "key", "runSource"] : ["kind", "action", "key"];
  if (!record(request) || Object.keys(request).some(k => !keys.includes(k))
    || !Object.hasOwn(AUTOMATION_VERBS, kind) || !AUTOMATION_VERBS[kind].includes(action)
    || (action === "list" ? keyed : !keyed ? action !== "status" : !automationIdValid(kind, request.key))
    || (describe && (!automationKeyLocal(request.key) || !automationDescriptionValid(request.description)))
    || (runs && (request.runSource !== true || !triggerSourcesSupported(cli) || !automationRunSourceValid(kind, action, request.runSource, cli.features)))) return automationsFailure("E_BAD_ARGS");
  if (!automationsSupported(cli)) return automationsFailure("E_AUTOMATIONS_UNAVAILABLE", kind, action);
  if (describe && !automationDescriptionsSupported(cli)) return automationsFailure("E_DESCRIPTIONS_UNAVAILABLE", kind, action);
  if (!workspace) return automationsFailure("E_WORKSPACE_UNKNOWN", kind, action);
  if (workspace.remote || workspace.server) return automationsFailure("E_UNSUPPORTED_REMOTE", kind, action);
  const envelope = await invoke(cli.bin, { kind, action, ...(keyed ? { id: request.key } : {}), ...(describe ? { description: request.description } : {}), ...(runs ? { runSource: true, features: cli.features } : {}), workspaceDir: workspace.scope });
  if (envelope?.ok === false) return automationsFailure(envelope.error?.code, kind, action, envelope.error?.message);
  if (envelope?.ok !== true || !kernelResult(kind, action, envelope.result)) return automationsFailure("E_CLI_PROTOCOL", kind, action);
  return { automationsViewApi: AUTOMATIONS_VIEW_API, status: "ok", kind, action, result: envelope.result, reason: null };
}
