import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  OutcomeRecorderError,
  listOutcomeEvents,
  markOutcomeEvent,
  recordOutcomeEvent,
  resolveOutcomeEventRef,
} from '../scripts/lib/outcome-recorder.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-mark-ux-root-'));
}

function makeHome() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-mark-ux-home-'));
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

test('outcome events lists newest raw events with short ids and mark metadata', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const oldest = emit(root, homeDir, {
    id: '018f1d2e-0000-7000-8000-000000000001',
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  const tiedEarlier = emit(root, homeDir, {
    id: '018f1d2e-0000-7000-8000-000000000002',
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T09:00:00.000Z'),
  });
  const tiedLater = emit(root, homeDir, {
    id: '018f1d2e-0000-7000-8000-000000000003',
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T09:00:00.000Z'),
  });
  mark(root, homeDir, tiedLater.id, {
    outcome: 'failure',
    failureCategory: 'misroute',
    failureDriver: 'human',
    now: new Date('2026-05-23T09:05:00.000Z'),
  });
  mark(root, homeDir, tiedLater.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    failureDriver: 'cache',
    now: new Date('2026-05-23T09:06:00.000Z'),
  });

  const listing = listOutcomeEvents({ root, homeDir, recent: 2 });

  assert.equal(listing.schema_version, '0.1');
  assert.equal(listing.events_version, '0.1');
  assert.deepEqual(listing.filters, {
    recent: 2,
    verb: null,
    surface: null,
    unmarked: false,
  });
  assert.deepEqual(
    listing.events.map((event) => event.id),
    [tiedLater.id, tiedEarlier.id],
  );
  assert.equal(listing.events[0].short_id, tiedLater.id.slice(0, 8));
  assert.equal(listing.events[0].outcome, 'success');
  assert.equal(listing.events[0].marked, true);
  assert.equal(listing.events[0].mark_count, 2);
  assert.equal(listing.events[0].latest_mark_ts, '2026-05-23T09:06:00.000Z');
  assert.equal(listing.events[1].marked, false);
  assert.equal(
    listing.events.some((event) => event.id === oldest.id),
    false,
  );
});

test('outcome events filters by verb, surface, and unmarked before applying recent', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const marked = emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'stale_cache',
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  const unmarkedLive = emit(root, homeDir, {
    surface: 'claude_plugin',
    verb: 'live_check',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:01:00.000Z'),
  });
  emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:02:00.000Z'),
  });
  mark(root, homeDir, marked.id, {
    outcome: 'failure',
    failureCategory: 'stale_cache',
    now: new Date('2026-05-23T08:03:00.000Z'),
  });

  const listing = listOutcomeEvents({
    root,
    homeDir,
    recent: 1,
    verb: 'live_check',
    surface: 'claude_plugin',
    unmarked: true,
  });

  assert.deepEqual(
    listing.events.map((event) => event.id),
    [unmarkedLive.id],
  );
  assert.deepEqual(listing.filters, {
    recent: 1,
    verb: 'live_check',
    surface: 'claude_plugin',
    unmarked: true,
  });
});

test('outcome events CLI prints table output and JSON output', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const event = emit(root, homeDir, {
    surface: 'repo',
    verb: 'validate',
    outcome: 'failure',
    exitCode: 1,
    failureCategory: 'manifest_drift',
    now: new Date('2026-05-23T08:00:00.000Z'),
  });

  const human = runCli(['outcome', 'events', '--root', root, '--recent', '1'], homeDir);
  assert.equal(human.status, 0, human.stderr || human.stdout);
  assert.match(human.stdout, /SHORTID\s+TS\s+VERB\s+OUTCOME\s+SURFACE\s+CATEGORY/);
  assert.match(human.stdout, new RegExp(event.id.slice(0, 8)));
  assert.match(human.stdout, /2026-05-23 08:00:00Z/);
  assert.match(human.stdout, /manifest_drift/);

  const json = runCli(['outcome', 'events', '--root', root, '--json'], homeDir);
  assert.equal(json.status, 0, json.stderr || json.stdout);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.events[0].id, event.id);
  assert.equal(payload.events[0].short_id, event.id.slice(0, 8));
  assert.equal(payload.events[0].marked, false);
});

test('outcome events rejects invalid filters', () => {
  const root = makeRoot();
  const homeDir = makeHome();

  for (const [args, pattern] of [
    [['outcome', 'events', '--root', root, '--recent', '0'], /recent must be a positive integer/],
    [['outcome', 'events', '--root', root, '--verb', 'bogus'], /verb must be one of/],
    [['outcome', 'events', '--root', root, '--surface', 'bogus'], /surface must be one of/],
  ]) {
    const result = runCli(args, homeDir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, pattern);
  }
});

test('short-id resolver resolves unique event prefixes and rejects ambiguous prefixes', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const first = emit(root, homeDir, {
    id: '018f1d2e-0000-7000-8000-000000000001',
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  const second = emit(root, homeDir, {
    id: '018f1d2f-0000-7000-8000-000000000002',
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:01:00.000Z'),
  });

  assert.equal(resolveOutcomeEventRef({ root, homeDir, ref: first.id.slice(0, 8) }).id, first.id);

  assert.throws(
    () => resolveOutcomeEventRef({ root, homeDir, ref: '018f' }),
    (error) =>
      error instanceof OutcomeRecorderError &&
      error.exitCode === 2 &&
      /ambiguous outcome id prefix/.test(error.message) &&
      error.message.includes(first.id.slice(0, 8)) &&
      error.message.includes(second.id.slice(0, 8)),
  );
});

test('short-id resolver rejects missing ids and mark-of-mark targets', () => {
  const root = makeRoot();
  const homeDir = makeHome();
  const event = emit(root, homeDir, {
    id: '018f1d2e-0000-7000-8000-000000000001',
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });
  const markRecord = mark(root, homeDir, event.id, {
    id: '018f1d2e-0000-7000-8000-000000000101',
    outcome: 'success',
    now: new Date('2026-05-23T08:01:00.000Z'),
  });

  assert.throws(
    () => resolveOutcomeEventRef({ root, homeDir, ref: '018f1d2e-0000-7000-8000-000000000999' }),
    (error) =>
      error instanceof OutcomeRecorderError &&
      error.exitCode === 4 &&
      /event .* not found/.test(error.message),
  );

  assert.throws(
    () => resolveOutcomeEventRef({ root, homeDir, ref: markRecord.id.slice(0, 35) }),
    (error) =>
      error instanceof OutcomeRecorderError &&
      error.exitCode === 2 &&
      /marks cannot target mark records/.test(error.message),
  );
});
