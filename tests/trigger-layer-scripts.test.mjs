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
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertNoDuplicateHeadingSlugs,
  findDuplicateHeadingSlugs,
  lintClaudeOnlyToolRefs,
  normalizeSkillBodyForPlaybook,
  parseClaudeSkill,
  upsertPlaybookSection,
  validateImportedTaskName,
} from '../scripts/import-claude-skills.mjs';
import {
  normalizeGeneratedManifest,
  upsertGeneratedPluginEntry,
} from '../scripts/lib/generated-manifest.mjs';
import {
  collectDocumentHeaderCheckFailures,
  expandHeaderCheckGlobs,
  validateHeaderCheckConfig,
} from '../scripts/lib/document-header-checks.mjs';
import { PLAYBOOK_FIRST_GUIDANCE } from '../scripts/lib/playbook-first-guidance.mjs';
import { writeTriggerLayer } from '../scripts/lib/trigger-layer.mjs';

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

function runGit(root, args, options = {}) {
  return spawnSync('git', args, {
    cwd: root,
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

function frontmatterText(root, path) {
  const text = readFileSync(join(root, path), 'utf8');
  return text.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
}

function readPluginVersionSources(root, pluginName) {
  return {
    package: readJson(root, 'package.json').version,
    codexMarketplace: readJson(root, '.agents/plugins/marketplace.json').plugins.find(
      (plugin) => plugin.name === pluginName,
    )?.version,
    claudeMarketplace: readJson(root, '.claude-plugin/marketplace.json').plugins.find(
      (plugin) => plugin.name === pluginName,
    )?.version,
    codexManifest: readJson(root, `plugins/${pluginName}/.codex-plugin/plugin.json`).version,
    claudeManifest: readJson(root, `plugins/${pluginName}/.claude-plugin/plugin.json`).version,
  };
}

function writeGeneratedManifest(root, pluginName, pluginVersion, files) {
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    kitVersion: '0.1.4',
    templateVersion: 1,
    pluginName,
    pluginVersion,
    playbook: 'docs/agent-playbooks/demo-ops.md',
    maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
    tasks: ['docs-review'],
    files: files.map((file) => ({
      ...file,
      sha256: sha256(join(root, file.path)),
    })),
  });
}

function writeGeneratedManifestV2(root, plugins, overrides = {}) {
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.4',
    templateVersion: 1,
    plugins,
    ...overrides,
  });
}

function generatedPluginEntry(root, pluginName = 'demo-ops') {
  const manifest = readJson(root, '.agent-trigger-kit/generated.json');
  if (manifest.schemaVersion === 2) return manifest.plugins?.[pluginName] || null;
  if (manifest.pluginName === pluginName) return manifest;
  return null;
}

function generatedFiles(root, pluginName = 'demo-ops') {
  return generatedPluginEntry(root, pluginName)?.files || [];
}

function writeGeneratedManifestForDemoPlugin(root, pluginDir, pluginName, pluginVersion) {
  writeGeneratedManifest(root, pluginName, pluginVersion, [
    { kind: 'plugin-manifest', path: `${pluginDir}/.codex-plugin/plugin.json` },
    { kind: 'plugin-manifest', path: `${pluginDir}/.claude-plugin/plugin.json` },
    { kind: 'skill', path: `${pluginDir}/skills/docs-review/SKILL.md` },
    { kind: 'command', path: `${pluginDir}/commands/docs-review.md` },
  ]);
}

function initGitFixture(root) {
  for (const args of [
    ['init'],
    ['config', 'user.name', 'Agent Trigger Kit Tests'],
    ['config', 'user.email', 'agent-trigger-kit-tests@example.com'],
  ]) {
    const result = runGit(root, args);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
}

function commitAll(root, message) {
  let result = runGit(root, ['add', '.']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runGit(root, ['commit', '-m', message]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = runGit(root, ['rev-parse', 'HEAD']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function bumpDemoPluginVersion(root, pluginDir, version = '0.1.1') {
  const codexMarketplace = readJson(root, '.agents/plugins/marketplace.json');
  codexMarketplace.plugins.find((plugin) => plugin.name === 'demo-ops').version = version;
  writeJson(root, '.agents/plugins/marketplace.json', codexMarketplace);

  const claudeMarketplace = readJson(root, '.claude-plugin/marketplace.json');
  claudeMarketplace.plugins.find((plugin) => plugin.name === 'demo-ops').version = version;
  writeJson(root, '.claude-plugin/marketplace.json', claudeMarketplace);

  const codexManifest = readJson(root, `${pluginDir}/.codex-plugin/plugin.json`);
  codexManifest.version = version;
  writeJson(root, `${pluginDir}/.codex-plugin/plugin.json`, codexManifest);

  const claudeManifest = readJson(root, `${pluginDir}/.claude-plugin/plugin.json`);
  claudeManifest.version = version;
  writeJson(root, `${pluginDir}/.claude-plugin/plugin.json`, claudeManifest);
}

function writeManagedSkill(root, pluginDir, body = 'Use for docs review work.') {
  write(
    root,
    `${pluginDir}/skills/docs-review/SKILL.md`,
    `---
name: docs-review
description: Use for docs review work.
---

# Docs Review

Maintenance contract: \`some/contract.md\`

${body}

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
}

function writeGuidedSkill(root, pluginDir, task = 'docs-review', options = {}) {
  const description =
    options.description ?? 'Use for docs review work. Project playbook is source of truth.';
  const guidance =
    options.guidance ??
    'For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it.';
  write(
    root,
    `${pluginDir}/skills/${task}/SKILL.md`,
    `---
name: ${task}
description: ${description}
---

# ${task}

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`

## Checklist

- ${guidance}
- Maintenance contract: \`../../../../.agent-trigger-kit/MAINTENANCE.md\`
`,
  );
}

function createVersionBumpFixture(root, options = {}) {
  const plugins =
    options.pluginNames && options.pluginNames.length > 1
      ? createMinimalPlugins(root, options.pluginNames)
      : [createMinimalPlugin(root)];
  for (const plugin of plugins) {
    mkdirSync(join(root, `${plugin.pluginDir}/skills`), { recursive: true });
    mkdirSync(join(root, `${plugin.pluginDir}/commands`), { recursive: true });
  }
  const { pluginDir, pluginName } = plugins.find((plugin) => plugin.pluginName === 'demo-ops');
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeManagedSkill(root, pluginDir);
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    pluginName,
    files: [{ kind: 'skill', path: `${pluginDir}/skills/docs-review/SKILL.md` }],
  });
  initGitFixture(root);
  return { pluginDir, pluginName, skillPath: `${pluginDir}/skills/docs-review/SKILL.md` };
}

function createVersionBumpFixtureV2(root, options = {}) {
  const plugins =
    options.pluginNames && options.pluginNames.length > 1
      ? createMinimalPlugins(root, options.pluginNames)
      : [createMinimalPlugin(root)];
  for (const plugin of plugins) {
    mkdirSync(join(root, `${plugin.pluginDir}/skills`), { recursive: true });
    mkdirSync(join(root, `${plugin.pluginDir}/commands`), { recursive: true });
  }
  const { pluginDir, pluginName } = plugins.find((plugin) => plugin.pluginName === 'demo-ops');
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeManagedSkill(root, pluginDir);
  write(
    root,
    `${pluginDir}/commands/docs-review.md`,
    `---
description: Use for docs review work.
---

Apply the \`demo-ops:docs-review\` skill before acting.
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: `${pluginDir}/skills/docs-review/SKILL.md` }],
    },
    ...(options.pluginNames?.includes('other-ops')
      ? {
          'other-ops': {
            pluginVersion: '0.1.0',
            playbook: 'docs/agent-playbooks/other-ops.md',
            maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
            tasks: ['docs-review'],
            files: [
              {
                kind: 'skill',
                path: 'plugins/other-ops/skills/docs-review/SKILL.md',
              },
            ],
          },
        }
      : {}),
  });
  initGitFixture(root);
  return { pluginDir, pluginName, skillPath: `${pluginDir}/skills/docs-review/SKILL.md` };
}

test('parseClaudeSkill extracts required frontmatter and body', () => {
  const parsed = parseClaudeSkill(
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
    '.claude/skills/docs-review/SKILL.md',
  );

  assert.deepEqual(parsed, {
    name: 'docs-review',
    description: 'Review docs before release.',
    body: '# Docs Review\n\nRead README changes.\n',
  });
});

test('parseClaudeSkill fails when name or description is missing', () => {
  assert.throws(
    () =>
      parseClaudeSkill(
        `---
name: docs-review
---

Body.
`,
        '.claude/skills/docs-review/SKILL.md',
      ),
    /missing required frontmatter key description/i,
  );
});

test('parseClaudeSkill normalizes CRLF and rejects unsupported block scalars', () => {
  const parsed = parseClaudeSkill(
    '---\r\nname: docs-review\r\ndescription: Review docs.\r\n---\r\n\r\nBody.\r\n',
    '.claude/skills/docs-review/SKILL.md',
  );
  assert.equal(parsed.body, '\nBody.\n');
  assert.throws(
    () =>
      parseClaudeSkill(
        `---
name: docs-review
description: >
  Review docs.
---

Body.
`,
        '.claude/skills/docs-review/SKILL.md',
      ),
    /block scalar frontmatter is not supported/i,
  );
});

test('parseClaudeSkill rejects block scalar variants for name and description', () => {
  for (const [key, value] of [
    ['description', '>-'],
    ['description', '|+'],
    ['name', '> # comment'],
  ]) {
    assert.throws(
      () =>
        parseClaudeSkill(
          `---
name: docs-review
description: Review docs.
${key}: ${value}
  continuation
---

Body.
`,
          '.claude/skills/docs-review/SKILL.md',
        ),
      /block scalar frontmatter is not supported/i,
    );
  }
});

test('validateImportedTaskName accepts clean kebab slugs only', () => {
  assert.equal(validateImportedTaskName('docs-review', 'skill name'), 'docs-review');
  assert.throws(
    () => validateImportedTaskName('Docs Review', 'skill name'),
    /must be a clean kebab slug/i,
  );
  assert.throws(
    () => validateImportedTaskName('docs_review', 'skill name'),
    /must be a clean kebab slug/i,
  );
});

test('playbook-first guidance helpers append signal idempotently', async () => {
  const {
    PLAYBOOK_FIRST_GUIDANCE,
    appendPlaybookFirstSignal,
    hasPlaybookFirstGuidance,
    hasPlaybookFirstSignal,
  } = await import('../scripts/lib/playbook-first-guidance.mjs');

  assert.equal(
    appendPlaybookFirstSignal('Use for docs review work.'),
    'Use for docs review work. Project playbook is source of truth.',
  );
  assert.equal(
    appendPlaybookFirstSignal('Use for docs review work. Project playbook is source of truth.'),
    'Use for docs review work. Project playbook is source of truth.',
  );
  assert.equal(hasPlaybookFirstSignal('Project playbook is source of truth.'), true);
  assert.equal(hasPlaybookFirstGuidance(PLAYBOOK_FIRST_GUIDANCE.guidance), true);
});

test('generated manifest round-trips playbook-first guidance flag', () => {
  const manifest = {
    schemaVersion: 2,
    kitVersion: '0.1.7',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbookFirstGuidance: { version: 1 },
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
      },
    },
  };

  const normalized = normalizeGeneratedManifest(manifest);
  assert.deepEqual(normalized.plugins['demo-ops'].playbookFirstGuidance, { version: 1 });

  const updated = upsertGeneratedPluginEntry(
    manifest,
    'demo-ops',
    {
      pluginVersion: '0.1.1',
      playbookFirstGuidance: { version: 1 },
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review', 'deploy-ops'],
      files: [],
    },
    { kitVersion: '0.1.8', templateVersion: 1 },
  );

  assert.deepEqual(updated.plugins['demo-ops'].playbookFirstGuidance, { version: 1 });
});

test('generated manifest drops malformed playbook-first guidance flags', () => {
  for (const playbookFirstGuidance of [{}, { version: '1' }, [], true]) {
    const manifest = {
      schemaVersion: 2,
      kitVersion: '0.1.7',
      templateVersion: 1,
      plugins: {
        'demo-ops': {
          pluginVersion: '0.1.0',
          playbookFirstGuidance,
          playbook: 'docs/agent-playbooks/demo-ops.md',
          maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
          tasks: ['docs-review'],
          files: [],
        },
      },
    };

    const normalized = normalizeGeneratedManifest(manifest);
    assert.equal(normalized.plugins['demo-ops'].playbookFirstGuidance, undefined);

    const updated = upsertGeneratedPluginEntry(
      manifest,
      'demo-ops',
      {
        pluginVersion: '0.1.1',
        playbookFirstGuidance,
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review', 'deploy-ops'],
        files: [],
      },
      { kitVersion: '0.1.8', templateVersion: 1 },
    );

    assert.equal(updated.plugins['demo-ops'].playbookFirstGuidance, undefined);
  }
});

test('generated manifest round-trips header checks', () => {
  const headerChecks = [
    {
      name: 'superpowers-plan-lifecycle',
      globs: ['docs/superpowers/plans/*.md'],
      headerLines: 6,
      requirePattern: '^Status: ',
      exclude: ['docs/plans/**'],
    },
  ];
  const manifest = {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks,
      },
    },
  };

  const normalized = normalizeGeneratedManifest(manifest);
  assert.deepEqual(normalized.plugins['demo-ops'].headerChecks, headerChecks);

  const updated = upsertGeneratedPluginEntry(
    manifest,
    'demo-ops',
    {
      pluginVersion: '0.1.1',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
      headerChecks,
    },
    { kitVersion: '0.1.10', templateVersion: 1 },
  );

  assert.deepEqual(updated.plugins['demo-ops'].headerChecks, headerChecks);
});

test('generated manifest omits malformed header checks during normalization', () => {
  for (const headerChecks of [{}, 'yes', true]) {
    const normalized = normalizeGeneratedManifest({
      schemaVersion: 2,
      plugins: {
        'demo-ops': {
          pluginVersion: '0.1.0',
          playbook: 'docs/agent-playbooks/demo-ops.md',
          maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
          tasks: ['docs-review'],
          files: [],
          headerChecks,
        },
      },
    });

    assert.equal(normalized.plugins['demo-ops'].headerChecks, undefined);
  }
});

test('generated manifest carries v1 header checks forward', () => {
  const headerChecks = [
    {
      name: 'superpowers-plan-lifecycle',
      globs: ['docs/superpowers/plans/*.md'],
      headerLines: 6,
      requirePattern: '^Status: ',
    },
  ];

  const normalized = normalizeGeneratedManifest({
    schemaVersion: 1,
    pluginName: 'demo-ops',
    pluginVersion: '0.1.0',
    playbook: 'docs/agent-playbooks/demo-ops.md',
    maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
    tasks: ['docs-review'],
    files: [],
    headerChecks,
  });

  assert.deepEqual(normalized.plugins['demo-ops'].headerChecks, headerChecks);
});

test('document header checks pass when a required header appears within the configured top lines', () => {
  const root = makeRoot();
  write(
    root,
    'docs/superpowers/plans/feature.md',
    `# Feature Plan
Status: Draft

Body.
`,
  );

  const failures = collectDocumentHeaderCheckFailures({
    root,
    checks: [
      {
        name: 'superpowers-plan-lifecycle',
        globs: ['docs/superpowers/plans/*.md'],
        headerLines: 6,
        requirePattern: '^Status: ',
      },
    ],
  });

  assert.deepEqual(failures, []);
});

test('document header checks fail when the header is missing from the top lines', () => {
  const root = makeRoot();
  write(
    root,
    'docs/superpowers/plans/feature.md',
    `# Feature Plan

Intro.

More intro.

Status: Draft
`,
  );

  const failures = collectDocumentHeaderCheckFailures({
    root,
    checks: [
      {
        name: 'superpowers-plan-lifecycle',
        globs: ['docs/superpowers/plans/*.md'],
        headerLines: 3,
        requirePattern: '^Status: ',
      },
    ],
  });

  assert.deepEqual(failures, [
    'MISSING header in docs/superpowers/plans/feature.md (check: superpowers-plan-lifecycle)',
  ]);
});

test('document header checks respect exclude globs', () => {
  const root = makeRoot();
  write(root, 'docs/superpowers/plans/current.md', '# Current\nStatus: Draft\n');
  write(root, 'docs/superpowers/plans/legacy.md', '# Legacy\n');

  const files = expandHeaderCheckGlobs(root, {
    globs: ['docs/superpowers/plans/*.md'],
    exclude: ['docs/superpowers/plans/legacy.md'],
  });

  assert.deepEqual(files, ['docs/superpowers/plans/current.md']);
});

test('document header glob expansion skips symlinked directories', () => {
  const root = makeRoot();
  write(root, 'docs/superpowers/plans/current.md', '# Current\nStatus: Draft\n');
  symlinkSync(root, join(root, 'docs/superpowers/plans/loop'), 'dir');

  const files = expandHeaderCheckGlobs(root, {
    globs: ['docs/superpowers/plans/**'],
  });

  assert.deepEqual(files, ['docs/superpowers/plans/current.md']);
});

test('document header checks support enum policies through requirePattern', () => {
  const root = makeRoot();
  write(root, 'docs/superpowers/specs/feature.md', '# Feature\nStatus: Banana\n');

  const failures = collectDocumentHeaderCheckFailures({
    root,
    checks: [
      {
        name: 'superpowers-status-enum',
        globs: ['docs/superpowers/specs/*.md'],
        headerLines: 6,
        requirePattern: '^Status: (Draft|Approved|Implemented)$',
      },
    ],
  });

  assert.deepEqual(failures, [
    'MISSING header in docs/superpowers/specs/feature.md (check: superpowers-status-enum)',
  ]);
});

test('document header check config reports malformed entries', () => {
  const errors = validateHeaderCheckConfig('.agent-trigger-kit/generated.json', 'demo-ops', [
    {
      name: '',
      globs: [],
      headerLines: 0,
      requirePattern: '(',
      exclude: ['docs/plans/**'],
    },
  ]);

  assert.match(errors.join('\n'), /headerChecks\[0\]\.name must be a non-empty string/);
  assert.match(errors.join('\n'), /headerChecks\[0\]\.globs must be a non-empty array/);
  assert.match(errors.join('\n'), /headerChecks\[0\]\.headerLines must be a positive integer/);
  assert.match(errors.join('\n'), /headerChecks\[0\]\.requirePattern is invalid/);
});

test('normalizeSkillBodyForPlaybook strips leading h1 and demotes headings outside fences', () => {
  const body = [
    '# Docs Review',
    '',
    'Intro.',
    '',
    '```bash',
    '# shell comment',
    '## literal code heading',
    '```',
    '',
    '## Checklist',
    '',
    '- Read docs.',
    '',
  ].join('\n');
  const expected = [
    'Intro.',
    '',
    '```bash',
    '# shell comment',
    '## literal code heading',
    '```',
    '',
    '### Checklist',
    '',
    '- Read docs.',
    '',
  ].join('\n');

  assert.equal(normalizeSkillBodyForPlaybook(body), expected);
});

test('normalizeSkillBodyForPlaybook preserves headings inside tilde fences', () => {
  const body = [
    '# Docs Review',
    '',
    '~~~js',
    '## literal code heading',
    '~~~',
    '',
    '## Checklist',
    '',
  ].join('\n');
  const expected = ['~~~js', '## literal code heading', '~~~', '', '### Checklist', ''].join('\n');

  assert.equal(normalizeSkillBodyForPlaybook(body), expected);
});

test('normalizeSkillBodyForPlaybook preserves indentation when no leading h1 exists', () => {
  assert.equal(
    normalizeSkillBodyForPlaybook('\n    const x = 1;\n\n## Notes\n\n'),
    '    const x = 1;\n\n### Notes\n',
  );
});

test('normalizeSkillBodyForPlaybook preserves indentation after stripped leading h1', () => {
  assert.equal(
    normalizeSkillBodyForPlaybook('# Docs Review\n\n    const x = 1;\n\n## Notes\n\n'),
    '    const x = 1;\n\n### Notes\n',
  );
});

test('upsertPlaybookSection appends new task section and rejects accidental replacement', () => {
  const initial = '# Demo Ops Playbook\n\nIntro.\n';
  const updated = upsertPlaybookSection(initial, {
    task: 'docs-review',
    body: 'Review docs.\n',
  });

  assert.match(updated, /^# Demo Ops Playbook\n\nIntro\.\n\n## docs-review\n\nReview docs\.\n$/);
  assert.throws(
    () =>
      upsertPlaybookSection(updated, {
        task: 'docs-review',
        body: 'Replacement.\n',
      }),
    /already has section ## docs-review/i,
  );
});

test('upsertPlaybookSection replaces existing section only when requested', () => {
  const updated = upsertPlaybookSection(
    '# Demo\n\n## docs-review\n\nOld.\n\n## deploy-ops\n\nDeploy.\n',
    {
      task: 'docs-review',
      body: 'New.\n',
      replace: true,
    },
  );

  assert.equal(updated, '# Demo\n\n## docs-review\n\nNew.\n\n## deploy-ops\n\nDeploy.\n');
});

test('upsertPlaybookSection preserves dollar tokens when replacing a section', () => {
  const updated = upsertPlaybookSection('# Demo\n\n## deploy-ops\n\nOld.\n', {
    task: 'deploy-ops',
    body: 'Run `deploy.sh $1 $2 $@ $& $$`.\n',
    replace: true,
  });

  assert.equal(updated, '# Demo\n\n## deploy-ops\n\nRun `deploy.sh $1 $2 $@ $& $$`.\n');
});

test('assertNoDuplicateHeadingSlugs rejects validator-incompatible playbooks', () => {
  assert.throws(
    () =>
      assertNoDuplicateHeadingSlugs(`# Demo

## docs-review

### Checklist

## deploy-ops

### Checklist
`),
    /duplicate heading slug checklist/i,
  );
});

test('findDuplicateHeadingSlugs uses validator-compatible simplified slugs', () => {
  assert.deepEqual(
    findDuplicateHeadingSlugs(`# Demo

## Use The Thing!

## use-the-thing
`),
    [
      {
        slug: 'use-the-thing',
        headings: ['Use The Thing!', 'use-the-thing'],
      },
    ],
  );
});

test('lintClaudeOnlyToolRefs warns for conservative Claude tool references', () => {
  assert.deepEqual(lintClaudeOnlyToolRefs('Use the TodoWrite tool, then call `Task`.'), [
    'Task',
    'TodoWrite',
  ]);
  assert.deepEqual(lintClaudeOnlyToolRefs('Use normal shell commands.'), []);
});

test('import-claude-skills seeds playbook and generated trigger wrappers', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Use the TodoWrite tool before editing docs.

## Checklist

- Read README.
`,
  );
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

# Deploy Ops

Confirm release state.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--skills',
    'docs-review,deploy-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /docs-review.*TodoWrite/i);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), false);

  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.match(playbook, /Maintenance contract: `..\/..\/.agent-trigger-kit\/MAINTENANCE.md`/);
  assert.match(playbook, /## docs-review\n\nUse the TodoWrite tool before editing docs\./);
  assert.match(playbook, /### Checklist/);
  assert.match(playbook, /## deploy-ops\n\nConfirm release state\./);

  const wrapper = readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8');
  assert.match(wrapper, /description: Review docs before release\./);

  const generated = generatedPluginEntry(root);
  assert.deepEqual(generated.tasks, ['docs-review', 'deploy-ops']);
  assert.equal(
    generated.files.some((file) => file.path === 'plugins/demo-ops/skills/docs-review/SKILL.md'),
    true,
  );

  const validate = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
});

test('import-claude-skills creates brand-new guided plugin with preserved description signal', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(generatedPluginEntry(root).playbookFirstGuidance, { version: 1 });
  const wrapper = readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8');
  assert.match(
    wrapper,
    /description: Review docs before release\. Project playbook is source of truth\./,
  );
  assert.match(wrapper, /For tasks covered by this project trigger layer/);

  const commandFrontmatter = frontmatterText(root, 'plugins/demo-ops/commands/docs-review.md');
  assert.match(commandFrontmatter, /^description: Review docs before release\.$/m);
  assert.doesNotMatch(commandFrontmatter, /Project playbook is source of truth\./);

  assert.match(
    readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8'),
    /## Playbook-First Guidance/,
  );
});

test('import-claude-skills does not upgrade existing unflagged plugin', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
  });
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(generatedPluginEntry(root).playbookFirstGuidance, undefined);
  assert.doesNotMatch(
    readFileSync(join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md'), 'utf8'),
    /Project playbook is source of truth/,
  );
});

test('import-claude-skills preserves existing custom plugin manifests on non-force import', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
  });
  writeJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json', {
    name: 'demo-ops',
    version: '0.1.0',
    description: 'Custom Codex manifest',
    author: { name: 'Demo Ops' },
    skills: './skills/',
    customCodexField: 'preserve me',
  });
  writeJson(root, 'plugins/demo-ops/.claude-plugin/plugin.json', {
    name: 'demo-ops',
    version: '0.1.0',
    description: 'Custom Claude manifest',
    author: { name: 'Demo Ops' },
    skills: ['./skills/'],
    commands: ['./commands/'],
    customClaudeField: 'preserve me too',
  });
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    readJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json').customCodexField,
    'preserve me',
  );
  assert.equal(
    readJson(root, 'plugins/demo-ops/.claude-plugin/plugin.json').customClaudeField,
    'preserve me too',
  );
  assert.equal(generatedPluginEntry(root).playbookFirstGuidance, undefined);
  assert.match(
    readFileSync(join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md'), 'utf8'),
    /description: Use when preparing deployments\./,
  );
});

test('import-claude-skills retains unchanged tracked plugin manifests when preserving them', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [
        {
          kind: 'plugin-manifest',
          path: 'plugins/demo-ops/.codex-plugin/plugin.json',
          sha256: sha256(join(root, 'plugins/demo-ops/.codex-plugin/plugin.json')),
        },
        {
          kind: 'plugin-manifest',
          path: 'plugins/demo-ops/.claude-plugin/plugin.json',
          sha256: sha256(join(root, 'plugins/demo-ops/.claude-plugin/plugin.json')),
        },
      ],
    },
  });
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    generatedFiles(root).some(
      (file) =>
        file.kind === 'plugin-manifest' &&
        file.path === 'plugins/demo-ops/.codex-plugin/plugin.json',
    ),
    true,
  );
  assert.equal(
    generatedFiles(root).some(
      (file) =>
        file.kind === 'plugin-manifest' &&
        file.path === 'plugins/demo-ops/.claude-plugin/plugin.json',
    ),
    true,
  );

  write(
    root,
    '.claude/skills/release-ops/SKILL.md',
    `---
name: release-ops
description: Use when preparing releases.
---

Release body.
`,
  );
  const forceResult = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--force',
  ]);

  assert.equal(forceResult.status, 0, forceResult.stderr || forceResult.stdout);
});

test('import-claude-skills drops tracked plugin manifests with checksum mismatch when preserving them', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const codexManifestPath = 'plugins/demo-ops/.codex-plugin/plugin.json';
  const claudeManifestPath = 'plugins/demo-ops/.claude-plugin/plugin.json';
  const trackedCodexSha = sha256(join(root, codexManifestPath));
  const trackedClaudeSha = sha256(join(root, claudeManifestPath));
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [
        { kind: 'plugin-manifest', path: codexManifestPath, sha256: trackedCodexSha },
        { kind: 'plugin-manifest', path: claudeManifestPath, sha256: trackedClaudeSha },
      ],
    },
  });
  writeJson(root, codexManifestPath, {
    name: 'demo-ops',
    version: '0.1.0',
    description: 'Locally edited Codex manifest',
    author: { name: 'Demo Ops' },
    skills: './skills/',
  });
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    generatedFiles(root).some(
      (file) =>
        file.kind === 'plugin-manifest' &&
        file.path === 'plugins/demo-ops/.codex-plugin/plugin.json',
    ),
    false,
  );
  assert.equal(
    generatedFiles(root).some(
      (file) =>
        file.kind === 'plugin-manifest' &&
        file.path === 'plugins/demo-ops/.claude-plugin/plugin.json',
    ),
    true,
  );
});

test('import-claude-skills failed existing-plugin import leaves generated.json unchanged', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
  });
  const generatedBefore = readFileSync(join(root, '.agent-trigger-kit/generated.json'), 'utf8');
  write(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md', 'User-owned wrapper collision.');
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /plugins\/demo-ops\/skills\/deploy-ops\/SKILL\.md already exists/);
  assert.equal(
    readFileSync(join(root, '.agent-trigger-kit/generated.json'), 'utf8'),
    generatedBefore,
  );
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, '.agent-trigger-kit/MAINTENANCE.md')), false);
});

test('import-claude-skills preserves existing guided plugin flag for imported tasks', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbookFirstGuidance: { version: 1 },
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
  });
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

Deploy body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(generatedPluginEntry(root).playbookFirstGuidance, { version: 1 });
  assert.match(
    readFileSync(join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md'), 'utf8'),
    /Use when preparing deployments\. Project playbook is source of truth\./,
  );
});

test('import-claude-skills deletes source by default after successful import', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

Body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), false);
});

test('import-claude-skills keeps source with --keep-source', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

Body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--keep-source',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});

test('import-claude-skills refuses existing playbook section without replacement flag', () => {
  const root = makeRoot();
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo\n\n## docs-review\n\nExisting.\n');
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

New body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already has section ## docs-review/i);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
});

test('import-claude-skills replaces playbook section with explicit flag', () => {
  const root = makeRoot();
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo\n\n## docs-review\n\nExisting.\n');
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs.
---

New body.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--replace-playbook-section',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8'),
    '# Demo\n\n## docs-review\n\nNew body.\n',
  );
});

test('import-claude-skills supports importing selected skills', () => {
  const root = makeRoot();
  for (const skill of ['docs-review', 'deploy-ops']) {
    write(
      root,
      `.claude/skills/${skill}/SKILL.md`,
      `---
name: ${skill}
description: ${skill} description.
---

${skill} body.
`,
    );
  }

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--skills',
    'deploy-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.doesNotMatch(playbook, /## docs-review/);
  assert.match(playbook, /## deploy-ops/);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
  assert.equal(existsSync(join(root, '.claude/skills/deploy-ops/SKILL.md')), false);
});

test('import-claude-skills fails before writes when imported bodies duplicate heading slugs', () => {
  const root = makeRoot();
  for (const skill of ['docs-review', 'deploy-ops']) {
    write(
      root,
      `.claude/skills/${skill}/SKILL.md`,
      `---
name: ${skill}
description: ${skill} description.
---

# ${skill}

## Checklist

- ${skill}
`,
    );
  }

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /duplicate heading slug checklist/i);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md')), false);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
  assert.equal(existsSync(join(root, '.claude/skills/deploy-ops/SKILL.md')), true);
});

test('import-claude-skills fails when a selected skill is missing', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--skills',
    'docs-review,missing-skill',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing-skill/);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});

test('import-claude-skills rejects selected skill names that escape source', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );
  write(
    root,
    '.claude/outside/SKILL.md',
    `---
name: outside
description: Escaped source skill.
---

# Outside

This should never import.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--skills',
    '../outside',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /selected skill name|clean kebab slug/i);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/outside/SKILL.md')), false);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
  assert.equal(existsSync(join(root, '.claude/outside/SKILL.md')), true);
});

test('import-claude-skills rejects source directories outside root before writes', () => {
  const root = makeRoot();
  const outsideRoot = makeRoot();
  const outsideSource = join(outsideRoot, '.claude/skills');
  const escapedSource = relative(root, outsideSource);
  write(
    outsideRoot,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    escapedSource,
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source directory must stay inside --root/i);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(outsideSource, 'docs-review/SKILL.md')), true);
});

test('import-claude-skills rejects symlinked source directories outside root before writes', () => {
  const root = makeRoot();
  const outsideRoot = makeRoot();
  const outsideSource = join(outsideRoot, '.claude/skills');
  write(
    outsideRoot,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );
  mkdirSync(join(root, '.claude'), { recursive: true });
  symlinkSync(outsideSource, join(root, '.claude/skills'), 'dir');

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source directory must stay inside --root/i);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(outsideSource, 'docs-review/SKILL.md')), true);
});

test('import-claude-skills rejects symlinked skill directories outside source before reads', () => {
  const root = makeRoot();
  const outsideRoot = makeRoot();
  write(
    outsideRoot,
    'docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );
  mkdirSync(join(root, '.claude/skills'), { recursive: true });
  symlinkSync(join(outsideRoot, 'docs-review'), join(root, '.claude/skills/docs-review'), 'dir');

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skill path must stay inside --source/i);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(outsideRoot, 'docs-review/SKILL.md')), true);
});

test('import-claude-skills rejects playbook paths outside root before writes', () => {
  const root = makeRoot();
  const outsideRoot = makeRoot();
  const escapedPlaybook = relative(root, join(outsideRoot, 'demo-ops.md'));
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    escapedPlaybook,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /playbook.*inside --root/i);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(outsideRoot, 'demo-ops.md')), false);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});

test('import-claude-skills rejects playbook parent symlinks outside root before writes', () => {
  const root = makeRoot();
  const outsideRoot = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );
  mkdirSync(join(root, 'docs'), { recursive: true });
  symlinkSync(outsideRoot, join(root, 'docs/outside'), 'dir');

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/outside/demo-ops.md',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /playbook.*inside --root/i);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), false);
  assert.equal(existsSync(join(outsideRoot, 'demo-ops.md')), false);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});

test('import-claude-skills rejects unsafe plugin names before writes', () => {
  const root = makeRoot();
  const unsafePluginName = `../../outside-plugin-${basename(root)}`;
  const escapedTarget = join(root, 'plugins', unsafePluginName, 'skills/docs-review/SKILL.md');
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    unsafePluginName,
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--skills',
    'docs-review',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /plugin|unsafe|simple plugin id|clean slug/i);
  assert.equal(existsSync(escapedTarget), false);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});

test('import-claude-skills preflights generated target collisions before writes', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );
  write(root, 'plugins/demo-ops/skills/docs-review/SKILL.md', 'existing generated target');

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--skills',
    'docs-review',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /plugins\/demo-ops\/skills\/docs-review\/SKILL\.md already exists; rerun with --force/i,
  );
  assert.equal(existsSync(join(root, '.agents/plugins/marketplace.json')), false);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(
    readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8'),
    'existing generated target\n',
  );
  assert.equal(existsSync(join(root, '.claude/skills/docs-review/SKILL.md')), true);
});

test('import-claude-skills discovers source skills in stable sorted order', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use when preparing deployments.
---

# Deploy Ops

Confirm release state.
`,
  );
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runScript('import-claude-skills.mjs', [
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const generated = generatedPluginEntry(root);
  assert.deepEqual(generated.tasks, ['deploy-ops', 'docs-review']);

  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.ok(playbook.indexOf('## deploy-ops') < playbook.indexOf('## docs-review'));
});

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

test('cli forwards init task descriptions', () => {
  const root = makeRoot();
  const result = runCli([
    'init',
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--task-descriptions',
    JSON.stringify({
      'docs-review': 'Use for docs and playbook review.',
    }),
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8'),
    /description: Use for docs and playbook review\. Project playbook is source of truth\./,
  );
});

test('cli routes version-check to the existing script', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = join(makeRoot(), 'missing-claude-home');
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runCli(
    [
      'version-check',
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      claudeHome,
      pluginName,
    ],
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /expected source version: 0\.1\.2/);
  assert.match(result.stdout, /claude: not initialized/);
});

test('cli routes clean command to the generated trigger layer cleaner', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runCli(['clean', '--root', root, '--plugin', 'demo-ops']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /clean dry-run: no orphan generated skills for demo-ops/);
});

test('cli routes import-claude-skills command to the importer', () => {
  const root = makeRoot();
  write(
    root,
    '.claude/skills/docs-review/SKILL.md',
    `---
name: docs-review
description: Review docs before release.
---

# Docs Review

Read README changes.
`,
  );

  const result = runCli([
    'import-claude-skills',
    '--root',
    root,
    '--source',
    '.claude/skills',
    '--plugin',
    'demo-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /imported 1 Claude skill\(s\) into demo-ops/);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md')), true);
});

test('clean dry-run lists generated skill files missing from a v2 plugin manifest entry', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  write(
    root,
    'plugins/demo-ops/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    result.stdout.trim(),
    [
      'clean dry-run: orphan generated skills for demo-ops',
      '  orphan plugins/demo-ops/skills/deploy-ops/SKILL.md',
    ].join('\n'),
  );
});

test('clean --apply deletes orphan generated skill file with marker and removes empty skill directory', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const skillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  const skillDir = 'plugins/demo-ops/skills/deploy-ops';
  write(
    root,
    skillPath,
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--apply',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    result.stdout.trim(),
    ['clean apply: deleted orphan generated skills for demo-ops', `  deleted ${skillPath}`].join(
      '\n',
    ),
  );
  assert.equal(existsSync(join(root, skillPath)), false);
  assert.equal(existsSync(join(root, skillDir)), false);
});

test('clean --apply leaves hand-rolled markerless skill on disk', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const skillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  write(
    root,
    skillPath,
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Hand rolled deploy notes.
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--apply',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'clean apply: no orphan generated skills for demo-ops');
  assert.equal(existsSync(join(root, skillPath)), true);
});

test('clean --apply leaves currently managed skill on disk', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const skillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  write(
    root,
    skillPath,
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [{ kind: 'skill', path: skillPath }],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--apply',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'clean apply: no orphan generated skills for demo-ops');
  assert.equal(existsSync(join(root, skillPath)), true);
});

test('clean --apply deletes only selected plugin orphan and leaves other plugin orphan on disk', () => {
  const root = makeRoot();
  createMinimalPlugins(root, ['demo-ops', 'other-ops']);
  const selectedSkillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  const otherSkillPath = 'plugins/other-ops/skills/deploy-ops/SKILL.md';
  for (const skillPath of [selectedSkillPath, otherSkillPath]) {
    write(
      root,
      skillPath,
      `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
    );
  }
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
    'other-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--apply',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    result.stdout.trim(),
    [
      'clean apply: deleted orphan generated skills for demo-ops',
      `  deleted ${selectedSkillPath}`,
    ].join('\n'),
  );
  assert.equal(existsSync(join(root, selectedSkillPath)), false);
  assert.equal(existsSync(join(root, otherSkillPath)), true);
});

test('clean --apply leaves non-empty skill directory after deleting SKILL.md', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const skillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  const extraPath = 'plugins/demo-ops/skills/deploy-ops/README.md';
  const skillDir = 'plugins/demo-ops/skills/deploy-ops';
  write(
    root,
    skillPath,
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  write(root, extraPath, '# Local notes');
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--apply',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(existsSync(join(root, skillPath)), false);
  assert.equal(existsSync(join(root, extraPath)), true);
  assert.deepEqual(readdirSync(join(root, skillDir)), ['README.md']);
});

test('clean --apply does not modify generated.json', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const skillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  const manifestPath = '.agent-trigger-kit/generated.json';
  write(
    root,
    skillPath,
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });
  const before = readFileSync(join(root, manifestPath), 'utf8');

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--apply',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(readFileSync(join(root, manifestPath), 'utf8'), before);
});

test('clean dry-run still does not delete files', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const skillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  write(
    root,
    skillPath,
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    result.stdout.trim(),
    ['clean dry-run: orphan generated skills for demo-ops', `  orphan ${skillPath}`].join('\n'),
  );
  assert.equal(existsSync(join(root, skillPath)), true);
});

test('clean dry-run skips hand-rolled skills without a maintenance contract marker', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  write(
    root,
    'plugins/demo-ops/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Hand rolled deploy notes.
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'clean dry-run: no orphan generated skills for demo-ops');
});

test('clean dry-run skips currently managed generated skills', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  const skillPath = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  write(
    root,
    skillPath,
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [{ kind: 'skill', path: skillPath }],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'clean dry-run: no orphan generated skills for demo-ops');
});

test('clean dry-run supports a v1 generated manifest for the selected plugin', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  write(
    root,
    'plugins/demo-ops/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    pluginName: 'demo-ops',
    pluginVersion: '0.1.0',
    files: [],
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(
    result.stdout.trim(),
    [
      'clean dry-run: orphan generated skills for demo-ops',
      '  orphan plugins/demo-ops/skills/deploy-ops/SKILL.md',
    ].join('\n'),
  );
});

test('clean dry-run checks only the selected v2 plugin entry', () => {
  const root = makeRoot();
  createMinimalPlugins(root, ['demo-ops', 'other-ops']);
  write(
    root,
    'plugins/other-ops/skills/deploy-ops/SKILL.md',
    `---
name: deploy-ops
description: Use for deploy ops.
---

# Deploy Ops

Maintenance contract: \`some/contract.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
    'other-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), 'clean dry-run: no orphan generated skills for demo-ops');
  assert.doesNotMatch(result.stdout, /other-ops/);
});

test('clean dry-run fails clearly when the selected plugin is absent from the generated manifest', () => {
  const root = makeRoot();
  createMinimalPlugins(root, ['demo-ops', 'other-ops']);
  writeGeneratedManifestV2(root, {
    'other-ops': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated manifest/i);
  assert.match(result.stderr, /plugin/i);
  assert.match(result.stderr, /demo-ops/);
});

test('clean dry-run rejects bare --root value', () => {
  const result = runScript('clean-generated-trigger-layer.mjs', ['--root', '--plugin', 'demo-ops']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--root/);
  assert.doesNotMatch(result.stderr, /TypeError|stack|at file:/i);
});

test('clean dry-run rejects bare --plugin value', () => {
  const root = makeRoot();

  const result = runScript('clean-generated-trigger-layer.mjs', ['--root', root, '--plugin']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--plugin/);
  assert.doesNotMatch(result.stderr, /generated manifest|clean dry-run|TypeError|stack|at file:/i);
});

test('clean dry-run rejects unsafe plugin names before scanning paths', () => {
  const root = makeRoot();
  writeGeneratedManifestV2(root, {
    '../..': {
      pluginVersion: '0.1.0',
      files: [],
    },
  });

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    '../..',
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /plugin name/i);
  assert.equal(result.stdout, '');
});

test('clean dry-run reports invalid generated manifest JSON clearly', () => {
  const root = makeRoot();
  createMinimalPlugin(root);
  write(root, '.agent-trigger-kit/generated.json', '{ malformed json');

  const result = runScript('clean-generated-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.agent-trigger-kit\/generated\.json/);
  assert.match(result.stderr, /invalid JSON|JSON/i);
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

test('init emits playbook-first guidance flag and generated skill guidance', () => {
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
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const entry = generatedPluginEntry(root);
  assert.deepEqual(entry.playbookFirstGuidance, { version: 1 });

  const skill = readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8');
  assert.match(
    skill,
    /description: Use for docs review work in this repo\. Project playbook is source of truth\./,
  );
  assert.match(
    skill,
    /For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it\./,
  );

  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.match(playbook, /## Playbook-First Guidance/);
  assert.doesNotMatch(playbook, /\n{3,}## /);

  const maintenance = readFileSync(join(root, '.agent-trigger-kit/MAINTENANCE.md'), 'utf8');
  assert.match(maintenance, /third-party plugin or global config/i);
});

test('init keeps playbook-first signal out of command and Cursor routing descriptions', () => {
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
    '--cursor-globs',
    'docs/**,README.md',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const skill = readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8');
  assert.match(
    frontmatterText(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'),
    /description: Use for docs review work in this repo\. Project playbook is source of truth\./,
  );
  assert.match(
    skill,
    /For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it\./,
  );

  const commandFrontmatter = frontmatterText(root, 'plugins/demo-ops/commands/docs-review.md');
  assert.match(commandFrontmatter, /^description: Use for docs review work in this repo\.$/m);
  assert.doesNotMatch(commandFrontmatter, /Project playbook is source of truth\./);

  const cursorFrontmatter = frontmatterText(root, '.cursor/rules/docs-review.mdc');
  assert.match(cursorFrontmatter, /^description: Use for docs review work in this repo\.$/m);
  assert.doesNotMatch(cursorFrontmatter, /Project playbook is source of truth\./);
});

test('init uses task-specific descriptions and appends playbook-first signal', () => {
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
    '--task-descriptions',
    JSON.stringify({
      'docs-review': 'Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout.',
    }),
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const docsReview = readFileSync(
    join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'),
    'utf8',
  );
  const deployOps = readFileSync(join(root, 'plugins/demo-ops/skills/deploy-ops/SKILL.md'), 'utf8');

  assert.match(
    docsReview,
    /^description: "Use for docs, playbooks, todo, done-log, review-log, and docs-only closeout\. Project playbook is source of truth\."$/m,
  );
  assert.match(
    deployOps,
    /description: Use for deploy ops work in this repo\. Project playbook is source of truth\./,
  );
});

test('init rejects invalid task description maps', () => {
  const cases = [
    {
      name: 'bare flag',
      args: ['--task-descriptions'],
      pattern: /--task-descriptions must be valid JSON object text/i,
    },
    {
      name: 'json null',
      value: 'null',
      pattern: /--task-descriptions must be a JSON object keyed by task name/i,
    },
    {
      name: 'json array',
      value: '[]',
      pattern: /--task-descriptions must be a JSON object keyed by task name/i,
    },
    {
      name: 'json string',
      value: '"hello"',
      pattern: /--task-descriptions must be a JSON object keyed by task name/i,
    },
    {
      name: 'unknown task',
      value: JSON.stringify({ missing: 'Use for missing work.' }),
      pattern: /unknown task description key missing/i,
    },
    {
      name: 'non-string value',
      value: JSON.stringify({ 'docs-review': 123 }),
      pattern: /docs-review.*non-empty single-line string/i,
    },
    {
      name: 'empty string',
      value: JSON.stringify({ 'docs-review': '   ' }),
      pattern: /docs-review.*non-empty single-line string/i,
    },
    {
      name: 'newline',
      value: JSON.stringify({ 'docs-review': 'Line one\nLine two' }),
      pattern: /docs-review.*single-line/i,
    },
    {
      name: 'invalid json',
      value: '{bad json',
      pattern: /--task-descriptions must be valid JSON/i,
    },
  ];
  const generatedPaths = [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'docs/agent-playbooks/demo-ops.md',
    '.agent-trigger-kit/MAINTENANCE.md',
    '.agent-trigger-kit/generated.json',
    'plugins/demo-ops/skills/docs-review/SKILL.md',
  ];

  for (const testCase of cases) {
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
      ...(testCase.args || ['--task-descriptions', testCase.value]),
    ]);

    assert.notEqual(result.status, 0, testCase.name);
    assert.match(result.stderr, testCase.pattern, testCase.name);
    for (const generatedPath of generatedPaths) {
      assert.equal(existsSync(join(root, generatedPath)), false, testCase.name);
    }
  }
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
  const entry = manifest.plugins?.['demo-ops'];
  const trackedPaths = entry.files.map((file) => file.path);
  const trackedKinds = Object.fromEntries(entry.files.map((file) => [file.path, file.kind]));
  const skillPath = 'plugins/demo-ops/skills/docs-review/SKILL.md';

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(Object.hasOwn(manifest, 'pluginName'), false);
  assert.equal(Object.hasOwn(manifest, 'files'), false);
  assert.equal(entry.pluginVersion, '0.1.0');
  assert.equal(entry.playbook, 'docs/agent-playbooks/demo-ops.md');
  assert.equal(entry.maintenanceContract, '.agent-trigger-kit/MAINTENANCE.md');
  assert.deepEqual(entry.tasks, ['docs-review', 'deploy-ops']);
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
    entry.files.find((file) => file.path === skillPath).sha256,
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

test('init for a second plugin preserves existing v2 plugin entries', () => {
  const root = makeRoot();
  const first = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstEntry = generatedPluginEntry(root, 'demo-ops');

  const second = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'deploy-ops',
    '--tasks',
    'release-check',
    '--playbook',
    'docs/agent-playbooks/deploy-ops.md',
  ]);

  assert.equal(second.status, 0, second.stderr || second.stdout);
  const manifest = readJson(root, '.agent-trigger-kit/generated.json');
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.plugins['demo-ops'], firstEntry);
  assert.equal(manifest.plugins['deploy-ops'].pluginVersion, '0.1.0');
  assert.deepEqual(manifest.plugins['deploy-ops'].tasks, ['release-check']);
  assert.equal(
    manifest.plugins['deploy-ops'].files.some(
      (file) => file.path === 'plugins/deploy-ops/skills/release-check/SKILL.md',
    ),
    true,
  );
});

test('init force overwrites unchanged managed skills and updates generated checksums', () => {
  const root = makeRoot();
  const skillPath = 'plugins/demo-ops/skills/docs-review/SKILL.md';
  const first = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const previousChecksum = generatedFiles(root).find((file) => file.path === skillPath).sha256;

  const second = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/renamed-demo-ops.md',
    '--force',
  ]);

  assert.equal(second.status, 0, second.stderr || second.stdout);
  const skillText = readFileSync(join(root, skillPath), 'utf8');
  const nextManifestEntry = generatedPluginEntry(root);
  const nextEntry = nextManifestEntry.files.find((file) => file.path === skillPath);
  assert.match(skillText, /docs\/agent-playbooks\/renamed-demo-ops\.md/);
  assert.notEqual(nextEntry.sha256, previousChecksum);
  assert.equal(nextEntry.sha256, sha256(join(root, skillPath)));
});

test('init force rejects overwriting a managed skill with local checksum changes', () => {
  const root = makeRoot();
  const skillPath = 'plugins/demo-ops/skills/docs-review/SKILL.md';
  const first = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const manualContent = `${readFileSync(join(root, skillPath), 'utf8')}\nManual local change.\n`;
  writeFileSync(join(root, skillPath), manualContent);

  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/renamed-demo-ops.md',
    '--force',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /checksum|local changes|refusing overwrite/i);
  assert.equal(readFileSync(join(root, skillPath), 'utf8'), manualContent);
});

test('init force preflights generated targets before creating any files', () => {
  const root = makeRoot();
  const skillPath = 'plugins/demo-ops/skills/docs-review/SKILL.md';
  const manualContent = `---
name: docs-review
description: User owned skill.
---

# User Owned
`;
  write(root, skillPath, manualContent);

  const result = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--cursor-globs',
    'docs/**',
    '--force',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated\.json|refusing overwrite/i);
  assert.equal(readFileSync(join(root, skillPath), 'utf8'), manualContent);
  assert.equal(existsSync(join(root, '.agents/plugins/marketplace.json')), false);
  assert.equal(existsSync(join(root, '.claude-plugin/marketplace.json')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/.codex-plugin/plugin.json')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/.claude-plugin/plugin.json')), false);
  assert.equal(existsSync(join(root, 'plugins/demo-ops/commands/docs-review.md')), false);
  assert.equal(existsSync(join(root, '.cursor/rules/docs-review.mdc')), false);
  assert.equal(existsSync(join(root, 'docs/agent-playbooks/demo-ops.md')), false);
  assert.equal(existsSync(join(root, '.agent-trigger-kit/MAINTENANCE.md')), false);
  assert.equal(existsSync(join(root, '.agent-trigger-kit/generated.json')), false);
});

test('init force rejects existing skill targets without matching previous generated manifest ownership', () => {
  const cases = [
    { name: 'missing manifest', manifest: null },
    {
      name: 'different plugin',
      manifest: {
        schemaVersion: 1,
        pluginName: 'other-ops',
        files: [
          {
            kind: 'skill',
            path: 'plugins/demo-ops/skills/docs-review/SKILL.md',
            sha256: null,
          },
        ],
      },
    },
    {
      name: 'v2 missing current plugin',
      manifest: {
        schemaVersion: 2,
        plugins: {
          'other-ops': {
            pluginVersion: '0.1.0',
            files: [
              {
                kind: 'skill',
                path: 'plugins/demo-ops/skills/docs-review/SKILL.md',
                sha256: null,
              },
            ],
          },
        },
      },
    },
  ];

  for (const { name, manifest } of cases) {
    const root = makeRoot();
    const skillPath = 'plugins/demo-ops/skills/docs-review/SKILL.md';
    const manualContent = `---
name: docs-review
description: User owned skill.
---

# User Owned
`;
    write(root, skillPath, manualContent);
    if (manifest) {
      writeJson(root, '.agent-trigger-kit/generated.json', manifest);
    }

    const result = runScript('init-project-trigger-layer.mjs', [
      '--root',
      root,
      '--plugin',
      'demo-ops',
      '--tasks',
      'docs-review',
      '--playbook',
      'docs/agent-playbooks/demo-ops.md',
      '--force',
    ]);

    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, /generated\.json|plugin|refusing overwrite/i, name);
    assert.equal(readFileSync(join(root, skillPath), 'utf8'), manualContent, name);
  }
});

test('init force leaves orphaned managed files on disk and removes them from generated manifest', () => {
  const root = makeRoot();
  const orphanSkill = 'plugins/demo-ops/skills/deploy-ops/SKILL.md';
  const orphanCommand = 'plugins/demo-ops/commands/deploy-ops.md';
  const first = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review,deploy-ops',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const second = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
    '--force',
  ]);

  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(existsSync(join(root, orphanSkill)), true);
  assert.equal(existsSync(join(root, orphanCommand)), true);
  const trackedPaths = generatedFiles(root).map((file) => file.path);
  assert.equal(trackedPaths.includes(orphanSkill), false);
  assert.equal(trackedPaths.includes(orphanCommand), false);
});

test('init without force still rejects existing generated target files', () => {
  const root = makeRoot();
  const first = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);
  assert.equal(first.status, 0, first.stderr || first.stdout);

  const second = runScript('init-project-trigger-layer.mjs', [
    '--root',
    root,
    '--plugin',
    'demo-ops',
    '--tasks',
    'docs-review',
    '--playbook',
    'docs/agent-playbooks/demo-ops.md',
  ]);

  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists; rerun with --force/);
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
  writeGeneratedManifestForDemoPlugin(root, pluginDir, pluginName, '0.2.0');

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
  assert.equal(readJson(root, '.agent-trigger-kit/generated.json').schemaVersion, 2);
  assert.equal(generatedPluginEntry(root, pluginName).pluginVersion, '0.2.0');
});

test('init ignores initial version when an existing plugin version is present', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.2.0' });
  writeValidSkillAndCommand(root, pluginDir);
  writeGeneratedManifestForDemoPlugin(root, pluginDir, pluginName, '0.2.0');

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
  assert.equal(generatedPluginEntry(root, pluginName).pluginVersion, '0.2.0');
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
  assert.doesNotMatch(result.stderr, /Error: existing manifest versions differ/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
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
  assert.equal(generatedPluginEntry(root).pluginVersion, '0.3.0');
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
  assert.equal(generatedPluginEntry(root).pluginVersion, '0.1.0');
});

test('init uses generated v2 fallback only for the current plugin entry', () => {
  const root = makeRoot();
  writeGeneratedManifestV2(root, {
    'other-ops': {
      pluginVersion: '0.9.0',
      playbook: 'docs/agent-playbooks/other-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
    'demo-ops': {
      pluginVersion: '0.3.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [],
    },
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
  assert.equal(readJson(root, '.agents/plugins/marketplace.json').plugins[0].version, '0.3.0');
  assert.equal(readJson(root, '.claude-plugin/marketplace.json').plugins[0].version, '0.3.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.codex-plugin/plugin.json').version, '0.3.0');
  assert.equal(readJson(root, 'plugins/demo-ops/.claude-plugin/plugin.json').version, '0.3.0');
  assert.equal(generatedPluginEntry(root, 'demo-ops').pluginVersion, '0.3.0');
  assert.equal(generatedPluginEntry(root, 'other-ops').pluginVersion, '0.9.0');
});

test('shared trigger layer generator consumes project trigger layer templates for generated wrappers', () => {
  const script = readFileSync(join(repoRoot, 'scripts/lib/trigger-layer.mjs'), 'utf8');

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

test('writeTriggerLayer omits playbook-first guidance by default', () => {
  const root = makeRoot();
  writeTriggerLayer({
    root,
    pluginName: 'demo-ops',
    tasks: ['docs-review'],
    playbook: 'docs/agent-playbooks/demo-ops.md',
  });

  const entry = generatedPluginEntry(root);
  assert.equal(Object.hasOwn(entry, 'playbookFirstGuidance'), false);

  const skill = readFileSync(join(root, 'plugins/demo-ops/skills/docs-review/SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /Project playbook is source of truth\./);
  assert.doesNotMatch(
    skill,
    /For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it\./,
  );

  const playbook = readFileSync(join(root, 'docs/agent-playbooks/demo-ops.md'), 'utf8');
  assert.doesNotMatch(playbook, /## Playbook-First Guidance/);
  assert.doesNotMatch(playbook, /\n{3,}## /);
});

test('writeTriggerLayer renders imported task descriptions as safe frontmatter scalars', () => {
  const root = makeRoot();
  const description = 'Review: docs # before release\nSecond line';
  writeTriggerLayer({
    root,
    pluginName: 'demo-ops',
    tasks: ['docs-review'],
    playbook: 'docs/agent-playbooks/demo-ops.md',
    cursorGlobs: ['docs/**'],
    taskDescriptions: new Map([['docs-review', description]]),
  });

  const expectedLine = 'description: "Review: docs # before release\\nSecond line"';
  for (const path of [
    'plugins/demo-ops/skills/docs-review/SKILL.md',
    'plugins/demo-ops/commands/docs-review.md',
    '.cursor/rules/docs-review.mdc',
  ]) {
    const text = readFileSync(join(root, path), 'utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    const escapedLine = expectedLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(frontmatter, new RegExp(`^${escapedLine}$`, 'm'));
    assert.doesNotMatch(frontmatter, /^Second line$/m);
  }

  const validate = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
});

test('writeTriggerLayer treats template markers in imported task descriptions as literal text', () => {
  const root = makeRoot();
  const description = 'Use {{taskName}} safely and {{globs}} literally';
  writeTriggerLayer({
    root,
    pluginName: 'demo-ops',
    tasks: ['docs-review'],
    playbook: 'docs/agent-playbooks/demo-ops.md',
    cursorGlobs: ['docs/**'],
    taskDescriptions: new Map([['docs-review', description]]),
  });

  const expectedLine = 'description: "Use {{taskName}} safely and {{globs}} literally"';
  for (const path of [
    'plugins/demo-ops/skills/docs-review/SKILL.md',
    'plugins/demo-ops/commands/docs-review.md',
    '.cursor/rules/docs-review.mdc',
  ]) {
    const text = readFileSync(join(root, path), 'utf8');
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
    const descriptionLine = frontmatter.match(/^description:.+$/m)?.[0] || '';
    const escapedLine = expectedLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(descriptionLine, new RegExp(`^${escapedLine}$`));
    assert.doesNotMatch(descriptionLine, /Use docs-review safely/);
    assert.doesNotMatch(descriptionLine, /docs\/\*\*/);
  }

  const validate = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(validate.status, 0, validate.stderr || validate.stdout);
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

test('validator fails when a v2 managed skill lacks a maintenance contract pointer', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  const skillPath = `${pluginDir}/skills/docs-review/SKILL.md`;
  writeValidSkillAndCommand(root, pluginDir);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: skillPath }],
    },
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

test('validator treats missing headerChecks as a no-op', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('validator reports non-array headerChecks as malformed config', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks: {},
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /\.agent-trigger-kit\/generated\.json \(demo-ops\): headerChecks must be an array when present/,
  );
});

test('validator reports configured missing document headers', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  write(root, 'docs/superpowers/plans/feature.md', '# Feature Plan\n\nBody.\n');
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks: [
          {
            name: 'superpowers-plan-lifecycle',
            globs: ['docs/superpowers/plans/*.md'],
            headerLines: 6,
            requirePattern: '^Status: ',
          },
        ],
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /MISSING header in docs\/superpowers\/plans\/feature\.md \(check: superpowers-plan-lifecycle\)/,
  );
});

test('validator accepts configured document headers and excludes legacy paths', () => {
  const root = makeRoot();
  createPackage(root);
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook\nStatus: Draft\n');
  write(root, 'docs/superpowers/plans/feature.md', '# Feature Plan\nStatus: Draft\n');
  write(root, 'docs/plans/legacy.md', '# Legacy Plan\n');
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 2,
    kitVersion: '0.1.9',
    templateVersion: 1,
    plugins: {
      'demo-ops': {
        pluginVersion: '0.1.0',
        playbook: 'docs/agent-playbooks/demo-ops.md',
        maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
        tasks: ['docs-review'],
        files: [],
        headerChecks: [
          {
            name: 'superpowers-plan-lifecycle',
            globs: ['docs/**/*.md'],
            headerLines: 6,
            requirePattern: '^Status: ',
            exclude: ['docs/plans/**'],
          },
        ],
      },
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('validator accepts old generated manifests without playbook-first flag', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root, { commands: false });
  const skillPath = `${pluginDir}/skills/docs-review/SKILL.md`;
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeManagedSkill(root, pluginDir);
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: skillPath }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator fails flagged generated skill missing playbook-first description signal', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root, { commands: false });
  const skillPath = `${pluginDir}/skills/docs-review/SKILL.md`;
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeGuidedSkill(root, pluginDir, 'docs-review', { description: 'Use for docs review work.' });
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      playbookFirstGuidance: { version: PLAYBOOK_FIRST_GUIDANCE.version },
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: skillPath }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stderr, /demo-ops/);
  assert.match(result.stderr, /missing playbook-first description signal/);
  assert.match(
    result.stderr,
    /restore the managed wrapper, manually add the missing playbook-first signal\/guidance, or remove the plugin playbookFirstGuidance flag to opt out/,
  );
});

test('validator fails flagged generated skill missing playbook-first checklist guidance', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root, { commands: false });
  const skillPath = `${pluginDir}/skills/docs-review/SKILL.md`;
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeGuidedSkill(root, pluginDir, 'docs-review', {
    guidance: 'Use the project playbook before generic helper guidance.',
  });
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      playbookFirstGuidance: { version: PLAYBOOK_FIRST_GUIDANCE.version },
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: skillPath }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.stderr, /demo-ops/);
  assert.match(result.stderr, /missing playbook-first checklist guidance/);
  assert.match(
    result.stderr,
    /restore the managed wrapper, manually add the missing playbook-first signal\/guidance, or remove the plugin playbookFirstGuidance flag to opt out/,
  );
});

test('validator does not duplicate missing frontmatter diagnostics for flagged generated skills', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root, { commands: false });
  const skillPath = `${pluginDir}/skills/docs-review/SKILL.md`;
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  write(
    root,
    skillPath,
    `# Docs Review

Maintenance contract: \`../../../../.agent-trigger-kit/MAINTENANCE.md\`

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      playbookFirstGuidance: { version: PLAYBOOK_FIRST_GUIDANCE.version },
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: skillPath }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((result.stderr.match(/missing frontmatter/g) || []).length, 1);
});

test('validator checks playbook-first guidance only for flagged plugins', () => {
  const root = makeRoot();
  const [flagged, unflagged] = createMinimalPlugins(root, ['demo-ops', 'other-ops']);
  mkdirSync(join(root, `${flagged.pluginDir}/commands`), { recursive: true });
  mkdirSync(join(root, `${unflagged.pluginDir}/commands`), { recursive: true });
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook');
  writeGuidedSkill(root, flagged.pluginDir);
  write(
    root,
    `${unflagged.pluginDir}/skills/ops-review/SKILL.md`,
    `---
name: ops-review
description: Use for ops review work.
---

# Ops Review

Maintenance contract: \`some/contract.md\`

## Must Read

- \`../../../../docs/agent-playbooks/demo-ops.md\`
`,
  );
  writeGeneratedManifestV2(root, {
    'demo-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      playbookFirstGuidance: { version: PLAYBOOK_FIRST_GUIDANCE.version },
      tasks: ['docs-review'],
      files: [{ kind: 'skill', path: `${flagged.pluginDir}/skills/docs-review/SKILL.md` }],
    },
    'other-ops': {
      pluginVersion: '0.1.0',
      playbook: 'docs/agent-playbooks/demo-ops.md',
      maintenanceContract: '.agent-trigger-kit/MAINTENANCE.md',
      tasks: ['ops-review'],
      files: [{ kind: 'skill', path: `${unflagged.pluginDir}/skills/ops-review/SKILL.md` }],
    },
  });

  const result = runScript('validate-trigger-layer.mjs', ['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump requires a base ref', () => {
  const root = makeRoot();
  const { pluginDir } = createMinimalPlugin(root);
  writeValidSkillAndCommand(root, pluginDir);
  writeJson(root, '.agent-trigger-kit/generated.json', {
    schemaVersion: 1,
    pluginName: 'demo-ops',
    files: [],
  });

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
  ]);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /--base/);
});

test('validator require-version-bump rejects managed skill changes without a version bump', () => {
  const root = makeRoot();
  const { skillPath } = createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, 'plugins/demo-ops', 'Changed generated skill body.');
  commitAll(root, 'change managed skill');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version bump/i);
  assert.match(result.stderr, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('validator require-version-bump accepts managed skill changes with aligned version bump', () => {
  const root = makeRoot();
  const { pluginDir } = createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  commitAll(root, 'change managed skill and bump version');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump infers the plugin from a single-plugin v2 manifest', () => {
  const root = makeRoot();
  const { pluginDir } = createVersionBumpFixtureV2(root);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  commitAll(root, 'change managed skill and bump version');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump requires --plugin for multi-plugin v2 manifests', () => {
  const root = makeRoot();
  const { pluginDir, skillPath } = createVersionBumpFixtureV2(root, {
    pluginNames: ['demo-ops', 'other-ops'],
  });
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  commitAll(root, 'change managed skill');

  const ambiguous = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /multiple plugins|--plugin/i);

  const selectedMatching = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
    '--plugin',
    'demo-ops',
  ]);
  assert.notEqual(selectedMatching.status, 0);
  assert.match(selectedMatching.stderr, /version bump/i);
  assert.match(
    selectedMatching.stderr,
    new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );

  const selectedOther = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
    '--plugin',
    'other-ops',
  ]);
  assert.equal(selectedOther.status, 0, selectedOther.stderr || selectedOther.stdout);
  assert.match(selectedOther.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump rejects stale matching package version', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createVersionBumpFixture(root);
  createPackage(root, '0.1.0', pluginName);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  commitAll(root, 'change managed skill and bump plugin surfaces');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot determine plugin version|version bump/i);
  assert.match(result.stderr, /package\.json|aligned plugin version/i);
});

test('validator require-version-bump rejects stale scoped matching package version', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createVersionBumpFixture(root);
  createPackage(root, '0.1.0', `@acme/${pluginName}`);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  commitAll(root, 'change managed skill and bump plugin surfaces');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot determine plugin version|version bump/i);
  assert.match(result.stderr, /package\.json|aligned plugin version/i);
});

test('validator require-version-bump ignores stale unrelated package version', () => {
  const root = makeRoot();
  const { pluginDir } = createVersionBumpFixture(root);
  createPackage(root, '0.1.0', 'external-project');
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  commitAll(root, 'change managed skill and bump plugin surfaces');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump accepts matching package version aligned with plugin surfaces', () => {
  const root = makeRoot();
  const { pluginDir, pluginName } = createVersionBumpFixture(root);
  createPackage(root, '0.1.0', pluginName);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  const packageJson = readJson(root, 'package.json');
  packageJson.version = '0.1.1';
  writeJson(root, 'package.json', packageJson);
  commitAll(root, 'change managed skill and bump aligned versions');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump rejects managed skill changes when a required manifest version is missing', () => {
  const root = makeRoot();
  const { pluginDir } = createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  rmSync(join(root, `${pluginDir}/.codex-plugin/plugin.json`), { force: true });
  commitAll(root, 'change managed skill and remove codex manifest');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot determine plugin version/i);
  assert.match(result.stderr, /missing.*codex plugin manifest.*version/i);
});

test('validator require-version-bump rejects managed skill changes with a lower aligned version', () => {
  const root = makeRoot();
  const { pluginDir } = createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir, '0.0.9');
  commitAll(root, 'change managed skill and lower version');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version bump/i);
  assert.match(result.stderr, /greater than/i);
});

test('validator require-version-bump rejects deleting a previously managed plugin-visible file without a version bump', () => {
  const root = makeRoot();
  const { pluginDir, skillPath } = createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  rmSync(join(root, `${pluginDir}/skills/docs-review`), { recursive: true, force: true });
  rmSync(join(root, `${pluginDir}/commands/docs-review.md`), { force: true });
  const generated = readJson(root, '.agent-trigger-kit/generated.json');
  generated.files = [];
  writeJson(root, '.agent-trigger-kit/generated.json', generated);
  commitAll(root, 'remove managed skill from generated files');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version bump/i);
  assert.match(result.stderr, new RegExp(skillPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('validator require-version-bump ignores cursor playbook maintenance and generated changes', () => {
  const root = makeRoot();
  createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  write(
    root,
    '.cursor/rules/docs-review.mdc',
    `---
description: Use for docs review work.
globs: docs/**
---

See \`docs/agent-playbooks/demo-ops.md\`.
`,
  );
  write(root, 'docs/agent-playbooks/demo-ops.md', '# Demo Ops Playbook\n\nChanged playbook.');
  write(root, '.agent-trigger-kit/MAINTENANCE.md', '# Maintenance\n\nChanged contract.');
  const generated = readJson(root, '.agent-trigger-kit/generated.json');
  generated.note = 'changed generated manifest';
  writeJson(root, '.agent-trigger-kit/generated.json', generated);
  commitAll(root, 'change non-plugin-visible generated files');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump ignores unrelated marketplace plugin entry changes', () => {
  const root = makeRoot();
  createVersionBumpFixture(root, { pluginNames: ['demo-ops', 'other-ops'] });
  const base = commitAll(root, 'base trigger layer');
  const codexMarketplace = readJson(root, '.agents/plugins/marketplace.json');
  codexMarketplace.plugins.find((plugin) => plugin.name === 'other-ops').description =
    'Changed unrelated trigger skills';
  writeJson(root, '.agents/plugins/marketplace.json', codexMarketplace);
  const claudeMarketplace = readJson(root, '.claude-plugin/marketplace.json');
  claudeMarketplace.plugins.find((plugin) => plugin.name === 'other-ops').description =
    'Changed unrelated trigger skills';
  writeJson(root, '.claude-plugin/marketplace.json', claudeMarketplace);
  commitAll(root, 'change unrelated marketplace entry');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump rejects matching marketplace entry changes without version bump', () => {
  const root = makeRoot();
  createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  const codexMarketplace = readJson(root, '.agents/plugins/marketplace.json');
  codexMarketplace.plugins.find((plugin) => plugin.name === 'demo-ops').description =
    'Changed demo trigger skills';
  writeJson(root, '.agents/plugins/marketplace.json', codexMarketplace);
  commitAll(root, 'change matching marketplace entry');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /version bump/i);
  assert.match(result.stderr, /\.agents\/plugins\/marketplace\.json/);
});

test('validator require-version-bump accepts matching marketplace version change with aligned manifests', () => {
  const root = makeRoot();
  const { pluginDir } = createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  bumpDemoPluginVersion(root, pluginDir);
  commitAll(root, 'bump matching marketplace entry');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
});

test('validator require-version-bump fails explicitly when git is unavailable', () => {
  const root = makeRoot();
  createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  const emptyPath = makeRoot();

  const result = runScript(
    'validate-trigger-layer.mjs',
    ['--root', root, '--require-version-bump', '--base', base],
    {
      env: { ...process.env, PATH: emptyPath },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git/i);
});

test('validator require-version-bump explains unavailable base refs', () => {
  const root = makeRoot();
  createVersionBumpFixture(root);
  commitAll(root, 'base trigger layer');

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    'missing-base-ref',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git fetch --unshallow|fetch-depth: 0/);
});

test('validator require-version-bump works from detached HEAD', () => {
  const root = makeRoot();
  const { pluginDir } = createVersionBumpFixture(root);
  const base = commitAll(root, 'base trigger layer');
  writeManagedSkill(root, pluginDir, 'Changed generated skill body.');
  bumpDemoPluginVersion(root, pluginDir);
  const head = commitAll(root, 'change managed skill and bump version');
  const checkout = runGit(root, ['checkout', '--detach', head]);
  assert.equal(checkout.status, 0, checkout.stderr || checkout.stdout);

  const result = runScript('validate-trigger-layer.mjs', [
    '--root',
    root,
    '--require-version-bump',
    '--base',
    base,
  ]);

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
  const claudeHome = join(makeRoot(), 'missing-claude-home');
  createPackage(root, '5.8.0');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');

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

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /expected source version: 0\.1\.2/);
  assert.doesNotMatch(result.stdout, /package\.json:/);
  assert.match(result.stdout, /codex marketplace: 0\.1\.2/);
  assert.match(result.stdout, /claude plugin: 0\.1\.2/);
  assert.match(result.stdout, /codex cache versions: 0\.1\.1, 0\.1\.2/);
  assert.match(result.stdout, /codex cache expected version: present/);
  assert.match(result.stdout, /claude: not initialized/);
});

test('version check emits structured JSON when requested', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = join(makeRoot(), 'missing-claude-home');
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache');

  const result = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--codex-home', codexHome, '--claude-home', claudeHome, '--json', pluginName],
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
  assert.equal(payload.claude.status, 'not-initialized');
  assert.equal(payload.claude.cli.status, 'not-initialized');
  assert.equal(Array.isArray(payload.actions), true);
  assert.equal(payload.versionMismatch, true);
});

test('version check usage mentions Claude home option', () => {
  const result = runScript('check-plugin-version.mjs', []);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--claude-home <path>/);
});

test('version check uses official Claude CLI when available', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = join(makeRoot(), 'missing-claude-home');
  const fakeBin = makeRoot();
  const fakeClaude = join(fakeBin, 'claude');
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
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
      '--claude-home',
      claudeHome,
      '--surface',
      'claude',
      '--json',
      pluginName,
    ],
    {
      env: { ...process.env, PATH: fakeBin },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(readFileSync(commandLog, 'utf8'), /claude plugin list --json/);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.claude.status, 'present');
  assert.equal(payload.claude.cli.status, 'available');
  assert.equal(payload.claude.cli.path, fakeClaude);
  assert.equal(payload.versionMismatch, false);
  assert.equal(Array.isArray(payload.actions), true);
});

test('version check falls back to Claude metadata when CLI is unavailable', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/skills/docs-review/SKILL.md', '# Docs');
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
    enabledPlugins: {
      'demo-ops@demo-ops': true,
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
    {
      env: { ...process.env, PATH: '' },
    },
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
      'other@other': [
        {
          scope: 'user',
          installPath: join(claudeHome, 'plugins/cache/other/other/1.0.0'),
          version: '1.0.0',
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
    {
      env: { ...process.env, PATH: '' },
    },
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
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.claude.entries[0].installPathExists, true);
  assert.equal(payload.claude.entries[0].installPathHasFiles, false);
  assert.equal(payload.versionMismatch, true);
});

test('version check strict mode fails when Claude expected install is orphaned', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/.orphaned_at', '2026-05-21');
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
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.claude.entries[0].warnings.includes('orphaned'), true);
  assert.equal(payload.claude.entries[0].usableExpectedInstall, false);
  assert.equal(payload.versionMismatch, true);
  assert.equal(
    payload.actions.some(
      (action) =>
        action.reason === 'repair-orphaned-claude-install' && action.command?.includes('uninstall'),
    ),
    true,
  );
  assert.equal(
    payload.actions.some(
      (action) =>
        action.reason === 'repair-orphaned-claude-install' && action.command?.includes('install'),
    ),
    true,
  );
});

test('version check emits well-formed Claude action entries', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {},
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
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.actions[0], {
    surface: 'claude',
    kind: 'command',
    command: ['claude', 'plugin', 'marketplace', 'update', 'demo-ops'],
    reason: 'refresh-claude-marketplace',
    requiresCli: 'claude',
  });
  assert.equal('actions' in payload.claude, false);
});

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
  assert.deepEqual(state.marketplace.warnings, ['marketplace-missing']);
  assert.deepEqual(state.actions, [
    {
      surface: 'claude',
      kind: 'manual',
      message: 'Add the demo-ops Claude marketplace before updating demo-ops@demo-ops.',
      reason: 'claude-marketplace-missing',
      requiresCli: 'claude',
    },
  ]);
});

test('plugin state probe reports nonexistent Claude home as not initialized CLI state', async () => {
  const claudeHome = join(makeRoot(), 'missing-claude-home');

  const { probeClaudeState } = await import('../scripts/lib/plugin-state-probe.mjs');
  const state = probeClaudeState({
    claudeHome,
    envPath: '',
    expectedVersion: '0.1.2',
    marketplaceName: 'demo-ops',
    pluginName: 'demo-ops',
  });

  assert.equal(state.status, 'not-initialized');
  assert.equal(state.cli.status, 'not-initialized');
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

test('plugin state probe recommends Claude update for known user-scope marketplace installs', async () => {
  const claudeHome = makeRoot();
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
          version: '0.1.2',
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

  assert.deepEqual(state.actions, [
    {
      surface: 'claude',
      kind: 'command',
      command: ['claude', 'plugin', 'marketplace', 'update', 'demo-ops'],
      reason: 'refresh-claude-marketplace',
      requiresCli: 'claude',
    },
    {
      surface: 'claude',
      kind: 'command',
      command: ['claude', 'plugin', 'update', 'demo-ops@demo-ops', '--scope', 'user'],
      reason: 'update-claude-plugin',
      requiresCli: 'claude',
    },
  ]);
});

test('plugin state probe recommends Claude install for known marketplace without user scope', async () => {
  const claudeHome = makeRoot();
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/known_marketplaces.json', {
    'demo-ops': {
      source: { source: 'git', url: 'https://example.invalid/demo-ops.git' },
      installLocation: join(claudeHome, 'plugins/marketplaces/demo-ops'),
    },
  });
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'project',
          projectPath: '/tmp/demo-project',
          installPath: join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'),
          version: '0.1.2',
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

  assert.deepEqual(state.actions[1], {
    surface: 'claude',
    kind: 'command',
    command: ['claude', 'plugin', 'install', 'demo-ops@demo-ops', '--scope', 'user'],
    reason: 'install-claude-plugin',
    requiresCli: 'claude',
  });
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
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');

  const { probeCodexCache } = await import('../scripts/lib/plugin-state-probe.mjs');
  const cache = probeCodexCache({
    codexHome,
    marketplaceName: 'demo-ops',
    pluginName: 'demo-ops',
    expectedVersion: '0.1.2',
  });

  assert.deepEqual(cache.versions, ['0.1.1', '0.1.2']);
  assert.equal(cache.hasExpected, true);
  assert.equal(cache.status, 'present');
});

test('plugin state probe separates Claude marketplace dirty state from installed commit state', async () => {
  const claudeHome = makeRoot();
  const marketplace = join(claudeHome, 'plugins/marketplaces/demo-ops');
  mkdirSync(marketplace, { recursive: true });
  initGitFixture(marketplace);
  write(marketplace, 'README.md', 'clean');
  const headSha = commitAll(marketplace, 'initial');
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

  assert.equal(state.marketplace.status, 'present');
  assert.equal(state.marketplace.known, true);
  assert.equal(state.marketplace.headSha, headSha);
  assert.equal(state.marketplace.dirtyFiles.includes(' M README.md'), true);
  assert.equal(state.marketplace.headDiffersFromInstalledSha, true);
  assert.equal(state.marketplace.warnings.includes('dirty-clone'), true);
  assert.equal(state.marketplace.warnings.includes('head-differs-from-installed-sha'), true);
});

test('plugin state probe reports untracked marketplace files as dirty clone state', async () => {
  const claudeHome = makeRoot();
  const marketplace = join(claudeHome, 'plugins/marketplaces/demo-ops');
  mkdirSync(marketplace, { recursive: true });
  initGitFixture(marketplace);
  write(marketplace, 'README.md', 'clean');
  commitAll(marketplace, 'initial');
  write(marketplace, 'NEW.md', 'untracked');
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

  assert.equal(state.marketplace.dirtyFiles.includes('?? NEW.md'), true);
  assert.equal(state.marketplace.warnings.includes('dirty-clone'), true);
});

test('plugin state probe treats any installed SHA matching marketplace HEAD as not divergent', async () => {
  const claudeHome = makeRoot();
  const marketplace = join(claudeHome, 'plugins/marketplaces/demo-ops');
  mkdirSync(marketplace, { recursive: true });
  initGitFixture(marketplace);
  write(marketplace, 'README.md', 'clean');
  const headSha = commitAll(marketplace, 'initial');
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
          scope: 'project',
          projectPath: '/tmp/demo-project',
          installPath: join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.1'),
          version: '0.1.1',
          gitCommitSha: 'old-installed-sha',
        },
        {
          scope: 'user',
          installPath: join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'),
          version: '0.1.2',
          gitCommitSha: headSha,
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
  assert.equal(state.marketplace.headDiffersFromInstalledSha, false);
  assert.equal(state.marketplace.warnings.includes('head-differs-from-installed-sha'), false);
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
  const claudeHome = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache only');
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
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
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.codexCache.status, 'skipped');
  assert.equal(payload.claude.status, 'cli-unavailable-metadata-present');
  assert.equal(payload.versionMismatch, false);
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
      '--claude-home',
      join(makeRoot(), 'missing-claude-home'),
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
    [
      '--root',
      root,
      '--codex-home',
      codexHome,
      '--claude-home',
      join(makeRoot(), 'missing-claude-home'),
      '--surface',
      'source',
      pluginName,
    ],
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

  const result = runScript(
    'check-plugin-version.mjs',
    ['--root', root, '--claude-home', join(makeRoot(), 'missing-claude-home'), pluginName],
    {
      env: { ...process.env, PATH: '' },
    },
  );

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
    [
      '--root',
      root,
      '--claude-home',
      join(makeRoot(), 'missing-claude-home'),
      '--surface',
      'source',
      '--json',
      pluginName,
    ],
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
    [
      '--root',
      root,
      '--claude-home',
      join(makeRoot(), 'missing-claude-home'),
      '--surface',
      'source',
      '--json',
      '--no-include-package',
      pluginName,
    ],
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
    [
      '--root',
      root,
      '--claude-home',
      join(makeRoot(), 'missing-claude-home'),
      '--surface',
      'source',
      '--include-package',
      pluginName,
    ],
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

test('bump plugin version --next patch updates matching package and all plugin surfaces', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readPluginVersionSources(root, pluginName), {
    package: '0.1.3',
    codexMarketplace: '0.1.3',
    claudeMarketplace: '0.1.3',
    codexManifest: '0.1.3',
    claudeManifest: '0.1.3',
  });
});

test('bump plugin version --next patch skips matching package when explicitly excluded', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
    '--no-include-package',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readPluginVersionSources(root, pluginName), {
    package: '0.1.2',
    codexMarketplace: '0.1.3',
    claudeMarketplace: '0.1.3',
    codexManifest: '0.1.3',
    claudeManifest: '0.1.3',
  });
});

test('bump plugin version --next patch updates unrelated package when explicitly included', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-trigger-kit');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
    '--include-package',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readPluginVersionSources(root, pluginName), {
    package: '0.1.3',
    codexMarketplace: '0.1.3',
    claudeMarketplace: '0.1.3',
    codexManifest: '0.1.3',
    claudeManifest: '0.1.3',
  });
});

test('bump plugin version --next minor resets patch version', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', '@acme/demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'minor',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readPluginVersionSources(root, pluginName), {
    package: '0.2.0',
    codexMarketplace: '0.2.0',
    claudeMarketplace: '0.2.0',
    codexManifest: '0.2.0',
    claudeManifest: '0.2.0',
  });
});

test('bump plugin version --next major resets minor and patch versions', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'major',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readPluginVersionSources(root, pluginName), {
    package: '1.0.0',
    codexMarketplace: '1.0.0',
    claudeMarketplace: '1.0.0',
    codexManifest: '1.0.0',
    claudeManifest: '1.0.0',
  });
});

test('bump plugin version --next rejects partial surfaces before writing files', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const before = readPluginVersionSources(root, pluginName);

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
    '--surface',
    'codex',
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--next requires --surface all/);
  assert.deepEqual(readPluginVersionSources(root, pluginName), before);
});

test('bump plugin version --next rejects non-clean current semver before writing files', () => {
  const root = makeRoot();
  createPackage(root, '0.1.0-rc.1', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.0-rc.1' });
  const before = readPluginVersionSources(root, pluginName);

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /clean semver|0\.1\.0-rc\.1/);
  assert.deepEqual(readPluginVersionSources(root, pluginName), before);
});

test('bump plugin version --next rejects differing source versions before writing files', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const claudeManifest = readJson(root, `plugins/${pluginName}/.claude-plugin/plugin.json`);
  claudeManifest.version = '0.1.3';
  writeJson(root, `plugins/${pluginName}/.claude-plugin/plugin.json`, claudeManifest);
  const before = readPluginVersionSources(root, pluginName);

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source versions differ|aligned source version/);
  assert.deepEqual(readPluginVersionSources(root, pluginName), before);
});

test('bump plugin version --next rejects differing explicitly included package before writing files', () => {
  const root = makeRoot();
  createPackage(root, '5.8.0', 'demo-trigger-kit');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const before = readPluginVersionSources(root, pluginName);

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
    '--include-package',
  ]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source versions differ|aligned source version/);
  assert.deepEqual(readPluginVersionSources(root, pluginName), before);
});

test('bump plugin version --next leaves unrelated package versions unchanged', () => {
  const root = makeRoot();
  createPackage(root, '5.8.0', 'demo-trigger-kit');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'patch',
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readPluginVersionSources(root, pluginName), {
    package: '5.8.0',
    codexMarketplace: '0.1.3',
    claudeMarketplace: '0.1.3',
    codexManifest: '0.1.3',
    claudeManifest: '0.1.3',
  });
});

test('bump plugin version --next rejects invalid increments', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const before = readPluginVersionSources(root, pluginName);

  const result = runScript('bump-plugin-version.mjs', [
    '--root',
    root,
    '--plugin',
    pluginName,
    '--next',
    'invalid',
  ]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--next must be patch, minor, or major/);
  assert.deepEqual(readPluginVersionSources(root, pluginName), before);
});

test('bump plugin version requires --version or --next', () => {
  const root = makeRoot();
  createPackage(root, '0.1.2', 'demo-ops');
  const { pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  const before = readPluginVersionSources(root, pluginName);

  const result = runScript('bump-plugin-version.mjs', ['--root', root, '--plugin', pluginName]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--version or --next/);
  assert.deepEqual(readPluginVersionSources(root, pluginName), before);
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

test('agent-trigger-kit exposes trigger-layer clean command', () => {
  const commandPath = join(repoRoot, 'plugins/agent-trigger-kit/commands/trigger-layer-clean.md');

  assert.equal(existsSync(commandPath), true);

  const commandText = readFileSync(commandPath, 'utf8');

  assert.match(commandText, /agent-trigger-kit:cross-agent-trigger-layer/);
  assert.match(commandText, /agent-trigger-kit clean/);
  assert.match(commandText, /--plugin/);
  assert.match(commandText, /--apply/);
});

test('local agent trigger refresh syncs stale Codex cache and updates Claude when available', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  write(root, `${pluginDir}/fresh.txt`, 'fresh local plugin snapshot');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/old.txt', 'stale same-version cache');
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
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
  assert.deepEqual(log.trim().split('\n'), [
    `claude plugin validate ${root}`,
    `claude plugin validate ${join(root, pluginDir)}`,
    'claude plugin marketplace update demo-ops',
    'claude plugin update demo-ops@demo-ops --scope user',
    'claude plugin list --json',
  ]);
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
  const claudeHome = makeRoot();
  const fakeBin = makeRoot();
  const commandLog = join(fakeBin, 'commands.log');
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  write(root, `${pluginDir}/fresh.txt`, 'fresh local plugin snapshot');
  write(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.1/old.txt', 'old cache only');
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
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
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2"}]\\n'
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
  assert.match(script, /'--claude-home'/);
  assert.doesNotMatch(script, /codex cache expected version/);
});

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
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
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
  const metadataPath = join(claudeHome, 'plugins/installed_plugins.json');
  const beforeMetadata = readFileSync(metadataPath, 'utf8');

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
    {
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /claude: CLI unavailable; reporting filesystem metadata only/);
  assert.match(result.stdout, /claude plugin marketplace update demo-ops/);
  assert.equal(readFileSync(metadataPath, 'utf8'), beforeMetadata);
});

test('local agent trigger refresh fails when probed Claude CLI cannot be spawned', () => {
  const root = makeRoot();
  const codexHome = makeRoot();
  const claudeHome = makeRoot();
  const fakeBin = makeRoot();
  createPackage(root, '0.1.2');
  const { pluginDir, pluginName } = createMinimalPlugin(root, { version: '0.1.2' });
  writeValidSkillAndCommand(root, pluginDir);
  cpSync(join(root, pluginDir), join(codexHome, 'plugins/cache/demo-ops/demo-ops/0.1.2'), {
    recursive: true,
  });
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
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
    `#!/path/to/nonexistent/claude-interpreter
exit 0
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
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}\n${result.stdout}`, /claude plugin validate .*failed to start/);
});

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
  const installPath = join(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2');
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'project',
          projectPath: root,
          installPath,
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
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const log = readFileSync(commandLog, 'utf8');
  assert.match(log, /claude plugin install demo-ops@demo-ops --scope user/);
  assert.doesNotMatch(log, /claude plugin update demo-ops@demo-ops --scope local/);
});

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
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  write(
    claudeHome,
    'plugins/cache/demo-ops/demo-ops/0.1.2/.orphaned_at',
    '2026-05-21T00:00:00.000Z',
  );
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/.in_use/12345', 'running');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
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
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /orphaned/);
  assert.match(result.stdout, /in-use/);
  const log = readFileSync(commandLog, 'utf8');
  assert.match(log, /claude plugin uninstall demo-ops@demo-ops --scope user/);
  assert.match(log, /claude plugin install demo-ops@demo-ops --scope user/);
});

test('local agent trigger refresh skips Codex prompt debug when requested after validation', () => {
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
  write(claudeHome, 'plugins/cache/demo-ops/demo-ops/0.1.2/current.txt', 'current cache');
  writeJson(claudeHome, 'plugins/installed_plugins.json', {
    version: 2,
    plugins: {
      'demo-ops@demo-ops': [
        {
          scope: 'user',
          installPath,
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
  printf '[{"id":"demo-ops@demo-ops","version":"0.1.2"}]\\n'
fi
`,
  );
  writeExecutable(
    fakeBin,
    'codex',
    `#!/bin/sh
printf 'codex should not be called\\n' >> "${commandLog}"
exit 41
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
    {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /trigger layer validation passed/);
  assert.match(result.stdout, /codex: skipped prompt-input verification/);
  assert.doesNotMatch(readFileSync(commandLog, 'utf8'), /codex/);
});
