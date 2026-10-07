/** Completion reporting only, never input authority. Source-qualified Claude
 * 2.1.289 non-Jt footer layout; the caller must enforce qualification and one
 * submitted answer. Unknown dialogs retaining this region can evade the finite
 * markers. That reporting risk is accepted; no subsequent key may be sent.
 * See launch-prompt-fixtures/structural-completion.json and README.md. */
export const CLAUDE_QUESTION_MARKERS = Object.freeze([
  'Accessing workspace:',
  'Quick safety check:',
  'Yes, I trust this folder',
  'No, continue without these permissions',
  'No, exit',
  'WARNING: Loading development channels',
  'I am using this for local development',
  'Managed settings require approval',
  'Yes, I trust these settings',
  'No, exit Claude Code',
  'Do you want to use this API key?',
  'Detected a custom API key in your environment',
  'Select login method:',
  'Do you want to proceed?',
  'Do you want to allow this connection?',
  'Waiting for permission…',
  'Enter to confirm',
  'Esc to cancel',
  'esc to cancel',
  'Enter to select',
  'Esc to exit',
]);

const modes = [
  ['default', '⏸ manual mode on'], ['plan', '⏸ plan mode on'],
  ['acceptEdits', '⏵⏵ accept edits on'], ['bypassPermissions', '⏵⏵ bypass permissions on'],
  ['dontAsk', "⏵⏵ don't ask on"], ['auto', '⏵⏵ auto mode on'],
];
const efforts = ['○ low · /effort', '◐ medium · /effort', '● high · /effort', '◉ xhigh · /effort', '◈ max · /effort'];
const hints = ['', ' · ← for agents', ' · esc to interrupt', ' · esc to interrupt · ← for agents'];
const shortcuts = [' · ? for shortcuts', ' · ? for shortcuts · ← for agents'];
const footers = new Set();
for (const [mode, label] of modes) {
  for (const cycle of mode === 'default' ? [''] : ['', ' (shift+tab to cycle)']) {
    for (const hint of mode === 'default' ? [...hints, ...shortcuts] : hints) {
      for (const right of efforts) {
        const left = label + cycle + hint;
        // Every enumerated character is single-column in the qualified layout.
        const gap = 108 - 2 - left.length - right.length;
        if (gap >= 1) footers.add('  ' + left + ' '.repeat(gap) + right);
      }
    }
  }
}
const border = '─'.repeat(110);

export function classifyClaudeLaunchCompletion(screen) {
  if (screen?.width !== 110 || screen?.height !== 35 || typeof screen.text !== 'string'
    || Buffer.byteLength(screen.text, 'utf8') > 64 * 1024) return null;
  // No exemptions for unknown questions. Ordinary shortcut/interrupt hints are
  // simply not markers; do not broaden this into a generic '?' or Esc rule.
  if (CLAUDE_QUESTION_MARKERS.some(marker => screen.text.includes(marker))) return 'blocked';
  if (/[\x00-\x09\x0b-\x1f]/.test(screen.text)) return null;
  const rows = screen.text.split('\n');
  if (rows.length !== 36 || rows.pop() !== '') return null;
  let footer = rows.length - 1;
  while (footer >= 0 && rows[footer] === '') footer--;
  if (footer < 3 || !footers.has(rows[footer]) || rows[footer - 1] !== border
    || rows[footer - 2] !== '❯\u00a0' || rows[footer - 3] !== border) return null;
  return 'completed';
}
