import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';
import { schedulesSchema, occurrences, nextOccurrence } from '../src/tasks/schedule.ts';
import { ScheduleRunner } from '../src/tasks/schedule-runner.ts';

const dir = mkdtempSync(join(tmpdir(), 'agent-schedule-test-'));
const now = Date.parse('2026-11-02T09:00:00Z');
const owner = '100000000000000001';
const [plan] = schedulesSchema.parse([{
  id: 'weekly', enabled: true, ownerId: owner, threadId: '100000000000000002',
  authorizationMessageId: '100000000000000003', startsAt: '2026-11-02T09:00:00Z', endsAt: '2026-12-07T00:00:00Z',
  graceMinutes: 20, instructions: 'Continue the authorized work.',
  slots: [{ id: 'monday', day: 1, time: '09:00', workMinutes: 120, focus: 'AI' }],
}]);
const save = (p = plan): void => writeFileSync(join(dir, 'schedules.json'), JSON.stringify([p]));
const read = (name: string): any => JSON.parse(readFileSync(join(dir, name), 'utf8'));
try {
  assert.equal(occurrences(plan, now - 1).length, 0);
  assert.equal(occurrences(plan, now).length, 1);
  assert.equal(occurrences(plan, now + 20 * 60000).length, 0, 'expired work is not caught up');
  assert.equal(occurrences(plan, Date.parse('2026-12-07T09:00:00Z')).length, 0, 'finite schedule ends');
  assert.equal(nextOccurrence(plan, now), '2026-11-09T09:00:00.000Z');
  assert.equal(occurrences({ ...plan, enabled: false }, now).length, 0);
  assert.throws(() => schedulesSchema.parse([{ ...plan, slots: Array.from({ length: 6 }, (_, i) => ({ ...plan.slots[0], id: `day-${i}` })) }]), /10 hours/);
  console.log('ok  UTC slots, launch window, weekly budget, finite end and pause');

  save();
  let deliveries = 0;
  const deliver = async () => { deliveries++; return { status: 'dispatched' as const }; };
  await new ScheduleRunner(dir, deliver).tick(now);
  await new ScheduleRunner(dir, deliver).tick(now + 30000);
  assert.equal(deliveries, 1, 'restart receipts prevent duplicate turns');
  assert.equal(read('schedule-runs.json').runs[occurrences(plan, now)[0].key].status, 'dispatched');
  assert.equal(read('schedule-health.json').plans[0].weeklyWorkMinutes, 120);
  const nextMonday = now + 7 * 86400000;
  let ready = false;
  const runner = new ScheduleRunner(dir, async () => ready ? deliver() : { status: 'deferred' });
  await runner.tick(nextMonday);
  assert.equal(deliveries, 1);
  ready = true;
  await runner.tick(nextMonday + 30000);
  assert.equal(deliveries, 2, 'busy task retries within the launch window');
  save({ ...plan, enabled: false });
  await runner.tick(nextMonday + 14 * 86400000);
  assert.equal(deliveries, 2, 'pause is loaded without restart');
  save();
  await new ScheduleRunner(dir, async () => { deliveries++; throw new Error('ambiguous send'); }).tick(nextMonday + 7 * 86400000);
  await new ScheduleRunner(dir, deliver).tick(nextMonday + 7 * 86400000 + 30000);
  assert.equal(deliveries, 3, 'ambiguous sends are not replayed after restart');
  writeFileSync(join(dir, 'schedule-runs.json'), '{corrupt');
  await assert.rejects(new ScheduleRunner(dir, deliver).tick(now), /JSON/);
  assert.equal(deliveries, 3, 'corrupt receipts fail closed');
  writeFileSync(join(dir, 'schedule-runs.json'), JSON.stringify({ runs: {} }));
  let release!: () => void, overlap = 0;
  const blocked = new ScheduleRunner(dir, async () => {
    overlap++;
    await new Promise<void>((resolve) => { release = resolve; });
    return { status: 'dispatched' };
  });
  const first = blocked.tick(now);
  await blocked.tick(now);
  release();
  await first;
  assert.equal(overlap, 1, 'overlapping timer ticks cannot start duplicate turns');
  console.log('ok  durable deduplication, busy deferral, hot pause and fail-closed receipts');

  // Real dispatch routing with a fake task/channel: no Discord network or live task records.
  const SRC = new URL('../src', import.meta.url).pathname;
  let allowed = true, busy = false, count = 0, author = owner, bot = false, closed = false;
  let sends = 0;
  const record = { ownerId: owner, state: 'idle', guildId: '100000000000000004' };
  const task = { get deploymentBusy() { return busy; },
    channel: { messages: { fetch: async () => ({ author: { id: author, bot } }) } },
    send: async (turn: any) => { assert.match(turn.text, /not a new message typed by the owner/); sends++; } };
  mock.module(`${SRC}/config.ts`, { namedExports: { config: { dataDir: dir, maxConcurrent: 2 }, isOwner: () => allowed } });
  mock.module(`${SRC}/store.ts`, { namedExports: { getRecord: () => closed ? { ...record, state: 'closed' } : record } });
  mock.module(`${SRC}/log.ts`, { namedExports: { log: { info() {}, error() {} }, errorText: String } });
  mock.module(`${SRC}/tasks/lifecycle.ts`, { namedExports: { trackActivity: (f: () => Promise<unknown>) => f() } });
  mock.module(`${SRC}/tasks/registry.ts`, { namedExports: { taskIn: async () => task, busyCount: () => count, otherTasks: () => [] } });
  const { dispatchWake } = await import('../src/tasks/scheduled-wake.ts');
  const due = occurrences(plan, now)[0];
  assert.equal((await dispatchWake({} as any, plan, due)).status, 'dispatched');
  busy = true;
  assert.equal((await dispatchWake({} as any, plan, due)).status, 'deferred');
  busy = false; count = 2;
  assert.equal((await dispatchWake({} as any, plan, due)).status, 'deferred');
  count = 0; bot = true;
  assert.equal((await dispatchWake({} as any, plan, due)).status, 'skipped');
  bot = false; author = 'untrusted';
  assert.equal((await dispatchWake({} as any, plan, due)).status, 'skipped');
  author = owner; allowed = false;
  assert.equal((await dispatchWake({} as any, plan, due)).status, 'skipped');
  allowed = true; closed = true;
  assert.equal((await dispatchWake({} as any, plan, due)).status, 'skipped');
  assert.equal(sends, 1, 'only a verified owner request and idle saved task can resume');
  console.log('ok  real wake-up dispatch enforces owner provenance, existing task and concurrency');
} finally { mock.restoreAll(); rmSync(dir, { recursive: true, force: true }); }
