import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  OutcomeRecorderError,
  buildOutcomeReport,
  markOutcomeEvent,
  outcomeStorePath,
  recordOutcomeEvent,
} from '../scripts/lib/outcome-recorder.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot(prefix = 'agent-trigger-kit-outcome-root-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-outcome-home-'));
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function projectHash(root) {
  return createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 12);
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'cli.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function runScript(scriptName, args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function runGit(root, args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function writeJson(root, path, value) {
  write(root, path, JSON.stringify(value, null, 2));
}

function writeCodexCache(root, marketplaceName, pluginName, version) {
  write(
    root,
    `.codex/plugins/cache/${marketplaceName}/${pluginName}/${version}/skills/demo/SKILL.md`,
    `
---
name: demo
---

# Demo
`,
  );
}

function writeLiveMatrix(root, text) {
  write(root, '.agent-trigger-kit/live-surfaces.yaml', text);
}

function createVersionedPlugin(root, version = '0.2.3') {
  const pluginName = 'demo-ops';
  const pluginDir = `plugins/${pluginName}`;
  writeJson(root, 'package.json', {
    name: pluginName,
    version,
    type: 'module',
  });
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: { source: 'local', path: `./${pluginDir}` },
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: `./${pluginDir}`,
      },
    ],
  });
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version,
  });
  writeJson(root, `${pluginDir}/.claude-plugin/plugin.json`, {
    name: pluginName,
    version,
  });
  return { pluginDir, pluginName, version };
}

function initGitFixture(root) {
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Agent Trigger Kit Tests'],
    ['config', 'user.email', 'agent-trigger-kit-tests@example.com'],
  ]) {
    const result = runGit(root, args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
}

function commitAll(root, message) {
  let result = runGit(root, ['add', '.']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runGit(root, ['commit', '-m', message]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runGit(root, ['rev-parse', 'HEAD']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function createPremergeFixture(root, version = '0.1.0') {
  createVersionedPlugin(root, version);
  writeJson(root, 'package-lock.json', {
    name: 'demo-ops',
    version,
    lockfileVersion: 3,
    packages: {
      '': { name: 'demo-ops', version },
    },
  });
  write(root, 'CHANGELOG.md', `# Changelog\n\n## ${version}\n\n- Fixture.`);
}

test('outcome recorder appends valid user-level event records', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const startedAt = new Date('2026-05-23T08:00:00.000Z');

  const { record, storePath } = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    operationKind: 'manual',
    outcome: 'fail',
    failureCategory: 'surface_drift',
    failureDriver: 'propagation',
    durationMs: 17,
    now: startedAt,
  });

  assert.match(
    record.eventId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.equal(storePath, outcomeStorePath({ root, homeDir }).eventsPath);
  assert.deepEqual(readJsonl(storePath), [
    {
      schemaVersion: 1,
      recordType: 'event',
      eventId: record.eventId,
      recordedAt: '2026-05-23T08:00:00.000Z',
      projectHash: projectHash(root),
      plugin: 'demo-ops',
      surface: 'repo',
      operationKind: 'manual',
      durationMs: 17,
      failureCategory: 'surface_drift',
      failureDriver: 'propagation',
      outcome: 'fail',
    },
  ]);
});

test('outcome recorder supports project-local storage and rejects oversized records', () => {
  const root = makeRoot();

  const { storePath } = recordOutcomeEvent({
    root,
    store: 'project',
    plugin: 'demo-ops',
    surface: 'repo',
    operationKind: 'manual',
    outcome: 'ok',
    failureCategory: 'unknown',
    failureDriver: 'other',
    durationMs: 0,
    now: new Date('2026-05-23T08:01:00.000Z'),
  });

  assert.equal(storePath, join(realpathSync(root), '.agent-trigger-kit/outcomes/events.jsonl'));
  assert.equal(
    readFileSync(join(root, '.agent-trigger-kit/outcomes/.gitignore'), 'utf8'),
    '*\n!.gitignore\n',
  );

  assert.throws(
    () =>
      recordOutcomeEvent({
        root,
        store: 'project',
        plugin: 'x'.repeat(1200),
        surface: 'repo',
        operationKind: 'manual',
        outcome: 'unknown',
        failureCategory: 'unknown',
        failureDriver: 'other',
        durationMs: 0,
      }),
    /exceeds 1024 bytes/,
  );
});

test('outcome recorder marks existing events and reports marked failure drivers', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const first = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'codex',
    operationKind: 'live_check',
    outcome: 'fail',
    failureCategory: 'cache_stale',
    failureDriver: 'propagation',
    durationMs: 4,
    now: new Date('2026-05-23T08:02:00.000Z'),
  }).record;
  const second = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    operationKind: 'static_check',
    outcome: 'ok',
    failureCategory: 'unknown',
    failureDriver: 'other',
    durationMs: 2,
    now: new Date('2026-05-23T08:03:00.000Z'),
  }).record;

  markOutcomeEvent({
    root,
    homeDir,
    eventId: first.eventId,
    result: 'failed',
    failureCategory: 'cache_stale',
    failureDriver: 'propagation',
    reason: 'cache stale after release',
    now: new Date('2026-05-23T08:04:00.000Z'),
  });
  markOutcomeEvent({
    root,
    homeDir,
    eventId: second.eventId,
    result: 'success',
    now: new Date('2026-05-23T08:05:00.000Z'),
  });

  const report = buildOutcomeReport({
    root,
    homeDir,
    windowDays: 60,
    now: new Date('2026-05-24T08:00:00.000Z'),
  });

  assert.equal(report.totalEvents, 2);
  assert.equal(report.totalMarks, 2);
  assert.deepEqual(report.byFailureDriver, { propagation: 1 });
  assert.deepEqual(report.byPlugin, { 'demo-ops': 2 });
  assert.deepEqual(report.byOutcome, { fail: 1, ok: 1 });

  assert.throws(
    () =>
      markOutcomeEvent({
        root,
        homeDir,
        eventId: '018f1d2e-0000-7000-8000-000000000000',
        result: 'success',
      }),
    (error) =>
      error instanceof OutcomeRecorderError &&
      error.exitCode === 4 &&
      /not found/.test(error.message),
  );
});

test('agent-trigger-kit outcome CLI records, reports, and validates mark combinations', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const env = { ...process.env, HOME: homeDir, AGENT_TRIGGER_KIT_OUTCOME_DISABLED: '1' };

  const record = runCli(
    [
      'outcome',
      'record',
      '--root',
      root,
      '--plugin',
      'demo-ops',
      '--surface',
      'repo',
      '--operation-kind',
      'manual',
      '--outcome',
      'unknown',
    ],
    { env },
  );
  assert.equal(record.status, 0, record.stderr || record.stdout);
  const eventId = record.stdout.match(/[0-9a-f-]{36}/)?.[0];
  assert.ok(eventId);

  const invalidSuccess = runCli(
    [
      'outcome',
      'mark',
      '--root',
      root,
      eventId,
      '--result',
      'success',
      '--failure-category',
      'surface_drift',
      '--failure-driver',
      'propagation',
    ],
    { env },
  );
  assert.equal(invalidSuccess.status, 2);
  assert.match(invalidSuccess.stderr, /success marks must not include failure fields/);

  const missing = runCli(
    [
      'outcome',
      'mark',
      '--root',
      root,
      '018f1d2e-0000-7000-8000-000000000000',
      '--result',
      'success',
    ],
    { env },
  );
  assert.equal(missing.status, 4);
  assert.match(missing.stderr, /may have expired under the retention policy/);

  const report = runCli(['outcome', 'report', '--root', root, '--json'], { env });
  assert.equal(report.status, 0, report.stderr || report.stdout);
  const payload = JSON.parse(report.stdout);
  assert.equal(payload.totalEvents, 1);
  assert.deepEqual(payload.byPlugin, { 'demo-ops': 1 });
  assert.deepEqual(payload.byOutcome, { unknown: 1 });
  assert.equal(existsSync(outcomeStorePath({ root, homeDir }).eventsPath), true);
});

test('validate auto-emits one ok event and honors --no-outcome', () => {
  const homeDir = makeHome();
  const env = { ...process.env, HOME: homeDir };

  const result = runScript('validate-trigger-layer.mjs', ['--root', repoRoot], { env });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const records = readJsonl(outcomeStorePath({ root: repoRoot, homeDir }).eventsPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].recordType, 'event');
  assert.equal(records[0].plugin, 'agent-trigger-kit');
  assert.equal(records[0].surface, 'repo');
  assert.equal(records[0].operationKind, 'static_check');
  assert.equal(records[0].outcome, 'ok');

  const disabledHome = makeHome();
  const disabled = runScript('validate-trigger-layer.mjs', ['--root', repoRoot, '--no-outcome'], {
    env: { ...process.env, HOME: disabledHome },
  });
  assert.equal(disabled.status, 0, disabled.stderr || disabled.stdout);
  assert.equal(
    existsSync(outcomeStorePath({ root: repoRoot, homeDir: disabledHome }).eventsPath),
    false,
  );
});

test('live-check auto-emits one event per selected row with shared correlation id', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  createVersionedPlugin(root, '0.1.0');
  writeCodexCache(root, 'demo-ops', 'demo-ops', '0.1.0');
  write(root, 'codex-config.toml', '[plugins."demo-ops"]\n');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-cache-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
      codexHome: \${ROOT}/.codex
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
  - id: codex-config-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: negative-config-assertion
    sourceTruth: config
    liveVerifier:
      kind: codex-config-absence
      configPath: \${ROOT}/codex-config.toml
      forbiddenPluginIds:
        - demo-ops
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json'], {
    env: { ...process.env, HOME: homeDir },
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const records = readJsonl(outcomeStorePath({ root, homeDir }).eventsPath);
  assert.equal(records.length, 2);
  assert.equal(records[0].correlationId, records[1].correlationId);
  assert.ok(records[0].correlationId);
  assert.deepEqual(
    records.map((record) => [
      record.plugin,
      record.surface,
      record.operationKind,
      record.outcome,
      record.failureCategory,
      record.failureDriver,
    ]),
    [
      ['demo-ops', 'codex', 'live_check', 'ok', 'unknown', 'other'],
      ['demo-ops', 'codex', 'live_check', 'fail', 'surface_residue', 'propagation'],
    ],
  );
});

test('premerge and scratch namespace checks auto-emit command-level events', () => {
  const premergeRoot = makeRoot();
  const premergeHome = makeHome();
  initGitFixture(premergeRoot);
  createPremergeFixture(premergeRoot, '0.1.0');
  const base = commitAll(premergeRoot, 'base fixture');

  const premerge = runScript(
    'premerge-version-check.mjs',
    ['--root', premergeRoot, '--base', base, '--plugin', 'demo-ops', '--json'],
    { env: { ...process.env, HOME: premergeHome } },
  );

  assert.equal(premerge.status, 0, premerge.stderr || premerge.stdout);
  const premergeRecords = readJsonl(
    outcomeStorePath({ root: premergeRoot, homeDir: premergeHome }).eventsPath,
  );
  assert.equal(premergeRecords.length, 1);
  assert.equal(premergeRecords[0].operationKind, 'mutation');
  assert.equal(premergeRecords[0].outcome, 'ok');

  const scratchRoot = makeRoot();
  const scratchHome = makeHome();
  initGitFixture(scratchRoot);
  const scratch = runScript('check-scratch-namespace.mjs', ['--root', scratchRoot], {
    env: { ...process.env, HOME: scratchHome },
  });

  assert.equal(scratch.status, 0, scratch.stderr || scratch.stdout);
  const scratchRecords = readJsonl(
    outcomeStorePath({ root: scratchRoot, homeDir: scratchHome }).eventsPath,
  );
  assert.equal(scratchRecords.length, 1);
  assert.equal(scratchRecords[0].operationKind, 'mutation');
  assert.equal(scratchRecords[0].outcome, 'ok');
});

test('auto-emitter recorder errors never alter check exit codes', () => {
  const root = makeRoot();
  initGitFixture(root);
  const badHome = join(root, 'not-a-directory');
  write(root, 'not-a-directory', 'file blocks outcome home');

  const result = runScript('check-scratch-namespace.mjs', ['--root', root], {
    env: { ...process.env, HOME: badHome },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /outcome recording failed/i);
});
