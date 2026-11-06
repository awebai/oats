// The `team` setting: the aweb team whose task list oats.aweb-tasks reads and
// writes. Absent means the home's default team, exactly as before the setting.
// A label follows oats.aweb's LABEL_RE; the identity home that acts in it is
// never derived from the label, only read from `oats aweb teams --json`.
export const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const LABEL_RULE = 'a team label is a letter or digit, then up to 63 letters, digits, "-" or "_"';

/** The setting's value shown in a message: JSON, at most 80 characters. */
export function shown(value) {
  let text;
  try { text = JSON.stringify(value); } catch { text = String(value); }
  if (text === undefined) text = String(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

/** What is wrong with a present `team` value, or null for a valid label. */
export function labelProblem(value) {
  if (typeof value !== 'string') return `is ${value === null ? 'null' : Array.isArray(value) ? 'a list' : `a ${typeof value}`}, not a team label; remove it to use the default team`;
  if (value === '') return 'is empty; remove it to use the default team';
  if (value.length > 64) return `is ${value.length} characters long, and ${LABEL_RULE}`;
  if (!/^[A-Za-z0-9]/.test(value)) return `starts with ${JSON.stringify(value[0])}, and ${LABEL_RULE}`;
  const bad = value.match(/[^A-Za-z0-9_-]/);
  if (bad) return `contains ${JSON.stringify(bad[0])}, and ${LABEL_RULE}`;
  return null;
}

/** The `team` setting of a settings payload: {absent: true}, {label} or {problem}. */
export function teamSetting(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { problem: 'the oats.aweb-tasks settings payload is not an object' };
  if (!Object.hasOwn(settings, 'team') || settings.team === undefined) return { absent: true };
  const problem = labelProblem(settings.team);
  return problem ? { problem: `setting team ${shown(settings.team)} ${problem}` } : { label: settings.team };
}
