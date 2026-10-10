import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { capabilityShowData, capabilityFileData, listedFiles } from '../../client/capability-show-contract.mjs';
import { createCapabilityContents } from '../renderer/capability-contents.mjs';

// Real `oats capabilities show … --max-age 60 --json` answers (main @ 6cd27bf8, captured on a live deployment, 2026-10-01):
// oats.aweb (package, with an inject) and oats.desktop-ui (member, no inject), one --file answer and one refusal.
const capture = name => JSON.parse(readFileSync(new URL(`./fixtures/workspace-v2/capability-show/${name}.json`, import.meta.url), 'utf8'));
const aweb = capture('show-oats-aweb'), ui = capture('show-oats-desktop-ui'), file = capture('file-oats-desktop-ui-skill'), unknown = capture('file-unknown');

test('the captured answers decode against the selector they were asked with', () => {
  const a = capabilityShowData(aweb.result, { selector: { name: 'oats.aweb', kind: 'package', package: 'oats.aweb' } });
  assert.ok(a, 'oats.aweb decodes');
  assert.equal(a.inject.path, 'injects/aweb.md');
  assert.equal(a.skills.length, 4);
  for (const skill of a.skills) assert.ok(skill.files.some(f => f.path === `${skill.path}/SKILL.md`), `${skill.name} lists its SKILL.md under its own directory`);
  const u = capabilityShowData(ui.result, { selector: { name: 'oats.desktop-ui', kind: 'member', repoKey: 'github.com/awebai/oats' } });
  assert.ok(u, 'oats.desktop-ui decodes'); assert.equal(u.inject, null);
  const listed = [...listedFiles(u).keys()];
  const f = capabilityFileData(file.result, { selector: { name: 'oats.desktop-ui', kind: 'member', repoKey: 'github.com/awebai/oats' }, path: file.result.file.path });
  assert.ok(f, 'the --file answer (with its observation block) decodes');
  assert.ok(listed.includes(f.file.path)); assert.equal(f.commit, u.commit, 'the file is read at the show answer\'s commit');
  assert.equal(unknown.ok, false); assert.equal(unknown.error.code, 'E_CAPABILITY_FILE_UNKNOWN');
});

test('the reader shows the captured SKILL.md with its front matter as a table', async t => {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true }), doc = dom.window.document;
  const contents = createCapabilityContents(doc, { request: body => Promise.resolve(structuredClone(body.action === 'show' ? ui.result : file.result)) });
  t.after(() => { contents.dispose(); dom.window.close(); });
  doc.body.append(contents.element);
  contents.update({ row: { name: 'oats.desktop-ui', kind: 'member', repoKey: 'github.com/awebai/oats', commit: ui.result.commit }, cli: { ok: true, features: ['capability-show'], capabilityShowApi: 1 }, deployment: '/ws' });
  for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
  assert.equal(doc.querySelector('.cap-reader-path').textContent, file.result.file.path, 'no inject: the first skill\'s SKILL.md');
  const facts = Object.fromEntries([...doc.querySelectorAll('.cap-fm tr')].map(r => [r.querySelector('th').textContent, r.querySelector('td').textContent]));
  assert.equal(facts.name, 'accessible-desktop-interactions');
  assert.match(facts.description, /^Use when designing or reviewing OATS Desktop/);
  assert.doesNotMatch(doc.querySelector('.cap-reader-body').textContent, /^\s*---/);
  assert.ok(doc.querySelector('.cap-reader-body .mdv h1'));
});
