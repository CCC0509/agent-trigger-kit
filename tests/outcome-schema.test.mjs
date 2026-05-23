import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAILURE_CATEGORIES,
  FAILURE_DRIVERS,
  OUTCOMES,
  SCHEMA_VERSION,
  SURFACES,
  VERBS,
  validateRecord,
} from '../scripts/lib/outcome-schema.mjs';

const EVENT_ID = '018f1d2e-0000-7000-8000-000000000000';
const MARK_ID = '018f1d2e-0001-7000-8000-000000000001';
const CORRELATION_ID = '018f1d2e-0002-7000-8000-000000000002';

function validEvent(overrides = {}) {
  return {
    id: EVENT_ID,
    schema_version: SCHEMA_VERSION,
    kind: 'event',
    ts: '2026-05-23T08:00:00.000Z',
    verb: 'validate',
    outcome: 'success',
    surface: 'repo',
    exit_code: 0,
    duration_ms: 12,
    project_hash: 'b53a95cd11dc',
    plugin: 'agent-trigger-kit',
    correlation_id: CORRELATION_ID,
    ...overrides,
  };
}

function validMark(overrides = {}) {
  return {
    id: MARK_ID,
    schema_version: SCHEMA_VERSION,
    kind: 'mark',
    ts: '2026-05-23T08:01:00.000Z',
    verb: 'validate',
    outcome: 'failure',
    surface: 'repo',
    failure_category: 'misroute',
    failure_driver: 'human',
    related_id: EVENT_ID,
    note: 'manual review found the route was wrong',
    ...overrides,
  };
}

test('outcome schema exports v0.1 closed enum values', () => {
  assert.equal(SCHEMA_VERSION, '0.1');
  assert.deepEqual(VERBS, [
    'validate',
    'live_check',
    'premerge_version_check',
    'scratch_namespace_check',
    'manual_record',
  ]);
  assert.deepEqual(OUTCOMES, ['success', 'failure', 'skipped', 'blocked']);
  assert.deepEqual(SURFACES, [
    'repo',
    'cli',
    'codex_plugin',
    'claude_plugin',
    'cursor_rule',
    'external',
  ]);
  assert.deepEqual(FAILURE_CATEGORIES, [
    'stale_cache',
    'version_skew',
    'misroute',
    'manifest_drift',
    'missing_artifact',
    'release_policy_gap',
    'surface_residue',
    'unknown',
  ]);
  assert.deepEqual(FAILURE_DRIVERS, ['human', 'tooling', 'cache', 'network', 'config', 'unknown']);
});

test('outcome schema accepts valid event and mark records', () => {
  assert.deepEqual(validateRecord(validEvent()), { ok: true, errors: [] });
  assert.deepEqual(validateRecord(validMark()), { ok: true, errors: [] });
  assert.deepEqual(
    validateRecord(
      validEvent({
        verb: 'manual_record',
        outcome: 'failure',
        surface: 'external',
        failure_category: 'unknown',
        exit_code: undefined,
      }),
    ),
    { ok: true, errors: [] },
  );
});

test('outcome schema rejects unknown fields and invalid core fields', () => {
  const result = validateRecord({
    ...validEvent(),
    schema_version: '0.2',
    id: 'not-a-uuid-v7',
    ts: '2026-05-23T08:00:00.000+08:00',
    verb: 'mark',
    extra: true,
  });

  assert.deepEqual(result, {
    ok: false,
    errors: [
      'unknown field: extra',
      'id must be a UUID v7 string',
      'schema_version must be "0.1"',
      'ts must be a UTC ISO8601 string ending in Z',
      'verb must be one of validate, live_check, premerge_version_check, scratch_namespace_check, manual_record',
    ],
  });
});

test('outcome schema enforces failure category and exit code cross-rules', () => {
  assert.deepEqual(validateRecord(validEvent({ failure_category: 'unknown' })), {
    ok: false,
    errors: ['failure_category is forbidden unless outcome is failure'],
  });

  assert.deepEqual(
    validateRecord(validEvent({ outcome: 'failure', failure_category: undefined })),
    {
      ok: false,
      errors: ['failure_category is required when outcome is failure'],
    },
  );

  assert.deepEqual(validateRecord(validEvent({ exit_code: undefined })), {
    ok: false,
    errors: [
      'exit_code is required for event records with verb validate, live_check, premerge_version_check, or scratch_namespace_check',
    ],
  });

  assert.deepEqual(validateRecord(validMark({ exit_code: 0 })), {
    ok: false,
    errors: ['exit_code is forbidden for mark records'],
  });
});

test('outcome schema requires mark related_id and caps serialized record size', () => {
  assert.deepEqual(validateRecord(validMark({ related_id: undefined })), {
    ok: false,
    errors: ['related_id is required for mark records'],
  });

  const oversized = validateRecord(validEvent({ note: 'x'.repeat(1200) }));
  assert.deepEqual(oversized, {
    ok: false,
    errors: ['serialized record must not exceed 1024 bytes'],
  });
});
