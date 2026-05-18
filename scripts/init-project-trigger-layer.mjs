#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, normalize } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = normalize(required('root'));
const pluginName = required('plugin');
const tasks = required('tasks').split(',').map((item) => item.trim()).filter(Boolean);
const playbook = required('playbook');
const force = Boolean(args.force);
const cursorGlobs = args['cursor-globs'] ? args['cursor-globs'].split(',').map((item) => item.trim()).filter(Boolean) : [];

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

function titleize(name) {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function write(path, content) {
  const full = pathOf(path);
  if (existsSync(full) && !force) {
    throw new Error(`${path} already exists; rerun with --force to overwrite generated files`);
  }
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, `${content.trimEnd()}\n`);
  console.log(`wrote ${path}`);
}

function readJsonIfExists(path, fallback) {
  if (!existsSync(pathOf(path))) return fallback;
  return JSON.parse(readFileSync(pathOf(path), 'utf8'));
}

function writeJson(path, value) {
  write(path, JSON.stringify(value, null, 2));
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

function upsertCodexMarketplace() {
  const path = '.agents/plugins/marketplace.json';
  const marketplace = readJsonIfExists(path, {
    name: pluginName,
    interface: { displayName: `${titleize(pluginName)} Plugins` },
    plugins: [],
  });
  marketplace.plugins = marketplace.plugins || [];
  const entry = {
    name: pluginName,
    version: '0.1.0',
    source: { source: 'local', path: `./plugins/${pluginName}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity',
    description: `${titleize(pluginName)} trigger skills for Codex and compatible skill loaders`,
  };
  marketplace.plugins = marketplace.plugins.filter((item) => item.name !== pluginName);
  marketplace.plugins.push(entry);
  writeJson(path, marketplace);
}

function upsertClaudeMarketplace() {
  const path = '.claude-plugin/marketplace.json';
  const marketplace = readJsonIfExists(path, {
    name: pluginName,
    owner: { name: titleize(pluginName) },
    metadata: { description: `${titleize(pluginName)} trigger skills` },
    plugins: [],
  });
  marketplace.plugins = marketplace.plugins || [];
  const entry = {
    name: pluginName,
    source: `./plugins/${pluginName}`,
    description: `${titleize(pluginName)} trigger skills for Claude Code`,
    version: '0.1.0',
    author: { name: titleize(pluginName) },
    category: 'workflow',
    strict: false,
  };
  marketplace.plugins = marketplace.plugins.filter((item) => item.name !== pluginName);
  marketplace.plugins.push(entry);
  writeJson(path, marketplace);
}

function writePlaybookPlaceholder() {
  const taskList = tasks.map((task) => `- ${task}`).join('\n');
  writeIfMissing(playbook, `# ${titleize(pluginName)} Playbook

This is the canonical playbook for the ${pluginName} trigger layer.

## Tasks

${taskList}

Keep project operating rules here. Codex skills, Claude commands, Cursor rules, and pointer docs should stay thin references to this file.
`);
}

function writePluginManifests() {
  writeJson(`plugins/${pluginName}/.codex-plugin/plugin.json`, {
    name: pluginName,
    version: '0.1.0',
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
  });

  writeJson(`plugins/${pluginName}/.claude-plugin/plugin.json`, {
    name: pluginName,
    version: '0.1.0',
    description: `${titleize(pluginName)} trigger skills for Claude-compatible skill loaders`,
    author: { name: titleize(pluginName) },
    skills: ['./skills/'],
    commands: ['./commands/'],
  });
}

function writeTaskWrappers() {
  for (const task of tasks) {
    const title = titleize(task);
    const description = `Use for ${title.toLowerCase()} work in this repo.`;
    write(`plugins/${pluginName}/skills/${task}/SKILL.md`, `---
name: ${task}
description: ${description}
---

# ${title}

This is a trigger layer only; canonical rules remain in repo playbooks.

## Must Read

- \`../../../../${playbook}\`

## Checklist

- State the matched playbook before acting.
- Keep this wrapper short; do not copy long SOP bodies here.
- Run the project trigger-layer validator when editing trigger surfaces.
`);

    write(`plugins/${pluginName}/commands/${task}.md`, `---
description: ${description}
---

# ${title} Command

Use this when invoking \`/${task}\`. The maintained workflow lives in \`skills/${task}/SKILL.md\`.

## Arguments

\`$ARGUMENTS\`

## Delegation

Apply the \`${pluginName}:${task}\` skill before answering or acting.
- Follow the canonical playbook references from the skill.
- Keep this command as a thin Claude Code slash entry point.
- Do not duplicate or replace canonical playbook content here.
`);

    if (cursorGlobs.length > 0) {
      const globs = cursorGlobs.map((glob) => `  - ${glob}`).join('\n');
      write(`.cursor/rules/${task}.mdc`, `---
description: ${description}
globs:
${globs}
---

Read the canonical playbook before acting:

- \`${playbook}\`

This file is a trigger wrapper only. Do not duplicate long SOP content here.
`);
    }
  }
}

upsertCodexMarketplace();
upsertClaudeMarketplace();
writePlaybookPlaceholder();
writePluginManifests();
writeTaskWrappers();

console.log(`created trigger layer for ${pluginName} with ${tasks.length} task(s) in ${root}`);
if (cursorGlobs.length === 0) {
  console.log('skipped Cursor rules because --cursor-globs was not provided');
}
