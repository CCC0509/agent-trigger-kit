import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { outcomeStorePath, recordOutcomeEvent } from '../scripts/lib/outcome-recorder.mjs';
import { runSessionCheck } from '../scripts/session-check.mjs';
import { makeTempDir } from './helpers/tmp.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-session-root-');
}

function makeHome(t) {
  return makeTempDir(t, 'agent-trigger-kit-session-home-');
}

function restoreWritable(path) {
  if (existsSync(path)) {
    chmodSync(path, 0o700);
  }
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function writeJson(root, path, value) {
  write(root, path, JSON.stringify(value, null, 2));
}

function createValidTriggerLayer(root) {
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: 'demo-trigger-kit',
    interface: { displayName: 'Demo Ops Plugins' },
    plugins: [
      {
        name: 'demo-ops',
        version: '0.1.0',
        source: { source: 'local', path: './plugins/demo-ops' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
        description: 'Demo Ops trigger skills',
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: 'demo-trigger-kit',
    owner: { name: 'Demo Ops' },
    metadata: { description: 'Demo Ops trigger skills' },
    plugins: [
      {
        name: 'demo-ops',
        source: './plugins/demo-ops',
        description: 'Demo Ops trigger skills',
        version: '0.1.0',
        author: { name: 'Demo Ops' },
        category: 'workflow',
        strict: false,
      },
    ],
  });
  writeJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json', {
    name: 'demo-ops',
    version: '0.1.0',
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: './skills/',
  });
  writeJson(root, 'plugins/demo-ops/.claude-plugin/plugin.json', {
    name: 'demo-ops',
    version: '0.1.0',
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: ['./skills/'],
    commands: ['./commands/'],
  });
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(
    root,
    'plugins/demo-ops/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  write(
    root,
    'plugins/demo-ops/commands/docs-review.md',
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );
}

function mutateCommandToMissingSkill(root) {
  write(
    root,
    'plugins/demo-ops/commands/docs-review.md',
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:deploy-ops\` skill before acting.
`,
  );
}

function runCli(args, homeDir) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'cli.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, AGENT_TRIGGER_KIT_OUTCOME_DISABLED: '1' },
  });
}

function emitUnmarked(root, homeDir, now = new Date('2026-05-23T10:00:00.000Z')) {
  return recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    failureCategory: 'missing_artifact',
    failureDriver: 'human',
    exitCode: 1,
    durationMs: 1,
    now,
  }).record;
}

test('session-check happy path validates a clean trigger layer and empty writable outcome store', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);

  const result = runCli(['session-check', '--root', root, '--json'], homeDir);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, 'session_check');
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.validation.status, 'passed');
  assert.equal(payload.outcome_store.status, 'ok');
  assert.equal(payload.unmarked_events.count, 0);
});

test('session-check treats absent outcome dir with unwritable ancestor as healthy read-only state', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  chmodSync(homeDir, 0o500);
  t.after(() => restoreWritable(homeDir));

  const result = runCli(['session-check', '--root', root, '--json'], homeDir);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.outcome_store.status, 'ok');
  assert.equal(payload.outcome_store.writable, false);
  assert.equal(payload.outcome_store.writable_reason, 'ancestor not writable');
  assert.equal(payload.unmarked_events.count, 0);
});

test('session-check treats readable read-only outcome dir as healthy with write diagnostics', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  const store = outcomeStorePath({ root, homeDir, store: 'user' });
  mkdirSync(store.dir, { recursive: true });
  chmodSync(store.dir, 0o500);
  t.after(() => restoreWritable(store.dir));

  const result = runCli(['session-check', '--root', root, '--json'], homeDir);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exit_code, 0);
  assert.equal(payload.outcome_store.status, 'ok');
  assert.equal(payload.outcome_store.writable, false);
  assert.equal(payload.outcome_store.writable_reason, 'outcome directory read-only');
});

test('session-check degrades when an existing outcome ancestor cannot be traversed', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  const blockedDir = join(homeDir, '.agent-trigger-kit');
  mkdirSync(blockedDir);
  chmodSync(blockedDir, 0o000);
  t.after(() => restoreWritable(blockedDir));

  const result = runCli(['session-check', '--root', root, '--json'], homeDir);

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exit_code, 3);
  assert.equal(payload.outcome_store.status, 'degraded');
  assert.match(payload.outcome_store.error.code, /EACCES|EPERM/);
});

test('session-check exits 4 and reports one unmarked event since the window', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  emitUnmarked(root, homeDir);

  const result = runCli(
    ['session-check', '--root', root, '--since=2026-05-01T00:00:00.000Z', '--json'],
    homeDir,
  );

  assert.equal(result.status, 4);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exit_code, 4);
  assert.equal(payload.unmarked_events.count, 1);
  assert.equal(payload.report_summary.failure_categories[0].failure_category, 'missing_artifact');
});

test('session-check closeout suggests an executable outcome mark command', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  const event = emitUnmarked(root, homeDir);

  const result = runCli(
    ['session-check', '--root', root, '--closeout', '--since', '2026-05-01T00:00:00.000Z'],
    homeDir,
  );

  assert.equal(result.status, 4);
  assert.match(result.stdout, /Session closeout check/);
  // The suggestion echoes the event's own recorded outcome so a failure event is
  // never silently re-marked as success. emitUnmarked records a failure with a
  // category and driver, so the faithful command carries that classification.
  assert.match(
    result.stdout,
    new RegExp(
      `agent-trigger-kit outcome mark --root ${escapeRegExp(root)} ${event.id} ` +
        `--outcome failure --failure-category missing_artifact --failure-driver human`,
    ),
  );
});

test('session-check closeout suggests a success mark for an unmarked success event', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  const event = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    durationMs: 1,
    now: new Date('2026-05-23T10:00:00.000Z'),
  }).record;

  const result = runCli(
    ['session-check', '--root', root, '--closeout', '--since', '2026-05-01T00:00:00.000Z'],
    homeDir,
  );

  assert.equal(result.status, 4);
  assert.match(
    result.stdout,
    new RegExp(
      `agent-trigger-kit outcome mark --root ${escapeRegExp(root)} ${event.id} --outcome success`,
    ),
  );
  assert.doesNotMatch(result.stdout, /--failure-category/);
});

test('session-check returns validate failure before outcome-state failures', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  mutateCommandToMissingSkill(root);
  emitUnmarked(root, homeDir);

  const result = runCli(
    ['session-check', '--root', root, '--json', '--since', '2026-05-01T00:00:00.000Z'],
    homeDir,
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.exit_code, 1);
  assert.equal(payload.validation.status, 'failed');
  assert.equal(payload.unmarked_events.count, 1);
  assert.match(payload.validation.stderr, /delegates to missing skill demo-ops:deploy-ops/);
});

test('session-check reports degraded outcome store without crashing', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  writeFileSync(join(homeDir, '.agent-trigger-kit'), 'not a directory\n');

  const stdout = [];
  const stderr = [];
  const result = runSessionCheck({
    argv: ['--root', root, '--json'],
    homeDir,
    stdout: { write: (chunk) => stdout.push(chunk) },
    stderr: { write: (chunk) => stderr.push(chunk) },
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.payload.outcome_store.status, 'degraded');
  assert.match(result.payload.outcome_store.error.message, /not a directory|ENOTDIR/);
  assert.doesNotThrow(() => JSON.parse(stdout.join('')));
  assert.equal(stderr.join(''), '');
});

test('session-check degrades when existing events path is not writable as a file', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  const store = outcomeStorePath({ root, homeDir, store: 'user' });
  mkdirSync(store.dir, { recursive: true });
  mkdirSync(store.eventsPath);

  const result = runSessionCheck({
    argv: ['--root', root, '--json'],
    homeDir,
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.payload.outcome_store.status, 'degraded');
  assert.match(result.payload.outcome_store.error.message, /not a file/);
});

test('session-check degrades when the outcome events file is corrupt', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  const store = outcomeStorePath({ root, homeDir, store: 'user' });
  mkdirSync(store.dir, { recursive: true });
  writeFileSync(store.eventsPath, 'not-json\n');

  const result = runSessionCheck({
    argv: ['--root', root, '--json'],
    homeDir,
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  });

  assert.equal(result.exitCode, 3);
  assert.equal(result.payload.outcome_store.status, 'degraded');
  assert.match(result.payload.outcome_store.error.message, /invalid JSON/);
});

test('session-check quiet mode suppresses output while preserving exit code', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);
  emitUnmarked(root, homeDir);

  const result = runCli(
    ['session-check', '--root', root, '--quiet', '--since', '2026-05-01T00:00:00.000Z'],
    homeDir,
  );

  assert.equal(result.status, 4);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('session-check JSON exposes stable schema fields for start and closeout modes', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);

  const start = runCli(['session-check', '--root', root, '--json'], homeDir);
  const closeout = runCli(['session-check', '--root', root, '--closeout', '--json'], homeDir);

  assert.equal(start.status, 0);
  assert.equal(closeout.status, 0);
  const startPayload = JSON.parse(start.stdout);
  const closeoutPayload = JSON.parse(closeout.stdout);
  assert.deepEqual(Object.keys(startPayload), [
    'schema_version',
    'kind',
    'generated_at',
    'root',
    'mode',
    'since',
    'exit_code',
    'validation',
    'outcome_store',
    'unmarked_events',
    'report_summary',
    'next_actions',
  ]);
  assert.equal(startPayload.schema_version, '0.2');
  assert.equal(startPayload.mode, 'start');
  assert.equal(closeoutPayload.mode, 'closeout');
  assert.deepEqual(Object.keys(startPayload.outcome_store), [
    'status',
    'store',
    'project_hash',
    'dir',
    'events_path',
    'writable',
    'writable_reason',
    'error',
  ]);
  assert.equal(typeof startPayload.outcome_store.writable, 'boolean');
  assert.equal(startPayload.outcome_store.writable_reason, null);
});

test('session-check rejects invalid since windows and unknown flags as usage errors', (t) => {
  const root = makeRoot(t);
  const homeDir = makeHome(t);
  createValidTriggerLayer(root);

  const invalidSince = runCli(
    ['session-check', '--root', root, '--since', 'nope', '--json'],
    homeDir,
  );
  const unknown = runCli(['session-check', '--root', root, '--wat'], homeDir);

  assert.equal(invalidSince.status, 2);
  assert.equal(invalidSince.stderr, '');
  const payload = JSON.parse(invalidSince.stdout);
  assert.equal(payload.exit_code, 2);
  assert.match(payload.outcome_store.error.message, /invalid --since/);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown option: --wat/);
});

test('session-check help exits successfully with usage text', (t) => {
  const homeDir = makeHome(t);

  const result = runCli(['session-check', '--help'], homeDir);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: agent-trigger-kit session-check/);
  assert.equal(result.stderr, '');
});
