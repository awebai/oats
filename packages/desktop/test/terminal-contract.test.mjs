import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terminalFailure, terminalMessage } from '../renderer/terminal-contract.mjs';

test('the remote transport and gone codes are contract codes, not folded into E_TERM_OPEN_FAILED', () => {
  assert.equal(terminalFailure('E_TERM_REMOTE_UNREACHABLE').code, 'E_TERM_REMOTE_UNREACHABLE');
  assert.equal(terminalFailure('E_TERM_REMOTE_GONE').code, 'E_TERM_REMOTE_GONE');
  assert.equal(terminalFailure('E_TERM_REMOTE_NO_ANSWER').code, 'E_TERM_REMOTE_NO_ANSWER');
  assert.equal(terminalFailure('E_SERVER_UNKNOWN').code, 'E_TERM_OPEN_FAILED', 'a host code outside the contract stays a static open failure');
});

test('the remote messages name the server; every other message is the static one', () => {
  assert.equal(terminalMessage('E_TERM_REMOTE_UNREACHABLE', 'build box'), "Couldn't reach build box.");
  assert.equal(terminalMessage('E_TERM_REMOTE_GONE', 'build box'), 'The session is no longer running on build box.');
  assert.equal(terminalMessage('E_TERM_REMOTE_NO_ANSWER', 'build box'), 'OATS on this computer gave no answer while connecting to build box.');
  assert.equal(terminalMessage('E_TERM_CAP', 'build box'), terminalFailure('E_TERM_CAP').message);
  assert.equal(terminalMessage('E_TERM_REMOTE_UNREACHABLE'), terminalFailure('E_TERM_REMOTE_UNREACHABLE').message);
});
