import test from 'node:test';
import assert from 'node:assert/strict';
import { editClaudeTrust } from '../lib/harness-trust-json.mjs';
test('Claude edits only missing suffix or boolean token, preserving unrelated bytes', () => {
  const root = '/tmp/"quote\\path/雪';
  for (const prefix of ['{}', '{"projects":{}}', `{"projects":{${JSON.stringify(root)}:{}}}`]) {
    const result = editClaudeTrust(prefix, root);
    assert.equal(JSON.parse(result.text).projects[root].hasTrustDialogAccepted, true);
    assert.equal(result.current, null);
  }
  const before = `{\r\n "sentinel":900719925474099312345, "projects":{${JSON.stringify(root)}:{"history":"secret-sentinel","hasTrustDialogAccepted": false}}\r\n}\r\n`;
  const result = editClaudeTrust(before, root);
  assert.equal(result.text, before.replace(': false', ': true'));
  assert.equal(result.current, false);
  assert.deepEqual(editClaudeTrust(result.text, root), { text: result.text, current: true });
});
test('Claude refuses duplicate keys, malformed JSON and wrong native shapes', () => {
  for (const value of ['[]', 'null', '{"projects":[]}', '{"projects":null}', '{"projects":{"/r":false}}', '{"projects":{"/r":{"hasTrustDialogAccepted":1}}}', '{"x":1,"x":2}', '{"projects":{},"projects":{}}', '{"x":[1,]}', '{"x":01}', '{"x":"bad\\q"}', '{"x":NaN}']) {
    assert.throws(() => editClaudeTrust(value, '/r'), /unsupported or invalid/);
  }
});
