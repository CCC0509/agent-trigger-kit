#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const [command, ...commandArgs] = process.argv.slice(2);
const commands = {
  init: 'init-project-trigger-layer.mjs',
  validate: 'validate-trigger-layer.mjs',
  'version-check': 'check-plugin-version.mjs',
};

function printUsage() {
  console.error(
    [
      'Usage: agent-trigger-kit <command> [args]',
      '',
      'Commands:',
      '  init           Create or update a project trigger layer',
      '  validate       Validate a project trigger layer',
      '  version-check  Check source and installed plugin versions',
    ].join('\n'),
  );
}

if (!command || command === '--help' || command === '-h') {
  printUsage();
  process.exit(command ? 0 : 2);
}

const scriptName = commands[command];
if (!scriptName) {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(2);
}

const result = spawnSync(process.execPath, [join(scriptDir, scriptName), ...commandArgs], {
  stdio: 'inherit',
});

if (result.error) {
  console.error(`agent-trigger-kit ${command}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
