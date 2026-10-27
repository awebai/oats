// The shell bindings the workspace-views change (#482) added to the roster functions that the
// source-extraction tests run in a vm context: the shown view's deployments (none: a window looks
// as before views), the roster sections and headings, and the re-homing seam. A test about
// re-homing passes its own `rehomeWorkspaceState`. Spec D's needs-input gate, roll-up and sentence are
// pure and shared the same way, with the tab sync's last-painted-roster state (#558).
// #982's lines that say who made a row's text or a kept failure's message (renderer/speaker-line.mjs), and the
// shared home's rule for a kept failure (deployment-facts.mjs keptFailure), are pure and shared the same way.
// #1247: the window's retires in flight. A suite about other behaviour holds none: rows are drawn as the roster
// says (`shownRows` the identity) and a read lets nothing go; a suite about them passes the shipped ones.
import { deploymentState, rosterSections, rowStale, splitByDeployment } from "../../../client/roster-sections.mjs";
import { DESKTOP_TERMS } from "../../renderer/desktop-terms.mjs";
import { deploymentHeading, notePanel, panelDeployments } from "../../renderer/view-deployments.mjs";
import { createViewMembership, rehomeMap } from "../../renderer/workspace-rehome.mjs";
import { waitingClaim, waitingSentence, waitingDetail, waitingClock } from "../../../client/waiting-on-you.mjs";
import { waitingRollup } from "../../../client/instance-tree.mjs";
import { rowReasonLine, runtimeErrorLine, unsupportedLine, speakerLine, keptFailureLine, heldLine } from "../../renderer/speaker-line.mjs";
import { keptFailure } from "../../../client/deployment-facts.mjs";
import { retiredTabs, tabShowsRow, otherIncarnation, terminalOrigin } from "../../renderer/retired-tabs.mjs";
import { dotColor, paintDotColor } from "../../renderer/instance-dot.mjs";
import { syncWaitingRow } from "../../renderer/waiting-row.mjs";

export const viewContext = () => ({
  contextDeployments: [], rosterSections, DESKTOP_TERMS, deploymentHeading, notePanel, panelDeployments, rowStale, deploymentState,
  rehomeMap, viewMembership: createViewMembership(), rehomeWorkspaceState() {},
  waitingClaim, waitingRollup, waitingSentence, waitingDetail, waitingClock, splitByDeployment,
  rowReasonLine, runtimeErrorLine, unsupportedLine, speakerLine, keptFailureLine, keptFailure, heldLine,
  // #1421 §2: an instance's colour on its dots (instance-dot.mjs), pure, read by the roster paint, the tab sync and a tab's open.
  dotColor, paintDotColor,
  shownRows: rows => rows, retires: { landed() {}, ids: () => new Set() },
  // syncTabNeedsInput's module state (#558): the last painted roster, read when a terminal tab opens.
  // Every roster paint calls syncTabNeedsInput; a suite about other behaviour gets this no-op, and a suite
  // that extracts the shipped function by name replaces it (tab-needs-input, roster-needs-input).
  tabNeedsInputRoster: { instances: [], workspace: null }, syncTabNeedsInput() {},
  // #1502: the waiting row over a terminal pane (waiting-row.mjs), pure DOM: the tab sync draws it and closeTab ends it.
  syncWaitingRow,
  // #1237: a terminal tab's incarnation (retired-tabs.mjs) and the retired-tab rule's module state. A roster read
  // runs the rule; a suite about other behaviour gets this no-op, and retired-tabs-shell extracts the shipped one.
  retiredTabs, tabShowsRow, otherIncarnation, terminalOrigin, panelReads: 0, judgedAnswer: null, closeRetiredTabs() {},
});
