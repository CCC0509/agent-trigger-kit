import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const doc = readFileSync(join(repoRoot, 'docs/harness-automation.md'), 'utf8');

function readClaudeHookExample() {
  const match = /```json\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(match, 'expected a Claude hooks JSON example');
  return JSON.parse(match[1]);
}

function hookCommands(settings) {
  return Object.values(settings.hooks).flatMap((entries) =>
    entries.flatMap((entry) => entry.hooks.map((hook) => hook.command)),
  );
}

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

test('Claude hook example parses and keeps shell commands syntactically valid', () => {
  const settings = readClaudeHookExample();
  for (const command of hookCommands(settings)) {
    const result = spawnSync('sh', ['-n', '-c', command], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('Claude PostToolUse hook reads the pin inside node without a shell wrapper', () => {
  const settings = readClaudeHookExample();
  const command = settings.hooks.PostToolUse[0].hooks[0].command;

  assert.match(command, /^node -e /);
  assert.doesNotMatch(command, /sh -lc/);
  assert.doesNotMatch(command, /tr -d/);
  assert.match(command, /fs\.readFileSync\(pinFile, "utf8"\)\.replace\(\/\\s\+\/g, ""\)/);
  assert.match(command, /"github:CCC0509\/agent-trigger-kit#"\s*\+\s*kitRef/);
});
