import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MAX_RECORD_BYTES = 1024;
const RETENTION_DAYS = 90;
const RETENTION_RECORDS = 1000;

const SURFACES = new Set(['codex', 'claude', 'cursor', 'repo', 'unknown']);
const OPERATION_KINDS = new Set([
  'static_check',
  'live_check',
  'generation',
  'cleanup',
  'mutation',
  'manual',
]);
const FAILURE_CATEGORIES = new Set([
  'cache_stale',
  'version_mismatch',
  'surface_missing',
  'surface_drift',
  'surface_residue',
  'release_policy_gap',
  'misroute',
  'unknown',
]);
const FAILURE_DRIVERS = new Set([
  'propagation',
  'context_bloat',
  'discovery',
  'runtime_trust',
  'other',
]);
const OUTCOMES = new Set(['ok', 'fail', 'unknown']);
const MARK_RESULTS = new Set(['success', 'failed', 'misroute']);

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
  const timestampHex = BigInt(now.getTime()).toString(16).padStart(12, '0').slice(-12);
  const random = randomBytes(10);
  const randA = ((random[0] << 8) | random[1]) & 0x0fff;
  const part3 = (0x7000 | randA).toString(16).padStart(4, '0');
  const part4 =
    ((random[2] & 0x3f) | 0x80).toString(16).padStart(2, '0') +
    random[3].toString(16).padStart(2, '0');
  const part5 = [...random.slice(4, 10)]
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

export function recordOutcomeEvent(options) {
  const now = options.now || new Date();
  const store = outcomeStorePath(options);
  const record = validateEventRecord({
    schemaVersion: 1,
    recordType: 'event',
    eventId: options.eventId || uuidV7(now),
    recordedAt: isoUtc(now, 'recordedAt'),
    projectHash: store.projectHash,
    plugin: requiredString(options.plugin, 'plugin'),
    surface: options.surface || 'unknown',
    operationKind: options.operationKind || 'manual',
    durationMs: nonNegativeInteger(options.durationMs ?? 0, 'durationMs'),
    failureCategory: options.failureCategory || 'unknown',
    failureDriver: options.failureDriver || 'other',
    outcome: options.outcome || 'unknown',
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  });

  appendRecord({ store, record, now });
  return { record, storePath: store.eventsPath };
}

export function markOutcomeEvent(options) {
  const now = options.now || new Date();
  const store = outcomeStorePath(options);
  const records = readOutcomeRecords(store.eventsPath);
  if (
    !records.some((record) => record.recordType === 'event' && record.eventId === options.eventId)
  ) {
    throw new OutcomeRecorderError(
      `event ${options.eventId} not found; it may have expired under the retention policy`,
      4,
    );
  }

  const record = validateMarkRecord({
    schemaVersion: 1,
    recordType: 'mark',
    eventId: requiredString(options.eventId, 'eventId'),
    markedAt: isoUtc(now, 'markedAt'),
    result: options.result,
    ...(options.failureCategory ? { failureCategory: options.failureCategory } : {}),
    ...(options.failureDriver ? { failureDriver: options.failureDriver } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
  });

  appendRecord({ store, record, now, existingRecords: records });
  return { record, storePath: store.eventsPath };
}

export function buildOutcomeReport({
  root = process.cwd(),
  homeDir = homedir(),
  store = 'user',
  windowDays = 60,
  now = new Date(),
} = {}) {
  const selectedStore = outcomeStorePath({ root, homeDir, store });
  const records = readOutcomeRecords(selectedStore.eventsPath);
  const windowMs = Number(windowDays) * 24 * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  const events = records.filter(
    (record) => record.recordType === 'event' && new Date(record.recordedAt).getTime() >= cutoff,
  );
  const marks = records.filter(
    (record) => record.recordType === 'mark' && new Date(record.markedAt).getTime() >= cutoff,
  );
  const latestMarkByEventId = new Map();
  for (const mark of marks) {
    latestMarkByEventId.set(mark.eventId, mark);
  }

  const report = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    projectHash: selectedStore.projectHash,
    windowDays: Number(windowDays),
    totalEvents: events.length,
    totalMarks: marks.length,
    byFailureCategory: {},
    byFailureDriver: {},
    byPlugin: {},
    bySurface: {},
    byOperationKind: {},
    byOutcome: {},
    byMarkResult: {},
  };

  for (const mark of marks) {
    increment(report.byMarkResult, mark.result);
  }

  for (const event of events) {
    increment(report.byPlugin, event.plugin);
    increment(report.bySurface, event.surface);
    increment(report.byOperationKind, event.operationKind);
    increment(report.byOutcome, event.outcome || 'unknown');

    const mark = latestMarkByEventId.get(event.eventId);
    if (mark?.result === 'success') continue;
    if (mark?.result === 'failed' || mark?.result === 'misroute') {
      increment(report.byFailureCategory, mark.failureCategory);
      increment(report.byFailureDriver, mark.failureDriver);
    } else if ((event.outcome || 'unknown') === 'fail') {
      increment(report.byFailureCategory, event.failureCategory);
      increment(report.byFailureDriver, event.failureDriver);
    }
  }

  return report;
}

export function readOutcomeRecords(eventsPath) {
  if (!existsSync(eventsPath)) return [];
  const text = readFileSync(eventsPath, 'utf8');
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new OutcomeRecorderError(
          `${eventsPath}:${index + 1}: invalid JSONL record (${error.message})`,
        );
      }
    });
}

export function autoOutcomeDisabled(args = {}, env = process.env) {
  return env.AGENT_TRIGGER_KIT_OUTCOME_DISABLED === '1' || args['no-outcome'] === true;
}

export function recordOutcomeSafely(options) {
  try {
    return recordOutcomeEvent(options);
  } catch (error) {
    console.error(`outcome recording failed: ${error.message}`);
    return null;
  }
}

function appendRecord({ store, record, now, existingRecords = null }) {
  const line = JSON.stringify(record);
  if (Buffer.byteLength(`${line}\n`, 'utf8') > MAX_RECORD_BYTES) {
    throw new OutcomeRecorderError(`outcome record exceeds ${MAX_RECORD_BYTES} bytes`, 2);
  }

  ensureStore(store);
  const records = existingRecords || readOutcomeRecords(store.eventsPath);
  const retained = retainRecords([...records, record], now);
  writeFileSync(store.eventsPath, `${retained.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
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

function retainRecords(records, now) {
  const cutoff = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return records.filter((record) => recordTimeMs(record) >= cutoff).slice(-RETENTION_RECORDS);
}

function recordTimeMs(record) {
  const timestamp = record.recordedAt || record.markedAt;
  return new Date(timestamp).getTime();
}

function validateEventRecord(record) {
  assertValue(record.schemaVersion === 1, 'schemaVersion must be 1');
  assertValue(record.recordType === 'event', 'recordType must be event');
  requiredString(record.eventId, 'eventId');
  isoUtc(record.recordedAt, 'recordedAt');
  requiredString(record.projectHash, 'projectHash');
  requiredString(record.plugin, 'plugin');
  enumValue(record.surface, SURFACES, 'surface');
  enumValue(record.operationKind, OPERATION_KINDS, 'operationKind');
  nonNegativeInteger(record.durationMs, 'durationMs');
  enumValue(record.failureCategory, FAILURE_CATEGORIES, 'failureCategory');
  enumValue(record.failureDriver, FAILURE_DRIVERS, 'failureDriver');
  enumValue(record.outcome || 'unknown', OUTCOMES, 'outcome');
  if (record.correlationId) requiredString(record.correlationId, 'correlationId');
  return record;
}

function validateMarkRecord(record) {
  assertValue(record.schemaVersion === 1, 'schemaVersion must be 1');
  assertValue(record.recordType === 'mark', 'recordType must be mark');
  requiredString(record.eventId, 'eventId');
  isoUtc(record.markedAt, 'markedAt');
  enumValue(record.result, MARK_RESULTS, 'result');

  if (record.result === 'success') {
    if (record.failureCategory || record.failureDriver) {
      throw new OutcomeRecorderError('success marks must not include failure fields', 2);
    }
  } else {
    enumValue(record.failureCategory, FAILURE_CATEGORIES, 'failureCategory');
    enumValue(record.failureDriver, FAILURE_DRIVERS, 'failureDriver');
  }

  if (record.reason !== undefined) {
    requiredString(record.reason, 'reason');
    if (record.reason.length > 200) {
      throw new OutcomeRecorderError('reason must be at most 200 characters', 2);
    }
    if (/[\r\n]/.test(record.reason)) {
      throw new OutcomeRecorderError('reason must be a single line', 2);
    }
  }

  return record;
}

function isoUtc(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  const text = date.toISOString();
  if (!text.endsWith('Z')) {
    throw new OutcomeRecorderError(`${label} must be a UTC ISO8601 timestamp ending in Z`, 2);
  }
  return text;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new OutcomeRecorderError(`${label} must be one of ${[...allowed].join(', ')}`, 2);
  }
  return value;
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

function assertValue(condition, message) {
  if (!condition) {
    throw new OutcomeRecorderError(message, 2);
  }
}

function increment(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}
