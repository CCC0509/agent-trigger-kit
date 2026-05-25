import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { makeTempDir } from './helpers/tmp.mjs';
import {
  SCRATCH_COMMAND_CHUNK_SIZE,
  SCRATCH_COMMAND_OMITTED_PERMISSION_RESTRICTED,
  SCRATCH_COMMAND_OMITTED_TOO_MANY_PATHS,
  SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT,
  SCRATCH_GROUP_THRESHOLD,
  SCRATCH_SAMPLE_LIMIT,
  groupScratchCandidates,
  scratchGroupId,
} from '../scripts/lib/audit-cleanup.mjs';
import {
  markOutcomeEvent,
  mintUuidV7,
  outcomeStorePath,
  recordOutcomeEvent,
} from '../scripts/lib/outcome-recorder.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function makeHome(t) {
  return makeTempDir(t, 'agent-trigger-kit-audit-home-');
}

function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env || {}) },
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function initRepo(t, options = {}) {
  const root = makeTempDir(t, 'agent-trigger-kit-audit-repo-');
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Agent Trigger Kit Tests']);
  git(root, ['config', 'user.email', 'agent-trigger-kit@example.test']);
  commitFile(root, 'README.md', '# audit cleanup fixture\n', 'initial commit', {
    date: options.initialDate,
  });
  return root;
}

function initBareRemote(t) {
  const remote = makeTempDir(t, 'agent-trigger-kit-audit-remote-');
  git(remote, ['init', '--bare']);
  return remote;
}

function commitFile(root, relativePath, content, message, options = {}) {
  const fullPath = join(root, relativePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
  git(root, ['add', relativePath]);
  const env = options.date
    ? {
        GIT_AUTHOR_DATE: options.date,
        GIT_COMMITTER_DATE: options.date,
      }
    : {};
  git(root, ['commit', '-m', message], { env });
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [join(repoRoot, 'scripts', 'cli.mjs'), ...args], {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: options.homeDir || makeHome(options.t),
      AGENT_TRIGGER_KIT_OUTCOME_DISABLED: '1',
    },
  });
}

function runAuditJson(t, root, args = [], options = {}) {
  const tmpRootArgs = args.includes('--tmp-root')
    ? []
    : ['--tmp-root', makeTempDir(t, 'agent-trigger-kit-audit-empty-tmp-')];
  const result = runCli(
    ['audit-cleanup', '--root', root, '--base', 'main', '--json', ...tmpRootArgs, ...args],
    {
      t,
      homeDir: options.homeDir,
      cwd: options.cwd,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function findById(report, id) {
  return report.findings.find((finding) => finding.id === id);
}

function assertFinding(report, id) {
  const finding = findById(report, id);
  assert.ok(finding, `expected finding ${id}\n${JSON.stringify(report.findings, null, 2)}`);
  return finding;
}

function snapshotRefs(root) {
  return git(root, ['for-each-ref', '--format=%(refname)%09%(objectname)']).stdout;
}

function scratchCandidate(tmpRoot, name, options = {}) {
  const path = join(tmpRoot, name);
  return {
    path,
    real_path: path,
    tmp_root: tmpRoot,
    name,
    permission_restricted: false,
    ...options,
  };
}

function expectedRmCommands(paths) {
  const commands = [];
  for (let index = 0; index < paths.length; index += SCRATCH_COMMAND_CHUNK_SIZE) {
    commands.push(
      `rm -rf ${paths
        .slice(index, index + SCRATCH_COMMAND_CHUNK_SIZE)
        .map((path) => shellQuoteForAuditTest(path))
        .join(' ')}`,
    );
  }
  return commands;
}

function shellQuoteForAuditTest(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

test('audit-cleanup scratch constants keep grouped command branches reachable', () => {
  assert.ok(SCRATCH_GROUP_THRESHOLD < SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT);
  assert.ok(SCRATCH_COMMAND_CHUNK_SIZE <= SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT);
  assert.ok(SCRATCH_SAMPLE_LIMIT <= SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT);
});

test('audit-cleanup scratch group ids use the full temp-root path', () => {
  assert.notEqual(scratchGroupId('/tmp/a/same-name'), scratchGroupId('/var/tmp/b/same-name'));
  assert.match(scratchGroupId('/tmp/a/same-name'), /^[a-f0-9]{16}$/);
});

test('audit-cleanup groups 57k in-memory scratch candidates without path floods', () => {
  const tmpRoot = '/tmp/agent-trigger-kit-large-root';
  const candidates = Array.from({ length: 57_000 }, (_, index) =>
    scratchCandidate(tmpRoot, `agent-trigger-kit-large-${String(index).padStart(5, '0')}`),
  );
  const grouped = groupScratchCandidates({ tmpRoot, candidates });

  assert.equal(grouped.id, `scratch.residue_group.${scratchGroupId(tmpRoot)}`);
  assert.equal(grouped.category, 'scratch');
  assert.equal(grouped.severity, 'actionable');
  assert.equal(grouped.details.tmp_root, tmpRoot);
  assert.equal(grouped.details.count, 57_000);
  assert.deepEqual(
    grouped.details.sample_paths,
    candidates.slice(0, SCRATCH_SAMPLE_LIMIT).map((candidate) => candidate.path),
  );
  assert.equal(grouped.details.omitted_count, 57_000 - SCRATCH_SAMPLE_LIMIT);
  assert.equal(grouped.details.has_permission_restricted_paths, false);
  assert.deepEqual(grouped.suggested_commands, []);
  assert.equal(grouped.details.command_omitted_reason, SCRATCH_COMMAND_OMITTED_TOO_MANY_PATHS);
  assert.equal(grouped.requires_human_judgment, true);
});

test('audit-cleanup groups explicit scratch commands in bounded chunks', () => {
  const tmpRoot = '/tmp/agent-trigger-kit-small-root';
  const candidates = Array.from({ length: SCRATCH_COMMAND_CHUNK_SIZE + 1 }, (_, index) =>
    scratchCandidate(tmpRoot, `agent-trigger-kit-small-${String(index).padStart(2, '0')}`),
  );
  const grouped = groupScratchCandidates({ tmpRoot, candidates });

  assert.deepEqual(
    grouped.suggested_commands,
    expectedRmCommands(candidates.map((candidate) => candidate.path)),
  );
  assert.equal(grouped.details.command_omitted_reason, null);
});

test('audit-cleanup reports local branches already merged into base', (t) => {
  const root = initRepo(t);
  git(root, ['checkout', '-b', 'merged-cleanup']);
  commitFile(root, 'merged.txt', 'merged work\n', 'merged work');
  git(root, ['checkout', 'main']);
  git(root, ['merge', '--no-ff', 'merged-cleanup', '-m', 'merge cleanup branch']);

  const report = runAuditJson(t, root);
  const finding = assertFinding(report, 'branch.merged.merged-cleanup');

  assert.equal(finding.category, 'branch');
  assert.equal(finding.severity, 'actionable');
  assert.match(finding.summary, /merged-cleanup/);
  assert.deepEqual(finding.suggested_commands, ['git branch -d merged-cleanup']);
  assert.equal(finding.requires_human_judgment, true);
});

test('audit-cleanup reports branches whose configured upstream is gone', (t) => {
  const root = initRepo(t);
  const remote = initBareRemote(t);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-u', 'origin', 'main']);
  git(root, ['checkout', '-b', 'lost-upstream']);
  commitFile(root, 'lost.txt', 'remote branch will disappear\n', 'lost upstream work');
  git(root, ['push', '-u', 'origin', 'lost-upstream']);
  git(root, ['checkout', 'main']);
  git(root, ['push', 'origin', ':lost-upstream']);

  const report = runAuditJson(t, root);
  const finding = assertFinding(report, 'branch.upstream_missing.lost-upstream');

  assert.equal(finding.category, 'branch');
  assert.equal(finding.severity, 'actionable');
  assert.deepEqual(finding.suggested_commands, ['git branch --unset-upstream lost-upstream']);
});

test('audit-cleanup reports non-current local branches that never had an upstream', (t) => {
  const root = initRepo(t);
  git(root, ['checkout', '-b', 'local-only']);
  commitFile(root, 'local.txt', 'local only work\n', 'local only work');
  git(root, ['checkout', 'main']);

  const report = runAuditJson(t, root);
  const finding = assertFinding(report, 'branch.no_upstream.local-only');

  assert.equal(finding.category, 'branch');
  assert.equal(finding.severity, 'info');
  assert.deepEqual(finding.suggested_commands, ['git log --oneline --decorate main..local-only']);
});

test('audit-cleanup reports branches with merge-bases older than the configured threshold', (t) => {
  const root = initRepo(t, { initialDate: '2000-01-01T00:00:00Z' });
  git(root, ['checkout', '-b', 'stale-work']);
  commitFile(root, 'stale.txt', 'stale branch work\n', 'stale branch work');
  git(root, ['checkout', 'main']);
  commitFile(root, 'main.txt', 'main moved on\n', 'main moved on');

  const report = runAuditJson(t, root, ['--merge-base-age-days', '1']);
  const finding = assertFinding(report, 'branch.stale_merge_base.stale-work');

  assert.equal(finding.category, 'branch');
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.details.threshold_days, 1);
  assert.ok(finding.details.merge_base_age_days >= 1);
  assert.deepEqual(finding.suggested_commands, ['git log --oneline --decorate main..stale-work']);
});

test('audit-cleanup does not report stale age when branch is based on current base commit', (t) => {
  const root = initRepo(t, { initialDate: '2000-01-01T00:00:00Z' });
  git(root, ['checkout', '-b', 'active-current-base']);
  commitFile(root, 'active.txt', 'active branch work\n', 'active branch work');
  git(root, ['checkout', 'main']);

  const report = runAuditJson(t, root, ['--merge-base-age-days', '1']);

  assert.equal(
    findById(report, 'branch.stale_merge_base.active-current-base'),
    undefined,
    JSON.stringify(report.findings, null, 2),
  );
});

test('audit-cleanup reports cherry-pick no-op candidate branches', (t) => {
  const root = initRepo(t);
  git(root, ['checkout', '-b', 'no-op-work']);
  commitFile(root, 'same.txt', 'same patch\n', 'same patch on branch');
  git(root, ['checkout', 'main']);
  commitFile(root, 'same.txt', 'same patch\n', 'same patch on main');

  const report = runAuditJson(t, root);
  const finding = assertFinding(report, 'branch.cherry_noop.no-op-work');

  assert.equal(finding.category, 'branch');
  assert.equal(finding.severity, 'actionable');
  assert.deepEqual(finding.suggested_commands, ['git cherry main no-op-work']);
});

test('audit-cleanup suppresses fresh upstream branches with non-no-op cherry output', (t) => {
  const root = initRepo(t);
  const remote = initBareRemote(t);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-u', 'origin', 'main']);
  git(root, ['checkout', '-b', 'active-review']);
  commitFile(root, 'review.txt', 'new review work\n', 'active review work');
  git(root, ['push', '-u', 'origin', 'active-review']);
  git(root, ['checkout', 'main']);

  const report = runAuditJson(t, root);

  assert.equal(
    report.findings.some((finding) => finding.details.branch === 'active-review'),
    false,
    JSON.stringify(report.findings, null, 2),
  );
});

test('audit-cleanup reports unmarked outcome events and ignores marked events', (t) => {
  const root = initRepo(t);
  const homeDir = makeHome(t);
  const unmarked = recordOutcomeEvent({
    root,
    homeDir,
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  }).record;
  const marked = recordOutcomeEvent({
    root,
    homeDir,
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:01:00.000Z'),
  }).record;
  markOutcomeEvent({
    root,
    homeDir,
    relatedId: marked.id,
    outcome: 'success',
    note: 'already reviewed',
    now: new Date('2026-05-23T08:02:00.000Z'),
  });

  const report = runAuditJson(t, root, [], { homeDir });
  const finding = assertFinding(report, `outcome.unmarked.${unmarked.id.slice(0, 8)}`);

  assert.equal(findById(report, `outcome.unmarked.${marked.id.slice(0, 8)}`), undefined);
  assert.equal(finding.category, 'outcome');
  assert.equal(finding.severity, 'actionable');
  assert.deepEqual(finding.suggested_commands, [
    `agent-trigger-kit outcome mark --root ${root} ${unmarked.id} --outcome success --note "reviewed during audit-cleanup"`,
  ]);
});

test('audit-cleanup reports more than 1000 unmarked outcome events', (t) => {
  const root = initRepo(t);
  const homeDir = makeHome(t);
  const store = outcomeStorePath({ root, homeDir, store: 'user' });
  mkdirSync(dirname(store.eventsPath), { recursive: true });
  const start = new Date('2026-01-01T00:00:00.000Z').getTime();
  const records = Array.from({ length: 1001 }, (_, index) => {
    const ts = new Date(start + index * 70_000);
    return {
      id: mintUuidV7(ts, `bulk-unmarked-${index}`),
      schema_version: '0.1',
      kind: 'event',
      ts: ts.toISOString(),
      verb: 'validate',
      outcome: 'success',
      surface: 'repo',
      exit_code: 0,
      project_hash: store.projectHash,
      plugin: 'agent-trigger-kit',
    };
  });
  writeFileSync(
    store.eventsPath,
    `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
  );

  const report = runAuditJson(t, root, [], { homeDir });
  const outcomeFindings = report.findings.filter((finding) => finding.category === 'outcome');

  assert.equal(outcomeFindings.length, 1001);
});

test('audit-cleanup emits a warning finding when the outcome store cannot be inspected', (t) => {
  const root = initRepo(t);
  const homeDir = makeHome(t);
  const store = outcomeStorePath({ root, homeDir, store: 'user' });
  mkdirSync(store.eventsPath, { recursive: true });

  const report = runAuditJson(t, root, [], { homeDir });
  const finding = assertFinding(report, 'outcome.unreadable_store');

  assert.equal(finding.category, 'outcome');
  assert.equal(finding.severity, 'warning');
  assert.match(finding.summary, /outcome store/i);
  assert.deepEqual(finding.suggested_commands, []);
});

test('audit-cleanup reports temp scratch residue from repeatable tmp roots and excludes HOME', (t) => {
  const root = initRepo(t);
  const firstTmpRoot = makeTempDir(t, 'agent-trigger-kit-audit-tmp-a-');
  const secondTmpRoot = makeTempDir(t, 'agent-trigger-kit-audit-tmp-b-');
  const residue = join(firstTmpRoot, 'agent-trigger-kit-old-residue');
  const homeDir = join(secondTmpRoot, 'agent-trigger-kit-current-home');
  mkdirSync(residue, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  const report = runAuditJson(t, root, ['--tmp-root', firstTmpRoot, '--tmp-root', secondTmpRoot], {
    homeDir,
  });
  const finding = assertFinding(report, 'scratch.residue.agent-trigger-kit-old-residue');

  assert.equal(finding.category, 'scratch');
  assert.equal(finding.severity, 'actionable');
  assert.equal(finding.details.path, residue);
  assert.equal(finding.details.tmp_root, firstTmpRoot);
  assert.equal(finding.details.name, 'agent-trigger-kit-old-residue');
  assert.equal(finding.details.permission_restricted, false);
  assert.deepEqual(finding.suggested_commands, [`rm -rf ${residue}`]);
  assert.equal(
    report.findings.some((candidate) => candidate.details.path === homeDir),
    false,
    JSON.stringify(report.findings, null, 2),
  );
});

test('audit-cleanup suggests chmod before removing permission-restricted scratch directories', (t) => {
  if (typeof process.getuid !== 'function') {
    return t.skip('process.getuid is unavailable on this platform');
  }

  const root = initRepo(t);
  const tmpRoot = makeTempDir(t, 'agent-trigger-kit-audit-blocked-tmp-');
  const residue = join(tmpRoot, 'agent-trigger-kit-blocked-residue');
  mkdirSync(residue, { recursive: true });
  chmodSync(residue, 0o000);
  t.after(() => {
    try {
      chmodSync(residue, 0o700);
    } catch {
      // Best-effort cleanup permission restore.
    }
  });

  const report = runAuditJson(t, root, ['--tmp-root', tmpRoot]);
  const finding = assertFinding(report, 'scratch.residue.agent-trigger-kit-blocked-residue');

  assert.equal(finding.category, 'scratch');
  assert.equal(finding.details.path, residue);
  assert.equal(finding.details.permission_restricted, true);
  assert.deepEqual(finding.suggested_commands, [`chmod -R u+rwX ${residue} && rm -rf ${residue}`]);
});

test('audit-cleanup preserves scratch tmp-root unreadable warnings', (t) => {
  const root = initRepo(t);
  const tmpParent = makeTempDir(t, 'agent-trigger-kit-audit-missing-parent-');
  const missingTmpRoot = join(tmpParent, 'agent-trigger-kit-missing-root');

  const report = runAuditJson(t, root, ['--tmp-root', missingTmpRoot]);
  const warning = report.warnings.find((candidate) =>
    candidate.id.startsWith('scratch.tmp_root_unreadable.'),
  );

  assert.ok(warning, JSON.stringify(report.warnings, null, 2));
  assert.equal(warning.category, 'scratch');
  assert.equal(warning.severity, 'warning');
  assert.match(warning.summary, /could not be inspected/);
  assert.equal(warning.details.code, 'ENOENT');
});

test('audit-cleanup JSON output remains parseable with many findings', (t) => {
  const root = initRepo(t);
  const tmpRoot = makeTempDir(t, 'agent-trigger-kit-audit-large-tmp-');
  const homeDir = makeHome(t);

  for (let index = 0; index < 120; index += 1) {
    mkdirSync(join(tmpRoot, `agent-trigger-kit-large-${String(index).padStart(3, '0')}`));
  }

  const stdout = execFileSync(
    process.execPath,
    [
      join(repoRoot, 'scripts', 'cli.mjs'),
      'audit-cleanup',
      '--root',
      root,
      '--base',
      'main',
      '--json',
      '--tmp-root',
      tmpRoot,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: homeDir,
        AGENT_TRIGGER_KIT_OUTCOME_DISABLED: '1',
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const report = JSON.parse(stdout);

  const finding = assertFinding(report, `scratch.residue_group.${scratchGroupId(tmpRoot)}`);
  const expectedPaths = Array.from({ length: 120 }, (_, index) =>
    join(tmpRoot, `agent-trigger-kit-large-${String(index).padStart(3, '0')}`),
  ).sort();

  assert.equal(report.findings.length, 1);
  assert.equal(finding.category, 'scratch');
  assert.equal(finding.severity, 'actionable');
  assert.equal(finding.details.tmp_root, tmpRoot);
  assert.equal(finding.details.count, 120);
  assert.deepEqual(finding.details.sample_paths, expectedPaths.slice(0, SCRATCH_SAMPLE_LIMIT));
  assert.equal(finding.details.omitted_count, 120 - SCRATCH_SAMPLE_LIMIT);
  assert.equal(finding.details.has_permission_restricted_paths, false);
  assert.equal(finding.details.command_omitted_reason, null);
  assert.deepEqual(finding.suggested_commands, expectedRmCommands(expectedPaths));
});

test('audit-cleanup omits grouped cleanup commands when any scratch path is restricted', (t) => {
  if (typeof process.getuid !== 'function') {
    return t.skip('process.getuid is unavailable on this platform');
  }

  const root = initRepo(t);
  const tmpRoot = makeTempDir(t, 'agent-trigger-kit-audit-group-restricted-tmp-');
  let restrictedPath = null;

  for (let index = 0; index < SCRATCH_GROUP_THRESHOLD + 1; index += 1) {
    const path = join(tmpRoot, `agent-trigger-kit-group-${String(index).padStart(3, '0')}`);
    mkdirSync(path, { recursive: true });
    if (index === 0) {
      restrictedPath = path;
      chmodSync(path, 0o000);
    }
  }
  t.after(() => {
    try {
      chmodSync(restrictedPath, 0o700);
    } catch {
      // Best-effort cleanup for a temp fixture that may already be gone.
    }
  });

  const report = runAuditJson(t, root, ['--tmp-root', tmpRoot]);
  const finding = assertFinding(report, `scratch.residue_group.${scratchGroupId(tmpRoot)}`);

  assert.equal(report.findings.length, 1);
  assert.equal(finding.details.count, SCRATCH_GROUP_THRESHOLD + 1);
  assert.equal(finding.details.has_permission_restricted_paths, true);
  assert.deepEqual(finding.suggested_commands, []);
  assert.equal(
    finding.details.command_omitted_reason,
    SCRATCH_COMMAND_OMITTED_PERMISSION_RESTRICTED,
  );
});

test('audit-cleanup reports remote prune dry-run candidates against a local bare remote', (t) => {
  const root = initRepo(t);
  const remote = initBareRemote(t);
  git(root, ['remote', 'add', 'origin', remote]);
  git(root, ['push', '-u', 'origin', 'main']);
  git(root, ['checkout', '-b', 'stale-remote']);
  commitFile(root, 'remote.txt', 'stale remote ref\n', 'stale remote branch');
  git(root, ['push', '-u', 'origin', 'stale-remote']);
  git(root, ['checkout', 'main']);
  git(root, ['push', 'origin', ':stale-remote']);
  git(root, [
    'update-ref',
    'refs/remotes/origin/stale-remote',
    git(root, ['rev-parse', 'stale-remote']).stdout.trim(),
  ]);

  const report = runAuditJson(t, root);
  const finding = assertFinding(report, 'remote.prune_candidate.origin/stale-remote');

  assert.equal(finding.category, 'remote');
  assert.equal(finding.severity, 'actionable');
  assert.deepEqual(finding.suggested_commands, ['git fetch --prune origin']);
});

test('audit-cleanup human output starts with title and prints suggested commands', (t) => {
  const root = initRepo(t);
  const homeDir = makeHome(t);
  git(root, ['checkout', '-b', 'merged-cleanup']);
  commitFile(root, 'merged.txt', 'merged work\n', 'merged work');
  git(root, ['checkout', 'main']);
  git(root, ['merge', '--no-ff', 'merged-cleanup', '-m', 'merge cleanup branch']);

  const result = runCli(
    [
      'audit-cleanup',
      '--root',
      root,
      '--base',
      'main',
      '--tmp-root',
      makeTempDir(t, 'agent-trigger-kit-audit-empty-tmp-'),
    ],
    { t, homeDir },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /^Audit cleanup/);
  assert.match(result.stdout, /branch\.merged\.merged-cleanup/);
  assert.match(result.stdout, /suggested: git branch -d merged-cleanup/);
});

test('audit-cleanup default base honors valid remote HEAD before remote main', (t) => {
  const source = initRepo(t);
  const remote = initBareRemote(t);
  git(source, ['remote', 'add', 'origin', remote]);
  git(source, ['push', '-u', 'origin', 'main']);
  git(source, ['checkout', '-b', 'trunk']);
  commitFile(source, 'trunk.txt', 'trunk work\n', 'trunk work');
  git(source, ['push', '-u', 'origin', 'trunk']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);

  const clone = makeTempDir(t, 'agent-trigger-kit-audit-clone-');
  git(clone, ['clone', remote, '.']);
  git(clone, ['checkout', '--detach', 'origin/trunk']);
  if (git(clone, ['branch', '--list', 'main']).stdout.trim()) {
    git(clone, ['branch', '-D', 'main']);
  }

  const result = runCli(
    [
      'audit-cleanup',
      '--root',
      clone,
      '--json',
      '--tmp-root',
      makeTempDir(t, 'agent-trigger-kit-audit-empty-tmp-'),
    ],
    { t },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.base, 'origin/trunk');
  assert.equal(report.status, 'completed');
});

test('audit-cleanup default base skips stale remote HEAD and falls back to remote main', (t) => {
  const source = initRepo(t);
  const remote = initBareRemote(t);
  git(source, ['remote', 'add', 'origin', remote]);
  git(source, ['push', '-u', 'origin', 'main']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  const clone = makeTempDir(t, 'agent-trigger-kit-audit-clone-');
  git(clone, ['clone', remote, '.']);
  git(clone, ['checkout', '--detach', 'origin/main']);
  git(clone, ['branch', '-D', 'main']);
  git(clone, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/missing']);
  git(clone, ['rev-parse', '--verify', 'origin/main^{commit}']);

  const result = runCli(
    [
      'audit-cleanup',
      '--root',
      clone,
      '--json',
      '--tmp-root',
      makeTempDir(t, 'agent-trigger-kit-audit-empty-tmp-'),
    ],
    { t },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.base, 'origin/main');
  assert.equal(report.status, 'completed');
});

test('audit-cleanup default base falls back to configured remote main without remote HEAD', (t) => {
  const source = initRepo(t);
  const remote = initBareRemote(t);
  git(source, ['remote', 'add', 'upstream', remote]);
  git(source, ['push', '-u', 'upstream', 'main']);
  git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  const clone = makeTempDir(t, 'agent-trigger-kit-audit-clone-');
  git(clone, ['clone', '--origin', 'upstream', remote, '.']);
  git(clone, ['checkout', '--detach', 'upstream/main']);
  git(clone, ['branch', '-D', 'main']);
  git(clone, ['symbolic-ref', '--delete', 'refs/remotes/upstream/HEAD']);
  git(clone, ['rev-parse', '--verify', 'upstream/main^{commit}']);

  const result = runCli(
    [
      'audit-cleanup',
      '--root',
      clone,
      '--remote',
      'upstream',
      '--json',
      '--tmp-root',
      makeTempDir(t, 'agent-trigger-kit-audit-empty-tmp-'),
    ],
    { t },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.base, 'upstream/main');
  assert.equal(report.status, 'completed');
});

test('audit-cleanup emits branch warnings when branch-level git checks fail', (t) => {
  const root = initRepo(t);
  git(root, ['checkout', '--orphan', 'orphan-work']);
  commitFile(root, 'orphan.txt', 'orphan work\n', 'orphan branch work');
  git(root, ['checkout', 'main']);

  const report = runAuditJson(t, root);
  const warning = report.warnings.find(
    (candidate) =>
      candidate.details?.branch === 'orphan-work' &&
      candidate.details.operation === 'git merge-base main orphan-work',
  );

  assert.ok(warning, JSON.stringify(report.warnings, null, 2));
  assert.equal(warning.id, 'branch.check_failed.orphan-work.merge_base');
  assert.match(warning.message, /Branch check failed/);
  assert.equal(warning.details.branch, 'orphan-work');
  assert.equal(typeof warning.details.stdout, 'string');
  assert.equal(typeof warning.details.stderr, 'string');
});

test('audit-cleanup is read-only for refs, outcome events, and scratch children', (t) => {
  const root = initRepo(t);
  const homeDir = makeHome(t);
  const tmpRoot = makeTempDir(t, 'agent-trigger-kit-audit-readonly-tmp-');
  const residue = join(tmpRoot, 'agent-trigger-kit-readonly-residue');
  mkdirSync(residue, { recursive: true });
  recordOutcomeEvent({
    root,
    homeDir,
    surface: 'repo',
    verb: 'validate',
    outcome: 'success',
    exitCode: 0,
    now: new Date('2026-05-23T08:00:00.000Z'),
  });

  const store = outcomeStorePath({ root, homeDir, store: 'user' });
  const refsBefore = snapshotRefs(root);
  const eventsBefore = readFileSync(store.eventsPath, 'utf8');
  const tmpChildrenBefore = readdirSync(tmpRoot).sort();

  const report = runAuditJson(t, root, ['--tmp-root', tmpRoot], { homeDir });

  assert.equal(report.status, 'completed');
  assert.equal(snapshotRefs(root), refsBefore);
  assert.equal(readFileSync(store.eventsPath, 'utf8'), eventsBefore);
  assert.deepEqual(readdirSync(tmpRoot).sort(), tmpChildrenBefore);
});
