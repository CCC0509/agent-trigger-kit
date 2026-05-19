#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { createPathOf } from './lib/fs-json.mjs';
import {
  generatedPluginEntry,
  generatedPluginNames,
  normalizeGeneratedManifest,
} from './lib/generated-manifest.mjs';

const args = parseArgs(process.argv.slice(2), { booleanKeys: ['require-version-bump'] });
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const failures = [];
const skillNames = new Map();
const commandNames = new Map();
const markdownHeadingCache = new Map();
const reportedDuplicateHeadingSlugs = new Set();
const requireVersionBump = args['require-version-bump'] === true;
const versionBumpBase = args.base;
const versionBumpPlugin = typeof args.plugin === 'string' ? args.plugin.trim() : '';

if (requireVersionBump && (typeof versionBumpBase !== 'string' || versionBumpBase.trim() === '')) {
  console.error('--require-version-bump requires --base <ref>');
  process.exit(2);
}

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

function parseJsonText(path, text) {
  try {
    return JSON.parse(text);
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
  const frontmatter = parseFrontmatter(path, text);
  if (!frontmatter) return false;
  validateFrontmatterKeys(path, frontmatter, keys);
  return true;
}

function validateFrontmatterKeys(path, frontmatter, keys) {
  for (const key of keys) {
    if (!new RegExp(`^${key}:`, 'm').test(frontmatter)) {
      fail(`${path}: missing frontmatter key ${key}`);
    }
  }
}

function parseFrontmatter(path, text = read(path)) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    fail(`${path}: missing frontmatter`);
    return null;
  }
  return match[1];
}

function frontmatterValue(frontmatter, key) {
  return frontmatter?.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))?.[1]?.trim() || null;
}

function localBacktickRefs(text) {
  return [...text.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1])
    .filter((ref) => {
      if (ref.startsWith('/') || ref.startsWith('#')) return false;
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return false;
      return /\.md(?:#[^`\s#]+)?$/.test(ref);
    });
}

function parseMarkdownRef(ref) {
  const [path, anchor] = ref.split('#');
  return { path, anchor };
}

function simplifiedHeadingSlug(heading) {
  return heading
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function markdownHeadingSlugs(path) {
  if (markdownHeadingCache.has(path)) return markdownHeadingCache.get(path);

  const slugs = new Map();
  const duplicateSlugs = new Set();
  for (const line of read(path).split('\n')) {
    const match = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const slug = simplifiedHeadingSlug(match[1]);
    if (!slug) continue;
    if (slugs.has(slug)) duplicateSlugs.add(slug);
    slugs.set(slug, (slugs.get(slug) || 0) + 1);
  }

  const result = { slugs, duplicateSlugs };
  markdownHeadingCache.set(path, result);
  return result;
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
    const { path: refPath, anchor } = parseMarkdownRef(ref);
    const candidate = normalize(join(baseDir, refPath));
    if (!existsSync(pathOf(candidate))) {
      fail(`${path}: missing canonical playbook ${candidate}`);
      continue;
    }
    const { slugs, duplicateSlugs } = markdownHeadingSlugs(candidate);
    for (const duplicateSlug of duplicateSlugs) {
      const duplicateKey = `${candidate}\0${duplicateSlug}`;
      if (!reportedDuplicateHeadingSlugs.has(duplicateKey)) {
        fail(`${candidate}: duplicate heading slug ${duplicateSlug}`);
        reportedDuplicateHeadingSlugs.add(duplicateKey);
      }
    }
    if (!anchor) continue;

    if (!slugs.has(anchor)) {
      fail(`${path}: missing canonical playbook anchor ${anchor} in ${candidate}`);
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

function recordName(map, name, entry) {
  const entries = map.get(name) || [];
  entries.push(entry);
  map.set(name, entries);
}

function validateNameCollisions(map, kind) {
  for (const [name, entries] of map) {
    if (entries.length < 2) continue;
    fail(
      `${kind} name collision ${name}: ${entries.map((entry) => `${entry.plugin} (${entry.path})`).join(', ')}`,
    );
  }
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

  const visibleSkillNames = new Set();
  for (const skillName of listDirs(`${plugin.pluginDir}/skills`)) {
    const skillPath = `${plugin.pluginDir}/skills/${skillName}/SKILL.md`;
    if (!existsSync(pathOf(skillPath))) {
      fail(`${skillPath}: missing`);
      continue;
    }
    const skillText = read(skillPath);
    const frontmatter = parseFrontmatter(skillPath, skillText);
    if (frontmatter) validateFrontmatterKeys(skillPath, frontmatter, ['name', 'description']);
    const visibleSkillName = frontmatterValue(frontmatter, 'name') || skillName;
    visibleSkillNames.add(visibleSkillName);
    recordName(skillNames, visibleSkillName, {
      plugin: plugin.name,
      path: skillPath,
    });
    validateCanonicalRefs(skillPath, dirname(skillPath), sectionBody(skillText, 'Must Read'));
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
      recordName(commandNames, file.replace(/\.md$/, ''), {
        plugin: plugin.name,
        path: commandPath,
      });
      hasFrontmatter(commandPath, ['description']);
      const commandText = read(commandPath);
      const delegations = [...commandText.matchAll(delegationPattern)].map((match) => match[1]);
      if (delegations.length === 0) {
        fail(`${commandPath}: missing delegation to ${plugin.name}:<skill>`);
      }
      for (const skillName of delegations) {
        if (!visibleSkillNames.has(skillName)) {
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

function validateMaintenanceContractPointers() {
  const generatedPath = '.agent-trigger-kit/generated.json';
  if (!existsSync(pathOf(generatedPath))) return;

  const generated = parseJson(generatedPath);
  if (!generated) return;

  const normalized = normalizeGeneratedManifest(generated);
  for (const plugin of Object.values(normalized.plugins)) {
    for (const entry of plugin.files || []) {
      if (entry?.kind !== 'skill' || typeof entry.path !== 'string') continue;
      if (!existsSync(pathOf(entry.path))) continue;
      if (!/Maintenance contract:\s*`[^`]+`/.test(read(entry.path))) {
        fail(`${entry.path}: missing maintenance contract pointer`);
      }
    }
  }
}

function runGit(argsToRun) {
  const result = spawnSync('git', argsToRun, { cwd: root, encoding: 'utf8' });
  if (result.error) {
    return {
      ok: false,
      missingGit: result.error.code === 'ENOENT',
      message: result.error.message,
      stdout: '',
      stderr: '',
    };
  }
  return {
    ok: result.status === 0,
    missingGit: false,
    message: result.stderr || result.stdout,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function shallowFetchHint(operation, details = '') {
  return `${operation} failed. Run git fetch --unshallow or use fetch-depth: 0 before running --require-version-bump.${details ? ` ${details.trim()}` : ''}`;
}

function normalizeGeneratedPath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function showFile(ref, path) {
  const result = runGit(['show', `${ref}:${path}`]);
  if (!result.ok) return null;
  return result.stdout;
}

function marketplaceEntry(json, pluginName) {
  return (json?.plugins || []).find((plugin) => plugin?.name === pluginName) || null;
}

function marketplaceEntryChanged(path, mergeBase, pluginName) {
  const baseText = showFile(mergeBase, path);
  const currentText = showFile('HEAD', path);
  const baseEntry = baseText
    ? marketplaceEntry(parseJsonText(`${mergeBase}:${path}`, baseText), pluginName)
    : null;
  const currentEntry = currentText
    ? marketplaceEntry(parseJsonText(`HEAD:${path}`, currentText), pluginName)
    : null;
  return stableStringify(baseEntry) !== stableStringify(currentEntry);
}

function sourceVersionsFromJson(ref, path) {
  const text = showFile(ref, path);
  if (!text) return null;
  return parseJsonText(`${ref}:${path}`, text);
}

function pluginDirFromEntry(entry, surface) {
  const sourcePath = surface === 'codex' ? entry?.source?.path : entry?.source;
  return typeof sourcePath === 'string' ? sourcePath.replace(/^\.\//, '') : '';
}

function packageNameMatchesPlugin(packageName, pluginName) {
  return packageName === pluginName || packageName?.endsWith(`/${pluginName}`);
}

function pluginVersionSnapshot(ref, pluginName) {
  const versions = [];
  const errors = [];
  const packageJson = sourceVersionsFromJson(ref, 'package.json');
  const codexMarketplace = sourceVersionsFromJson(ref, '.agents/plugins/marketplace.json');
  const claudeMarketplace = sourceVersionsFromJson(ref, '.claude-plugin/marketplace.json');
  const codexEntry = marketplaceEntry(codexMarketplace, pluginName);
  const claudeEntry = marketplaceEntry(claudeMarketplace, pluginName);
  const pluginDir =
    pluginDirFromEntry(codexEntry, 'codex') || pluginDirFromEntry(claudeEntry, 'claude');
  const refName = ref || 'current';

  if (codexEntry?.version) {
    versions.push(codexEntry.version);
  } else {
    errors.push(`${refName}: missing Codex marketplace entry version for ${pluginName}`);
  }

  if (claudeEntry?.version) {
    versions.push(claudeEntry.version);
  } else {
    errors.push(`${refName}: missing Claude marketplace entry version for ${pluginName}`);
  }

  if (packageNameMatchesPlugin(packageJson?.name, pluginName)) {
    if (packageJson?.version) {
      versions.push(packageJson.version);
    } else {
      errors.push(`${refName}: missing package.json version for ${pluginName}`);
    }
  }

  if (!pluginDir) {
    errors.push(`${refName}: missing plugin source path for ${pluginName}`);
  } else {
    const codexManifestPath = `${pluginDir}/.codex-plugin/plugin.json`;
    const claudeManifestPath = `${pluginDir}/.claude-plugin/plugin.json`;
    const codexManifest = sourceVersionsFromJson(ref, codexManifestPath);
    const claudeManifest = sourceVersionsFromJson(ref, claudeManifestPath);

    if (codexManifest?.version) {
      versions.push(codexManifest.version);
    } else {
      errors.push(`${refName}: missing Codex plugin manifest version at ${codexManifestPath}`);
    }

    if (claudeManifest?.version) {
      versions.push(claudeManifest.version);
    } else {
      errors.push(`${refName}: missing Claude plugin manifest version at ${claudeManifestPath}`);
    }
  }

  const uniqueVersions = new Set(versions);
  if (errors.length > 0 || uniqueVersions.size !== 1) {
    return {
      version: null,
      error: `${refName}: cannot determine aligned plugin version for ${pluginName}${
        errors.length > 0 ? ` (${errors.join('; ')})` : ''
      }`,
    };
  }

  return { version: versions[0], error: null };
}

function parseCleanSemver(version, label) {
  const match = version?.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (!match) return { parts: null, error: `${label} is not clean semver x.y.z: ${version}` };
  return { parts: match.slice(1).map(Number), error: null };
}

function compareCleanSemver(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function generatedPluginVisiblePaths(ref, pluginName) {
  const generatedText = showFile(ref, '.agent-trigger-kit/generated.json');
  if (!generatedText) return [];

  const generated = parseJsonText(`${ref}:.agent-trigger-kit/generated.json`, generatedText);
  const pluginVisibleKinds = new Set(['skill', 'command', 'plugin-manifest']);
  return (generatedPluginEntry(generated, pluginName)?.files || [])
    .filter((entry) => pluginVisibleKinds.has(entry?.kind) && typeof entry.path === 'string')
    .map((entry) => normalizeGeneratedPath(entry.path));
}

function versionBumpGeneratedPluginName(generated, generatedPath) {
  if (!generated) return null;

  if (generated.schemaVersion !== 2) {
    if (!generated.pluginName) {
      fail(`${generatedPath}: missing pluginName required by --require-version-bump`);
      return null;
    }
    if (versionBumpPlugin && versionBumpPlugin !== generated.pluginName) {
      fail(
        `${generatedPath}: --plugin ${versionBumpPlugin} does not match generated pluginName ${generated.pluginName}`,
      );
      return null;
    }
    return generated.pluginName;
  }

  const pluginNames = generatedPluginNames(generated);
  if (versionBumpPlugin) {
    if (!pluginNames.includes(versionBumpPlugin)) {
      fail(`${generatedPath}: --plugin ${versionBumpPlugin} is not present in generated manifest`);
      return null;
    }
    return versionBumpPlugin;
  }

  if (pluginNames.length === 1) {
    return pluginNames[0];
  }

  if (pluginNames.length > 1) {
    fail(
      `${generatedPath}: multiple plugins (${pluginNames.join(', ')}) require --plugin <name> with --require-version-bump`,
    );
    return null;
  }

  fail(`${generatedPath}: missing plugin entry required by --require-version-bump`);
  return null;
}

function validateRequiredVersionBump() {
  if (!requireVersionBump) return;

  const generatedPath = '.agent-trigger-kit/generated.json';
  if (!existsSync(pathOf(generatedPath))) {
    fail(`${generatedPath}: required by --require-version-bump to identify the plugin`);
    return;
  }

  const generated = parseJson(generatedPath);
  const pluginName = versionBumpGeneratedPluginName(generated, generatedPath);
  if (!pluginName) return;

  const gitVersion = runGit(['--version']);
  if (!gitVersion.ok) {
    fail(
      gitVersion.missingGit
        ? '--require-version-bump requires git, but the git binary was not found'
        : `--require-version-bump requires git, but git --version failed: ${gitVersion.message}`,
    );
    return;
  }

  const mergeBaseResult = runGit(['merge-base', versionBumpBase, 'HEAD']);
  if (!mergeBaseResult.ok) {
    fail(shallowFetchHint(`git merge-base ${versionBumpBase} HEAD`, mergeBaseResult.message));
    return;
  }
  const mergeBase = mergeBaseResult.stdout.trim();

  const diffResult = runGit(['diff', '--name-only', `${versionBumpBase}...HEAD`]);
  if (!diffResult.ok) {
    fail(shallowFetchHint(`git diff --name-only ${versionBumpBase}...HEAD`, diffResult.message));
    return;
  }

  const changedFiles = new Set(
    diffResult.stdout
      .split('\n')
      .map((path) => path.trim())
      .filter(Boolean)
      .map(normalizeGeneratedPath),
  );
  const pluginVisibleChanges = [];
  const generatedPluginVisiblePathsByPath = new Set([
    ...generatedPluginVisiblePaths(mergeBase, pluginName),
    ...generatedPluginVisiblePaths('HEAD', pluginName),
  ]);

  for (const entryPath of generatedPluginVisiblePathsByPath) {
    if (changedFiles.has(entryPath)) pluginVisibleChanges.push(entryPath);
  }

  for (const marketplacePath of [
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
  ]) {
    if (
      changedFiles.has(marketplacePath) &&
      marketplaceEntryChanged(marketplacePath, mergeBase, pluginName)
    ) {
      pluginVisibleChanges.push(marketplacePath);
    }
  }

  if (pluginVisibleChanges.length === 0) return;

  const baseSnapshot = pluginVersionSnapshot(mergeBase, pluginName);
  const currentSnapshot = pluginVersionSnapshot('HEAD', pluginName);
  if (baseSnapshot.error || currentSnapshot.error) {
    fail(
      `Cannot determine plugin version for --require-version-bump: ${[
        baseSnapshot.error,
        currentSnapshot.error,
      ]
        .filter(Boolean)
        .join('; ')}`,
    );
    return;
  }

  const baseSemver = parseCleanSemver(baseSnapshot.version, 'base plugin version');
  const currentSemver = parseCleanSemver(currentSnapshot.version, 'current plugin version');
  if (baseSemver.error || currentSemver.error) {
    fail(
      `Cannot determine plugin version bump for --require-version-bump: ${[
        baseSemver.error,
        currentSemver.error,
      ]
        .filter(Boolean)
        .join('; ')}`,
    );
    return;
  }

  if (compareCleanSemver(currentSemver.parts, baseSemver.parts) <= 0) {
    fail(
      `Version bump required for plugin-visible trigger-layer changes: current plugin version ${currentSnapshot.version} must be greater than base plugin version ${baseSnapshot.version}; changed files: ${pluginVisibleChanges.join(', ')}`,
    );
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
validateNameCollisions(skillNames, 'skill');
validateNameCollisions(commandNames, 'command');
validateCursorRules();
validateMaintenanceContractPointers();
validateRequiredVersionBump();

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`trigger layer validation passed for ${root}`);
