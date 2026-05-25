import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPin,
  compareSemver,
  latestSemverTag,
  parsePinFile,
  parseRemoteTags,
} from '../scripts/lib/pin-check.mjs';

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

const LS_REMOTE = [
  '1111111111111111111111111111111111111111\trefs/tags/v0.2.3',
  '2222222222222222222222222222222222222222\trefs/tags/v0.2.3^{}',
  '3333333333333333333333333333333333333333\trefs/tags/v0.2.10',
  '4444444444444444444444444444444444444444\trefs/tags/v0.3.0-rc1',
  '5555555555555555555555555555555555555555\trefs/tags/not-a-version',
].join('\n');

test('parseRemoteTags normalizes derefs, dedups, drops non-semver', () => {
  const tags = parseRemoteTags(LS_REMOTE);
  assert.deepEqual(
    tags.map((t) => t.tag),
    ['v0.2.3', 'v0.2.10'],
  );
});

test('compareSemver orders numerically, not lexically', () => {
  assert.equal(compareSemver('0.2.3', '0.2.10'), -1);
  assert.equal(compareSemver('0.2.10', '0.2.3'), 1);
  assert.equal(compareSemver('0.2.3', '0.2.3'), 0);
});

test('latestSemverTag picks the highest by semver', () => {
  const tags = parseRemoteTags(LS_REMOTE);
  assert.deepEqual(latestSemverTag(tags), { tag: 'v0.2.10', version: '0.2.10' });
});

test('latestSemverTag returns null when no semver tags', () => {
  assert.equal(latestSemverTag([]), null);
});

const latest = { tag: 'v0.2.4', version: '0.2.4' };

test('classifyPin maps every status', () => {
  assert.equal(classifyPin({ pinResult: { missing: true }, latest }).status, 'missing_pin');
  assert.equal(
    classifyPin({ pinResult: { ok: false, code: 'invalid_pin', message: 'x' }, latest }).status,
    'invalid_pin',
  );
  assert.equal(
    classifyPin({ pinResult: { ok: true, type: 'non_semver_ref', ref: 'main' }, latest }).status,
    'non_semver_ref',
  );
  assert.equal(classifyPin({ pinResult: semver('0.2.3'), latest: null }).status, 'degraded');
  assert.equal(classifyPin({ pinResult: semver('0.2.4'), latest }).status, 'current');
  assert.equal(classifyPin({ pinResult: semver('0.2.3'), latest }).status, 'behind');
  assert.equal(classifyPin({ pinResult: semver('0.2.5'), latest }).status, 'ahead');
});

function semver(version) {
  return { ok: true, type: 'semver_tag', ref: `v${version}`, version };
}
