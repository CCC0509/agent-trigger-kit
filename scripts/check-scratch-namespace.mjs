#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';

const args = parseArgs(process.argv.slice(2), { booleanKeys: ['advisory'] });
if (args.root === true) {
  console.error('--root requires a path value');
  process.exit(2);
}

const root = normalize(args.root || process.cwd());
const advisory = args.advisory === true;
const warningMessage = 'Tracked scratch namespace file must be relocated or dropped before merge';

function escapeAnnotationProperty(value) {
  return value
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .replaceAll(':', '%3A')
    .replaceAll(',', '%2C');
}

function emitWarningAnnotation(file) {
  console.warn(`::warning file=${escapeAnnotationProperty(file)}::${warningMessage}`);
}

const result = spawnSync('git', ['-C', root, 'ls-files', 'docs/superpowers/'], {
  encoding: 'utf8',
});

if (result.status !== 0) {
  const status = result.status ?? 1;
  const stderr = result.stderr?.trim() || result.error?.message || '';
  console.error(`scratch namespace check failed to run git ls-files in ${root}`);
  if (stderr) console.error(stderr);
  process.exit(status);
}

const trackedFiles = result.stdout.split(/\r?\n/).filter(Boolean);

if (trackedFiles.length === 0) {
  if (advisory) {
    console.log('scratch namespace advisory passed: docs/superpowers/ has no tracked files');
  } else {
    console.log('scratch namespace check passed: docs/superpowers/ has no tracked files');
  }
  process.exit(0);
}

if (advisory) {
  console.log(
    `scratch namespace advisory found ${trackedFiles.length} tracked files in docs/superpowers/`,
  );
  for (const file of trackedFiles) {
    emitWarningAnnotation(file);
  }
  process.exit(0);
}

console.error('Tracked scratch namespace files are not allowed in the final main tree.');
console.error('');
console.error('docs/superpowers/ is branch-local scratch space.');
console.error(
  'Please relocate durable files to docs/designs/ with git mv or remove scratch artifacts with git rm.',
);
console.error(
  '.gitignore does not untrack existing files; tracked files must be moved or removed.',
);
console.error('');
console.error('Tracked files:');
for (const file of trackedFiles) {
  console.error(`- ${file}`);
}

process.exit(1);
