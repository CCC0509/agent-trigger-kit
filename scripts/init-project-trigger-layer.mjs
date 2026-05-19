#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

import { parseArgs, requiredArg } from './lib/args.mjs';
import { createPathOf, readJsonFileIfExists, writeJsonFileCreatingParents } from './lib/fs-json.mjs';

const args = parseArgs(process.argv.slice(2));
const root = normalize(requiredArg(args, 'root'));
const pathOf = createPathOf(root);
const pluginName = requiredArg(args, 'plugin');
const tasks = requiredArg(args, 'tasks').split(',').map((item) => item.trim()).filter(Boolean);
const playbook = requiredArg(args, 'playbook');
const force = Boolean(args.force);
const cursorGlobs = args['cursor-globs'] ? args['cursor-globs'].split(',').map((item) => item.trim()).filter(Boolean) : [];
const templateRoot = new URL('../templates/project-trigger-layer/', import.meta.url);
const wrapperTemplates = {
  skill: readTemplate('skill/SKILL.md.template'),
  command: readTemplate('command.md.template'),
  cursorRule: readTemplate('cursor-rule.mdc.template'),
};

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
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function markdownRelativePath(fromDir, toPath) {
  return relative(fromDir, toPath).replaceAll('\\', '/');
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

function writeJson(path, value) {
  write(path, JSON.stringify(value, null, 2));
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
    version: '0.1.0',
    source: { source: 'local', path: `./plugins/${pluginName}` },
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
    source: `./plugins/${pluginName}`,
    description: `${titleize(pluginName)} trigger skills for Claude Code`,
    version: '0.1.0',
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
    const values = {
      taskName: task,
      taskTitle: title,
      description,
      pluginName,
    };
    const skillPath = `plugins/${pluginName}/skills/${task}/SKILL.md`;
    write(skillPath, renderTemplate(wrapperTemplates.skill, {
      ...values,
      canonicalPlaybook: markdownRelativePath(dirname(skillPath), playbook),
    }));

    write(`plugins/${pluginName}/commands/${task}.md`, renderTemplate(wrapperTemplates.command, values));

    if (cursorGlobs.length > 0) {
      const globs = cursorGlobs.map((glob) => `  - ${glob}`).join('\n');
      write(`.cursor/rules/${task}.mdc`, renderTemplate(wrapperTemplates.cursorRule, {
        ...values,
        canonicalPlaybook: playbook,
        globs,
      }));
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
