// The shell bindings the workspace-views change (#482) added to the roster functions that the
// source-extraction tests run in a vm context: the shown view's deployments (none: a window looks
// as before views), the roster sections and headings, and the re-homing seam. A test about
// re-homing passes its own `rehomeWorkspaceState`. Spec D's needs-input gate, roll-up and sentence are
// pure and shared the same way, with the tab sync's last-painted-roster state (#558).
import { rosterSections, rowStale, splitByDeployment } from "../../../client/roster-sections.mjs";
import { deploymentHeading, notePanel, panelDeployments } from "../../renderer/view-deployments.mjs";
import { createViewMembership, rehomeMap } from "../../renderer/workspace-rehome.mjs";
import { waitingClaim, waitingSentence, waitingLabel, waitingClock } from "../../../client/waiting-on-you.mjs";
import { waitingRollup } from "../../../client/instance-tree.mjs";

export const viewContext = () => ({
  contextDeployments: [], rosterSections, deploymentHeading, notePanel, panelDeployments, rowStale,
  rehomeMap, viewMembership: createViewMembership(), rehomeWorkspaceState() {},
  waitingClaim, waitingRollup, waitingSentence, waitingLabel, waitingClock, splitByDeployment,
  // syncTabNeedsInput's module state (#558): the last painted roster, read when a terminal tab opens.
  // Every roster paint calls syncTabNeedsInput; a suite about other behaviour gets this no-op, and a suite
  // that extracts the shipped function by name replaces it (tab-needs-input, roster-needs-input).
  tabNeedsInputRoster: { instances: [], workspace: null }, syncTabNeedsInput() {},
});
