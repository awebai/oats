/** Provider-owned binding protocol. This codec declares no provider model and
 * grants no execution authority; commands remain in the sole manifest table. */
import { objectAt, stringAt, stringSetAt, versionAt } from './shape.mjs';
import { oatsError } from './errors.mjs';
import { validateBindingReasons } from './provider-reasons.mjs';

/** The layers a binding codec may belong to (the kernel's LAYERS). */
const FUNDAMENTAL_SLOTS = Object.freeze(['knowledge', 'messaging', 'tasks']);

export const BINDING_PHASES = Object.freeze(['normalize', 'bind', 'check']);
export function validateBindingInterface(manifest) {
  if (manifest.binding === undefined) return null;
  if (!FUNDAMENTAL_SLOTS.includes(manifest.layer)) throw oatsError('invalid-binding-interface', 'binding codecs belong to a fundamental provider slot');
  const binding = manifest.binding;
  objectAt(binding, ['version', ...BINDING_PHASES, 'reasons', 'keys'], ['version', ...BINDING_PHASES], '/binding');
  versionAt(binding.version);
  if (Object.hasOwn(binding, 'reasons')) validateBindingReasons(binding.reasons);
  // 0.24.4 validates declarations only; ownership/routing enforcement is 0.25.
  if (Object.hasOwn(binding, 'keys')) stringSetAt(binding.keys, '/binding/keys', (key, pointer) =>
    stringAt(key, pointer, { pattern: /^[A-Za-z][A-Za-z0-9_-]*\.?$(?![\s\S])/ }));
  for (const phase of BINDING_PHASES) {
    const name = binding[phase];
    stringAt(name, `/binding/${phase}`, { pattern: /^[a-z0-9][a-z0-9-]*$/ });
    if (!manifest.commands || !Object.hasOwn(manifest.commands, name) || typeof manifest.commands[name] !== 'string' || !manifest.commands[name].trim()) {
      throw oatsError('invalid-binding-interface', 'binding phase must reference a command owned by this manifest');
    }
  }
  return binding;
}
