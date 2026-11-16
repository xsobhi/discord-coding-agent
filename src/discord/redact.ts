import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { log, errorText } from '../log.ts';

// Everything the bot posts passes through here. Threads are visible to the
// whole server, so a stray `cat .env` in a reply must not leak anything.
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[redacted private key]'],
  [/[MNO][A-Za-z\d_-]{23,27}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,40}/g, '[redacted discord token]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g, '[redacted github token]'],
  [/\bsk-(ant-)?[A-Za-z0-9_-]{24,}/g, '[redacted api key]'],
  [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted aws key]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[redacted google key]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, '[redacted slack token]'],
  [/\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g, '[redacted jwt]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi, '$1[redacted]@'],
  [
    // Needs a digit in the value, so prose like "token: expired" stays readable.
    /((?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|cookie)["']?\s*[=:]\s*["']?)(?=[^\s"'`,;]*\d)[^\s"'`,;]{6,}/gi,
    '$1[redacted]',
  ],
];

let known: string[] = [];

/** Exact values from every .env under the scanned directories (AGENT_SECRET_SCAN_DIRS), so even oddly shaped secrets are caught. */
export async function refreshKnownSecrets(dirs: string[]): Promise<void> {
  try {
    const files = await findEnvFiles(dirs);
    const found = new Set<string>();
    for (const path of files) {
      const text = await readFile(path, 'utf8').catch(() => '');
      for (const value of Object.values(parseEnv(text))) if (value && looksSecret(value)) found.add(value);
    }
    known = [...found].sort((a, b) => b.length - a.length);
  } catch (err) {
    log.warn('secret scan failed', errorText(err));
  }
}

function looksSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 12 || /\s/.test(v)) return false;
  if (/^(https?:\/\/[^@]*|\/[\w./-]*|[\w.-]+\.(com|net|io|org)|true|false)$/i.test(v)) return false;
  return /[0-9]/.test(v) && /[a-zA-Z]/.test(v);
}

function findEnvFiles(dirs: string[]): Promise<string[]> {
  const args = [...dirs, '-maxdepth', '5', '-name', 'node_modules', '-prune', '-o', '-type', 'f',
    '(', '-name', '.env', '-o', '-name', '.env.*', ')', '-print'];
  return new Promise((resolve) =>
    execFile('find', args, { timeout: 20_000, maxBuffer: 4 << 20 }, (_err, out) =>
      resolve(out.split('\n').filter(Boolean))));
}

export function redact(text: string): string {
  let out = text;
  for (const secret of known) if (out.includes(secret)) out = out.split(secret).join('[redacted]');
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}
