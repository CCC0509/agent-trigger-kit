import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePinFile } from '../scripts/lib/pin-check.mjs';

const ACCEPT = [
  ['v0.2.3\n', { type: 'semver_tag', version: '0.2.3' }],
  ['0.2.3', { type: 'semver_tag', version: '0.2.3' }],
  ['1a2b3c4', { type: 'non_semver_ref' }],
  ['0123456789abcdef0123456789abcdef01234567', { type: 'non_semver_ref' }],
  ['release/v0.2.3', { type: 'non_semver_ref' }],
  ['main', { type: 'non_semver_ref' }],
  ['v0.2.3\r\n', { type: 'semver_tag', version: '0.2.3' }], // CRLF tolerated
];

const REJECT = [
  '',
  '\nmain\n',
  'main\n\n',
  'v0.2.3\nv0.2.4\n',
  'v0.2.3 # comment',
  '../main',
  '/main',
  'main/',
  'feature..branch',
  '@{upstream}',
  '-main',
  'refs/heads/main.lock',
  'main:prod',
  'main;prod',
  'main~prod',
  'main^prod',
  'main=prod',
];

test('parsePinFile accepts valid refs', () => {
  for (const [input, expected] of ACCEPT) {
    const result = parsePinFile(input);
    assert.equal(result.ok, true, `expected accept: ${JSON.stringify(input)}`);
    assert.equal(result.type, expected.type);
    if (expected.version) assert.equal(result.version, expected.version);
  }
});

test('parsePinFile rejects unsafe or malformed refs', () => {
  for (const input of REJECT) {
    const result = parsePinFile(input);
    assert.equal(result.ok, false, `expected reject: ${JSON.stringify(input)}`);
    assert.equal(result.code, 'invalid_pin');
    assert.equal(typeof result.message, 'string');
  }
});
