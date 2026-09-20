/** Fixed provider-declared diagnostics, never a free-text transport. Values
 * come from the verified selected manifest or reviewed kernel compatibility
 * data, not from a codec response, operator input or today's configuration. */
import { stringAt, stringSetAt } from './portable-shape.mjs';

// Compatibility literals for manifests predating binding.reasons. These are
// data, never provider-name-dependent interpretation of payloads or settings.
// aweb: awebai/oats-aweb v1.11.0 (tag 862f156, merge 93f8ab96),
// oats-package/capabilities/oats-aweb/lib/binding-wire.mjs safeReasons/fallbackReasons.
// OKF: awebai/oats-okf PR5, 0517a70a7158ebdf14ccb6e880b437c3d43cb1db,
// same capability-relative file, settingMessages (UNRELEASED 2.1.2 at selection).
// Released OKF 2.1.1 sends code-only; this table invents no reason for it.
const bundled = Object.freeze({
  'oats.aweb': Object.freeze([
    'messaging-enabled standalone preparation needs an explicit context key',
    'messaging binding needs one soul declaration',
    'messaging workspace must declare private: per-human',
    'an explicit responsible-human binding is required',
    'an explicit wider-membership consent list is required',
    'a selected wider-team binding is required',
    'a selected wider alias needs an explicit workspace team mapping',
    'messaging settings and explicit binding selections are required',
    'multiple soul messaging declarations',
    'adoption team aliases have conflicting mappings',
    'messaging declarations contain incompatible requirements',
  ]),
  'oats.okf': Object.freeze([
    'setting bindings-file is required (absolute host path)',
    'setting bindings-file must be a normalized absolute host path',
    'setting state-dir is required (absolute host path)',
    'setting state-dir must be a normalized absolute host path',
    'setting harvest-runtime is required (pi, claude or codex)',
    'setting harvest-runtime must be pi, claude or codex',
    'setting harvest-model must be null or a non-empty string',
  ]),
});
const none = Object.freeze([]);

export function validateBindingReasons(reasons) {
  return stringSetAt(reasons, '/binding/reasons', (reason, pointer) =>
    stringAt(reason, pointer, { pattern: /^[^\u0000-\u001f\u007f-\u009f]+$/ }));
}

export function providerReasons(manifest) {
  if (Object.hasOwn(manifest.binding ?? {}, 'reasons')) return validateBindingReasons(manifest.binding.reasons);
  return Object.hasOwn(bundled, manifest.capability) ? bundled[manifest.capability] : none;
}

/** Exact Unicode scalar text is exact UTF-8 text; never trim, normalize,
 * interpolate or accept a prefix/substring. Absence preserves template fallback. */
export function safeProviderReason(message, reasons) {
  return typeof message === 'string' && reasons.includes(message) ? message : undefined;
}
