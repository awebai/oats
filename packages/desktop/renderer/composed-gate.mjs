/** When a soul's composed AGENTS.md is asked for (feature soul-composed-instructions, `inspect --soul
 * --instructions`). Shared by the renderer (whether the soul page asks) and the server (whether the ask
 * reaches the CLI); DOM-free so the server can import it.
 *
 * A local soul: this computer's CLI advertises the feature. A routed soul (`--server`): the host composes,
 * so this computer's CLI must also relay what each host reports about itself (feature server-probe-features:
 * the roster group's `probe.features`, the host's own `version --json` features), and the host's list must
 * name the feature. Only an array counts: `features: null` (an older host, or a list the kernel would not
 * relay) and a group with no `features` key (a failed roster read) are unknown, and unknown is not supported.
 * Never decided from a refusal (`E_REMOTE_INCOMPATIBLE`) and never by probing: the roster row is the answer. */
export const COMPOSED_FEATURE = 'soul-composed-instructions';
export const PROBE_FEATURES_FEATURE = 'server-probe-features';

const advertises = (cli, feature) => !!cli?.ok && Array.isArray(cli.features) && cli.features.includes(feature);
/** This computer's CLI composes a soul's AGENTS.md on request. */
export const composedSupported = cli => advertises(cli, COMPOSED_FEATURE);
/** This computer's CLI can route the request and relays the hosts' own feature lists in the roster. */
export const routedComposedSupported = cli => composedSupported(cli) && advertises(cli, PROBE_FEATURES_FEATURE);
/** A roster group's host composes: its last roster read succeeded and its own list names the feature. */
export function hostComposes(cli, group) {
  const probe = group?.probe;
  return routedComposedSupported(cli) && probe?.ok === true && Array.isArray(probe.features) && probe.features.includes(COMPOSED_FEATURE);
}
