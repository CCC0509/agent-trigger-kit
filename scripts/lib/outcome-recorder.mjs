import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { SCHEMA_VERSION, validateRecord } from './outcome-schema.mjs';

const RETENTION_DAYS = 90;
const RETENTION_RECORDS = 1000;

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
    (record) => record.kind === 'event' && new Date(record.ts).getTime() >= cutoff,
  );
  const marks = records.filter(
    (record) => record.kind === 'mark' && new Date(record.ts).getTime() >= cutoff,
  );
  const latestMarkByRelatedId = latestMarksByRelatedId(marks);

  const report = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    projectHash: selectedStore.projectHash,
    windowDays: Number(windowDays),
    totalEvents: events.length,
    totalMarks: marks.length,
    byFailureCategory: {},
    byFailureDriver: {},
    byPlugin: {},
    bySurface: {},
    byVerb: {},
    byOutcome: {},
    byMarkOutcome: {},
  };

  for (const mark of marks) {
    increment(report.byMarkOutcome, mark.outcome);
  }

  for (const event of events) {
    const effective = latestMarkByRelatedId.get(event.id) || event;
    increment(report.byPlugin, event.plugin || effective.plugin || 'unknown');
    increment(report.bySurface, effective.surface);
    increment(report.byVerb, effective.verb);
    increment(report.byOutcome, effective.outcome);

    if (effective.outcome === 'failure') {
      increment(report.byFailureCategory, effective.failure_category);
      if (effective.failure_driver) {
        increment(report.byFailureDriver, effective.failure_driver);
      }
    }
  }

  return report;
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

export function recordOutcomeSafely(options) {
  try {
    return recordOutcomeEvent(options);
  } catch (error) {
    console.error(`outcome recording failed: ${error.message}`);
    return null;
  }
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

function latestMarksByRelatedId(marks) {
  const latest = new Map();
  for (const mark of marks) {
    const previous = latest.get(mark.related_id);
    if (!previous || new Date(mark.ts).getTime() >= new Date(previous.ts).getTime()) {
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

function increment(bucket, key) {
  bucket[key] = (bucket[key] || 0) + 1;
}
