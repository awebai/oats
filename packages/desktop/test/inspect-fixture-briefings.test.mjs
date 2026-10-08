// #682: the inspect fixtures carry the briefing a current instance receives. Every composed AGENTS.md string
// under test/fixtures holds the kernel's instance-boundary and work-mode blocks verbatim between their markers;
// each must equal what the kernel composes for that block today: its own goldens (test/golden/*/AGENTS.md at the
// repository root), or, for a mode no golden composes (directory), the inject it is composed from. #678 changed
// both blocks and nothing failed, so a fixture silently showed a pre-0.42.1 instance. When this fails after a
// kernel change, align the fixture's block by hand to the golden: there is no Desktop fixture generator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const NAME = '(kernel:instance-boundary|work-mode:[a-z]+)';
const OPENING = new RegExp(`<!-- oats:${NAME} src=`, 'g');
const BLOCK = new RegExp(`<!-- oats:${NAME} src=[^\\n]* -->\\n([\\s\\S]*?)\\n<!-- /oats:\\1 -->`, 'g');

/** The kernel blocks in one composed text, by name; throws on an opening marker without its closing one, so a
 * truncated or renamed block cannot escape the comparison. */
function kernelBlocks(text, where) {
  const blocks = [...text.matchAll(BLOCK)].map(([, name, body]) => ({ name, body }));
  assert.equal(blocks.length, [...text.matchAll(OPENING)].length, `${where}: every kernel block opening has its closing marker`);
  return blocks;
}

function* strings(value) {
  if (typeof value === 'string') yield value;
  else if (value && typeof value === 'object') for (const item of Object.values(value)) yield* strings(item);
}

// What the kernel composes, per block name: every variant its goldens hold.
const composed = new Map();
for (const dir of readdirSync(join(ROOT, 'test', 'golden'))) {
  const file = join(ROOT, 'test', 'golden', dir, 'AGENTS.md');
  for (const { name, body } of kernelBlocks(readFileSync(file, 'utf8'), file)) {
    if (!composed.has(name)) composed.set(name, new Set());
    composed.get(name).add(body);
  }
}
const expected = name => {
  if (composed.has(name)) return composed.get(name);
  const inject = name === 'kernel:instance-boundary' ? 'instance-boundary.md' : `work-${name.slice('work-mode:'.length)}.md`;
  return new Set([readFileSync(join(ROOT, 'injects', inject), 'utf8').replace(/\n+$/, '')]);
};

test('every composed briefing in the Desktop fixtures carries the kernel blocks the current kernel composes', () => {
  const checked = new Map();
  for (const rel of readdirSync(FIXTURES, { recursive: true }).filter(path => path.endsWith('.json')).sort()) {
    const json = JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'));
    for (const text of strings(json)) {
      for (const { name, body } of kernelBlocks(text, rel)) {
        const current = expected(name);
        assert.ok(current.has(body), `${rel}: its ${name} block differs from what the kernel composes now (align it by hand)\n` +
          `--- fixture\n${body}\n--- kernel\n${[...current][0]}`);
        checked.set(name, (checked.get(name) ?? 0) + 1);
      }
    }
  }
  // Not vacuous: the two blocks #678 changed, and the one mode with no golden, are each compared somewhere.
  for (const name of ['kernel:instance-boundary', 'work-mode:worktree', 'work-mode:directory']) {
    assert.ok(checked.get(name) > 0, `a fixture carries ${name}`);
  }
});
