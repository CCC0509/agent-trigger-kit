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
      '  agent-trigger-kit outcome record --root <path> --plugin <name> --surface <surface> --operation-kind <kind> [--outcome ok|fail|unknown] [--failure-category <category>] [--failure-driver <driver>]',
      '  agent-trigger-kit outcome mark --root <path> <event-id> --result success|failed|misroute [--failure-category <category>] [--failure-driver <driver>] [--reason <text>]',
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
      plugin: requiredArg(args, 'plugin'),
      surface: requiredArg(args, 'surface'),
      operationKind: requiredArg(args, 'operation-kind'),
      outcome: args.outcome || 'unknown',
      failureCategory: args['failure-category'] || 'unknown',
      failureDriver: args['failure-driver'] || 'other',
      durationMs: args['duration-ms'] ? Number(args['duration-ms']) : 0,
    });
    console.log(`recorded outcome event ${record.eventId}`);
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
      eventId,
      result: requiredArg(args, 'result'),
      failureCategory: args['failure-category'],
      failureDriver: args['failure-driver'],
      reason: args.reason,
    });
    console.log(`marked outcome event ${record.eventId} as ${record.result}`);
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
