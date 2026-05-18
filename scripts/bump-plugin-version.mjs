#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());
const pluginName = required('plugin');
const version = required('version');
const surface = args.surface || 'all';

if (!['all', 'codex', 'claude'].includes(surface)) {
  console.error('--surface must be all, codex, or claude');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    }
  }
  return out;
}

function required(key) {
  if (!args[key]) {
    console.error(`Missing required --${key}`);
    process.exit(2);
  }
  return args[key];
}

function pathOf(path) {
  return join(root, path);
}

function updateJson(path, mutate) {
  if (!existsSync(pathOf(path))) return;
  const value = JSON.parse(readFileSync(pathOf(path), 'utf8'));
  mutate(value);
  writeFileSync(pathOf(path), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`updated ${path}`);
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
