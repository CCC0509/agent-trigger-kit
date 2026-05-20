#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { createPathOf, readJsonFileIfExistsOrExit } from './lib/fs-json.mjs';
import { probeClaudeState, probeCodexCache } from './lib/plugin-state-probe.mjs';

const args = parseArgs(process.argv.slice(2), {
  booleanKeys: ['json', 'strict-installed', 'include-package', 'no-include-package'],
  collectPositionals: true,
});
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const codexHome = normalize(
  args['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'),
);
const claudeHome = normalize(args['claude-home'] || join(homedir(), '.claude'));
const pluginName = args.plugin || args._[0];
const jsonOutput = Boolean(args.json);
const surface = args.surface || 'all';
const validSurfaces = new Set(['all', 'codex', 'claude', 'source']);

if (!pluginName) {
  console.error(
    [
      'Missing plugin name.',
      'Usage: check-plugin-version.mjs [--root <path>] [--codex-home <path>] [--claude-home <path>] [--surface all|codex|claude|source] <plugin-name>',
    ].join(' '),
  );
  process.exit(2);
}

if (!validSurfaces.has(surface)) {
  console.error('--surface must be all, codex, claude, or source');
  process.exit(2);
}

if (args['include-package'] && args['no-include-package']) {
  console.error('--include-package and --no-include-package cannot both be set');
  process.exit(2);
}

const checkCodex = surface === 'all' || surface === 'codex';
const checkClaude = surface === 'all' || surface === 'claude';
const sourceOnly = surface === 'source';

function sourceEntry(label, version) {
  return { label, version: version || 'missing' };
}

function packageNameMatchesPlugin(packageName) {
  return packageName === pluginName || packageName?.endsWith(`/${pluginName}`);
}

function shouldIncludePackage(packageJson) {
  if (args['include-package']) return true;
  if (args['no-include-package']) return false;
  return packageNameMatchesPlugin(packageJson?.name);
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
  ...(shouldIncludePackage(packageJson) ? [sourceEntry('package.json', packageJson?.version)] : []),
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
if (!jsonOutput) {
  console.log(`expected source version: ${expectedVersion}`);
  console.log('source versions:');
  for (const entry of sourceVersions) {
    console.log(`  ${entry.label}: ${entry.version}`);
  }
}
let versionMismatch = false;
let actions = [];

let codexCache = { status: 'skipped', reason: `--surface ${surface}` };
if (checkCodex) {
  codexCache = probeCodexCache({
    codexHome,
    marketplaceName,
    pluginName,
    expectedVersion,
  });
  if (!jsonOutput) {
    console.log(
      `codex cache versions: ${codexCache.versions.length > 0 ? codexCache.versions.join(', ') : 'none'}`,
    );
    console.log(`codex cache expected version: ${codexCache.hasExpected ? 'present' : 'missing'}`);
  }
  if (codexCache.versions.length > 0 && !codexCache.hasExpected) {
    versionMismatch = true;
  }
} else {
  if (!jsonOutput && !sourceOnly) {
    console.log(`codex cache: skipped (--surface ${surface})`);
  }
}

let claudeStatus = { status: 'skipped', reason: `--surface ${surface}` };
if (checkClaude) {
  const probedClaude = probeClaudeState({
    claudeHome,
    envPath: process.env.PATH || '',
    expectedVersion,
    marketplaceName: claudeMarketplace?.name || marketplaceName,
    pluginName,
  });
  if (probedClaude.cli.status === 'available') {
    const claude = spawnSync('claude', ['plugin', 'list', '--json'], {
      encoding: 'utf8',
    });
    if (claude.error) {
      claudeStatus = {
        status: 'error',
        cli: probedClaude.cli,
        message: claude.error.message,
      };
      if (!jsonOutput) {
        console.log(`claude: unable to run plugin list (${claude.error.message})`);
      }
    } else if (claude.status !== 0) {
      claudeStatus = {
        status: 'command-failed',
        cli: probedClaude.cli,
        exitCode: claude.status,
      };
      if (!jsonOutput) {
        console.log('claude: `claude plugin list --json` did not complete successfully');
      }
    } else {
      const claudePluginId = probedClaude.pluginId;
      try {
        const plugins = JSON.parse(claude.stdout);
        const installed = plugins.find((entry) => entry.id === claudePluginId);
        if (!installed) {
          claudeStatus = {
            status: 'missing',
            cli: probedClaude.cli,
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
            cli: probedClaude.cli,
            pluginId: claudePluginId,
            version: installed.version,
            hasExpected: expectedPresent,
          };
          if (!jsonOutput) {
            console.log(`claude installed version: ${installed.version}`);
            console.log(
              `claude installed expected version: ${expectedPresent ? 'present' : 'stale'}`,
            );
          }
          if (installed.version !== expectedVersion) {
            versionMismatch = true;
          }
        }
      } catch (error) {
        claudeStatus = {
          status: 'parse-error',
          cli: probedClaude.cli,
          message: error.message,
        };
        if (!jsonOutput) {
          console.log(`claude: unable to parse plugin list JSON (${error.message})`);
        }
      }
    }
  } else {
    const { actions: fallbackActions, ...fallbackStatus } = probedClaude;
    actions = fallbackActions;
    claudeStatus = fallbackStatus;

    if (probedClaude.status === 'missing' || probedClaude.status === 'parse-error') {
      versionMismatch = true;
    }
    if (
      probedClaude.entries.length > 0 &&
      !probedClaude.entries.some((entry) => entry.usableExpectedInstall === true)
    ) {
      versionMismatch = true;
    }

    try {
      if (!jsonOutput) {
        printClaudeFallbackStatus(probedClaude, actions);
      }
    } catch (error) {
      console.log(`claude: unable to render fallback status (${error.message})`);
    }
  }
} else {
  if (!jsonOutput && !sourceOnly) {
    console.log(`claude: skipped (--surface ${surface})`);
  }
}

if (!jsonOutput && sourceOnly) {
  console.log('installed state: skipped ("--surface source")');
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
        actions,
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

function printClaudeFallbackStatus(state, stateActions) {
  if (state.status === 'not-initialized') {
    console.log(`claude: not initialized (${state.cli.status})`);
    return;
  }

  if (state.status === 'parse-error') {
    console.log(`claude: unable to parse filesystem metadata (${state.error})`);
  } else {
    console.log(`claude: ${state.status} (${state.cli.status})`);
  }

  if (state.entries.length > 0) {
    for (const entry of state.entries) {
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
  } else if (state.status === 'missing') {
    console.log(`claude installed version: missing (${state.pluginId})`);
  }

  for (const action of stateActions) {
    if (action.kind === 'command') {
      console.log(`claude action: ${action.command.join(' ')}`);
    } else if (action.message) {
      console.log(`claude action: ${action.message}`);
    }
  }
}
