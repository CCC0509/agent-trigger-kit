#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MERGE_BASE_AGE_DAYS,
  DEFAULT_REMOTE,
  runAuditCleanup,
} from './lib/audit-cleanup.mjs';

class AuditCleanupUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuditCleanupUsageError';
    this.exitCode = 2;
  }
}

export function runAuditCleanupCommand(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const cwd = options.cwd || process.cwd();
  const wantsJson = argv.includes('--json');

  if (argv.includes('--help') || argv.includes('-h')) {
    stdout.write(`${usageText()}\n`);
    return { exitCode: 0, report: null };
  }

  let parsed;
  try {
    parsed = parseAuditCleanupArgs(argv, cwd);
  } catch (error) {
    if (wantsJson) {
      stdout.write(`${JSON.stringify(errorPayload(error.message), null, 2)}\n`);
    } else {
      stderr.write(`${error.message}\n\n${usageText()}\n`);
    }
    return { exitCode: error.exitCode || 2, report: null };
  }

  const { exitCode, report } = runAuditCleanup({
    ...parsed,
    cwd,
    homeDir: options.homeDir || homedir(),
    now: options.now,
  });

  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    writeHumanReport(stdout, report);
  }

  return { exitCode, report };
}

function parseAuditCleanupArgs(argv, cwd) {
  const normalized = normalizeEqualsArgs(argv);
  const parsed = {
    root: cwd,
    base: null,
    remote: DEFAULT_REMOTE,
    mergeBaseAgeDays: DEFAULT_MERGE_BASE_AGE_DAYS,
    tmpRoots: [],
    json: false,
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === '--root') {
      parsed.root = resolve(cwd, requiredValue(normalized, (index += 1), '--root'));
    } else if (arg === '--base') {
      parsed.base = requiredValue(normalized, (index += 1), '--base');
    } else if (arg === '--remote') {
      parsed.remote = requiredValue(normalized, (index += 1), '--remote');
    } else if (arg === '--merge-base-age-days') {
      parsed.mergeBaseAgeDays = positiveInteger(
        requiredValue(normalized, (index += 1), '--merge-base-age-days'),
        '--merge-base-age-days',
      );
    } else if (arg === '--tmp-root') {
      parsed.tmpRoots.push(resolve(cwd, requiredValue(normalized, (index += 1), '--tmp-root')));
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--apply') {
      throw new AuditCleanupUsageError('--apply is not supported by audit-cleanup v1');
    } else if (arg.startsWith('-')) {
      throw new AuditCleanupUsageError(`unknown option: ${arg}`);
    } else {
      throw new AuditCleanupUsageError(`unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

function normalizeEqualsArgs(argv) {
  const normalized = [];
  for (const arg of argv) {
    const match = arg.match(/^(--[^=]+)=(.*)$/);
    if (match) {
      normalized.push(match[1], match[2]);
    } else {
      normalized.push(arg);
    }
  }
  return normalized;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new AuditCleanupUsageError(`${flag} requires a value`);
  }
  return value;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AuditCleanupUsageError(`${flag} must be a positive integer`);
  }
  return parsed;
}

function writeHumanReport(stdout, report) {
  stdout.write('Audit cleanup\n');
  stdout.write(`Root: ${report.root}\n`);
  stdout.write(`Base: ${report.base}\n`);
  stdout.write(`Remote: ${report.remote}\n`);
  stdout.write(`Merge-base age threshold: ${report.merge_base_age_days} days\n`);
  stdout.write(`Status: ${report.status}\n`);

  if (report.error) {
    stdout.write(`Error: ${report.error.operation}: ${report.error.message.trim()}\n`);
  }

  if (report.warnings.length > 0) {
    stdout.write('\nWarnings\n');
    for (const warning of report.warnings) {
      stdout.write(`- ${warning.id}: ${warning.summary}\n`);
    }
  }

  stdout.write(`\nFindings (${report.findings.length})\n`);
  if (report.findings.length === 0) {
    stdout.write('- None\n');
  } else {
    for (const item of report.findings) {
      stdout.write(`- ${item.id} [${item.category}/${item.severity}]\n`);
      stdout.write(`  ${item.summary}\n`);
      for (const command of item.suggested_commands) {
        stdout.write(`  suggested: ${command}\n`);
      }
    }
  }

  stdout.write(`\nExit code: ${report.exit_code}\n`);
}

function usageText() {
  return [
    'Usage: agent-trigger-kit audit-cleanup [--root <path>] [--base <ref>] [--remote <name>] [--merge-base-age-days <n>] [--tmp-root <path>] [--json]',
    '',
    'Read-only post-merge audit for outcome, branch, remote, and scratch residue.',
  ].join('\n');
}

function errorPayload(message) {
  return {
    schema_version: 1,
    kind: 'audit_cleanup',
    status: 'failed',
    exit_code: 2,
    error: { message },
    findings: [],
    warnings: [],
  };
}

function main() {
  const { exitCode } = runAuditCleanupCommand();
  process.exitCode = exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
