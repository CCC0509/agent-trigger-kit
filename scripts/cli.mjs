#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const [command, ...commandArgs] = process.argv.slice(2);
const commands = {
  'audit-cleanup': 'audit-cleanup.mjs',
  clean: 'clean-generated-trigger-layer.mjs',
  init: 'init-project-trigger-layer.mjs',
  'import-claude-skills': 'import-claude-skills.mjs',
  'live-check': { script: 'live-trigger-surface-check.mjs' },
  outcome: 'outcome-recorder.mjs',
  'render-matrix': { script: 'render-live-surface-matrix.mjs' },
  'session-check': 'session-check.mjs',
  'spec-graduate': 'spec-graduate.mjs',
  validate: 'validate-trigger-layer.mjs',
  'version-check': 'check-plugin-version.mjs',
};

function printUsage() {
  console.error(
    [
      'Usage: agent-trigger-kit <command> [args]',
      '',
      'Commands:',
      '  audit-cleanup Read-only post-merge audit for residue',
      '  clean          Dry-run cleanup checks for generated trigger layer files',
      '  init           Create or update a project trigger layer',
      '  import-claude-skills  Import existing Claude Code skills into a trigger layer',
      '  validate       Validate a project trigger layer',
      '  live-check     Check live agent trigger surfaces from a consumer-owned matrix',
      '  outcome        Record, mark, and report trigger outcome evidence',
      '  render-matrix  Render live trigger surface matrix documentation',
      '  session-check  Validate trigger layer and outcome closeout state',
      '  spec-graduate  Graduate completed branch-local review material into durable docs',
      '  version-check  Check source and installed plugin versions',
    ].join('\n'),
  );
}

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(command ? 0 : 2);
}

const commandEntry = commands[command];
if (!commandEntry) {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(2);
}

const scriptName = typeof commandEntry === 'string' ? commandEntry : commandEntry.script;
const commandPrefixArgs = typeof commandEntry === 'string' ? [] : commandEntry.args || [];
const dispatchArgs = [join(scriptDir, scriptName), ...commandPrefixArgs, ...commandArgs];
const result = spawnSync(process.execPath, dispatchArgs, {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`agent-trigger-kit ${command}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
