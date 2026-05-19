#!/usr/bin/env node
import { normalize } from 'node:path';

import { parseArgs, requiredArg } from './lib/args.mjs';
import { createPathOf, readJsonFileIfExists, updateJsonFileIfExists } from './lib/fs-json.mjs';

const args = parseArgs(process.argv.slice(2), {
  booleanKeys: ['include-package', 'no-include-package'],
});
const root = normalize(args.root || process.cwd());
const pathOf = createPathOf(root);
const pluginName = requiredArg(args, 'plugin');
const surface = args.surface || 'all';
const requestedVersion = args.version;
const requestedNext = args.next;

if (!['all', 'codex', 'claude'].includes(surface)) {
  console.error('--surface must be all, codex, or claude');
  process.exit(2);
}

if (requestedVersion && requestedNext) {
  console.error('--version and --next cannot both be set');
  process.exit(2);
}

if (!requestedVersion && !requestedNext) {
  console.error('Missing required --version or --next');
  process.exit(2);
}

if (args['include-package'] && args['no-include-package']) {
  console.error('--include-package and --no-include-package cannot both be set');
  process.exit(2);
}

if (requestedNext && !['patch', 'minor', 'major'].includes(requestedNext)) {
  console.error('--next must be patch, minor, or major');
  process.exit(2);
}

if (requestedNext && surface !== 'all') {
  console.error('--next requires --surface all (cannot infer aligned version for partial surface)');
  process.exit(2);
}

if (surface !== 'all') {
  const label = surface === 'codex' ? 'Codex' : 'Claude';
  console.error(
    `warning: --surface ${surface} updates only ${label} plugin manifests and does not keep release versions aligned`,
  );
}

function updateJson(path, mutate) {
  if (updateJsonFileIfExists(pathOf(path), mutate)) {
    console.log(`updated ${path}`);
  }
}

function packageNameMatchesPlugin(packageName) {
  return packageName === pluginName || packageName?.endsWith(`/${pluginName}`);
}

function shouldIncludePackage(packageJson) {
  if (args['include-package']) return true;
  if (args['no-include-package']) return false;
  return packageNameMatchesPlugin(packageJson?.name);
}

function sourceVersion(label, version) {
  return { label, version };
}

function findMarketplacePlugin(marketplace) {
  return marketplace?.plugins?.find((entry) => entry.name === pluginName);
}

function collectAlignedVersionSources() {
  const missing = [];
  const sources = [];
  const packageJson = readJsonFileIfExists(pathOf('package.json'), null);

  if (shouldIncludePackage(packageJson)) {
    if (packageJson?.version) {
      sources.push(sourceVersion('package.json', packageJson.version));
    } else {
      missing.push('package.json');
    }
  }

  const codexMarketplace = readJsonFileIfExists(pathOf('.agents/plugins/marketplace.json'), null);
  const codexMarketplacePlugin = findMarketplacePlugin(codexMarketplace);
  if (codexMarketplacePlugin?.version) {
    sources.push(sourceVersion('codex marketplace', codexMarketplacePlugin.version));
  } else {
    missing.push('codex marketplace');
  }

  const claudeMarketplace = readJsonFileIfExists(pathOf('.claude-plugin/marketplace.json'), null);
  const claudeMarketplacePlugin = findMarketplacePlugin(claudeMarketplace);
  if (claudeMarketplacePlugin?.version) {
    sources.push(sourceVersion('claude marketplace', claudeMarketplacePlugin.version));
  } else {
    missing.push('claude marketplace');
  }

  const codexManifest = readJsonFileIfExists(
    pathOf(`plugins/${pluginName}/.codex-plugin/plugin.json`),
    null,
  );
  if (codexManifest?.version) {
    sources.push(sourceVersion('codex plugin manifest', codexManifest.version));
  } else {
    missing.push('codex plugin manifest');
  }

  const claudeManifest = readJsonFileIfExists(
    pathOf(`plugins/${pluginName}/.claude-plugin/plugin.json`),
    null,
  );
  if (claudeManifest?.version) {
    sources.push(sourceVersion('claude plugin manifest', claudeManifest.version));
  } else {
    missing.push('claude plugin manifest');
  }

  return { missing, sources };
}

function parseCleanSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function nextVersionFrom(currentVersion, next) {
  const parsed = parseCleanSemver(currentVersion);
  if (!parsed) {
    console.error(`Current aligned source version must be clean semver x.y.z: ${currentVersion}`);
    process.exit(1);
  }

  if (next === 'patch') return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  if (next === 'minor') return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major + 1}.0.0`;
}

function inferNextVersion(next) {
  const { missing, sources } = collectAlignedVersionSources();
  if (missing.length > 0) {
    console.error(`Cannot determine aligned source version; missing ${missing.join(', ')}`);
    process.exit(1);
  }

  const versions = new Map();
  for (const source of sources) {
    const labels = versions.get(source.version) || [];
    labels.push(source.label);
    versions.set(source.version, labels);
  }

  if (versions.size !== 1) {
    const details = sources.map((source) => `${source.label}=${source.version}`).join(', ');
    console.error(`Cannot determine aligned source version; source versions differ: ${details}`);
    process.exit(1);
  }

  return nextVersionFrom(sources[0].version, next);
}

const version = requestedNext ? inferNextVersion(requestedNext) : requestedVersion;

if (surface === 'all' || surface === 'codex') {
  const packageJson = readJsonFileIfExists(pathOf('package.json'), null);
  if (surface === 'all' && shouldIncludePackage(packageJson)) {
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
