import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decideReleaseTag, tagNameForVersion } from '../scripts/lib/release-tag.mjs';
import { makeTempDir } from './helpers/tmp.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test('tagNameForVersion accepts clean semver and prefixes v', () => {
  assert.deepEqual(tagNameForVersion('0.2.7'), {
    ok: true,
    tagName: 'v0.2.7',
  });
});

test('tagNameForVersion rejects non-clean semver', () => {
  assert.deepEqual(tagNameForVersion('0.2.7-rc.1'), {
    ok: false,
    reason: 'expected source version must be clean SemVer x.y.z',
  });
  assert.deepEqual(tagNameForVersion('v0.2.7'), {
    ok: false,
    reason: 'expected source version must be clean SemVer x.y.z',
  });
});

test('decideReleaseTag blocks when source versions are inconsistent', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      sourceErrorMessage: 'source versions differ',
      tagTarget: null,
    }),
    {
      action: 'blocked',
      expectedVersion: '0.2.7',
      head,
      reason: 'source versions differ',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag blocks when expected version is not clean semver', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: 'v0.2.7',
      head,
      tagTarget: null,
    }),
    {
      action: 'blocked',
      expectedVersion: 'v0.2.7',
      head,
      reason: 'expected source version must be clean SemVer x.y.z',
      shouldCreate: false,
      shouldPush: false,
      tagName: null,
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag blocks when HEAD is unavailable', () => {
  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head: null,
      tagTarget: null,
    }),
    {
      action: 'blocked',
      expectedVersion: '0.2.7',
      head: null,
      reason: 'HEAD commit is unavailable',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag creates a missing clean semver tag at HEAD', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      tagTarget: null,
    }),
    {
      action: 'create',
      expectedVersion: '0.2.7',
      head,
      reason: 'tag is missing',
      shouldCreate: true,
      shouldPush: true,
      tagName: 'v0.2.7',
      tagTarget: null,
      warning: null,
    },
  );
});

test('decideReleaseTag no-ops when the tag already points at HEAD', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      tagTarget: head,
    }),
    {
      action: 'noop_current',
      expectedVersion: '0.2.7',
      head,
      reason: 'tag already points at HEAD',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget: head,
      warning: null,
    },
  );
});

test('decideReleaseTag warns but never moves an existing tag at another commit', () => {
  const head = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const tagTarget = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  assert.deepEqual(
    decideReleaseTag({
      expectedVersion: '0.2.7',
      head,
      tagTarget,
    }),
    {
      action: 'warn_existing',
      expectedVersion: '0.2.7',
      head,
      reason: 'tag already exists at a different commit',
      shouldCreate: false,
      shouldPush: false,
      tagName: 'v0.2.7',
      tagTarget,
      warning:
        'v0.2.7 already points at bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; leaving it unchanged instead of moving a published tag',
    },
  );
});

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function initReleaseFixture(t, version = '0.2.7') {
  const root = makeTempDir(t, 'agent-trigger-kit-release-tag-');
  const pluginDir = join(root, 'plugins/agent-trigger-kit');

  mkdirSync(join(root, '.agents/plugins'), { recursive: true });
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(pluginDir, '.codex-plugin'), { recursive: true });
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });

  writeJson(join(root, 'package.json'), {
    name: 'agent-trigger-kit',
    version,
    type: 'module',
  });
  writeJson(join(root, '.agents/plugins/marketplace.json'), {
    name: 'agent-trigger-kit',
    plugins: [
      {
        name: 'agent-trigger-kit',
        version,
        source: {
          source: 'local',
          path: './plugins/agent-trigger-kit',
        },
      },
    ],
  });
  writeJson(join(root, '.claude-plugin/marketplace.json'), {
    name: 'agent-trigger-kit',
    plugins: [
      {
        name: 'agent-trigger-kit',
        version,
        source: './plugins/agent-trigger-kit',
      },
    ],
  });
  writeJson(join(pluginDir, '.codex-plugin/plugin.json'), {
    name: 'agent-trigger-kit',
    version,
  });
  writeJson(join(pluginDir, '.claude-plugin/plugin.json'), {
    name: 'agent-trigger-kit',
    version,
  });
  writeFileSync(join(root, 'README.md'), '# Fixture\n');

  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'Release Test']);
  runGit(root, ['config', 'user.email', 'release-test@example.invalid']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'fixture']);

  return root;
}

function runReleaseTag(args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts/release-tag.mjs'), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
}

function gitTagList(root) {
  return runGit(root, ['tag', '--list']).split('\n').filter(Boolean);
}

test('release-tag dry-run reports create without creating a tag', (t) => {
  const root = initReleaseFixture(t, '0.2.7');

  const result = runReleaseTag(['--root', root]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Release tag/);
  assert.match(result.stdout, /Version: 0\.2\.7/);
  assert.match(result.stdout, /Tag: v0\.2\.7/);
  assert.match(result.stdout, /Action: create/);
  assert.match(result.stdout, /Dry run: yes/);
  assert.deepEqual(gitTagList(root), []);
});

test('release-tag JSON dry-run reports warn_existing without moving a tag', (t) => {
  const root = initReleaseFixture(t, '0.2.7');
  const firstCommit = runGit(root, ['rev-parse', 'HEAD']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nDocs only.\n');
  runGit(root, ['add', 'README.md']);
  runGit(root, ['commit', '-m', 'docs only']);
  runGit(root, ['tag', '-a', 'v0.2.7', firstCommit, '-m', 'Release v0.2.7']);

  const result = runReleaseTag(['--root', root, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kind, 'release_tag');
  assert.equal(report.action, 'warn_existing');
  assert.equal(report.tagName, 'v0.2.7');
  assert.equal(report.tagTarget, firstCommit);
  assert.equal(report.created, false);
  assert.equal(report.pushed, false);
  assert.equal(runGit(root, ['rev-parse', 'v0.2.7^{}']), firstCommit);
});

test('release-tag blocks when source versions differ', (t) => {
  const root = initReleaseFixture(t, '0.2.7');
  const manifestPath = join(root, 'plugins/agent-trigger-kit/.claude-plugin/plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = '0.2.8';
  writeJson(manifestPath, manifest);

  const result = runReleaseTag(['--root', root, '--json']);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.action, 'blocked');
  assert.match(report.reason, /source versions differ/);
  assert.deepEqual(gitTagList(root), []);
});

test('release-tag apply treats a remote-existing tag race as immutable no-op', (t) => {
  const root = initReleaseFixture(t, '0.2.7');
  const origin = makeTempDir(t, 'agent-trigger-kit-release-tag-origin-');

  runGit(origin, ['init', '--bare']);
  runGit(root, ['remote', 'add', 'origin', origin]);
  runGit(root, ['push', 'origin', 'HEAD:main']);
  runGit(root, ['tag', '-a', 'v0.2.7', '-m', 'Release v0.2.7']);
  runGit(root, ['push', 'origin', 'v0.2.7']);
  const remoteTarget = runGit(root, ['rev-parse', 'v0.2.7^{}']);
  runGit(root, ['tag', '-d', 'v0.2.7']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n\nLater docs.\n');
  runGit(root, ['add', 'README.md']);
  runGit(root, ['commit', '-m', 'later docs']);

  const result = runReleaseTag(['--root', root, '--apply', '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.action, 'warn_existing');
  assert.match(report.warning, /appeared on origin before push completed/);
  assert.equal(report.created, true);
  assert.equal(report.pushed, false);
  const localTag = spawnSync('git', ['rev-parse', '-q', '--verify', 'v0.2.7^{}'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(localTag.status, 0, localTag.stdout);
  assert.equal(
    runGit(root, ['ls-remote', '--tags', 'origin', 'refs/tags/v0.2.7^{}']).includes(remoteTarget),
    true,
  );
});
