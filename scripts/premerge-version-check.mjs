#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { changedFiles, isAncestor, shallowFetchHint, showFile } from './lib/git-base.mjs';
import { sourceVisibleChangedFiles } from './lib/source-plugin-visible.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2), { booleanKeys: ['json'] });
const root = normalize(args.root || process.cwd());
const base = typeof args.base === 'string' ? args.base.trim() : '';
const pluginName = typeof args.plugin === 'string' ? args.plugin.trim() : 'agent-trigger-kit';
const jsonOutput = args.json === true;

const CHECK_PRIORITY = [
  'source-version-consistency',
  'base-reconciliation',
  'changelog-head-alignment',
  'plugin-visible-version-bump',
];
const CLEAN_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

if (!base) {
  console.error('--base is required; pass --base origin/main or the target merge base');
  process.exit(2);
}

function passed(name, reason, details = {}) {
  return { name, status: 'passed', reason, details };
}

function failed(name, reason, details = {}) {
  return { name, status: 'failed', reason, details };
}

function skipped(name, prerequisite) {
  return {
    name,
    status: 'skipped',
    reason: `requires ${prerequisite}`,
    details: {},
  };
}

function printAndExit(checks) {
  const failedNames = new Set(
    checks.filter((check) => check.status === 'failed').map((check) => check.name),
  );
  const exitReason = CHECK_PRIORITY.find((name) => failedNames.has(name)) || null;
  const overallStatus = exitReason ? 'failed' : 'passed';
  const payload = { checks, overallStatus, exitReason };

  if (jsonOutput) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (overallStatus === 'passed') {
    console.log('premerge version check passed');
  } else {
    for (const check of checks.filter((entry) => entry.status === 'failed')) {
      console.error(`${check.name}: ${check.reason}`);
      if (Object.keys(check.details).length > 0) {
        console.error(JSON.stringify(check.details, null, 2));
      }
    }
  }

  process.exit(overallStatus === 'passed' ? 0 : 1);
}

function premergeFetchHint(operation, details = '') {
  return shallowFetchHint(operation, details, { command: 'ops:premerge-version-check' });
}

function checkSourceVersionConsistency() {
  const result = spawnSync(
    process.execPath,
    [
      join(scriptDir, 'check-plugin-version.mjs'),
      '--root',
      root,
      '--surface',
      'source',
      '--json',
      pluginName,
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    return failed('source-version-consistency', 'source version checker failed', {
      exitCode: result.status,
      stderr: result.stderr.trim(),
    });
  }

  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    return failed('source-version-consistency', 'source version checker did not return JSON', {
      message: error.message,
    });
  }

  if (!payload.expectedVersion || payload.versionMismatch) {
    return failed('source-version-consistency', 'source versions differ', {
      expectedVersion: payload.expectedVersion || null,
      sourceVersions: payload.sourceVersions || [],
    });
  }

  return passed('source-version-consistency', 'source versions are aligned', {
    expectedVersion: payload.expectedVersion,
    sourceVersions: payload.sourceVersions || [],
  });
}

function checkBaseReconciliation() {
  const result = isAncestor({ root, ancestor: base, descendant: 'HEAD' });
  if (!result.ok) {
    return failed('base-reconciliation', 'base is not an ancestor of HEAD', {
      base,
      hint: premergeFetchHint(`git merge-base --is-ancestor ${base} HEAD`, result.message),
    });
  }
  return passed('base-reconciliation', 'base is an ancestor of HEAD', { base });
}

function changelogHeadVersion() {
  const path = join(root, 'CHANGELOG.md');
  if (!existsSync(path)) {
    return { error: 'CHANGELOG.md is missing' };
  }

  const changelog = readFileSync(path, 'utf8');
  const heading = changelog.match(/^##\s+(.+)$/m)?.[1]?.trim();
  if (!heading) {
    return { error: 'CHANGELOG.md has no release heading' };
  }
  if (/^Unreleased$/i.test(heading)) {
    return { error: 'CHANGELOG.md must not use ## Unreleased as the first release heading' };
  }
  if (!CLEAN_SEMVER_RE.test(heading)) {
    return { error: `CHANGELOG.md head must be clean SemVer x.y.z: ${heading}` };
  }
  return { version: heading };
}

function checkChangelogHeadAlignment(sourceCheck) {
  if (sourceCheck.status !== 'passed' || !sourceCheck.details.expectedVersion) {
    return skipped('changelog-head-alignment', 'source-version-consistency');
  }

  const head = changelogHeadVersion();
  if (head.error) {
    return failed('changelog-head-alignment', head.error);
  }
  if (head.version !== sourceCheck.details.expectedVersion) {
    return failed(
      'changelog-head-alignment',
      `CHANGELOG.md head ${head.version} does not match source version ${sourceCheck.details.expectedVersion}`,
      { changelogVersion: head.version, expectedVersion: sourceCheck.details.expectedVersion },
    );
  }
  return passed('changelog-head-alignment', 'changelog head matches source version', {
    version: head.version,
  });
}

function parseJsonText(label, text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: null, error: `${label}: invalid JSON (${error.message})` };
  }
}

function marketplaceEntry(json, name) {
  return (json?.plugins || []).find((plugin) => plugin?.name === name) || null;
}

function pluginDirFromEntry(entry, surface) {
  const sourcePath = surface === 'codex' ? entry?.source?.path : entry?.source;
  return typeof sourcePath === 'string' ? sourcePath.replace(/^\.\//, '') : '';
}

function packageNameMatchesPlugin(packageName, name) {
  return packageName === name || packageName?.endsWith(`/${name}`);
}

function readJsonAtRef(ref, path) {
  const text = showFile({ root, ref, path });
  if (!text) return { value: null, error: `${ref}: missing ${path}` };
  return parseJsonText(`${ref}:${path}`, text);
}

function pluginVersionSnapshot(ref) {
  const errors = [];
  const versions = [];
  const packageJson = readJsonAtRef(ref, 'package.json');
  const codexMarketplace = readJsonAtRef(ref, '.agents/plugins/marketplace.json');
  const claudeMarketplace = readJsonAtRef(ref, '.claude-plugin/marketplace.json');

  for (const result of [packageJson, codexMarketplace, claudeMarketplace]) {
    if (result.error) errors.push(result.error);
  }

  const codexEntry = marketplaceEntry(codexMarketplace.value, pluginName);
  const claudeEntry = marketplaceEntry(claudeMarketplace.value, pluginName);
  const pluginDir =
    pluginDirFromEntry(codexEntry, 'codex') || pluginDirFromEntry(claudeEntry, 'claude');

  if (codexEntry?.version) versions.push(codexEntry.version);
  else errors.push(`${ref}: missing Codex marketplace entry version for ${pluginName}`);

  if (claudeEntry?.version) versions.push(claudeEntry.version);
  else errors.push(`${ref}: missing Claude marketplace entry version for ${pluginName}`);

  if (packageNameMatchesPlugin(packageJson.value?.name, pluginName)) {
    if (packageJson.value?.version) versions.push(packageJson.value.version);
    else errors.push(`${ref}: missing package.json version for ${pluginName}`);
  }

  if (!pluginDir) {
    errors.push(`${ref}: missing plugin source path for ${pluginName}`);
  } else {
    for (const [label, path] of [
      ['Codex plugin manifest', `${pluginDir}/.codex-plugin/plugin.json`],
      ['Claude plugin manifest', `${pluginDir}/.claude-plugin/plugin.json`],
    ]) {
      const manifest = readJsonAtRef(ref, path);
      if (manifest.error) errors.push(manifest.error);
      if (manifest.value?.version) versions.push(manifest.value.version);
      else errors.push(`${ref}: missing ${label} version at ${path}`);
    }
  }

  const uniqueVersions = new Set(versions);
  if (errors.length > 0 || uniqueVersions.size !== 1) {
    return {
      version: null,
      error: `${ref}: cannot determine aligned plugin version for ${pluginName}${
        errors.length > 0 ? ` (${errors.join('; ')})` : ''
      }`,
    };
  }

  return { version: versions[0], error: null };
}

function parseCleanSemver(version) {
  const match = CLEAN_SEMVER_RE.exec(version || '');
  if (!match) return null;
  return match.slice(1).map(Number);
}

function compareCleanSemver(leftVersion, rightVersion) {
  const left = parseCleanSemver(leftVersion);
  const right = parseCleanSemver(rightVersion);
  if (!left || !right) return null;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function checkPluginVisibleVersionBump(sourceCheck, baseCheck) {
  if (sourceCheck.status !== 'passed') {
    return skipped('plugin-visible-version-bump', 'source-version-consistency');
  }
  if (baseCheck.status !== 'passed') {
    return skipped('plugin-visible-version-bump', 'base-reconciliation');
  }

  const diff = changedFiles({ root, base, head: 'HEAD' });
  if (!diff.ok) {
    return failed('plugin-visible-version-bump', 'unable to inspect changed files', {
      base,
      hint: premergeFetchHint(`git diff --name-only ${base}...HEAD`, diff.message),
    });
  }

  const changedSourceFiles = sourceVisibleChangedFiles(diff.files, pluginName);
  if (changedSourceFiles.length === 0) {
    return passed('plugin-visible-version-bump', 'no source-visible changes require a bump', {
      changedFiles: [],
    });
  }

  const baseSnapshot = pluginVersionSnapshot(base);
  if (baseSnapshot.error) {
    return failed('plugin-visible-version-bump', baseSnapshot.error, {
      changedFiles: changedSourceFiles,
    });
  }

  const currentVersion = sourceCheck.details.expectedVersion;
  const comparison = compareCleanSemver(currentVersion, baseSnapshot.version);
  if (comparison === null) {
    return failed('plugin-visible-version-bump', 'source versions must be clean SemVer x.y.z', {
      baseVersion: baseSnapshot.version,
      currentVersion,
      changedFiles: changedSourceFiles,
    });
  }

  if (comparison <= 0) {
    return failed(
      'plugin-visible-version-bump',
      `version bump required: current version ${currentVersion} must be higher than base version ${baseSnapshot.version}`,
      {
        baseVersion: baseSnapshot.version,
        currentVersion,
        changedFiles: changedSourceFiles,
      },
    );
  }

  return passed('plugin-visible-version-bump', 'source-visible changes include a version bump', {
    baseVersion: baseSnapshot.version,
    currentVersion,
    changedFiles: changedSourceFiles,
  });
}

const checks = [];
const sourceCheck = checkSourceVersionConsistency();
checks.push(sourceCheck);
const baseCheck = checkBaseReconciliation();
checks.push(baseCheck);
checks.push(checkChangelogHeadAlignment(sourceCheck));
checks.push(checkPluginVisibleVersionBump(sourceCheck, baseCheck));
printAndExit(checks);
