# Provenance-Aware Plugin Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Trigger Kit version checks and local sync choose provenance-aware paths: Codex local cache sync remains allowed for local sources, while Claude Code state is read-only unless changed by the official `claude` CLI.

**Architecture:** Add a shared read-only probe module for CLI availability, Codex cache versions, and Claude metadata/cache health. Refactor `check-plugin-version.mjs` and `update-local-agent-triggers.mjs` to use that probe, emit a stable `actions` contract, and keep Claude filesystem fallback report-only. Update docs and plugin-visible skills, then bump the aligned plugin version.

**Tech Stack:** Node.js ESM scripts, `node:test`, existing JSON/file helpers, shell-command fixtures, no new runtime dependencies.

---

## File Structure

- Create: `scripts/lib/plugin-state-probe.mjs`
  - Owns read-only probing for command availability, Codex cache versions, Claude metadata, Claude cache health, marketplace Git state, and canonical next-step actions.
- Modify: `scripts/check-plugin-version.mjs`
  - Accepts `--claude-home`, uses the shared probe, emits precise Claude fallback statuses, adds top-level `actions`, and preserves existing source/Codex behavior.
- Modify: `scripts/update-local-agent-triggers.mjs`
  - Accepts `--claude-home`, keeps trigger-layer validation and Codex prompt-input verification, uses the shared probe for policy, syncs Codex local cache when allowed, and invokes only official Claude CLI commands for Claude changes.
- Modify: `tests/trigger-layer-scripts.test.mjs`
  - Adds probe unit tests, version-check fallback tests, local-sync policy tests, and updates existing status expectations.
- Modify: `README.md`
  - Documents provenance-aware sync behavior, `--claude-home`, Claude CLI unavailable fallback, and Git-sourced Claude report-only behavior.
- Modify: `plugins/agent-trigger-kit/skills/version-check/SKILL.md`
  - Teaches the read-only fallback and canonical official next-step command reporting.
- Modify: `plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md`
  - Documents Git-source provenance boundaries, dirty marketplace clone handling, and `.orphaned_at` recovery guidance.
- Modify: `plugins/agent-trigger-kit/skills/codex-plugin-marketplace/SKILL.md`
  - Keeps Codex cache sync explicitly limited to local Codex marketplace sources.
- Modify: `CHANGELOG.md`
  - Adds a new release entry for the provenance-aware sync/reporting change.
- Modify: `package.json`
  - Bumps current `0.1.8` to `0.1.9`.
- Modify: `.agents/plugins/marketplace.json`
  - Bumps the Codex marketplace plugin entry to `0.1.9`.
- Modify: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
  - Bumps the Codex plugin manifest to `0.1.9`.
- Modify: `.claude-plugin/marketplace.json`
  - Bumps the Claude marketplace plugin entry to `0.1.9`.
- Modify: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
  - Bumps the Claude plugin manifest to `0.1.9`.

## Execution Setup

Before Task 1, create an isolated feature branch or worktree. Do not commit this
work directly on `main`.

```bash
git switch -c feat/provenance-aware-plugin-sync
```

If the working tree already contains the spec and plan as untracked files, add
them in the first implementation commit or keep them uncommitted until the
design/plan review is complete.

---

### Task 1: Add Read-Only Plugin State Probe

**Files:**

- Create: `scripts/lib/plugin-state-probe.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing probe tests**

Add these tests near the existing version-check tests in `tests/trigger-layer-scripts.test.mjs`:

```js
test('plugin state probe reports Claude home without CLI and missing requested plugin', async () => {
  const claudeHome = makeRoot();
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'other@other': [
        {
          scope: 'user',
          installPath: join(claudeHome, 'plugins/cache/other/other/1.0.0'),
          version: '1.0.0',
        },
      ],
    },
  });

  const { probeClaudeState } = await import('../scripts/lib/plugin-state-probe.mjs');
  const state = probeClaudeState({
    claudeHome,
    envPath: '',
    expectedVersion: '0.1.2',
    marketplaceName: 'demo-ops',
    pluginName: 'demo-ops',
  });

  assert.equal(state.status, 'missing');
  assert.equal(state.cli.status, 'path-missing-with-home');
  assert.deepEqual(state.entries, []);
});

test('plugin state probe reports broken Claude install paths as unusable warnings', async () => {
  const claudeHome = makeRoot();
  const missingInstallPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath: missingInstallPath,
          version: '0.1.2',
          gitCommitSha: 'abc123',
        },
      ],
    },
  });
  writeJson(claudeHome, 'settings.json', {
    enabledPlugins: {
      'demo-ops@demo-ops': true,
    },
  });

  const { probeClaudeState } = await import('../scripts/lib/plugin-state-probe.mjs');
  const state = probeClaudeState({
    claudeHome,
    envPath: '',
    expectedVersion: '0.1.2',
    marketplaceName: 'demo-ops',
    pluginName: 'demo-ops',
  });

  assert.equal(state.status, 'cli-unavailable-metadata-present');
  assert.equal(state.entries[0].hasExpectedVersion, true);
  assert.equal(state.entries[0].installPathExists, false);
  assert.equal(state.entries[0].installPathHasFiles, false);
  assert.equal(state.entries[0].usableExpectedInstall, false);
  assert.equal(state.entries[0].enabled, true);
  assert.deepEqual(state.entries[0].warnings, ['install-path-missing', 'install-path-empty']);
});

test('plugin state probe reports missing Claude metadata distinctly from missing plugin entry', async () => {
  const claudeHome = makeRoot();

  const { probeClaudeState } = await import('../scripts/lib/plugin-state-probe.mjs');
  const state = probeClaudeState({
    claudeHome,
    envPath: '',
    expectedVersion: '0.1.2',
    marketplaceName: 'demo-ops',
    pluginName: 'demo-ops',
  });

  assert.equal(state.status, 'cli-unavailable-metadata-missing');
  assert.equal(state.cli.status, 'path-missing-with-home');
  assert.deepEqual(state.entries, []);
});

test('plugin state probe lists Codex cache versions from the configured home', async () => {
  const codexHome = makeRoot();
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current');

  const { probeCodexCache } = await import('../scripts/lib/plugin-state-probe.mjs');
  const state = probeCodexCache({
    codexHome,
    marketplaceName: 'demo-ops',
    pluginName: 'demo-ops',
    expectedVersion: '0.1.2',
  });

  assert.deepEqual(state.versions, ['0.1.1', '0.1.2']);
  assert.equal(state.hasExpected, true);
  assert.equal(state.status, 'present');
});

test('plugin state probe separates Claude marketplace dirty state from installed commit state', async () => {
  const claudeHome = makeRoot();
  const marketplace = join(claudeHome, 'plugins/marketplaces/demo-ops');
  mkdirSync(marketplace, { recursive: true });
  const init = runGit(marketplace, ['init']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  write(marketplace, 'README.md', 'clean');
  assert.equal(runGit(marketplace, ['add', 'README.md']).status, 0);
  assert.equal(
    runGit(marketplace, [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Test',
      'commit',
      '-m',
      'initial',
    ]).status,
    0,
  );
  const headSha = runGit(marketplace, ['rev-parse', 'HEAD']).stdout.trim();
  write(marketplace, 'README.md', 'dirty');
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: marketplace,
      lastUpdated: '2026-05-21T00:00:00.000Z',
    },
  });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath: join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'),
          version: '0.1.2',
          gitCommitSha: 'installed-sha',
        },
      ],
    },
  });

  const { probeClaudeState } = await import('../scripts/lib/plugin-state-probe.mjs');
  const state = probeClaudeState({
    claudeHome,
    envPath: '',
    expectedVersion: '0.1.2',
    marketplaceName: 'demo-ops',
    pluginName: 'demo-ops',
  });

  assert.equal(state.marketplace.headSha, headSha);
  assert.equal(state.marketplace.headDiffersFromInstalledSha, true);
  assert.deepEqual(state.marketplace.dirtyFiles, ['M README.md']);
  assert.deepEqual(state.marketplace.warnings, ['dirty-clone', 'head-differs-from-installed-sha']);
});
```

- [ ] **Step 2: Run the focused probe tests and confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'plugin state probe'
```

Expected: FAIL with a module-not-found error for `scripts/lib/plugin-state-probe.mjs`.

- [ ] **Step 3: Create the probe module**

Create `scripts/lib/plugin-state-probe.mjs` with these exports and behavior:

```js
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { readJsonFileIfExists } from './fs-json.mjs';

export function resolveCommand(command, envPath = process.env.PATH || '') {
  for (const dir of envPath.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function directoryHasFiles(path) {
  if (!existsSync(path)) return false;
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

export function listDirectoryNames(path) {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => statSync(join(path, name)).isDirectory())
    .sort();
}

export function probeCodexCache({ codexHome, marketplaceName, pluginName, expectedVersion }) {
  const cacheParent = join(codexHome, 'plugins/cache', marketplaceName, pluginName);
  const versions = listDirectoryNames(cacheParent);
  const hasExpected = versions.includes(expectedVersion);
  return {
    path: cacheParent,
    versions,
    hasExpected,
    status: hasExpected ? 'present' : 'missing',
  };
}

function readJsonStatus(path, fallback) {
  const exists = existsSync(path);
  if (!exists) return { ok: true, exists: false, value: fallback };
  try {
    return { ok: true, exists: true, value: readJsonFileIfExists(path, fallback) };
  } catch (error) {
    return { ok: false, exists: true, error: error.message, value: fallback };
  }
}

function gitOutput(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim();
}

function probeMarketplace({ claudeHome, marketplaceName, installedEntries }) {
  const knownPath = join(claudeHome, 'plugins/known_marketplaces.json');
  const known = readJsonStatus(knownPath, {});
  const marketplace = known.value?.[marketplaceName] || null;
  if (!marketplace)
    return {
      name: marketplaceName,
      status: 'missing',
      known: false,
      warnings: ['marketplace-missing'],
    };

  const installLocation = marketplace.installLocation;
  const state = {
    name: marketplaceName,
    status: 'present',
    known: true,
    source: marketplace.source || null,
    installLocation,
    headSha: null,
    dirtyFiles: [],
    headDiffersFromInstalledSha: false,
    warnings: [],
  };

  if (!installLocation || !existsSync(installLocation)) {
    state.status = 'path-missing';
    state.warnings.push('marketplace-path-missing');
    return state;
  }

  const headSha = gitOutput(['rev-parse', 'HEAD'], installLocation);
  if (!headSha) {
    state.status = 'git-state-unavailable';
    state.warnings.push('git-state-unavailable');
    return state;
  }

  state.headSha = headSha;
  const dirty = gitOutput(['status', '--porcelain'], installLocation);
  state.dirtyFiles = dirty ? dirty.split('\n').filter(Boolean) : [];
  if (state.dirtyFiles.length > 0) state.warnings.push('dirty-clone');

  const installedShas = new Set(
    installedEntries.map((entry) => entry.gitCommitSha).filter(Boolean),
  );
  state.headDiffersFromInstalledSha = installedShas.size > 0 && !installedShas.has(headSha);
  if (state.headDiffersFromInstalledSha) state.warnings.push('head-differs-from-installed-sha');

  return state;
}

export function probeClaudeState({
  claudeHome,
  envPath = process.env.PATH || '',
  expectedVersion,
  marketplaceName,
  pluginName,
}) {
  const pluginId = `${pluginName}@${marketplaceName}`;
  const cliPath = resolveCommand('claude', envPath);
  const cliStatus = cliPath
    ? 'available'
    : existsSync(claudeHome)
      ? 'path-missing-with-home'
      : 'not-initialized';
  if (cliStatus === 'not-initialized') {
    return {
      status: 'not-initialized',
      pluginId,
      cli: { status: cliStatus, path: null },
      entries: [],
      marketplace: null,
      actions: buildClaudeActions({
        marketplaceName,
        pluginId,
        hasUserScope: false,
        orphaned: false,
        marketplaceKnown: false,
      }),
    };
  }

  const installedPath = join(claudeHome, 'plugins/installed_plugins.json');
  const installed = readJsonStatus(installedPath, { version: 2, plugins: {} });
  if (!installed.exists) {
    const marketplace = probeMarketplace({ claudeHome, marketplaceName, installedEntries: [] });
    return {
      status: cliStatus === 'available' ? 'missing' : 'cli-unavailable-metadata-missing',
      pluginId,
      cli: { status: cliStatus, path: cliPath },
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
      cli: { status: cliStatus, path: cliPath },
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
      cli: { status: cliStatus, path: cliPath },
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
  const enabled = settings.value?.enabledPlugins?.[pluginId];
  const entries = rawEntries.map((entry) => {
    const installPathExists = Boolean(entry.installPath && existsSync(entry.installPath));
    const installPathHasFiles = Boolean(entry.installPath && directoryHasFiles(entry.installPath));
    const hasExpectedVersion = entry.version === expectedVersion;
    const orphaned = Boolean(
      entry.installPath && existsSync(join(entry.installPath, '.orphaned_at')),
    );
    const inUse = Boolean(
      entry.installPath &&
      existsSync(join(entry.installPath, '.in_use')) &&
      directoryHasFiles(join(entry.installPath, '.in_use')),
    );
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
      installPath: entry.installPath,
      installPathExists,
      installPathHasFiles,
      usableExpectedInstall: hasExpectedVersion && installPathExists && installPathHasFiles,
      gitCommitSha: entry.gitCommitSha,
      enabled: typeof enabled === 'boolean' ? enabled : null,
      warnings,
    };
  });

  const hasUsableExpected = entries.some((entry) => entry.usableExpectedInstall);
  const hasAnyExpectedVersion = entries.some((entry) => entry.hasExpectedVersion);
  const status =
    cliStatus === 'available'
      ? hasUsableExpected
        ? 'present'
        : 'stale'
      : 'cli-unavailable-metadata-present';
  const hasUserScope = entries.some((entry) => entry.scope === 'user');
  const orphaned = entries.some((entry) => entry.warnings.includes('orphaned'));
  const marketplace = probeMarketplace({
    claudeHome,
    marketplaceName,
    installedEntries: rawEntries,
  });

  return {
    status,
    pluginId,
    cli: { status: cliStatus, path: cliPath },
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
    command: ['claude', 'plugin', hasUserScope ? 'update' : 'install', pluginId, '--scope', 'user'],
    reason: hasUserScope ? 'refresh-user-scope-claude-plugin' : 'install-user-scope-claude-plugin',
    requiresCli: 'claude',
  });
  return actions;
}
```

During implementation, keep the module read-only. Do not import `writeFileSync`, `cpSync`, `renameSync`, or `rmSync` in this file.

- [ ] **Step 4: Run focused probe tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'plugin state probe'
```

Expected: PASS.

- [ ] **Step 5: Commit the probe**

Run:

```bash
git add scripts/lib/plugin-state-probe.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "feat: add read-only plugin state probe"
```

Expected: commit succeeds.

---

### Task 2: Add Claude Filesystem Fallback To Version Check

**Files:**

- Modify: `scripts/check-plugin-version.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing version-check fallback tests**

Add these tests near the current `version check emits structured JSON when requested` tests:

```js
test('version check falls back to Claude metadata when CLI is unavailable', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/skills/docs-review/SKILL.md', '# Skill');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
          version: '0.1.2',
          gitCommitSha: 'abc123',
        },
      ],
    },
  });
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });
  writeJson(claudeHome, 'settings.json', {
    enabledPlugins: { 'demo-ops@demo-ops': true },
  });

  const result = runScript(
    'check-plugin-version.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      '--surface',
      'claude',
      '--json',
      pluginName,
    ],
    { env: { ...process.env, PATH: '' } },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.claude.status, 'cli-unavailable-metadata-present');
  assert.equal(payload.claude.cli.status, 'path-missing-with-home');
  assert.equal(payload.claude.entries[0].usableExpectedInstall, true);
  assert.equal(payload.claude.entries[0].enabled, true);
  assert.equal(payload.versionMismatch, false);
  assert.deepEqual(payload.actions[0].command, [
    'claude',
    'plugin',
    'marketplace',
    'update',
    'demo-ops',
  ]);
  assert.deepEqual(payload.actions[1].command, [
    'claude',
    'plugin',
    'update',
    'demo-ops@demo-ops',
    '--scope',
    'user',
  ]);
});

test('version check reports missing Claude plugin entry even when metadata exists', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'other@other': [{ scope: 'user', installPath: '/tmp/other', version: '1.0.0' }],
    },
  });
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });

  const result = runScript(
    'check-plugin-version.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      '--surface',
      'claude',
      '--json',
      pluginName,
    ],
    { env: { ...process.env, PATH: '' } },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.claude.status, 'missing');
  assert.equal(payload.claude.cli.status, 'path-missing-with-home');
  assert.deepEqual(payload.claude.entries, []);
  assert.equal(payload.versionMismatch, true);
  assert.deepEqual(payload.actions[1].command, [
    'claude',
    'plugin',
    'install',
    'demo-ops@demo-ops',
    '--scope',
    'user',
  ]);
});

test('version check strict mode fails when Claude metadata points at an empty install path', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  mkdirSync(installPath, { recursive: true });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [{ scope: 'user', installPath, version: '0.1.2' }],
    },
  });

  const result = runScript(
    'check-plugin-version.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      '--surface',
      'claude',
      '--strict-installed',
      '--json',
      pluginName,
    ],
    { env: { ...process.env, PATH: '' } },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.claude.entries[0].installPathExists, true);
  assert.equal(payload.claude.entries[0].installPathHasFiles, false);
  assert.equal(payload.versionMismatch, true);
});

test('version check emits well-formed Claude action entries', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeJson(claudeHome, 'plugins/installed_plugins.json', { version: 2, plugins: {} });
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });

  const result = runScript(
    'check-plugin-version.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      '--surface',
      'claude',
      '--json',
      pluginName,
    ],
    { env: { ...process.env, PATH: '' } },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const action = JSON.parse(result.stdout).actions[0];
  assert.equal(action.surface, 'claude');
  assert.equal(action.kind, 'command');
  assert.deepEqual(action.command, ['claude', 'plugin', 'marketplace', 'update', 'demo-ops']);
  assert.equal(action.reason, 'refresh-claude-marketplace');
  assert.equal(action.requiresCli, 'claude');
});
```

Update these existing version-check tests so every requested Claude surface uses
an explicit `--claude-home` fixture and never reads the real user's
`~/.claude`:

- `version check reports matching source versions and Codex cache versions`
- `version check emits structured JSON when requested`
- `version check --surface claude skips Codex cache installed-state checks`
- `version check --surface source skips installed-state checks`
- `version check --surface source keeps human output focused on source state`
- any other existing `check-plugin-version.mjs` invocation whose surface is
  `all` or `claude`

For `version check reports matching source versions and Codex cache versions`,
pass a nonexistent Claude home so strict mode proves that an unavailable Claude
surface does not read real metadata:

```js
const claudeHome = join(makeRoot(), 'missing-claude-home');
const result = runScript(
  'check-plugin-version.mjs',
  [
    '--root',
    root,
    '--codex-home',
    codexHome,
    '--claude-home',
    claudeHome,
    '--strict-installed',
    pluginName,
  ],
  {
    env: { ...process.env, PATH: '' },
  },
);
```

Expected: status remains `0`; human output reports the source and Codex cache
state, and does not depend on the developer machine's real Claude metadata.
Replace the old `assert.match(result.stdout, /claude: CLI unavailable/)` with an
assertion for the new unavailable report, for example:

```js
assert.match(result.stdout, /claude: not initialized|claude: CLI unavailable/);
```

For `version check emits structured JSON when requested`, pass a nonexistent
Claude home path. Do not use `makeRoot()` itself because `makeRoot()` creates a
directory and therefore produces `path-missing-with-home`.

```js
const claudeHome = join(makeRoot(), 'missing-claude-home');
// pass '--claude-home', claudeHome
assert.equal(payload.claude.status, 'not-initialized');
assert.equal(payload.claude.cli.status, 'not-initialized');
```

For `version check --surface claude skips Codex cache installed-state checks`,
create a temporary Claude home with a user-scope install entry matching the fake
CLI payload, and pass `--claude-home`:

```js
const claudeHome = makeRoot();
const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/skills/docs-review/SKILL.md', '# Skill');
writeJson(claudeHome, 'plugins/installed_plugins.json', {
  version: 2,
  plugins: {
    'demo-ops@demo-ops': [{ scope: 'user', installPath, version: '0.1.2' }],
  },
});
// pass '--claude-home', claudeHome
```

For source-only tests, pass a nonexistent `--claude-home` path when the command
already receives a fake PATH. Source-only mode must not read that path or invoke
the fake `claude` command.

- [ ] **Step 2: Run focused version-check tests and confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'version check'
```

Expected: FAIL because `--claude-home` and fallback payloads are not implemented.

- [ ] **Step 3: Wire `check-plugin-version.mjs` to the probe**

Modify `scripts/check-plugin-version.mjs`:

- Add `const claudeHome = normalize(args['claude-home'] || join(homedir(), '.claude'));`.
- Import `probeClaudeState`.
- Keep existing source version checks unchanged.
- Keep existing Codex cache output shape unchanged.
- For Codex cache output, use `probeCodexCache()` from the shared probe rather
  than duplicating directory enumeration in `check-plugin-version.mjs`.
- For `checkClaude`, use official CLI when `probeClaudeState(...).cli.status === 'available'`; otherwise use the fallback state directly.
- Every Claude result shape, including official CLI `present`, `stale`,
  `missing`, `command-failed`, and `parse-error` cases, must include
  `cli: { status: <status>, path: <path-or-null> }`.
- Always include top-level `actions: []`.
- Copy Claude fallback `actions` to the top-level `actions`.
- Set `versionMismatch = true` when:
  - Claude status is `missing`,
  - any requested official CLI state is stale,
  - fallback entries exist but no entry has `usableExpectedInstall === true`,
  - fallback metadata parse failed.

Use this shape when serializing JSON:

```js
const actions = [];
// append Codex or Claude actions as objects when the script can name a next step

console.log(
  JSON.stringify(
    {
      pluginName,
      expectedVersion,
      sourceVersions,
      codexCache,
      claude: claudeStatus,
      versionMismatch,
      actions,
    },
    null,
    2,
  ),
);
```

For human output when Claude CLI is unavailable, print the derived actions:

```js
for (const action of claudeStatus.actions || []) {
  if (action.kind === 'command') {
    console.log(`  ${action.command.join(' ')}`);
  }
}
```

Do not add a second command-list field inside `claudeStatus`.

- [ ] **Step 4: Run focused version-check tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'version check'
```

Expected: PASS.

- [ ] **Step 5: Commit version-check fallback**

Run:

```bash
git add scripts/check-plugin-version.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "feat: report Claude plugin state without CLI"
```

Expected: commit succeeds.

---

### Task 3: Make Local Agent Sync Provenance-Aware

**Files:**

- Modify: `scripts/update-local-agent-triggers.mjs`
- Modify: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing local-sync policy tests**

First update every existing `update-local-agent-triggers.mjs` test to pass a
temporary `--claude-home` fixture. The local sync tests must never read the real
user's `~/.claude`.

For `local agent trigger refresh syncs stale Codex cache and updates Claude when
available`, add a matching user-scope Claude metadata fixture so
`buildClaudeActions()` chooses `update --scope user`, preserving the existing
expectation:

```js
const claudeHome = makeRoot();
const claudeInstallPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/skills/docs-review/SKILL.md', '# Skill');
writeJson(claudeHome, 'plugins/installed_plugins.json', {
  version: 2,
  plugins: {
    'demo-ops@demo-ops': [{ scope: 'user', installPath: claudeInstallPath, version: '0.1.2' }],
  },
});
writeJson(claudeHome, 'plugins/known_marketplaces.json', {
  'demo-ops': {
    source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
    installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
  },
});
```

Then add `--claude-home`, `claudeHome` to that test's script arguments.

For `local agent trigger refresh syncs when structured version check reports
missing expected cache`, add the same user-scope Claude fixture, including
`plugins/known_marketplaces.json`, and pass `--claude-home`.

For `local agent trigger refresh uses structured version check output`, add an
assertion that the script includes `'--claude-home'` in the internal
`check-plugin-version.mjs` argument list:

```js
assert.match(script, /'--claude-home'/);
```

Update the current `local agent trigger refresh skips Claude update when CLI is unavailable` test so it passes `--claude-home` and asserts report-only behavior:

```js
test('local agent trigger refresh reports Claude fallback without writing Claude metadata when CLI is unavailable', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  cpSync(join(root, pluginDir), join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'), {
    recursive: true,
  });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath: join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'),
          version: '0.1.2',
        },
      ],
    },
  });
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });
  const before = readFileSync(join(claudeHome, 'plugins/installed_plugins.json'), 'utf8');

  const result = runScript(
    'update-local-agent-triggers.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      '--no-codex-debug',
      pluginName,
    ],
    { env: { ...process.env, PATH: '' } },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /claude: CLI unavailable; reporting filesystem metadata only/);
  assert.match(result.stdout, /claude plugin marketplace update demo-ops/);
  assert.equal(readFileSync(join(claudeHome, 'plugins/installed_plugins.json'), 'utf8'), before);
});
```

Add a test for user-scope install when the plugin is present only in project/local metadata:

```js
test('local agent trigger refresh installs user scope when Claude has only project scope', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  cpSync(join(root, pluginDir), join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'), {
    recursive: true,
  });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'local',
          projectPath: '/tmp/other-project',
          installPath: join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'),
          version: '0.1.2',
        },
      ],
    },
  });
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude %s\\n' "$*" >> "${commandLog}"
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2","scope":"local"}]\\n'
fi
`,
  );

  const result = runScript(
    'update-local-agent-triggers.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      '--no-codex-debug',
      pluginName,
    ],
    { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const log = readFileSync(commandLog, 'utf8');
  assert.match(log, /claude plugin install demo-ops@demo-ops --scope user/);
  assert.doesNotMatch(log, /claude plugin update demo-ops@demo-ops --scope local/);
});
```

Add a test for cache health warnings not blocking official CLI:

```js
test('local agent trigger refresh reports Claude cache health markers without blocking CLI update', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  cpSync(join(root, pluginDir), join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'), {
    recursive: true,
  });
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(
    claudeHome,
    'plugins/cache/demo-ops/demo-ops/0.1.2/.orphaned_at',
    '2026-05-21T00:00:00.000Z',
  );
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/.in_use/12345', '');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [{ scope: 'user', installPath, version: '0.1.2' }],
    },
  });
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude %s\\n' "$*" >> "${commandLog}"
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2","scope":"user"}]\\n'
fi
`,
  );

  const result = runScript(
    'update-local-agent-triggers.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      '--no-codex-debug',
      pluginName,
    ],
    { env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /orphaned/);
  assert.match(result.stdout, /in-use/);
  assert.match(
    readFileSync(commandLog, 'utf8'),
    /claude plugin uninstall demo-ops@demo-ops --scope user/,
  );
  assert.match(
    readFileSync(commandLog, 'utf8'),
    /claude plugin install demo-ops@demo-ops --scope user/,
  );
});
```

Keep the existing test that validates `--no-codex-debug`; add one assertion that `trigger layer validation passed` remains in stdout.

- [ ] **Step 2: Run local-sync tests and confirm they fail**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'local agent trigger refresh'
```

Expected: FAIL because `--claude-home` and the new Claude policy are not wired.

- [ ] **Step 3: Update `update-local-agent-triggers.mjs`**

Modify `scripts/update-local-agent-triggers.mjs`:

- Add `const claudeHome = normalize(args['claude-home'] || join(homedir(), '.claude'));`.
- Import `probeClaudeState`.
- Keep the existing `validate-trigger-layer.mjs --root <root>` call before cache decisions.
- Keep the existing Codex cache stale check and `sync-codex-plugin-cache.mjs` call.
- Keep Codex prompt-input verification after Codex sync unless `--no-codex-debug` is passed.
- Pass `--claude-home` to the internal `check-plugin-version.mjs --json` call.
- Replace `runClaude()` branching with probe-driven policy:

```js
const claudeState = probeClaudeState({
  claudeHome,
  envPath: process.env.PATH || '',
  expectedVersion: codexEntry.version,
  marketplaceName: claudeMarketplace?.name || codexMarketplace.name || pluginName,
  pluginName,
});

for (const entry of claudeState.entries || []) {
  if (entry.warnings?.length > 0) {
    const scope = entry.scope || 'unknown-scope';
    console.log(`claude: ${scope} cache warnings: ${entry.warnings.join(', ')}`);
  }
}

if (claudeState.cli.status !== 'available') {
  console.log('claude: CLI unavailable; reporting filesystem metadata only');
  for (const action of claudeState.actions || []) {
    if (action.kind === 'command') console.log(`  ${action.command.join(' ')}`);
  }
} else {
  // run official claude validate/update/install commands only
}
```

The warning-reporting loop is required on both CLI-unavailable and CLI-available
paths. It must print cache-health warnings from `claudeState.entries[].warnings`
such as `orphaned`, `in-use`, `install-path-missing`, and `install-path-empty`
before any official Claude command actions run. Warnings are report-only; they do
not block `claude plugin marketplace update`, `uninstall`, `install`, or
`update`.

When CLI is available, choose the official command from `claudeState.actions`:

```js
for (const action of claudeState.actions || []) {
  if (action.kind === 'command') {
    runClaude(action.command.slice(1));
  }
}
runClaude(['plugin', 'list', '--json']);
```

Before running action commands, still run:

```js
runClaude(['plugin', 'validate', root]);
runClaude(['plugin', 'validate', pluginDirAbsolute]);
```

Do not write, copy, rename, or delete anything under `claudeHome`.

- [ ] **Step 4: Run local-sync tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'local agent trigger refresh'
```

Expected: PASS.

- [ ] **Step 5: Run version-check and Codex sync focused tests together**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'version check|Codex plugin cache sync|local agent trigger refresh|plugin state probe'
```

Expected: PASS.

- [ ] **Step 6: Commit local sync policy**

Run:

```bash
git add scripts/update-local-agent-triggers.mjs tests/trigger-layer-scripts.test.mjs
git commit -m "fix: keep Claude local sync provenance-aware"
```

Expected: commit succeeds.

---

### Task 4: Update Documentation, Skills, And Version

**Files:**

- Modify: `README.md`
- Modify: `plugins/agent-trigger-kit/skills/version-check/SKILL.md`
- Modify: `plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md`
- Modify: `plugins/agent-trigger-kit/skills/codex-plugin-marketplace/SKILL.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.codex-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/agent-trigger-kit/.claude-plugin/plugin.json`
- Test: `tests/trigger-layer-scripts.test.mjs`

- [ ] **Step 1: Write failing docs/skill exposure tests**

Add this test near the existing plugin-visible skill tests:

```js
test('version and lifecycle skills document provenance-aware Claude fallback', () => {
  const versionSkill = readFileSync(
    join(repoRoot, 'plugins/agent-trigger-kit/skills/version-check/SKILL.md'),
    'utf8',
  );
  const lifecycleSkill = readFileSync(
    join(repoRoot, 'plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md'),
    'utf8',
  );
  const codexSkill = readFileSync(
    join(repoRoot, 'plugins/agent-trigger-kit/skills/codex-plugin-marketplace/SKILL.md'),
    'utf8',
  );

  assert.match(versionSkill, /Claude CLI unavailable/i);
  assert.match(versionSkill, /filesystem metadata/i);
  assert.match(versionSkill, /official `claude` CLI/i);
  assert.match(lifecycleSkill, /Git-sourced marketplace/i);
  assert.match(lifecycleSkill, /do not copy/i);
  assert.match(codexSkill, /local Codex marketplace source/i);
});
```

- [ ] **Step 2: Run the docs/skill test and confirm it fails**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'provenance-aware Claude fallback'
```

Expected: FAIL because the skill text has not been updated.

- [ ] **Step 3: Update README**

In `README.md`, update the "Check Your Version" section after the `--json` example with this text:

```md
When `claude` is unavailable in the current shell, `--surface claude` and
`--surface all` fall back to read-only Claude metadata under `~/.claude`. The
report names installed entries, cache health warnings, and official commands to
run from a shell where `claude` is available. Agent Trigger Kit does not copy
local working tree files into Git-sourced Claude plugin caches.
```

Also document `--claude-home` near `--codex-home` examples:

```bash
npm run ops:plugin-version-check -- --surface claude --claude-home /tmp/claude-home --json agent-trigger-kit
```

- [ ] **Step 4: Update version-check skill**

In `plugins/agent-trigger-kit/skills/version-check/SKILL.md`, add this bullet under "Core Model":

```md
- When Claude CLI unavailable appears in a Codex shell, the checkout script can
  read Claude filesystem metadata read-only. Treat that as a report, not a
  repair; next steps must be official `claude` CLI commands.
```

Replace the current "If Codex or Claude installed state is stale" command block with wording that includes the fallback:

````md
If Claude metadata is stale but the `claude` CLI is unavailable in this shell,
report the metadata state and give the operator commands to run where Claude
Code exposes the CLI:

```bash
claude plugin marketplace update agent-trigger-kit
claude plugin update agent-trigger-kit@agent-trigger-kit --scope user
```
````

- [ ] **Step 5: Update Claude lifecycle skill**

In `plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md`, add a "Provenance Boundary" section after "Install Scope":

```md
## Provenance Boundary

Agent Trigger Kit itself is a Git-sourced marketplace in Claude Code. Do not
copy a local working tree into `~/.claude/plugins/marketplaces/**` or
`~/.claude/plugins/cache/**` as a default repair. That makes the cache files
disagree with the marketplace clone's Git `HEAD`.

If `claude` is unavailable in the current shell, inspect filesystem metadata
read-only and report official commands for a shell where `claude` is available.
Dirty marketplace clones should be reported by path and dirty file list before
running update commands.
```

- [ ] **Step 6: Update Codex marketplace skill**

In `plugins/agent-trigger-kit/skills/codex-plugin-marketplace/SKILL.md`, add this sentence under "Scope Model":

```md
Local cache copy is allowed only for a local Codex marketplace source;
do not generalize this behavior to Git-sourced Claude Code plugin caches.
```

- [ ] **Step 7: Update changelog and bump version**

Add a `0.1.9` entry at the top of `CHANGELOG.md`:

```md
## 0.1.9

- Added provenance-aware version reporting for Claude Code when the `claude` CLI
  is unavailable in the current shell.
- Kept Claude Code filesystem fallback read-only and limited local cache copying
  to local Codex marketplace sources.
- Preserved trigger-layer validation and Codex prompt-input verification in the
  local agent sync workflow.
```

Run the existing bump script:

```bash
node scripts/bump-plugin-version.mjs --root . --plugin agent-trigger-kit --version 0.1.9
```

Expected: `package.json`, both marketplace manifests, and both plugin manifests move to `0.1.9`.

- [ ] **Step 8: Run focused docs/skill/version tests**

Run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'provenance-aware Claude fallback|plugin-visible files stay version-aligned'
```

If the second pattern does not match an existing test name, run:

```bash
node --test tests/trigger-layer-scripts.test.mjs --test-name-pattern 'version|plugin-visible'
```

Expected: PASS.

- [ ] **Step 9: Commit docs and version bump**

Run:

```bash
git add README.md CHANGELOG.md package.json .agents/plugins/marketplace.json .claude-plugin/marketplace.json plugins/agent-trigger-kit/.codex-plugin/plugin.json plugins/agent-trigger-kit/.claude-plugin/plugin.json plugins/agent-trigger-kit/skills/version-check/SKILL.md plugins/agent-trigger-kit/skills/claude-plugin-lifecycle/SKILL.md plugins/agent-trigger-kit/skills/codex-plugin-marketplace/SKILL.md tests/trigger-layer-scripts.test.mjs
git commit -m "docs: document provenance-aware plugin sync"
```

Expected: commit succeeds.

---

### Task 5: Full Verification And Cache Refresh

**Files:**

- Verify: entire repo
- Optional write through approved workflow: Codex local cache via `npm run ops:local-agent-sync`

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS with all `node:test` suites green.

- [ ] **Step 2: Run formatting check**

Run:

```bash
npm run format:check
```

Expected: PASS with "All matched files use Prettier code style!".

- [ ] **Step 3: Run trigger-layer validation**

Run:

```bash
npm run validate
```

Expected: PASS with `trigger layer validation passed for .`.

- [ ] **Step 4: Run source version check**

Run:

```bash
npm run ops:plugin-version-check -- --surface source agent-trigger-kit
```

Expected: PASS and every source surface reports `0.1.9`.

- [ ] **Step 5: Run Codex/Claude reporting check without mutating Claude state**

Run:

```bash
npm run ops:plugin-version-check -- --surface all --json agent-trigger-kit
```

Expected: PASS. Codex cache may report stale until refreshed. Claude may report CLI unavailable plus filesystem metadata. The JSON includes top-level `actions`.

- [ ] **Step 6: Refresh local Codex cache only after tests pass**

This step writes to the real Codex plugin cache under `~/.codex` when run
without `--codex-home`. Confirm with the maintainer before running it on a
developer machine.

Run:

```bash
npm run ops:local-agent-sync -- --no-codex-debug agent-trigger-kit
```

Expected:

- Trigger-layer validation runs.
- Codex local cache sync runs if cache is stale or missing.
- Claude state is updated only if the official `claude` CLI is available.
- If `claude` is unavailable, output reports filesystem metadata and official commands without writing to `~/.claude/**`.

- [ ] **Step 7: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean working tree after the task commits, or only intentionally uncommitted planning/spec files if the implementation was done before committing this plan.

---

## Self-Review Checklist

- Spec invariant covered: Task 1 and Task 3 keep Claude filesystem access read-only unless invoking official `claude` CLI commands.
- Out-of-scope covered: no task creates a working-tree-to-Claude-cache copy script.
- Probe covered: Task 1 creates the shared probe and fast checks.
- Version-check fallback covered: Task 2 handles CLI unavailable, missing metadata, missing plugin entry, broken install paths, `actions`, and strict exit behavior.
- Local sync covered: Task 3 keeps validation, Codex prompt-input verification, Codex local cache sync, Claude official CLI actions, and report-only fallback.
- Docs/version covered: Task 4 updates user docs, plugin-visible skills, changelog, and aligned manifests to `0.1.9`.
- Verification covered: Task 5 runs full tests, formatting, validation, version checks, and local cache refresh.
