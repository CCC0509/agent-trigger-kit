import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
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
  const pluginDir = `plugins/${pluginName}`;
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: pluginName,
    interface: { displayName: 'Demo Ops Plugins' },
    plugins: [
      {
        name: pluginName,
        version: '0.1.0',
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
        version: '0.1.0',
        author: { name: 'Demo Ops' },
        category: 'workflow',
        strict: false,
      },
    ],
  });
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version: '0.1.0',
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: './skills/',
  });
  writeJson(root, `${pluginDir}/.claude-plugin/plugin.json`, {
    name: pluginName,
    version: '0.1.0',
    description: 'Demo Ops trigger skills',
    author: { name: 'Demo Ops' },
    skills: ['./skills/'],
    ...(overrides.commands === false ? {} : { commands: ['./commands/'] }),
  });
  return { pluginDir, pluginName };
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
