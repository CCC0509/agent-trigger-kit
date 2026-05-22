#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());

function gitHooksDir() {
  const result = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.error || result.status !== 0) {
    const message = (result.error?.message || result.stderr || result.stdout || '').trim();
    console.error(`Cannot determine git hooks path for ${root}: ${message}`);
    process.exit(1);
  }

  const hooksPath = result.stdout.trim();
  if (!hooksPath) {
    console.error(`Cannot determine git hooks path for ${root}: git returned an empty path`);
    process.exit(1);
  }

  return normalize(isAbsolute(hooksPath) ? hooksPath : join(root, hooksPath));
}

const hooksDir = gitHooksDir();
const hookPath = join(hooksDir, 'pre-push');

if (existsSync(hookPath)) {
  console.error(`Refusing to overwrite existing ${hookPath}`);
  process.exit(1);
}

mkdirSync(hooksDir, { recursive: true });

writeFileSync(
  hookPath,
  `#!/bin/sh
# This hook protects main-bound Agent Trigger Kit work. Disable or edit it when
# pushing to another integration target.
npm run check:scratch-namespace
npm run ops:premerge-version-check -- --base origin/main
`,
);
chmodSync(hookPath, 0o755);
console.log(`installed ${hookPath}`);
