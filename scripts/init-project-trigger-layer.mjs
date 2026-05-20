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

function parseTaskDescriptions(value, tasks) {
  if (value === undefined) {
    return new Map();
  }
  if (typeof value !== 'string') {
    throw new Error('--task-descriptions must be valid JSON object text');
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`--task-descriptions must be valid JSON object text (${error.message})`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--task-descriptions must be a JSON object keyed by task name');
  }

  const taskSet = new Set(tasks);
  const descriptions = new Map();
  for (const [task, description] of Object.entries(parsed)) {
    if (!taskSet.has(task)) {
      throw new Error(`unknown task description key ${task}; expected one of ${tasks.join(', ')}`);
    }
    if (
      typeof description !== 'string' ||
      description.trim() === '' ||
      description.includes('\n') ||
      description.includes('\r')
    ) {
      throw new Error(`${task} description must be a non-empty single-line string`);
    }
    descriptions.set(task, description.trim());
  }

  return descriptions;
}

try {
  const taskDescriptions = parseTaskDescriptions(args['task-descriptions'], tasks);
  writeTriggerLayer({
    root,
    pluginName,
    tasks,
    playbook,
    cursorGlobs,
    taskDescriptions,
    force: Boolean(args.force),
    initialVersion: args['initial-version'] || '0.1.0',
    writePlaybookPlaceholder: true,
    playbookFirstGuidance: true,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
