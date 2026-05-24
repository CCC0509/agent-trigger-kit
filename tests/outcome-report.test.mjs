import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildOutcomeReport,
  buildOutcomeSessionSummary,
  markOutcomeEvent,
  outcomeStorePath,
  recordOutcomeEvent,
} from '../scripts/lib/outcome-recorder.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-report-root-'));
}

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-report-home-'));
}

function emit(root, homeDir, fields) {
  return recordOutcomeEvent({
    root,
    homeDir,
    plugin: 'demo-ops',
    durationMs: 1,
    ...fields,
  }).record;
}

function mark(root, homeDir, relatedId, fields) {
  return markOutcomeEvent({
    root,
    homeDir,
    relatedId,
    ...fields,
  }).record;
}

function runCli(args, homeDir) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'cli.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: homeDir, AGENT_TRIGGER_KIT_OUTCOME_DISABLED: '1' },
  });
}

test('outcome report computes propagation totals, rates, and failure categories', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-23T10:00:00.000Z');

  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-23T08:01:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'premerge_version_check',
    outcome: 'blocked',
    exitCode: 2,
    now: new Date('2026-05-23T08:02:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'cursor_rule',
    verb: 'live_check',
    outcome: 'skipped',
    exitCode: 0,
    now: new Date('2026-05-23T08:03:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'misroute',
    failureDriver: 'human',
    now: new Date('2026-05-23T08:04:00.000Z'),
  });

  const report = buildOutcomeReport({ root, homeDir, now });

  assert.equal(report.schema_version, '0.1');
  assert.equal(report.report_version, '0.1');
  assert.equal(report.store, 'user');
  assert.deepEqual(report.scope, {
    since: null,
    surface: null,
    verb: null,
    retained_records_only: true,
    retention_horizon_days: 90,
    retention_record_limit: 1000,
  });
  assert.deepEqual(report.totals, {
    events_read: 5,
    marks_read: 0,
    effective_events: 5,
    signal_events: 4,
    skipped_events: 1,
  });
  assert.deepEqual(report.propagation, {
    status: 'ok',
    success: 1,
    failure: 2,
    blocked: 1,
    skipped: 1,
    denominator: 4,
    success_rate: 0.25,
    failure_rate: 0.5,
    blocked_rate: 0.25,
  });
  assert.deepEqual(report.by_failure_category, [
    { failure_category: 'misroute', count: 1, share_of_failures: 0.5 },
    { failure_category: 'stale_cache', count: 1, share_of_failures: 0.5 },
  ]);
});

test('outcome report sorts per-surface reliability with weak surfaces first', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-23T10:00:00.000Z');

  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'manifest_drift',
    now: new Date('2026-05-23T08:01:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:02:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'blocked',
    exitCode: 2,
    now: new Date('2026-05-23T08:03:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'cursor_rule',
    verb: 'manual_record',
    outcome: 'failure',
    failureCategory: 'surface_residue',
    now: new Date('2026-05-23T08:04:00.000Z'),
  });

  const report = buildOutcomeReport({ root, homeDir, now });

  assert.deepEqual(
    report.by_surface.map((row) => row.surface),
    ['cursor_rule', 'claude_plugin', 'repo'],
  );
  assert.deepEqual(report.by_surface[0], {
    surface: 'cursor_rule',
    signal_events: 1,
    success: 0,
    failure: 1,
    blocked: 0,
    skipped: 0,
    success_rate: 0,
    failure_rate: 1,
    blocked_rate: 0,
  });
  assert.equal(report.by_surface[1].success_rate, 0.5);
  assert.equal(report.by_surface[2].success_rate, 0.5);
});

test('outcome report applies latest mark overrides including surface changes', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-23T10:00:00.000Z');
  const event = emit(root, homeDir, {
    surface: 'repo',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });

  mark(root, homeDir, event.id, {
    surface: 'claude_plugin',
    outcome: 'failure',
    failureCategory: 'misroute',
    failureDriver: 'human',
    now: new Date('2026-05-23T08:01:00.000Z'),
  });
  mark(root, homeDir, event.id, {
    surface: 'cursor_rule',
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-23T08:02:00.000Z'),
  });

  const report = buildOutcomeReport({ root, homeDir, now });

  assert.equal(report.totals.events_read, 1);
  assert.equal(report.totals.marks_read, 2);
  assert.deepEqual(report.by_surface, [
    {
      surface: 'cursor_rule',
      signal_events: 1,
      success: 0,
      failure: 1,
      blocked: 0,
      skipped: 0,
      success_rate: 0,
      failure_rate: 1,
      blocked_rate: 0,
    },
  ]);
  assert.deepEqual(report.by_failure_category, [
    { failure_category: 'stale_cache', count: 1, share_of_failures: 1 },
  ]);
});

test('outcome session summary aggregates failure drivers from latest effective failures', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-23T10:00:00.000Z');
  const remediated = emit(root, homeDir, {
    surface: 'repo',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'repo',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    failureDriver: 'tooling',
    now: new Date('2026-05-23T08:03:00.000Z'),
  });
  const resolved = emit(root, homeDir, {
    surface: 'repo',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'manifest_drift',
    failureDriver: 'cache',
    now: new Date('2026-05-23T08:04:00.000Z'),
  });

  mark(root, homeDir, remediated.id, {
    outcome: 'failure',
    failureCategory: 'misroute',
    failureDriver: 'human',
    now: new Date('2026-05-23T08:01:00.000Z'),
  });
  mark(root, homeDir, remediated.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-23T08:02:00.000Z'),
  });
  mark(root, homeDir, resolved.id, {
    outcome: 'success',
    now: new Date('2026-05-23T08:05:00.000Z'),
  });

  const summary = buildOutcomeSessionSummary({ root, homeDir, now });

  assert.equal(summary.schema_version, '0.1');
  assert.equal(summary.generated_at, now.toISOString());
  assert.equal(summary.store, 'user');
  assert.deepEqual(summary.scope, {
    since: null,
    surface: null,
    verb: null,
    retained_records_only: true,
    retention_horizon_days: 90,
    retention_record_limit: 1000,
  });
  assert.deepEqual(summary.failure_categories, [
    { failure_category: 'stale_cache', count: 2, share_of_failures: 1 },
  ]);
  assert.deepEqual(summary.failure_drivers, [
    { failure_driver: 'cache', count: 1, share_of_failures: 0.5 },
    { failure_driver: 'tooling', count: 1, share_of_failures: 0.5 },
  ]);
});

test('outcome session summary applies since filtering before failure driver aggregation', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-23T10:00:00.000Z');
  const old = emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-23T07:59:59.999Z'),
  });
  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'manifest_drift',
    failureDriver: 'tooling',
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  const includedMarked = emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:01:00.000Z'),
  });

  mark(root, homeDir, old.id, {
    outcome: 'failure',
    failureCategory: 'misroute',
    failureDriver: 'human',
    now: new Date('2026-05-23T08:30:00.000Z'),
  });
  mark(root, homeDir, includedMarked.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'human',
    now: new Date('2026-05-23T08:31:00.000Z'),
  });

  const summary = buildOutcomeSessionSummary({
    root,
    homeDir,
    now,
    since: '2026-05-23T08:00:00.000Z',
  });

  assert.equal(summary.scope.since, '2026-05-23T08:00:00.000Z');
  assert.deepEqual(summary.failure_categories, [
    { failure_category: 'manifest_drift', count: 1, share_of_failures: 0.5 },
    { failure_category: 'stale_cache', count: 1, share_of_failures: 0.5 },
  ]);
  assert.deepEqual(summary.failure_drivers, [
    { failure_driver: 'human', count: 1, share_of_failures: 0.5 },
    { failure_driver: 'tooling', count: 1, share_of_failures: 0.5 },
  ]);
});

test('outcome report filters with since, window-days compatibility, surface, and verb', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-23T10:00:00.000Z');

  const old = emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'release_policy_gap',
    now: new Date('2026-03-01T08:00:00.000Z'),
  });
  const included = emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'manifest_drift',
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:01:00.000Z'),
  });
  mark(root, homeDir, old.id, {
    outcome: 'success',
    now: new Date('2026-05-23T08:30:00.000Z'),
  });
  mark(root, homeDir, included.id, {
    surface: 'claude_plugin',
    outcome: 'success',
    now: new Date('2026-05-23T08:31:00.000Z'),
  });

  const sinceReport = buildOutcomeReport({
    root,
    homeDir,
    now,
    since: '2026-05-23T08:00:00.000Z',
  });
  assert.equal(sinceReport.totals.events_read, 3);
  assert.equal(sinceReport.totals.marks_read, 2);
  assert.equal(sinceReport.totals.effective_events, 2);
  assert.equal(sinceReport.propagation.success, 2);

  const windowReport = buildOutcomeReport({ root, homeDir, now, windowDays: 60 });
  assert.equal(windowReport.scope.since, '2026-03-24T10:00:00.000Z');
  assert.equal(windowReport.totals.effective_events, 2);

  const sinceWins = buildOutcomeReport({
    root,
    homeDir,
    now,
    windowDays: 60,
    since: '2026-02-01T00:00:00.000Z',
  });
  assert.equal(sinceWins.scope.since, '2026-02-01T00:00:00.000Z');
  assert.equal(sinceWins.totals.effective_events, 3);

  const surfaceReport = buildOutcomeReport({ root, homeDir, now, surface: 'claude_plugin' });
  assert.equal(surfaceReport.totals.effective_events, 2);
  assert.deepEqual(
    surfaceReport.by_surface.map((row) => row.surface),
    ['claude_plugin'],
  );

  const verbReport = buildOutcomeReport({ root, homeDir, now, verb: 'validate' });
  assert.equal(verbReport.totals.effective_events, 2);
});

test('outcome report handles empty and all-skipped stores as no-signal reports', () => {
  const emptyRoot = makeRoot();
  const emptyHome = makeHome();
  const now = new Date('2026-05-23T10:00:00.000Z');

  const empty = buildOutcomeReport({ root: emptyRoot, homeDir: emptyHome, now });
  assert.deepEqual(empty.totals, {
    events_read: 0,
    marks_read: 0,
    effective_events: 0,
    signal_events: 0,
    skipped_events: 0,
  });
  assert.deepEqual(empty.propagation, {
    status: 'no_signal',
    success: 0,
    failure: 0,
    blocked: 0,
    skipped: 0,
    denominator: 0,
    success_rate: null,
    failure_rate: null,
    blocked_rate: null,
  });

  const skippedRoot = makeRoot();
  const skippedHome = makeHome();
  emit(skippedRoot, skippedHome, {
    surface: 'repo',
    verb: 'live_check',
    outcome: 'skipped',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  const skipped = buildOutcomeReport({ root: skippedRoot, homeDir: skippedHome, now });
  assert.equal(skipped.totals.effective_events, 1);
  assert.equal(skipped.totals.signal_events, 0);
  assert.equal(skipped.totals.skipped_events, 1);
  assert.equal(skipped.propagation.status, 'no_signal');
  assert.equal(skipped.propagation.success_rate, null);
  assert.equal(skipped.by_surface[0].success_rate, null);
});

test('outcome report gate summary uses event timestamp window, latest marks, and filters', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-24T10:15:30.000Z');

  const outside = emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-03-25T10:15:29.999Z'),
  });
  mark(root, homeDir, outside.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-24T09:00:00.000Z'),
  });

  const includedFailure = emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-03-25T10:15:30.000Z'),
  });
  mark(root, homeDir, includedFailure.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'tooling',
    now: new Date('2026-05-24T09:01:00.000Z'),
  });

  const includedSkipped = emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'skipped',
    exitCode: 0,
    now: new Date('2026-05-24T08:00:00.000Z'),
  });
  mark(root, homeDir, includedSkipped.id, {
    outcome: 'skipped',
    now: new Date('2026-05-24T09:02:00.000Z'),
  });

  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'manifest_drift',
    now: new Date('2026-05-24T08:30:00.000Z'),
  });

  const report = buildOutcomeReport({
    root,
    homeDir,
    now,
    windowDays: 7,
    surface: 'claude_plugin',
    gates: true,
  });

  assert.equal(report.scope.since, '2026-05-17T10:15:30.000Z');
  assert.equal(report.totals.effective_events, 1);
  assert.equal(report.gate_report_version, '0.1');
  assert.deepEqual(report.gates.window, {
    anchor: 'event_ts',
    days: 60,
    start: '2026-03-25T10:15:30.000Z',
    end: '2026-05-24T10:15:30.000Z',
    mark_policy: 'latest_retained_mark_at_report_time',
  });
  assert.deepEqual(report.gates.marked_event_counts, {
    marked_events: 2,
    marked_failures: 1,
    marked_skipped: 1,
    unmarked_events: 0,
  });
  assert.equal(report.gates.graphify.status, 'disabled');
  assert.equal(report.gates.graphify.disabled_reason, 'schema_gap.context_bloat_axis_missing');
  assert.equal(report.gates.graphify.denominator, 1);
  assert.equal(report.gates.ecc.status, 'insufficient_data');
  assert.equal(report.gates.ecc.denominator, 2);
  assert.equal(report.gates.ecc.candidate_pool, 1);
  assert.equal(report.gates.ecc.eligibility.missing_denominator, 18);
  assert.equal(report.gates.safety.status, 'disabled');
  assert.equal(report.gates.safety.disabled_reason, 'schema_gap.mutation_axis_missing');
  assert.equal(report.gates.safety.denominator, null);
});

test('outcome report gate summary groups ECC candidates by failure category plugin and surface', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-24T10:15:30.000Z');

  const first = emit(root, homeDir, {
    plugin: 'foo',
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-24T08:00:00.000Z'),
  });
  mark(root, homeDir, first.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-24T09:00:00.000Z'),
  });

  const second = emit(root, homeDir, {
    plugin: 'foo',
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    failureDriver: 'tooling',
    now: new Date('2026-05-24T08:01:00.000Z'),
  });
  mark(root, homeDir, second.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'tooling',
    now: new Date('2026-05-24T09:01:00.000Z'),
  });

  for (let index = 0; index < 18; index += 1) {
    const event = emit(root, homeDir, {
      plugin: 'foo',
      surface: 'repo',
      verb: 'validate',
      outcome: index % 2 === 0 ? 'success' : 'skipped',
      exitCode: 0,
      now: new Date(`2026-05-24T08:${String(index + 2).padStart(2, '0')}:00.000Z`),
    });
    mark(root, homeDir, event.id, {
      outcome: event.outcome,
      now: new Date(`2026-05-24T09:${String(index + 2).padStart(2, '0')}:00.000Z`),
    });
  }

  const report = buildOutcomeReport({ root, homeDir, now, windowDays: 60, gates: true });

  assert.equal(report.gates.ecc.status, 'not_triggered');
  assert.equal(report.gates.ecc.denominator, 20);
  assert.equal(report.gates.ecc.candidate_pool, 2);
  assert.equal(report.gates.ecc.numerator, 2);
  assert.deepEqual(report.gates.ecc.repetition_key, ['failure_category', 'plugin', 'surface']);
  assert.deepEqual(report.gates.ecc.top_candidates, [
    {
      key: {
        failure_category: 'stale_cache',
        plugin: 'foo',
        surface: 'claude_plugin',
      },
      count: 2,
      failure_driver_breakdown: {
        cache: 1,
        tooling: 1,
      },
      driver_policy: 'wildcard',
      rule_suggestion_basis:
        'Repeated stale_cache failures for plugin foo on claude_plugin regardless of driver; inspect driver breakdown before writing a narrow rule.',
    },
  ]);
});

test('outcome report gate summary uses latest mark at report generation time', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-24T10:15:30.000Z');

  const futureOnly = emit(root, homeDir, {
    plugin: 'foo',
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-24T08:00:00.000Z'),
  });
  mark(root, homeDir, futureOnly.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    now: new Date('2026-05-25T00:00:00.000Z'),
  });

  const pastThenFuture = emit(root, homeDir, {
    plugin: 'foo',
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-24T08:01:00.000Z'),
  });
  mark(root, homeDir, pastThenFuture.id, {
    outcome: 'failure',
    failureCategory: 'misroute',
    failureDriver: 'human',
    now: new Date('2026-05-24T09:00:00.000Z'),
  });
  mark(root, homeDir, pastThenFuture.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-25T00:01:00.000Z'),
  });

  const report = buildOutcomeReport({
    root,
    homeDir,
    now,
    windowDays: 60,
    surface: 'claude_plugin',
    gates: true,
  });

  assert.deepEqual(report.gates.marked_event_counts, {
    marked_events: 1,
    marked_failures: 1,
    marked_skipped: 0,
    unmarked_events: 1,
  });
  assert.equal(report.gates.graphify.denominator, 1);
  assert.equal(report.gates.ecc.denominator, 1);
  assert.equal(report.gates.ecc.candidate_pool, 1);
  assert.equal(report.gates.ecc.numerator, 0);
  assert.deepEqual(report.gates.ecc.top_candidates, []);
  assert.deepEqual(report.by_failure_category, [
    { failure_category: 'stale_cache', count: 2, share_of_failures: 1 },
  ]);
});

test('outcome report gate summary skips schema-invalid failures before ECC candidates', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const now = new Date('2026-05-24T10:15:30.000Z');

  const valid = emit(root, homeDir, {
    plugin: 'foo',
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    now: new Date('2026-05-24T08:00:00.000Z'),
  });
  mark(root, homeDir, valid.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    now: new Date('2026-05-24T09:00:00.000Z'),
  });

  const malformed = {
    id: '018f1d2e-0000-7000-8000-000000000000',
    schema_version: '0.1',
    kind: 'event',
    ts: '2026-05-24T08:01:00.000Z',
    verb: 'manual_record',
    outcome: 'failure',
    surface: 'claude_plugin',
    project_hash: 'malformed001',
    plugin: 'foo',
  };
  const eventsPath = outcomeStorePath({ root, homeDir }).eventsPath;
  writeFileSync(eventsPath, `${JSON.stringify(malformed)}\n`, { flag: 'a' });

  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  let report;
  try {
    report = buildOutcomeReport({ root, homeDir, now, windowDays: 60, gates: true });
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(errors, [
    'outcome.schema_error: line=3 reason=failure_category is required when outcome is failure',
  ]);
  assert.equal(report.totals.events_read, 1);
  assert.equal(report.gates.marked_event_counts.marked_failures, 1);
  assert.equal(report.gates.ecc.candidate_pool, 1);
  assert.equal(report.gates.ecc.numerator, 0);
  assert.deepEqual(report.gates.ecc.top_candidates, []);
});

test('outcome report CLI emits human text by default and structured JSON with --json', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    now: new Date('2026-05-23T08:01:00.000Z'),
  });

  const human = runCli(['outcome', 'report', '--root', root, '--surface', 'repo'], homeDir);
  assert.equal(human.status, 0, human.stderr || human.stdout);
  assert.match(human.stdout, /Outcome report/);
  assert.match(human.stdout, /Success rate: 50\.0%/);
  assert.match(human.stdout, /stale_cache/);
  assert.doesNotMatch(human.stdout, /^\{/);

  const json = runCli(
    ['outcome', 'report', '--root', root, '--json', '--verb', 'validate'],
    homeDir,
  );
  assert.equal(json.status, 0, json.stderr || json.stdout);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.scope.verb, 'validate');
  assert.equal(payload.scope.retention_horizon_days, 90);
  assert.equal(payload.scope.retention_record_limit, 1000);
  assert.equal(payload.propagation.success_rate, 0.5);
  assert.equal(payload.propagation.failure_rate, 0.5);
  assert.equal(payload.propagation.blocked_rate, 0);

  const gatesWithoutJson = runCli(['outcome', 'report', '--root', root, '--gates'], homeDir);
  assert.equal(gatesWithoutJson.status, 2);
  assert.match(gatesWithoutJson.stderr, /--gates requires --json/);

  const plainJson = runCli(['outcome', 'report', '--root', root, '--json'], homeDir);
  assert.equal(plainJson.status, 0, plainJson.stderr || plainJson.stdout);
  assert.equal(Object.hasOwn(JSON.parse(plainJson.stdout), 'gates'), false);

  const gateJson = runCli(['outcome', 'report', '--root', root, '--json', '--gates'], homeDir);
  assert.equal(gateJson.status, 0, gateJson.stderr || gateJson.stdout);
  const gatePayload = JSON.parse(gateJson.stdout);
  assert.equal(gatePayload.gate_report_version, '0.1');
  assert.equal(gatePayload.gates.window.anchor, 'event_ts');

  const invalidSurface = runCli(
    ['outcome', 'report', '--root', root, '--surface', 'bogus'],
    homeDir,
  );
  assert.equal(invalidSurface.status, 2);
  assert.match(invalidSurface.stderr, /surface must be one of/);

  const invalidSince = runCli(
    ['outcome', 'report', '--root', root, '--since', '2026-05-23'],
    homeDir,
  );
  assert.equal(invalidSince.status, 2);
  assert.match(invalidSince.stderr, /since must be a UTC ISO8601 string ending in Z/);
});
