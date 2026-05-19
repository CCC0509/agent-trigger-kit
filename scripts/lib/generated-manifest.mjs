function copyFiles(files) {
  return Array.isArray(files) ? files.map((file) => ({ ...file })) : [];
}

function copyTasks(tasks) {
  return Array.isArray(tasks) ? [...tasks] : [];
}

function copyPluginEntry(entry = {}) {
  return {
    pluginVersion: entry.pluginVersion,
    playbook: entry.playbook,
    maintenanceContract: entry.maintenanceContract,
    tasks: copyTasks(entry.tasks),
    files: copyFiles(entry.files),
  };
}

export function normalizeGeneratedManifest(manifest) {
  const normalized = {
    schemaVersion: 2,
    kitVersion: manifest?.kitVersion,
    templateVersion: manifest?.templateVersion,
    plugins: {},
  };

  if (!manifest || typeof manifest !== 'object') {
    return normalized;
  }

  if (manifest.schemaVersion === 2 && manifest.plugins && typeof manifest.plugins === 'object') {
    for (const [pluginName, entry] of Object.entries(manifest.plugins)) {
      normalized.plugins[pluginName] = copyPluginEntry(entry);
    }
    return normalized;
  }

  if (typeof manifest.pluginName === 'string' && manifest.pluginName) {
    normalized.plugins[manifest.pluginName] = copyPluginEntry(manifest);
  } else if (Array.isArray(manifest.files)) {
    normalized.plugins.__legacy_v1_without_plugin_name__ = copyPluginEntry(manifest);
  }

  return normalized;
}

export function generatedPluginEntry(manifest, pluginName) {
  return normalizeGeneratedManifest(manifest).plugins[pluginName] || null;
}

export function generatedPluginNames(manifest) {
  return Object.keys(normalizeGeneratedManifest(manifest).plugins);
}

export function upsertGeneratedPluginEntry(manifest, pluginName, entry, options = {}) {
  const normalized = normalizeGeneratedManifest(manifest);
  return {
    schemaVersion: 2,
    kitVersion: options.kitVersion ?? normalized.kitVersion,
    templateVersion: options.templateVersion ?? normalized.templateVersion,
    plugins: {
      ...normalized.plugins,
      [pluginName]: copyPluginEntry(entry),
    },
  };
}
