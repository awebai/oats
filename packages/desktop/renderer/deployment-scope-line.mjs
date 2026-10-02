/** "On This Mac · ~/Agents/oats" (#482, expert decision Q1): a deployment-level surface (the
 * Workspace view, Automations, Schedules, the soul inspector, Brain, a capability page, the Sync
 * sheet) reads and acts on its view's PRIMARY deployment. In a view of two or more deployments it
 * says which, in one short line under its heading. A one-deployment view shows nothing (the line
 * stays hidden and takes no space): the surface looks exactly as before views.
 *
 * Surfaces do not read the panel themselves: the line follows the view store that every panel the
 * shell reads feeds (view-deployments.mjs `notePanel`). */
import { deploymentLabel } from './deployment-label.mjs';
import { isMultiDeployment, primaryDeployment, panelDeployments, viewDeployments, onViewDeployments } from './view-deployments.mjs';
import { currentWorkspace, onWorkspaceChange } from './views/common.mjs';

/** The line's label for a panel (or a deployments list): the primary deployment's label when the
 * view has two or more deployments, else null. */
export function deploymentScopeLabel(panelOrDeployments) {
  const deployments = Array.isArray(panelOrDeployments) ? panelOrDeployments : panelDeployments(panelOrDeployments);
  return isMultiDeployment(deployments) ? deploymentLabel(primaryDeployment(deployments)) : null;
}

export const deploymentScopeCSS = `
.deployment-scope { margin:0; padding:6px 16px 0; color:var(--muted); font-size:11.5px; line-height:1.4; font-weight:500;
  min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.deployment-scope[hidden] { display:none; }
.deployment-scope.inline { padding:0; }
`;

function ensureCSS(doc) {
  if (!doc?.head || doc.head.querySelector('style[data-deployment-scope]')) return;
  const style = doc.createElement('style'); style.dataset.deploymentScope = ''; style.textContent = deploymentScopeCSS;
  doc.head.append(style);
}

/**
 * A self-updating line. `workspace()` names the view (or deployment) the surface shows: the shell's
 * current workspace, or a pinned tab's own. `inline` drops the bar padding (a line inside a padded
 * page or dialog). Returns `{ element, update(), dispose() }`; the subscription also ends by itself
 * once a line that was on screen leaves the document.
 */
export function createDeploymentScopeLine(doc, { workspace = currentWorkspace, inline = false, className = '' } = {}) {
  ensureCSS(doc);
  const element = doc.createElement('p');
  element.className = ['deployment-scope', inline ? 'inline' : '', className].filter(Boolean).join(' ');
  let seen = false, off = null, offWorkspace = null;
  const update = () => {
    const label = deploymentScopeLabel(viewDeployments(typeof workspace === 'function' ? workspace() : workspace) || []);
    const value = label ? `On ${label}` : '';
    if (element.textContent !== value) element.textContent = value;
    element.title = value;
    element.hidden = !label;
  };
  const follow = () => {
    if (element.isConnected) seen = true;
    else if (seen) { dispose(); return; }
    update();
  };
  off = onViewDeployments(follow);
  // A switch changes what the current-workspace surfaces show, even when no panel changed.
  offWorkspace = onWorkspaceChange(follow);
  function dispose() { off?.(); off = null; offWorkspace?.(); offWorkspace = null; }
  update();
  return { element, update, dispose };
}
