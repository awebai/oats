/** The one lifecycle refusal only the Desktop raises: main's frame guard (main.mjs, the `api` handler)
 * answers it to a frame that is not the window's own page. No other client has a window to refuse, so the
 * sentence is here and not in the shared table (packages/client/lifecycle-contract.mjs), which does not
 * know the code. Main raises it and the lifecycle dialog shows it, so both import this module. */
import { lifecycleFailureOf } from '../../client/lifecycle-contract.mjs';

export const LIFECYCLE_FORBIDDEN_FRAME = Object.freeze({ code: 'E_FORBIDDEN_FRAME', message: 'This window cannot request a lifecycle operation.' });

/** The body main answers a refused frame with: a lifecycle failure whose reason is the one above, given ready. */
export const lifecycleFrameRefusal = () => lifecycleFailureOf({ ...LIFECYCLE_FORBIDDEN_FRAME });
