import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { makeTempDir } from './helpers/tmp.mjs';

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

function closeoutLadderBlock() {
  const section = sectionBetween('<!-- closeout-ladder:start -->', '<!-- closeout-ladder:end -->');
  const match = /```sh\n([\s\S]*?)\n```/.exec(section);
  assert.ok(match, 'expected marked closeout ladder shell block');
  return match[1];
}

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function toolPath() {
  return ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
}

function runCloseoutLadder(t, options = {}) {
  const root = makeTempDir(t, 'agent-trigger-kit-closeout-ladder-');
  const fakeBin = join(root, 'fake-bin');
  mkdirSync(fakeBin, { recursive: true });

  if (options.pin !== false) {
    mkdirSync(join(root, '.agent-trigger-kit'), { recursive: true });
    writeFileSync(join(root, '.agent-trigger-kit', 'pin'), `${options.pin || 'v0.2.9'}\n`);
  }

  if (options.localScript) {
    const localBin = join(root, 'node_modules', '.bin');
    mkdirSync(localBin, { recursive: true });
    writeExecutable(join(localBin, 'agent-trigger-kit'), options.localScript);
  }

  if (options.pathScript) {
    writeExecutable(join(fakeBin, 'agent-trigger-kit'), options.pathScript);
  }

  writeExecutable(
    join(fakeBin, 'npx'),
    options.npxScript ||
      ['#!/bin/sh', 'echo "npx tier ran"', 'echo "Session closeout check"', 'exit 0', ''].join(
        '\n',
      ),
  );

  return spawnSync('sh', ['-c', closeoutLadderBlock()], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${toolPath()}`,
      ROOT: '.',
      KIT_REPO: 'CCC0509/agent-trigger-kit',
    },
  });
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
  const codexExample = sectionBetween('## Agent Trigger Kit checks', 'For **Cursor**, add');
  const tierFragments = [
    'node scripts/cli.mjs session-check --closeout',
    'node_modules/.bin/agent-trigger-kit',
    'command -v agent-trigger-kit',
    'npx --yes "$KIT_SPEC" session-check --closeout',
  ];

  for (const fragment of tierFragments) {
    assertIncludes(policy, fragment);
  }

  assertOrdered(policy, tierFragments, 'closeout policy tier order');
  // Compact Stop hooks embed only pinned external Tier 4. If a future hook carries all tiers,
  // require the full embedded ladder in the documented order.
  assertEmbeddedTierOrder(command, tierFragments);

  assertIncludes(policy, 'Session closeout check');
  assertIncludes(policy, '"kind": "session_check"');
  assertIncludes(policy, '"mode": "closeout"');
  assertIncludes(policy, 'ambiguous no-report failures default to invocation_error');
  assertIncludes(policy, '[ -x "$LOCAL_ATK" ]');
  assertIncludes(policy, 'agent-trigger-kit local binary missing; status=not_installed');
  assertIncludes(policy, 'blocked_by_policy');
  assertIncludes(policy, 'not_installed');
  assertIncludes(policy, 'skipped_missing_pin');
  assertIncludes(policy, 'CLAUDE_PROJECT_DIR');
  assertIncludes(policy, 'agent-trigger-kit --version');
  assertIncludes(policy, 'path_non_semver_pin');
  assertIncludes(policy, 'path_version_mismatch');
  assertIncludes(policy, 'path_version_unknown');
  assertIncludes(policy, 'realpath_or_same');
  assert.match(policy, /version equality[\s\S]*not proof|not proof[\s\S]*version equality/i);
  assert.match(policy, /opportunistic/i);
  assert.match(policy, /low-integrity/i);

  assert.match(codexCursor, /closeout invocation policy/i);
  assertIncludes(codexCursor, 'Session closeout check');
  assertIncludes(codexCursor, 'invocation_error');
  assertIncludes(codexCursor, 'agent-trigger-kit --version');
  assertIncludes(codexCursor, 'path_non_semver_pin');
  assertIncludes(codexCursor, 'path_version_mismatch');

  assertIncludes(codexExample, 'agent-trigger-kit --version');
  assertIncludes(codexExample, 'path_non_semver_pin');
  assertIncludes(codexExample, 'path_version_mismatch');
  assertIncludes(codexExample, 'PATH/global');
  assertIncludes(codexExample, 'pinned external');
  assert.doesNotMatch(codexExample, /otherwise use the same pinned[\s\S]*KIT_SPEC[\s\S]*fallback/);
});

test('marked closeout ladder shell block is syntactically valid', () => {
  const result = spawnSync('sh', ['-n', '-c', closeoutLadderBlock()], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('closeout ladder stops after local closeout report even when local exits nonzero', (t) => {
  const result = runCloseoutLadder(t, {
    localScript: [
      '#!/bin/sh',
      'echo "Session closeout check"',
      'echo "local tier ran"',
      'exit 4',
      '',
    ].join('\n'),
    pathScript: ['#!/bin/sh', 'echo "path tier should not run"', 'exit 0', ''].join('\n'),
    npxScript: ['#!/bin/sh', 'echo "npx tier should not run"', 'exit 0', ''].join('\n'),
  });

  assert.equal(result.status, 4);
  assert.match(result.stdout, /local tier ran/);
  assert.doesNotMatch(result.stdout, /path tier should not run|npx tier should not run/);
});

test('closeout ladder uses matching PATH binary before pinned external', (t) => {
  const result = runCloseoutLadder(t, {
    pathScript: [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "0.2.9"; exit 0; fi',
      'echo "path tier ran"',
      'echo "Session closeout check"',
      'exit 0',
      '',
    ].join('\n'),
    npxScript: ['#!/bin/sh', 'echo "npx tier should not run"', 'exit 0', ''].join('\n'),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /path tier ran/);
  assert.doesNotMatch(result.stdout, /npx tier should not run/);
});

test('closeout ladder falls through when PATH version is unknown', (t) => {
  const result = runCloseoutLadder(t, {
    pathScript: [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then exit 2; fi',
      'echo "path closeout should not run"',
      'exit 0',
      '',
    ].join('\n'),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=path_version_unknown/);
  assert.doesNotMatch(result.stdout, /path closeout should not run/);
  assert.match(result.stdout, /npx tier ran/);
});

test('closeout ladder falls through when PATH version mismatches pin', (t) => {
  const result = runCloseoutLadder(t, {
    pathScript: [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "0.2.8"; exit 0; fi',
      'echo "path closeout should not run"',
      'exit 0',
      '',
    ].join('\n'),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=path_version_mismatch/);
  assert.doesNotMatch(result.stdout, /path closeout should not run/);
  assert.match(result.stdout, /npx tier ran/);
});

test('closeout ladder skips PATH gate for non-semver pins', (t) => {
  const result = runCloseoutLadder(t, {
    pin: 'main',
    pathScript: [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "0.2.9"; exit 0; fi',
      'echo "path closeout should not run"',
      'exit 0',
      '',
    ].join('\n'),
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /status=path_non_semver_pin/);
  assert.doesNotMatch(result.stdout, /path closeout should not run/);
  assert.match(result.stdout, /npx tier ran/);
});
