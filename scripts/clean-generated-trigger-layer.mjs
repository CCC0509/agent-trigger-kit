#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { createPathOf } from './lib/fs-json.mjs';
import { generatedPluginEntry } from './lib/generated-manifest.mjs';

const generatedMarker = 'Maintenance contract:';
const safePluginNamePattern = /^[A-Za-z0-9_-]+$/;

const args = parseArgs(process.argv.slice(2));
const root = normalize(requiredStringArg(args, 'root'));
const pluginName = requiredStringArg(args, 'plugin');

if (!safePluginNamePattern.test(pluginName)) {
  console.error(`Invalid plugin name "${pluginName}": --plugin must be a simple plugin id.`);
  process.exit(2);
}

const pathOf = createPathOf(root);
const manifestPath = pathOf('.agent-trigger-kit/generated.json');
const manifest = readGeneratedManifest(manifestPath);

if (!manifest) {
  console.error(`${manifestPath}: generated manifest is required for clean dry-run`);
  process.exit(1);
}

const pluginEntry = generatedPluginEntry(manifest, pluginName);
if (!pluginEntry) {
  console.error(`generated manifest has no plugin entry for ${pluginName}`);
  process.exit(1);
}

const managedSkillPaths = new Set(
  (pluginEntry.files || [])
    .filter((file) => file?.kind === 'skill' && typeof file.path === 'string')
    .map((file) => normalizeGeneratedPath(file.path)),
);

const orphanSkillPaths = findSkillPaths(pluginName)
  .filter((path) => !managedSkillPaths.has(path))
  .filter((path) => readFileSync(pathOf(path), 'utf8').includes(generatedMarker))
  .sort();

if (orphanSkillPaths.length === 0) {
  console.log(`clean dry-run: no orphan generated skills for ${pluginName}`);
} else {
  console.log(`clean dry-run: orphan generated skills for ${pluginName}`);
  for (const path of orphanSkillPaths) {
    console.log(`  orphan ${path}`);
  }
}

function findSkillPaths(plugin) {
  const skillsDir = pathOf(`plugins/${plugin}/skills`);
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `plugins/${plugin}/skills/${entry.name}/SKILL.md`)
    .filter((path) => existsSync(pathOf(path)));
}

function requiredStringArg(args, key) {
  if (typeof args[key] !== 'string' || args[key].trim() === '') {
    console.error(`Missing required --${key} value`);
    process.exit(2);
  }

  return args[key];
}

function normalizeGeneratedPath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function readGeneratedManifest(path) {
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    console.error(`${path}: invalid JSON in .agent-trigger-kit/generated.json (${error.message})`);
    process.exit(1);
  }
}
