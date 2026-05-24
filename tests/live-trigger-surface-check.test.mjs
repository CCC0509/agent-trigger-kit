import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { makeTempDir } from './helpers/tmp.mjs';
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
import { expandPath } from '../scripts/lib/path-expand.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-live-trigger-surface-');
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
  const { env, ...spawnOptions } = options;
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...spawnOptions,
    env: {
      ...process.env,
      AGENT_TRIGGER_KIT_OUTCOME_DISABLED: '1',
      ...env,
    },
  });
}

test('docs explain live surface checks for consumer trigger layers', () => {
  const readRepoFile = (path) => readFileSync(join(repoRoot, path), 'utf8');
  const readme = readRepoFile('README.md');
  const crossAgentSkill = readRepoFile(
    'plugins/agent-trigger-kit/skills/cross-agent-trigger-layer/SKILL.md',
  );
  const versionCheckSkill = readRepoFile('plugins/agent-trigger-kit/skills/version-check/SKILL.md');

  assert.match(readme, /live-surfaces\.yaml/);
  assert.match(readme, /agent-trigger-kit live-check/);
  assert.match(
    readme,
    /agent-trigger-kit render-matrix --root <target-repo> --output docs\/agent-trigger-surfaces\.md/,
  );
  assert.match(readme, /read-only by default/i);
  assert.match(crossAgentSkill, /live-check/);
  assert.match(crossAgentSkill, /consumer-owned matrix/i);
  assert.match(crossAgentSkill, /Codex.*global.*residue/is);
  assert.match(versionCheckSkill, /version-check[\s\S]*source/);
  assert.match(versionCheckSkill, /live-check[\s\S]*installed-state drift/);
});

test('source snapshot reports aligned source versions', (t) => {
  const root = makeRoot(t);
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

test('validate checks live surface matrix schema and generated markdown freshness', (t) => {
  const root = makeRoot(t);
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

test('validate checks malformed live surface matrix without raw stack trace', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
  write(root, '.agent-trigger-kit/live-surfaces.yaml', 'schemaVersion: [\n');

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.agent-trigger-kit\/live-surfaces\.yaml/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test('render-matrix writes generated Markdown from matrix', (t) => {
  const root = makeRoot(t);
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

  const result = runScript('render-live-surface-matrix.mjs', [
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

test('render-matrix rejects output paths outside root', (t) => {
  const root = makeRoot(t);
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

  const result = runScript('render-live-surface-matrix.mjs', [
    '--root',
    root,
    '--output',
    '../outside.md',
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /render-matrix --output must stay within --root/);
});

test('render-matrix rejects absolute output paths', (t) => {
  const root = makeRoot(t);
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

  const result = runScript('render-live-surface-matrix.mjs', [
    '--root',
    root,
    '--output',
    join(root, 'docs/agent-trigger-surfaces.md'),
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /render-matrix --output must stay within --root/);
});

test('live-check reports drift, allowed drift, and clean rows without mutating state', (t) => {
  const root = makeRoot(t);
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

test('live-check claude verifier does not run git or claude commands', (t) => {
  const root = makeRoot(t);
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

test('live-check reports validation error for malformed claude installed metadata', (t) => {
  const root = makeRoot(t);
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

test('live-check reports validation error for non-string claude install path metadata', (t) => {
  const root = makeRoot(t);
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

test('live-check reports validation error for non-string claude scope metadata', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
  writeJson(root, '.claude/plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: ['project'],
          projectPath: root,
          version: '0.1.0',
          installPath: join(root, '.claude/plugins/cache/demo-ops/demo-ops/0.1.0'),
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
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'validation-error');
  assert.equal(payload.results[0].status, 'validation-error');
  assert.match(payload.results[0].message, /scope/);
});

test('live-check reports validation error when claude install path cannot be inspected', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
  mkdirSync(join(root, '.claude/plugins/cache/demo-ops/demo-ops'), { recursive: true });
  symlinkSync(
    'missing-install',
    join(root, '.claude/plugins/cache/demo-ops/demo-ops/0.1.0-broken'),
  );
  writeJson(root, '.claude/plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'project',
          projectPath: root,
          version: '0.1.0',
          installPath: join(root, '.claude/plugins/cache/demo-ops/demo-ops/0.1.0-broken'),
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
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'validation-error');
  assert.equal(payload.results[0].status, 'validation-error');
  assert.match(payload.results[0].message, /0\.1\.0-broken/);
});

test('live-check keeps allowed-until date active through end-of-day UTC', (t) => {
  const root = makeRoot(t);
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

test('live-check reports config error for invalid staleness budget dates', (t) => {
  const root = makeRoot(t);
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
      allowed-until: 2025-99-01
      reason: typo in review window
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'config-error');
  assert.equal(payload.results[0].status, 'config-error');
  assert.match(payload.results[0].message, /invalid stalenessBudget.*allowed-until/);
});

test('live-check honors strict allowed drift for pointer docs', (t) => {
  const root = makeRoot(t);
  const todayUtc = new Date().toISOString().slice(0, 10);
  createVersionedPlugin(root, '0.1.0');
  write(root, 'GEMINI.md', '# Gemini pointer\n');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: gemini-pointer
    surface: gemini
    scope: project
    plugin: demo-ops
    artifactType: pointer-doc
    sourceTruth: source
    liveVerifier:
      kind: pointer-doc
      path: \${ROOT}/GEMINI.md
    headless: safe
    owner: demo
    stalenessBudget:
      mode: pointer-only
      until: ${todayUtc}
      reason: same-day pointer migration
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

test('live-check does not allow staleness budget to hide missing pointer docs', (t) => {
  const root = makeRoot(t);
  const todayUtc = new Date().toISOString().slice(0, 10);
  createVersionedPlugin(root, '0.1.0');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: gemini-pointer
    surface: gemini
    scope: project
    plugin: demo-ops
    artifactType: pointer-doc
    sourceTruth: source
    liveVerifier:
      kind: pointer-doc
      path: \${ROOT}/GEMINI.md
    headless: safe
    owner: demo
    stalenessBudget:
      mode: pointer-only
      until: ${todayUtc}
      reason: same-day pointer migration
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).results[0].status, 'drift');
});

test('live-check keeps expired pointer-only budgets as drift', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
  write(root, 'GEMINI.md', '# Gemini pointer\n');
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: gemini-pointer
    surface: gemini
    scope: project
    plugin: demo-ops
    artifactType: pointer-doc
    sourceTruth: source
    liveVerifier:
      kind: pointer-doc
      path: \${ROOT}/GEMINI.md
    headless: safe
    owner: demo
    stalenessBudget:
      mode: pointer-only
      until: 2000-01-01
      reason: expired review window
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).results[0].status, 'drift');
});

test('live-check flags codex forbidden config residue by exact table names', (t) => {
  const root = makeRoot(t);
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

test('live-check reports config error for empty codex config path expansion', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
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
      configPath: \${AGENT_TRIGGER_KIT_TEST_MISSING_CODEX_HOME}/config.toml
      forbiddenPluginIds:
        - demo-ops@demo-ops
      forbiddenMarketplaces: []
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const env = { ...process.env };
  delete env.AGENT_TRIGGER_KIT_TEST_MISSING_CODEX_HOME;
  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json'], { env });

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'config-error');
  assert.equal(payload.results[0].status, 'config-error');
  assert.match(payload.results[0].message, /AGENT_TRIGGER_KIT_TEST_MISSING_CODEX_HOME/);
});

test('live-check defaults codex config absence to CODEX_HOME config', (t) => {
  const root = makeRoot(t);
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    process.env.CODEX_HOME = join(root, 'codex-home');
    createVersionedPlugin(root, '0.1.0');
    write(
      root,
      'codex-home/config.toml',
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
    assert.equal(JSON.parse(result.stdout).results[0].status, 'drift');
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test('live-check expands environment fallback paths in codex config absence verifier', (t) => {
  const root = makeRoot(t);
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

test('live-check uses effective timeout precedence for row timeout and invalid cli timeout', (t) => {
  const root = makeRoot(t);
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

test('live-check honors AGENT_TRIGGER_LIVE_CHECK_TIMEOUT_MS when no row cli or default timeout exists', (t) => {
  const root = makeRoot(t);
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

test('live-check component-name-disjoint appends assertion results and strips command .md extensions', (t) => {
  const root = makeRoot(t);
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

test('live-check reports config error when component skill entries cannot be read', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
  mkdirSync(join(root, 'plugins/demo-ops/skills'), { recursive: true });
  symlinkSync('missing-skill', join(root, 'plugins/demo-ops/skills/broken-skill'));
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

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'config-error');
  assert.equal(payload.results[0].resultType, 'assertion');
  assert.equal(payload.results[0].status, 'config-error');
  assert.match(payload.results[0].message, /broken-skill/);
});

test('live-check reports config error when component command entries cannot be read', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
  mkdirSync(join(root, 'plugins/demo-ops/commands'), { recursive: true });
  symlinkSync('missing-command.md', join(root, 'plugins/demo-ops/commands/broken-command.md'));
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

  assert.equal(result.status, 3);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'config-error');
  assert.equal(payload.results[0].status, 'config-error');
  assert.match(payload.results[0].message, /broken-command\.md/);
});

test('live-check component-name-disjoint ignores duplicate names within one set', (t) => {
  const root = makeRoot(t);
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

test('live-check exits zero when filters select no rows', (t) => {
  const root = makeRoot(t);
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

test('cli prints live-check help without requiring a matrix', () => {
  const result = runScript('cli.mjs', ['live-check', '--help']);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(output, /live-check/);
  assert.match(output, /render-matrix/);
});

test('cli routes render-matrix command to render surface script', (t) => {
  const root = makeRoot(t);
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

test('cli live-check does not treat render-matrix as an internal mode', (t) => {
  const root = makeRoot(t);
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces: []
`,
  );

  const result = runScript('cli.mjs', [
    'live-check',
    'render-matrix',
    '--root',
    root,
    '--output',
    'docs/agent-trigger-surfaces.md',
  ]);

  assert.equal(result.status, 0);
  assert.equal(existsSync(join(root, 'docs/agent-trigger-surfaces.md')), false);
  assert.match(result.stdout, /no rows selected/);
});

test('source snapshot defaults omitted root to the current working directory', (t) => {
  const root = makeRoot(t);
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

test('source snapshot reports malformed JSON without exiting', (t) => {
  const root = makeRoot(t);
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

test('source snapshot reports unaligned source versions', (t) => {
  const root = makeRoot(t);
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

test('live-check source version validation states that live verifier was not checked', (t) => {
  const root = makeRoot(t);
  const { pluginDir } = createVersionedPlugin(root, '0.2.3');
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: 'demo-ops',
    version: '0.2.2',
  });
  writeCodexCache(root, 'demo-ops', 'demo-ops', '0.2.3');
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

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.results[0].status, 'validation-error');
  assert.match(payload.results[0].message, /live verifier not checked/);
});

test('live surface matrix validates schema and applies path defaults', (t) => {
  const root = makeRoot(t);

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
  const validation = validateLiveSurfaceMatrix({ matrix });

  assert.deepEqual(validation.errors, []);
  assert.equal(matrix.surfaces[0].timeoutMs, 12345);
  assert.equal(matrix.surfaces[0].liveVerifier.codexHome.endsWith('.codex'), true);
  assert.equal(matrix.surfaces[1].liveVerifier.claudeHome.endsWith('.claude'), true);
  assert.equal(matrix.surfaces[1].liveVerifier.projectPath, root);
  assert.equal(matrix.extraFutureField, 'preserved');
});

test('live surface matrix uses fallback when env path variable is empty', (t) => {
  const root = makeRoot(t);
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

  const validation = validateLiveSurfaceMatrix({ matrix });

  assert.match(validation.errors.join('\n'), /pointer-only/);
  assert.match(validation.errors.join('\n'), /onFailure/);
});

test('live surface matrix rejects pointer-only budgets without expiry or reason', () => {
  const matrix = {
    schemaVersion: 1,
    plugin: 'demo-ops',
    surfaces: [
      {
        id: 'gemini-pointer',
        surface: 'gemini',
        scope: 'project',
        plugin: 'demo-ops',
        artifactType: 'pointer-doc',
        sourceTruth: 'source',
        liveVerifier: {
          kind: 'pointer-doc',
        },
        headless: 'safe',
        owner: 'demo',
        stalenessBudget: {
          mode: 'pointer-only',
        },
      },
    ],
  };

  const validation = validateLiveSurfaceMatrix({ matrix });

  assert.match(validation.errors.join('\n'), /pointer-only.*expiry/);
  assert.match(validation.errors.join('\n'), /pointer-only.*reason/);
});

test('live surface matrix rejects missing top-level required fields and live verifier kind', () => {
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

  const validation = validateLiveSurfaceMatrix({ matrix });
  const missingSurfacesValidation = validateLiveSurfaceMatrix({
    matrix: matrixWithoutSurfaces,
  });

  assert.match(validation.errors.join('\n'), /schemaVersion/);
  assert.match(validation.errors.join('\n'), /plugin/);
  assert.match(validation.errors.join('\n'), /liveVerifier\.kind/);
  assert.match(missingSurfacesValidation.errors.join('\n'), /surfaces/);
});

test('live surface matrix rejects unsupported schema versions and non-array rows', () => {
  const unsupportedSchemaValidation = validateLiveSurfaceMatrix({
    matrix: {
      schemaVersion: 2,
      plugin: 'demo-ops',
      surfaces: [],
    },
  });
  const nonArraySurfacesValidation = validateLiveSurfaceMatrix({
    matrix: {
      schemaVersion: 1,
      plugin: 'demo-ops',
      surfaces: {},
    },
  });
  const nonArrayAssertionsValidation = validateLiveSurfaceMatrix({
    matrix: {
      schemaVersion: 1,
      plugin: 'demo-ops',
      surfaces: [],
      assertions: {},
    },
  });

  assert.match(unsupportedSchemaValidation.errors.join('\n'), /schemaVersion/);
  assert.match(nonArraySurfacesValidation.errors.join('\n'), /surfaces must be an array/);
  assert.match(nonArrayAssertionsValidation.errors.join('\n'), /assertions must be an array/);
});

test('live-check exits with config error for unsupported schema versions and non-array rows', (t) => {
  const root = makeRoot(t);

  writeLiveMatrix(
    root,
    `
schemaVersion: 2
plugin: demo-ops
surfaces: []
`,
  );
  const unsupportedSchemaResult = runScript('live-trigger-surface-check.mjs', ['--root', root]);

  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces: {}
assertions: {}
`,
  );
  const nonArrayRowsResult = runScript('live-trigger-surface-check.mjs', ['--root', root]);

  assert.equal(unsupportedSchemaResult.status, 3);
  assert.match(unsupportedSchemaResult.stderr, /schemaVersion/);
  assert.equal(nonArrayRowsResult.status, 3);
  assert.match(nonArrayRowsResult.stderr, /surfaces must be an array/);
  assert.match(nonArrayRowsResult.stderr, /assertions must be an array/);
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

test('live surface matrix ignores TOML table-looking text inside multiline strings', () => {
  const names = extractTomlTableNames(`
banner = """
[plugins."not-a-plugin"]
enabled = true
"""

other = '''
[marketplaces.not-a-marketplace]
path = "./not-real"
'''

[plugins."real-plugin@real-marketplace"]
enabled = true

[marketplaces.real-marketplace]
path = "./real"
`);

  assert.deepEqual(names.plugins, ['real-plugin@real-marketplace']);
  assert.deepEqual(names.marketplaces, ['real-marketplace']);
});

test('path expansion is shared and preserves empty values', (t) => {
  const root = makeRoot(t);
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    process.env.CODEX_HOME = '';

    assert.equal(expandPath({ root, value: null }), null);
    assert.equal(expandPath({ root, value: '' }), '');
    assert.equal(expandPath({ root, value: '${CODEX_HOME:-~/.codex}' }).endsWith('.codex'), true);
    assert.equal(expandPath({ root, value: '${ROOT}/docs' }), join(root, 'docs'));
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test('live surface matrix rejects invalid staleness budget dates', () => {
  const validation = validateLiveSurfaceMatrix({
    matrix: {
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
            mode: 'allowed-until',
            'allowed-until': '2025-99-01',
            reason: 'typo',
          },
        },
      ],
    },
  });

  assert.match(validation.errors.join('\n'), /invalid stalenessBudget.*allowed-until/);
});

test('live-check only trusts pointer frontmatter at the start of the document', (t) => {
  const root = makeRoot(t);
  createVersionedPlugin(root, '0.1.0');
  write(
    root,
    'GEMINI.md',
    `
# Gemini pointer

---
pointer_only: true
---
`,
  );
  writeLiveMatrix(
    root,
    `
schemaVersion: 1
plugin: demo-ops
surfaces:
  - id: gemini-pointer
    surface: gemini
    scope: project
    plugin: demo-ops
    artifactType: pointer-doc
    sourceTruth: source
    liveVerifier:
      kind: pointer-doc
      path: \${ROOT}/GEMINI.md
    headless: safe
    owner: demo
    stalenessBudget:
      mode: none
`,
  );

  const result = runScript('live-trigger-surface-check.mjs', ['--root', root, '--json']);

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).results[0].status, 'drift');
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
