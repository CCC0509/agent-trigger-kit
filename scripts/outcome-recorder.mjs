#!/usr/bin/env node
import { parseArgs, requiredArg } from './lib/args.mjs';
import {
  OutcomeRecorderError,
  buildOutcomeReport,
  markOutcomeEvent,
  recordOutcomeEvent,
} from './lib/outcome-recorder.mjs';

const [verb, ...verbArgs] = process.argv.slice(2);

function printUsage() {
  console.error(
    [
      'Usage:',
      '  agent-trigger-kit outcome record --root <path> --surface <surface> --verb <verb> --outcome <outcome> [--plugin <name>] [--failure-category <category>] [--failure-driver <driver>]',
      '  agent-trigger-kit outcome mark --root <path> <event-id> --outcome <outcome> [--failure-category <category>] [--failure-driver <driver>] [--note <text>]',
      '  agent-trigger-kit outcome report --root <path> [--json] [--window-days 60]',
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
      windowDays: args['window-days'] ? Number(args['window-days']) : 60,
    });
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`events: ${report.totalEvents}`);
      console.log(`marks: ${report.totalMarks}`);
      console.log(`failure drivers: ${JSON.stringify(report.byFailureDriver)}`);
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
