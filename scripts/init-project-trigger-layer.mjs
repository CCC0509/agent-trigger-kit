#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

import { parseArgs, requiredArg } from './lib/args.mjs';
import {
  createPathOf,
  readJsonFileIfExists,
  writeJsonFileCreatingParents,
} from './lib/fs-json.mjs';
import {
  generatedPluginEntry,
  generatedPluginNames,
  upsertGeneratedPluginEntry,
} from './lib/generated-manifest.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(requiredArg(args, 'root'));
const pathOf = createPathOf(root);
const pluginName = requiredArg(args, 'plugin');
const pluginDir = `plugins/${pluginName}`;
const tasks = requiredArg(args, 'tasks')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const playbook = requiredArg(args, 'playbook');
const force = Boolean(args.force);
const initialVersion = args['initial-version'] || '0.1.0';
const maintenanceContract = '.agent-trigger-kit/MAINTENANCE.md';
const templateVersion = 1;
const kitPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const generatedFiles = [];
const cursorGlobs = args['cursor-globs']
  ? args['cursor-globs']
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : [];
const templateRoot = new URL('../templates/project-trigger-layer/', import.meta.url);
const wrapperTemplates = {
  skill: readTemplate('skill/SKILL.md.template'),
  command: readTemplate('command.md.template'),
  cursorRule: readTemplate('cursor-rule.mdc.template'),
};

const previousGeneratedManifest = readJsonFileIfExists(
  pathOf('.agent-trigger-kit/generated.json'),
  null,
);
const generatedTargets = buildGeneratedTargets();

function buildGeneratedTargets() {
  const targets = [
    { path: `${pluginDir}/.codex-plugin/plugin.json`, kind: 'plugin-manifest' },
    { path: `${pluginDir}/.claude-plugin/plugin.json`, kind: 'plugin-manifest' },
  ];

  for (const task of tasks) {
    targets.push({ path: `${pluginDir}/skills/${task}/SKILL.md`, kind: 'skill' });
    targets.push({ path: `${pluginDir}/commands/${task}.md`, kind: 'command' });
    if (cursorGlobs.length > 0) {
      targets.push({ path: `.cursor/rules/${task}.mdc`, kind: 'cursor-rule' });
    }
  }

  return targets;
}

function readTemplate(path) {
  return readFileSync(new URL(path, templateRoot), 'utf8');
}

function renderTemplate(template, values) {
  let rendered = template;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  const unresolved = rendered.match(/{{[^}]+}}/g);
  if (unresolved) {
    throw new Error(`unresolved template placeholder(s): ${unresolved.join(', ')}`);
  }
  return rendered;
}

function titleize(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function markdownRelativePath(fromDir, toPath) {
  return relative(fromDir, toPath).replaceAll('\\', '/');
}

function existingPluginVersion() {
  const versions = [];
  const codexMarketplace = readJsonFileIfExists(pathOf('.agents/plugins/marketplace.json'), null);
  const codexEntry = codexMarketplace?.plugins?.find((entry) => entry.name === pluginName);
  if (codexEntry?.version) {
    versions.push({ label: 'codex marketplace', version: codexEntry.version });
  }

  const codexPlugin = readJsonFileIfExists(pathOf(`${pluginDir}/.codex-plugin/plugin.json`), null);
  if (codexPlugin?.version) {
    versions.push({ label: 'codex plugin', version: codexPlugin.version });
  }

  const claudeMarketplace = readJsonFileIfExists(pathOf('.claude-plugin/marketplace.json'), null);
  const claudeEntry = claudeMarketplace?.plugins?.find((entry) => entry.name === pluginName);
  if (claudeEntry?.version) {
    versions.push({ label: 'claude marketplace', version: claudeEntry.version });
  }

  const claudePlugin = readJsonFileIfExists(
    pathOf(`${pluginDir}/.claude-plugin/plugin.json`),
    null,
  );
  if (claudePlugin?.version) {
    versions.push({ label: 'claude plugin', version: claudePlugin.version });
  }

  const unique = new Set(versions.map((entry) => entry.version));
  if (unique.size > 1) {
    throw new Error(
      `existing manifest versions differ: ${versions.map((entry) => `${entry.label}=${entry.version}`).join(', ')}`,
    );
  }

  if (versions.length > 0) {
    return versions[0].version;
  }

  const generated = readJsonFileIfExists(pathOf('.agent-trigger-kit/generated.json'), null);
  return generatedPluginEntry(generated, pluginName)?.pluginVersion || initialVersion;
}

let pluginVersion;
try {
  pluginVersion = existingPluginVersion();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256(path) {
  return sha256Bytes(readFileSync(pathOf(path)));
}

function trackGeneratedFile(path, kind) {
  generatedFiles.push({
    path,
    kind,
    sha256: sha256(path),
  });
}

function verifyForceOverwrite(path, kind, full) {
  if (!force || !kind || !existsSync(full)) {
    return;
  }

  if (!previousGeneratedManifest) {
    throw new Error(
      `${path} exists but .agent-trigger-kit/generated.json is missing; refusing overwrite with --force`,
    );
  }

  const previousGeneratedEntry = generatedPluginEntry(previousGeneratedManifest, pluginName);
  if (!previousGeneratedEntry) {
    const previousPlugins = generatedPluginNames(previousGeneratedManifest);
    throw new Error(
      `${path} exists but .agent-trigger-kit/generated.json has no entry for ${pluginName}${
        previousPlugins.length > 0 ? ` (found ${previousPlugins.join(', ')})` : ''
      }; refusing overwrite with --force`,
    );
  }

  const previousEntry = previousGeneratedEntry.files?.find((file) => file.path === path);
  if (!previousEntry) {
    throw new Error(
      `${path} exists but is not listed in .agent-trigger-kit/generated.json; refusing overwrite with --force`,
    );
  }

  if (previousEntry.kind !== kind) {
    throw new Error(
      `${path} exists with generated kind ${previousEntry.kind || 'unknown'} but init wants ${kind}; refusing overwrite with --force`,
    );
  }

  const currentSha256 = sha256Bytes(readFileSync(full));
  if (currentSha256 !== previousEntry.sha256) {
    throw new Error(
      `${path} has checksum mismatch or local changes; refusing overwrite with --force`,
    );
  }
}

function write(path, content, kind = null) {
  const full = pathOf(path);
  if (existsSync(full) && !force) {
    throw new Error(`${path} already exists; rerun with --force to overwrite generated files`);
  }
  verifyForceOverwrite(path, kind, full);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, `${content.trimEnd()}\n`);
  if (kind) trackGeneratedFile(path, kind);
  console.log(`wrote ${path}`);
}

function writeJson(path, value, kind = null) {
  write(path, JSON.stringify(value, null, 2), kind);
}

function writeJsonAlways(path, value) {
  const full = pathOf(path);
  const existed = existsSync(full);
  writeJsonFileCreatingParents(full, value);
  console.log(`${existed ? 'updated' : 'wrote'} ${path}`);
}

function writeIfMissing(path, content) {
  const full = pathOf(path);
  if (existsSync(full)) {
    console.log(`kept ${path}`);
    return;
  }
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, `${content.trimEnd()}\n`);
  console.log(`wrote ${path}`);
}

function preflightForceOverwrites() {
  if (!force) {
    return;
  }

  for (const target of generatedTargets) {
    verifyForceOverwrite(target.path, target.kind, pathOf(target.path));
  }
}

function upsertCodexMarketplace() {
  const path = '.agents/plugins/marketplace.json';
  const marketplace = readJsonFileIfExists(pathOf(path), {
    name: pluginName,
    interface: { displayName: `${titleize(pluginName)} Plugins` },
    plugins: [],
  });
  marketplace.plugins = marketplace.plugins || [];
  const entry = {
    name: pluginName,
    version: pluginVersion,
    source: { source: 'local', path: `./${pluginDir}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity',
    description: `${titleize(pluginName)} trigger skills for Codex and compatible skill loaders`,
  };
  marketplace.plugins = marketplace.plugins.filter((item) => item.name !== pluginName);
  marketplace.plugins.push(entry);
  writeJsonAlways(path, marketplace);
}

function upsertClaudeMarketplace() {
  const path = '.claude-plugin/marketplace.json';
  const marketplace = readJsonFileIfExists(pathOf(path), {
    name: pluginName,
    owner: { name: titleize(pluginName) },
    metadata: { description: `${titleize(pluginName)} trigger skills` },
    plugins: [],
  });
  marketplace.plugins = marketplace.plugins || [];
  const entry = {
    name: pluginName,
    source: `./${pluginDir}`,
    description: `${titleize(pluginName)} trigger skills for Claude Code`,
    version: pluginVersion,
    author: { name: titleize(pluginName) },
    category: 'workflow',
    strict: false,
  };
  marketplace.plugins = marketplace.plugins.filter((item) => item.name !== pluginName);
  marketplace.plugins.push(entry);
  writeJsonAlways(path, marketplace);
}

function writePlaybookPlaceholder() {
  const taskList = tasks.map((task) => `- ${task}`).join('\n');
  writeIfMissing(
    playbook,
    `# ${titleize(pluginName)} Playbook

This is the canonical playbook for the ${pluginName} trigger layer.

## Tasks

${taskList}

Keep project operating rules here. Codex skills, Claude commands, Cursor rules, and pointer docs should stay thin references to this file.

Maintenance contract: \`${markdownRelativePath(dirname(playbook), maintenanceContract)}\`
`,
  );
}

function writeMaintenanceContract() {
  writeIfMissing(
    maintenanceContract,
    `# Agent Trigger Layer Maintenance

This file is the maintenance contract for the project-local trigger layer.

- Keep long operating rules in the canonical playbook: \`${playbook}\`.
- Keep skills, commands, Cursor rules, and pointer docs as thin routing surfaces.
- For playbook refs with anchors, use simplified heading slugs: lowercase, trimmed, whitespace runs as hyphens, and only a-z, 0-9, and hyphen kept.
- Bump the local plugin version when plugin-visible files change: skills, commands, plugin manifests, or marketplace manifests.
- Keep install scope explicit: Agent Trigger Kit itself belongs at user scope, while this generated project ops plugin belongs to this project.
- For Claude Code, generated in-repo marketplaces are not auto-discovered; when explicit plugin loading is needed, add the marketplace and install this plugin with project scope.
- For Codex, there is no project plugin scope; add the project marketplace only for temporary verification, then remove the global config entry.
- Run the project trigger-layer validator after editing trigger surfaces.
`,
  );
}

function writePluginManifests() {
  writeJson(
    `${pluginDir}/.codex-plugin/plugin.json`,
    {
      name: pluginName,
      version: pluginVersion,
      description: `${titleize(pluginName)} trigger skills for Codex and compatible skill loaders`,
      author: { name: titleize(pluginName) },
      skills: './skills/',
      interface: {
        displayName: pluginName,
        shortDescription: `${titleize(pluginName)} playbook trigger skills`,
        longDescription: `Thin trigger skills that route ${pluginName} tasks to the canonical playbook.`,
        developerName: titleize(pluginName),
        category: 'Development',
      },
    },
    'plugin-manifest',
  );

  writeJson(
    `${pluginDir}/.claude-plugin/plugin.json`,
    {
      name: pluginName,
      version: pluginVersion,
      description: `${titleize(pluginName)} trigger skills for Claude-compatible skill loaders`,
      author: { name: titleize(pluginName) },
      skills: ['./skills/'],
      commands: ['./commands/'],
    },
    'plugin-manifest',
  );
}

function writeTaskWrappers() {
  for (const task of tasks) {
    const title = titleize(task);
    const description = `Use for ${title.toLowerCase()} work in this repo.`;
    const values = {
      taskName: task,
      taskTitle: title,
      description,
      pluginName,
    };
    const skillPath = `${pluginDir}/skills/${task}/SKILL.md`;
    write(
      skillPath,
      renderTemplate(wrapperTemplates.skill, {
        ...values,
        canonicalPlaybook: markdownRelativePath(dirname(skillPath), playbook),
        maintenanceContract: markdownRelativePath(dirname(skillPath), maintenanceContract),
      }),
      'skill',
    );

    write(
      `${pluginDir}/commands/${task}.md`,
      renderTemplate(wrapperTemplates.command, values),
      'command',
    );

    if (cursorGlobs.length > 0) {
      const globs = cursorGlobs.map((glob) => `  - ${glob}`).join('\n');
      write(
        `.cursor/rules/${task}.mdc`,
        renderTemplate(wrapperTemplates.cursorRule, {
          ...values,
          canonicalPlaybook: playbook,
          globs,
        }),
        'cursor-rule',
      );
    }
  }
}

function writeGeneratedManifest() {
  writeJsonFileCreatingParents(
    pathOf('.agent-trigger-kit/generated.json'),
    upsertGeneratedPluginEntry(
      previousGeneratedManifest,
      pluginName,
      {
        pluginVersion,
        playbook,
        maintenanceContract,
        tasks,
        files: generatedFiles,
      },
      {
        kitVersion: kitPackage.version,
        templateVersion,
      },
    ),
  );
  console.log('wrote .agent-trigger-kit/generated.json');
}

try {
  preflightForceOverwrites();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

upsertCodexMarketplace();
upsertClaudeMarketplace();
writePlaybookPlaceholder();
writeMaintenanceContract();
writePluginManifests();
writeTaskWrappers();
writeGeneratedManifest();

console.log(`created trigger layer for ${pluginName} with ${tasks.length} task(s) in ${root}`);
if (cursorGlobs.length === 0) {
  console.log('skipped Cursor rules because --cursor-globs was not provided');
}
