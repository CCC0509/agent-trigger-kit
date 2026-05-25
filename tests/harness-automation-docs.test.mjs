import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const doc = readFileSync(join(repoRoot, 'docs/harness-automation.md'), 'utf8');

test('harness doc documents the pin file and reads it in surfaces', () => {
  assert.match(doc, /\.agent-trigger-kit\/pin/);
  assert.match(doc, /KIT_SPEC="github:CCC0509\/agent-trigger-kit#\$KIT_REF"/);
});

test('harness doc uses current Renovate terminology', () => {
  assert.match(doc, /managerFilePatterns/);
  assert.match(doc, /versioningTemplate/);
  assert.doesNotMatch(doc, /"fileMatch"/);
});

test('harness doc no longer presents bare <tag> as the primary hook path', () => {
  // The pin-read snippet must appear before any remaining <tag> placeholder mention.
  const pinIndex = doc.indexOf('.agent-trigger-kit/pin');
  const tagIndex = doc.indexOf('#<tag>');
  assert.ok(pinIndex !== -1);
  assert.ok(tagIndex === -1 || pinIndex < tagIndex);
});
