import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, isAbsolute, join, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

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
  const surfaces = Array.isArray(matrix?.surfaces) ? matrix.surfaces : [];
  const assertions = Array.isArray(matrix?.assertions) ? matrix.assertions : [];

  if (!matrix || typeof matrix !== 'object') {
    return { errors: ['matrix must be an object'] };
  }

  validateRequiredFields({
    errors,
    value: matrix,
    fields: ['schemaVersion', 'plugin', 'surfaces'],
    label: 'matrix',
  });

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
  let match;

  while ((match = tableHeaderPattern.exec(text)) !== null) {
    const tableName = match[1];
    if (tableName.startsWith('plugins.')) {
      plugins.push(unquoteTomlKey(tableName.slice('plugins.'.length)));
    } else if (tableName.startsWith('marketplaces.')) {
      marketplaces.push(unquoteTomlKey(tableName.slice('marketplaces.'.length)));
    }
  }

  return { plugins, marketplaces };
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

function expandPath({ root, value }) {
  const expandedVariables = value.replace(
    /\$\{([^}:]+)(:-([^}]*))?\}/g,
    (_, name, _fallback, fallback) => {
      if (name === 'ROOT') {
        return root;
      }

      const envValue = process.env[name];
      if (fallback !== undefined && (envValue === undefined || envValue === '')) {
        return fallback;
      }

      return envValue ?? '';
    },
  );

  const expandedHome =
    expandedVariables === '~' || expandedVariables.startsWith('~/')
      ? join(homedir(), expandedVariables.slice(2))
      : expandedVariables;

  return isAbsolute(expandedHome) ? expandedHome : resolve(root, expandedHome);
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
