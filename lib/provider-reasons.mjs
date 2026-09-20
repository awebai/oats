/** Fixed provider-declared diagnostics, never a free-text transport. Values
 * come from the verified selected manifest or reviewed kernel compatibility
 * data, not from a codec response, operator input or today's configuration. */
import { invalidShape, stringAt, stringSetAt } from './portable-shape.mjs';

// Compatibility literals for manifests predating binding.reasons. These are
// data, never provider-name-dependent interpretation of payloads or settings.
// aweb: awebai/oats-aweb v1.11.0, 862f156c883ab39c69c9e83cdf3bab86be882867.
// oats-package/capabilities/oats-aweb/lib/{binding-wire,session-readiness}.mjs:
// complete safeReasons/fallback/overflow/check vocabulary (no hook warnings).
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
    'multiple soul messaging declarations',
    'adoption team aliases have conflicting mappings',
    'messaging settings and explicit binding selections are required',
    'messaging declarations contain incompatible requirements',
    'messaging input must match the supported binding contract',
    'explicit native messaging authorization is required',
    'a required native messaging host resource is unavailable',
    'the selected messaging provider is unavailable',
    'the requested messaging configuration is not qualified',
    'messaging response exceeds the supported wire limits',
    'an admitted captured instance intent is required for execution',
    'an explicit private-team binding is required',
    'selected binding and inline captured invocation are required',
    'an explicit captured instance home is required',
    'captured messaging requires explicit delivery: session',
    'selected wider memberships need their explicitly qualified native setup; they were not omitted',
    'caller-owned OATS_CLI_BIN and readable kernel version are required',
    'oats >=0.24.2 is required for captured HOME custody and retained runtime inspection',
    'the exact retained runtime profile must be readable',
    'the kernel must report the exact retained resolution',
    'a retained launchSelection runtime/model observation is required',
    'Pi strict print does not support session input; retain messaging and configure an input-capable profile',
    'a supported input-capable ordinary Claude/Codex profile is required',
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

export function validateBindingReasons(reasons, { allowEmpty = false } = {}) {
  stringSetAt(reasons, '/binding/reasons', (reason, pointer) => {
    stringAt(reason, pointer);
    if (reason.length > 200 || /[{}]|[^\x20-\x7e]/.test(reason)) invalidShape(pointer, 'reason must be printable ASCII of at most 200 characters without braces');
  });
  if (reasons.length > 64 || (!allowEmpty && reasons.length === 0)) invalidShape('/binding/reasons', 'expected 1 to 64 fixed reasons');
  return reasons;
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
