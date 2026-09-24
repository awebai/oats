/** Where a soul is edited. In workspace model v2 a soul is DECLARED in its
 * repository (a workspace member); the Desktop never edits it in place. This
 * turns the kernel's `oats souls` source — repoKey, commit, path — into the
 * repository location and, for a hosted key, a web link.
 *
 * Keys follow the kernel: hosted `<host>/<path>` (the kernel's own clone URL
 * is `https://<key>.git`) or `local/<abs>`. Only a well-formed hosted key gets
 * a link: github.com links the soul's directory at its resolved commit, other
 * hosts their repository home (their tree URL shapes differ). A local key is
 * a directory on this machine and gets no link. Anything else is not linked. */
const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?$/;
const SEGMENT = /^[A-Za-z0-9._~-]+$/;
const segments = path => {
  if (typeof path !== 'string' || !path || path.length > 1024) return null;
  const parts = path.split('/');
  return parts.every(part => SEGMENT.test(part) && part !== '.' && part !== '..') ? parts : null;
};

export function soulRepository(source) {
  const repoKey = typeof source?.repoKey === 'string' ? source.repoKey : '';
  const path = segments(source?.path) ? source.path : null;
  const commit = typeof source?.commit === 'string' && /^[0-9a-f]{40}$/.test(source.commit) ? source.commit : null;
  if (repoKey.startsWith('local/')) {
    const dir = repoKey.slice('local/'.length);
    return dir.startsWith('/') && !dir.includes('\0') ? { repository: dir, path, url: null } : null;
  }
  const [host, ...rest] = repoKey.split('/');
  if (!HOST.test(host || '') || rest.length < 1 || !segments(rest.join('/'))) return null;
  const home = `https://${host}/${rest.join('/')}`;
  const url = host === 'github.com' && rest.length === 2 && path && commit ? `${home}/tree/${commit}/${path}` : home;
  return { repository: repoKey, path, url };
}
