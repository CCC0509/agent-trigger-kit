export function parseArgs(argv, options = {}) {
  const booleanKeys = new Set(options.booleanKeys || []);
  const out = options.collectPositionals ? { _: [] } : {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (booleanKeys.has(key)) {
        out[key] = true;
        continue;
      }

      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i += 1;
      }
    } else if (options.collectPositionals) {
      out._.push(arg);
    }
  }

  return out;
}

export function requiredArg(args, key) {
  if (!args[key]) {
    console.error(`Missing required --${key}`);
    process.exit(2);
  }
  return args[key];
}
