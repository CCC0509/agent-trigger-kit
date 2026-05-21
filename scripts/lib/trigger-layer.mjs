import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { createPathOf, readJsonFileIfExists, writeJsonFileCreatingParents } from './fs-json.mjs';
import {
  generatedPluginEntry,
  generatedPluginNames,
  upsertGeneratedPluginEntry,
} from './generated-manifest.mjs';
import { appendPlaybookFirstSignal, PLAYBOOK_FIRST_GUIDANCE } from './playbook-first-guidance.mjs';

export const DEFAULT_MAINTENANCE_CONTRACT = '.agent-trigger-kit/MAINTENANCE.md';
export const TEMPLATE_VERSION = 1;
export const SUPERPOWERS_HEADER_CHECKS = [
  {
    name: 'superpowers-plan-lifecycle',
    globs: ['docs/superpowers/specs/*.md', 'docs/superpowers/plans/*.md'],
    headerLines: 6,
    requirePattern: '^Status: ',
    exclude: ['docs/plans/**'],
  },
];

const kitPackage = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const templateRoot = new URL('../../templates/project-trigger-layer/', import.meta.url);
const wrapperTemplates = {
  skill: readTemplate('skill/SKILL.md.template'),
  command: readTemplate('command.md.template'),
  cursorRule: readTemplate('cursor-rule.mdc.template'),
};

function readTemplate(path) {
  return readFileSync(new URL(path, templateRoot), 'utf8');
}

function renderTemplate(template, values) {
  const unresolved = [];
  const rendered = template.replace(/{{([^}]+)}}/g, (match, key) => {
    if (!Object.hasOwn(values, key)) {
      unresolved.push(match);
      return match;
    }
    return values[key];
  });

  if (unresolved.length > 0) {
    throw new Error(`unresolved template placeholder(s): ${unresolved.join(', ')}`);
  }
  return rendered;
}

export function titleize(name) {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function markdownRelativePath(fromDir, toPath) {
  return relative(fromDir, toPath).replaceAll('\\', '/');
}

export function taskDescriptionFor(task) {
  return `Use for ${titleize(task).toLowerCase()} work in this repo.`;
}

function renderFrontmatterDescription(description) {
  const text = String(description).replace(/\r\n?/g, '\n');
  if (/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function createWriteContext(options) {
  const root = options.root;
  const pathOf = createPathOf(root);
  const pluginName = options.pluginName;
  const pluginDir = `plugins/${pluginName}`;
  const tasks = options.tasks;
  const playbook = options.playbook;
  const force = Boolean(options.force);
  const initialVersion = options.initialVersion || '0.1.0';
  const cursorGlobs = options.cursorGlobs || [];
  const taskDescriptions = options.taskDescriptions || new Map();
  const writePlaybookPlaceholder = options.writePlaybookPlaceholder ?? true;
  const playbookFirstGuidance = Boolean(options.playbookFirstGuidance);
  const preserveExistingPluginManifests = Boolean(options.preserveExistingPluginManifests);
  const requestedHeaderChecks = options.headerChecks;
  const generatedFiles = [];
  const previousGeneratedManifest = readJsonFileIfExists(
    pathOf('.agent-trigger-kit/generated.json'),
    null,
  );
  const generatedTargets = buildGeneratedTargets();
  const pluginVersion = existingPluginVersion();

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

  function existingPluginVersion() {
    const versions = [];
    const codexMarketplace = readJsonFileIfExists(pathOf('.agents/plugins/marketplace.json'), null);
    const codexEntry = codexMarketplace?.plugins?.find((entry) => entry.name === pluginName);
    if (codexEntry?.version) {
      versions.push({ label: 'codex marketplace', version: codexEntry.version });
    }

    const codexPlugin = readJsonFileIfExists(
      pathOf(`${pluginDir}/.codex-plugin/plugin.json`),
      null,
    );
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

  function trackPreservedGeneratedFile(path, kind) {
    const previousGeneratedEntry = generatedPluginEntry(previousGeneratedManifest, pluginName);
    const previousEntry = previousGeneratedEntry?.files?.find((file) => file.path === path);
    if (!previousEntry || previousEntry.kind !== kind) return;

    const currentSha256 = sha256(path);
    if (currentSha256 !== previousEntry.sha256) return;

    generatedFiles.push({
      path,
      kind,
      sha256: currentSha256,
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

  function writePlaybookPlaceholderFile() {
    const taskList = tasks.map((task) => `- ${task}`).join('\n');
    const sections = [
      `# ${titleize(pluginName)} Playbook

This is the canonical playbook for the ${pluginName} trigger layer.`,
    ];
    if (playbookFirstGuidance) {
      sections.push(`## Playbook-First Guidance

${PLAYBOOK_FIRST_GUIDANCE.guidance}`);
    }
    sections.push(
      `## Tasks

${taskList}`,
      'Keep project operating rules here. Codex skills, Claude commands, Cursor rules, and pointer docs should stay thin references to this file.',
      `Maintenance contract: \`${markdownRelativePath(dirname(playbook), DEFAULT_MAINTENANCE_CONTRACT)}\``,
    );
    writeIfMissing(playbook, sections.join('\n\n'));
  }

  function writeMaintenanceContract() {
    writeIfMissing(
      DEFAULT_MAINTENANCE_CONTRACT,
      `# Agent Trigger Layer Maintenance

This file is the maintenance contract for the project-local trigger layer.

- Keep long operating rules in the canonical playbook: \`${playbook}\`.
- Keep skills, commands, Cursor rules, and pointer docs as thin routing surfaces.
- For playbook refs with anchors, use simplified heading slugs: lowercase, trimmed, whitespace runs as hyphens, and only a-z, 0-9, and hyphen kept.
- Bump the local plugin version when plugin-visible files change: skills, commands, plugin manifests, or marketplace manifests.
- Keep install scope explicit: Agent Trigger Kit itself belongs at user scope, while this generated project ops plugin belongs to this project.
- For Claude Code, generated in-repo marketplaces are not auto-discovered; when explicit plugin loading is needed, add the marketplace and install this plugin with project scope.
- For Codex, there is no project plugin scope; add the project marketplace only for temporary verification, then remove the global config entry.
${playbookFirstGuidance ? '- Treat third-party plugin or global config changes as explicit fixes, not the default response to trigger collisions.\n' : ''}- Run the project trigger-layer validator after editing trigger surfaces.

## Optional Document Header Checks

To opt in, copy a headerChecks block into this plugin entry in
\`.agent-trigger-kit/generated.json\`. Example:

\`\`\`json
"headerChecks": [
  {
    "name": "superpowers-plan-lifecycle",
    "globs": ["docs/superpowers/specs/*.md", "docs/superpowers/plans/*.md"],
    "headerLines": 6,
    "requirePattern": "^Status: ",
    "exclude": ["docs/plans/**"]
  }
]
\`\`\`
`,
    );
  }

  function writePluginManifests() {
    const codexPluginPath = `${pluginDir}/.codex-plugin/plugin.json`;
    const claudePluginPath = `${pluginDir}/.claude-plugin/plugin.json`;

    if (preserveExistingPluginManifests && existsSync(pathOf(codexPluginPath))) {
      trackPreservedGeneratedFile(codexPluginPath, 'plugin-manifest');
      console.log(`kept ${codexPluginPath}`);
    } else {
      writeJson(
        codexPluginPath,
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
    }

    if (preserveExistingPluginManifests && existsSync(pathOf(claudePluginPath))) {
      trackPreservedGeneratedFile(claudePluginPath, 'plugin-manifest');
      console.log(`kept ${claudePluginPath}`);
    } else {
      writeJson(
        claudePluginPath,
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
  }

  function writeTaskWrappers() {
    for (const task of tasks) {
      const title = titleize(task);
      const baseDescription = taskDescriptions.get(task) || taskDescriptionFor(task);
      const routingDescription = renderFrontmatterDescription(baseDescription);
      const skillDescriptionText = playbookFirstGuidance
        ? appendPlaybookFirstSignal(baseDescription)
        : baseDescription;
      const skillDescription = renderFrontmatterDescription(skillDescriptionText);
      const values = {
        taskName: task,
        taskTitle: title,
        description: routingDescription,
        pluginName,
      };
      const skillPath = `${pluginDir}/skills/${task}/SKILL.md`;
      write(
        skillPath,
        renderTemplate(wrapperTemplates.skill, {
          ...values,
          description: skillDescription,
          canonicalPlaybook: markdownRelativePath(dirname(skillPath), playbook),
          maintenanceContract: markdownRelativePath(
            dirname(skillPath),
            DEFAULT_MAINTENANCE_CONTRACT,
          ),
          playbookFirstGuidanceChecklistItem: playbookFirstGuidance
            ? `- ${PLAYBOOK_FIRST_GUIDANCE.guidance}\n`
            : '',
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
    const previousPlugin = generatedPluginEntry(previousGeneratedManifest, pluginName);
    const resolvedHeaderChecks = requestedHeaderChecks ?? previousPlugin?.headerChecks;

    writeJsonFileCreatingParents(
      pathOf('.agent-trigger-kit/generated.json'),
      upsertGeneratedPluginEntry(
        previousGeneratedManifest,
        pluginName,
        {
          pluginVersion,
          playbook,
          maintenanceContract: DEFAULT_MAINTENANCE_CONTRACT,
          tasks,
          files: generatedFiles,
          ...(resolvedHeaderChecks ? { headerChecks: resolvedHeaderChecks } : {}),
          ...(playbookFirstGuidance
            ? { playbookFirstGuidance: { version: PLAYBOOK_FIRST_GUIDANCE.version } }
            : {}),
        },
        {
          kitVersion: kitPackage.version,
          templateVersion: TEMPLATE_VERSION,
        },
      ),
    );
    console.log('wrote .agent-trigger-kit/generated.json');
  }

  function printSummary() {
    console.log(`created trigger layer for ${pluginName} with ${tasks.length} task(s) in ${root}`);
    if (cursorGlobs.length === 0) {
      console.log('skipped Cursor rules because --cursor-globs was not provided');
    }
  }

  return {
    root,
    pathOf,
    pluginName,
    pluginDir,
    tasks,
    playbook,
    force,
    initialVersion,
    cursorGlobs,
    taskDescriptions,
    writePlaybookPlaceholder,
    playbookFirstGuidance,
    preserveExistingPluginManifests,
    generatedFiles,
    previousGeneratedManifest,
    generatedTargets,
    pluginVersion,
    preflightForceOverwrites,
    upsertCodexMarketplace,
    upsertClaudeMarketplace,
    writePlaybookPlaceholderFile,
    writeMaintenanceContract,
    writePluginManifests,
    writeTaskWrappers,
    writeGeneratedManifest,
    printSummary,
  };
}

export function writeTriggerLayer(options) {
  const context = createWriteContext(options);
  context.preflightForceOverwrites();
  context.upsertCodexMarketplace();
  context.upsertClaudeMarketplace();
  if (context.writePlaybookPlaceholder) context.writePlaybookPlaceholderFile();
  context.writeMaintenanceContract();
  context.writePluginManifests();
  context.writeTaskWrappers();
  context.writeGeneratedManifest();
  context.printSummary();
  return {
    pluginVersion: context.pluginVersion,
    generatedFiles: context.generatedFiles,
  };
}
