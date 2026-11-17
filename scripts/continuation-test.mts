// Offline check of continuing an existing Codex conversation (data/pending-continuation.json) and of resume never
// starting a replacement chat. Run from the repo: node --no-warnings --experimental-test-module-mocks scripts/continuation-test.mts
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { mock } from 'node:test';
import type { TaskRecord } from '../src/store.ts';
import type { SessionHost } from '../src/engines/types.ts';

const scratch = mkdtempSync(join(tmpdir(), 'agent-continuation-test-'));
writeFileSync(join(scratch, 'env'), 'DISCORD_TOKEN=offline-test\nDISCORD_CLIENT_ID=100000000000000009\n');
Object.assign(process.env, { AGENT_ENV_FILE: join(scratch, 'env'), AGENT_DATA_DIR: scratch, AGENT_ALLOWED_USERS: 'OWNER' });
const { loadStore, flushStore, allRecords } = await import('../src/store.ts');
const { bindContinuation } = await import('../src/tasks/continuation.ts');
const { getDefaults } = await import('../src/engines/settings.ts');
const sessionId = '12345678-1234-1234-1234-123456789abc';
const file = join(scratch, 'pending-continuation.json');
const plan = { codexThreadId: sessionId, ownerId: 'OWNER', title: 'Existing conversation', model: 'test-model', effort: 'high' };
const record = (threadId: string): TaskRecord => ({ id: threadId, threadId, ownerId: 'OWNER',
  ownThread: true, guildId: 'SERVER', title: 'New request', tier: 'owner', agent: getDefaults(),
  sessions: {}, state: 'idle', originChannelId: 'CHANNEL', originMessageId: 'MESSAGE', createdAt: '', updatedAt: '' });
try {
  loadStore();
  writeFileSync(file, JSON.stringify(plan));
  for (const changed of [{ ownerId: 'STRANGER' }, { tier: 'guest' as const }, { guildId: null }, { ownThread: false }]) {
    assert.equal(bindContinuation({ ...record('SKIP'), ...changed }), false);
  }
  mkdirSync(join(scratch, 'tasks.json.tmp'));
  assert.throws(() => bindContinuation(record('FAIL')), /EISDIR|EPERM|EACCES/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).discordThreadId, undefined);
  assert.equal(allRecords().length, 0, 'failed persistence does not leave a false in-memory claim');
  rmSync(join(scratch, 'tasks.json.tmp'), { recursive: true });
  const first = record('FIRST');
  assert.equal(bindContinuation(first), true);
  assert.equal(first.sessions.codex, sessionId);
  assert.equal(first.agent.engine, 'codex');
  assert.equal(JSON.parse(readFileSync(join(scratch, 'tasks.json'), 'utf8')).FIRST.sessions.codex, sessionId);
  loadStore();
  assert.equal(bindContinuation(record('SECOND')), false, 'a restart cannot bind twice');
  writeFileSync(file, JSON.stringify(plan));
  assert.equal(bindContinuation(record('CRASH-RECOVERY')), false, 'a crash before consuming the plan cannot duplicate the saved binding');
  console.log('ok  owner-only continuation, durable binding, failed write and restart protection');

  const calls: string[] = [];
  let fail = true, wrongId = false, closes = 0, removals = 0;
  const rpc = { call: async (method: string) => {
    calls.push(method);
    if (fail) throw new Error('saved thread unavailable');
    return { thread: { id: wrongId ? 'different-thread' : sessionId } };
  }, close: () => { closes++; } };
  mock.module(new URL('../src/engines/codex/rpc.ts', import.meta.url).href,
    { namedExports: { CodexRpc: { start: async () => rpc } } });
  mock.module(new URL('../src/engines/codex/mcp-http.ts', import.meta.url).href,
    { namedExports: { exposeTools: async () => ({ url: 'http://localhost/test', remove: () => { removals++; } }) } });
  const { CodexSession } = await import('../src/engines/codex/session.ts');
  const bound: string[] = [];
  const host = { owners: ['OWNER'], resume: sessionId, sink: { onSession: (id: string) => bound.push(id) } } as unknown as SessionHost;
  await assert.rejects(CodexSession.open(host, { model: 'test-model' }), /no replacement chat was created/);
  assert.deepEqual(calls, ['thread/resume']);
  assert.equal(closes, 1);
  assert.equal(removals, 1);
  fail = false; wrongId = true;
  await assert.rejects(CodexSession.open(host, { model: 'test-model' }), /different conversation/);
  assert.deepEqual(bound, []);
  wrongId = false;
  const session = await CodexSession.open(host, { model: 'test-model' });
  assert.deepEqual(bound, [sessionId]);
  assert.ok(calls.every((method) => method === 'thread/resume'));
  await session.close();
  console.log('ok  exact saved session only; resume failures never start a replacement chat');
} finally {
  flushStore();
  assert.ok(resolve(scratch).startsWith(resolve(tmpdir()) + sep));
  rmSync(scratch, { recursive: true, force: true });
}
