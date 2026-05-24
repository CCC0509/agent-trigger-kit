#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';

const SCHEMA_VERSION = 1;
const COMMAND = 'spec-graduate';
const SPECS_DIR = 'docs/superpowers/specs';
const PLANS_DIR = 'docs/superpowers/plans';
const DESIGNS_DIR = 'docs/designs';

export function runSpecGraduate(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const cwd = options.cwd || process.cwd();
  const args = parseArgs(argv, {
    booleanKeys: ['commit', 'dry-run', 'json'],
    collectPositionals: true,
  });
  const slug = resolveSlug(args);
  const root = resolveRoot(args, cwd);
  const dryRun = args['dry-run'] === true;
  const wantsCommit = args.commit === true;

  if (dryRun && wantsCommit) {
    throw usageError('--commit cannot be used with --dry-run');
  }

  const specs = listMarkdownFiles(root, SPECS_DIR);
  const spec = resolveSpec(slug, specs);
  const design = {
    relative: `${DESIGNS_DIR}/${spec.file}`,
    full: join(root, DESIGNS_DIR, spec.file),
  };

  if (existsSync(design.full)) {
    throw operationalError(`target durable design already exists: ${design.relative}`);
  }

  const { removedPlans, warnings } = planCleanup(root, spec);
  const result = {
    schema_version: SCHEMA_VERSION,
    command: COMMAND,
    status: dryRun ? 'planned' : 'completed',
    moved: {
      from: spec.relative,
      to: design.relative,
    },
    removed_plans: removedPlans.map((plan) => plan.relative),
    warnings,
    commit: { status: 'not_requested' },
  };

  if (dryRun) {
    return result;
  }

  if (wantsCommit) {
    ensureEmptyIndex(root);
  }

  mkdirSync(dirname(design.full), { recursive: true });
  renameSync(spec.full, design.full);
  for (const plan of removedPlans) {
    unlinkSync(plan.full);
  }

  if (wantsCommit) {
    result.commit = createCommit(root, slug, [
      spec.relative,
      design.relative,
      ...result.removed_plans,
    ]);
  }

  return result;
}

function resolveSlug(args) {
  const positionals = args._ || [];
  if (positionals.length === 0) {
    throw usageError('missing required <slug>');
  }
  if (positionals.length > 1) {
    throw usageError(`expected one <slug>, got ${positionals.length}`);
  }
  if (typeof positionals[0] !== 'string' || positionals[0].trim() === '') {
    throw usageError('missing required <slug>');
  }

  return positionals[0];
}

function resolveRoot(args, cwd) {
  if (Object.hasOwn(args, 'root') && typeof args.root !== 'string') {
    throw usageError('--root requires a path value');
  }

  return resolve(cwd, args.root || '.');
}

function listMarkdownFiles(root, relativeDir) {
  const fullDir = join(root, relativeDir);
  if (!existsSync(fullDir)) return [];

  return readdirSync(fullDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => {
      const stem = entry.name.slice(0, -'.md'.length);
      return {
        file: entry.name,
        stem,
        relative: `${relativeDir}/${entry.name}`,
        full: join(fullDir, entry.name),
      };
    })
    .sort((left, right) => left.relative.localeCompare(right.relative));
}

function resolveSpec(slug, specs) {
  const exact = specs.filter((spec) => spec.stem === slug);
  if (exact.length === 1) return exact[0];

  const suffix = specs.filter((spec) => specMatchesSuffix(spec.stem, slug));
  if (suffix.length === 1) return suffix[0];
  if (suffix.length > 1) {
    throw operationalError(
      [
        `ambiguous spec suffix "${slug}" matched:`,
        ...suffix.map((spec) => `  ${spec.relative}`),
      ].join('\n'),
    );
  }

  throw operationalError(`no matching spec for "${slug}" under ${SPECS_DIR}`);
}

function specMatchesSuffix(stem, slug) {
  const durableStem = stripTrailingDesign(stem);
  return durableStem === slug || durableStem.endsWith(`-${slug}`) || stem.endsWith(`-${slug}`);
}

function planCleanup(root, spec) {
  const specPlanKey = stripTrailingDesign(spec.stem);
  const matches = listMarkdownFiles(root, PLANS_DIR).filter(
    (plan) => stripTrailingDesign(plan.stem) === specPlanKey,
  );

  if (matches.length === 1) {
    return { removedPlans: matches, warnings: [] };
  }

  if (matches.length > 1) {
    return {
      removedPlans: [],
      warnings: [
        `Plan cleanup skipped: multiple matching plans for ${spec.relative}: ${matches
          .map((plan) => plan.relative)
          .join(', ')}`,
      ],
    };
  }

  return { removedPlans: [], warnings: [] };
}

function stripTrailingDesign(stem) {
  return stem.endsWith('-design') ? stem.slice(0, -'-design'.length) : stem;
}

function createCommit(root, slug, paths) {
  const add = spawnSync('git', ['add', ...paths], {
    cwd: root,
    encoding: 'utf8',
  });
  if (add.status !== 0) {
    throw operationalError(formatGitFailure('git add', add));
  }

  const message = `docs: graduate ${slug}`;
  const commit = spawnSync('git', ['commit', '-m', message], {
    cwd: root,
    encoding: 'utf8',
  });
  if (commit.status !== 0) {
    throw operationalError(formatGitFailure('git commit', commit));
  }

  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });

  return {
    status: 'created',
    message,
    sha: head.status === 0 ? head.stdout.trim() : null,
  };
}

function ensureEmptyIndex(root) {
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return;
  }
  if (result.status === 1) {
    throw operationalError('--commit requires an empty index before spec graduation');
  }

  throw operationalError(formatGitFailure('git diff --cached --quiet', result));
}

function formatGitFailure(command, result) {
  const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim();
  return detail ? `${command} failed: ${detail}` : `${command} failed`;
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  return error;
}

function operationalError(message) {
  const error = new Error(message);
  error.exitCode = 1;
  return error;
}

function printHuman(result) {
  console.log('Spec graduation');
  console.log(`Status: ${result.status}`);
  console.log(`Moved ${result.moved.from} -> ${result.moved.to}`);
  if (result.removed_plans.length > 0) {
    for (const plan of result.removed_plans) {
      console.log(`Removed plan ${plan}`);
    }
  } else {
    console.log('Removed plans: none');
  }
  for (const warning of result.warnings) {
    console.log(`Warning: ${warning}`);
  }
  if (result.commit.status === 'created') {
    console.log(`Commit: ${result.commit.message}`);
  } else {
    console.log('Commit: not requested');
  }
}

function emptyErrorPayload(message) {
  return {
    schema_version: SCHEMA_VERSION,
    command: COMMAND,
    status: 'failed',
    moved: null,
    removed_plans: [],
    warnings: [],
    commit: { status: 'not_requested' },
    error: message,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const wantsJson = argv.includes('--json');

  try {
    const result = runSpecGraduate({ argv });
    if (wantsJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result);
    }
  } catch (error) {
    if (wantsJson) {
      console.log(JSON.stringify(emptyErrorPayload(error.message), null, 2));
    } else {
      console.error(error.message);
    }
    process.exit(error.exitCode || 1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
