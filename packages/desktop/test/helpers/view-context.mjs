// The shell bindings the workspace-views change (#482) added to the roster functions that the
// source-extraction tests run in a vm context: the shown view's deployments (none: a window looks
// as before views), the roster sections, the deployment list and the re-homing seam. A test about
// re-homing passes its own `rehomeWorkspaceState`.
import { rosterSections, deploymentHeading, notePanel, panelDeployments, renderDeploymentList } from "../../renderer/view-deployments.mjs";
import { createViewMembership, rehomeMap } from "../../renderer/workspace-rehome.mjs";

export const viewContext = () => ({
  contextDeployments: [], rosterSections, deploymentHeading, notePanel, panelDeployments, renderDeploymentList,
  rehomeMap, viewMembership: createViewMembership(), rehomeWorkspaceState() {},
});
