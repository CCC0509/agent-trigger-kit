#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { createPathOf, readJsonFileOrExit } from './lib/fs-json.mjs';
import { probeClaudeState } from './lib/plugin-state-probe.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2), {
  booleanKeys: ['no-codex-debug'],
  collectPositionals: true,
});
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const codexHome = normalize(
  args['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'),
);
const claudeHome = normalize(args['claude-home'] || join(homedir(), '.claude'));
const pluginName = args.plugin || args._[0];

if (!pluginName) {
  console.error(
    [
      'Missing plugin name.',
      'Usage: update-local-agent-triggers.mjs [--root <path>] [--codex-home <path>] [--claude-home <path>] [--no-codex-debug] <plugin-name>',
    ].join(' '),
  );
  process.exit(2);
}

function filesDiffer(left, right) {
  const leftStat = statSync(left);
  if (!existsSync(right)) return true;

  const rightStat = statSync(right);
  if (leftStat.isDirectory() !== rightStat.isDirectory()) return true;
  if (leftStat.isFile() !== rightStat.isFile()) return true;

  if (leftStat.isDirectory()) {
    const leftEntries = readdirSync(left).sort();
    const rightEntries = readdirSync(right).sort();
    if (leftEntries.length !== rightEntries.length) return true;
    for (let index = 0; index < leftEntries.length; index += 1) {
      if (leftEntries[index] !== rightEntries[index]) return true;
      if (filesDiffer(join(left, leftEntries[index]), join(right, rightEntries[index]))) {
        return true;
      }
    }
    return false;
  }

  if (leftStat.isFile()) {
    if (leftStat.size !== rightStat.size) return true;
    return !readFileSync(left).equals(readFileSync(right));
  }

  return false;
}

function run(command, commandArgs, options = {}) {
  const { silent = false, ...spawnOptions } = options;
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    ...spawnOptions,
  });
  if (!silent && result.stdout) process.stdout.write(result.stdout);
  if (!silent && result.stderr) process.stderr.write(result.stderr);
  return result;
}

function runNodeScript(scriptName, scriptArgs, options = {}) {
  return run(process.execPath, [join(scriptDir, scriptName), ...scriptArgs], options);
}

function requireSuccess(label, result) {
  if (result.error) {
    console.error(`${label}: failed to start (${result.error.message})`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    console.error(`${label}: failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }
}

function runClaude(commandArgs) {
  const result = run('claude', commandArgs);
  if (result.error?.code === 'ENOENT') {
    return { unavailable: true };
  }
  requireSuccess(`claude ${commandArgs.join(' ')}`, result);
  return { unavailable: false };
}

function printClaudeCacheWarnings(claudeState) {
  for (const entry of claudeState.entries || []) {
    if (!entry.warnings || entry.warnings.length === 0) continue;
    const scope = entry.scope || 'unknown';
    const installPath = entry.installPath || 'missing';
    console.log(
      `claude cache health warning: ${claudeState.pluginId} (${scope} scope, ${installPath}): ${entry.warnings.join(', ')}`,
    );
  }
}

function printClaudeFallbackStatus(claudeState) {
  console.log('claude: CLI unavailable; reporting filesystem metadata only');
  console.log(`claude: ${claudeState.status} (${claudeState.cli.status})`);
  for (const entry of claudeState.entries || []) {
    console.log(
      `claude installed version: ${entry.version || 'missing'} (${entry.scope || 'unknown'} scope)`,
    );
    console.log(
      `claude install path: ${entry.installPath || 'missing'} (${entry.installPathExists ? 'exists' : 'missing'}, ${entry.installPathHasFiles ? 'has files' : 'empty'})`,
    );
    console.log(
      `claude installed expected version: ${entry.usableExpectedInstall ? 'present' : 'stale'}`,
    );
  }
  printClaudeCacheWarnings(claudeState);
  for (const action of claudeState.actions || []) {
    if (action.kind === 'command') {
      console.log(`recommendation: ${action.command.join(' ')}`);
    } else if (action.message) {
      console.log(`recommendation: ${action.message}`);
    }
  }
}

function runClaudeAction(action) {
  if (action.kind !== 'command') {
    if (action.message) console.log(`claude action: ${action.message}`);
    return;
  }
  const [command, ...commandArgs] = action.command;
  if (command !== 'claude') {
    console.error(`claude action: unsupported command ${action.command.join(' ')}`);
    process.exit(1);
  }
  runClaude(commandArgs);
}

const codexMarketplacePath = pathOf('.agents/plugins/marketplace.json');
if (!existsSync(codexMarketplacePath)) {
  console.error(`${codexMarketplacePath}: missing Codex marketplace manifest`);
  process.exit(1);
}

const codexMarketplace = readJsonFileOrExit(codexMarketplacePath);
const codexEntry = codexMarketplace.plugins?.find((entry) => entry.name === pluginName);
if (!codexEntry) {
  console.error(`${pluginName}: missing from .agents/plugins/marketplace.json`);
  process.exit(1);
}
if (codexEntry.source?.source !== 'local' || !codexEntry.source?.path) {
  console.error(`${pluginName}: local agent refresh requires a local Codex marketplace source`);
  process.exit(1);
}
if (!codexEntry.version) {
  console.error(`${pluginName}: missing Codex marketplace version`);
  process.exit(1);
}

const sourceDir = resolve(root, codexEntry.source.path);
if (!existsSync(sourceDir)) {
  console.error(`${pluginName}: source directory missing at ${sourceDir}`);
  process.exit(1);
}
const targetDir = join(
  codexHome,
  'plugins/cache',
  codexMarketplace.name,
  pluginName,
  codexEntry.version,
);

const claudeMarketplacePath = pathOf('.claude-plugin/marketplace.json');
const claudeMarketplace = existsSync(claudeMarketplacePath)
  ? readJsonFileOrExit(claudeMarketplacePath)
  : null;
const claudeEntry = claudeMarketplace?.plugins?.find((entry) => entry.name === pluginName);
const pluginDir = claudeEntry?.source || codexEntry.source?.path;
if (!pluginDir) {
  console.error(`${pluginName}: missing plugin source path`);
  process.exit(1);
}

console.log(`Agent trigger refresh: ${pluginName}`);

const validate = runNodeScript('validate-trigger-layer.mjs', ['--root', root]);
requireSuccess('trigger layer validation', validate);

const versionCheck = runNodeScript(
  'check-plugin-version.mjs',
  [
    '--root',
    root,
    '--codex-home',
    codexHome,
    '--claude-home',
    claudeHome,
    '--surface',
    'codex',
    '--json',
    pluginName,
  ],
  { silent: true },
);
requireSuccess('plugin version check', versionCheck);

let versionCheckPayload = null;
try {
  versionCheckPayload = JSON.parse(versionCheck.stdout || '{}');
} catch (error) {
  console.error(`plugin version check: unable to parse JSON output (${error.message})`);
  process.exit(1);
}

if (versionCheckPayload.codexCache?.hasExpected === false || filesDiffer(sourceDir, targetDir)) {
  console.log('Codex cache is missing or stale; syncing local cache');
  const sync = runNodeScript('sync-codex-plugin-cache.mjs', [
    '--root',
    root,
    '--codex-home',
    codexHome,
    pluginName,
  ]);
  requireSuccess('Codex local cache sync', sync);
} else {
  console.log('Codex cache check: expected version present and content matches');
}

if (args['no-codex-debug']) {
  console.log('codex: skipped prompt-input verification (--no-codex-debug)');
} else {
  const codexDebug = run('codex', ['debug', 'prompt-input', 'test']);
  if (codexDebug.error?.code === 'ENOENT') {
    console.log('codex: CLI unavailable; skipped prompt-input verification');
  } else {
    requireSuccess('codex debug prompt-input', codexDebug);
  }
}

const marketplaceName = claudeMarketplace?.name || codexMarketplace.name || pluginName;
const claudeState = probeClaudeState({
  claudeHome,
  envPath: process.env.PATH || '',
  expectedVersion: codexEntry.version,
  marketplaceName,
  pluginName,
});

if (claudeState.cli.status !== 'available') {
  printClaudeFallbackStatus(claudeState);
} else {
  const pluginDirAbsolute = resolve(root, pluginDir);
  printClaudeCacheWarnings(claudeState);
  runClaude(['plugin', 'validate', root]);
  runClaude(['plugin', 'validate', pluginDirAbsolute]);
  for (const action of claudeState.actions || []) {
    runClaudeAction(action);
  }
  runClaude(['plugin', 'list', '--json']);
}

console.log('Cursor: repo-local rules are covered by trigger-layer validation');
