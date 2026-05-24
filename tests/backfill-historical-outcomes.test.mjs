import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse as parseYaml } from 'yaml';

import { makeTempDir } from './helpers/tmp.mjs';
import { mintUuidV7, outcomeStorePath } from '../scripts/lib/outcome-recorder.mjs';
import { validateRecord } from '../scripts/lib/outcome-schema.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-backfill-');
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function writePublicSeed(root, text) {
  write(root, 'docs/data/historical-outcomes-seed.yaml', text);
}

function writeLocalSeed(root, text) {
  write(root, 'docs/data/historical-outcomes-seed.local.yaml', text);
}

function readJsonl(path) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function runBackfill(root, args = []) {
  return runBackfillArgs(['--root', root, '--store', 'project', ...args]);
}

function runBackfillArgs(args = []) {
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/backfill-historical-outcomes.mjs'), ...args],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
}

test('historical backfill writes schema-valid records and is idempotent', (t) => {
  const root = makeRoot(t);
  writePublicSeed(
    root,
    `
- incident_id: validate-success-example
  ts: '2026-01-02T00:00:00Z'
  ts_confidence: exact
  verb: validate
  surface: repo
  outcome: success
  exit_code: 0
  plugin: agent-trigger-kit
  note: 'Sanitized validate success example.'
- incident_id: live-skipped-example
  ts: '2026-01-03T00:00:00Z'
  ts_confidence: exact
  verb: live_check
  surface: repo
  outcome: skipped
  exit_code: 0
  plugin: agent-trigger-kit
  note: 'Sanitized no-row live check example.'
- incident_id: claude-cache-stale-example
  ts: '2025-11-15T00:00:00Z'
  ts_confidence: estimated
  verb: live_check
  surface: claude_plugin
  outcome: failure
  exit_code: 1
  failure_category: stale_cache
  failure_driver: cache
  plugin: agent-trigger-kit
  note: 'A sanitized plugin cache held stale trigger data after an update.'
- incident_id: manual-external-unknown-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: unknown
  surface: external
  outcome: failure
  failure_category: unknown
  failure_driver: unknown
  note: 'A sanitized historical incident could not be tied to a specific hook.'
`,
  );

  const first = runBackfill(root);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.match(first.stdout, /total=4/);
  assert.match(first.stdout, /written=4/);
  assert.match(first.stdout, /skipped=0/);

  const store = outcomeStorePath({ root, store: 'project' });
  const records = readJsonl(store.eventsPath);
  assert.equal(records.length, 4);
  for (const record of records) {
    assert.deepEqual(validateRecord(record), { ok: true, errors: [] });
  }
  assert.equal(
    records[0].id,
    mintUuidV7(new Date('2026-01-02T00:00:00Z'), 'validate-success-example'),
  );
  assert.equal(records[1].outcome, 'skipped');
  assert.equal(records[1].exit_code, 0);
  assert.equal(records[3].verb, 'manual_record');
  assert.equal(Object.hasOwn(records[3], 'exit_code'), false);

  const before = readFileSync(store.eventsPath, 'utf8');
  const second = runBackfill(root);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.match(second.stdout, /written=0/);
  assert.match(second.stdout, /skipped=4/);
  assert.equal(readFileSync(store.eventsPath, 'utf8'), before);
});

test('historical backfill idempotency sees raw records with matching ids', (t) => {
  const root = makeRoot(t);
  const incidentId = 'future-schema-existing-id';
  const ts = '2025-04-01T00:00:00Z';
  const id = mintUuidV7(new Date(ts), incidentId);
  writePublicSeed(
    root,
    `
- incident_id: ${incidentId}
  ts: '${ts}'
  ts_confidence: estimated
  surface: external
  outcome: success
`,
  );
  const store = outcomeStorePath({ root, store: 'project' });
  mkdirSync(dirname(store.eventsPath), { recursive: true });
  writeFileSync(store.eventsPath, `${JSON.stringify({ id, schema_version: '0.2' })}\n`);

  const result = runBackfill(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /written=0/);
  assert.match(result.stdout, /skipped=1/);
  assert.equal(readFileSync(store.eventsPath, 'utf8').match(new RegExp(id, 'g')).length, 1);
});

test('historical backfill rejects invalid seed entries before writing records', (t) => {
  const root = makeRoot(t);
  writePublicSeed(
    root,
    `
- incident_id: valid-manual-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
- incident_id: missing-exit-code-example
  ts: '2025-01-02T00:00:00Z'
  ts_confidence: estimated
  verb: live_check
  surface: codex_plugin
  outcome: success
`,
  );

  const result = runBackfill(root);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exit_code is required/);
  assert.equal(existsSync(outcomeStorePath({ root, store: 'project' }).eventsPath), false);
});

test('historical backfill rejects schema-invalid seed records atomically', (t) => {
  const scenarios = [
    {
      name: 'missing failure category',
      seed: `
- incident_id: missing-category-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: failure
`,
      message: /failure_category is required/,
    },
    {
      name: 'non-failure category',
      seed: `
- incident_id: non-failure-category-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
  failure_category: unknown
`,
      message: /failure_category is forbidden/,
    },
    {
      name: 'oversized note',
      seed: `
- incident_id: oversized-note-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
  note: '${'x'.repeat(1200)}'
`,
      message: /serialized record must not exceed 1024 bytes/,
    },
  ];

  for (const scenario of scenarios) {
    const root = makeRoot(t);
    writePublicSeed(root, scenario.seed);

    const result = runBackfill(root);
    assert.equal(result.status, 2, scenario.name);
    assert.match(result.stderr, scenario.message, scenario.name);
    assert.equal(existsSync(outcomeStorePath({ root, store: 'project' }).eventsPath), false);
  }
});

test('historical backfill rejects missing root or store option values', (t) => {
  const missingRoot = runBackfillArgs(['--root']);
  assert.equal(missingRoot.status, 2);
  assert.match(missingRoot.stderr, /--root requires a path value/);

  const root = makeRoot(t);
  writePublicSeed(
    root,
    `
- incident_id: valid-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
`,
  );
  const missingStore = runBackfillArgs(['--root', root, '--store']);
  assert.equal(missingStore.status, 2);
  assert.match(missingStore.stderr, /--store requires a value/);
});

test('historical backfill rejects duplicate incident ids atomically', (t) => {
  const root = makeRoot(t);
  writePublicSeed(
    root,
    `
- incident_id: duplicate-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
- incident_id: duplicate-example
  ts: '2025-01-02T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
`,
  );

  const result = runBackfill(root);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /duplicate incident_id: duplicate-example/);
  assert.equal(existsSync(outcomeStorePath({ root, store: 'project' }).eventsPath), false);
});

test('historical backfill prefers local seed over public seed', (t) => {
  const root = makeRoot(t);
  writePublicSeed(
    root,
    `
- incident_id: public-example
  ts: '2025-01-01T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
  note: 'public seed'
`,
  );
  writeLocalSeed(
    root,
    `
- incident_id: local-example
  ts: '2025-01-02T00:00:00Z'
  ts_confidence: estimated
  surface: external
  outcome: success
  note: 'local seed'
`,
  );

  const result = runBackfill(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /historical-outcomes-seed\.local\.yaml/);
  const records = readJsonl(outcomeStorePath({ root, store: 'project' }).eventsPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, mintUuidV7(new Date('2025-01-02T00:00:00Z'), 'local-example'));
  assert.equal(records[0].note, 'local seed');
});

test('public historical seed is a minimum synthetic demonstration set', () => {
  const seedPath = join(repoRoot, 'docs/data/historical-outcomes-seed.yaml');
  const text = readFileSync(seedPath, 'utf8');
  assert.match(text, /synthetic-but-plausible examples/);
  assert.match(text, /exit_code values/);
  assert.match(text, /historical-outcomes-seed\.local\.yaml/);

  const entries = parseYaml(text);
  assert.equal(entries.length, 4);
  assert.equal(
    entries.some((entry) => entry.outcome === 'success'),
    true,
  );
  assert.equal(
    entries.some(
      (entry) => entry.outcome === 'failure' && entry.failure_category === 'stale_cache',
    ),
    true,
  );
  assert.equal(
    entries.some(
      (entry) =>
        entry.verb === 'premerge_version_check' &&
        entry.outcome === 'blocked' &&
        entry.exit_code === 2,
    ),
    true,
  );
  assert.equal(
    entries.some(
      (entry) =>
        (entry.verb === undefined || entry.verb === 'manual_record') &&
        entry.surface === 'external' &&
        entry.ts_confidence === 'unknown',
    ),
    true,
  );
});
