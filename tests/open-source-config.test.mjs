import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parse as parseYaml } from 'yaml';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function readCiWorkflow() {
  return parseYaml(read('.github/workflows/ci.yml'));
}

function parseChangelogPatchVersions(changelog) {
  return [...changelog.matchAll(/^## (\d+)\.(\d+)\.(\d+)(?:\b|$)/gm)].map((match) => ({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }));
}

function versionLabel(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function assertNoPatchVersionGaps(versions) {
  for (let index = 0; index < versions.length - 1; index += 1) {
    const current = versions[index];
    const next = versions[index + 1];
    if (current.major !== next.major || current.minor !== next.minor) continue;

    assert.equal(
      next.patch,
      current.patch - 1,
      `changelog jumps from ${versionLabel(current)} to ${versionLabel(next)}; missing ${current.major}.${current.minor}.${current.patch - 1}`,
    );
  }
}

test('ci runs the quality gate on Ubuntu and macOS with a pinned Claude CLI', () => {
  const ci = read('.github/workflows/ci.yml');
  const workflow = readCiWorkflow();
  const validateRuns = workflow.jobs.validate.steps.map((step) => step.run).filter(Boolean);

  assert.match(ci, /matrix:/);
  assert.match(ci, /ubuntu-latest/);
  assert.match(ci, /macos-latest/);
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm run format:check/);
  assert.equal(validateRuns.includes('npm run check:scratch-namespace'), true);
  assert.match(ci, /@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
  assert.doesNotMatch(ci, /npm install -g @anthropic-ai\/claude-code\s*$/m);
});

test('package exposes lint format and preflight tooling with locked dev dependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));

  assert.equal(existsSync(join(repoRoot, 'package-lock.json')), true);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages?.['']?.version, pkg.version);
  assert.equal(pkg.scripts.lint, 'eslint .');
  assert.equal(pkg.scripts.format, 'prettier --write .');
  assert.equal(pkg.scripts['format:check'], 'prettier --check .');
  assert.equal(pkg.scripts['check:scratch-namespace'], 'node scripts/check-scratch-namespace.mjs');
  assert.equal(pkg.scripts.validate, 'node scripts/validate-trigger-layer.mjs --root .');
  assert.equal(
    pkg.scripts.preflight,
    'npm run lint && npm run format:check && npm test && npm run validate && npm run check:scratch-namespace',
  );
  assert.match(pkg.devDependencies?.eslint, /^\d+\.\d+\.\d+$/);
  assert.match(pkg.devDependencies?.prettier, /^\d+\.\d+\.\d+$/);
});

test('open-source polish files document editor, badge, and SemVer expectations', () => {
  assert.equal(existsSync(join(repoRoot, '.editorconfig')), true);

  const readme = read('README.md');
  assert.match(readme, /actions\/workflows\/ci\.yml\/badge\.svg/);
  assert.match(readme, /License-MIT/);
  assert.match(readme, /node-%3E%3D20/);

  const contributing = read('CONTRIBUTING.md');
  assert.match(contributing, /## SemVer Policy/);
  assert.match(contributing, /major/i);
  assert.match(contributing, /minor/i);
  assert.match(contributing, /patch/i);
});

test('changelog documents release history without patch version gaps', () => {
  const changelog = read('CHANGELOG.md');
  const versions = parseChangelogPatchVersions(changelog);

  assert.ok(versions.length > 0);
  assertNoPatchVersionGaps(versions);
});

test('changelog patch gap detector reports skipped patch versions', () => {
  assert.throws(
    () => assertNoPatchVersionGaps(parseChangelogPatchVersions('## 0.1.4\n\n## 0.1.2\n')),
    /missing 0\.1\.3/,
  );
});

test('changelog documents scratch namespace pre-merge controls', () => {
  const changelog = read('CHANGELOG.md');
  const release =
    changelog.match(
      /## \d+\.\d+\.\d+[\s\S]*?Scratch Namespace Advisory[\s\S]*?(?=\n## |\n*$)/,
    )?.[0] || '';

  assert.match(release, /Scratch Namespace Advisory/);
  assert.match(release, /pull request/i);
  assert.match(release, /warning annotations/i);
});

test('completion workflow documents plugin-visible version bump gate', () => {
  const agents = read('AGENTS.md');
  const readme = read('README.md');

  assert.match(agents, /plugin-visible/i);
  assert.match(agents, /package\.json/);
  assert.match(agents, /\.agents\/plugins\/marketplace\.json/);
  assert.match(agents, /\.claude-plugin\/marketplace\.json/);
  assert.match(agents, /before commit/i);
  assert.match(agents, /before push/i);

  assert.match(readme, /plugin-visible/i);
  assert.match(readme, /bump.*aligned version/i);
});

test('contributing documents premerge version reconciliation', () => {
  const pkg = JSON.parse(read('package.json'));
  const contributing = read('CONTRIBUTING.md');
  const prTemplate = read('.github/PULL_REQUEST_TEMPLATE.md');

  assert.equal(
    pkg.scripts['ops:premerge-version-check'],
    'node scripts/premerge-version-check.mjs',
  );
  assert.match(contributing, /pre-merge version reconciliation/i);
  assert.match(contributing, /ops:premerge-version-check -- --base origin\/main/);
  assert.match(contributing, /CHANGELOG\.md.*head.*aligned source version/is);
  assert.match(contributing, /`CHANGELOG\.md` does not use `## Unreleased`/i);
  assert.match(contributing, /source-visible/i);
  assert.match(contributing, /package-lock\.json/);
  assert.match(contributing, /scripts\/install-hooks\.mjs/);
  assert.match(contributing, /npm run preflight/);
  assert.match(prTemplate, /npm run preflight/);
  assert.match(contributing, /git push --no-verify/);
});

test('README documents playbook-first task descriptions', () => {
  const readme = read('README.md');
  assert.match(readme, /playbook-first guidance/i);
  assert.match(readme, /--task-descriptions/);
});

test('scratch namespace policy is documented and reviewable', () => {
  const gitignore = read('.gitignore');
  const contributing = read('CONTRIBUTING.md');
  const prTemplate = read('.github/PULL_REQUEST_TEMPLATE.md');

  assert.match(gitignore, /^docs\/superpowers\/$/m);
  assert.match(contributing, /docs\/superpowers\/.*scratch space/is);
  assert.match(contributing, /git add -f docs\/superpowers\//);
  assert.match(contributing, /docs\/designs\//);
  assert.match(contributing, /relocate durable/i);
  assert.match(contributing, /drop\s+non-durable/i);
  assert.match(prTemplate, /docs\/superpowers\//);
  assert.match(
    prTemplate,
    /relocated to `docs\/designs\/` or dropped|relocated to docs\/designs\/ or dropped/i,
  );
  assert.match(contributing, /Scratch Namespace Advisory/);
  assert.match(contributing, /warning annotations/i);
  assert.match(contributing, /does not block ordinary review/i);
  assert.match(prTemplate, /Scratch Namespace Advisory/);
});

test('scratch namespace CI gate is scoped to main pushes', () => {
  const ci = read('.github/workflows/ci.yml');
  const workflow = readCiWorkflow();
  const scratchRuns = workflow.jobs['scratch-namespace'].steps
    .map((step) => step.run)
    .filter(Boolean);
  const scratchJob =
    ci.match(/ {2}scratch-namespace:[\s\S]*?(?=\n {2}[a-zA-Z0-9_-]+:|$)/)?.[0] || '';

  assert.deepEqual(scratchRuns, ['npm run check:scratch-namespace']);
  assert.match(ci, /scratch-namespace:/);
  assert.match(scratchJob, /belt-and-suspenders/i);
  assert.match(scratchJob, /name: Check Scratch Namespace/);
  assert.match(scratchJob, /needs: validate/);
  assert.match(scratchJob, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(scratchJob, /cache:\s*npm/);
  assert.doesNotMatch(scratchJob, /npm ci/);
  assert.doesNotMatch(scratchJob, /--advisory/);
  assert.match(
    scratchJob,
    /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(scratchJob, /^ {8}run: npm run check:scratch-namespace$/m);
});

test('scratch namespace advisory CI job reports PR warnings without blocking review', () => {
  const ci = read('.github/workflows/ci.yml');
  const workflow = readCiWorkflow();
  const advisoryRuns = workflow.jobs['scratch-namespace-advisory'].steps
    .map((step) => step.run)
    .filter(Boolean);
  const advisoryJob =
    ci.match(/ {2}scratch-namespace-advisory:[\s\S]*?(?=\n {2}[a-zA-Z0-9_-]+:|$)/)?.[0] || '';

  assert.match(ci, /scratch-namespace-advisory:/);
  assert.match(advisoryJob, /name: Scratch Namespace Advisory/);
  assert.match(
    workflow.jobs['scratch-namespace-advisory'].if,
    /github\.event_name == 'pull_request'.*github\.event\.pull_request\.draft == true/,
  );
  assert.match(advisoryJob, /runs-on: ubuntu-latest/);
  assert.match(advisoryJob, /actions\/checkout@v4/);
  assert.match(advisoryJob, /actions\/setup-node@v4/);
  assert.match(advisoryJob, /node-version: '20'/);
  assert.deepEqual(advisoryRuns, ['npm run check:scratch-namespace -- --advisory']);
  assert.doesNotMatch(advisoryJob, /continue-on-error/);
  assert.doesNotMatch(advisoryJob, /needs: validate/);
  assert.doesNotMatch(advisoryJob, /npm ci/);
});
