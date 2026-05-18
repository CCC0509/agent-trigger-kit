#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());
const codexHome = normalize(args['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'));
const pluginName = args.plugin || args._[0];

if (!pluginName) {
  console.error([
    'Missing plugin name.',
    'Usage: check-plugin-version.mjs [--root <path>] [--codex-home <path>] <plugin-name>',
  ].join(' '));
  process.exit(2);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
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

function optionalJson(path) {
  if (!existsSync(pathOf(path))) return null;
  return readJson(pathOf(path));
}

function sourceEntry(label, version) {
  return { label, version: version || 'missing' };
}

const packageJson = optionalJson('package.json');
const codexMarketplace = optionalJson('.agents/plugins/marketplace.json');
const claudeMarketplace = optionalJson('.claude-plugin/marketplace.json');
const codexEntry = codexMarketplace?.plugins?.find((entry) => entry.name === pluginName);
const claudeEntry = claudeMarketplace?.plugins?.find((entry) => entry.name === pluginName);
const pluginDir = codexEntry?.source?.path?.replace(/^\.\//, '') || claudeEntry?.source?.replace(/^\.\//, '');

if (!pluginDir) {
  console.error(`${pluginName}: missing plugin source in marketplace manifests`);
  process.exit(1);
}

const codexPlugin = optionalJson(`${pluginDir}/.codex-plugin/plugin.json`);
const claudePlugin = optionalJson(`${pluginDir}/.claude-plugin/plugin.json`);
const sourceVersions = [
  sourceEntry('package.json', packageJson?.version),
  sourceEntry('codex marketplace', codexEntry?.version),
  sourceEntry('codex plugin', codexPlugin?.version),
  sourceEntry('claude marketplace', claudeEntry?.version),
  sourceEntry('claude plugin', claudePlugin?.version),
];

const uniqueVersions = new Set(sourceVersions.map((entry) => entry.version));
if (uniqueVersions.size !== 1) {
  console.error(`source versions differ: ${sourceVersions.map((entry) => `${entry.label}=${entry.version}`).join(', ')}`);
  process.exit(1);
}

const expectedVersion = sourceVersions[0].version;
const marketplaceName = codexMarketplace?.name || pluginName;
const cacheParent = join(codexHome, 'plugins/cache', marketplaceName, pluginName);
let codexCacheVersions = [];
if (existsSync(cacheParent)) {
  codexCacheVersions = readdirSync(cacheParent)
    .filter((name) => statSync(join(cacheParent, name)).isDirectory())
    .sort();
}

console.log(`expected source version: ${expectedVersion}`);
console.log('source versions:');
for (const entry of sourceVersions) {
  console.log(`  ${entry.label}: ${entry.version}`);
}
console.log(`codex cache versions: ${codexCacheVersions.length > 0 ? codexCacheVersions.join(', ') : 'none'}`);
const codexCacheHasExpected = codexCacheVersions.includes(expectedVersion);
let versionMismatch = false;
console.log(`codex cache expected version: ${codexCacheHasExpected ? 'present' : 'missing'}`);
if (codexCacheVersions.length > 0 && !codexCacheHasExpected) {
  versionMismatch = true;
}

const claude = spawnSync('claude', ['plugin', 'list', '--json'], {
  encoding: 'utf8',
});
if (claude.error?.code === 'ENOENT') {
  console.log('claude: CLI unavailable; run `claude plugin list --json` manually');
} else if (claude.error) {
  console.log(`claude: unable to run plugin list (${claude.error.message})`);
} else if (claude.status !== 0) {
  console.log('claude: `claude plugin list --json` did not complete successfully');
} else {
  try {
    const plugins = JSON.parse(claude.stdout);
    const claudePluginId = `${pluginName}@${claudeMarketplace?.name || marketplaceName}`;
    const installed = plugins.find((entry) => entry.id === claudePluginId);
    if (!installed) {
      console.log(`claude installed version: missing (${claudePluginId})`);
      versionMismatch = true;
    } else {
      console.log(`claude installed version: ${installed.version}`);
      console.log(`claude installed expected version: ${installed.version === expectedVersion ? 'present' : 'stale'}`);
      if (installed.version !== expectedVersion) {
        versionMismatch = true;
      }
    }
  } catch (error) {
    console.log(`claude: unable to parse plugin list JSON (${error.message})`);
  }
}

if (versionMismatch && args['strict-installed']) {
  process.exit(1);
}
