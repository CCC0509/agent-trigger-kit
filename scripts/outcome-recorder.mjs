#!/usr/bin/env node
import { parseArgs, requiredArg } from './lib/args.mjs';
import {
  OutcomeRecorderError,
  buildOutcomeReport,
  listOutcomeEvents,
  markOutcomeEvent,
  recordOutcomeEvent,
} from './lib/outcome-recorder.mjs';

const [verb, ...verbArgs] = process.argv.slice(2);

function printUsage() {
  console.error(
    [
      'Usage:',
      '  agent-trigger-kit outcome record --root <path> --surface <surface> --verb <verb> --outcome <outcome> [--plugin <name>] [--failure-category <category>] [--failure-driver <driver>]',
      '  agent-trigger-kit outcome events --root <path> [--recent <N>] [--verb <verb>] [--surface <surface>] [--unmarked] [--json]',
      '  agent-trigger-kit outcome mark --root <path> <event-id> --outcome <outcome> [--failure-category <category>] [--failure-driver <driver>] [--note <text>]',
      '  agent-trigger-kit outcome report --root <path> [--json] [--since <UTC-ISO8601>] [--surface <surface>] [--verb <verb>] [--window-days <days>]',
    ].join('\n'),
  );
}

function storeFromArgs(args) {
  return args.store === 'project' || args['project-local'] === true ? 'project' : 'user';
}

try {
  if (!verb || verb === '--help' || verb === '-h') {
    printUsage();
    process.exit(verb ? 0 : 2);
  }

  if (verb === 'record') {
    const args = parseArgs(verbArgs, { booleanKeys: ['project-local'] });
    const { record } = recordOutcomeEvent({
      root: requiredArg(args, 'root'),
      store: storeFromArgs(args),
      plugin: args.plugin,
      surface: requiredArg(args, 'surface'),
      verb: requiredArg(args, 'verb'),
      outcome: requiredArg(args, 'outcome'),
      failureCategory: args['failure-category'],
      failureDriver: args['failure-driver'],
      exitCode: args['exit-code'] === undefined ? undefined : Number(args['exit-code']),
      durationMs: args['duration-ms'] === undefined ? undefined : Number(args['duration-ms']),
      errorCode: args['error-code'],
      note: args.note,
    });
    console.log(`recorded outcome event ${record.id}`);
    process.exit(0);
  }

  if (verb === 'events') {
    const args = parseArgs(verbArgs, { booleanKeys: ['json', 'project-local', 'unmarked'] });
    const listing = listOutcomeEvents({
      root: requiredArg(args, 'root'),
      store: storeFromArgs(args),
      recent: args.recent === undefined ? undefined : optionalValueArg(args, 'recent'),
      verb: optionalValueArg(args, 'verb'),
      surface: optionalValueArg(args, 'surface'),
      unmarked: args.unmarked === true,
    });
    if (args.json) {
      console.log(JSON.stringify(listing, null, 2));
    } else {
      console.log(formatEventList(listing));
    }
    process.exit(0);
  }

  if (verb === 'mark') {
    const args = parseArgs(verbArgs, {
      booleanKeys: ['project-local'],
      collectPositionals: true,
    });
    const eventId = args._[0];
    if (!eventId) {
      console.error('Missing required <event-id>');
      process.exit(2);
    }
    const { record } = markOutcomeEvent({
      root: requiredArg(args, 'root'),
      store: storeFromArgs(args),
      relatedId: eventId,
      outcome: requiredArg(args, 'outcome'),
      failureCategory: args['failure-category'],
      failureDriver: args['failure-driver'],
      errorCode: args['error-code'],
      note: args.note || args.reason,
    });
    console.log(`marked outcome event ${record.related_id} as ${record.outcome}`);
    process.exit(0);
  }

  if (verb === 'report') {
    const args = parseArgs(verbArgs, { booleanKeys: ['json', 'project-local'] });
    const report = buildOutcomeReport({
      root: requiredArg(args, 'root'),
      store: storeFromArgs(args),
      since: optionalValueArg(args, 'since'),
      surface: optionalValueArg(args, 'surface'),
      verb: optionalValueArg(args, 'verb'),
      windowDays:
        args['window-days'] === undefined
          ? undefined
          : Number(optionalValueArg(args, 'window-days')),
    });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatHumanReport(report));
    }
    process.exit(0);
  }

  console.error(`Unknown outcome verb: ${verb}`);
  printUsage();
  process.exit(2);
} catch (error) {
  if (error instanceof OutcomeRecorderError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  console.error(error.message);
  process.exit(1);
}

function optionalValueArg(args, key) {
  if (args[key] === undefined) return undefined;
  if (args[key] === true) {
    throw new OutcomeRecorderError(`--${key} requires a value`, 2);
  }
  return args[key];
}

function formatEventList(listing) {
  const rows = [
    ['SHORTID', 'TS', 'VERB', 'OUTCOME', 'SURFACE', 'CATEGORY'],
    ...listing.events.map((event) => [
      event.short_id,
      formatEventTimestamp(event.ts),
      event.verb,
      event.outcome,
      event.surface,
      event.failure_category || '-',
    ]),
  ];
  const widths = rows[0].map((_, index) =>
    Math.max(...rows.map((row) => String(row[index]).length)),
  );

  return rows
    .map((row) =>
      row
        .map((cell, index) => String(cell).padEnd(widths[index]))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

function formatEventTimestamp(value) {
  return new Date(value).toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function formatHumanReport(report) {
  const lines = [
    'Outcome report',
    `Project: ${report.project_hash}`,
    `Scope: retained records, since ${report.scope.since || 'all'}`,
  ];

  if (report.scope.surface) lines.push(`Surface: ${report.scope.surface}`);
  if (report.scope.verb) lines.push(`Verb: ${report.scope.verb}`);

  lines.push('');

  if (report.propagation.status === 'no_signal') {
    lines.push('No signal events found for the selected filters.');
    if (report.propagation.skipped > 0) {
      lines.push(`Skipped: ${report.propagation.skipped} (excluded from success-rate denominator)`);
    }
    return lines.join('\n');
  }

  lines.push('Propagation reliability');
  lines.push(`Signal events: ${report.totals.signal_events}`);
  lines.push(
    `Success rate: ${formatPercent(report.propagation.success_rate)} (${report.propagation.success} success / ${report.propagation.denominator} success+failure+blocked)`,
  );
  lines.push(`Failures: ${report.propagation.failure}`);
  lines.push(`Blocked: ${report.propagation.blocked}`);
  lines.push(`Skipped: ${report.propagation.skipped} (excluded from success-rate denominator)`);

  lines.push('');
  lines.push('Surface reliability');
  lines.push('surface signal success failure blocked skipped success_rate');
  for (const row of report.by_surface) {
    lines.push(
      [
        row.surface,
        row.signal_events,
        row.success,
        row.failure,
        row.blocked,
        row.skipped,
        formatPercent(row.success_rate),
      ].join(' '),
    );
  }

  lines.push('');
  lines.push('Failure categories');
  if (report.by_failure_category.length === 0) {
    lines.push('No failures found for the selected filters.');
  } else {
    lines.push('failure_category count share_of_failures');
    for (const row of report.by_failure_category) {
      lines.push([row.failure_category, row.count, formatPercent(row.share_of_failures)].join(' '));
    }
  }

  return lines.join('\n');
}

function formatPercent(value) {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
