import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildOutcomeReport,
  markOutcomeEvent,
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
