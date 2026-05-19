#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { createPathOf, readJsonFileIfExistsOrExit } from './lib/fs-json.mjs';

const args = parseArgs(process.argv.slice(2), {
  booleanKeys: ['json', 'strict-installed'],
  collectPositionals: true,
});
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const codexHome = normalize(
  args['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'),
);
const pluginName = args.plugin || args._[0];
const jsonOutput = Boolean(args.json);

if (!pluginName) {
  console.error(
    [
      'Missing plugin name.',
      'Usage: check-plugin-version.mjs [--root <path>] [--codex-home <path>] <plugin-name>',
    ].join(' '),
  );
  process.exit(2);
}

function sourceEntry(label, version) {
  return { label, version: version || 'missing' };
}

const packageJson = readJsonFileIfExistsOrExit(pathOf('package.json'), null);
const codexMarketplace = readJsonFileIfExistsOrExit(
  pathOf('.agents/plugins/marketplace.json'),
  null,
);
const claudeMarketplace = readJsonFileIfExistsOrExit(
  pathOf('.claude-plugin/marketplace.json'),
  null,
);
const codexEntry = codexMarketplace?.plugins?.find((entry) => entry.name === pluginName);
const claudeEntry = claudeMarketplace?.plugins?.find((entry) => entry.name === pluginName);
const pluginDir =
  codexEntry?.source?.path?.replace(/^\.\//, '') || claudeEntry?.source?.replace(/^\.\//, '');

if (!pluginDir) {
  console.error(`${pluginName}: missing plugin source in marketplace manifests`);
  process.exit(1);
}

const codexPlugin = readJsonFileIfExistsOrExit(
  pathOf(`${pluginDir}/.codex-plugin/plugin.json`),
  null,
);
const claudePlugin = readJsonFileIfExistsOrExit(
  pathOf(`${pluginDir}/.claude-plugin/plugin.json`),
  null,
);
const sourceVersions = [
  sourceEntry('package.json', packageJson?.version),
  sourceEntry('codex marketplace', codexEntry?.version),
  sourceEntry('codex plugin', codexPlugin?.version),
  sourceEntry('claude marketplace', claudeEntry?.version),
  sourceEntry('claude plugin', claudePlugin?.version),
];

const uniqueVersions = new Set(sourceVersions.map((entry) => entry.version));
if (uniqueVersions.size !== 1) {
  console.error(
    `source versions differ: ${sourceVersions.map((entry) => `${entry.label}=${entry.version}`).join(', ')}`,
  );
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

if (!jsonOutput) {
  console.log(`expected source version: ${expectedVersion}`);
  console.log('source versions:');
  for (const entry of sourceVersions) {
    console.log(`  ${entry.label}: ${entry.version}`);
  }
  console.log(
    `codex cache versions: ${codexCacheVersions.length > 0 ? codexCacheVersions.join(', ') : 'none'}`,
  );
}
const codexCacheHasExpected = codexCacheVersions.includes(expectedVersion);
let versionMismatch = false;
if (!jsonOutput) {
  console.log(`codex cache expected version: ${codexCacheHasExpected ? 'present' : 'missing'}`);
}
if (codexCacheVersions.length > 0 && !codexCacheHasExpected) {
  versionMismatch = true;
}
const codexCache = {
  path: cacheParent,
  versions: codexCacheVersions,
  hasExpected: codexCacheHasExpected,
  status: codexCacheHasExpected ? 'present' : 'missing',
};

const claude = spawnSync('claude', ['plugin', 'list', '--json'], {
  encoding: 'utf8',
});
let claudeStatus = { status: 'unchecked' };
if (claude.error?.code === 'ENOENT') {
  claudeStatus = {
    status: 'cli-unavailable',
    message: 'run `claude plugin list --json` manually',
  };
  if (!jsonOutput) {
    console.log('claude: CLI unavailable; run `claude plugin list --json` manually');
  }
} else if (claude.error) {
  claudeStatus = {
    status: 'error',
    message: claude.error.message,
  };
  if (!jsonOutput) {
    console.log(`claude: unable to run plugin list (${claude.error.message})`);
  }
} else if (claude.status !== 0) {
  claudeStatus = {
    status: 'command-failed',
    exitCode: claude.status,
  };
  if (!jsonOutput) {
    console.log('claude: `claude plugin list --json` did not complete successfully');
  }
} else {
  try {
    const plugins = JSON.parse(claude.stdout);
    const claudePluginId = `${pluginName}@${claudeMarketplace?.name || marketplaceName}`;
    const installed = plugins.find((entry) => entry.id === claudePluginId);
    if (!installed) {
      claudeStatus = {
        status: 'missing',
        pluginId: claudePluginId,
      };
      if (!jsonOutput) {
        console.log(`claude installed version: missing (${claudePluginId})`);
      }
      versionMismatch = true;
    } else {
      const expectedPresent = installed.version === expectedVersion;
      claudeStatus = {
        status: expectedPresent ? 'present' : 'stale',
        pluginId: claudePluginId,
        version: installed.version,
        hasExpected: expectedPresent,
      };
      if (!jsonOutput) {
        console.log(`claude installed version: ${installed.version}`);
        console.log(`claude installed expected version: ${expectedPresent ? 'present' : 'stale'}`);
      }
      if (installed.version !== expectedVersion) {
        versionMismatch = true;
      }
    }
  } catch (error) {
    claudeStatus = {
      status: 'parse-error',
      message: error.message,
    };
    if (!jsonOutput) {
      console.log(`claude: unable to parse plugin list JSON (${error.message})`);
    }
  }
}

if (jsonOutput) {
  console.log(
    JSON.stringify(
      {
        pluginName,
        expectedVersion,
        sourceVersions,
        codexCache,
        claude: claudeStatus,
        versionMismatch,
      },
      null,
      2,
    ),
  );
}

if (versionMismatch && args['strict-installed']) {
  process.exit(1);
}
