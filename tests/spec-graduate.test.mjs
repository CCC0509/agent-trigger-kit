import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { makeTempDir } from './helpers/tmp.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeRoot(t) {
  return makeTempDir(t, 'agent-trigger-kit-spec-graduate-');
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

function write(root, path, text) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${text.trimEnd()}\n`);
}

function read(root, path) {
  return readFileSync(join(root, path), 'utf8');
}

function exists(root, path) {
  return existsSync(join(root, path));
}

function writeSpec(root, file, text = '# Spec') {
  write(root, `docs/superpowers/specs/${file}`, text);
}

function writePlan(root, file, text = '# Plan') {
  write(root, `docs/superpowers/plans/${file}`, text);
}

function writeDesign(root, file, text = '# Existing design') {
  write(root, `docs/designs/${file}`, text);
}

test('spec-graduate moves a matching spec and removes one matching plan', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-workflow-mechanical-helpers-design.md', '# Workflow design');
  writePlan(root, '2026-05-24-workflow-mechanical-helpers.md', '# Workflow plan');

  const result = runCli(['spec-graduate', 'workflow-mechanical-helpers', '--root', root]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Spec graduation/m);
  assert.match(
    result.stdout,
    /Moved docs\/superpowers\/specs\/2026-05-24-workflow-mechanical-helpers-design\.md -> docs\/designs\/2026-05-24-workflow-mechanical-helpers-design\.md/,
  );
  assert.match(result.stdout, /Commit: not requested/);
  assert.equal(
    exists(root, 'docs/superpowers/specs/2026-05-24-workflow-mechanical-helpers-design.md'),
    false,
  );
  assert.equal(
    exists(root, 'docs/superpowers/plans/2026-05-24-workflow-mechanical-helpers.md'),
    false,
  );
  assert.equal(exists(root, 'docs/designs/2026-05-24-workflow-mechanical-helpers-design.md'), true);
  assert.equal(
    read(root, 'docs/designs/2026-05-24-workflow-mechanical-helpers-design.md'),
    '# Workflow design\n',
  );
});

test('spec-graduate supports exact stem resolution', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-exact-design.md', '# Exact design');
  writePlan(root, '2026-05-24-exact.md', '# Exact plan');

  const result = runCli(['spec-graduate', '2026-05-24-exact-design', '--root', root]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(exists(root, 'docs/superpowers/specs/2026-05-24-exact-design.md'), false);
  assert.equal(exists(root, 'docs/designs/2026-05-24-exact-design.md'), true);
  assert.equal(exists(root, 'docs/superpowers/plans/2026-05-24-exact.md'), false);
});

test('spec-graduate ambiguous suffix fails and lists both candidate files', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-shared-design.md');
  writeSpec(root, '2026-05-25-shared-design.md');

  const result = runCli(['spec-graduate', 'shared', '--root', root]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ambiguous spec suffix/i);
  assert.match(result.stderr, /docs\/superpowers\/specs\/2026-05-24-shared-design\.md/);
  assert.match(result.stderr, /docs\/superpowers\/specs\/2026-05-25-shared-design\.md/);
  assert.equal(exists(root, 'docs/superpowers/specs/2026-05-24-shared-design.md'), true);
  assert.equal(exists(root, 'docs/superpowers/specs/2026-05-25-shared-design.md'), true);
});

test('spec-graduate target durable design already exists fails without overwriting', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-existing-design.md', '# New design');
  writeDesign(root, '2026-05-24-existing-design.md', '# Existing durable design');

  const result = runCli(['spec-graduate', 'existing', '--root', root]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /already exists/i);
  assert.equal(
    read(root, 'docs/superpowers/specs/2026-05-24-existing-design.md'),
    '# New design\n',
  );
  assert.equal(
    read(root, 'docs/designs/2026-05-24-existing-design.md'),
    '# Existing durable design\n',
  );
});

test('spec-graduate --dry-run --json leaves files unchanged and returns planned status', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-dry-run-design.md', '# Dry design');
  writePlan(root, '2026-05-24-dry-run.md', '# Dry plan');

  const result = runCli(['spec-graduate', 'dry-run', '--root', root, '--dry-run', '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schema_version, 1);
  assert.equal(payload.command, 'spec-graduate');
  assert.equal(payload.status, 'planned');
  assert.deepEqual(payload.removed_plans, ['docs/superpowers/plans/2026-05-24-dry-run.md']);
  assert.deepEqual(payload.warnings, []);
  assert.equal(payload.commit.status, 'not_requested');
  assert.deepEqual(payload.moved, {
    from: 'docs/superpowers/specs/2026-05-24-dry-run-design.md',
    to: 'docs/designs/2026-05-24-dry-run-design.md',
  });
  assert.equal(exists(root, 'docs/superpowers/specs/2026-05-24-dry-run-design.md'), true);
  assert.equal(exists(root, 'docs/superpowers/plans/2026-05-24-dry-run.md'), true);
  assert.equal(exists(root, 'docs/designs/2026-05-24-dry-run-design.md'), false);
});

test('spec-graduate ambiguous plan matches are not removed and human output includes warning', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-plan-ambiguous-design.md', '# Plan ambiguous design');
  writePlan(root, '2026-05-24-plan-ambiguous.md', '# First plan');
  writePlan(root, '2026-05-24-plan-ambiguous-design.md', '# Second plan');

  const result = runCli(['spec-graduate', 'plan-ambiguous', '--root', root]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan cleanup skipped/);
  assert.equal(exists(root, 'docs/superpowers/specs/2026-05-24-plan-ambiguous-design.md'), false);
  assert.equal(exists(root, 'docs/designs/2026-05-24-plan-ambiguous-design.md'), true);
  assert.equal(exists(root, 'docs/superpowers/plans/2026-05-24-plan-ambiguous.md'), true);
  assert.equal(exists(root, 'docs/superpowers/plans/2026-05-24-plan-ambiguous-design.md'), true);
});

test('spec-graduate --commit creates a commit with moved and deleted paths', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-commit-me-design.md', '# Commit design');
  writePlan(root, '2026-05-24-commit-me.md', '# Commit plan');
  assert.equal(runGit(root, ['init']).status, 0);
  assert.equal(runGit(root, ['config', 'user.name', 'Agent Trigger Kit Test']).status, 0);
  assert.equal(runGit(root, ['config', 'user.email', 'agent-trigger-kit@example.test']).status, 0);
  assert.equal(runGit(root, ['add', '.']).status, 0);
  assert.equal(runGit(root, ['commit', '-m', 'test fixture']).status, 0);

  const result = runCli(['spec-graduate', 'commit-me', '--root', root, '--commit']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Commit: docs: graduate commit-me/);
  const status = runGit(root, ['status', '--short']);
  assert.equal(status.status, 0);
  assert.equal(status.stdout, '');
  const show = runGit(root, ['show', '--no-renames', '--name-status', '--pretty=', 'HEAD']);
  assert.equal(show.status, 0);
  assert.match(show.stdout, /A\tdocs\/designs\/2026-05-24-commit-me-design\.md/);
  assert.match(show.stdout, /D\tdocs\/superpowers\/specs\/2026-05-24-commit-me-design\.md/);
  assert.match(show.stdout, /D\tdocs\/superpowers\/plans\/2026-05-24-commit-me\.md/);
});

test('spec-graduate --commit refuses an already-staged index before moving files', (t) => {
  const root = makeRoot(t);
  writeSpec(root, '2026-05-24-staged-index-design.md', '# Staged index design');
  writePlan(root, '2026-05-24-staged-index.md', '# Staged index plan');
  assert.equal(runGit(root, ['init']).status, 0);
  assert.equal(runGit(root, ['config', 'user.name', 'Agent Trigger Kit Test']).status, 0);
  assert.equal(runGit(root, ['config', 'user.email', 'agent-trigger-kit@example.test']).status, 0);
  assert.equal(runGit(root, ['add', '.']).status, 0);
  assert.equal(runGit(root, ['commit', '-m', 'test fixture']).status, 0);
  write(root, 'scratch/unrelated.md', '# Unrelated staged work');
  assert.equal(runGit(root, ['add', 'scratch/unrelated.md']).status, 0);

  const result = runCli(['spec-graduate', 'staged-index', '--root', root, '--commit']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--commit requires an empty index before spec graduation/);
  assert.equal(exists(root, 'docs/superpowers/specs/2026-05-24-staged-index-design.md'), true);
  assert.equal(exists(root, 'docs/superpowers/plans/2026-05-24-staged-index.md'), true);
  assert.equal(exists(root, 'docs/designs/2026-05-24-staged-index-design.md'), false);
  const staged = runGit(root, ['diff', '--cached', '--name-status']);
  assert.equal(staged.status, 0);
  assert.equal(staged.stdout, 'A\tscratch/unrelated.md\n');
});
