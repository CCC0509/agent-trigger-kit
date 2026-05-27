import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { makeTempDir } from './helpers/tmp.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'cli.mjs'), ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
  });
}

test('top-level --version prints the package version only', () => {
  const result = runCli(['--version']);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, '');
});

test('--version resolves package.json relative to the CLI script, not cwd', (t) => {
  const otherCwd = makeTempDir(t, 'agent-trigger-kit-cli-version-');
  const result = runCli(['--version'], { cwd: otherCwd });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, `${packageJson.version}\n`);
  assert.equal(result.stderr, '');
});

test('--version is handled before subcommand lookup and usage rendering', () => {
  const result = runCli(['--version']);

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /Usage: agent-trigger-kit/);
  assert.doesNotMatch(result.stderr, /Unknown command|Usage: agent-trigger-kit/);
});

test('--help does not require package metadata', (t) => {
  const tempRoot = makeTempDir(t, 'agent-trigger-kit-cli-help-');
  const tempScriptsDir = join(tempRoot, 'scripts');
  const tempCli = join(tempScriptsDir, 'cli.mjs');

  mkdirSync(tempScriptsDir);
  copyFileSync(join(repoRoot, 'scripts', 'cli.mjs'), tempCli);

  const result = spawnSync(process.execPath, [tempCli, '--help'], {
    cwd: tempRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Usage: agent-trigger-kit/);
  assert.doesNotMatch(result.stderr, /package\.json|ENOENT/);
});
