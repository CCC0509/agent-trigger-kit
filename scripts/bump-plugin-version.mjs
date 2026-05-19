#!/usr/bin/env node
import { normalize } from 'node:path';

import { parseArgs, requiredArg } from './lib/args.mjs';
import { createPathOf, updateJsonFileIfExists } from './lib/fs-json.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const pluginName = requiredArg(args, 'plugin');
const version = requiredArg(args, 'version');
const surface = args.surface || 'all';

if (!['all', 'codex', 'claude'].includes(surface)) {
  console.error('--surface must be all, codex, or claude');
  process.exit(2);
}

if (surface !== 'all') {
  const label = surface === 'codex' ? 'Codex' : 'Claude';
  console.error(`warning: --surface ${surface} updates only ${label} plugin manifests and does not keep release versions aligned`);
}

function updateJson(path, mutate) {
  if (updateJsonFileIfExists(pathOf(path), mutate)) {
    console.log(`updated ${path}`);
  }
}

if (surface === 'all' || surface === 'codex') {
  if (surface === 'all') {
    updateJson('package.json', (pkg) => {
      pkg.version = version;
    });
  }
  updateJson('.agents/plugins/marketplace.json', (marketplace) => {
    const plugin = marketplace.plugins?.find((entry) => entry.name === pluginName);
    if (plugin) plugin.version = version;
  });
  updateJson(`plugins/${pluginName}/.codex-plugin/plugin.json`, (plugin) => {
    plugin.version = version;
  });
}

if (surface === 'all' || surface === 'claude') {
  updateJson('.claude-plugin/marketplace.json', (marketplace) => {
    const plugin = marketplace.plugins?.find((entry) => entry.name === pluginName);
    if (plugin) plugin.version = version;
  });
  updateJson(`plugins/${pluginName}/.claude-plugin/plugin.json`, (plugin) => {
    plugin.version = version;
  });
}
