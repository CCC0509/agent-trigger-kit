import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  isSourceVisiblePath,
  sourceVisibleChangedFiles,
} from '../scripts/lib/source-plugin-visible.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-premerge-test-'));
}

function runScript(scriptName, args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', scriptName), ...args], {
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

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function writeJson(root, path, value) {
  write(root, path, JSON.stringify(value, null, 2));
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
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

function createSourceFixture(root, version = '0.1.0') {
  writeJson(root, 'package.json', {
    name: 'agent-trigger-kit',
    version,
    private: true,
    type: 'module',
    scripts: {
      'ops:plugin-version-check': 'node scripts/check-plugin-version.mjs',
    },
  });
  writeJson(root, 'package-lock.json', {
    name: 'agent-trigger-kit',
    version,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'agent-trigger-kit',
        version,
      },
    },
  });
  writeJson(root, '.agents/plugins/marketplace.json', {
    name: 'agent-trigger-kit',
    plugins: [
      {
        name: 'agent-trigger-kit',
        version,
        source: { source: 'local', path: './plugins/agent-trigger-kit' },
      },
    ],
  });
  writeJson(root, '.claude-plugin/marketplace.json', {
    name: 'agent-trigger-kit',
    plugins: [
      {
        name: 'agent-trigger-kit',
        version,
        source: './plugins/agent-trigger-kit',
      },
    ],
  });
  writeJson(root, 'plugins/agent-trigger-kit/.codex-plugin/plugin.json', {
    name: 'agent-trigger-kit',
    version,
  });
  writeJson(root, 'plugins/agent-trigger-kit/.claude-plugin/plugin.json', {
    name: 'agent-trigger-kit',
    version,
  });
  write(root, 'CHANGELOG.md', `# Changelog\n\n## ${version}\n\n- Initial fixture.`);
}

function bumpSourceFixture(root, version) {
  const packageJson = readJson(root, 'package.json');
  packageJson.version = version;
  writeJson(root, 'package.json', packageJson);

  const packageLock = readJson(root, 'package-lock.json');
  packageLock.version = version;
  packageLock.packages[''].version = version;
  writeJson(root, 'package-lock.json', packageLock);

  const codexMarketplace = readJson(root, '.agents/plugins/marketplace.json');
  codexMarketplace.plugins[0].version = version;
  writeJson(root, '.agents/plugins/marketplace.json', codexMarketplace);

  const claudeMarketplace = readJson(root, '.claude-plugin/marketplace.json');
  claudeMarketplace.plugins[0].version = version;
  writeJson(root, '.claude-plugin/marketplace.json', claudeMarketplace);

  const codexManifest = readJson(root, 'plugins/agent-trigger-kit/.codex-plugin/plugin.json');
  codexManifest.version = version;
  writeJson(root, 'plugins/agent-trigger-kit/.codex-plugin/plugin.json', codexManifest);

  const claudeManifest = readJson(root, 'plugins/agent-trigger-kit/.claude-plugin/plugin.json');
  claudeManifest.version = version;
  writeJson(root, 'plugins/agent-trigger-kit/.claude-plugin/plugin.json', claudeManifest);
}

function writeChangelog(root, text) {
  write(root, 'CHANGELOG.md', text);
}

function runPremerge(root, args = []) {
  return runScript('premerge-version-check.mjs', ['--root', root, ...args]);
}

function runPremergeJson(root, args = []) {
  const result = runPremerge(root, [...args, '--json']);
  return {
    result,
    json: result.stdout ? JSON.parse(result.stdout) : null,
  };
}

test('source visible path rules classify Agent Trigger Kit release surfaces', () => {
  assert.equal(isSourceVisiblePath('.agents/plugins/marketplace.json'), true);
  assert.equal(isSourceVisiblePath('.claude-plugin/marketplace.json'), true);
  assert.equal(isSourceVisiblePath('package.json'), true);
  assert.equal(isSourceVisiblePath('package-lock.json'), true);
  assert.equal(isSourceVisiblePath('plugins/agent-trigger-kit/skills/version-check/SKILL.md'), true);
  assert.equal(isSourceVisiblePath('scripts/premerge-version-check.mjs'), true);
  assert.equal(isSourceVisiblePath('templates/project-trigger-layer/skill/SKILL.md.template'), true);

  assert.equal(isSourceVisiblePath('README.md'), false);
  assert.equal(isSourceVisiblePath('CONTRIBUTING.md'), false);
  assert.equal(isSourceVisiblePath('tests/premerge-version-check.test.mjs'), false);
  assert.equal(isSourceVisiblePath('docs/designs/2026-05-22-example.md'), false);
});

test('source visible changed files returns only matching paths', () => {
  assert.deepEqual(
    sourceVisibleChangedFiles([
      'README.md',
      './package-lock.json',
      'plugins/agent-trigger-kit/commands/trigger-layer-init.md',
      'tests/premerge-version-check.test.mjs',
    ]),
    ['package-lock.json', 'plugins/agent-trigger-kit/commands/trigger-layer-init.md'],
  );
});

test('premerge version check requires an explicit base', () => {
  const root = makeRoot();
  initGitFixture(root);
  createSourceFixture(root);

  const result = runPremerge(root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /--base is required/);
  assert.match(result.stderr, /origin\/main/);
});

test('premerge version check passes a clean source repo reconciled with base', () => {
  const root = makeRoot();
  initGitFixture(root);
  createSourceFixture(root);
  const base = commitAll(root, 'base source fixture');

  const { result, json } = runPremergeJson(root, ['--base', base]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(json.overallStatus, 'passed');
  assert.equal(json.exitReason, null);
  assert.deepEqual(
    Object.fromEntries(json.checks.map((check) => [check.name, check.status])),
    {
      'source-version-consistency': 'passed',
      'base-reconciliation': 'passed',
      'changelog-head-alignment': 'passed',
      'plugin-visible-version-bump': 'passed',
    },
  );
});

test('premerge version check rejects malformed changelog heads', () => {
  const cases = [
    {
      name: 'missing changelog',
      writeCase(root) {
        createSourceFixture(root);
        rmSync(join(root, 'CHANGELOG.md'), { force: true });
      },
      pattern: /CHANGELOG\.md is missing/,
    },
    {
      name: 'no second-level heading',
      writeCase(root) {
        createSourceFixture(root);
        writeChangelog(root, '# Changelog\n\nNo releases yet.');
      },
      pattern: /no release heading/i,
    },
    {
      name: 'unreleased heading',
      writeCase(root) {
        createSourceFixture(root);
        writeChangelog(root, '# Changelog\n\n## Unreleased\n\n- Draft.');
      },
      pattern: /Unreleased/i,
    },
    {
      name: 'non semver heading',
      writeCase(root) {
        createSourceFixture(root);
        writeChangelog(root, '# Changelog\n\n## Next\n\n- Draft.');
      },
      pattern: /clean SemVer/i,
    },
    {
      name: 'version mismatch',
      writeCase(root) {
        createSourceFixture(root, '0.1.0');
        writeChangelog(root, '# Changelog\n\n## 0.1.1\n\n- Wrong head.');
      },
      pattern: /does not match source version 0\.1\.0/,
    },
  ];

  for (const testCase of cases) {
    const root = makeRoot();
    initGitFixture(root);
    testCase.writeCase(root);
    const base = commitAll(root, testCase.name);

    const { result, json } = runPremergeJson(root, ['--base', base]);

    assert.equal(result.status, 1, `${testCase.name} unexpectedly passed`);
    assert.equal(json.exitReason, 'changelog-head-alignment');
    assert.equal(
      json.checks.find((check) => check.name === 'changelog-head-alignment').status,
      'failed',
    );
    assert.match(result.stderr || JSON.stringify(json), testCase.pattern);
  }
});

test('premerge version check skips dependent checks when prerequisites fail', () => {
  const root = makeRoot();
  initGitFixture(root);
  createSourceFixture(root);
  const codexMarketplace = readJson(root, '.agents/plugins/marketplace.json');
  codexMarketplace.plugins[0].version = '0.1.1';
  writeJson(root, '.agents/plugins/marketplace.json', codexMarketplace);
  commitAll(root, 'misalign source versions');

  const { result, json } = runPremergeJson(root, ['--base', 'missing-base']);

  assert.equal(result.status, 1);
  assert.equal(json.overallStatus, 'failed');
  assert.equal(json.exitReason, 'source-version-consistency');
  assert.equal(
    json.checks.find((check) => check.name === 'source-version-consistency').status,
    'failed',
  );
  assert.equal(json.checks.find((check) => check.name === 'base-reconciliation').status, 'failed');
  assert.equal(
    json.checks.find((check) => check.name === 'changelog-head-alignment').status,
    'skipped',
  );
  assert.equal(
    json.checks.find((check) => check.name === 'plugin-visible-version-bump').status,
    'skipped',
  );
});

test('premerge version check reports base failure before bump checks', () => {
  const root = makeRoot();
  initGitFixture(root);
  createSourceFixture(root);
  commitAll(root, 'base source fixture');

  const { result, json } = runPremergeJson(root, ['--base', 'missing-base']);

  assert.equal(result.status, 1);
  assert.equal(json.exitReason, 'base-reconciliation');
  assert.equal(json.checks.find((check) => check.name === 'base-reconciliation').status, 'failed');
  assert.equal(
    json.checks.find((check) => check.name === 'plugin-visible-version-bump').status,
    'skipped',
  );
});
