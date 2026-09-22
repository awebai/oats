import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayProducerEnvelope } from './helpers/spawn-apply-producer.mjs';
const corpus = JSON.parse(readFileSync(new URL('./fixtures/spawn-apply-producer.json', import.meta.url), 'utf8'));
assert.equal(corpus.producerMerge, 'c19b781689c2f3d1a6436c57557f1fa91d084926');
for (const name of Object.keys(corpus.fixtures)) test(`stored apply producer through adapter/broker/view: ${name}`, async () => {
  await replayProducerEnvelope(corpus.fixtures, name);
});
test('concurrent producer outcomes are identified by envelope, never receipt filename', () => {
  const pair = Object.entries(corpus.fixtures).filter(([name]) => name.startsWith('apply-concurrent-'));
  assert.equal(pair.length, 2); assert.equal(pair.filter(([, value]) => value.ok === true).length, 1);
  assert.equal(pair.filter(([, value]) => value.error?.code === 'E_PLACEMENT_TAKEN').length, 1);
});
