// Offline check of the Codex process lifecycle with a fake child: graceful exit, bounded termination, failed kill.
// Run from the repo: node --no-warnings --experimental-test-module-mocks scripts/rpc-lifecycle-test.mts
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { mock } from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'rpc-lifecycle-'));
writeFileSync(join(tmp, 'env'), 'DISCORD_TOKEN=offline-test\nDISCORD_CLIENT_ID=100000000000000009\n');
Object.assign(process.env, { AGENT_ENV_FILE: join(tmp, 'env'), AGENT_ALLOWED_USERS: '100000000000000001' });

class Child extends EventEmitter {
  pid: number | undefined = 43210;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kills = 0;
  failKill = false;
  stdin = new Writable({ write: (chunk, _encoding, done) => {
    const message = JSON.parse(String(chunk));
    if (message.method === 'initialize') queueMicrotask(() => {
      this.stdout.write(JSON.stringify({ id: message.id, result: {} }) + '\n');
    });
    done();
  } });
  kill(): boolean {
    this.kills++;
    if (this.failKill) { this.emit('error', new Error('kill denied')); return false; }
    this.emit('exit', null, 'SIGTERM');
    return true;
  }
}
let child: Child;
mock.module('node:child_process', { namedExports: { spawn: () => child } });
mock.module(new URL('../src/log.ts', import.meta.url).href, { namedExports: {
  errorText: (e: unknown) => String(e), log: { info: () => undefined, warn: () => undefined, error: () => undefined },
} });
const { CodexRpc } = await import('../src/engines/codex/rpc.ts');
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
mock.timers.enable({ apis: ['setTimeout'] });
try {
  child = new Child();
  const graceful = await CodexRpc.start();
  let closed = false;
  const closing = graceful.close().then(() => { closed = true; });
  await tick();
  assert.equal(child.stdin.writableEnded, true);
  assert.equal(closed, false, 'EOF alone is not proof of process exit');
  await assert.rejects(graceful.call('thread/resume'), /not running/);
  child.emit('exit', 0, null);
  await closing;
  assert.equal(closed, true); assert.equal(child.kills, 0);

  child = new Child();
  const stalled = await CodexRpc.start();
  const stopped = stalled.close();
  mock.timers.tick(2000); await tick();
  await stopped;
  assert.equal(child.kills, 1, 'a stalled owned child is terminated after the grace period');

  child = new Child(); child.failKill = true;
  const denied = await CodexRpc.start();
  const rejection = assert.rejects(denied.close(), /did not exit/);
  mock.timers.tick(2000); await tick();
  mock.timers.tick(3000); await tick();
  await rejection;
  assert.equal(child.kills, 1, 'a failed kill never counts as a successful exit');
  child.emit('exit', 0, null);
  console.log('ok  RPC waits for real exit, bounds owned-child cleanup and rejects unconfirmed closure');
} finally {
  mock.timers.reset();
  mock.restoreAll();
}
