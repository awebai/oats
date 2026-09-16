import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBindingInterface } from '../lib/provider-binding.mjs';
import { hasExecutableSurface } from '../lib/capability-execution.mjs';

test('binding phases reuse owned executable commands and introduce no implicit provider', () => {
  assert.equal(validateBindingInterface({capability:'example.tools'}), null);
  const manifest={capability:'example.provider',layer:'tasks',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  assert.equal(validateBindingInterface(manifest),manifest.binding);
  assert.equal(hasExecutableSurface(manifest),true);
});
test('binding declarations refuse missing commands, wrong owner slot, unknown fields and versions', () => {
  const base={layer:'knowledge',commands:{binding:'binding.mjs'},binding:{version:1,normalize:'binding',bind:'binding',check:'binding'}};
  assert.throws(()=>validateBindingInterface({...base,layer:undefined}),{code:'invalid-binding-interface'});
  assert.throws(()=>validateBindingInterface({...base,commands:{}}),{code:'invalid-binding-interface'});
  assert.throws(()=>validateBindingInterface({...base,binding:{...base.binding,version:2}}));
  assert.throws(()=>validateBindingInterface({...base,binding:{...base.binding,script:'unowned.mjs'}}),{code:'invalid-declaration'});
});
