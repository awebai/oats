/** Fixed provider-declared diagnostics (a manifest's binding.reasons), never a
 * free-text transport: their shape and bounds. */
import { invalidShape, stringAt, stringSetAt } from './shape.mjs';

export function validateBindingReasons(reasons, { allowEmpty = false } = {}) {
  stringSetAt(reasons, '/binding/reasons', (reason, pointer) => {
    stringAt(reason, pointer);
    if (reason.length > 200 || /[{}]|[^\x20-\x7e]/.test(reason)) invalidShape(pointer, 'reason must be printable ASCII of at most 200 characters without braces');
  });
  if (reasons.length > 64 || (!allowEmpty && reasons.length === 0)) invalidShape('/binding/reasons', 'expected 1 to 64 fixed reasons');
  return reasons;
}
