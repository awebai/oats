import test from 'node:test';
import assert from 'node:assert/strict';
import { editCodexTrust } from '../lib/harness-trust-toml.mjs';
test('Codex preserves bytes in table, dotted and inline forms', () => {
  for (const text of ['[projects."/r"]\ntrust_level = "untrusted" # stay\n', 'projects."/r".trust_level = \'untrusted\'\r\n', '[projects]\n"/r" = { trust_level = "untrusted" }\n']) {
    const result = editCodexTrust(text, '/r');
    assert.equal(result.current, 'untrusted');
    assert.equal(result.text, text.replace(/"untrusted"|'untrusted'/, '"trusted"'));
    assert.equal(editCodexTrust(result.text, '/r').text, result.text);
  }
});
test('Codex inserts missing leaf/ancestors with unrelated settings intact', () => {
  for (const text of ['', 'model = "sentinel"\n', '[projects."/r"]\nother = 9007199254740993\n[next]\nx = true\n', '[projects]\n"/r" = {}\n', 'projects."/r".other = 1\n', '[projects]\n"/r".other = 1\n', '# [comment]\nprojects."/r".other=1\n[next]\nx=true\n']) {
    const result = editCodexTrust(text, '/r');
    assert.equal(result.current, null); assert.equal(editCodexTrust(result.text, '/r').current, 'trusted');
  }
});
test('Codex refuses conflicting, duplicate, unsupported or malformed forms', () => {
  for (const text of ['[projects."/r"]\ntrust_level=1', '[projects."/r"]\ntrust_level="unknown"', 'x=1\nx=2', '[x]\na=1\n[x]\nb=2', 'projects="bad"', 'projects."/r"=1', 'x=[1,,2]', 'x={a=1,}', 'x="""multiline"""', 'projects={}', '[projects]\n"/r"={other=1}', 'x=01', 'x=9223372036854775808', '[[unknown]]\nx=1']) assert.throws(() => editCodexTrust(text, '/r'), /unsupported or invalid/);
});

test('TOML rejects JSON-only escapes, lone surrogates and forbidden comment controls', () => {
 for (const source of ['x = "a\\/b"\n', 'x = "\\ud800"\n', '# hidden\x01\n', 'x = 9223372036854775808\n']) assert.throws(() => editCodexTrust(source, '/root'));
});

test('TOML refuses dotted redefinition of an explicit table and surrogate-pair escapes', () => {
 for(const source of ['[a.b]\nx=1\n[a]\nb.c=1\n', 'x="\\ud83d\\ude00"\n']) assert.throws(()=>editCodexTrust(source,'/r'));
});
