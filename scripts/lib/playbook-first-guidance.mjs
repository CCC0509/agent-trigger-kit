export const PLAYBOOK_FIRST_GUIDANCE = {
  version: 1,
  heading: 'Playbook-First Guidance',
  signal: 'Project playbook is source of truth.',
  guidance:
    'For tasks covered by this project trigger layer, the project playbook is the source of truth; generic helper guidance should align with it, not override it.',
};

export function hasPlaybookFirstSignal(text) {
  return String(text ?? '').includes(PLAYBOOK_FIRST_GUIDANCE.signal);
}

export function hasPlaybookFirstGuidance(text) {
  return String(text ?? '').includes(PLAYBOOK_FIRST_GUIDANCE.guidance);
}

export function appendPlaybookFirstSignal(description) {
  const text = String(description ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (!text) return PLAYBOOK_FIRST_GUIDANCE.signal;
  if (hasPlaybookFirstSignal(text)) return text;
  return `${text} ${PLAYBOOK_FIRST_GUIDANCE.signal}`;
}
