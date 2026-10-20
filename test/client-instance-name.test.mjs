// The instance-name rule of the shared home (packages/client/instance-name.mjs): a typed name gets its soul's role
// as a suffix, once. The cases are tables so the kernel's own copy (the name suggestion, a later change) can pin
// the very same rows.
import test from "node:test";
import assert from "node:assert/strict";
import { soulRole, nameWithRole } from "../packages/client/instance-name.mjs";

/** [soul name, role]: the last `-` word, after a package qualifier (the last `/` or `--`). */
export const ROLE_CASES = Object.freeze([
  ["oats-desktop-expert", "expert"],
  ["oats-kernel-developer", "developer"],
  ["oats-maintainer", "maintainer"],
  ["code-reviewer", "reviewer"],
  ["cloner", "cloner"],
  ["acme-pkg--keeper", "keeper"],
  ["acme-pkg--release-keeper", "keeper"],
  ["oats.framework/code-reviewer", "reviewer"],
  ["acme/pkg--ops-lead", "lead"],
  ["", ""],
  ["trailing-", ""],
  ["pkg--", ""],
]);

/** [typed, soul name, final name]. */
export const NAME_CASES = Object.freeze([
  ["desktop-improvements", "oats-desktop-expert", "desktop-improvements-expert"],
  ["desktop-improvements-expert", "oats-desktop-expert", "desktop-improvements-expert"],
  ["expert", "oats-desktop-expert", "expert"],
  ["api-v2", "oats-kernel-developer", "api-v2-developer"],
  ["release", "oats-maintainer", "release-maintainer"],
  ["pr-42", "code-reviewer", "pr-42-reviewer"],
  ["cloner", "cloner", "cloner"],
  ["mirror", "cloner", "mirror-cloner"],
  ["nightly", "acme-pkg--keeper", "nightly-keeper"],
  // Only a whole trailing word counts: a name that merely ends in the role's letters still gets it.
  ["subexpert", "oats-desktop-expert", "subexpert-expert"],
  ["expert-one", "oats-desktop-expert", "expert-one-expert"],
  // The rule rewrites nothing else: case and the grammar are the kernel's to refuse.
  ["Desktop-Expert", "oats-desktop-expert", "Desktop-Expert-expert"],
  ["x", "trailing-", "x"],
  ["", "oats-desktop-expert", ""],
]);

test("soulRole: the last word of the soul's name, after a package qualifier", () => {
  for (const [soul, role] of ROLE_CASES) assert.equal(soulRole(soul), role, soul);
  for (const v of [undefined, null, 7, {}]) assert.equal(soulRole(v), "");
});

test("nameWithRole: the role once as a suffix; a name already ending in it, or equal to it, stays as typed", () => {
  for (const [typed, soul, final] of NAME_CASES) assert.equal(nameWithRole(typed, soul), final, `${typed} · ${soul}`);
  for (const v of [undefined, null, 7]) assert.equal(nameWithRole(v, "oats-desktop-expert"), "");
  assert.equal(nameWithRole("solo", undefined), "solo", "no soul name, no role: the name as typed");
});

test("nameWithRole is idempotent: a final name given again is unchanged (a restored draft holds the final name)", () => {
  for (const [typed, soul] of NAME_CASES) { const once = nameWithRole(typed, soul); assert.equal(nameWithRole(once, soul), once, `${typed} · ${soul}`); }
});
