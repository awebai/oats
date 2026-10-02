/** The one rule for a workspace, view or deployment id the Desktop stores, routes or binds a window
 * to: a non-empty string of at most WORKSPACE_ID_MAX characters with no C0 or DEL control. Shared by
 * main (window binding, IPC) and the renderer (remembered tabs and deployments). */
export const WORKSPACE_ID_MAX = 4096;

export const validWorkspaceId = v => typeof v === 'string' && v.length > 0 && v.length <= WORKSPACE_ID_MAX && !/[\x00-\x1f\x7f]/.test(v);
