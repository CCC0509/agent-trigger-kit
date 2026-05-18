import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-test-'));
}

function runScript(scriptName, args) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function writeJson(root, path, value) {
  write(root, path, JSON.stringify(value, null, 2));
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function createMinimalPlugin(root, overrides = {}) {
  const pluginName = overrides.pluginName || 'demo-ops';
  const version = overrides.version || '0.1.0';
  const pluginDir = `plugins/${pluginName}`;
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: pluginName,
    interface: { displayName: 'Demo Ops Plugins' },
    plugins: [
      {
        name: pluginName,
        version,
        source: { source: 'local', path: `./${pluginDir}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
        description: 'Demo Ops trigger skills',
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: pluginName,
    owner: { name: 'Demo Ops' },
    metadata: { description: 'Demo Ops trigger skills' },
    plugins: [
      {
        name: pluginName,
        source: `./${pluginDir}`,
        description: 'Demo Ops trigger skills',
        version,
        author: { name: 'Demo Ops' },
        category: 'workflow',
        strict: false,
      },
    ],
  });
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version,
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: './skills/',
  });
  writeJson(root, `${pluginDir}/.claude-plugin/plugin.json`, {
    name: pluginName,
    version,
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: ['./skills/'],
    ...(overrides.commands === false ? {} : { commands: ['./commands/'] }),
  });
  return { pluginDir, pluginName };
}

function writeValidSkillAndCommand(root, pluginDir) {
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(root, `${pluginDir}/skills/docs-review/SKILL.md`, `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`);
  write(root, `${pluginDir}/commands/docs-review.md`, `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`);
}

test('init creates a canonical playbook placeholder when it is missing', () => {
  const root = makeRoot();
  const playbook = 'docs/agent-playbooks/demo-ops.md';
  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review,deploy-ops',
    '--playbook',
    playbook,
    '--cursor-globs',
    'docs/**,README.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, playbook)), true);
  assert.match(readFileSync(join(root, playbook), 'utf8'), /# Demo Ops Playbook/);
});

test('validator fails when a skill delegates to a missing playbook', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, `${pluginDir}/skills/docs-review/SKILL.md`, `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/missing.md\`
`);
  write(root, `${pluginDir}/commands/docs-review.md`, `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`);

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing canonical playbook/);
  assert.match(result.stderr, /docs\/agent-playbooks\/missing\.md/);
});

test('validator fails when a command delegates to a missing skill', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(root, `${pluginDir}/skills/docs-review/SKILL.md`, `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`);
  write(root, `${pluginDir}/commands/deploy-ops.md`, `---
description: Use for deploy ops work.
---

Apply the \`demo-ops:deploy-ops\` skill before acting.
`);

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /delegates to missing skill demo-ops:deploy-ops/);
});

test('validator fails when Claude commands exist but are not declared', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root, { commands: false });
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(root, `${pluginDir}/skills/docs-review/SKILL.md`, `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`);
  write(root, `${pluginDir}/commands/docs-review.md`, `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`);

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /commands exist but are not declared/);
});

test('validator fails when Codex marketplace and plugin manifest versions differ', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: 'demo-ops',
    version: '0.1.1',
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: './skills/',
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version must match Codex marketplace 0\.1\.0/);
});

test('validator fails when Claude marketplace and plugin manifest versions differ', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, `${pluginDir}/.claude-plugin/plugin.json`, {
    name: 'demo-ops',
    version: '0.1.1',
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: ['./skills/'],
    commands: ['./commands/'],
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version must match Claude marketplace 0\.1\.0/);
});

test('Codex plugin cache sync snapshots the marketplace plugin version and backs up stale cache', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  write(root, `${pluginDir}/extra.txt`, 'fresh snapshot');
  write(root, `plugins/${pluginName}/nested/data.txt`, 'nested file');

  const staleCache = join(codexHome, 'plugins/cache', pluginName, pluginName, '0.1.2');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/old.txt', 'stale cache');

  const result = runScript('sync-codex-plugin-cache.mjs', [
    '--root',
    root,
    '--codex-home',
    codexHome,
    pluginName,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(join(staleCache, 'extra.txt'), 'utf8').trim(), 'fresh snapshot');
  assert.equal(readFileSync(join(staleCache, 'nested/data.txt'), 'utf8').trim(), 'nested file');
  assert.equal(existsSync(join(staleCache, 'old.txt')), false);
  const backupParent = join(codexHome, 'plugins/cache', pluginName, pluginName);
  const backups = readdirSync(backupParent).filter((name) => name.startsWith('0.1.2.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(existsSync(join(backupParent, backups[0], 'old.txt')), true);
  assert.match(result.stdout, /sync-codex-plugin-cache: copied demo-ops 0\.1\.2/);
  assert.match(result.stdout, /diff -qr passed/);
});
