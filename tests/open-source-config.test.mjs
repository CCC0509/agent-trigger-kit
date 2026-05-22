import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
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

  assert.match(ci, /matrix:/);
  assert.match(ci, /ubuntu-latest/);
  assert.match(ci, /macos-latest/);
  assert.match(ci, /npm ci/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm run format:check/);
  assert.match(ci, /@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
  assert.doesNotMatch(ci, /npm install -g @anthropic-ai\/claude-code\s*$/m);
});

test('package exposes lint and format tooling with locked dev dependencies', () => {
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
});

test('scratch namespace CI gate is scoped to main pushes', () => {
  const ci = read('.github/workflows/ci.yml');
  const scratchJob = ci.match(/ {2}scratch-namespace:[\s\S]*/)?.[0] || '';

  assert.equal((ci.match(/run: npm run check:scratch-namespace/g) || []).length, 1);
  assert.match(ci, /scratch-namespace:/);
  assert.match(ci, /name: Check Scratch Namespace/);
  assert.match(ci, /needs: validate/);
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(scratchJob, /cache:\s*npm/);
  assert.doesNotMatch(scratchJob, /npm ci/);
  assert.match(
    ci,
    /scratch-namespace:[\s\S]*if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'[\s\S]*run: npm run check:scratch-namespace/,
  );
});
