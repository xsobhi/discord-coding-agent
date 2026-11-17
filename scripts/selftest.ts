// Offline checks for the pure helpers: message splitting and secret redaction.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunk } from '../src/discord/chunk.ts';
import { windowsEnvFiles } from '../src/discord/env-files.ts';
import { redact } from '../src/discord/redact.ts';

const code = '```ts\n' + Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`).join('\n') + '\n```';
const parts = chunk(`Intro text\n${code}\nAfter.`);
assert.ok(parts.length > 1, 'long text splits');
for (const p of parts) {
  assert.ok(p.length <= 1900, `piece within limit (${p.length})`);
  assert.equal((p.match(/```/g) ?? []).length % 2, 0, 'every piece has balanced fences');
}
assert.ok(parts.at(-1)!.endsWith('After.'));

const cases: [string, string][] = [
  ['token ghp_' + 'a'.repeat(36), 'ghp_'],
  ['remote https://user:hunter2pass@github.com/x.git', 'hunter2pass'],
  ['DISCORD_TOKEN=MTQ5NzE2' + 'x'.repeat(20) + '.Gabcde.' + 'y'.repeat(38), 'MTQ5NzE2'],
  ['password: s3cretValue9', 's3cretValue9'],
  ['key sk-ant-api03-' + 'z'.repeat(40), 'sk-ant'],
  ['-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----', 'abc'],
];
for (const [input, leaked] of cases) assert.ok(!redact(input).includes(leaked), `redacts: ${redact(input)}`);
assert.equal(redact('the token: expired yesterday'), 'the token: expired yesterday', 'prose stays readable');
// The Windows secret scan (a stand-in for `find`): .env files a few levels down, none inside node_modules.
const tree = mkdtempSync(join(tmpdir(), 'envscan-'));
for (const dir of ['a/b', 'node_modules/x']) mkdirSync(join(tree, dir), { recursive: true });
for (const f of ['.env', 'a/b/.env.local', 'node_modules/x/.env', 'a/notenv']) writeFileSync(join(tree, f), 'X=1');
assert.deepEqual((await windowsEnvFiles([tree])).map((f) => f.slice(tree.length + 1)).sort(), ['.env', join('a', 'b', '.env.local')]);
// Config: `~/` and relative paths resolve, and permissions default to the safer mode.
const tmp = mkdtempSync(join(tmpdir(), 'selftest-'));
writeFileSync(join(tmp, 'env'), 'DISCORD_TOKEN=offline\nDISCORD_CLIENT_ID=1\n');
Object.assign(process.env, { AGENT_ENV_FILE: join(tmp, 'env'), AGENT_ALLOWED_USERS: '1, 2', AGENT_GUEST_HOME: '~/g', AGENT_INSTRUCTIONS_FILE: 'notes.md' });
const { config, ROOT } = await import('../src/config.ts');
assert.deepEqual([...config.owners], ['1', '2']);
assert.equal(config.guestHome, join(homedir(), 'g'));
assert.equal(config.instructionsFile, join(ROOT, 'notes.md'));
assert.equal(config.permissionMode, 'auto');

console.log(`selftest ok: ${parts.length} chunks, ${cases.length} redaction cases, config paths, env scan`);
