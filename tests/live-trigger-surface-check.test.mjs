import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  effectiveTimeoutMs,
  extractTomlTableNames,
  loadLiveSurfaceMatrix,
  renderLiveSurfaceMarkdown,
  validateLiveSurfaceMatrix,
} from '../scripts/lib/live-surface-matrix.mjs';
import {
  collectSourceVersionSnapshot,
  sourceVersionsDiffer,
} from '../scripts/lib/source-version-snapshot.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-live-trigger-surface-'));
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function writeJson(root, path, value) {
  write(root, path, JSON.stringify(value, null, 2));
}

function writeCodexCache(root, marketplaceName, pluginName, version) {
  write(
    root,
    `.codex/plugins/cache/${marketplaceName}/${pluginName}/${version}/skills/demo/SKILL.md`,
    `
---
name: demo
---

# Demo
`,
  );
}

function writeClaudeInstalled(root, pluginId, entry) {
  writeJson(root, '.claude/plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      [pluginId]: [entry],
    },
  });
  const installPath = isAbsolute(entry.installPath)
    ? relative(root, entry.installPath)
    : entry.installPath;
  write(
    root,
    `${installPath}/skills/demo/SKILL.md`,
    `
---
name: demo
---

# Demo
`,
  );
}

function writeLiveMatrix(root, text) {
  write(root, '.agent-trigger-kit/live-surfaces.yaml', text);
}

function createVersionedPlugin(root, version = '0.2.3') {
  const pluginName = 'demo-ops';
  const pluginDir = `plugins/${pluginName}`;

  writeJson(root, 'package.json', {
    name: pluginName,
    version,
    type: 'module',
  });
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: { source: 'local', path: `./${pluginDir}` },
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: pluginName,
    plugins: [
      {
        name: pluginName,
        version,
        source: `./${pluginDir}`,
      },
    ],
  });
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version,
  });
  writeJson(root, `${pluginDir}/.claude-plugin/plugin.json`, {
    name: pluginName,
    version,
  });

  return { pluginDir, pluginName, version };
}

function runScript(scriptName, args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

test('source snapshot reports aligned source versions', () => {
  const root = makeRoot();
  const { pluginDir, pluginName, version } = createVersionedPlugin(root, '0.2.3');

  const snapshot = collectSourceVersionSnapshot({ root, pluginName });

  assert.equal(snapshot.pluginName, pluginName);
  assert.equal(snapshot.expectedVersion, version);
  assert.equal(snapshot.pluginDir, pluginDir);
  assert.deepEqual(snapshot.sourceVersions, [
    { label: 'package.json', version: '0.2.3' },
    { label: 'codex marketplace', version: '0.2.3' },
    { label: 'codex plugin', version: '0.2.3' },
    { label: 'claude marketplace', version: '0.2.3' },
    { label: 'claude plugin', version: '0.2.3' },
  ]);
  assert.equal(sourceVersionsDiffer(snapshot), false);

  const result = runScript('check-plugin-version.mjs', [
    '--root',
    root,
    '--surface',
    'source',
    pluginName,
  ]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /expected source version: 0\.2\.3/);
});

test('validate checks live surface matrix schema and generated markdown freshness', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );
  write(root, 'docs/agent-trigger-surfaces.md', '| stale |\n| --- |\n');

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /docs\/agent-trigger-surfaces\.md: generated Markdown is stale/);
});

test('validate checks malformed live surface matrix without raw stack trace', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  write(root, '.agent-trigger-kit/live-surfaces.yaml', 'schemaVersion: [\n');

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.agent-trigger-kit\/live-surfaces\.yaml/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('render-matrix writes generated Markdown from matrix', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', [
    'render-matrix',
    '--root',
    root,
    '--matrix',
    '.agent-trigger-kit/live-surfaces.yaml',
    '--output',
    'docs/agent-trigger-surfaces.md',
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /wrote docs\/agent-trigger-surfaces\.md/);
  assert.match(
    readFileSync(join(root, 'docs/agent-trigger-surfaces.md'), 'utf8'),
    /\| codex \| user \|/,
  );
});

test('render-matrix rejects output paths outside root', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', [
    'render-matrix',
    '--root',
    root,
    '--output',
    '../outside.md',
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /render-matrix --output must stay within --root/);
});

test('render-matrix rejects absolute output paths', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', [
    'render-matrix',
    '--root',
    root,
    '--output',
    join(root, 'docs/agent-trigger-surfaces.md'),
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /render-matrix --output must stay within --root/);
});

test('live-check reports drift, allowed drift, and clean rows without mutating state', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  writeCodexCache(root, 'demo-ops', 'demo-ops', '0.1.0');
  writeClaudeInstalled(root, 'demo-ops@demo-ops', {
    scope: 'project',
    projectPath: root,
    version: '0.0.9',
    installPath: join(root, '.claude/plugins/cache/demo-ops/demo-ops/0.0.9'),
  });
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
      codexHome: \${ROOT}/.codex
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
  - id: claude-project-demo-ops
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
      claudeHome: \${ROOT}/.claude
      projectPath: \${ROOT}
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );
  const beforeInstalled = readFileSync(
    join(root, '.claude/plugins/installed_plugins.json'),
    'utf8',
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'drift');
  assert.equal(payload.summary.clean, 1);
  assert.equal(payload.summary.drift, 1);
  assert.equal(payload.results[0].resultType, 'surface');
  assert.equal(payload.results[0].status, 'clean');
  assert.equal(payload.results[1].resultType, 'surface');
  assert.equal(payload.results[1].status, 'drift');
  assert.match(payload.results[1].nextActions.join('\n'), /claude plugin update/);
  assert.equal(
    readFileSync(join(root, '.claude/plugins/installed_plugins.json'), 'utf8'),
    beforeInstalled,
  );
});

test('live-check claude verifier does not run git or claude commands', () => {
  const root = makeRoot();
  const fakeBin = join(root, 'fake-bin');
  const commandLog = join(root, 'command-log.txt');
  createVersionedPlugin(root, '0.1.0');
  writeClaudeInstalled(root, 'demo-ops@demo-ops', {
    scope: 'project',
    projectPath: root,
    version: '0.0.9',
    installPath: join(root, '.claude/plugins/cache/demo-ops/demo-ops/0.0.9'),
  });
  writeJson(root, '.claude/plugins/known_marketplaces.json', {
    'demo-ops': {
      installLocation: join(root, 'marketplace-clone'),
      source: '/unused',
    },
  });
  write(root, 'marketplace-clone/.keep', 'present');
  write(
    root,
    'fake-bin/git',
    `#!/bin/sh
echo git >> "${commandLog}"
exit 99
`,
  );
  chmodSync(join(root, 'fake-bin/git'), 0o755);
  write(
    root,
    'fake-bin/claude',
    `#!/bin/sh
echo claude >> "${commandLog}"
exit 99
`,
  );
  chmodSync(join(root, 'fake-bin/claude'), 0o755);
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: claude-project-demo-ops
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
      claudeHome: \${ROOT}/.claude
      projectPath: \${ROOT}
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json'], {
    env: {
      ...process.env,
      PATH: `${fakeBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}`,
    },
  });

  assert.equal(result.status, 1);
  assert.equal(existsSync(commandLog), false);
});

test('live-check reports validation error for malformed claude installed metadata', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  writeJson(root, '.claude/plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [null],
    },
  });
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: claude-project-demo-ops
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
      claudeHome: \${ROOT}/.claude
      projectPath: \${ROOT}
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 2);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /\n\s+at /);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'validation-error');
  assert.equal(payload.results[0].resultType, 'surface');
  assert.equal(payload.results[0].status, 'validation-error');
  assert.match(payload.results[0].message, /installed_plugins\.json/);
});

test('live-check reports validation error for non-string claude install path metadata', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  writeJson(root, '.claude/plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'project',
          projectPath: root,
          version: '0.1.0',
          installPath: { bad: true },
        },
      ],
    },
  });
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: claude-project-demo-ops
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
      claudeHome: \${ROOT}/.claude
      projectPath: \${ROOT}
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 2);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /\n\s+at /);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'validation-error');
  assert.equal(payload.results[0].status, 'validation-error');
  assert.match(payload.results[0].message, /installPath/);
});

test('live-check keeps allowed-until date active through end-of-day UTC', () => {
  const root = makeRoot();
  const todayUtc = new Date().toISOString().slice(0, 10);
  createVersionedPlugin(root, '0.1.0');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
      codexHome: \${ROOT}/.codex
    headless: safe
    owner: demo
    stalenessBudget:
      mode: allowed-until
      allowed-until: ${todayUtc}
      reason: same-day review window
`,
  );

  const allowedResult = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);
  const strictResult = runScript('live-trigger-surface-check.mjs', [
    '--root',
    root,
    '--json',
    '--strict-allowed-drift',
  ]);

  assert.equal(allowedResult.status, 0);
  assert.equal(JSON.parse(allowedResult.stdout).results[0].status, 'allowed-drift');
  assert.equal(strictResult.status, 1);
  assert.equal(JSON.parse(strictResult.stdout).results[0].status, 'drift');
});

test('live-check flags codex forbidden config residue by exact table names', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  write(
    root,
    '.codex/config.toml',
    `
[marketplaces.demo-ops]
path = "./demo-ops"

[plugins."demo-ops@demo-ops"]
enabled = true
`,
  );
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-config-residue
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: negative-config-assertion
    sourceTruth: config
    liveVerifier:
      kind: codex-config-absence
      configPath: \${ROOT}/.codex/config.toml
      forbiddenPluginIds:
        - demo-ops@demo-ops
      forbiddenMarketplaces:
        - demo-ops
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'drift');
  assert.equal(payload.results[0].resultType, 'surface');
  assert.equal(payload.results[0].status, 'drift');
  assert.match(payload.results[0].message, /demo-ops@demo-ops/);
});

test('live-check expands environment fallback paths in codex config absence verifier', () => {
  const root = makeRoot();
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    process.env.CODEX_HOME = join(root, '.codex');
    createVersionedPlugin(root, '0.1.0');
    write(
      root,
      '.codex/config.toml',
      `
[plugins."demo-ops@demo-ops"]
enabled = true
`,
    );
    writeLiveMatrix(
      root,
      `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-config-residue
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: negative-config-assertion
    sourceTruth: config
    liveVerifier:
      kind: codex-config-absence
      configPath: \${CODEX_HOME:-~/.codex}/config.toml
      forbiddenPluginIds:
        - demo-ops@demo-ops
      forbiddenMarketplaces: []
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
    );

    const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout).results[0].message, /demo-ops@demo-ops/);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test('live-check uses effective timeout precedence for row timeout and invalid cli timeout', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  writeCodexCache(root, 'demo-ops', 'demo-ops', '0.1.0');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
defaults:
  timeoutMs: 20000
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    timeoutMs: -1
    liveVerifier:
      kind: codex-cache
      codexHome: \${ROOT}/.codex
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', [
    '--root',
    root,
    '--json',
    '--timeout-ms',
    'invalid',
  ]);

  assert.equal(result.status, 124);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'timeout');
  assert.equal(payload.results[0].status, 'timeout');
});

test('live-check honors AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS when no row cli or default timeout exists', () => {
  const root = makeRoot();
  const previousTimeout = process.env.AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS;
  createVersionedPlugin(root, '0.1.0');
  writeCodexCache(root, 'demo-ops', 'demo-ops', '0.1.0');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
      codexHome: \${ROOT}/.codex
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  try {
    process.env.AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS = '-1';
    const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

    assert.equal(result.status, 124);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'timeout');
    assert.equal(payload.results[0].status, 'timeout');
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS;
    } else {
      process.env.AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS = previousTimeout;
    }
  }
});

test('live-check component-name-disjoint appends assertion results and strips command .md extensions', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  write(
    root,
    'plugins/demo-ops/skills/scan/SKILL.md',
    `
---
name: scan
---

# Scan
`,
  );
  write(
    root,
    'plugins/demo-ops/commands/scan.md',
    `
---
description: Scan surfaces
---
`,
  );
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces: []
assertions:
  - id: no-skill-command-name-collisions
    kind: component-name-disjoint
    plugin: demo-ops
    sets:
      - skills
      - commands
    onFailure: drift
    owner: demo
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'drift');
  assert.equal(payload.results[0].resultType, 'assertion');
  assert.equal(payload.results[0].kind, 'component-name-disjoint');
  assert.equal(payload.results[0].status, 'drift');
  assert.match(payload.results[0].message, /scan/);
});

test('live-check component-name-disjoint ignores duplicate names within one set', () => {
  const root = makeRoot();
  createVersionedPlugin(root, '0.1.0');
  write(
    root,
    'plugins/demo-ops/skills/scan-a/SKILL.md',
    `
---
name: scan
---

# Scan A
`,
  );
  write(
    root,
    'plugins/demo-ops/skills/scan-b/SKILL.md',
    `
---
name: scan
---

# Scan B
`,
  );
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces: []
assertions:
  - id: no-skill-command-name-collisions
    kind: component-name-disjoint
    plugin: demo-ops
    sets:
      - skills
      - commands
    onFailure: drift
    owner: demo
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'clean');
  assert.equal(payload.results[0].status, 'clean');
});

test('live-check exits zero when filters select no rows', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces: []
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--owner', 'nobody']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /no rows selected/);
});

test('cli routes render-matrix command to live surface script', () => {
  const root = makeRoot();
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('cli.mjs', [
    'render-matrix',
    '--root',
    root,
    '--matrix',
    '.agent-trigger-kit/live-surfaces.yaml',
    '--output',
    'docs/agent-trigger-surfaces.md',
  ]);

  assert.equal(result.status, 0);
  assert.match(
    readFileSync(join(root, 'docs/agent-trigger-surfaces.md'), 'utf8'),
    /\| codex \| user \|/,
  );
});

test('source snapshot defaults omitted root to the current working directory', () => {
  const root = makeRoot();
  const { pluginDir, pluginName, version } = createVersionedPlugin(root, '0.2.3');
  const previousCwd = process.cwd();

  try {
    process.chdir(root);

    const snapshot = collectSourceVersionSnapshot({ pluginName });

    assert.equal(snapshot.pluginName, pluginName);
    assert.equal(snapshot.expectedVersion, version);
    assert.equal(snapshot.pluginDir, pluginDir);
    assert.equal(sourceVersionsDiffer(snapshot), false);
  } finally {
    process.chdir(previousCwd);
  }
});

test('source snapshot reports malformed JSON without exiting', () => {
  const root = makeRoot();
  const { pluginName } = createVersionedPlugin(root, '0.2.3');
  write(root, 'package.json', '{');
  const previousExit = process.exit;

  try {
    process.exit = (code) => {
      throw new Error(`process.exit(${code})`);
    };

    const snapshot = collectSourceVersionSnapshot({ root, pluginName });

    assert.equal(snapshot.pluginName, pluginName);
    assert.deepEqual(snapshot.sourceVersions, []);
    assert.equal(snapshot.expectedVersion, 'missing');
    assert.equal(snapshot.pluginDir, null);
    assert.equal(snapshot.marketplaceName, pluginName);
    assert.equal(snapshot.claudeMarketplaceName, pluginName);
    assert.match(snapshot.errorMessage, /package\.json/);
    assert.match(snapshot.errorMessage, /Expected property name|JSON/);
    assert.equal(sourceVersionsDiffer(snapshot), true);
  } finally {
    process.exit = previousExit;
  }
});

test('source snapshot reports unaligned source versions', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createVersionedPlugin(root, '0.2.3');
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version: '0.2.2',
  });

  const snapshot = collectSourceVersionSnapshot({ root, pluginName });

  assert.equal(sourceVersionsDiffer(snapshot), true);
  assert.match(snapshot.errorMessage, /source versions differ/);
  assert.match(snapshot.errorMessage, /codex plugin=0\.2\.2/);
});

test('live surface matrix validates schema and applies path defaults', () => {
  const root = makeRoot();

  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
generatedDocs:
  markdownTable: docs/agent-trigger-surfaces.md
defaults:
  timeoutMs: 12345
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
  - id: claude-project-demo-ops
    surface: claude
    scope: project
    plugin: demo-ops
    marketplace: demo-ops
    artifactType: project-plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: claude-installed-plugin
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
assertions:
  - id: no-skill-command-name-collisions
    kind: component-name-disjoint
    plugin: demo-ops
    sets:
      - skills
      - commands
    onFailure: drift
    owner: demo
extraFutureField: preserved
`,
  );

  const matrix = loadLiveSurfaceMatrix({
    root,
    matrixPath: '.agent-trigger-kit/live-surfaces.yaml',
  });
  const validation = validateLiveSurfaceMatrix({ root, matrix });

  assert.deepEqual(validation.errors, []);
  assert.equal(matrix.surfaces[0].timeoutMs, 12345);
  assert.equal(matrix.surfaces[0].liveVerifier.codexHome.endsWith('.codex'), true);
  assert.equal(matrix.surfaces[1].liveVerifier.claudeHome.endsWith('.claude'), true);
  assert.equal(matrix.surfaces[1].liveVerifier.projectPath, root);
  assert.equal(matrix.extraFutureField, 'preserved');
});

test('live surface matrix uses fallback when env path variable is empty', () => {
  const root = makeRoot();
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    process.env.CODEX_HOME = '';
    writeLiveMatrix(
      root,
      `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: codex-demo-ops
    surface: codex
    scope: user
    plugin: demo-ops
    artifactType: plugin-cache
    sourceTruth: source-version
    liveVerifier:
      kind: codex-cache
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
    );

    const matrix = loadLiveSurfaceMatrix({
      root,
      matrixPath: '.agent-trigger-kit/live-surfaces.yaml',
    });

    assert.equal(matrix.surfaces[0].liveVerifier.codexHome.endsWith('.codex'), true);
    assert.notEqual(matrix.surfaces[0].liveVerifier.codexHome, root);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test('live surface matrix rejects invalid assertion onFailure and pointer-only misuse', () => {
  const root = makeRoot();
  const matrix = {
    schemaVersion: 1,
    plugin: 'demo-ops',
    surfaces: [
      {
        id: 'codex-demo-ops',
        surface: 'codex',
        scope: 'user',
        plugin: 'demo-ops',
        artifactType: 'plugin-cache',
        sourceTruth: 'source-version',
        liveVerifier: {
          kind: 'codex-cache',
        },
        headless: 'safe',
        owner: 'demo',
        stalenessBudget: {
          mode: 'pointer-only',
        },
      },
    ],
    assertions: [
      {
        id: 'no-skill-command-name-collisions',
        kind: 'component-name-disjoint',
        plugin: 'demo-ops',
        sets: ['skills', 'commands'],
        onFailure: 'clean',
        owner: 'demo',
      },
    ],
  };

  const validation = validateLiveSurfaceMatrix({ root, matrix });

  assert.match(validation.errors.join('\n'), /pointer-only/);
  assert.match(validation.errors.join('\n'), /onFailure/);
});

test('live surface matrix rejects missing top-level required fields and live verifier kind', () => {
  const root = makeRoot();
  const matrix = {
    surfaces: [
      {
        id: 'codex-demo-ops',
        surface: 'codex',
        scope: 'user',
        plugin: 'demo-ops',
        artifactType: 'plugin-cache',
        sourceTruth: 'source-version',
        liveVerifier: {},
        headless: 'safe',
        owner: 'demo',
        stalenessBudget: {
          mode: 'none',
        },
      },
    ],
  };
  const matrixWithoutSurfaces = {
    schemaVersion: 1,
    plugin: 'demo-ops',
  };

  const validation = validateLiveSurfaceMatrix({ root, matrix });
  const missingSurfacesValidation = validateLiveSurfaceMatrix({
    root,
    matrix: matrixWithoutSurfaces,
  });

  assert.match(validation.errors.join('\n'), /schemaVersion/);
  assert.match(validation.errors.join('\n'), /plugin/);
  assert.match(validation.errors.join('\n'), /liveVerifier\.kind/);
  assert.match(missingSurfacesValidation.errors.join('\n'), /surfaces/);
});

test('live surface matrix renders markdown and extracts codex config table names', () => {
  const markdown = renderLiveSurfaceMarkdown({
    surfaces: [
      {
        id: 'codex-demo-ops',
        surface: 'codex',
        scope: 'user',
        plugin: 'demo-ops',
        artifactType: 'plugin-cache',
        sourceTruth: 'source|truth\\alpha\nbeta',
        liveVerifier: {
          kind: 'codex-cache',
        },
        headless: 'safe',
        owner: 'demo|owner\\name\nnext',
        stalenessBudget: {
          mode: 'none',
        },
      },
    ],
  });

  assert.match(
    markdown,
    /\| Surface \| Scope \| Artifact \| Source Truth \| Live Verifier \| Headless \| Owner \| Staleness Budget \|/,
  );
  assert.match(
    markdown,
    /\| codex \| user \| plugin-cache \| source\\\|truth\\\\alpha\\nbeta \| codex-cache \| safe \| demo\\\|owner\\\\name\\nnext \| none \|/,
  );
  assert.equal(markdown.trimEnd().split('\n').length, 3);

  const names = extractTomlTableNames(`
[marketplaces.stock-scanner-ops]
path = "./stock-scanner-ops"

[plugins."stock-scanner-ops@stock-scanner-ops"]
enabled = true

[plugins."inline-comment@demo"] # trailing comment
enabled = true

[marketplaces.local] # trailing comment
path = "./local"

# [plugins."commented-out"]
`);

  assert.deepEqual(names.plugins, ['stock-scanner-ops@stock-scanner-ops', 'inline-comment@demo']);
  assert.deepEqual(names.marketplaces, ['stock-scanner-ops', 'local']);
});

test('live surface matrix resolves effective timeout using first finite value', () => {
  assert.equal(
    effectiveTimeoutMs({
      rowTimeoutMs: 500,
      cliTimeoutMs: 1000,
      defaultTimeoutMs: 2000,
      envTimeoutMs: 3000,
    }),
    500,
  );
  assert.equal(effectiveTimeoutMs({ rowTimeoutMs: 'abc', cliTimeoutMs: 1000 }), 1000);
  assert.equal(
    effectiveTimeoutMs({
      rowTimeoutMs: 'abc',
      cliTimeoutMs: Number.NaN,
      defaultTimeoutMs: Infinity,
      envTimeoutMs: '4000',
    }),
    4000,
  );
  assert.equal(effectiveTimeoutMs({ rowTimeoutMs: 'abc', cliTimeoutMs: Number.NaN }), 20000);
});
