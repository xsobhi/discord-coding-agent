// Offline check of the session slot (close before reopen, late startup, failed cleanup) and the bounded
// writer-conflict retry on resume (the two "session cleanup failed" log lines are expected). Run: node scripts/session-lifecycle-test.mts
import assert from 'node:assert/strict';
import { SessionSlot } from '../src/tasks/session-slot.ts';
import { SessionCleanupError, type EngineSession } from '../src/engines/types.ts';
import { resumeSavedThread } from '../src/engines/codex/resume.ts';
import type { CodexRpc } from '../src/engines/codex/rpc.ts';

const deferred = <T,>() => {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
const session = (close: () => Promise<void>): EngineSession => ({ engine: 'codex', choice: { model: 'test' },
  needsRestartFor: () => false, send: async () => undefined, interrupt: async () => undefined, close });
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

const slot = new SessionSlot();
const released = deferred<void>();
const events: string[] = [];
let oldLive!: () => boolean;
const first = await slot.ensure(async (live) => {
  oldLive = live;
  return session(async () => { events.push('closing-first'); await released.promise; events.push('closed-first'); });
});
assert.equal(await slot.ensure(async () => { throw new Error('duplicate open'); }), first);
const closing = slot.close();
assert.equal(oldLive(), false, 'late events are ignored as soon as closing starts');
const second = slot.ensure(async () => { events.push('opened-second'); return session(async () => undefined); });
await tick();
assert.deepEqual(events, ['closing-first']);
released.resolve();
await closing; await second;
assert.deepEqual(events, ['closing-first', 'closed-first', 'opened-second']);
await slot.close();
console.log('ok  reopening waits for process exit and ignores old session events');

const inFlight = new SessionSlot();
const startup = deferred<EngineSession>(), lateExit = deferred<void>();
let starts = 0, lateCloses = 0;
const initial = inFlight.ensure(async () => { starts++; return startup.promise; });
await tick();
const cancelled = assert.rejects(initial, /closed while opening/);
const dispose = inFlight.close();
const replacement = inFlight.ensure(async () => { starts++; return session(async () => undefined); });
startup.resolve(session(async () => { lateCloses++; await lateExit.promise; }));
await cancelled; await tick();
assert.equal(lateCloses, 1); assert.equal(starts, 1);
lateExit.resolve(); await dispose; await replacement;
assert.equal(starts, 2);
await inFlight.close();
console.log('ok  closing during startup disposes the late process before reopening');

const blocked = new SessionSlot();
await blocked.ensure(async () => session(async () => { throw new SessionCleanupError('child still alive'); }));
await assert.rejects(blocked.close(), /child still alive/);
await assert.rejects(blocked.ensure(async () => { throw new Error('must not open'); }), /child still alive/);
const blockedOpening = new SessionSlot();
const badStart = deferred<EngineSession>();
const openingResult = blockedOpening.ensure(async () => badStart.promise);
await tick();
const openRejected = assert.rejects(openingResult, /unconfirmed exit/);
const closeRejected = assert.rejects(blockedOpening.close(), /unconfirmed exit/);
badStart.reject(new SessionCleanupError('unconfirmed exit'));
await openRejected; await closeRejected;
await assert.rejects(blockedOpening.ensure(async () => { throw new Error('must not open'); }), /unconfirmed exit/);
console.log('ok  unconfirmed cleanup blocks reopening, including failed startup cleanup');

const calls: { method: string; params: Record<string, unknown> }[] = [];
let failures = 2, note = 0;
const pauses: number[] = [];
const rpc = { call: async (method: string, params: Record<string, unknown>) => {
  calls.push({ method, params });
  if (failures-- > 0) throw new Error('thread saved already has an active writer');
  return { thread: { id: 'saved' } };
} } as unknown as Pick<CodexRpc, 'call'>;
const wait = async (ms: number) => { pauses.push(ms); };
const resumed = await resumeSavedThread(rpc, 'saved', {}, () => note++, undefined, wait);
assert.equal(resumed.thread.id, 'saved'); assert.equal(note, 1);
assert.deepEqual(pauses, [250, 500]);
assert.ok(calls.every(c => c.method === 'thread/resume' && c.params.threadId === 'saved'));
failures = 100; calls.length = 0;
await assert.rejects(resumeSavedThread(rpc, 'saved', {}, () => undefined, undefined, wait), /active writer/);
assert.equal(calls.length, 7, 'a persistent external writer does not cause endless retries');
const broken = { call: async () => { throw new Error('not found'); } } as Pick<CodexRpc, 'call'>;
await assert.rejects(resumeSavedThread(broken, 'saved', {}, () => { throw new Error('must not retry'); }), /not found/);
const abort = new AbortController(); abort.abort();
await assert.rejects(resumeSavedThread(rpc, 'saved', {}, () => undefined, abort.signal));
console.log('ok  bounded writer-conflict retry preserves exact thread and respects cancellation');
