/** The API versions of the automation answers (`scheduleApi` and `automationsApi` in `version --json`).
 *  A leaf (awebai/oats#1630): `oats version` reads them without loading schedule.mjs or automations.mjs,
 *  which re-export them. */

export const SCHEDULE_API = 2;

export const AUTOMATIONS_API = 1;
