import type { SendableChannels } from 'discord.js';
import { oneLine } from '../discord/chunk.ts';
import { redact } from '../discord/redact.ts';
import { saveRecord, type TaskRecord } from '../store.ts';

/** Discord lets a channel be renamed twice per 10 minutes; past that, the request just waits. */
const WINDOW_MS = 10 * 60_000;
const renames = new Map<string, number[]>();

/**
 * Names a bot-made task thread "🛠 <title>" (the agent's own summary, in place
 * of the first words of the request). Throws when it can't, with the reason.
 */
export async function retitle(channel: SendableChannels, record: TaskRecord, title: string): Promise<string> {
  if (!record.ownThread || !channel.isThread()) {
    return 'This task runs in a channel or DM the bot did not create, so its name was left alone.';
  }
  const clean = oneLine(redact(title).replace(/^🛠\s*/u, ''), 90);
  if (clean.length < 3) throw new Error('The title is too short.');
  const recent = (renames.get(record.threadId) ?? []).filter((t) => Date.now() - t < WINDOW_MS);
  if (recent.length >= 2) throw new Error('Discord allows only 2 renames per 10 minutes; keep the current title for now.');
  const name = `🛠 ${clean}`.slice(0, 100);
  await Promise.race([
    channel.setName(name, 'task title'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Discord did not confirm the rename within 15 s.')), 15_000)),
  ]);
  renames.set(record.threadId, [...recent, Date.now()]);
  record.title = clean;
  saveRecord(record);
  return `Thread renamed to "${name}".`;
}
