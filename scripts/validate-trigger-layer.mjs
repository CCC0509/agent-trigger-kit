#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { createPathOf } from './lib/fs-json.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(pathOf(path), 'utf8');
}

function parseJson(path) {
  try {
    return JSON.parse(read(path));
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
    return null;
  }
}

function listDirs(path) {
  const full = pathOf(path);
  if (!existsSync(full)) return [];
  return readdirSync(full).filter((name) => statSync(join(full, name)).isDirectory());
}

function hasFrontmatter(path, keys) {
  const text = read(path);
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    fail(`${path}: missing frontmatter`);
    return false;
  }
  for (const key of keys) {
    if (!new RegExp(`^${key}:`, 'm').test(match[1])) {
      fail(`${path}: missing frontmatter key ${key}`);
    }
  }
  return true;
}

function localBacktickRefs(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((ref) => {
      if (ref.startsWith('/') || ref.startsWith('#')) return false;
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false;
      return ref.endsWith('.md');
    });
}

function sectionBody(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return '';
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    body.push(line);
  }
  return body.join('\n');
}

function validateCanonicalRefs(path, baseDir, text = read(path)) {
  for (const ref of localBacktickRefs(text)) {
    const candidate = normalize(join(baseDir, ref));
    if (!existsSync(pathOf(candidate))) {
      fail(`${path}: missing canonical playbook ${candidate}`);
    }
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parsePluginEntries() {
  const entries = new Map();

  if (existsSync(pathOf('.agents/plugins/marketplace.json'))) {
    const codex = parseJson('.agents/plugins/marketplace.json');
    for (const entry of codex?.plugins || []) {
      const sourcePath = entry.source?.path;
      if (entry.name && sourcePath) {
        entries.set(entry.name, {
          ...entries.get(entry.name),
          name: entry.name,
          codexVersion: entry.version,
          pluginDir: sourcePath.replace(/^\.\//, ''),
        });
      }
    }
  }

  if (existsSync(pathOf('.claude-plugin/marketplace.json'))) {
    const claude = parseJson('.claude-plugin/marketplace.json');
    for (const entry of claude?.plugins || []) {
      if (entry.name && entry.source) {
        entries.set(entry.name, {
          ...entries.get(entry.name),
          name: entry.name,
          claudeVersion: entry.version,
          pluginDir: entry.source.replace(/^\.\//, ''),
        });
      }
    }
  }

  return [...entries.values()];
}

function validatePlugin(plugin) {
  if (!plugin.pluginDir || !existsSync(pathOf(plugin.pluginDir))) {
    fail(`${plugin.name}: plugin directory missing`);
    return;
  }

  const codexManifestPath = `${plugin.pluginDir}/.codex-plugin/plugin.json`;
  if (existsSync(pathOf(codexManifestPath))) {
    const codex = parseJson(codexManifestPath);
    if (codex?.name !== plugin.name) fail(`${codexManifestPath}: name must be ${plugin.name}`);
    if (plugin.codexVersion && codex?.version !== plugin.codexVersion) {
      fail(`${codexManifestPath}: version must match Codex marketplace ${plugin.codexVersion}`);
    }
    if (codex?.skills && !existsSync(pathOf(`${plugin.pluginDir}/${codex.skills}`))) {
      fail(`${codexManifestPath}: skills path does not exist`);
    }
  }

  const claudeManifestPath = `${plugin.pluginDir}/.claude-plugin/plugin.json`;
  let claude = null;
  if (existsSync(pathOf(claudeManifestPath))) {
    claude = parseJson(claudeManifestPath);
    if (claude?.name !== plugin.name) fail(`${claudeManifestPath}: name must be ${plugin.name}`);
    if (plugin.claudeVersion && claude?.version !== plugin.claudeVersion) {
      fail(`${claudeManifestPath}: version must match Claude marketplace ${plugin.claudeVersion}`);
    }
    for (const skillsPath of claude?.skills || []) {
      if (!existsSync(pathOf(`${plugin.pluginDir}/${skillsPath}`))) {
        fail(`${claudeManifestPath}: skills path ${skillsPath} does not exist`);
      }
    }
    for (const commandsPath of claude?.commands || []) {
      if (!existsSync(pathOf(`${plugin.pluginDir}/${commandsPath}`))) {
        fail(`${claudeManifestPath}: commands path ${commandsPath} does not exist`);
      }
    }
  }

  for (const skillName of listDirs(`${plugin.pluginDir}/skills`)) {
    const skillPath = `${plugin.pluginDir}/skills/${skillName}/SKILL.md`;
    if (!existsSync(pathOf(skillPath))) {
      fail(`${skillPath}: missing`);
      continue;
    }
    hasFrontmatter(skillPath, ['name', 'description']);
    validateCanonicalRefs(skillPath, dirname(skillPath), sectionBody(read(skillPath), 'Must Read'));
  }

  const commandDir = `${plugin.pluginDir}/commands`;
  if (existsSync(pathOf(commandDir))) {
    const commandFiles = readdirSync(pathOf(commandDir)).filter((name) => name.endsWith('.md'));
    if (
      commandFiles.length > 0 &&
      (!Array.isArray(claude?.commands) || claude.commands.length === 0)
    ) {
      fail(`${claudeManifestPath}: commands exist but are not declared`);
    }
    const delegationPattern = new RegExp(`${escapeRegExp(plugin.name)}:([A-Za-z0-9_-]+)`, 'g');
    for (const file of commandFiles) {
      const commandPath = `${commandDir}/${file}`;
      hasFrontmatter(commandPath, ['description']);
      const commandText = read(commandPath);
      const delegations = [...commandText.matchAll(delegationPattern)].map((match) => match[1]);
      if (delegations.length === 0) {
        fail(`${commandPath}: missing delegation to ${plugin.name}:<skill>`);
      }
      for (const skillName of delegations) {
        if (!existsSync(pathOf(`${plugin.pluginDir}/skills/${skillName}/SKILL.md`))) {
          fail(`${commandPath}: delegates to missing skill ${plugin.name}:${skillName}`);
        }
      }
    }
  }
}

function validateCursorRules() {
  const rulesDir = '.cursor/rules';
  if (!existsSync(pathOf(rulesDir))) return;
  for (const file of readdirSync(pathOf(rulesDir)).filter((name) => name.endsWith('.mdc'))) {
    const rulePath = `${rulesDir}/${file}`;
    hasFrontmatter(rulePath, ['description', 'globs']);
    validateCanonicalRefs(rulePath, '.');
  }
}

const plugins = parsePluginEntries();
if (plugins.length === 0) {
  fail(
    'No plugin entries found in .agents/plugins/marketplace.json or .claude-plugin/marketplace.json',
  );
}

for (const plugin of plugins) {
  validatePlugin(plugin);
}
validateCursorRules();

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`trigger layer validation passed for ${root}`);
