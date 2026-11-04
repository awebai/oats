// The one shape a service URL from another party's text (an invite, a root's workspace.yaml) must
// have before it is used or shown: http(s), a host, an optional port and no path but `/` or `/api`,
// at most 2048 characters. Nothing else passes, so no credential (userinfo, a query, a path
// segment) and no stray text (WHATWG URL parsing drops tabs and newlines; this does not) gets through.
const PLAIN_SERVICE_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?(?:\/api\/?|\/)?$/;

/** `value` when it is a plain service URL, else undefined. */
export function plainServiceUrl(value) {
  return typeof value === 'string' && value.length <= 2048 && PLAIN_SERVICE_RE.test(value) ? value : undefined;
}
