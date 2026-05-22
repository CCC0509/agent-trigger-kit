#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());
const gitDir = join(root, '.git');
const hooksDir = join(gitDir, 'hooks');
const hookPath = join(hooksDir, 'pre-push');

if (!existsSync(gitDir)) {
  console.error(`Cannot install hooks: ${hooksDir} does not exist`);
  process.exit(1);
}

mkdirSync(hooksDir, { recursive: true });

writeFileSync(
  hookPath,
  `#!/bin/sh
# This hook protects main-bound Agent Trigger Kit work. Disable or edit it when
# pushing to another integration target.
npm run ops:premerge-version-check -- --base origin/main
`,
);
chmodSync(hookPath, 0o755);
console.log(`installed ${hookPath}`);
