#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import {
  effectiveTimeoutMs,
  extractTomlTableNames,
  loadLiveSurfaceMatrix,
  parseAllowedUntilDate,
  stalenessBudgetExpiry,
  validateLiveSurfaceMatrix,
} from './lib/live-surface-matrix.mjs';
import { probeCodexCache } from './lib/plugin-state-probe.mjs';
import {
  collectSourceVersionSnapshot,
  sourceVersionsDiffer,
} from './lib/source-version-snapshot.mjs';
import { expandPath } from './lib/path-expand.mjs';

const DEFAULT_MATRIX_PATH = '.agent-trigger-kit/live-surfaces.yaml';

const [mode] = process.argv.slice(2);
const isHelpArg = (value) => value === '--help' || value === '-h';

function printUsage() {
  console.log(
    [
      'Usage:',
      '  agent-trigger-kit live-check [--root <path>] [--matrix <path>] [--json] [filters]',
      '  agent-trigger-kit render-matrix --output <path> [--root <path>] [--matrix <path>]',
      '',
      'Commands:',
      '  live-check     Check live agent trigger surfaces from a consumer-owned matrix',
      '  render-matrix  Render live trigger surface matrix documentation',
    ].join('\n'),
  );
}

if (isHelpArg(mode)) {
  printUsage();
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

const validation = validateLiveSurfaceMatrix({ matrix });
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
    message: `${snapshot.errorMessage}; live verifier not checked`,
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
    return runPointerDoc({ root, row, strict: Boolean(args['strict-allowed-drift']) });
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
  let configPath;
  try {
    configPath = expandPath({
      root,
      value: verifier.configPath || '${CODEX_HOME:-~/.codex}/config.toml',
      strictEnv: true,
    });
  } catch (error) {
    return surfaceResult(row, {
      status: 'config-error',
      message: `codex config path expansion failed: ${error.message}`,
    });
  }

  if (typeof configPath !== 'string' || configPath.trim() === '' || !isAbsolute(configPath)) {
    return surfaceResult(row, {
      status: 'config-error',
      message: `codex config path must expand to an absolute path: ${String(configPath)}`,
    });
  }

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

function runPointerDoc({ root, row, strict }) {
  const verifier = row.liveVerifier || {};
  const path = expandRoot(
    root,
    row.path || verifier.path || (row.surface === 'gemini' ? 'GEMINI.md' : ''),
  );
  if (!path || !existsSync(path)) {
    return applyStalenessBudget({
      row,
      result: surfaceResult(row, { status: 'drift', message: `pointer doc missing: ${path}` }),
      strict: true,
    });
  }

  const text = readFileSync(path, 'utf8');
  const clean =
    text.startsWith('---\n') &&
    /^---\n[\s\S]*?\npointer_only:\s*true\s*(?:\n[\s\S]*?)?\n---/.test(text);
  return applyStalenessBudget({
    row,
    result: surfaceResult(row, {
      status: clean ? 'clean' : 'drift',
      message: clean ? 'pointer doc is pointer-only' : 'pointer doc missing pointer_only: true',
    }),
    strict,
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
  try {
    for (const setName of assertion.sets || []) {
      namesBySet.set(
        setName,
        new Set(collectComponentNames({ root, pluginName: assertion.plugin, setName })),
      );
    }
  } catch (error) {
    return assertionResult(assertion, {
      status: 'config-error',
      message: error.message,
    });
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
  return readDirectoryOrEmpty(path).filter((entry) => statEntry(join(path, entry)).isDirectory());
}

function listFiles(path) {
  return readDirectoryOrEmpty(path).filter((entry) => statEntry(join(path, entry)).isFile());
}

function readDirectoryOrEmpty(path) {
  try {
    return readdirSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw new Error(`${path}: ${error.message}`);
  }
}

function statEntry(path) {
  try {
    return statSync(path);
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw new Error(`${path}: ${error.message}`);
  }
}

function inspectDirectoryHasFiles(path) {
  let pathStats;
  try {
    pathStats = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw new Error(`${path}: ${error.message}`);
  }

  if (pathStats.isSymbolicLink()) {
    try {
      pathStats = statSync(path);
    } catch (error) {
      throw new Error(`${path}: ${error.message}`);
    }
  }

  if (!pathStats.isDirectory()) {
    return false;
  }

  try {
    return readdirSync(path).length > 0;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw new Error(`${path}: ${error.message}`);
  }
}

function directoryHasFiles(path) {
  return inspectDirectoryHasFiles(path);
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
  const expiry = stalenessBudgetExpiry(budget);
  const allowedUntil = expiry?.value;
  let allowedUntilDate = null;
  if (allowedUntil !== undefined && allowedUntil !== null && allowedUntil !== '') {
    try {
      allowedUntilDate = parseAllowedUntilDate(allowedUntil);
    } catch (error) {
      return {
        ...result,
        status: 'config-error',
        message: `invalid stalenessBudget ${expiry.key}: ${error.message}`,
      };
    }
  }
  const pointerOnlyAllowed =
    budget.mode === 'pointer-only' &&
    allowedUntilDate &&
    now.getTime() <= allowedUntilDate.getTime();
  const explicitAllowed =
    budget.mode === 'allowed-until' &&
    allowedUntilDate &&
    now.getTime() <= allowedUntilDate.getTime();

  if (!pointerOnlyAllowed && !explicitAllowed) {
    return result;
  }

  return {
    ...result,
    status: 'allowed-drift',
    allowedDriftReason: budget.reason || budget.mode,
  };
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
  return expandPath({ root, value });
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
    for (const field of ['installPath', 'projectPath', 'scope']) {
      if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== 'string') {
        return {
          pluginId,
          entries: [],
          errorMessage: `${installedPath}: expected ${pluginId}[${index}].${field} to be a string`,
        };
      }
    }
  }

  const entries = [];
  for (const entry of rawEntries) {
    try {
      const installPath = entry.installPath || null;
      const installPathExists = Boolean(installPath && pathExists(installPath));
      const installPathHasFiles = Boolean(installPath && directoryHasFiles(installPath));
      const warnings = [];
      if (installPath && existsSync(join(installPath, '.orphaned_at'))) {
        warnings.push('orphaned');
      }
      entries.push({
        scope: entry.scope,
        projectPath: entry.projectPath || null,
        version: entry.version,
        hasExpectedVersion: entry.version === expectedVersion,
        installPath,
        installPathExists,
        installPathHasFiles,
        warnings,
      });
    } catch (error) {
      return {
        pluginId,
        entries: [],
        errorMessage: error.message,
      };
    }
  }

  return {
    pluginId,
    entries,
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
