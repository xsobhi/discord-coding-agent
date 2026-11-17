import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import { allRecords, dropRecord, flushStore, saveRecord, type TaskRecord } from '../store.ts';

type Continuation = {
  codexThreadId: string; ownerId: string; title: string;
  model: string; effort?: string; discordThreadId?: string; boundAt?: string;
};

/** One owner-requested import, claimed durably by their first newly created server thread. */
export function bindContinuation(record: TaskRecord): boolean {
  const file = join(config.dataDir, 'pending-continuation.json');
  if (!existsSync(file) || !record.ownThread || record.tier !== 'owner' || !record.guildId) return false;
  const plan = JSON.parse(readFileSync(file, 'utf8')) as Continuation;
  if (plan.ownerId !== record.ownerId || plan.discordThreadId) return false;
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(plan.codexThreadId) || !plan.model || !plan.title) {
    throw new Error('Invalid saved conversation binding; refusing an unrelated fresh chat');
  }
  const existing = allRecords().find((r) => r.sessions.codex === plan.codexThreadId);
  if (existing) return false;
  record.agent = { ...record.agent, engine: 'codex', codex: { model: plan.model, effort: plan.effort } };
  record.sessions.codex = plan.codexThreadId;
  record.lastEngine = 'codex';
  record.title = plan.title;
  // Persist the task before consuming the import. A crash between these writes
  // is recovered by checking the existing session binding above, never duplicating it.
  saveRecord(record);
  try { flushStore(true); }
  catch (err) { dropRecord(record.threadId); throw err; }
  const bound = { ...plan, discordThreadId: record.threadId, boundAt: new Date().toISOString() };
  writeFileSync(file+'.tmp', JSON.stringify(bound, null, 2));
  renameSync(file+'.tmp', file);
  return true;
}
