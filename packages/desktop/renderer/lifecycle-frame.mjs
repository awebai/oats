/** The one lifecycle refusal only the Desktop raises: main's frame guard (main.mjs, the `api` handler)
 * answers it to a frame that is not the window's own page. No other client has a window to refuse, so the
 * sentence is here and not in the shared table (packages/client/lifecycle-contract.mjs), which does not
 * know the code. Main raises it and the lifecycle dialog shows it, so both import this module. */
import { lifecycleFailure } from '../../client/lifecycle-contract.mjs';
import { DESKTOP_TERMS } from './desktop-terms.mjs';

export const LIFECYCLE_FORBIDDEN_FRAME = Object.freeze({ code: 'E_FORBIDDEN_FRAME', message: 'This window cannot request a lifecycle operation.' });

/** The body main answers a refused frame with: a lifecycle failure whose reason is the one above.
 * `lifecycleFailure` builds the failure's fixed fields and takes a code of the shared table; the code it
 * is given here only fills `reason`, which is replaced, so it is never part of the answer. */
export const lifecycleFrameRefusal = () => lifecycleFailure('E_CLI_FAILED', DESKTOP_TERMS, { reason: { ...LIFECYCLE_FORBIDDEN_FRAME } });
