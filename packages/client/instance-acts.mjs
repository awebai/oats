/** Which acts a roster row offers, decided from the kernel's row alone. A client draws its menu, its
 * keys or its buttons from this answer: verbs and reasons, never a label, an icon or a key.
 *
 *   instanceActs(instance) -> { blocked: Reason | null, limited: Reason | null, acts: Act[] }
 *   Act    = { verb, enabled, reason: Reason | null }
 *   Reason = { code, sentence } and, by code:
 *     { code: 'unaddressable', key, sentence }   key: the row reason's own (remote-address.mjs rowReason)
 *     { code: 'held', kind, sentence }           kind: 'spawning' | 'spawn-incomplete' | 'retire-incomplete'
 *     { code: 'unsupported-session', sentence }
 *
 * A client may switch on `code`, and on `key` or `kind` when it needs to; never on the sentence.
 * The sentences are the ones the shared tables already produce. Two of them can be kernel text (an
 * unaddressable row's `runtimeError`, the kernel's reason for a removed session backend): a client
 * shows a sentence only through display-text.mjs `displayLine`.
 *
 * `blocked`: the row offers nothing, and this is why; `acts` is then empty.
 * `limited`: the row offers fewer acts than a home normally does, and this is why. It is about the
 * row, not about one act: **a client adds none of its own acts to a limited row.**
 * `blocked` and `limited` are never both set. An act's own `reason` says why that one act is listed
 * and not enabled; the others stay as they are.
 *
 * In order, the first that applies:
 *   a remote row the kernel does not report addressable   blocked (unaddressable); no acts
 *   a home the kernel holds, spawning                     blocked (held); no acts
 *   a home the kernel holds, spawn or retire incomplete   limited (held); retire
 *   a session backend OATS no longer has                  inspect, start (not enabled, unsupported-session), stop, retire
 *   running === true                                      inspect, restart, stop, retire
 *   running === false                                     inspect, start, stop, retire
 *   running unknown                                       inspect, stop, retire
 */
import { heldHome } from './instance-tree.mjs';
import { unsupportedSession } from './instance-presentation.mjs';
import { canAddressRemote, rowReason } from './remote-address.mjs';

const act = (verb, reason = null) => ({ verb, enabled: !reason, reason });

export function instanceActs(instance) {
  if (!canAddressRemote(instance)) {
    const { key, sentence } = rowReason(instance);
    return { blocked: { code: 'unaddressable', key, sentence }, limited: null, acts: [] };
  }
  // #802: a home the kernel holds starts, stops and opens nothing. Retire only when a spawn or a retire left it
  // half cleaned (the kernel's retire completes it), nothing while its spawn sets up the worktree.
  const held = heldHome(instance);
  if (held) {
    const reason = { code: 'held', kind: held.kind, sentence: held.sentence(instance.instance) };
    return held.retire ? { blocked: null, limited: reason, acts: [act('retire')] } : { blocked: reason, limited: null, acts: [] };
  }
  // A Herdr-recorded row cannot start or restart: Start stays listed, not enabled, with the kernel's reason.
  const unsupported = unsupportedSession(instance);
  const launch = unsupported ? [act('start', { code: 'unsupported-session', sentence: unsupported })]
    : instance.running === true ? [act('restart')] : instance.running === false ? [act('start')] : [];
  return { blocked: null, limited: null, acts: [act('inspect'), ...launch, act('stop'), act('retire')] };
}
