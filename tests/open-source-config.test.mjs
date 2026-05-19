import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
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
