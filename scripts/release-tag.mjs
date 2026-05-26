#!/usr/bin/env node
import { normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { runGit } from './lib/git-base.mjs';
import { decideReleaseTag, tagNameForVersion } from './lib/release-tag.mjs';
import {
  collectSourceVersionSnapshot,
  sourceVersionsDiffer,
} from './lib/source-version-snapshot.mjs';

const args = parseArgs(process.argv.slice(2), {
  booleanKeys: ['json', 'apply', 'dry-run', 'no-push'],
});
const root = normalize(args.root || process.cwd());
const pluginName = typeof args.plugin === 'string' ? args.plugin.trim() : 'agent-trigger-kit';
const jsonOutput = args.json === true;

if (args.apply && args['dry-run']) {
  console.error('--apply and --dry-run cannot both be set');
  process.exit(2);
}

const dryRun = args.apply !== true;
const pushEnabled = args['no-push'] !== true;
const sourceSnapshot = collectSourceVersionSnapshot({ root, pluginName });
const sourceErrorMessage = sourceVersionsDiffer(sourceSnapshot) ? sourceSnapshot.errorMessage : '';
const expectedVersion = sourceSnapshot.expectedVersion;

let head = null;
let tagTarget = null;
let decision = null;

if (sourceErrorMessage) {
  decision = decideReleaseTag({
    expectedVersion,
    head,
    sourceErrorMessage,
    tagTarget,
  });
} else {
  const tagNameResult = tagNameForVersion(expectedVersion);
  if (tagNameResult.ok) {
    head = gitOutput(['rev-parse', 'HEAD']);
    tagTarget = gitOutput(['rev-parse', '-q', '--verify', `${tagNameResult.tagName}^{}`]);
  }

  decision = decideReleaseTag({
    expectedVersion,
    head,
    tagTarget,
  });
}

let report = reportFromDecision(decision, {
  dryRun,
  pluginName,
  sourceVersions: sourceSnapshot.sourceVersions,
});
let exitCode = decision.action === 'blocked' ? 1 : 0;

if (decision.action === 'create' && !dryRun) {
  const tagResult = runGit({
    root,
    args: ['tag', '-a', decision.tagName, '-m', `Release ${decision.tagName}`],
  });

  if (tagResult.ok) {
    report.created = true;
  } else {
    report = blockReport(report, `git tag failed: ${gitMessage(tagResult)}`);
    exitCode = 1;
  }

  if (tagResult.ok && decision.shouldPush && pushEnabled) {
    const pushResult = runGit({ root, args: ['push', 'origin', decision.tagName] });
    if (pushResult.ok) {
      report.pushed = true;
    } else if (remoteTagExists(decision.tagName)) {
      const deleteResult = runGit({ root, args: ['tag', '-d', decision.tagName] });
      if (deleteResult.ok) {
        report.action = 'warn_existing';
        report.reason = 'tag appeared on origin before push completed';
        report.warning = `${decision.tagName} appeared on origin before push completed; removed the local tag and left the remote tag unchanged`;
        report.pushed = false;
        exitCode = 0;
      } else {
        report = blockReport(
          report,
          `git tag cleanup failed after remote tag race: ${gitMessage(deleteResult)}`,
        );
        exitCode = 1;
      }
    } else {
      report = blockReport(report, `git push failed: ${gitMessage(pushResult)}`);
      exitCode = 1;
    }
  }
}

printReport(report);
process.exit(exitCode);

function gitOutput(gitArgs) {
  const result = runGit({ root, args: gitArgs });
  if (!result.ok) return null;
  return result.stdout.trim() || null;
}

function remoteTagExists(tagName) {
  const result = runGit({
    root,
    args: ['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`],
  });
  return result.ok && result.stdout.trim() !== '';
}

function gitMessage(result) {
  return result.message.trim() || 'unknown git failure';
}

function reportFromDecision(
  { action, expectedVersion, head: decisionHead, reason, tagName, tagTarget, warning },
  { dryRun: reportDryRun, pluginName: reportPluginName, sourceVersions },
) {
  return {
    kind: 'release_tag',
    pluginName: reportPluginName,
    expectedVersion,
    tagName,
    action,
    reason,
    warning,
    head: decisionHead,
    tagTarget,
    dryRun: reportDryRun,
    created: false,
    pushed: false,
    sourceVersions,
  };
}

function blockReport(report, reason) {
  return {
    ...report,
    action: 'blocked',
    reason,
    warning: null,
    pushed: false,
  };
}

function printReport(report) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Release tag');
  console.log(`Plugin: ${report.pluginName}`);
  console.log(`Version: ${report.expectedVersion}`);
  console.log(`Tag: ${report.tagName || 'none'}`);
  console.log(`Action: ${report.action}`);
  console.log(`Dry run: ${report.dryRun ? 'yes' : 'no'}`);
  console.log(`Created: ${report.created ? 'yes' : 'no'}`);
  console.log(`Pushed: ${report.pushed ? 'yes' : 'no'}`);
  if (report.reason) {
    console.log(`Reason: ${report.reason}`);
  }
  if (report.warning) {
    console.log(`Warning: ${report.warning}`);
  }
}
