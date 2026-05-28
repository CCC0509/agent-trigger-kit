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

  return spawnSync('sh', [options.errexit ? '-ec' : '-c', closeoutLadderBlock()], {
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

test('Claude PostToolUse hook dispatches validate exit codes under shell wrapper', () => {
  const settings = readClaudeHookExample();
  const command = settings.hooks.PostToolUse[0].hooks[0].command;

  assert.match(command, /^sh -lc /);
  assert.match(command, /node -e /);
  assert.match(command, /atk_run validate --root "\$ROOT"/);
  assert.match(command, /case "\$rc" in/);
  assert.match(command, /126\).*status=path_non_semver_pin/);
  assert.match(command, /127\).*status=interactive_validate_unverified/);
  assert.match(command, /\*\).*validate FAILED; exit=\$rc/);
  assert.match(command, /ATK_STRICT_VALIDATE="\$\{ATK_STRICT_VALIDATE:-0\}"/);
  assert.doesNotMatch(command, /npx --yes.*validate/);
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
  assertIncludes(codexExample, 'atk_run()');
  assertIncludes(codexExample, 'run_validate()');
  assertIncludes(codexExample, 'interactive_validate_unverified');
  assertIncludes(codexExample, 'case "$rc" in');
  const helperFence =
    /- Define this interactive local-first helper[\s\S]*?:\n\n {2}```sh\n([\s\S]*?)\n {2}```/.exec(
      codexExample,
    );
  assert.ok(helperFence, 'expected Codex helper to be rendered as a nested shell fence');
  const helperBlock = helperFence[1].replace(/^ {2}/gm, '');
  assert.match(helperBlock, /^atk_run\(\) \{$/m);
  assert.doesNotMatch(helperBlock, /^if \[ -x "\$LOCAL_ATK"/m);
  for (const line of helperBlock.split('\n')) {
    const indent = /^ */.exec(line)[0].length;
    assert.ok(indent <= 4, `helper line is over-indented: ${line}`);
  }
  assert.doesNotMatch(
    codexExample,
    /At session start:\s+`npx --yes "\$KIT_SPEC" session-check --root \.`/,
  );
  assert.doesNotMatch(
    codexExample,
    /After editing[\s\S]{0,120}`npx --yes "\$KIT_SPEC" validate --root \.`/,
  );
  assert.doesNotMatch(codexExample, /otherwise use the same pinned[\s\S]*KIT_SPEC[\s\S]*fallback/);

  const cursorExample = sectionBetween(
    'For **Cursor**, add `.cursor/rules/agent-trigger-kit.mdc`',
    'These are best-effort:',
  );
  assertIncludes(
    doc,
    '````\n\nFor **Cursor**, add `.cursor/rules/agent-trigger-kit.mdc`',
    'expected Codex 4-backtick close to be followed by Cursor prose without a stray fence',
  );
  assert.match(
    doc,
    /\n```markdown\n---\ndescription: Agent Trigger Kit checks[\s\S]*?\n```\n\nThese are best-effort/,
    'Cursor rule template must close with a 3-backtick fence',
  );
  assertIncludes(cursorExample, 'atk_run()');
  assertIncludes(cursorExample, 'run_validate()');
  assertIncludes(cursorExample, 'interactive_validate_unverified');
  assertIncludes(cursorExample, 'case "$rc" in');
  assert.doesNotMatch(cursorExample, /npx --yes "\$KIT_SPEC" session-check --root \./);
  assert.doesNotMatch(cursorExample, /npx --yes "\$KIT_SPEC" validate --root \./);
});

test('Claude SessionStart hook runs advisory checks local-first', () => {
  const settings = readClaudeHookExample();
  const command = settings.hooks.SessionStart[0].hooks[0].command;

  assert.match(command, /^sh -lc /);
  assert.match(command, /atk_run\(\)/);
  assert.match(command, /run_advisory session-check session-check --root "\$ROOT"/);
  assert.match(command, /run_advisory pin-check pin-check --no-outcome --root "\$ROOT"/);
  assert.match(command, /status=path_non_semver_pin/);
  assert.match(command, /status=interactive_skipped_local_first/);
  assert.doesNotMatch(command, /npx --yes.*session-check/);
  assert.doesNotMatch(command, /npx --yes.*pin-check/);
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

test('closeout ladder keeps nonzero local reports visible under errexit', (t) => {
  const result = runCloseoutLadder(t, {
    errexit: true,
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
  assert.match(result.stdout, /Session closeout check/);
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

test('closeout ladder falls through when PATH version is unknown under errexit', (t) => {
  const result = runCloseoutLadder(t, {
    errexit: true,
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
