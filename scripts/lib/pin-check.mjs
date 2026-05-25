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

export function parseRemoteTags(stdout) {
  const seen = new Set();
  const tags = [];
  for (const line of String(stdout).split('\n')) {
    const match = /\trefs\/tags\/(.+?)(\^\{\})?$/.exec(line);
    if (!match) continue;
    const tag = match[1];
    if (seen.has(tag)) continue;
    seen.add(tag);
    const semver = SEMVER_RE.exec(tag);
    if (!semver) continue; // ignore prerelease/build-metadata/non-semver tags
    tags.push({ tag, version: `${semver[1]}.${semver[2]}.${semver[3]}` });
  }
  return tags;
}

export function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

export function latestSemverTag(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  return tags.reduce((best, tag) => (compareSemver(tag.version, best.version) > 0 ? tag : best));
}

export function classifyPin({ pinResult, latest }) {
  if (pinResult.missing) return { status: 'missing_pin' };
  if (!pinResult.ok) {
    return { status: 'invalid_pin', error: { code: pinResult.code, message: pinResult.message } };
  }
  if (pinResult.type !== 'semver_tag') return { status: 'non_semver_ref' };
  if (!latest) return { status: 'degraded' };
  const cmp = compareSemver(pinResult.version, latest.version);
  if (cmp === 0) return { status: 'current' };
  if (cmp < 0) return { status: 'behind' };
  return { status: 'ahead' };
}
