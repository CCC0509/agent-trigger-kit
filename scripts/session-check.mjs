#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { R_OK, W_OK, accessSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OutcomeRecorderError,
  buildOutcomeSessionSummary,
  listOutcomeEvents,
  outcomeStorePath,
} from './lib/outcome-recorder.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const validatePath = join(scriptDir, 'validate-trigger-layer.mjs');
const WINDOW_MS = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '30m': 30 * 60 * 1000,
};

class SessionCheckUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionCheckUsageError';
  }
}

export function runSessionCheck(options = {}) {
  const argv = options.argv || [];
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const now = options.now || new Date();
  const wantsQuiet = argv.includes('--quiet');
  const wantsJson = argv.includes('--json');

  if (argv.includes('--help') || argv.includes('-h')) {
    return helpResult({ now, stdout, quiet: wantsQuiet });
  }

  let parsed;

  try {
    parsed = parseArgs(argv, { ...options, now });
  } catch (error) {
    const result = usageResult({ error, now, stdout, stderr, quiet: wantsQuiet, json: wantsJson });
    return result;
  }

  const { root, homeDir, sinceInput, sinceIso, mode, json, quiet } = parsed;
  const generatedAt = now.toISOString();
  const validation = runValidator(root);
  const outcomeStore = probeOutcomeStore({ root, homeDir });
  let unmarkedEvents = [];
  let reportSummary = {
    failure_categories: [],
    failure_drivers: [],
  };

  if (outcomeStore.status === 'ok') {
    try {
      const listing = listOutcomeEvents({
        root,
        homeDir,
        store: 'user',
        recent: 1000,
        unmarked: true,
        now,
      });
      unmarkedEvents = listing.events.filter((event) => event.ts >= sinceIso);
      const summary = buildOutcomeSessionSummary({
        root,
        homeDir,
        store: 'user',
        since: sinceIso,
        now,
      });
      reportSummary = {
        failure_categories: summary.failure_categories,
        failure_drivers: summary.failure_drivers,
      };
    } catch (error) {
      outcomeStore.status = 'degraded';
      outcomeStore.error = serializeError(error);
    }
  }

  const exitCode = chooseExitCode({ validation, outcomeStore, unmarkedEvents });
  const nextActions = buildNextActions({ root, mode, unmarkedEvents });
  const payload = {
    schema_version: '0.1',
    kind: 'session_check',
    generated_at: generatedAt,
    root,
    mode,
    since: { input: sinceInput, iso: sinceIso },
    exit_code: exitCode,
    validation,
    outcome_store: outcomeStore,
    unmarked_events: {
      count: unmarkedEvents.length,
      events: unmarkedEvents,
    },
    report_summary: reportSummary,
    next_actions: nextActions,
  };

  if (!quiet) {
    if (json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      writeHumanReport({ stdout, payload });
    }
  }

  return { exitCode, payload };
}

export function probeOutcomeStore({ root = process.cwd(), homeDir = homedir() } = {}) {
  let storePath;
  try {
    storePath = outcomeStorePath({ root, homeDir, store: 'user' });
  } catch (error) {
    return degradedStore({ storePath, error });
  }

  const base = {
    status: 'ok',
    store: storePath.store,
    project_hash: storePath.projectHash,
    dir: storePath.dir,
    events_path: storePath.eventsPath,
    error: null,
  };

  try {
    if (existsSync(storePath.dir)) {
      const dirStat = statSync(storePath.dir);
      if (!dirStat.isDirectory()) {
        throw new Error(`outcome store path is not a directory: ${storePath.dir}`);
      }
      accessSync(storePath.dir, R_OK | W_OK);
      if (existsSync(storePath.eventsPath)) {
        const eventsStat = statSync(storePath.eventsPath);
        if (!eventsStat.isFile()) {
          throw new Error(`outcome events path is not a file: ${storePath.eventsPath}`);
        }
        accessSync(storePath.eventsPath, R_OK | W_OK);
      }
      return base;
    }

    const ancestor = nearestExistingAncestor(storePath.dir);
    const ancestorStat = statSync(ancestor);
    if (!ancestorStat.isDirectory()) {
      throw new Error(`outcome store ancestor is not a directory: ${ancestor}`);
    }
    accessSync(ancestor, W_OK);
    return base;
  } catch (error) {
    return {
      ...base,
      status: 'degraded',
      error: serializeError(error),
    };
  }
}

function parseArgs(argv, options) {
  const normalized = normalizeEqualsArgs(argv);
  const parsed = {
    root: options.root || process.cwd(),
    homeDir: options.homeDir || homedir(),
    sinceInput: '7d',
    closeout: false,
    json: false,
    quiet: false,
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const arg = normalized[index];
    if (arg === '--root') {
      parsed.root = requiredValue(normalized, (index += 1), '--root');
    } else if (arg === '--since') {
      parsed.sinceInput = requiredValue(normalized, (index += 1), '--since');
    } else if (arg === '--closeout') {
      parsed.closeout = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--quiet') {
      parsed.quiet = true;
    } else if (arg === '--start') {
      throw new SessionCheckUsageError('--start is not supported; omit it for start mode');
    } else if (arg === '--help' || arg === '-h') {
      throw new SessionCheckUsageError(usageText());
    } else if (arg.startsWith('-')) {
      throw new SessionCheckUsageError(`unknown option: ${arg}`);
    } else {
      throw new SessionCheckUsageError(`unexpected argument: ${arg}`);
    }
  }

  return {
    root: resolve(parsed.root),
    homeDir: parsed.homeDir,
    sinceInput: parsed.sinceInput,
    sinceIso: parseSince(parsed.sinceInput, options.now || new Date()),
    mode: parsed.closeout ? 'closeout' : 'start',
    json: parsed.json,
    quiet: parsed.quiet,
  };
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
    throw new SessionCheckUsageError(`${flag} requires a value`);
  }
  return value;
}

function parseSince(input, now) {
  if (Object.hasOwn(WINDOW_MS, input)) {
    return new Date(now.getTime() - WINDOW_MS[input]).toISOString();
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  throw new SessionCheckUsageError(`invalid --since value: ${input}`);
}

function runValidator(root) {
  const result = spawnSync(process.execPath, [validatePath, '--root', root, '--no-outcome'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  const exitCode = result.error ? 1 : (result.status ?? 1);
  return {
    status: exitCode === 0 ? 'passed' : 'failed',
    exit_code: exitCode,
    stdout: result.stdout || '',
    stderr: result.error ? result.error.message : result.stderr || '',
  };
}

function nearestExistingAncestor(path) {
  let cursor = path;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return cursor;
    cursor = parent;
  }
  return cursor;
}

function degradedStore({ storePath, error }) {
  return {
    status: 'degraded',
    store: storePath?.store || 'user',
    project_hash: storePath?.projectHash || null,
    dir: storePath?.dir || null,
    events_path: storePath?.eventsPath || null,
    error: serializeError(error),
  };
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    code: error?.code || null,
    message: error?.message || String(error),
  };
}

function chooseExitCode({ validation, outcomeStore, unmarkedEvents }) {
  if (validation.exit_code !== 0) return 1;
  if (outcomeStore.status === 'degraded') return 3;
  if (unmarkedEvents.length > 0) return 4;
  return 0;
}

function buildNextActions({ root, mode, unmarkedEvents }) {
  if (mode !== 'closeout') return [];
  return unmarkedEvents.map((event) => ({
    event_id: event.id,
    short_id: event.short_id,
    command: `agent-trigger-kit outcome mark --root . ${event.short_id}`,
    cwd: root,
  }));
}

function writeHumanReport({ stdout, payload }) {
  stdout.write(`${payload.mode === 'closeout' ? 'Session closeout check' : 'Session check'}\n`);
  stdout.write(`Root: ${payload.root}\n`);
  stdout.write(`Mode: ${payload.mode}\n`);
  stdout.write(`Since: ${payload.since.iso} (${payload.since.input})\n\n`);

  stdout.write('Trigger layer\n');
  stdout.write(`- Status: ${payload.validation.status}\n`);
  stdout.write(`- Exit code: ${payload.validation.exit_code}\n`);
  if (payload.validation.stdout) stdout.write(`${payload.validation.stdout.trimEnd()}\n`);
  if (payload.validation.stderr) stdout.write(`${payload.validation.stderr.trimEnd()}\n`);
  stdout.write('\n');

  stdout.write('Outcome store\n');
  stdout.write(`- Status: ${payload.outcome_store.status}\n`);
  stdout.write(`- Path: ${payload.outcome_store.events_path || '(unavailable)'}\n`);
  if (payload.outcome_store.error) {
    stdout.write(`- Error: ${payload.outcome_store.error.message}\n`);
  }
  stdout.write('\n');

  stdout.write(`Unmarked outcome events since ${payload.since.iso}\n`);
  if (payload.unmarked_events.count === 0) {
    stdout.write('- None\n');
  } else {
    for (const event of payload.unmarked_events.events) {
      stdout.write(
        `- ${event.short_id} ${event.ts} ${event.verb} ${event.outcome} ${event.surface}\n`,
      );
    }
    if (payload.mode === 'closeout') {
      stdout.write('\n');
      for (const action of payload.next_actions) {
        stdout.write(`${action.command}\n`);
      }
    }
  }
  stdout.write('\n');

  stdout.write('Outcome summary\n');
  writeSummaryRows(stdout, 'Failure categories', payload.report_summary.failure_categories);
  writeSummaryRows(stdout, 'Failure drivers', payload.report_summary.failure_drivers);
  stdout.write(`\nExit code: ${payload.exit_code}\n`);
}

function writeSummaryRows(stdout, label, rows) {
  stdout.write(`- ${label}:`);
  if (rows.length === 0) {
    stdout.write(' none\n');
    return;
  }
  stdout.write('\n');
  for (const row of rows) {
    const name = row.failure_category || row.failure_driver;
    stdout.write(`  - ${name}: ${row.count}\n`);
  }
}

function helpResult({ now, stdout, quiet }) {
  if (!quiet) {
    stdout.write(`${usageText()}\n`);
  }
  return {
    exitCode: 0,
    payload: {
      schema_version: '0.1',
      kind: 'session_check',
      generated_at: now.toISOString(),
      root: null,
      mode: 'start',
      since: { input: '7d', iso: null },
      exit_code: 0,
      validation: { status: 'not_run', exit_code: null, stdout: '', stderr: '' },
      outcome_store: {
        status: 'not_run',
        store: 'user',
        project_hash: null,
        dir: null,
        events_path: null,
        error: null,
      },
      unmarked_events: { count: 0, events: [] },
      report_summary: { failure_categories: [], failure_drivers: [] },
      next_actions: [],
    },
  };
}

function usageResult({ error, now, stdout, stderr, quiet, json }) {
  const message = error instanceof SessionCheckUsageError ? error.message : String(error);
  const payload = {
    schema_version: '0.1',
    kind: 'session_check',
    generated_at: now.toISOString(),
    root: null,
    mode: 'start',
    since: { input: '7d', iso: null },
    exit_code: 2,
    validation: { status: 'not_run', exit_code: null, stdout: '', stderr: '' },
    outcome_store: {
      status: 'not_run',
      store: 'user',
      project_hash: null,
      dir: null,
      events_path: null,
      error: { name: 'SessionCheckUsageError', code: null, message },
    },
    unmarked_events: { count: 0, events: [] },
    report_summary: { failure_categories: [], failure_drivers: [] },
    next_actions: [],
  };
  if (!quiet) {
    if (json) {
      stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      stderr.write(`${message}\n`);
      if (message !== usageText()) stderr.write(`${usageText()}\n`);
    }
  }
  return { exitCode: 2, payload };
}

function usageText() {
  return [
    'Usage: agent-trigger-kit session-check [--root <path>] [--since=<window>] [--since <window>] [--closeout] [--json] [--quiet]',
    'Windows: 7d, 24h, 30m, or an ISO timestamp',
  ].join('\n');
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const result = runSessionCheck({ argv: process.argv.slice(2) });
    process.exit(result.exitCode);
  } catch (error) {
    if (!(error instanceof OutcomeRecorderError)) {
      console.error(`agent-trigger-kit session-check: ${error.message}`);
    }
    process.exit(error.exitCode || 1);
  }
}
