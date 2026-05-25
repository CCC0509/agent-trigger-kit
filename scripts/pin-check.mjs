#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { autoOutcomeDisabled, recordOutcomeSafely } from './lib/outcome-recorder.mjs';
import { PIN_PATH, gitLsRemoteTags, parseRepoArg, runPinCheck } from './lib/pin-check.mjs';

const commandStartedAt = Date.now();
const args = parseArgs(process.argv.slice(2), { booleanKeys: ['json', 'strict', 'no-outcome'] });
const root = normalize(args.root === true || !args.root ? process.cwd() : args.root);
const json = args.json === true;
const strict = args.strict === true;

const repoArg = typeof args.repo === 'string' ? args.repo : 'CCC0509/agent-trigger-kit';
const parsedRepo = parseRepoArg(repoArg);
if (!parsedRepo.ok) {
  console.error(parsedRepo.message);
  process.exit(2);
}

function readPin() {
  const full = join(root, PIN_PATH);
  if (!existsSync(full)) return { present: false };
  return { present: true, text: readFileSync(full, 'utf8') };
}

const { exitCode, report, outcome } = runPinCheck({
  repo: parsedRepo.repo,
  readPin,
  fetchTags: gitLsRemoteTags,
  strict,
});

if (json) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  writeHuman(report);
}

if (!autoOutcomeDisabled(args)) {
  recordOutcomeSafely({
    root,
    plugin: 'agent-trigger-kit',
    surface: 'repo',
    verb: 'pin_check',
    outcome: outcome.outcome,
    failureCategory: outcome.failureCategory,
    failureDriver: outcome.failureDriver,
    exitCode,
    durationMs: Date.now() - commandStartedAt,
  });
}

process.exit(exitCode);

function writeHuman(r) {
  const lines = [
    'Pin check',
    `Repo: ${r.repo}`,
    `Pin file: ${r.pinPath}`,
    `Current: ${r.current ? r.current.ref : '(none)'}`,
    `Latest: ${r.latest ? r.latest.tag : '(unknown)'}`,
    `Status: ${r.status}`,
  ];
  if (r.status === 'missing_pin') {
    lines.push(
      '',
      'Create it with:',
      '  mkdir -p .agent-trigger-kit',
      "  printf 'v0.2.3\\n' > .agent-trigger-kit/pin",
    );
  }
  if (r.status === 'behind') {
    lines.push('', `Next: bump ${r.pinPath} to ${r.latest.tag} (Renovate can open this PR).`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}
