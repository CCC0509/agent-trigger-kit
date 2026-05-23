export const SCHEMA_VERSION = '0.1';

export const VERBS = [
  'validate',
  'live_check',
  'premerge_version_check',
  'scratch_namespace_check',
  'manual_record',
];

export const OUTCOMES = ['success', 'failure', 'skipped', 'blocked'];

export const SURFACES = ['repo', 'cli', 'codex_plugin', 'claude_plugin', 'cursor_rule', 'external'];

export const FAILURE_CATEGORIES = [
  'stale_cache',
  'version_skew',
  'misroute',
  'manifest_drift',
  'missing_artifact',
  'release_policy_gap',
  'surface_residue',
  'unknown',
];

export const FAILURE_DRIVERS = ['human', 'tooling', 'cache', 'network', 'config', 'unknown'];

export const MAX_SERIALIZED_RECORD_BYTES = 1024;

const KINDS = ['event', 'mark'];
const AUTO_EVENT_VERBS = [
  'validate',
  'live_check',
  'premerge_version_check',
  'scratch_namespace_check',
];
const REQUIRED_FIELDS = ['id', 'schema_version', 'kind', 'ts', 'verb', 'outcome', 'surface'];
const ALLOWED_FIELDS = new Set([
  ...REQUIRED_FIELDS,
  'exit_code',
  'duration_ms',
  'failure_category',
  'failure_driver',
  'error_code',
  'project_hash',
  'plugin',
  'correlation_id',
  'related_id',
  'note',
]);
const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateRecord(record) {
  const errors = [];

  if (!isPlainObject(record)) {
    return { ok: false, errors: ['record must be an object'] };
  }

  for (const key of Object.keys(record).sort()) {
    if (!ALLOWED_FIELDS.has(key)) {
      errors.push(`unknown field: ${key}`);
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined) {
      errors.push(`${field} is required`);
    }
  }

  validateUuid(record.id, 'id', errors);
  if (record.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be "${SCHEMA_VERSION}"`);
  }
  validateEnum(record.kind, KINDS, 'kind', errors);
  validateTimestamp(record.ts, errors);
  validateEnum(record.verb, VERBS, 'verb', errors);
  validateEnum(record.outcome, OUTCOMES, 'outcome', errors);
  validateEnum(record.surface, SURFACES, 'surface', errors);

  validateInteger(record.exit_code, 'exit_code', errors, { optional: true });
  validateInteger(record.duration_ms, 'duration_ms', errors, { optional: true });
  validateEnum(record.failure_driver, FAILURE_DRIVERS, 'failure_driver', errors, {
    optional: true,
  });
  validateString(record.error_code, 'error_code', errors, { optional: true });
  validateString(record.project_hash, 'project_hash', errors, { optional: true });
  validateString(record.plugin, 'plugin', errors, { optional: true });
  validateUuid(record.correlation_id, 'correlation_id', errors, { optional: true });
  validateUuid(record.related_id, 'related_id', errors, { optional: true });
  validateString(record.note, 'note', errors, { optional: true });

  validateFailureCategory(record, errors);
  validateExitCodeRules(record, errors);
  validateMarkRules(record, errors);
  validateSerializedSize(record, errors);

  return { ok: errors.length === 0, errors };
}

function validateFailureCategory(record, errors) {
  if (record.outcome === 'failure') {
    if (record.failure_category === undefined) {
      errors.push('failure_category is required when outcome is failure');
      return;
    }
    validateEnum(record.failure_category, FAILURE_CATEGORIES, 'failure_category', errors);
    return;
  }

  if (record.failure_category !== undefined) {
    errors.push('failure_category is forbidden unless outcome is failure');
  }
}

function validateExitCodeRules(record, errors) {
  if (record.kind === 'mark' && record.exit_code !== undefined) {
    errors.push('exit_code is forbidden for mark records');
    return;
  }

  if (
    record.kind === 'event' &&
    AUTO_EVENT_VERBS.includes(record.verb) &&
    record.exit_code === undefined
  ) {
    errors.push(
      'exit_code is required for event records with verb validate, live_check, premerge_version_check, or scratch_namespace_check',
    );
  }
}

function validateMarkRules(record, errors) {
  if (record.kind === 'mark' && record.related_id === undefined) {
    errors.push('related_id is required for mark records');
  }
}

function validateSerializedSize(record, errors) {
  if (Buffer.byteLength(JSON.stringify(record), 'utf8') > MAX_SERIALIZED_RECORD_BYTES) {
    errors.push(`serialized record must not exceed ${MAX_SERIALIZED_RECORD_BYTES} bytes`);
  }
}

function validateEnum(value, allowed, label, errors, options = {}) {
  if (value === undefined && options.optional) return;
  if (!allowed.includes(value)) {
    errors.push(`${label} must be one of ${allowed.join(', ')}`);
  }
}

function validateUuid(value, label, errors, options = {}) {
  if (value === undefined && options.optional) return;
  if (typeof value !== 'string' || !UUID_V7_RE.test(value)) {
    errors.push(`${label} must be a UUID v7 string`);
  }
}

function validateTimestamp(value, errors) {
  if (typeof value !== 'string' || !value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    errors.push('ts must be a UTC ISO8601 string ending in Z');
  }
}

function validateInteger(value, label, errors, options = {}) {
  if (value === undefined && options.optional) return;
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a non-negative integer`);
  }
}

function validateString(value, label, errors, options = {}) {
  if (value === undefined && options.optional) return;
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} must be a non-empty string`);
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
