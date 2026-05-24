import { spawn } from 'node:child_process';

export const SHIP_GATE_SCHEMA_VERSION = 1;
export const SHIP_GATE_COMMAND = 'ship-gate';
export const SHIP_GATE_CHECKS = [
  { command: 'npm run check:scratch-namespace', args: ['run', 'check:scratch-namespace'] },
  {
    command: 'npm run ops:plugin-version-check -- --surface source --json agent-trigger-kit',
    args: [
      'run',
      'ops:plugin-version-check',
      '--',
      '--surface',
      'source',
      '--json',
      'agent-trigger-kit',
    ],
  },
  { command: 'npm run lint', args: ['run', 'lint'] },
  { command: 'npm run format:check', args: ['run', 'format:check'] },
  { command: 'npm run validate', args: ['run', 'validate'] },
  { command: 'npm test', args: ['test'] },
];

const TAIL_LINE_COUNT = 20;
const TAIL_BYTE_COUNT = 8192;

export async function runShipGate(options = {}) {
  const root = options.root || process.cwd();
  const json = options.json === true;
  const continueOnFail = options.continueOnFail === true;
  const startMs = Date.now();
  const startedAt = new Date(startMs).toISOString();
  const checks = [];
  let failed = false;

  for (const check of SHIP_GATE_CHECKS) {
    const result = await runCheck(check, { root, json });
    checks.push(result);

    if (result.status === 'failed') {
      failed = true;
      if (!continueOnFail) break;
    }
  }

  const finishedMs = Date.now();
  const report = {
    schema_version: SHIP_GATE_SCHEMA_VERSION,
    command: SHIP_GATE_COMMAND,
    status: failed ? 'failed' : 'passed',
    checks,
    started_at: startedAt,
    finished_at: new Date(finishedMs).toISOString(),
    duration_ms: finishedMs - startMs,
    exit_reason: failed ? 'check_failed' : 'all_passed',
  };

  return {
    exitCode: failed ? 1 : 0,
    report,
  };
}

function runCheck(check, { root, json }) {
  const startMs = Date.now();
  const stdoutTail = createTailCollector();
  const stderrTail = createTailCollector();

  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(npmExecutable(), check.args, {
      cwd: root,
      stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    if (json) {
      child.stdout?.on('data', (chunk) => {
        stdoutTail.push(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderrTail.push(chunk);
      });
    }

    child.on('error', (error) => {
      stderrTail.push(`${error.message}\n`);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve(checkResult({ check, code, startMs, stdoutTail, stderrTail, json }));
    });
  });
}

function checkResult({ check, code, startMs, stdoutTail, stderrTail, json }) {
  const durationMs = Date.now() - startMs;
  const exitCode = code ?? 1;
  const status = exitCode === 0 ? 'passed' : 'failed';

  return {
    command: check.command,
    status,
    exit_code: exitCode,
    duration_ms: durationMs,
    stdout_tail: json && status === 'failed' ? stdoutTail.value() : '',
    stderr_tail: json && status === 'failed' ? stderrTail.value() : '',
  };
}

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function createTailCollector() {
  let text = '';

  return {
    push(chunk) {
      text = trimTail(`${text}${chunk.toString('utf8')}`);
    },
    value() {
      return trimTail(text);
    },
  };
}

function trimTail(text) {
  const lineTrimmed = text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .slice(-TAIL_LINE_COUNT)
    .join('\n');

  return trimBytes(lineTrimmed);
}

function trimBytes(text) {
  if (Buffer.byteLength(text, 'utf8') <= TAIL_BYTE_COUNT) {
    return text;
  }

  let trimmed = Buffer.from(text, 'utf8').subarray(-TAIL_BYTE_COUNT).toString('utf8');
  while (Buffer.byteLength(trimmed, 'utf8') > TAIL_BYTE_COUNT) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}
