#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, normalize, resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { createPathOf, readJsonFileOrExit } from './lib/fs-json.mjs';

const args = parseArgs(process.argv.slice(2), { collectPositionals: true });
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const codexHome = normalize(
  args['codex-home'] || process.env.CODEX_HOME || join(homedir(), '.codex'),
);
const pluginName = args.plugin || args._[0];

if (!pluginName) {
  console.error(
    [
      'Missing plugin name.',
      'Usage: sync-codex-plugin-cache.mjs [--root <path>] [--codex-home <path>] <plugin-name>',
    ].join(' '),
  );
  process.exit(2);
}

function backupName(version) {
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `${version}.backup-${stamp}`;
}

function uniqueBackupPath(parentDir, version) {
  let candidate = join(parentDir, backupName(version));
  let suffix = 2;
  while (existsSync(candidate)) {
    candidate = join(parentDir, `${backupName(version)}-${suffix}`);
    suffix += 1;
  }
  return candidate;
}

const marketplacePath = pathOf('.agents/plugins/marketplace.json');
if (!existsSync(marketplacePath)) {
  console.error(`${marketplacePath}: missing Codex marketplace manifest`);
  process.exit(1);
}

const marketplace = readJsonFileOrExit(marketplacePath);
const plugin = marketplace.plugins?.find((entry) => entry.name === pluginName);
if (!plugin) {
  console.error(`${pluginName}: missing from .agents/plugins/marketplace.json`);
  process.exit(1);
}
if (plugin.source?.source !== 'local' || !plugin.source?.path) {
  console.error(`${pluginName}: cache sync only supports local Codex marketplace sources`);
  process.exit(1);
}
if (!plugin.version) {
  console.error(`${pluginName}: missing marketplace version`);
  process.exit(1);
}

const sourceDir = resolve(root, plugin.source.path);
if (!existsSync(sourceDir)) {
  console.error(`${pluginName}: source directory missing at ${sourceDir}`);
  process.exit(1);
}

const pluginManifestPath = join(sourceDir, '.codex-plugin/plugin.json');
if (!existsSync(pluginManifestPath)) {
  console.error(`${pluginName}: missing ${pluginManifestPath}`);
  process.exit(1);
}

const pluginManifest = readJsonFileOrExit(pluginManifestPath);
if (pluginManifest.name !== pluginName) {
  console.error(`${pluginManifestPath}: name must be ${pluginName}`);
  process.exit(1);
}
if (pluginManifest.version !== plugin.version) {
  console.error(`${pluginManifestPath}: version must match Codex marketplace ${plugin.version}`);
  process.exit(1);
}

const cacheParent = join(codexHome, 'plugins/cache', marketplace.name, pluginName);
const targetDir = join(cacheParent, plugin.version);
mkdirSync(cacheParent, { recursive: true });

if (existsSync(targetDir)) {
  const backupDir = uniqueBackupPath(cacheParent, plugin.version);
  renameSync(targetDir, backupDir);
  console.log(`sync-codex-plugin-cache: backed up ${targetDir} to ${backupDir}`);
}

cpSync(sourceDir, targetDir, { recursive: true });
console.log(`sync-codex-plugin-cache: copied ${pluginName} ${plugin.version} to ${targetDir}`);

const diff = spawnSync('diff', ['-qr', sourceDir, targetDir], {
  encoding: 'utf8',
});
if (diff.error) {
  console.error(`diff -qr failed to start: ${diff.error.message}`);
  process.exit(1);
}
if (diff.status !== 0) {
  if (diff.stdout) process.stderr.write(diff.stdout);
  if (diff.stderr) process.stderr.write(diff.stderr);
  process.exit(diff.status || 1);
}

console.log('sync-codex-plugin-cache: diff -qr passed');
