/** Provider-owned binding protocol. This codec declares no provider model and
 * grants no execution authority; commands remain in the sole manifest table. */
import { objectAt, stringAt, versionAt } from './portable-shape.mjs';
import { FUNDAMENTAL_SLOTS } from './portable-policy.mjs';
import { oatsError } from './errors.mjs';

export const BINDING_PHASES = Object.freeze(['normalize', 'bind', 'check']);
export function validateBindingInterface(manifest) {
  if (manifest.binding === undefined) return null;
  if (!FUNDAMENTAL_SLOTS.includes(manifest.layer)) throw oatsError('invalid-binding-interface', 'binding codecs belong to a fundamental provider slot');
  const binding = manifest.binding;
  objectAt(binding, ['version', ...BINDING_PHASES], ['version', ...BINDING_PHASES], '/binding');
  versionAt(binding.version);
  for (const phase of BINDING_PHASES) {
    const name = binding[phase];
    stringAt(name, `/binding/${phase}`, { pattern: /^[a-z0-9][a-z0-9-]*$/ });
    if (!manifest.commands || !Object.hasOwn(manifest.commands, name) || typeof manifest.commands[name] !== 'string' || !manifest.commands[name].trim()) {
      throw oatsError('invalid-binding-interface', 'binding phase must reference a command owned by this manifest');
    }
  }
  return binding;
}
