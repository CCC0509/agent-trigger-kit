import { createInterface } from 'node:readline/promises';

import { FAILURE_CATEGORIES, FAILURE_DRIVERS, OUTCOMES } from './outcome-schema.mjs';
import { OutcomeRecorderError } from './outcome-recorder.mjs';

export function createPromptAdapter({
  stdin = process.stdin,
  stdout = process.stdout,
  readLine,
} = {}) {
  const injected = typeof readLine === 'function';
  const rl = injected ? null : createInterface({ input: stdin, output: stdout });
  const askLine = injected ? readLine : (question) => rl.question(question);

  return {
    write(text) {
      stdout.write?.(text);
    },
    async ask(question) {
      try {
        if (injected) stdout.write?.(question);
        const answer = await askLine(question);
        if (answer === undefined) {
          throw new OutcomeRecorderError('input ended before required answer', 2);
        }
        return String(answer);
      } catch (error) {
        if (error instanceof OutcomeRecorderError) throw error;
        if (error?.code === 'SIGINT') {
          throw new OutcomeRecorderError('prompt cancelled', 130);
        }
        throw error;
      }
    },
    async askEnum(question, values, { optional = false } = {}) {
      while (true) {
        const answer = (await this.ask(question)).trim();
        if (answer === '' && optional) return undefined;
        if (values.includes(answer)) return answer;
        stdout.write?.(`Value must be one of ${values.join(', ')}\n`);
      }
    },
    close() {
      rl?.close();
    },
  };
}

export async function completeMarkOptions({
  args = {},
  event,
  promptAdapter,
  isTty = process.stdin.isTTY === true && process.stdout.isTTY === true,
} = {}) {
  const adapter = promptAdapter || (isTty ? createPromptAdapter() : null);
  const values = {
    outcome: optionValue(args, 'outcome'),
    failureCategory: optionValue(args, 'failure-category', 'failureCategory'),
    failureDriver: optionValue(args, 'failure-driver', 'failureDriver'),
    note: optionValue(args, 'note', 'reason'),
  };

  if (isTty) {
    adapter.write(`${markingLine(event)}\n`);
  }

  if (values.outcome === undefined) {
    if (!isTty) throw new OutcomeRecorderError('Missing required --outcome', 2);
    values.outcome = await adapter.askEnum(`Outcome [${OUTCOMES.join('/')}]: `, OUTCOMES);
  }

  if (values.outcome === 'failure' && values.failureCategory === undefined) {
    if (!isTty) throw new OutcomeRecorderError('Missing required --failure-category', 2);
    values.failureCategory = await adapter.askEnum(
      `Failure category [${FAILURE_CATEGORIES.join('/')}]: `,
      FAILURE_CATEGORIES,
    );
  }

  if (isTty && values.failureDriver === undefined) {
    values.failureDriver = await adapter.askEnum(
      `Failure driver (optional) [${FAILURE_DRIVERS.join('/')}]: `,
      FAILURE_DRIVERS,
      { optional: true },
    );
  }

  if (isTty && values.note === undefined) {
    const note = await adapter.ask('Note (optional, blank to skip): ');
    values.note = note.trim() === '' ? undefined : note;
  }

  return values;
}

function markingLine(event = {}) {
  const shortId = event.short_id || event.id?.slice(0, 8) || 'unknown';
  return `Marking event ${shortId} (${event.verb}, ${event.outcome}, ${event.surface}, ${event.ts}).`;
}

function optionValue(options, ...names) {
  for (const name of names) {
    if (options[name] !== undefined) return options[name];
  }
  return undefined;
}
