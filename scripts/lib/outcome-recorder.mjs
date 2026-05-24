import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { SCHEMA_VERSION, SURFACES, VERBS, validateRecord } from './outcome-schema.mjs';

const RETENTION_DAYS = 90;
const RETENTION_RECORDS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REPORT_VERSION = '0.1';
const EVENTS_VERSION = '0.1';
const GATE_REPORT_VERSION = '0.1';
const GATE_WINDOW_DAYS = 60;
const GATE_WINDOW_MS = GATE_WINDOW_DAYS * DAY_MS;
const GRAPHIFY_MIN_COUNT = 3;
const GRAPHIFY_MIN_SHARE = 0.2;
const ECC_MIN_DENOMINATOR = 20;
const ECC_MIN_REPEATED_COUNT = 5;
const SAFETY_MIN_COUNT = 3;
const GATE_STATUS = {
  disabled: 'disabled',
  insufficientData: 'insufficient_data',
  notTriggered: 'not_triggered',
  triggered: 'triggered',
};
const USER_STORE_UNAVAILABLE_CODES = new Set([
  'EACCES',
  'EEXIST',
  'EISDIR',
  'ENOTDIR',
  'EPERM',
  'EROFS',
]);

export class OutcomeRecorderError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'OutcomeRecorderError';
    this.exitCode = exitCode;
  }
}

export function canonicalRoot(root = process.cwd()) {
  return realpathSync(resolve(root));
}

export function projectHashForRoot(root) {
  return createHash('sha256').update(canonicalRoot(root)).digest('hex').slice(0, 12);
}

export function uuidV7(now = new Date()) {
  return formatUuidV7(now, randomBytes(10));
}

export function mintUuidV7(date, entropySeed) {
  if (typeof entropySeed !== 'string' || entropySeed.trim() === '') {
    throw new OutcomeRecorderError('entropySeed must be a non-empty string', 2);
  }

  const entropy = createHash('sha256').update(entropySeed).digest().subarray(0, 10);
  return formatUuidV7(date, entropy);
}

function formatUuidV7(date, entropy) {
  const timestamp = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(timestamp.getTime())) {
    throw new OutcomeRecorderError('date must be a valid date', 2);
  }

  const timestampHex = BigInt(timestamp.getTime()).toString(16).padStart(12, '0').slice(-12);
  const randA = ((entropy[0] << 8) | entropy[1]) & 0x0fff;
  const part3 = (0x7000 | randA).toString(16).padStart(4, '0');
  const part4 =
    ((entropy[2] & 0x3f) | 0x80).toString(16).padStart(2, '0') +
    entropy[3].toString(16).padStart(2, '0');
  const part5 = [...entropy.slice(4, 10)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8)}-${part3}-${part4}-${part5}`;
}

export function outcomeStorePath({ root = process.cwd(), homeDir = homedir(), store = 'user' }) {
  const canonical = canonicalRoot(root);
  if (store === 'project') {
    const dir = join(canonical, '.agent-trigger-kit', 'outcomes');
    return {
      store,
      projectHash: projectHashForRoot(canonical),
      dir,
      eventsPath: join(dir, 'events.jsonl'),
    };
  }

  if (store !== 'user') {
    throw new OutcomeRecorderError(`unsupported outcome store: ${store}`, 2);
  }

  const projectHash = projectHashForRoot(canonical);
  const dir = join(homeDir, '.agent-trigger-kit', 'outcomes', projectHash);
  return {
    store,
    projectHash,
    dir,
    eventsPath: join(dir, 'events.jsonl'),
  };
}

export function recordOutcomeEvent(options = {}) {
  const now = options.now || new Date();
  const store = outcomeStorePath(options);
  const failureCategory = optionValue(options, 'failureCategory', 'failure_category');
  const failureDriver = optionValue(options, 'failureDriver', 'failure_driver');
  const exitCode = optionValue(options, 'exitCode', 'exit_code');
  const durationMs = optionValue(options, 'durationMs', 'duration_ms');
  const errorCode = optionValue(options, 'errorCode', 'error_code');
  const projectHash = optionValue(options, 'projectHash', 'project_hash') || store.projectHash;
  const correlationId = optionValue(options, 'correlationId', 'correlation_id');
  const relatedId = optionValue(options, 'relatedId', 'related_id');

  const record = validateOutcomeRecord(
    compact({
      id: options.id || uuidV7(now),
      schema_version: SCHEMA_VERSION,
      kind: 'event',
      ts: isoUtc(now, 'ts'),
      verb: requiredString(options.verb, 'verb'),
      outcome: requiredString(options.outcome, 'outcome'),
      surface: options.surface || 'external',
      exit_code: exitCode === undefined ? undefined : nonNegativeInteger(exitCode, 'exitCode'),
      duration_ms:
        durationMs === undefined ? undefined : nonNegativeInteger(durationMs, 'durationMs'),
      failure_category:
        failureCategory === undefined
          ? undefined
          : requiredString(failureCategory, 'failureCategory'),
      failure_driver:
        failureDriver === undefined ? undefined : requiredString(failureDriver, 'failureDriver'),
      error_code: errorCode === undefined ? undefined : requiredString(errorCode, 'errorCode'),
      project_hash: requiredString(projectHash, 'projectHash'),
      plugin: options.plugin === undefined ? undefined : requiredString(options.plugin, 'plugin'),
      correlation_id:
        correlationId === undefined ? undefined : requiredString(correlationId, 'correlationId'),
      related_id: relatedId === undefined ? undefined : requiredString(relatedId, 'relatedId'),
      note: options.note === undefined ? undefined : requiredString(options.note, 'note'),
    }),
  );

  appendRecord({ store, record, now });
  return { record, storePath: store.eventsPath };
}

export function markOutcomeEvent(options = {}) {
  const now = options.now || new Date();
  const store = outcomeStorePath(options);
  const relatedId = optionValue(options, 'relatedId', 'related_id', 'eventId');
  const failureCategory = optionValue(options, 'failureCategory', 'failure_category');
  const failureDriver = optionValue(options, 'failureDriver', 'failure_driver');
  const errorCode = optionValue(options, 'errorCode', 'error_code');
  const correlationId = optionValue(options, 'correlationId', 'correlation_id');
  const records = readOutcomeRecords(store.eventsPath);
  const event = records.find((record) => record.kind === 'event' && record.id === relatedId);

  if (!event) {
    throw new OutcomeRecorderError(
      `event ${relatedId} not found; it may have expired under the retention policy`,
      4,
    );
  }

  if (options.verb !== undefined && options.verb !== event.verb) {
    throw new OutcomeRecorderError('mark verb must match related event verb', 2);
  }

  const record = validateOutcomeRecord(
    compact({
      id: options.id || uuidV7(now),
      schema_version: SCHEMA_VERSION,
      kind: 'mark',
      ts: isoUtc(now, 'ts'),
      verb: event.verb,
      outcome: requiredString(options.outcome, 'outcome'),
      surface: options.surface || event.surface,
      failure_category:
        failureCategory === undefined
          ? undefined
          : requiredString(failureCategory, 'failureCategory'),
      failure_driver:
        failureDriver === undefined ? undefined : requiredString(failureDriver, 'failureDriver'),
      error_code: errorCode === undefined ? undefined : requiredString(errorCode, 'errorCode'),
      project_hash: event.project_hash,
      plugin: event.plugin,
      correlation_id: correlationId || event.correlation_id,
      related_id: requiredString(relatedId, 'relatedId'),
      note:
        options.note === undefined && options.reason === undefined
          ? undefined
          : requiredString(options.note ?? options.reason, 'note'),
    }),
  );

  appendRecord({ store, record, now });
  return { record, storePath: store.eventsPath };
}

export function listOutcomeEvents({
  root = process.cwd(),
  homeDir = homedir(),
  store = 'user',
  recent = 20,
  verb,
  surface,
  unmarked = false,
  now = new Date(),
} = {}) {
  const selectedStore = outcomeStorePath({ root, homeDir, store });
  const records = readOutcomeRecords(selectedStore.eventsPath);
  const recentCount = positiveInteger(recent, 'recent');
  const verbFilter = reportEnum(verb, VERBS, 'verb');
  const surfaceFilter = reportEnum(surface, SURFACES, 'surface');
  const marksByEventId = marksByRelatedId(records);
  const events = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.kind === 'event')
    .filter(({ record }) => !verbFilter || record.verb === verbFilter)
    .filter(({ record }) => !surfaceFilter || record.surface === surfaceFilter)
    .filter(({ record }) => !unmarked || !marksByEventId.has(record.id))
    .sort(compareEventEntriesNewestFirst)
    .slice(0, recentCount)
    .map(({ record }) => eventListRow(record, marksByEventId.get(record.id)));

  return {
    schema_version: SCHEMA_VERSION,
    events_version: EVENTS_VERSION,
    generated_at: now.toISOString(),
    project_hash: selectedStore.projectHash,
    store: selectedStore.store,
    filters: {
      recent: recentCount,
      verb: verbFilter,
      surface: surfaceFilter,
      unmarked: Boolean(unmarked),
    },
    events,
  };
}

export function resolveOutcomeEventRef({
  root = process.cwd(),
  homeDir = homedir(),
  store = 'user',
  ref,
} = {}) {
  const selectedStore = outcomeStorePath({ root, homeDir, store });
  const normalized = normalizeOutcomeRef(ref);
  const matches = readOutcomeRecords(selectedStore.eventsPath).filter((record) =>
    record.id.toLowerCase().startsWith(normalized),
  );

  if (matches.length === 0) {
    throw new OutcomeRecorderError(
      `event ${ref} not found; it may have expired under the retention policy`,
      4,
    );
  }

  if (matches.length > 1) {
    throw new OutcomeRecorderError(
      `ambiguous outcome id prefix ${ref}; candidates: ${matches.map(formatOutcomeCandidate).join(', ')}`,
      2,
    );
  }

  const [match] = matches;
  if (match.kind === 'mark') {
    throw new OutcomeRecorderError(
      `marks cannot target mark records (${shortId(match.id)}); write a new mark for the related event`,
      2,
    );
  }

  return match;
}

export function selectLatestUnmarkedOutcomeEvent({
  root = process.cwd(),
  homeDir = homedir(),
  store = 'user',
  verb,
} = {}) {
  const selectedStore = outcomeStorePath({ root, homeDir, store });
  const records = readOutcomeRecords(selectedStore.eventsPath);
  const verbFilter = reportEnum(verb, VERBS, 'verb');
  const marksByEventId = marksByRelatedId(records);
  const [selected] = records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => record.kind === 'event')
    .filter(({ record }) => !verbFilter || record.verb === verbFilter)
    .filter(({ record }) => !marksByEventId.has(record.id))
    .sort(compareEventEntriesNewestFirst);

  if (!selected) {
    throw new OutcomeRecorderError(
      `no unmarked outcome event found${verbFilter ? ` for verb ${verbFilter}` : ''}`,
      4,
    );
  }

  return selected.record;
}

export function buildOutcomeReport(options = {}) {
  const {
    root = process.cwd(),
    homeDir = homedir(),
    store = 'user',
    windowDays,
    since,
    surface,
    verb,
    now = new Date(),
  } = options;
  const selectedStore = outcomeStorePath({ root, homeDir, store });
  const records = readOutcomeRecords(selectedStore.eventsPath);
  const events = records.filter((record) => record.kind === 'event');
  const marks = records.filter((record) => record.kind === 'mark');
  const sinceIso = reportSince({ since, windowDays, now });
  const sinceMs = sinceIso === null ? null : new Date(sinceIso).getTime();
  const surfaceFilter = reportEnum(surface, SURFACES, 'surface');
  const verbFilter = reportEnum(verb, VERBS, 'verb');
  const latestMarkByRelatedId = latestMarksByRelatedId(marks);
  const latestGateMarkByRelatedId = latestMarksByRelatedId(marks, { now });
  const gateRows = [];
  const effectiveRows = [];
  for (const event of events) {
    const gateMark = latestGateMarkByRelatedId.get(event.id) || null;
    const gateEffective = effectiveOutcomeEvent(event, gateMark);
    if (!surfaceFilter || gateEffective.surface === surfaceFilter) {
      if (!verbFilter || gateEffective.verb === verbFilter) {
        gateRows.push({ event, mark: gateMark, effective: gateEffective });
      }
    }

    const mark = latestMarkByRelatedId.get(event.id) || null;
    const effective = effectiveOutcomeEvent(event, mark);
    if (surfaceFilter && effective.surface !== surfaceFilter) continue;
    if (verbFilter && effective.verb !== verbFilter) continue;
    if (sinceMs !== null && new Date(event.ts).getTime() < sinceMs) continue;
    effectiveRows.push({ event, mark, effective });
  }
  const effectiveEvents = effectiveRows.map((row) => row.effective);

  return buildReportObject({
    now,
    selectedStore,
    sinceIso,
    surface: surfaceFilter,
    verb: verbFilter,
    eventsRead: events.length,
    marksRead: marks.length,
    effectiveEvents,
    gateRows,
    includeGates: options.gates === true,
  });
}

export function readOutcomeRecords(eventsPath) {
  if (!existsSync(eventsPath)) return [];
  const text = readFileSync(eventsPath, 'utf8');
  const records = [];

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      logSchemaError(index + 1, `invalid JSON (${error.message})`);
      continue;
    }

    const result = validateRecord(parsed);
    if (!result.ok) {
      logSchemaError(index + 1, result.errors.join('; '));
      continue;
    }

    records.push(parsed);
  }

  return records;
}

export function autoOutcomeDisabled(args = {}, env = process.env) {
  return env.AGENT_TRIGGER_KIT_OUTCOME_DISABLED === '1' || args['no-outcome'] === true;
}

export function recordOutcomeSafely(options = {}) {
  const recordOptions = options.now === undefined ? { ...options, now: new Date() } : options;
  try {
    return recordOutcomeEvent(recordOptions);
  } catch (error) {
    if (shouldFallbackToProjectStore(recordOptions, error)) {
      try {
        return recordOutcomeEvent({ ...recordOptions, store: 'project' });
      } catch (fallbackError) {
        console.error(`outcome recording failed: ${fallbackError.message}`);
        return null;
      }
    }

    console.error(`outcome recording failed: ${error.message}`);
    return null;
  }
}

function shouldFallbackToProjectStore(options, error) {
  const store = options.store || 'user';
  return store === 'user' && USER_STORE_UNAVAILABLE_CODES.has(error?.code);
}

function appendRecord({ store, record, now }) {
  ensureStore(store);
  const entries = readOutcomeLineEntries(store.eventsPath);
  const retained = retainRecordEntries([...entries, recordLineEntry(record)], now);
  const content = retained.map((entry) => entry.line).join('\n');
  writeFileSync(store.eventsPath, `${content}\n`);
}

function ensureStore(store) {
  mkdirSync(store.dir, { recursive: true });
  if (store.store === 'project') {
    const gitignorePath = join(store.dir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '*\n!.gitignore\n');
    }
  }
}

function retainRecordEntries(entries, now) {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const retainedRecords = new Set(
    entries
      .filter((entry) => entry.record && recordTimeMs(entry.record) >= cutoff)
      .slice(-RETENTION_RECORDS),
  );

  return entries.filter((entry) => !entry.record || retainedRecords.has(entry));
}

function recordTimeMs(record) {
  const timestamp = new Date(record.ts).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new OutcomeRecorderError(`${label} must be a positive integer`, 2);
  }
  return number;
}

function marksByRelatedId(records) {
  const marks = new Map();
  for (const record of records) {
    if (record.kind !== 'mark') continue;
    const bucket = marks.get(record.related_id) || [];
    bucket.push(record);
    marks.set(record.related_id, bucket);
  }
  return marks;
}

function compareEventEntriesNewestFirst(a, b) {
  const time = new Date(b.record.ts).getTime() - new Date(a.record.ts).getTime();
  return time || b.index - a.index;
}

function eventListRow(event, marks = []) {
  const latestMark = latestRecordByTs(marks);
  return {
    id: event.id,
    short_id: shortId(event.id),
    ts: event.ts,
    verb: event.verb,
    outcome: event.outcome,
    surface: event.surface,
    failure_category: event.failure_category || null,
    failure_driver: event.failure_driver || null,
    plugin: event.plugin || null,
    marked: marks.length > 0,
    mark_count: marks.length,
    latest_mark_ts: latestMark ? latestMark.ts : null,
  };
}

function latestRecordByTs(records) {
  let latest = null;
  for (const record of records) {
    if (!latest || new Date(record.ts).getTime() >= new Date(latest.ts).getTime()) {
      latest = record;
    }
  }
  return latest;
}

function normalizeOutcomeRef(ref) {
  if (typeof ref !== 'string' || !/^[0-9a-f-]{4,36}$/i.test(ref)) {
    throw new OutcomeRecorderError('event id prefix must be 4 to 36 UUID characters', 2);
  }
  return ref.toLowerCase();
}

function shortId(id) {
  return id.slice(0, 8);
}

function formatOutcomeCandidate(record) {
  return [
    shortId(record.id),
    record.kind,
    record.ts,
    record.verb,
    record.outcome,
    record.surface,
  ].join(' ');
}

function reportSince({ since, windowDays, now }) {
  if (since !== undefined && since !== null) {
    return utcIsoString(since, 'since');
  }

  if (windowDays === undefined || windowDays === null) {
    return null;
  }

  const days = Number(windowDays);
  if (!Number.isFinite(days) || days < 0) {
    throw new OutcomeRecorderError('windowDays must be a non-negative number', 2);
  }

  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function reportEnum(value, allowed, label) {
  if (value === undefined || value === null) return null;
  if (!allowed.includes(value)) {
    throw new OutcomeRecorderError(`${label} must be one of ${allowed.join(', ')}`, 2);
  }
  return value;
}

function effectiveOutcomeEvent(event, mark) {
  if (!mark) return event;

  return compact({
    ...event,
    outcome: mark.outcome,
    surface: mark.surface,
    failure_category: mark.outcome === 'failure' ? mark.failure_category : undefined,
    failure_driver: mark.failure_driver,
    error_code: mark.error_code,
    plugin: mark.plugin || event.plugin,
    note: mark.note ?? event.note,
  });
}

function buildReportObject({
  now,
  selectedStore,
  sinceIso,
  surface,
  verb,
  eventsRead,
  marksRead,
  effectiveEvents,
  gateRows,
  includeGates,
}) {
  const propagationCounts = outcomeCounts();
  const surfaceRows = new Map();
  const failureCategories = new Map();

  for (const event of effectiveEvents) {
    propagationCounts[event.outcome] += 1;
    const surfaceRow = surfaceRows.get(event.surface) || surfaceCounts(event.surface);
    surfaceRow[event.outcome] += 1;
    surfaceRows.set(event.surface, surfaceRow);

    if (event.outcome === 'failure') {
      incrementMap(failureCategories, event.failure_category);
    }
  }

  const signalEvents =
    propagationCounts.success + propagationCounts.failure + propagationCounts.blocked;
  const totalFailures = propagationCounts.failure;

  const report = {
    schema_version: SCHEMA_VERSION,
    report_version: REPORT_VERSION,
    generated_at: now.toISOString(),
    project_hash: selectedStore.projectHash,
    store: selectedStore.store,
    scope: {
      since: sinceIso,
      surface,
      verb,
      retained_records_only: true,
      retention_horizon_days: RETENTION_DAYS,
      retention_record_limit: RETENTION_RECORDS,
    },
    totals: {
      events_read: eventsRead,
      marks_read: marksRead,
      effective_events: effectiveEvents.length,
      signal_events: signalEvents,
      skipped_events: propagationCounts.skipped,
    },
    propagation: {
      status: signalEvents === 0 ? 'no_signal' : 'ok',
      success: propagationCounts.success,
      failure: propagationCounts.failure,
      blocked: propagationCounts.blocked,
      skipped: propagationCounts.skipped,
      denominator: signalEvents,
      success_rate: rate(propagationCounts.success, signalEvents),
      failure_rate: rate(propagationCounts.failure, signalEvents),
      blocked_rate: rate(propagationCounts.blocked, signalEvents),
    },
    by_surface: [...surfaceRows.values()].map(finalizeSurfaceRow).sort(compareSurfaceRows),
    by_failure_category: [...failureCategories.entries()]
      .map(([category, count]) => ({
        failure_category: category,
        count,
        share_of_failures: rate(count, totalFailures),
      }))
      .sort((a, b) => b.count - a.count || a.failure_category.localeCompare(b.failure_category)),
  };

  if (includeGates) {
    report.gate_report_version = GATE_REPORT_VERSION;
    report.gates = buildGateSummary({ now, effectiveRows: gateRows });
  }

  return report;
}

function buildGateSummary({ now, effectiveRows }) {
  const windowStart = new Date(now.getTime() - GATE_WINDOW_MS);
  const rows = effectiveRows.filter(({ event }) => {
    const eventMs = new Date(event.ts).getTime();
    return eventMs >= windowStart.getTime() && eventMs <= now.getTime();
  });
  const markedRows = rows.filter((row) => row.mark);
  const markedFailures = markedRows.filter(({ effective }) => effective.outcome === 'failure');
  const markedSkipped = markedRows.filter(({ effective }) => effective.outcome === 'skipped');
  const eccCandidates = buildEccCandidates(markedFailures);
  const repeatedEccCandidates = eccCandidates.filter((candidate) => candidate.count >= 2);
  const topEcc = repeatedEccCandidates[0] || null;

  return {
    window: {
      anchor: 'event_ts',
      days: GATE_WINDOW_DAYS,
      start: windowStart.toISOString(),
      end: now.toISOString(),
      mark_policy: 'latest_retained_mark_at_report_time',
    },
    marked_event_counts: {
      marked_events: markedRows.length,
      marked_failures: markedFailures.length,
      marked_skipped: markedSkipped.length,
      unmarked_events: rows.length - markedRows.length,
    },
    graphify: graphifyGate(markedFailures),
    ecc: eccGate({
      markedRows,
      candidatePool: eccCandidates.reduce((total, candidate) => total + candidate.count, 0),
      repeatedCandidates: repeatedEccCandidates,
      topCandidate: topEcc,
    }),
    safety: safetyGate(markedFailures),
    diagnostics: {
      schema_gaps: [
        'graphify requires a context-bloat evidence axis not present in schema v0.1',
        'safety requires a mutation or safety denominator not present in schema v0.1',
      ],
      prerequisites: [
        'docs vocabulary alignment from pre-v0.1 terms to schema v0.1 terms',
        'recorder translation audit for camelCase caller options to snake_case records',
      ],
    },
  };
}

function graphifyGate(markedFailures) {
  return {
    status: GATE_STATUS.disabled,
    disabled_reason: 'schema_gap.context_bloat_axis_missing',
    denominator_family: 'marked_failure_signal_events',
    denominator: markedFailures.length,
    numerator: null,
    threshold: {
      minimum_count: GRAPHIFY_MIN_COUNT,
      minimum_share: GRAPHIFY_MIN_SHARE,
    },
  };
}

function eccGate({ markedRows, candidatePool, repeatedCandidates, topCandidate }) {
  const denominator = markedRows.length;
  const numerator = topCandidate?.count || 0;
  const base = {
    status: eccStatus({ denominator, numerator }),
    denominator_family: 'all_marked_events',
    denominator,
    numerator,
    candidate_pool: candidatePool,
    threshold: {
      minimum_repeated_count: ECC_MIN_REPEATED_COUNT,
    },
    repetition_key: ['failure_category', 'plugin', 'surface'],
    top_candidates: repeatedCandidates.slice(0, 5),
  };

  if (denominator < ECC_MIN_DENOMINATOR) {
    base.eligibility = {
      required_denominator: ECC_MIN_DENOMINATOR,
      actual_denominator: denominator,
      missing_denominator: ECC_MIN_DENOMINATOR - denominator,
    };
  }

  return base;
}

function eccStatus({ denominator, numerator }) {
  if (denominator < ECC_MIN_DENOMINATOR) return GATE_STATUS.insufficientData;
  return numerator >= ECC_MIN_REPEATED_COUNT ? GATE_STATUS.triggered : GATE_STATUS.notTriggered;
}

function safetyGate(markedFailures) {
  return {
    status: GATE_STATUS.disabled,
    disabled_reason: 'schema_gap.mutation_axis_missing',
    denominator_family: 'marked_mutation_or_safety_events',
    denominator: null,
    numerator: null,
    threshold: {
      minimum_count: SAFETY_MIN_COUNT,
    },
    auditable_partial_counts: {
      release_policy_gap_failures: markedFailures.filter(
        ({ effective }) => effective.failure_category === 'release_policy_gap',
      ).length,
      surface_residue_failures: markedFailures.filter(
        ({ effective }) => effective.failure_category === 'surface_residue',
      ).length,
    },
  };
}

function buildEccCandidates(markedFailures) {
  const buckets = new Map();
  for (const { effective } of markedFailures) {
    if (
      typeof effective.failure_category !== 'string' ||
      effective.failure_category.trim() === ''
    ) {
      continue;
    }
    const key = [effective.failure_category, effective.plugin || null, effective.surface].join(
      '\0',
    );
    const bucket = buckets.get(key) || {
      key: {
        failure_category: effective.failure_category,
        plugin: effective.plugin || null,
        surface: effective.surface,
      },
      count: 0,
      failure_driver_breakdown: {},
      driver_policy: 'wildcard',
      rule_suggestion_basis: '',
    };
    bucket.count += 1;
    if (effective.failure_driver) {
      bucket.failure_driver_breakdown[effective.failure_driver] =
        (bucket.failure_driver_breakdown[effective.failure_driver] || 0) + 1;
    }
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .map((candidate) => ({
      ...candidate,
      failure_driver_breakdown: sortObjectByKey(candidate.failure_driver_breakdown),
      rule_suggestion_basis: eccRuleSuggestionBasis(candidate),
    }))
    .sort(compareEccCandidates);
}

function eccRuleSuggestionBasis(candidate) {
  return `Repeated ${candidate.key.failure_category} failures for plugin ${candidate.key.plugin || 'unknown'} on ${candidate.key.surface} regardless of driver; inspect driver breakdown before writing a narrow rule.`;
}

function compareEccCandidates(a, b) {
  return (
    b.count - a.count ||
    a.key.failure_category.localeCompare(b.key.failure_category) ||
    String(a.key.plugin || '').localeCompare(String(b.key.plugin || '')) ||
    a.key.surface.localeCompare(b.key.surface)
  );
}

function sortObjectByKey(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function outcomeCounts() {
  return { success: 0, failure: 0, blocked: 0, skipped: 0 };
}

function surfaceCounts(surface) {
  return { surface, ...outcomeCounts() };
}

function finalizeSurfaceRow(row) {
  const signalEvents = row.success + row.failure + row.blocked;
  return {
    surface: row.surface,
    signal_events: signalEvents,
    success: row.success,
    failure: row.failure,
    blocked: row.blocked,
    skipped: row.skipped,
    success_rate: rate(row.success, signalEvents),
    failure_rate: rate(row.failure, signalEvents),
    blocked_rate: rate(row.blocked, signalEvents),
  };
}

function compareSurfaceRows(a, b) {
  return (
    nullLast(a.success_rate, b.success_rate) ||
    b.failure + b.blocked - (a.failure + a.blocked) ||
    a.surface.localeCompare(b.surface)
  );
}

function nullLast(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function rate(numerator, denominator) {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function validateOutcomeRecord(record) {
  const result = validateRecord(record);
  if (!result.ok) {
    throw new OutcomeRecorderError(result.errors.join('; '), 2);
  }

  return record;
}

function readOutcomeLineEntries(eventsPath) {
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const record = parseValidOutcomeLine(line);
      return { line, record };
    });
}

function recordLineEntry(record) {
  return {
    line: JSON.stringify(record),
    record,
  };
}

function parseValidOutcomeLine(line) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  return validateRecord(parsed).ok ? parsed : null;
}

function latestMarksByRelatedId(marks, { now } = {}) {
  const latest = new Map();
  const nowMs = now === undefined ? null : now.getTime();
  for (const mark of marks) {
    const markMs = new Date(mark.ts).getTime();
    if (nowMs !== null && markMs > nowMs) continue;
    const previous = latest.get(mark.related_id);
    if (!previous || markMs >= new Date(previous.ts).getTime()) {
      latest.set(mark.related_id, mark);
    }
  }
  return latest;
}

function optionValue(options, ...names) {
  for (const name of names) {
    if (options[name] !== undefined) return options[name];
  }
  return undefined;
}

function compact(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null),
  );
}

function isoUtc(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new OutcomeRecorderError(`${label} must be a valid date`, 2);
  }

  return date.toISOString();
}

function utcIsoString(value, label) {
  if (value instanceof Date) {
    return isoUtc(value, label);
  }

  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    throw new OutcomeRecorderError(`${label} must be a UTC ISO8601 string ending in Z`, 2);
  }

  return new Date(value).toISOString();
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OutcomeRecorderError(`${label} must be a non-empty string`, 2);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new OutcomeRecorderError(`${label} must be a non-negative integer`, 2);
  }
  return value;
}

function logSchemaError(line, reason) {
  console.error(`outcome.schema_error: line=${line} reason=${oneLine(reason)}`);
}

function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

function incrementMap(bucket, key) {
  bucket.set(key, (bucket.get(key) || 0) + 1);
}
