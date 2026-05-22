import { normalize } from 'node:path';

import { createPathOf, readJsonFileIfExists as readJsonFileIfExistsRaw } from './fs-json.mjs';

function sourceEntry(label, version) {
  return { label, version: version || 'missing' };
}

function packageNameMatchesPlugin(packageName, pluginName) {
  return packageName === pluginName || packageName?.endsWith(`/${pluginName}`);
}

function shouldIncludePackageVersion(packageJson, pluginName, includePackage, noIncludePackage) {
  if (includePackage) return true;
  if (noIncludePackage) return false;
  return packageNameMatchesPlugin(packageJson?.name, pluginName);
}

function stripLeadingCurrentDirectory(path) {
  return path?.replace(/^\.\//, '');
}

function sourceVersionErrorMessage(sourceVersions) {
  const uniqueVersions = new Set(sourceVersions.map((entry) => entry.version));
  if (uniqueVersions.size === 1) return null;
  return `source versions differ: ${sourceVersions
    .map((entry) => `${entry.label}=${entry.version}`)
    .join(', ')}`;
}

function errorSnapshot({
  pluginName,
  marketplaceName = pluginName,
  claudeMarketplaceName = marketplaceName,
  errorMessage,
}) {
  return {
    pluginName,
    sourceVersions: [],
    expectedVersion: 'missing',
    pluginDir: null,
    marketplaceName,
    claudeMarketplaceName,
    errorMessage,
  };
}

function readJsonFileIfExistsSafely(path, fallback) {
  try {
    return { value: readJsonFileIfExistsRaw(path, fallback), errorMessage: null };
  } catch (error) {
    return { value: fallback, errorMessage: `${path}: ${error.message}` };
  }
}

export function collectSourceVersionSnapshot({
  root,
  pluginName,
  includePackage = false,
  noIncludePackage = false,
}) {
  const normalizedRoot = normalize(root || process.cwd());
  const pathOf = createPathOf(normalizedRoot);
  const packageJson = readJsonFileIfExistsSafely(pathOf('package.json'), null);
  if (packageJson.errorMessage) {
    return errorSnapshot({ pluginName, errorMessage: packageJson.errorMessage });
  }

  const codexMarketplace = readJsonFileIfExistsSafely(
    pathOf('.agents/plugins/marketplace.json'),
    null,
  );
  if (codexMarketplace.errorMessage) {
    return errorSnapshot({ pluginName, errorMessage: codexMarketplace.errorMessage });
  }

  const claudeMarketplace = readJsonFileIfExistsSafely(
    pathOf('.claude-plugin/marketplace.json'),
    null,
  );
  if (claudeMarketplace.errorMessage) {
    const marketplaceName = codexMarketplace.value?.name || pluginName;
    return errorSnapshot({
      pluginName,
      marketplaceName,
      errorMessage: claudeMarketplace.errorMessage,
    });
  }

  const marketplaceName = codexMarketplace.value?.name || pluginName;
  const claudeMarketplaceName = claudeMarketplace.value?.name || marketplaceName;
  const codexEntry = codexMarketplace.value?.plugins?.find((entry) => entry.name === pluginName);
  const claudeEntry = claudeMarketplace.value?.plugins?.find((entry) => entry.name === pluginName);
  const pluginDir = stripLeadingCurrentDirectory(codexEntry?.source?.path || claudeEntry?.source);

  if (!pluginDir) {
    return {
      pluginName,
      sourceVersions: [],
      expectedVersion: 'missing',
      pluginDir: null,
      marketplaceName,
      claudeMarketplaceName,
      errorMessage: `${pluginName}: missing plugin source in marketplace manifests`,
    };
  }

  const codexPlugin = readJsonFileIfExistsSafely(
    pathOf(`${pluginDir}/.codex-plugin/plugin.json`),
    null,
  );
  if (codexPlugin.errorMessage) {
    return errorSnapshot({
      pluginName,
      marketplaceName,
      claudeMarketplaceName,
      errorMessage: codexPlugin.errorMessage,
    });
  }

  const claudePlugin = readJsonFileIfExistsSafely(
    pathOf(`${pluginDir}/.claude-plugin/plugin.json`),
    null,
  );
  if (claudePlugin.errorMessage) {
    return errorSnapshot({
      pluginName,
      marketplaceName,
      claudeMarketplaceName,
      errorMessage: claudePlugin.errorMessage,
    });
  }

  const sourceVersions = [
    ...(shouldIncludePackageVersion(packageJson.value, pluginName, includePackage, noIncludePackage)
      ? [sourceEntry('package.json', packageJson.value?.version)]
      : []),
    sourceEntry('codex marketplace', codexEntry?.version),
    sourceEntry('codex plugin', codexPlugin.value?.version),
    sourceEntry('claude marketplace', claudeEntry?.version),
    sourceEntry('claude plugin', claudePlugin.value?.version),
  ];

  return {
    pluginName,
    sourceVersions,
    expectedVersion: sourceVersions[0]?.version || 'missing',
    pluginDir,
    marketplaceName,
    claudeMarketplaceName,
    errorMessage: sourceVersionErrorMessage(sourceVersions),
  };
}

export function sourceVersionsDiffer(snapshot) {
  return Boolean(snapshot.errorMessage);
}
