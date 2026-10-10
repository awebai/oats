import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { capabilityShowData, capabilityFileData, capabilityShowSupported, capabilitySelector, selectorOf, sameSelector, validRelativePath,
  listedFiles, skillFilePath, triggerSourcesOf, triggerSourceProblemsOf, triggerSourcesView, FILE_TEXT_MAX_BYTES, LIMITS } from '../../client/capability-show-contract.mjs';

const commit = 'a'.repeat(40);
const show = (over = {}) => ({
  capabilityShowApi: 1, name: 'oats.aweb', kind: 'package', repoKey: null, package: 'oats.aweb', version: '1.17.0', commit, path: 'capabilities/oats.aweb',
  inject: { path: 'inject.md', bytes: 12, text: '# Messaging\n', binary: false, truncated: false },
  skills: [{ name: 'oats-aweb', path: 'skills/oats-aweb', description: 'The playbook. Use it first.', files: [{ path: 'skills/oats-aweb/SKILL.md', bytes: 40 }, { path: 'skills/oats-aweb/refs/a.md', bytes: 3 }], filesTruncated: false }],
  problems: [], ...over,
});

test('the gate is the feature AND the API integer, never a version', () => {
  assert.equal(capabilityShowSupported({ ok: true, features: ['capability-show'], capabilityShowApi: 1 }), true);
  assert.equal(capabilityShowSupported({ ok: true, features: ['capability-show'] }), false);
  assert.equal(capabilityShowSupported({ ok: true, features: [], capabilityShowApi: 1 }), false);
  assert.equal(capabilityShowSupported({ ok: true, features: ['capability-show'], capabilityShowApi: 2 }), false);
  assert.equal(capabilityShowSupported({ ok: false, features: ['capability-show'], capabilityShowApi: 1 }), false);
});

test('the selector comes from the catalog row: member by repoKey, package by id, external none', () => {
  assert.deepEqual(capabilitySelector({ name: 'oats.desktop-ui', kind: 'member', repoKey: 'github.com/awebai/oats', commit }), { name: 'oats.desktop-ui', kind: 'member', repoKey: 'github.com/awebai/oats' });
  assert.deepEqual(capabilitySelector({ name: 'oats.aweb', kind: 'package', package: 'oats.aweb' }), { name: 'oats.aweb', kind: 'package', package: 'oats.aweb' });
  assert.equal(capabilitySelector({ name: 'x', kind: 'external' }), null);
  assert.equal(capabilitySelector({ name: 'x', kind: 'member', repoKey: '--upload-pack=evil' }), null, 'never an option-looking argv value');
  assert.equal(capabilitySelector({ name: '-x', kind: 'package', package: 'p' }), null);
  assert.equal(selectorOf({ name: 'x', kind: 'member', repoKey: 'r', extra: 1 }), null, 'exact keys only');
  assert.equal(selectorOf({ name: 'x', kind: 'member', package: 'p' }), null);
  assert.equal(sameSelector({ name: 'x', kind: 'member', repoKey: 'r' }, { name: 'x', kind: 'member', repoKey: 'r2' }), false);
});

test('a good answer decodes; listed files are joined to the capability root', () => {
  const data = capabilityShowData(show(), { name: 'oats.aweb' });
  assert.equal(data.inject.text, '# Messaging\n');
  assert.equal(skillFilePath(data.skills[0], data.skills[0].files[1]), 'skills/oats-aweb/refs/a.md');
  assert.deepEqual([...listedFiles(data).keys()], ['inject.md', 'skills/oats-aweb/SKILL.md', 'skills/oats-aweb/refs/a.md']);
  assert.equal(capabilityShowData(show({ inject: null, skills: null }), { name: 'oats.aweb' }).skills, null);
  // Kernel refinements: an unlistable skill (files: null, a problem names it), an unsafe inject value (path: null).
  const odd = capabilityShowData(show({ inject: { path: null, bytes: null, text: null, binary: false, truncated: false },
    skills: [{ name: 's', path: 'skills/s', description: null, files: null, filesTruncated: false }],
    problems: [{ code: 'E_X', message: 'inject "../x" is not a safe path', path: null }, { code: 'E_Y', message: 'cannot list', path: 'skills/s' }] }));
  assert.equal(odd.inject.path, null); assert.equal(odd.skills[0].files, null);
  assert.deepEqual([...listedFiles(odd).keys()], [], 'neither is readable through --file');
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 'skills/s', description: null, files: null, filesTruncated: true }] })), null);
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 'skills/s', description: null, files: [], filesTruncated: false }] })), null, '[] never means unlisted');
  assert.equal(capabilityShowData(show({ inject: { path: null, bytes: 3, text: 'abc', binary: false, truncated: false } })), null, 'no content without a path');
  assert.ok(capabilityShowData({ ...show(), observation: { observedAt: '2026-10-01T00:00:00Z', reused: true, localRevision: 'x' } }), 'an observation block is accepted');
  const member = capabilityShowData(show({ kind: 'member', repoKey: 'github.com/awebai/oats', package: null }));
  const asked = { name: 'oats.aweb', kind: 'package', package: 'oats.aweb' };
  assert.ok(capabilityShowData(show(), { selector: asked }));
  assert.equal(capabilityShowData(show({ package: 'other.pkg' }), { selector: asked }), null, 'the same name from another package');
  assert.equal(capabilityShowData(show({ kind: 'member', repoKey: 'r', package: null }), { selector: asked }), null);
  assert.equal(capabilityShowData(show({ kind: 'member', repoKey: 'a/b', package: null }), { selector: { name: 'oats.aweb', kind: 'member', repoKey: 'a/c' } }), null, 'another member');
  assert.equal(member.package, null);
});

test('malformed answers refuse the whole document', () => {
  const bad = [
    show({ capabilityShowApi: 2 }), show({ commit: 'abc' }), show({ kind: 'external' }), show({ name: 'other' }),
    show({ problems: null }), show({ skills: {} }), show({ inject: { path: 'a', bytes: -1, text: '', binary: false, truncated: false } }),
    show({ inject: { path: 'a', bytes: 1, text: 'x', binary: true, truncated: false } }), // binary with text
    show({ inject: { path: 'a', bytes: 1, text: null, binary: false, truncated: true } }), // truncated without text
    show({ skills: [{ name: 's', path: 's', description: null, files: [{ path: 's/A', bytes: 1 }, { path: 's/A', bytes: 1 }], filesTruncated: false }] }), // duplicate
    show({ skills: [{ name: 's', path: 's', description: null, files: [{ path: 's/a', bytes: 1 }], filesTruncated: 'no' }] }),
    show({ problems: [{ code: 'has space', message: 'm', path: null }] }),
    show({ kind: 'member', repoKey: null }),
    show({ inject: { path: 'a', bytes: 1, text: null, binary: true, truncated: true } }), // binary is never truncated
    show({ skills: [{ name: 's', path: 'skills/s', description: null, files: [{ path: 'skills/other/SKILL.md', bytes: 1 }], filesTruncated: false }] }), // outside its skill
    show({ skills: [{ name: 's', path: 'skills/s', description: null, files: [{ path: 'SKILL.md', bytes: 1 }], filesTruncated: false }] }), // skill-relative: not the kernel's shape
    null, [], 'x',
  ];
  for (const v of bad) assert.equal(capabilityShowData(v, { name: 'oats.aweb' }), null, JSON.stringify(v)?.slice(0, 120));
});

test('oversize strings and lists refuse', () => {
  const big = 'x'.repeat(FILE_TEXT_MAX_BYTES + 1);
  assert.equal(capabilityShowData(show({ inject: { path: 'a', bytes: 1, text: big, binary: false, truncated: true } })), null);
  // 256 KiB of characters that are 3 bytes each in UTF-8: over budget by bytes.
  assert.equal(capabilityShowData(show({ inject: { path: 'a', bytes: 1, text: '€'.repeat(FILE_TEXT_MAX_BYTES / 2), binary: false, truncated: true } })), null);
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 's', description: 'é'.repeat(600), files: [], filesTruncated: false }] })), null, 'description over 1 KiB');
  const files = Array.from({ length: 201 }, (_, i) => ({ path: `s/f${i}`, bytes: 1 }));
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: 's', description: null, files, filesTruncated: true }] })), null);
  assert.equal(capabilityShowData(show({ problems: Array.from({ length: 65 }, () => ({ code: 'E_X', message: 'm', path: null })) })), null);
});

test('paths: relative POSIX inside the capability only', () => {
  for (const p of ['SKILL.md', 'skills/a/SKILL.md', 'a b/c.md', '.hidden/x']) assert.equal(validRelativePath(p), true, p);
  for (const p of ['', '/etc/passwd', '../x', 'a/../../x', 'a/./b', 'a//b', 'a\\b', 'a/', '-x', 'a\u0000b', 'a\nb', 'x'.repeat(1025)]) assert.equal(validRelativePath(p), false, JSON.stringify(p));
  assert.equal(capabilityShowData(show({ inject: { path: '../outside.md', bytes: 1, text: 'x', binary: false, truncated: false } })), null);
  assert.equal(capabilityShowData(show({ skills: [{ name: 's', path: '/abs', description: null, files: [], filesTruncated: false }] })), null);
  assert.equal(capabilityShowData(show({ problems: [{ code: 'E_X', message: 'm', path: '../x' }] })), null);
});

test('a --file answer decodes only for the path asked', () => {
  const answer = { capabilityShowApi: 1, name: 'oats.aweb', kind: 'package', commit, file: { path: 'skills/oats-aweb/SKILL.md', bytes: 4, text: 'body', binary: false, truncated: false } };
  assert.equal(capabilityFileData(answer, { name: 'oats.aweb', path: 'skills/oats-aweb/SKILL.md' }).file.text, 'body');
  assert.equal(capabilityFileData(answer, { name: 'oats.aweb', path: 'skills/oats-aweb/other.md' }), null);
  assert.equal(capabilityFileData({ ...answer, capabilityShowApi: 3 }, { name: 'oats.aweb' }), null);
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, path: '../x' } }), null);
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, bytes: null } }), null, 'a --file answer always has a size');
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, text: null } }), null, 'text: null on a text file is the inject case only');
  assert.equal(capabilityFileData({ ...answer, file: { ...answer.file, text: null, binary: true } }).file.binary, true);
});

/* ── trigger sources (feature `trigger-sources`) ─────────────────────────── */
// The kernel's recorded answers (test/fixtures/trigger-sources/, envelopes: the answer is `.result`):
// capability-show.json (well formed), capability-show-problems.json (one source with a problem, one well formed,
// and `"Bad Name": 7`, not a source, with two problems) and capability-show-not-object.json (a string, one
// top-level problem).
const recorded = name => JSON.parse(readFileSync(new URL(`./fixtures/trigger-sources/${name}.json`, import.meta.url), 'utf8')).result;
const SELECTOR = { name: 'acme.graph', kind: 'member', repoKey: 'local//fixture/base/remotes/ws.git' };
const DESCRIPTION = 'Ready harvest branches, one event per judged head';
const twice = v => capabilityShowData(JSON.parse(JSON.stringify(capabilityShowData(v, { selector: SELECTOR }))), { selector: SELECTOR });

test('trigger sources: the well-formed fixture keeps each source\'s events and description, nothing else of it', () => {
  const data = capabilityShowData(recorded('capability-show'), { selector: SELECTOR });
  assert.deepEqual(data.triggerSources, { 'harvest-branches': { events: ['opened', 'updated'], description: DESCRIPTION } });
  assert.equal(Object.hasOwn(data, 'triggerSourceProblems'), false, 'no problems key when the kernel sent none');
  assert.doesNotMatch(JSON.stringify(data), /review-source|parameters|fields|urlHosts|graph\.example\.org/, 'command, parameters, fields and urlHosts are not relayed');
  assert.deepEqual(data.problems, []);
  assert.deepEqual(triggerSourcesView(data), { sources: [{ name: 'harvest-branches', events: ['opened', 'updated'], description: DESCRIPTION, problems: [] }] });
});

test('trigger sources: the problems fixture keeps the kernel\'s messages beside the sources, never in `problems`', () => {
  const raw = recorded('capability-show-problems'), data = capabilityShowData(raw, { selector: SELECTOR });
  assert.deepEqual(data.triggerSources, { 'harvest-branches': { events: ['opened', 'updated'], description: DESCRIPTION },
    good: { events: ['opened', 'updated'], description: DESCRIPTION }, 'Bad Name': null });
  assert.deepEqual(Object.keys(data.triggerSources), ['harvest-branches', 'good', 'Bad Name'], 'the kernel\'s order');
  assert.deepEqual(data.triggerSourceProblems, raw.triggerSourceProblems, 'source, pointer and message, verbatim');
  assert.deepEqual(data.problems, [], 'the capability did not fail');
  const view = triggerSourcesView(data);
  assert.deepEqual(view.sources.map(s => [s.name, s.events, s.problems.length]), [['harvest-branches', ['opened', 'updated'], 1], ['good', ['opened', 'updated'], 0], ['Bad Name', null, 2]]);
  assert.equal(view.sources[0].problems[0], raw.triggerSourceProblems[0].message);
});

test('trigger sources: the not-an-object fixture is declared but not readable; the raw value is not relayed', () => {
  const raw = recorded('capability-show-not-object'), data = capabilityShowData(raw, { selector: SELECTOR });
  assert.equal(data.triggerSources, null);
  assert.doesNotMatch(JSON.stringify(data), /script/);
  assert.deepEqual(data.triggerSourceProblems, [{ source: null, pointer: '/triggerSources', message: 'triggerSources must be an object of named trigger sources' }]);
  assert.deepEqual(triggerSourcesView(data), { unreadable: ['triggerSources must be an object of named trigger sources'] });
  for (const value of ['x', 7, [], null, true]) assert.equal(triggerSourcesOf(value), null, JSON.stringify(value));
});

test('trigger sources: the projection is idempotent (the server\'s is relayed and projected again)', () => {
  for (const name of ['capability-show', 'capability-show-problems', 'capability-show-not-object']) {
    const once = capabilityShowData(recorded(name), { selector: SELECTOR });
    assert.deepEqual(twice(recorded(name)), once, name);
    assert.deepEqual(JSON.parse(JSON.stringify(triggerSourcesView(twice(recorded(name))))), JSON.parse(JSON.stringify(triggerSourcesView(once))), name);
  }
  const odd = { ...recorded('capability-show'), triggerSources: { 2: { events: ['a'] }, b: 'x', 1: { events: [7, 'e'], description: 9 }, ['n'.repeat(200)]: { events: [] } },
    triggerSourceProblems: [{ source: 7, pointer: 9, message: 'm' }, 'x', { source: 'b', message: 4 }] };
  assert.deepEqual(twice(odd), capabilityShowData(odd, { selector: SELECTOR }));
});

test('trigger sources: an answer without the keys has none, exactly as before', () => {
  const { triggerSources: _t, ...older } = recorded('capability-show');
  const data = capabilityShowData(older, { selector: SELECTOR });
  assert.equal(Object.hasOwn(data, 'triggerSources'), false);
  assert.equal(Object.hasOwn(data, 'triggerSourceProblems'), false);
  assert.deepEqual(Object.keys(data), ['capabilityShowApi', 'name', 'kind', 'repoKey', 'package', 'version', 'commit', 'path', 'inject', 'skills', 'problems', 'warnings']);
  assert.equal(triggerSourcesView(data), null);
  assert.deepEqual(Object.keys(capabilityShowData(show(), { name: 'oats.aweb' })), Object.keys(data));
  // Problems without a declaration (the kernel never sends that): kept as sent, nothing is shown.
  assert.equal(triggerSourcesView(capabilityShowData({ ...older, triggerSourceProblems: [{ source: null, pointer: null, message: 'm' }] }, { selector: SELECTOR })), null);
});

test('trigger sources: bounds on sources, names, events, descriptions and problems', () => {
  const long = 'x'.repeat(5000);
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`s${String(i).padStart(2, '0')}`, { command: 'c', events: ['e'] }]));
  assert.deepEqual(Object.keys(triggerSourcesOf(many)), Object.keys(many).slice(0, 16), 'the first 16, in the kernel\'s order');
  assert.equal(LIMITS.sources, 16);
  const one = triggerSourcesOf({ [long]: { events: [...Array.from({ length: 20 }, (_, i) => `e${i}`), long], description: long } });
  const [[name, source]] = Object.entries(one);
  assert.equal(name.length, 128); assert.equal(source.events.length, 16); assert.equal(source.description.length, 1024);
  assert.equal(triggerSourcesOf({ a: { events: [long] } }).a.events[0].length, 64);
  assert.deepEqual(triggerSourcesOf({ a: { events: ['e', 7, null, { x: 1 }, 'f'], description: 7 } }), { a: { events: ['e', 'f'] } }, 'only strings; a description only when it is one');
  for (const value of [7, 'x', null, [], { events: 'opened' }, { command: 'c' }]) assert.deepEqual(triggerSourcesOf({ a: value }), { a: null }, JSON.stringify(value));
  // A cut never splits a surrogate pair.
  assert.equal(Object.keys(triggerSourcesOf({ [`${'x'.repeat(127)}😀`]: null }))[0], 'x'.repeat(127));
  const problems = triggerSourceProblemsOf(Array.from({ length: 80 }, (_, i) => ({ source: long, pointer: long, message: `${i}${long}` })));
  assert.equal(problems.length, 64);
  assert.deepEqual([problems[0].source.length, problems[0].pointer.length, problems[0].message.length], [128, 1024, 4096]);
  // A problem names its source by the same cut the listing keeps, so the two still meet.
  const cutBoth = triggerSourcesView(capabilityShowData({ ...recorded('capability-show'), triggerSources: { [long]: { events: ['e'] } }, triggerSourceProblems: [{ source: long, pointer: null, message: 'bad' }] }, { selector: SELECTOR }));
  assert.deepEqual(cutBoth.sources.map(s => [s.name.length, s.problems]), [[128, ['bad']]]);
});

test('trigger sources: a manifest key named __proto__ or constructor is an entry like any other', () => {
  const raw = JSON.parse('{"__proto__": {"events": ["opened"], "description": "d"}, "constructor": {"events": ["x"]}, "toString": 7}');
  const out = triggerSourcesOf(raw);
  assert.deepEqual(Object.keys(out), ['__proto__', 'constructor', 'toString']);
  assert.equal(Object.getPrototypeOf(out), Object.prototype, 'the prototype is untouched');
  assert.deepEqual(Object.getOwnPropertyDescriptor(out, '__proto__').value, { events: ['opened'], description: 'd' });
  assert.deepEqual(out.constructor, { events: ['x'] }); assert.equal(out.toString, null);
  assert.equal({}.events, undefined, 'nothing reached Object.prototype');
  // Through the whole decoder, twice (the relay), and into the view.
  const answer = { ...recorded('capability-show'), triggerSources: raw, triggerSourceProblems: [{ source: '__proto__', pointer: '/triggerSources/__proto__', message: 'no' }, { source: 'hasOwnProperty', pointer: null, message: 'ghost' }] };
  const data = twice(answer);
  assert.deepEqual(Object.keys(data.triggerSources), ['__proto__', 'constructor', 'toString']);
  assert.deepEqual(triggerSourcesView(data).sources.map(s => [s.name, s.events, s.problems]),
    [['__proto__', ['opened'], ['no']], ['constructor', ['x'], []], ['toString', null, []], ['hasOwnProperty', null, ['ghost']]]);
});

test('trigger sources: malformed problems never refuse the answer nor reach `problems`', () => {
  const base = recorded('capability-show-problems');
  for (const value of [null, 'x', 7, {}, [null, 'x', 7, [], {}, { source: 'good' }, { source: 'good', message: 7 }]]) {
    const data = capabilityShowData({ ...base, triggerSourceProblems: value }, { selector: SELECTOR });
    assert.ok(data, JSON.stringify(value));
    assert.deepEqual(data.problems, []);
    assert.deepEqual(data.triggerSourceProblems, Array.isArray(value) ? [] : undefined, JSON.stringify(value));
    assert.equal(Object.keys(data.triggerSources).length, 3);
  }
  // A source or pointer that is not text reads as none: `source: null` is a top-level problem.
  assert.deepEqual(triggerSourceProblemsOf([{ source: 7, pointer: {}, message: 'm' }]), [{ source: null, pointer: null, message: 'm' }]);
  // The capability's own problems stay what they were, beside the trigger sources' problems.
  const own = [{ code: 'E_X', message: 'cannot list', path: null }];
  const both = capabilityShowData({ ...base, problems: own }, { selector: SELECTOR });
  assert.deepEqual(both.problems, own); assert.equal(both.triggerSourceProblems.length, 3);
});

test('trigger sources view: a top-level problem makes the whole declaration unreadable; an unlisted source is still shown; at most 16', () => {
  const sources = { a: { events: ['e'] }, b: null };
  assert.deepEqual(triggerSourcesView({ triggerSources: sources, triggerSourceProblems: [{ source: 'a', pointer: null, message: 'one' }, { source: null, pointer: null, message: 'top' }] }), { unreadable: ['top'] });
  assert.deepEqual(triggerSourcesView({ triggerSources: null }), { unreadable: [] });
  assert.deepEqual(triggerSourcesView({ triggerSources: {} }), { sources: [] });
  assert.deepEqual(triggerSourcesView({ triggerSources: sources, triggerSourceProblems: [{ source: 'gone', pointer: null, message: 'g1' }, { source: 'gone', pointer: null, message: 'g2' }] }).sources,
    [{ name: 'a', events: ['e'], description: null, problems: [] }, { name: 'b', events: null, description: null, problems: [] }, { name: 'gone', events: null, description: null, problems: ['g1', 'g2'] }]);
  const full = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`s${i}`, { events: ['e'] }]));
  assert.equal(triggerSourcesView({ triggerSources: full, triggerSourceProblems: [{ source: 'other', pointer: null, message: 'm' }] }).sources.length, 16);
  for (const value of [null, undefined, 'x', [], {}]) assert.equal(triggerSourcesView(value), null);
});
