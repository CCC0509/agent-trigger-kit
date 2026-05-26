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

function stopHookCommand(settings) {
  return settings.hooks.Stop[0].hooks[0].command;
}

function sectionBetween(startHeading, endHeading) {
  const start = doc.indexOf(startHeading);
  assert.notEqual(start, -1, `expected ${startHeading} section`);
  const end = doc.indexOf(endHeading, start);
  assert.notEqual(end, -1, `expected ${endHeading} after ${startHeading}`);
  return doc.slice(start, end);
}

function assertIncludes(haystack, needle, label = needle) {
  assert.ok(haystack.includes(needle), `expected ${label}`);
}

function assertOrdered(text, fragments, label) {
  let previous = -1;
  for (const fragment of fragments) {
    const current = text.indexOf(fragment);
    assert.notEqual(current, -1, `${label}: expected ${fragment}`);
    assert.ok(current > previous, `${label}: expected ${fragment} after previous fragment`);
    previous = current;
  }
}

function assertEmbeddedTierOrder(command, fragments) {
  const positions = fragments.map((fragment) => command.indexOf(fragment));
  if (!positions.every((position) => position !== -1)) return;

  assertOrdered(command, fragments, 'embedded Stop hook tier order');
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

test('embedded Stop hook tier order check only applies when all tiers are present', () => {
  const fragments = ['tier1', 'tier2', 'tier3'];

  assert.doesNotThrow(() => assertEmbeddedTierOrder('tier2 tier3', fragments));
  assert.throws(
    () => assertEmbeddedTierOrder('tier2 tier1 tier3', fragments),
    /embedded Stop hook tier order/,
  );
});

test('harness doc documents closeout invocation policy and ladder', () => {
  const settings = readClaudeHookExample();
  const command = stopHookCommand(settings);
  const policy = sectionBetween('### Closeout invocation policy', '### Where pin-check runs');
  // End anchor is the fenced AGENTS.md example heading, not a real document section.
  const codexCursor = sectionBetween(
    '## Codex and Cursor (instruction-based)',
    '## Agent Trigger Kit checks',
  );
  const tierFragments = [
    'node scripts/cli.mjs session-check --closeout',
    'npx --no-install agent-trigger-kit session-check --closeout',
    'npx --yes "$KIT_SPEC" session-check --closeout',
  ];

  for (const fragment of tierFragments) {
    assertIncludes(policy, fragment);
  }

  assertOrdered(policy, tierFragments, 'closeout policy tier order');
  // Compact Stop hooks embed only Tier 3. If a future hook carries all tiers,
  // require the full embedded ladder in the documented order.
  assertEmbeddedTierOrder(command, tierFragments);

  assertIncludes(policy, 'Session closeout check');
  assertIncludes(policy, '"kind": "session_check"');
  assertIncludes(policy, '"mode": "closeout"');
  assertIncludes(policy, 'ambiguous no-report failures default to invocation_error');
  assertIncludes(policy, 'blocked_by_policy');
  assertIncludes(policy, 'not_installed');
  assertIncludes(policy, 'skipped_missing_pin');
  assertIncludes(policy, 'CLAUDE_PROJECT_DIR');

  assert.match(codexCursor, /closeout invocation policy/i);
  assertIncludes(codexCursor, 'Session closeout check');
  assertIncludes(codexCursor, 'invocation_error');
});
