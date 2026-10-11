/** Completion reporting only, never input authority. After the sole Enter, a
 * capture containing any of these strings is a question Claude is asking, and
 * the launch blocks: no subsequent key may be sent. One list, the only one.
 * See docs/launch-prompt-completion.md. */
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

// Ordinary shortcut/interrupt hints are simply not markers; do not broaden
// this into a generic '?' or Esc rule.
export const hasClaudeQuestionMarker = text => CLAUDE_QUESTION_MARKERS.some(marker => text.includes(marker));
