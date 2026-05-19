#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());
const codexHome = normalize(args['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'));
const pluginName = args.plugin || args._[0];

if (!pluginName) {
  console.error([
    'Missing plugin name.',
    'Usage: update-local-agent-triggers.mjs [--root <path>] [--codex-home <path>] [--no-codex-debug] <plugin-name>',
  ].join(' '));
  process.exit(2);
}

function parseArgs(argv) {
  const out = { _: [] };
  const booleanKeys = new Set(['no-codex-debug']);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (booleanKeys.has(key)) {
        out[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function pathOf(path) {
  return join(root, path);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`${path}: ${error.message}`);
    process.exit(1);
  }
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
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function runNodeScript(scriptName, scriptArgs) {
  return run(process.execPath, [join(scriptDir, scriptName), ...scriptArgs]);
}

function requireSuccess(label, result) {
  if (result.error) {
    console.error(`${label}: failed to start (${result.error.message})`);
    process.exit(1);
  }
  if (result.status !== 0) {
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

const codexMarketplacePath = pathOf('.agents/plugins/marketplace.json');
if (!existsSync(codexMarketplacePath)) {
  console.error(`${codexMarketplacePath}: missing Codex marketplace manifest`);
  process.exit(1);
}

const codexMarketplace = readJson(codexMarketplacePath);
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
const targetDir = join(codexHome, 'plugins/cache', codexMarketplace.name, pluginName, codexEntry.version);

const claudeMarketplacePath = pathOf('.claude-plugin/marketplace.json');
const claudeMarketplace = existsSync(claudeMarketplacePath) ? readJson(claudeMarketplacePath) : null;
const claudeEntry = claudeMarketplace?.plugins?.find((entry) => entry.name === pluginName);
const pluginDir = claudeEntry?.source || codexEntry.source?.path;
if (!pluginDir) {
  console.error(`${pluginName}: missing plugin source path`);
  process.exit(1);
}

console.log(`Agent trigger refresh: ${pluginName}`);

const validate = runNodeScript('validate-trigger-layer.mjs', ['--root', root]);
requireSuccess('trigger layer validation', validate);

const versionCheck = runNodeScript('check-plugin-version.mjs', [
  '--root',
  root,
  '--codex-home',
  codexHome,
  pluginName,
]);
requireSuccess('plugin version check', versionCheck);

if (/codex cache expected version: missing/.test(versionCheck.stdout || '') || filesDiffer(sourceDir, targetDir)) {
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

const firstClaude = runClaude(['plugin', 'validate', root]);
if (firstClaude.unavailable) {
  console.log('claude: CLI unavailable; skipped Claude update commands');
} else {
  const pluginDirAbsolute = resolve(root, pluginDir);
  runClaude(['plugin', 'validate', pluginDirAbsolute]);
  runClaude(['plugin', 'marketplace', 'update', claudeMarketplace?.name || codexMarketplace.name || pluginName]);
  runClaude([
    'plugin',
    'update',
    `${pluginName}@${claudeMarketplace?.name || codexMarketplace.name || pluginName}`,
    '--scope',
    'user',
  ]);
  runClaude(['plugin', 'list', '--json']);
}

console.log('Cursor: repo-local rules are covered by trigger-layer validation');
