#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { parseArgs } from './lib/args.mjs';
import { mintUuidV7, outcomeStorePath } from './lib/outcome-recorder.mjs';
import {
  FAILURE_CATEGORIES,
  FAILURE_DRIVERS,
  OUTCOMES,
  SCHEMA_VERSION,
  SURFACES,
  VERBS,
  validateRecord,
} from './lib/outcome-schema.mjs';

const PUBLIC_SEED = 'docs/data/historical-outcomes-seed.yaml';
const LOCAL_SEED = 'docs/data/historical-outcomes-seed.local.yaml';
const TS_CONFIDENCE = ['exact', 'estimated', 'unknown'];
const AUTO_EVENT_VERBS = [
  'validate',
  'live_check',
  'premerge_version_check',
  'scratch_namespace_check',
];
const ALLOWED_SEED_FIELDS = new Set([
  'incident_id',
  'ts',
  'ts_confidence',
  'verb',
  'surface',
  'outcome',
  'exit_code',
  'failure_category',
  'failure_driver',
  'error_code',
  'project_hash',
  'plugin',
  'note',
]);

const args = parseArgs(process.argv.slice(2));

try {
  const root = resolveRoot(args);
  const storeName = resolveStore(args);
  const seedPath = selectSeedPath(root);
  const entries = loadSeed(seedPath);
  const records = buildBackfillRecords(entries);
  const store = outcomeStorePath({ root, store: storeName });
  const existingIds = readExistingIds(store.eventsPath);
  const newRecords = records.filter((record) => !existingIds.has(record.id));
  appendRecords({ store, records: newRecords });

  console.log(
    [
      `seed=${relative(root, seedPath) || seedPath}`,
      `total=${records.length}`,
      `written=${newRecords.length}`,
      `skipped=${records.length - newRecords.length}`,
    ].join(' '),
  );
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(error.exitCode || 1);
}

function resolveRoot(args) {
  if (Object.hasOwn(args, 'root') && typeof args.root !== 'string') {
    throw validationError('--root requires a path value');
  }

  return resolve(args.root || process.cwd());
}

function resolveStore(args) {
  if (Object.hasOwn(args, 'store') && typeof args.store !== 'string') {
    throw validationError('--store requires a value');
  }

  return args.store || 'user';
}

function selectSeedPath(root) {
  const local = join(root, LOCAL_SEED);
  if (existsSync(local)) return local;

  const publicSeed = join(root, PUBLIC_SEED);
  if (existsSync(publicSeed)) return publicSeed;

  throw validationError(`seed file not found: ${PUBLIC_SEED}`);
}

function loadSeed(seedPath) {
  let parsed;
  try {
    parsed = parseYaml(readFileSync(seedPath, 'utf8'));
  } catch (error) {
    throw validationError(`${seedPath}: invalid YAML (${error.message})`);
  }

  if (!Array.isArray(parsed)) {
    throw validationError(`${seedPath}: seed root must be a list`);
  }

  return parsed;
}

function readExistingIds(eventsPath) {
  const ids = new Set();
  if (!existsSync(eventsPath)) return ids;

  for (const line of readFileSync(eventsPath, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object' && typeof record.id === 'string') {
        ids.add(record.id);
      }
    } catch {
      // Invalid JSON has no reliable id to de-duplicate against.
    }
  }

  return ids;
}

function buildBackfillRecords(entries) {
  const incidentIds = new Set();
  const recordIds = new Set();

  return entries.map((entry, index) => {
    validateSeedEntryShape(entry, index);
    if (incidentIds.has(entry.incident_id)) {
      throw validationError(`duplicate incident_id: ${entry.incident_id}`);
    }
    incidentIds.add(entry.incident_id);

    const record = buildRecord(entry);
    if (recordIds.has(record.id)) {
      throw validationError(`duplicate deterministic id for incident_id: ${entry.incident_id}`);
    }
    recordIds.add(record.id);
    return record;
  });
}

function validateSeedEntryShape(entry, index) {
  const label = `entry ${index + 1}`;
  if (!isPlainObject(entry)) {
    throw validationError(`${label}: seed entry must be an object`);
  }

  for (const key of Object.keys(entry).sort()) {
    if (!ALLOWED_SEED_FIELDS.has(key)) {
      throw validationError(`${label}: unknown field: ${key}`);
    }
  }

  requiredString(entry.incident_id, `${label}: incident_id`);
  requiredString(entry.ts, `${label}: ts`);
  requiredString(entry.ts_confidence, `${label}: ts_confidence`);
  if (!TS_CONFIDENCE.includes(entry.ts_confidence)) {
    throw validationError(`${label}: ts_confidence must be one of ${TS_CONFIDENCE.join(', ')}`);
  }
  if (!entry.ts.endsWith('Z') || Number.isNaN(Date.parse(entry.ts))) {
    throw validationError(`${label}: ts must be a UTC ISO8601 string ending in Z`);
  }

  const verb = entry.verb || 'manual_record';
  if (!VERBS.includes(verb)) {
    throw validationError(`${label}: verb must be one of ${VERBS.join(', ')}`);
  }
  validateEnum(entry.surface, SURFACES, `${label}: surface`);
  validateEnum(entry.outcome, OUTCOMES, `${label}: outcome`);

  if (AUTO_EVENT_VERBS.includes(verb) && entry.exit_code === undefined) {
    throw validationError(
      `${label}: exit_code is required when verb is ${verb}; use manual_record if the historical exit code is unknown`,
    );
  }
  if (entry.exit_code !== undefined) {
    nonNegativeInteger(entry.exit_code, `${label}: exit_code`);
  }
  if (entry.failure_category !== undefined) {
    validateEnum(entry.failure_category, FAILURE_CATEGORIES, `${label}: failure_category`);
  }
  if (entry.failure_driver !== undefined) {
    validateEnum(entry.failure_driver, FAILURE_DRIVERS, `${label}: failure_driver`);
  }
  validateOptionalString(entry.failure_driver, `${label}: failure_driver`);
  validateOptionalString(entry.error_code, `${label}: error_code`);
  validateOptionalString(entry.project_hash, `${label}: project_hash`);
  validateOptionalString(entry.plugin, `${label}: plugin`);
  validateOptionalString(entry.note, `${label}: note`);
}

function buildRecord(entry) {
  const record = compact({
    id: mintUuidV7(new Date(entry.ts), entry.incident_id),
    schema_version: SCHEMA_VERSION,
    kind: 'event',
    ts: entry.ts,
    verb: entry.verb || 'manual_record',
    outcome: entry.outcome,
    surface: entry.surface,
    exit_code: entry.exit_code,
    failure_category: entry.failure_category,
    failure_driver: entry.failure_driver,
    error_code: entry.error_code,
    project_hash: entry.project_hash,
    plugin: entry.plugin,
    note: entry.note,
  });
  const result = validateRecord(record);
  if (!result.ok) {
    throw validationError(`${entry.incident_id}: ${result.errors.join('; ')}`);
  }

  return record;
}

function appendRecords({ store, records }) {
  if (records.length === 0) return;

  mkdirSync(store.dir, { recursive: true });
  if (store.store === 'project') {
    const gitignorePath = join(store.dir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '*\n!.gitignore\n');
    }
  }

  let prefix = '';
  if (existsSync(store.eventsPath)) {
    const current = readFileSync(store.eventsPath, 'utf8');
    prefix = current && !current.endsWith('\n') ? '\n' : '';
  } else {
    mkdirSync(dirname(store.eventsPath), { recursive: true });
  }

  appendFileSync(
    store.eventsPath,
    `${prefix}${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );
}

function validationError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function validateEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw validationError(`${label} must be one of ${allowed.join(', ')}`);
  }
}

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw validationError(`${label} must be a non-empty string`);
  }
}

function validateOptionalString(value, label) {
  if (value === undefined) return;
  requiredString(value, label);
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw validationError(`${label} must be a non-negative integer`);
  }
}

function compact(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null),
  );
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
