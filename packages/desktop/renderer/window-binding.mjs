/** One Desktop window per workspace (#481): a window is bound to its workspace by its renderer URL's
 * hash, exactly `#ws=<encodeURIComponent(id)>`. No hash is a window with no workspace yet. Pure, and
 * shared: main trusts a frame and reads its workspace with frameWorkspace(); the renderer reads its
 * own hash with hashWorkspace() and rewrites it with workspaceHash(). */
import { validWorkspaceId } from './workspace-id.mjs';

const PREFIX = '#ws=';

/** The hash that binds a window to `id`; throws for an id the rule refuses. */
export function workspaceHash(id) {
  if (!validWorkspaceId(id)) throw new Error('window binding: invalid workspace id');
  return `${PREFIX}${encodeURIComponent(id)}`;
}

/** A location hash read as a binding: `{ ok: true, workspace: null }` for no hash, `{ ok: true,
 * workspace }` for the canonical `#ws=` of a valid id, else `{ ok: false }` (refused, never ignored:
 * another hash, extra parameters, a non-canonical or broken encoding, an invalid id). */
export function hashWorkspace(hash) {
  if (hash === '') return { ok: true, workspace: null };
  if (typeof hash !== 'string' || !hash.startsWith(PREFIX)) return { ok: false };
  let workspace;
  try { workspace = decodeURIComponent(hash.slice(PREFIX.length)); } catch { return { ok: false }; }
  if (!validWorkspaceId(workspace) || `${PREFIX}${encodeURIComponent(workspace)}` !== hash) return { ok: false };
  return { ok: true, workspace };
}

/** The workspace a frame URL binds, for a frame that is the app's own renderer: null with no hash, the
 * id with a valid `#ws=`. undefined for every other URL (another origin or path, any query, any other
 * hash): the frame is not trusted. Origin and path are compared exactly, as one string. */
export function frameWorkspace(url, rendererUrl) {
  if (typeof url !== 'string' || typeof rendererUrl !== 'string' || !rendererUrl || !url.startsWith(rendererUrl)) return undefined;
  const binding = hashWorkspace(url.slice(rendererUrl.length));
  return binding.ok ? binding.workspace : undefined;
}

/** Is this frame URL the app's own renderer (unbound, or bound to a valid workspace)? */
export function trustedRendererUrl(url, rendererUrl) {
  return frameWorkspace(url, rendererUrl) !== undefined;
}
