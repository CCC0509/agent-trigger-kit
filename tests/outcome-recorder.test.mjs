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
  markOutcomeEvent,
  mintUuidV7,
  outcomeStorePath,
  readOutcomeRecords,
  recordOutcomeEvent,
} from '../scripts/lib/outcome-recorder.mjs';
import { validateRecord } from '../scripts/lib/outcome-schema.mjs';

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

function uuidTimestampPrefix(date) {
  const hex = BigInt(date.getTime()).toString(16).padStart(12, '0').slice(-12);
  return `${hex.slice(0, 8)}-${hex.slice(8)}`;
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

test('mintUuidV7 creates deterministic UUID v7 values from date and seed', () => {
  const date = new Date('2025-11-15T00:00:00.000Z');
  const first = mintUuidV7(date, 'claude-cache-stale-2025q4');
  const second = mintUuidV7(date, 'claude-cache-stale-2025q4');
  const differentSeed = mintUuidV7(date, 'codex-cache-stale-2025q4');
  const differentDate = mintUuidV7(
    new Date('2025-11-16T00:00:00.000Z'),
    'claude-cache-stale-2025q4',
  );

  assert.equal(first, second);
  assert.notEqual(first, differentSeed);
  assert.notEqual(first, differentDate);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(first.startsWith(uuidTimestampPrefix(date)), true);
  assert.equal(
    differentDate.startsWith(uuidTimestampPrefix(new Date('2025-11-16T00:00:00.000Z'))),
    true,
  );
});

test('outcome recorder appends valid user-level event records', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const startedAt = new Date('2026-05-23T08:00:00.000Z');

  const { record, storePath } = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    verb: 'manual_record',
    outcome: 'failure',
    failureCategory: 'manifest_drift',
    failureDriver: 'tooling',
    durationMs: 17,
    now: startedAt,
  });

  assert.match(record.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(validateRecord(record), { ok: true, errors: [] });
  assert.equal(storePath, outcomeStorePath({ root, homeDir }).eventsPath);
  assert.deepEqual(readJsonl(storePath), [
    {
      id: record.id,
      schema_version: '0.1',
      kind: 'event',
      ts: '2026-05-23T08:00:00.000Z',
      verb: 'manual_record',
      outcome: 'failure',
      surface: 'repo',
      duration_ms: 17,
      failure_category: 'manifest_drift',
      failure_driver: 'tooling',
      project_hash: projectHash(root),
      plugin: 'demo-ops',
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
    verb: 'manual_record',
    outcome: 'success',
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
        plugin: 'demo-ops',
        surface: 'repo',
        verb: 'manual_record',
        outcome: 'success',
        note: 'x'.repeat(1200),
        durationMs: 0,
      }),
    /must not exceed 1024 bytes/,
  );
});

test('outcome recorder treats plugin as optional schema data', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const { record } = recordOutcomeEvent({
    root,
    homeDir,
    surface: 'external',
    verb: 'manual_record',
    outcome: 'success',
    now: new Date('2026-05-23T08:01:30.000Z'),
  });

  assert.deepEqual(validateRecord(record), { ok: true, errors: [] });
  assert.equal(Object.hasOwn(record, 'plugin'), false);
});

test('outcome recorder marks existing events and validates mark semantics', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const first = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'codex_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    durationMs: 4,
    now: new Date('2026-05-23T08:02:00.000Z'),
  }).record;
  const second = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    durationMs: 2,
    now: new Date('2026-05-23T08:03:00.000Z'),
  }).record;

  const failureMark = markOutcomeEvent({
    root,
    homeDir,
    relatedId: first.id,
    outcome: 'failure',
    failureCategory: 'misroute',
    failureDriver: 'human',
    note: 'manual review found the route was wrong',
    now: new Date('2026-05-23T08:04:00.000Z'),
  }).record;
  markOutcomeEvent({
    root,
    homeDir,
    relatedId: second.id,
    outcome: 'success',
    now: new Date('2026-05-23T08:05:00.000Z'),
  });

  assert.deepEqual(validateRecord(failureMark), { ok: true, errors: [] });
  assert.equal(failureMark.related_id, first.id);
  assert.equal(failureMark.verb, 'live_check');
  assert.equal(failureMark.surface, 'codex_plugin');

  assert.throws(
    () =>
      markOutcomeEvent({
        root,
        homeDir,
        relatedId: first.id,
        verb: 'validate',
        outcome: 'success',
      }),
    /mark verb must match related event verb/,
  );

  const records = readOutcomeRecords(outcomeStorePath({ root, homeDir }).eventsPath);
  assert.equal(records.filter((record) => record.kind === 'event').length, 2);
  assert.equal(records.filter((record) => record.kind === 'mark').length, 2);

  assert.throws(
    () =>
      markOutcomeEvent({
        root,
        homeDir,
        relatedId: '018f1d2e-0000-7000-8000-000000000000',
        outcome: 'success',
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
      '--surface',
      'external',
      '--verb',
      'manual_record',
      '--outcome',
      'failure',
      '--failure-category',
      'missing_artifact',
      '--failure-driver',
      'human',
      '--note',
      'historical propagation miss',
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
      '--outcome',
      'success',
      '--failure-category',
      'surface_residue',
      '--failure-driver',
      'config',
    ],
    { env },
  );
  assert.equal(invalidSuccess.status, 2);
  assert.match(invalidSuccess.stderr, /failure_category is forbidden/);

  const missing = runCli(
    [
      'outcome',
      'mark',
      '--root',
      root,
      '018f1d2e-0000-7000-8000-000000000000',
      '--outcome',
      'success',
    ],
    { env },
  );
  assert.equal(missing.status, 4);
  assert.match(missing.stderr, /may have expired under the retention policy/);

  const report = runCli(['outcome', 'report', '--root', root, '--json'], { env });
  assert.equal(report.status, 0, report.stderr || report.stdout);
  const payload = JSON.parse(report.stdout);
  assert.equal(payload.totals.events_read, 1);
  assert.equal(payload.totals.marks_read, 0);
  assert.equal(payload.propagation.failure, 1);
  assert.deepEqual(payload.by_failure_category, [
    { failure_category: 'missing_artifact', count: 1, share_of_failures: 1 },
  ]);
  assert.equal(existsSync(outcomeStorePath({ root, homeDir }).eventsPath), true);
});

test('outcome reader skips schema-invalid records and reports schema errors', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const { record, storePath } = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    verb: 'manual_record',
    outcome: 'success',
    now: new Date('2026-05-23T08:06:00.000Z'),
  });
  const futureRecord = {
    ...record,
    id: '018f1d2e-0000-7000-8000-000000000000',
    schema_version: '0.2',
  };
  writeFileSync(
    storePath,
    `${JSON.stringify(record)}\nnot json\n${JSON.stringify(futureRecord)}\n`,
  );

  const messages = [];
  const originalError = console.error;
  console.error = (message) => messages.push(String(message));
  try {
    assert.deepEqual(readOutcomeRecords(storePath), [record]);
  } finally {
    console.error = originalError;
  }

  assert.match(messages.join('\n'), /outcome\.schema_error: line=2 reason=invalid JSON/);
  assert.match(messages.join('\n'), /line=3 reason=schema_version must be "0\.1"/);

  const appended = recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    surface: 'repo',
    verb: 'manual_record',
    outcome: 'success',
    now: new Date('2026-05-23T08:07:00.000Z'),
  }).record;
  const rewrittenText = readFileSync(storePath, 'utf8');
  assert.match(rewrittenText, /not json/);
  assert.match(rewrittenText, /"schema_version":"0\.2"/);
  assert.match(rewrittenText, new RegExp(appended.id));
});

test('validate auto-emits one ok event and honors --no-outcome', () => {
  const homeDir = makeHome();
  const env = { ...process.env, HOME: homeDir };

  const result = runScript('validate-trigger-layer.mjs', ['--root', repoRoot], { env });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const records = readJsonl(outcomeStorePath({ root: repoRoot, homeDir }).eventsPath);
  assert.equal(records.length, 1);
  assert.deepEqual(validateRecord(records[0]), { ok: true, errors: [] });
  assert.equal(records[0].kind, 'event');
  assert.equal(records[0].schema_version, '0.1');
  assert.equal(records[0].plugin, 'agent-trigger-kit');
  assert.equal(records[0].surface, 'repo');
  assert.equal(records[0].verb, 'validate');
  assert.equal(records[0].outcome, 'success');
  assert.equal(records[0].exit_code, 0);
  assert.equal(Object.hasOwn(records[0], 'failure_category'), false);

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

test('live-check auto-emits parent and child events with shared correlation id', () => {
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
  assert.equal(records.length, 3);
  for (const record of records) {
    assert.deepEqual(validateRecord(record), { ok: true, errors: [] });
    assert.equal(record.correlation_id, records[0].correlation_id);
  }
  assert.ok(records[0].correlation_id);
  assert.deepEqual(
    records.map((record) => [
      record.plugin,
      record.surface,
      record.verb,
      record.outcome,
      record.failure_category,
      record.failure_driver,
    ]),
    [
      ['demo-ops', 'repo', 'live_check', 'failure', 'unknown', undefined],
      ['demo-ops', 'codex_plugin', 'live_check', 'success', undefined, undefined],
      ['demo-ops', 'codex_plugin', 'live_check', 'failure', 'surface_residue', 'config'],
    ],
  );
});

test('live-check auto-emits skipped parent when no rows are selected', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces: []
`,
  );

  const result = runScript(
    'live-trigger-surface-check.mjs',
    ['--root', root, '--owner', 'nobody'],
    {
      env: { ...process.env, HOME: homeDir },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /no rows selected/);
  const records = readJsonl(outcomeStorePath({ root, homeDir }).eventsPath);
  assert.equal(records.length, 1);
  assert.deepEqual(validateRecord(records[0]), { ok: true, errors: [] });
  assert.equal(records[0].plugin, 'demo-ops');
  assert.equal(records[0].surface, 'repo');
  assert.equal(records[0].verb, 'live_check');
  assert.equal(records[0].outcome, 'skipped');
  assert.equal(records[0].exit_code, 0);
  assert.equal(Object.hasOwn(records[0], 'failure_category'), false);
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
  assert.deepEqual(validateRecord(premergeRecords[0]), { ok: true, errors: [] });
  assert.equal(premergeRecords[0].verb, 'premerge_version_check');
  assert.equal(premergeRecords[0].outcome, 'success');
  assert.equal(premergeRecords[0].exit_code, 0);

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
  assert.deepEqual(validateRecord(scratchRecords[0]), { ok: true, errors: [] });
  assert.equal(scratchRecords[0].verb, 'scratch_namespace_check');
  assert.equal(scratchRecords[0].outcome, 'success');
  assert.equal(scratchRecords[0].exit_code, 0);
});

test('auto-emitter falls back to project-local store when user store is unavailable', () => {
  const root = makeRoot();
  initGitFixture(root);
  const badHome = join(root, 'not-a-directory');
  write(root, 'not-a-directory', 'file blocks outcome home');

  const result = runScript('check-scratch-namespace.mjs', ['--root', root], {
    env: { ...process.env, HOME: badHome },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /outcome recording failed/i);
  assert.equal(existsSync(outcomeStorePath({ root, homeDir: badHome }).eventsPath), false);
  assert.equal(
    readFileSync(join(root, '.agent-trigger-kit/outcomes/.gitignore'), 'utf8'),
    '*\n!.gitignore\n',
  );
  const records = readJsonl(outcomeStorePath({ root, store: 'project' }).eventsPath);
  assert.equal(records.length, 1);
  assert.deepEqual(validateRecord(records[0]), { ok: true, errors: [] });
  assert.equal(records[0].verb, 'scratch_namespace_check');
  assert.equal(records[0].outcome, 'success');
  assert.equal(records[0].exit_code, 0);
});
