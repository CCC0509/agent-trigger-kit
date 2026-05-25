const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const REF_TOKEN_RE = /^[A-Za-z0-9._/-]+$/;

export function parsePinFile(text) {
  if (typeof text !== 'string') {
    return { ok: false, code: 'invalid_pin', message: 'pin content must be a string' };
  }

  const normalized = text.replace(/\r\n?/g, '\n');

  if (normalized === '' || normalized === '\n') {
    return { ok: false, code: 'invalid_pin', message: 'pin file is empty' };
  }
  if (!/^[^\n]+\n?$/.test(normalized)) {
    return { ok: false, code: 'invalid_pin', message: 'pin file must contain exactly one ref' };
  }

  const ref = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  if (/\s/.test(ref)) {
    return { ok: false, code: 'invalid_pin', message: 'ref must not contain whitespace' };
  }
  if (!REF_TOKEN_RE.test(ref)) {
    return { ok: false, code: 'invalid_pin', message: `ref contains invalid characters: ${ref}` };
  }

  const unsafe =
    ref.startsWith('-') ||
    ref.startsWith('/') ||
    ref.endsWith('/') ||
    ref.endsWith('.') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.includes('\\') ||
    ref.endsWith('.lock') ||
    /[#:?[*]/.test(ref);
  if (unsafe) {
    return { ok: false, code: 'invalid_pin', message: `unsafe ref token: ${ref}` };
  }

  const semver = SEMVER_RE.exec(ref);
  if (semver) {
    return { ok: true, ref, type: 'semver_tag', version: `${semver[1]}.${semver[2]}.${semver[3]}` };
  }
  return { ok: true, ref, type: 'non_semver_ref' };
}
