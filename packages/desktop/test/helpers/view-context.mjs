// The shell bindings the workspace-views change (#482) added to the roster functions that the
// source-extraction tests run in a vm context: the shown view's deployments (none: a window looks
// as before views), the roster sections and headings, and the re-homing seam. A test about
// re-homing passes its own `rehomeWorkspaceState`. Spec D's needs-input gate, roll-up and sentence are
// pure and shared the same way.
import { rosterSections, deploymentHeading, notePanel, panelDeployments, rowStale, splitByDeployment } from "../../renderer/view-deployments.mjs";
import { createViewMembership, rehomeMap } from "../../renderer/workspace-rehome.mjs";
import { waitingClaim, waitingRollup, waitingSentence } from "../../renderer/waiting-on-you.mjs";

export const viewContext = () => ({
  contextDeployments: [], rosterSections, deploymentHeading, notePanel, panelDeployments, rowStale,
  rehomeMap, viewMembership: createViewMembership(), rehomeWorkspaceState() {},
  waitingClaim, waitingRollup, waitingSentence, splitByDeployment,
});
