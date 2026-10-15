// The ONE module of packages/tui/ that imports the shared client home (packages/client/): the rest
// of the TUI names no reader path, so what the TUI takes from the shared readers is this list
// (test/tui-boundary.test.mjs pins it). Every function here is the Desktop's own, never a copy:
// the roster, its order, its words and what a failed read becomes are decided there, once, for
// both clients. test/client-boundary.test.mjs holds each name to the home's stable surface.
import { fileURLToPath } from "node:url";
import { clientTerms } from "../../client/client-terms.mjs";

export { displayLine, DETAIL_WITHHELD } from "../../client/display-text.mjs";
export { parseProbeStdout, acceptProbe, cliRecord } from "../../client/cli-locator.mjs";
export { cliDeploymentRead } from "../../client/deployment-read-cli.mjs";
export { cliRemoteRoster } from "../../client/cli-adapter.mjs";
export { createDeploymentObserver, mapBounded, MAX_DEPLOYMENT_OBSERVATIONS } from "../../client/deployment-observer.mjs";
export { createRefreshLoop } from "../../client/refresh-loop.mjs";
export { rosterRows, livenessInput, livenessAnswers, panelInstances, pendingEntry, failedEntry, observedEntry } from "../../client/deployment-panel.mjs";
export { panelData, cliReadsRemotes, workspaceChoices, viewModel, deployments } from "../../client/panel-views.mjs";
export { remoteRosterState } from "../../client/remote-roster.mjs";
export { observeIdentities, identityMemory } from "../../client/remote-identity-memory.mjs";
export { workspaceChoiceRows, choiceMatches, UNMATCHED_SECTION } from "../../client/workspace-choices.mjs";
export { shortPath } from "../../client/deployment-label.mjs";
export { instanceId, instanceVisibleInTree, waitingRollup, collapseKey, filterInstanceTree, hasInstanceChildren, heldHome } from "../../client/instance-tree.mjs";
export { rosterSections, deploymentState, rowStale, primaryDeployment, isMultiDeployment } from "../../client/roster-sections.mjs";
export { runtimeState, runtimeCounts, originLead } from "../../client/instance-presentation.mjs";
export { waitingClaim, waitingLabel, waitedText, waitingClock, waitingBelowText } from "../../client/waiting-on-you.mjs";
export { instanceActs, openAct } from "../../client/instance-acts.mjs";
export { sessionAttachArgv, prepareRemoteTerm, detachKeySupported, hostDetachKeySupported, preflightFailure, DETACH_KEY_FEATURE } from "../../client/session-attach.mjs";
export { attachExit } from "../../client/attach-exit.mjs";
export { kernelLines } from "../../client/kernel-lines.mjs";
export { createLifecycleBoundary } from "../../client/instance-lifecycle.mjs";
export { createLifecycleConfirmation } from "../../client/lifecycle-confirmation.mjs";
export { startGate, startInstance } from "../../client/session-start.mjs";
export { retainedStartMessage, launchFlagIgnored, flagIgnoredNotice } from "../../client/launch-prompt-outcome.mjs";
export { INSTANCE_VARIABLES } from "../../client/kernel-environment.mjs";
export { validateWorkspace, deploymentsInside } from "../../client/workspace-admission.mjs";

/** The words a shared sentence uses where it names the client that shows it (client-terms.mjs).
 *  Made once, here: every shared function that takes `terms` is passed this constant, and refuses
 *  anything else. */
export const TERMS = clientTerms({ name: "oats tui", self: "oats tui", selfInitial: "oats tui", update: "OATS", thisMachine: "This machine" });

/** The liveness collector, a program of the shared home: started as a child, never imported. */
export const COLLECTOR = fileURLToPath(new URL("../../client/liveness-main.mjs", import.meta.url));
