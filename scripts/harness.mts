// Offline run of the real Task against a fake Discord thread and a real session (Claude haiku, or Codex with ENGINE=codex):
// quick reply, queued message, the waiting note + Read now, a background job's own turn, a question ping.
// Run from the repo: AGENT_DATA_DIR=/tmp/harness-data node scripts/harness.mts [quick,queue,readnow,background,ping,title]
const SRC = new URL('../src', import.meta.url).href;
const { Task } = await import(`${SRC}/tasks/task.ts`);
const { answerTyped } = await import(`${SRC}/agent/questions.ts`);
const { setOwnerLabels } = await import(`${SRC}/tasks/lifecycle.ts`);
const { randomUUID } = await import('node:crypto');
if (!process.env.AGENT_DATA_DIR) throw new Error('set AGENT_DATA_DIR: the harness must not write the live data/tasks.json');

const OWNER = '100000000000000001';
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summarize(o: any): string {
  if (typeof o === 'string') return o.slice(0, 160);
  const parts: string[] = [];
  if (o.content !== undefined) parts.push(`content=${JSON.stringify(String(o.content).slice(0, 220))}`);
  for (const e of o.embeds ?? []) { const d = e.data ?? e; parts.push(`embed[${d.title}] ${String(d.description ?? '').replace(/\n/g, ' | ').slice(0, 160)}`); }
  for (const row of o.components ?? []) for (const c of row.components ?? []) { const d = c.data ?? c; parts.push(`button[${d.label}|${d.custom_id}]`); }
  if (o.allowedMentions) parts.push(`mentions=${JSON.stringify(o.allowedMentions)}`);
  return parts.join(' ');
}

let n = 0;
const sent: { id: string; o: any }[] = [];
function fakeMessage(id: string) {
  const reactions = new Map<string, true>();
  const msg: any = {
    id, client: { user: { id: 'BOT' } }, author: { id: OWNER, username: 'tester' }, channel: { id: 'THREAD' },
    reactions: { cache: { get: (e: string) => (reactions.has(e) ? { users: { remove: async () => { reactions.delete(e); log(`  [${id}] -${e}`); } } } : undefined) } },
    react: async (e: string) => { reactions.set(e, true); log(`  [${id}] +${e}`); },
    edit: async (o: any) => { log(`  edit ${id}:`, summarize(o)); return msg; },
    delete: async () => { log(`  delete ${id}`); },
    reply: async (o: any) => { log(`  reply on ${id}:`, summarize(o)); },
    marks: () => [...reactions.keys()].join(''),
  };
  return msg;
}
const channel: any = {
  id: 'THREAD', isSendable: () => true, isThread: () => true, messages: { fetch: async () => new Map() },
  setName: async (name: string) => log(`setName ${JSON.stringify(name)}`),
  send: async (o: any) => { const m = fakeMessage(`b${++n}`); sent.push({ id: m.id, o }); log(`send ${m.id}:`, summarize(o)); return m; },
};

setOwnerLabels([`tester (@tester, id ${OWNER})`]);
const record: any = {
  id: 'harness', threadId: 'THREAD', ownThread: true, title: 'harness', ownerId: OWNER, originChannelId: 'THREAD', originMessageId: 'x',
  guildId: null, agent: { engine: process.env.ENGINE ?? 'claude', claude: { model: 'claude-haiku-5-5' }, codex: { model: 'gpt-6-astra', effort: 'low' } }, sessions: {}, state: 'idle',
  createdAt: '', updatedAt: '',
};
const task = new Task({} as any, record, channel);
let m = 0;
async function owner(text: string) {
  const msg = fakeMessage(`o${++m}`);
  log(`OWNER o${m}: ${text}`);
  await task.send({ id: randomUUID(), text: `Owner tester replied in the thread:\n> ${text}`, pasted: [], images: [] }, msg);
  return msg;
}
async function idle(label: string, max = 300_000) {
  const start = Date.now();
  while (task.busy && Date.now() - start < max) await sleep(500);
  log(`-- ${label}: busy=${task.busy}`);
}
const scenario = process.argv[2] ?? 'all';
const run = (name: string) => scenario === 'all' || scenario.split(',').includes(name);

if (run('quick')) {
  const a = await owner('This is an automated test of the Discord bot harness. Reply with just the word: hello. Use no tools.');
  await idle('quick');
  log(`quick marks on o1: ${a.marks()} (expect ✅, and no board embed above)`);
}
if (run('queue')) {
  const a = await owner('Harness test. Run this exact command in the foreground with the Bash tool and a 120000 ms timeout: python3 -c "import time; time.sleep(25)" ; then say DONE.');
  await sleep(8000);
  const b = await owner('Also, what is 2+2? Answer it as soon as you read this.');
  log(`queued marks on b right after sending: ${b.marks()} (expect ⏳)`);
  await idle('queue');
  log(`queue marks: a=${a.marks()} b=${b.marks()} (expect ✅ ✅)`);
}
if (run('readnow')) {
  await owner('Harness test. Run this exact command in the foreground with the Bash tool and a 300000 ms timeout: python3 -c "import time; time.sleep(100)" ; then say DONE.');
  await sleep(10_000);
  const b = await owner('What is 3+3? Answer as soon as you read this.');
  await sleep(50_000);
  const notice = sent.find((s) => String(s.o.content ?? '').startsWith('📥'));
  log(`notice posted: ${Boolean(notice)}; pressing Read now`);
  log(`readNow -> ${await task.readNow('tester')}`);
  await idle('readnow');
  log(`readnow marks: b=${b.marks()} (expect ✅)`);
}
if (run('background')) {
  await owner('Harness test. Start this command with the Bash tool and run_in_background: true: python3 -c "import time; time.sleep(20); print(42)" . Then end your turn right away with just: STARTED. When it finishes, report the number it printed.');
  await idle('background first turn');
  log('waiting for the job to finish and start its own turn…');
  const start = Date.now();
  while (!task.busy && Date.now() - start < 60_000) await sleep(250);
  log(`own turn started: ${task.busy}`);
  await idle('background own turn');
}
if (run('ping')) {
  await owner('Harness test. Use the AskUserQuestion tool to ask me "Red or blue?" with options Red and Blue. Then tell me which one I picked.');
  const start = Date.now();
  while (!sent.some((s) => String(s.o.content ?? '').includes(`<@${OWNER}>`)) && Date.now() - start < 90_000) await sleep(500);
  await sleep(1000);
  log(`answered by typing: ${answerTyped('THREAD', 'Blue')}`);
  await idle('ping');
}
if (run('title')) {
  const { firstTurnText } = await import(`${SRC}/tasks/prompt.ts`);
  const ctx = { request: 'the upload service keeps dying halfway through long uploads, can you look', owner: `tester (id ${OWNER}, OWNER)`, where: 'test thread', link: 'n/a', mentioned: [], recent: '', attachments: [] };
  await owner(`${firstTurnText(ctx, 'THREAD', [])}\n\n(Harness test: once the thread is named, reply "named" and stop. Do not investigate.)`);
  await idle('title');
  log(`record.title = ${JSON.stringify(record.title)}`);
}
task.closeSession();
log('harness finished');
setTimeout(() => process.exit(0), 3000);
