import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { delimiter, join } from 'node:path';

function readJsonStatus(path, fallback = null) {
  if (!existsSync(path)) {
    return { exists: false, ok: true, value: fallback };
  }
  try {
    return {
      exists: true,
      ok: true,
      value: JSON.parse(readFileSync(path, 'utf8')),
    };
  } catch (error) {
    return {
      exists: true,
      ok: false,
      value: fallback,
      error: error.message,
    };
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function directoryHasFiles(path) {
  try {
    return isDirectory(path) && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function commandStatus(command, envPath, homeExists) {
  const path = resolveCommand(command, envPath);
  if (path) return { status: 'available', path };
  if (!homeExists) return { status: 'not-initialized', path: null };
  return {
    status: 'path-missing-with-home',
    path: null,
  };
}

function gitOutput(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error || result.status !== 0) {
    return { ok: false, error: result.error?.message || result.stderr.trim() || 'git failed' };
  }
  return { ok: true, stdout: result.stdout };
}

function formatNameStatus(stdout, prefix) {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [status, ...pathParts] = line.split('\t');
      return `${prefix}${status[0]} ${pathParts.join('\t')}`;
    });
}

function formatUntrackedFiles(stdout) {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((path) => `?? ${path}`);
}

function probeMarketplace({ claudeHome, marketplaceName, installedEntries }) {
  const known = readJsonStatus(join(claudeHome, 'plugins/known_marketplaces.json'), {});
  const record = known.ok ? known.value?.[marketplaceName] : null;
  if (!record) {
    return {
      status: 'missing',
      known: false,
      marketplaceName,
      warnings: ['marketplace-missing'],
    };
  }

  const installLocation = record.installLocation || null;
  const installedShas = installedEntries
    .map((entry) => entry.gitCommitSha)
    .filter((sha) => typeof sha === 'string' && sha.length > 0);
  const marketplace = {
    status: 'present',
    known: true,
    marketplaceName,
    source: record.source || null,
    installLocation,
    lastUpdated: record.lastUpdated || null,
    headSha: null,
    dirtyFiles: [],
    installedSha: installedShas[0] || null,
    installedShas,
    headDiffersFromInstalledSha: false,
    warnings: [],
  };

  if (!installLocation || !existsSync(installLocation)) {
    marketplace.status = 'path-missing';
    marketplace.warnings.push('marketplace-path-missing');
    return marketplace;
  }

  const head = gitOutput(installLocation, ['rev-parse', 'HEAD']);
  const unstaged = gitOutput(installLocation, ['diff', '--name-status', '--no-renames']);
  const staged = gitOutput(installLocation, ['diff', '--cached', '--name-status', '--no-renames']);
  const untracked = gitOutput(installLocation, ['ls-files', '--others', '--exclude-standard']);
  if (!head.ok || !unstaged.ok || !staged.ok || !untracked.ok) {
    marketplace.status = 'git-state-unavailable';
    marketplace.warnings.push('git-state-unavailable');
    return marketplace;
  }

  marketplace.headSha = head.stdout.trim();
  marketplace.dirtyFiles = [
    ...formatNameStatus(unstaged.stdout, ' '),
    ...formatNameStatus(staged.stdout, ''),
    ...formatUntrackedFiles(untracked.stdout),
  ];
  if (marketplace.dirtyFiles.length > 0) {
    marketplace.warnings.push('dirty-clone');
  }
  marketplace.headDiffersFromInstalledSha = Boolean(
    marketplace.installedShas.length > 0 &&
      marketplace.headSha &&
      !marketplace.installedShas.includes(marketplace.headSha),
  );
  if (marketplace.headDiffersFromInstalledSha) {
    marketplace.warnings.push('head-differs-from-installed-sha');
  }

  return marketplace;
}

export function resolveCommand(command, envPath = process.env.PATH || '') {
  for (const entry of envPath.split(delimiter).filter(Boolean)) {
    const candidate = join(entry, command);
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Keep scanning PATH entries.
    }
  }
  return null;
}

export function probeCodexCache({ codexHome, marketplaceName, pluginName, expectedVersion }) {
  const path = join(codexHome, 'plugins/cache', marketplaceName, pluginName);
  const versions = existsSync(path)
    ? readdirSync(path)
        .filter((name) => isDirectory(join(path, name)))
        .sort()
    : [];
  const hasExpected = versions.includes(expectedVersion);
  return {
    path,
    versions,
    hasExpected,
    status: hasExpected ? 'present' : 'missing',
  };
}

export function probeClaudeState({
  claudeHome,
  envPath = process.env.PATH || '',
  expectedVersion,
  marketplaceName,
  pluginName,
}) {
  const pluginId = `${pluginName}@${marketplaceName}`;
  const homeExists = existsSync(claudeHome);
  const cli = commandStatus('claude', envPath, homeExists);
  const cliAvailable = cli.status === 'available';

  if (!homeExists && !cliAvailable) {
    return {
      status: 'not-initialized',
      pluginId,
      cli,
      entries: [],
      marketplace: {
        status: 'missing',
        known: false,
        marketplaceName,
        warnings: [],
      },
      actions: buildClaudeActions({
        marketplaceName,
        pluginId,
        hasUserScope: false,
        orphaned: false,
        marketplaceKnown: false,
      }),
    };
  }

  const installed = readJsonStatus(join(claudeHome, 'plugins/installed_plugins.json'), {
    version: 2,
    plugins: {},
  });
  if (!installed.exists) {
    const marketplace = probeMarketplace({ claudeHome, marketplaceName, installedEntries: [] });
    return {
      status: cliAvailable ? 'missing' : 'cli-unavailable-metadata-missing',
      pluginId,
      cli,
      entries: [],
      marketplace,
      actions: buildClaudeActions({
        marketplaceName,
        pluginId,
        hasUserScope: false,
        orphaned: false,
        marketplaceKnown: marketplace.known,
      }),
    };
  }
  if (!installed.ok) {
    return {
      status: 'parse-error',
      pluginId,
      cli,
      entries: [],
      marketplace: null,
      error: installed.error,
      actions: buildClaudeActions({
        marketplaceName,
        pluginId,
        hasUserScope: false,
        orphaned: false,
        marketplaceKnown: false,
      }),
    };
  }

  const rawEntries = installed.value?.plugins?.[pluginId] || [];
  if (rawEntries.length === 0) {
    const marketplace = probeMarketplace({ claudeHome, marketplaceName, installedEntries: [] });
    return {
      status: 'missing',
      pluginId,
      cli,
      entries: [],
      marketplace,
      actions: buildClaudeActions({
        marketplaceName,
        pluginId,
        hasUserScope: false,
        orphaned: false,
        marketplaceKnown: marketplace.known,
      }),
    };
  }

  const settings = readJsonStatus(join(claudeHome, 'settings.json'), {});
  const enabled = settings.ok ? settings.value?.enabledPlugins?.[pluginId] : null;
  const entries = rawEntries.map((entry) => {
    const installPath = entry.installPath || null;
    const installPathExists = Boolean(installPath && existsSync(installPath));
    const installPathHasFiles = Boolean(installPath && directoryHasFiles(installPath));
    const hasExpectedVersion = entry.version === expectedVersion;
    const orphaned = Boolean(installPath && existsSync(join(installPath, '.orphaned_at')));
    const inUse = Boolean(installPath && directoryHasFiles(join(installPath, '.in_use')));
    const warnings = [];
    if (!installPathExists) warnings.push('install-path-missing');
    if (!installPathHasFiles) warnings.push('install-path-empty');
    if (orphaned) warnings.push('orphaned');
    if (inUse) warnings.push('in-use');

    return {
      scope: entry.scope,
      projectPath: entry.projectPath || null,
      version: entry.version,
      hasExpectedVersion,
      installPath,
      installPathExists,
      installPathHasFiles,
      usableExpectedInstall: hasExpectedVersion && installPathExists && installPathHasFiles,
      gitCommitSha: entry.gitCommitSha,
      enabled: typeof enabled === 'boolean' ? enabled : null,
      warnings,
    };
  });

  const hasUsableExpected = entries.some((entry) => entry.usableExpectedInstall);
  const hasUserScope = entries.some((entry) => entry.scope === 'user');
  const orphaned = entries.some((entry) => entry.warnings.includes('orphaned'));
  const marketplace = probeMarketplace({
    claudeHome,
    marketplaceName,
    installedEntries: rawEntries,
  });

  return {
    status: cliAvailable
      ? hasUsableExpected
        ? 'present'
        : 'stale'
      : 'cli-unavailable-metadata-present',
    pluginId,
    cli,
    entries,
    marketplace,
    actions: buildClaudeActions({
      marketplaceName,
      pluginId,
      hasUserScope,
      orphaned,
      marketplaceKnown: marketplace.known,
    }),
  };
}

export function buildClaudeActions({
  marketplaceName,
  pluginId,
  hasUserScope,
  orphaned,
  marketplaceKnown = true,
}) {
  if (!marketplaceKnown) {
    return [
      {
        surface: 'claude',
        kind: 'manual',
        message: `Add the ${marketplaceName} Claude marketplace before updating ${pluginId}.`,
        reason: 'claude-marketplace-missing',
        requiresCli: 'claude',
      },
    ];
  }

  const actions = [
    {
      surface: 'claude',
      kind: 'command',
      command: ['claude', 'plugin', 'marketplace', 'update', marketplaceName],
      reason: 'refresh-claude-marketplace',
      requiresCli: 'claude',
    },
  ];

  if (orphaned && hasUserScope) {
    actions.push({
      surface: 'claude',
      kind: 'command',
      command: ['claude', 'plugin', 'uninstall', pluginId, '--scope', 'user'],
      reason: 'repair-orphaned-claude-install',
      requiresCli: 'claude',
    });
    actions.push({
      surface: 'claude',
      kind: 'command',
      command: ['claude', 'plugin', 'install', pluginId, '--scope', 'user'],
      reason: 'repair-orphaned-claude-install',
      requiresCli: 'claude',
    });
    return actions;
  }

  actions.push({
    surface: 'claude',
    kind: 'command',
    command: [
      'claude',
      'plugin',
      hasUserScope ? 'update' : 'install',
      pluginId,
      '--scope',
      'user',
    ],
    reason: hasUserScope ? 'update-claude-plugin' : 'install-claude-plugin',
    requiresCli: 'claude',
  });
  return actions;
}
