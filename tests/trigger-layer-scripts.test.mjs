import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function createMinimalPlugins(root, pluginNames, version = '0.1.0') {
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: 'demo-trigger-kit',
    interface: { displayName: 'Demo Ops Plugins' },
    plugins: pluginNames.map((pluginName) => ({
      name: pluginName,
      version,
      source: { source: 'local', path: `./plugins/${pluginName}` },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
      category: 'Productivity',
      description: `${pluginName} trigger skills`,
    })),
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: 'demo-trigger-kit',
    owner: { name: 'Demo Ops' },
    metadata: { description: 'Demo Ops trigger skills' },
    plugins: pluginNames.map((pluginName) => ({
      name: pluginName,
      source: `./plugins/${pluginName}`,
      description: `${pluginName} trigger skills`,
      version,
      author: { name: 'Demo Ops' },
      category: 'workflow',
      strict: false,
    })),
  });
  for (const pluginName of pluginNames) {
    writeJson(root, `plugins/${pluginName}/.codex-plugin/plugin.json`, {
      name: pluginName,
      version,
      description: `${pluginName} trigger skills`,
      author: { name: 'Demo Ops' },
      skills: './skills/',
    });
    writeJson(root, `plugins/${pluginName}/.claude-plugin/plugin.json`, {
      name: pluginName,
      version,
      description: `${pluginName} trigger skills`,
      author: { name: 'Demo Ops' },
      skills: ['./skills/'],
      commands: ['./commands/'],
    });
  }
  return pluginNames.map((pluginName) => ({
    pluginName,
    pluginDir: `plugins/${pluginName}`,
  }));
}

function createPackage(root, version = '0.1.0', name = 'demo-trigger-kit') {
  writeJson(root, 'package.json', {
    name,
    version,
    private: true,
    type: 'module',
  });
}

function writeValidSkillAndCommand(root, pluginDir) {
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
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

  const result = runCli(['version-check', '--root', root, '--codex-home', codexHome, pluginName], {
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

test('init records generated trigger-layer files without claiming user-owned files', () => {
  const root = makeRoot();
  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review,deploy-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--cursor-globs',
    'docs/**,README.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(
    readFileSync(join(root, '.agent-trigger-kit/generated.json'), 'utf8'),
  );
  const trackedPaths = manifest.files.map((file) => file.path);
  const trackedKinds = Object.fromEntries(manifest.files.map((file) => [file.path, file.kind]));
  const skillPath = 'plugins/demo-ops/skills/docs-review/SKILL.md';

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.pluginName, 'demo-ops');
  assert.equal(manifest.pluginVersion, '0.1.0');
  assert.equal(manifest.playbook, 'docs/agent-playbooks/demo-ops.md');
  assert.equal(manifest.maintenanceContract, '.agent-trigger-kit/MAINTENANCE.md');
  assert.deepEqual(manifest.tasks, ['docs-review', 'deploy-ops']);
  assert.equal(trackedKinds['plugins/demo-ops/.codex-plugin/plugin.json'], 'plugin-manifest');
  assert.equal(trackedKinds['plugins/demo-ops/.claude-plugin/plugin.json'], 'plugin-manifest');
  assert.equal(trackedKinds[skillPath], 'skill');
  assert.equal(trackedKinds['plugins/demo-ops/commands/docs-review.md'], 'command');
  assert.equal(trackedKinds['.cursor/rules/docs-review.mdc'], 'cursor-rule');
  assert.equal(trackedPaths.includes('docs/agent-playbooks/demo-ops.md'), false);
  assert.equal(trackedPaths.includes('.agents/plugins/marketplace.json'), false);
  assert.equal(trackedPaths.includes('.claude-plugin/marketplace.json'), false);
  assert.equal(trackedPaths.includes('.agent-trigger-kit/generated.json'), false);
  assert.equal(
    manifest.files.find((file) => file.path === skillPath).sha256,
    sha256(join(root, skillPath)),
  );
  assert.equal(existsSync(join(root, '.agent-trigger-kit/MAINTENANCE.md')), true);
  assert.match(
    readFileSync(join(root, skillPath), 'utf8'),
    /Maintenance contract: `\.\.\/\.\.\/\.\.\/\.\.\/\.agent-trigger-kit\/MAINTENANCE\.md`/,
  );
  assert.match(
    readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8'),
    /Maintenance contract: `\.\.\/\.\.\/\.agent-trigger-kit\/MAINTENANCE\.md`/,
  );
});

test('init computes playbook refs relative to nested generated skill paths', () => {
  const root = makeRoot();
  const playbook = 'docs/agent-playbooks/team-demo-ops.md';
  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'team/demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    playbook,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const skillText = readFileSync(
    join(root, 'plugins/team/demo-ops/skills/docs-review/SKILL.md'),
    'utf8',
  );
  assert.match(
    skillText,
    /`\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/docs\/agent-playbooks\/team-demo-ops\.md`/,
  );

  const validate = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
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
  assert.deepEqual(
    codex.plugins.map((plugin) => plugin.name),
    ['existing-ops', 'demo-ops'],
  );
  assert.deepEqual(
    claude.plugins.map((plugin) => plugin.name),
    ['existing-ops', 'demo-ops'],
  );
  assert.equal(codex.plugins[0].version, '0.2.0');
  assert.equal(claude.plugins[0].version, '0.2.0');
});

test('init force preserves existing plugin version instead of downgrading', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.2.0' });
  writeValidSkillAndCommand(root, pluginDir);

  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--force',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readJson(root, '.agents/plugins/marketplace.json').plugins[0].version, '0.2.0');
  assert.equal(readJson(root, '.claude-plugin/marketplace.json').plugins[0].version, '0.2.0');
  assert.equal(readJson(root, `${pluginDir}/.codex-plugin/plugin.json`).version, '0.2.0');
  assert.equal(readJson(root, `${pluginDir}/.claude-plugin/plugin.json`).version, '0.2.0');
  assert.equal(readJson(root, '.agent-trigger-kit/generated.json').pluginVersion, '0.2.0');
});

test('init ignores initial version when an existing plugin version is present', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.2.0' });
  writeValidSkillAndCommand(root, pluginDir);

  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--initial-version',
    '0.3.0',
    '--force',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readJson(root, '.agents/plugins/marketplace.json').plugins[0].version, '0.2.0');
  assert.equal(readJson(root, '.claude-plugin/marketplace.json').plugins[0].version, '0.2.0');
  assert.equal(readJson(root, `${pluginDir}/.codex-plugin/plugin.json`).version, '0.2.0');
  assert.equal(readJson(root, `${pluginDir}/.claude-plugin/plugin.json`).version, '0.2.0');
  assert.equal(readJson(root, '.agent-trigger-kit/generated.json').pluginVersion, '0.2.0');
});

test('init uses an existing partial manifest version as the recovery baseline', () => {
  const root = makeRoot();
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: 'project-marketplace',
    interface: { displayName: 'Project Plugins' },
    plugins: [
      {
        name: 'demo-ops',
        version: '0.2.0',
        source: { source: 'local', path: './plugins/demo-ops' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
        description: 'Demo Ops trigger skills',
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
  assert.equal(readJson(root, '.agents/plugins/marketplace.json').plugins[0].version, '0.2.0');
  assert.equal(readJson(root, '.claude-plugin/marketplace.json').plugins[0].version, '0.2.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json').version, '0.2.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.claude-plugin/plugin.json').version, '0.2.0');
});

test('init fails when existing manifest versions disagree', () => {
  const root = makeRoot();
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: 'project-marketplace',
    interface: { displayName: 'Project Plugins' },
    plugins: [
      {
        name: 'demo-ops',
        version: '0.2.0',
        source: { source: 'local', path: './plugins/demo-ops' },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Productivity',
        description: 'Demo Ops trigger skills',
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: 'project-marketplace',
    owner: { name: 'Project Maintainers' },
    metadata: { description: 'Project trigger skills' },
    plugins: [
      {
        name: 'demo-ops',
        source: './plugins/demo-ops',
        description: 'Demo Ops trigger skills',
        version: '0.3.0',
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

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /existing manifest versions differ/);
});

test('init applies initial version only when no existing plugin version is present', () => {
  const root = makeRoot();
  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--initial-version',
    '0.3.0',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readJson(root, '.agents/plugins/marketplace.json').plugins[0].version, '0.3.0');
  assert.equal(readJson(root, '.claude-plugin/marketplace.json').plugins[0].version, '0.3.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json').version, '0.3.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.claude-plugin/plugin.json').version, '0.3.0');
  assert.equal(readJson(root, '.agent-trigger-kit/generated.json').pluginVersion, '0.3.0');
});

test('init uses generated manifest fallback only for the matching plugin name', () => {
  const root = makeRoot();
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    kitVersion: '0.1.4',
    templateVersion: 1,
    pluginName: 'other-ops',
    pluginVersion: '0.9.0',
    playbook: 'docs/agent-playbooks/other-ops.md',
    maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
    tasks: ['docs-review'],
    files: [],
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
  assert.equal(readJson(root, '.agents/plugins/marketplace.json').plugins[0].version, '0.1.0');
  assert.equal(readJson(root, '.claude-plugin/marketplace.json').plugins[0].version, '0.1.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json').version, '0.1.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.claude-plugin/plugin.json').version, '0.1.0');
  assert.equal(readJson(root, '.agent-trigger-kit/generated.json').pluginName, 'demo-ops');
  assert.equal(readJson(root, '.agent-trigger-kit/generated.json').pluginVersion, '0.1.0');
});

test('init script consumes project trigger layer templates for generated wrappers', () => {
  const script = readFileSync(join(repoRoot, 'scripts/init-project-trigger-layer.mjs'), 'utf8');

  assert.match(script, /templates\/project-trigger-layer/);
  assert.match(script, /skill\/SKILL\.md\.template/);
  assert.match(script, /command\.md\.template/);
  assert.match(script, /cursor-rule\.mdc\.template/);
  assert.equal(
    existsSync(join(repoRoot, 'templates/project-trigger-layer/AGENTS.snippet.md')),
    false,
  );
  assert.equal(
    existsSync(join(repoRoot, 'templates/project-trigger-layer/CLAUDE.snippet.md')),
    false,
  );
  assert.equal(
    existsSync(join(repoRoot, 'templates/project-trigger-layer/GEMINI.snippet.md')),
    false,
  );
});

test('validator fails when a skill delegates to a missing playbook', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/missing.md\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing canonical playbook/);
  assert.match(result.stderr, /docs\/agent-playbooks\/missing\.md/);
});

test('validator fails when a command delegates to a missing skill', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/deploy-ops.md`,
    `---
description: Use for deploy ops work.
---

Apply the \`demo-ops:deploy-ops\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /delegates to missing skill demo-ops:deploy-ops/);
});

test('validator accepts command delegation to a visible skill name that differs from its directory', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(
    root,
    `${pluginDir}/skills/docs/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator rejects command delegation to a skill directory when the visible name differs', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(
    root,
    `${pluginDir}/skills/docs/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /delegates to missing skill demo-ops:docs/);
});

test('validator fails when Claude commands exist but are not declared', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root, { commands: false });
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /commands exist but are not declared/);
});

test('validator fails when same-plugin skill frontmatter names collide across different directories', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  for (const skillDir of ['docs-review', 'docs-review-alias']) {
    write(
      root,
      `${pluginDir}/skills/${skillDir}/SKILL.md`,
      `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
    );
  }
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skill name collision/);
  assert.match(result.stderr, /docs-review/);
  assert.match(result.stderr, /plugins\/demo-ops\/skills\/docs-review\/SKILL\.md/);
  assert.match(result.stderr, /plugins\/demo-ops\/skills\/docs-review-alias\/SKILL\.md/);
});

test('validator fails when plugin skill directory names collide', () => {
  const root = makeRoot();
  const plugins = createMinimalPlugins(root, ['demo-ops', 'data-ops']);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  for (const { pluginDir, pluginName } of plugins) {
    write(
      root,
      `${pluginDir}/skills/docs-review/SKILL.md`,
      `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
    );
    write(
      root,
      `${pluginDir}/commands/${pluginName}.md`,
      `---
description: Use for ${pluginName} work.
---

Apply the \`${pluginName}:docs-review\` skill before acting.
`,
    );
  }

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skill name collision/);
  assert.match(result.stderr, /docs-review/);
  assert.match(result.stderr, /demo-ops/);
  assert.match(result.stderr, /data-ops/);
  assert.match(result.stderr, /plugins\/demo-ops\/skills\/docs-review\/SKILL\.md/);
  assert.match(result.stderr, /plugins\/data-ops\/skills\/docs-review\/SKILL\.md/);
});

test('validator fails when plugin skill frontmatter names collide across different directories', () => {
  const root = makeRoot();
  const plugins = createMinimalPlugins(root, ['demo-ops', 'data-ops']);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  for (const { pluginDir, pluginName } of plugins) {
    const skillDir = pluginName === 'demo-ops' ? 'docs-review' : 'data-review';
    write(
      root,
      `${pluginDir}/skills/${skillDir}/SKILL.md`,
      `---
name: shared-review
description: Use for shared review work.
---

# Shared Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
    );
    write(
      root,
      `${pluginDir}/commands/${skillDir}.md`,
      `---
description: Use for ${pluginName} work.
---

Apply the \`${pluginName}:${skillDir}\` skill before acting.
`,
    );
  }

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skill name collision/);
  assert.match(result.stderr, /shared-review/);
  assert.match(result.stderr, /plugins\/demo-ops\/skills\/docs-review\/SKILL\.md/);
  assert.match(result.stderr, /plugins\/data-ops\/skills\/data-review\/SKILL\.md/);
});

test('validator fails when plugin command filename stems collide', () => {
  const root = makeRoot();
  const plugins = createMinimalPlugins(root, ['demo-ops', 'data-ops']);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  for (const { pluginDir, pluginName } of plugins) {
    const skillName = pluginName === 'demo-ops' ? 'docs-review' : 'data-review';
    write(
      root,
      `${pluginDir}/skills/${skillName}/SKILL.md`,
      `---
name: ${skillName}
description: Use for ${skillName} work.
---

# ${skillName}

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
    );
    write(
      root,
      `${pluginDir}/commands/run-check.md`,
      `---
description: Use for ${pluginName} work.
---

Apply the \`${pluginName}:${skillName}\` skill before acting.
`,
    );
  }

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /command name collision/);
  assert.match(result.stderr, /run-check/);
  assert.match(result.stderr, /demo-ops/);
  assert.match(result.stderr, /data-ops/);
  assert.match(result.stderr, /plugins\/demo-ops\/commands\/run-check\.md/);
  assert.match(result.stderr, /plugins\/data-ops\/commands\/run-check\.md/);
});

test('validator passes when a markdown playbook anchor exists', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook\n\n## Deploy Ops');
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md#deploy-ops\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator fails when a markdown playbook anchor is missing', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook\n\n## Deploy Ops');
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md#missing-anchor\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing canonical playbook anchor/);
  assert.match(result.stderr, /missing-anchor/);
  assert.match(result.stderr, /docs\/agent-playbooks\/demo-ops\.md/);
});

test('validator fails when a markdown playbook has duplicate heading slugs', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(
    root,
    'docs/agent-playbooks/demo-ops.md',
    '# Demo Ops Playbook\n\n## Deploy Ops!\n\n## Deploy Ops',
  );
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md#deploy-ops\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate heading slug/);
  assert.match(result.stderr, /deploy-ops/);
  assert.match(result.stderr, /docs\/agent-playbooks\/demo-ops\.md/);
});

test('validator fails when a plain markdown playbook ref has duplicate heading slugs', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(
    root,
    'docs/agent-playbooks/demo-ops.md',
    '# Demo Ops Playbook\n\n## Deploy Ops!\n\n## Deploy Ops',
  );
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate heading slug/);
  assert.match(result.stderr, /deploy-ops/);
  assert.match(result.stderr, /docs\/agent-playbooks\/demo-ops\.md/);
});

test('validator reports duplicate heading slugs once when multiple skills reference the same playbook', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  write(
    root,
    'docs/agent-playbooks/demo-ops.md',
    '# Demo Ops Playbook\n\n## Deploy Ops!\n\n## Deploy Ops',
  );
  for (const skillName of ['docs-review', 'deploy-ops']) {
    write(
      root,
      `${pluginDir}/skills/${skillName}/SKILL.md`,
      `---
name: ${skillName}
description: Use for ${skillName} work.
---

# ${skillName}

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
    );
  }
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.equal(
    result.stderr.match(/docs\/agent-playbooks\/demo-ops\.md: duplicate heading slug deploy-ops/g)
      ?.length,
    1,
  );
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

test('validator fails when a managed skill lacks a maintenance contract pointer', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  const skillPath = `${pluginDir}/skills/docs-review/SKILL.md`;
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    files: [{ kind: 'skill', path: skillPath }],
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stderr, /maintenance contract pointer/i);
});

test('validator accepts a managed skill with a loose maintenance contract pointer path', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  const skillPath = `${pluginDir}/skills/docs-review/SKILL.md`;
  writeValidSkillAndCommand(root, pluginDir);
  write(
    root,
    skillPath,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

Maintenance contract: \`some/other/path.md\`

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
    files: [{ kind: 'skill', path: skillPath }],
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator accepts a hand-rolled skill without a maintenance contract pointer', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    files: [],
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator accepts a generated command without a maintenance contract pointer', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    files: [{ kind: 'command', path: `${pluginDir}/commands/docs-review.md` }],
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
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
  createPackage(root, '5.8.0');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');

  const result = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--codex-home', codexHome, '--strict-installed', pluginName],
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /expected source version: 0\.1\.2/);
  assert.doesNotMatch(result.stdout, /package\.json:/);
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

  const result = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--codex-home', codexHome, '--json', pluginName],
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.pluginName, pluginName);
  assert.equal(payload.expectedVersion, '0.1.2');
  assert.equal(payload.sourceVersions.length, 4);
  assert.equal(
    payload.sourceVersions.some((entry) => entry.label === 'package.json'),
    false,
  );
  assert.deepEqual(payload.codexCache.versions, ['0.1.1']);
  assert.equal(payload.codexCache.hasExpected, false);
  assert.equal(payload.codexCache.status, 'missing');
  assert.equal(payload.claude.status, 'cli-unavailable');
  assert.equal(payload.versionMismatch, true);
});

test('version check --surface codex skips Claude installed-state checks', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude should not be called\\n' >> "${commandLog}"
exit 23
`,
  );

  const result = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--codex-home', codexHome, '--surface', 'codex', '--json', pluginName],
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.codexCache.status, 'present');
  assert.equal(payload.claude.status, 'skipped');
  assert.equal(existsSync(commandLog), false);
});

test('version check --surface claude skips Codex cache installed-state checks', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache only');
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude %s\\n' "$*" >> "${commandLog}"
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2"}]\\n'
fi
`,
  );

  const result = runScript(
    'check-plugin-version.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--surface',
      'claude',
      '--strict-installed',
      '--json',
      pluginName,
    ],
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.codexCache.status, 'skipped');
  assert.equal(payload.claude.status, 'present');
  assert.equal(payload.versionMismatch, false);
  assert.match(readFileSync(commandLog, 'utf8'), /claude plugin list --json/);
});

test('version check --surface source skips installed-state checks', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache only');
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude should not be called\\n' >> "${commandLog}"
exit 23
`,
  );

  const result = runScript(
    'check-plugin-version.mjs',
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--surface',
      'source',
      '--strict-installed',
      '--json',
      pluginName,
    ],
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.codexCache.status, 'skipped');
  assert.equal(payload.claude.status, 'skipped');
  assert.equal(payload.versionMismatch, false);
  assert.equal(existsSync(commandLog), false);
});

test('version check --surface source keeps human output focused on source state', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache only');
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude should not be called\\n' >> "${commandLog}"
exit 23
`,
  );

  const result = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--codex-home', codexHome, '--surface', 'source', pluginName],
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /expected source version: 0\.1\.2/);
  assert.match(result.stdout, /installed state: skipped \("--surface source"\)/);
  assert.doesNotMatch(result.stdout, /codex cache: skipped/);
  assert.doesNotMatch(result.stdout, /claude: skipped/);
  assert.equal(existsSync(commandLog), false);
});

test('version check fails when source versions differ', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.1' });

  const result = runScript('check-plugin-version.mjs', ['--root', root, pluginName], {
    env: { ...process.env, PATH: '' },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source versions differ/);
  assert.match(result.stderr, /package\.json=0\.1\.2/);
  assert.match(result.stderr, /codex marketplace=0\.1\.1/);
});

test('version check includes scoped package versions by default', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', '@acme/demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--surface', 'source', '--json', pluginName],
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(
    payload.sourceVersions.some((entry) => entry.label === 'package.json'),
    true,
  );
});

test('version check can force or skip package version alignment', () => {
  const root = makeRoot();
  createPackage(root, '5.8.0', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const skipped = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--surface', 'source', '--json', '--no-include-package', pluginName],
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(skipped.status, 0, skipped.stderr || skipped.stdout);
  assert.equal(
    JSON.parse(skipped.stdout).sourceVersions.some((entry) => entry.label === 'package.json'),
    false,
  );

  const forced = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--surface', 'source', '--include-package', pluginName],
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.notEqual(forced.status, 0);
  assert.match(forced.stderr, /package\.json=5\.8\.0/);
});

test('bump plugin version leaves unrelated package versions unchanged by default', () => {
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
  assert.equal(readJson(root, 'package.json').version, '0.1.0');
  assert.equal(
    JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8')).plugins[0]
      .version,
    '0.1.2',
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0]
      .version,
    '0.1.2',
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, `plugins/${pluginName}/.codex-plugin/plugin.json`), 'utf8'))
      .version,
    '0.1.2',
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, `plugins/${pluginName}/.claude-plugin/plugin.json`), 'utf8'))
      .version,
    '0.1.2',
  );
});

test('bump plugin version updates matching package versions unless explicitly skipped', () => {
  const root = makeRoot();
  createPackage(root, '0.1.0', '@acme/demo-ops');
  const { pluginName } = createMinimalPlugin(root);

  const updatePackage = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--version',
    '0.1.2',
  ]);

  assert.equal(updatePackage.status, 0, updatePackage.stderr || updatePackage.stdout);
  assert.equal(readJson(root, 'package.json').version, '0.1.2');

  const skipPackage = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--version',
    '0.1.3',
    '--no-include-package',
  ]);

  assert.equal(skipPackage.status, 0, skipPackage.stderr || skipPackage.stdout);
  assert.equal(readJson(root, 'package.json').version, '0.1.2');
  assert.equal(readJson(root, '.agents/plugins/marketplace.json').plugins[0].version, '0.1.3');
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
  assert.equal(
    JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8')).plugins[0]
      .version,
    '0.1.0',
  );
});

test('bump plugin version warns when updating a partial surface', () => {
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
    'claude',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /--surface claude updates only Claude plugin manifests/);
  assert.match(result.stderr, /does not keep release versions aligned/);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '0.1.0');
  assert.equal(
    JSON.parse(readFileSync(join(root, '.agents/plugins/marketplace.json'), 'utf8')).plugins[0]
      .version,
    '0.1.0',
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0]
      .version,
    '0.1.2',
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, `plugins/${pluginName}/.codex-plugin/plugin.json`), 'utf8'))
      .version,
    '0.1.0',
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, `plugins/${pluginName}/.claude-plugin/plugin.json`), 'utf8'))
      .version,
    '0.1.2',
  );
});

test('agent-trigger-kit exposes version-check skill and Claude command', () => {
  const skillPath = join(repoRoot, 'plugins/agent-trigger-kit/skills/version-check/SKILL.md');
  const commandPath = join(
    repoRoot,
    'plugins/agent-trigger-kit/commands/agent-trigger-kit-version.md',
  );

  assert.equal(existsSync(skillPath), true);
  assert.equal(existsSync(commandPath), true);

  const skillText = readFileSync(skillPath, 'utf8');
  const commandText = readFileSync(commandPath, 'utf8');

  assert.match(skillText, /^name: version-check/m);
  assert.match(skillText, /kit version/i);
  assert.match(skillText, /Scope First/);
  assert.match(skillText, /ops:plugin-version-check/);
  assert.doesNotMatch(skillText, /ops:local-agent-sync/);
  assert.match(skillText, /codex plugin marketplace upgrade agent-trigger-kit/);
  assert.match(skillText, /claude plugin update agent-trigger-kit@agent-trigger-kit --scope user/);
  assert.match(commandText, /agent-trigger-kit:version-check/);
  assert.match(commandText, /--surface claude/);
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
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude %s\\n' "$*" >> "${commandLog}"
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2"}]\\n'
fi
`,
  );
  writeExecutable(
    fakeBin,
    'cursor',
    `#!/bin/sh
printf 'cursor should not be called\\n' >> "${commandLog}"
exit 99
`,
  );

  const result = runScript(
    'update-local-agent-triggers.mjs',
    ['--root', root, '--codex-home', codexHome, '--no-codex-debug', pluginName],
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex cache is missing or stale; syncing local cache/);
  assert.match(result.stdout, /Cursor: repo-local rules are covered by trigger-layer validation/);
  assert.equal(
    readFileSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/fresh.txt'), 'utf8').trim(),
    'fresh local plugin snapshot',
  );
  assert.equal(existsSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/old.txt')), false);
  const backups = readdirSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops')).filter((name) =>
    name.startsWith('0.1.2.backup-'),
  );
  assert.equal(backups.length, 1);
  assert.equal(
    existsSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops', backups[0], 'old.txt')),
    true,
  );
  const log = readFileSync(commandLog, 'utf8');
  assert.match(
    log,
    new RegExp(`claude plugin validate ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  assert.match(
    log,
    new RegExp(
      `claude plugin validate ${join(root, pluginDir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    ),
  );
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
  writeExecutable(
    fakeBin,
    'claude',
    `#!/bin/sh
printf 'claude %s\\n' "$*" >> "${commandLog}"
if [ "$1" = "plugin" ] && [ "$2" = "list" ] && [ "$3" = "--json" ]; then
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2"}]\\n'
fi
`,
  );

  const result = runScript(
    'update-local-agent-triggers.mjs',
    ['--root', root, '--codex-home', codexHome, '--no-codex-debug', pluginName],
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Codex cache is missing or stale; syncing local cache/);
  assert.equal(
    readFileSync(join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/fresh.txt'), 'utf8').trim(),
    'fresh local plugin snapshot',
  );
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
  cpSync(join(root, pluginDir), join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'), {
    recursive: true,
  });

  const result = runScript(
    'update-local-agent-triggers.mjs',
    ['--root', root, '--codex-home', codexHome, '--no-codex-debug', pluginName],
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /claude: CLI unavailable; skipped Claude update commands/);
});
