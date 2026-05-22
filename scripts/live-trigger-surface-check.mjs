#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import {
  effectiveTimeoutMs,
  extractTomlTableNames,
  loadLiveSurfaceMatrix,
  renderLiveSurfaceMarkdown,
  validateLiveSurfaceMatrix,
} from './lib/live-surface-matrix.mjs';
import { probeCodexCache } from './lib/plugin-state-probe.mjs';
import {
  collectSourceVersionSnapshot,
  sourceVersionsDiffer,
} from './lib/source-version-snapshot.mjs';

const DEFAULT_MATRIX_PATH = '.agent-trigger-kit/live-surfaces.yaml';

const [mode, ...modeArgs] = process.argv.slice(2);

if (mode === 'render-matrix') {
  const args = parseArgs(modeArgs);
  const root = resolve(args.root || process.cwd());
  const matrixPath = args.matrix || DEFAULT_MATRIX_PATH;
  const output = args.output;

  if (typeof output !== 'string' || output.trim() === '') {
    console.error('render-matrix requires --output');
    process.exit(2);
  }

  const outputPath = resolve(root, output);
  const outputRelativePath = relative(root, outputPath);
  if (
    isAbsolute(output) ||
    outputRelativePath === '..' ||
    outputRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(outputRelativePath)
  ) {
    console.error('render-matrix --output must stay within --root');
    process.exit(2);
  }

  const matrix = loadLiveSurfaceMatrix({ root, matrixPath });
  const validation = validateLiveSurfaceMatrix({ root, matrix });
  if (validation.errors.length > 0) {
    console.error(validation.errors.join('\n'));
    process.exit(3);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderLiveSurfaceMarkdown(matrix));
  console.log(`wrote ${output}`);
  process.exit(0);
}

const args = parseArgs(process.argv.slice(2), {
  booleanKeys: ['json', 'headless-only', 'strict-allowed-drift'],
});
const root = resolve(args.root || process.cwd());
const matrixPath = args.matrix || DEFAULT_MATRIX_PATH;
const jsonOutput = Boolean(args.json);

let matrix;
try {
  matrix = loadLiveSurfaceMatrix({ root, matrixPath });
} catch (error) {
  exitWithPayload({
    code: 3,
    jsonOutput,
    payload: {
      schemaVersion: 1,
      plugin: null,
      status: 'config-error',
      summary: summarize([]),
      results: [
        {
          resultType: 'surface',
          id: 'matrix',
          status: 'config-error',
          message: `${matrixPath}: ${error.message}`,
        },
      ],
    },
    human: `${matrixPath}: ${error.message}`,
  });
}

const validation = validateLiveSurfaceMatrix({ root, matrix });
if (validation.errors.length > 0) {
  exitWithPayload({
    code: 3,
    jsonOutput,
    payload: livePayload({ matrix, results: validation.errors.map(configErrorResult) }),
    human: validation.errors.join('\n'),
  });
}

const selectedSurfaces = selectRows(matrix.surfaces || [], args);
const selectedAssertions = selectRows(matrix.assertions || [], args);

if (selectedSurfaces.length === 0 && selectedAssertions.length === 0) {
  const payload = livePayload({ matrix, results: [] });
  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('no rows selected');
  }
  process.exit(0);
}

const sourceSnapshots = new Map();
const results = [];
const startedAt = Date.now();

for (const row of selectedSurfaces) {
  if (isTimedOut({ startedAt, row, matrix, args })) {
    results.push(surfaceResult(row, { status: 'timeout', message: 'live-check timed out' }));
    continue;
  }

  const sourceResult = validateSourceTruth({ root, matrix, row, sourceSnapshots });
  if (sourceResult) {
    results.push(sourceResult);
    continue;
  }

  results.push(runSurfaceVerifier({ root, matrix, row, sourceSnapshots, args }));
}

for (const assertion of selectedAssertions) {
  if (isTimedOut({ startedAt, row: assertion, matrix, args })) {
    results.push(
      assertionResult(assertion, { status: 'timeout', message: 'live-check timed out' }),
    );
    continue;
  }

  results.push(runAssertion({ root, assertion }));
}

const exitCode = exitCodeForResults(results);
const payload = livePayload({ matrix, results, exitCode });

if (jsonOutput) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  printHuman({ payload });
}

process.exit(exitCode);

function configErrorResult(message) {
  return {
    resultType: 'surface',
    id: 'matrix',
    status: 'config-error',
    message,
  };
}

function validateSourceTruth({ root, matrix, row, sourceSnapshots }) {
  if (row.sourceTruth !== 'source-version') {
    return null;
  }

  const snapshot = sourceSnapshotFor({ root, matrix, row, sourceSnapshots });
  if (!sourceVersionsDiffer(snapshot)) {
    return null;
  }

  return surfaceResult(row, {
    status: 'validation-error',
    expected: snapshot.expectedVersion,
    message: snapshot.errorMessage,
  });
}

function sourceSnapshotFor({ root, matrix, row, sourceSnapshots }) {
  const pluginName = row.plugin || matrix.plugin;
  if (!sourceSnapshots.has(pluginName)) {
    sourceSnapshots.set(pluginName, collectSourceVersionSnapshot({ root, pluginName }));
  }
  return sourceSnapshots.get(pluginName);
}

function runSurfaceVerifier({ root, matrix, row, sourceSnapshots, args }) {
  const verifier = row.liveVerifier || {};

  if (verifier.kind === 'codex-cache') {
    const snapshot = sourceSnapshotFor({ root, matrix, row, sourceSnapshots });
    const expectedVersion = snapshot.expectedVersion;
    const marketplaceName =
      row.marketplace || snapshot.marketplaceName || row.plugin || matrix.plugin;
    const state = probeCodexCache({
      codexHome: expandRoot(root, verifier.codexHome),
      marketplaceName,
      pluginName: row.plugin || matrix.plugin,
      expectedVersion,
    });
    const result = surfaceResult(row, {
      status: state.hasExpected ? 'clean' : 'drift',
      expected: expectedVersion,
      actual: state.versions,
      message: state.hasExpected
        ? `codex cache has ${expectedVersion}`
        : `codex cache missing ${expectedVersion}`,
    });
    return applyStalenessBudget({ row, result, strict: Boolean(args['strict-allowed-drift']) });
  }

  if (verifier.kind === 'claude-installed-plugin') {
    const snapshot = sourceSnapshotFor({ root, matrix, row, sourceSnapshots });
    const expectedVersion = snapshot.expectedVersion;
    const pluginName = row.plugin || matrix.plugin;
    const marketplaceName = row.marketplace || snapshot.marketplaceName || pluginName;
    const claudeMarketplaceName =
      row.marketplace || snapshot.claudeMarketplaceName || marketplaceName;
    const state = readClaudeInstalledMetadata({
      claudeHome: expandRoot(root, verifier.claudeHome),
      envPath: '',
      expectedVersion,
      marketplaceName: claudeMarketplaceName,
      pluginName,
    });
    if (state.errorMessage) {
      return surfaceResult(row, {
        status: 'validation-error',
        expected: expectedVersion,
        message: state.errorMessage,
      });
    }
    const expectedProjectPath =
      row.scope === 'project' ? expandRoot(root, verifier.projectPath || root) : null;
    const matchingEntry = state.entries.some((entry) => {
      if (entry.version !== expectedVersion) return false;
      if (row.scope && entry.scope !== row.scope) return false;
      if (expectedProjectPath && entry.projectPath !== expectedProjectPath) return false;
      return (
        entry.installPathExists && entry.installPathHasFiles && !entry.warnings.includes('orphaned')
      );
    });
    const pluginId = `${pluginName}@${claudeMarketplaceName}`;
    const nextActions = [`claude plugin update ${pluginId}`];
    const result = surfaceResult(row, {
      status: matchingEntry ? 'clean' : 'drift',
      expected: expectedVersion,
      actual: state.entries.map((entry) => ({
        scope: entry.scope,
        projectPath: entry.projectPath,
        version: entry.version,
      })),
      message: matchingEntry
        ? `claude install has ${expectedVersion}`
        : `claude install missing matching ${expectedVersion}`,
      nextActions: matchingEntry ? [] : nextActions,
    });
    return applyStalenessBudget({ row, result, strict: Boolean(args['strict-allowed-drift']) });
  }

  if (verifier.kind === 'codex-config-absence') {
    return runCodexConfigAbsence({ root, row });
  }

  if (verifier.kind === 'pointer-doc') {
    return runPointerDoc({ root, row });
  }

  if (verifier.kind === 'static-validator') {
    return surfaceResult(row, { status: 'clean', message: 'static validator covered elsewhere' });
  }

  return surfaceResult(row, {
    status: 'config-error',
    message: `unknown live verifier kind: ${verifier.kind}`,
  });
}

function runCodexConfigAbsence({ root, row }) {
  const verifier = row.liveVerifier || {};
  const configPath = expandPath(root, verifier.configPath || join(root, '.codex/config.toml'));
  if (!existsSync(configPath)) {
    return surfaceResult(row, { status: 'clean', message: 'codex config missing' });
  }

  const tableNames = extractTomlTableNames(readFileSync(configPath, 'utf8'));
  const forbiddenPlugins = verifier.forbiddenPluginIds || [];
  const forbiddenMarketplaces = verifier.forbiddenMarketplaces || [];
  const pluginMatches = forbiddenPlugins.filter((id) => tableNames.plugins.includes(id));
  const marketplaceMatches = forbiddenMarketplaces.filter((name) =>
    tableNames.marketplaces.includes(name),
  );
  const matches = [...pluginMatches, ...marketplaceMatches];

  return surfaceResult(row, {
    status: matches.length > 0 ? 'drift' : 'clean',
    actual: tableNames,
    message:
      matches.length > 0
        ? `forbidden codex config tables present: ${matches.join(', ')}`
        : 'no forbidden codex config tables present',
  });
}

function runPointerDoc({ root, row }) {
  const verifier = row.liveVerifier || {};
  const path = expandRoot(
    root,
    row.path || verifier.path || (row.surface === 'gemini' ? 'GEMINI.md' : ''),
  );
  if (!path || !existsSync(path)) {
    return applyStalenessBudget({
      row,
      result: surfaceResult(row, { status: 'drift', message: `pointer doc missing: ${path}` }),
      strict: false,
    });
  }

  const text = readFileSync(path, 'utf8');
  const clean = /^---\n[\s\S]*?\npointer_only:\s*true\s*(?:\n[\s\S]*?)?\n---/m.test(text);
  return applyStalenessBudget({
    row,
    result: surfaceResult(row, {
      status: clean ? 'clean' : 'drift',
      message: clean ? 'pointer doc is pointer-only' : 'pointer doc missing pointer_only: true',
    }),
    strict: false,
  });
}

function runAssertion({ root, assertion }) {
  if (assertion.kind !== 'component-name-disjoint') {
    return assertionResult(assertion, {
      status: 'config-error',
      message: `unknown assertion kind: ${assertion.kind}`,
    });
  }

  const namesBySet = new Map();
  for (const setName of assertion.sets || []) {
    namesBySet.set(
      setName,
      new Set(collectComponentNames({ root, pluginName: assertion.plugin, setName })),
    );
  }

  const setNamesByComponent = new Map();
  for (const [setName, names] of namesBySet.entries()) {
    for (const name of names) {
      if (!setNamesByComponent.has(name)) {
        setNamesByComponent.set(name, new Set());
      }
      setNamesByComponent.get(name).add(setName);
    }
  }
  const collisions = [...setNamesByComponent.entries()]
    .filter(([, setNames]) => setNames.size > 1)
    .map(([name]) => name);

  return assertionResult(assertion, {
    status: collisions.length > 0 ? assertion.onFailure : 'clean',
    message:
      collisions.length > 0
        ? `component names are not disjoint: ${[...new Set(collisions)].join(', ')}`
        : 'component names are disjoint',
  });
}

function collectComponentNames({ root, pluginName, setName }) {
  if (setName === 'skills') {
    const skillsDir = join(root, 'plugins', pluginName, 'skills');
    return listDirectories(skillsDir).map((skillName) => {
      const skillPath = join(skillsDir, skillName, 'SKILL.md');
      if (!existsSync(skillPath)) return skillName.trim();
      return (frontmatterValue(readFileSync(skillPath, 'utf8'), 'name') || skillName).trim();
    });
  }

  if (setName === 'commands') {
    const commandsDir = join(root, 'plugins', pluginName, 'commands');
    return listFiles(commandsDir)
      .filter((file) => extname(file) === '.md')
      .map((file) => basename(file, '.md').trim());
  }

  return [];
}

function listDirectories(path) {
  try {
    return readdirSync(path).filter((entry) => statSync(join(path, entry)).isDirectory());
  } catch {
    return [];
  }
}

function listFiles(path) {
  try {
    return readdirSync(path).filter((entry) => statSync(join(path, entry)).isFile());
  } catch {
    return [];
  }
}

function frontmatterValue(text, key) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const line = match[1]
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${key}:`));
  return line
    ? line
        .slice(key.length + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '')
    : null;
}

function surfaceResult(row, extras = {}) {
  return compactResult({
    resultType: 'surface',
    id: row.id,
    surface: row.surface,
    scope: row.scope,
    owner: row.owner,
    status: extras.status || 'clean',
    expected: extras.expected,
    actual: extras.actual,
    message: extras.message,
    nextActions: extras.nextActions,
    allowedDriftReason: extras.allowedDriftReason,
  });
}

function assertionResult(assertion, extras = {}) {
  return compactResult({
    resultType: 'assertion',
    id: assertion.id,
    kind: assertion.kind,
    owner: assertion.owner,
    status: extras.status || 'clean',
    message: extras.message,
  });
}

function compactResult(result) {
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== '';
    }),
  );
}

function applyStalenessBudget({ row, result, strict }) {
  if (strict || result.status !== 'drift') {
    return result;
  }

  const budget = row.stalenessBudget || {};
  const now = new Date();
  const allowedUntil = budget['allowed-until'] || budget.allowedUntil || budget.until;
  const pointerOnlyAllowed =
    budget.mode === 'pointer-only' && now.getTime() <= endOfUtcDay(now).getTime();
  const explicitAllowed =
    budget.mode === 'allowed-until' &&
    allowedUntil &&
    now.getTime() <= parseAllowedUntil(allowedUntil).getTime();

  if (!pointerOnlyAllowed && !explicitAllowed) {
    return result;
  }

  return {
    ...result,
    status: 'allowed-drift',
    allowedDriftReason: budget.reason || budget.mode,
  };
}

function parseAllowedUntil(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  }

  return new Date(value);
}

function endOfUtcDay(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999),
  );
}

function isTimedOut({ startedAt, row, matrix, args }) {
  const timeoutMs = effectiveTimeoutMs({
    rowTimeoutMs: row.timeoutMs,
    cliTimeoutMs: args['timeout-ms'],
    defaultTimeoutMs: matrix.defaults?.timeoutMs,
    envTimeoutMs: process.env.AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS,
  });
  return Date.now() > startedAt + timeoutMs;
}

function selectRows(rows, args) {
  return rows.filter((row) => {
    if (args.owner && row.owner !== args.owner) return false;
    if (args['headless-only'] && row.headless && row.headless !== 'safe') return false;
    return true;
  });
}

function exitCodeForResults(results) {
  const statuses = new Set(results.map((result) => result.status));
  if (statuses.has('timeout')) return 124;
  if (statuses.has('config-error')) return 3;
  if (statuses.has('validation-error')) return 2;
  if (statuses.has('drift')) return 1;
  return 0;
}

function statusForExitCode(code) {
  if (code === 124) return 'timeout';
  if (code === 3) return 'config-error';
  if (code === 2) return 'validation-error';
  if (code === 1) return 'drift';
  return 'clean';
}

function summarize(results) {
  return {
    clean: results.filter((result) => result.status === 'clean').length,
    drift: results.filter((result) => result.status === 'drift').length,
    allowedDrift: results.filter((result) => result.status === 'allowed-drift').length,
    validationErrors: results.filter((result) => result.status === 'validation-error').length,
    configErrors: results.filter((result) => result.status === 'config-error').length,
    timeouts: results.filter((result) => result.status === 'timeout').length,
  };
}

function livePayload({ matrix, results, exitCode = exitCodeForResults(results) }) {
  return {
    schemaVersion: 1,
    plugin: matrix?.plugin || null,
    status: statusForExitCode(exitCode),
    summary: summarize(results),
    results,
  };
}

function printHuman({ payload }) {
  for (const result of payload.results) {
    console.log(`${result.status}\t${result.id || result.kind}`);
    if (result.message) console.log(`  ${result.message}`);
  }
  console.log(
    `summary clean=${payload.summary.clean} drift=${payload.summary.drift} allowed-drift=${payload.summary.allowedDrift}`,
  );
}

function exitWithPayload({ code, jsonOutput, payload, human }) {
  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(human);
  }
  process.exit(code);
}

function expandRoot(root, value) {
  if (!value) return value;
  return expandPath(root, String(value).replaceAll('${ROOT}', root));
}

function expandPath(root, value) {
  if (!value) return value;
  const expandedVariables = String(value).replace(
    /\$\{([^}:]+)(:-([^}]*))?\}/g,
    (_, name, _fallback, fallback) => {
      if (name === 'ROOT') return root;
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

function readClaudeInstalledMetadata({ claudeHome, expectedVersion, marketplaceName, pluginName }) {
  const pluginId = `${pluginName}@${marketplaceName}`;
  const installedPath = join(claudeHome, 'plugins/installed_plugins.json');
  if (!existsSync(installedPath)) {
    return {
      pluginId,
      entries: [],
    };
  }

  let installed;
  try {
    installed = JSON.parse(readFileSync(installedPath, 'utf8'));
  } catch (error) {
    return {
      pluginId,
      entries: [],
      errorMessage: `${installedPath}: ${error.message}`,
    };
  }

  if (!isPlainObject(installed)) {
    return {
      pluginId,
      entries: [],
      errorMessage: `${installedPath}: expected root object`,
    };
  }

  if (installed.plugins !== undefined && !isPlainObject(installed.plugins)) {
    return {
      pluginId,
      entries: [],
      errorMessage: `${installedPath}: expected plugins object`,
    };
  }

  const rawEntries = installed.plugins?.[pluginId] || [];
  if (!Array.isArray(rawEntries)) {
    return {
      pluginId,
      entries: [],
      errorMessage: `${installedPath}: expected ${pluginId} entries array`,
    };
  }

  const malformedIndex = rawEntries.findIndex((entry) => !isPlainObject(entry));
  if (malformedIndex !== -1) {
    return {
      pluginId,
      entries: [],
      errorMessage: `${installedPath}: expected ${pluginId}[${malformedIndex}] to be an object`,
    };
  }

  for (const [index, entry] of rawEntries.entries()) {
    for (const field of ['installPath', 'projectPath']) {
      if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== 'string') {
        return {
          pluginId,
          entries: [],
          errorMessage: `${installedPath}: expected ${pluginId}[${index}].${field} to be a string`,
        };
      }
    }
  }

  return {
    pluginId,
    entries: rawEntries.map((entry) => {
      const installPath = entry.installPath || null;
      const installPathExists = Boolean(installPath && existsSync(installPath));
      const installPathHasFiles = Boolean(installPath && directoryHasFiles(installPath));
      const warnings = [];
      if (installPath && existsSync(join(installPath, '.orphaned_at'))) {
        warnings.push('orphaned');
      }
      return {
        scope: entry.scope,
        projectPath: entry.projectPath || null,
        version: entry.version,
        hasExpectedVersion: entry.version === expectedVersion,
        installPath,
        installPathExists,
        installPathHasFiles,
        warnings,
      };
    }),
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function directoryHasFiles(path) {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}
