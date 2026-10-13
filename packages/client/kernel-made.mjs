/** The mark of an error object the installed CLI printed: who reads the kernel's answer says so on the
 * object, where it parses it, and who shows the error's message asks. Not on the stable surface.
 *
 *   kernelMade(error) -> the same object, marked      the reader's, where an answer is parsed
 *   madeByKernel(error) -> boolean                    the shower's
 *
 * The mark is a property under a symbol this module does not export, and not enumerable. So it cannot
 * arrive in an answer (JSON carries no symbol key), it is in nothing a client serves (`JSON.stringify`
 * skips it), and a comparison of the object's fields does not see it. It is on the object, not in a list
 * of objects: this home keeps no state.
 *
 * Unmarked reads as not the kernel's (the rule of deployment-read-cli.mjs `origin: 'kernel'`). A copy of
 * the object (a spread, a JSON round trip, `structuredClone`) has no mark, so a lost mark never puts
 * words under the kernel's name: the error then reads as the client's own. An error the client writes
 * itself (a timeout, an answer that is not the contract's, a read that threw) needs nothing. */
const KERNEL = Symbol('the installed CLI printed this');

export function kernelMade(error) {
  if (error !== null && typeof error === 'object' && Object.isExtensible(error)) Object.defineProperty(error, KERNEL, { value: true });
  return error;
}

export const madeByKernel = (error) => error !== null && typeof error === 'object' && Object.hasOwn(error, KERNEL);
