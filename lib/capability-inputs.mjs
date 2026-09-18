/** Capability-owned helper instruction policy and selected supplemental inputs.
 * Shape only: no source lookup, binding, readiness, side effects or fallback. */
import { canonicalJson } from './portable-values.mjs';
import { objectAt, invalidShape } from './portable-shape.mjs';
import { portablePath } from './source-spec.mjs';

export function validateHelperInjection(value) {
  canonicalJson(value);
  const file = value?.mode === 'file';
  objectAt(value, file ? ['version', 'mode', 'path'] : ['version', 'mode'], file ? ['version', 'mode', 'path'] : ['version', 'mode']);
  if (value.version !== 1 || !['inherit', 'omit', 'file'].includes(value.mode)) invalidShape('/helperInjection', 'unsupported helper instruction policy');
  if (file) portablePath(value.path);
  return value;
}

export function validateHookInputs(value) {
  canonicalJson(value);
  objectAt(value, ['sourceReceipt'], [], '/inputs');
  if (Object.hasOwn(value, 'sourceReceipt')) {
    objectAt(value.sourceReceipt, ['version'], ['version'], '/inputs/sourceReceipt');
    if (value.sourceReceipt.version !== 1) invalidShape('/inputs/sourceReceipt/version', 'unsupported source receipt input version');
  }
  return value;
}

/** Presence is explicit. In particular, absent/empty inputs are NOT consent;
 * this validator does not infer whether a provider depends on that input. */
export function validateCapabilityInputDeclarations(manifest) {
  canonicalJson(manifest);
  objectAt(manifest, null, []);
  if (Object.hasOwn(manifest, 'helperInjection')) validateHelperInjection(manifest.helperInjection);
  if (Object.hasOwn(manifest, 'hooks')) {
    objectAt(manifest.hooks, null, [], '/hooks');
    for (const hook of Object.values(manifest.hooks)) {
      if (hook !== null && typeof hook === 'object' && Object.hasOwn(hook, 'inputs')) validateHookInputs(hook.inputs);
    }
  }
  return manifest;
}
