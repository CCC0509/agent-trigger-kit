import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
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

function runScript(scriptName, args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'cli.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
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

function writeExecutable(root, path, text) {
  write(root, path, text);
  chmodSync(join(root, path), 0o755);
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

function createPackage(root, version = '0.1.0') {
  writeJson(root, 'package.json', {
    name: 'demo-trigger-kit',
    version,
    private: true,
    type: 'module',
  });
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

test('package exposes the agent-trigger-kit bin entry', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.bin?.['agent-trigger-kit'], 'scripts/cli.mjs');
});

test('cli routes init and validate commands to the existing scripts', () => {
  const root = makeRoot();

  const init = runCli([
    'init',
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), true);

  const validate = runCli(['validate', '--root', root]);
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
  assert.match(validate.stdout, /trigger layer validation passed/);
});

test('cli routes version-check to the existing script', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runCli([
    'version-check',
    '--root',
    root,
    '--codex-home',
    codexHome,
    pluginName,
  ], {
    env: { ...process.env, PATH: '' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /expected source version: 0\.1\.2/);
  assert.match(result.stdout, /claude: CLI unavailable/);
});

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

test('init upserts plugin entries into existing marketplaces without force', () => {
  const root = makeRoot();
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: 'project-marketplace',
    interface: { displayName: 'Project Plugins' },
    plugins: [
      {
        name: 'existing-ops',
        version: '0.2.0',
        source: { source: 'local', path: './plugins/existing-ops' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
        description: 'Existing trigger skills',
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: 'project-marketplace',
    owner: { name: 'Project Maintainers' },
    metadata: { description: 'Project trigger skills' },
    plugins: [
      {
        name: 'existing-ops',
        source: './plugins/existing-ops',
        description: 'Existing trigger skills',
        version: '0.2.0',
        author: { name: 'Project Maintainers' },
        category: 'workflow',
        strict: false,
      },
    ],
  });

  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const codex = JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
  const claude = JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.deepEqual(codex.plugins.map((plugin) => plugin.name), ['existing-ops', 'demo-ops']);
  assert.deepEqual(claude.plugins.map((plugin) => plugin.name), ['existing-ops', 'demo-ops']);
  assert.equal(codex.plugins[0].version, '0.2.0');
  assert.equal(claude.plugins[0].version, '0.2.0');
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

test('version check reports matching source versions and Codex cache versions', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');

  const result = runScript('check-plugin-version.mjs', [
    '--root',
    root,
    '--codex-home',
    codexHome,
    '--strict-installed',
    pluginName,
  ], {
    env: { ...process.env, PATH: '' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /expected source version: 0\.1\.2/);
  assert.match(result.stdout, /package\.json: 0\.1\.2/);
  assert.match(result.stdout, /codex marketplace: 0\.1\.2/);
  assert.match(result.stdout, /claude plugin: 0\.1\.2/);
  assert.match(result.stdout, /codex cache versions: 0\.1\.1, 0\.1\.2/);
  assert.match(result.stdout, /codex cache expected version: present/);
  assert.match(result.stdout, /claude: CLI unavailable/);
});

test('version check emits structured JSON when requested', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache');

  const result = runScript('check-plugin-version.mjs', [
    '--root',
    root,
    '--codex-home',
    codexHome,
    '--json',
    pluginName,
  ], {
    env: { ...process.env, PATH: '' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.pluginName, pluginName);
  assert.equal(payload.expectedVersion, '0.1.2');
  assert.equal(payload.sourceVersions.length, 5);
  assert.deepEqual(payload.codexCache.versions, ['0.1.1']);
  assert.equal(payload.codexCache.hasExpected, false);
  assert.equal(payload.codexCache.status, 'missing');
  assert.equal(payload.claude.status, 'cli-unavailable');
  assert.equal(payload.versionMismatch, true);
});

test('version check fails when source versions differ', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.1' });

  const result = runScript('check-plugin-version.mjs', [
    '--root',
    root,
    pluginName,
  ], {
    env: { ...process.env, PATH: '' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source versions differ/);
  assert.match(result.stderr, /package\.json=0\.1\.2/);
  assert.match(result.stderr, /codex marketplace=0\.1\.1/);
});

test('bump plugin version updates package and all plugin manifests by default', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginName } = createMinimalPlugin(root);

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--version',
    '0.1.2',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '0.1.2');
  assert.equal(JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8')).plugins[0].version, '0.1.2');
  assert.equal(JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0].version, '0.1.2');
  assert.equal(JSON.parse(readFileSync(join(root, `plugins/${pluginName}/.codex-plugin/plugin.json`), 'utf8')).version, '0.1.2');
  assert.equal(JSON.parse(readFileSync(join(root, `plugins/${pluginName}/.claude-plugin/plugin.json`), 'utf8')).version, '0.1.2');
});

test('bump plugin version validates surface before writing files', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginName } = createMinimalPlugin(root);

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--version',
    '0.1.2',
    '--surface',
    'bad',
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--surface must be all, codex, or claude/);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '0.1.0');
  assert.equal(JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8')).plugins[0].version, '0.1.0');
});

test('agent-trigger-kit exposes version-check skill and Claude command', () => {
  const skillPath = join(repoRoot, 'plugins/agent-trigger-kit/skills/version-check/SKILL.md');
  const commandPath = join(repoRoot, 'plugins/agent-trigger-kit/commands/agent-trigger-kit-version.md');

  assert.equal(existsSync(skillPath), true);
  assert.equal(existsSync(commandPath), true);

  const skillText = readFileSync(skillPath, 'utf8');
  const commandText = readFileSync(commandPath, 'utf8');

  assert.match(skillText, /^name: version-check/m);
  assert.match(skillText, /kit version/i);
  assert.match(skillText, /ops:local-agent-sync/);
  assert.match(skillText, /codex plugin marketplace upgrade agent-trigger-kit/);
  assert.match(skillText, /claude plugin update agent-trigger-kit@agent-trigger-kit --scope user/);
  assert.match(commandText, /agent-trigger-kit:version-check/);
});

test('local agent trigger refresh syncs stale Codex cache and updates Claude when available', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  write(root, `${pluginDir}/fresh.txt`, 'fresh local plugin snapshot');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/old.txt', 'stale same-version cache');
  writeExecutable(fakeBin, 'claude', `#!/bin/sh
printf 'claude %s\\n' "$*" >> "${commandLog}"
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2"}]\\n'
fi
`);
  writeExecutable(fakeBin, 'cursor', `#!/bin/sh
printf 'cursor should not be called\\n' >> "${commandLog}"
exit 99
`);

  const result = runScript('update-local-agent-triggers.mjs', [
    '--root',
    root,
    '--codex-home',
    codexHome,
    '--no-codex-debug',
    pluginName,
  ], {
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex cache is missing or stale; syncing local cache/);
  assert.match(result.stdout, /Cursor: repo-local rules are covered by trigger-layer validation/);
  assert.equal(readFileSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/fresh.txt'), 'utf8').trim(), 'fresh local plugin snapshot');
  assert.equal(existsSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/old.txt')), false);
  const backups = readdirSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops')).filter((name) => name.startsWith('0.1.2.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(existsSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops', backups[0], 'old.txt')), true);
  const log = readFileSync(commandLog, 'utf8');
  assert.match(log, new RegExp(`claude plugin validate ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(log, new RegExp(`claude plugin validate ${join(root, pluginDir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(log, /claude plugin marketplace update demo-ops/);
  assert.match(log, /claude plugin update demo-ops@demo-ops --scope user/);
  assert.match(log, /claude plugin list --json/);
  assert.doesNotMatch(log, /cursor/);
});

test('local agent trigger refresh syncs when structured version check reports missing expected cache', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  write(root, `${pluginDir}/fresh.txt`, 'fresh local plugin snapshot');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache only');
  writeExecutable(fakeBin, 'claude', `#!/bin/sh
printf 'claude %s\\n' "$*" >> "${commandLog}"
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2"}]\\n'
fi
`);

  const result = runScript('update-local-agent-triggers.mjs', [
    '--root',
    root,
    '--codex-home',
    codexHome,
    '--no-codex-debug',
    pluginName,
  ], {
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex cache is missing or stale; syncing local cache/);
  assert.equal(readFileSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/fresh.txt'), 'utf8').trim(), 'fresh local plugin snapshot');
});

test('local agent trigger refresh uses structured version check output', () => {
  const script = readFileSync(join(repoRoot, 'scripts/update-local-agent-triggers.mjs'), 'utf8');

  assert.match(script, /'--json'/);
  assert.doesNotMatch(script, /codex cache expected version/);
});

test('local agent trigger refresh skips Claude update when CLI is unavailable', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  cpSync(join(root, pluginDir), join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'), { recursive: true });

  const result = runScript('update-local-agent-triggers.mjs', [
    '--root',
    root,
    '--codex-home',
    codexHome,
    '--no-codex-debug',
    pluginName,
  ], {
    env: { ...process.env, PATH: '' },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /claude: CLI unavailable; skipped Claude update commands/);
});
