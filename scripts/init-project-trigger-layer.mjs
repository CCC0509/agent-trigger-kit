#!/usr/bin/env node
import { normalize } from 'node:path';

import { parseArgs, requiredArg } from './lib/args.mjs';
import { writeTriggerLayer } from './lib/trigger-layer.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(requiredArg(args, 'root'));
const pluginName = requiredArg(args, 'plugin');
const tasks = requiredArg(args, 'tasks')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const playbook = requiredArg(args, 'playbook');
const cursorGlobs = args['cursor-globs']
  ? args['cursor-globs']
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : [];

try {
  writeTriggerLayer({
    root,
    pluginName,
    tasks,
    playbook,
    cursorGlobs,
    force: Boolean(args.force),
    initialVersion: args['initial-version'] || '0.1.0',
    writePlaybookPlaceholder: true,
    playbookFirstGuidance: true,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
