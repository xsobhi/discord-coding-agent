// Offline check of who the bot answers where: open channel vs mention-only channel vs DM, replies that
// belong to a running task, and an owner's quick second message. startTask/continueTask are stubbed.
// Run from the repo: node --experimental-test-module-mocks scripts/routing.mts
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock } from 'node:test';

const tmp = mkdtempSync(join(tmpdir(), 'routing-'));
writeFileSync(join(tmp, 'env'), 'DISCORD_TOKEN=offline-test\nDISCORD_CLIENT_ID=100000000000000009\n');
process.env.AGENT_ENV_FILE = join(tmp, 'env');
process.env.AGENT_DATA_DIR = tmp;
process.env.AGENT_ALLOWED_USERS = '100000000000000001,100000000000000002';
process.env.AGENT_OPEN_CHANNELS = 'OPEN';
process.env.AGENT_UNDERCOVER_GUILDS = 'UC';
process.env.AGENT_GUEST_USERS = 'GUEST,GUEST2';
const SRC = new URL('../src', import.meta.url).pathname;
const OWNER = '100000000000000001';
const OWNER2 = '100000000000000002';
const BOT = 'BOT';

const calls: string[] = [];
mock.module(`${SRC}/tasks/start.ts`, {
  namedExports: {
    startTask: async (_c: unknown, m: any) => {
      calls.push(`start:${m.id}`);
      // Undercover servers get a private thread, which does not share the request's id.
      const threadId = m.guildId === 'UC' ? `pt-${m.id}` : m.id;
      channel(threadId, 12, true);
      saveRecord({ id: m.id, threadId, ownThread: true, title: 't', ownerId: m.author.id, originChannelId: m.channel.id,
        originMessageId: m.id, guildId: m.guildId, agent: {} as any, sessions: {}, state: 'idle', createdAt: '', updatedAt: '' });
      return { record: { threadId } };
    },
    continueTask: async (t: any, m: any, via?: string) => { calls.push(`continue:${m.id}->${t.record.threadId}${via ? ` (${via.split(' ')[0]})` : ''}`); },
  },
});
const { saveRecord } = await import(`${SRC}/store.ts`);
const { onMessage } = await import(`${SRC}/discord/on-message.ts`);

const channels: Record<string, any> = {};
const channel = (id: string, type: number, thread = false) =>
  (channels[id] = { id, type, isThread: () => thread, isSendable: () => true, send: async () => ({}) });
const OPEN = channel('OPEN', 0), PLAIN = channel('PLAIN', 0), DM = channel('DM', 1), SUB = channel('SUB', 11, true);
const client: any = { user: { id: BOT }, channels: { fetch: async (id: string) => channels[id] ?? null } };

let n = 0;
const sent = new Map<string, any>();
function msg(ch: any, author: string, opts: { mention?: boolean; replyTo?: string; forward?: boolean; text?: string; guild?: string } = {}) {
  const id = `m${++n}`;
  const ref = opts.replyTo ? sent.get(opts.replyTo) : undefined;
  const m: any = {
    id, client, channel: ch, guildId: opts.guild ?? (ch.type === 1 ? null : 'G'), content: opts.text ?? (opts.mention ? `<@${BOT}> hi` : 'hi'), webhookId: null, system: false,
    author: { id: author, bot: author === BOT, username: author.slice(0, 4) },
    mentions: {
      users: new Map(opts.mention ? [[BOT, {}]] : []), roles: { some: () => false },
      repliedUser: ref && !opts.forward ? { id: ref.author.id } : null,
    },
    reference: opts.replyTo ? { type: opts.forward ? 1 : 0, messageId: opts.replyTo } : null,
    fetchReference: async () => ref,
    reply: async (o: any) => { calls.push(`reply:${id}:${String(o.content ?? o).slice(0, 20)}`); },
    react: async (e: string) => { calls.push(`react:${id}:${e}`); },
  };
  sent.set(id, m);
  return m;
}
async function expect(m: any, want: string[], label: string) {
  calls.length = 0;
  await onMessage(client, m);
  assert.deepEqual(calls, want, label);
  console.log(`ok  ${label}: ${want.join(', ') || '(ignored)'}`);
}

// Who gets a task started, where.
const a = msg(OPEN, OWNER);
await expect(a, [`start:${a.id}`], 'open channel, owner, no mention -> starts a task');
await expect(msg(OPEN, 'friend'), [], 'open channel, non-owner, no mention -> ignored, no refusal');
const f = msg(OPEN, 'friend', { mention: true });
await expect(f, [`reply:${f.id}:I only take instruct`], 'open channel, non-owner mentions the bot -> refused');
await expect(msg(PLAIN, OWNER), [], 'other channel, owner, no mention -> ignored');
const p = msg(PLAIN, OWNER, { mention: true });
await expect(p, [`start:${p.id}`], 'other channel, owner mentions the bot -> starts');
const d = msg(DM, OWNER);
await expect(d, [`start:${d.id}`], 'DM, owner, no mention -> starts');
await expect(msg(SUB, OWNER), [], 'a thread (not a task) under a channel, no mention -> ignored');

// Messages that belong to a task already running instead of opening a second thread.
const b = msg(OPEN, OWNER);
await expect(b, [`continue:${b.id}->${a.id} (right)`, ], 'same owner, quick second message -> joins their request');
const c = msg(OPEN, OWNER2);
await expect(c, [`start:${c.id}`], 'the other owner in the same minute -> their own task');
const r = msg(OPEN, OWNER, { replyTo: c.id });
await expect(r, [`continue:${r.id}->${c.id} (replying)`], 'open channel, reply to a task request -> that task');
const x = msg(OPEN, OWNER2, { replyTo: f.id });
await expect(x, [`start:${x.id}`], 'open channel, reply to a message with no task -> a new task');
await expect(msg(PLAIN, OWNER2, { replyTo: p.id }), [], 'other channel, reply to a task request without a mention -> ignored');
const pm = msg(PLAIN, OWNER2, { replyTo: p.id, mention: true });
await expect(pm, [`continue:${pm.id}->${p.id} (replying)`], 'other channel, reply to a task request with a mention -> that task');
const note = msg(PLAIN, BOT, { replyTo: p.id, text: '✅ Finished' });
const rn = msg(PLAIN, OWNER, { replyTo: note.id });
await expect(rn, [`continue:${rn.id}->${p.id} (replying)`], "reply to the bot's Finished note -> that task, no mention needed");
const fw = msg(OPEN, OWNER, { replyTo: p.id, forward: true });
await expect(fw, [`start:${fw.id}`], 'a forwarded message is not a reply -> a new task');
const stop = msg(OPEN, OWNER, { replyTo: c.id, text: 'stop' });
await expect(stop, [`react:${stop.id}:🤷`], "'stop' as a reply in the channel -> stops that task (nothing running here)");

// Undercover server: private threads, and nobody but an owner gets an answer.
const UCH = channel('UCH', 0);
await expect(msg(UCH, 'friend', { mention: true, guild: 'UC' }), [], 'undercover server, non-owner mentions the bot -> no refusal');
const u = msg(UCH, OWNER, { mention: true, guild: 'UC' });
await expect(u, [`start:${u.id}`], 'undercover server, owner mentions the bot -> starts');
const ur = msg(UCH, OWNER, { replyTo: u.id, mention: true, guild: 'UC' });
await expect(ur, [`continue:${ur.id}->pt-${u.id} (replying)`], 'undercover server, reply to the request -> its private thread');

// Guests: they start tasks of their own and reach only those.
const g = msg(PLAIN, 'GUEST', { mention: true });
await expect(g, [`start:${g.id}`], 'guest mentions the bot -> their own task');
await expect(msg(PLAIN, 'GUEST'), [], 'guest without a mention in a plain channel -> ignored');
const gd = msg(channel('GDM', 1), 'GUEST');
await expect(gd, [`start:${gd.id}`], 'guest DM -> starts');
const inOwn = msg(channels[g.id], 'GUEST');
await expect(inOwn, [`continue:${inOwn.id}->${g.id}`], "guest writes in their own task's thread -> that task");
await expect(msg(channels[p.id], 'GUEST'), [], "guest writes in an owner's task thread -> ignored");
await expect(msg(channels[p.id], 'GUEST', { mention: true }), [], "guest mentions the bot in an owner's task thread -> ignored");
await expect(msg(channels[g.id], 'GUEST2'), [], "another guest in someone else's guest thread -> ignored");
const og = msg(channels[g.id], OWNER);
await expect(og, [`continue:${og.id}->${g.id}`], "owner writes in a guest's thread -> joins it (it stays a guest task)");
const gr = msg(PLAIN, 'GUEST', { replyTo: p.id, mention: true });
await expect(gr, [`start:${gr.id}`], "guest replies to an owner's request with a mention -> a new task of theirs, not the owner's");
const go = msg(OPEN, 'GUEST');
await expect(go, [`start:${go.id}`], 'guest in an open channel, no mention -> starts');
const go2 = msg(OPEN, 'GUEST');
await expect(go2, [`continue:${go2.id}->${go.id} (right)`], 'guest quick second message -> joins their request');
console.log('routing ok');
process.exit(0);
