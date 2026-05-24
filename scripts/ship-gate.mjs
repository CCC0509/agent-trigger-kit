#!/usr/bin/env node
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { SHIP_GATE_COMMAND, SHIP_GATE_SCHEMA_VERSION, runShipGate } from './lib/ship-gate.mjs';

class ShipGateUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShipGateUsageError';
    this.exitCode = 2;
  }
}

export async function runShipGateCommand(options = {}) {
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
    parsed = parseShipGateArgs(argv, cwd);
  } catch (error) {
    if (wantsJson) {
      stdout.write(`${JSON.stringify(usageErrorPayload(error.message), null, 2)}\n`);
    } else {
      stderr.write(`${error.message}\n\n${usageText()}\n`);
    }
    return { exitCode: error.exitCode || 2, report: null };
  }

  const { exitCode, report } = await runShipGate(parsed);
  if (parsed.json) {
    stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    writeHumanReport(stdout, report);
  }

  return { exitCode, report };
}

function parseShipGateArgs(argv, cwd) {
  const args = parseArgs(argv, {
    booleanKeys: ['json', 'continue-on-fail'],
    collectPositionals: true,
  });
  const allowedKeys = new Set(['_', 'root', 'json', 'continue-on-fail']);

  for (const key of Object.keys(args)) {
    if (!allowedKeys.has(key)) {
      throw new ShipGateUsageError(`unknown option: --${key}`);
    }
  }

  if ((args._ || []).length > 0) {
    throw new ShipGateUsageError(`unexpected argument: ${args._[0]}`);
  }

  if (Object.hasOwn(args, 'root') && typeof args.root !== 'string') {
    throw new ShipGateUsageError('--root requires a path value');
  }

  const root = resolve(cwd, args.root || '.');
  assertDirectoryRoot(root);

  return {
    root,
    json: args.json === true,
    continueOnFail: args['continue-on-fail'] === true,
  };
}

function assertDirectoryRoot(root) {
  let stat;
  try {
    stat = statSync(root);
  } catch {
    throw new ShipGateUsageError(`--root must be an existing directory: ${root}`);
  }

  if (!stat.isDirectory()) {
    throw new ShipGateUsageError(`--root must be an existing directory: ${root}`);
  }
}

function writeHumanReport(stdout, report) {
  stdout.write('Ship gate\n');
  for (const check of report.checks) {
    stdout.write(
      `${check.command.padEnd(34, ' ')} ${check.status.padEnd(6, ' ')} ${check.duration_ms}ms\n`,
    );
  }
  stdout.write(`Result: ${report.status}\n`);
}

function usageText() {
  return [
    'Usage: agent-trigger-kit ship-gate [--root <path>] [--json] [--continue-on-fail]',
    '',
    'Run the local pre-PR composite quality gate.',
  ].join('\n');
}

function usageErrorPayload(message) {
  const now = new Date().toISOString();
  return {
    schema_version: SHIP_GATE_SCHEMA_VERSION,
    command: SHIP_GATE_COMMAND,
    status: 'failed',
    checks: [],
    started_at: now,
    finished_at: now,
    duration_ms: 0,
    exit_reason: 'usage_error',
    error: { message },
  };
}

async function main() {
  const { exitCode } = await runShipGateCommand();
  process.exitCode = exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
