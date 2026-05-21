import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'agent-trigger-kit-scratch-test-'));
}

function runScript(root) {
  return spawnSync(
    process.execPath,
    [join(repoRoot, 'scripts/check-scratch-namespace.mjs'), '--root', root],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
}

function runGit(root, args) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });
}

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function initGitRepo(root) {
  const init = runGit(root, ['init']);
  assert.equal(init.status, 0, init.stderr || init.stdout);
}

function withTempGitRepo(fn) {
  const root = makeRoot();
  try {
    initGitRepo(root);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('scratch namespace check ignores untracked scratch files', () => {
  withTempGitRepo((root) => {
    write(root, 'docs/superpowers/specs/draft-design.md', '# Draft');

    const result = runScript(root);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /scratch namespace check passed/i);
  });
});

test('scratch namespace check fails and lists tracked scratch files', () => {
  withTempGitRepo((root) => {
    write(root, 'docs/superpowers/specs/draft-design.md', '# Draft');
    const add = runGit(root, ['add', 'docs/superpowers/specs/draft-design.md']);
    assert.equal(add.status, 0, add.stderr || add.stdout);

    const result = runScript(root);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Tracked scratch namespace files are not allowed/);
    assert.match(result.stderr, /docs\/superpowers\/specs\/draft-design\.md/);
    assert.match(result.stderr, /relocate durable files to docs\/designs\//);
    assert.match(result.stderr, /git rm/);
  });
});
