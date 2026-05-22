import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export function expandPath({ root, value, strictEnv = false }) {
  if (value === undefined || value === null || value === '') {
    return value;
  }

  const missingEnvNames = [];
  const expandedVariables = String(value).replace(
    /\$\{([^}:]+)(:-([^}]*))?\}/g,
    (_, name, _fallback, fallback) => {
      if (name === 'ROOT') {
        return root;
      }

      const envValue = process.env[name];
      if (fallback !== undefined && (envValue === undefined || envValue === '')) {
        return fallback;
      }

      if (envValue === undefined || envValue === '') {
        missingEnvNames.push(name);
        return '';
      }

      return envValue;
    },
  );

  if (strictEnv && missingEnvNames.length > 0) {
    throw new Error(
      `missing environment variable(s) for path expansion: ${[...new Set(missingEnvNames)].join(', ')}`,
    );
  }

  const expandedHome =
    expandedVariables === '~' || expandedVariables.startsWith('~/')
      ? join(homedir(), expandedVariables.slice(2))
      : expandedVariables;

  if (expandedHome === '') {
    return '';
  }

  return isAbsolute(expandedHome) ? expandedHome : resolve(root, expandedHome);
}
