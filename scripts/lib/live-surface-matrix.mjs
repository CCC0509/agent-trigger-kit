import { readFileSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { expandPath } from './path-expand.mjs';

const DEFAULT_MATRIX_PATH = '.agent-trigger-kit/live-surfaces.yaml';
const DEFAULT_TIMEOUT_MS = 20000;
const KNOWN_LIVE_VERIFIER_KINDS = new Set([
  'codex-cache',
  'codex-config-absence',
  'claude-installed-plugin',
  'static-validator',
  'pointer-doc',
]);
const KNOWN_ASSERTION_KINDS = new Set(['component-name-disjoint']);
const ALLOWED_ON_FAILURE = new Set(['drift', 'allowed-drift']);

export function effectiveTimeoutMs({
  rowTimeoutMs,
  cliTimeoutMs,
  defaultTimeoutMs,
  envTimeoutMs,
} = {}) {
  for (const value of [rowTimeoutMs, cliTimeoutMs, defaultTimeoutMs, envTimeoutMs]) {
    if (value !== undefined && value !== null && value !== '') {
      const numericValue = Number(value);
      if (Number.isFinite(numericValue)) {
        return numericValue;
      }
    }
  }

  return DEFAULT_TIMEOUT_MS;
}

export function loadLiveSurfaceMatrix({ root, matrixPath = DEFAULT_MATRIX_PATH }) {
  const resolvedRoot = resolve(root ?? process.cwd());
  const fullPath = isAbsolute(matrixPath) ? matrixPath : join(resolvedRoot, matrixPath);
  const text = readFileSync(fullPath, 'utf8');
  const matrix =
    extname(fullPath) === '.json' ? JSON.parse(text) : parseYaml(text, { prettyErrors: true });

  applyMatrixDefaults({ root: resolvedRoot, matrix });

  return matrix;
}

export function validateLiveSurfaceMatrix({ matrix }) {
  const errors = [];
  const seenIds = new Set();

  if (!matrix || typeof matrix !== 'object') {
    return { errors: ['matrix must be an object'] };
  }

  validateRequiredFields({
    errors,
    value: matrix,
    fields: ['schemaVersion', 'plugin', 'surfaces'],
    label: 'matrix',
  });

  if (matrix.schemaVersion !== undefined && matrix.schemaVersion !== 1) {
    errors.push(`matrix.schemaVersion has unsupported value: ${matrix.schemaVersion}`);
  }

  if (matrix.surfaces !== undefined && !Array.isArray(matrix.surfaces)) {
    errors.push('matrix.surfaces must be an array');
  }

  if (matrix.assertions !== undefined && !Array.isArray(matrix.assertions)) {
    errors.push('matrix.assertions must be an array');
  }

  const surfaces = Array.isArray(matrix.surfaces) ? matrix.surfaces : [];
  const assertions = Array.isArray(matrix.assertions) ? matrix.assertions : [];

  for (const [index, surface] of surfaces.entries()) {
    validateRequiredFields({
      errors,
      value: surface,
      fields: [
        'id',
        'surface',
        'scope',
        'plugin',
        'artifactType',
        'sourceTruth',
        'liveVerifier',
        'headless',
        'owner',
        'stalenessBudget',
      ],
      label: `surfaces[${index}]`,
    });
    validateDuplicateId({ errors, seenIds, id: surface?.id, label: `surfaces[${index}]` });

    const verifierKind = surface?.liveVerifier?.kind;
    if (!verifierKind) {
      errors.push(`surfaces[${index}].liveVerifier.kind is required`);
    } else if (!KNOWN_LIVE_VERIFIER_KINDS.has(verifierKind)) {
      errors.push(`surfaces[${index}].liveVerifier.kind has unknown value: ${verifierKind}`);
    }

    if (
      surface?.stalenessBudget?.mode === 'pointer-only' &&
      (surface.artifactType !== 'pointer-doc' || verifierKind !== 'pointer-doc')
    ) {
      errors.push(
        `surfaces[${index}].stalenessBudget.mode pointer-only requires artifactType pointer-doc and liveVerifier.kind pointer-doc`,
      );
    }

    if (
      surface?.stalenessBudget?.mode === 'pointer-only' ||
      surface?.stalenessBudget?.mode === 'allowed-until'
    ) {
      const budget = surface.stalenessBudget;
      const expiry = stalenessBudgetExpiry(budget);

      if (!expiry) {
        errors.push(
          `surfaces[${index}].stalenessBudget.mode ${budget.mode} requires an expiry field`,
        );
      } else {
        try {
          parseAllowedUntilDate(expiry.value);
        } catch (error) {
          errors.push(
            `surfaces[${index}].stalenessBudget has invalid stalenessBudget ${expiry.key}: ${error.message}`,
          );
        }
      }

      if (budget.mode === 'pointer-only' && !budget.reason) {
        errors.push(`surfaces[${index}].stalenessBudget.mode pointer-only requires reason`);
      }
    }
  }

  for (const [index, assertion] of assertions.entries()) {
    validateRequiredFields({
      errors,
      value: assertion,
      fields: ['id', 'kind', 'onFailure', 'owner'],
      label: `assertions[${index}]`,
    });
    validateDuplicateId({ errors, seenIds, id: assertion?.id, label: `assertions[${index}]` });

    if (assertion?.kind && !KNOWN_ASSERTION_KINDS.has(assertion.kind)) {
      errors.push(`assertions[${index}].kind has unknown value: ${assertion.kind}`);
    }

    if (assertion?.onFailure && !ALLOWED_ON_FAILURE.has(assertion.onFailure)) {
      errors.push(`assertions[${index}].onFailure must be drift or allowed-drift`);
    }

    if (assertion?.kind === 'component-name-disjoint') {
      validateRequiredFields({
        errors,
        value: assertion,
        fields: ['plugin', 'sets'],
        label: `assertions[${index}]`,
      });
    }
  }

  return { errors };
}

export function renderLiveSurfaceMarkdown(matrix) {
  const rows = Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
  const lines = [
    '| Surface | Scope | Artifact | Source Truth | Live Verifier | Headless | Owner | Staleness Budget |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    lines.push(
      `| ${[
        row.surface,
        row.scope,
        row.artifactType,
        row.sourceTruth,
        row.liveVerifier?.kind,
        row.headless,
        row.owner,
        row.stalenessBudget?.mode,
      ]
        .map(escapeMarkdownTableCell)
        .join(' | ')} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export function extractTomlTableNames(text) {
  const plugins = [];
  const marketplaces = [];
  const tableHeaderPattern = /^\s*\[([^\]\r\n]+)\]\s*(?:#.*)?$/gm;
  const textWithoutMultilineStrings = stripTomlMultilineStrings(text);
  let match;

  while ((match = tableHeaderPattern.exec(textWithoutMultilineStrings)) !== null) {
    const tableName = match[1];
    if (tableName.startsWith('plugins.')) {
      plugins.push(unquoteTomlKey(tableName.slice('plugins.'.length)));
    } else if (tableName.startsWith('marketplaces.')) {
      marketplaces.push(unquoteTomlKey(tableName.slice('marketplaces.'.length)));
    }
  }

  return { plugins, marketplaces };
}

export function stalenessBudgetExpiry(budget = {}) {
  if (budget['allowed-until'] !== undefined) {
    return { key: 'allowed-until', value: budget['allowed-until'] };
  }

  if (budget.allowedUntil !== undefined) {
    return { key: 'allowedUntil', value: budget.allowedUntil };
  }

  if (budget.until !== undefined) {
    return { key: 'until', value: budget.until };
  }

  return null;
}

export function parseAllowedUntilDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const result = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
    if (
      result.getUTCFullYear() !== year ||
      result.getUTCMonth() !== month - 1 ||
      result.getUTCDate() !== day
    ) {
      throw new Error(String(value));
    }
    return result;
  }

  const result = new Date(value);
  if (Number.isNaN(result.getTime())) {
    throw new Error(String(value));
  }

  return result;
}

function stripTomlMultilineStrings(text) {
  return text.replace(/"""[\s\S]*?"""/g, '').replace(/'''[\s\S]*?'''/g, '');
}

function applyMatrixDefaults({ root, matrix }) {
  const defaultTimeoutMs = matrix?.defaults?.timeoutMs;
  const surfaces = Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];

  for (const surface of surfaces) {
    if (surface.timeoutMs === undefined && defaultTimeoutMs !== undefined) {
      surface.timeoutMs = defaultTimeoutMs;
    }

    if (!surface.liveVerifier || typeof surface.liveVerifier !== 'object') {
      continue;
    }

    if (surface.liveVerifier.kind === 'codex-cache' && !surface.liveVerifier.codexHome) {
      surface.liveVerifier.codexHome = '${CODEX_HOME:-~/.codex}';
    }

    if (surface.liveVerifier.kind === 'claude-installed-plugin') {
      if (!surface.liveVerifier.claudeHome) {
        surface.liveVerifier.claudeHome = '${CLAUDE_HOME:-~/.claude}';
      }

      if (surface.scope === 'project' && !surface.liveVerifier.projectPath) {
        surface.liveVerifier.projectPath = '${ROOT}';
      }
    }

    expandLiveVerifierPaths({ root, liveVerifier: surface.liveVerifier });
  }
}

function expandLiveVerifierPaths({ root, liveVerifier }) {
  for (const key of ['codexHome', 'claudeHome', 'projectPath', 'path']) {
    if (typeof liveVerifier[key] === 'string') {
      liveVerifier[key] = expandPath({ root, value: liveVerifier[key] });
    }
  }
}

function validateRequiredFields({ errors, value, fields, label }) {
  for (const field of fields) {
    if (value?.[field] === undefined || value?.[field] === null || value?.[field] === '') {
      errors.push(`${label}.${field} is required`);
    }
  }
}

function escapeMarkdownTableCell(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll('\n', '\\n');
}

function validateDuplicateId({ errors, seenIds, id, label }) {
  if (!id) {
    return;
  }

  if (seenIds.has(id)) {
    errors.push(`${label}.id duplicates another surface or assertion id: ${id}`);
    return;
  }

  seenIds.add(id);
}

function unquoteTomlKey(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
}
