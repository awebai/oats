/** How a deployment is named on screen: its machine and a short path (#482). Shared by the server,
 * which labels every deployment of a workspace view, and the renderer, which shows the labels. */

export const THIS_MACHINE = 'This Mac';
const MAX_PATH = 40;

/** A path for display only: the home directory as `~` (this computer's own home for a local
 * deployment; a remote host's `/Users/<name>` or `/home/<name>` prefix, which is only a display
 * guess, since the host's home is never asked), and its last two segments when it is still long. */
export function shortPath(path, { home = null } = {}) {
  if (typeof path !== 'string' || !path) return '';
  let shown = path;
  if (typeof home === 'string' && home.length > 1 && (path === home || path.startsWith(home.endsWith('/') ? home : `${home}/`))) {
    shown = `~${path.slice(home.replace(/\/$/, '').length)}`;
  } else if (home === null) {
    const m = path.match(/^\/(?:Users|home)\/[^/]+(\/.*)?$/);
    if (m) shown = `~${m[1] || ''}`;
  }
  if (shown.length <= MAX_PATH) return shown;
  const parts = shown.split('/').filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : shown;
}

/** `This Mac · ~/Agents/oats`, `altair · ~/Agents/tsm`. */
export function deploymentLabel(deployment) {
  const machine = typeof deployment?.machine === 'string' && deployment.machine ? deployment.machine : THIS_MACHINE;
  const path = typeof deployment?.label === 'string' && deployment.label ? deployment.label : '';
  return path ? `${machine} · ${path}` : machine;
}
