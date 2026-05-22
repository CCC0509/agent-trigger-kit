import { spawnSync } from 'node:child_process';

export function normalizeGitPath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function runGit({ root, args }) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error) {
    return {
      ok: false,
      missingGit: result.error.code === 'ENOENT',
      message: result.error.message,
      stdout: '',
      stderr: '',
    };
  }
  return {
    ok: result.status === 0,
    missingGit: false,
    message: result.stderr || result.stdout,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function shallowFetchHint(operation, details = '') {
  return `${operation} failed. Run git fetch --unshallow or use fetch-depth: 0 before running --require-version-bump.${details ? ` ${details.trim()}` : ''}`;
}

export function showFile({ root, ref, path }) {
  const result = runGit({ root, args: ['show', `${ref}:${path}`] });
  if (!result.ok) return null;
  return result.stdout;
}

export function mergeBase({ root, base, head = 'HEAD' }) {
  return runGit({ root, args: ['merge-base', base, head] });
}

export function changedFiles({ root, base, head = 'HEAD' }) {
  const result = runGit({ root, args: ['diff', '--name-only', `${base}...${head}`] });
  if (!result.ok) return result;
  return {
    ...result,
    files: result.stdout
      .split('\n')
      .map((path) => path.trim())
      .filter(Boolean)
      .map(normalizeGitPath),
  };
}

export function isAncestor({ root, ancestor, descendant = 'HEAD' }) {
  return runGit({ root, args: ['merge-base', '--is-ancestor', ancestor, descendant] });
}
