import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';

import { runGit } from './git-base.mjs';
import { listOutcomeEvents } from './outcome-recorder.mjs';

export const AUDIT_CLEANUP_SCHEMA_VERSION = 1;
export const DEFAULT_MERGE_BASE_AGE_DAYS = 7;
export const DEFAULT_REMOTE = 'origin';
export const SCRATCH_GROUP_THRESHOLD = 100;
export const SCRATCH_SAMPLE_LIMIT = 20;
export const SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT = 200;
export const SCRATCH_COMMAND_CHUNK_SIZE = 50;
export const SCRATCH_COMMAND_OMITTED_TOO_MANY_PATHS = 'too_many_explicit_paths';
export const SCRATCH_COMMAND_OMITTED_PERMISSION_RESTRICTED =
  'permission_restricted_paths_require_manual_review';

const DAY_MS = 24 * 60 * 60 * 1000;
const REMOTE_PRUNE_TIMEOUT_MS = 3000;
const SCRATCH_PREFIX = 'agent-trigger-kit-';

assertScratchConstants();

export function runAuditCleanup(options = {}) {
  const now = options.now || new Date();
  const cwd = options.cwd || process.cwd();
  const root = resolve(cwd, options.root || '.');
  const remote = options.remote || DEFAULT_REMOTE;
  const mergeBaseAgeDays = options.mergeBaseAgeDays ?? DEFAULT_MERGE_BASE_AGE_DAYS;
  const homeDir = options.homeDir || homedir();
  const tmpRoots = normalizeTmpRoots(options.tmpRoots);
  const base = options.base || discoverDefaultBase({ root, remote });
  const report = baseReport({
    root,
    base,
    remote,
    mergeBaseAgeDays,
    tmpRoots,
    generatedAt: now.toISOString(),
  });

  const repoCheck = runGit({ root, args: ['rev-parse', '--show-toplevel'] });
  if (!repoCheck.ok) {
    return failRequiredRepoOperation(report, 'git rev-parse --show-toplevel', repoCheck);
  }

  const baseCheck = runGit({ root, args: ['rev-parse', '--verify', `${base}^{commit}`] });
  if (!baseCheck.ok) {
    return failRequiredRepoOperation(report, `git rev-parse --verify ${base}^{commit}`, baseCheck);
  }
  const baseCommit = baseCheck.stdout.trim();

  addOutcomeFindings({ report, root, homeDir });

  const branchResult = addBranchFindings({
    report,
    root,
    base,
    baseCommit,
    remote,
    mergeBaseAgeDays,
    now,
  });
  if (!branchResult.ok)
    return failRequiredRepoOperation(report, branchResult.operation, branchResult.result);

  addRemoteFindings({ report, root, remote });
  addScratchFindings({ report, root, cwd, homeDir, tmpRoots });

  report.status = 'completed';
  report.exit_code = 0;
  return { exitCode: 0, report };
}

function baseReport({ root, base, remote, mergeBaseAgeDays, tmpRoots, generatedAt }) {
  return {
    schema_version: AUDIT_CLEANUP_SCHEMA_VERSION,
    kind: 'audit_cleanup',
    generated_at: generatedAt,
    status: 'running',
    exit_code: 0,
    root,
    base,
    remote,
    merge_base_age_days: mergeBaseAgeDays,
    tmp_roots: tmpRoots,
    findings: [],
    warnings: [],
  };
}

function failRequiredRepoOperation(report, operation, result) {
  report.status = 'failed';
  report.exit_code = 1;
  report.error = {
    operation,
    message: result?.message || result?.stderr || result?.stdout || 'required git operation failed',
    stdout: result?.stdout || '',
    stderr: result?.stderr || '',
  };
  return { exitCode: 1, report };
}

function discoverDefaultBase({ root, remote }) {
  const localMain = runGit({
    root,
    args: ['rev-parse', '--verify', '--quiet', 'refs/heads/main^{commit}'],
  });
  if (localMain.ok) return 'main';

  const symbolic = runGit({
    root,
    args: ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
  });
  const ref = symbolic.stdout?.trim();
  if (symbolic.ok && ref?.startsWith(`${remote}/`)) {
    const remoteHead = runGit({
      root,
      args: ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
    });
    if (remoteHead.ok) return ref;
  }

  const remoteMain = runGit({
    root,
    args: ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/main^{commit}`],
  });
  if (remoteMain.ok) return `${remote}/main`;

  return 'main';
}

function addOutcomeFindings({ report, root, homeDir }) {
  try {
    const listing = listOutcomeEvents({
      root,
      homeDir,
      store: 'user',
      recent: Number.MAX_SAFE_INTEGER,
      unmarked: true,
    });
    for (const event of listing.events) {
      report.findings.push(
        finding({
          id: `outcome.unmarked.${event.short_id}`,
          category: 'outcome',
          severity: 'actionable',
          summary: `Outcome event ${event.short_id} is unmarked.`,
          details: {
            event_id: event.id,
            short_id: event.short_id,
            ts: event.ts,
            verb: event.verb,
            outcome: event.outcome,
            surface: event.surface,
            failure_category: event.failure_category,
            failure_driver: event.failure_driver,
          },
          suggested_commands: [buildOutcomeMarkCommand({ root, event })],
          requires_human_judgment: true,
        }),
      );
    }
  } catch (error) {
    report.findings.push(
      finding({
        id: 'outcome.unreadable_store',
        category: 'outcome',
        severity: 'warning',
        summary: 'Outcome store could not be inspected.',
        details: serializeError(error),
        suggested_commands: [],
        requires_human_judgment: true,
      }),
    );
  }
}

function buildOutcomeMarkCommand({ root, event }) {
  const parts = [
    'agent-trigger-kit outcome mark --root',
    shellQuote(root),
    event.id,
    '--outcome',
    event.outcome,
  ];
  if (event.outcome === 'failure') {
    if (event.failure_category) parts.push('--failure-category', event.failure_category);
    if (event.failure_driver) parts.push('--failure-driver', event.failure_driver);
  }
  parts.push('--note', '"reviewed during audit-cleanup"');
  return parts.join(' ');
}

function addBranchFindings({ report, root, base, baseCommit, remote, mergeBaseAgeDays, now }) {
  const refsResult = runGit({
    root,
    args: [
      'for-each-ref',
      '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track)',
      'refs/heads',
    ],
  });
  if (!refsResult.ok) {
    return { ok: false, operation: 'git for-each-ref refs/heads', result: refsResult };
  }

  const mergedResult = runGit({
    root,
    args: ['branch', '--format=%(refname:short)', '--merged', base],
  });
  if (!mergedResult.ok) {
    return { ok: false, operation: `git branch --merged ${base}`, result: mergedResult };
  }

  const mergedBranches = new Set(splitLines(mergedResult.stdout));
  const branches = parseBranchRows(refsResult.stdout);

  for (const branch of branches) {
    if (branch.isCurrent || isBaseBranch(branch.name, base, remote)) continue;

    if (mergedBranches.has(branch.name)) {
      report.findings.push(mergedBranchFinding({ branch: branch.name, base }));
      continue;
    }

    if (branch.upstream && upstreamIsGone(branch)) {
      report.findings.push(
        upstreamMissingFinding({ branch: branch.name, upstream: branch.upstream }),
      );
      continue;
    }

    if (!branch.upstream) {
      report.findings.push(noUpstreamFinding({ branch: branch.name, base }));
    }

    const mergeBase = branchMergeBase({ root, base, branch: branch.name, now });
    if (!mergeBase.ok) {
      report.warnings.push(
        branchCheckWarning({
          branch: branch.name,
          check: mergeBase.check,
          operation: mergeBase.operation,
          result: mergeBase.result,
        }),
      );
    } else if (mergeBase.sha !== baseCommit && mergeBase.ageDays >= mergeBaseAgeDays) {
      report.findings.push(
        staleMergeBaseFinding({
          branch: branch.name,
          base,
          mergeBase,
          thresholdDays: mergeBaseAgeDays,
        }),
      );
    }

    const cherryOperation = `git cherry ${base} ${branch.name}`;
    const cherry = runGit({ root, args: ['cherry', base, branch.name] });
    if (!cherry.ok) {
      report.warnings.push(
        branchCheckWarning({
          branch: branch.name,
          check: 'cherry',
          operation: cherryOperation,
          result: cherry,
        }),
      );
      continue;
    }
    const cherryLines = splitLines(cherry.stdout);
    if (cherryLines.length > 0 && cherryLines.every((line) => line.startsWith('-'))) {
      report.findings.push(cherryNoopFinding({ branch: branch.name, base, lines: cherryLines }));
    }
  }

  return { ok: true };
}

function parseBranchRows(stdout) {
  return splitLines(stdout).map((line) => {
    const [name, headMarker = '', upstream = '', tracking = ''] = line.split('\t');
    return {
      name,
      isCurrent: headMarker === '*',
      upstream,
      tracking,
    };
  });
}

function upstreamIsGone(branch) {
  return branch.tracking.includes('[gone]');
}

function branchMergeBase({ root, base, branch, now }) {
  const operation = `git merge-base ${base} ${branch}`;
  const mergeBase = runGit({ root, args: ['merge-base', base, branch] });
  if (!mergeBase.ok) {
    return { ok: false, check: 'merge_base', operation, result: mergeBase };
  }
  const sha = mergeBase.stdout.trim();
  const timestampOperation = `git show -s --format=%ct ${sha}`;
  const timestamp = runGit({ root, args: ['show', '-s', '--format=%ct', sha] });
  if (!timestamp.ok) {
    return {
      ok: false,
      check: 'merge_base_timestamp',
      operation: timestampOperation,
      result: timestamp,
    };
  }
  const seconds = Number(timestamp.stdout.trim());
  if (!Number.isFinite(seconds)) {
    return {
      ok: false,
      check: 'merge_base_timestamp',
      operation: timestampOperation,
      result: {
        ok: false,
        stdout: timestamp.stdout,
        stderr: timestamp.stderr,
        message: `invalid merge-base timestamp: ${timestamp.stdout.trim()}`,
      },
    };
  }
  const date = new Date(seconds * 1000);
  const ageDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / DAY_MS));
  return {
    ok: true,
    sha,
    date: date.toISOString(),
    ageDays,
  };
}

function mergedBranchFinding({ branch, base }) {
  return finding({
    id: `branch.merged.${branch}`,
    category: 'branch',
    severity: 'actionable',
    summary: `Local branch ${branch} is already merged into ${base}.`,
    details: { branch, base },
    suggested_commands: [`git branch -d ${shellQuote(branch)}`],
    requires_human_judgment: true,
  });
}

function upstreamMissingFinding({ branch, upstream }) {
  return finding({
    id: `branch.upstream_missing.${branch}`,
    category: 'branch',
    severity: 'actionable',
    summary: `Local branch ${branch} tracks missing upstream ${upstream}.`,
    details: { branch, upstream },
    suggested_commands: [`git branch --unset-upstream ${shellQuote(branch)}`],
    requires_human_judgment: true,
  });
}

function noUpstreamFinding({ branch, base }) {
  return finding({
    id: `branch.no_upstream.${branch}`,
    category: 'branch',
    severity: 'info',
    summary: `Local branch ${branch} has no configured upstream.`,
    details: { branch, base },
    suggested_commands: [`git log --oneline --decorate ${shellQuote(`${base}..${branch}`)}`],
    requires_human_judgment: true,
  });
}

function staleMergeBaseFinding({ branch, base, mergeBase, thresholdDays }) {
  return finding({
    id: `branch.stale_merge_base.${branch}`,
    category: 'branch',
    severity: 'warning',
    summary: `Local branch ${branch} diverged from ${base} ${mergeBase.ageDays} days ago.`,
    details: {
      branch,
      base,
      merge_base: mergeBase.sha,
      merge_base_date: mergeBase.date,
      merge_base_age_days: mergeBase.ageDays,
      threshold_days: thresholdDays,
    },
    suggested_commands: [`git log --oneline --decorate ${shellQuote(`${base}..${branch}`)}`],
    requires_human_judgment: true,
  });
}

function branchCheckWarning({ branch, check, operation, result }) {
  return {
    id: `branch.check_failed.${branch}.${check}`,
    category: 'branch',
    severity: 'warning',
    summary: `Branch check failed for ${branch}.`,
    message: `Branch check failed for ${branch}: ${operation}`,
    details: {
      branch,
      operation,
      stdout: result?.stdout || '',
      stderr: result?.stderr || '',
      message: result?.message || result?.stderr || result?.stdout || 'branch check failed',
    },
  };
}

function cherryNoopFinding({ branch, base, lines }) {
  return finding({
    id: `branch.cherry_noop.${branch}`,
    category: 'branch',
    severity: 'actionable',
    summary: `Local branch ${branch} appears patch-equivalent to ${base}.`,
    details: { branch, base, cherry_output: lines },
    suggested_commands: [`git cherry ${shellQuote(base)} ${shellQuote(branch)}`],
    requires_human_judgment: true,
  });
}

function addRemoteFindings({ report, root, remote }) {
  const result = spawnSync('git', ['remote', 'prune', '--dry-run', remote], {
    cwd: root,
    encoding: 'utf8',
    timeout: REMOTE_PRUNE_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    report.warnings.push({
      id: 'remote.prune_unavailable',
      category: 'remote',
      severity: 'warning',
      summary: `Remote ${remote} could not be inspected with prune dry-run.`,
      details: {
        remote,
        stdout: result.stdout || '',
        stderr: result.error ? result.error.message : result.stderr || '',
      },
    });
    return;
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  for (const line of splitLines(output)) {
    const match = line.match(/\[would prune\]\s+(.+)$/);
    if (!match) continue;
    const ref = match[1].trim();
    report.findings.push(
      finding({
        id: `remote.prune_candidate.${ref}`,
        category: 'remote',
        severity: 'actionable',
        summary: `Remote-tracking ref ${ref} would be pruned from ${remote}.`,
        details: { remote, ref },
        suggested_commands: [`git fetch --prune ${shellQuote(remote)}`],
        requires_human_judgment: true,
      }),
    );
  }
}

function addScratchFindings({ report, root, cwd, homeDir, tmpRoots }) {
  const excluded = new Set(
    [root, cwd, homeDir].map((path) => safeRealPath(path)).filter((path) => path !== null),
  );

  for (const tmpRoot of tmpRoots) {
    let candidates;
    try {
      candidates = collectScratchCandidates({ tmpRoot, excluded });
    } catch (error) {
      report.warnings.push({
        id: `scratch.tmp_root_unreadable.${safeId(tmpRoot)}`,
        category: 'scratch',
        severity: 'warning',
        summary: `Temp root ${tmpRoot} could not be inspected.`,
        details: serializeError(error),
      });
      continue;
    }

    if (candidates.length > SCRATCH_GROUP_THRESHOLD) {
      report.findings.push(groupScratchCandidates({ tmpRoot, candidates }));
    } else {
      for (const candidate of sortScratchCandidates(candidates)) {
        report.findings.push(individualScratchFinding(candidate));
      }
    }
  }
}

function collectScratchCandidates({ tmpRoot, excluded }) {
  const entries = readdirSync(tmpRoot, { withFileTypes: true });
  const candidates = [];

  for (const entry of entries) {
    if (!entry.name.startsWith(SCRATCH_PREFIX)) continue;
    const path = resolve(tmpRoot, entry.name);
    const realPath = safeRealPath(path) || path;
    if (excluded.has(realPath)) continue;

    candidates.push({
      path,
      real_path: realPath,
      tmp_root: tmpRoot,
      name: entry.name,
      permission_restricted: isPermissionRestrictedScratchPath(path),
    });
  }

  return candidates;
}

function individualScratchFinding(candidate) {
  return finding({
    id: `scratch.residue.${candidate.name}`,
    category: 'scratch',
    severity: 'actionable',
    summary: `Temp scratch path ${candidate.path} looks like Agent Trigger Kit residue.`,
    details: {
      path: candidate.path,
      tmp_root: candidate.tmp_root,
      name: candidate.name,
      permission_restricted: candidate.permission_restricted,
    },
    suggested_commands: [scratchRemovalCommand(candidate)],
    requires_human_judgment: true,
  });
}

function scratchRemovalCommand(candidate) {
  if (candidate.permission_restricted) {
    return `chmod -R u+rwX ${shellQuote(candidate.path)} && rm -rf ${shellQuote(candidate.path)}`;
  }
  return `rm -rf ${shellQuote(candidate.path)}`;
}

function isPermissionRestrictedScratchPath(path) {
  if (typeof process.getuid !== 'function') return false;

  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return false;
  }

  if (!stat.isDirectory()) return false;
  if (stat.uid !== process.getuid()) return false;

  return (stat.mode & 0o700) !== 0o700;
}

export function scratchGroupId(tmpRoot) {
  return createHash('sha256').update(String(tmpRoot)).digest('hex').slice(0, 16);
}

export function groupScratchCandidates({ tmpRoot, candidates }) {
  const sortedCandidates = sortScratchCandidates(candidates);
  const { suggested_commands, command_omitted_reason } =
    scratchGroupCommandResult(sortedCandidates);
  const samplePaths = sortedCandidates
    .slice(0, SCRATCH_SAMPLE_LIMIT)
    .map((candidate) => candidate.path);

  return finding({
    id: `scratch.residue_group.${scratchGroupId(tmpRoot)}`,
    category: 'scratch',
    severity: 'actionable',
    summary: `${sortedCandidates.length} temp scratch paths under ${tmpRoot} look like Agent Trigger Kit residue.`,
    details: {
      tmp_root: tmpRoot,
      count: sortedCandidates.length,
      sample_paths: samplePaths,
      omitted_count: sortedCandidates.length - samplePaths.length,
      has_permission_restricted_paths: sortedCandidates.some(
        (candidate) => candidate.permission_restricted,
      ),
      command_omitted_reason,
    },
    suggested_commands,
    requires_human_judgment: true,
  });
}

function scratchGroupCommandResult(candidates) {
  if (candidates.some((candidate) => candidate.permission_restricted)) {
    return {
      suggested_commands: [],
      command_omitted_reason: SCRATCH_COMMAND_OMITTED_PERMISSION_RESTRICTED,
    };
  }

  if (candidates.length > SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT) {
    return {
      suggested_commands: [],
      command_omitted_reason: SCRATCH_COMMAND_OMITTED_TOO_MANY_PATHS,
    };
  }

  return {
    suggested_commands: chunkScratchCandidates(candidates).map(
      (chunk) => `rm -rf ${chunk.map((candidate) => shellQuote(candidate.path)).join(' ')}`,
    ),
    command_omitted_reason: null,
  };
}

function sortScratchCandidates(candidates) {
  return [...candidates].sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });
}

function chunkScratchCandidates(candidates) {
  const chunks = [];
  for (let index = 0; index < candidates.length; index += SCRATCH_COMMAND_CHUNK_SIZE) {
    chunks.push(candidates.slice(index, index + SCRATCH_COMMAND_CHUNK_SIZE));
  }
  return chunks;
}

function normalizeTmpRoots(tmpRoots) {
  const roots = tmpRoots?.length ? tmpRoots : [tmpdir(), '/private/tmp'];
  return [...new Set(roots.map((root) => resolve(root)))];
}

function isBaseBranch(branch, base, remote) {
  const candidates = new Set([base, base.replace(/^refs\/heads\//, '')]);
  if (base.startsWith(`${remote}/`)) candidates.add(base.slice(remote.length + 1));
  return candidates.has(branch);
}

function finding({
  id,
  category,
  severity,
  summary,
  details,
  suggested_commands,
  requires_human_judgment,
}) {
  return {
    id,
    category,
    severity,
    summary,
    details,
    suggested_commands,
    requires_human_judgment,
  };
}

function splitLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function safeRealPath(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function safeId(value) {
  const name = basename(String(value)) || String(value);
  return name.replace(/[^A-Za-z0-9._/-]+/g, '_');
}

function assertScratchConstants() {
  if (SCRATCH_GROUP_THRESHOLD >= SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT) {
    throw new Error(
      'SCRATCH_GROUP_THRESHOLD must be lower than SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT',
    );
  }
  if (SCRATCH_COMMAND_CHUNK_SIZE > SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT) {
    throw new Error(
      'SCRATCH_COMMAND_CHUNK_SIZE must not exceed SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT',
    );
  }
  if (SCRATCH_SAMPLE_LIMIT > SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT) {
    throw new Error('SCRATCH_SAMPLE_LIMIT must not exceed SCRATCH_EXPLICIT_COMMAND_PATH_LIMIT');
  }
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || null,
    message: error?.message || String(error),
  };
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
