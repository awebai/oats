/** What a client says, in its own words, of a start it could not make: a start, a restart or a launch
 * preview of an existing home that the kernel refused. One sentence per refusal code a client has words
 * for; every other refusal reads as the kernel's message, as before.
 *
 * A sentence names the Start dialog's own two controls (its Launch configuration list and that list's
 * entry for the bare harness), never a machine: it is the same for a home on this computer and on a
 * server. It holds no part of the kernel's message, which a client shows under it, attributed and through
 * the display filter (display-text.mjs). No kernel text is parsed or compared to choose it: the code alone.
 * Not on the stable surface. */
const SENTENCES = Object.freeze({
  // Several launch configurations are declared for the harness a start named, none is the default, and the
  // start named no configuration.
  E_LAUNCH_CONFIG_AMBIGUOUS: 'More than one launch configuration is declared for the chosen harness, and none is the default. Choose one under Launch configuration, or choose "No launch configuration" to run the harness as installed.',
});

/** The client's sentence for a start's refusal `code`, or null when it has none. */
export const startRefusalSentence = code => (typeof code === 'string' && Object.hasOwn(SENTENCES, code) ? SENTENCES[code] : null);
