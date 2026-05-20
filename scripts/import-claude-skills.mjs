#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, requiredArg } from './lib/args.mjs';
import { createPathOf } from './lib/fs-json.mjs';
import { markdownRelativePath, titleize, writeTriggerLayer } from './lib/trigger-layer.mjs';

const CLAUDE_ONLY_TOOL_NAMES = ['Task', 'TodoWrite'];
const SAFE_PLUGIN_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripLeadingH1(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const firstContent = lines.findIndex((line) => line.trim() !== '');
  if (firstContent === -1) return '';
  if (!/^#\s+/.test(lines[firstContent])) {
    return `${trimBlankBoundaryLines(lines).join('\n')}\n`;
  }

  lines.splice(firstContent, 1);
  while (lines[firstContent]?.trim() === '') lines.splice(firstContent, 1);
  return `${trimBlankBoundaryLines(lines).join('\n')}\n`;
}

function trimBlankBoundaryLines(lines) {
  const trimmed = [...lines];
  while (trimmed[0]?.trim() === '') trimmed.shift();
  while (trimmed.at(-1)?.trim() === '') trimmed.pop();
  return trimmed;
}

function simplifiedHeadingSlug(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function parseClaudeSkill(text, path) {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const match = normalizedText.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${path}: missing frontmatter`);
  }

  const frontmatter = match[1];
  const body = match[2].replace(/^\n(?=#\s+)/, '');
  const values = {};
  const rawValues = {};

  for (const line of frontmatter.split('\n')) {
    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (keyValue) {
      rawValues[keyValue[1]] = keyValue[2].trim();
      values[keyValue[1]] = rawValues[keyValue[1]].replace(/^['"]|['"]$/g, '');
    }
  }

  for (const key of ['name', 'description']) {
    if (!values[key]) {
      throw new Error(`${path}: missing required frontmatter key ${key}`);
    }
    if (/^[>|][+-]?(?:\s+#.*)?$/.test(rawValues[key])) {
      throw new Error(`${path}: block scalar frontmatter is not supported for ${key}`);
    }
  }

  return {
    name: values.name,
    description: values.description,
    body,
  };
}

export function validateImportedTaskName(taskName, label = 'task name') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taskName)) {
    throw new Error(`${label} must be a clean kebab slug: ${taskName}`);
  }
  return taskName;
}

export function normalizeSkillBodyForPlaybook(body) {
  let fenceMarker = null;
  return stripLeadingH1(body)
    .split('\n')
    .map((line) => {
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence) {
        if (fenceMarker === null) {
          fenceMarker = fence[1];
        } else if (fence[1] === fenceMarker) {
          fenceMarker = null;
        }
        return line;
      }
      if (fenceMarker !== null) return line;
      const match = line.match(/^(\s{0,3})(#{1,5})(\s+.*)$/);
      if (!match) return line;
      return `${match[1]}${'#'.repeat(match[2].length + 1)}${match[3]}`;
    })
    .join('\n');
}

export function upsertPlaybookSection(playbookText, { task, body, replace = false }) {
  const normalizedBody = body.trimEnd();
  const section = `## ${task}\n\n${normalizedBody}\n`;
  const sectionPattern = new RegExp(`(^|\\n)## ${escapeRegExp(task)}\\n[\\s\\S]*?(?=\\n## |$)`);
  const match = playbookText.match(sectionPattern);

  if (!match) {
    return `${playbookText.trimEnd()}\n\n${section}`;
  }

  if (!replace) {
    throw new Error(`playbook already has section ## ${task}; pass --replace-playbook-section`);
  }

  const prefix = match[1] || '';
  return playbookText.replace(sectionPattern, () => `${prefix}${section}`);
}

export function findDuplicateHeadingSlugs(markdownText) {
  const seen = new Map();
  const duplicates = new Map();

  for (const line of markdownText.split('\n')) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const heading = match[1];
    const slug = simplifiedHeadingSlug(heading);
    if (!slug) continue;

    if (!seen.has(slug)) {
      seen.set(slug, heading);
      continue;
    }

    const headings = duplicates.get(slug) || [seen.get(slug)];
    headings.push(heading);
    duplicates.set(slug, headings);
  }

  return [...duplicates.entries()].map(([slug, headings]) => ({ slug, headings }));
}

export function assertNoDuplicateHeadingSlugs(markdownText) {
  const duplicates = findDuplicateHeadingSlugs(markdownText);
  if (duplicates.length === 0) return;

  const details = duplicates
    .map((entry) => `${entry.slug} (${entry.headings.join(' / ')})`)
    .join(', ');
  throw new Error(`playbook would contain duplicate heading slug ${details}`);
}

export function lintClaudeOnlyToolRefs(text) {
  const found = new Set();
  for (const toolName of CLAUDE_ONLY_TOOL_NAMES) {
    const escaped = escapeRegExp(toolName);
    if (new RegExp(`\`${escaped}\``).test(text)) found.add(toolName);
    if (new RegExp(`\\buse the ${escaped} tool\\b`, 'i').test(text)) found.add(toolName);
  }
  return [...found].sort();
}

function validatePluginName(pluginName) {
  if (!SAFE_PLUGIN_NAME_PATTERN.test(pluginName)) {
    throw new Error(`Invalid plugin name "${pluginName}": --plugin must be a simple plugin id.`);
  }
  return pluginName;
}

function isPathInside(parent, child) {
  const relativePath = relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function sourcePathFor(root, source) {
  const rootPath = resolve(root);
  const sourcePath = resolve(rootPath, source);
  if (!isPathInside(rootPath, sourcePath)) {
    throw new Error(`${source}: source directory must stay inside --root`);
  }
  if (existsSync(sourcePath)) {
    const realRootPath = realpathSync(rootPath);
    const realSourcePath = realpathSync(sourcePath);
    if (!isPathInside(realRootPath, realSourcePath)) {
      throw new Error(`${source}: source directory must stay inside --root`);
    }
  }
  return sourcePath;
}

function playbookPathFor(root, playbook) {
  const rootPath = resolve(root);
  const playbookPath = resolve(rootPath, playbook);
  if (!isPathInside(rootPath, playbookPath)) {
    throw new Error(`${playbook}: playbook path must stay inside --root`);
  }

  let parentPath = dirname(playbookPath);
  while (!existsSync(parentPath)) {
    const nextParent = dirname(parentPath);
    if (nextParent === parentPath) break;
    parentPath = nextParent;
  }

  const realRootPath = realpathSync(rootPath);
  const realParentPath = realpathSync(parentPath);
  if (!isPathInside(realRootPath, realParentPath)) {
    throw new Error(`${playbook}: playbook path must stay inside --root`);
  }

  return playbookPath;
}

function assertSkillPathInsideSource(root, source, sourcePath, skillName, skillPath) {
  const realRootPath = realpathSync(resolve(root));
  const realSourcePath = realpathSync(sourcePath);
  const realSkillPath = realpathSync(skillPath);
  if (!isPathInside(realRootPath, realSkillPath) || !isPathInside(realSourcePath, realSkillPath)) {
    throw new Error(`${source}/${skillName}/SKILL.md: skill path must stay inside --source`);
  }
}

function selectedSkillDirs(root, source, selectedSkills) {
  const sourcePath = sourcePathFor(root, source);
  if (!existsSync(sourcePath)) {
    throw new Error(`${source}: source directory does not exist`);
  }

  if (selectedSkills.length > 0) {
    return selectedSkills.map((name) => {
      validateImportedTaskName(name, 'selected skill name');
      const skillPath = join(sourcePath, name, 'SKILL.md');
      if (!existsSync(skillPath)) {
        throw new Error(`${source}/${name}/SKILL.md: selected skill is missing`);
      }
      assertSkillPathInsideSource(root, source, sourcePath, name, skillPath);
      return { name, skillPath };
    });
  }

  const dirs = readdirSync(sourcePath)
    .sort()
    .map((name) => ({ name, skillPath: join(sourcePath, name, 'SKILL.md') }))
    .filter((entry) => existsSync(entry.skillPath));

  for (const entry of dirs) {
    assertSkillPathInsideSource(root, source, sourcePath, entry.name, entry.skillPath);
  }

  if (dirs.length === 0) {
    throw new Error(`${source}: no skill directories with SKILL.md found`);
  }

  return dirs;
}

function parseCommaList(value, options = {}) {
  if (value === undefined) return [];
  if (typeof value !== 'string') {
    if (options.rejectEmpty) {
      throw new Error(`${options.label || 'comma list value'} must not be empty`);
    }
    return [];
  }

  const items = value.split(',').map((item) => item.trim());
  if (options.rejectEmpty && items.some((item) => item === '')) {
    throw new Error(`${options.label || 'comma list value'} must not be empty`);
  }
  return items.filter(Boolean);
}

function playbookHeader(pluginName, maintenanceRef) {
  return `# ${titleize(pluginName)} Playbook

This is the canonical playbook for the ${pluginName} trigger layer.

Imported Claude Code skill bodies live in task sections below. Codex skills, Claude commands, Cursor rules, and pointer docs should stay thin references to this file.

Maintenance contract: \`${maintenanceRef}\`
`;
}

function preflightGeneratedTargets({ pathOf, pluginName, tasks, cursorGlobs }) {
  const pluginDir = `plugins/${pluginName}`;
  const targets = [
    `${pluginDir}/.codex-plugin/plugin.json`,
    `${pluginDir}/.claude-plugin/plugin.json`,
  ];

  for (const task of tasks) {
    targets.push(`${pluginDir}/skills/${task}/SKILL.md`);
    targets.push(`${pluginDir}/commands/${task}.md`);
    if (cursorGlobs.length > 0) {
      targets.push(`.cursor/rules/${task}.mdc`);
    }
  }

  for (const target of targets) {
    if (existsSync(pathOf(target))) {
      throw new Error(`${target} already exists; rerun with --force to overwrite generated files`);
    }
  }
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, {
    booleanKeys: ['force', 'keep-source', 'replace-playbook-section'],
  });
  const root = normalize(requiredArg(args, 'root'));
  const pathOf = createPathOf(root);
  const source = requiredArg(args, 'source');
  const pluginName = validatePluginName(requiredArg(args, 'plugin'));
  const playbook = requiredArg(args, 'playbook');
  const selectedSkills = parseCommaList(args.skills, {
    rejectEmpty: args.skills !== undefined,
    label: 'selected skill name',
  });
  const cursorGlobs = parseCommaList(args['cursor-globs']);

  const imported = [];
  const warnings = [];
  for (const entry of selectedSkillDirs(root, source, selectedSkills)) {
    const parsed = parseClaudeSkill(readFileSync(entry.skillPath, 'utf8'), entry.skillPath);
    const task = validateImportedTaskName(parsed.name, `${entry.name} frontmatter name`);
    if (task !== entry.name) {
      warnings.push(`${entry.name} directory imports task ${task}`);
    }

    const toolRefs = lintClaudeOnlyToolRefs(parsed.body);
    if (toolRefs.length > 0) {
      warnings.push(`${task}: Claude-specific tool references found: ${toolRefs.join(', ')}`);
    }

    imported.push({
      task,
      description: parsed.description,
      body: normalizeSkillBodyForPlaybook(parsed.body),
      sourcePath: entry.skillPath,
    });
  }

  const taskNames = imported.map((item) => item.task);
  if (new Set(taskNames).size !== taskNames.length) {
    throw new Error(`duplicate imported skill names: ${taskNames.join(', ')}`);
  }

  const playbookPath = playbookPathFor(root, playbook);
  const maintenanceRef = markdownRelativePath(
    dirname(playbook),
    '.agent-trigger-kit/MAINTENANCE.md',
  );
  let playbookText = existsSync(playbookPath)
    ? readFileSync(playbookPath, 'utf8')
    : playbookHeader(pluginName, maintenanceRef);

  for (const item of imported) {
    playbookText = upsertPlaybookSection(playbookText, {
      task: item.task,
      body: item.body,
      replace: Boolean(args['replace-playbook-section']),
    });
  }
  assertNoDuplicateHeadingSlugs(playbookText);

  if (!args.force) {
    preflightGeneratedTargets({
      pathOf,
      pluginName,
      tasks: taskNames,
      cursorGlobs,
    });
  }

  writeTriggerLayer({
    root,
    pluginName,
    tasks: taskNames,
    playbook,
    cursorGlobs,
    force: Boolean(args.force),
    initialVersion: args['initial-version'] || '0.1.0',
    taskDescriptions: new Map(imported.map((item) => [item.task, item.description])),
    writePlaybookPlaceholder: false,
  });

  mkdirSync(dirname(playbookPath), { recursive: true });
  writeFileSync(playbookPath, `${playbookText.trimEnd()}\n`);

  for (const warning of warnings) {
    console.error(`warning: ${warning}; consider rewriting the playbook in cross-agent terms`);
  }

  if (!args['keep-source']) {
    for (const item of imported) {
      rmSync(dirname(item.sourcePath), { recursive: true, force: true });
      console.log(`deleted ${resolve(item.sourcePath)}`);
    }
  }

  console.log(`imported ${imported.length} Claude skill(s) into ${pluginName}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
